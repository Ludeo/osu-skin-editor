import { h, toHex, fromHex } from './dom.js';

// In-app replacement for <input type="color">. On Linux the native picker goes
// through the desktop portal, which on some desktops (KDE Wayland) closes again
// right away. Behaves like the input: has .value ('#rrggbb') and fires `input`
// while dragging and `change` when the popup closes.

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, max ? d / max : 0, max];
}

function hsvToRgb(hue, s, v) {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}

function normHex(v) {
  const m = HEX.exec(String(v).trim());
  if (!m) return null;
  const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${x.toLowerCase()}`;
}

export function colorInput({ value = '#ffffff', oninput, onchange, title } = {}) {
  let hex = normHex(value) ?? '#ffffff';
  const btn = h('button.color-input', { type: 'button', title: title ?? 'Pick a colour' });
  const paintBtn = () => btn.style.setProperty('--c', hex);
  Object.defineProperty(btn, 'value', {
    get: () => hex,
    set: (v) => { hex = normHex(v) ?? hex; paintBtn(); },
  });
  paintBtn();
  if (oninput) btn.addEventListener('input', oninput);
  if (onchange) btn.addEventListener('change', onchange);
  btn.addEventListener('click', () => open(btn));
  return btn;
}

let current = null;

function open(btn) {
  current?.close();
  const start = btn.value;
  let [hue, sat, val] = rgbToHsv(fromHex(start));

  const sv = h('div.cp-sv', h('div.cp-knob'));
  const hueBar = h('div.cp-hue', h('div.cp-knob'));
  const text = h('input.cp-hex', { type: 'text', value: start, spellcheck: false,
    onchange: (e) => {
      const v = normHex(e.target.value);
      if (!v) { e.target.value = btn.value; return; }
      [hue, sat, val] = rgbToHsv(fromHex(v));
      set(v);
    },
  });
  const preview = h('span.cp-preview');
  const pop = h('div.cp-pop', sv, hueBar, h('div.cp-row', preview, text));

  function show() {
    sv.style.setProperty('--hue', `hsl(${hue} 100% 50%)`);
    sv.firstChild.style.left = `${sat * 100}%`;
    sv.firstChild.style.top = `${(1 - val) * 100}%`;
    hueBar.firstChild.style.left = `${(hue / 360) * 100}%`;
    preview.style.setProperty('--c', btn.value);
    if (document.activeElement !== text) text.value = btn.value;
  }
  function set(v) {
    btn.value = v;
    show();
    btn.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const fromHsv = () => set(toHex(hsvToRgb(hue, sat, val)));

  const drag = (el, move) => el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const at = (ev) => {
      const r = el.getBoundingClientRect();
      move(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
      fromHsv();
    };
    at(e);
    el.onpointermove = at;
    el.onpointerup = () => { el.onpointermove = el.onpointerup = null; };
  });
  drag(sv, (x, y) => { sat = x; val = 1 - y; });
  drag(hueBar, (x) => { hue = x * 359.999; });

  // Clicks outside close the popup; Escape restores the old colour. Both are
  // caught before the dialog underneath sees them: a click on the button must
  // not reopen it and one on the backdrop must not close the dialog too.
  const outside = (e) => {
    if (pop.contains(e.target)) return;
    if (btn.contains(e.target) || e.target.classList?.contains('modal-backdrop')) {
      const stop = (ev) => ev.stopPropagation();
      document.addEventListener('mousedown', stop, { capture: true, once: true });
      document.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => {
        document.removeEventListener('mousedown', stop, true);
        document.removeEventListener('click', stop, true);
      }, 500);
    }
    close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target !== text)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === 'Escape' && btn.value !== start) set(start);
      close();
    }
  };
  function close() {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', onKey, true);
    current = null;
    if (btn.value !== start) btn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  current = { close };

  document.body.append(pop);
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - pw - 8, r.left));
  const top = r.bottom + 6 + ph > innerHeight - 8 ? Math.max(8, r.top - ph - 6) : r.bottom + 6;
  Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  show();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', onKey, true);
}
