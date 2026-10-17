// Recolour a mania note (and its hold parts) and save the result over the
// originals or as new images, optionally pointing skin.ini columns at them.
import { h, clear, modal, attempt, confirmDialog, toHex, fromHex, toast } from '../lib/dom.js';
import { state, api, resolveImage, loadImage, joinPath, refreshFiles, iniChanged } from '../lib/state.js';
import { matchElementFiles, defaultColumnStyle } from '../../shared/elements.js';
import { getManiaSection, getValue, setValue } from '../../shared/skinIni.js';
import { DEFAULT_RECOLOR, recolorPixels, renameFiles, checkName } from '../../shared/recolor.js';
import { currentKeys } from './config.js';
import { colorInput } from '../lib/colorPicker.js';

const PARTS = [['', 'Note'], ['H', 'Hold head'], ['L', 'Hold body'], ['T', 'Hold tail']];
const SWATCHES = [
  ['Red', [255, 70, 70]], ['Orange', [255, 150, 40]], ['Yellow', [255, 225, 60]], ['Green', [80, 220, 100]],
  ['Cyan', [60, 220, 230]], ['Blue', [70, 140, 255]], ['Purple', [160, 90, 255]], ['Pink', [255, 100, 200]], ['Grey', [200, 200, 200]],
];
const PREVIEW_MAX = 220;

const norm = (v) => v?.replace(/\\/g, '/').replace(/\.png$/i, '') || null;
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
// Last settings, so recolouring several notes the same way is quick.
let last = { ...DEFAULT_RECOLOR };

/** "mania-note1H" -> note group of the Elements tab, or null for other elements. */
export function noteGroupOf(name) {
  const m = /^mania-note([12S])[HLT]?$/i.exec(name);
  if (!m) return null;
  const stem = `mania-note${m[1]}`;
  return { stem, parts: PARTS.map(([suffix, label]) => ({ suffix, label, base: stem + suffix })) };
}

/** The note images column `c` uses in the current keycount (skin.ini or defaults). */
export function columnNoteGroup(sec, keys, c) {
  const style = defaultColumnStyle(keys, c);
  const parts = PARTS.map(([suffix, label]) => ({ suffix, label, base: norm(getValue(sec, `NoteImage${c}${suffix}`)) || `mania-note${style}${suffix}` }));
  return { stem: parts[0].base, parts, column: c };
}

/** Resolves true when something was saved. */
export async function openRecolor(group) {
  const parts = group.parts.map((p) => ({ ...p, info: resolveImage(p.base) })).filter((p) => p.info);
  if (!parts.length) {
    toast('This skin has no image for this note yet. Import one first.', 'error');
    return false;
  }
  return Boolean(await modal(`Recolour ${group.stem}`, (close, backdrop) => build({ ...group, parts }, close, backdrop), { wide: true }));
}

