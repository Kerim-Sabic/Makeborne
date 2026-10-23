/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Format registry and extraction entry point: detect the real format from the
 * bytes, check it against the declared type and file name, run the one parser
 * for it, and return a complete, plain extraction object. Never throws for a
 * bad file: every outcome is a status with a specific message. */
const { EXTRACTION_VERSION, IngestError, mergeLimits } = require('./common.cjs');
const { openZip } = require('./zip.cjs');
const { packageKind, isCompoundFile, isEncryptedPackage, KIND_LABEL } = require('./ooxml.cjs');
const { parseDocx } = require('./docx.cjs');
const { parsePptx } = require('./pptx.cjs');
const { parseXlsx } = require('./xlsx.cjs');
const { parseCsv } = require('./csv.cjs');
const { inspectPdf } = require('./pdf.cjs');
const { Output } = require('./output.cjs');
const { sniffImage, columnName } = require('./common.cjs');

const EXTENSIONS = {
  docx: 'docx', docm: 'docx', dotx: 'docx', pptx: 'pptx', pptm: 'pptx', potx: 'pptx', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx',
  csv: 'csv', tsv: 'csv', pdf: 'pdf', txt: 'text', md: 'markdown', markdown: 'markdown',
  png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', gif: 'gif',
  doc: 'legacy', xls: 'legacy', ppt: 'legacy',
};
const MIME = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'text/csv': 'csv', 'text/tab-separated-values': 'csv', 'application/csv': 'csv', 'application/pdf': 'pdf', 'text/plain': 'text', 'text/markdown': 'markdown',
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/msword': 'legacy', 'application/vnd.ms-excel': 'legacy', 'application/vnd.ms-powerpoint': 'legacy',
};
const LABEL = { docx: KIND_LABEL.docx, pptx: KIND_LABEL.pptx, xlsx: KIND_LABEL.xlsx, csv: 'a CSV file', pdf: 'a PDF', text: 'a text file', markdown: 'a Markdown file', png: 'a PNG image', jpeg: 'a JPEG image', webp: 'a WebP image', gif: 'a GIF image', legacy: 'an older Office file' };
const OFFICE = new Set(['docx', 'pptx', 'xlsx']);
const IMAGES = new Set(['png', 'jpeg', 'webp', 'gif']);

function claimedFormat(name, declaredType) {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name || '')?.[1]?.toLowerCase();
  return (extension && EXTENSIONS[extension]) || MIME[(declaredType || '').toLowerCase().split(';')[0].trim()] || null;
}
function looksLikeHtml(bytes) {
  const head = Buffer.from(bytes.subarray(0, 512)).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml') && head.includes('<html');
}

/** { format } or { problem, message, status } from the bytes, declared type and name. */
function detect(bytes, declaredType, name, limits) {
  const claimed = claimedFormat(name, declaredType);
  const signature = sniffImage(bytes)?.mediaType?.slice(6) ?? null;
  const pdf = bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
  const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
  const mismatch = actual => ({ status: 'failed', problem: 'mime-mismatch', message: `This file is named as ${LABEL[claimed]} but its contents are ${actual}. Rename it with the right extension or export it again.` });
  if (pdf || signature) {
    const actual = pdf ? 'pdf' : signature;
    if (claimed && claimed !== actual && !(IMAGES.has(claimed) && IMAGES.has(actual))) return mismatch(LABEL[actual]);
    return { format: actual };
  }
  if (zip) {
    let kind = null;
    try { kind = packageKind(openZip(bytes, limits)); }
    catch (error) {
      if (error instanceof IngestError) return { status: error.problem === 'encrypted' ? 'encrypted' : 'failed', problem: error.problem, message: error.message };
      throw error;
    }
    if (!kind) return claimed && OFFICE.has(claimed) ? mismatch('a ZIP archive') : { status: 'unsupported', problem: 'archive', message: 'AI can’t read archives (ZIP). Unpack it and attach the documents themselves.' };
    if (claimed && claimed !== kind) return mismatch(KIND_LABEL[kind]);
    return { format: kind };
  }
  if (isCompoundFile(bytes)) {
    if (isEncryptedPackage(bytes)) return { format: claimed && OFFICE.has(claimed) ? claimed : 'office', status: 'encrypted', problem: 'encrypted', message: 'This file is password-protected, so AI can’t read it. Open it, remove the password (File › Info › Protect), save a copy and attach that.' };
    return { status: 'unsupported', problem: 'legacy-format', message: 'This is an older Office format (.doc, .xls or .ppt). Open it and save it as .docx, .xlsx or .pptx, then attach that copy.' };
  }
  if (claimed === 'csv' || claimed === 'text' || claimed === 'markdown') {
    if (looksLikeHtml(bytes)) return { status: 'unsupported', problem: 'mime-mismatch', message: `This file is named as ${LABEL[claimed]} but contains a web page (HTML). Save the content as plain text or CSV.` };
    return { format: claimed };
  }
  if (claimed && claimed !== 'legacy') return mismatch(looksLikeHtml(bytes) ? 'a web page (HTML)' : 'not a recognised document');
  if (claimed === 'legacy') return { status: 'unsupported', problem: 'legacy-format', message: 'This is an older Office format (.doc, .xls or .ppt). Open it and save it as .docx, .xlsx or .pptx, then attach that copy.' };
  return { status: 'unsupported', problem: 'unknown-format', message: 'AI can’t read this type of file.' };
}

