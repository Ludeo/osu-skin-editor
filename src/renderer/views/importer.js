// Bulk copy elements and mania keycount configurations from installed skins.
import { h, clear, attempt, confirmDialog, toast } from '../lib/dom.js';
import { state, on, api, elementInfo, refreshFiles, filesOf, ensureSaved, reloadIni } from '../lib/state.js';
import { CATEGORIES, ELEMENTS } from '../../shared/elements.js';
import { parseIni, getManiaSections, getValue } from '../../shared/skinIni.js';

const ui = { source: '', cat: 'mania', onlyMissing: false, selected: new Set() };

export function mountImporter(root) {
  const sourceSel = h('select', { onchange: (e) => { ui.source = e.target.value; ui.selected.clear(); render(); } });
  const catBar = h('div.chips');
  const grid = h('div.el-grid.compact');
  const maniaBox = h('div.mania-configs');
  const copyBtn = h('button.primary', { onclick: copySelected });
  const onlyMissing = h('label.check', h('input', { type: 'checkbox', checked: ui.onlyMissing, onchange: (e) => { ui.onlyMissing = e.target.checked; renderGrid(); } }), 'Only what my skin is missing');

  clear(root, h('div.importer-view',
    h('div.imp-main',
      h('div.toolbar', h('span.label', 'Copy from'), sourceSel, h('div.spacer'), onlyMissing,
        h('button', { onclick: () => selectVisible(true) }, 'Select all'),
        h('button', { onclick: () => selectVisible(false) }, 'Select none')),
      catBar,
      grid,
      h('div.sticky-footer', copyBtn),
    ),
    h('aside.detail', h('h3', 'Mania keycount configs'), h('p.muted.small', 'Copies the whole [Mania] section (column widths, positions, colours, …) and every image it references into your skin.'), maniaBox),
  ));

  let sourceFiles = [];
  let visible = [];

  function renderSources() {
    const others = state.skins.filter((s) => s.path !== state.skin?.path);
    if (!others.some((s) => s.path === ui.source)) ui.source = others[0]?.path ?? '';
    clear(sourceSel, others.map((s) => h('option', { value: s.path, selected: s.path === ui.source }, s.name)));
  }

  function renderCats() {
    clear(catBar, CATEGORIES.map((c) => h(`button.chip${ui.cat === c.id ? '.active' : ''}`, { onclick: () => { ui.cat = c.id; renderCats(); renderGrid(); } }, c.label)));
  }

  function renderGrid() {
    if (!state.skin || !ui.source) return clear(grid, h('p.empty-state', 'No other skins installed.'));
    visible = [];
    const cards = [];
    for (const el of ELEMENTS.filter((e) => e.cat === ui.cat)) {
      const info = elementInfo(el, { skinPath: ui.source, files: sourceFiles });
      if (!info) continue;
      const mine = elementInfo(el);
      if (ui.onlyMissing && mine) continue;
      visible.push(el);
      const checked = ui.selected.has(el.name);
      cards.push(h(`div.el-card${checked ? '.selected' : ''}`, {
        onclick: () => { checked ? ui.selected.delete(el.name) : ui.selected.add(el.name); renderGrid(); },
      },
      h('input.card-check', { type: 'checkbox', checked, tabIndex: -1 }),
      h(`div.thumb${el.sound ? '' : '.checker'}`, el.sound ? h('div.sound-icon', '♪') : h('img', { src: info.url, loading: 'lazy', alt: '' })),
      h('div.el-label', el.label),
      h('div.badges',
        info.frames.length > 1 ? h('span.badge.anim', `${info.frames.length}f`) : null,
        mine ? h('span.badge.warn', 'replaces yours') : h('span.badge.ok', 'new')),
      ));
    }
    clear(grid, cards.length ? cards : h('p.empty-state', 'This skin has no elements in this category.'));
    updateButton();
  }

  function selectVisible(yes) {
    visible.forEach((el) => (yes ? ui.selected.add(el.name) : ui.selected.delete(el.name)));
    renderGrid();
  }

  function updateButton() {
    copyBtn.textContent = `Copy ${ui.selected.size} element(s) to “${state.skin?.name ?? ''}”`;
    copyBtn.disabled = !ui.selected.size;
  }

  async function copySelected() {
    const els = ELEMENTS.filter((e) => ui.selected.has(e.name));
    const replacing = els.filter((e) => elementInfo(e));
    if (replacing.length && !(await confirmDialog('Replace elements?', `${replacing.length} element(s) already exist in your skin and will be replaced:\n${replacing.map((e) => e.name).join(', ')}`, 'Replace'))) return;
    const copied = await attempt(() => api.copyElements(ui.source, state.skin.path, els.map((e) => ({ base: e.name, anim: e.anim ?? '-', sound: e.sound }))));
    if (copied) {
      toast(`Copied ${copied.length} file(s)`, 'ok');
      ui.selected.clear();
      await refreshFiles();
    }
  }

  async function renderMania() {
    if (!ui.source || !state.skin) return clear(maniaBox);
    const doc = parseIni(await api.readIni(ui.source).catch(() => ''));
    const mine = new Set(getManiaSections(state.iniDoc).map((s) => Number(getValue(s, 'Keys'))));
    const sections = getManiaSections(doc).sort((a, b) => getValue(a, 'Keys') - getValue(b, 'Keys'));
    if (!sections.length) return clear(maniaBox, h('p.muted', 'This skin has no [Mania] sections.'));
    clear(maniaBox, sections.map((s) => {
      const keys = Number(getValue(s, 'Keys'));
      const widths = getValue(s, 'ColumnWidth') ?? 'default';
      return h('div.mania-config',
        h('div', h('strong', `${keys}K`), mine.has(keys) ? h('span.badge.warn', 'replaces yours') : null),
        h('div.muted.small', `ColumnWidth ${widths} · HitPosition ${getValue(s, 'HitPosition') ?? 402}`),
        h('button.small', {
          onclick: async () => {
            if (mine.has(keys) && !(await confirmDialog('Replace config?', `Replace your ${keys}K configuration with the one from this skin?`, 'Replace'))) return;
            await ensureSaved();
            const res = await attempt(() => api.copyMania(ui.source, state.skin.path, keys));
            if (res) {
              toast(`Copied ${keys}K config and ${res.files.length} image file(s)`, 'ok');
              await Promise.all([refreshFiles(), reloadIni()]);
              renderMania();
            }
          },
        }, `Copy ${keys}K config + images`),
      );
    }));
  }

  async function render() {
    renderSources();
    renderCats();
    sourceFiles = ui.source ? await filesOf(ui.source).catch(() => []) : [];
    renderGrid();
    renderMania();
  }

  render();
  const offs = [on('skin', render), on('skins', render), on('files', renderGrid), on('ini', renderMania)];
  return () => offs.forEach((off) => off());
}
