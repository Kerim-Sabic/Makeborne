import { cleanText, hoursIn, pricesIn } from "./types";

/**
 * "No unsupported facts in a website, book or deck": a deterministic check of
 * generated copy against what the client actually supports. Every price,
 * clock time, figure, phone number, email address and status word ("award-
 * winning", "certified", "since", "#1", ...) must trace to an APPROVED fact
 * (observed, decided or a brand rule; never an inference) or to the brief.
 * The artifact being checked is never a source for itself, and neither are
 * other generated artifacts: inferences are the only facts they can support,
 * and inferences never count here.
 *
 * Exposed as a check only. Builders and the reviewer call checkCopyClaims (or
 * checkArtifactClaims for saved content) after generation and treat
 * `unsupported` and `unapproved` findings as blocking; `disputed` is a warning.
 */
export type ClaimFact = Readonly<{
  id: string; key: string; kind: "observed_fact" | "inference" | "user_decision" | "brand_preference";
  trust: "approved" | "unapproved"; valueText: string; label?: string; currency?: string | null; pending?: readonly unknown[];
}>;
export type ClaimFinding = Readonly<{
  type: "price" | "time" | "figure" | "phone" | "email" | "status";
  text: string; status: "unsupported" | "unapproved" | "disputed"; detail: string; factIds?: readonly string[];
}>;
export type ClaimReport = Readonly<{ ok: boolean; findings: readonly ClaimFinding[]; checked: number }>;

/** Status words that assert something about the business. */
export const STATUS_WORDS = ["award", "awards", "award-winning", "certified", "accredited", "licensed", "licenced", "insured", "guaranteed", "guarantee", "warranty",
  "patented", "official", "registered", "approved", "endorsed", "family-owned", "family-run", "established", "since", "founded", "#1", "best", "leading", "top-rated",
  "rated", "voted", "trusted", "bestselling", "best-selling", "organic", "free", "24/7", "fastest", "cheapest", "largest"] as const;
