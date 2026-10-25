import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Project artwork bytes for a signed-in member.
 *
 * Browsers cannot read the private project-assets bucket (migration
 * 20261020203000): a readable object row would let any member sign a download
 * URL with a lifetime of their choosing, which the storage API never re-checks,
 * so it would outlive their removal from the workspace. Instead the caller's
 * own RLS-bound client must still see the registered asset for this exact
 * object path at the moment of the read (same authority as the project itself);
 * only then does the server key fetch the object. Nothing here returns a URL.
 */
type Download = { data: Blob | null; error: unknown };
type Scope = { workspaceId: string; projectId?: string };
type Reader = (objectPath: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Download>;

// The registered row (not the path) binds an object to its project; legacy paths only share the workspace prefix.
const unsafePath = (scope: Scope, objectPath: string) => typeof objectPath !== "string" || objectPath.length > 1024
  || !objectPath.startsWith(`${scope.workspaceId}/`)
  || objectPath.split("/").some(part => !part || part === "." || part === "..") || /[\\%?#\u0000-\u001f\u007f]/.test(objectPath);

// Loaded on use: offline harnesses import this module without the server key client.
const serverReader: Reader = async (objectPath, init) => (await import("../billing/database")).billingDatabase().storage.from("project-assets").download(objectPath, {}, init);

export async function downloadProjectAsset(client: SupabaseClient, scope: Scope, objectPath: string,
  init?: { signal?: AbortSignal; cache?: RequestCache }, read: Reader = serverReader): Promise<Download> {
  if (unsafePath(scope, objectPath)) return { data: null, error: new Error("ASSET_PATH_INVALID") };
  let query = client.from("assets").select("id").eq("workspace_id", scope.workspaceId).eq("object_path", objectPath);
  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  const visible = await query.limit(1);
  if (visible.error || !Array.isArray(visible.data) || visible.data.length !== 1) return { data: null, error: visible.error ?? new Error("ASSET_NOT_VISIBLE") };
  try { return await read(objectPath, init); }
  catch (error) { return { data: null, error }; }
}

/** Re-read an object this request just tried to store, before its registration row
 * exists. Only for the editor-authorised upload route, with its server-built path. */
export async function readPendingUpload(scope: Required<Scope>, objectPath: string, read: Reader = serverReader): Promise<Download> {
  if (unsafePath(scope, objectPath) || !objectPath.startsWith(`${scope.workspaceId}/${scope.projectId}/artwork/`)) return { data: null, error: new Error("ASSET_PATH_INVALID") };
  try { return await read(objectPath); }
  catch (error) { return { data: null, error }; }
}

/** Same as readPendingUpload, for an AI source file the editor's browser just stored at the
 * server-built path `<workspace>/<project>/sources/<sha256>.<ext>` (src/lib/ingest/storage.ts). */
export async function readPendingSourceUpload(scope: Required<Scope>, objectPath: string, read: Reader = serverReader, init?: { signal?: AbortSignal }): Promise<Download> {
  if (unsafePath(scope, objectPath) || !/^[a-f0-9]{64}\.(docx|pptx|xlsx|csv|pdf)$/.test(objectPath.slice(`${scope.workspaceId}/${scope.projectId}/sources/`.length))
    || !objectPath.startsWith(`${scope.workspaceId}/${scope.projectId}/sources/`)) return { data: null, error: new Error("ASSET_PATH_INVALID") };
  try { return await read(objectPath, init); }
  catch (error) { return { data: null, error }; }
}
