import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseIni, serializeIni, getManiaSection, getValue, setValue, addManiaSection, findSection, parseList,
} from '../src/shared/skinIni.js';
import { matchElementFiles, defaultColumnStyle } from '../src/shared/elements.js';
import { copyElements, copyManiaSection, readIni, listFiles, importOsk, exportOsk, safeJoin } from '../src/main/skinFs.js';
import { locateFfmpeg, convertToSkin } from '../src/main/media.js';

const SAMPLE = '﻿[General]\r\nName: Test\r\n// a comment\r\nUnknownKey: 5\r\n\r\n[Mania]\r\nKeys: 4\r\nColumnWidth: 60,60,60,60\r\nNoteImage0: Orbs\\note1\r\n\r\n[Mania]\r\nKeys: 7\r\nHitPosition: 420\r\n';

test('ini round-trips comments, unknown keys and duplicate sections', () => {
  const doc = parseIni(SAMPLE);
  const out = serializeIni(doc);
  assert.match(out, /\/\/ a comment/);
  assert.match(out, /UnknownKey: 5/);
  assert.equal(parseIni(out).sections.length, 3);
  assert.equal(getValue(getManiaSection(doc, 7), 'HitPosition'), '420');
  assert.equal(getValue(getManiaSection(doc, 4), 'noteimage0'), 'Orbs\\note1');
});

test('setValue updates, appends and removes', () => {
  const doc = parseIni(SAMPLE);
  const gen = findSection(doc, 'General');
  setValue(gen, 'name', 'Renamed');
  setValue(gen, 'Author', 'me');
  setValue(gen, 'UnknownKey', '');
  const out = serializeIni(doc);
  assert.match(out, /Name: Renamed/);
  assert.match(out, /Author: me/);
  assert.doesNotMatch(out, /UnknownKey/);
});

test('addManiaSection keeps keycounts ordered', () => {
  const doc = parseIni(SAMPLE);
  addManiaSection(doc, 5);
  const keys = doc.sections.filter((s) => s.name === 'Mania').map((s) => getValue(s, 'Keys'));
  assert.deepEqual(keys, ['4', '5', '7']);
});

test('parseList broadcasts single values', () => {
  assert.deepEqual(parseList('2', 3, 0), [2, 2, 2]);
  assert.deepEqual(parseList('1,2', 3, 9), [1, 2, 9]);
  assert.deepEqual(parseList(undefined, 2, 30), [30, 30]);
});

test('matchElementFiles finds static, HD and contiguous frames case-insensitively', () => {
  const files = ['Menu-Back-0.png', 'menu-back-1.png', 'menu-back-1@2x.png', 'menu-back-3.png', 'menu-back.png', 'menu-background.png'];
  const m = matchElementFiles(files, 'menu-back', { anim: '-' });
  assert.equal(m.static.sd, 'menu-back.png');
  assert.equal(m.frames.length, 2); // frame 3 is not contiguous
  assert.equal(m.frames[1].hd, 'menu-back-1@2x.png');
  assert.ok(!m.all.includes('menu-background.png'));
  assert.equal(matchElementFiles(['mania-hit300g-0.png'], 'mania-hit300', { anim: '-' }).all.length, 0);
});

test('default mania column styles', () => {
  assert.deepEqual([0, 1, 2, 3].map((c) => defaultColumnStyle(4, c)), ['1', '2', '2', '1']);
  assert.deepEqual([...Array(7).keys()].map((c) => defaultColumnStyle(7, c)), ['1', '2', '1', 'S', '1', '2', '1']);
});

test('safeJoin refuses paths escaping the skin', () => {
  assert.throws(() => safeJoin('/tmp/skin', '../evil.png'));
  assert.throws(() => safeJoin('/tmp/skin', '..\\evil.png'));
  assert.equal(safeJoin('/tmp/skin', 'Orbs\\a.png'), path.resolve('/tmp/skin/Orbs/a.png'));
});

async function makeSkins() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skintest-'));
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  await fs.mkdir(path.join(src, 'Orbs'), { recursive: true });
  await fs.mkdir(dst);
  await fs.writeFile(path.join(src, 'Skin.ini'), SAMPLE);
  await fs.writeFile(path.join(dst, 'skin.ini'), '[General]\nName: Dst\n\n[Mania]\nKeys: 4\nHitPosition: 1\n');
  for (const f of ['Orbs/note1.png', 'Orbs/note1@2x.png', 'menu-back-0.png', 'menu-back-1.png']) await fs.writeFile(path.join(src, f), 'x');
  await fs.writeFile(path.join(dst, 'menu-back-0.png'), 'old');
  for (let i = 0; i < 5; i++) await fs.writeFile(path.join(dst, `menu-back-${i}.png`), 'old');
  return { root, src, dst };
}

test('copyElements replaces all old frames', async () => {
  const { root, src, dst } = await makeSkins();
  await copyElements(src, dst, [{ base: 'menu-back', anim: '-' }]);
  const files = (await listFiles(dst)).filter((f) => f.startsWith('menu-back'));
  assert.deepEqual(files.sort(), ['menu-back-0.png', 'menu-back-1.png']);
  await fs.rm(root, { recursive: true });
});

test('copyManiaSection copies config and referenced images', async () => {
  const { root, src, dst } = await makeSkins();
  const res = await copyManiaSection(src, dst, 4);
  assert.equal(res.replaced, true);
  assert.deepEqual(res.files.sort(), ['Orbs/note1.png', 'Orbs/note1@2x.png']);
  const doc = parseIni(await readIni(dst));
  assert.equal(getValue(getManiaSection(doc, 4), 'ColumnWidth'), '60,60,60,60');
  assert.equal(getValue(getManiaSection(doc, 4), 'HitPosition'), undefined);
  assert.equal(getValue(findSection(doc, 'General'), 'Name'), 'Dst');
  await fs.rm(root, { recursive: true });
});

test('osk export/import round trip', async () => {
  const { root, src } = await makeSkins();
  const osk = path.join(root, 'out.osk');
  await exportOsk(src, osk);
  const dir = await importOsk(osk, root);
  assert.ok((await listFiles(dir)).includes('Orbs/note1@2x.png'));
  await fs.rm(root, { recursive: true });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('convert a GIF into HD + SD animation frames', { skip: !hasFfmpeg && 'ffmpeg missing' }, async () => {
  await locateFfmpeg();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skinconv-'));
  const gif = path.join(root, 'in.gif');
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=200x100:rate=10:duration=1', gif]);
  const res = await convertToSkin(gif, root, { base: 'menu-back', sep: '-', animated: true, fps: 10, maxFrames: 5, width: 100, height: 50, hd: true, sd: true });
  assert.equal(res.frames, 5);
  const files = (await listFiles(root)).filter((f) => f.startsWith('menu-back')).sort();
  assert.equal(files.length, 10);
  assert.ok(files.includes('menu-back-4@2x.png') && files.includes('menu-back-0.png'));

  const still = await convertToSkin(gif, root, { base: 'mania-key1', animated: false, hd: false });
  assert.deepEqual(still.written, ['mania-key1.png']);
  await fs.rm(root, { recursive: true });
});
