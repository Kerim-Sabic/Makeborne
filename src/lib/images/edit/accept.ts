import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RequestError } from "../../server/http";
import { mapArtifact, mapVersion } from "../../cloud/mappers";
import { downloadProjectAsset } from "../../cloud/asset-storage";
import { resolveDocumentSourceAssets, resolveWebsiteSourceAssets } from "../../projects/source-assets";
import { storeResponsiveVariants } from "../../builder/images";
import { AcceptEditSchema, imageEditingEnabled } from "./contract";
import { applyAcceptedEdit, listAssetUses, type WebsiteAsset } from "./references";

/**
 * Accept = one new artifact version, saved with the expected-version check,
 * in which only the chosen uses of the original point at the edited asset.
 * The original asset is never modified or deleted; other uses keep it; earlier
 * versions keep resolving it. Discard needs no server call: nothing was ever
 * applied, and the unreferenced candidate stays as an immutable asset (it is
 * not in any manifest, so the existing asset cleanup policy may remove it).
 */
const stale = () => new RequestError("EDIT_STALE", "The project changed since you compared these images. Reload it and choose again. Nothing was changed.", 409);
const unavailable = () => new RequestError("EDIT_ASSET_UNAVAILABLE", "This edited image isn't available in this project.", 404);

type Scope = { workspaceId: string; actor: string };
export type AcceptDeps = { env?: Record<string, string | undefined>; download?: typeof downloadProjectAsset };

