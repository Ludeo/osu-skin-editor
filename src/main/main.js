import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as skinFs from './skinFs.js';
import * as media from './media.js';
import * as compose from './compose.js';
import * as cutout from './cutout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

let settings = { skinsDir: '', ffmpegPath: '', lastSkin: '', author: '' };
let win = null;

// Local files the renderer may load through app://local/. Everything under the
// Skins folder plus individual files the user picked in a dialog.
const allowedRoots = new Set();
const allowedFiles = new Set();

function isAllowed(p) {
  const full = path.resolve(p);
  if (allowedFiles.has(full)) return true;
  for (const root of allowedRoots) if (full === root || full.startsWith(root + path.sep)) return true;
  return false;
}

function allowRoot(p) {
  if (p) allowedRoots.add(path.resolve(p));
}

async function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')) };
  } catch { /* first start */ }
  if (!settings.skinsDir) settings.skinsDir = skinFs.candidateSkinDirs()[0] ?? '';
  allowRoot(settings.skinsDir);
}

async function saveSettings() {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function registerProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host === 'bundle') {
      const file = path.resolve(SRC_ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!file.startsWith(SRC_ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    }
    if (url.host === 'local') {
      const file = decodeURIComponent(url.pathname.slice(1));
      if (!isAllowed(file)) return new Response('Forbidden', { status: 403 });
      const res = await net.fetch(pathToFileURL(file).toString(), { headers: req.headers }).catch(() => null);
      if (!res) return new Response('Not found', { status: 404 });
      // The renderer adds ?v=<version> and bumps it whenever files change, so a
      // URL never points at stale content. Caching lets animated previews reuse
      // frames instead of re-reading them from disk on every frame.
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'private, max-age=86400');
      // Animated previews fetch() frames from the app page.
      headers.set('Access-Control-Allow-Origin', 'app://bundle');
      return new Response(res.body, { status: res.status, headers });
    }
    return new Response('Not found', { status: 404 });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#15151c',
    title: 'osu! Skin Editor',
    icon: path.join(SRC_ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL('app://bundle/renderer/index.html');
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Wrap a handler so errors reach the renderer as a readable message. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[${channel}]`, err);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

function skinPath(p) {
  // Only operate on folders inside the configured Skins folder or explicitly opened ones.
  const full = path.resolve(p);
  if (!isAllowed(full)) throw new Error('Skin folder is outside the allowed locations');
  return full;
}

function registerIpc() {
  handle('settings:get', () => ({ ...settings, candidates: skinFs.candidateSkinDirs() }));
  handle('settings:set', async (patch) => {
    settings = { ...settings, ...patch };
    allowRoot(settings.skinsDir);
    if ('ffmpegPath' in patch) await media.locateFfmpeg(settings.ffmpegPath);
    await saveSettings();
    return settings;
  });
  handle('ffmpeg:status', async () => ({ path: await media.locateFfmpeg(settings.ffmpegPath) }));

  handle('dialog:openFile', async ({ filters, title, multi } = {}) => {
    const r = await dialog.showOpenDialog(win, {
      title,
      filters,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    });
    if (r.canceled) return null;
    r.filePaths.forEach((f) => allowedFiles.add(path.resolve(f)));
    return multi ? r.filePaths : r.filePaths[0];
  });
  handle('dialog:openDir', async ({ title } = {}) => {
    const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
    if (r.canceled) return null;
    allowRoot(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('dialog:saveFile', async ({ defaultPath, filters }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath, filters });
    return r.canceled ? null : r.filePath;
  });
  // Files dropped onto the window: the renderer gets their path via webUtils.
  handle('files:allow', (paths) => {
    paths.forEach((p) => allowedFiles.add(path.resolve(p)));
    return true;
  });

  handle('skins:list', () => (settings.skinsDir ? skinFs.listSkins(settings.skinsDir) : []));
  handle('skin:files', (p) => skinFs.listFiles(skinPath(p)));
  handle('skin:readIni', (p) => skinFs.readIni(skinPath(p)));
  handle('skin:writeIni', (p, text) => skinFs.writeIni(skinPath(p), text));
  handle('skin:create', async (opts) => {
    const dir = await skinFs.createSkin(settings.skinsDir, {
      ...opts,
      basedOn: opts.basedOn ? skinPath(opts.basedOn) : null,
    });
    allowRoot(dir);
    return dir;
  });
  handle('skin:copyElements', (src, dst, elements) => skinFs.copyElements(skinPath(src), skinPath(dst), elements));
  handle('skin:copyFiles', (src, dst, rels) => skinFs.copyFiles(skinPath(src), skinPath(dst), rels));
  handle('skin:copyMania', (src, dst, keys) => skinFs.copyManiaSection(skinPath(src), skinPath(dst), keys));
  handle('skin:deleteMania', (p, keys) => skinFs.deleteManiaSection(skinPath(p), keys));
  handle('skin:removeElement', (p, base, opts) => skinFs.removeElement(skinPath(p), base, opts));
  handle('skin:writeImages', (p, files, opts) => skinFs.writeImages(skinPath(p), files, opts));
  handle('skin:check',(p) => skinFs.checkSkin(skinPath(p)));
  handle('skin:exportOsk', async (p) => {
    const dir = skinPath(p);
    const out = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('downloads'), `${path.basename(dir)}.osk`),
      filters: [{ name: 'osu! skin', extensions: ['osk'] }],
    });
    if (out.canceled) return null;
    return skinFs.exportOsk(dir, out.filePath);
  });
  handle('skin:importOsk', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'osu! skin', extensions: ['osk', 'zip'] }] });
    if (r.canceled) return null;
    const dir = await skinFs.importOsk(r.filePaths[0], settings.skinsDir);
    allowRoot(dir);
    return dir;
  });
  handle('shell:reveal', (p) => shell.openPath(skinPath(p)));

  handle('media:probe', (file) => {
    if (!isAllowed(file)) throw new Error('File not allowed');
    return media.probe(file);
  });
  handle('media:convert', (src, skinDir, opts) => {
    if (!isAllowed(src)) throw new Error('File not allowed');
    return media.convertToSkin(src, skinPath(skinDir), opts, (p) => win?.webContents.send('media:progress', p));
  });
  handle('media:copyPng', (src, skinDir, opts) => {
    if (!isAllowed(src)) throw new Error('File not allowed');
    return media.copyPng(src, skinPath(skinDir), opts);
  });
  handle('media:importSound', (src, skinDir, base) => {
    if (!isAllowed(src)) throw new Error('File not allowed');
    return media.importSound(src, skinPath(skinDir), base);
  });
  handle('media:cancel', () => media.cancel());

  const composeRoot = () => path.join(app.getPath('userData'), 'compositions');
  handle('compose:load', async (skinDir, base) => {
    const r = await compose.load(composeRoot(), skinPath(skinDir), base);
    r?.project.layers.forEach((l) => [l.path, l.maskPath].forEach((p) => p && allowedFiles.add(path.resolve(p))));
    return r;
  });
  handle('compose:save', (skinDir, base, images, project, opts) => {
    for (const l of project.layers) if (!isAllowed(l.path)) throw new Error(`File not allowed: ${l.path}`);
    return compose.save(composeRoot(), skinPath(skinDir), base, images, project, { anim: opts?.anim === '' ? '' : '-' });
  });

  const modelRoot = () => path.join(app.getPath('userData'), 'models');
  handle('cutout:models', () => cutout.list(modelRoot()));
  handle('cutout:download', (id) => cutout.fetchModel(modelRoot(), id, (p) => win?.webContents.send('cutout:progress', p)));
  handle('cutout:cancelDownload', () => cutout.cancelDownload());
  handle('cutout:segment', (id, input) => cutout.segment(modelRoot(), id, input));
  handle('cutout:release', () => cutout.release());
  // Finished cut-outs: either where the user chooses, or into the app's data
  // folder when they go straight into a skin or the composer.
  handle('cutout:save', async (data, { name = 'cutout.png', ask = false } = {}) => {
    if (!(data instanceof Uint8Array) || ![0x89, 0x50, 0x4e, 0x47].every((v, i) => data[i] === v)) throw new Error('Invalid image data');
    let dest;
    if (ask) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('pictures'), path.basename(name)),
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (r.canceled) return null;
      dest = /\.png$/i.test(r.filePath) ? r.filePath : `${r.filePath}.png`;
    } else {
      const dir = path.join(app.getPath('userData'), 'cutouts');
      await fs.mkdir(dir, { recursive: true });
      dest = path.join(dir, `${path.basename(name, path.extname(name))}-${Date.now().toString(36)}.png`);
    }
    await fs.writeFile(dest, data);
    allowedFiles.add(path.resolve(dest));
    return dest;
  });
}

app.whenReady().then(async () => {
  await loadSettings();
  await media.locateFfmpeg(settings.ffmpegPath);
  registerProtocol();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
