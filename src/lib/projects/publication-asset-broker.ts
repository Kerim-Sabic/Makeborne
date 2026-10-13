import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {WebsiteProjectSourceSchema} from "./website-source";
import {assertPublicationAssetOrigin, assertPublicationBrokerSecret, PUBLICATION_ASSET_PATH, PublicationDownloadContextSchema,
  type PublicationDownloadContext, publicationAssetWait, readPublicationAsset, verifyPublicationAssetSignature} from "./publication-download-contract";
import {STAGING_SUPABASE_URL} from "../../../infra/customer-sites/namespace-policy.js";

const RecordSchema = z.object({id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  object_path: z.string().min(1).max(1024), content_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
function locate(value: unknown, context: PublicationDownloadContext, workspaceId: string) {
  const loaded = z.object({id: z.literal(context.preparationId), state: z.literal("running"), versionId: z.string().uuid(),
    scope: z.object({workspaceId: z.literal(workspaceId), projectId: z.string().uuid(), artifactId: z.string().uuid()}),
    content: z.object({websiteSource: WebsiteProjectSourceSchema}), assetRecords: z.array(RecordSchema).max(100),
  }).parse(value);
  const descriptor = loaded.content.websiteSource.assets.find(asset => asset.id === context.assetId);
  const records = loaded.assetRecords.filter(asset => asset.id === context.assetId), record = records[0];
  if (!descriptor || records.length !== 1 || record.workspace_id !== workspaceId || record.project_id !== loaded.scope.projectId
    || record.sha256 !== descriptor.sha256 || record.content_type !== descriptor.mediaType
    || !record.object_path.startsWith(`${workspaceId}/${loaded.scope.projectId}/`)
    || /[\\%?#\u0000-\u001f\u007f]/.test(record.object_path) || record.object_path.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error("PUBLICATION_ASSET_IDENTITY_INVALID");
  return {versionId: loaded.versionId, scope: loaded.scope, record, descriptor};
}

/** Only the application process constructs this closure. New Supabase secret
 * keys go in apikey; they are not JWTs or controller credentials. */
export function publicationStorageReader(secret: string, transport: typeof fetch = fetch) {
  if (!secret.startsWith("sb_secret_")) throw new Error("PUBLICATION_ASSET_CONFIG_INVALID");
  return async (objectPath: string, maximum: number, signal: AbortSignal) => {
    if (/[\\%?#\u0000-\u001f\u007f]/.test(objectPath) || objectPath.split("/").some(part => !part || part === "." || part === ".."))
      throw new Error("PUBLICATION_ASSET_IDENTITY_INVALID");
    const url = `${STAGING_SUPABASE_URL}/storage/v1/object/authenticated/project-assets/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const response = await publicationAssetWait(() => transport(url, {method: "GET", redirect: "error", cache: "no-store", credentials: "omit", signal,
      headers: {apikey: secret, "accept-encoding": "identity"}}), signal, response => {void response.body?.cancel().catch(() => {});});
    if (response.status !== 200 || !response.body || response.headers.has("content-length") && response.headers.get("content-length") !== String(maximum)
      || response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity") {
      void response.body?.cancel().catch(() => {}); throw new Error("PUBLICATION_ASSET_UNAVAILABLE");
    }
    return readPublicationAsset(response.body, maximum, signal);
  };
}

export function publicationAssetBroker(deps: {secret: string; origin: string; workspaceId: string; now?: () => number;
  load(context: PublicationDownloadContext, signal: AbortSignal): PromiseLike<unknown>;
  read(objectPath: string, maximum: number, signal: AbortSignal): Promise<Uint8Array>}) {
  const {secret, origin, workspaceId} = deps;
  assertPublicationBrokerSecret(secret); assertPublicationAssetOrigin(origin);
  return async (request: Request): Promise<Response> => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
    try {
      if (request.url !== origin + PUBLICATION_ASSET_PATH || request.method !== "POST"
        || request.headers.get("content-type") !== "application/json" || request.headers.has("content-encoding") || !request.body)
        throw new Error("PUBLICATION_ASSET_AUTH_INVALID");
      const raw = await readPublicationAsset(request.body, 1024, signal, false);
      const body = new TextDecoder("utf-8", {fatal: true}).decode(raw);
      verifyPublicationAssetSignature(secret, origin, request.headers.get("x-makeborne-asset-time") ?? "",
        request.headers.get("x-makeborne-asset-signature") ?? "", body, deps.now?.() ?? Date.now());
      const context = PublicationDownloadContextSchema.parse(JSON.parse(body));
      const before = locate(await publicationAssetWait(() => deps.load(context, signal), signal), context, workspaceId);
      const bytes = await publicationAssetWait(() => deps.read(before.record.object_path, before.descriptor.bytes, signal), signal);
      if (bytes.length !== before.descriptor.bytes || createHash("sha256").update(bytes).digest("hex") !== before.descriptor.sha256)
        throw new Error("PUBLICATION_ASSET_BYTES_INVALID");
      const after = locate(await publicationAssetWait(() => deps.load(context, signal), signal), context, workspaceId);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("PUBLICATION_ASSET_IDENTITY_CHANGED");
      signal.throwIfAborted();
      // Verify and reauthorize before emitting any bytes. A real response stream
      // avoids Vercel's buffered 4.5 MB limit without reducing the 20 MB asset cap.
      let offset = 0;
      return new Response(new ReadableStream<Uint8Array>({pull(controller) {
        if (request.signal.aborted) {controller.error(new Error("PUBLICATION_ASSET_ABORTED")); return;}
        if (offset === bytes.length) {controller.close(); return;}
        const end = Math.min(offset + 65_536, bytes.length); controller.enqueue(bytes.subarray(offset, end)); offset = end;
      }}), {headers: {"content-type": "application/octet-stream", "cache-control": "private, no-store, no-transform",
        "x-content-type-options": "nosniff", "x-makeborne-asset-bytes": String(bytes.length)}});
    } catch {
      return new Response("Private source unavailable.", {status: 403, headers: {"cache-control": "private, no-store"}});
    }
  };
}
