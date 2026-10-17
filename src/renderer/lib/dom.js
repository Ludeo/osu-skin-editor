/** Tiny hyperscript helper: h('div.card', { onclick }, child, ...) */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  // Children first so that e.g. <select value> can match an appended option.
  append(node, children);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') node.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else if (k === 'value' || k === 'checked') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

let toastRoot;
export function toast(msg, kind = 'info', ms = 3500) {
  toastRoot ??= document.body.appendChild(h('div.toasts'));
  const t = h(`div.toast.${kind}`, msg);
  toastRoot.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Show an error toast for a failed async action, return undefined. */
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (err) {
    console.error(err);
    toast(err.message ?? String(err), 'error', 7000);
    return undefined;
  }
}

/**
 * Modal dialog. `build(close)` returns the body node. Resolves with the value
 * passed to close(), or undefined when dismissed.
 */
export function modal(title, build, { wide = false, full = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div.modal-backdrop');
    const close = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    // The body may set backdrop.confirmClose to guard unsaved work.
    const dismiss = () => {
      if (!backdrop.dataset.busy && (backdrop.confirmClose?.() ?? true)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && isTopModal(backdrop)) dismiss();
    };
    const box = h(`div.modal${wide ? '.wide' : ''}${full ? '.full' : ''}`,
      h('div.modal-head', h('h2', title), h('button.icon', { title: 'Close', onclick: dismiss }, '✕')),
      h('div.modal-body', build(close, backdrop)),
    );
    backdrop.append(box);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) dismiss();
    });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    box.querySelector('input, select, textarea')?.focus();
  });
}

/** Fields where keys should type rather than trigger shortcuts. */
export const TYPING = 'input:not([type=range]):not([type=checkbox]):not([type=color]), select, textarea';

/** Dialogs can open on top of each other; keyboard shortcuts belong to the top one. */
export const isTopModal = (backdrop) => [...document.querySelectorAll('.modal-backdrop')].pop() === backdrop;

export function confirmDialog(title, message, okLabel = 'OK') {
  return modal(title, (close) =>
    h('div',
      h('p.pre', message),
      h('div.actions', h('button', { onclick: () => close(false) }, 'Cancel'), h('button.primary', { onclick: () => close(true) }, okLabel)),
    ),
  ).then(Boolean);
}

export function field(label, input, hint) {
  return h('label.field', h('span.label', label), input, hint ? h('small.hint', hint) : null);
}

/** rgb(a) string "r,g,b[,a]" <-> "#rrggbb" helpers */
export const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
