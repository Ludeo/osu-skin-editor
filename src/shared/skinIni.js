// Lossless-ish skin.ini parser/serializer.
// Keeps comments, blank lines and unknown keys so editing a skin never
// destroys information the editor doesn't understand.
//
// Doc shape:
//   { preamble: Line[], sections: Section[] }
//   Section = { name: string, lines: Line[] }
//   Line    = { kind: 'kv', key, value } | { kind: 'raw', text }

export function parseIni(text) {
  const doc = { preamble: [], sections: [] };
  let current = null;
  const src = String(text ?? '').replace(/^﻿/, '');

  for (const rawLine of src.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const header = /^\[([^\]]+)\]\s*$/.exec(trimmed);
    if (header) {
      current = { name: header[1].trim(), lines: [] };
      doc.sections.push(current);
      continue;
    }
    const target = current ? current.lines : doc.preamble;
    if (trimmed === '' || trimmed.startsWith('//')) {
      target.push({ kind: 'raw', text: rawLine });
      continue;
    }
    const idx = trimmed.indexOf(':');
    if (idx <= 0) {
      target.push({ kind: 'raw', text: rawLine });
      continue;
    }
    target.push({
      kind: 'kv',
      key: trimmed.slice(0, idx).trim(),
      value: trimmed.slice(idx + 1).trim(),
    });
  }
  // Drop trailing blank lines of the file; serializer re-adds spacing.
  const last = doc.sections.at(-1)?.lines ?? doc.preamble;
  while (last.length && last.at(-1).kind === 'raw' && last.at(-1).text.trim() === '') last.pop();
  return doc;
}

export function serializeIni(doc) {
  const out = [];
  const pushLines = (lines) => {
    for (const l of lines) out.push(l.kind === 'kv' ? `${l.key}: ${l.value}` : l.text);
  };
  pushLines(doc.preamble);
  doc.sections.forEach((s) => {
    if (out.length && out.at(-1).trim() !== '') out.push('');
    out.push(`[${s.name}]`);
    pushLines(s.lines);
  });
  return out.join('\r\n') + '\r\n';
}

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

export function findSection(doc, name) {
  return doc.sections.find((s) => eq(s.name, name)) ?? null;
}

export function ensureSection(doc, name) {
  let s = findSection(doc, name);
  if (!s) {
    s = { name, lines: [] };
    // Keep [Mania] sections at the end, insert regular sections before them.
    const firstMania = doc.sections.findIndex((x) => eq(x.name, 'Mania'));
    if (!eq(name, 'Mania') && firstMania >= 0) doc.sections.splice(firstMania, 0, s);
    else doc.sections.push(s);
  }
  return s;
}

export function getValue(section, key) {
  if (!section) return undefined;
  for (let i = section.lines.length - 1; i >= 0; i--) {
    const l = section.lines[i];
    if (l.kind === 'kv' && eq(l.key, key)) return l.value;
  }
  return undefined;
}

/** Set a key. Empty/null/undefined removes the key. */
export function setValue(section, key, value) {
  const remove = value === undefined || value === null || String(value).trim() === '';
  const idxs = [];
  section.lines.forEach((l, i) => {
    if (l.kind === 'kv' && eq(l.key, key)) idxs.push(i);
  });
  if (remove) {
    for (const i of idxs.reverse()) section.lines.splice(i, 1);
    return;
  }
  if (idxs.length) {
    // Update the last occurrence (the one osu! uses), remove duplicates.
    section.lines[idxs.at(-1)].value = String(value);
    for (const i of idxs.slice(0, -1).reverse()) section.lines.splice(i, 1);
    return;
  }
  let insertAt = section.lines.length;
  while (insertAt > 0 && section.lines[insertAt - 1].kind === 'raw' && section.lines[insertAt - 1].text.trim() === '') insertAt--;
  section.lines.splice(insertAt, 0, { kind: 'kv', key, value: String(value) });
}

export function sectionEntries(section) {
  const map = new Map();
  for (const l of section?.lines ?? []) if (l.kind === 'kv') map.set(l.key, l.value);
  return map;
}

export function getManiaSections(doc) {
  return doc.sections.filter((s) => eq(s.name, 'Mania'));
}

export function getManiaSection(doc, keys) {
  return getManiaSections(doc).find((s) => Number(getValue(s, 'Keys')) === Number(keys)) ?? null;
}

export function addManiaSection(doc, keys, lines = []) {
  const s = { name: 'Mania', lines: [{ kind: 'kv', key: 'Keys', value: String(keys) }, ...lines] };
  // Keep mania sections sorted by key count.
  const all = getManiaSections(doc);
  const after = all.filter((m) => Number(getValue(m, 'Keys')) < keys).at(-1);
  const before = all.find((m) => Number(getValue(m, 'Keys')) > keys);
  if (before) doc.sections.splice(doc.sections.indexOf(before), 0, s);
  else if (after) doc.sections.splice(doc.sections.indexOf(after) + 1, 0, s);
  else doc.sections.push(s);
  return s;
}

export function removeSection(doc, section) {
  const i = doc.sections.indexOf(section);
  if (i >= 0) doc.sections.splice(i, 1);
}

export function cloneSection(section) {
  return { name: section.name, lines: section.lines.map((l) => ({ ...l })) };
}

/** "1,2,3" -> [1,2,3]; single values are broadcast to `count`. */
export function parseList(value, count, fallback) {
  if (value === undefined || value === '') return Array(count).fill(fallback);
  const parts = String(value).split(',').map((v) => Number(v.trim()));
  if (parts.length === 1) return Array(count).fill(Number.isFinite(parts[0]) ? parts[0] : fallback);
  return Array.from({ length: count }, (_, i) => (Number.isFinite(parts[i]) ? parts[i] : fallback));
}

export function formatList(values) {
  return values.map((v) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100)).join(',');
}

export function parseColour(value, fallback = [255, 255, 255, 255]) {
  if (!value) return [...fallback];
  const p = String(value).split(',').map((x) => parseInt(x.trim(), 10));
  if (p.length < 3 || p.slice(0, 3).some((x) => !Number.isFinite(x))) return [...fallback];
  return [p[0], p[1], p[2], Number.isFinite(p[3]) ? p[3] : 255];
}

export function newSkinIni({ name, author }) {
  return parseIni(
    [
      '[General]',
      `Name: ${name}`,
      `Author: ${author ?? ''}`,
      'Version: 2.5',
      'AnimationFramerate: -1',
      '',
      '[Colours]',
      '',
      '[Fonts]',
      '',
      '[Mania]',
      'Keys: 4',
      'ColumnStart: 136',
      'ColumnWidth: 60,60,60,60',
      'ColumnLineWidth: 0,0,0,0,0',
      'HitPosition: 402',
      'ScorePosition: 300',
      'ComboPosition: 150',
      'JudgementLine: 0',
      'KeysUnderNotes: 0',
      '',
      '[Mania]',
      'Keys: 7',
      'ColumnStart: 136',
      'ColumnWidth: 50,50,50,50,50,50,50',
      'ColumnLineWidth: 0,0,0,0,0,0,0,0',
      'HitPosition: 402',
      'ScorePosition: 300',
      'ComboPosition: 150',
      'JudgementLine: 0',
      'KeysUnderNotes: 0',
    ].join('\n'),
  );
}
