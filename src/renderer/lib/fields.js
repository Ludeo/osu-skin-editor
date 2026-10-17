// Form widgets bound to a skin.ini key.
import { h, toHex, fromHex } from './dom.js';
import { getValue, setValue, parseColour } from '../../shared/skinIni.js';
import { iniChanged, imageBases, resolveImage } from './state.js';
import { colorInput } from './colorPicker.js';

/**
 * spec: { key, type, def, desc, options, label }
 * getSection(create) returns the target section (creating it when create=true).
 */
export function iniField(spec, getSection, { compact = false } = {}) {
  const current = () => getValue(getSection(false), spec.key) ?? '';
  const write = (v) => {
    setValue(getSection(true), spec.key, v);
    iniChanged('form');
  };
  const input = widget(spec, current(), write);
  if (compact) return input;
  return h('div.ini-row', { title: spec.desc ?? '' },
    h('div.ini-key', h('span', spec.label ?? spec.key), spec.desc ? h('small', spec.desc) : null),
    h('div.ini-input', input),
  );
}

export function widget(spec, value, write) {
  const def = spec.def === undefined || spec.def === '' ? '' : String(spec.def);
  switch (spec.type) {
    case 'bool':
      return h('select', { onchange: (e) => write(e.target.value) },
        h('option', { value: '', selected: value === '' }, def === '' ? 'Default' : `Default (${def === '1' ? 'on' : 'off'})`),
        h('option', { value: '1', selected: value === '1' }, 'On'),
        h('option', { value: '0', selected: value === '0' }, 'Off'));
    case 'enum': {
      const opts = spec.options.map((o) => (Array.isArray(o) ? o : [o, o]));
      const hasEmpty = opts.some(([v]) => v === '');
      return h('select', { onchange: (e) => write(e.target.value) },
        hasEmpty ? null : h('option', { value: '', selected: value === '' }, def === '' ? 'Default' : `Default (${opts.find(([v]) => v === def)?.[1] ?? def})`),
        opts.map(([v, l]) => h('option', { value: v, selected: value === v }, l)));
    }
    case 'int':
    case 'float':
      return h('input', {
        type: 'number', value, placeholder: def, step: spec.type === 'int' ? 1 : 0.1,
        onchange: (e) => write(e.target.value),
      });
    case 'color':
    case 'colorA':
      return colourWidget(spec, value, write);
    case 'image':
      return imageWidget(spec, value, write);
    default:
      return h('input', { type: 'text', value, placeholder: def, onchange: (e) => write(e.target.value) });
  }
}

function colourWidget(spec, value, write) {
  const alpha = spec.type === 'colorA';
  const isSet = value !== '';
  const c = parseColour(isSet ? value : spec.def || '255,255,255', [255, 255, 255, 255]);
  const text = h('input.colour-text', { type: 'text', value, placeholder: spec.def || 'default', onchange: (e) => commit(e.target.value) });
  const picker = colorInput({ value: toHex(c), oninput: () => commit(fromPickers()) });
  const range = alpha ? h('input.alpha', { type: 'range', min: 0, max: 255, value: c[3], title: 'Opacity', oninput: () => commit(fromPickers()) }) : null;
  const swatch = h('span.swatch', { style: `--c: rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})` });
  if (!isSet) swatch.classList.add('unset');

  function fromPickers() {
    const rgb = fromHex(picker.value);
    return (alpha ? [...rgb, Number(range.value)] : rgb).join(',');
  }
  function commit(v) {
    text.value = v;
    const p = parseColour(v || spec.def || '255,255,255');
    swatch.style.setProperty('--c', `rgba(${p[0]},${p[1]},${p[2]},${p[3] / 255})`);
    swatch.classList.toggle('unset', !v);
    write(v);
  }
  return h('div.colour', swatch, picker, range, text,
    h('button.icon.small', { title: 'Reset to default', onclick: () => { commit(''); } }, '↺'));
}

let datalistSeq = 0;
function imageWidget(spec, value, write) {
  const id = `imgs-${++datalistSeq}`;
  const thumb = h('img.mini-thumb', { alt: '' });
  const setThumb = (v) => {
    const info = resolveImage(v || spec.def);
    thumb.src = info?.url ?? '';
    thumb.hidden = !info;
  };
  setThumb(value);
  const input = h('input', {
    type: 'text', value, list: id, placeholder: spec.def || '(none)',
    onchange: (e) => {
      const v = e.target.value.trim().replace(/\//g, '\\').replace(/\.png$/i, '');
      e.target.value = v;
      setThumb(v);
      write(v);
    },
  });
  return h('div.image-field', h('div.checker.mini', thumb), input,
    h('datalist', { id }, imageBases().map((b) => h('option', { value: b.replace(/\//g, '\\') }))));
}
