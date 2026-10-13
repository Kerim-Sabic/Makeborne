import "server-only";
import { parseAccessPlanIds, parsePlanCreditRules } from "./plan-schedule";

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
  const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  // Sandbox creation is deliberately local-only and cannot use the live merchant.
  const sandbox = process.env.WHOP_API_BASE_URL === "https://sandbox-api.whop.com/api/v1";
  const sandboxAllowed = sandbox && process.env.MAKEBORNE_WHOP_SANDBOX === "true"
    && !process.env.VERCEL
    && process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55435"
    && companyId === process.env.WHOP_SANDBOX_COMPANY_ID
    && /^biz_[A-Za-z0-9]+$/.test(companyId ?? "") && companyId !== SUPPORT.companyId;
  // Access is granted only for listed plans that also resolve to a credit rule
  // (catalogue or WHOP_PLAN_CREDIT_MAP). Unknown, malformed or support plans are
  // dropped and reported in planConfigIssues, so they fail closed.
  const credit = parsePlanCreditRules(CREATION_CATALOG, process.env.WHOP_PLAN_CREDIT_MAP ?? "", [SUPPORT.planId]);
  const access = parseAccessPlanIds(process.env.WHOP_ACCESS_PLAN_IDS ?? "", credit.rules, [SUPPORT.planId]);
  const accessPlanIds = access.ids;
  const planConfigIssues = [...credit.issues, ...access.issues];
  const merchantAllowed = sandbox ? sandboxAllowed : companyId === SUPPORT.companyId;
  const configured = Boolean(apiKey && merchantAllowed && webhookSecret?.startsWith("ws_") && secretKey?.startsWith("sb_secret_") && accessPlanIds.length);
  return {
    apiKey, companyId, secretKey, accessPlanIds, planConfigIssues, configured, sandbox,
    enabled: configured && process.env.WHOP_CREATION_ENABLED === "true" && process.env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED === "true",
  };
}
