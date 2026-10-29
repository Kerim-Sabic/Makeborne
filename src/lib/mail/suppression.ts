import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDomain, normalizeDomain, normalizeEmail, suppressionFor, type Suppression } from "../crm-research/match";

/** Exact, workspace-scoped lookup; no truncated directory scan or dependence on a UI flag. */
export async function contactBlocked(db: SupabaseClient, workspaceId: string, target: { email: string; website?: string | null }) {
  const email = normalizeEmail(target.email);
  if (!email) throw new Error("A valid recipient email is required.");
  const keys = new Set([email]);
  for (const host of [emailDomain(email), normalizeDomain(target.website)]) {
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i++) keys.add(labels.slice(i).join("."));
  }
  const { data, error } = await db.from("crm_suppressions").select("kind,value").eq("workspace_id", workspaceId).in("value", [...keys]);
  if (error) throw new Error("Could not check the do-not-contact list. Nothing was sent.");
  return !!suppressionFor((data ?? []) as Suppression[], target);
}
