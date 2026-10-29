/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS so the same files load in a plain worker thread or sandbox without a build step. */
'use strict';
/* Excel (.xlsx): every sheet's cells with their A1 reference and the value
 * Excel last saved. Formulas are NEVER evaluated: a formula cell keeps its
 * cached result and its formula text is kept only as untrusted data. Number
 * formats are used to recognise dates, percentages and currency amounts.
 * Links to other workbooks are ignored (their last saved values stay). */
const { openPackage, packageFindings, assertKind, readChart } = require('./ooxml.cjs');
const { kids, kid, attr, relId, find, textOf } = require('./xml.cjs');
const { Output } = require('./output.cjs');
const { IngestError, parseRef, cellRef } = require('./common.cjs');

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_PERCENT = new Set([9, 10]);
const BUILTIN_CURRENCY = new Set([5, 6, 7, 8, 42, 44]);
const BUILTIN_CODES = { 9: '0%', 10: '0.00%', 14: 'm/d/yyyy', 22: 'm/d/yyyy h:mm' };
const SYMBOLS = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', 'KM': 'BAM', 'kn': 'HRK', 'CHF': 'CHF' };

function classifyFormat(id, code) {
  if (BUILTIN_DATE.has(id)) return { kind: 'date' };
  if (BUILTIN_PERCENT.has(id)) return { kind: 'percent' };
  if (BUILTIN_CURRENCY.has(id)) return { kind: 'currency' };
  if (!code) return { kind: 'number' };
  // [$€-2], [$€-x-euro2], [$USD-409]: the symbol, then an optional locale tag.
  const bracketCurrency = /\[\$([^\]-]*)(?:-[^\]]*)?\]/.exec(code);
  const plain = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '');
  if (/%/.test(plain)) return { kind: 'percent' };
  const quoted = (code.match(/"([^"]*)"/g) || []).map(text => text.slice(1, -1).trim());
  const symbol = bracketCurrency?.[1] || Object.keys(SYMBOLS).find(item => plain.includes(item) || quoted.includes(item));
  if (symbol !== undefined && symbol !== '') return { kind: 'currency', currency: SYMBOLS[symbol] || symbol };
  if (/[yd]/i.test(plain)) return { kind: 'date' };
  if (/[hs]/i.test(plain)) return { kind: 'date', time: true };
  if (/m/i.test(plain) && !/[0#?]/.test(plain)) return { kind: 'date' };
  return { kind: 'number' };
}

/** Excel serial day → ISO date (with time when present); handles the 1900 leap-year quirk and the 1904 system. */
function serialDate(serial, date1904, timeOnly = false) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  if (!date1904 && Math.floor(serial) === 60) return null;
  const ms = Math.round(serial * 86_400_000);
  // A time-only format (h:mm, [h]:mm:ss) shows the time of day.
  if (timeOnly) return new Date(ms % 86_400_000).toISOString().slice(11, 19);
  const value = new Date(base + ms);
  const iso = value.toISOString();
  return ms % 86_400_000 === 0 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function parseXlsx(bytes, limits) {
  const pkg = openPackage(bytes, limits);
  assertKind(pkg, 'xlsx');
  const out = new Output(limits);
  const main = [...pkg.rels('').values()].find(rel => rel.type === 'officeDocument' && !rel.external)?.path || 'xl/workbook.xml';
  const workbook = pkg.xml(main);
  const date1904 = ['1', 'true'].includes((attr(kid(workbook, 'workbookPr'), 'date1904') || '').toLowerCase());
  const rels = pkg.rels(main);
  const relOf = type => [...rels.values()].find(rel => rel.type === type && !rel.external && rel.path && pkg.has(rel.path));
  const strings = [];
  const sharedRel = relOf('sharedStrings');
  if (sharedRel) for (const item of kids(pkg.xml(sharedRel.path), 'si')) strings.push(kid(item, 't') ? textOf(kid(item, 't')) : kids(item, 'r').map(run => textOf(kid(run, 't'))).join(''));
  const formats = [];
  const stylesRel = relOf('styles');
  if (stylesRel) {
    const styles = pkg.xml(stylesRel.path);
    const custom = new Map(kids(kid(styles, 'numFmts'), 'numFmt').map(node => [Number(attr(node, 'numFmtId')), attr(node, 'formatCode') || '']));
    for (const xf of kids(kid(styles, 'cellXfs'), 'xf')) {
      const id = Number(attr(xf, 'numFmtId') || 0);
      const code = custom.get(id) ?? BUILTIN_CODES[id] ?? '';
      formats.push({ id, code, ...classifyFormat(id, custom.get(id) ?? '') });
    }
  }
  const sheetNodes = kids(kid(workbook, 'sheets'), 'sheet');
  if (!sheetNodes.length) throw new IngestError('malformed', 'This workbook has no sheets.');
  const totalSheets = sheetNodes.length;
  const readableSheets = Math.min(totalSheets, limits.sheets);
  let cellBudget = limits.cells, totalCells = 0, readCells = 0, sheetsRead = 0, formulas = 0, missingResults = 0, hiddenSheets = 0;
  for (let index = 0; index < readableSheets; index++) {
    const node = sheetNodes[index];
    const name = attr(node, 'name') || `Sheet ${index + 1}`;
    const state = attr(node, 'state') || 'visible';
    const sheet = { name, index: index + 1, hidden: state !== 'visible', rows: 0, columns: 0, cells: [], cellsTotal: 0, truncated: false };
    if (sheet.hidden) hiddenSheets++;
    out.sheets.push(sheet);
    try {
      const rel = rels.get(relId(node));
      if (!rel || rel.external || !rel.path || !pkg.has(rel.path)) throw new IngestError('malformed', 'Sheet part missing.');
      if (rel.type === 'chartsheet') { sheet.kind = 'chart'; sheetsRead++; continue; }
      const root = pkg.xml(rel.path);
      let hiddenRows = 0;
      for (const row of kids(kid(root, 'sheetData'), 'row')) {
        if (['1', 'true'].includes(attr(row, 'hidden') || '')) hiddenRows++;
        const rowNumber = Number(attr(row, 'r')) - 1;
        let column = -1;
        for (const c of kids(row, 'c')) {
          const position = parseRef(attr(c, 'r') || '') || { row: Number.isSafeInteger(rowNumber) && rowNumber >= 0 ? rowNumber : sheet.rows, col: column + 1 };
          column = position.col;
          const v = kid(c, 'v'), f = kid(c, 'f'), inline = kid(c, 'is');
          if (!v && !f && !inline) continue;
          sheet.cellsTotal++; totalCells++;
          if (position.row >= limits.rows || position.col >= limits.columns) { sheet.truncated = true; continue; }
          if (cellBudget <= 0) { sheet.truncated = true; continue; }
          cellBudget--; readCells++;
          sheet.rows = Math.max(sheet.rows, position.row + 1);
          sheet.columns = Math.max(sheet.columns, position.col + 1);
          sheet.cells.push(readCell(c, position, { strings, formats, date1904 }, counts => { formulas += counts.formula; missingResults += counts.missing; }));
        }
      }
      if (hiddenRows) out.warn(`${hiddenRows} hidden row${hiddenRows === 1 ? '' : 's'} in “${name}” ${hiddenRows === 1 ? 'is' : 'are'} included.`);
      const merged = kids(kid(root, 'mergeCells'), 'mergeCell').length;
      if (merged) out.warn(`“${name}” has ${merged} merged range${merged === 1 ? '' : 's'}; each value is in its top-left cell.`);
      sheetDrawings(pkg, rel.path, name, out);
      sheetComments(pkg, rel.path, name, out);
      if (sheet.truncated) out.missed(`“${name}”: ${sheet.cells.length.toLocaleString('en-US')} of ${sheet.cellsTotal.toLocaleString('en-US')} cells read (limit ${limits.cells.toLocaleString('en-US')} cells per file, ${limits.rows.toLocaleString('en-US')} rows, ${limits.columns.toLocaleString('en-US')} columns).`);
      sheetsRead++;
    } catch (error) {
      if (error instanceof IngestError && error.problem === 'archive-limit') throw error;
      sheet.error = 'This sheet is damaged and couldn’t be read.';
      sheet.cells = [];
      out.missed(`Sheet “${name}” couldn’t be read (${error instanceof IngestError ? 'damaged XML' : 'damaged'}).`);
    }
  }
  if (totalSheets > readableSheets) out.missed(`Only the first ${readableSheets} of ${totalSheets} sheets were read (limit ${limits.sheets} sheets per file).`);
  if (hiddenSheets) out.warn(`${hiddenSheets} hidden sheet${hiddenSheets === 1 ? ' is' : 's are'} included and marked “hidden”.`);
  if (formulas) out.warn(`${formulas.toLocaleString('en-US')} formula cell${formulas === 1 ? '' : 's'}: the value Excel last saved is used; formulas were not recalculated.`);
  if (missingResults) out.missed(`${missingResults.toLocaleString('en-US')} formula cell${missingResults === 1 ? ' has' : 's have'} no saved result, so ${missingResults === 1 ? 'its value is' : 'their values are'} unknown. Open and save the workbook in Excel, then attach it again.`);
  const externalBooks = pkg.zip.names.filter(name => /^xl\/externalLinks\/externalLink\d+\.xml$/i.test(name)).length;
  if (externalBooks) out.unsupported.push({ kind: 'external-workbook', count: externalBooks, detail: `${externalBooks} link${externalBooks === 1 ? '' : 's'} to other workbooks ignored; cells show the values last saved in this file.` });
  const pivots = pkg.zip.names.filter(name => /^xl\/pivotTables\/[^/]+\.xml$/i.test(name)).length;
  if (pivots) out.unsupported.push({ kind: 'pivot', count: pivots, detail: `${pivots} pivot table layout${pivots === 1 ? '' : 's'} not read as pivots; their saved cells are read.` });
  packageFindings(pkg, out.unsupported);
  out.images.report(out.unsupported);
  out.details.xlsx = { sheets: totalSheets, hiddenSheets, formulas, date1904 };
  out.coverage = { unit: 'sheets', total: totalSheets, read: sheetsRead, cells: { total: totalCells, read: readCells }, visual: 'none',
    notes: ['Cell values are the ones Excel last saved; no formula was recalculated.'] };
  return out;
}

function readCell(c, position, context, count) {
  const ref = cellRef(position.row, position.col);
  const type = attr(c, 't') || 'n';
  const style = context.formats[Number(attr(c, 's') || 0)] || { kind: 'number', code: '' };
  const v = kid(c, 'v'), f = kid(c, 'f');
  const raw = v ? textOf(v) : '';
  const cell = { ref, row: position.row, col: position.col, kind: 'string', value: null, text: '' };
  if (f) {
    const formula = textOf(f).trim();
    cell.formula = formula ? `=${formula}` : `(shared formula ${attr(f, 'si') ?? ''})`.trim();
    count({ formula: 1, missing: v ? 0 : 1 });
  }
  if (type === 'inlineStr') { const inline = kid(c, 'is'); cell.value = cell.text = kid(inline, 't') ? textOf(kid(inline, 't')) : kids(inline, 'r').map(run => textOf(kid(run, 't'))).join(''); return cell; }
  if (!v) { cell.kind = 'empty'; return cell; }
  if (type === 's') { const index = Number(raw); cell.value = cell.text = Number.isSafeInteger(index) && index >= 0 && index < context.strings.length ? context.strings[index] : ''; return cell; }
  if (type === 'str') { cell.value = cell.text = raw; return cell; }
  if (type === 'b') { cell.kind = 'boolean'; cell.value = raw === '1'; cell.text = raw === '1' ? 'TRUE' : 'FALSE'; return cell; }
  if (type === 'e') { cell.kind = 'error'; cell.value = cell.text = raw; return cell; }
  if (type === 'd') { cell.kind = 'date'; cell.value = cell.text = raw; cell.date = raw.slice(0, 19); return cell; }
  const number = Number(raw);
  if (!raw.trim() || !Number.isFinite(number)) { cell.value = cell.text = raw; return cell; }
  cell.value = number;
  if (style.code) cell.numFmt = style.code;
  if (style.kind === 'date') {
    const date = serialDate(number, context.date1904, Boolean(style.time));
    if (date) { cell.kind = 'date'; cell.date = date; cell.text = date; return cell; }
  }
  if (style.kind === 'percent') { cell.kind = 'percent'; cell.text = `${Number((number * 100).toPrecision(12))}%`; return cell; }
  if (style.kind === 'currency') { cell.kind = 'currency'; if (style.currency) cell.currency = style.currency; cell.text = style.currency ? `${raw} ${style.currency}` : `${raw} (currency)`; return cell; }
  cell.kind = 'number'; cell.text = raw;
  return cell;
}

function sheetDrawings(pkg, sheetPart, name, out) {
  for (const rel of pkg.rels(sheetPart).values()) {
    if (rel.type !== 'drawing' || rel.external || !rel.path || !pkg.has(rel.path)) continue;
    const drawing = pkg.xml(rel.path);
    const drawingRels = pkg.rels(rel.path);
    for (const blip of find(drawing, 'blip')) {
      const target = drawingRels.get(relId(blip, 'embed'));
      if (target && !target.external && target.path && pkg.has(target.path)) out.image(out.images.add(pkg.read(target.path), target.path, `sheet ${name}`), `sheet ${name}`);
    }
    for (const chart of find(drawing, 'chart')) {
      const target = drawingRels.get(relId(chart));
      if (!target || target.external || !target.path || !pkg.has(target.path)) continue;
      try {
        const data = readChart(pkg, target.path);
        if (data) out.table(`Chart on “${name}”${data.title ? `: ${data.title}` : ''} (saved chart data)`, [data.header, ...data.rows], 1, `sheet ${name}`);
      } catch (error) { out.missed(`A chart on “${name}” couldn’t be read (${error.message || 'damaged'}).`); }
    }
  }
}
function sheetComments(pkg, sheetPart, name, out) {
  for (const rel of pkg.rels(sheetPart).values()) {
    if (rel.type !== 'comments' || rel.external || !rel.path || !pkg.has(rel.path)) continue;
    for (const comment of kids(kid(pkg.xml(rel.path), 'commentList'), 'comment')) {
      const text = find(comment, 't').map(textOf).join('').trim();
      if (text) out.note(`Comment on ${name}!${attr(comment, 'ref') || ''}`, text, `sheet ${name}`);
    }
  }
}

module.exports = { parseXlsx, serialDate, classifyFormat };
