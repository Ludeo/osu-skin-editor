// Composer: builds an image (ranking-panel, the mania stage sides) from layers
// that can be moved, scaled, rotated and flipped, like a transparent character
// over a background. Output is written as <base>@2x.png (+ optional SD copy).
import { h, modal, field, toast, clear, isTopModal, TYPING } from '../lib/dom.js';
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
const profileOf = (el) => (el.compose === 'stage' ? stageProfile(el.side) : panelProfile());

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
const MAX_SIDE = 16384;
const HANDLE_PX = 10; // corner handle size on screen

/** Open the composer for an element of the current skin. Resolves true if saved. */
/**
 * Open the composer for an element of the current skin. `base` is the file to
 * write if skin.ini points the element elsewhere. Resolves true if saved.
 */
export async function openComposer(el, { base = el.name } = {}) {
  if (!state.skin) return false;
  const saved = await api.composeLoad(state.skin.path, base).catch(() => null);
  return Boolean(await modal(`Compose ${el.label}`, (close, backdrop) => build(el, base, saved, close, backdrop), { full: true }));
}

function build(el, base, saved, close, backdrop) {
  const profile = profileOf(el);
  const PRESETS = profile.presets;
  const doc = { width: PRESETS[0].w || 400, height: PRESETS[0].h, fill: '', layers: [] };
  const view = { zoom: 0, guides: true, sd: true }; // zoom 0 = fit
  let selected = null;
  let nextId = 1;

  // ---- undo -------------------------------------------------------------
  // Layer images stay loaded in `layer` objects; snapshots only hold numbers.
  const PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'flip', 'hidden', 'locked'];
  const known = new Map(); // id -> layer, also for removed layers (undo)
  const snapshot = () => JSON.stringify({
    width: doc.width, height: doc.height, fill: doc.fill,
    layers: doc.layers.map((l) => ({ id: l.id, ...Object.fromEntries(PROPS.map((k) => [k, l[k]])) })),
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
      x: doc.width / 2, y: doc.height / 2, scale: Math.round(fit * 1000) / 1000, rotation: 0, opacity: 1,
      flip: false, hidden: false, locked: false, ...props,
    };
    known.set(layer.id, layer);
    doc.layers.push(layer);
    selected = layer;
    return layer;
  }

  /** The element as it currently is in a skin, locked at the top-left at @2x scale. */
  async function addPanelOf(skinPath, files, name) {
    const info = skinPath === state.skin.path ? resolveImage(base) : elementInfo(el, { skinPath, files });
    if (!info) return null;
    const scale = info.hd ? 1 : 2;
    const layer = await addLayer(joinPath(skinPath, info.rel), { name, locked: true });
    if (layer) Object.assign(layer, { scale, x: (layer.w * scale) / 2, y: (layer.h * scale) / 2 });
    return layer;
  }

  async function restoreProject(p) {
    Object.assign(doc, { width: p.width, height: p.height, fill: p.fill ?? '', layers: [] });
    for (const l of p.layers) await addLayer(l.path, l);
    selected = null;
  }

  function hit(l, px, py) {
    const r = (-l.rotation * Math.PI) / 180;
    const dx = px - l.x;
    const dy = py - l.y;
    const ux = (dx * Math.cos(r) - dy * Math.sin(r)) / l.scale;
    const uy = (dx * Math.sin(r) + dy * Math.cos(r)) / l.scale;
    return Math.abs(ux) <= l.w / 2 && Math.abs(uy) <= l.h / 2;
  }
  function corners(l) {
    const r = (l.rotation * Math.PI) / 180;
    const hw = (l.w * l.scale) / 2;
    const hh = (l.h * l.scale) / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [
      l.x + x * Math.cos(r) - y * Math.sin(r),
      l.y + x * Math.sin(r) + y * Math.cos(r),
    ]);
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
      ctx.scale(l.flip ? -l.scale : l.scale, l.scale);
      ctx.drawImage(l.img, -l.w / 2, -l.h / 2);
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
    if (!drag) return;
    drag = null;
    commit();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

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
  const widthIn = num({ min: 1, max: MAX_SIDE, step: 1 }, () => doc.width, (v) => (doc.width = clampSide(v)));
  const heightIn = num({ min: 1, max: MAX_SIDE, step: 1 }, () => doc.height, (v) => (doc.height = clampSide(v)));
  const clampSide = (v) => Math.max(1, Math.min(MAX_SIDE, Math.round(v)));
  const presetSel = h('select', {
    onchange: (e) => {
      const p = PRESETS[e.target.value];
      if (p) Object.assign(doc, { width: p.w || doc.width, height: p.h });
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
    selected.scale = Math.round(Math.min(sw / selected.w, sh / selected.h) * 1000) / 1000;
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
  const syncers = [widthIn, heightIn, fillOn, xIn, yIn, scaleIn, rotIn, opIn, ...[flipChk, hiddenChk, lockedChk].map((c) => c.firstChild)];

  function refreshProps() {
    syncers.forEach((s) => s.sync());
    layerBox.hidden = !selected;
    if (selected) sizeInfo.textContent = `${selected.name} · ${selected.w}×${selected.h} → ${Math.round(selected.w * selected.scale)}×${Math.round(selected.h * selected.scale)}`;
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
  const own = resolveImage(base);

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
        layers: doc.layers.map((l) => ({ path: l.path, name: l.name, ...Object.fromEntries(PROPS.map((k) => [k, l[k]])) })),
      };
      const res = await api.composeSave(state.skin.path, base, images, project);
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
      ),
      fromSkin,
    ),
    layerBox,
    h('fieldset',
      h('legend', 'View'),
      h('div.row',
        h('button.small', { onclick: () => { view.zoom = 0; applyZoom(); } }, 'Fit'),
        h('button.small', { onclick: () => { view.zoom = 0.5; applyZoom(); } }, '50%'),
        h('button.small', { onclick: () => { view.zoom = 1; applyZoom(); } }, '100%'),
        zoomLabel),
      h('label.check', h('input', { type: 'checkbox', checked: view.guides, onchange: (e) => { view.guides = e.target.checked; render(); } }), 'Show screen guides'),
      h('small.hint', 'Drag to move, drag a corner or scroll over the layer to scale, arrow keys nudge (Shift = 10 px), Ctrl + scroll zooms.'),
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
      if (l) Object.assign(doc, { width: Math.round(l.w * l.scale), height: Math.round(l.h * l.scale) });
    }
    committed = savedState = snapshot();
    refreshAll();
    applyZoom();
  })();

  refreshAll();
  return h('div.composer', stage, side);
}
