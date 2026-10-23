import type { ExtractionRecord } from "../ingest/record";
import { boundQuote, cleanText, hoursIn, normalizeKey, pricesIn, type EvidenceInput, type FactLocator, type FactProposal } from "./types";

/**
 * Deterministic suggestions from material a client supplied: prices, opening
 * hours and contact details, each with the exact place it was read. No model
 * call. Every result is a PROPOSAL: the database stores it as 'proposed', and
 * prices, hours and contact details are never given to a task until a person
 * approves them. Text inside a source is data: an "instruction" in it is just
 * a quote, and nothing here (or in the database) acts on it.
 */
export type ExtractionInput = Pick<ExtractionRecord, "sourceSha256" | "extractionVersion" | "blocks" | "slides" | "sheets">;
/** Where suggestions point: the stored upload (asset) or project source the text was read from. */
export type ExtractionTarget = { kind: "asset" | "source"; refId: string; sha256: string; extractionVersion?: string; observedAt?: string };

export const MAX_SUGGESTIONS = 200;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_ALIASES: Record<string, number> = { mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2, thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6 };
const DAY_WORD = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const DAY_RANGE = new RegExp(`\\b${DAY_WORD}\\b(?:\\s?(?:-|–|—|to)\\s?\\b${DAY_WORD}\\b)?`, "i");
const PLAIN_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} '’&()+,.-]{0,79}$/u;
const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}\b/g;
const PHONE = /(?:\+|00)?\d[\d ()./-]{6,18}\d/g;

function evidence(target: ExtractionTarget, locator: FactLocator, quote: string): EvidenceInput {
  return { kind: target.kind, refId: target.refId, sha256: target.sha256, ...(target.extractionVersion ? { extractionVersion: target.extractionVersion } : {}), locator, quote: boundQuote(quote) };
}

function days(text: string): string[] {
  const match = DAY_RANGE.exec(text);
  if (!match) return [];
  const start = DAY_ALIASES[match[1].toLowerCase()], end = match[2] ? DAY_ALIASES[match[2].toLowerCase()] : start;
  if (start === undefined || end === undefined) return [];
  const out: string[] = [];
  for (let i = start; ; i = (i + 1) % 7) { out.push(DAYS[i]); if (i === end || out.length === 7) break; }
  return out;
}

/** Suggestions from one line of text at one place. */
export function suggestionsFromLine(line: string, locator: FactLocator, target: ExtractionTarget): FactProposal[] {
  const text = cleanText(line);
  if (!text || text.length > 2000) return [];
  const out: FactProposal[] = [];
  const base = { kind: "observed_fact" as const, ...(target.observedAt ? { observedAt: target.observedAt } : {}) };
  const covered: [number, number][] = [];
  const hours = hoursIn(text), dayList = days(text);
  if (dayList.length && (hours.length || /\bclosed\b/i.test(text))) {
    const value = hours[0] ? { opens: hours[0].opens, closes: hours[0].closes } : { closed: true };
    const valueText = hours[0] ? `${hours[0].opens}–${hours[0].closes}` : "Closed";
    for (const day of dayList) out.push({ ...base, key: `opening_hours.${day}`, label: `Opening hours, ${day[0].toUpperCase()}${day.slice(1)}`, valueText, value, evidence: [evidence(target, locator, text)] });
    for (const item of hours) covered.push([item.index, item.index + item.text.length]);
  }
  for (const price of pricesIn(text)) {
    if (covered.some(([start, end]) => price.index >= start && price.index < end)) continue;
    // The label is the words before the price on the same line ("Flat tyre repair: EUR 45").
    const before = text.slice(0, price.index).replace(/[\s:–—=|-]+$/, "").split(/[.;!?•|]\s/).pop() ?? "";
    const label = before.replace(/^[\s•*-]+/, "").replace(/\b(from|only|just|costs?|price|is)\s*$/i, "").trim();
    // A label is a short run of plain words; markup, JSON or a sentence is not a product name.
    const key = PLAIN_LABEL.test(label) && label.split(/\s+/).length <= 8 ? normalizeKey(`price.${label}`) : null;
    if (!key || key === "price") continue;
    out.push({ ...base, key, label, valueText: `${price.currency} ${price.amount % 1 ? price.amount.toFixed(2) : price.amount}`,
      value: { amount: price.amount }, currency: price.currency, evidence: [evidence(target, locator, text)] });
  }
  for (const match of text.matchAll(EMAIL)) out.push({ ...base, key: "contact.email", label: "Email", valueText: match[0].toLowerCase(), evidence: [evidence(target, locator, text)] });
  if (/\b(phone|tel|telephone|call|mobile|whatsapp)\b/i.test(text)) {
    for (const match of text.matchAll(PHONE)) {
      const digits = match[0].replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15 || hours.some(item => item.text.includes(match[0]))) continue;
      out.push({ ...base, key: "contact.phone", label: "Phone", valueText: match[0].trim(), value: { digits }, evidence: [evidence(target, locator, text)] });
    }
  }
  return out;
}

