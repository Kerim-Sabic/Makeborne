/** Unconfirmed claims before publishing (audit NPD "separate supplied facts from
 * invented copy"): statements in the website's visible text that only the
 * business can confirm — prices, guarantees, awards, testimonials and ratings,
 * "#1"-style rankings, certifications, figures, opening hours and contact
 * details. Pure pattern matching in the browser: no AI, no network, no credits.
 *
 * Limits: it reads the same visible text as the client-ready check (string
 * literals and JSX text in code, HTML, data files and the prepared pages), so
 * text assembled at runtime may be split or missed, and claims worded in other
 * ways (or other languages) aren't found. A match isn't an error: it is a
 * reminder to confirm the statement with the client. It never blocks publishing
 * and never knows whether a claim is true. */
import { visibleText, type ClientReadyInput } from "./client-ready";

export type ClaimKind = "price" | "guarantee" | "award" | "testimonial" | "ranking" | "certification" | "figure" | "hours" | "contact";
export type ClaimGroup = { kind: ClaimKind; label: string; hint: string; items: { text: string; locations: string[]; count: number }[]; count: number };

const KINDS: Record<ClaimKind, { label: string; hint: string; patterns: RegExp[] }> = {
  price: { label: "Prices and offers", hint: "Check every amount, currency and what it includes.", patterns: [
    /(?:[£$€¥₺]|\b(?:KM|BAM|EUR|USD|GBP|CHF)\s?)\d+(?:[.,]\d+)*(?:\s?(?:\/|per)\s?\w+)?/gi,
    /\b\d+(?:[.,]\d+)*\s?(?:€|KM|BAM|EUR|USD|GBP|CHF|zł|kn)(?=\s|[.,;)]|$)/gi,
    /\bfree\s+(?:delivery|shipping|consultations?|quotes?|trials?|estimates?|parking|wi-?fi|returns?)\b/gi,
    /\b\d{1,2}\s?%\s?(?:off|discount)\b|\bno hidden (?:fees|costs|charges)\b/gi,
  ] },
  guarantee: { label: "Guarantees and promises", hint: "Make sure the business really offers these terms.", patterns: [
    /\b(?:money[- ]back|satisfaction|price[- ]match|lifetime)\s+guarantee[ds]?\b/gi,
    /\bguarantee[ds]?\b[^.!?\n]{0,40}/gi, /\b\d+[- ]?(?:year|month|day)s?\s+(?:warranty|guarantee)\b/gi,
    /\b100\s?%\s+(?:satisfaction|guaranteed|safe|secure|natural|organic)\b/gi, /\brisk[- ]free\b/gi,
  ] },
  award: { label: "Awards and press", hint: "Confirm each award, year and publication.", patterns: [
    /\baward[- ]winning\b|\bwinners?\s+of\b[^.!?\n]{0,40}/gi, /\b(?:won|winning)\s+(?:the\s+)?[A-Z][^.!?\n]{0,40}\b[Aa]ward/g,
    /\bawards?\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s+awards?\b/gi, /\b(?:as\s+)?(?:seen|featured)\s+(?:in|on)\b[^.!?\n]{0,40}/gi, /\bvoted\b[^.!?\n]{0,40}/gi,
  ] },
  testimonial: { label: "Testimonials, reviews and ratings", hint: "Use only real reviews you have permission to quote.", patterns: [
    /[★⭐]{3,}|\b[1-5](?:\.\d)?\s?(?:\/\s?5\s?)?stars?\b|\b[1-5]-star\b|\brated\s+[1-5](?:\.\d)?\b/gi,
    /\b\d+(?:[.,]\d+)*\+?\s+(?:5-star\s+)?(?:reviews|ratings|testimonials)\b|\b(?:trustpilot|google reviews|tripadvisor|yelp)\b/gi,
    /[“"][^”"\n]{25,160}[”"]\s*(?:[—–-]|\n)\s*[A-Z][\p{L}.' -]{1,40}/gu,
  ] },
  ranking: { label: "Rankings and superlatives", hint: "Claims like “#1” or “the best” need evidence.", patterns: [
    /(?:^|[^\w&])#\s?1(?!\d|[a-f\d]{2})\b[^.!?\n]{0,30}|\bno\.?\s?1\b[^.!?\n]{0,30}|\bnumber\s+one\b[^.!?\n]{0,30}/gi,
    /\b(?:top|best|highest)[- ]rated\b|\b(?:market|industry)[- ]leading\b|\bleading\s+(?:provider|supplier|expert|company|agency)s?\b|\bthe\s+best\b[^.!?\n]{0,30}\bin\b[^.!?\n]{0,25}|\bworld[- ]class\b/gi,
  ] },
  certification: { label: "Certifications, licences and compliance", hint: "Confirm the exact certificate, licence or membership.", patterns: [
    /\b(?:fully\s+)?(?:certified|accredited|licensed|insured|chartered|registered|approved)\b[^.!?\n]{0,40}/gi,
    /\bISO\s?\d{4,5}\b|\bSOC\s?2\b|\bHIPAA\b|\bPCI[- ]DSS\b|\b(?:GDPR|CE)[- ](?:compliant|marked|certified)\b|\bGas Safe\b|\bNICEIC\b/gi,
  ] },
  figure: { label: "Numbers about the business", hint: "Check years, customer counts and percentages.", patterns: [
    /\b\d+(?:[.,]\d+)*\+?\s+(?:years?|happy|satisfied|clients|customers|projects|homes|patients|students|members|countries|locations|cities|employees|experts)\b[^.!?\n]{0,20}/gi,
    /\b(?:since|established|est\.?|founded(?:\s+in)?)\s+(?:19|20)\d{2}\b/gi, /\b\d{1,3}(?:[.,]\d)?\s?%(?!\s?(?:off|discount))\s+(?:of\s+)?\p{L}[^.!?\n]{0,25}/giu,
  ] },
  hours: { label: "Opening hours", hint: "Check days, times and holiday hours.", patterns: [
    /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b\s?(?:[–—-]|to)\s?\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b[^.!?\n]{0,30}/gi,
    /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)?\s?[–—-]\s?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\s?[–—-]\s?(?:[01]?\d|2[0-3]):[0-5]\d\b/gi,
    /\bopen\s+(?:24\/7|24 hours|daily|every day|7 days(?: a week)?)\b/gi,
  ] },
  contact: { label: "Contact details and addresses", hint: "Phone numbers, emails and addresses must be the business’s own.", patterns: [
    /(?:tel:)?(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g,
    /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    /\b\d{1,5}[a-z]?\s+(?:[A-Z][\p{L}'-]+\s){0,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Square|Sq|Place|Pl|Boulevard|Blvd|Ulica|Strasse|Straße)\b\.?/gu,
    /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g,
  ] },
};
const ORDER = Object.keys(KINDS) as ClaimKind[];
const digits = (text: string) => text.replace(/\D/g, "").length;
/** Strings that only look like claims inside code (colours, ids, sizes). */
function plausible(kind: ClaimKind, text: string) {
  if (kind === "contact" && /^(?:tel:)?[+()\d\s.-]+$/.test(text)) {
    const count = digits(text);
    // A phone number: 8 to 15 digits, not a date, time, size list or version.
    return count >= 8 && count <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(text) && (/^(?:tel:)?[+(0]/.test(text) || /[\s.-]/.test(text)) && !/^\d+(?:\.\d+){2,}$/.test(text);
  }
  if (kind === "contact" && /@/.test(text)) return !/\.(?:png|jpe?g|webp|svg|css|js|tsx?)$/i.test(text) && !/^@/.test(text);
  return true;
}
const tidy = (text: string) => text.replace(/^(?:tel|mailto):/i, "").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}#£$€¥₺+“"(★⭐]+/u, "").replace(/[\s,.;:–—-]+$/, "").trim();

/** Groups of claims found in the site's visible text, in a fixed order, bounded per group. */
export function siteClaims(input: ClientReadyInput, maxItems = 8, maxLocations = 4): ClaimGroup[] {
  const groups = new Map<ClaimKind, Map<string, { text: string; locations: string[]; count: number }>>();
  for (const { text, where } of visibleText(input)) {
    if (!text.trim()) continue;
    for (const kind of ORDER) for (const pattern of KINDS[kind].patterns) for (const match of text.matchAll(pattern)) {
      const found = tidy(match[0]);
      if (found.length < 3 || !plausible(kind, found)) continue;
      const key = found.toLowerCase(), group = groups.get(kind) ?? new Map();
      const item = group.get(key) ?? { text: found.slice(0, 120), locations: [], count: 0 };
      if (!item.locations.includes(where)) { item.count++; if (item.locations.length < maxLocations) item.locations.push(where); }
      group.set(key, item); groups.set(kind, group);
    }
  }
  return ORDER.filter(kind => groups.has(kind)).map(kind => {
    const items = [...groups.get(kind)!.values()];
    return { kind, label: KINDS[kind].label, hint: KINDS[kind].hint, items: items.slice(0, maxItems), count: items.length };
  });
}
