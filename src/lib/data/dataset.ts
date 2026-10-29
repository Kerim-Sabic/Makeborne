import { z } from "zod";
import type { ExtractionRecord, ExtractionSheet, SheetCell } from "../ingest/record";
import { fromNumber, parseDec, shift, type Dec } from "./decimal";

/**
 * A typed table built from one sheet of an ingestion record (stage 2 extraction:
 * cached values only, formulas never evaluated, A1 references). Every value keeps
 * its cell reference; every value that cannot be used is kept as `missing` with
 * the exact reason, never dropped or guessed. Ambiguous readings ("1,234",
 * "03/04/2026") are refused unless the column states its format explicitly.
 * Dates are calendar dates (YYYY-MM-DD) without a time zone.
 */
export const COLUMN_KINDS = ["number", "money", "percent", "date", "text"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];
export const DATE_FORMATS = ["YYYY-MM-DD", "DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type DecimalMark = "." | ",";

const Letter = z.string().regex(/^[A-Z]{1,3}$/);
export const ColumnSpecSchema = z.object({
  column: Letter, kind: z.enum(COLUMN_KINDS).optional(), dateFormat: z.enum(DATE_FORMATS).optional(),
  decimal: z.enum([".", ","]).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), unit: z.string().trim().min(1).max(8).optional(),
}).strict();
export type ColumnSpec = z.infer<typeof ColumnSpecSchema>;
export const DatasetOptionsSchema = z.object({
  sheet: z.string().max(500).optional(), headerRow: z.number().int().min(1).max(50).optional(),
  columns: z.array(ColumnSpecSchema).max(100).optional(),
}).strict();
export type DatasetOptions = z.infer<typeof DatasetOptionsSchema>;

export type Value =
  | { kind: "number"; value: Dec; ref: string; currency?: string; unit?: string; formula?: true }
  | { kind: "date"; value: string; ref: string; formula?: true }
  | { kind: "text"; value: string; ref: string }
  | { kind: "missing"; ref: string; reason: string; raw?: string };
export type DatasetColumn = {
  letter: string; header: string; kind: ColumnKind; kindSource: "declared" | "inferred";
  currency?: string; currencySource?: "declared" | "heading" | "cells"; unit?: string;
  dateFormat?: DateFormat; decimal?: DecimalMark;
  counts: { values: number; missing: number; formulas: number };
  suggestions: { kind: "decimal" | "dateFormat"; message: string; value?: string }[];
};
export type DatasetRow = { row: number; cells: Record<string, Value> };
export type DataIssue = { ref: string; column: string; reason: string; raw?: string };
export type Dataset = {
  source: { sha256: string; extractionVersion: string; format: string; sheet: string; sheets: string[]; name?: string };
  headerRow: number; columns: DatasetColumn[]; rows: DatasetRow[]; issues: DataIssue[]; warnings: string[];
};

export class DataError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); this.name = "DataError"; }
}

