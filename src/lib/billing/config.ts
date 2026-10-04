import "server-only";

// Verified merchant product. Support purchases never grant creation access.
export const SUPPORT = {
  companyId: "biz_CV9cZg1zFX3h7f",
  planId: "plan_B7Dgm9ZqM3V0M",
  url: "https://whop.com/checkout/plan_B7Dgm9ZqM3V0M",
} as const;

// Verified in Whop; hidden and out of stock while generation is unavailable.
// These IDs do not activate selling or grant access by themselves.
export const CREATION_CATALOG = {
  create: "plan_qs8XNbKQsowC6",
  studio: "plan_arwSDewCa8Dvi",
  scale: "plan_Wf2CTdqqUwufk",
} as const;

export function billingConfig() {
  const apiKey = process.env.WHOP_API_KEY;
  const companyId = process.env.WHOP_COMPANY_ID;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const accessPlanIds = (process.env.WHOP_ACCESS_PLAN_IDS ?? "").split(",").map(value => value.trim())
    .filter(value => Object.values(CREATION_CATALOG).includes(value as typeof CREATION_CATALOG[keyof typeof CREATION_CATALOG]) && value !== SUPPORT.planId);
  const configured = Boolean(apiKey && companyId === SUPPORT.companyId && secretKey?.startsWith("sb_secret_") && accessPlanIds.length);
  return {
    apiKey, companyId, secretKey, accessPlanIds,
    enabled: configured && process.env.WHOP_CREATION_ENABLED === "true" && process.env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED === "true",
  };
}