function decodeStrictText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new IngestError('encoding', 'This text isn’t UTF-8, so AI can’t read it. Save it as UTF-8 text and attach that copy.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new IngestError('binary', 'This text file contains binary data. Save it as plain UTF-8 text and attach that copy.');
  return text;
}

/** Renders the structure as the text AI reads, within the character limit. Returns what was left out. */
function render(out, limits) {
  const lines = [];
  let used = 0, left = null;
  const push = text => { if (left) return false; if (used + text.length + 1 > limits.textCharacters) return false; lines.push(text); used += text.length + 1; return true; };
  const tables = new Map(out.tables.map(table => [table.id, table]));
  const included = new Set();
  for (const [index, block] of out.blocks.entries()) {
    let text = '';
    if (block.type === 'heading') text = `${'#'.repeat(block.level)} ${block.text}`;
    else if (block.type === 'paragraph') text = block.list ? `${'  '.repeat(block.list - 1)}- ${block.text.replace(/\n/g, ' ')}` : block.text;
    else if (block.type === 'note') text = `[${block.label}] ${block.text}`;
    else if (block.type === 'image') text = `[Picture ${block.image}${block.location ? ` (${block.location})` : ''} is attached after this text]`;
    else if (block.type === 'table') text = renderTable(tables.get(block.table));
    if (!text) continue;
    if (!push(text)) { left = { blocks: out.blocks.length - index }; break; }
    if (block.type === 'image') included.add(block.image);
  }
  let cellsSent = 0, cellsTotal = 0;
  for (const sheet of out.sheets) {
    cellsTotal += sheet.cells.length;
    if (left) continue;
    const byRow = new Map();
    let minCol = Infinity, maxCol = -1;
    for (const cell of sheet.cells) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
      minCol = Math.min(minCol, cell.col); maxCol = Math.max(maxCol, cell.col);
    }
    const width = maxCol - minCol + 1;
    // Dense sheets read as a grid (the reference is column letter + row number); sparse ones list each reference.
    const grid = sheet.cells.length > 0 && width <= 60 && sheet.cells.length / (byRow.size * width) >= 0.4;
    const shape = grid ? `grid: each line is “row number: values for columns ${columnName(minCol)}–${columnName(maxCol)}”, separated by |` : 'cells shown as reference: value';
    const header = `## Sheet “${sheet.name}”${sheet.hidden ? ' (hidden)' : ''}${sheet.kind === 'chart' ? ' — chart sheet (see chart data above)' : sheet.error ? ` — not read: ${sheet.error}` : ` — ${sheet.rows} rows × ${sheet.columns} columns, ${shape}`}`;
    if (!push(header)) { left = { cells: true }; continue; }
    const value = cell => `${escapeCell(cell.text)}${cell.formula ? ` {formula ${escapeCell(cell.formula)}}` : ''}${cell.formulaLike ? ' {text, not a formula}' : ''}`;
    for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
      const cells = byRow.get(row).sort((a, b) => a.col - b.col);
      let line;
      if (grid) {
        const slots = Array.from({ length: width }, () => '');
        for (const cell of cells) slots[cell.col - minCol] = value(cell);
        line = `${row + 1}: ${slots.join(' | ').replace(/(?: \| )+$/, '')}`;
      } else line = cells.map(cell => `${cell.ref}: ${value(cell)}`).join(' | ');
      if (!push(line)) { left = { cells: true }; break; }
      cellsSent += cells.length;
    }
  }
  for (const id of out.images.images.map(image => image.id)) if (!included.has(id) && !left) { if (push(`[Picture ${id} is attached after this text]`)) included.add(id); }
  if (left) {
    const detail = left.cells ? `${cellsSent.toLocaleString('en-US')} of ${cellsTotal.toLocaleString('en-US')} cells` : `the first part (${(out.blocks.length - left.blocks).toLocaleString('en-US')} of ${out.blocks.length.toLocaleString('en-US')} blocks)`;
    out.missed(`The extracted text is longer than AI reads per file (${limits.textCharacters.toLocaleString('en-US')} characters): only ${detail} would be read. Split the file into smaller files.`);
  }
  // Pictures not referenced from the text that fits are not sent: keep the record honest.
  out.images.images = out.images.images.filter(image => included.has(image.id));
  return { text: lines.join('\n'), cellsSent };
}
const escapeCell = text => String(text ?? '').replace(/\r?\n/g, ' ⏎ ').replace(/\|/g, '¦');
function renderTable(table) {
  if (!table) return '';
  const rows = table.rows.map(row => `| ${row.map(cell => escapeCell(cell.text)).join(' | ')} |`);
  const width = table.rows[0]?.length ?? 0;
  if (table.headerRows > 0 && rows.length > table.headerRows) rows.splice(table.headerRows, 0, `|${' --- |'.repeat(width)}`);
  return [`Table (${table.source}):`, ...rows].join('\n');
}

