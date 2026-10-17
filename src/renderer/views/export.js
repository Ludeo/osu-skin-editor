import { h, clear, attempt, toast } from '../lib/dom.js';
import { state, on, api, ensureSaved } from '../lib/state.js';

export function mountExport(root) {
  const results = h('div.check-results');
  clear(root, h('div.export-view',
    h('section.card',
      h('h3', 'Export'),
      h('p.muted', 'Package the skin as a .osk file you can share. Opening a .osk installs it in osu!'),
      h('div.actions',
        h('button.primary', {
          onclick: async () => {
            await ensureSaved();
            const out = await attempt(() => api.exportOsk(state.skin.path));
            if (out) toast(`Exported to ${out}`, 'ok', 6000);
          },
        }, 'Export .osk…'),
        h('button', { onclick: () => attempt(() => api.reveal(state.skin.path)) }, 'Open skin folder'),
      ),
    ),
    h('section.card',
      h('h3', 'Skin check'),
      h('p.muted', 'Looks for broken image references in skin.ini and other common problems.'),
      h('button', { onclick: check }, 'Run check again'),
      results,
    ),
  ));

  async function check() {
    if (!state.skin) return;
    const issues = await attempt(() => api.checkSkin(state.skin.path));
    if (!issues) return;
    clear(results,
      state.dirty ? h('p.muted.small', 'Note: this checks the saved skin.ini. You have unsaved changes.') : null,
      issues.length
      ? h('ul.issues', issues.map((i) => h(`li.${i.level}`, h('span.level', i.level), i.msg)))
      : h('p.ok-text', 'No problems found.'));
  }

  check();
  const off = on('skin', check);
  return off;
}
