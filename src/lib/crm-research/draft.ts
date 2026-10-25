import type { CheckFinding } from "./score";

/**
 * An honest first email, written without AI from things that are true:
 * - at most three website findings, each as measured on a dated check, in the
 *   person's own words ("when I looked at … on 25 Oct I noticed …");
 * - approved client facts only (never suggested or rejected ones);
 * - the sender's name and business, and a plain way to say no.
 * It is a DRAFT for the person to read, edit and send themselves through the
 * existing email (send-only) or their own mail app. Nothing here sends, queues
 * or schedules anything, and nothing is written for someone on the
 * do-not-contact list.
 *
 * An optional "polish" step can rewrite the wording through a model port. It
 * is unqualified (refused) until a qualification run passes; with a test port
 * the result is accepted only if it adds no new numbers, years, prices, emails,
 * phone numbers or web addresses and keeps the opt-out line.
 */
export type DraftInput = {
  sender: { name: string; business?: string | null };
  recipient: { name: string; company?: string | null; email?: string | null };
  offer?: string | null;
  check?: { status: string; checkedAt: string; host: string | null; findings: Pick<CheckFinding, "id" | "title" | "detail" | "level">[] } | null;
  facts?: { id: string; label: string; valueText: string }[];
  suppressed?: boolean;
};
export type Draft = { subject: string; body: string; uses: { kind: "finding" | "fact"; ref: string; text: string }[]; warnings: string[] };
export class DraftRefused extends Error { constructor(public code: "SUPPRESSED" | "NO_RECIPIENT", message: string) { super(message); } }

export const OPT_OUT = "If this isn't useful, just reply “no thanks” and I won't contact you again.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const clean = (value: string | null | undefined, max = 200) => (value ?? "").replace(/[<>\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const first = (name: string) => clean(name, 60).split(" ")[0] || "there";
/** What each finding means for their customers, in one clause (no numbers beyond the finding's own). */
const PHRASE: Partial<Record<CheckFinding["id"], string>> = {
  https: "the site opens without https, so browsers show visitors a “Not secure” warning",
  mobile: "on a phone the site shows as a shrunken desktop page",
  cta: "there isn't a clear way to book, call or get in touch from the home page",
  no_contact: "I couldn't find a phone number, email or address on the pages I read",
  slow: "the home page was slow to load when I checked",
  broken_links: "some links on the home page lead to missing pages",
  dated: "the footer's copyright year makes the site look out of date",
  legacy: "the page is built with older techniques that break on modern phones",
  form: "there's no form for visitors to send a message",
  phone: "phone visitors can't call with one tap",
  hours: "I couldn't find your opening hours",
  structured: "Google can't read your opening hours and address from the page",
};

export function openingDraft(input: DraftInput): Draft {
  if (input.suppressed) throw new DraftRefused("SUPPRESSED", "This contact is on your do-not-contact list, so no draft was written.");
  if (!clean(input.recipient.name)) throw new DraftRefused("NO_RECIPIENT", "Add the client's name first.");
  const uses: Draft["uses"] = [], warnings: string[] = [];
  const business = clean(input.recipient.company) || clean(input.recipient.name);
  const sender = clean(input.sender.name, 80) || "I", senderBusiness = clean(input.sender.business, 80);
  const check = input.check && input.check.status === "checked" ? input.check : null;
  const picked = (check?.findings ?? []).filter(item => PHRASE[item.id]).slice(0, 3);
  const lines: string[] = [`Hi ${first(input.recipient.name)},`, ""];
  lines.push(`I'm ${sender}${senderBusiness ? ` from ${senderBusiness}` : ""}.${input.offer ? ` ${clean(input.offer, 240).replace(/\.?$/, ".")}` : ""}`);
  if (picked.length && check) {
    lines.push("", `When I looked at ${check.host ?? "your website"} on ${dateLabel(check.checkedAt)}, I noticed that:`);
    for (const item of picked) { lines.push(`- ${PHRASE[item.id]}`); uses.push({ kind: "finding", ref: item.id, text: item.title }); }
    lines.push("", "These are quick to fix, and they're often why visitors leave without getting in touch.");
  } else {
    warnings.push(check ? "The website check found nothing worth mentioning, so the email doesn't mention their site." : "No website check yet, so the email doesn't mention their site.");
  }
  const facts = (input.facts ?? []).slice(0, 2);
  if (facts.length) {
    lines.push("", "What I already know about you, so you can correct me if it's wrong:");
    for (const fact of facts) lines.push(`- ${clean(fact.label, 60) ? `${clean(fact.label, 60)}: ` : ""}${clean(fact.valueText, 140)}`);
    for (const fact of facts) uses.push({ kind: "fact", ref: fact.id, text: clean(fact.label || fact.valueText, 120) });
  }
  lines.push("", "Would a short call next week be useful? I can share a few concrete ideas for " + business + ", with no obligation.", "", OPT_OUT, "", "Best,", sender + (senderBusiness ? `\n${senderBusiness}` : ""));
  if (!clean(input.recipient.email)) warnings.push("This client has no email address yet.");
  const subject = picked.length ? `A few quick ideas for ${business}'s website` : `An idea for ${business}`;
  return { subject: subject.slice(0, 160), body: lines.join("\n"), uses, warnings };
}

// ---------- optional polish (unqualified) ----------
export interface DraftPolisher { readonly qualified: boolean; polish(draft: Draft, signal?: AbortSignal): Promise<{ subject: string; body: string }> }
export const UNQUALIFIED_POLISHER: DraftPolisher = Object.freeze({ qualified: false, polish: async () => { throw new Error("DRAFT_POLISH_NOT_QUALIFIED"); } });

const TOKENS = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.]+|[€$£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:%|€|eur|usd|gbp|percent)|\+?\d[\d\s().-]{6,}\d|\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\b/gi;
const tokens = (text: string) => new Set((text.match(TOKENS) ?? []).map(item => item.replace(/\s+/g, "").toLowerCase()));
/** The polished text may only rephrase: anything factual-looking it adds is a reason to keep the original. */
export function polishProblems(original: Draft, polished: { subject: string; body: string }): string[] {
  const allowed = tokens(`${original.subject}\n${original.body}`), problems: string[] = [];
  for (const token of tokens(`${polished.subject}\n${polished.body}`)) if (!allowed.has(token)) problems.push(`Adds “${token}”, which isn't in the facts`);
  if (!polished.body.includes(OPT_OUT)) problems.push("Drops the opt-out line");
  if (polished.body.length > 4000 || polished.subject.length > 160) problems.push("Too long");
  return problems;
}
export async function polishDraft(draft: Draft, polisher: DraftPolisher = UNQUALIFIED_POLISHER, signal?: AbortSignal): Promise<{ draft: Draft; polished: boolean; problems: string[] }> {
  if (!polisher.qualified) return { draft, polished: false, problems: ["Polishing isn't available yet."] };
  const result = await polisher.polish(draft, signal);
  const problems = polishProblems(draft, result);
  return problems.length ? { draft, polished: false, problems } : { draft: { ...draft, subject: result.subject, body: result.body }, polished: true, problems: [] };
}