export const MAX_DATA_ROWS = 100_000;
const CURRENCY: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY", "KM": "BAM", "EUR": "EUR", "USD": "USD", "GBP": "GBP", "BAM": "BAM", "CHF": "CHF", "RSD": "RSD", "HRK": "HRK", "JPY": "JPY" };
const UNITS = ["%", "‰", "kg", "g", "mg", "t", "km", "m", "cm", "mm", "m²", "m2", "km²", "ha", "m³", "l", "ml", "h", "min", "s", "ms", "kWh", "MWh", "kW", "MW", "W", "°C", "°F", "GB", "MB", "TB", "kB", "pcs", "kom"];
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const MISSING = /^(n\/?a|na|n\.a\.|null|none|nil|-|—|–|\?|#n\/a|tbd|unknown|not available)$/i;
const quote = (text: string, max = 40) => { const clean = text.replace(/\s+/g, " ").trim(); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; };

/** The sheet-qualified reference shown to people: Sales!C12, 'Q3 sales'!C12. */
export function qualified(sheet: string, ref: string) {
  return /^[A-Za-z0-9_]+$/.test(sheet) ? `${sheet}!${ref}` : `'${sheet.replace(/'/g, "''")}'!${ref}`;
}

type NumberReading = { ok: true; value: Dec; currency?: string; unit?: string } | { ok: false; reason: "ambiguous" | "invalid" };
/** Number text with an explicit (or unambiguous) decimal mark; currency and unit marks are kept, never converted. */
export function parseNumberText(raw: string, decimal?: DecimalMark): NumberReading {
  let text = raw.replace(/[   ]/g, " ").trim(), negative = false, currency: string | undefined, unit: string | undefined;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  for (const [symbol, code] of Object.entries(CURRENCY)) {
    if (text.startsWith(symbol) && /^[\s\d(+\-−]/.test(text.slice(symbol.length) || " ")) { currency = code; text = text.slice(symbol.length).trim(); break; }
    if (text.endsWith(symbol) && /[\s\d)]$/.test(text.slice(0, -symbol.length) || " ")) { currency = code; text = text.slice(0, -symbol.length).trim(); break; }
  }
  if (/^[-−–]/.test(text)) { negative = !negative; text = text.slice(1).trim(); } else if (text.startsWith("+")) text = text.slice(1).trim();
  if (currency && /^[-−–]/.test(text)) { negative = !negative; text = text.slice(1).trim(); }
  if (!currency) for (const candidate of UNITS) {
    if (text.endsWith(candidate) && /[\s\d]$/.test(text.slice(0, -candidate.length))) { unit = candidate === "m2" ? "m²" : candidate; text = text.slice(0, -candidate.length).trim(); break; }
  }
  if (!/^\d[\d .,']*$/.test(text) || /[ .,']$/.test(text)) return { ok: false, reason: "invalid" };
  let whole: string, fraction = "";
  const groupOk = (part: string, separators: string) => { const groups = part.split(new RegExp(`[${separators.replace(/[.]/g, "\\.")}]`)); return groups.length === 1 || (/^\d{1,3}$/.test(groups[0]) && groups.slice(1).every(group => /^\d{3}$/.test(group))); };
  if (decimal) {
    const groupChars = decimal === "." ? ", '" : ". '";
    const pieces = text.split(decimal);
    if (pieces.length > 2) return { ok: false, reason: "invalid" };
    if (!groupOk(pieces[0], groupChars)) return { ok: false, reason: "invalid" };
    whole = pieces[0].replace(/[ .,']/g, ""); fraction = pieces[1] ?? "";
    if (pieces.length === 2 && !/^\d+$/.test(fraction)) return { ok: false, reason: "invalid" };
  } else {
    const compact = text.replace(/[ ']/g, "");
    if (/[ ']/.test(text) && !groupOk(text.replace(/[.,]\d+$/, ""), " '")) return { ok: false, reason: "invalid" };
    const dots = (compact.match(/\./g) ?? []).length, commas = (compact.match(/,/g) ?? []).length;
    if (dots && commas) {
      const mark = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
      const pieces = compact.split(mark);
      if (pieces.length !== 2 || !groupOk(pieces[0], mark === "." ? "," : ".") || !/^\d+$/.test(pieces[1])) return { ok: false, reason: "invalid" };
      whole = pieces[0].replace(/[.,]/g, ""); fraction = pieces[1];
    } else if (dots > 1 || commas > 1) {
      if (!groupOk(compact, dots ? "." : ",")) return { ok: false, reason: "invalid" };
      whole = compact.replace(/[.,]/g, "");
    } else if (dots === 1 || commas === 1) {
      const [left, right] = compact.split(dots ? "." : ",");
      // "1,234" is one thousand two hundred and thirty-four, or one point two three four.
      if (right.length === 3 && left.length <= 3 && left !== "0") return { ok: false, reason: "ambiguous" };
      whole = left; fraction = right;
    } else whole = compact;
  }
  if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction)) || (whole + fraction).replace(/^0+/, "").length > 30) return { ok: false, reason: "invalid" };
  const value = parseDec(`${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`);
  return value ? { ok: true, value, ...(currency ? { currency } : {}), ...(unit ? { unit } : {}) } : { ok: false, reason: "invalid" };
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!(year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
type DateReading = { ok: true; date: string; time?: true } | { ok: false; reason: "ambiguous" | "invalid" | "two-digit-year" };
/** Calendar dates only. ISO, dotted day.month.year and named months are unambiguous; slash dates need the declared order. */
export function parseDateText(raw: string, format?: DateFormat): DateReading {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (match) { const date = isoDate(+match[1], +match[2], +match[3]); return date ? { ok: true, date, ...(match[4] ? { time: true as const } : {}) } : { ok: false, reason: "invalid" }; }
  match = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/.exec(text);
  if (match) { const date = isoDate(+match[3], +match[2], +match[1]); return date ? { ok: true, date } : { ok: false, reason: "invalid" }; }
  match = /^(\d{1,2})\.?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(text) ?? null;
  if (match && MONTHS[match[2].toLowerCase()]) { const date = isoDate(+match[3], MONTHS[match[2].toLowerCase()], +match[1]); return date ? { ok: true, date } : { ok: false, reason: "invalid" }; }
  match = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) { const date = isoDate(+match[3], MONTHS[match[1].toLowerCase()], +match[2]); return date ? { ok: true, date } : { ok: false, reason: "invalid" }; }
  match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (match) { const date = isoDate(+match[1], +match[2], +match[3]); return date ? { ok: true, date } : { ok: false, reason: "invalid" }; }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) {
    if (match[3].length === 2) return { ok: false, reason: "two-digit-year" };
    if (format !== "DD/MM/YYYY" && format !== "MM/DD/YYYY") return { ok: false, reason: "ambiguous" };
    const [day, month] = format === "DD/MM/YYYY" ? [+match[1], +match[2]] : [+match[2], +match[1]];
    const date = isoDate(+match[3], month, day);
    return date ? { ok: true, date } : { ok: false, reason: "invalid" };
  }
  return { ok: false, reason: "invalid" };
}

/** Currency named in a column heading ("Revenue (EUR)", "Amount €"). */
export function headingCurrency(header: string): string | undefined {
  const code = /\b(EUR|USD|GBP|BAM|CHF|RSD|HRK|JPY)\b/.exec(header)?.[1];
  if (code) return code;
  const symbol = /[€$£¥]/.exec(header)?.[0];
  return symbol ? CURRENCY[symbol] : /\bKM\b/.test(header) ? "BAM" : undefined;
}
export function headingUnit(header: string): string | undefined {
  const inside = /\(([^)]{1,8})\)\s*$/.exec(header)?.[1]?.trim() ?? /\bin\s+(\S{1,8})\s*$/i.exec(header)?.[1];
  if (!inside) return undefined;
  const unit = UNITS.find(candidate => candidate.toLowerCase() === inside.toLowerCase());
  return unit === "m2" ? "m²" : unit;
}

function sheetOf(record: ExtractionRecord, name?: string): ExtractionSheet {
  const usable = record.sheets.filter(sheet => sheet.kind !== "chart" && sheet.cells.length > 0);
  const sheet = name !== undefined ? record.sheets.find(item => item.name === name) : usable.find(item => !item.hidden) ?? usable[0];
  if (!sheet) throw new DataError("NO_TABLE", name !== undefined ? `There is no sheet called “${quote(name)}” in this file.` : "This file has no table of values to report on.");
  if (sheet.error) throw new DataError("SHEET_DAMAGED", `The sheet “${quote(sheet.name)}” is damaged and couldn’t be read, so no figures can be computed from it.`);
  if (sheet.truncated) throw new DataError("SHEET_TRUNCATED", `Only part of “${quote(sheet.name)}” could be read (${sheet.cells.length.toLocaleString("en-US")} of ${sheet.cellsTotal.toLocaleString("en-US")} values), so totals would be wrong. Split the file and try again.`);
  if (sheet.kind === "chart") throw new DataError("NO_TABLE", `“${quote(sheet.name)}” is a chart sheet, not a table of values.`);
  return sheet;
}

const letterOf = (ref: string) => ref.replace(/\d+$/, "");
const blank = (cell: SheetCell) => cell.kind !== "error" && !cell.formula && !cell.formulaLike && (cell.kind === "empty" || cell.text.trim() === "");

/** The reason a cell cannot be read as a number, a date or text at all, if any. */
function unusable(cell: SheetCell): string | null {
  if (cell.formula && cell.kind === "empty") return "a formula with no saved result (formulas are never recalculated)";
  if (cell.formulaLike) return "formula text in a CSV file (never calculated)";
  if (cell.kind === "error") return `the error value ${quote(cell.text, 16)}`;
  return null;
}

function readNumber(cell: SheetCell, column: { kind: ColumnKind; decimal?: DecimalMark }): Value {
  const ref = cell.ref, bad = unusable(cell);
  if (bad) return { kind: "missing", ref, reason: bad, ...(cell.formula ? { raw: cell.formula.slice(0, 80) } : {}) };
  const formula = cell.formula ? { formula: true as const } : {};
  if (cell.kind === "boolean") return { kind: "missing", ref, reason: "TRUE/FALSE in a number column", raw: cell.text };
  if (cell.kind === "date") return { kind: "missing", ref, reason: "a date in a number column", raw: cell.text };
  if (typeof cell.value === "number" && (cell.kind === "number" || cell.kind === "percent" || cell.kind === "currency")) {
    // A saved binary number: its shortest exact form. Percent cells hold fractions (0.25 for 25%).
    const exact = fromNumber(cell.value);
    if (!exact) return { kind: "missing", ref, reason: "not a finite number" };
    if (cell.kind === "percent") return { kind: "number", value: shift(exact, 2), ref, unit: "%", ...formula };
    return { kind: "number", value: exact, ref, ...(cell.kind === "currency" ? { currency: cell.currency ?? "?" } : {}), ...formula };
  }
  const text = cell.text.trim();
  if (MISSING.test(text)) return { kind: "missing", ref, reason: `marked as not available (“${quote(text, 16)}”)`, raw: text };
  const reading = parseNumberText(text, column.decimal);
  if (!reading.ok) return { kind: "missing", ref, raw: quote(text),
    reason: reading.reason === "ambiguous" ? `“${quote(text, 16)}” could be read two ways; choose the decimal mark for this column` : `“${quote(text, 24)}” is not a number` };
  return { kind: "number", value: reading.value, ref, ...(reading.currency ? { currency: reading.currency } : {}), ...(reading.unit ? { unit: reading.unit } : {}), ...formula };
}

function readDate(cell: SheetCell, format: DateFormat | undefined, notes: { times: number }): Value {
  const ref = cell.ref, bad = unusable(cell);
  if (bad) return { kind: "missing", ref, reason: bad, ...(cell.formula ? { raw: cell.formula.slice(0, 80) } : {}) };
  const formula = cell.formula ? { formula: true as const } : {};
  if (cell.kind === "date" && cell.date) {
    // XLSX dates arrive as ISO text (serials already resolved with the workbook's date system).
    if (/^\d{2}:\d{2}/.test(cell.date)) return { kind: "missing", ref, reason: "a time of day without a date", raw: cell.date };
    if (cell.date.length > 10) notes.times++;
    return { kind: "date", value: cell.date.slice(0, 10), ref, ...formula };
  }
  if (typeof cell.value === "number") return { kind: "missing", ref, reason: "a number without a date format in a date column", raw: cell.text };
  const text = cell.text.trim();
  if (MISSING.test(text)) return { kind: "missing", ref, reason: `marked as not available (“${quote(text, 16)}”)`, raw: text };
  const reading = parseDateText(text, format);
  if (!reading.ok) return { kind: "missing", ref, raw: quote(text),
    reason: reading.reason === "ambiguous" ? `“${quote(text, 16)}” could be day/month or month/day; choose the date order for this column`
      : reading.reason === "two-digit-year" ? `“${quote(text, 16)}” has a two-digit year; use four digits`
      : format ? `“${quote(text, 24)}” is not a valid ${format} date` : `“${quote(text, 24)}” is not a date` };
  if (reading.time) notes.times++;
  return { kind: "date", value: reading.date, ref, ...formula };
}

function inferKind(cells: SheetCell[], header: string): ColumnKind {
  let numbers = 0, dates = 0, currency = 0, percent = 0, considered = 0;
  for (const cell of cells) {
    if (unusable(cell) || blank(cell) || MISSING.test(cell.text.trim())) continue;
    considered++;
    const text = cell.text.trim();
    if (cell.kind === "date" || (cell.kind === "string" && (parseDateText(text).ok || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)))) { dates++; continue; }
    if (cell.kind === "currency") { numbers++; currency++; continue; }
    if (cell.kind === "percent") { numbers++; percent++; continue; }
    if (cell.kind === "number") { numbers++; continue; }
    const reading = parseNumberText(cell.text);
    if (reading.ok || reading.reason === "ambiguous") { numbers++; if (reading.ok && reading.currency) currency++; if (reading.ok && reading.unit === "%") percent++; }
  }
  if (!considered) return "text";
  if (dates / considered >= 0.6) return "date";
  if (numbers / considered >= 0.6) return currency || headingCurrency(header) ? "money" : percent === numbers ? "percent" : "number";
  return "text";
}

/** Builds the typed table. Throws DataError only when nothing reliable can be computed (unreadable, truncated or damaged sheet). */
export function buildDataset(record: ExtractionRecord, options: DatasetOptions = {}): Dataset {
  if (record.status !== "complete" && record.status !== "partial") throw new DataError("SOURCE_UNREADABLE", record.message || "This file couldn’t be read.");
  if (record.format !== "xlsx" && record.format !== "csv") throw new DataError("NOT_A_SPREADSHEET", "Choose an Excel workbook (.xlsx) or a CSV file.");
  const sheet = sheetOf(record, options.sheet);
  const headerRow = options.headerRow ?? 1, headerIndex = headerRow - 1;
  const specs = new Map((options.columns ?? []).map(spec => [spec.column, spec]));
  const byColumn = new Map<string, SheetCell[]>(), headers = new Map<string, string>(), rowCells = new Map<number, Map<string, SheetCell>>();
  for (const cell of sheet.cells) {
    const letter = letterOf(cell.ref);
    if (cell.row === headerIndex) { headers.set(letter, cell.text.trim()); continue; }
    if (cell.row < headerIndex) continue;
    if (!byColumn.has(letter)) byColumn.set(letter, []);
    byColumn.get(letter)!.push(cell);
    if (!rowCells.has(cell.row)) rowCells.set(cell.row, new Map());
    rowCells.get(cell.row)!.set(letter, cell);
  }
  const columnIndex = (letter: string) => [...letter].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  const letters = [...new Set([...headers.keys(), ...byColumn.keys()])].sort((a, b) => columnIndex(a) - columnIndex(b));
  for (const letter of specs.keys()) if (!letters.includes(letter)) throw new DataError("COLUMN_UNKNOWN", `Column ${letter} has no heading or values in “${quote(sheet.name)}”.`, 400);
  const dataRows = [...rowCells.entries()].filter(([, cells]) => [...cells.values()].some(cell => !blank(cell))).sort((a, b) => a[0] - b[0]);
  if (!dataRows.length) throw new DataError("NO_ROWS", `“${quote(sheet.name)}” has headings but no rows of values below row ${headerRow}.`);
  if (dataRows.length > MAX_DATA_ROWS) throw new DataError("TOO_MANY_ROWS", `This sheet has more than ${MAX_DATA_ROWS.toLocaleString("en-US")} rows. Split it and report on each part.`);

  const issues: DataIssue[] = [], warnings: string[] = [];
  const notes = { times: 0 };
  const columns: DatasetColumn[] = letters.map(letter => {
    const header = headers.get(letter) || `Column ${letter}`, spec = specs.get(letter), cells = byColumn.get(letter) ?? [];
    const kind = spec?.kind ?? inferKind(cells, header);
    const column: DatasetColumn = { letter, header, kind, kindSource: spec?.kind ? "declared" : "inferred", counts: { values: 0, missing: 0, formulas: 0 }, suggestions: [],
      ...(spec?.dateFormat ? { dateFormat: spec.dateFormat } : {}), ...(spec?.decimal ? { decimal: spec.decimal } : {}) };
    if (kind === "money") {
      const declared = spec?.currency, heading = headingCurrency(header);
      if (declared) { column.currency = declared; column.currencySource = "declared"; } else if (heading) { column.currency = heading; column.currencySource = "heading"; }
    }
    if (kind === "number" || kind === "percent") { const unit = spec?.unit ?? headingUnit(header) ?? (kind === "percent" ? "%" : undefined); if (unit) column.unit = unit; }
    return column;
  });
  const columnByLetter = new Map(columns.map(column => [column.letter, column]));
  const ambiguous = new Map<string, { numbers: number; slash: number; dayFirst: number; monthFirst: number }>();
  const rows: DatasetRow[] = dataRows.map(([index, cells]) => {
    const values: Record<string, Value> = {};
    for (const column of columns) {
      const cell = cells.get(column.letter);
      let value: Value;
      if (!cell || blank(cell)) value = { kind: "missing", ref: `${column.letter}${index + 1}`, reason: "empty" };
      else if (column.kind === "text") { const bad = unusable(cell); value = bad ? { kind: "missing", ref: cell.ref, reason: bad } : MISSING.test(cell.text.trim()) ? { kind: "missing", ref: cell.ref, reason: `marked as not available (“${quote(cell.text, 16)}”)`, raw: cell.text.trim() } : { kind: "text", value: cell.text.trim(), ref: cell.ref }; }
      else if (column.kind === "date") value = readDate(cell, column.dateFormat, notes);
      else value = readNumber(cell, column);
      if (value.kind === "number") {
        if (column.kind === "money") {
          // Explicit currency marks on a cell win over the heading or declaration, so a mixed column is detected, never merged.
          if (!value.currency) value = column.currency ? { ...value, currency: column.currency } : value;
          else if (!column.currencySource) column.currencySource = "cells";
          if (value.unit === "%") value = { kind: "missing", ref: value.ref, reason: "a percentage in a money column" };
        } else if (column.kind === "percent") {
          if (!value.unit) value = { ...value, unit: "%" };
          else if (value.unit !== "%") value = { kind: "missing", ref: value.ref, reason: `a value in ${value.unit} in a percentage column` };
        } else if (!value.unit && column.unit) value = { ...value, unit: column.unit };
      }
      if (value.kind === "missing") {
        column.counts.missing++;
        if (cell && !blank(cell)) {
          issues.push({ ref: value.ref, column: column.letter, reason: value.reason, ...(value.raw ? { raw: value.raw } : {}) });
          const stats = ambiguous.get(column.letter) ?? { numbers: 0, slash: 0, dayFirst: 0, monthFirst: 0 };
          if (/choose the decimal mark/.test(value.reason)) stats.numbers++;
          const slash = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(cell.text.trim());
          if (slash) { stats.slash++; if (+slash[1] > 12) stats.dayFirst++; if (+slash[2] > 12) stats.monthFirst++; }
          ambiguous.set(column.letter, stats);
        }
      } else { column.counts.values++; if ("formula" in value && value.formula) column.counts.formulas++; }
      values[column.letter] = value;
    }
    return { row: index + 1, cells: values };
  });
  for (const [letter, stats] of ambiguous) {
    const column = columnByLetter.get(letter)!;
    if (stats.numbers && !column.decimal) column.suggestions.push({ kind: "decimal", message: `${stats.numbers} value${stats.numbers === 1 ? "" : "s"} like “1,234” could be read two ways. Choose whether this column uses a point or a comma for decimals.` });
    if (stats.slash && column.kind === "date" && !column.dateFormat) {
      const value = stats.dayFirst && !stats.monthFirst ? "DD/MM/YYYY" : stats.monthFirst && !stats.dayFirst ? "MM/DD/YYYY" : undefined;
      column.suggestions.push({ kind: "dateFormat", message: `${stats.slash} date${stats.slash === 1 ? "" : "s"} like 03/04/2026 could be day/month or month/day.${value ? ` Values such as ${value === "DD/MM/YYYY" ? "13/04/2026 suggest day/month" : "04/13/2026 suggest month/day"} order.` : stats.dayFirst && stats.monthFirst ? " This column mixes both orders, so it needs fixing in the file." : ""} Choose the date order for this column.`, ...(value ? { value } : {}) });
    }
  }
  if (notes.times) warnings.push(`${notes.times} date${notes.times === 1 ? "" : "s"} included a time of day; reports use the calendar date only.`);
  for (const column of columns) if (column.counts.formulas) warnings.push(`${column.counts.formulas} value${column.counts.formulas === 1 ? "" : "s"} in ${column.header} (column ${column.letter}) ${column.counts.formulas === 1 ? "is a formula result" : "are formula results"} as last saved in the file; formulas were not recalculated.`);
  for (const warning of record.warnings) if (!/formula cell/.test(warning)) warnings.push(warning);
  return {
    source: { sha256: record.sourceSha256, extractionVersion: record.extractionVersion, format: record.format, sheet: sheet.name, sheets: record.sheets.filter(item => item.kind !== "chart").map(item => item.name) },
    headerRow, columns, rows, issues, warnings,
  };
}

export const column = (dataset: Dataset, letter: string) => dataset.columns.find(item => item.letter === letter);
