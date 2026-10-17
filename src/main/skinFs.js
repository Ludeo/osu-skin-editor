import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import {
  parseIni, serializeIni, getManiaSection, getValue, addManiaSection, removeSection,
  cloneSection, newSkinIni, findSection, setValue,
} from '../shared/skinIni.js';
import { matchElementFiles, IMAGE_EXTS } from '../shared/elements.js';

const MAX_DEPTH = 4;
const MAX_FILES = 20000;

/** Possible osu! Skins folders for the current platform. */
export function candidateSkinDirs() {
  const home = os.homedir();
  const list = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'osu!', 'Skins'));
    list.push('C:\\osu!\\Skins', 'C:\\Program Files\\osu!\\Skins');
  } else if (process.platform === 'darwin') {
    list.push(path.join(home, 'Applications', 'osu!.app', 'Contents', 'Resources', 'drive_c', 'osu!', 'Skins'));
  } else {
    list.push(
      path.join(home, 'Games', 'osu', 'osu!', 'Skins'),
      path.join(home, '.local', 'share', 'osu-wine', 'osu!', 'Skins'),
      path.join(home, '.local', 'share', 'osu-wine', 'OSU', 'Skins'),
      path.join(home, '.wine', 'drive_c', 'osu!', 'Skins'),
      path.join(home, '.wine-osu', 'drive_c', 'osu!', 'Skins'),
      path.join(home, '.local', 'share', 'lutris', 'osu', 'drive_c', 'osu!', 'Skins'),
    );
    const user = os.userInfo().username;
    list.push(path.join(home, '.wine', 'drive_c', 'users', user, 'AppData', 'Local', 'osu!', 'Skins'));
  }
  return list.filter((p) => existsSync(p));
}

export async function listSkins(skinsDir) {
  const entries = await fs.readdir(skinsDir, { withFileTypes: true }).catch(() => []);
  const skins = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(skinsDir, e.name);
    const ini = await findSkinIni(dir);
    let displayName = e.name;
    let author = '';
    if (ini) {
      const doc = parseIni(await fs.readFile(ini, 'utf8').catch(() => ''));
      const gen = findSection(doc, 'General');
      displayName = getValue(gen, 'Name') || e.name;
      author = getValue(gen, 'Author') || '';
    }
    skins.push({ folder: e.name, path: dir, name: displayName, author, hasIni: !!ini });
  }
  return skins.sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }));
}

export async function findSkinIni(skinDir) {
  const entries = await fs.readdir(skinDir).catch(() => []);
  const hit = entries.find((n) => n.toLowerCase() === 'skin.ini');
  return hit ? path.join(skinDir, hit) : null;
}

/** All files of a skin as forward-slash relative paths. */
export async function listFiles(skinDir) {
  const out = [];
  async function walk(dir, rel, depth) {
    if (depth > MAX_DEPTH || out.length > MAX_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r, depth + 1);
      else if (e.isFile()) out.push(r);
    }
  }
  await walk(skinDir, '', 0);
  return out;
}

export async function readIni(skinDir) {
  const p = await findSkinIni(skinDir);
  return p ? fs.readFile(p, 'utf8') : '';
}

const backedUp = new Set();

export async function writeIni(skinDir, text) {
  const p = (await findSkinIni(skinDir)) ?? path.join(skinDir, 'skin.ini');
  // One backup per skin per app session, so a bad edit is always recoverable.
  if (!backedUp.has(p) && existsSync(p)) {
    await fs.copyFile(p, `${p}.bak`);
    backedUp.add(p);
  }
  await fs.writeFile(p, text, 'utf8');
}

export async function createSkin(skinsDir, { name, author, basedOn }) {
  const folder = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!folder) throw new Error('Invalid skin name');
  const dir = path.join(skinsDir, folder);
  if (existsSync(dir)) throw new Error(`A skin folder named "${folder}" already exists`);
  if (basedOn) {
    await fs.cp(basedOn, dir, { recursive: true });
    const doc = parseIni(await readIni(dir));
    let gen = findSection(doc, 'General');
    if (!gen) doc.sections.unshift((gen = { name: 'General', lines: [] }));
    setValue(gen, 'Name', name);
    if (author) setValue(gen, 'Author', author);
    await writeIni(dir, serializeIni(doc));
  } else {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'skin.ini'), serializeIni(newSkinIni({ name, author })), 'utf8');
  }
  return dir;
}