async function artifactAt(client: SupabaseClient, workspaceId: string, artifactId: string) {
  const { data, error } = await client.from("artifacts").select("id,project_id,kind,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The project could not be read. Try again.", 503);
  if (!data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  return data as { id: string; project_id: string; kind: string; current_version: number };
}
async function versionAt(client: SupabaseClient, workspaceId: string, artifactId: string, number: number) {
  const { data, error } = await client.from("artifact_versions").select("*").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", number).maybeSingle();
  if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The project could not be read. Try again.", 503);
  if (!data) throw stale();
  return mapVersion(data);
}

/** The places the customer can switch (for the Accept dialog). */
export async function editableUses(client: SupabaseClient, scope: Scope, artifactId: string, assetId: string) {
  const artifact = await artifactAt(client, scope.workspaceId, artifactId);
  const { data: asset, error } = await client.from("assets").select("id,sha256").eq("workspace_id", scope.workspaceId).eq("project_id", artifact.project_id).eq("id", assetId).maybeSingle();
  if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The image could not be read. Try again.", 503);
  if (!asset) throw new RequestError("EDIT_ASSET_UNAVAILABLE", "This image isn't available in this project.", 404);
  if (artifact.current_version < 1) return { version: 0, asset: { id: asset.id as string, sha256: asset.sha256 as string }, uses: [] };
  const version = await versionAt(client, scope.workspaceId, artifactId, artifact.current_version);
  return { version: artifact.current_version, asset: { id: asset.id as string, sha256: asset.sha256 as string }, uses: listAssetUses(version, assetId) };
}

export async function acceptImageEdit(client: SupabaseClient, scope: Scope, body: unknown, deps: AcceptDeps = {}) {
  if (!imageEditingEnabled(deps.env ?? process.env)) throw new RequestError("IMAGE_EDITING_UNAVAILABLE", "Image editing isn't available yet.", 404);
  const parsed = AcceptEditSchema.safeParse(body);
  if (!parsed.success) throw new RequestError("EDIT_ACCEPT_INVALID", "Choose where to use the edited image.");
  const input = parsed.data;
  if (input.originalAssetId === input.candidateAssetId) throw new RequestError("EDIT_ACCEPT_INVALID", "Choose an edited image.");
  const artifact = await artifactAt(client, scope.workspaceId, input.artifactId);
  // The next version is built from the version the customer compared against. The save's
  // expected-version check decides: a moved project is refused (stale), while a retry of an
  // acceptance that already committed (same acceptKey) replays its saved version.
  if (artifact.current_version < input.expectedVersion) throw stale();
  const current = await versionAt(client, scope.workspaceId, input.artifactId, input.expectedVersion);
  const projectScope = { workspaceId: scope.workspaceId, projectId: artifact.project_id };

  // The candidate must be an edit of exactly this original, in this project.
  const { data: row, error } = await client.from("assets").select("id,project_id,object_path,content_type,sha256,provenance")
    .eq("workspace_id", scope.workspaceId).eq("project_id", artifact.project_id).eq("id", input.candidateAssetId).maybeSingle();
  if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The edited image could not be checked. Try again.", 503);
  const provenance = (row?.provenance ?? {}) as Record<string, unknown>;
  if (!row || !["image_edit", "image_edit_deterministic"].includes(String(provenance.kind)) || String(provenance.of).toLowerCase() !== input.originalAssetId
    || !["image/webp", "image/png"].includes(row.content_type)) throw unavailable();
  if (provenance.reviewRequired === true && !input.reviewed) throw new RequestError("EDIT_REVIEW_REQUIRED", "Check the protected areas (labels, logos, text) in the edited image, then confirm before using it.", 409);
  const download = deps.download ?? downloadProjectAsset;
  const file = await download(client, projectScope, row.object_path, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (file.error || !file.data) throw new RequestError("CLOUD_UNAVAILABLE", "The edited image could not be read. Try again.", 503);
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw unavailable();
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw unavailable();
  const candidate = { id: row.id as string, sha256: row.sha256 as string, bytes: bytes.length, mediaType: row.content_type as "image/webp" | "image/png" };

  // Website uses: the edited original's responsive copies, registered like any project image (deterministic ids, best effort).
  let variants: WebsiteAsset[] = [];
  const websitePath = input.references.find(reference => reference.kind === "website_asset" || reference.kind === "website_occurrence");
  if (websitePath && current.content.websiteSource) {
    const stem = (websitePath as { path: string }).path.replace(/\.[^.]+$/, "");
    const path = `${stem}-edit-${candidate.sha256.slice(0, 8)}.${candidate.mediaType === "image/png" ? "png" : "webp"}`;
    variants = (await storeResponsiveVariants(client, projectScope, { id: candidate.id, path, sha256: candidate.sha256, width: meta.width, height: meta.height, data: bytes })) as WebsiteAsset[];
  }
  const next = applyAcceptedEdit(current, { originalId: input.originalAssetId, candidate, references: input.references, variants });
  // Same verification as every other save: every referenced image re-read and its bytes re-hashed.
  if (next.content.websiteSource) await resolveWebsiteSourceAssets(client, projectScope, next.content.websiteSource);
  if ((next.content.kind === "book" || next.content.kind === "presentation") && next.assetIds.length) await resolveDocumentSourceAssets(client, projectScope, next.content, next.style);
  const { data, error: saveError } = await client.rpc("makeborne_save_artifact_version", {
    p_workspace_id: scope.workspaceId, p_artifact_id: input.artifactId, p_expected_version: input.expectedVersion,
    p_content: next.content, p_style: next.style, p_asset_ids: next.assetIds,
    p_change_summary: `Used an edited image in ${next.switched} place${next.switched === 1 ? "" : "s"}`, p_request_key: input.acceptKey,
  });
  if (saveError) {
    if (saveError.code === "PT409" || saveError.code === "40001") throw stale();
    if (saveError.code === "42501") throw new RequestError("ACCESS_DENIED", "You do not have permission to change this work.", 403);
    throw new RequestError("CLOUD_OUTCOME_UNKNOWN", "Saving could not be confirmed. Retry the same acceptance before doing anything else.", 503);
  }
  if (!data || typeof data !== "object" || !data.artifact || !data.version) throw new RequestError("CLOUD_UNAVAILABLE", "Saving did not return a valid version.", 503);
  return { artifact: mapArtifact(data.artifact), version: mapVersion(data.version), switched: next.switched, replayed: Boolean(data.replayed) };
}
