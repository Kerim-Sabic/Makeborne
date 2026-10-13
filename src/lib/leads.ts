import { z } from "zod";

/** What research found on a lead's public page, and what the AI concluded from it. */
export const LeadResearchSchema = z.object({
  url: z.string().max(500), platform: z.string().max(30), handle: z.string().max(60).nullable(),
  followers: z.string().max(20).nullable(), following: z.string().max(20).nullable(), posts: z.string().max(20).nullable(),
  bio: z.string().max(600), at: z.string().max(40),
}).strict();
export const LeadInsightSchema = z.object({
  niche: z.string().max(240), audience: z.string().max(240), angle: z.string().max(300),
  confidence: z.enum(["high", "medium", "low", ""]), at: z.string().max(40),
}).strict();
export const LeadProfileSchema = z.object({ research: LeadResearchSchema.optional(), insight: LeadInsightSchema.optional() }).passthrough();
export type LeadProfile = z.infer<typeof LeadProfileSchema>;

export const LEAD_SOURCES = ["", "Instagram", "TikTok", "YouTube", "LinkedIn", "Referral", "Website", "Cold email", "Event", "Import", "Other"] as const;
export const CURRENCIES = ["EUR", "USD", "GBP", "BAM", "CHF"] as const;
export type Lead = { tags: string[]; dealValue: number | null; dealCurrency: string; source: string; profile: LeadProfile };
export const emptyLead = (): Lead => ({ tags: [], dealValue: null, dealCurrency: "EUR", source: "", profile: {} });

export const normalizeTag = (tag: string) => tag.trim().replace(/\s+/g, " ").replace(/[<>\n\r]/g, "").slice(0, 30);

/** "48K", "1.2M", "1,204" → a number (null when unknown). */
export function countValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /^([\d.,]+)\s*([KkMm]?)$/.exec(raw.trim());
  if (!match) return null;
  const unit = match[2].toLowerCase(), base = unit ? Number(match[1].replace(/,/g, ".").replace(/\.(?=.*\.)/g, "")) : Number(match[1].replace(/[.,]/g, ""));
  return Number.isFinite(base) ? Math.round(base * (unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1)) : null;
}
export const compactCount = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const formatMoney = (value: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: value >= 1000 ? 0 : 2 }).format(value);

/**
 * A transparent 0–100 lead score: how far along they are (stage), how reachable
 * (email), how big the opportunity looks (deal value, audience), and how much we
 * know (research). Closed clients have no score.
 */
export function scoreLead(input: { stage: string; hasEmail: boolean; lead: Lead; overdue: boolean }) {
  if (input.stage === "Won" || input.stage === "Lost") return null;
  const reasons: string[] = [];
  let score = ({ Lead: 20, Contacted: 32, Conversation: 55, Proposal: 70 } as Record<string, number>)[input.stage] ?? 20;
  reasons.push(`${input.stage} stage`);
  const followers = countValue(input.lead.profile.research?.followers);
  if (followers !== null && followers > 0) { const bonus = Math.min(15, Math.round(Math.log10(followers) * 3)); score += bonus; reasons.push(`${compactCount(followers)} followers`); }
  if ((input.lead.dealValue ?? 0) > 0) { score += 10; reasons.push("deal value set"); }
  if (input.lead.profile.insight?.niche) { score += 5; reasons.push("researched"); }
  if (input.hasEmail) { score += 5; } else { score -= 10; reasons.push("no email"); }
  if (input.overdue) reasons.push("follow-up overdue");
  const value = Math.max(0, Math.min(100, score));
  return { value, tier: value >= 70 ? "hot" as const : value >= 45 ? "warm" as const : "cold" as const, reasons };
}

export function leadFromRow(row: { tags?: string[] | null; deal_value?: number | string | null; deal_currency?: string | null; lead_source?: string | null; lead_profile?: unknown }): Lead {
  const profile = LeadProfileSchema.safeParse(row.lead_profile ?? {});
  return { tags: row.tags ?? [], dealValue: row.deal_value === null || row.deal_value === undefined ? null : Number(row.deal_value), dealCurrency: row.deal_currency ?? "EUR",
    source: row.lead_source ?? "", profile: profile.success ? profile.data : {} };
}
