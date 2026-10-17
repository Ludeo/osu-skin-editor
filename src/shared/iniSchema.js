// Field definitions for the form-based skin.ini editor.
// type: text | int | float | bool | enum | color | colorA | image | list
// `def` is osu!'s default (used as placeholder; empty field = key omitted).

const f = (key, type, def, desc, extra = {}) => ({ key, type, def, desc, ...extra });

export const GENERAL = [
  f('Name', 'text', '', 'Skin name shown in the options menu.'),
  f('Author', 'text', '', 'Who made the skin.'),
  f('Version', 'enum', 'latest', 'Skin version. Mania layout behaves best with 2.5 or newer.', {
    options: ['1.0', '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.7', 'latest'],
  }),
  f('AnimationFramerate', 'int', -1, 'FPS for animations without their own rate (e.g. menu-back). -1 = play all frames in one second.'),
  f('AllowSliderBallTint', 'bool', 0, 'Tint the slider ball with the combo colour.'),
  f('ComboBurstRandom', 'bool', 0, 'Show combo bursts in random order.'),
  f('CursorCentre', 'bool', 1, 'Centre the cursor image on the pointer.'),
  f('CursorExpand', 'bool', 1, 'Cursor grows when clicking.'),
  f('CursorRotate', 'bool', 1, 'Cursor rotates.'),
  f('CursorTrailRotate', 'bool', 1, 'Cursor trail rotates.'),
  f('CustomComboBurstSounds', 'text', '', 'Comma separated combo counts that play comboburst sounds.'),
  f('HitCircleOverlayAboveNumber', 'bool', 1, 'Draw hitcircleoverlay above the number.'),
  f('LayeredHitSounds', 'bool', 1, 'Always play hitnormal together with other hitsounds.'),
  f('SliderBallFlip', 'bool', 1, 'Flip the slider ball on reverse.'),
  f('SpinnerFadePlayfield', 'bool', 0, 'Darken the playfield during spinners.'),
  f('SpinnerFrequencyModulate', 'bool', 1, 'Spinner sound pitch increases with speed.'),
  f('SpinnerNoBlink', 'bool', 0, 'Disable the highest spinner bar blinking.'),
];

export const COLOURS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    f(`Combo${i}`, 'color', ['255,192,0', '0,202,0', '18,124,255', '242,24,57'][i - 1] ?? '', `Combo colour ${i}.`),
  ),
  f('InputOverlayText', 'color', '0,0,0', 'Key overlay text colour.'),
  f('MenuGlow', 'color', '0,78,155', 'Main menu spectrum glow.'),
  f('SliderBall', 'color', '2,170,255', 'Default slider ball colour.'),
  f('SliderBorder', 'color', '255,255,255', 'Slider border colour.'),
  f('SliderTrackOverride', 'color', '', 'Slider body colour (default: combo colour).'),
  f('SongSelectActiveText', 'color', '0,0,0', 'Selected beatmap text colour.'),
  f('SongSelectInactiveText', 'color', '255,255,255', 'Unselected beatmap text colour.'),
  f('SpinnerBackground', 'color', '100,100,100', 'Spinner background tint.'),
  f('StarBreakAdditive', 'color', '255,182,193', 'Break-time star colour.'),
];

export const FONTS = [
  f('HitCirclePrefix', 'text', 'default', 'Prefix (may include a folder) for hitcircle numbers.'),
  f('HitCircleOverlap', 'int', -2, 'Overlap between hitcircle digits in px.'),
  f('ScorePrefix', 'text', 'score', 'Prefix for score digits.'),
  f('ScoreOverlap', 'int', 0, 'Overlap between score digits.'),
  f('ComboPrefix', 'text', 'score', 'Prefix for combo digits.'),
  f('ComboOverlap', 'int', 0, 'Overlap between combo digits.'),
];

export const CATCH = [
  f('HyperDash', 'color', '255,0,0', 'Hyperdash catcher tint.'),
  f('HyperDashFruit', 'color', '', 'Hyperdash fruit tint (default: HyperDash).'),
  f('HyperDashAfterImage', 'color', '', 'Hyperdash after-image tint (default: HyperDash).'),
];

