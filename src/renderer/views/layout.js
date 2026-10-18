// Visual osu!mania stage editor. Positions use osu!'s 480px-tall coordinate
// space; the width depends on the chosen aspect ratio.
import { h, clear } from '../lib/dom.js';
import { state, on, iniChanged, resolveImage } from '../lib/state.js';
import { widget } from '../lib/fields.js';
import { keycountBar, currentKeys } from './config.js';
import { MANIA_COLUMN_KEYS, columnKey } from '../../shared/iniSchema.js';
import { defaultColumnStyle, ELEMENTS } from '../../shared/elements.js';
import { openComposer, stageBottomBase } from './composer.js';
import { openRecolor, columnNoteGroup } from './recolor.js';
import { getManiaSection, getValue, setValue, parseList, formatList, parseColour } from '../../shared/skinIni.js';

const H = 480;
// osu! skin pixels are designed for 1024x768; an SD pixel is 480/768 units.
const SKIN_PX = H / 768;
const ASPECTS = { '16:9': 16 / 9, '16:10': 16 / 10, '4:3': 4 / 3, '21:9': 21 / 9 };

const ui = { aspect: '16:9', centered: false, notes: true, link: true, pressed: false, column: null };

export function readModel(sec, keys) {
  const num = (k, d) => {
    const v = parseFloat(getValue(sec, k));
    return Number.isFinite(v) ? v : d;
  };
  const widths = parseList(getValue(sec, 'ColumnWidth'), keys, 30);
  const spacing = parseList(getValue(sec, 'ColumnSpacing'), Math.max(keys - 1, 0), 0);
  const lines = parseList(getValue(sec, 'ColumnLineWidth'), keys + 1, 2);
  const xs = [];
  let x = 0;
  for (let i = 0; i < keys; i++) {
    xs.push(x);
    x += widths[i] + (i < keys - 1 ? spacing[i] : 0);
  }
  return {
    keys, widths, spacing, lines, xs, stageW: x,
    colStart: num('ColumnStart', 136),
    hitPos: num('HitPosition', 402),
    lightPos: num('LightPosition', 413),
    scorePos: num('ScorePosition', 300),
    comboPos: num('ComboPosition', 150),
    scoreSet: getValue(sec, 'ScorePosition') !== undefined,
    comboSet: getValue(sec, 'ComboPosition') !== undefined,
    keysUnderNotes: getValue(sec, 'KeysUnderNotes') === '1',
    lineColour: parseColour(getValue(sec, 'ColourColumnLine'), [255, 255, 255, 255]),
  };
}

const rgba = (c) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;

