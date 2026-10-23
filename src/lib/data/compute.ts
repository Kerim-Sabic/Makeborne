import { exactSum } from "../ingest/sheets";
import { add, cmp, dec, decText, divide, isZero, parseDec, sub, abs, shift, type Dec } from "./decimal";
import { DataError, type Dataset, type DatasetRow, type Value } from "./dataset";

/**
 * Deterministic computations over a typed dataset. They never guess: a value
 * that is missing stays missing (and is reported with its cell), amounts in
 * different currencies or units are never added together, division by zero
 * yields "not defined" (null), and every result lists the cells it used.
 */
export type NumberCell = { value: Dec; ref: string; row: number; currency?: string; unit?: string };
export type Missing = { ref: string; reason: string };

export function numberCells(rows: readonly DatasetRow[], letter: string): { values: NumberCell[]; missing: Missing[] } {
  const values: NumberCell[] = [], missing: Missing[] = [];
  for (const row of rows) {
    const cell: Value | undefined = row.cells[letter];
    if (cell?.kind === "number") values.push({ value: cell.value, ref: cell.ref, row: row.row, ...(cell.currency ? { currency: cell.currency } : {}), ...(cell.unit ? { unit: cell.unit } : {}) });
    else missing.push({ ref: cell?.ref ?? `${letter}${row.row}`, reason: cell?.kind === "missing" ? cell.reason : "not a number" });
  }
  return { values, missing };
}
export function textOf(row: DatasetRow, letter: string): string | null {
  const cell = row.cells[letter];
  return cell?.kind === "text" ? cell.value : cell?.kind === "number" ? decText(cell.value) : cell?.kind === "date" ? cell.value : null;
}
export function dateOf(row: DatasetRow, letter: string): string | null {
  const cell = row.cells[letter];
  return cell?.kind === "date" ? cell.value : null;
}

const sample = (refs: string[]) => refs.slice(0, 3).join(", ") + (refs.length > 3 ? ` and ${refs.length - 3} more` : "");
/** The one currency of a set of amounts, or a refusal naming the cells: amounts are never converted or merged. */
export function commonCurrency(values: readonly NumberCell[], label: string): string | undefined {
  const by = new Map<string, string[]>();
  for (const value of values) { const key = value.currency ?? "none"; if (!by.has(key)) by.set(key, []); by.get(key)!.push(value.ref); }
  if (by.size <= 1) { const only = [...by.keys()][0]; return only && only !== "none" && only !== "?" ? only : undefined; }
  const parts = [...by.entries()].map(([currency, refs]) => `${currency === "none" || currency === "?" ? "no currency mark" : currency} (${sample(refs)})`);
  throw new DataError("MIXED_CURRENCY", `${label} mixes currencies: ${parts.join("; ")}. Amounts in different currencies are never added together. Convert them in the file, or choose to report each currency separately.`);
}
export function commonUnit(values: readonly NumberCell[], label: string): string | undefined {
  const by = new Map<string, string[]>();
  for (const value of values) { const key = value.unit ?? "none"; if (!by.has(key)) by.set(key, []); by.get(key)!.push(value.ref); }
  if (by.size <= 1) { const only = [...by.keys()][0]; return only && only !== "none" ? only : undefined; }
  const parts = [...by.entries()].map(([unit, refs]) => `${unit === "none" ? "no unit" : unit} (${sample(refs)})`);
  throw new DataError("MIXED_UNIT", `${label} mixes units: ${parts.join("; ")}. Values in different units are never combined. Convert them in the file first.`);
}

/** Exact total. Values read from saved binary numbers are cross-checked against the ingestion helper's exact sum. */
export function total(values: readonly NumberCell[]): Dec {
  const result = values.reduce((sum, value) => add(sum, value.value), dec(BigInt(0)));
  const numbers = values.map(value => Number(decText(value.value)));
  if (numbers.every((number, index) => Number.isFinite(number) && String(number) === decText(values[index].value))) {
    const check = exactSum(numbers);
    if (check && check.exact !== decText(result)) throw new Error(`Exact sum mismatch: ${check.exact} vs ${decText(result)}`);
  }
  return result;
}
export const count = (n: number) => dec(BigInt(n));
/** a / b, or null when b is zero. */
export const ratio = (a: Dec, b: Dec, places: number) => divide(a, b, places);
/** (a / b) × 100 in percentage points, or null when b is zero. */
export const percentOf = (a: Dec, b: Dec, places = 1) => isZero(b) ? null : divide(shift(a, 2), b, places);
/** (current − previous) / |previous| × 100, or null when previous is zero. */
export function percentChange(current: Dec, previous: Dec, places = 1) {
  if (isZero(previous)) return null;
  return divide(shift(sub(current, previous), 2), abs(previous), places);
}
export const max = (values: readonly Dec[]) => values.reduce((best, value) => cmp(value, best) > 0 ? value : best);
export const min = (values: readonly Dec[]) => values.reduce((best, value) => cmp(value, best) < 0 ? value : best);
export const ZERO = parseDec("0")!;

/** Calendar months between two YYYY-MM keys, inclusive (no time zones involved). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  while ((year < endYear || (year === endYear && month <= endMonth)) && out.length < 600) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month++; if (month > 12) { month = 1; year++; }
  }
  return out;
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (key: string, short = false) => { const [year, month] = key.split("-").map(Number); const name = MONTH_NAMES[month - 1]; return `${short ? name.slice(0, 3) : name} ${year}`; };
export const previousMonth = (key: string) => { const [year, month] = key.split("-").map(Number); return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`; };

export function datasetColumn(dataset: Dataset, letter: string) {
  const column = dataset.columns.find(item => item.letter === letter);
  if (!column) throw new DataError("COLUMN_UNKNOWN", `Column ${letter} is not in this sheet.`, 400);
  return column;
}
