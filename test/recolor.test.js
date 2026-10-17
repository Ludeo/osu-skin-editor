import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recolorPixels, rgbToHsl, hslToRgb, renameFiles, checkName } from '../src/shared/recolor.js';
import { writeImages, listFiles } from '../src/main/skinFs.js';

const px = (...rgba) => new Uint8ClampedArray(rgba);

test('hsl round-trips', () => {
  for (const c of [[255, 0, 0], [12, 200, 99], [128, 128, 128], [255, 255, 255]]) {
    assert.deepEqual(hslToRgb(...rgbToHsl(...c)).map(Math.round), c);
  }
});

test('colorize keeps lightness and alpha, white stays white', () => {
  const d = recolorPixels(px(255, 0, 0, 200, 255, 255, 255, 255, 0, 0, 0, 0), { mode: 'colorize', colour: [0, 0, 255] });
  assert.deepEqual([...d.slice(0, 4)], [0, 0, 255, 200]);
  assert.deepEqual([...d.slice(4, 8)], [255, 255, 255, 255]);
  assert.deepEqual([...d.slice(8)], [0, 0, 0, 0]);
});

test('hue shift, strength and brightness', () => {
  assert.deepEqual([...recolorPixels(px(255, 0, 0, 255), { mode: 'shift', hue: 120 })], [0, 255, 0, 255]);
  assert.deepEqual([...recolorPixels(px(255, 0, 0, 255), { mode: 'shift', hue: 120, strength: 0 })], [255, 0, 0, 255]);
  assert.deepEqual([...recolorPixels(px(100, 100, 100, 255), { mode: 'shift', brightness: 1 })], [255, 255, 255, 255]);
});

test('renameFiles maps frames and HD versions, skips non-PNGs', () => {
  const files = ['Mania-Note1@2x.png', 'mania-note1-0.png', 'mania-note1-0@2x.png', 'mania-note1.jpg'];
  assert.deepEqual(renameFiles(files, 'mania-note1', 'Notes/blue').map((f) => f.dest), ['Notes/blue@2x.png', 'Notes/blue-0.png', 'Notes/blue-0@2x.png']);
});

test('checkName rejects unsafe and ambiguous names', () => {
  assert.equal(checkName('Notes/blue'), null);
  for (const bad of ['', '../x', '/abs', 'note-3', 'note@2x', 'a:b']) assert.ok(checkName(bad), bad);
});

test('writeImages replaces old frames and stays inside the skin', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ose-recolor-'));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await fs.writeFile(path.join(dir, 'blue-5.png'), 'old');
  await writeImages(dir, [{ rel: 'blue.png', data: png }], { replace: ['blue'] });
  assert.deepEqual(await listFiles(dir), ['blue.png']);
  await assert.rejects(writeImages(dir, [{ rel: '../x.png', data: png }]));
  await assert.rejects(writeImages(dir, [{ rel: 'x.png', data: new Uint8Array([1, 2]) }]));
  await fs.rm(dir, { recursive: true, force: true });
});
