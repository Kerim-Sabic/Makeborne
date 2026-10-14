import "server-only";
import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {verifyStillRaster} from "../media/verified-raster";
import {z} from "zod";
import {RequestError} from "../server/http";
import {WebsiteProjectSourceSchema, SourceAssetSchema} from "./website-source";
import {ArtifactContentSchema, StyleProfileSchema} from "../domain";

const ScopeSchema = z.object({workspaceId: z.string().uuid(), projectId: z.string().uuid()}).strict();
const unavailable = () => new RequestError("SOURCE_ASSET_UNAVAILABLE", "Project artwork is missing, changed, or unavailable. Reattach it before saving this source.", 409);
const upstream = () => new RequestError("SOURCE_ASSET_UNCONFIRMED", "Project artwork could not be verified. Retry without changing the source.", 503);

/** Call with the request's authenticated, RLS-bound client, never an administrator
 * client. Resolve original bytes, not transformed previews, before persistence or
 * a build. No signed URL or caller-provided storage path is accepted. */
export async function resolveWebsiteSourceAssets(client: SupabaseClient, scopeInput: unknown, input: unknown) {
  const source = WebsiteProjectSourceSchema.parse(input);
  return resolveOriginalAssets(client, scopeInput, source.assets, {individual: 20_000_000, total: 40_000_000});
}

/** Resolve registered originals referenced by a book or deck. Identity comes from
 * scoped database records, never URLs or paths supplied by the model. The same
 * bytes/descriptors can be passed to the existing presentation worker/exporter.
 * The caller must use a current authenticated RLS-bound client. */
export async function resolveDocumentSourceAssets(client: SupabaseClient, scopeInput: unknown, contentInput: unknown, styleInput: unknown) {
  const content = ArtifactContentSchema.parse(contentInput), style = StyleProfileSchema.parse(styleInput);
  if (content.kind !== "book" && content.kind !== "presentation") throw new RequestError("INVALID_DOCUMENT", "Choose a book or presentation.");
  const ids = [...new Set([...style.referenceAssetIds, ...content.sections.flatMap(section => section.blocks.flatMap(block => block.assetId ? [block.assetId] : []))].map(id => id.toLowerCase()))];
  const artwork = await resolveOriginalAssets(client, scopeInput, ids.map(id => ({id})),
    content.kind === "presentation" ? {individual: 3_000_000, total: 12_000_000} : {individual: 8 * 1024 * 1024, total: 40_000_000});
  return {artwork, descriptors: artwork.map(asset => SourceAssetSchema.parse({...asset, bytes: asset.bytes.byteLength}))};
}

type OriginalReference = {id: string; path?: string; sha256?: string; mediaType?: string; bytes?: number};
async function resolveOriginalAssets(client: SupabaseClient, scopeInput: unknown, references: OriginalReference[], limits: {individual: number; total: number}) {
  const scope = ScopeSchema.parse(scopeInput);
  if (references.length > 100) throw unavailable();
  // The caller obtains this client through cloudContext; that shared boundary owns
  // session, role and creation-entitlement checks. Keep RLS on every read here.
  const project = await client.from("projects").select("id").eq("workspace_id", scope.workspaceId).eq("id", scope.projectId).maybeSingle();
  if (project.error) throw upstream();
  if (!project.data || project.data.id !== scope.projectId) throw new RequestError("SOURCE_ACCESS_DENIED", "This source project is unavailable.", 403);
  if (references.length === 0) return [];

  const registered = await client.from("assets").select("id,workspace_id,project_id,object_path,content_type,sha256")
    .eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).in("id", references.map(asset => asset.id));
  if (registered.error) throw upstream();
  if (!registered.data || registered.data.length !== references.length) throw unavailable();
  const rows = new Map(registered.data.map(row => [row.id, row]));
  if (rows.size !== references.length) throw unavailable();
  const resolved: {id: string; path: string; sha256: string; mediaType: string; bytes: Uint8Array}[] = [];
  // Sequential verification bounds decoding/network concurrency. The schema caps
  // aggregate retained bytes. Never substitute a preview: it would change identity.
  let retainedBytes = 0;
  for (const descriptor of references) {
    const row = rows.get(descriptor.id);
    if (!row || row.workspace_id !== scope.workspaceId || row.project_id !== scope.projectId
      || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !["image/png", "image/jpeg", "image/webp"].includes(row.content_type)
      || (descriptor.sha256 !== undefined && row.sha256 !== descriptor.sha256)
      || (descriptor.mediaType !== undefined && row.content_type !== descriptor.mediaType)
      || typeof row.object_path !== "string"
      || !row.object_path.startsWith(`${scope.workspaceId}/${scope.projectId}/`)
      || row.object_path.split("/").some((part: string) => !part || part === "." || part === "..")
      || /[\\%?#\u0000-\u001f\u007f]/.test(row.object_path)) throw unavailable();
    let blob: Blob;
    try {
      const result = await client.storage.from("project-assets").download(row.object_path, {}, {signal: AbortSignal.timeout(15_000), cache: "no-store"});
      if (result.error || !result.data) throw upstream();
      blob = result.data;
    } catch {throw upstream();}
    if (!Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > limits.individual
      || retainedBytes + blob.size > limits.total || (descriptor.bytes !== undefined && blob.size !== descriptor.bytes)) throw unavailable();
    retainedBytes += blob.size;
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.byteLength !== blob.size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw unavailable();
    try {
      await verifyStillRaster(bytes, row.content_type);
    } catch {throw unavailable();}
    const extension = row.content_type === "image/jpeg" ? "jpg" : row.content_type.slice(6);
    resolved.push({id: descriptor.id, path: descriptor.path ?? `public/artwork/${descriptor.id}.${extension}`, sha256: row.sha256, mediaType: row.content_type, bytes});
  }
  return resolved;
}