/** Resolve a relative path inside a skin, refusing anything that escapes it. */
export function safeJoin(root, rel) {
  const full = path.resolve(root, rel.replace(/\\/g, '/'));
  const r = path.resolve(root);
  if (full !== r && !full.startsWith(r + path.sep)) throw new Error(`Path escapes skin folder: ${rel}`);
  return full;
}

async function copyRel(srcSkin, dstSkin, rel) {
  const dst = safeJoin(dstSkin, rel);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(safeJoin(srcSkin, rel), dst);
  return rel;
}

/**
 * Delete every existing file for an element in the destination, so that e.g.
 * a 10-frame animation replacing a 60-frame one doesn't leave frames behind.
 */
export async function removeElement(skinDir, base, opts) {
  const files = await listFiles(skinDir);
  const m = matchElementFiles(files, base, opts);
  await Promise.all(m.all.map((rel) => fs.rm(safeJoin(skinDir, rel), { force: true })));
  return m.all;
}

/**
 * Write rendered PNGs (e.g. recoloured notes) into a skin. Every element in
 * `replace` is removed first so no old frames of it are left behind.
 */
export async function writeImages(skinDir, files, { replace = [] } = {}) {
  const isPng = (b) => b instanceof Uint8Array && [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v);
  if (!files.length || !files.every((f) => isPng(f.data) && /\.png$/i.test(f.rel))) throw new Error('Invalid image data');
  const targets = files.map((f) => ({ dest: safeJoin(skinDir, f.rel), data: f.data }));
  for (const base of replace) await removeElement(skinDir, base, { anim: '-' });
  for (const { dest, data } of targets) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
  }
  return files.map((f) => f.rel);
}

/** Copy elements (all variants: @2x, animation frames) from one skin to another. */
export async function copyElements(srcSkin, dstSkin, elements) {
  const srcFiles = await listFiles(srcSkin);
  const copied = [];
  for (const { base, anim, sound } of elements) {
    const m = matchElementFiles(srcFiles, base, { anim, sound });
    if (!m.all.length) continue;
    await removeElement(dstSkin, base, { anim, sound });
    for (const rel of m.all) {
      // Normalise the case of the base name to the canonical element name.
      const tail = rel.slice(base.length);
      const target = rel.toLowerCase().startsWith(base.toLowerCase()) ? base + tail : rel;
      const dst = safeJoin(dstSkin, target);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(safeJoin(srcSkin, rel), dst);
      copied.push(target);
    }
  }
  return copied;
}

/** Copy arbitrary relative files between skins. */
export async function copyFiles(srcSkin, dstSkin, rels) {
  const out = [];
  for (const rel of rels) out.push(await copyRel(srcSkin, dstSkin, rel));
  return out;
}

const IMAGE_KEY_RE = /^(KeyImage\d+D?|NoteImage\d+[HLT]?|Stage(Left|Right|Bottom|Hint|Light)|Lighting[NL]|WarningArrow|Hit(0|50|100|200|300|300g))$/i;

/**
 * Copy a [Mania] keycount section plus every image it references.
 * Returns { replaced: boolean, files: string[] }.
 */
export async function copyManiaSection(srcSkin, dstSkin, keys) {
  const srcDoc = parseIni(await readIni(srcSkin));
  const section = getManiaSection(srcDoc, keys);
  if (!section) throw new Error(`Source skin has no [Mania] section for ${keys}K`);

  const srcFiles = await listFiles(srcSkin);
  const files = new Set();
  for (const l of section.lines) {
    if (l.kind !== 'kv' || !IMAGE_KEY_RE.test(l.key) || !l.value) continue;
    const base = l.value.replace(/\\/g, '/').replace(/\.png$/i, '');
    matchElementFiles(srcFiles, base, { anim: '-' }).all.forEach((f) => files.add(f));
  }
  for (const rel of files) await copyRel(srcSkin, dstSkin, rel);

  const dstDoc = parseIni(await readIni(dstSkin));
  const existing = getManiaSection(dstDoc, keys);
  const copy = cloneSection(section);
  if (existing) {
    dstDoc.sections[dstDoc.sections.indexOf(existing)] = copy;
  } else {
    const added = addManiaSection(dstDoc, keys, []);
    added.lines = copy.lines;
  }
  await writeIni(dstSkin, serializeIni(dstDoc));
  return { replaced: !!existing, files: [...files] };
}

