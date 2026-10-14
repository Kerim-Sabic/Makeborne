import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { researchLinks } from "./research";

type Results = Awaited<ReturnType<typeof researchLinks>>;

/** Stores the most useful page found (a social profile beats a website) on the client's lead profile. Returns the updated row, or null when nothing was readable. */
export async function saveResearch(client: SupabaseClient, workspaceId: string, clientId: string, results: Results) {
  const pages = results.flatMap(item => item.ok ? [item.facts] : []);
  const best = pages.find(page => page.platform !== "Website") ?? pages[0];
  if (!best) return null;
  const { data: current } = await client.from("clients").select("lead_profile").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
  const research = { url: best.url.slice(0, 500), platform: best.platform.slice(0, 30), handle: best.handle?.slice(0, 60) ?? null, followers: best.followers?.slice(0, 20) ?? null,
    following: best.following?.slice(0, 20) ?? null, posts: best.posts?.slice(0, 20) ?? null, bio: (best.bio || best.description || best.text).slice(0, 600), at: new Date().toISOString() };
  const { data, error } = await client.from("clients").update({ lead_profile: { ...((current?.lead_profile as object) ?? {}), research } }).eq("id", clientId).eq("workspace_id", workspaceId)
    .select("id,tags,deal_value,deal_currency,lead_source,lead_profile,updated_at").maybeSingle();
  if (error) return null;
  return data;
}
