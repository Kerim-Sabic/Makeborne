import type { EvidenceInput, FactProposal } from "../knowledge/types";
import type { SiteCheck } from "./site-check";

/**
 * What a website check may add to client knowledge: PROPOSALS only, never
 * approved here. Each one cites the page it came from (url + when it was read
 * + sha256 of the bytes read) and, where the value is on the page, the exact
 * line. Contact details and opening hours are business truth: they stay out
 * of every task until a person approves them in Client knowledge.
 */
const SHA = /^[a-f0-9]{64}$/;
const clip = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function proposalsFromCheck(check: SiteCheck): FactProposal[] {
  if (check.status !== "checked") return [];
  const out: FactProposal[] = [];
  const counters = new Map<string, number>();
  const evidenceFor = (url: string, fetchedAt: string, sha256: string | undefined, quote?: string): EvidenceInput | null =>
    sha256 && SHA.test(sha256) ? { kind: "url", url, fetchedAt, sha256, ...(quote ? { quote: clip(quote, 480) } : {}) } : null;
  for (const contact of check.contacts) {
    const evidence = evidenceFor(contact.evidence.url, contact.evidence.checkedAt, contact.evidence.sha256, contact.evidence.quote);
    if (!evidence) continue;
    const base = { phone: "contact.phone", email: "contact.email", address: "address", hours: "opening_hours.listed" }[contact.kind];
    const n = (counters.get(base) ?? 0) + 1; counters.set(base, n);
    const label = { phone: "Phone (from their website)", email: "Email (from their website)", address: "Address (from their website)", hours: "Opening hours (from their website)" }[contact.kind];
    out.push({ kind: "observed_fact", key: n === 1 ? base : `${base}_${n}`, label, valueText: clip(contact.value, 300), observedAt: contact.evidence.checkedAt, evidence: [evidence] });
  }
  for (const finding of check.findings.slice(0, 8)) {
    const evidence = evidenceFor(finding.evidence.url, finding.evidence.checkedAt, finding.evidence.sha256, finding.evidence.quote);
    if (!evidence) continue;
    const measured = finding.evidence.measured ? ` (${clip(finding.evidence.measured, 200)})` : "";
    out.push({ kind: "observed_fact", key: `website.issue.${finding.id}`, label: `Website: ${finding.title}`,
      valueText: clip(`${finding.title}: ${finding.detail}${measured} Checked ${finding.evidence.checkedAt.slice(0, 10)}.`, 1000), observedAt: finding.evidence.checkedAt, evidence: [evidence] });
  }
  return out.slice(0, 20);
}
