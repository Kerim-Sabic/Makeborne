/**
 * Done-for-you website service: the single source for the /done-for-you page, its structured data and /llms.txt.
 * Prices must match the outreach claims register (agency-outbound/config/claims.yaml). Change both together.
 */
export const DFY_CONTACT = "admin@makeborne.com";

export type DfyTier = { id: string; name: string; build: number; monthly: number; summary: string; includes: string[] };

export const DFY_TIERS: readonly DfyTier[] = [
  { id: "care", name: "Site Care", build: 0, monthly: 349, summary: "Keep your current site and fix what holds it back.",
    includes: ["Technical SEO and AI-search fixes", "Uptime monitoring", "Monthly measured report", "3-month minimum"] },
  { id: "launch", name: "Launch", build: 3900, monthly: 249, summary: "A new site for a focused business.",
    includes: ["Up to 6 pages", "Hosting and care", "Schema and analytics set up", "Before/after report"] },
  { id: "growth", name: "Growth", build: 7500, monthly: 449, summary: "Room for every service and location you offer.",
    includes: ["Up to 15 pages, incl. service and location pages", "Booking or CRM integration", "Monthly AI-visibility report", "Everything in Launch"] },
  { id: "signature", name: "Signature", build: 14500, monthly: 890, summary: "A custom design system for a flagship brand.",
    includes: ["Custom design system", "Up to 30 pages", "Content migration and photography direction", "Quarterly redesign sprints"] },
];

export const DFY_TERMS = [
  "Build fee can be paid 50% upfront and 50% at launch, or split over 3 months.",
  "Monthly plans are month-to-month after a 6-month minimum.",
  "Prices are in US dollars, before tax.",
] as const;

export const DFY_SUMMARY =
  "Makeborne's team designs, builds, hosts and maintains your website. You review and approve; we do the work, and every site ships with a measured before/after report.";

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
