/**
 * Scores, as transparent points models (no AI, no hidden weights).
 *
 * Website opportunity (0–100): how much a better website would help this
 * business, from what the check measured. Every point comes from a finding the
 * person can see, with its evidence. An unreadable site has no score.
 *
 * Lead fit (0–100): who to contact first, combining the website opportunity,
 * whether there's a public way to reach them, whether their category is one
 * you serve, and two hard stops: the do-not-contact list and "already a client".
 */
export type Evidence = { url: string; checkedAt: string; quote?: string; measured?: string; sha256?: string };
export const FINDING_IDS = ["https", "mobile", "cta", "no_contact", "slow", "broken_links", "dated", "legacy", "form", "phone", "heavy", "structured", "hours", "h1", "description", "alt", "thin"] as const;
export type FindingId = (typeof FINDING_IDS)[number];
export type CheckFinding = { id: FindingId; level: "high" | "medium" | "low"; title: string; detail: string; points: number; evidence: Evidence };
export type CheckStrength = { id: string; title: string; evidence: Evidence };

export const FINDING_POINTS: Readonly<Record<FindingId, { level: CheckFinding["level"]; points: number }>> = Object.freeze({
  https: { level: "high", points: 16 }, mobile: { level: "high", points: 16 }, cta: { level: "high", points: 12 }, no_contact: { level: "high", points: 12 },
  slow: { level: "medium", points: 10 }, broken_links: { level: "medium", points: 8 }, dated: { level: "medium", points: 8 }, legacy: { level: "medium", points: 8 },
  form: { level: "medium", points: 5 }, phone: { level: "medium", points: 5 },
  heavy: { level: "low", points: 5 }, structured: { level: "low", points: 4 }, hours: { level: "low", points: 3 }, h1: { level: "low", points: 3 },
  description: { level: "low", points: 3 }, alt: { level: "low", points: 2 }, thin: { level: "low", points: 3 },
});
const ORDER = { high: 0, medium: 1, low: 2 } as const;

export function bandOf(score: number | null): "strong" | "some" | "low" | "unknown" {
  return score === null ? "unknown" : score >= 45 ? "strong" : score >= 20 ? "some" : "low";
}

/** Points and levels applied, most important first; deterministic for the same findings. */
export function scoreFindings(findings: readonly CheckFinding[]) {
  const unique = new Map<FindingId, CheckFinding>();
  for (const finding of findings) if (!unique.has(finding.id) && FINDING_POINTS[finding.id]) unique.set(finding.id, { ...finding, ...FINDING_POINTS[finding.id] });
  const sorted = [...unique.values()].sort((a, b) => ORDER[a.level] - ORDER[b.level] || b.points - a.points || FINDING_IDS.indexOf(a.id) - FINDING_IDS.indexOf(b.id));
  const score = Math.min(100, sorted.reduce((sum, item) => sum + item.points, 0));
  const band = bandOf(score);
  const top = sorted.slice(0, 3).map(item => item.title.toLowerCase());
  const summary = !sorted.length ? "We found no clear problems on the pages we read. Lead with something other than their website."
    : band === "strong" ? `A better website would clearly help: ${top.join(", ")}.`
    : band === "some" ? `Some room to improve: ${top.join(", ")}.`
    : `Only small issues: ${top.join(", ")}.`;
  return { score, band, summary, findings: sorted };
}

export type FitInput = {
  check?: { status: "checked" | "inaccessible" | "no_website"; score: number | null; reason?: string | null } | null;
  website?: string | null; email?: string | null; phone?: string | null; category?: string | null;
  /** Categories you serve (lowercase words); empty means "any". */
  targets?: readonly string[];
  suppressed?: boolean; existing?: boolean;
};
export type FitReason = { text: string; points: number };
export type Fit = { score: number; tier: "hot" | "warm" | "cold" | "excluded"; reasons: FitReason[] };

export function fitScore(input: FitInput): Fit {
  if (input.suppressed) return { score: 0, tier: "excluded", reasons: [{ text: "On your do-not-contact list", points: 0 }] };
  const reasons: FitReason[] = [];
  const add = (text: string, points: number) => reasons.push({ text, points });
  const check = input.check ?? null;
  if (!input.website?.trim() || check?.status === "no_website") add("No website listed: a first site is the natural offer (confirm they have none)", 40);
  else if (check?.status === "checked" && check.score !== null) add(`Website check: ${check.score}/100 room to improve`, Math.round(check.score * 0.5));
  else if (check?.status === "inaccessible") add(check.reason === "robots" ? "Their site asks automated readers not to read it: check it yourself" : "Their website didn't load when checked: check it yourself", 5);
  else add("Website not checked yet", 0);
  if (input.email?.trim()) add("Public email address", 15);
  if (input.phone?.trim()) add("Public phone number", 8);
  if (!input.email?.trim() && !input.phone?.trim()) add("No public email or phone", -10);
  const targets = (input.targets ?? []).map(item => item.trim().toLowerCase()).filter(Boolean);
  const category = (input.category ?? "").toLowerCase();
  if (targets.length && category) {
    const hit = targets.find(item => category.includes(item) || item.includes(category));
    if (hit) add(`Category you serve (${hit})`, 15); else add("Not one of the categories you serve", -5);
  }
  let score = Math.max(0, Math.min(100, reasons.reduce((sum, item) => sum + item.points, 0)));
  if (input.existing) { reasons.unshift({ text: "Already in your clients", points: 0 }); score = Math.min(score, 10); }
  const tier = input.existing ? "excluded" as const : score >= 55 ? "hot" as const : score >= 30 ? "warm" as const : "cold" as const;
  return { score, tier, reasons };
}
