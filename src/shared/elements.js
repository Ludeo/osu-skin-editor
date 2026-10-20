// Catalog of osu! skin elements.
//   name : base filename without extension / @2x / frame suffix
//   anim : frame separator if the element can be animated ('-' => name-0.png,
//          '' => name0.png), undefined if static
//   sound: true for audio elements (.wav/.ogg/.mp3)
//   size : recommended @2x (HD) size in pixels, informational only
//   compose: composer presets and guides (every image can be composed):
//            'panel' for ranking-panel, 'stage' for the mania stage sides (+ side),
//            'button' for the song select beatmap panel, 'bottom' for mania-stage-bottom

export const CATEGORIES = [
  { id: 'mania', label: 'Mania' },
  { id: 'interface', label: 'Menu & Interface' },
  { id: 'songselect', label: 'Song Select' },
  { id: 'hud', label: 'Gameplay HUD' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'mods', label: 'Mod Icons' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'standard', label: 'osu!standard' },
  { id: 'sounds', label: 'Sounds' },
];

const el = (cat, name, label, opts = {}) => ({ cat, name, label, ...opts });

const mania = [
  el('mania', 'mania-key1', 'Key 1 (outer)', { desc: 'Unpressed key for "1" style columns.' }),
  el('mania', 'mania-key1D', 'Key 1 pressed'),
  el('mania', 'mania-key2', 'Key 2 (inner)'),
  el('mania', 'mania-key2D', 'Key 2 pressed'),
  el('mania', 'mania-keyS', 'Key S (special/middle)'),
  el('mania', 'mania-keySD', 'Key S pressed'),
  el('mania', 'mania-note1', 'Note 1', { anim: '-' }),
  el('mania', 'mania-note1H', 'Hold head 1', { anim: '-' }),
  el('mania', 'mania-note1L', 'Hold body 1', { anim: '-' }),
  el('mania', 'mania-note1T', 'Hold tail 1', { anim: '-' }),
  el('mania', 'mania-note2', 'Note 2', { anim: '-' }),
  el('mania', 'mania-note2H', 'Hold head 2', { anim: '-' }),
  el('mania', 'mania-note2L', 'Hold body 2', { anim: '-' }),
  el('mania', 'mania-note2T', 'Hold tail 2', { anim: '-' }),
  el('mania', 'mania-noteS', 'Note S', { anim: '-' }),
  el('mania', 'mania-noteSH', 'Hold head S', { anim: '-' }),
  el('mania', 'mania-noteSL', 'Hold body S', { anim: '-' }),
  el('mania', 'mania-noteST', 'Hold tail S', { anim: '-' }),
  el('mania', 'mania-stage-left', 'Stage left border', { compose: 'stage', side: 'left' }),
  el('mania', 'mania-stage-right', 'Stage right border', { compose: 'stage', side: 'right' }),
  el('mania', 'mania-stage-bottom', 'Stage bottom', { compose: 'bottom' }),
  el('mania', 'mania-stage-hint', 'Judgement line (hint)'),
  el('mania', 'mania-stage-light', 'Column light', { anim: '-' }),
  el('mania', 'lightingN', 'Note hit lighting', { anim: '-' }),
  el('mania', 'lightingL', 'Hold lighting', { anim: '-' }),
  el('mania', 'mania-hit0', 'Miss', { anim: '-' }),
  el('mania', 'mania-hit50', '50', { anim: '-' }),
  el('mania', 'mania-hit100', '100', { anim: '-' }),
  el('mania', 'mania-hit200', '200', { anim: '-' }),
  el('mania', 'mania-hit300', '300', { anim: '-' }),
  el('mania', 'mania-hit300g', 'MAX (300g)', { anim: '-' }),
  el('mania', 'comboburst-mania', 'Combo burst', { anim: '-' }),
];

