import { z } from "zod";
import type { IngestionReference } from "../ingest/record";

/**
 * Client knowledge: the shared vocabulary for facts, their evidence and their
 * review state. The database (migration 20261023210000_client_knowledge.sql)
 * is authoritative for every rule here; these mirrors validate input early,
 * normalise keys and values the same way, and type the results.
 *
 * Four kinds stay distinct all the way to the task context:
 * - observed_fact: something a source says (needs a real source);
 * - inference: something concluded from material (never used as proof);
 * - user_decision: something a person decided or corrected (their words are the evidence);
 * - brand_preference: a brand rule, from a guideline source or a person.
 */
export const FACT_KINDS = ["observed_fact", "inference", "user_decision", "brand_preference"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_STATUSES = ["proposed", "approved", "rejected", "superseded"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];
export const EVIDENCE_KINDS = ["source", "asset", "url", "brief", "user", "artifact_version"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceState = "live" | "stale" | "revoked";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The same extraction-version shape the database accepts (ingest uses "ingest-2026-10-23.1"). */
export const ExtractionVersionSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);

/** Where in a source: page, slide, sheet + A1 cell or range, paragraph/line, or a character range. */
export const LocatorSchema = z.object({
  page: z.number().int().min(1).max(100_000).optional(),
  slide: z.number().int().min(1).max(10_000).optional(),
  sheet: z.string().min(1).max(200).optional(),
  cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/).optional(),
  range: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/).optional(),
  paragraph: z.number().int().min(1).max(1_000_000).optional(),
  line: z.number().int().min(1).max(10_000_000).optional(),
  charStart: z.number().int().min(0).optional(),
  charEnd: z.number().int().min(0).optional(),
  section: z.string().max(200).optional(),
  label: z.string().max(200).optional(),
}).strict().refine(value => value.cell === undefined || value.sheet !== undefined, "A cell needs its sheet.");
export type FactLocator = z.infer<typeof LocatorSchema>;

export const QUOTE_LIMIT = 500;
const quote = z.string().trim().min(1).max(QUOTE_LIMIT);
export const EvidenceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), refId: uuid, sha256, extractionVersion: ExtractionVersionSchema.optional(), locator: LocatorSchema.default({}), quote: quote.optional() }).strict(),
  /** An uploaded file (ingestion records point here: the asset id and the sha256 of its bytes). */
  z.object({ kind: z.literal("asset"), refId: uuid, sha256, extractionVersion: ExtractionVersionSchema.optional(), locator: LocatorSchema.default({}), quote: quote.optional() }).strict(),
  z.object({ kind: z.literal("url"), url: z.string().url().max(2048).regex(/^https?:\/\//), fetchedAt: z.string().datetime({ offset: true }), sha256, locator: LocatorSchema.default({}), quote: quote.optional() }).strict(),
  z.object({ kind: z.literal("brief"), refId: uuid, sha256, quote: quote.optional() }).strict(),
  /** A person's own words, recorded by that person. Tasks cannot create these. */
  z.object({ kind: z.literal("user"), quote }).strict(),
  /** A generated output. Supports an inference at most; the database refuses it for anything else. */
  z.object({ kind: z.literal("artifact_version"), refId: uuid, sha256, locator: LocatorSchema.default({}), quote: quote.optional() }).strict(),
]);
export type EvidenceInput = z.input<typeof EvidenceInputSchema>;

/** Ingestion record -> evidence. Only stored uploads (asset ids) are durable; inline attachments are not knowledge sources. */
export function evidenceFromIngestion(reference: IngestionReference, locator: FactLocator = {}, quoteText?: string): EvidenceInput {
  if (!uuid.safeParse(reference.sourceId).success) throw new Error("Only a stored upload can be cited as knowledge.");
  if (reference.status !== "complete" && reference.status !== "partial") throw new Error("This source could not be read.");
  return { kind: "asset", refId: reference.sourceId, sha256: reference.sha256, extractionVersion: reference.extractionVersion, locator,
    ...(quoteText ? { quote: boundQuote(quoteText) } : {}) };
}

/** Quotes are short, single-spaced excerpts without control characters. */
export function boundQuote(text: string, limit = QUOTE_LIMIT): string {
  const clean = cleanText(text);
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}
/** Removes control and bidirectional-override characters and collapses whitespace. */
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim();
}

