import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { requireCreationAccess } from "@/lib/billing/access";
import { ArtifactContentSchema } from "@/lib/domain";
import { RequestError } from "@/lib/server/http";
import { renderAssetPreview, MAX_PREVIEW_SOURCE_BYTES } from "@/lib/cloud/image-preview";
import { renderHostedSite } from "@/lib/hosting/render";
import { renderHostedSnapshot } from "@/lib/hosting/snapshot";
import { prepareSiteBundle, serializeSiteFiles, SiteBundleError, type SiteBundle } from "@/lib/hosting/bundle";
import { siteAddress, validSiteSlug, type HostedSite } from "@/lib/hosting/config";
import type { WebsiteProjectSource } from "@/lib/projects/website-source";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
const bundleInput = z.object({ js: z.string().max(1_500_000), css: z.string().max(512_000) }).strict();
const input = z.object({
  live: z.boolean(), slug: z.string().max(48), version: z.number().int().positive(), revision: z.number().int().nonnegative(), acknowledged: z.literal(true),
  snapshot: z.string().max(4_000_000).optional(),
  /** Production build of a React project, compiled in the editor with the preview toolchain. */
  bundle: bundleInput.optional(),
  /** Run the site's JavaScript on its isolated origin (default on). */
  interactive: z.boolean().default(true),
}).strict();
const toggle = z.object({ interactive: z.boolean(), revision: z.number().int().positive() }).strict();
const columns = "slug,live,version_number,revision,updated_at,interactive,entry_script";

type SiteRow = Omit<HostedSite, "scripted" | "interactive"> & { interactive?: boolean; entry_script?: string | null; scripted?: boolean };
const publicSite = (row: SiteRow | null): HostedSite | null => row && ({
  slug: row.slug, live: row.live, version_number: row.version_number, revision: row.revision, updated_at: row.updated_at,
  interactive: row.interactive ?? true, scripted: row.scripted ?? Boolean(row.entry_script),
});
const respond = (row: SiteRow | null) => { const site = publicSite(row); return cloudJson({ site, address: site ? siteAddress(site.slug) : null }); };

