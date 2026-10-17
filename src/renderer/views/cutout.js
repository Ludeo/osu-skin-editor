// Cut-out helper: removes the background around a character so it can be used
// as a transparent PNG. An AI model makes the first pass; brushes, a magic wand
// and edge settings clean it up.
//
// Transparency is computed per pixel from:
//   AI mask (through the cutoff/softness curve, or fully opaque without one)
//   → raised by the "restore" coverage, lowered by the "erase" coverage
//   → times the picture's own alpha → edge shrink → edge softening.
// Keeping the edits separate from the AI mask lets the curve be changed later
// without losing brush work.
import { h, modal, field, toast, confirmDialog, isTopModal, TYPING } from '../lib/dom.js';
import { api, basename, loadImage } from '../lib/state.js';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  { name: 'All files', extensions: ['*'] },
];
const AI_SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const MAX_PIXELS = 40e6;
const HISTORY_BYTES = 400e6;
const BACKGROUNDS = [
  { id: 'checker', label: 'Checkerboard' },
  { id: '#000000', label: 'Black' },
  { id: '#ffffff', label: 'White' },
  { id: '#ff66aa', label: 'Pink' },
  { id: '#2fbf71', label: 'Green' },
];

/**
 * Open the helper. Without `action` the result is saved wherever the user
 * chooses; with it, the primary button is labelled `action` and the result is
 * written to the app's data folder. Resolves with the PNG path or null.
 */
export async function openCutout({ path, action } = {}) {
  path ??= await api.openFile({ title: 'Choose a picture of a character', filters: IMAGE_FILTERS });
  if (!path) return null;
  let img;
  try {
    img = await loadImage(path);
  } catch (err) {
    toast(err.message, 'error', 6000);
    return null;
  }
  if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
    toast('This picture is too large to edit (over 40 megapixels).', 'error', 6000);
    return null;
  }
  try {
    return (await modal(`Cut out: ${basename(path)}`, (close, backdrop) => build(img, path, action, close, backdrop), { full: true })) ?? null;
  } finally {
    api.cutoutRelease().catch(() => {});
  }
}

