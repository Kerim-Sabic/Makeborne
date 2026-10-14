import "server-only";
import {z} from "zod";
import {submissionContext} from "../generation/submission-server";
import {billingDatabase} from "../billing/database";
import {cloudBody, databaseError, requestKey, validId} from "../cloud/server";
import {RequestError} from "../server/http";
import {HOSTING, validSiteSlug} from "../hosting/config";
import {assertPublicationAddress} from "../hosting/namespace-server";
import {PreparePublicationSchema, PublicationPreparationSchema} from "./publication-contract";

export function trustedPublicationAvailable() {
  // Explicit activation only after the restricted worker and storage have been
  // qualified. Request handlers only enqueue; they never execute project code.
  return process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED === "true";
}
const StoredPreparation = z.object({
  id: z.string().uuid(), state: z.string(),
  scope: z.object({workspaceId: z.string().uuid(), projectId: z.string().uuid(), artifactId: z.string().uuid()}),
  versionNumber: z.number().int().positive(), publicationRevision: z.number().int().nonnegative(),
  slug: z.string(), interactive: z.boolean(), expiresAt: z.string(),
  error: z.string().nullable().optional(), output: z.object({html: z.string(), routes:z.array(z.object({path:z.string(),html:z.string()}).passthrough()).max(20)}).passthrough().nullable().optional(),
}).passthrough();

/** The RPC can return private compiler evidence. Select fields explicitly so
 * adding a server field can never accidentally expose it to the browser. */
export function publicPublicationPreparation(value: unknown, workspaceId: string, artifactId: string) {
  if (value === null) return null;
  const parsed = StoredPreparation.safeParse(value);
  if (!parsed.success || parsed.data.scope.workspaceId !== workspaceId || parsed.data.scope.artifactId !== artifactId)
    throw new RequestError("PUBLICATION_UNCONFIRMED", "Publication preparation could not be verified. Refresh its status.", 503);
  const row = parsed.data;
  const state = row.state === "running" ? "building" : row.state === "promoted" ? "published" : row.state;
  const status = PublicationPreparationSchema.safeParse({id: row.id, state, workspaceId, artifactId,
    version: row.versionNumber, publicationRevision: row.publicationRevision, slug: row.slug, interactive: row.interactive,
    expiresAt: row.expiresAt, error: row.error ? "The website could not be prepared. Your live site is unchanged. Prepare it again after reviewing the saved source." : null,
    previewHtml: row.state === "ready" ? row.output?.html ?? null : null,
    previewRoutes: row.state === "ready" ? row.output?.routes.map(route=>({path:route.path,html:route.html})) ?? [] : []});
  if (!status.success || (row.state === "ready" && !status.data.previewHtml))
    throw new RequestError("PUBLICATION_UNCONFIRMED", "The prepared website is incomplete. Refresh its status.", 503);
  return status.data;
}

export async function requestPublicationPreparation(request: Request, workspaceId: string, artifactId: string) {
  validId(workspaceId); validId(artifactId);
  const body = await cloudBody(request, PreparePublicationSchema, 4096), key = requestKey(request);
  const {trusted} = await submissionContext(request, true);
  if (!trustedPublicationAvailable()) throw new RequestError("PUBLICATION_PREPARATION_UNAVAILABLE", "Verified website publishing is being prepared. Your saved work and existing live site are available.", 503);
  if (!validSiteSlug(body.slug)) throw new RequestError("INVALID_ADDRESS", "Use 3–48 lowercase letters, numbers, and hyphens for the address.");
  assertPublicationAddress(workspaceId, body.slug);
  if (body.interactive && !HOSTING.interactiveAllowed) throw new RequestError("JAVASCRIPT_UNAVAILABLE", "Interactive hosting is not configured for this workspace.", 409);
  const {data, error} = await billingDatabase().rpc("makeborne_request_publication_preparation", {...trusted,
    p_workspace: workspaceId, p_artifact: artifactId, p_version: body.version, p_revision: body.revision,
    p_slug: body.slug, p_interactive: body.interactive, p_request: key}).abortSignal(request.signal);
  databaseError(error);
  return publicPublicationPreparation(data, workspaceId, artifactId);
}

export async function readPublicationPreparation(request: Request, workspaceId: string, artifactId: string) {
  validId(workspaceId); validId(artifactId);
  const query = new URL(request.url).searchParams, ids = query.getAll("id");
  if ([...query.keys()].some(key => key !== "id") || ids.length > 1) throw new RequestError("INVALID_ID", "Choose one publication preparation.");
  const {trusted} = await submissionContext(request);
  const rpc = ids.length ? "makeborne_publication_preparation_status" : "makeborne_latest_publication_preparation";
  const args = ids.length ? {...trusted, p_preparation: validId(ids[0])} : {...trusted, p_workspace: workspaceId, p_artifact: artifactId};
  const {data, error} = await billingDatabase().rpc(rpc, args).abortSignal(request.signal);
  databaseError(error);
  return publicPublicationPreparation(data, workspaceId, artifactId);
}

export async function promotePublicationPreparation(request: Request, workspaceId: string, artifactId: string, preparationId: string) {
  validId(workspaceId); validId(artifactId); validId(preparationId);
  const {trusted} = await submissionContext(request, true), db = billingDatabase();
  const {data: status, error: readError} = await db.rpc("makeborne_publication_preparation_status", {...trusted, p_preparation: preparationId}).abortSignal(request.signal);
  databaseError(readError);
  const preparation = publicPublicationPreparation(status, workspaceId, artifactId);
  if (!preparation) throw new RequestError("NOT_FOUND", "This publication preparation is unavailable.", 404);
  assertPublicationAddress(workspaceId, preparation.slug);
  const {data, error} = await db.rpc("makeborne_promote_publication_preparation", {...trusted, p_preparation: preparationId}).abortSignal(request.signal);
  databaseError(error);
  return data;
}
