import { h, clear, attempt, confirmDialog } from '../lib/dom.js';
import { state, on, api, elementInfo, refreshFiles, filesOf, getAnimationFramerate } from '../lib/state.js';
import { previewImg } from '../lib/preview.js';
import { CATEGORIES, ELEMENTS } from '../../shared/elements.js';
import { importInto } from './convert.js';
import { openComposer, stageBottomBase, extractSavedSides } from './composer.js';
import { openCutout } from './cutout.js';
import { openRecolor, noteGroupOf } from './recolor.js';
import { getManiaSections } from '../../shared/skinIni.js';

const ui = { cat: 'mania', search: '', filter: 'all', selected: null };

export const toTarget = (el) => ({ base: el.name, label: el.label, anim: el.anim, sound: el.sound, size: el.size });

export function mountElements(root) {
  const grid = h('div.el-grid');
  const detail = h('aside.detail');
  const catBar = h('div.chips');
  const search = h('input.search', { type: 'search', placeholder: 'Search elements…', value: ui.search, oninput: (e) => { ui.search = e.target.value; renderGrid(); } });
  const filter = h('select', { onchange: (e) => { ui.filter = e.target.value; renderGrid(); } },
    h('option', { value: 'all' }, 'All'), h('option', { value: 'present' }, 'In skin'), h('option', { value: 'missing' }, 'Missing'));

  clear(root, h('div.elements-view',
    h('div.el-main', h('div.toolbar', catBar, h('div.spacer'), search, filter), grid),
    detail,
  ));

  function renderCats() {
    clear(catBar, CATEGORIES.map((c) => h(`button.chip${ui.cat === c.id ? '.active' : ''}`, { onclick: () => { ui.cat = c.id; renderCats(); renderGrid(); } }, c.label)));
  }

  function visibleElements() {
    const q = ui.search.trim().toLowerCase();
    return ELEMENTS.filter((el) => (q ? el.name.toLowerCase().includes(q) || el.label.toLowerCase().includes(q) : el.cat === ui.cat));
  }

  function renderGrid() {
    if (!state.skin) return clear(grid, h('p.empty-state', 'Select or create a skin on the left.'));
    const cards = [];
    for (const el of visibleElements()) {
      const info = elementInfo(el);
      if (ui.filter === 'present' && !info) continue;
      if (ui.filter === 'missing' && info) continue;
      cards.push(card(el, info));
    }
    clear(grid, maniaPathHint(), cards.length ? cards : h('p.empty-state', 'Nothing here.'));
  }

  /** Mania skins often point to their own images via skin.ini instead of the default names. */
  function maniaPathHint() {
    if (ui.cat !== 'mania' || ui.search) return null;
    const custom = getManiaSections(state.iniDoc).some((s) => s.lines.some((l) => l.kind === 'kv' && /^(KeyImage|NoteImage)\d/i.test(l.key)));
    if (!custom) return null;
    return h('div.banner', 'This skin sets its own key/note images in skin.ini, so osu! may not use the default files below. Edit them per column in the Mania Layout tab.');
  }

  function card(el, info) {
    const thumb = el.sound
      ? h('div.sound-icon', info ? '♪' : '–')
      : info ? h('img', { src: info.url, draggable: false, loading: 'lazy', decoding: 'async', alt: '' }) : h('div.missing', 'missing');
    const badges = [];
    if (info?.frames.length > 1) badges.push(h('span.badge.anim', `${info.frames.length}f`));
    if (info?.hasHd) badges.push(h('span.badge', 'HD'));
    if (info?.hasSd) badges.push(h('span.badge', 'SD'));
    if (el.anim !== undefined && !info?.frames.length) badges.push(h('span.badge.ghost', 'animatable'));

    const node = h(`div.el-card${ui.selected === el.name ? '.selected' : ''}${info ? '' : '.absent'}`,
      {
        dataset: { name: el.name },
        title: `${el.name}\nDrop an image, GIF or video here to replace it`,
        onclick: () => select(el),
        ondragover: (e) => { e.preventDefault(); node.classList.add('drop'); },
        ondragleave: () => node.classList.remove('drop'),
        ondrop: async (e) => {
          e.preventDefault();
          node.classList.remove('drop');
          const f = e.dataTransfer.files[0];
          if (!f) return;
          const p = await api.droppedPath(f);
          if (p && (await importInto(toTarget(el), p))) select(el);
        },
      },
      h(`div.thumb${el.sound ? '' : '.checker'}`, thumb),
      h('div.el-label', el.label),
      h('div.el-name', el.name),
      h('div.badges', badges),
    );
    return node;
  }

  function select(el) {
    ui.selected = el.name;
    // Only move the highlight; rebuilding the grid would reload every thumbnail.
    grid.querySelectorAll('.el-card').forEach((c) => c.classList.toggle('selected', c.dataset.name === el.name));
    renderDetail();
  }

  function renderDetail() {
    const el = ELEMENTS.find((e) => e.name === ui.selected);
    if (!el || !state.skin) return clear(detail, h('div.empty-state', 'Click an element to preview, replace or copy it from another skin. You can also drop files directly onto a card.'));
    const info = elementInfo(el);
    const fr = getAnimationFramerate();

    const preview = el.sound
      ? info ? h('audio', { controls: true, src: info.url }) : h('div.missing.big', 'No sound')
      : h('div.checker.big-preview', info ? previewImg(info, { fps: fr }) : h('div.missing', 'Not in this skin (osu! default is used)'));

    const actions = h('div.actions.wrap',
      h('button.primary', { onclick: async () => { if (await importInto(toTarget(el))) renderDetail(); } },
        el.sound ? 'Import sound…' : el.anim !== undefined ? 'Import image / GIF / video…' : 'Import image…'),
      el.sound ? null : h('button', {
        title: 'Remove the background from a picture first, then import it',
        onclick: async () => {
          const p = await openCutout({ action: 'Continue to import' });
          if (p && (await importInto(toTarget(el), p))) renderDetail();
        },
      }, 'Cut out…'),
      el.sound ? null : h('button', { title: 'Combine images, e.g. place a character on a big background', onclick: async () => { if (await openComposer(el)) renderDetail(); } }, 'Compose…'),
      el.compose === 'bottom' ? h('button', {
        title: 'Paint mania-stage-left and -right into this image where osu! draws them, so a lane cover doesn\'t hide them',
        onclick: async () => { if (await openComposer(el, { base: stageBottomBase(), addSides: true })) renderDetail(); },
      }, 'Add stage sides…') : null,
      el.compose === 'bottom' ? h('button', {
        title: 'Write the stage sides painted into this image back into the skin as mania-stage-left/-right, e.g. after deleting those files',
        onclick: async () => { if (await extractSavedSides()) renderDetail(); },
      }, 'Extract stage sides') : null,
      info && noteGroupOf(el.name) ? h('button', { title: 'Change the colour of this note and its hold parts', onclick: () => openRecolor(noteGroupOf(el.name)) }, 'Recolour…') : null,
      info ? h('button.danger', {
        onclick: async () => {
          if (!(await confirmDialog('Delete element', `Delete ${info.files.length} file(s) of ${el.name}? osu! will fall back to the default skin.`, 'Delete'))) return;
          await attempt(async () => {
            await api.removeElement(state.skin.path, el.name, { anim: el.anim ?? '-', sound: el.sound });
            await refreshFiles();
          }, 'Deleted');
          renderDetail();
        },
      }, 'Delete') : null,
    );

    const gallery = h('div.gallery', h('div.muted', 'Searching installed skins…'));
    clear(detail,
      h('h3', el.label),
      h('code.el-name', el.name),
      el.desc ? h('p.muted', el.desc) : null,
      el.size ? h('p.muted.small', `Recommended HD size: ${el.size[0]}×${el.size[1]}`) : null,
      preview,
      info?.frames.length > 1 ? h('p.muted.small', `${info.frames.length} frames · AnimationFramerate ${fr > 0 ? `${fr} fps` : '-1 (all frames in 1 s)'}`) : null,
      actions,
      info ? h('details.files', h('summary', `${info.files.length} file(s)`), h('ul', info.files.map((f) => h('li', f)))) : null,
      h('h4', 'Copy from an installed skin'),
      gallery,
    );
    fillGallery(el, gallery);
  }

  let galleryToken = 0;
  async function fillGallery(el, gallery) {
    const token = ++galleryToken;
    const others = state.skins.filter((s) => s.path !== state.skin.path);
    const results = await Promise.all(others.map(async (s) => {
      const files = await filesOf(s.path).catch(() => []);
      return { skin: s, info: elementInfo(el, { skinPath: s.path, files }) };
    }));
    if (token !== galleryToken) return;
    const found = results.filter((r) => r.info);
    if (!found.length) return clear(gallery, h('div.muted', 'No other installed skin has this element.'));
    clear(gallery, found.map(({ skin, info }) =>
      h('div.gallery-item', {
        title: `Copy from ${skin.name}`,
        onclick: async () => {
          await attempt(async () => {
            await api.copyElements(skin.path, state.skin.path, [{ base: el.name, anim: el.anim ?? '-', sound: el.sound }]);
            await refreshFiles();
          }, `Copied ${el.name} from ${skin.name}`);
          renderDetail();
        },
      },
      el.sound ? h('div.sound-icon', '♪') : h('div.checker.thumb', previewImg(info, { fps: getAnimationFramerate() })),
      h('div.gallery-name', skin.name),
      h('div.muted.small', info.frames.length > 1 ? `${info.frames.length} frames` : info.hasHd ? 'HD' : 'SD'),
      el.sound ? h('button.small', { onclick: (e) => { e.stopPropagation(); new Audio(info.url).play(); } }, '▶ Play') : null,
      )));
  }

  renderCats();
  renderGrid();
  renderDetail();
  const offs = [
    on('files', () => { renderGrid(); renderDetail(); }),
    on('skin', () => { renderGrid(); renderDetail(); }),
    on('skins', renderDetail),
  ];
  return () => offs.forEach((off) => off());
}

