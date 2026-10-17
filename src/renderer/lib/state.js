import { parseIni, serializeIni, findSection, getValue } from '../../shared/skinIni.js';
import { ELEMENTS, matchElementFiles } from '../../shared/elements.js';

const api = window.api;

export const state = {
  settings: null,
  skins: [],
  skin: null, // { path, folder, name }
  files: [],
  iniDoc: parseIni(''),
  dirty: false,
  version: Date.now(), // bumped whenever files on disk change, used for cache busting (unique per launch)
  otherFiles: new Map(), // skin path -> files[] of other installed skins
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  listeners.get(evt)?.forEach((fn) => fn(payload));
}

export function localUrl(absPath) {
  return `app://local/${encodeURIComponent(absPath)}?v=${state.version}`;
}

export const basename = (p) => p.split(/[\\/]/).pop();

/** Load a local image so that canvases drawing it can still be exported. */
export function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${basename(path)}`));
    img.src = localUrl(path);
  });
}

export function joinPath(dir, rel) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + rel.replace(/[\\/]/g, sep);
}

/** Resolve the files of an element/base path in a skin into URLs. */
export function resolveImage(base, { anim = '-', sound = false, skinPath = state.skin?.path, files = state.files } = {}) {
  if (!skinPath || !base) return null;
  const m = matchElementFiles(files, base.replace(/\\/g, '/').replace(/\.png$/i, ''), { anim, sound });
  if (!m.all.length) return null;
  const pick = (v) => (v.hd ? { rel: v.hd, hd: true } : v.sd ? { rel: v.sd, hd: false } : null);
  const frames = m.frames.map(pick).filter(Boolean).map((f) => ({ ...f, url: localUrl(joinPath(skinPath, f.rel)) }));
  const still = pick(m.static);
  // osu! prefers animation frames over the static image when both exist.
  const main = frames[0] ?? (still && { ...still, url: localUrl(joinPath(skinPath, still.rel)) });
  return {
    ...main,
    frames,
    files: m.all,
    hasHd: Boolean(m.static.hd || m.frames.some((f) => f.hd)),
    hasSd: Boolean(m.static.sd || m.frames.some((f) => f.sd)),
  };
}

export function elementInfo(element, opts) {
  return resolveImage(element.name, { anim: element.anim ?? '-', sound: element.sound, ...opts });
}

/** Image files of the current skin as base paths ("Orbs/note1"), for pickers. */
export function imageBases() {
  const set = new Set();
  for (const f of state.files) {
    const m = /^(.*?)(?:-\d+)?(?:@2x)?\.(png|jpe?g)$/i.exec(f);
    if (m) set.add(m[1]);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function refreshFiles() {
  if (!state.skin) return;
  state.files = await api.skinFiles(state.skin.path);
  state.version++;
  emit('files');
}

export async function reloadIni() {
  state.iniDoc = parseIni(await api.readIni(state.skin.path));
  state.dirty = false;
  emit('ini', { external: true });
  emit('dirty', false);
}

/** Mark the in-memory skin.ini as changed. `source` lets views skip self-updates. */
export function iniChanged(source) {
  state.dirty = true;
  emit('ini', { source });
  emit('dirty', true);
}

export async function saveIni() {
  if (!state.skin) return;
  await api.writeIni(state.skin.path, serializeIni(state.iniDoc));
  state.dirty = false;
  emit('dirty', false);
  const name = getValue(findSection(state.iniDoc, 'General'), 'Name');
  if (name && name !== state.skin.name) {
    state.skin.name = name;
    emit('skin-renamed');
  }
}

/** Save pending ini edits before the main process modifies skin.ini itself. */
export async function ensureSaved() {
  if (state.dirty) await saveIni();
}

export async function openSkin(skin) {
  if (state.dirty && state.skin && !window.confirm(`Discard unsaved skin.ini changes to "${state.skin.name}"?`)) return false;
  state.skin = { path: skin.path, folder: skin.folder, name: skin.name };
  state.dirty = false;
  await Promise.all([refreshFiles(), reloadIni()]);
  state.otherFiles.delete(skin.path);
  await api.setSettings({ lastSkin: skin.path });
  emit('skin');
  return true;
}

export async function loadSkinList() {
  state.skins = await api.listSkins();
  emit('skins');
}

export async function filesOf(skinPath) {
  if (skinPath === state.skin?.path) return state.files;
  if (!state.otherFiles.has(skinPath)) state.otherFiles.set(skinPath, await api.skinFiles(skinPath));
  return state.otherFiles.get(skinPath);
}

export function getAnimationFramerate() {
  return Number(getValue(findSection(state.iniDoc, 'General'), 'AnimationFramerate') ?? -1);
}

export { ELEMENTS, api };
