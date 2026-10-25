import "server-only";
import {z} from "zod";
import type {User} from "@supabase/supabase-js";
import {submissionContext} from "../generation/submission-server";
import {requireCreationAccess} from "../billing/access";
import {billingDatabase} from "../billing/database";
import {cloudBody, databaseError, requestKey, validId} from "../cloud/server";
import {RequestError} from "../server/http";
import {HOSTING, validSiteSlug} from "../hosting/config";
import {assertPublicationAddress} from "../hosting/namespace-server";
import {PreparePublicationSchema, PublicationPreparationSchema} from "./publication-contract";

const UNCHANGED = "Your saved work and any website that is already live are unchanged.";
/** Publishing-specific wording for refusals the database authority decides.
 * Everything else keeps the shared cloud mapping. */
export function publicationDatabaseError(error: {code?: string; message?: string} | null, stage: "request" | "read" | "promote") {
  if (!error) return;
  if (error.code === "MB402") throw new RequestError("PUBLISHING_PLAN_REQUIRED", `Publishing needs an active Makeborne plan. ${UNCHANGED}`, 402);
  if (error.code === "42501" && error.message === "Trusted publication workspace not enabled")
    throw new RequestError("PUBLISHING_NOT_ENABLED", `Publishing is not switched on for this workspace yet. ${UNCHANGED}`, 403);
  if (error.code === "MB429") throw stage === "promote"
    ? new RequestError("PUBLISHING_LIMIT", "A fair-use publishing limit was reached (50 new websites a day, or 1,000 live websites in a workspace). Your current live site is unchanged. Try again tomorrow or contact support.", 429)
    : new RequestError("PREPARATION_LIMIT", `You can prepare up to 30 publications an hour. Try again later. ${UNCHANGED}`, 429);
  databaseError(error);
}

function publishingAccessError(error: unknown): never {
  if (error instanceof RequestError && error.code === "MEMBERSHIP_REQUIRED")
    throw new RequestError("PUBLISHING_PLAN_REQUIRED", `Publishing needs an active Makeborne plan. Choose a plan to publish. ${UNCHANGED}`, 402);
  throw error;
}
/** A write needs current plan access; say so in publishing terms. */
async function publicationWriteContext(request: Request) {
  try { return await submissionContext(request, true); } catch (error) { publishingAccessError(error); }
}
/** Same verified plan-access check as creation and checkout, worded for publishing. */
export async function requirePublishingAccess(user: User) {
  try { return await requireCreationAccess(user); } catch (error) { publishingAccessError(error); }
}

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
  const {trusted} = await publicationWriteContext(request);
  if (!trustedPublicationAvailable()) throw new RequestError("PUBLICATION_PREPARATION_UNAVAILABLE", "Verified website publishing is being prepared. Your saved work and existing live site are available.", 503);
  if (!validSiteSlug(body.slug)) throw new RequestError("INVALID_ADDRESS", "Use 3–48 lowercase letters, numbers, and hyphens for the address.");
  assertPublicationAddress(workspaceId, body.slug);
  if (body.interactive && !HOSTING.interactiveAllowed) throw new RequestError("JAVASCRIPT_UNAVAILABLE", "Interactive hosting is not configured for this workspace.", 409);
  const {data, error} = await billingDatabase().rpc("makeborne_request_publication_preparation", {...trusted,
    p_workspace: workspaceId, p_artifact: artifactId, p_version: body.version, p_revision: body.revision,
    p_slug: body.slug, p_interactive: body.interactive, p_request: key}).abortSignal(request.signal);
  publicationDatabaseError(error, "request");
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
  publicationDatabaseError(error, "read");
  return publicPublicationPreparation(data, workspaceId, artifactId);
}

export async function promotePublicationPreparation(request: Request, workspaceId: string, artifactId: string, preparationId: string) {
  validId(workspaceId); validId(artifactId); validId(preparationId);
  const {trusted} = await publicationWriteContext(request), db = billingDatabase();
  const {data: status, error: readError} = await db.rpc("makeborne_publication_preparation_status", {...trusted, p_preparation: preparationId}).abortSignal(request.signal);
  publicationDatabaseError(readError, "read");
  const preparation = publicPublicationPreparation(status, workspaceId, artifactId);
  if (!preparation) throw new RequestError("NOT_FOUND", "This publication preparation is unavailable.", 404);
  assertPublicationAddress(workspaceId, preparation.slug);
  const {data, error} = await db.rpc("makeborne_promote_publication_preparation", {...trusted, p_preparation: preparationId}).abortSignal(request.signal);
  publicationDatabaseError(error, "promote");
  return data;
}