const iface = [
  el('interface', 'menu-back', 'Back button', { anim: '-', size: [400, 400], desc: 'Animated back button in menus.' }),
  el('interface', 'menu-background', 'Menu background', { size: [2732, 1536] }),
  el('interface', 'menu-snow', 'Menu snow'),
  el('interface', 'welcome_text', 'Welcome text'),
  el('interface', 'cursor', 'Cursor'),
  el('interface', 'cursormiddle', 'Cursor middle'),
  el('interface', 'cursortrail', 'Cursor trail'),
  el('interface', 'cursor-smoke', 'Cursor smoke'),
  el('interface', 'button-left', 'Button left'),
  el('interface', 'button-middle', 'Button middle'),
  el('interface', 'button-right', 'Button right'),
  el('interface', 'options-offset-tick', 'Offset wizard tick'),
  el('interface', 'loading-icon', 'Loading icon (unused, legacy)'),
];

const songselect = [
  el('songselect', 'menu-button-background', 'Beatmap panel', { compose: 'button' }),
  el('songselect', 'selection-tab', 'Tab'),
  el('songselect', 'star', 'Difficulty star'),
  el('songselect', 'star2', 'Star (menu particles)'),
  el('songselect', 'selection-mode', 'Mode button'),
  el('songselect', 'selection-mode-over', 'Mode button (hover)'),
  el('songselect', 'selection-mods', 'Mods button'),
  el('songselect', 'selection-mods-over', 'Mods button (hover)'),
  el('songselect', 'selection-random', 'Random button'),
  el('songselect', 'selection-random-over', 'Random button (hover)'),
  el('songselect', 'selection-options', 'Options button'),
  el('songselect', 'selection-options-over', 'Options button (hover)'),
  el('songselect', 'mode-osu', 'Mode icon osu!'),
  el('songselect', 'mode-taiko', 'Mode icon taiko'),
  el('songselect', 'mode-fruits', 'Mode icon catch'),
  el('songselect', 'mode-mania', 'Mode icon mania'),
  el('songselect', 'mode-osu-med', 'Mode icon osu! (medium)'),
  el('songselect', 'mode-taiko-med', 'Mode icon taiko (medium)'),
  el('songselect', 'mode-fruits-med', 'Mode icon catch (medium)'),
  el('songselect', 'mode-mania-med', 'Mode icon mania (medium)'),
  el('songselect', 'mode-osu-small', 'Mode icon osu! (small)'),
  el('songselect', 'mode-taiko-small', 'Mode icon taiko (small)'),
  el('songselect', 'mode-fruits-small', 'Mode icon catch (small)'),
  el('songselect', 'mode-mania-small', 'Mode icon mania (small)'),
];

const hud = [
  el('hud', 'scorebar-bg', 'Health bar background'),
  el('hud', 'scorebar-colour', 'Health bar fill', { anim: '-' }),
  el('hud', 'scorebar-ki', 'Health bar marker'),
  el('hud', 'scorebar-kidanger', 'Health marker (danger)'),
  el('hud', 'scorebar-kidanger2', 'Health marker (critical)'),
  el('hud', 'scorebar-marker', 'Health bar marker (new style)'),
  el('hud', 'play-skip', 'Skip button', { anim: '-' }),
  el('hud', 'play-unranked', 'Unranked text'),
  el('hud', 'play-warningarrow', 'Warning arrow'),
  el('hud', 'arrow-warning', 'Arrow warning'),
  el('hud', 'arrow-pause', 'Arrow pause'),
  el('hud', 'section-pass', 'Section pass'),
  el('hud', 'section-fail', 'Section fail'),
  el('hud', 'count1', 'Countdown 1'),
  el('hud', 'count2', 'Countdown 2'),
  el('hud', 'count3', 'Countdown 3'),
  el('hud', 'go', 'Go'),
  el('hud', 'ready', 'Ready'),
  el('hud', 'pause-overlay', 'Pause overlay', { anim: '-' }),
  el('hud', 'fail-background', 'Fail overlay', { anim: '-' }),
  el('hud', 'pause-continue', 'Pause: continue'),
  el('hud', 'pause-retry', 'Pause: retry'),
  el('hud', 'pause-back', 'Pause: back'),
  el('hud', 'pause-replay', 'Pause: replay'),
  el('hud', 'inputoverlay-background', 'Input overlay background'),
  el('hud', 'inputoverlay-key', 'Input overlay key'),
  el('hud', 'masking-border', 'Masking border'),
];

