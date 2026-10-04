import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";

const id = z.string().regex(/^[a-z]+_[A-Za-z0-9]+$/);
export const membershipSchema = z.object({
  id,
  status: z.string(),
  company: z.object({ id }),
  plan: z.object({ id }),
  user: z.object({ id }).nullable(),
  checkout_configuration_id: id.nullable(),
  renewal_period_end: z.string().nullable(),
});
export type WhopMembership = z.infer<typeof membershipSchema>;

export async function whopRequest(path: string, body?: unknown): Promise<unknown> {
  const { apiKey } = billingConfig();
  if (!apiKey) throw new RequestError("BILLING_NOT_CONFIGURED", "Membership verification is not available yet.", 503);
  try {
    const response = await fetch(`https://api.whop.com/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Provider request failed");
    return await response.json();
  } catch {
    throw new RequestError("PAYMENT_PROVIDER_UNAVAILABLE", "We could not verify your membership with Whop. Try again shortly.", 503);
  }
}

export async function retrieveMembership(membershipId: string) {
  if (!/^mem_[A-Za-z0-9]+$/.test(membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "This membership could not be verified.", 403);
  const parsed = membershipSchema.safeParse(await whopRequest(`/memberships/${membershipId}`));
  if (!parsed.success || parsed.data.id !== membershipId) throw new RequestError("MEMBERSHIP_UNVERIFIED", "This membership could not be verified.", 503);
  return parsed.data;
}

export function activeMembership(membership: WhopMembership) {
  const config = billingConfig();
  return membership.company.id === config.companyId && config.accessPlanIds.includes(membership.plan.id)
    && Boolean(membership.user) && ["active", "canceling"].includes(membership.status)
    && membership.renewal_period_end !== null && Date.parse(membership.renewal_period_end) > Date.now();
}

export function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout link could not be verified.", 503);
  const url = new URL(value, "https://whop.com");
  if (url.origin !== "https://whop.com" || url.username || url.password || !url.pathname.startsWith("/checkout/"))
    throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout link could not be verified.", 503);
  return url.href;
}
