// Background removal for the cut-out helper. The renderer prepares a 1024×1024
// input tensor and turns the returned mask into transparency; this side only
// manages the models (downloaded once into the app's data folder) and runs them.
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { net } from 'electron';

const BASE_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
export const SIZE = 1024;

// IS-Net models as published by rembg. Both take a 1×3×1024×1024 RGB tensor
// (0..1 minus the ImageNet mean) and return a 1×1×1024×1024 mask first.
export const MODELS = {
  anime: {
    label: 'Anime / illustration',
    file: 'isnet-anime.onnx',
    bytes: 176069933,
    sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99',
  },
  general: {
    label: 'Photo / general',
    file: 'isnet-general-use.onnx',
    bytes: 178648008,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  },
};

const model = (id) => {
  const m = MODELS[id];
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
};
const exists = (p) => fs.stat(p).then(() => true, () => false);

export async function list(root) {
  return Promise.all(Object.entries(MODELS).map(async ([id, m]) => ({
    id, label: m.label, bytes: m.bytes, ready: await exists(path.join(root, m.file)),
  })));
}

let download = null; // { id, abort }

/** Download a model, verifying its checksum. onProgress({ id, received, total }). */
export async function fetchModel(root, id, onProgress) {
  const m = model(id);
  const dest = path.join(root, m.file);
  if (await exists(dest)) return true;
  if (download) throw new Error('Another download is running');
  await fs.mkdir(root, { recursive: true });
  const abort = new AbortController();
  download = { id, abort };
  const part = `${dest}.part`;
  try {
    const res = await net.fetch(BASE_URL + m.file, { signal: abort.signal });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || m.bytes;
    const hash = crypto.createHash('sha256');
    const out = createWriteStream(part);
    let received = 0;
    let last = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.byteLength;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - last > 150) {
          last = Date.now();
          onProgress({ id, received, total });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (hash.digest('hex') !== m.sha256) throw new Error('The downloaded model is damaged (checksum mismatch). Please try again.');
    await fs.rename(part, dest);
    onProgress({ id, received, total, done: true });
    return true;
  } catch (err) {
    await fs.rm(part, { force: true });
    if (abort.signal.aborted) return false;
    throw err;
  } finally {
    download = null;
  }
}

export function cancelDownload() {
  download?.abort.abort();
}

// onnxruntime is large, so it's only loaded when a model is first used.
let ort = null;
const sessions = new Map();

async function session(root, id) {
  if (!sessions.has(id)) {
    const file = path.join(root, model(id).file);
    if (!(await exists(file))) throw new Error('The model has not been downloaded yet');
    if (!ort) {
      const mod = await import('onnxruntime-node');
      ort = mod.default ?? mod;
    }
    // With the memory arena / pattern on, a second run hands its output back in
    // the same native buffer as the first, which Electron's V8 sandbox rejects
    // by killing the process (SIGTRAP).
    sessions.set(id, ort.InferenceSession.create(file, { graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false }));
  }
  try {
    return await sessions.get(id);
  } catch (err) {
    sessions.delete(id);
    throw err;
  }
}

/** Run a model on a prepared 3×1024×1024 tensor; returns the mask scaled to 0..1. */
export async function segment(root, id, input) {
  if (!(input instanceof Float32Array) || input.length !== 3 * SIZE * SIZE) throw new Error('Invalid input');
  const s = await session(root, id);
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const mask = Float32Array.from(out[s.outputNames[0]].data);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of mask) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] - lo) / range;
  return mask;
}

/** Free the memory of loaded models (a few hundred MB each). */
export async function release() {
  const all = [...sessions.values()];
  sessions.clear();
  for (const p of all) await p.then((s) => s.release?.(), () => {});
}
