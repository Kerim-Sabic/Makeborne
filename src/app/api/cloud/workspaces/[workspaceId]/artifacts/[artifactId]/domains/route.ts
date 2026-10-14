import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { checkHostname, CloudflareError, cloudflareHostnames, customDomainConfig, dnsRecords, domainState } from "@/lib/hosting/custom-domains";
import { domainView, type DomainRow } from "@/lib/hosting/custom-domain-view";

type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
/** A pending claim on someone else's account can be taken over after this long. */
const STALE_PENDING_MS = 72 * 3_600_000;
const COLUMNS = "id,hostname,status,ssl_status,error,verification,created_at,last_checked_at";

async function owner(context: Context) {
  const { workspaceId, artifactId } = await context.params;
  validId(artifactId);
  const account = await cloudContext(workspaceId);
  if (account.workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can manage domains.", 403);
  return { ...account, workspaceId, artifactId };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { client, workspaceId, artifactId } = await owner(context);
    const config = customDomainConfig();
    const [site, rows] = await Promise.all([
      client.from("hosted_sites").select("slug,live").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle(),
      client.from("custom_domains").select(COLUMNS).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).order("created_at"),
    ]);
    databaseError(site.error);
    // The table arrives with its migration; until then the panel explains that domains are being set up.
    const missing = rows.error && ["42P01", "PGRST205"].includes(rows.error.code ?? "");
    if (!missing) databaseError(rows.error);
    return cloudJson({ configured: Boolean(config) && !missing, target: config?.target ?? null, published: Boolean(site.data), live: site.data?.live ?? false,
      domains: missing ? [] : ((rows.data ?? []) as DomainRow[]).map(domainView(config?.target ?? "")) });
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, z.object({ hostname: z.string().trim().min(1).max(300) }).strict());
    const { client, user, workspaceId, artifactId } = await owner(context);
    const config = customDomainConfig();
    if (!config) throw new RequestError("DOMAINS_UNAVAILABLE", "Custom domains are being set up. Your site stays available on its Makeborne address.", 503);
    const checked = checkHostname(body.hostname, { allowTest: process.env.NODE_ENV !== "production" && process.env.MAKEBORNE_ALLOW_TEST_DOMAINS === "true" });
    if (!checked.ok) throw new RequestError("INVALID_DOMAIN", checked.message, 400);
    const site = await client.from("hosted_sites").select("artifact_id").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
    databaseError(site.error);
    if (!site.data) throw new RequestError("PUBLISH_FIRST", "Publish this website once before connecting a domain.", 409);

    const db = billingDatabase(), cloudflare = cloudflareHostnames(config);
    const taken = await db.from("custom_domains").select("id,workspace_id,artifact_id,status,cloudflare_id,created_at").eq("hostname", checked.hostname).maybeSingle();
    databaseError(taken.error);
    if (taken.data) {
      if (taken.data.workspace_id === workspaceId && taken.data.artifact_id === artifactId) throw new RequestError("DOMAIN_EXISTS", "This domain is already connected to this website.", 409);
      const stale = taken.data.status !== "active" && Date.now() - Date.parse(taken.data.created_at) > STALE_PENDING_MS;
      if (!stale) throw new RequestError("DOMAIN_IN_USE", "This domain is already connected to another Makeborne website. If it's yours, remove it there first.", 409);
      // An abandoned claim never blocks the real owner.
      if (taken.data.cloudflare_id) await cloudflare.remove(taken.data.cloudflare_id);
      const cleared = await db.from("custom_domains").delete().eq("id", taken.data.id).neq("status", "active");
      databaseError(cleared.error);
    }

    let created;
    try { created = await cloudflare.create(checked.hostname); }
    catch (error) {
      if (error instanceof CloudflareError && /duplicate|already exists/i.test(error.message)) throw new RequestError("DOMAIN_IN_USE", "This domain is already connected to another website on our network.", 409);
      throw new RequestError("DOMAIN_PROVIDER_ERROR", "The domain couldn't be registered right now. Nothing was changed; try again in a minute.", 503);
    }
    const state = domainState(created);
    const inserted = await db.from("custom_domains").insert({
      workspace_id: workspaceId, artifact_id: artifactId, hostname: checked.hostname, status: state.status, cloudflare_id: created.id,
      ssl_status: state.sslStatus, error: state.error, verification: dnsRecords(checked.hostname, checked.apex, config.target, state.extra), created_by: user.id, last_checked_at: new Date().toISOString(),
    }).select(COLUMNS).single();
    if (inserted.error) {
      // Keep Cloudflare and the database in step: undo the registration if the row can't be saved.
      await cloudflare.remove(created.id).catch(() => undefined);
      if (inserted.error.code === "MB429") throw new RequestError("DOMAIN_LIMIT", "A website can have up to 5 domains.", 409);
      if (inserted.error.code === "23505") throw new RequestError("DOMAIN_IN_USE", "This domain was just connected elsewhere.", 409);
      databaseError(inserted.error);
    }
    return cloudJson({ domain: domainView(config.target)(inserted.data as DomainRow) }, 201);
  } catch (error) { return cloudError(error); }
}