const STATUS_MESSAGE = {
  timeout: 'Reading this file took too long, so it was stopped. Split it into smaller files or save a simpler copy.',
  memory: 'This file needs more memory to read than AI sources allow. Split it into smaller files.',
};

/** The worker's whole job: bytes in, one extraction object out. */
function extract(input) {
  const limits = mergeLimits(input.limits);
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const name = String(input.name || '').slice(0, 255);
  const base = { extractionVersion: EXTRACTION_VERSION, bytes: bytes.length };
  if (!bytes.length) return { ...base, format: claimedFormat(name, input.declaredType) || 'unknown', status: 'failed', problem: 'empty', message: 'This file is empty.' };
  let detected;
  try { detected = detect(bytes, input.declaredType, name, limits); }
  catch { return { ...base, format: 'unknown', status: 'failed', problem: 'malformed', message: 'This file couldn’t be checked.' }; }
  if (!detected.format || detected.status) return { ...base, format: detected.format || claimedFormat(name, input.declaredType) || 'unknown', status: detected.status, problem: detected.problem, message: detected.message, coverage: null, text: '', warnings: [], unsupported: [] };
  const format = detected.format;
  try {
    let out;
    if (format === 'docx') out = parseDocx(bytes, limits);
    else if (format === 'pptx') out = parsePptx(bytes, limits);
    else if (format === 'xlsx') out = parseXlsx(bytes, limits);
    else if (format === 'csv') out = parseCsv(bytes, limits, name);
    else if (format === 'pdf') {
      const result = inspectPdf(bytes, limits);
      out = result.out;
      if (result.encrypted) return finish(base, format, out, 'encrypted', 'This PDF is password-protected or encrypted, so AI can’t read it. Save an unprotected copy (Print › Save as PDF) and attach that.', 'encrypted', '');
      if (!result.pages) return finish(base, format, out, 'failed', 'No pages were found in this PDF. It may be damaged; save it again and attach the new copy.', 'malformed', '');
      if (result.pages > limits.pages) return finish(base, format, out, 'failed', `This PDF has ${result.pages.toLocaleString('en-US')} pages. AI reads up to ${limits.pages} pages per PDF, and a PDF is never cut short silently. Split it into parts of ${limits.pages} pages or fewer.`, 'too-many-pages', '');
      return finish(base, format, out, 'complete', '', undefined, '');
    } else if (format === 'text' || format === 'markdown') {
      const text = decodeStrictText(bytes);
      out = new Output(limits);
      if (text.length > limits.textCharacters) return finish(base, format, out, 'failed', `This text has ${text.length.toLocaleString('en-US')} characters. AI reads up to ${limits.textCharacters.toLocaleString('en-US')} characters per file; split it into smaller files.`, 'text-too-long', '');
      out.coverage = { unit: 'characters', total: text.length, read: text.length, visual: 'none', notes: [] };
      return finish(base, format, out, 'complete', '', undefined, text);
    } else if (IMAGES.has(format)) {
      out = new Output(limits);
      const info = sniffImage(bytes);
      out.details.image = { width: info?.width ?? 0, height: info?.height ?? 0 };
      out.coverage = { unit: 'image', total: 1, read: 1, visual: 'native', notes: ['AI views the picture itself.'] };
      return finish(base, format, out, 'complete', '', undefined, '');
    } else return { ...base, format, status: 'unsupported', problem: 'unknown-format', message: 'AI can’t read this type of file.' };
    const { text } = render(out, limits);
    if (out.partial.length) return finish(base, format, out, 'partial', `Only part of this file could be read: ${out.partial[0]}${out.partial.length > 1 ? ` (and ${out.partial.length - 1} more issue${out.partial.length === 2 ? '' : 's'})` : ''}`, 'partial', text);
    if (!text.trim() && !out.images.images.length) return finish(base, format, out, 'failed', 'No readable text, tables or pictures were found in this file.', 'empty', text);
    return finish(base, format, out, 'complete', '', undefined, text);
  } catch (error) {
    if (error instanceof IngestError) return { ...base, format, status: error.problem === 'encrypted' ? 'encrypted' : 'failed', problem: error.problem, message: error.message, coverage: null, text: '', warnings: [], unsupported: [] };
    return { ...base, format, status: 'failed', problem: 'malformed', message: 'This file is damaged or uses a structure AI sources can’t read. Save a fresh copy from the original app and attach that.', coverage: null, text: '', warnings: [], unsupported: [] };
  }
}

function finish(base, format, out, status, message, problem, text) {
  return {
    ...base, format, status, ...(problem ? { problem } : {}), message,
    coverage: out.coverage, text, blocks: out.blocks, tables: out.tables, slides: out.slides,
    sheets: out.sheets, images: out.images.images, warnings: out.warnings, unsupported: out.unsupported, details: out.details,
  };
}

module.exports = { extract, detect, claimedFormat, STATUS_MESSAGE, EXTRACTION_VERSION };
