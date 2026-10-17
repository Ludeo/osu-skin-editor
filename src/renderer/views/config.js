// Form-based skin.ini editor with a raw text fallback.
import { h, clear, debounce, confirmDialog } from '../lib/dom.js';
import { state, on, iniChanged } from '../lib/state.js';
import { iniField, widget } from '../lib/fields.js';
import { SECTIONS, MANIA, MANIA_LISTS, MANIA_COLUMN_KEYS, VALID_KEYCOUNTS, columnKey } from '../../shared/iniSchema.js';
import {
  findSection, ensureSection, getManiaSections, getManiaSection, getValue, setValue,
  addManiaSection, removeSection, parseIni, serializeIni, parseList, formatList, sectionEntries,
} from '../../shared/skinIni.js';

const ui = { tab: 'General' };

export function maniaKeycounts() {
  return getManiaSections(state.iniDoc).map((s) => Number(getValue(s, 'Keys'))).filter(Number.isFinite).sort((a, b) => a - b);
}

/** Currently selected keycount, shared between the config and layout views. */
export function currentKeys() {
  const ks = maniaKeycounts();
  if (!ks.includes(state.maniaKeys)) state.maniaKeys = ks.includes(4) ? 4 : ks.includes(7) ? 7 : ks[0];
  return state.maniaKeys;
}

/** Keycount selector with add/remove; calls onChange after switching. */
export function keycountBar(onChange) {
  const keys = currentKeys();
  const existing = maniaKeycounts();
  const addSel = h('select', {
    onchange: (e) => {
      const k = Number(e.target.value);
      if (!k) return;
      const cols = Math.min(k, 10);
      addManiaSection(state.iniDoc, k, [
        { kind: 'kv', key: 'ColumnStart', value: '136' },
        { kind: 'kv', key: 'ColumnWidth', value: Array(k).fill(Math.round(240 / cols)).join(',') },
        { kind: 'kv', key: 'HitPosition', value: '402' },
      ]);
      state.maniaKeys = k;
      iniChanged('keycount');
      onChange();
    },
  }, h('option', { value: '' }, '+ Add keycount…'), VALID_KEYCOUNTS.filter((k) => !existing.includes(k)).map((k) => h('option', { value: k }, `${k}K`)));

  return h('div.keycount-bar',
    h('div.chips', existing.map((k) => h(`button.chip${k === keys ? '.active' : ''}`, { onclick: () => { state.maniaKeys = k; onChange(); } }, `${k}K`))),
    addSel,
    keys ? h('button.small.danger', {
      onclick: async () => {
        if (!(await confirmDialog('Remove keycount', `Remove the [Mania] section for ${keys}K? (Images stay in the skin folder.)`, 'Remove'))) return;
        removeSection(state.iniDoc, getManiaSection(state.iniDoc, keys));
        iniChanged('keycount');
        onChange();
      },
    }, `Remove ${keys}K`) : null,
  );
}

export function mountConfig(root) {
  const tabs = h('div.subtabs');
  const body = h('div.config-body');
  clear(root, h('div.config-view', tabs, body));

  function renderTabs() {
    const names = [...SECTIONS.map((s) => s.id), 'Mania', 'Raw'];
    clear(tabs, names.map((n) => h(`button.subtab${ui.tab === n ? '.active' : ''}`, { onclick: () => { ui.tab = n; render(); } }, n === 'Raw' ? 'Raw text' : n)));
  }

  function render() {
    renderTabs();
    if (!state.skin) return clear(body, h('p.empty-state', 'No skin selected.'));
    if (ui.tab === 'Raw') return renderRaw();
    if (ui.tab === 'Mania') return renderMania();
    const sec = SECTIONS.find((s) => s.id === ui.tab);
    const get = (create) => (create ? ensureSection(state.iniDoc, sec.id) : findSection(state.iniDoc, sec.id));
    clear(body,
      h('div.ini-form', sec.fields.map((f) => iniField(f, get))),
      unknownKeys(get(false), new Set(sec.fields.map((f) => f.key.toLowerCase()))),
    );
  }

  function renderMania() {
    const keys = currentKeys();
    const bar = keycountBar(render);
    if (!keys) return clear(body, bar, h('p.empty-state', 'This skin has no [Mania] sections yet. Add a keycount above.'));
    const get = () => getManiaSection(state.iniDoc, keys);
    const groups = [...new Set(MANIA.map((f) => f.group))];
    clear(body, bar,
      h('p.muted.small', 'Tip: the Mania Layout tab lets you drag these values visually.'),
      groups.map((g) => h('details.group', { open: g === 'Layout' }, h('summary', g),
        h('div.ini-form', MANIA.filter((f) => f.group === g).map((f) => iniField(f, get))))),
      h('details.group', { open: true }, h('summary', 'Columns'), columnTable(keys, get)),
      unknownKeys(get(), knownManiaKeys(keys)),
    );
  }

  function renderRaw() {
    const ta = h('textarea.raw', {
      spellcheck: false,
      value: serializeIni(state.iniDoc).replace(/\r\n/g, '\n'),
      oninput: debounce((e) => {
        state.iniDoc = parseIni(e.target.value);
        iniChanged('raw');
      }, 300),
    });
    clear(body, h('p.muted.small', 'Edit skin.ini directly. Changes sync with the forms; press Ctrl+S to save.'), ta);
  }

  render();
  const offs = [
    on('ini', ({ source }) => {
      if (source === 'form' || (source === 'raw' && ui.tab === 'Raw')) return;
      render();
    }),
    on('skin', render),
    on('files', () => ui.tab === 'Mania' && render()),
  ];
  return () => offs.forEach((off) => off());
}

