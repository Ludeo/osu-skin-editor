import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { safeJoin, removeElement } from './skinFs.js';
import { SOUND_EXTS } from '../shared/elements.js';

let ffmpegPath = null;
let running = null;

function run(bin, args, onStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    running = child;
    let stderr = '';
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      onStderr?.(s);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      running = null;
      if (signal) reject(new Error('Conversion cancelled'));
      else resolve({ code, stderr });
    });
  });
}

export function cancel() {
  running?.kill('SIGKILL');
}

async function works(bin) {
  try {
    const { code } = await run(bin, ['-hide_banner', '-version']);
    return code === 0;
  } catch {
    return false;
  }
}

/** Find a usable ffmpeg: user setting, then PATH, then the ffmpeg-static package. */
export async function locateFfmpeg(custom) {
  const candidates = [];
  if (custom) candidates.push(custom);
  candidates.push('ffmpeg');
  try {
    const mod = await import('ffmpeg-static');
    if (mod.default) candidates.push(mod.default.replace('app.asar', 'app.asar.unpacked'));
  } catch { /* optional dependency */ }
  for (const c of candidates) {
    if (await works(c)) {
      ffmpegPath = c;
      return c;
    }
  }
  ffmpegPath = null;
  return null;
}

function requireFfmpeg() {
  if (!ffmpegPath) throw new Error('ffmpeg was not found. Install ffmpeg or set its path in Settings.');
  return ffmpegPath;
}

/** Inspect a media file using `ffmpeg -i` (ffprobe isn't always available). */
export async function probe(file) {
  const { stderr } = await run(requireFfmpeg(), ['-hide_banner', '-i', file]);
  const info = { width: 0, height: 0, fps: 0, duration: 0, codec: '', hasAlpha: false, hasVideo: false, hasAudio: false };
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  if (dur) info.duration = +dur[1] * 3600 + +dur[2] * 60 + +dur[3];
  const video = /Stream #\S+.*?Video:\s*([^\s,]+)([^\n]*)/.exec(stderr);
  if (video) {
    info.hasVideo = true;
    info.codec = video[1];
    const size = /(\d{1,5})x(\d{1,5})/.exec(video[2]);
    if (size) [info.width, info.height] = [+size[1], +size[2]];
    const fps = /([\d.]+)\s*fps/.exec(video[2]) ?? /([\d.]+)\s*tbr/.exec(video[2]);
    if (fps) info.fps = +fps[1];
    info.hasAlpha = /alpha_mode\s*:\s*1/i.test(stderr) || /\b(rgba|bgra|argb|abgr|yuva\w*|pal8|ya8)\b/.test(video[2]);
  }
  info.hasAudio = /Stream #\S+.*?Audio:/.test(stderr);
  if (!info.hasVideo && !info.hasAudio) throw new Error('Unsupported or unreadable file');
  return info;
}

function decoderArgs(info) {
  // ffmpeg's native VP8/VP9 decoders drop the alpha channel of WebM files.
  if (info.hasAlpha && info.codec === 'vp9') return ['-c:v', 'libvpx-vp9'];
  if (info.hasAlpha && info.codec === 'vp8') return ['-c:v', 'libvpx'];
  return [];
}

function scaleFilter(width, height) {
  if (!width && !height) return null;
  const w = width ? Math.round(width) : -1;
  const h = height ? Math.round(height) : -1;
  return `scale=${w}:${h}:flags=lanczos`;
}

/**
 * Convert an image, GIF or video into skin PNG(s).
 *
 * opts:
 *   base      element base path, e.g. "menu-back" or "Orbs/note1"
 *   animated  write a frame sequence (base{sep}{n}.png) instead of one image
 *   sep       frame separator ('-' for most elements)
 *   fps, maxFrames, start, duration  (animated only; start also picks the still frame)
 *   width, height  output size of the HD (@2x) image; empty keeps source size
 *   hd        write @2x files
 *   sd        also write half-size SD files (only meaningful with hd)
 */
