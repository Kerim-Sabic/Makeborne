import { z } from "zod";
import { abs, cmp, parseDec, round, shift, type Dec } from "./decimal";
import type { FactsSheet } from "./facts";

/**
 * The written part of a data report. Whoever writes it (the summary written
 * from the numbers, or later an AI writer), it may cite figures only as fact
 * ids — [[F012]] — which are replaced by the computed display text. A
 * deterministic check then refuses any narrative that names an unknown fact or
 * contains a number of its own that the facts sheet does not hold (formatting
 * differences such as thousands separators, currency marks, rounding to fewer
 * decimals or "k"/"M" abbreviations are tolerated; signs are carried by words).
 */
export const SectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const NarrativeSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  summary: z.array(z.string().trim().min(1).max(700)).min(1).max(4),
  highlights: z.array(z.object({ title: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(300) }).strict()).max(4),
  sections: z.array(z.object({ id: SectionId, text: z.string().trim().min(1).max(500) }).strict()).max(24),
}).strict();
export type Narrative = z.infer<typeof NarrativeSchema>;

/** Rendered (after fact substitution) length limits, matching where each part is placed. */
export const RENDERED_LIMITS = { headline: 120, summary: 700, highlightTitle: 60, highlight: 170, section: 220 } as const;

export type NarrativeProblem = { field: string; issue: "unknown_fact" | "unsupported_number" | "unknown_section" | "too_long" | "duplicate_section"; detail: string };
const TOKEN = /\[\[(F\d{3,4})\]\]/g;
const MULTIPLIERS: Record<string, number> = { k: 3, thousand: 3, m: 6, million: 6, bn: 9, billion: 9 };

type Literal = { raw: string; value: Dec; places: number; exponent: number };
/** Numbers written in prose, read tolerantly: 12,345.60 · €12.3k · 4.5% · 1,5 · 3 million. */
export function literals(text: string): Literal[] {
  const out: Literal[] = [];
  const pattern = /(?<![\p{L}\p{N}_.])[-+−]?[€$£¥]?\s?(\d[\d,'’]*(?:\.\d+)?|\d+,\d{1,2}(?!\d))(?:\s?(%|k|K|m|M|bn|thousand|million|billion)\b|%)?/gu;
  for (const match of text.matchAll(pattern)) {
    let body = match[1].replace(/['’]/g, "");
    const suffix = (match[2] ?? "").toLowerCase();
    // 1,234,567 groups thousands; a lone ",5" or ",50" is a decimal comma.
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) body = body.replace(/,/g, "");
    else if (/^\d+,\d{1,2}$/.test(body)) body = body.replace(",", ".");
    else body = body.replace(/,/g, "");
    const value = parseDec(body);
    if (!value) continue;
    out.push({ raw: match[0].trim(), value, places: body.includes(".") ? body.split(".")[1].length : 0, exponent: MULTIPLIERS[suffix] ?? 0 });
  }
  return out;
}

/** The values a narrative may state: every fact value, its count and denominator, and the sheet's allowed numbers. */
function candidates(facts: Pick<FactsSheet, "facts" | "allowedNumbers">): Dec[] {
  const values: Dec[] = [];
  const push = (text: string | undefined) => { const value = text === undefined ? null : parseDec(text); if (value) values.push(abs(value)); };
  for (const fact of facts.facts) { push(fact.value); push(String(fact.n)); push(fact.denominator?.value); }
  for (const number of facts.allowedNumbers) push(number);
  return values;
}
const supported = (literal: Literal, values: readonly Dec[]) => values.some(value => cmp(round(shift(value, -literal.exponent), literal.places), abs(literal.value)) === 0);

const years = (facts: Pick<FactsSheet, "period" | "allowedNumbers">) => {
  const out = new Set<string>();
  if (facts.period) for (let year = Number(facts.period.from.slice(0, 4)); year <= Number(facts.period.to.slice(0, 4)); year++) out.add(String(year));
  return out;
};

/** Names taken from the facts sheet (headings, answers, product and campaign names, fact labels): quoting them is not inventing a figure. */
export function knownLabels(facts: Partial<Pick<FactsSheet, "facts" | "tables" | "sections" | "charts" | "columnsUsed">>): string[] {
  const labels = new Set<string>();
  for (const fact of facts.facts ?? []) labels.add(fact.label);
  for (const table of facts.tables ?? []) { labels.add(table.title); for (const column of table.columns) labels.add(column); for (const row of table.rows) { labels.add(row.label); for (const cell of row.cells) if (!cell.factId) labels.add(cell.text); } }
  for (const section of facts.sections ?? []) labels.add(section.title);
  for (const chart of facts.charts ?? []) { labels.add(chart.title); for (const point of chart.points) { labels.add(point.category); labels.add(point.series); } }
  for (const column of facts.columnsUsed ?? []) labels.add(column.header);
  // Only names (with letters) that contain digits matter; a bare number is never a "name" and stays checked.
  return [...labels].filter(label => label.trim().length >= 2 && /\d/.test(label) && /\p{L}/u.test(label)).sort((a, b) => b.length - a.length).slice(0, 2000);
}

type CheckFacts = Pick<FactsSheet, "facts" | "allowedNumbers" | "period"> & Partial<Pick<FactsSheet, "tables" | "sections" | "charts" | "columnsUsed">>;
export function checkText(field: string, text: string, facts: CheckFacts, values = candidates(facts), labels = knownLabels(facts)): NarrativeProblem[] {
  const problems: NarrativeProblem[] = [];
  const ids = new Set(facts.facts.map(fact => fact.id));
  for (const match of text.matchAll(TOKEN)) if (!ids.has(match[1])) problems.push({ field, issue: "unknown_fact", detail: match[1] });
  // Fact tokens are the computed values themselves; what remains is the writer's own text.
  let rest = text.replace(TOKEN, " ");
  for (const label of labels) if (rest.includes(label)) rest = rest.split(label).join(" ");
  rest = rest.replace(/\[\[[^\]]*\]\]/g, match => { problems.push({ field, issue: "unknown_fact", detail: match.slice(0, 24) }); return " "; });
  const allowedYears = years(facts);
  // Dates and month names may name years in the reporting period only.
  rest = rest.replace(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g, (match, year: string) => { if (!allowedYears.has(year)) problems.push({ field, issue: "unsupported_number", detail: match }); return " "; });
  rest = rest.replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Q[1-4]|H[12])\s+(\d{4})\b/g, (match, year: string) => { if (!allowedYears.has(year)) problems.push({ field, issue: "unsupported_number", detail: match }); return " "; });
  for (const literal of literals(rest)) {
    if (literal.places === 0 && literal.exponent === 0 && allowedYears.has(literal.raw.replace(/^[-+−]/, ""))) continue;
    if (!supported(literal, values)) problems.push({ field, issue: "unsupported_number", detail: literal.raw });
  }
  return problems;
}

