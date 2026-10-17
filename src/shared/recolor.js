// Recolouring of skin images (mania notes). Pure pixel maths, shared by the
// renderer and the tests.
//   mode       'shift'    rotate every hue by `hue` degrees
//              'colorize' give everything the hue/saturation of `colour`,
//                         keeping each pixel's lightness (white stays white)
//   saturation multiplier, 1 = unchanged
//   brightness -1 … 1, 0 = unchanged
//   strength   0 … 1, how much of the result replaces the original

export const DEFAULT_RECOLOR = { mode: 'colorize', hue: 0, colour: [80, 160, 255], saturation: 1, brightness: 0, strength: 1 };

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Recolour RGBA pixel data in place. Alpha is never touched. */
export function recolorPixels(data, opts) {
  const o = { ...DEFAULT_RECOLOR, ...opts };
  const [th, ts] = rgbToHsl(...o.colour);
  const k = clamp01(o.strength);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let [h, s, l] = rgbToHsl(r, g, b);
    if (o.mode === 'colorize') {
      h = th;
      s = ts;
    } else {
      h += o.hue;
    }
    s = clamp01(s * o.saturation);
    l = o.brightness >= 0 ? l + (1 - l) * o.brightness : l * (1 + o.brightness);
    const [nr, ng, nb] = hslToRgb(h, s, clamp01(l));
    data[i] = r + (nr - r) * k;
    data[i + 1] = g + (ng - g) * k;
    data[i + 2] = b + (nb - b) * k;
  }
  return data;
}

/**
 * Where each file of an element goes when it is saved as `newBase`:
 * "mania-note1-0@2x.png" -> "Notes/blue-0@2x.png". Only PNGs are recoloured.
 */
export function renameFiles(files, base, newBase) {
  const n = base.replace(/\\/g, '/').length;
  return files.filter((f) => /\.png$/i.test(f)).map((f) => ({ src: f, dest: newBase + f.slice(n) }));
}

/** Problem with a new image name, or null if it's usable. */
export function checkName(name) {
  const v = name.trim().replace(/\\/g, '/');
  if (!v) return 'Enter a name';
  if (/(^|\/)\.\.?(\/|$)/.test(v) || v.startsWith('/') || /^[a-z]:/i.test(v)) return 'Use a name inside the skin folder';
  if (/[<>:"|?*]/.test(v)) return 'The name contains characters that are not allowed in file names';
  if (/-\d+$/.test(v) || /@2x$/i.test(v)) return 'The name must not end in -<number> or @2x (osu! reads those as frames / HD)';
  return null;
}
