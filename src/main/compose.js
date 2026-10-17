// Compositions made in the panel composer. They live in the app's data folder
// (not the skin, so they don't end up in the .osk) together with private
// copies of every layer image, so a panel can be re-arranged later even if the
// original files were moved or overwritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeJoin, removeElement } from './skinFs.js';

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const isPng = (b) => b instanceof Uint8Array && [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v);
const projectDir = (root, skinDir, base) => path.join(root, sha1(`${path.resolve(skinDir)}\0${base}`).slice(0, 16));

/** Write the rendered images into the skin and remember how they were made. */
export async function save(root, skinDir, base, { hd, sd }, project) {
  if (!isPng(hd) || (sd && !isPng(sd))) throw new Error('Invalid image data');
  const dir = projectDir(root, skinDir, base);
  await fs.mkdir(dir, { recursive: true });

  // Copy the sources first: one of them may be the panel we're about to replace.
  const layers = [];
  for (const { path: src, ...layer } of project.layers) {
    const data = await fs.readFile(src);
    const file = `src-${sha1(data).slice(0, 16)}${path.extname(src).toLowerCase() || '.png'}`;
    const dest = path.join(dir, file);
    if (!(await fs.stat(dest).catch(() => null))) await fs.writeFile(dest, data);
    layers.push({ ...layer, file });
  }

  await removeElement(skinDir, base, { anim: '-' });
  const written = [];
  for (const [name, data] of [[`${base}@2x.png`, hd], [`${base}.png`, sd]]) {
    if (!data) continue;
    const dest = safeJoin(skinDir, name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    written.push(name);
  }

  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ ...project, base, layers, outputSize: hd.byteLength }, null, 2));
  const used = new Set(layers.map((l) => l.file));
  for (const f of await fs.readdir(dir)) if (f.startsWith('src-') && !used.has(f)) await fs.rm(path.join(dir, f), { force: true });
  return { written };
}

/**
 * The last composition saved for this element, or null. `stale` is true when
 * the element was changed some other way since.
 */
export async function load(root, skinDir, base) {
  const dir = projectDir(root, skinDir, base);
  let project;
  try {
    project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
  } catch {
    return null;
  }
  const size = await fs.stat(safeJoin(skinDir, `${base}@2x.png`)).then((s) => s.size, () => -1);
  project.layers = project.layers.map(({ file, ...l }) => ({ ...l, path: path.join(dir, path.basename(file)) }));
  return { project, stale: size !== project.outputSize };
}