export function mountLayout(root) {
  const viewport = h('div.stage-viewport');
  const panel = h('aside.detail.layout-panel');
  clear(root, h('div.layout-view', h('div.layout-main', viewport, h('div.layout-hint.muted.small',
    'Drag the stage, the column edges, the HitPosition line and the 300/combo markers. Hold Shift to snap to 5px. Positions are previewed approximately like osu!stable.')), panel));

  let drag = null;
  let suppressClick = false;
  let scale = 1;

  const sec = () => getManiaSection(state.iniDoc, currentKeys());
  const W = () => H * ASPECTS[ui.aspect];

  function stageX(m) {
    return ui.centered ? (W() - m.stageW) / 2 : m.colStart;
  }

  function img(base, fallbackBase) {
    const v = base?.replace(/\\/g, '/');
    return (v && resolveImage(v)) || (fallbackBase && resolveImage(fallbackBase)) || null;
  }

  /** Natural-size sprite: osu! skin pixel scale (or `px`), halved for @2x files. */
  function sprite(info, cls, style, px = SKIN_PX) {
    const node = h(`img.${cls}`, { src: info.url, draggable: false, alt: '', style });
    node.onload = () => {
      const f = px / (info.hd ? 2 : 1);
      node.style.width = `${node.naturalWidth * f}px`;
    };
    return node;
  }

  function renderStage() {
    const keys = currentKeys();
    const s = sec();
    if (!state.skin || !s) return clear(viewport, h('p.empty-state', state.skin ? 'Add a keycount in the panel on the right.' : 'No skin selected.'));
    const m = readModel(s, keys);
    const w = W();
    const x0 = stageX(m);
    const parts = [];

    // 4:3 safe area guide in widescreen
    if (w > 640) {
      const off = (w - 640) / 2;
      parts.push(h('div.guide', { style: { left: `${off}px` } }), h('div.guide', { style: { left: `${off + 640}px` } }));
    }
    parts.push(h('div.guide.center', { style: { left: `${w / 2}px` } }));

    const stage = h('div.stage', { style: { left: `${x0}px`, width: `${m.stageW}px` }, onpointerdown: (e) => startDrag(e, 'stage', m) });

    // Lanes
    for (let i = 0; i < keys; i++) {
      const colour = parseColour(getValue(s, `Colour${i + 1}`), [0, 0, 0, 255]);
      stage.append(h(`div.lane${ui.column === i ? '.selected' : ''}`, {
        style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, background: rgba(colour) },
        onclick: () => {
          if (suppressClick) return;
          ui.column = ui.column === i ? null : i;
          renderStage();
          renderPanel();
        },
      }));
    }
    // Column lines
    for (let i = 0; i <= keys; i++) {
      const lw = m.lines[i];
      if (!lw) continue;
      const lx = i < keys ? m.xs[i] : m.stageW;
      stage.append(h('div.colline', { style: { left: `${lx - lw / 2}px`, width: `${lw}px`, height: `${m.hitPos}px`, background: rgba(m.lineColour) } }));
    }

    const stageImg = (key, def) => img(getValue(s, key), def);
    const left = stageImg('StageLeft', 'mania-stage-left');
    const right = stageImg('StageRight', 'mania-stage-right');
    // osu! keeps the side images at their natural width and stretches only their height to the stage.
    if (left) stage.append(sprite(left, 'stage-side', { right: '100%' }));
    if (right) stage.append(sprite(right, 'stage-side', { left: '100%' }));
    const bottom = stageImg('StageBottom', 'mania-stage-bottom');
    // osu! draws the stage bottom 1.6× larger: one SD pixel per unit.
    if (bottom) stage.append(sprite(bottom, 'stage-bottom', {}, 1));

    // Stage hint (judgement line), stretched to each column
    const hint = stageImg('StageHint', 'mania-stage-hint');
    for (let i = 0; i < keys && hint; i++) {
      stage.append(h('img.hint', { src: hint.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, top: `${m.hitPos}px` } }));
    }

    const keyLayer = h('div.layer', { style: { zIndex: m.keysUnderNotes ? 1 : 3 } });
    const noteLayer = h('div.layer', { style: { zIndex: 2 } });
    for (let i = 0; i < keys; i++) {
      const style = defaultColumnStyle(keys, i);
      const keyImg = img(getValue(s, `KeyImage${i}${ui.pressed ? 'D' : ''}`), `mania-key${style}${ui.pressed ? 'D' : ''}`);
      if (keyImg) keyLayer.append(h('img.key', { src: keyImg.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px` } }));

      if (!ui.notes) continue;
      const note = img(getValue(s, `NoteImage${i}`), `mania-note${style}`);
      if (i === 0 || (keys > 4 && i === keys - 2)) {
        // A hold note in a couple of columns
        const head = img(getValue(s, `NoteImage${i}H`), `mania-note${style}H`) ?? note;
        const body = img(getValue(s, `NoteImage${i}L`), `mania-note${style}L`);
        const tail = img(getValue(s, `NoteImage${i}T`), `mania-note${style}T`);
        const yHead = m.hitPos - 40;
        const yTail = m.hitPos - 230;
        if (body) noteLayer.append(h('img.note.body', { src: body.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, top: `${yTail}px`, height: `${yHead - yTail}px` } }));
        if (tail) noteLayer.append(h('img.note', { src: tail.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, top: `${yTail}px`, transform: 'translateY(-100%)' } }));
        if (head) noteLayer.append(h('img.note', { src: head.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, top: `${yHead}px`, transform: 'translateY(-100%)' } }));
      } else if (note) {
        for (const y of [m.hitPos - 10 - ((i * 67) % 140), m.hitPos - 230 - ((i * 41) % 120)]) {
          noteLayer.append(h('img.note', { src: note.url, draggable: false, style: { left: `${m.xs[i]}px`, width: `${m.widths[i]}px`, top: `${y}px`, transform: 'translateY(-100%)' } }));
        }
      }
    }
    stage.append(keyLayer, noteLayer);

    // Column resize handles
    for (let i = 0; i < keys; i++) {
      stage.append(h('div.col-handle', { title: `Column ${i + 1} width: ${m.widths[i]}`, style: { left: `${m.xs[i] + m.widths[i] - 3}px`, height: `${H}px` }, onpointerdown: (e) => startDrag(e, 'width', m, i) }));
    }

    // Draggable horizontal markers
    const marker = (kind, y, label, cls, content) => h(`div.marker.${cls}`, {
      style: { top: `${y}px` },
      onpointerdown: (e) => startDrag(e, kind, m),
    }, content, h('span.marker-label', label));

    parts.push(stage);
    const overlay = h('div.overlay', { style: { left: `${x0}px`, width: `${m.stageW}px` } });
    overlay.append(
      marker('hitPos', m.hitPos, `HitPosition ${Math.round(m.hitPos)}`, 'line'),
      marker('lightPos', m.lightPos, `LightPosition ${Math.round(m.lightPos)}`, 'line.dashed'),
    );
    const hit300 = img(getValue(s, 'Hit300'), 'mania-hit300');
    overlay.append(marker('scorePos', m.scorePos, `ScorePosition ${Math.round(m.scorePos)}${m.scoreSet ? '' : ' (unset)'}`, 'burst',
      hit300 ? sprite(hit300, 'burst-img', {}) : h('span.burst-text', '300')));
    overlay.append(marker('comboPos', m.comboPos, `ComboPosition ${Math.round(m.comboPos)}${m.comboSet ? '' : ' (unset)'}`, 'combo', h('span.combo-text', '727')));
    parts.push(overlay);

    const field = h('div.playfield', { style: { width: `${w}px`, height: `${H}px` } }, parts);
    clear(viewport, h('div.playfield-wrap', field));
    fit(field);
  }

  function fit(field) {
    const r = viewport.getBoundingClientRect();
    scale = Math.max(0.2, Math.min((r.width - 24) / W(), (r.height - 24) / H));
    field.style.transform = `scale(${scale})`;
    field.parentElement.style.width = `${W() * scale}px`;
    field.parentElement.style.height = `${H * scale}px`;
  }

  function startDrag(e, kind, m, column) {
    if (e.button !== 0) return;
    if (kind === 'stage' && ui.centered) return;
    e.stopPropagation();
    drag = { kind, column, x: e.clientX, y: e.clientY, m, moved: false };
  }

  const snap = (v, e) => (e.shiftKey ? Math.round(v / 5) * 5 : Math.round(v));

  function onMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / scale;
    const dy = (e.clientY - drag.y) / scale;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    const s = sec();
    const m = drag.m;
    const clampY = (v) => Math.max(0, Math.min(H, v));
    switch (drag.kind) {
      case 'stage': setValue(s, 'ColumnStart', snap(m.colStart + dx, e)); break;
      case 'hitPos': setValue(s, 'HitPosition', snap(clampY(m.hitPos + dy), e)); break;
      case 'lightPos': setValue(s, 'LightPosition', snap(clampY(m.lightPos + dy), e)); break;
      case 'scorePos': setValue(s, 'ScorePosition', snap(clampY(m.scorePos + dy), e)); break;
      case 'comboPos': setValue(s, 'ComboPosition', snap(clampY(m.comboPos + dy), e)); break;
      case 'width': {
        const nw = Math.max(5, snap(m.widths[drag.column] + dx, e));
        const widths = ui.link ? m.widths.map(() => nw) : m.widths.map((w, i) => (i === drag.column ? nw : w));
        setValue(s, 'ColumnWidth', formatList(widths));
        break;
      }
    }
    state.dirty = true;
    renderStage();
  }

  function onUp() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) {
      // The click that ends a drag shouldn't also select a column.
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
      iniChanged('layout');
    }
  }

  function setNum(key, v) {
    setValue(sec(), key, v === '' ? '' : Math.round(Number(v) * 100) / 100);
    iniChanged('layout');
  }

  function renderPanel() {
    const keys = currentKeys();
    const bar = keycountBar(() => { ui.column = null; renderAll(); });
    const s = sec();
    if (!state.skin || !s) return clear(panel, h('h3', 'Mania layout'), bar);
    const m = readModel(s, keys);

    const numRow = (label, key, value, attrs = {}) => h('label.field.inline', h('span.label', label),
      h('input', { type: 'number', value: getValue(s, key) ?? '', placeholder: value, step: 1, ...attrs, onchange: (e) => setNum(key, e.target.value) }));
    const toggle = (key, label, after) => h('label.check', h('input', { type: 'checkbox', checked: ui[key], onchange: (e) => { ui[key] = e.target.checked; after?.(); renderStage(); } }), label);

    const uniform = m.widths.every((w) => w === m.widths[0]);
    const colPanel = ui.column === null || ui.column >= keys ? h('p.muted.small', 'Click a column in the preview to edit its images and colours.') : columnPanel(s, keys, ui.column, m);

    clear(panel,
      h('h3', 'Mania layout'),
      bar,
      h('div.row',
        h('label.field.inline', h('span.label', 'Aspect'), h('select', { onchange: (e) => { ui.aspect = e.target.value; renderStage(); } },
          Object.keys(ASPECTS).map((a) => h('option', { value: a, selected: a === ui.aspect }, a))))),
      toggle('centered', 'Preview stage centred (ignore ColumnStart)'),
      toggle('notes', 'Show sample notes'),
      toggle('pressed', 'Show pressed keys'),
      toggle('link', 'Resize all columns together'),
      h('h4', 'Position'),
      numRow('ColumnStart', 'ColumnStart', 136),
      h('div.actions.wrap',
        h('button.small', { onclick: () => setNum('ColumnStart', Math.round((W() - m.stageW) / 2)) }, `Centre for ${ui.aspect}`),
        h('button.small', { onclick: () => setNum('ColumnStart', Math.round((640 - m.stageW) / 2)) }, 'Centre for 4:3')),
      numRow('HitPosition', 'HitPosition', 402, { min: 0, max: 480 }),
      numRow('LightPosition', 'LightPosition', 413, { min: 0, max: 480 }),
      numRow('ScorePosition', 'ScorePosition', '', { min: 0, max: 480 }),
      numRow('ComboPosition', 'ComboPosition', '', { min: 0, max: 480 }),
      h('h4', 'Columns'),
      h('label.field.inline', h('span.label', 'All widths'), h('input', {
        type: 'number', min: 5, value: uniform ? m.widths[0] : '', placeholder: uniform ? '' : 'mixed',
        onchange: (e) => { setValue(s, 'ColumnWidth', formatList(Array(keys).fill(Number(e.target.value)))); iniChanged('layout'); },
      })),
      h('label.field.inline', h('span.label', 'All spacing'), h('input', {
        type: 'number', value: m.spacing.every((v) => v === m.spacing[0]) ? m.spacing[0] ?? 0 : '',
        onchange: (e) => { setValue(s, 'ColumnSpacing', keys > 1 ? formatList(Array(keys - 1).fill(Number(e.target.value))) : ''); iniChanged('layout'); },
      })),
      h('label.field.inline', h('span.label', 'All line widths'), h('input', {
        type: 'number', min: 0, value: m.lines.every((v) => v === m.lines[0]) ? m.lines[0] : '',
        onchange: (e) => { setValue(s, 'ColumnLineWidth', formatList(Array(keys + 1).fill(Number(e.target.value)))); iniChanged('layout'); },
      })),
      h('p.muted.small', `Stage width: ${Math.round(m.stageW)} · screen width: ${Math.round(W())}`),
      h('h4', 'Stage sides'),
      h('div.actions.wrap', [['StageLeft', 'mania-stage-left', 'left'], ['StageRight', 'mania-stage-right', 'right']].map(([key, name, side]) => {
        // Writes to the file skin.ini points this keycount at, if any.
        const base = getValue(s, key)?.replace(/\\/g, '/').replace(/\.png$/i, '') || name;
        return h('button.small', {
          title: `Arrange images into ${base}, e.g. a character next to the stage`,
          onclick: () => openComposer(ELEMENTS.find((e) => e.name === name), { base }),
        }, `Compose ${side} side…`);
      }),
      h('button.small', {
        title: 'Paint the stage sides into mania-stage-bottom, so a lane cover doesn\'t hide them',
        onclick: () => openComposer(ELEMENTS.find((e) => e.name === 'mania-stage-bottom'), { base: stageBottomBase(), addSides: true }),
      }, 'Stage sides over bottom…')),
      h('h4', ui.column === null ? 'Column' : `Column ${ui.column + 1}`),
      colPanel,
    );
  }

  function columnPanel(s, keys, c, m) {
    const write = (key) => (v) => { setValue(sec(), key, v); iniChanged('form'); renderStage(); };
    const setListAt = (key, count, def, idx, v) => {
      const arr = parseList(getValue(sec(), key), count, def);
      arr[idx] = Number(v);
      setValue(sec(), key, formatList(arr));
      iniChanged('layout');
    };
    const rows = MANIA_COLUMN_KEYS.map((spec) => {
      const key = columnKey(spec, c);
      return h('div.ini-row.compact', h('div.ini-key', spec.label), h('div.ini-input', widget({ ...spec, key }, getValue(s, key) ?? '', write(key))));
    });
    return h('div',
      h('label.field.inline', h('span.label', 'Width'), h('input', { type: 'number', value: m.widths[c], onchange: (e) => setListAt('ColumnWidth', keys, 30, c, e.target.value) })),
      c < keys - 1 ? h('label.field.inline', h('span.label', 'Spacing after'), h('input', { type: 'number', value: m.spacing[c], onchange: (e) => setListAt('ColumnSpacing', keys - 1, 0, c, e.target.value) })) : null,
      rows,
      h('div.actions.wrap',
      h('button.small', {
        title: 'Change the colour of this column\'s note and hold images, then save them over the originals or under a new name',
        onclick: () => openRecolor(columnNoteGroup(sec(), keys, c)),
      }, 'Recolour notes…'),
      h('button.small', {
        title: 'Copy this column\'s images and colours to every column',
        onclick: () => {
          for (const spec of MANIA_COLUMN_KEYS) {
            const v = getValue(sec(), columnKey(spec, c));
            for (let i = 0; i < keys; i++) if (i !== c) setValue(sec(), columnKey(spec, i), v ?? '');
          }
          iniChanged('layout');
        },
      }, 'Apply to all columns')),
    );
  }

  function renderAll() {
    renderStage();
    renderPanel();
  }

  renderAll();
  const ro = new ResizeObserver(() => {
    const field = viewport.querySelector('.playfield');
    if (field) fit(field);
  });
  ro.observe(viewport);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  const offs = [
    on('ini', ({ source }) => {
      renderStage();
      if (source !== 'form') renderPanel();
    }),
    on('skin', () => { ui.column = null; renderAll(); }),
    on('files', renderAll),
  ];
  return () => {
    ro.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    offs.forEach((off) => off());
  };
}