/** Stage-wide mania fields. Per-column fields come from maniaColumnFields(). */
export const MANIA = [
  f('ColumnStart', 'float', 136, 'X position of the left edge of the stage.', { group: 'Layout' }),
  f('ColumnRight', 'float', 19, 'Right-hand limit for columns.', { group: 'Layout' }),
  f('HitPosition', 'int', 402, 'Y of the judgement line (0 = top, 480 = bottom).', { group: 'Layout' }),
  f('LightPosition', 'int', 413, 'Y of the column lights.', { group: 'Layout' }),
  f('ScorePosition', 'int', '', 'Y of the hit bursts (300, 200, ...).', { group: 'Layout' }),
  f('ComboPosition', 'int', '', 'Y of the combo counter.', { group: 'Layout' }),
  f('BarlineHeight', 'float', 1.2, 'Barline thickness.', { group: 'Layout' }),
  f('WidthForNoteHeightScale', 'float', '', 'Column width used to scale note height.', { group: 'Layout' }),
  f('SpecialStyle', 'enum', 0, 'Special lane placement (mainly 8K).', { options: [['0', 'None'], ['1', 'Left (outer)'], ['2', 'Right (inner)']], group: 'Behaviour' }),
  f('ComboBurstStyle', 'enum', 1, 'Where combo bursts appear.', { options: [['0', 'Left'], ['1', 'Right'], ['2', 'Both']], group: 'Behaviour' }),
  f('SplitStages', 'bool', '', 'Force splitting the stage in two.', { group: 'Behaviour' }),
  f('StageSeparation', 'float', 40, 'Distance between split stages.', { group: 'Behaviour' }),
  f('SeparateScore', 'bool', 1, 'Hit bursts only on the stage that scored.', { group: 'Behaviour' }),
  f('KeysUnderNotes', 'bool', 0, 'Draw notes on top of keys.', { group: 'Behaviour' }),
  f('UpsideDown', 'bool', 0, 'Flip the stage (notes go up).', { group: 'Behaviour' }),
  f('KeyFlipWhenUpsideDown', 'bool', 1, 'Flip key images when upside down.', { group: 'Behaviour' }),
  f('NoteFlipWhenUpsideDown', 'bool', 1, 'Flip note images when upside down.', { group: 'Behaviour' }),
  f('NoteBodyStyle', 'enum', 1, 'How hold bodies are drawn.', { options: [['0', 'Stretch'], ['1', 'Repeat from top'], ['2', 'Repeat from bottom']], group: 'Behaviour' }),
  f('JudgementLine', 'bool', '', 'Draw an extra line above the stage hint.', { group: 'Behaviour' }),
  f('LightFramePerSecond', 'int', '', 'FPS of the column light animation.', { group: 'Behaviour' }),
  f('ColourColumnLine', 'colorA', '255,255,255,255', 'Column separator lines.', { group: 'Colours' }),
  f('ColourBarline', 'colorA', '255,255,255,255', 'Barlines.', { group: 'Colours' }),
  f('ColourJudgementLine', 'color', '255,255,255', 'Judgement line.', { group: 'Colours' }),
  f('ColourKeyWarning', 'color', '0,0,0', 'Key binding hint text.', { group: 'Colours' }),
  f('ColourHold', 'colorA', '255,191,51,255', 'Combo counter while holding.', { group: 'Colours' }),
  f('ColourBreak', 'color', '255,0,0', 'Combo counter after a combo break.', { group: 'Colours' }),
  f('StageLeft', 'image', 'mania-stage-left', 'Left stage border.', { group: 'Stage images' }),
  f('StageRight', 'image', 'mania-stage-right', 'Right stage border.', { group: 'Stage images' }),
  f('StageBottom', 'image', 'mania-stage-bottom', 'Bottom stage image.', { group: 'Stage images' }),
  f('StageHint', 'image', 'mania-stage-hint', 'Judgement line image.', { group: 'Stage images' }),
  f('StageLight', 'image', 'mania-stage-light', 'Column light.', { group: 'Stage images' }),
  f('LightingN', 'image', 'lightingN', 'Note hit lighting.', { group: 'Stage images' }),
  f('LightingL', 'image', 'lightingL', 'Hold lighting.', { group: 'Stage images' }),
  f('WarningArrow', 'image', '', 'Warning arrow before the map starts.', { group: 'Stage images' }),
  f('Hit0', 'image', 'mania-hit0', 'Miss judgement.', { group: 'Judgement images' }),
  f('Hit50', 'image', 'mania-hit50', '50 judgement.', { group: 'Judgement images' }),
  f('Hit100', 'image', 'mania-hit100', '100 judgement.', { group: 'Judgement images' }),
  f('Hit200', 'image', 'mania-hit200', '200 judgement.', { group: 'Judgement images' }),
  f('Hit300', 'image', 'mania-hit300', '300 judgement.', { group: 'Judgement images' }),
  f('Hit300g', 'image', 'mania-hit300g', 'MAX judgement.', { group: 'Judgement images' }),
];

/** List-valued keys holding one value per column (or per column line). */
export const MANIA_LISTS = [
  { key: 'ColumnWidth', def: 30, count: (k) => k, desc: 'Width of each column.' },
  { key: 'ColumnSpacing', def: 0, count: (k) => k - 1, desc: 'Gap after each column.' },
  { key: 'ColumnLineWidth', def: 2, count: (k) => k + 1, desc: 'Separator line widths (keys + 1).' },
  { key: 'LightingNWidth', def: '', count: (k) => k, desc: 'Note lighting width per column.' },
  { key: 'LightingLWidth', def: '', count: (k) => k, desc: 'Hold lighting width per column.' },
];

/** Per-column keys (# = column index). */
export const MANIA_COLUMN_KEYS = [
  { key: 'KeyImage#', type: 'image', label: 'Key' },
  { key: 'KeyImage#D', type: 'image', label: 'Key pressed' },
  { key: 'NoteImage#', type: 'image', label: 'Note' },
  { key: 'NoteImage#H', type: 'image', label: 'Hold head' },
  { key: 'NoteImage#L', type: 'image', label: 'Hold body' },
  { key: 'NoteImage#T', type: 'image', label: 'Hold tail' },
  { key: 'Colour#', type: 'colorA', label: 'Lane colour', def: '0,0,0,255', oneBased: true },
  { key: 'ColourLight#', type: 'color', label: 'Light colour', def: '55,255,255', oneBased: true },
  { key: 'NoteBodyStyle#', type: 'enum', label: 'Body style', options: [['', 'Default'], ['0', 'Stretch'], ['1', 'Repeat top'], ['2', 'Repeat bottom']] },
];

/** Key name for a column, e.g. ('KeyImage#D', 2) -> 'KeyImage2D'. Colour# is 1-based. */
export function columnKey(spec, column) {
  return spec.key.replace('#', String(spec.oneBased ? column + 1 : column));
}

export const SECTIONS = [
  { id: 'General', fields: GENERAL },
  { id: 'Colours', fields: COLOURS },
  { id: 'Fonts', fields: FONTS },
  { id: 'CatchTheBeat', fields: CATCH },
];

export const VALID_KEYCOUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18];
