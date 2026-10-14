import { z } from "zod";

/**
 * Lead finder pricing: credits for leads actually delivered (verified and not
 * already in the CRM), plus the AI ranking at the standard chat rate. Nothing
 * is charged when no leads come back. Adding leads to the CRM is free.
 */
export const LEAD_FINDER = {
  creditsPerLead: 0.2,
  /** Credits the AI ranking may use at most (its share of the hold). */
  rankingCredits: 3,
  /** Price multiple on the ranking's provider cost, same as personalised emails. */
  priceMultiplier: 15,
  /** Web search (creator discovery, and the map's fallback): fees are $0.01 per search, so a lower multiple keeps it fair. */
  searchPriceMultiplier: 3,
  /** Searches allowed per discovery, and the credits its hold reserves (covers the worst-case bound at the search rate). */
  searchUses: { creators: 4, businesses: 3 },
  searchCredits: 6,
  counts: [10, 25, 40] as const,
  maxListItems: 40,
} as const;

/** The most a search can cost: what the hold reserves and the UI quotes. Map searches may fall back to the web, so they reserve for it too. */
export const leadFinderMaxCredits = (count: number, mode: "local" | "creators" | "list" = "local") =>
  Math.ceil(count * LEAD_FINDER.creditsPerLead + LEAD_FINDER.rankingCredits + (mode === "list" ? 0 : LEAD_FINDER.searchCredits));
/** What a typical search costs: delivered leads, a little for ranking, and about 4 credits when the web is searched. */
export const leadFinderTypicalCredits = (count: number, mode: "local" | "creators" | "list" = "local") =>
  Math.ceil(count * LEAD_FINDER.creditsPerLead + 0.5 + (mode === "creators" ? 3.5 : 0));
export const AUDIENCES = { any: "Any size", micro: "1K–100K followers", large: "100K+ followers" } as const;

export const PLATFORMS = ["Instagram", "TikTok", "YouTube"] as const;
export const LeadFindRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("local"),
    niche: z.string().trim().min(3).max(80),
    place: z.string().trim().min(2).max(120),
    offer: z.string().trim().max(600).default(""),
    count: z.union([z.literal(10), z.literal(25), z.literal(40)]).default(25),
  }).strict(),
  z.object({
    mode: z.literal("creators"),
    niche: z.string().trim().min(3).max(80),
    platform: z.enum(PLATFORMS).default("Instagram"),
    place: z.string().trim().max(120).default(""),
    audience: z.enum(["any", "micro", "large"]).default("any"),
    offer: z.string().trim().max(600).default(""),
    count: z.union([z.literal(10), z.literal(25)]).default(10),
  }).strict(),
  z.object({
    mode: z.literal("list"),
    items: z.array(z.string().trim().min(2).max(300)).min(1).max(LEAD_FINDER.maxListItems),
    offer: z.string().trim().max(600).default(""),
    count: z.union([z.literal(10), z.literal(25), z.literal(40)]).default(40),
  }).strict(),
]);
export type LeadFindRequest = z.infer<typeof LeadFindRequestSchema>;

export type FoundLead = {
  id: string;
  name: string;
  category: string;
  /** Public pages: the business website and/or a social profile. */
  website: string;
  profileUrl: string;
  email: string;
  /** Where the email was published: the map listing, the business's own site, or the creator's profile bio. */
  emailSource: "" | "listing" | "website" | "profile";
  phone: string;
  address: string;
  platform: string;
  handle: string | null;
  followers: string | null;
  bio: string;
  summary: string;
  source: "OpenStreetMap" | "Web search" | "Your list";
  /** Read successfully (unreadable leads are kept only when they have other contact routes). */
  verified: boolean;
  note: string;
  score: number;
  ai: { fit: number; niche: string; audience: string; why: string; angle: string; confidence: "high" | "medium" | "low" } | null;
};

export type LeadFindEvent =
  | { type: "status"; message: string }
  | { type: "progress"; stage: "search" | "read" | "rank"; done: number; total: number }
  | { type: "results"; leads: FoundLead[]; skipped: number; duplicates: number; attribution: string; place: string; category: string }
  | { type: "done"; charged: number; delivered: number }
  | { type: "error"; code: string; message: string; retryable?: boolean };

/** Score without AI: how reachable and how established the lead looks (0–100). */
export function reachScore(lead: Pick<FoundLead, "website" | "email" | "phone" | "profileUrl" | "followers" | "verified">) {
  let score = 20;
  if (lead.email) score += 30;
  if (lead.website) score += 15;
  if (lead.verified) score += 10;
  if (lead.profileUrl) score += 8;
  if (lead.phone) score += 5;
  const followers = Number(String(lead.followers ?? "").replace(/,/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6"));
  if (Number.isFinite(followers) && followers > 0) score += Math.min(12, Math.round(Math.log10(followers) * 2.5));
  return Math.max(0, Math.min(100, score));
}

/** "@name", "instagram.com/name", "name.com" or a full link → a public URL (or "" when it isn't one). */
export function listItemUrl(raw: string) {
  const value = raw.trim();
  if (/^@[\w.]{2,30}$/.test(value)) return `https://www.instagram.com/${value.slice(1)}/`;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !/\.[a-z]{2,}$/i.test(url.hostname)) return "";
    return url.toString();
  } catch { return ""; }
}

/** A social profile's identity ("instagram.com/name", "tiktok.com/@name", "youtube.com/@name"), or "" for anything else. */
export const handleOf = (raw: string) => {
  const match = /(instagram\.com|tiktok\.com|youtube\.com)\/(@?[\w.-]{2,40})/i.exec(raw);
  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : "";
};