const grades = ['XH', 'X', 'SH', 'S', 'A', 'B', 'C', 'D'];
const ranking = [
  el('ranking', 'ranking-panel', 'Results panel', {
    compose: 'panel',
    desc: 'Background of the results screen. It can be much taller than the screen (up to 2732×2693 @2x) to also decorate the part you scroll down to.',
  }),
  el('ranking', 'ranking-graph', 'Performance graph'),
  el('ranking', 'ranking-title', 'Title'),
  el('ranking', 'ranking-accuracy', 'Accuracy label'),
  el('ranking', 'ranking-maxcombo', 'Max combo label'),
  el('ranking', 'ranking-perfect', 'Perfect / full combo'),
  el('ranking', 'ranking-replay', 'Replay button'),
  el('ranking', 'ranking-retry', 'Retry button'),
  el('ranking', 'ranking-winner', 'Winner (multiplayer)'),
  ...grades.map((g) => el('ranking', `ranking-${g}`, `Grade ${g}`)),
  ...grades.map((g) => el('ranking', `ranking-${g}-small`, `Grade ${g} (small)`)),
];

const modNames = [
  ['easy', 'Easy'], ['nofail', 'No Fail'], ['halftime', 'Half Time'], ['hardrock', 'Hard Rock'],
  ['suddendeath', 'Sudden Death'], ['perfect', 'Perfect'], ['doubletime', 'Double Time'],
  ['nightcore', 'Nightcore'], ['hidden', 'Hidden'], ['fadein', 'Fade In'], ['flashlight', 'Flashlight'],
  ['relax', 'Relax'], ['relax2', 'Autopilot'], ['spunout', 'Spun Out'], ['autoplay', 'Auto'],
  ['cinema', 'Cinema'], ['scorev2', 'ScoreV2'], ['target', 'Target'], ['random', 'Random'],
  ['mirror', 'Mirror'], ['keycoop', 'Co-op'], ['freemodallowed', 'Free mod'], ['touchdevice', 'Touch'],
  ...Array.from({ length: 9 }, (_, i) => [`key${i + 1}`, `${i + 1}K`]),
];
const mods = modNames.map(([n, l]) => el('mods', `selection-mod-${n}`, l));

const digits = [...Array(10).keys()];
const fonts = [
  ...digits.map((d) => el('fonts', `score-${d}`, `Score ${d}`)),
  el('fonts', 'score-comma', 'Score ,'),
  el('fonts', 'score-dot', 'Score .'),
  el('fonts', 'score-percent', 'Score %'),
  el('fonts', 'score-x', 'Score x'),
  ...digits.map((d) => el('fonts', `default-${d}`, `Hitcircle ${d}`)),
];

const standard = [
  el('standard', 'hitcircle', 'Hit circle'),
  el('standard', 'hitcircleoverlay', 'Hit circle overlay', { anim: '-' }),
  el('standard', 'approachcircle', 'Approach circle'),
  el('standard', 'sliderstartcircle', 'Slider start circle'),
  el('standard', 'sliderendcircle', 'Slider end circle'),
  el('standard', 'sliderb', 'Slider ball', { anim: '' }),
  el('standard', 'sliderfollowcircle', 'Slider follow circle', { anim: '-' }),
  el('standard', 'reversearrow', 'Reverse arrow'),
  el('standard', 'sliderscorepoint', 'Slider tick'),
  el('standard', 'followpoint', 'Follow point', { anim: '-' }),
  el('standard', 'hit0', 'Miss', { anim: '-' }),
  el('standard', 'hit50', '50', { anim: '-' }),
  el('standard', 'hit100', '100', { anim: '-' }),
  el('standard', 'hit100k', 'Katu 100', { anim: '-' }),
  el('standard', 'hit300', '300', { anim: '-' }),
  el('standard', 'hit300k', 'Katu 300', { anim: '-' }),
  el('standard', 'hit300g', 'Geki 300', { anim: '-' }),
  el('standard', 'spinner-background', 'Spinner background'),
  el('standard', 'spinner-circle', 'Spinner circle'),
  el('standard', 'spinner-metre', 'Spinner metre'),
  el('standard', 'spinner-bottom', 'Spinner bottom'),
  el('standard', 'spinner-glow', 'Spinner glow'),
  el('standard', 'spinner-middle', 'Spinner middle'),
  el('standard', 'spinner-middle2', 'Spinner middle 2'),
  el('standard', 'spinner-top', 'Spinner top'),
  el('standard', 'spinner-approachcircle', 'Spinner approach circle'),
  el('standard', 'spinner-rpm', 'Spinner RPM'),
  el('standard', 'spinner-clear', 'Spinner clear'),
  el('standard', 'spinner-spin', 'Spinner spin'),
  el('standard', 'comboburst', 'Combo burst', { anim: '-' }),
];

