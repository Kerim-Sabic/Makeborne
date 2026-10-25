import { createHash } from "node:crypto";
import type { Chart } from "../documents/schema";
import { canonicalSourceJson } from "../projects/canonical-json";
import { abs, cmp, decText, formatDec, parseDec, round, shift, type Dec } from "./decimal";
import { qualified, type DataIssue, type Dataset } from "./dataset";

/**
 * The facts sheet: every number a data report may show, computed by code, each
 * with an id (F001…), its exact decimal value, its display text, unit/currency,
 * how many values it used, and the exact cells it came from (sheet-qualified A1
 * ranges). Narrative text may only cite these ids; charts and tables are built
 * from them. It is stored with the saved report so any figure can be traced.
 */
export const FACTS_VERSION = "data-facts-2026-10-24.1";

export type FactKind = "sum" | "count" | "average" | "share" | "change" | "change_pct" | "ratio" | "min" | "max" | "value";
export type Fact = {
  id: string; key: string; label: string; kind: FactKind;
  /** Exact decimal text (rounded only where `rounding` says so). */
  value: string; display: string; compact: string;
  currency?: string; unit?: string;
  /** Values that contributed, and exactly where they are. */
  n: number; ranges: string[]; refs: string;
  missing?: { count: number; refs: string };
  denominator?: { value: string; label: string };
  method: string; rounding?: string;
  period?: { from: string; to: string };
};
export type FactTable = { id: string; title: string; columns: string[]; rows: { label: string; cells: { text: string; factId?: string }[] }[] };
export type FactChart = { id: string; section: string; title: string; chart: Chart; points: { category: string; series: string; factId: string; value: string }[] };
export type FactSection = { id: string; title: string; factIds: string[] };
export type FactsSheet = {
  version: typeof FACTS_VERSION; template: string; title: string; digest: string;
  source: Dataset["source"] & { assetId?: string; name?: string };
  columnsUsed: { role: string; letter: string; header: string; kind: string; currency?: string; unit?: string; ranges: string[] }[];
  period?: { from: string; to: string; column: string };
  facts: Fact[]; tables: FactTable[]; charts: FactChart[]; sections: FactSection[];
  issues: DataIssue[]; warnings: string[];
  /** Plain numbers the narrative may use besides fact values (counts it can state, years in the period). */
  allowedNumbers: string[];
};

export const ROUNDING = "rounded half away from zero";
export const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", JPY: "¥" };
export const currencyPlaces = (currency?: string) => currency === "JPY" ? 0 : 2;

/** Consecutive rows in one column collapse into a range: C2:C41, C43:C80. Exact: every listed cell contributed. */
export function rangesOf(sheet: string, refs: readonly string[]): string[] {
  const byColumn = new Map<string, number[]>();
  for (const ref of refs) {
    const match = /^([A-Z]{1,3})(\d+)$/.exec(ref);
    if (!match) continue;
    if (!byColumn.has(match[1])) byColumn.set(match[1], []);
    byColumn.get(match[1])!.push(Number(match[2]));
  }
  const out: string[] = [];
  for (const [letter, rows] of [...byColumn.entries()].sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))) {
    const sorted = [...new Set(rows)].sort((a, b) => a - b);
    let start = sorted[0], previous = sorted[0];
    for (const row of [...sorted.slice(1), Number.NaN]) {
      if (row === previous + 1) { previous = row; continue; }
      out.push(qualified(sheet, start === previous ? `${letter}${start}` : `${letter}${start}:${letter}${previous}`));
      start = row; previous = row;
    }
  }
  return out;
}
export function rangeText(ranges: readonly string[], max = 4) {
  if (ranges.length <= max) return ranges.join(", ");
  return `${ranges.slice(0, max).join(", ")} and ${ranges.length - max} more range${ranges.length - max === 1 ? "" : "s"}`;
}

export function formatMoney(value: Dec, currency?: string, places = currencyPlaces(currency)) {
  const text = formatDec(value, places);
  if (!currency) return text;
  const symbol = SYMBOLS[currency];
  const negative = text.startsWith("-");
  return symbol ? `${negative ? "-" : ""}${symbol}${negative ? text.slice(1) : text}` : `${text} ${currency}`;
}
export function compactOf(value: Dec, display: (value: Dec, places: number) => string, full: string) {
  const magnitude = abs(value);
  if (full.length <= 12) return full;
  const million = parseDec("1000000")!, thousand = parseDec("1000")!;
  if (cmp(magnitude, million) >= 0) return display(round(shift(value, -6), 2), 2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + "M";
  if (cmp(magnitude, thousand) >= 0) return display(round(shift(value, -3), 1), 1).replace(/\.0$/, "") + "k";
  return full;
}
/** Display text by kind: money with its currency, percentages with one decimal, counts as integers. */
export function display(value: Dec, kind: { currency?: string; unit?: string; places: number; signed?: boolean }) {
  const sign = kind.signed && value.digits > BigInt(0) ? "+" : "";
  if (kind.currency) return sign + formatMoney(value, kind.currency, kind.places);
  const text = formatDec(value, kind.places);
  if (!kind.unit) return sign + text;
  return sign + (kind.unit === "%" ? `${text}%` : `${text} ${kind.unit}`);
}

export type FactInput = Omit<Fact, "id" | "display" | "compact" | "ranges" | "refs" | "value"> & { value: Dec; places: number; signed?: boolean; cells: readonly string[]; missingCells?: readonly string[] };
/** Assigns stable ids in creation order; one fact per key. */
export class FactBook {
  readonly facts: Fact[] = [];
  private readonly keys = new Map<string, Fact>();
  constructor(private readonly sheet: string) {}
  add(input: FactInput): Fact {
    const existing = this.keys.get(input.key);
    if (existing) return existing;
    const ranges = rangesOf(this.sheet, input.cells);
    const missing = input.missingCells?.length ? { count: input.missingCells.length, refs: rangeText(rangesOf(this.sheet, input.missingCells), 6) } : undefined;
    const shown = display(input.value, input);
    const { places, signed, cells, missingCells, ...rest } = input;
    void places; void signed; void cells; void missingCells;
    const fact: Fact = { ...rest, id: `F${String(this.facts.length + 1).padStart(3, "0")}`, value: decText(input.value), display: shown,
      compact: compactOf(input.value, (value, digits) => display(value, { ...input, places: digits }), shown), ranges, refs: rangeText(ranges),
      ...(missing ? { missing } : {}) };
    this.facts.push(fact); this.keys.set(fact.key, fact);
    return fact;
  }
  get(key: string) { return this.keys.get(key); }
}

export function factsDigest(sheet: Omit<FactsSheet, "digest">): string {
  const { digest, ...rest } = sheet as FactsSheet;
  void digest;
  return createHash("sha256").update(canonicalSourceJson(JSON.parse(JSON.stringify(rest)))).digest("hex");
}
export function sealFacts(sheet: Omit<FactsSheet, "digest">): FactsSheet {
  return { ...sheet, digest: factsDigest(sheet) };
}
export const factById = (sheet: Pick<FactsSheet, "facts">, id: string) => sheet.facts.find(fact => fact.id === id);