/** Same rule as the database: lower-case words joined by "_" in "."-separated parts, at most 120 characters. */
export const KEY_PATTERN = /^[a-z0-9]+([._][a-z0-9]+)*$/;
export function normalizeKey(input: string): string | null {
  const key = input.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().trim()
    .replace(/&/g, " and ").replace(/[\s\-/]+/g, "_").replace(/[^a-z0-9_.]/g, "").replace(/_+/g, "_").replace(/\.+/g, ".")
    .replace(/_?\._?/g, ".").replace(/^[._]+|[._]+$/g, "").slice(0, 120).replace(/[._]+$/g, "");
  return KEY_PATTERN.test(key) ? key : null;
}

/** Mirror of makeborne_private.knowledge_sensitive_key: business truth that must be approved before any task uses it. */
export function sensitiveKey(key: string): boolean {
  return /^(price|pricing|fee|opening_hours|hours|contact|phone|email|address|legal|licen[cs]e|certification|award|guarantee|warranty|offer|discount|claim|stat)s?([._]|$)/.test(key);
}

const CURRENCY: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", eur: "EUR", euro: "EUR", euros: "EUR", usd: "USD", dollar: "USD", dollars: "USD", gbp: "GBP", chf: "CHF", sek: "SEK", nok: "NOK", dkk: "DKK", bam: "BAM", km: "BAM" };
const CUR = "€|\\$|£|EUR|USD|GBP|CHF|SEK|NOK|DKK|BAM|euros?|dollars?";
const AMOUNT = "\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
export const PRICE_PATTERN = new RegExp(`(?:(${CUR})\\s?(${AMOUNT})|(${AMOUNT})\\s?(${CUR}))(?![\\p{L}\\d])`, "giu");
function amountOf(text: string): number | null {
  const digits = text.replace(/\s/g, "");
  // "1,200" / "1.200" thousands; "4,50" / "4.50" decimals.
  const value = /^\d{1,3}([.,]\d{3})+$/.test(digits) ? Number(digits.replace(/[.,]/g, "")) : Number(digits.replace(",", "."));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
export type Price = { amount: number; currency: string; text: string; index: number };
export function pricesIn(text: string): Price[] {
  const out: Price[] = [];
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const symbol = (match[1] ?? match[4] ?? "").toLowerCase(), amount = amountOf(match[2] ?? match[3] ?? "");
    const currency = CURRENCY[symbol] ?? CURRENCY[symbol.toUpperCase()] ?? symbol.toUpperCase();
    if (amount !== null && /^[A-Z]{3}$/.test(currency)) out.push({ amount, currency, text: match[0], index: match.index ?? 0 });
  }
  return out;
}

/** "9am", "9:30", "09.30", "17h", "5 pm" -> "HH:MM"; null when it is not a clock time. */
export function clockTime(hour: string, minute: string | undefined, meridiem: string | undefined): string | null {
  let h = Number(hour); const m = minute ? Number(minute) : 0;
  const mer = meridiem?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h >= 0 && h <= 24 && m >= 0 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null;
}
const TIME = "(\\d{1,2})(?:[:.h](\\d{2}))?\\s?(a\\.?m\\.?|p\\.?m\\.?)?";
export const HOURS_PATTERN = new RegExp(`${TIME}\\s?(?:-|–|—|to|until|till)\\s?${TIME}`, "gi");
export type Hours = { opens: string; closes: string; text: string; index: number };
export function hoursIn(text: string): Hours[] {
  const out: Hours[] = [];
  for (const match of text.matchAll(HOURS_PATTERN)) {
    // A bare "3-5" is not hours: one side needs minutes or am/pm.
    if (!match[2] && !match[3] && !match[5] && !match[6]) continue;
    const opens = clockTime(match[1], match[2], match[3] ?? match[6]), closes = clockTime(match[4], match[5], match[6]);
    if (opens && closes) out.push({ opens, closes, text: match[0], index: match.index ?? 0 });
  }
  return out;
}