const soundNames = [
  ['applause', 'Applause'], ['menuback', 'Menu back'], ['menuclick', 'Menu click'], ['menuhit', 'Menu hit'],
  ['menu-back-click', 'Back button click'], ['menu-back-hover', 'Back button hover'],
  ['click-short-confirm', 'Confirm click'], ['click-short', 'Short click'], ['heartbeat', 'Heartbeat'],
  ['combobreak', 'Combo break'], ['failsound', 'Fail'], ['sectionpass', 'Section pass'],
  ['sectionfail', 'Section fail'], ['pause-loop', 'Pause loop'], ['count1s', 'Count 1'],
  ['count2s', 'Count 2'], ['count3s', 'Count 3'], ['gos', 'Go'], ['readys', 'Ready'],
  ...['normal', 'soft', 'drum'].flatMap((set) =>
    ['hitnormal', 'hitclap', 'hitwhistle', 'hitfinish', 'slidertick', 'sliderslide'].map((h) => [
      `${set}-${h}`,
      `${set} ${h.replace('hit', 'hit ')}`,
    ]),
  ),
];
const sounds = soundNames.map(([n, l]) => el('sounds', n, l, { sound: true }));

export const ELEMENTS = [...mania, ...iface, ...songselect, ...hud, ...ranking, ...mods, ...fonts, ...standard, ...sounds];

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg'];
export const SOUND_EXTS = ['wav', 'ogg', 'mp3'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find every file in `files` (relative paths, any case) that belongs to the
 * element with base path `base` (may contain a folder, e.g. "Orbs/note1").
 * Returns { static: {sd, hd}, frames: [{index, sd, hd}], all: [...] }.
 */
export function matchElementFiles(files, base, { anim, sound } = {}) {
  const exts = sound ? SOUND_EXTS : IMAGE_EXTS;
  const b = escapeRe(base.replace(/\\/g, '/').toLowerCase());
  const extRe = `\\.(${exts.join('|')})$`;
  const staticRe = new RegExp(`^${b}(@2x)?${extRe}`);
  const sep = anim === undefined ? null : escapeRe(anim);
  const frameRe = sep === null ? null : new RegExp(`^${b}${sep}(\\d+)(@2x)?${extRe}`);

  const result = { static: { sd: null, hd: null }, frames: [], all: [] };
  const frames = new Map();
  for (const f of files) {
    const lower = f.toLowerCase();
    let m = staticRe.exec(lower);
    if (m) {
      result.static[m[1] ? 'hd' : 'sd'] = f;
      result.all.push(f);
      continue;
    }
    if (frameRe && (m = frameRe.exec(lower))) {
      const idx = Number(m[1]);
      if (!frames.has(idx)) frames.set(idx, { index: idx, sd: null, hd: null });
      frames.get(idx)[m[2] ? 'hd' : 'sd'] = f;
      result.all.push(f);
    }
  }
  // osu! only uses a contiguous run of frames starting at 0.
  for (let i = 0; frames.has(i); i++) result.frames.push(frames.get(i));
  return result;
}

/** Default mania key/note image suffix ("1", "2" or "S") for a column. */
export function defaultColumnStyle(keys, column) {
  const half = Math.floor(keys / 2);
  if (keys % 2 === 1 && column === half) return 'S';
  const fromOuter = column < half ? column : keys - 1 - column;
  return fromOuter % 2 === 0 ? '1' : '2';
}
