import "server-only";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { billingDatabase } from "@/lib/billing/database";
import { billingUser } from "@/lib/billing/access";
import { mapVersion } from "@/lib/cloud/mappers";
import { requestAccountMatches } from "@/lib/cloud/request-account";
import { websiteSourceBundle } from "@/lib/generation/website-source-bundle";
import { cloudflareHostnames, customDomainConfig } from "@/lib/hosting/custom-domains";
import { resolveWebsiteSourceAssets } from "@/lib/projects/source-assets";
import { websiteProjectSourceBundle } from "@/lib/projects/source-bundle";
import { RequestError } from "@/lib/server/http";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_DELETION_GRACE_DAYS, DELETION_REAUTH_SECONDS, EXPORT_LINK_SECONDS } from "./contracts";
import { EXPORT_BUCKET, expireAccountExportsWith, rightsLog, rpc, runAccountExportWith, runDueAccountDeletionsWith, type Db } from "./jobs";
import { recentlyAuthenticated } from "./session";

export { rightsLog };

/** Off unless exactly "on". Activation is an owner/Codex decision. */
export const accountExportEnabled = () => process.env.MAKEBORNE_ACCOUNT_EXPORT === "on";
export const accountDeletionEnabled = () => process.env.MAKEBORNE_ACCOUNT_DELETION === "on";
export const accountDeletionGraceDays = () => ACCOUNT_DELETION_GRACE_DAYS;

/** The signed-in, confirmed, non-anonymous account. The optional account header can only narrow it. */
export async function requireRightsUser(): Promise<User> {
  const user = await billingUser();
  if (!user) throw new RequestError("AUTH_REQUIRED", "Sign in to manage your data.", 401);
  if (!requestAccountMatches((await headers()).get("X-Makeborne-Account"), user.id)) throw new RequestError("ACCOUNT_CHANGED", "Your signed-in account changed. Reload Settings before continuing.", 409);
  return user;
}

/** Deletion needs a sign-in within the last ten minutes, read from the verified token. */
export async function requireRecentSignIn(user: User) {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || data?.claims?.sub !== user.id || !recentlyAuthenticated(data.claims, DELETION_REAUTH_SECONDS))
    throw new RequestError("REAUTH_REQUIRED", "For your security, sign in again to confirm it's you, then come back to Settings.", 401);
}

export async function accountRightsStatus(userId: string) {
  return rpc<unknown>(billingDatabase(), "makeborne_account_rights_status", { p_user: userId });
}
export async function requestAccountExport(userId: string, key: string) {
  return rpc<{ status: string; id?: string; nextAt?: string }>(billingDatabase(), "makeborne_account_export_request", { p_user: userId, p_key: key });
}
export async function requestAccountDeletion(userId: string, key: string) {
  return rpc<{ status: string; id?: string; scheduledFor?: string; blockers?: string[] }>(billingDatabase(), "makeborne_account_deletion_request",
    { p_user: userId, p_key: key, p_grace_days: accountDeletionGraceDays() });
}
export async function cancelAccountDeletion(userId: string) {
  return rpc<{ status: string; id?: string }>(billingDatabase(), "makeborne_account_deletion_cancel", { p_user: userId });
}

/** A short-lived link to one prepared part, only for its owner while it is unexpired. */
export async function exportPartUrl(userId: string, requestId: string, part: number) {
  const db = billingDatabase();
  const path = await rpc<string | null>(db, "makeborne_account_export_part", { p_user: userId, p_request: requestId, p_part: part });
  if (!path || !path.startsWith(`${userId}/${requestId}/`)) return null;
  const { data, error } = await db.storage.from(EXPORT_BUCKET).createSignedUrl(path, EXPORT_LINK_SECONDS, { download: `makeborne-data-part-${part}.zip` });
  if (error || !data?.signedUrl) throw new RequestError("EXPORT_LINK_UNAVAILABLE", "The download link couldn't be made. Try again in a minute.", 503);
  return data.signedUrl;
}

/** Source downloads of each owned website's current version (cheap extra; failures are skipped). */
function websiteSources(db: Db) {
  return (userId: string) => async () => {
    const { data: workspaces, error } = await db.from("workspaces").select("id").eq("owner_id", userId);
    if (error) throw Object.assign(new Error("workspaces"), { code: "EXPORT_READ_FAILED" });
    const ids = (workspaces ?? []).map(row => row.id as string);
    if (!ids.length) return [];
    const { data: artifacts } = await db.from("artifacts").select("id,workspace_id,project_id,title,current_version").in("workspace_id", ids).eq("kind", "website").gt("current_version", 0).limit(25);
    const bundles: { name: string; bytes: Uint8Array }[] = [];
    for (const artifact of artifacts ?? []) {
      try {
        const { data: row } = await db.from("artifact_versions").select("*").eq("workspace_id", artifact.workspace_id).eq("artifact_id", artifact.id).eq("version_number", artifact.current_version).maybeSingle();
        if (!row) continue;
        const version = mapVersion(row);
        if (version.content.kind !== "website" || (!version.content.website && !version.content.websiteSource)) continue;
        const bundle = version.content.websiteSource
          ? await websiteProjectSourceBundle(version, await resolveWebsiteSourceAssets(db, { workspaceId: artifact.workspace_id, projectId: artifact.project_id }, version.content.websiteSource))
          : await websiteSourceBundle(version);
        bundles.push({ name: `${String(artifact.title || "website").slice(0, 60)}-v${version.number}-${String(artifact.id).slice(0, 8)}.zip`, bytes: new Uint8Array(bundle.bytes) });
      } catch { /* A site whose source can't be bundled is still exported as saved versions. */ }
    }
    return bundles;
  };
}

export async function runAccountExport(requestId?: string) {
  const db = billingDatabase();
  return runAccountExportWith(db, { requestId, websiteSources: websiteSources(db) });
}

export async function expireAccountExports() {
  return expireAccountExportsWith(billingDatabase());
}

/** Detach one custom hostname at the edge. Without the edge configuration this deployment attached none. */
async function removeDomain(providerId: string) {
  const config = customDomainConfig();
  if (!config) { rightsLog("deletion", { step: "domains", outcome: "skipped", code: "DOMAINS_UNCONFIGURED" }); return; }
  await cloudflareHostnames(config).remove(providerId);
}

export async function runDueAccountDeletions(limit = 3) {
  return runDueAccountDeletionsWith(billingDatabase(), removeDomain, limit);
}

export async function purgeRetainedRecords() {
  return rpc<number>(billingDatabase(), "makeborne_account_retained_purge", { p_now: new Date().toISOString() });
}
