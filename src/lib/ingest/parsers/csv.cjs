/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* CSV/TSV: encoding from the byte-order mark, else strict UTF-8, else
 * Windows-1252 with a warning. The delimiter is chosen by consistency over the
 * first lines. Cells that look like formulas (=, +, -, @) are kept as text and
 * flagged; nothing is evaluated. */
const { IngestError, cellRef, FORMULA_LIKE } = require('./common.cjs');
const { Output } = require('./output.cjs');
const { normaliseCell } = require('./cells.cjs');

function decodeText(bytes, out) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)), encoding: 'utf-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2)), encoding: 'utf-16be' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; }
  catch {
    out.warn('This file isn’t UTF-8, so it was read as Western European (Windows-1252). Check accented letters (č, ć, ž, š, đ) and save it as UTF-8 if they look wrong.');
    return { text: windows1252(bytes), encoding: 'windows-1252' };
  }
}
/* 0x80–0x9F of Windows-1252 (Š, Ž, €, quotes…); some runtimes decode the label as plain Latin-1. */
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function windows1252(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    const chunk = bytes.subarray(index, index + 8192);
    text += String.fromCharCode(...Array.from(chunk, byte => byte >= 0x80 && byte <= 0x9f ? CP1252.charCodeAt(byte - 0x80) : byte));
  }
  return text;
}

/** RFC 4180 records; stops storing (but keeps counting) past the limits. */
function* records(text, delimiter) {
  let row = [], field = '', quoted = false, index = 0;
  const length = text.length;
  while (index < length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { field += '"'; index += 2; continue; } quoted = false; index++; continue; }
      field += char; index++; continue;
    }
    if (char === '"' && field === '') { quoted = true; index++; continue; }
    if (char === delimiter) { row.push(field); field = ''; index++; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      index++;
      row.push(field); field = '';
      yield row; row = [];
      continue;
    }
    field += char; index++;
  }
  if (quoted) yield { unterminated: true, row: [...row, field] };
  else if (field !== '' || row.length) { row.push(field); yield row; }
}

function sniffDelimiter(text, preferred) {
  const sample = text.slice(0, 64_000);
  let best = { delimiter: preferred || ',', score: -1 };
  for (const delimiter of [preferred, ',', ';', '\t', '|'].filter(Boolean)) {
    const widths = [];
    for (const row of records(sample, delimiter)) { if (Array.isArray(row)) widths.push(row.length); if (widths.length >= 30) break; }
    if (widths.length > 1 && sample.length >= 64_000) widths.pop(); // last sampled line may be cut
    const counts = new Map();
    for (const width of widths) counts.set(width, (counts.get(width) || 0) + 1);
    const [width, frequency] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [1, 0];
    const score = width > 1 ? frequency * 1000 + width : 0;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

function parseCsv(bytes, limits, name) {
  const out = new Output(limits);
  const { text, encoding } = decodeText(bytes, out);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new IngestError('binary', 'This file contains binary data, so it isn’t a readable CSV. Export it again as CSV (UTF-8).');
  const delimiter = sniffDelimiter(text, /\.tsv$/i.test(name) ? '\t' : '');
  const sheet = { name: name.replace(/\.[a-z0-9]+$/i, '') || 'CSV', index: 1, hidden: false, rows: 0, columns: 0, cells: [], cellsTotal: 0, truncated: false };
  let rowIndex = 0, formulaLike = 0, totalRows = 0, budget = limits.cells, longFields = 0;
  for (const record of records(text, delimiter)) {
    if (!Array.isArray(record)) { out.missed('The file ends inside a quoted value, so its last row may be incomplete.'); }
    const row = Array.isArray(record) ? record : record.row;
    totalRows++;
    const storeRow = rowIndex < limits.rows;
    // Blank lines stay rows, so every reference matches the row a spreadsheet app shows.
    if (row.length === 1 && row[0] === '') { if (storeRow) { rowIndex++; sheet.rows = rowIndex; } continue; }
    for (let col = 0; col < row.length; col++) {
      const raw = row[col];
      if (raw === '') continue;
      sheet.cellsTotal++;
      if (!storeRow || col >= limits.columns || budget <= 0) { sheet.truncated = true; continue; }
      if (raw.length > limits.csvFieldChars) { longFields++; sheet.truncated = true; continue; }
      budget--;
      const cell = { ref: cellRef(rowIndex, col), row: rowIndex, col, kind: 'string', value: raw, text: raw };
      if (FORMULA_LIKE.test(raw) && !/^[-+]?\s*[0-9.,\s]+%?$/.test(raw)) { cell.formulaLike = true; formulaLike++; }
      else {
        const normal = normaliseCell(raw);
        if (normal.number !== undefined) { cell.kind = normal.currency ? 'currency' : normal.unit === '%' ? 'percent' : 'number'; cell.number = normal.number; if (normal.currency) cell.currency = normal.currency; if (normal.unit) cell.unit = normal.unit; }
        else if (normal.date) { cell.kind = 'date'; cell.date = normal.date; }
      }
      sheet.cells.push(cell);
      sheet.columns = Math.max(sheet.columns, col + 1);
    }
    if (storeRow) { rowIndex++; sheet.rows = rowIndex; }
  }
  out.sheets.push(sheet);
  if (!sheet.cellsTotal) throw new IngestError('empty', 'This CSV file has no values.');
  if (sheet.truncated) out.missed(`${sheet.cells.length.toLocaleString('en-US')} of ${sheet.cellsTotal.toLocaleString('en-US')} values read (limits: ${limits.rows.toLocaleString('en-US')} rows, ${limits.columns.toLocaleString('en-US')} columns, ${limits.cells.toLocaleString('en-US')} values${longFields ? `, ${limits.csvFieldChars.toLocaleString('en-US')} characters per value` : ''}). Split the file to include the rest.`);
  if (formulaLike) out.warn(`${formulaLike.toLocaleString('en-US')} value${formulaLike === 1 ? '' : 's'} start${formulaLike === 1 ? 's' : ''} like a spreadsheet formula (=, +, -, @). ${formulaLike === 1 ? 'It is' : 'They are'} kept as plain text and never calculated.`);
  out.details.csv = { encoding, delimiter: delimiter === '\t' ? 'tab' : delimiter, rows: totalRows };
  out.coverage = { unit: 'rows', total: totalRows, read: Math.min(totalRows, sheet.rows), cells: { total: sheet.cellsTotal, read: sheet.cells.length }, visual: 'none', notes: [] };
  return out;
}

module.exports = { parseCsv, sniffDelimiter };
