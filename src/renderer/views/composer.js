// Composer: builds any image element (with extra presets and guides for
// ranking-panel, the mania stage sides/bottom and the song select beatmap
// panel) from layers that can be moved, scaled, rotated and flipped, like a
// transparent character over a background. Parts of a layer can be erased
// with a brush without changing its source image. Output is written as
// <base>@2x.png (+ optional SD copy).
import { h, modal, field, toast, clear, isTopModal, TYPING, confirmDialog } from '../lib/dom.js';
import { openCutout } from './cutout.js';
import { colorInput } from '../lib/colorPicker.js';
import { readModel } from './layout.js';
import { currentKeys } from './config.js';
import { state, api, refreshFiles, elementInfo, resolveImage, filesOf, joinPath, basename, loadImage } from '../lib/state.js';
import { findSection, getValue, getManiaSection } from '../../shared/skinIni.js';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  { name: 'All files', extensions: ['*'] },
];

// osu! lays out @2x elements on a 1366×768 screen, so a 16:9 screen is 2732×1536.
const SCREEN = { w: 2732, h: 1536 };

/** What the image is for: canvas presets (w 0 = keep the width), hint and screen guides. */
const profileOf = (el) => (el.compose === 'stage' ? stageProfile(el.side)
  : el.compose === 'bottom' ? bottomProfile()
    : el.compose === 'button' ? buttonProfile()
      : el.compose === 'panel' ? panelProfile() : genericProfile(el));

// mania-stage-bottom is drawn 1.6× larger than other skin images: one SD pixel
// per unit of the 480-tall mania space, so 2 @2x pixels per unit and the
// screen is 960 px tall. Other images (like the stage sides) use 480/768.
const BOTTOM_PX = 2;
const BOTTOM_SCREEN_H = 480 * BOTTOM_PX;
const SIDE_PX = (BOTTOM_PX * 480) / 768;

/** The mania layout of the keycount picked in the skin.ini / layout tabs (osu! defaults if it has no section). */
function maniaModel() {
  const keys = currentKeys() ?? 4;
  const sec = getManiaSection(state.iniDoc, keys);
  return { keys, sec, m: readModel(sec, keys) };
}

function panelProfile() {
  // osu! draws the top of ranking-panel 102 px below the top of the screen, or 74 for skin version 1.0.
  // Without a skin.ini osu! uses the latest version; with one but no Version line, 1.0.
  const noIni = !state.iniDoc?.sections.length;
  const v = parseFloat(getValue(findSection(state.iniDoc, 'General'), 'Version') ?? (noIni ? 'latest' : '1'));
  const top = Number.isFinite(v) && v < 2 ? 148 : 204;
  const bottom = SCREEN.h - top;
  // Scrolling down moves the results screen up by a bit less than one screen
  // height (175 px short, checked in game), and anything below is never shown.
  const scrolled = 2 * SCREEN.h - top - 175;
  return {
    presets: [
      { w: 2732, h: scrolled, label: `Whole results screen incl. the part you scroll to (2732×${scrolled})` },
      { w: 2732, h: bottom, label: `Visible part of a 16:9 screen (2732×${bottom})` },
    ],
    hint: `Transparent areas show the default results background in osu!. Anything below ${scrolled} px is never shown, even when scrolled down.`,
    guides(g, doc) {
      if (doc.height > bottom) g.hline(bottom, `bottom of the screen before scrolling down (osu! draws the panel ${top / 2} px below the top)`);
      if (doc.height > scrolled) g.hline(scrolled, 'bottom of the screen when scrolled all the way down (everything below is cut off)');
      if (doc.width > SCREEN.w) g.vline(SCREEN.w, 'right edge of a 16:9 screen');
    },
  };
}

function stageProfile(side) {
  const keys = currentKeys();
  const sec = getManiaSection(state.iniDoc, keys);
  const m = sec && readModel(sec, keys);
  // Room between the stage and the screen edge on a 16:9 screen; mania positions use a 480-tall space.
  const room = !m ? 0 : side === 'left' ? m.colStart : (480 * 16) / 9 - m.colStart - m.stageW;
  const gap = Math.round((room * SCREEN.h) / 480);
  return {
    presets: [
      ...(gap > 0 ? [{ w: gap, h: SCREEN.h, label: `Up to the screen edge in ${keys}K on 16:9 (${gap}×${SCREEN.h})` }] : []),
      { w: 0, h: SCREEN.h, label: `Screen height, keep the width (…×${SCREEN.h})` },
    ],
    hint: `osu! stretches the image to the screen height (${SCREEN.h} px) and keeps its width. The ${side === 'left' ? 'right' : 'left'} edge touches the stage.`,
    guides(g, doc) {
      if (side === 'left') g.text(doc.width, 'stage →', 'right');
      else g.text(0, '← stage', 'left');
      const edge = side === 'left' ? doc.width - gap : gap;
      if (m && edge > 0 && edge < doc.width) g.vline(edge, `${side} edge of a 16:9 screen (${keys}K)`, side === 'right');
      if (doc.height !== SCREEN.h) g.hline(doc.height, `osu! stretches this to ${SCREEN.h} px tall (×${(SCREEN.h / doc.height).toFixed(2)})`);
    },
  };
}

/** The stage bottom file of the picked keycount: skin.ini's StageBottom, if set. */
export function stageBottomBase() {
  return iniBase(maniaModel().sec, 'StageBottom', 'mania-stage-bottom');
}

/** The file a skin.ini image key points to (without .png), or the default name. */
const iniBase = (sec, key, name) => getValue(sec, key)?.replace(/\\/g, '/').replace(/\.png$/i, '') || name;

