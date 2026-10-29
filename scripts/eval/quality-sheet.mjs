#!/usr/bin/env node
// Side-by-side sheets: each row is a reference example (left) and Makeborne's output (right), at the same height, with
// a caption under each. Reads images only (the reference folder is never written); writes one JPEG per sheet.
//
//   node scripts/eval/quality-sheet.mjs <spec.json> <out.jpg>
//   spec: { "title": "...", "rows": [{ "label": "...", "reference": "<path>", "ours": "<path or [paths]>", "note": "..." }] }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const [specFile, outFile] = process.argv.slice(2);
if (!specFile || !outFile) throw new Error('Usage: quality-sheet.mjs <spec.json> <out.jpg>');
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const ROW_H = 600, GAP = 24, CAPTION = 64, WIDTH = 2 * 1100 + 3 * GAP;
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const caption = (text, width, size = 22, weight = 600) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CAPTION}"><text x="0" y="${size + 8}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="#222">${esc(text).slice(0, 160)}</text></svg>`);
/** One cell: an image (or several side by side) fitted into width x ROW_H. */
async function cell(sources, width) {
  const list = Array.isArray(sources) ? sources : [sources];
  const each = Math.floor((width - (list.length - 1) * 8) / list.length);
  const parts = await Promise.all(list.map(async source => sharp(source, { limitInputPixels: 60_000_000 }).resize({ width: each, height: ROW_H, fit: 'inside', background: '#ffffff' }).toBuffer({ resolveWithObject: true })));
  const composite = []; let x = 0;
  for (const { data, info } of parts) { composite.push({ input: data, left: x, top: Math.floor((ROW_H - info.height) / 2) }); x += info.width + 8; }
  return sharp({ create: { width, height: ROW_H, channels: 3, background: '#f2f1ee' } }).composite(composite).png().toBuffer();
}
const rows = [];
for (const row of spec.rows) {
  const half = (WIDTH - 3 * GAP) / 2;
  rows.push({ row, left: row.reference ? await cell(row.reference, half) : null, right: await cell(row.ours, half) });
}
const header = 90, height = header + rows.length * (ROW_H + CAPTION + 2 * GAP) + GAP;
const composite = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${header}"><text x="${GAP}" y="52" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700" fill="#111">${esc(spec.title)}</text><text x="${GAP}" y="82" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#555">Left: reference example (Z:/makeborne-films/v14/gen) · Right: Makeborne output</text></svg>`), left: 0, top: 0 }];
let y = header;
for (const { row, left, right } of rows) {
  const half = (WIDTH - 3 * GAP) / 2;
  if (left) composite.push({ input: left, left: GAP, top: y + GAP });
  composite.push({ input: right, left: 2 * GAP + half, top: y + GAP });
  composite.push({ input: caption(`${row.label} — reference${row.reference ? ` (${path.basename(Array.isArray(row.reference) ? row.reference[0] : row.reference)})` : ': none'}`, half), left: GAP, top: y + GAP + ROW_H + 6 });
  composite.push({ input: caption(`Makeborne${row.note ? ` — ${row.note}` : ''}`, half, 20, 400), left: 2 * GAP + half, top: y + GAP + ROW_H + 6 });
  y += ROW_H + CAPTION + 2 * GAP;
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
await sharp({ create: { width: WIDTH, height, channels: 3, background: '#ffffff' } }).composite(composite).jpeg({ quality: 86 }).toFile(outFile);
console.log(`${outFile}: ${rows.length} rows, ${WIDTH} x ${height}`);
