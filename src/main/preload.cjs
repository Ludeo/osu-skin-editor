const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  ffmpegStatus: () => call('ffmpeg:status'),

  openFile: (opts) => call('dialog:openFile', opts),
  openDir: (opts) => call('dialog:openDir', opts),
  /** Path of a File from a drag & drop event; also whitelists it for previews. */
  droppedPath: async (file) => {
    const p = webUtils.getPathForFile(file);
    if (p) await call('files:allow', [p]);
    return p;
  },

  listSkins: () => call('skins:list'),
  skinFiles: (dir) => call('skin:files', dir),
  readIni: (dir) => call('skin:readIni', dir),
  writeIni: (dir, text) => call('skin:writeIni', dir, text),
  createSkin: (opts) => call('skin:create', opts),
  copyElements: (src, dst, elements) => call('skin:copyElements', src, dst, elements),
  copyFiles: (src, dst, rels) => call('skin:copyFiles', src, dst, rels),
  copyMania: (src, dst, keys) => call('skin:copyMania', src, dst, keys),
  deleteMania: (dir, keys) => call('skin:deleteMania', dir, keys),
  removeElement: (dir, base, opts) => call('skin:removeElement', dir, base, opts),
  writeImages: (dir, files, opts) => call('skin:writeImages', dir, files, opts),
  checkSkin:(dir) => call('skin:check', dir),
  exportOsk: (dir) => call('skin:exportOsk', dir),
  importOsk: () => call('skin:importOsk'),
  reveal: (dir) => call('shell:reveal', dir),

  probe: (file) => call('media:probe', file),
  convert: (src, dir, opts) => call('media:convert', src, dir, opts),
  copyPng: (src, dir, opts) => call('media:copyPng', src, dir, opts),
  importSound: (src, dir, base) => call('media:importSound', src, dir, base),
  cancelConvert: () => call('media:cancel'),
  composeLoad: (dir, base) => call('compose:load', dir, base),
  composeSave: (dir, base, images, project) => call('compose:save', dir, base, images, project),
  cutoutModels: () => call('cutout:models'),
  cutoutDownload: (id) => call('cutout:download', id),
  cutoutCancelDownload: () => call('cutout:cancelDownload'),
  cutoutSegment: (id, input) => call('cutout:segment', id, input),
  cutoutRelease: () => call('cutout:release'),
  cutoutSave: (data, opts) => call('cutout:save', data, opts),
  onCutoutProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('cutout:progress', listener);
    return () => ipcRenderer.removeListener('cutout:progress', listener);
  },
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('media:progress', listener);
    return () => ipcRenderer.removeListener('media:progress', listener);
  },
});
