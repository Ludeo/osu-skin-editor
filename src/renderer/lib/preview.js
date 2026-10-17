import { h } from './dom.js';

// One shared animation loop for every animated preview on screen. Previews
// that are removed from the DOM drop out automatically.
const players = new Set();
let raf = 0;

// Each frame is fetched once, a few at a time, and kept as an in-memory blob
// URL; only loaded frames are shown. Long animations (some skins ship 500+
// frames) would otherwise hit the main process on every displayed frame.
const LOADS_PER_PLAYER = 3;

const visibility = new IntersectionObserver((entries) => {
  for (const e of entries) e.target._player && (e.target._player.visible = e.isIntersecting);
});

function loadMore(p) {
  while (p.inFlight < LOADS_PER_PLAYER && p.nextLoad < p.frames.length) {
    const i = p.nextLoad++;
    p.inFlight++;
    fetch(p.frames[i])
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob && !p.disposed) p.loaded[i] = URL.createObjectURL(blob);
      })
      .catch(() => {})
      .finally(() => {
        p.inFlight--;
        if (!p.disposed && p.visible) loadMore(p);
      });
  }
}

function dispose(p) {
  p.disposed = true;
  players.delete(p);
  visibility.unobserve(p.img);
  p.loaded.forEach((u) => u && URL.revokeObjectURL(u));
}

function tick(now) {
  for (const p of players) {
    if (!p.img.isConnected) {
      dispose(p);
      continue;
    }
    if (!p.visible) continue;
    if (p.nextLoad < p.frames.length) loadMore(p);
    const idx = Math.floor((now / 1000) * p.fps) % p.frames.length;
    if (idx !== p.idx && p.loaded[idx]) {
      p.idx = idx;
      p.img.src = p.loaded[idx];
    }
  }
  raf = players.size ? requestAnimationFrame(tick) : 0;
}

/**
 * Image preview of a resolved element (see resolveImage). Animated elements
 * loop at `fps`; osu!'s -1 framerate means "all frames in one second".
 */
export function previewImg(info, { fps = -1, className = '' } = {}) {
  const img = h(`img.preview${className ? '.' + className : ''}`, { src: info?.url ?? '', draggable: false, alt: '', decoding: 'async' });
  if (!info) img.classList.add('empty');
  if (info?.frames?.length > 1) {
    const frames = info.frames.map((f) => f.url);
    const p = { img, frames, fps: fps > 0 ? fps : frames.length, idx: 0, loaded: [], nextLoad: 0, inFlight: 0, visible: true };
    img._player = p;
    visibility.observe(img);
    players.add(p);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  return img;
}

/** Load an image and resolve with its natural size (0x0 on error). */
export function imageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, img });
    img.onerror = () => resolve({ w: 0, h: 0, img: null });
    img.src = url;
  });
}
