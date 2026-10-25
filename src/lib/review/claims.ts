import type { ApprovedFacts, ClaimCheckResult, ClaimKind, ClaimsCheck } from "./contract";

/**
 * Deterministic default for the reviewer's "approved facts + claims check":
 * prices and percentages stated in the rendered output must match a value in
 * an approved fact (same currency and amount, or the same percentage).
 * It is deliberately narrow (no free-text entailment): a claim it cannot
 * extract is not judged here. The knowledge module's checker can replace it
 * through the same ClaimsCheck signature.
 */
const CURRENCY: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", usd: "USD", eur: "EUR", gbp: "GBP", chf: "CHF", bam: "BAM" };
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, bn: 1e9, million: 1e6, billion: 1e9, thousand: 1e3 };
const PREFIX = /([$€£¥])\s?(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s?(k|m|bn|million|billion|thousand)\b)?/gi;
// The amount must not be glued to other digits, and the currency must not start another amount ("01 €49" is not "1 €").
// "KM" is left out on purpose: it is also kilometres.
const SUFFIX = /(?<![\d.,])(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(k|m|bn|million|billion|thousand)?\s?(€|eur|usd|gbp|chf|bam)(?![\p{L}\d])/giu;
const PERCENT = /(\d+(?:[.,]\d+)?)\s?%/g;

function amount(raw: string): number {
  const text = raw.replace(/\s/g, "");
  // "1,200.50" / "1.200,50" / "1,200" / "49.90": the last separator followed by 1–2 digits is the decimal mark.
  const decimal = /[.,](\d{1,2})$/.exec(text);
  const whole = decimal ? text.slice(0, -decimal[0].length) : text;
  return Number(`${whole.replace(/[.,]/g, "")}${decimal ? `.${decimal[1]}` : ""}`);
}

export type ExtractedClaim = { text: string; kind: ClaimKind; key: string };
export function extractClaims(text: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [], seen = new Set<string>();
  const push = (claim: ExtractedClaim) => { const id = `${claim.key}|${claim.text}`; if (!seen.has(id)) { seen.add(id); out.push(claim); } };
  for (const match of text.matchAll(PREFIX)) {
    const value = amount(match[2]) * (match[3] ? SCALE[match[3].toLowerCase()] : 1);
    if (Number.isFinite(value)) push({ text: match[0].trim(), kind: "price", key: `price:${CURRENCY[match[1]]}:${value}` });
  }
  for (const match of text.matchAll(SUFFIX)) {
    const value = amount(match[1]) * (match[2] ? SCALE[match[2].toLowerCase()] : 1);
    if (Number.isFinite(value)) push({ text: match[0].trim(), kind: "price", key: `price:${CURRENCY[match[3].toLowerCase()]}:${value}` });
  }
  for (const match of text.matchAll(PERCENT)) push({ text: match[0].trim(), kind: "percentage", key: `percentage:${Number(match[1].replace(",", "."))}` });
  return out;
}

export const defaultClaimsCheck: ClaimsCheck = (text: string, facts: ApprovedFacts): readonly ClaimCheckResult[] => {
  const supported = new Map<string, string>();
  for (const fact of facts.facts) for (const claim of extractClaims(`${fact.statement} ${fact.value ?? ""}`)) if (!supported.has(claim.key)) supported.set(claim.key, fact.id);
  return extractClaims(text).map(claim => Object.freeze({ text: claim.text, kind: claim.kind, supported: supported.has(claim.key), factId: supported.get(claim.key) ?? null }));
};
