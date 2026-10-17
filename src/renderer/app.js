import { h, clear, modal, field, toast, attempt } from './lib/dom.js';
import { state, on, api, openSkin, loadSkinList, saveIni } from './lib/state.js';
import { mountElements } from './views/elements.js';
import { mountImporter } from './views/importer.js';
import { mountConfig } from './views/config.js';
import { mountLayout } from './views/layout.js';
import { mountExport } from './views/export.js';
import { openCutout } from './views/cutout.js';

const TABS = [
  { id: 'elements', label: 'Elements', mount: mountElements },
  { id: 'layout', label: 'Mania Layout', mount: mountLayout },
  { id: 'config', label: 'skin.ini', mount: mountConfig },
  { id: 'importer', label: 'Copy from Skins', mount: mountImporter },
  { id: 'export', label: 'Check & Export', mount: mountExport },
];

const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
const view = document.getElementById('view');
let activeTab = 'elements';
let unmount = null;
let skinFilter = '';

function renderSidebar() {
  const list = h('div.skin-list');
  const fill = () => {
    const q = skinFilter.toLowerCase();
    clear(list, state.skins
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.folder.toLowerCase().includes(q))
      .map((s) => h(`button.skin-item${state.skin?.path === s.path ? '.active' : ''}`, {
        title: s.path,
        onclick: async () => { if (await openSkin(s)) renderSidebar(); },
      }, h('span.skin-name', s.name), s.author ? h('span.skin-author', s.author) : null)));
    if (!state.skins.length) list.append(h('p.muted.small.pad', state.settings.skinsDir ? 'No skins found in this folder.' : 'Choose your osu! Skins folder in Settings.'));
  };
  fill();
  clear(sidebar,
    h('div.brand', h('span.logo', '●'), h('span', 'osu! Skin Editor')),
    h('div.side-actions',
      h('button.primary', { onclick: newSkinDialog }, '+ New skin'),
      h('button', { title: 'Install a .osk file into your Skins folder', onclick: importOsk }, 'Import .osk'),
      h('button', { title: 'Remove the background from a picture of a character and save it as a transparent PNG', onclick: () => openCutout() }, '✂ Cut out character'),
    ),
    h('input.search', { type: 'search', placeholder: 'Filter skins…', value: skinFilter, oninput: (e) => { skinFilter = e.target.value; fill(); } }),
    list,
    h('div.side-footer',
      h('div.muted.small.ellipsis', { title: state.settings.skinsDir }, state.settings.skinsDir || 'No Skins folder set'),
      h('div.actions',
        h('button.small', { onclick: () => attempt(loadSkinList) }, '⟳ Refresh'),
        h('button.small', { onclick: settingsDialog }, '⚙ Settings')),
    ),
  );
}

function renderTopbar() {
  const saveBtn = h('button.primary', { disabled: !state.dirty, onclick: () => attempt(saveIni, 'skin.ini saved') }, state.dirty ? 'Save skin.ini' : 'Saved');
  clear(topbar,
    h('div.title',
      h('h1', state.skin?.name ?? 'No skin selected'),
      state.dirty ? h('span.dirty', { title: 'Unsaved skin.ini changes' }, '● unsaved') : null),
    h('nav.tabs', TABS.map((t) => h(`button.tab${t.id === activeTab ? '.active' : ''}`, { disabled: !state.skin, onclick: () => switchTab(t.id) }, t.label))),
    h('div.top-actions',
      state.skin ? h('button', { title: 'Open the skin folder', onclick: () => attempt(() => api.reveal(state.skin.path)) }, 'Open folder') : null,
      state.skin ? saveBtn : null),
  );
}

function switchTab(id) {
  activeTab = id;
  unmount?.();
  unmount = null;
  renderTopbar();
  if (!state.skin) {
    clear(view, welcome());
    return;
  }
  unmount = TABS.find((t) => t.id === id).mount(view) ?? null;
}

function welcome() {
  return h('div.welcome',
    h('h2', 'Welcome!'),
    h('p', 'Pick a skin on the left to edit it, or create a new one. Every element of every installed skin can be copied into your skin with one click.'),
    state.settings.skinsDir ? null : h('button.primary', { onclick: chooseSkinsDir }, 'Choose osu! Skins folder…'),
  );
}

async function chooseSkinsDir() {
  const dir = await api.openDir({ title: 'Select your osu! Skins folder' });
  if (!dir) return;
  state.settings = await api.setSettings({ skinsDir: dir });
  await loadSkinList();
  switchTab(activeTab);
}

