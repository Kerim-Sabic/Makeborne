import "server-only";
import { getCloudStatus } from "@/lib/cloud/config";
import { billingConfig } from "@/lib/billing/config";
import { PLANNED_ROUTES } from "@/lib/routing/registry";
import { capabilitySnapshot } from "./snapshot";

/** No network calls or secret values are included in the returned snapshot.
 * The caller must derive administrator status from the verified server grant.
 */
export function getCapabilities({ administrator = false, hostname }: { administrator?: boolean; hostname?: string } = {}) {
  const billing = billingConfig();
  return capabilitySnapshot({
    environment: process.env.NODE_ENV,
    hostname,
    administrator,
    cloud: getCloudStatus(),
    pilotProviderConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    hostingCredentialConfigured: Boolean(process.env.SUPABASE_SECRET_KEY?.startsWith("sb_secret_")),
    billingConfigured: billing.configured,
    billingEnabledByConfiguration: billing.enabled,
    routing: {
      configured: PLANNED_ROUTES.filter(route => route.status !== "unconfigured").length,
      total: PLANNED_ROUTES.length,
    },
  });
}