/** A fact proposal before it reaches the database (keys normalised, values canonical). */
export const FactProposalSchema = z.object({
  kind: z.enum(FACT_KINDS),
  key: z.string().trim().min(1).max(160),
  label: z.string().trim().max(200).optional(),
  valueText: z.string().trim().min(1).max(2000),
  value: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.number(), z.string(), z.boolean()]).optional(),
  unit: z.string().trim().min(1).max(16).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  validFrom: day.optional(), validTo: day.optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  uncertainty: z.string().trim().max(1000).optional(),
  supersedesId: uuid.optional(),
  evidence: z.array(EvidenceInputSchema).min(1).max(10),
}).strict().refine(value => !value.validFrom || !value.validTo || value.validFrom <= value.validTo, "The end date is before the start date.");
export type FactProposal = z.input<typeof FactProposalSchema>;

/** Validates and canonicalises a proposal: normalised key; prices and opening hours get a structured value so equal claims compare equal. */
export function canonicalProposal(input: unknown): z.output<typeof FactProposalSchema> {
  const parsed = FactProposalSchema.parse(input);
  const key = normalizeKey(parsed.key);
  if (!key) throw new Error("Choose a name for this fact using letters and numbers.");
  const out = { ...parsed, key, valueText: cleanText(parsed.valueText) };
  if (out.value === undefined) {
    const canonical = canonicalValue(key, out.valueText);
    if (canonical.value !== undefined) out.value = canonical.value;
    if (canonical.currency && !out.currency) out.currency = canonical.currency;
  }
  return out;
}

/** Structured value for prices ({amount} + currency) and opening hours ({opens, closes} or {closed}); nothing for other keys. */
export function canonicalValue(key: string, valueText: string): { value?: Record<string, unknown>; currency?: string } {
  if (/^(price|pricing|fee)s?[._]/.test(key)) {
    const [price] = pricesIn(valueText);
    if (price) return { value: { amount: price.amount }, currency: price.currency };
  }
  if (/^(opening_)?hours[._]/.test(key)) {
    const [hours] = hoursIn(valueText);
    if (hours) return { value: { opens: hours.opens, closes: hours.closes } };
    if (/closed/i.test(valueText)) return { value: { closed: true } };
  }
  return {};
}

/** The payload the database entry point takes (camelCase JSON; evidence travels separately). */
export function factPayload(proposal: z.output<typeof FactProposalSchema>) {
  const { evidence, ...fact } = proposal;
  return { fact, evidence };
}

/** Same overlap rule as the database: inclusive date ranges, missing ends are open. */
export function windowsOverlap(a: { validFrom?: string | null; validTo?: string | null }, b: { validFrom?: string | null; validTo?: string | null }) {
  const aFrom = a.validFrom ?? "0000-01-01", aTo = a.validTo ?? "9999-12-31", bFrom = b.validFrom ?? "0000-01-01", bTo = b.validTo ?? "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}

/** Same identity as the generated column: structured value when present, else normalised text; plus currency and unit. */
export function valueIdentity(fact: { value?: unknown; valueText: string; currency?: string | null; unit?: string | null }) {
  const base = fact.value !== undefined && fact.value !== null ? `json:${canonicalJson(fact.value)}` : `text:${fact.valueText.trim().replace(/\s+/g, " ").toLowerCase()}`;
  return `${base}|${fact.currency ?? ""}|${fact.unit ?? ""}`;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Customer-facing words for each kind and status (no provider or model names). */
export const KIND_LABEL: Record<FactKind, string> = { observed_fact: "From a source", inference: "Inferred", user_decision: "Your decision", brand_preference: "Brand rule" };
export const STATUS_LABEL: Record<FactStatus, string> = { proposed: "Suggested", approved: "Approved", rejected: "Rejected", superseded: "Replaced" };

/** "Sheet Prices, cell B4", "Page 2", "Slide 3 · paragraph 1". */
export function describeLocator(locator: FactLocator | Record<string, unknown> | null | undefined): string {
  const l = (locator ?? {}) as FactLocator;
  const parts = [l.sheet ? `Sheet ${l.sheet}${l.cell ? `, cell ${l.cell}` : l.range ? `, cells ${l.range}` : ""}` : "",
    l.page ? `Page ${l.page}` : "", l.slide ? `Slide ${l.slide}` : "", l.section ? l.section : "",
    l.paragraph ? `paragraph ${l.paragraph}` : "", l.line ? `line ${l.line}` : "", l.label ?? ""].filter(Boolean);
  return parts.join(" · ");
}
