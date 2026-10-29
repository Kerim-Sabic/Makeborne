import { z } from "zod";
import { ChartSchema, type Chart } from "../documents/schema";
import { cmp, dec, decText, divide, parseDec, sub, toNumber, type Dec } from "./decimal";
import { DataError, type ColumnKind, type Dataset, type DatasetRow } from "./dataset";
import { commonCurrency, commonUnit, count, dateOf, datasetColumn, min, max, monthLabel, monthsBetween, numberCells, percentChange, percentOf, previousMonth, ratio, textOf, total, type NumberCell } from "./compute";
import { FACTS_VERSION, FactBook, ROUNDING, SYMBOLS, currencyPlaces, rangesOf, sealFacts, type Fact, type FactChart, type FactSection, type FactTable, type FactsSheet } from "./facts";
import type { Narrative } from "./narrative";

/**
 * The four supported data-to-deliverable tasks. Each one maps columns to roles
 * (detected from headings, always overridable), computes its facts sheet with
 * deterministic code, and writes a plain summary that cites only fact ids.
 *   sales_monthly        sales spreadsheet → monthly report (book)
 *   survey_findings      survey data → findings presentation (deck)
 *   catalogue_comparison product catalogue → comparison content (book section + website-ready table data)
 *   campaign_report      campaign results → client report with native editable charts (deck)
 */
