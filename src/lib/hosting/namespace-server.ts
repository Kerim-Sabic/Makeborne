import "server-only";
import {STAGING_SITE_LABELS, STAGING_SUPABASE_URL} from "../../../infra/customer-sites/namespace-policy.js";
import {RequestError} from "../server/http";

export type PublicationAddressPolicy = {
  enabled: boolean;
  allowedSlugs: string[] | null;
  reservedSlugs: string[];
};

/** This is an early application guard, not database authority. Migration 56
 * independently enforces the configured namespace, including older callers.
 * Never derive this mode or its workspace from browser flags or request input. */
export function publicationAddressPolicy(workspaceId: string): PublicationAddressPolicy {
  const mode = process.env.MAKEBORNE_HOSTING_NAMESPACE ?? "production";
  const blocked = {enabled: false, allowedSlugs: [], reservedSlugs: [...STAGING_SITE_LABELS]};
  if (mode === "staging") {
    const workspace = process.env.MAKEBORNE_STAGING_QA_WORKSPACE_ID;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== STAGING_SUPABASE_URL ||
      !workspace || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspace) ||
      workspace !== workspaceId) return blocked;
    return {enabled: true, allowedSlugs: [...STAGING_SITE_LABELS], reservedSlugs: []};
  }
  // Missing staging configuration must not make the staging database a second
  // customer publisher. Local databases can exercise production label policy.
  if (mode !== "production" || process.env.NEXT_PUBLIC_SUPABASE_URL === STAGING_SUPABASE_URL) return blocked;
  return {enabled: true, allowedSlugs: null, reservedSlugs: [...STAGING_SITE_LABELS]};
}

export function assertPublicationAddress(workspaceId: string, slug: string) {
  const policy = publicationAddressPolicy(workspaceId);
  if (!policy.enabled) throw new RequestError("PUBLISHING_NAMESPACE_UNAVAILABLE", "Publishing is not enabled for this workspace. Your saved work and existing website are unchanged.", 503);
  if (policy.reservedSlugs.includes(slug) || policy.allowedSlugs !== null && !policy.allowedSlugs.includes(slug))
    throw new RequestError("ADDRESS_UNAVAILABLE", "This address is not available in this workspace. Choose an allowed website address.", 409);
}