function build(img, path, action, close, backdrop) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const N = W * H;

  const canvas = h('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const out = ctx.getImageData(0, 0, W, H); // original colours; only alpha is rewritten
  const alpha0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) alpha0[i] = out.data[i * 4 + 3];

  // ---- state ------------------------------------------------------------
  const p = { cut: 50, soft: 100, shrink: 0, feather: 0 };
  let ai = null; // Uint8Array(N), AI mask at full size
  let erase = new Uint8Array(N);
  let keep = new Uint8Array(N);
  const view = { zoom: 0, bg: 'checker', ghost: false, trim: true };
  const tool = { id: 'erase', size: Math.max(8, Math.round(Math.min(W, H) / 25)), hard: 60, tol: 30, contiguous: true };
  let dirtyEdits = false;

  // ---- undo -------------------------------------------------------------
  const maxHistory = Math.max(5, Math.min(50, Math.floor(HISTORY_BYTES / (2 * N))));
  const undo = [];
  const redo = [];
  const snap = () => ({ p: { ...p }, ai, erase: erase.slice(), keep: keep.slice() });
  function checkpoint() {
    undo.push(snap());
    if (undo.length > maxHistory) undo.shift();
    redo.length = 0;
    dirtyEdits = true;
    refreshButtons();
  }
  function step(from, to) {
    if (!from.length) return;
    to.push(snap());
    const s = from.pop();
    Object.assign(p, s.p);
    ({ ai, erase, keep } = s);
    syncInputs();
    computeAll();
    refreshButtons();
  }
  backdrop.confirmClose = () => !dirtyEdits || window.confirm('Discard this cut-out?');

  // ---- compositing ------------------------------------------------------
  const lut = new Uint8Array(256);
  function buildLut() {
    const t = p.cut / 100;
    // The ramp stays inside 0..1 so certain background/foreground never changes.
    const s = (p.soft / 100) * Math.min(t, 1 - t);
    for (let k = 0; k < 256; k++) {
      const m = k / 255;
      lut[k] = s < 1e-3 ? (m >= t ? 255 : 0) : Math.round(Math.max(0, Math.min(1, (m - (t - s)) / (2 * s))) * 255);
    }
  }

  /** Recompute transparency inside a rectangle and show it. */
  function compute(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1));
    y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    // Edge filters look at neighbours, so work on a slightly larger area.
    const m = p.shrink + p.feather * 2 + 1;
    const ex0 = Math.max(0, x0 - m);
    const ey0 = Math.max(0, y0 - m);
    const ex1 = Math.min(W, x1 + m);
    const ey1 = Math.min(H, y1 + m);
    const w = ex1 - ex0;
    const hh = ey1 - ey0;
    let a = new Uint8Array(w * hh);
    for (let y = 0; y < hh; y++) {
      let i = (ey0 + y) * W + ex0;
      let j = y * w;
      for (let x = 0; x < w; x++, i++, j++) {
        let v = ai ? lut[ai[i]] : 255;
        if (keep[i]) v += ((255 - v) * keep[i]) / 255;
        if (erase[i]) v = (v * (255 - erase[i])) / 255;
        a[j] = (v * alpha0[i]) / 255;
      }
    }
    if (p.shrink) a = erode(a, w, hh, p.shrink);
    if (p.feather) a = blur(blur(a, w, hh, p.feather), w, hh, p.feather);
    const d = out.data;
    for (let y = y0; y < y1; y++) {
      let i = y * W + x0;
      let j = (y - ey0) * w + (x0 - ex0);
      for (let x = x0; x < x1; x++, i++, j++) d[i * 4 + 3] = a[j];
    }
    ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
  function computeAll() {
    buildLut();
    compute(0, 0, W, H);
  }

  // ---- AI ---------------------------------------------------------------
  const modelSel = h('select');
  const aiBtn = h('button.primary', { onclick: runAi }, 'Detect character');
  const aiStatus = h('div.muted.small');
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const cancelDl = h('button.small', { hidden: true, onclick: () => api.cutoutCancelDownload() }, 'Cancel download');
  let models = [];
  async function loadModels() {
    models = await api.cutoutModels().catch(() => []);
    const current = modelSel.value || 'anime';
    modelSel.replaceChildren(...models.map((m) =>
      h('option', { value: m.id }, `${m.label}${m.ready ? '' : ` (${Math.round(m.bytes / 1e6)} MB download)`}`)));
    modelSel.value = current;
  }
  loadModels();

  async function runAi() {
    const m = models.find((x) => x.id === modelSel.value);
    if (!m) return;
    aiBtn.disabled = true;
    backdrop.dataset.busy = '1';
    try {
      if (!m.ready) {
        const ok = await confirmDialog('Download model',
          `The "${m.label}" model needs a one-time download of ${Math.round(m.bytes / 1e6)} MB from GitHub (rembg project).\n\nIt is stored in the app's data folder and runs offline on your computer afterwards; your pictures are never uploaded.`,
          'Download');
        if (!ok) return;
        progress.hidden = cancelDl.hidden = false;
        aiStatus.textContent = 'Downloading model…';
        const off = api.onCutoutProgress((pr) => {
          progress.value = pr.received / pr.total;
          aiStatus.textContent = `Downloading model… ${Math.round(pr.received / 1e6)} / ${Math.round(pr.total / 1e6)} MB`;
        });
        let done;
        try {
          done = await api.cutoutDownload(m.id);
        } finally {
          off();
          progress.hidden = cancelDl.hidden = true;
        }
        await loadModels();
        if (!done) {
          aiStatus.textContent = 'Download cancelled.';
          return;
        }
      }
      aiStatus.textContent = 'Detecting… (the first run takes a few seconds longer)';
      await new Promise(requestAnimationFrame);
      const mask = await api.cutoutSegment(m.id, aiInput());
      checkpoint();
      ai = upscaleMask(mask);
      computeAll();
      aiStatus.textContent = 'Done. Adjust the cutoff below, then fix the rest with the brushes.';
    } catch (err) {
      aiStatus.textContent = '';
      toast(err.message, 'error', 8000);
    } finally {
      aiBtn.disabled = false;
      delete backdrop.dataset.busy;
    }
  }

  function aiInput() {
    const c = h('canvas', { width: AI_SIZE, height: AI_SIZE });
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, AI_SIZE, AI_SIZE);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, AI_SIZE, AI_SIZE);
    const d = cx.getImageData(0, 0, AI_SIZE, AI_SIZE).data;
    const n = AI_SIZE * AI_SIZE;
    const t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c2 = 0; c2 < 3; c2++) t[c2 * n + i] = d[i * 4 + c2] / 255 - MEAN[c2];
    return t;
  }

  function upscaleMask(mask) {
    const small = h('canvas', { width: AI_SIZE, height: AI_SIZE });
    const sd = new ImageData(AI_SIZE, AI_SIZE);
    for (let i = 0; i < mask.length; i++) sd.data[i * 4 + 3] = Math.round(mask[i] * 255);
    small.getContext('2d').putImageData(sd, 0, 0);
    const big = h('canvas', { width: W, height: H });
    const bx = big.getContext('2d', { willReadFrequently: true });
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(small, 0, 0, W, H);
    const d = bx.getImageData(0, 0, W, H).data;
    const res = new Uint8Array(N);
    for (let i = 0; i < N; i++) res[i] = d[i * 4 + 3];
    return res;
  }

  // ---- tools ------------------------------------------------------------
  function dab(cx, cy, mode, box) {
    const r = tool.size / 2;
    const core = r * (tool.hard / 100);
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    const [add, sub] = mode === 'erase' ? [erase, keep] : [keep, erase];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dist > r) continue;
        const c = dist <= core ? 255 : Math.round(((r - dist) / (r - core)) * 255);
        const i = y * W + x;
        if (c > add[i]) add[i] = c;
        if (sub[i]) sub[i] = (sub[i] * (255 - c)) / 255;
      }
    }
    box[0] = Math.min(box[0], x0);
    box[1] = Math.min(box[1], y0);
    box[2] = Math.max(box[2], x1 + 1);
    box[3] = Math.max(box[3], y1 + 1);
  }

  /** Remove pixels with a colour like the clicked one. */
  function wand(sx, sy) {
    const d = out.data;
    const s = (sy * W + sx) * 4;
    const [r0, g0, b0] = [d[s], d[s + 1], d[s + 2]];
    const tol = (tool.tol / 100) * 441.7; // share of the largest RGB distance
    const tol2 = tol * tol;
    const like = (i) => {
      const dr = d[i * 4] - r0;
      const dg = d[i * 4 + 1] - g0;
      const db = d[i * 4 + 2] - b0;
      return dr * dr + dg * dg + db * db <= tol2;
    };
    checkpoint();
    if (!tool.contiguous) {
      for (let i = 0; i < N; i++) if (like(i)) (erase[i] = 255), (keep[i] = 0);
    } else {
      const seen = new Uint8Array(N);
      const stack = new Int32Array(N);
      let top = 0;
      stack[top++] = sy * W + sx;
      seen[sy * W + sx] = 1;
      while (top) {
        const i = stack[--top];
        erase[i] = 255;
        keep[i] = 0;
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || seen[j]) continue;
          seen[j] = 1;
          if (like(j)) stack[top++] = j;
        }
      }
    }
    computeAll();
  }

  /** Erase small shapes far from the main ones, plus faint haze around them. */
  function removeSpecks() {
    const d = out.data;
    const SOLID = 32;
    const label = new Int32Array(N);
    const stack = new Int32Array(N);
    const sizes = [0];
    for (let s = 0; s < N; s++) {
      if (label[s] || d[s * 4 + 3] < SOLID) continue;
      const id = sizes.length;
      let count = 0;
      let top = 0;
      stack[top++] = s;
      label[s] = id;
      while (top) {
        const i = stack[--top];
        count++;
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || label[j] || d[j * 4 + 3] < SOLID) continue;
          label[j] = id;
          stack[top++] = j;
        }
      }
      sizes.push(count);
    }
    let biggest = 0;
    for (const n of sizes) if (n > biggest) biggest = n;
    if (!biggest) return toast('Nothing visible to keep.', 'error');
    const min = biggest * 0.05;
    // Faint pixels right next to a kept shape are its soft edge, not haze.
    const kept = new Uint8Array(N);
    for (let i = 0; i < N; i++) kept[i] = label[i] && sizes[label[i]] >= min ? 0 : 255;
    const near = erode(kept, W, H, 3); // 0 within 3 px of a kept shape
    checkpoint();
    let pieces = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] < min) pieces++;
    let changed = 0;
    for (let i = 0; i < N; i++) {
      if (!kept[i] || !d[i * 4 + 3]) continue;
      if (label[i] || near[i]) {
        erase[i] = 255;
        keep[i] = 0;
        changed++;
      }
    }
    computeAll();
    toast(changed ? `Removed ${pieces} loose piece(s) and faint haze` : 'No loose pieces found', 'ok');
  }

  // ---- stage ------------------------------------------------------------
  const ghost = h('img.ghost', { src: img.src, draggable: false, alt: '' });
  const cursor = h('div.brush-cursor', { hidden: true });
  const wrap = h('div.cutout-wrap.checker', ghost, canvas, cursor);
  const stage = h('div.compose-stage.cutout-stage', wrap);
  const zoomLabel = h('span.muted.small');
  const scale = () => wrap.getBoundingClientRect().width / W || 1;

  function applyZoom(anchor) {
    const before = anchor && toImage(anchor);
    const fit = Math.min((stage.clientWidth - 32) / W, (stage.clientHeight - 32) / H);
    const s = view.zoom || Math.max(Math.min(fit, 4), 0.02);
    wrap.style.width = `${Math.round(W * s)}px`;
    wrap.style.height = `${Math.round(H * s)}px`;
    zoomLabel.textContent = `${Math.round(s * 100)}%`;
    if (before) {
      // Keep the pixel under the mouse in place.
      const sr = stage.getBoundingClientRect();
      stage.scrollLeft = wrap.offsetLeft + before[0] * s - (anchor.clientX - sr.left);
      stage.scrollTop = wrap.offsetTop + before[1] * s - (anchor.clientY - sr.top);
    }
    updateCursor();
  }
  new ResizeObserver(() => !view.zoom && applyZoom()).observe(stage);

  function toImage(e) {
    const r = wrap.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  }

  let lastPointer = null;
  function updateCursor(e = lastPointer) {
    lastPointer = e;
    const brush = tool.id !== 'wand';
    cursor.hidden = !e || !brush || pan;
    wrap.style.cursor = pan || spaceDown ? 'grab' : brush ? 'none' : 'crosshair';
    if (cursor.hidden) return;
    const [x, y] = toImage(e);
    const s = scale();
    const d = tool.size * s;
    Object.assign(cursor.style, { width: `${d}px`, height: `${d}px`, left: `${x * s - d / 2}px`, top: `${y * s - d / 2}px` });
  }

  let stroke = null;
  let pan = null;
  let spaceDown = false;
  let pending = null;
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending) return;
    const b = pending;
    pending = null;
    compute(b[0], b[1], b[2], b[3]);
  };

  wrap.addEventListener('pointerdown', (e) => {
    // Shortcuts are ignored while a form field has focus.
    document.activeElement?.blur?.();
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      wrap.setPointerCapture(e.pointerId);
      return updateCursor(e);
    }
    if (e.button !== 0) return;
    const [x, y] = toImage(e);
    if (tool.id === 'wand') {
      if (x >= 0 && y >= 0 && x < W && y < H) wand(Math.floor(x), Math.floor(y));
      return;
    }
    checkpoint();
    // Alt flips between erasing and restoring while held.
    const mode = e.altKey ? (tool.id === 'erase' ? 'restore' : 'erase') : tool.id;
    stroke = { x, y, mode };
    pending = [Infinity, Infinity, -Infinity, -Infinity];
    dab(x, y, mode, pending);
    flush();
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (pan) {
      stage.scrollLeft = pan.sl - (e.clientX - pan.x);
      stage.scrollTop = pan.st - (e.clientY - pan.y);
      return;
    }
    updateCursor(e);
    if (!stroke) return;
    const [x, y] = toImage(e);
    const dist = Math.hypot(x - stroke.x, y - stroke.y);
    const stepLen = Math.max(1, tool.size * 0.15);
    pending ??= [Infinity, Infinity, -Infinity, -Infinity];
    for (let t = stepLen; t <= dist; t += stepLen) {
      dab(stroke.x + ((x - stroke.x) * t) / dist, stroke.y + ((y - stroke.y) * t) / dist, stroke.mode, pending);
    }
    if (dist >= stepLen) Object.assign(stroke, { x, y });
    frame ||= requestAnimationFrame(flush);
  });
  const endPointer = () => {
    pan = null;
    if (stroke) {
      stroke = null;
      flush();
    }
    updateCursor();
  };
  wrap.addEventListener('pointerup', endPointer);
  wrap.addEventListener('pointercancel', endPointer);
  wrap.addEventListener('pointerleave', () => {
    if (!stroke && !pan) cursor.hidden = true;
  });

  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    view.zoom = Math.min(16, Math.max(0.02, scale() * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    applyZoom(e);
  }, { passive: false });

  const onKey = (e) => {
    // Removed lazily: the dialog can also be closed with Escape or ✕.
    if (!backdrop.isConnected) {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      return;
    }
    if (!isTopModal(backdrop) || e.target.closest?.(TYPING)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) step(redo, undo);
      else step(undo, redo);
    } else if (mod && k === 'y') {
      e.preventDefault();
      step(redo, undo);
    } else if (mod) {
      return;
    } else if (e.key === ' ') {
      e.preventDefault();
      spaceDown = true;
      updateCursor();
    } else if (k === 'e' || k === 'r' || k === 'w') {
      setTool({ e: 'erase', r: 'restore', w: 'wand' }[k]);
    } else if (e.key === '[' || e.key === ']') {
      tool.size = Math.max(2, Math.min(sizeIn.max, Math.round(tool.size * (e.key === ']' ? 1.2 : 1 / 1.2))));
      sizeIn.value = tool.size;
      sizeOut.textContent = `${tool.size} px`;
      updateCursor();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === ' ') {
      spaceDown = false;
      updateCursor();
    }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  // ---- side panel -------------------------------------------------------
  /** Range slider; edits are undoable as one step per drag. */
  const slider = (key, min, max, label, fmt = (v) => v) => {
    const outEl = h('span.muted.small');
    const input = h('input', {
      type: 'range', min, max, step: 1, value: p[key],
      oninput: (e) => {
        if (!input.moved) checkpoint();
        input.moved = true;
        p[key] = Number(e.target.value);
        outEl.textContent = fmt(p[key]);
        computeAll();
      },
      onchange: () => (input.moved = false),
    });
    input.sync = () => {
      input.value = p[key];
      outEl.textContent = fmt(p[key]);
    };
    input.sync();
    return Object.assign(field(h('span', label, ' ', outEl), input), { input });
  };
  const cutS = slider('cut', 0, 100, 'Cutoff', (v) => `${v}%`);
  const softS = slider('soft', 0, 100, 'Edge softness', (v) => `${v}%`);
  const shrinkS = slider('shrink', 0, 10, 'Shrink edge', (v) => `${v} px`);
  const featherS = slider('feather', 0, 10, 'Soften edge', (v) => `${v} px`);
  const sliders = [cutS, softS, shrinkS, featherS];
  const syncInputs = () => sliders.forEach((s) => s.input.sync());

  const toolBtns = {};
  const toolRow = h('div.segmented', [['erase', 'Erase', 'E'], ['restore', 'Restore', 'R'], ['wand', 'Magic wand', 'W']].map(([id, label, key]) =>
    (toolBtns[id] = h('button.small', { title: `${label} (${key})`, onclick: () => setTool(id) }, label))));
  const sizeOut = h('span.muted.small', `${tool.size} px`);
  const sizeIn = h('input', {
    type: 'range', min: 2, max: Math.max(200, Math.round(Math.max(W, H) / 3)), value: tool.size,
    oninput: (e) => { tool.size = Number(e.target.value); sizeOut.textContent = `${tool.size} px`; },
  });
  const hardOut = h('span.muted.small', `${tool.hard}%`);
  const hardIn = h('input', { type: 'range', min: 0, max: 100, value: tool.hard, oninput: (e) => { tool.hard = Number(e.target.value); hardOut.textContent = `${tool.hard}%`; } });
  const tolOut = h('span.muted.small', `${tool.tol}%`);
  const tolIn = h('input', { type: 'range', min: 1, max: 100, value: tool.tol, oninput: (e) => { tool.tol = Number(e.target.value); tolOut.textContent = `${tool.tol}%`; } });
  const brushOpts = h('div', field(h('span', 'Brush size ', sizeOut), sizeIn), field(h('span', 'Hardness ', hardOut), hardIn));
  const wandOpts = h('div',
    field(h('span', 'Colour tolerance ', tolOut), tolIn),
    h('label.check', h('input', { type: 'checkbox', checked: tool.contiguous, onchange: (e) => (tool.contiguous = e.target.checked) }), 'Only connected pixels'));
  const toolHint = h('small.hint');
  function setTool(id) {
    tool.id = id;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('active', k === id);
    brushOpts.hidden = id === 'wand';
    wandOpts.hidden = id !== 'wand';
    toolHint.textContent = id === 'wand'
      ? 'Click a background colour to remove it, e.g. a plain or studio background.'
      : id === 'erase'
        ? 'Paint over leftovers of the background. Hold Alt to restore instead.'
        : 'Paint to bring back parts of the character that were removed. Hold Alt to erase instead.';
    updateCursor();
  }

  const undoBtn = h('button.small', { title: 'Undo (Ctrl+Z)', onclick: () => step(undo, redo) }, '↶ Undo');
  const redoBtn = h('button.small', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => step(redo, undo) }, '↷ Redo');
  function refreshButtons() {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
  }

  const bgSel = h('select', {
    onchange: (e) => {
      view.bg = e.target.value;
      wrap.classList.toggle('checker', view.bg === 'checker');
      wrap.style.backgroundColor = view.bg === 'checker' ? '' : view.bg;
    },
  }, BACKGROUNDS.map((b) => h('option', { value: b.id }, b.label)));

  const status = h('div.muted.small');
  async function save(ask) {
    const box = view.trim ? contentBox() : [0, 0, W, H];
    if (!box) return toast('The picture is completely transparent.', 'error');
    const [x0, y0, x1, y1] = box;
    const c = h('canvas', { width: x1 - x0, height: y1 - y0 });
    c.getContext('2d').putImageData(out, -x0, -y0, x0, y0, x1 - x0, y1 - y0);
    status.textContent = 'Saving…';
    try {
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not create the PNG');
      const name = `${basename(path).replace(/\.[^.]+$/, '')}-cutout.png`;
      const dest = await api.cutoutSave(new Uint8Array(await blob.arrayBuffer()), { name, ask });
      status.textContent = '';
      if (!dest) return null;
      dirtyEdits = false;
      return dest;
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'error', 8000);
      return null;
    }
  }
  /** Bounds of the visible pixels (ignoring near-invisible haze). */
  function contentBox() {
    const d = out.data;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W * 4 + 3; x < W; x++, i += 4) {
        if (d[i] <= 8) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }

  const primary = action
    ? h('button.primary', { onclick: async () => { const d = await save(false); if (d) close(d); } }, action)
    : h('button.primary', { onclick: async () => { const d = await save(true); if (d) { toast(`Saved ${d}`, 'ok', 6000); close(d); } } }, 'Save PNG…');

  const side = h('div.compose-side',
    h('div.history', undoBtn, redoBtn),
    h('fieldset',
      h('legend', '1. Automatic'),
      field('Picture type', modelSel),
      h('div.actions', aiBtn),
      progress, cancelDl, aiStatus,
      cutS, softS,
      h('small.hint', 'Raise the cutoff if bits of background remain, lower it if parts of the character are missing. Lower softness gives harder edges.'),
    ),
    h('fieldset',
      h('legend', '2. Touch up'),
      toolRow,
      brushOpts, wandOpts, toolHint,
      h('div.actions.wrap',
        h('button.small', { title: 'Keep only the biggest shape and remove loose specks and haze', onclick: removeSpecks }, 'Remove loose specks'),
        h('button.small', { onclick: () => { checkpoint(); erase.fill(0); keep.fill(0); computeAll(); } }, 'Clear touch-ups'),
      ),
    ),
    h('fieldset',
      h('legend', '3. Edges'),
      shrinkS, featherS,
      h('small.hint', 'Shrinking removes a coloured fringe left over from the old background.'),
    ),
    h('fieldset',
      h('legend', 'View'),
      h('div.row',
        h('button.small', { onclick: () => { view.zoom = 0; applyZoom(); } }, 'Fit'),
        h('button.small', { onclick: () => { view.zoom = 1; applyZoom(); } }, '100%'),
        zoomLabel),
      field('Background', bgSel),
      h('label.check', h('input', { type: 'checkbox', onchange: (e) => { view.ghost = e.target.checked; ghost.classList.toggle('on', view.ghost); } }), 'Show removed parts faintly'),
      h('small.hint', 'Ctrl + scroll zooms, middle mouse or Space + drag pans, [ and ] change the brush size.'),
    ),
    h('label.check', h('input', { type: 'checkbox', checked: view.trim, onchange: (e) => (view.trim = e.target.checked) }), 'Trim empty borders'),
    status,
    h('div.actions.wrap',
      h('button', { onclick: () => backdrop.confirmClose() && close(null) }, 'Cancel'),
      action ? h('button', { onclick: async () => { const d = await save(true); if (d) toast(`Saved ${d}`, 'ok', 6000); } }, 'Save copy…') : null,
      primary),
  );

  setTool('erase');
  refreshButtons();
  computeAll();
  requestAnimationFrame(() => {
    // The dialog focuses its first field; shortcuts should work right away here.
    document.activeElement?.blur?.();
    applyZoom();
  });
  return h('div.composer', stage, side);
}

/** Erosion (min filter) with a square of radius r. */
function erode(a, w, hh, r) {
  const tmp = new Uint8Array(a.length);
  for (let y = 0; y < hh; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e && m; k++) if (a[row + k] < m) m = a[row + k];
      tmp[row + x] = m;
    }
  }
  const res = new Uint8Array(a.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < hh; y++) {
      let m = 255;
      for (let k = Math.max(0, y - r), e = Math.min(hh - 1, y + r); k <= e && m; k++) if (tmp[k * w + x] < m) m = tmp[k * w + x];
      res[y * w + x] = m;
    }
  }
  return res;
}

/** Box blur with radius r (edges repeat). */
function blur(a, w, hh, r) {
  const tmp = new Uint8Array(a.length);
  const n = 2 * r + 1;
  for (let y = 0; y < hh; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += a[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
    }
  }
  const res = new Uint8Array(a.length);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(hh - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < hh; y++) {
      res[y * w + x] = sum / n;
      sum += tmp[Math.min(hh - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return res;
}
