// "Import media" dialog: turns an image, GIF or video into skin PNGs.
import { h, modal, field, toast } from '../lib/dom.js';
import { state, api, localUrl, refreshFiles, iniChanged, saveIni } from '../lib/state.js';
import { setValue, ensureSection } from '../../shared/skinIni.js';

const MEDIA_FILTERS = [
  { name: 'Images, GIFs & videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng', 'bmp', 'mp4', 'webm', 'mkv', 'mov', 'avi'] },
  { name: 'All files', extensions: ['*'] },
];
const SOUND_FILTERS = [{ name: 'Audio', extensions: ['wav', 'ogg', 'mp3', 'flac', 'm4a', 'aac', 'opus'] }];

const isVideoExt = (p) => /\.(mp4|webm|mkv|mov|avi)$/i.test(p);

/**
 * Import a file into an element of the current skin.
 * `target` = { base, label, anim (separator or undefined), sound, size }
 * Returns true if something was written.
 */
export async function importInto(target, file) {
  if (!state.skin) return false;
  if (target.sound) {
    file ??= await api.openFile({ title: `Sound for ${target.label}`, filters: SOUND_FILTERS });
    if (!file) return false;
    try {
      await api.importSound(file, state.skin.path, target.base);
      await refreshFiles();
      toast(`Imported ${target.base}`, 'ok');
      return true;
    } catch (err) {
      toast(err.message, 'error', 7000);
      return false;
    }
  }
  file ??= await api.openFile({ title: `Media for ${target.label}`, filters: MEDIA_FILTERS });
  if (!file) return false;

  let info;
  try {
    info = await api.probe(file);
  } catch (err) {
    toast(`Could not read file: ${err.message}`, 'error', 7000);
    return false;
  }
  return Boolean(await modal(`Import into ${target.label}`, (close, backdrop) => buildDialog(target, file, info, close, backdrop), { wide: true }));
}