const ILLUSTRATIVE = /\b(illustrative|for illustration|example|sample|placeholder|fictional|hypothetical)\b/i;
const NUMBER = /(?<![\p{L}\d.,:#+])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?%|\s?(?:k|m|million|thousand|bn|billion)\b)?/giu;
const PHONE = /(?:\+|00)\d[\d ()./-]{6,18}\d|\b\d{3}[ ./-]\d{3}[ ./-]?\d{2,4}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}\b/g;

type Support = { id: string | null; text: string; approved: boolean; disputed: boolean };
function supports(facts: readonly ClaimFact[], brief: string): Support[] {
  // Inferences never support a claim; everything else counts only when approved (unapproved support is reported as such).
  return [
    ...(brief.trim() ? [{ id: null, text: cleanText(brief), approved: true, disputed: false }] : []),
    ...facts.filter(fact => fact.kind !== "inference").map(fact => ({ id: fact.id, text: cleanText(`${fact.label ?? ""} ${fact.key.replace(/[._]/g, " ")} ${fact.valueText} ${fact.currency ?? ""}`),
      approved: fact.trust === "approved", disputed: !!fact.pending?.length })),
  ];
}
const numbers = (text: string) => [...text.matchAll(NUMBER)].map(match => scale(match[1], match[2]));
function scale(digits: string, unit = ""): number {
  const base = Number(digits.replace(/,/g, "")), u = unit.trim().toLowerCase();
  const value = u === "k" || u === "thousand" ? base * 1e3 : u === "m" || u === "million" ? base * 1e6 : u === "bn" || u === "billion" ? base * 1e9 : base;
  return Math.round(value * 1000) / 1000;
}
const times = (text: string) => {
  const out = new Set<string>();
  for (const hours of hoursIn(text)) { out.add(hours.opens); out.add(hours.closes); }
  for (const match of text.matchAll(/\b(\d{1,2})[:.](\d{2})\b|\b(\d{1,2})\s?(a\.?m\.?|p\.?m\.?)/gi)) {
    let h = Number(match[1] ?? match[3]); const m = Number(match[2] ?? 0), mer = match[4]?.toLowerCase().replace(/\./g, "");
    if (mer === "pm" && h < 12) h += 12; if (mer === "am" && h === 12) h = 0;
    if (h <= 24 && m < 60) out.add(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
};
const words = (text: string) => new Set(text.toLowerCase().match(/[#\p{L}\p{N}][\p{L}\p{N}/-]*/gu) ?? []);

function judge(matching: Support[], type: ClaimFinding["type"], text: string, what: string): ClaimFinding | null {
  const approved = matching.filter(item => item.approved);
  if (approved.length && approved.some(item => !item.disputed)) return null;
  if (approved.length) return { type, text, status: "disputed", detail: `${what} matches an approved fact that a newer source disputes.`, factIds: approved.flatMap(item => item.id ? [item.id] : []) };
  if (matching.length) return { type, text, status: "unapproved", detail: `${what} matches only a suggested fact nobody has approved yet.`, factIds: matching.flatMap(item => item.id ? [item.id] : []) };
  return { type, text, status: "unsupported", detail: `${what} is not in the client's approved facts or the brief.` };
}

/** Checks lines of generated copy. */
export function checkCopyClaims(copy: string | readonly string[], facts: readonly ClaimFact[], brief = ""): ClaimReport {
  const lines = (typeof copy === "string" ? copy.split(/\n+/) : copy).map(cleanText).filter(Boolean);
  const base = supports(facts, brief);
  const findings: ClaimFinding[] = [];
  let checked = 0;
  const add = (finding: ClaimFinding | null) => { checked++; if (finding && !findings.some(item => item.type === finding.type && item.text === finding.text)) findings.push(finding); };
  for (const line of lines) {
    if (ILLUSTRATIVE.test(line)) continue;
    const covered: [number, number][] = [];
    const cover = (index: number, length: number) => covered.push([index, index + length]);
    const isCovered = (index: number) => covered.some(([start, end]) => index >= start && index < end);
    for (const price of pricesIn(line)) {
      cover(price.index, price.text.length);
      add(judge(base.filter(item => pricesIn(item.text).some(known => known.amount === price.amount && known.currency === price.currency)), "price", price.text, `The price ${price.text}`));
    }
    for (const match of line.matchAll(EMAIL)) {
      cover(match.index ?? 0, match[0].length);
      add(judge(base.filter(item => item.text.toLowerCase().includes(match[0].toLowerCase())), "email", match[0], `The address ${match[0]}`));
    }
    for (const match of line.matchAll(PHONE)) {
      const digits = match[0].replace(/\D/g, "");
      if (digits.length < 7 || isCovered(match.index ?? 0)) continue;
      cover(match.index ?? 0, match[0].length);
      add(judge(base.filter(item => item.text.replace(/\D/g, " ").includes(digits) || item.text.replace(/\D/g, "").includes(digits)), "phone", match[0], `The number ${match[0]}`));
    }
    const lineTimes = times(line);
    for (const hours of hoursIn(line)) cover(hours.index, hours.text.length);
    for (const match of line.matchAll(/\b(\d{1,2})[:.](\d{2})\b|\b(\d{1,2})\s?(a\.?m\.?|p\.?m\.?)/gi)) cover(match.index ?? 0, match[0].length);
    for (const time of lineTimes) add(judge(base.filter(item => times(item.text).has(time)), "time", time, `The time ${time}`));
    for (const match of line.matchAll(NUMBER)) {
      if (isCovered(match.index ?? 0)) continue;
      const value = scale(match[1], match[2]);
      // Step and list numerals ("Step 2", "1.") are layout, not claims.
      const before = line.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0).toLowerCase();
      if (value <= 10 && /(step|no\.|part|chapter|slide|page|#)\s*$/.test(before)) continue;
      add(judge(base.filter(item => numbers(item.text).includes(value)), "figure", match[0].trim(), `The figure ${match[0].trim()}`));
    }
    const lineWords = words(line);
    for (const word of STATUS_WORDS) {
      if (!lineWords.has(word)) continue;
      add(judge(base.filter(item => words(item.text).has(word)), "status", word, `"${word}"`));
    }
  }
  return Object.freeze({ ok: !findings.some(item => item.status !== "disputed"), findings: Object.freeze(findings), checked });
}

const SKIP_KEYS = new Set(["id", "src", "href", "url", "image", "images", "icon", "class", "classname", "style", "styles", "css", "type", "kind", "layout", "tone",
  "schemaversion", "color", "colors", "font", "fonts", "variant", "slug", "path", "asset", "assetid", "assets", "theme", "token", "tokens"]);
const MAX_COPY = 400_000;
/** Visible copy from saved website/book/deck content: JSON strings (minus ids, links, styling) and HTML text (minus tags, scripts, styles). */
export function copyFromContent(content: unknown): string[] {
  const out: string[] = [];
  let size = 0;
  const push = (text: string) => { const clean = cleanText(text); if (clean && size < MAX_COPY) { out.push(clean.slice(0, MAX_COPY - size)); size += clean.length; } };
  const html = (text: string) => text.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>|<\/(p|h[1-6]|li|div|section|td|th|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&euro;/g, "€").replace(/&pound;/g, "£").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 40 || size >= MAX_COPY) return;
    if (typeof value === "string") {
      if (SKIP_KEYS.has(key.toLowerCase()) || /^(https?:|data:|#[0-9a-f]{3,8}$|\/)/i.test(value.trim())) return;
      // Source files: only markup and content files carry copy.
      if (/\.(css|js|mjs|ts|tsx|jsx|json|svg|map)$/i.test(key)) return;
      if (/<[a-z!/][^>]*>/i.test(value)) { for (const line of html(value).split(/\n+/)) push(line); return; }
      push(value);
    } else if (Array.isArray(value)) value.forEach(item => walk(item, key, depth + 1));
    else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) walk(item, name, depth + 1);
  };
  walk(content, "", 0);
  return out;
}

/** Checks saved artifact content (website, book or deck). */
export function checkArtifactClaims(content: unknown, facts: readonly ClaimFact[], brief = ""): ClaimReport {
  return checkCopyClaims(copyFromContent(content), facts, brief);
}
