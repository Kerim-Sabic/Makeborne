import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { requireCreationAccess } from "@/lib/billing/access";
import { ArtifactContentSchema } from "@/lib/domain";
import { RequestError } from "@/lib/server/http";
import { renderAssetPreview, MAX_PREVIEW_SOURCE_BYTES } from "@/lib/cloud/image-preview";
import { renderHostedSite } from "@/lib/hosting/render";
import { renderHostedSnapshot } from "@/lib/hosting/snapshot";
import { siteAddress, validSiteSlug } from "@/lib/hosting/config";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
const input = z.object({ live: z.boolean(), slug: z.string().max(48), version: z.number().int().positive(), revision: z.number().int().nonnegative(), acknowledged: z.literal(true), snapshot: z.string().max(4_000_000).optional() }).strict();
const columns = "slug,live,version_number,revision,updated_at";

export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId);
    const { data, error } = await client.from("hosted_sites").select(columns).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
    databaseError(error);
    return cloudJson({ site: data });
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, input, 4_200_000);
    const key = requestKey(request);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client, user, workspace } = await cloudContext(workspaceId);
    if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can publish or take a site offline.", 403);
    if (!validSiteSlug(body.slug)) throw new RequestError("INVALID_ADDRESS", "Use 3–48 lowercase letters, numbers, and hyphens for the address.");
    let html = "";
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
        // React projects publish as a static snapshot rendered in the editor's sandbox.
        if (!body.snapshot) throw new RequestError("SNAPSHOT_REQUIRED", "Open the preview and publish again so the latest render can be captured.", 409);
        try { html = renderHostedSnapshot(body.snapshot, content.title, content.websiteSource.designDirection?.positioning.slice(0, 160) ?? content.title, siteAddress(body.slug)); }
        catch (error) { throw new RequestError("SITE_NOT_READY", error instanceof Error ? error.message : "Review this website before publishing."); }
      }
      const sourceIds = [...new Set(content.sections.flatMap(section => section.blocks.flatMap(block => block.sourceIds)))];
      if (sourceIds.length) {
        const { data: sources, error: sourceError } = await client.from("sources").select("id,permission,approved").eq("workspace_id", workspaceId).eq("project_id", artifact.project_id).in("id", sourceIds);
        databaseError(sourceError);
        if (!sources || sources.length !== sourceIds.length || sources.some(source => source.permission !== "public" || !source.approved)) throw new RequestError("PRIVATE_SOURCES", "Approve the referenced sources for public use before publishing this website.", 403);
      }
      const images = new Map<string,string>();
      // Generated designs reference only the curated public image policy. Their
      // compatibility outline is not a second source of publication artwork.
      const ids = content.website ? [] : [...new Set(content.sections.flatMap(s => s.blocks.flatMap(b => b.assetId ? [b.assetId] : [])))];
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
    const { data, error } = await billingDatabase().rpc("makeborne_save_hosted_site",{p_actor:user.id,p_workspace:workspaceId,p_artifact:artifactId,p_version:body.version,p_slug:body.slug,p_html:html,p_live:body.live,p_revision:body.revision,p_request:key});
    if(error?.code === "23505") throw new RequestError("ADDRESS_TAKEN","That address is already reserved. Choose another.",409);
    databaseError(error);
    return cloudJson({site:data});
  } catch(error) { return cloudError(error); }
}