export function renderText(text: string, facts: Pick<FactsSheet, "facts">) {
  const byId = new Map(facts.facts.map(fact => [fact.id, fact.display]));
  return text.replace(TOKEN, (match, id: string) => byId.get(id) ?? match).replace(/\s+/g, " ").trim();
}

/** The full check: schema, sections known, every figure traceable, and each rendered part fits where it goes. */
export function checkNarrative(value: unknown, facts: FactsSheet): { ok: true; narrative: Narrative } | { ok: false; problems: NarrativeProblem[] } {
  const parsed = NarrativeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 8).map(issue => ({ field: issue.path.join(".") || "(narrative)", issue: "too_long" as const, detail: issue.message })) };
  const narrative = parsed.data, values = candidates(facts), labels = knownLabels(facts), problems: NarrativeProblem[] = [];
  const sectionIds = new Set(facts.sections.map(section => section.id)), seen = new Set<string>();
  const fits = (field: string, text: string, limit: number) => { const rendered = renderText(text, facts); if (rendered.length > limit) problems.push({ field, issue: "too_long", detail: `${rendered.length} characters (at most ${limit})` }); };
  problems.push(...checkText("headline", narrative.headline, facts, values, labels)); fits("headline", narrative.headline, RENDERED_LIMITS.headline);
  narrative.summary.forEach((text, index) => { problems.push(...checkText(`summary.${index}`, text, facts, values, labels)); fits(`summary.${index}`, text, RENDERED_LIMITS.summary); });
  narrative.highlights.forEach((item, index) => {
    problems.push(...checkText(`highlights.${index}.title`, item.title, facts, values, labels), ...checkText(`highlights.${index}.text`, item.text, facts, values, labels));
    fits(`highlights.${index}.title`, item.title, RENDERED_LIMITS.highlightTitle); fits(`highlights.${index}.text`, item.text, RENDERED_LIMITS.highlight);
  });
  narrative.sections.forEach((item, index) => {
    if (!sectionIds.has(item.id)) problems.push({ field: `sections.${index}.id`, issue: "unknown_section", detail: item.id });
    if (seen.has(item.id)) problems.push({ field: `sections.${index}.id`, issue: "duplicate_section", detail: item.id });
    seen.add(item.id);
    problems.push(...checkText(`sections.${index}.text`, item.text, facts, values, labels)); fits(`sections.${index}.text`, item.text, RENDERED_LIMITS.section);
  });
  return problems.length ? { ok: false, problems } : { ok: true, narrative };
}

export type RenderedNarrative = { headline: string; summary: string[]; highlights: { title: string; text: string }[]; sections: Record<string, string> };
export function renderNarrative(narrative: Narrative, facts: FactsSheet): RenderedNarrative {
  return { headline: renderText(narrative.headline, facts), summary: narrative.summary.map(text => renderText(text, facts)),
    highlights: narrative.highlights.map(item => ({ title: renderText(item.title, facts), text: renderText(item.text, facts) })),
    sections: Object.fromEntries(narrative.sections.map(item => [item.id, renderText(item.text, facts)])) };
}

/** Customer-facing explanation of a refused narrative (no writer or model named). */
export function narrativeRefusal(problems: readonly NarrativeProblem[]) {
  const invented = problems.filter(problem => problem.issue === "unsupported_number").map(problem => problem.detail);
  if (invented.length) return `The written summary was not used: it contained figures that are not in the computed results (${[...new Set(invented)].slice(0, 5).join(", ")}). Nothing was saved.`;
  return "The written summary was not used: it referred to results that don’t exist or didn’t fit the layout. Nothing was saved.";
}