const SIDES = [['StageLeft', 'mania-stage-left', -1], ['StageRight', 'mania-stage-right', 1]];
const isSideLayer = (l, name) => l.name.startsWith(`${name} (`) && l.name.endsWith(' stage side)');
// @2x sides are placed at half the scale of SD ones.
const isHdSide = (l) => l.scale < SIDE_PX * 0.75;

/**
 * Write the stage side layers of a stage-bottom composition back into the
 * skin as mania-stage-left/right, so the separate files can be deleted and
 * restored later. Resolves true if anything was written.
 */
export async function extractSides(layers) {
  const { sec } = maniaModel();
  const files = [];
  const replace = [];
  for (const [key, name] of SIDES) {
    const l = layers.find((x) => isSideLayer(x, name));
    if (!l) continue;
    const img = l.img ?? (await loadImage(l.path));
    const c = h('canvas', { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    const base = iniBase(sec, key, name);
    files.push({ rel: `${base}${isHdSide(l) ? '@2x' : ''}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    replace.push(base);
  }
  if (!files.length) {
    toast('There are no stage side layers in this stage bottom. Add them with "+ Stage sides" first.', 'error', 6000);
    return false;
  }
  const existing = replace.filter((b) => resolveImage(b));
  if (existing.length && !(await confirmDialog('Extract stage sides', `Replace ${existing.join(' and ')} in this skin with the copies from the stage bottom?`, 'Replace'))) return false;
  await api.writeImages(state.skin.path, files, { replace });
  await refreshFiles();
  toast(`Wrote ${files.map((f) => f.rel).join(', ')}`, 'ok');
  return true;
}

/** extractSides() from the last saved stage-bottom composition. */
export async function extractSavedSides() {
  try {
    const saved = await api.composeLoad(state.skin.path, stageBottomBase());
    if (saved) return await extractSides(saved.project.layers);
    toast('This skin has no stage bottom made in the composer yet. Use "Add stage sides…" first.', 'error', 6000);
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
  return false;
}

function bottomProfile() {
  const { keys, m } = maniaModel();
  // Wide enough to cover a 16:9 screen on both sides of the stage centre.
  const centre = m.colStart + m.stageW / 2;
  const cover = Math.ceil(2 * Math.max(centre, (480 * 16) / 9 - centre) * BOTTOM_PX);
  return {
    anchor: 'bottom',
    presets: [
      { w: cover, h: BOTTOM_SCREEN_H, label: `Whole 16:9 screen in ${keys}K (${cover}×${BOTTOM_SCREEN_H})` },
      { w: 0, h: BOTTOM_SCREEN_H, label: `Screen height, keep the width (…×${BOTTOM_SCREEN_H})` },
    ],
    hint: `osu! draws this centred under the stage with its bottom on the bottom of the screen (${BOTTOM_SCREEN_H} px = screen height), on top of the notes and the stage sides. Resizing the canvas keeps the layers in place in game. "+ Stage sides" paints mania-stage-left/right into it where osu! draws them for ${keys}K, so a lane cover doesn't hide them.`,
    guides(g, doc) {
      const half = m.stageW * (BOTTOM_PX / 2);
      g.vline(doc.width / 2 - half, `stage (${keys}K)`, true);
      g.vline(doc.width / 2 + half, 'stage');
      if (doc.height > BOTTOM_SCREEN_H) g.hline(doc.height - BOTTOM_SCREEN_H, 'top of the screen (everything above is never shown)');
    },
  };
}

function buttonProfile() {
  // The size the default skin and almost every skin use; osu! draws it unscaled.
  const std = { w: 1398, h: 206 };
  return {
    presets: [{ ...std, label: `Standard beatmap panel (${std.w}×${std.h})` }],
    hint: 'osu! tints this panel (other songs, the difficulties of the selected song and the selected one each get their own colour), so light or grey art keeps the tint readable. The song title, artist and thumbnail are drawn on top of the left part.',
    guides(g, doc) {
      if (doc.width > std.w) g.vline(std.w, `standard panel width (${std.w})`, true);
      if (doc.height > std.h) g.hline(std.h, `standard panel height (${std.h})`);
    },
  };
}

/** Any other image: starts at the size of the current image (or 512×512 if there is none). */
function genericProfile(el) {
  const animated = el.anim !== undefined && resolveImage(el.name, { anim: el.anim })?.frames.length;
  return {
    start: el.size ? { w: el.size[0], h: el.size[1] } : { w: 512, h: 512 },
    presets: [
      ...(el.size ? [{ w: el.size[0], h: el.size[1], label: `Recommended size (${el.size[0]}×${el.size[1]})` }] : []),
      { w: SCREEN.w, h: SCREEN.h, label: `16:9 screen (${SCREEN.w}×${SCREEN.h})` },
    ],
    hint: `Saved as a single @2x image${animated ? '. It replaces the current animation frames, since osu! prefers frames over a still image' : ''}. Transparent areas stay transparent in game.`,
    guides(g, doc) {
      if (doc.width > SCREEN.w) g.vline(SCREEN.w, 'right edge of a 16:9 screen');
      if (doc.height > SCREEN.h) g.hline(SCREEN.h, 'bottom of a 16:9 screen');
    },
  };
}

const MAX_SIDE = 16384;
const HANDLE_PX = 10; // corner handle size on screen

/**
 * Open the composer for an element of the current skin. `base` is the file to
 * write if skin.ini points the element elsewhere. `addSides` (stage bottom)
 * starts with the stage sides already placed. Resolves true if saved.
 */
export async function openComposer(el, { base = el.name, addSides = false } = {}) {
  if (!state.skin) return false;
  const saved = await api.composeLoad(state.skin.path, base).catch(() => null);
  return Boolean(await modal(`Compose ${el.label}`, (close, backdrop) => build(el, base, saved, close, backdrop, { addSides }), { full: true }));
}

function build(el, base, saved, close, backdrop, opts) {
  const profile = profileOf(el);
  const PRESETS = profile.presets;
  const start = profile.start ?? PRESETS[0];
  const doc = { width: start.w || 400, height: start.h, fill: '', layers: [] };
  const anim = el.anim ?? '-';
  const current = () => resolveImage(base, { anim });
  const view = { zoom: 0, guides: true, sd: true }; // zoom 0 = fit
  let selected = null;
  let nextId = 1;

  // ---- undo -------------------------------------------------------------
  // Layer images stay loaded in `layer` objects; snapshots only hold numbers.
  // stretch: extra vertical scale, for images osu! stretches (the stage sides).
  const PROPS = ['x', 'y', 'scale', 'stretch', 'rotation', 'opacity', 'flip', 'hidden', 'locked'];
  const known = new Map(); // id -> layer, also for removed layers (undo)
  const snapshot = () => JSON.stringify({
    width: doc.width, height: doc.height, fill: doc.fill,
    layers: doc.layers.map((l) => ({ id: l.id, maskVer: l.maskVer, ...Object.fromEntries(PROPS.map((k) => [k, l[k]])) })),
  });
  let committed = snapshot();
  let savedState = committed;
  const undo = [];
  const redo = [];
  function commit() {
    const now = snapshot();
    if (now === committed) return;
    undo.push(committed);
    redo.length = 0;
    committed = now;
    refreshAll();
  }
  function restore(snap) {
    const s = JSON.parse(snap);
    Object.assign(doc, { width: s.width, height: s.height, fill: s.fill });
    doc.layers = s.layers.map((p) => Object.assign(known.get(p.id), p));
    if (!doc.layers.includes(selected)) selected = null;
    committed = snap;
    refreshAll();
  }
  const step = (from, to) => from.length && (to.push(committed), restore(from.pop()));
  backdrop.confirmClose = () => committed === savedState || window.confirm('Discard this composition?');

  // ---- layers -----------------------------------------------------------
  async function addLayer(path, props = {}) {
    let img;
    try {
      img = await loadImage(path);
    } catch (err) {
      toast(err.message, 'error', 6000);
      return null;
    }
    const w = img.naturalWidth;
    const hgt = img.naturalHeight;
    // New layers fit inside the canvas and start in the middle.
    const fit = Math.min(1, (doc.width * 0.9) / w, (doc.height * 0.9) / hgt);
    const layer = {
      id: nextId++, name: props.name ?? basename(path), path, img, w, h: hgt,
      x: doc.width / 2, y: doc.height / 2, scale: Math.round(fit * 1000) / 1000, stretch: 1, rotation: 0, opacity: 1,
      flip: false, hidden: false, locked: false, masks: [null], maskVer: 0, ...props,
    };
    if (props.maskPath) await loadMask(layer, props.maskPath);
    known.set(layer.id, layer);
    doc.layers.push(layer);
    selected = layer;
    return layer;
  }

  /** The element as it currently is in a skin, locked at the top-left (bottom centre for the stage bottom) at @2x scale. */
  async function addPanelOf(skinPath, files, name) {
    const info = skinPath === state.skin.path ? current() : elementInfo(el, { skinPath, files });
    if (!info) return null;
    const scale = info.hd ? 1 : 2;
    const layer = await addLayer(joinPath(skinPath, info.rel), { name, locked: true });
    if (!layer) return null;
    const [w, hgt] = [layer.w * scale, layer.h * scale];
    Object.assign(layer, { scale, x: w / 2, y: hgt / 2 }, profile.anchor === 'bottom' && { x: doc.width / 2, y: doc.height - hgt / 2 });
    return layer;
  }

  /** mania-stage-left/right where osu! draws them next to the stage, on top of the other layers. */
  async function addSides() {
    const { keys, sec, m } = maniaModel();
    let added = 0;
    for (const [key, name, dir] of SIDES) {
      const info = resolveImage(getValue(sec, key)) ?? resolveImage(name);
      if (!info) continue;
      // Placing them again replaces the earlier copies.
      const tag = `${name} (${keys}K stage side)`;
      doc.layers = doc.layers.filter((l) => !isSideLayer(l, name));
      const layer = await addLayer(joinPath(state.skin.path, info.rel), { name: tag, locked: true });
      if (!layer) continue;
      // Natural width, stretched to the screen height, touching the stage edge.
      const scale = SIDE_PX * (info.hd ? 0.5 : 1);
      Object.assign(layer, {
        scale,
        stretch: BOTTOM_SCREEN_H / (layer.h * scale),
        x: doc.width / 2 + dir * ((m.stageW * BOTTOM_PX) / 2 + (layer.w * scale) / 2),
        y: doc.height - BOTTOM_SCREEN_H / 2,
      });
      added++;
    }
    selected = null;
    if (added) toast(`Placed the stage sides for ${keys}K. They're locked; unlock them to adjust.`, 'ok');
    else toast('This skin has no mania-stage-left or mania-stage-right image.', 'error');
  }

  async function restoreProject(p) {
    Object.assign(doc, { width: p.width, height: p.height, fill: p.fill ?? '', layers: [] });
    for (const l of p.layers) await addLayer(l.path, l);
    selected = null;
  }

  /** A canvas point in the layer's own image pixels. */
  function toLayer(l, px, py) {
    const r = (-l.rotation * Math.PI) / 180;
    const dx = px - l.x;
    const dy = py - l.y;
    const ux = (dx * Math.cos(r) - dy * Math.sin(r)) / l.scale;
    const uy = (dx * Math.sin(r) + dy * Math.cos(r)) / (l.scale * l.stretch);
    return [(l.flip ? -ux : ux) + l.w / 2, uy + l.h / 2];
  }
  function hit(l, px, py) {
    const [x, y] = toLayer(l, px, py);
    return x >= 0 && y >= 0 && x <= l.w && y <= l.h;
  }
  function corners(l) {
    const r = (l.rotation * Math.PI) / 180;
    const hw = (l.w * l.scale) / 2;
    const hh = (l.h * l.scale * l.stretch) / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [
      l.x + x * Math.cos(r) - y * Math.sin(r),
      l.y + x * Math.sin(r) + y * Math.cos(r),
    ]);
  }

  // ---- erasing ----------------------------------------------------------
  // Erased parts are a mask over the layer's own pixels (0-255 each), so the
  // source image stays untouched. Every stroke makes a new mask version and
  // undo snapshots only hold the version number.
  const brush = { id: 'move', size: 60, hard: 60 };
  let brushAt = null; // pointer position in canvas pixels
  let stroke = null;

  /** The image to draw: the layer image without its erased parts. */
  function source(l) {
    if (!l.masks[l.maskVer]) return l.img;
    if (l.viewVer !== l.maskVer) {
      l.view ??= h('canvas', { width: l.w, height: l.h });
      l.viewVer = l.maskVer;
      updateView(l, [0, 0, l.w, l.h]);
    }
    return l.view;
  }
  function pixelsOf(l) {
    if (!l.pixels) {
      const cx = h('canvas', { width: l.w, height: l.h }).getContext('2d', { willReadFrequently: true });
      cx.drawImage(l.img, 0, 0);
      l.pixels = cx.getImageData(0, 0, l.w, l.h).data;
    }
    return l.pixels;
  }
  function updateView(l, [x0, y0, x1, y1]) {
    const w = x1 - x0;
    const hgt = y1 - y0;
    if (w <= 0 || hgt <= 0) return;
    const src = pixelsOf(l);
    const mask = l.masks[l.maskVer];
    const out = new ImageData(w, hgt);
    for (let y = 0; y < hgt; y++) {
      const row = (y0 + y) * l.w + x0;
      out.data.set(src.subarray(row * 4, (row + w) * 4), y * w * 4);
      for (let x = 0; x < w; x++) {
        if (mask[row + x]) out.data[(y * w + x) * 4 + 3] = (src[(row + x) * 4 + 3] * (255 - mask[row + x])) / 255;
      }
    }
    l.view.getContext('2d').putImageData(out, x0, y0);
  }

  /** One brush dab at a canvas point; grows `box` (layer pixels) by what changed. */
  function dab(l, px, py, mode, box) {
    const [cx, cy] = toLayer(l, px, py);
    const rx = brush.size / 2 / l.scale;
    const ry = rx / l.stretch;
    const core = brush.hard / 100;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const x1 = Math.min(l.w, Math.ceil(cx + rx));
    const y1 = Math.min(l.h, Math.ceil(cy + ry));
    if (x0 >= x1 || y0 >= y1) return;
    const mask = l.masks[l.maskVer];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
        if (d > 1) continue;
        const c = d <= core ? 255 : Math.round(((1 - d) / (1 - core)) * 255);
        const i = y * l.w + x;
        if (mode === 'erase') mask[i] = Math.max(mask[i], c);
        else mask[i] = Math.round((mask[i] * (255 - c)) / 255);
      }
    }
    box[0] = Math.min(box[0], x0);
    box[1] = Math.min(box[1], y0);
    box[2] = Math.max(box[2], x1);
    box[3] = Math.max(box[3], y1);
  }
  function startStroke(e, px, py) {
    const l = selected;
    if (!l || l.hidden) return toast('Select a visible layer first, in the layer list or with the Move tool.', 'error');
    const mask = l.masks[l.maskVer];
    l.masks.push(mask ? mask.slice() : new Uint8Array(l.w * l.h));
    l.maskVer = l.masks.length - 1;
    source(l);
    // Alt flips between erasing and restoring while held.
    stroke = { layer: l, x: px, y: py, mode: e.altKey ? (brush.id === 'erase' ? 'restore' : 'erase') : brush.id };
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    dab(l, px, py, stroke.mode, box);
    updateView(l, box);
    canvas.setPointerCapture(e.pointerId);
    render();
  }
  function continueStroke(px, py) {
    const { layer: l, mode } = stroke;
    const dist = Math.hypot(px - stroke.x, py - stroke.y);
    const stepLen = Math.max(1, brush.size * 0.15);
    if (dist < stepLen) return;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let t = stepLen; t <= dist; t += stepLen) dab(l, stroke.x + ((px - stroke.x) * t) / dist, stroke.y + ((py - stroke.y) * t) / dist, mode, box);
    Object.assign(stroke, { x: px, y: py });
    updateView(l, box);
  }
  function clearMask() {
    if (!selected?.masks[selected.maskVer]) return;
    selected.masks.push(null);
    selected.maskVer = selected.masks.length - 1;
    commit();
  }

  /** The mask as the alpha of a black PNG, or undefined if nothing is erased. */
  async function maskPng(l) {
    const mask = l.masks[l.maskVer];
    if (!mask?.some((v) => v)) return undefined;
    const c = h('canvas', { width: l.w, height: l.h });
    const data = new ImageData(l.w, l.h);
    for (let i = 0; i < mask.length; i++) data.data[i * 4 + 3] = mask[i];
    c.getContext('2d').putImageData(data, 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function loadMask(l, path) {
    try {
      const img = await loadImage(path);
      if (img.naturalWidth !== l.w || img.naturalHeight !== l.h) return;
      const cx = h('canvas', { width: l.w, height: l.h }).getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, l.w, l.h).data;
      const mask = new Uint8Array(l.w * l.h);
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3];
      l.masks = [null, mask];
      l.maskVer = 1;
    } catch {
      toast(`Could not load the erased parts of ${l.name}`, 'error');
    }
  }

  // ---- drawing ----------------------------------------------------------
  function drawLayers(ctx) {
    if (doc.fill) {
      ctx.fillStyle = doc.fill;
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    for (const l of doc.layers) {
      if (l.hidden) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x, l.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.scale(l.flip ? -l.scale : l.scale, l.scale * l.stretch);
      ctx.drawImage(source(l), -l.w / 2, -l.h / 2);
      ctx.restore();
    }
  }

  const canvas = h('canvas.checker');
  const ctx = canvas.getContext('2d');
  const viewScale = () => canvas.getBoundingClientRect().width / doc.width || 1;

  let frame = 0;
  function render() {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (canvas.width !== doc.width || canvas.height !== doc.height) {
        canvas.width = doc.width;
        canvas.height = doc.height;
        applyZoom();
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, doc.width, doc.height);
      drawLayers(ctx);
      const px = 1 / viewScale(); // one screen pixel in canvas pixels
      if (view.guides) drawGuides(px);
      if (selected && !selected.hidden) drawSelection(selected, px);
      if (brush.id !== 'move' && brushAt) drawBrush(px);
      refreshProps();
    });
  }

  function drawGuides(px) {
    ctx.save();
    ctx.setLineDash([8 * px, 6 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(102, 217, 255, .8)';
    ctx.font = `${12 * px}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(102, 217, 255, .95)';
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const g = {
      hline(y, label) {
        line(0, y, doc.width, y);
        ctx.fillText(label, 8 * px, y - 6 * px);
      },
      // Labels sit right of a vertical line, or left of it with `leftOf`.
      vline(x, label, leftOf = false) {
        line(x, 0, x, doc.height);
        ctx.textAlign = leftOf ? 'right' : 'left';
        ctx.fillText(label, x + (leftOf ? -6 : 6) * px, 18 * px);
        ctx.textAlign = 'left';
      },
      text(x, label, align) {
        ctx.textAlign = align;
        ctx.fillText(label, x + (align === 'right' ? -6 : 6) * px, 36 * px);
        ctx.textAlign = 'left';
      },
    };
    profile.guides(g, doc);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 255, 255, .25)';
    ctx.strokeRect(0, 0, doc.width, doc.height);
    ctx.restore();
  }

  function drawSelection(l, px) {
    const c = corners(l);
    ctx.save();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = l.locked ? 'rgba(255, 255, 255, .5)' : '#ff66aa';
    ctx.beginPath();
    c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    if (!l.locked) {
      ctx.fillStyle = '#ff66aa';
      const s = HANDLE_PX * px;
      for (const [x, y] of c) ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
  }

  function drawBrush(px) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(brushAt[0], brushAt[1], brush.size / 2, 0, Math.PI * 2);
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = 'rgba(0, 0, 0, .7)';
    ctx.stroke();
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // ---- stage interaction -------------------------------------------------
  const stage = h('div.compose-stage', canvas);

  function applyZoom() {
    const fit = Math.min((stage.clientWidth - 32) / doc.width, (stage.clientHeight - 32) / doc.height);
    const s = view.zoom || Math.max(fit, 0.02);
    canvas.style.width = `${Math.round(doc.width * s)}px`;
    canvas.style.height = `${Math.round(doc.height * s)}px`;
    zoomLabel.textContent = `${Math.round(s * 100)}%`;
    render();
  }
  new ResizeObserver(() => !view.zoom && applyZoom()).observe(stage);

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * doc.width) / r.width, ((e.clientY - r.top) * doc.height) / r.height];
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [px, py] = toCanvas(e);
    if (brush.id !== 'move') return startStroke(e, px, py);
    const tol = (HANDLE_PX / viewScale()) * 0.8;
    // A corner handle of the selected layer scales it around its centre.
    const corner = selected && !selected.locked && !selected.hidden && corners(selected).some(([x, y]) => Math.abs(x - px) <= tol && Math.abs(y - py) <= tol);
    if (!corner) selected = [...doc.layers].reverse().find((l) => !l.hidden && !l.locked && hit(l, px, py)) ?? null;
    if (selected && !selected.locked) {
      drag = {
        layer: selected, mode: corner ? 'scale' : 'move', px, py, x: selected.x, y: selected.y,
        scale: selected.scale, dist: Math.hypot(px - selected.x, py - selected.y) || 1,
      };
      canvas.setPointerCapture(e.pointerId);
    }
    refreshLayers();
    render();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = toCanvas(e);
    if (brush.id !== 'move') {
      canvas.style.cursor = 'none';
      brushAt = [px, py];
      if (stroke) continueStroke(px, py);
      return render();
    }
    if (!drag) {
      canvas.style.cursor = doc.layers.some((l) => !l.hidden && !l.locked && hit(l, px, py)) ? 'move' : 'default';
      return;
    }
    const l = drag.layer;
    if (drag.mode === 'move') {
      l.x = Math.round(drag.x + px - drag.px);
      l.y = Math.round(drag.y + py - drag.py);
    } else {
      l.scale = Math.max(0.01, Math.round(drag.scale * (Math.hypot(px - l.x, py - l.y) / drag.dist) * 1000) / 1000);
    }
    render();
  });
  const endDrag = () => {
    if (!drag && !stroke) return;
    drag = stroke = null;
    commit();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (stroke) return;
    brushAt = null;
    render();
  });

  stage.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      // Ctrl + wheel zooms the view.
      e.preventDefault();
      view.zoom = Math.min(4, Math.max(0.02, viewScale() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      applyZoom();
      return;
    }
    // Wheel over the selected layer scales it.
    const [px, py] = toCanvas(e);
    if (!selected || selected.locked || !hit(selected, px, py)) return;
    e.preventDefault();
    selected.scale = Math.max(0.01, Math.round(selected.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05) * 1000) / 1000);
    render();
    commitSoon();
  }, { passive: false });
  let commitTimer = 0;
  const commitSoon = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 400);
  };

  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    const [px, py] = toCanvas(e);
    for (const f of e.dataTransfer.files) {
      const p = await api.droppedPath(f);
      if (p) await addLayer(p, { x: Math.round(px), y: Math.round(py) });
    }
    commit();
  });

  const onKey = (e) => {
    // Removed lazily: the modal can also be closed with Escape or ✕.
    if (!backdrop.isConnected) return document.removeEventListener('keydown', onKey);
    if (!isTopModal(backdrop) || e.target.closest?.(TYPING)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) step(redo, undo);
      else step(undo, redo);
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      step(redo, undo);
    } else if (!mod && ['v', 'e', 'r'].includes(e.key.toLowerCase())) {
      setTool({ v: 'move', e: 'erase', r: 'restore' }[e.key.toLowerCase()]);
    } else if (!mod && (e.key === '[' || e.key === ']')) {
      setBrushSize(brush.size * (e.key === ']' ? 1.2 : 1 / 1.2));
    } else if (selected && !selected.locked && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') selected.x -= d;
      if (e.key === 'ArrowRight') selected.x += d;
      if (e.key === 'ArrowUp') selected.y -= d;
      if (e.key === 'ArrowDown') selected.y += d;
      render();
      commitSoon();
    } else if (selected && e.key === 'Delete') {
      removeSelected();
    }
  };
  document.addEventListener('keydown', onKey);

  function removeSelected() {
    doc.layers = doc.layers.filter((l) => l !== selected);
    selected = null;
    commit();
  }
  function move(dir) {
    const i = doc.layers.indexOf(selected);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
    commit();
  }

  // ---- side panel -------------------------------------------------------
  const zoomLabel = h('span.muted.small');
  const num = (attrs, get, set) => {
    // While the user is typing, the field isn't overwritten with the parsed value.
    const input = h('input', {
      type: 'number', ...attrs,
      oninput: (e) => {
        input.typing = true;
        if (e.target.value !== '') {
          set(Number(e.target.value));
          render();
        }
      },
      onchange: () => {
        input.typing = false;
        commit();
      },
      onblur: () => {
        input.typing = false;
        input.sync();
      },
    });
    input.sync = () => !input.typing && (input.value = get());
    return input;
  };
  const check = (label, get, set) => {
    const input = h('input', { type: 'checkbox', onchange: (e) => { set(e.target.checked); commit(); } });
    input.sync = () => (input.checked = get());
    return h('label.check', input, label);
  };

  // Canvas size
  const widthIn = num({ min: 1, max: MAX_SIDE, step: 1 }, () => doc.width, (v) => resize(v, doc.height));
  const heightIn = num({ min: 1, max: MAX_SIDE, step: 1 }, () => doc.height, (v) => resize(doc.width, v));
  const clampSide = (v) => Math.max(1, Math.min(MAX_SIDE, Math.round(v)));
  // A bottom-anchored image grows upwards and to both sides, so the layers keep their spot in game.
  function resize(w, hgt) {
    w = clampSide(w);
    hgt = clampSide(hgt);
    if (profile.anchor === 'bottom') {
      for (const l of doc.layers) {
        l.x += (w - doc.width) / 2;
        l.y += hgt - doc.height;
      }
    }
    Object.assign(doc, { width: w, height: hgt });
  }
  const presetSel = h('select', {
    onchange: (e) => {
      const p = PRESETS[e.target.value];
      if (p) resize(p.w || doc.width, p.h);
      e.target.value = '';
      commit();
    },
  }, h('option', { value: '' }, 'Preset size…'), PRESETS.map((p, i) => h('option', { value: i }, p.label)));
  const fillOn = h('input', { type: 'checkbox', onchange: (e) => { doc.fill = e.target.checked ? fillColor.value : ''; commit(); } });
  const fillColor = colorInput({ value: '#101028', oninput: (e) => { if (doc.fill) { doc.fill = e.target.value; render(); } }, onchange: commit });
  fillOn.sync = () => {
    fillOn.checked = Boolean(doc.fill);
    if (doc.fill) fillColor.value = doc.fill;
  };

  // Selected layer
  const L = (k) => () => selected?.[k];
  const setL = (k, f = (v) => v) => (v) => selected && (selected[k] = f(v));
  const xIn = num({ step: 1 }, L('x'), setL('x'));
  const yIn = num({ step: 1 }, L('y'), setL('y'));
  const scaleIn = num({ min: 1, step: 1 }, () => Math.round((selected?.scale ?? 0) * 1000) / 10, setL('scale', (v) => Math.max(0.01, v / 100)));
  const rotIn = num({ min: -180, max: 180, step: 1 }, L('rotation'), setL('rotation'));
  const opIn = num({ min: 0, max: 100, step: 5 }, () => Math.round((selected?.opacity ?? 1) * 100), setL('opacity', (v) => Math.max(0, Math.min(1, v / 100))));
  const flipChk = check('Mirror horizontally', L('flip'), setL('flip'));
  const hiddenChk = check('Hidden', L('hidden'), setL('hidden'));
  const lockedChk = check('Locked (can\'t be moved on the canvas)', L('locked'), setL('locked'));
  const sizeInfo = h('div.muted.small');
  const fitTo = (sw, sh) => {
    selected.scale = Math.round(Math.min(sw / selected.w, sh / (selected.h * selected.stretch)) * 1000) / 1000;
    commit();
  };
  const layerBox = h('fieldset',
    h('legend', 'Selected layer'),
    sizeInfo,
    h('div.grid2', field('X (centre)', xIn), field('Y (centre)', yIn), field('Scale %', scaleIn), field('Rotation °', rotIn), field('Opacity %', opIn)),
    flipChk, hiddenChk, lockedChk,
    h('div.actions.wrap',
      h('button.small', { onclick: () => { selected.x = Math.round(doc.width / 2); selected.y = Math.round(doc.height / 2); commit(); } }, 'Centre'),
      h('button.small', { onclick: () => fitTo(doc.width, Infinity) }, 'Fit width'),
      h('button.small', { onclick: () => fitTo(Infinity, doc.height) }, 'Fit height'),
      h('button.small', { onclick: () => { selected.scale = 1; commit(); } }, '100%'),
      h('button.small.danger', { onclick: removeSelected }, 'Remove'),
    ),
  );
  // Tools
  const toolBtns = {};
  const toolRow = h('div.segmented', [['move', 'Move', 'V'], ['erase', 'Erase', 'E'], ['restore', 'Restore', 'R']].map(([id, label, key]) =>
    (toolBtns[id] = h('button.small', { title: `${label} (${key})`, onclick: () => setTool(id) }, label))));
  const sizeOut = h('span.muted.small');
  const sizeIn = h('input', { type: 'range', min: 2, max: 1000, oninput: (e) => setBrushSize(Number(e.target.value)) });
  const hardOut = h('span.muted.small', `${brush.hard}%`);
  const hardIn = h('input', { type: 'range', min: 0, max: 100, value: brush.hard, oninput: (e) => { brush.hard = Number(e.target.value); hardOut.textContent = `${brush.hard}%`; } });
  const clearBtn = h('button.small', { title: 'Bring back everything erased from the selected layer', onclick: clearMask }, 'Clear erased parts');
  const brushOpts = h('div', field(h('span', 'Brush size ', sizeOut), sizeIn), field(h('span', 'Hardness ', hardOut), hardIn));
  const toolHint = h('small.hint');
  function setBrushSize(v) {
    brush.size = Math.max(2, Math.min(1000, Math.round(v)));
    sizeIn.value = brush.size;
    sizeOut.textContent = `${brush.size} px`;
    render();
  }
  function setTool(id) {
    brush.id = id;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('active', k === id);
    brushOpts.hidden = id === 'move';
    if (id === 'move') canvas.style.cursor = 'default';
    toolHint.textContent = id === 'move'
      ? 'Click a layer to select it, then pick Erase to remove parts of it.'
      : id === 'erase'
        ? 'Paint over the selected layer to remove those parts. Hold Alt to restore instead. Its source image is kept, so nothing is lost.'
        : 'Paint to bring back erased parts of the selected layer. Hold Alt to erase instead.';
    render();
  }
  setBrushSize(brush.size);
  setTool('move');
  const toolBox = h('fieldset', h('legend', 'Tool'), toolRow, brushOpts, toolHint, h('div.actions', clearBtn));

  const syncers = [widthIn, heightIn, fillOn, xIn, yIn, scaleIn, rotIn, opIn, ...[flipChk, hiddenChk, lockedChk].map((c) => c.firstChild)];

  function refreshProps() {
    syncers.forEach((s) => s.sync());
    layerBox.hidden = !selected;
    if (selected) sizeInfo.textContent = `${selected.name} · ${selected.w}×${selected.h} → ${Math.round(selected.w * selected.scale)}×${Math.round(selected.h * selected.scale * selected.stretch)}`;
    clearBtn.disabled = !selected?.masks[selected.maskVer];
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
  }

  const layerList = h('div.layer-list');
  function refreshLayers() {
    if (!doc.layers.length) return clear(layerList, h('div.muted.small', 'No layers yet. Add an image or drop one onto the canvas.'));
    clear(layerList, [...doc.layers].reverse().map((l) =>
      h(`div.layer-row${l === selected ? '.selected' : ''}${l.hidden ? '.hidden-layer' : ''}`,
        { onclick: () => { selected = l; refreshLayers(); render(); } },
        h('span.ellipsis', { title: l.path }, l.name),
        h('span.spacer'),
        l.locked ? h('span.badge', 'locked') : null,
        h('button.icon.small', { title: 'Move up', onclick: (e) => { e.stopPropagation(); selected = l; move(1); } }, '▲'),
        h('button.icon.small', { title: 'Move down', onclick: (e) => { e.stopPropagation(); selected = l; move(-1); } }, '▼'),
      )));
  }
  function refreshAll() {
    refreshLayers();
    render();
  }

  // Adding layers
  const fromSkin = h('select', {
    onchange: async (e) => {
      const s = state.skins.find((x) => x.path === e.target.value);
      e.target.value = '';
      if (!s) return;
      await addPanelOf(s.path, await filesOf(s.path), `${el.name} (${s.name})`);
      commit();
    },
  }, h('option', { value: '' }, `${el.name} from another skin…`));
  (async () => {
    for (const s of state.skins) {
      if (s.path === state.skin.path) continue;
      const files = await filesOf(s.path).catch(() => []);
      if (elementInfo(el, { skinPath: s.path, files })) fromSkin.append(h('option', { value: s.path }, s.name));
    }
  })();
  const own = current();

  const undoBtn = h('button.small', { title: 'Undo (Ctrl+Z)', onclick: () => step(undo, redo) }, '↶ Undo');
  const redoBtn = h('button.small', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => step(redo, undo) }, '↷ Redo');
  const status = h('div.muted.small');
  const restoreBanner = h('div.banner', { hidden: !(saved?.stale) },
    `${base} was changed since your last composition. `,
    h('button.small', { onclick: async () => { restoreBanner.hidden = true; await restoreProject(saved.project); commit(); } }, 'Restore last composition'));

  async function save() {
    if (!doc.layers.some((l) => !l.hidden) && !doc.fill) return toast('Add at least one visible layer first.', 'error');
    backdrop.dataset.busy = '1';
    saveBtn.disabled = true;
    status.textContent = 'Rendering…';
    try {
      const images = { hd: await renderPng(1), sd: view.sd ? await renderPng(0.5) : null };
      status.textContent = 'Saving…';
      const project = {
        version: 1, width: doc.width, height: doc.height, fill: doc.fill,
        layers: await Promise.all(doc.layers.map(async (l) => ({ path: l.path, name: l.name, ...Object.fromEntries(PROPS.map((k) => [k, l[k]])), mask: await maskPng(l) }))),
      };
      const res = await api.composeSave(state.skin.path, base, images, project, { anim });
      await refreshFiles();
      toast(`Wrote ${res.written.join(', ')}`, 'ok');
      savedState = committed;
      delete backdrop.dataset.busy;
      close(true);
    } catch (err) {
      delete backdrop.dataset.busy;
      saveBtn.disabled = false;
      status.textContent = '';
      toast(err.message, 'error', 8000);
    }
  }
  async function renderPng(scale) {
    const c = h('canvas', { width: Math.max(1, Math.round(doc.width * scale)), height: Math.max(1, Math.round(doc.height * scale)) });
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.scale(scale, scale);
    drawLayers(cx);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Rendering failed (image too large?)');
    return new Uint8Array(await blob.arrayBuffer());
  }
  const saveBtn = h('button.primary', { onclick: save }, `Save ${base}`);

  const side = h('div.compose-side',
    h('div.history', undoBtn, redoBtn),
    restoreBanner,
    h('fieldset',
      h('legend', 'Canvas (@2x pixels)'),
      h('div.grid2', field('Width', widthIn), field('Height', heightIn)),
      presetSel,
      h('label.check', fillOn, 'Background colour', fillColor),
      h('small.hint', profile.hint),
    ),
    h('fieldset',
      h('legend', 'Layers (top first)'),
      layerList,
      h('div.actions.wrap',
        h('button.small', {
          onclick: async () => {
            const files = await api.openFile({ title: 'Add image layer', filters: IMAGE_FILTERS, multi: true });
            for (const f of files ?? []) await addLayer(f);
            commit();
          },
        }, '+ Image…'),
        h('button.small', {
          title: 'Pick a picture and remove its background before adding it',
          onclick: async () => {
            const p = await openCutout({ action: 'Add as layer' });
            if (p && (await addLayer(p))) commit();
          },
        }, '+ Cut out character…'),
        own ? h('button.small', { onclick: async () => { await addPanelOf(state.skin.path, state.files, `current ${el.name}`); commit(); } }, `+ Current ${el.name}`) : null,
        el.compose === 'bottom' ? h('button.small', {
          title: 'Paint mania-stage-left and -right where osu! draws them next to the stage, so they show above this image',
          onclick: async () => { await addSides(); commit(); },
        }, '+ Stage sides') : null,
        el.compose === 'bottom' ? h('button.small', {
          title: 'Write the stage side layers back into the skin as mania-stage-left/-right, e.g. to restore them after deleting those files',
          onclick: () => extractSides(doc.layers).catch((err) => toast(err.message, 'error', 6000)),
        }, 'Extract stage sides') : null,
      ),
      fromSkin,
    ),
    toolBox,
    layerBox,
    h('fieldset',
      h('legend', 'View'),
      h('div.row',
        h('button.small', { onclick: () => { view.zoom = 0; applyZoom(); } }, 'Fit'),
        h('button.small', { onclick: () => { view.zoom = 0.5; applyZoom(); } }, '50%'),
        h('button.small', { onclick: () => { view.zoom = 1; applyZoom(); } }, '100%'),
        zoomLabel),
      h('label.check', h('input', { type: 'checkbox', checked: view.guides, onchange: (e) => { view.guides = e.target.checked; render(); } }), 'Show screen guides'),
      h('small.hint', 'Drag to move, drag a corner or scroll over the layer to scale, arrow keys nudge (Shift = 10 px), Ctrl + scroll zooms. V, E and R switch tools, [ and ] change the brush size.'),
    ),
    h('label.check', h('input', { type: 'checkbox', checked: view.sd, onchange: (e) => (view.sd = e.target.checked) }), 'Also write a half-size SD copy'),
    status,
    h('div.actions', h('button', { onclick: () => backdrop.confirmClose() && close(false) }, 'Cancel'), saveBtn),
  );

  // Initial content: the last composition, or the element as it is now.
  (async () => {
    if (saved && !saved.stale) await restoreProject(saved.project);
    else if (own) {
      const l = await addPanelOf(state.skin.path, state.files, `current ${el.name}`);
      if (l) resize(l.w * l.scale, l.h * l.scale);
    }
    committed = savedState = snapshot();
    if (opts.addSides) {
      await addSides();
      commit();
    }
    refreshAll();
    applyZoom();
  })();

  refreshAll();
  return h('div.composer', stage, side);
}