/** Project images, re-encoded server-side exactly as the editor preview shows them. */
async function loadProjectImages(client: SupabaseClient, workspaceId: string, projectId: string, source: WebsiteProjectSource) {
  if (source.assets.length > 40) throw new RequestError("SITE_TOO_LARGE", "Published websites support up to 40 images.", 413);
  const images: { path: string; bytes: Uint8Array }[] = [];
  for (const asset of source.assets) {
    const { data: record, error } = await client.from("assets").select("object_path,content_type").eq("workspace_id", workspaceId).eq("project_id", projectId).eq("id", asset.id).maybeSingle();
    databaseError(error);
    if (!record || !["image/png", "image/jpeg", "image/webp"].includes(record.content_type) || !record.object_path.startsWith(`${workspaceId}/`)) throw new RequestError("MISSING_IMAGE", "A website image is missing or unavailable in this project.");
    const { data: file, error: downloadError } = await client.storage.from("project-assets").download(record.object_path);
    if (downloadError || !file || file.size > MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("INVALID_IMAGE", "An image is unavailable or exceeds 8 MB.");
    let bytes: Uint8Array;
    try { bytes = await renderAssetPreview(new Uint8Array(await file.arrayBuffer())); }
    catch { throw new RequestError("INVALID_IMAGE", "A website image could not be prepared for publishing."); }
    images.push({ path: `/${asset.path.replace(/^public\//, "")}`, bytes });
  }
  return images;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId);
    const { data, error } = await client.from("hosted_sites").select(columns).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
    databaseError(error);
    return respond(data as SiteRow | null);
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    // Vercel caps function request bodies at 4.5 MB; images never travel in this body.
    const body = await cloudBody(request, input, 4_400_000);
    const key = requestKey(request);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client, user, workspace } = await cloudContext(workspaceId);
    if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can publish or take a site offline.", 403);
    if (!validSiteSlug(body.slug)) throw new RequestError("INVALID_ADDRESS", "Use 3–48 lowercase letters, numbers, and hyphens for the address.");
    let html = "";
    let bundle: SiteBundle | null = null;
    if (body.live) {
      await requireCreationAccess(user);
      const { data: artifact, error: aError } = await client.from("artifacts").select("project_id,kind,current_version").eq("workspace_id",workspaceId).eq("id",artifactId).maybeSingle();
      databaseError(aError);
      if (!artifact || artifact.kind !== "website") throw new RequestError("NOT_FOUND", "Choose a saved website.", 404);
      if (artifact.current_version !== body.version) throw new RequestError("REVISION_CONFLICT", "The saved website changed. Reload before publishing.",409);
      const { data: version, error: vError } = await client.from("artifact_versions").select("content,style_snapshot").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).eq("version_number",body.version).single();
      databaseError(vError);
      if (!version) throw new RequestError("NOT_FOUND","Save a version before publishing.",404);
      const content = ArtifactContentSchema.parse(version.content);
      if (content.websiteSource) {
        // React projects: a sanitised snapshot rendered in the editor's sandbox is
        // the first paint and no-JS fallback; the production bundle enhances it.
        if (!body.snapshot) throw new RequestError("SNAPSHOT_REQUIRED", "Open the preview and publish again so the latest render can be captured.", 409);
        if (body.interactive && !body.bundle) throw new RequestError("BUNDLE_REQUIRED", "Open the preview and publish again so the interactive version can be built.", 409);
        if (body.bundle) {
          const images = await loadProjectImages(client, workspaceId, artifact.project_id, content.websiteSource);
          try { bundle = prepareSiteBundle({ js: body.bundle.js, css: body.bundle.css, images }); }
          catch (error) { if (error instanceof SiteBundleError) throw new RequestError("SITE_NOT_READY", error.message, 413); throw error; }
        }
        try { html = renderHostedSnapshot(body.snapshot, content.title, content.websiteSource.designDirection?.positioning.slice(0, 160) ?? content.title, siteAddress(body.slug), bundle ? { assetPaths: bundle.assetPaths, stylesheet: bundle.stylesheet } : {}); }
        catch (error) { throw new RequestError("SITE_NOT_READY", error instanceof Error ? error.message : "Review this website before publishing."); }
      } else if (body.bundle) throw new RequestError("SITE_NOT_READY", "Only React projects publish a script bundle.");
      const sourceIds = [...new Set(content.sections.flatMap(section => section.blocks.flatMap(block => block.sourceIds)))];
      if (sourceIds.length) {
        const { data: sources, error: sourceError } = await client.from("sources").select("id,permission,approved").eq("workspace_id", workspaceId).eq("project_id", artifact.project_id).in("id", sourceIds);
        databaseError(sourceError);
        if (!sources || sources.length !== sourceIds.length || sources.some(source => source.permission !== "public" || !source.approved)) throw new RequestError("PRIVATE_SOURCES", "Approve the referenced sources for public use before publishing this website.", 403);
      }
      const images = new Map<string,string>();
      // Generated designs reference only the curated public image policy. Their
      // compatibility outline is not a second source of publication artwork.
      const ids = content.website || content.websiteSource ? [] : [...new Set(content.sections.flatMap(s => s.blocks.flatMap(b => b.assetId ? [b.assetId] : [])))];
      if (ids.length>12) throw new RequestError("SITE_TOO_LARGE","The first hosting release supports up to 12 images per website.",413);
      let total = 0;
      for (const id of ids) {
        const {data: asset,error} = await client.from("assets").select("object_path,content_type").eq("workspace_id",workspaceId).eq("project_id",artifact.project_id).eq("id",id).maybeSingle();
        databaseError(error);
        if (!asset || !["image/png","image/jpeg","image/webp"].includes(asset.content_type) || !asset.object_path.startsWith(`${workspaceId}/`)) throw new RequestError("MISSING_IMAGE","A website image is missing or unavailable in this project.");
        const {data:file,error:downloadError} = await client.storage.from("project-assets").download(asset.object_path);
        if(downloadError || !file || file.size>MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("INVALID_IMAGE","An image is unavailable or exceeds 8 MB.");
        const bytes = await renderAssetPreview(new Uint8Array(await file.arrayBuffer()));
        total += bytes.length;
        if(total>2_500_000) throw new RequestError("SITE_TOO_LARGE","Reduce image sizes before publishing (2.5 MB combined image limit).",413);
        images.set(id,`data:image/webp;base64,${bytes.toString("base64")}`);
      }
      if (!content.websiteSource) try { html=renderHostedSite(content,version.style_snapshot,siteAddress(body.slug),images); }
      catch(error) { throw new RequestError("SITE_NOT_READY",error instanceof Error ? error.message : "Review this website before publishing."); }
      if(Buffer.byteLength(html)>4_000_000) throw new RequestError("SITE_TOO_LARGE","This website exceeds the 4 MB publishing limit.",413);
    }
    const { data, error } = await billingDatabase().rpc("makeborne_save_hosted_site_v2",{
      p_actor:user.id,p_workspace:workspaceId,p_artifact:artifactId,p_version:body.version,p_slug:body.slug,p_html:html,p_live:body.live,p_revision:body.revision,p_request:key,
      p_interactive:body.interactive,p_script:bundle?.script ?? null,p_files:bundle ? serializeSiteFiles(bundle.files) : [],
    });
    if(error?.code === "23505") throw new RequestError("ADDRESS_TAKEN","That address is already reserved. Choose another.",409);
    databaseError(error);
    return respond(data as SiteRow);
  } catch(error) { return cloudError(error); }
}

/** Switch a published site's JavaScript on or off without republishing. */
export async function PATCH(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, toggle, 1_000);
    const key = requestKey(request);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client, user, workspace } = await cloudContext(workspaceId);
    if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can change how this site runs.", 403);
    if (body.interactive) {
      const { data: site, error } = await client.from("hosted_sites").select("entry_script").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
      databaseError(error);
      if (site && !site.entry_script) throw new RequestError("BUNDLE_REQUIRED", "Publish the website again to turn on JavaScript.", 409);
    }
    const { data, error } = await billingDatabase().rpc("makeborne_set_hosted_site_interactive", { p_actor: user.id, p_workspace: workspaceId, p_artifact: artifactId, p_interactive: body.interactive, p_revision: body.revision, p_request: key });
    databaseError(error);
    return respond(data as SiteRow);
  } catch (error) { return cloudError(error); }
}