function buildDialog(target, file, info, close, backdrop) {
  const animatable = target.anim !== undefined;
  const moving = info.duration > 0.05 && !/\.(png|jpe?g|bmp)$/i.test(file);
  const srcFps = info.fps || 30;

  const o = {
    animated: animatable && moving,
    start: 0,
    duration: moving ? Math.min(info.duration, 10) : 0,
    fps: Math.min(Math.round(srcFps), 60),
    maxFrames: 240,
    keepSize: !target.size,
    width: target.size?.[0] ?? info.width,
    height: target.size?.[1] ?? info.height,
    lockAspect: true,
    hd: true,
    sd: true,
    setFramerate: target.base === 'menu-back' || target.base.startsWith('play-skip'),
  };
  const aspect = info.width && info.height ? info.width / info.height : 1;

  const sourcePreview = isVideoExt(file)
    ? h('video', { src: localUrl(file), autoplay: true, loop: true, muted: true, controls: true })
    : h('img', { src: localUrl(file) });

  const estimate = h('span.muted');
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const status = h('div.muted');

  const num = (key, attrs = {}, onChange) =>
    h('input', {
      type: 'number', value: o[key], ...attrs,
      oninput: (e) => {
        o[key] = Number(e.target.value);
        onChange?.();
        update();
      },
    });

  const widthIn = num('width', { min: 1, step: 1 }, () => {
    if (o.lockAspect) heightIn.value = o.height = Math.round(o.width / aspect);
  });
  const heightIn = num('height', { min: 1, step: 1 }, () => {
    if (o.lockAspect) widthIn.value = o.width = Math.round(o.height * aspect);
  });
  const check = (key, label, onChange) =>
    h('label.check', h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; onChange?.(); update(); } }), label);

  const animBox = h('fieldset',
    h('legend', 'Animation'),
    h('div.grid3',
      field('Start (s)', num('start', { min: 0, step: 0.1 })),
      field('Duration (s)', num('duration', { min: 0.05, step: 0.1 })),
      field('Frames per second', num('fps', { min: 1, max: 120, step: 1 })),
      field('Max frames', num('maxFrames', { min: 1, max: 1000, step: 1 })),
    ),
    check('setFramerate', 'Set AnimationFramerate in skin.ini to this FPS (applies to all animations without their own rate, e.g. menu-back)'),
    estimate,
  );
  const stillBox = h('fieldset',
    h('legend', 'Still image'),
    moving ? field('Take frame at (s)', num('start', { min: 0, step: 0.1 })) : h('p.muted', 'The image will be converted to PNG.'),
  );

  const sizeBox = h('fieldset',
    h('legend', 'Output size'),
    check('keepSize', `Keep source size (${info.width}×${info.height})`),
    h('div.grid3', field('Width (px)', widthIn), field('Height (px)', heightIn), h('div', check('lockAspect', 'Lock aspect ratio'))),
    target.size ? h('small.hint', `Recommended HD size for this element: ${target.size[0]}×${target.size[1]}`) : null,
    check('hd', 'Save as HD (@2x)'),
    check('sd', 'Also create half-size SD copies (better for low resolutions)'),
  );

  const modeSwitch = animatable && moving
    ? h('div.segmented',
      h('button', { class: o.animated ? 'active' : '', onclick: (e) => setMode(true, e) }, 'Animation (frames)'),
      h('button', { class: !o.animated ? 'active' : '', onclick: (e) => setMode(false, e) }, 'Single still image'))
    : null;

  function setMode(animated, e) {
    o.animated = animated;
    e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
    update();
  }

  function update() {
    animBox.hidden = !o.animated;
    stillBox.hidden = o.animated;
    widthIn.disabled = heightIn.disabled = o.keepSize;
    const frames = Math.min(o.maxFrames, Math.ceil(o.duration * o.fps));
    estimate.textContent = `≈ ${frames} frame${frames === 1 ? '' : 's'} × ${o.hd && o.sd ? 2 : 1} files`;
  }
  update();

  const goBtn = h('button.primary', { onclick: run }, 'Import');
  const cancelBtn = h('button', { onclick: () => (backdrop.dataset.busy ? api.cancelConvert() : close(false)) }, 'Cancel');

  async function run() {
    backdrop.dataset.busy = '1';
    goBtn.disabled = true;
    progress.hidden = false;
    status.textContent = 'Converting…';
    const off = api.onProgress((p) => (progress.value = p));
    try {
      const opts = {
        base: target.base,
        sep: target.anim ?? '-',
        animated: o.animated,
        fps: o.fps,
        maxFrames: o.maxFrames,
        start: o.start,
        duration: o.duration,
        width: o.keepSize ? 0 : o.width,
        height: o.keepSize ? 0 : o.height,
        hd: o.hd,
        sd: o.sd,
      };
      const plainPng = !o.animated && o.keepSize && !(o.hd && o.sd) && /\.png$/i.test(file);
      const res = plainPng ? await api.copyPng(file, state.skin.path, opts) : await api.convert(file, state.skin.path, opts);
      if (o.animated && o.setFramerate) {
        setValue(ensureSection(state.iniDoc, 'General'), 'AnimationFramerate', o.fps);
        iniChanged('convert');
        await saveIni();
      }
      await refreshFiles();
      toast(`Wrote ${res.written.length} file(s) for ${target.base}`, 'ok');
      delete backdrop.dataset.busy;
      close(true);
    } catch (err) {
      delete backdrop.dataset.busy;
      status.textContent = '';
      progress.hidden = true;
      goBtn.disabled = false;
      toast(err.message, 'error', 8000);
    } finally {
      off();
    }
  }

  return h('div.convert',
    h('div.convert-source',
      h('div.checker.source-preview', sourcePreview),
      h('div.muted.small', file),
      h('div.muted.small', `${info.codec} · ${info.width}×${info.height}${info.duration ? ` · ${info.duration.toFixed(2)} s` : ''}${info.fps ? ` · ${info.fps} fps` : ''}${info.hasAlpha ? ' · transparency' : ''}`),
    ),
    h('div.convert-options',
      modeSwitch,
      animatable ? null : moving ? h('p.muted', 'This element cannot be animated in osu!, so one frame will be used.') : null,
      animBox, stillBox, sizeBox,
      progress, status,
      h('div.actions', cancelBtn, goBtn),
    ),
  );
}