export const TEMPLATE_IDS = ["sales_monthly", "survey_findings", "catalogue_comparison", "campaign_report"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
type RoleSpec = { role: string; label: string; kinds: readonly ColumnKind[]; required: boolean; multiple?: boolean; match: RegExp };
export type TemplateInfo = { id: TemplateId; label: string; description: string; artifact: "book" | "presentation"; roles: readonly RoleSpec[] };
const money = ["money", "number"] as const;
export const TEMPLATES: Readonly<Record<TemplateId, TemplateInfo>> = Object.freeze({
  sales_monthly: { id: "sales_monthly", label: "Monthly sales report", description: "Totals by month, change on the previous month and top categories, as a report document.", artifact: "book", roles: [
    { role: "date", label: "Date", kinds: ["date"], required: true, match: /date|day|datum|ordered|invoice/i },
    { role: "amount", label: "Amount", kinds: money, required: true, match: /revenue|sales|amount|total|net|gross|value|iznos|prihod|price/i },
    { role: "category", label: "Category", kinds: ["text"], required: false, match: /category|product|item|sku|region|channel|segment|store|line/i },
  ] },
  survey_findings: { id: "survey_findings", label: "Survey findings", description: "Answers per question with counts and percentages, and one comparison by group, as a presentation.", artifact: "presentation", roles: [
    { role: "questions", label: "Questions", kinds: ["text", "number"], required: true, multiple: true, match: /\?|how|what|which|would|rate|satisf|recommend|agree|prefer|often|likely/i },
    { role: "segment", label: "Compare by", kinds: ["text"], required: false, match: /segment|group|region|department|age|role|plan|country|team|customer type/i },
  ] },
  catalogue_comparison: { id: "catalogue_comparison", label: "Product comparison", description: "A comparison table with ranges per attribute, as a document section and website-ready table data.", artifact: "book", roles: [
    { role: "name", label: "Product", kinds: ["text"], required: true, match: /name|product|model|item|title|sku/i },
    { role: "price", label: "Price", kinds: ["money", "number"], required: false, match: /price|cost|rrp|msrp|cijena/i },
    { role: "attributes", label: "Attributes", kinds: ["number", "percent", "text", "money"], required: false, multiple: true, match: /./ },
  ] },
  campaign_report: { id: "campaign_report", label: "Campaign client report", description: "Spend, results and efficiency per campaign with editable charts, as a presentation.", artifact: "presentation", roles: [
    { role: "campaign", label: "Campaign", kinds: ["text"], required: true, match: /campaign|channel|ad ?set|source|platform/i },
    { role: "spend", label: "Spend", kinds: money, required: true, match: /spend|cost|budget|amount spent/i },
    { role: "impressions", label: "Impressions", kinds: ["number"], required: false, match: /impression|views|reach/i },
    { role: "clicks", label: "Clicks", kinds: ["number"], required: false, match: /click/i },
    { role: "conversions", label: "Conversions", kinds: ["number"], required: false, match: /conversion|leads|purchases|sign.?ups|orders|results/i },
    { role: "revenue", label: "Revenue", kinds: money, required: false, match: /revenue|sales|value|income/i },
    { role: "date", label: "Date", kinds: ["date"], required: false, match: /date|day|week|month/i },
  ] },
});

const Letter = z.string().regex(/^[A-Z]{1,3}$/);
export const RolesSchema = z.record(z.string().regex(/^[a-z]{2,20}$/), z.union([Letter, z.array(Letter).max(12)]));
export type Roles = z.infer<typeof RolesSchema>;
export const ReportOptionsSchema = z.object({ mixedCurrency: z.enum(["refuse", "separate"]).default("refuse") }).strict();
export type ReportOptions = z.infer<typeof ReportOptionsSchema>;

const ID_LIKE = /^(id|#|no\.?|respondent|response ?id|record|row|timestamp|submitted|start(ed)?|end(ed)?|email|name)$/i;
/** Column roles from headings and column kinds. Always shown in the preview and overridable. */
export function detectRoles(template: TemplateId, dataset: Dataset): Roles {
  const used = new Set<string>(), roles: Roles = {};
  const info = TEMPLATES[template];
  for (const spec of info.roles.filter(item => !item.multiple)) {
    const candidates = dataset.columns.filter(column => !used.has(column.letter) && spec.kinds.includes(column.kind));
    const pick = candidates.find(column => spec.match.test(column.header)) ?? (spec.required ? candidates[0] : undefined);
    if (pick) { roles[spec.role] = pick.letter; used.add(pick.letter); }
  }
  for (const spec of info.roles.filter(item => item.multiple)) {
    const columns = dataset.columns.filter(column => !used.has(column.letter) && spec.kinds.includes(column.kind) && column.kind !== "date" && !ID_LIKE.test(column.header.trim()));
    // Survey questions are columns with a small set of answers; free-text columns are left for the person to add (and are then reported as free text).
    const distinct = (letter: string) => new Set(dataset.rows.map(row => row.cells[letter]).filter(cell => cell && cell.kind !== "missing").map(cell => cell.kind === "number" ? decText(cell.value) : String(cell.value))).size;
    const matched = template === "survey_findings" ? columns.filter(column => column.counts.values > 0 && distinct(column.letter) <= 12) : columns;
    if (matched.length) roles[spec.role] = matched.slice(0, template === "survey_findings" ? 8 : 6).map(column => column.letter);
  }
  return roles;
}

function roleColumn(dataset: Dataset, roles: Roles, template: TemplateId, role: string) {
  const spec = TEMPLATES[template].roles.find(item => item.role === role)!;
  const letter = roles[role];
  if (letter === undefined) { if (spec.required) throw new DataError("ROLE_MISSING", `Choose the ${spec.label.toLowerCase()} column.`, 400); return null; }
  if (Array.isArray(letter)) throw new DataError("ROLE_INVALID", `Choose one column for ${spec.label.toLowerCase()}.`, 400);
  const column = datasetColumn(dataset, letter);
  if (!spec.kinds.includes(column.kind)) throw new DataError("ROLE_KIND", `${column.header} (column ${letter}) holds ${column.kind === "text" ? "text" : `${column.kind} values`}, but ${spec.label.toLowerCase()} needs ${spec.kinds.join(" or ")} values. Change the column or its type.`, 400);
  return column;
}
function roleColumns(dataset: Dataset, roles: Roles, template: TemplateId, role: string) {
  const spec = TEMPLATES[template].roles.find(item => item.role === role)!;
  const letters = roles[role] === undefined ? [] : Array.isArray(roles[role]) ? roles[role] as string[] : [roles[role] as string];
  if (spec.required && !letters.length) throw new DataError("ROLE_MISSING", `Choose at least one ${spec.label.toLowerCase().replace(/s$/, "")} column.`, 400);
  if (new Set(letters).size !== letters.length) throw new DataError("ROLE_INVALID", `A column is listed twice under ${spec.label.toLowerCase()}.`, 400);
  return letters.map(letter => { const column = datasetColumn(dataset, letter); if (!spec.kinds.includes(column.kind)) throw new DataError("ROLE_KIND", `${column.header} (column ${letter}) can’t be used under ${spec.label.toLowerCase()}.`, 400); return column; });
}
function distinctRoles(roles: Roles) {
  const all = Object.values(roles).flatMap(value => Array.isArray(value) ? value : [value]);
  if (new Set(all).size !== all.length) throw new DataError("ROLE_INVALID", "Each column can have only one role.", 400);
}

const label28 = (text: string) => text.length > 28 ? `${text.slice(0, 27)}…` : text;
const chartSource = (dataset: Dataset, ranges: string[]) => { const text = `${dataset.source.name ?? dataset.source.sheet}: ${ranges.slice(0, 3).join(", ")}${ranges.length > 3 ? "…" : ""}`; return text.length > 140 ? `${text.slice(0, 139)}…` : text; };
const chartUnit = (fact: Pick<Fact, "currency" | "unit">) => fact.currency ? (SYMBOLS[fact.currency] ?? fact.currency) : fact.unit === "%" ? "%" : fact.unit?.slice(0, 8);
function makeChart(id: string, section: string, title: string, type: Chart["type"], categories: string[], series: { name: string; facts: Fact[] }[], dataset: Dataset, extra: Partial<Chart> = {}): FactChart | null {
  if (categories.length < 2 || categories.length > 12) return null;
  const first = series[0].facts[0];
  const chart = ChartSchema.safeParse({ type, categories: categories.map(label28), series: series.map(item => ({ name: item.name.slice(0, 40), values: item.facts.map(fact => toNumber(fromText(fact.value))) })),
    ...(chartUnit(first) ? { unit: chartUnit(first) } : {}), ...(first.currency && SYMBOLS[first.currency] ? { unitPosition: "prefix" as const } : {}),
    source: chartSource(dataset, [...new Set(series.flatMap(item => item.facts.flatMap(fact => fact.ranges)))]), ...extra });
  if (!chart.success) return null;
  return { id, section, title, chart: chart.data, points: series.flatMap(item => item.facts.map((fact, index) => ({ category: categories[index], series: item.name, factId: fact.id, value: fact.value }))) };
}
/** A fact's exact value back as a decimal (facts store canonical decimal text). */
const fromText = (text: string): Dec => parseDec(text)!;

type Built = { facts: Omit<FactsSheet, "digest" | "version" | "template" | "title" | "source" | "issues">; title: string };
export type ComputeInput = { template: TemplateId; dataset: Dataset; roles: Roles; options?: Partial<ReportOptions> };

/** The facts sheet for one task. Refusals (mixed currencies or units, missing roles) are DataErrors with a specific message. */
export function computeFacts(input: ComputeInput): FactsSheet {
  const options = ReportOptionsSchema.parse(input.options ?? {});
  const roles = RolesSchema.parse(input.roles);
  distinctRoles(roles);
  const built = input.template === "sales_monthly" ? sales(input.dataset, roles, options)
    : input.template === "survey_findings" ? survey(input.dataset, roles)
    : input.template === "catalogue_comparison" ? catalogue(input.dataset, roles)
    : campaign(input.dataset, roles);
  return sealFacts({ version: FACTS_VERSION, template: input.template, title: built.title, source: input.dataset.source, ...built.facts,
    issues: input.dataset.issues, warnings: [...input.dataset.warnings, ...built.facts.warnings] });
}

const used = (dataset: Dataset, role: string, letter: string, refs: string[]) => {
  const column = datasetColumn(dataset, letter);
  return { role, letter, header: column.header, kind: column.kind, ...(column.currency ? { currency: column.currency } : {}), ...(column.unit ? { unit: column.unit } : {}), ranges: rangesOf(dataset.source.sheet, refs) };
};
const periodText = (from: string, to: string) => from.slice(0, 7) === to.slice(0, 7) ? monthLabel(from.slice(0, 7)) : `${monthLabel(from.slice(0, 7))} to ${monthLabel(to.slice(0, 7))}`;

// ---------------------------------------------------------------- sales → monthly report
function sales(dataset: Dataset, roles: Roles, options: ReportOptions): Built {
  const dateColumn = roleColumn(dataset, roles, "sales_monthly", "date")!, amountColumn = roleColumn(dataset, roles, "sales_monthly", "amount")!;
  const categoryColumn = roleColumn(dataset, roles, "sales_monthly", "category");
  const book = new FactBook(dataset.source.sheet);
  const { values, missing } = numberCells(dataset.rows, amountColumn.letter);
  if (!values.length) throw new DataError("NO_VALUES", `${amountColumn.header} (column ${amountColumn.letter}) has no amounts that can be read.`);
  let groups: [string | undefined, NumberCell[]][];
  try { groups = [[commonCurrency(values, amountColumn.header), values]]; }
  catch (error) {
    if (!(error instanceof DataError) || options.mixedCurrency !== "separate") throw error;
    const by = new Map<string, NumberCell[]>();
    for (const value of values) { const key = value.currency ?? "?"; if (!by.has(key)) by.set(key, []); by.get(key)!.push(value); }
    if (by.has("?")) throw new DataError("MIXED_CURRENCY", `${by.get("?")!.length} amount${by.get("?")!.length === 1 ? " has" : "s have"} no currency mark (${by.get("?")!.slice(0, 3).map(value => value.ref).join(", ")}), so they can’t be placed in any currency. Add the currency in the file.`);
    if (by.size > 3) throw new DataError("MIXED_CURRENCY", `${amountColumn.header} has amounts in ${by.size} currencies; a report can show at most 3 side by side.`);
    groups = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
  commonUnit(values.filter(value => !value.currency), amountColumn.header);
  const separate = groups.length > 1;
  const byRow = new Map(dataset.rows.map(row => [row.row, row]));
  const dates = dataset.rows.map(row => dateOf(row, dateColumn.letter)).filter((value): value is string => Boolean(value)).sort();
  if (!dates.length) throw new DataError("NO_VALUES", `${dateColumn.header} (column ${dateColumn.letter}) has no dates that can be read.${dateColumn.suggestions.length ? ` ${dateColumn.suggestions[0].message}` : ""}`);
  const period = { from: dates[0], to: dates.at(-1)!, column: dateColumn.letter };
  const sections: FactSection[] = [{ id: "overview", title: "Overview", factIds: [] }, { id: "monthly", title: "By month", factIds: [] }];
  if (categoryColumn) sections.push({ id: "categories", title: `By ${categoryColumn.header.toLowerCase()}`, factIds: [] });
  const tables: FactTable[] = [], charts: FactChart[] = [], warnings: string[] = [];
  const allowed = new Set<string>();
  const missingAmounts = missing.map(item => item.ref);
  const monthKeys = [...new Set(dates.map(date => date.slice(0, 7)))].sort();
  allowed.add(String(monthKeys.length));
  for (const [currency, cells] of groups) {
    const suffix = separate ? `.${currency}` : "", inCur = separate ? ` in ${currency}` : "";
    const kind = { currency, unit: currency ? undefined : cells[0]?.unit, places: currency ? currencyPlaces(currency) : Math.min(4, Math.max(0, ...cells.map(cell => cell.value.scale))) };
    const totalFact = book.add({ key: `total${suffix}`, label: `Total ${amountColumn.header}${inCur}`, kind: "sum", value: total(cells), ...kind, n: cells.length, cells: cells.map(cell => cell.ref),
      missingCells: separate ? undefined : missingAmounts, method: `Sum of every readable amount in ${amountColumn.header} (column ${amountColumn.letter})${inCur}.`, period: { from: period.from, to: period.to } });
    const rowsFact = book.add({ key: `rows${suffix}`, label: `Rows with an amount${inCur}`, kind: "count", value: count(cells.length), places: 0, n: cells.length, cells: cells.map(cell => cell.ref), method: "Number of rows with a readable amount." });
    const average = divide(total(cells), count(cells.length), kind.places);
    const averageFact = average ? book.add({ key: `average${suffix}`, label: `Average amount per row${inCur}`, kind: "average", value: average, ...kind, n: cells.length, cells: cells.map(cell => cell.ref),
      method: `Total divided by the ${cells.length} rows with an amount.`, rounding: `${ROUNDING} to ${kind.places} decimal places` }) : null;
    sections[0].factIds.push(totalFact.id, rowsFact.id, ...(averageFact ? [averageFact.id] : []));
    // By calendar month of the date column (dates are calendar dates: no time zone can move a sale to another month).
    const months = new Map<string, NumberCell[]>(), undated: NumberCell[] = [];
    for (const cell of cells) {
      const date = dateOf(byRow.get(cell.row)!, dateColumn.letter);
      if (!date) { undated.push(cell); continue; }
      const key = date.slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key)!.push(cell);
    }
    const monthFacts: { key: string; fact: Fact; rows: number }[] = [];
    for (const key of [...months.keys()].sort()) {
      const items = months.get(key)!;
      const fact = book.add({ key: `month.${key}${suffix}`, label: `${amountColumn.header}, ${monthLabel(key)}${inCur}`, kind: "sum", value: total(items), ...kind, n: items.length, cells: items.map(cell => cell.ref),
        method: `Sum of amounts dated in ${monthLabel(key)} (${dateColumn.header}, column ${dateColumn.letter}).`, period: { from: `${key}-01`, to: `${key}-31` } });
      monthFacts.push({ key, fact, rows: items.length });
      sections[1].factIds.push(fact.id);
    }
    const empty = monthKeys.length ? monthsBetween(monthKeys[0], monthKeys.at(-1)!).filter(key => !months.has(key)) : [];
    if (empty.length) warnings.push(`No ${separate ? `${currency} ` : ""}amounts are dated in ${empty.map(key => monthLabel(key)).join(", ")}; ${empty.length === 1 ? "that month is" : "those months are"} left out, not shown as zero.`);
    let undatedFact: Fact | null = null;
    if (undated.length) {
      undatedFact = book.add({ key: `undated${suffix}`, label: `Amounts without a readable date${inCur}`, kind: "sum", value: total(undated), ...kind, n: undated.length, cells: undated.map(cell => cell.ref),
        method: "Included in the total but in no month, because the date is missing or unreadable." });
      sections[1].factIds.push(undatedFact.id);
    }
    // Latest month against the calendar month before it, only when that month has data.
    const latest = monthFacts.at(-1);
    let changeFacts: Fact[] = [];
    if (latest) {
      const before = monthFacts.find(item => item.key === previousMonth(latest.key));
      const latestValue = fromText(latest.fact.value);
      if (before) {
        const beforeValue = fromText(before.fact.value);
        const difference = sub(latestValue, beforeValue);
        const change = book.add({ key: `change${suffix}`, label: `Change, ${monthLabel(latest.key)} on ${monthLabel(before.key)}${inCur}`, kind: "change", value: difference, ...kind, signed: true, n: latest.rows + before.rows,
          cells: [...months.get(latest.key)!, ...months.get(before.key)!].map(cell => cell.ref), method: `${monthLabel(latest.key)} total minus ${monthLabel(before.key)} total.` });
        changeFacts = [change];
        const pct = percentChange(latestValue, beforeValue, 1);
        if (pct) changeFacts.push(book.add({ key: `change-pct${suffix}`, label: `Change in percent, ${monthLabel(latest.key)} on ${monthLabel(before.key)}${inCur}`, kind: "change_pct", value: pct, unit: "%", places: 1, signed: true,
          n: latest.rows + before.rows, cells: change.ranges.length ? [...months.get(latest.key)!, ...months.get(before.key)!].map(cell => cell.ref) : [], denominator: { value: before.fact.value, label: `${monthLabel(before.key)} total` },
          method: `(latest − previous) ÷ previous × 100.`, rounding: `${ROUNDING} to 1 decimal place` }));
        else warnings.push(`${monthLabel(before.key)} totals zero, so the change in percent is not defined.`);
      } else if (monthFacts.length > 1) warnings.push(`There are no amounts dated in ${monthLabel(previousMonth(latest.key))}, so the change for ${monthLabel(latest.key)} is not computed.`);
      sections[0].factIds.push(latest.fact.id, ...changeFacts.map(fact => fact.id));
    }
    if (monthFacts.length > 1) {
      const best = monthFacts.reduce((a, b) => cmp(fromText(b.fact.value), fromText(a.fact.value)) > 0 ? b : a);
      const bestFact = book.add({ key: `best-month${suffix}`, label: `Highest month: ${monthLabel(best.key)}${inCur}`, kind: "max", value: fromText(best.fact.value), ...kind, n: best.rows, cells: months.get(best.key)!.map(cell => cell.ref), method: `The month with the highest total.` });
      sections[0].factIds.push(bestFact.id);
    }
    tables.push({ id: `monthly${suffix}`, title: `${amountColumn.header} by month${inCur}`, columns: ["Month", amountColumn.header, "Rows", "Change"], rows: [
      ...monthFacts.map((item, index) => {
        const previous = index > 0 && monthFacts[index - 1].key === previousMonth(item.key) ? monthFacts[index - 1] : null;
        let changeCell = { text: "—" } as { text: string; factId?: string };
        // The latest month's change is the headline fact already; reuse it rather than state it twice.
        const headline = item.key === latest?.key ? changeFacts.find(fact => fact.kind === "change_pct") : undefined;
        if (headline) changeCell = { text: headline.display, factId: headline.id };
        else if (previous) {
          const pct = percentChange(fromText(item.fact.value), fromText(previous.fact.value), 1);
          if (pct) { const fact = book.add({ key: `mom.${item.key}${suffix}`, label: `Change in percent, ${monthLabel(item.key)} on ${monthLabel(previous.key)}${inCur}`, kind: "change_pct", value: pct, unit: "%", places: 1, signed: true, n: item.rows + previous.rows,
            cells: [...months.get(item.key)!, ...months.get(previous.key)!].map(cell => cell.ref), denominator: { value: previous.fact.value, label: `${monthLabel(previous.key)} total` }, method: "(month − previous month) ÷ previous month × 100.", rounding: `${ROUNDING} to 1 decimal place` });
            changeCell = { text: fact.display, factId: fact.id }; }
        }
        return { label: monthLabel(item.key), cells: [{ text: monthLabel(item.key) }, { text: item.fact.display, factId: item.fact.id }, { text: String(item.rows) }, changeCell] };
      }),
      ...(undatedFact ? [{ label: "No readable date", cells: [{ text: "No readable date" }, { text: undatedFact.display, factId: undatedFact.id }, { text: String(undatedFact.n) }, { text: "—" }] }] : []),
      { label: "Total", cells: [{ text: "Total" }, { text: totalFact.display, factId: totalFact.id }, { text: String(totalFact.n) }, { text: "" }] },
    ] });
    const shown = monthFacts.slice(-12);
    if (shown.length < monthFacts.length) warnings.push(`The chart shows the latest 12 of ${monthFacts.length} months; the table lists every month.`);
    const monthly = makeChart(`monthly${suffix}`, "monthly", `${amountColumn.header} by month${inCur}`, shown.length >= 3 ? "line" : "column", shown.map(item => monthLabel(item.key, true)), [{ name: amountColumn.header, facts: shown.map(item => item.fact) }], dataset, { highlight: shown.length - 1 });
    if (monthly) charts.push(monthly);
    // Categories: top five by total, the rest as one "Other" row, and rows without a category kept visible.
    if (categoryColumn) {
      const by = new Map<string, NumberCell[]>(), none: NumberCell[] = [];
      for (const cell of cells) { const key = textOf(byRow.get(cell.row)!, categoryColumn.letter); if (!key) { none.push(cell); continue; } if (!by.has(key)) by.set(key, []); by.get(key)!.push(cell); }
      const ranked = [...by.entries()].map(([key, items]) => ({ key, items, sum: total(items) })).sort((a, b) => cmp(b.sum, a.sum) || a.key.localeCompare(b.key));
      const top = ranked.slice(0, 5), rest = ranked.slice(5);
      const grand = fromText(totalFact.value);
      const rows: FactTable["rows"] = [], chartFacts: Fact[] = [], chartLabels: string[] = [];
      const addRow = (key: string, label: string, items: NumberCell[], method: string) => {
        const fact = book.add({ key: `category.${key}${suffix}`, label: `${amountColumn.header}, ${label}${inCur}`, kind: "sum", value: total(items), ...kind, n: items.length, cells: items.map(cell => cell.ref), method });
        const share = percentOf(fromText(fact.value), grand, 1);
        const shareFact = share ? book.add({ key: `share.${key}${suffix}`, label: `Share of total, ${label}${inCur}`, kind: "share", value: share, unit: "%", places: 1, n: items.length, cells: items.map(cell => cell.ref),
          denominator: { value: totalFact.value, label: totalFact.label }, method: `${label} total ÷ overall total × 100.`, rounding: `${ROUNDING} to 1 decimal place` }) : null;
        rows.push({ label, cells: [{ text: label }, { text: fact.display, factId: fact.id }, { text: shareFact?.display ?? "—", ...(shareFact ? { factId: shareFact.id } : {}) }] });
        sections[2].factIds.push(fact.id, ...(shareFact ? [shareFact.id] : []));
        chartFacts.push(fact); chartLabels.push(label);
      };
      top.forEach(item => addRow(item.key, item.key, item.items, `Sum of amounts where ${categoryColumn.header} is “${item.key}”.`));
      if (rest.length) addRow("other", `Other (${rest.length})`, rest.flatMap(item => item.items), `Sum of the ${rest.length} smaller ${categoryColumn.header.toLowerCase()} groups.`);
      if (none.length) addRow("none", "No category", none, `Amounts whose ${categoryColumn.header} is empty or unreadable.`);
      allowed.add(String(Math.min(5, ranked.length))); allowed.add(String(ranked.length)); if (rest.length) allowed.add(String(rest.length));
      tables.push({ id: `categories${suffix}`, title: `${amountColumn.header} by ${categoryColumn.header.toLowerCase()}${inCur}`, columns: [categoryColumn.header, amountColumn.header, "Share"], rows });
      const chart = makeChart(`categories${suffix}`, "categories", `${amountColumn.header} by ${categoryColumn.header.toLowerCase()}${inCur}`, "bar", chartLabels, [{ name: amountColumn.header, facts: chartFacts }], dataset, { highlight: 0 });
      if (chart) charts.push(chart);
      if (ranked[0]) sections[0].factIds.push(chartFacts[0].id);
    }
  }
  if (separate) warnings.push(`Amounts are in ${groups.length} currencies (${groups.map(group => group[0]).join(", ")}); each is reported on its own and never converted or added together.`);
  for (const year of new Set(dates.map(date => date.slice(0, 4)))) allowed.add(year);
  return { title: `${amountColumn.header} report, ${periodText(period.from, period.to)}`, facts: {
    columnsUsed: [used(dataset, "date", dateColumn.letter, dataset.rows.map(row => row.cells[dateColumn.letter]).filter(cell => cell?.kind === "date").map(cell => cell!.ref)),
      used(dataset, "amount", amountColumn.letter, values.map(value => value.ref)),
      ...(categoryColumn ? [used(dataset, "category", categoryColumn.letter, dataset.rows.map(row => row.cells[categoryColumn.letter]).filter(cell => cell?.kind === "text").map(cell => cell!.ref))] : [])],
    period, facts: book.facts, tables, charts, sections, warnings, allowedNumbers: [...allowed] } };
}

// ---------------------------------------------------------------- survey → findings deck
function survey(dataset: Dataset, roles: Roles): Built {
  const questions = roleColumns(dataset, roles, "survey_findings", "questions");
  if (questions.length > 8) throw new DataError("ROLE_INVALID", "Choose at most 8 questions for one findings presentation.", 400);
  const segment = roleColumn(dataset, roles, "survey_findings", "segment");
  const book = new FactBook(dataset.source.sheet), sections: FactSection[] = [{ id: "overview", title: "Overview", factIds: [] }];
  const tables: FactTable[] = [], charts: FactChart[] = [], warnings: string[] = [], allowed = new Set<string>();
  const respondents = book.add({ key: "responses", label: "Responses", kind: "count", value: count(dataset.rows.length), places: 0, n: dataset.rows.length,
    cells: dataset.rows.map(row => `${questions[0].letter}${row.row}`), method: "Number of rows of answers below the heading row." });
  sections[0].factIds.push(respondents.id);
  const answerOf = (row: DatasetRow, letter: string) => { const cell = row.cells[letter]; return cell?.kind === "text" ? cell.value : cell?.kind === "number" ? decText(cell.value) : null; };
  let first: { letter: string; header: string; answers: string[] } | null = null;
  for (const question of questions) {
    const id = `q-${question.letter.toLowerCase()}`;
    const answered = dataset.rows.filter(row => answerOf(row, question.letter) !== null), skipped = dataset.rows.filter(row => answerOf(row, question.letter) === null);
    const by = new Map<string, string[]>();
    for (const row of answered) { const answer = answerOf(row, question.letter)!; if (!by.has(answer)) by.set(answer, []); by.get(answer)!.push(row.cells[question.letter].ref); }
    if (!answered.length) { warnings.push(`Nobody answered “${question.header}” (column ${question.letter}).`); continue; }
    if (by.size > 12) { warnings.push(`“${question.header}” (column ${question.letter}) has ${by.size} different answers, so it is treated as free text and not summarised as counts.`); continue; }
    const rating = question.kind === "number" && [...by.keys()].every(key => /^\d+$/.test(key) && Number(key) <= 10);
    const ordered = [...by.entries()].sort((a, b) => rating ? Number(a[0]) - Number(b[0]) : b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const n = answered.length;
    const answeredFact = book.add({ key: `${id}.answered`, label: `Answered “${question.header}”`, kind: "count", value: count(n), places: 0, n, cells: answered.map(row => row.cells[question.letter].ref),
      missingCells: skipped.map(row => row.cells[question.letter]?.ref ?? `${question.letter}${row.row}`), method: "Rows with an answer to this question." });
    const section: FactSection = { id, title: question.header, factIds: [answeredFact.id] };
    const percentFacts: Fact[] = [];
    const rows: FactTable["rows"] = [];
    for (const [answer, refs] of ordered) {
      const countFact = book.add({ key: `${id}.count.${answer}`, label: `“${answer}” for “${question.header}”`, kind: "count", value: count(refs.length), places: 0, n: refs.length, cells: refs, method: "People who gave this answer." });
      const pct = percentOf(count(refs.length), count(n), 1)!;
      const pctFact = book.add({ key: `${id}.pct.${answer}`, label: `Share answering “${answer}” to “${question.header}”`, kind: "share", value: pct, unit: "%", places: 1, n: refs.length, cells: refs,
        denominator: { value: String(n), label: `people who answered “${question.header}”` }, method: `${refs.length} of ${n} people who answered.`, rounding: `${ROUNDING} to 1 decimal place` });
      section.factIds.push(pctFact.id); percentFacts.push(pctFact);
      rows.push({ label: answer, cells: [{ text: answer }, { text: countFact.display, factId: countFact.id }, { text: pctFact.display, factId: pctFact.id }] });
    }
    if (rating) {
      const cells = numberCells(answered, question.letter).values;
      const average = divide(total(cells), count(cells.length), 2)!;
      const averageFact = book.add({ key: `${id}.average`, label: `Average rating for “${question.header}”`, kind: "average", value: average, places: 2, n: cells.length, cells: cells.map(cell => cell.ref),
        method: `Sum of ratings ÷ ${cells.length} answers.`, rounding: `${ROUNDING} to 2 decimal places` });
      section.factIds.unshift(averageFact.id);
    }
    sections.push(section);
    tables.push({ id, title: question.header, columns: ["Answer", "People", "Share"], rows });
    allowed.add(String(by.size));
    // Rating answers are labels ("5"), not figures; quoting one is not inventing a number.
    if (rating) for (const [answer] of ordered) allowed.add(answer);
    const chart = makeChart(id, id, question.header, "bar", ordered.map(([answer]) => answer), [{ name: "Share of answers", facts: percentFacts }], dataset, rating ? {} : { highlight: 0 });
    if (chart) charts.push(chart); else warnings.push(`“${question.header}” has a single answer, so it is shown as a table only.`);
    if (!first) first = { letter: question.letter, header: question.header, answers: ordered.map(([answer]) => answer) };
  }
  if (sections.length === 1) throw new DataError("NO_VALUES", "None of the chosen questions has answers that can be counted.");
  if (segment && first) {
    const groups = new Map<string, DatasetRow[]>();
    let excluded = 0;
    for (const row of dataset.rows) {
      const key = textOf(row, segment.letter), answer = answerOf(row, first.letter);
      if (!key || answer === null) { excluded++; continue; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const shown = ranked.slice(0, 3);
    if (shown.length >= 2) {
      const id = "crosstab", section: FactSection = { id, title: `${first.header} by ${segment.header.toLowerCase()}`, factIds: [] };
      const series: { name: string; facts: Fact[] }[] = [];
      for (const [group, rows] of shown) {
        const facts = first.answers.map(answer => {
          const matching = rows.filter(row => answerOf(row, first!.letter) === answer);
          const pct = percentOf(count(matching.length), count(rows.length), 1)!;
          return book.add({ key: `crosstab.${group}.${answer}`, label: `Share of ${group} answering “${answer}”`, kind: "share", value: pct, unit: "%", places: 1, n: matching.length,
            cells: matching.map(row => row.cells[first!.letter].ref), denominator: { value: String(rows.length), label: `${group} respondents who answered` },
            method: `${matching.length} of ${rows.length} ${group} respondents.`, rounding: `${ROUNDING} to 1 decimal place` });
        });
        const groupFact = book.add({ key: `crosstab.${group}.n`, label: `${group} respondents who answered “${first.header}”`, kind: "count", value: count(rows.length), places: 0, n: rows.length,
          cells: rows.map(row => row.cells[segment.letter].ref), method: `Rows where ${segment.header} is “${group}” and the question is answered.` });
        section.factIds.push(groupFact.id, ...facts.map(fact => fact.id));
        series.push({ name: group, facts });
      }
      if (ranked.length > 3) warnings.push(`The comparison shows the 3 largest of ${ranked.length} ${segment.header.toLowerCase()} groups.`);
      if (excluded) warnings.push(`${excluded} row${excluded === 1 ? " is" : "s are"} left out of the comparison because ${segment.header.toLowerCase()} or the answer is missing.`);
      sections.push(section);
      const chart = makeChart(id, id, section.title, "column", first.answers, series, dataset);
      if (chart) charts.push(chart);
      allowed.add(String(shown.length));
    } else warnings.push(`Only one ${segment.header.toLowerCase()} group has answers, so no comparison is shown.`);
  }
  warnings.push("Shares are rounded to one decimal place, so they may not add up to exactly 100%.");
  allowed.add("100"); allowed.add(String(questions.length));
  return { title: `Survey findings: ${dataset.rows.length} responses`, facts: {
    columnsUsed: [...questions.map(question => used(dataset, "question", question.letter, dataset.rows.filter(row => answerOf(row, question.letter) !== null).map(row => row.cells[question.letter].ref))),
      ...(segment ? [used(dataset, "segment", segment.letter, dataset.rows.filter(row => textOf(row, segment.letter)).map(row => row.cells[segment.letter].ref))] : [])],
    facts: book.facts, tables, charts, sections, warnings, allowedNumbers: [...allowed] } };
}

// ---------------------------------------------------------------- catalogue → comparison content
function catalogue(dataset: Dataset, roles: Roles): Built {
  const name = roleColumn(dataset, roles, "catalogue_comparison", "name")!, price = roleColumn(dataset, roles, "catalogue_comparison", "price");
  const attributes = roleColumns(dataset, roles, "catalogue_comparison", "attributes");
  if (attributes.length > 6) throw new DataError("ROLE_INVALID", "Choose at most 6 attributes to compare.", 400);
  const products = dataset.rows.filter(row => textOf(row, name.letter));
  const unnamed = dataset.rows.length - products.length;
  if (!products.length) throw new DataError("NO_VALUES", `${name.header} (column ${name.letter}) has no product names.`);
  if (products.length > 60) throw new DataError("TOO_MANY_ROWS", `There are ${products.length} products; a comparison can show at most 60. Filter the file (for example by category) first.`);
  const book = new FactBook(dataset.source.sheet), warnings: string[] = [], allowed = new Set<string>([String(products.length)]);
  if (unnamed) warnings.push(`${unnamed} row${unnamed === 1 ? " has" : "s have"} no ${name.header.toLowerCase()} and ${unnamed === 1 ? "is" : "are"} left out.`);
  const names = products.map(row => textOf(row, name.letter)!);
  const duplicate = new Set(names.filter((item, index) => names.indexOf(item) !== index));
  const labelOf = (row: DatasetRow) => { const text = textOf(row, name.letter)!; return duplicate.has(text) ? `${text} (row ${row.row})` : text; };
  if (duplicate.size) warnings.push(`Some product names appear more than once (${[...duplicate].slice(0, 3).join(", ")}); they are labelled with their row number.`);
  const columns = [...(price ? [price] : []), ...attributes];
  const sections: FactSection[] = [{ id: "overview", title: "Overview", factIds: [] }, { id: "comparison", title: "Comparison", factIds: [] }, { id: "ranges", title: "Ranges", factIds: [] }];
  const productsFact = book.add({ key: "products", label: "Products compared", kind: "count", value: count(products.length), places: 0, n: products.length, cells: products.map(row => row.cells[name.letter].ref), method: `Rows with a ${name.header.toLowerCase()}.` });
  sections[0].factIds.push(productsFact.id);
  const cellFacts = new Map<string, Fact>();
  const numericColumns: { column: typeof columns[number]; currency?: string; unit?: string; places: number }[] = [];
  for (const column of columns) {
    if (column.kind === "text") continue;
    const { values } = numberCells(products, column.letter);
    if (!values.length) { warnings.push(`${column.header} (column ${column.letter}) has no readable values.`); continue; }
    const currency = column.kind === "money" ? commonCurrency(values, column.header) : undefined;
    const unit = currency ? undefined : commonUnit(values, column.header);
    const places = currency ? currencyPlaces(currency) : Math.min(4, Math.max(0, ...values.map(value => value.value.scale)));
    numericColumns.push({ column, currency, unit, places });
    for (const value of values) {
      const row = products.find(item => item.row === value.row)!;
      cellFacts.set(`${row.row}:${column.letter}`, book.add({ key: `value.${row.row}.${column.letter}`, label: `${column.header} of ${labelOf(row)}`, kind: "value", value: value.value, currency, unit, places, n: 1, cells: [value.ref], method: "Value as given in the file." }));
    }
    const numbers = values.map(value => value.value);
    const low = min(numbers), high = max(numbers);
    const lowRows = values.filter(value => cmp(value.value, low) === 0), highRows = values.filter(value => cmp(value.value, high) === 0);
    const nameList = (items: NumberCell[]) => items.map(item => labelOf(products.find(row => row.row === item.row)!)).slice(0, 3).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : "");
    const minFact = book.add({ key: `min.${column.letter}`, label: `Lowest ${column.header.toLowerCase()}: ${nameList(lowRows)}`, kind: "min", value: low, currency, unit, places, n: values.length, cells: values.map(value => value.ref), method: `Lowest of ${values.length} values.` });
    const maxFact = book.add({ key: `max.${column.letter}`, label: `Highest ${column.header.toLowerCase()}: ${nameList(highRows)}`, kind: "max", value: high, currency, unit, places, n: values.length, cells: values.map(value => value.ref), method: `Highest of ${values.length} values.` });
    sections[2].factIds.push(minFact.id, maxFact.id);
    if (column === price) {
      const average = divide(total(values), count(values.length), places)!;
      const averageFact = book.add({ key: "average.price", label: `Average ${column.header.toLowerCase()}`, kind: "average", value: average, currency, unit, places, n: values.length, cells: values.map(value => value.ref),
        method: `Sum of ${values.length} prices ÷ ${values.length}.`, rounding: `${ROUNDING} to ${places} decimal places` });
      sections[0].factIds.push(minFact.id, maxFact.id, averageFact.id);
    }
    const missing = products.length - values.length;
    if (missing) warnings.push(`${missing} product${missing === 1 ? " has" : "s have"} no readable ${column.header.toLowerCase()}; shown as “—”.`);
  }
  const header = [name.header, ...columns.map(column => { const numeric = numericColumns.find(item => item.column === column); const mark = numeric?.currency ?? numeric?.unit; return mark && !column.header.includes(mark) ? `${column.header} (${mark})` : column.header; })];
  const table: FactTable = { id: "comparison", title: `${name.header} comparison`, columns: header, rows: products.map(row => ({ label: labelOf(row), cells: [{ text: labelOf(row) }, ...columns.map(column => {
    const fact = cellFacts.get(`${row.row}:${column.letter}`);
    if (fact) { sections[1].factIds.push(fact.id); return { text: fact.display, factId: fact.id }; }
    const text = column.kind === "text" ? textOf(row, column.letter) : null;
    return { text: text ?? "—" };
  })] })) };
  const charts: FactChart[] = [];
  const priceColumn = numericColumns.find(item => item.column === price);
  if (priceColumn) {
    const priced = products.filter(row => cellFacts.has(`${row.row}:${price!.letter}`)).sort((a, b) => cmp(fromText(cellFacts.get(`${a.row}:${price!.letter}`)!.value), fromText(cellFacts.get(`${b.row}:${price!.letter}`)!.value)));
    const shown = priced.slice(0, 12);
    if (shown.length < priced.length) warnings.push(`The price chart shows the 12 lowest-priced of ${priced.length} products; the table lists all of them.`);
    const chart = makeChart("price", "comparison", `${price!.header} by product`, "bar", shown.map(labelOf), [{ name: price!.header, facts: shown.map(row => cellFacts.get(`${row.row}:${price!.letter}`)!) }], dataset);
    if (chart) charts.push(chart);
  }
  allowed.add(String(columns.length));
  return { title: `${name.header} comparison: ${products.length} products`, facts: {
    columnsUsed: [used(dataset, "name", name.letter, products.map(row => row.cells[name.letter].ref)), ...columns.map(column => used(dataset, column === price ? "price" : "attribute", column.letter, products.map(row => row.cells[column.letter]).filter(cell => cell && cell.kind !== "missing").map(cell => cell!.ref)))],
    facts: book.facts, tables: [table], charts, sections, warnings, allowedNumbers: [...allowed] } };
}

// ---------------------------------------------------------------- campaign → client report
function campaign(dataset: Dataset, roles: Roles): Built {
  const name = roleColumn(dataset, roles, "campaign_report", "campaign")!, spend = roleColumn(dataset, roles, "campaign_report", "spend")!;
  const metric = (role: string) => roleColumn(dataset, roles, "campaign_report", role);
  const impressions = metric("impressions"), clicks = metric("clicks"), conversions = metric("conversions"), revenue = metric("revenue"), date = metric("date");
  const rows = dataset.rows.filter(row => textOf(row, name.letter));
  if (!rows.length) throw new DataError("NO_VALUES", `${name.header} (column ${name.letter}) has no campaign names.`);
  const unnamed = dataset.rows.length - rows.length;
  const spendCells = numberCells(rows, spend.letter);
  if (!spendCells.values.length) throw new DataError("NO_VALUES", `${spend.header} (column ${spend.letter}) has no amounts that can be read.`);
  // Spend and revenue must be in one currency: return on spend across currencies would be meaningless.
  const currency = commonCurrency([...spendCells.values, ...(revenue ? numberCells(rows, revenue.letter).values : [])], revenue ? `${spend.header} and ${revenue.header}` : spend.header);
  const places = currencyPlaces(currency);
  for (const column of [impressions, clicks, conversions]) if (column) commonUnit(numberCells(rows, column.letter).values, column.header);
  const book = new FactBook(dataset.source.sheet), warnings: string[] = [], allowed = new Set<string>();
  if (unnamed) warnings.push(`${unnamed} row${unnamed === 1 ? " has" : "s have"} no ${name.header.toLowerCase()} and ${unnamed === 1 ? "is" : "are"} left out.`);
  const sections: FactSection[] = [{ id: "overview", title: "Overview", factIds: [] }, { id: "spend", title: "Spend", factIds: [] }, { id: "results", title: "Results", factIds: [] }, { id: "efficiency", title: "Efficiency", factIds: [] }];
  const groups = new Map<string, DatasetRow[]>();
  for (const row of rows) { const key = textOf(row, name.letter)!; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(row); }
  const metrics = [["spend", spend], ["impressions", impressions], ["clicks", clicks], ["conversions", conversions], ["revenue", revenue]] as const;
  const kindOf = (role: string) => role === "spend" || role === "revenue" ? { currency, places } : { places: 0 };
  type Totals = Record<string, Fact | null>;
  const sumFor = (key: string, label: string, items: DatasetRow[], role: string, column: NonNullable<typeof spend>) => {
    const cells = numberCells(items, column.letter);
    if (!cells.values.length) return null;
    return book.add({ key: `${role}.${key}`, label: `${column.header}, ${label}`, kind: "sum", value: total(cells.values), ...kindOf(role), n: cells.values.length, cells: cells.values.map(cell => cell.ref),
      missingCells: cells.missing.map(item => item.ref), method: `Sum of ${column.header} (column ${column.letter}) for ${label}.` });
  };
  /** A ratio only over rows where both values are present, so a missing value never skews it. */
  const ratioFor = (key: string, label: string, items: DatasetRow[], numerator: NonNullable<typeof spend> | null, denominator: NonNullable<typeof spend> | null, what: { name: string; percent?: boolean; money?: boolean; times?: boolean; places: number }) => {
    if (!numerator || !denominator) return null;
    const paired = items.filter(row => row.cells[numerator.letter]?.kind === "number" && row.cells[denominator.letter]?.kind === "number");
    if (!paired.length) return null;
    const top = total(numberCells(paired, numerator.letter).values), bottom = total(numberCells(paired, denominator.letter).values);
    const value = what.percent ? percentOf(top, bottom, what.places) : ratio(top, bottom, what.places);
    if (!value) { warnings.push(`${what.name} for ${label} is not defined: ${denominator.header.toLowerCase()} totals zero.`); return null; }
    const left = items.length - paired.length;
    return book.add({ key: `${what.name.toLowerCase()}.${key}`, label: `${what.name}, ${label}`, kind: "ratio", value, places: what.places, ...(what.percent ? { unit: "%" } : what.money ? { currency } : what.times ? { unit: "×" } : {}),
      n: paired.length, cells: [...paired.map(row => row.cells[numerator.letter].ref), ...paired.map(row => row.cells[denominator.letter].ref)],
      ...(left ? { missingCells: items.filter(row => !paired.includes(row)).map(row => row.cells[numerator.letter]?.ref ?? `${numerator.letter}${row.row}`) } : {}),
      denominator: { value: decText(bottom), label: `${denominator.header} (${paired.length} row${paired.length === 1 ? "" : "s"})` },
      method: `${numerator.header} ÷ ${denominator.header}${what.percent ? " × 100" : ""}, over rows with both values.`, rounding: `${ROUNDING} to ${what.places} decimal places` });
  };
  const derived = (key: string, label: string, items: DatasetRow[]) => ({
    ctr: ratioFor(key, label, items, clicks, impressions, { name: "CTR", percent: true, places: 2 }),
    cpc: ratioFor(key, label, items, spend, clicks, { name: "CPC", money: true, places }),
    cpa: ratioFor(key, label, items, spend, conversions, { name: "CPA", money: true, places }),
    roas: ratioFor(key, label, items, revenue, spend, { name: "ROAS", times: true, places: 2 }),
  });
  const totals: Totals = {};
  for (const [role, column] of metrics) totals[role] = column ? sumFor("all", "all campaigns", rows, role, column) : null;
  const overall = derived("all", "all campaigns", rows);
  const campaignsFact = book.add({ key: "campaigns", label: "Campaigns", kind: "count", value: count(groups.size), places: 0, n: rows.length, cells: rows.map(row => row.cells[name.letter].ref), method: `Distinct values of ${name.header}.` });
  sections[0].factIds.push(campaignsFact.id, ...Object.values(totals).filter((fact): fact is Fact => Boolean(fact)).map(fact => fact.id), ...Object.values(overall).filter((fact): fact is Fact => Boolean(fact)).map(fact => fact.id));
  allowed.add(String(groups.size));
  // Per campaign, ranked by spend; beyond 11 the rest form one "Other" group so charts stay readable.
  const ranked = [...groups.entries()].map(([key, items]) => ({ key, items, spend: total(numberCells(items, spend.letter).values) })).sort((a, b) => cmp(b.spend, a.spend) || a.key.localeCompare(b.key));
  const shown = ranked.length > 12 ? [...ranked.slice(0, 11), { key: `Other (${ranked.length - 11})`, items: ranked.slice(11).flatMap(item => item.items), spend: dec(BigInt(0)) }] : ranked;
  if (ranked.length > 12) { warnings.push(`The ${ranked.length - 11} smallest campaigns by spend are grouped as “Other”.`); allowed.add(String(ranked.length - 11)); }
  const per = shown.map(item => {
    const sums: Totals = {};
    for (const [role, column] of metrics) sums[role] = column ? sumFor(`c.${item.key}`, item.key, item.items, role, column) : null;
    return { key: item.key, sums, ratios: derived(`c.${item.key}`, item.key, item.items) };
  });
  for (const item of per) {
    if (item.sums.spend) sections[1].factIds.push(item.sums.spend.id);
    for (const role of ["impressions", "clicks", "conversions", "revenue"]) if (item.sums[role]) sections[2].factIds.push(item.sums[role]!.id);
    for (const fact of Object.values(item.ratios)) if (fact) sections[3].factIds.push(fact.id);
  }
  const charts: FactChart[] = [];
  const series = (role: string) => per.every(item => item.sums[role]) ? per.map(item => item.sums[role]!) : null;
  const labels = per.map(item => item.key);
  const spendSeries = series("spend");
  if (spendSeries) { const chart = makeChart("spend", "spend", `${spend.header} by campaign`, "bar", labels, [{ name: spend.header, facts: spendSeries }], dataset, { highlight: 0 }); if (chart) charts.push(chart); }
  const conversionSeries = conversions ? series("conversions") : null;
  if (conversionSeries) { const chart = makeChart("conversions", "results", `${conversions!.header} by campaign`, "column", labels, [{ name: conversions!.header, facts: conversionSeries }], dataset); if (chart) charts.push(chart); }
  const cpa = per.every(item => item.ratios.cpa) ? per.map(item => item.ratios.cpa!) : null;
  if (cpa) { const chart = makeChart("cpa", "efficiency", "Cost per conversion by campaign", "bar", labels, [{ name: "CPA", facts: cpa }], dataset); if (chart) charts.push(chart); }
  const ctr = per.every(item => item.ratios.ctr) ? per.map(item => item.ratios.ctr!) : null;
  if (ctr) { const chart = makeChart("ctr", "efficiency", "Click-through rate by campaign", "bar", labels, [{ name: "CTR", facts: ctr }], dataset); if (chart) charts.push(chart); }
  let period: FactsSheet["period"];
  if (date) {
    const months = new Map<string, DatasetRow[]>();
    for (const row of rows) { const value = dateOf(row, date.letter); if (value) { const key = value.slice(0, 7); if (!months.has(key)) months.set(key, []); months.get(key)!.push(row); } }
    const keys = [...months.keys()].sort();
    const dates = rows.map(row => dateOf(row, date.letter)).filter((value): value is string => Boolean(value)).sort();
    if (dates.length) period = { from: dates[0], to: dates.at(-1)!, column: date.letter };
    if (keys.length >= 2) {
      sections.push({ id: "trend", title: "By month", factIds: [] });
      const facts = keys.slice(-12).map(key => sumFor(`m.${key}`, monthLabel(key), months.get(key)!, "spend", spend)).filter((fact): fact is Fact => Boolean(fact));
      sections.at(-1)!.factIds.push(...facts.map(fact => fact.id));
      if (facts.length === Math.min(12, keys.length)) { const chart = makeChart("trend", "trend", `${spend.header} by month`, "line", keys.slice(-12).map(key => monthLabel(key, true)), [{ name: spend.header, facts }], dataset); if (chart) charts.push(chart); }
      for (const key of keys) allowed.add(key.slice(0, 4));
    }
  }
  const columnsShown = (["spend", "clicks", "conversions"] as const).filter(role => metrics.find(item => item[0] === role)?.[1]);
  const table: FactTable = { id: "campaigns", title: "Results by campaign", columns: [name.header, ...columnsShown.map(role => metrics.find(item => item[0] === role)![1]!.header), ...(conversions ? ["CPA"] : []), ...(revenue ? ["ROAS"] : [])].slice(0, 6),
    rows: per.map(item => ({ label: item.key, cells: [{ text: item.key }, ...columnsShown.map(role => item.sums[role] ? { text: item.sums[role]!.display, factId: item.sums[role]!.id } : { text: "—" }),
      ...(conversions ? [item.ratios.cpa ? { text: item.ratios.cpa.display, factId: item.ratios.cpa.id } : { text: "—" }] : []), ...(revenue ? [item.ratios.roas ? { text: item.ratios.roas.display, factId: item.ratios.roas.id } : { text: "—" }] : [])].slice(0, 6) })) };
  const tables = [table];
  return { title: `Campaign results${period ? `, ${periodText(period.from, period.to)}` : ""}`, facts: {
    columnsUsed: [used(dataset, "campaign", name.letter, rows.map(row => row.cells[name.letter].ref)), ...metrics.filter(([, column]) => column).map(([role, column]) => used(dataset, role, column!.letter, numberCells(rows, column!.letter).values.map(cell => cell.ref))),
      ...(date ? [used(dataset, "date", date.letter, rows.map(row => row.cells[date.letter]).filter(cell => cell?.kind === "date").map(cell => cell!.ref))] : [])],
    ...(period ? { period } : {}), facts: book.facts, tables, charts, sections, warnings, allowedNumbers: [...allowed] } };
}

// ---------------------------------------------------------------- plain summaries (no AI)
/** The summary written from the numbers: fixed sentences that cite fact ids only, so it always passes the figure check. */
export function plainNarrative(facts: FactsSheet): Narrative {
  const get = (key: string) => facts.facts.find(fact => fact.key === key);
  const t = (fact: Fact | undefined) => fact ? `[[${fact.id}]]` : "";
  const section = (id: string, text: string) => ({ id, text });
  if (facts.template === "sales_monthly") {
    const currencies = facts.facts.filter(fact => fact.key.startsWith("total")).map(fact => fact.key.slice(5));
    const suffix = currencies[0] ?? "";
    const totalFact = get(`total${suffix}`), change = get(`change${suffix}`), pct = get(`change-pct${suffix}`), best = get(`best-month${suffix}`);
    const months = facts.facts.filter(fact => fact.key.startsWith("month.") && fact.key.endsWith(suffix));
    const latest = months.at(-1), topCategory = facts.facts.find(fact => fact.key.startsWith("category.") && fact.key.endsWith(suffix) && !fact.key.includes(".other") && !fact.key.includes(".none"));
    const categoryShare = topCategory ? get(topCategory.key.replace("category.", "share.")) : undefined;
    const summary = [`${totalFact?.label ?? "The total"} for the period is ${t(totalFact)} across ${t(get(`rows${suffix}`))} rows, an average of ${t(get(`average${suffix}`))} per row.`];
    if (latest) summary.push(`${latest.label} came to ${t(latest)}${change ? `, a change of ${t(change)}${pct ? ` (${t(pct)})` : ""} on the month before` : ""}.`);
    if (currencies.length > 1) summary.push("Each currency is reported separately; amounts in different currencies are never converted or added together.");
    const highlights = [
      ...(latest ? [{ title: "Latest month", text: `${t(latest)} in ${latest.label.split(", ").at(-1)!.replace(/ in [A-Z]{3}$/, "")}.` }] : []),
      ...(pct ? [{ title: "Change on the month before", text: `${t(pct)}, or ${t(change)}.` }] : []),
      ...(best ? [{ title: "Highest month", text: `${best.label.replace(/^Highest month: /, "")}: ${t(best)}.` }] : []),
      ...(topCategory ? [{ title: "Largest group", text: `“${topCategory.label.split(", ").slice(1).join(", ").replace(/ in [A-Z]{3}$/, "")}”: ${t(topCategory)}${categoryShare ? `, ${t(categoryShare)} of the total` : ""}.` }] : []),
    ].slice(0, 4);
    return { headline: facts.title.slice(0, 160), summary, highlights,
      sections: [section("monthly", latest ? `${latest.label}: ${t(latest)}.${pct ? ` Change on the month before: ${t(pct)}.` : ""}` : "Totals by calendar month."),
        ...(facts.sections.some(item => item.id === "categories") ? [section("categories", topCategory ? `“${topCategory.label.split(", ").slice(1).join(", ").replace(/ in [A-Z]{3}$/, "")}” leads with ${t(topCategory)}.` : "Totals by group.")] : [])] };
  }
  if (facts.template === "survey_findings") {
    const responses = get("responses");
    const questionSections = facts.sections.filter(item => item.id.startsWith("q-"));
    const highlights = questionSections.slice(0, 4).map(item => {
      const top = facts.facts.find(fact => item.factIds.includes(fact.id) && fact.kind === "share");
      const answer = top ? /“([^”]*)”/.exec(top.label)?.[1] ?? "" : "";
      return { title: item.title.slice(0, 60), text: top ? `Most common answer: “${answer.slice(0, 60)}” (${t(top)}).` : "See the answers." };
    }).filter(item => item.text.length <= 160);
    return { headline: facts.title.slice(0, 160), summary: [`${t(responses)} responses were analysed across ${questionSections.length} question${questionSections.length === 1 ? "" : "s"}. Shares use the people who answered each question as the base.`],
      highlights, sections: questionSections.map(item => {
        const answered = facts.facts.find(fact => item.factIds.includes(fact.id) && fact.key.endsWith(".answered"));
        const average = facts.facts.find(fact => item.factIds.includes(fact.id) && fact.kind === "average");
        return section(item.id, `${t(answered)} answered.${average ? ` Average rating: ${t(average)}.` : ""}`);
      }) };
  }
  if (facts.template === "catalogue_comparison") {
    const products = get("products"), low = facts.facts.find(fact => fact.kind === "min" && facts.sections[0].factIds.includes(fact.id)), high = facts.facts.find(fact => fact.kind === "max" && facts.sections[0].factIds.includes(fact.id)), average = get("average.price");
    const summary = [`This comparison covers ${t(products)} products.${low && high ? ` Prices range from ${t(low)} to ${t(high)}${average ? `, with an average of ${t(average)}` : ""}.` : ""}`];
    const highlights = [
      ...(low ? [{ title: "Lowest price", text: `“${low.label.replace(/^Lowest [^:]*: /, "")}”: ${t(low)}.` }] : []),
      ...(high ? [{ title: "Highest price", text: `“${high.label.replace(/^Highest [^:]*: /, "")}”: ${t(high)}.` }] : []),
    ].filter(item => item.text.length <= 160);
    return { headline: facts.title.slice(0, 160), summary, highlights, sections: [section("comparison", "Every value is shown as given in the file, with its unit."), section("ranges", "Lowest and highest value for each measured attribute.")] };
  }
  const spendTotal = get("spend.all"), conversions = get("conversions.all"), cpa = get("cpa.all"), roas = get("roas.all"), ctr = get("ctr.all"), campaigns = get("campaigns");
  const topSpend = facts.facts.find(fact => fact.key.startsWith("spend.c."));
  return { headline: facts.title.slice(0, 160),
    summary: [`${t(campaigns)} campaigns spent ${t(spendTotal)} in total${conversions ? ` and produced ${t(conversions)} conversions` : ""}.${cpa ? ` The cost per conversion was ${t(cpa)}.` : ""}${roas ? ` Return on spend was ${t(roas)}.` : ""}`],
    highlights: [
      { title: "Total spend", text: `${t(spendTotal)} across ${t(campaigns)} campaigns.` },
      ...(conversions ? [{ title: "Conversions", text: `${t(conversions)} in total.` }] : []),
      ...(cpa ? [{ title: "Cost per conversion", text: `${t(cpa)} across all campaigns.` }] : []),
      ...(ctr ? [{ title: "Click-through rate", text: `${t(ctr)} of impressions led to a click.` }] : []),
    ].slice(0, 4),
    sections: [section("spend", topSpend ? `“${topSpend.label.replace(/^[^,]*, /, "")}” had the largest spend: ${t(topSpend)}.` : "Spend by campaign."),
      ...(facts.sections.some(item => item.id === "results") ? [section("results", conversions ? `${t(conversions)} conversions in total.` : "Results by campaign.")] : []),
      ...(facts.sections.some(item => item.id === "efficiency") ? [section("efficiency", cpa ? `Overall cost per conversion: ${t(cpa)}.` : ctr ? `Overall click-through rate: ${t(ctr)}.` : "Efficiency by campaign.")] : []),
      ...(facts.sections.some(item => item.id === "trend") ? [section("trend", "Spend by calendar month.")] : [])] };
}