function knownManiaKeys(keys) {
  const set = new Set(['keys', ...MANIA.map((f) => f.key.toLowerCase()), ...MANIA_LISTS.map((l) => l.key.toLowerCase())]);
  for (let c = 0; c < keys; c++) {
    for (const spec of MANIA_COLUMN_KEYS) set.add(columnKey(spec, c).toLowerCase());
    set.add(`keyflipwhenupsidedown${c}`);
    set.add(`keyflipwhenupsidedown${c}d`);
    for (const s of ['', 'h', 'l', 't']) set.add(`noteflipwhenupsidedown${c}${s}`);
  }
  return set;
}

/** Table with one row per column: widths, spacing, images, colours. */
export function columnTable(keys, getSection) {
  const sec = getSection();
  const lists = Object.fromEntries(MANIA_LISTS.map((l) => [l.key, parseList(getValue(sec, l.key), l.count(keys), l.def === '' ? NaN : l.def)]));
  const setList = (key, idx, v) => {
    const l = MANIA_LISTS.find((x) => x.key === key);
    const arr = parseList(getValue(getSection(), key), l.count(keys), l.def === '' ? NaN : l.def);
    // Lighting widths have no fixed default; unset columns follow the column width.
    const widths = parseList(getValue(getSection(), 'ColumnWidth'), keys, 30);
    arr.forEach((x, i) => { if (!Number.isFinite(x)) arr[i] = widths[i] ?? 30; });
    arr[idx] = Number(v);
    setValue(getSection(), key, formatList(arr));
    iniChanged('form');
  };
  const numCell = (key, idx) => {
    const v = lists[key][idx];
    return h('td', h('input.num', { type: 'number', step: 1, value: Number.isFinite(v) ? v : '', onchange: (e) => setList(key, idx, e.target.value) }));
  };

  const head = h('tr', h('th', '#'), h('th', 'Width'), h('th', 'Spacing'), h('th', 'Line L'), h('th', 'LightN W'), h('th', 'LightL W'),
    MANIA_COLUMN_KEYS.map((s) => h('th', s.label)));
  const rows = Array.from({ length: keys }, (_, c) =>
    h('tr',
      h('td', c + 1),
      numCell('ColumnWidth', c),
      c < keys - 1 ? numCell('ColumnSpacing', c) : h('td'),
      numCell('ColumnLineWidth', c),
      numCell('LightingNWidth', c),
      numCell('LightingLWidth', c),
      MANIA_COLUMN_KEYS.map((spec) => {
        const key = columnKey(spec, c);
        return h('td', widget({ ...spec, key }, getValue(sec, key) ?? '', (v) => {
          setValue(getSection(), key, v);
          iniChanged('form');
        }));
      }),
    ));
  const lastLine = h('tr', h('td', '→'), h('td', { colSpan: 2 }, h('span.muted.small', 'Rightmost line')), numCell('ColumnLineWidth', keys));
  return h('div.table-scroll', h('table.columns', h('thead', head), h('tbody', rows, lastLine)));
}

function unknownKeys(section, known) {
  if (!section) return null;
  const extra = [...sectionEntries(section)].filter(([k]) => !known.has(k.toLowerCase()));
  if (!extra.length) return null;
  return h('details.group', h('summary', `Other keys (${extra.length})`),
    h('div.ini-form', extra.map(([k, v]) =>
      h('div.ini-row', h('div.ini-key', k), h('div.ini-input', h('input', {
        type: 'text', value: v,
        onchange: (e) => { setValue(section, k, e.target.value); iniChanged('form'); },
      }))))));
}