export async function convertToSkin(src, skinDir, opts, onProgress) {
  const bin = requireFfmpeg();
  const info = await probe(src);
  if (!info.hasVideo) throw new Error('This file has no image/video stream');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osu-skin-'));
  try {
    const chain = [];
    if (opts.animated && opts.fps) chain.push(`fps=${opts.fps}`);
    const scale = scaleFilter(opts.width, opts.height);
    if (scale) chain.push(scale);
    chain.push('format=rgba');

    const wantSd = opts.hd && opts.sd;
    const outputs = opts.hd ? ['hd'] : ['sd'];
    if (wantSd) outputs.push('sd');

    let graph = `[0:v]${chain.join(',')}`;
    if (wantSd) {
      graph += ',split=2[hd][tmp];[tmp]scale=w=max(1\\,trunc(iw/2)):h=max(1\\,trunc(ih/2)):flags=lanczos,format=rgba[sd]';
    } else {
      graph += `[${outputs[0]}]`;
    }

    const args = ['-hide_banner', '-y'];
    if (opts.start) args.push('-ss', String(opts.start));
    if (opts.animated && opts.duration) args.push('-t', String(opts.duration));
    args.push(...decoderArgs(info), '-i', src, '-filter_complex', graph);

    const maxFrames = opts.animated ? Math.max(1, Math.min(opts.maxFrames || 120, 1000)) : 1;
    for (const o of outputs) {
      args.push('-map', `[${o}]`, '-frames:v', String(maxFrames));
      if (opts.animated) args.push('-start_number', '0', path.join(tmp, `${o}_%d.png`));
      else args.push('-update', '1', path.join(tmp, `${o}.png`));
    }

    const expected = opts.animated
      ? Math.min(maxFrames, Math.ceil((opts.duration || info.duration || 1) * (opts.fps || info.fps || 30)))
      : 1;
    const { code, stderr } = await run(bin, args, (chunk) => {
      const m = /frame=\s*(\d+)/.exec(chunk);
      if (m) onProgress?.(Math.min(1, +m[1] / expected));
    });
    if (code !== 0) throw new Error(`ffmpeg failed:\n${stderr.split('\n').slice(-6).join('\n')}`);

    const produced = (await fs.readdir(tmp)).filter((f) => f.endsWith('.png'));
    if (!produced.length) throw new Error('ffmpeg produced no frames. Check the start time and duration.');

    await removeElement(skinDir, opts.base, { anim: opts.sep ?? '-' });
    const written = [];
    for (const f of produced) {
      const m = /^(hd|sd)(?:_(\d+))?\.png$/.exec(f);
      if (!m) continue;
      const suffix = m[1] === 'hd' ? '@2x' : '';
      const name = opts.animated ? `${opts.base}${opts.sep ?? '-'}${m[2]}${suffix}.png` : `${opts.base}${suffix}.png`;
      const dest = safeJoin(skinDir, name);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(tmp, f), dest);
      written.push(name);
    }
    onProgress?.(1);
    return { written, frames: opts.animated ? produced.filter((f) => f.startsWith(outputs[0])).length : 1 };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Copy a PNG as-is (no re-encode), replacing all previous variants of the element. */
export async function copyPng(src, skinDir, { base, hd, sep }) {
  await removeElement(skinDir, base, { anim: sep ?? '-' });
  const name = `${base}${hd ? '@2x' : ''}.png`;
  const dest = safeJoin(skinDir, name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  return { written: [name], frames: 1 };
}

/** Import a sound: copy wav/ogg/mp3 directly, convert anything else to wav. */
export async function importSound(src, skinDir, base) {
  await removeElement(skinDir, base, { sound: true });
  const ext = path.extname(src).slice(1).toLowerCase();
  if (SOUND_EXTS.includes(ext)) {
    const name = `${base}.${ext}`;
    await fs.copyFile(src, safeJoin(skinDir, name));
    return { written: [name] };
  }
  const name = `${base}.wav`;
  const { code, stderr } = await run(requireFfmpeg(), ['-hide_banner', '-y', '-i', src, '-vn', '-ac', '2', '-ar', '44100', safeJoin(skinDir, name)]);
  if (code !== 0) throw new Error(`ffmpeg failed:\n${stderr.split('\n').slice(-6).join('\n')}`);
  return { written: [name] };
}