function build(group, close, backdrop) {
  const opts = { ...last, colour: [...last.colour] };
  const chosen = new Set(group.parts.map((p) => p.suffix));
  const keys = currentKeys();
  const sec = getManiaSection(state.iniDoc, keys);
  let target = 'new';
  let name = `${group.stem}-recoloured`;

  // Preview: a downscaled copy of each part's first image, before and after.
  const previews = group.parts.map((p) => {
    const before = h('canvas');
    const after = h('canvas');
    const row = h('div.recolor-part',
      h('div.recolor-label', p.label, h('small.muted', p.info.frames.length > 1 ? ` · ${p.info.frames.length} frames` : '')),
      h('div.recolor-pair', h('div.checker.recolor-box', before), h('span.muted', '→'), h('div.checker.recolor-box', after)));
    const pv = { part: p, before, after, row, src: null };
    loadImage(joinPath(state.skin.path, p.info.rel)).then((img) => {
      const f = Math.min(1, PREVIEW_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      for (const c of [before, after]) {
        c.width = Math.max(1, Math.round(img.naturalWidth * f));
        c.height = Math.max(1, Math.round(img.naturalHeight * f));
      }
      const ctx = before.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, before.width, before.height);
      pv.src = ctx.getImageData(0, 0, before.width, before.height);
      paint(pv);
    }, (err) => row.append(h('p.muted.small', err.message)));
    return pv;
  });

  function paint(pv) {
    if (!pv.src) return;
    const data = new ImageData(new Uint8ClampedArray(pv.src.data), pv.src.width, pv.src.height);
    recolorPixels(data.data, opts);
    pv.after.getContext('2d').putImageData(data, 0, 0);
  }
  let frame = 0;
  const repaint = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => previews.forEach(paint));
  };

  // Controls
  const controls = h('div');
  const range = (label, key, min, max, scale, unit) => {
    const out = h('span.muted', '');
    const show = () => (out.textContent = `${Math.round(opts[key] * scale)}${unit}`);
    show();
    return h('label.field', h('span.label', label, ' ', out), h('input', {
      type: 'range', min, max, value: Math.round(opts[key] * scale),
      oninput: (e) => { opts[key] = Number(e.target.value) / scale; show(); repaint(); },
    }));
  };
  function renderControls() {
    const modeBtn = (m, label) => h(`button${opts.mode === m ? '.active' : ''}`, { onclick: () => { opts.mode = m; renderControls(); repaint(); } }, label);
    const colour = colorInput({ value: toHex(opts.colour), oninput: (e) => { opts.colour = fromHex(e.target.value); repaint(); } });
    clear(controls,
      h('div.segmented', modeBtn('colorize', 'Colourize'), modeBtn('shift', 'Shift hue')),
      opts.mode === 'colorize'
        ? h('div',
          h('label.field', h('span.label', 'Colour'), colour),
          h('div.recolor-swatches', SWATCHES.map(([label, c]) => h('button.swatch', {
            title: label, style: `--c: ${toHex(c)}`,
            onclick: () => { opts.colour = c; colour.value = toHex(c); repaint(); },
          }))),
          h('p.muted.small', 'Every pixel gets this colour; light and dark parts keep their brightness, so white highlights stay white.'))
        : range('Hue', 'hue', -180, 180, 1, '°'),
      range('Saturation', 'saturation', 0, 200, 100, '%'),
      range('Brightness', 'brightness', -100, 100, 100, ''),
      range('Strength', 'strength', 0, 100, 100, '%'),
      h('button.small', { onclick: () => { Object.assign(opts, { ...DEFAULT_RECOLOR, mode: opts.mode, colour: opts.colour }); renderControls(); repaint(); } }, 'Reset sliders'),
    );
  }
  renderControls();

  const partChecks = h('div', group.parts.map((p) => h('label.check',
    h('input', { type: 'checkbox', checked: true, onchange: (e) => {
      e.target.checked ? chosen.add(p.suffix) : chosen.delete(p.suffix);
      previews.find((pv) => pv.part === p).row.classList.toggle('off', !e.target.checked);
      renderSave();
    } }),
    p.label, h('code', p.base))));

  // Saving
  const saveBox = h('div');
  const selected = () => group.parts.filter((p) => chosen.has(p.suffix));
  const newName = () => name.trim().replace(/\\/g, '/').replace(/\.png$/i, '');
  const destOf = (p) => (target === 'overwrite' ? p.base : newName() + p.suffix);
  const usesStem = (c) => same(columnNoteGroup(sec, keys, c).stem, group.stem);
  const columns = new Set(sec ? [...Array(keys).keys()].filter((c) => (group.column !== undefined ? c === group.column : usesStem(c))) : []);
  const saveBtn = h('button.primary', { onclick: () => save() });

  const radio = (v, label) => h('label.check', h('input', { type: 'radio', name: 'recolor-target', checked: target === v, onchange: () => { target = v; renderSave(); } }), label);
  const newBox = h('div',
    h('label.field', h('span.label', 'New name'), h('input', {
      type: 'text', value: name, spellcheck: false,
      oninput: (e) => { name = e.target.value; renderSave(); },
    }), h('small.hint', 'Hold parts get H / L / T added, like the default note names. A folder like Notes/blue keeps things tidy.')),
    sec ? h('div',
      h('div.small', `Use them in skin.ini for ${keys}K columns`),
      h('div.recolor-columns', [...Array(keys).keys()].map((c) => h('label.check',
        h('input', { type: 'checkbox', checked: columns.has(c), onchange: (e) => (e.target.checked ? columns.add(c) : columns.delete(c)) }), String(c + 1)))),
      h('small.hint', 'osu! only uses images with a new name when skin.ini points to them.'))
      : h('p.muted.small', `There is no [Mania] section for ${keys}K, so skin.ini isn't changed. You can pick the images per column in the Mania Layout tab.`));
  const overwriteBox = h('p.muted.small', 'Replaces every frame and the HD/SD versions of the selected parts.');
  const status = h('div');
  clear(saveBox, radio('new', 'Save as new images'), radio('overwrite', 'Overwrite the originals'), newBox, overwriteBox, status);

  function renderSave() {
    const err = target === 'new' ? checkName(name) : null;
    const clash = target === 'new' && !err && selected().some((p) => same(destOf(p), p.base));
    const exists = target === 'new' && !err && !clash && selected().some((p) => resolveImage(destOf(p)));
    saveBtn.disabled = Boolean(err || clash || !selected().length);
    saveBtn.textContent = target === 'overwrite' ? 'Overwrite' : 'Save as new';
    newBox.hidden = target !== 'new';
    overwriteBox.hidden = target !== 'overwrite';
    clear(status,
      err ? h('p.small.recolor-warn', err) : clash ? h('p.small.recolor-warn', 'That is the current name. Choose "Overwrite the originals" instead.') : null,
      exists ? h('p.small.recolor-warn', 'Images with this name already exist and will be replaced.') : null,
      !err && selected().length ? h('details.files', h('summary.small', 'Files to write'), h('ul', selected().flatMap((p) =>
        renameFiles(matchElementFiles(state.files, p.base, { anim: '-' }).all, p.base, destOf(p)).map((f) => h('li.small', f.dest))))) : null,
    );
  }
  renderSave();

  async function encode(rel) {
    const img = await loadImage(joinPath(state.skin.path, rel));
    const c = h('canvas', { width: img.naturalWidth, height: img.naturalHeight });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    recolorPixels(data.data, opts);
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function save() {
    const parts = selected();
    if (target === 'overwrite' && !(await confirmDialog('Overwrite images',
      `Replace ${parts.map((p) => p.base).join(', ')} with the recoloured version? This can't be undone.`, 'Overwrite'))) return;
    if (target === 'new' && parts.some((p) => resolveImage(destOf(p)))
      && !(await confirmDialog('Replace images', `Images named ${newName()} already exist. Replace them?`, 'Replace'))) return;
    backdrop.dataset.busy = '1';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const ok = await attempt(async () => {
      const files = [];
      for (const p of parts) {
        for (const f of renameFiles(matchElementFiles(state.files, p.base, { anim: '-' }).all, p.base, destOf(p))) {
          files.push({ rel: f.dest, data: await encode(f.src) });
        }
      }
      await api.writeImages(state.skin.path, files, { replace: target === 'new' ? parts.map(destOf) : [] });
      let iniNote = '';
      if (target === 'new' && sec && columns.size) {
        for (const c of columns) for (const p of parts) setValue(sec, `NoteImage${c}${p.suffix}`, destOf(p));
        iniChanged('layout');
        iniNote = `\nskin.ini now uses them for column ${[...columns].map((c) => c + 1).join(', ')} (${keys}K). Save skin.ini to keep that.`;
      }
      await refreshFiles();
      return `Saved ${files.length} file(s)${iniNote}`;
    });
    delete backdrop.dataset.busy;
    if (!ok) return renderSave();
    last = { ...opts, colour: [...opts.colour] };
    toast(ok, 'ok', 6000);
    close(true);
  }

  return h('div.recolor',
    h('div.recolor-previews', previews.map((pv) => pv.row)),
    h('div.recolor-side',
      controls,
      h('h4', 'Parts'),
      partChecks,
      h('h4', 'Save'),
      saveBox,
      h('div.actions', h('button', { onclick: () => close() }, 'Cancel'), saveBtn)),
  );
}
