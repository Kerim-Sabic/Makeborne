import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError, sameOrigin } from "@/lib/server/http";
import { checkHostname, CloudflareError, cloudflareHostnames, customDomainConfig, dnsRecords, domainState } from "@/lib/hosting/custom-domains";
import { domainView, type DomainRow } from "@/lib/hosting/custom-domain-view";

type Context = { params: Promise<{ workspaceId: string; artifactId: string; domainId: string }> };
const COLUMNS = "id,hostname,status,ssl_status,error,verification,created_at,last_checked_at";

async function ownedDomain(context: Context) {
  const { workspaceId, artifactId, domainId } = await context.params;
  validId(artifactId); validId(domainId);
  const { workspace } = await cloudContext(workspaceId);
  if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can manage domains.", 403);
  const config = customDomainConfig();
  if (!config) throw new RequestError("DOMAINS_UNAVAILABLE", "Custom domains are being set up.", 503);
  const row = await billingDatabase().from("custom_domains").select(`${COLUMNS},cloudflare_id`).eq("id", domainId).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
  databaseError(row.error);
  if (!row.data) throw new RequestError("NOT_FOUND", "This domain is no longer connected.", 404);
  return { config, row: row.data as DomainRow & { cloudflare_id: string | null }, workspaceId, artifactId, domainId };
}

/** Check now: refresh the status from Cloudflare. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { config, row } = await ownedDomain(context);
    if (!row.cloudflare_id) throw new RequestError("DOMAIN_BROKEN", "Remove this domain and add it again.", 409);
    let state;
    try { state = domainState(await cloudflareHostnames(config).get(row.cloudflare_id)); }
    catch (error) {
      if (error instanceof CloudflareError && error.status === 404) state = { status: "failed" as const, sslStatus: null, error: "This domain was removed from our network. Remove it and add it again.", extra: [] };
      else throw new RequestError("DOMAIN_PROVIDER_ERROR", "The status couldn't be checked right now. Try again in a minute.", 503);
    }
    const checked = checkHostname(row.hostname, { allowTest: true });
    const verification = dnsRecords(row.hostname, checked.ok && checked.apex, config.target, state.extra);
    const saved = await billingDatabase().from("custom_domains").update({ status: state.status, ssl_status: state.sslStatus, error: state.error, verification, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).select(COLUMNS).single();
    databaseError(saved.error);
    return cloudJson({ domain: domainView(config.target)(saved.data as DomainRow) });
  } catch (error) { return cloudError(error); }
}

/** Disconnect: remove from Cloudflare first, then forget it. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { config, row } = await ownedDomain(context);
    if (row.cloudflare_id) {
      try { await cloudflareHostnames(config).remove(row.cloudflare_id); }
      catch { throw new RequestError("DOMAIN_PROVIDER_ERROR", "The domain couldn't be disconnected right now. Nothing was changed; try again in a minute.", 503); }
    }
    const removed = await billingDatabase().from("custom_domains").delete().eq("id", row.id);
    databaseError(removed.error);
    return cloudJson({ removed: true });
  } catch (error) { return cloudError(error); }
}
