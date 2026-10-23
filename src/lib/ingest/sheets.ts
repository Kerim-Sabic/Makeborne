import type { ExtractionSheet, SheetCell } from "./record";

/** Deterministic spreadsheet helpers for later stages (data → deliverable). They work on
 * the extracted cells only: cached values, never formulas, and every result names the
 * exact cells it came from. Sums are exact decimal arithmetic over each saved number's
 * shortest exact form (at most 17 significant digits); otherwise `exact` is false. */

export type ColumnType = "number" | "date" | "text" | "boolean" | "mixed" | "empty";
export type ColumnProfile = {
  column: string; header: string; type: ColumnType; cells: number;
  counts: { number: number; date: number; text: number; boolean: number; error: number; formula: number };
};

const letters = (ref: string) => ref.replace(/[0-9]+$/, "");
function columnIndex(letter: string) { let value = 0; for (const char of letter) value = value * 26 + char.charCodeAt(0) - 64; return value - 1; }

/** A cell's numeric value, if it is one: Excel numbers, percentages, currency, or CSV values recognised as numbers. */
export function numericValue(cell: SheetCell): number | null {
  if ((cell.kind === "number" || cell.kind === "percent" || cell.kind === "currency") && typeof cell.value === "number") return cell.value;
  if (typeof cell.number === "number") return cell.number;
  return null;
}

function rows(sheet: ExtractionSheet) {
  const byRow = new Map<number, Map<number, SheetCell>>();
  for (const cell of sheet.cells) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, new Map());
    byRow.get(cell.row)!.set(cell.col, cell);
  }
  return byRow;
}

/** Resolves a column given as a letter ("B") or a header text in the header row. */
export function resolveColumn(sheet: ExtractionSheet, column: string, headerRow = 1): number {
  if (/^[A-Z]{1,3}$/.test(column)) return columnIndex(column);
  const header = sheet.cells.filter(cell => cell.row === headerRow - 1 && cell.text.trim().toLowerCase() === column.trim().toLowerCase());
  if (header.length !== 1) throw new Error(header.length ? `More than one column is headed “${column}”.` : `No column is headed “${column}”.`);
  return header[0].col;
}

export function inferColumns(sheet: ExtractionSheet, headerRow = 1): ColumnProfile[] {
  const byColumn = new Map<number, SheetCell[]>();
  for (const cell of sheet.cells) if (cell.row > headerRow - 1) { if (!byColumn.has(cell.col)) byColumn.set(cell.col, []); byColumn.get(cell.col)!.push(cell); }
  const headers = new Map(sheet.cells.filter(cell => cell.row === headerRow - 1).map(cell => [cell.col, cell.text]));
  const columns = [...new Set([...byColumn.keys(), ...headers.keys()])].sort((a, b) => a - b);
  return columns.map(col => {
    const cells = byColumn.get(col) ?? [];
    const counts = { number: 0, date: 0, text: 0, boolean: 0, error: 0, formula: 0 };
    for (const cell of cells) {
      if (cell.formula) counts.formula++;
      if (cell.kind === "date" || cell.date) counts.date++;
      else if (numericValue(cell) !== null) counts.number++;
      else if (cell.kind === "boolean") counts.boolean++;
      else if (cell.kind === "error") counts.error++;
      else if (cell.text.trim()) counts.text++;
    }
    const kinds = (["number", "date", "text", "boolean"] as const).filter(kind => counts[kind] > 0);
    const type: ColumnType = !cells.length ? "empty" : kinds.length === 1 && !counts.error ? kinds[0] : "mixed";
    const ref = cells[0]?.ref ?? sheet.cells.find(cell => cell.col === col)?.ref ?? "A1";
    return { column: letters(ref), header: headers.get(col) ?? "", type, cells: cells.length, counts };
  });
}

/** Exact decimal sum of the numbers as written (shortest round-trip form, at most 17 significant digits). */
function exactSum(values: number[]): { sum: number; exact: string } | null {
  let scale = 0;
  const parts: { digits: bigint; scale: number }[] = [];
  for (const value of values) {
    const text = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(text) || text.replace(/[-.]/g, "").replace(/^0+/, "").length > 17) return null;
    const [whole, fraction = ""] = text.replace("-", "").split(".");
    parts.push({ digits: BigInt((text.startsWith("-") ? "-" : "") + whole + fraction), scale: fraction.length });
    scale = Math.max(scale, fraction.length);
  }
  let total = BigInt(0);
  for (const part of parts) total += part.digits * BigInt(10) ** BigInt(scale - part.scale);
  const negative = total < BigInt(0);
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const exact = `${negative ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits}`;
  return { sum: Number(exact), exact };
}

export type GroupResult = {
  key: string; count: number; sum: number; sumText: string; exact: boolean; average: number; min: number; max: number;
  /** Every value cell that contributed, e.g. ["C2", "C5"]. */
  cells: string[]; fromFormulas: number;
};
export type AggregateResult = { sheet: string; groupColumn: string; valueColumn: string; groups: GroupResult[]; skipped: { ref: string; reason: string }[] };

/** count/sum/average/min/max of one column grouped by another, with cell-reference provenance.
 * Rows without a group or a numeric value are listed in `skipped`, never silently dropped. */
export function aggregateBy(sheet: ExtractionSheet, options: { groupBy: string; value: string; headerRow?: number }): AggregateResult {
  const headerRow = options.headerRow ?? 1;
  const groupCol = resolveColumn(sheet, options.groupBy, headerRow), valueCol = resolveColumn(sheet, options.value, headerRow);
  const groups = new Map<string, { values: number[]; cells: string[]; fromFormulas: number }>();
  const skipped: { ref: string; reason: string }[] = [];
  for (const [row, cells] of [...rows(sheet).entries()].sort((a, b) => a[0] - b[0])) {
    if (row <= headerRow - 1) continue;
    const group = cells.get(groupCol), value = cells.get(valueCol);
    if (!value) { if (group) skipped.push({ ref: group.ref, reason: "no value in this row" }); continue; }
    const number = numericValue(value);
    if (number === null) { skipped.push({ ref: value.ref, reason: value.kind === "error" ? `error value ${value.text}` : "not a number" }); continue; }
    const key = group?.text.trim() ?? "";
    if (!key) { skipped.push({ ref: value.ref, reason: "no group in this row" }); continue; }
    if (!groups.has(key)) groups.set(key, { values: [], cells: [], fromFormulas: 0 });
    const entry = groups.get(key)!;
    entry.values.push(number); entry.cells.push(value.ref);
    if (value.formula) entry.fromFormulas++;
  }
  return {
    sheet: sheet.name, groupColumn: options.groupBy, valueColumn: options.value, skipped,
    groups: [...groups.entries()].map(([key, entry]) => {
      const exact = exactSum(entry.values);
      const sum = exact ? exact.sum : entry.values.reduce((total, value) => total + value, 0);
      return { key, count: entry.values.length, sum, sumText: exact ? exact.exact : String(sum), exact: Boolean(exact), average: sum / entry.values.length,
        min: Math.min(...entry.values), max: Math.max(...entry.values), cells: entry.cells, fromFormulas: entry.fromFormulas };
    }),
  };
}