function newSkinDialog() {
  if (!state.settings.skinsDir) return toast('Choose your Skins folder in Settings first.', 'error');
  modal('New skin', (close) => {
    const name = h('input', { type: 'text', placeholder: 'My Mania Skin' });
    const author = h('input', { type: 'text', value: state.settings.author ?? '' });
    const base = h('select', h('option', { value: '' }, 'Empty skin (osu! defaults)'),
      state.skins.map((s) => h('option', { value: s.path }, `Copy of: ${s.name}`)));
    const create = async () => {
      if (!name.value.trim()) return toast('Enter a name', 'error');
      const dir = await attempt(() => api.createSkin({ name: name.value.trim(), author: author.value.trim(), basedOn: base.value || null }));
      if (!dir) return;
      if (author.value.trim() !== state.settings.author) state.settings = await api.setSettings({ author: author.value.trim() });
      await loadSkinList();
      const skin = state.skins.find((s) => s.path === dir);
      close(true);
      if (skin && (await openSkin(skin))) {
        renderSidebar();
        toast(`Created "${skin.name}"`, 'ok');
      }
    };
    return h('div.form',
      field('Name', name),
      field('Author', author),
      field('Start from', base, 'Starting from a copy is the quickest way to make an edit of an existing skin.'),
      h('div.actions', h('button', { onclick: () => close() }, 'Cancel'), h('button.primary', { onclick: create }, 'Create')),
    );
  });
}

async function importOsk() {
  const dir = await attempt(() => api.importOsk());
  if (!dir) return;
  await loadSkinList();
  const skin = state.skins.find((s) => s.path === dir);
  if (skin && (await openSkin(skin))) renderSidebar();
  toast('Skin imported', 'ok');
}

function settingsDialog() {
  modal('Settings', (close) => {
    const dirInput = h('input', { type: 'text', value: state.settings.skinsDir ?? '' });
    const ffInput = h('input', { type: 'text', value: state.settings.ffmpegPath ?? '', placeholder: 'auto (system ffmpeg)' });
    const ffStatus = h('small.hint', 'Checking ffmpeg…');
    api.ffmpegStatus().then((s) => {
      ffStatus.textContent = s.path ? `Using: ${s.path}` : 'ffmpeg not found — GIF/video import will not work.';
      ffStatus.classList.toggle('error-text', !s.path);
    });
    const candidates = state.settings.candidates ?? [];
    return h('div.form',
      field('osu! Skins folder', h('div.row', dirInput, h('button', {
        onclick: async () => {
          const d = await api.openDir({ title: 'Select your osu! Skins folder' });
          if (d) dirInput.value = d;
        },
      }, 'Browse…')), candidates.length ? `Detected: ${candidates.join(' · ')}` : 'No osu! install detected automatically.'),
      field('ffmpeg path', ffInput, ffStatus),
      h('div.actions',
        h('button', { onclick: () => close() }, 'Cancel'),
        h('button.primary', {
          onclick: async () => {
            state.settings = await api.setSettings({ skinsDir: dirInput.value.trim(), ffmpegPath: ffInput.value.trim() });
            state.settings.candidates = candidates;
            await loadSkinList();
            close(true);
            renderSidebar();
            switchTab(activeTab);
          },
        }, 'Save'),
      ),
    );
  });
}

// Keyboard: Ctrl+S saves skin.ini
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (state.skin && state.dirty) attempt(saveIni, 'skin.ini saved');
  }
});

// Don't let a stray drop navigate the window to the file.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// Ask before closing with unsaved changes.
let closing = false;
window.addEventListener('beforeunload', (e) => {
  if (!state.dirty || closing) return;
  e.preventDefault();
  e.returnValue = false;
  modal('Unsaved changes', (close) => h('div',
    h('p', 'skin.ini has unsaved changes.'),
    h('div.actions',
      h('button', { onclick: () => close() }, 'Cancel'),
      h('button.danger', { onclick: () => close('discard') }, 'Discard & quit'),
      h('button.primary', { onclick: () => close('save') }, 'Save & quit')),
  )).then(async (choice) => {
    if (!choice) return;
    if (choice === 'save' && (await attempt(saveIni)) === undefined && state.dirty) return;
    closing = true;
    window.close();
  });
});

on('dirty', renderTopbar);
on('skins', renderSidebar);
on('skin-renamed', async () => { await loadSkinList(); renderTopbar(); });
on('skin', () => { renderTopbar(); if (!unmount) switchTab(activeTab); });

(async function init() {
  state.settings = await api.getSettings();
  await attempt(loadSkinList);
  renderSidebar();
  const last = state.skins.find((s) => s.path === state.settings.lastSkin);
  if (last) await openSkin(last);
  renderSidebar();
  switchTab(activeTab);
})();