export async function deleteManiaSection(skinDir, keys) {
  const doc = parseIni(await readIni(skinDir));
  const s = getManiaSection(doc, keys);
  if (s) removeSection(doc, s);
  await writeIni(skinDir, serializeIni(doc));
}

export async function exportOsk(skinDir, outFile) {
  const zip = new AdmZip();
  for (const rel of await listFiles(skinDir)) {
    if (/\.bak$/i.test(rel)) continue;
    zip.addLocalFile(path.join(skinDir, rel), path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));
  }
  await zip.writeZipPromise(outFile);
  return outFile;
}

export async function importOsk(oskFile, skinsDir) {
  const zip = new AdmZip(oskFile);
  const base = path.basename(oskFile).replace(/\.(osk|zip)$/i, '').replace(/[<>:"/\\|?*]/g, '_');
  let dir = path.join(skinsDir, base);
  for (let i = 2; existsSync(dir); i++) dir = path.join(skinsDir, `${base} (${i})`);
  await fs.mkdir(dir, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const target = safeJoin(dir, entry.entryName); // guards against zip-slip
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
  }
  return dir;
}

/** Sanity checks shown in the Export tab. */
export async function checkSkin(skinDir) {
  const files = await listFiles(skinDir);
  const issues = [];
  const doc = parseIni(await readIni(skinDir));
  if (!(await findSkinIni(skinDir))) issues.push({ level: 'error', msg: 'No skin.ini found.' });
  const gen = findSection(doc, 'General');
  if (!getValue(gen, 'Name')) issues.push({ level: 'warn', msg: '[General] Name is empty.' });
  const version = getValue(gen, 'Version');
  if (version && version !== 'latest' && Number(version) < 2.5) {
    issues.push({ level: 'warn', msg: `Version ${version} uses old mania behaviour. Consider 2.5 or newer.` });
  }

  const lower = new Set(files.map((f) => f.toLowerCase()));
  const missing = new Map(); // referenced path -> ["4K NoteImage0", ...]
  for (const s of doc.sections.filter((x) => x.name.toLowerCase() === 'mania')) {
    const keys = getValue(s, 'Keys');
    for (const l of s.lines) {
      if (l.kind !== 'kv' || !IMAGE_KEY_RE.test(l.key) || !l.value) continue;
      const base = l.value.replace(/\\/g, '/').replace(/\.png$/i, '').toLowerCase();
      const found = ['', '@2x', '-0', '-0@2x'].some((suf) => IMAGE_EXTS.some((e) => lower.has(`${base}${suf}.${e}`)));
      if (found) continue;
      if (!missing.has(l.value)) missing.set(l.value, []);
      missing.get(l.value).push(`${keys}K ${l.key}`);
    }
  }
  // Pointing at a non-existent file is a common trick to hide an element,
  // so this is a warning rather than an error.
  for (const [value, uses] of missing) {
    const list = uses.length > 4 ? `${uses.slice(0, 4).join(', ')} and ${uses.length - 4} more` : uses.join(', ');
    issues.push({ level: 'warn', msg: `"${value}" does not exist (used by ${list}). osu! will show nothing there.` });
  }

  const hdOnly = files.filter((f) => {
    const m = /^(.*)@2x\.png$/i.exec(f);
    return m && !lower.has(`${m[1].toLowerCase()}.png`);
  });
  if (hdOnly.length) {
    issues.push({
      level: 'info',
      msg: `${hdOnly.length} @2x image(s) have no SD version (osu! downscales them; fine for most players). E.g. ${hdOnly.slice(0, 3).join(', ')}`,
    });
  }
  return issues;
}

export { serializeIni, parseIni };