/** Suggestions from an ingestion record (documents, decks and spreadsheets), bounded. */
export function suggestionsFromExtraction(record: ExtractionInput, target: Omit<ExtractionTarget, "sha256" | "extractionVersion">): FactProposal[] {
  const full: ExtractionTarget = { ...target, sha256: record.sourceSha256, extractionVersion: record.extractionVersion };
  const out: FactProposal[] = [];
  const push = (items: FactProposal[]) => { for (const item of items) if (out.length < MAX_SUGGESTIONS) out.push(item); };
  let paragraph = 0;
  for (const block of record.blocks) {
    if (block.type !== "paragraph" && block.type !== "heading" && block.type !== "note") continue;
    paragraph++;
    const page = /page (\d+)/i.exec(block.location ?? "")?.[1];
    for (const line of block.text.split(/\n+/)) push(suggestionsFromLine(line, { paragraph, ...(page ? { page: Number(page) } : {}) }, full));
  }
  for (const slide of record.slides) {
    if (slide.hidden) continue;
    for (const [index, line] of [slide.title, ...slide.body].entries()) push(suggestionsFromLine(line, { slide: slide.index, ...(index ? { paragraph: index } : {}) }, full));
  }
  for (const sheet of record.sheets) {
    if (sheet.hidden || sheet.kind === "chart") continue;
    const byRow = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) byRow.set(cell.row, [...(byRow.get(cell.row) ?? []), cell]);
    for (const cells of byRow.values()) {
      const sorted = [...cells].sort((a, b) => a.col - b.col);
      // A label cell followed by a currency cell is a price, cited at the price cell.
      for (const [index, cell] of sorted.entries()) {
        const label = sorted.slice(0, index).reverse().find(item => item.kind === "string" && item.text.trim());
        // CSV cells carry the parsed amount in `number`; XLSX cells keep the saved numeric value in `value`.
        const amount = typeof cell.number === "number" ? cell.number : typeof cell.value === "number" && Number.isFinite(cell.value) ? cell.value : null;
        if (cell.kind === "currency" && amount !== null && cell.currency && label) {
          const key = normalizeKey(`price.${label.text}`);
          if (key && key !== "price") push([{ kind: "observed_fact", key, label: cleanText(label.text).slice(0, 200), valueText: `${cell.currency} ${amount}`, value: { amount: Math.round(amount * 100) / 100 },
            currency: cell.currency, ...(target.observedAt ? { observedAt: target.observedAt } : {}), evidence: [evidence(full, { sheet: sheet.name, cell: cell.ref }, `${label.text}: ${cell.text}`)] }]);
        } else if (cell.kind === "string" && index === sorted.length - 1) {
          push(suggestionsFromLine(sorted.map(item => item.text).join(": "), { sheet: sheet.name, cell: sorted[0].ref }, full));
        }
      }
    }
  }
  return dedupe(out);
}

/** Suggestions from a plain project source (public.sources content), one locator per line. */
export function suggestionsFromText(text: string, target: ExtractionTarget): FactProposal[] {
  const out: FactProposal[] = [];
  for (const [index, line] of text.slice(0, 600_000).split(/\n/).entries()) {
    for (const item of suggestionsFromLine(line, { line: index + 1 }, target)) if (out.length < MAX_SUGGESTIONS) out.push(item);
  }
  return dedupe(out);
}

function dedupe(items: FactProposal[]): FactProposal[] {
  const seen = new Set<string>();
  return items.filter(item => { const id = `${item.key}|${item.valueText}`; if (seen.has(id)) return false; seen.add(id); return true; });
}
