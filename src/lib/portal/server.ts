import "server-only";
/**
 * Client portal server helpers. Portal users are never workspace members, so
 * portal routes never use cloudContext or tenant tables: every read and write
 * is a grant-checking RPC called as service_role with the verified actor and
 * session (the generation-submission pattern), and the database re-checks the
 * grant on each call. Agency routes use ./agency.ts.
 */
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { billingDatabase } from "@/lib/billing/database";
import { requestAccountMatches } from "@/lib/cloud/request-account";
import { RequestError, apiError } from "@/lib/server/http";
import { newReviewToken, anonymousReviewDatabase } from "@/lib/client-review/server";
import { validReviewToken } from "@/lib/client-review/contracts";
import { CONTENT_DIR, checkCollection, describeChange, parseManifest } from "./content-model";

export type PortalTrusted = { p_actor: string; p_session: string; p_expires: string };
type AuthClient = Awaited<ReturnType<typeof createClient>>;
type DatabaseError = { code?: string; message?: string } | null;

export const PORTAL_SETUP_MESSAGE = "Client editing is being set up. Please try again later.";
/** Draft bodies: up to 30 files of 200 KB, 600 KB in total, plus JSON overhead. */
export const DRAFT_BODY_LIMIT = 700_000;
/** Invite links stop working after this many days (the database allows at most 14). */
export const INVITE_DAYS = 14;

/** getClaims verifies the JWT whose session and expiry SQL checks again; never decode a cookie as proof. */
export async function trustedSession(client: AuthClient, userId: string): Promise<PortalTrusted> {
  const { data, error } = await client.auth.getClaims();
  const parsed = z.object({ sub: z.literal(userId), session_id: z.string().uuid(), exp: z.number().int().positive(), role: z.literal("authenticated"),
    is_anonymous: z.literal(false) }).passthrough().safeParse(data?.claims);
  if (error || !parsed.success || parsed.data.exp * 1000 <= Date.now()) throw new RequestError("AUTH_REQUIRED", "Sign in again to continue.", 401);
  return { p_actor: userId, p_session: parsed.data.session_id, p_expires: new Date(Math.min(parsed.data.exp * 1000, Date.now() + 60 * 60_000)).toISOString() };
}

/** Service-role client for the portal RPCs only (they verify actor, session and grant). */
export function portalDatabase() {
  try { return billingDatabase(); }
  catch { throw new RequestError("PORTAL_SETUP", PORTAL_SETUP_MESSAGE, 503); }
}

/** The signed-in portal visitor. No workspace lookup, no tenant table, no creation-access check. */
export async function portalContext(request: Request) {
  let client: AuthClient;
  try { client = await createClient(); } catch { throw new RequestError("PORTAL_SETUP", PORTAL_SETUP_MESSAGE, 503); }
  const { data: auth, error } = await client.auth.getUser();
  if (error || !auth.user) throw new RequestError("AUTH_REQUIRED", "Sign in to continue.", 401);
  // This header can only constrain the authenticated identity, never grant access.
  if (!requestAccountMatches(request.headers.get("X-Makeborne-Account"), auth.user.id)) throw new RequestError("ACCOUNT_CHANGED", "Your signed-in account changed. Reload this page before continuing.", 409);
  const trusted = await trustedSession(client, auth.user.id);
  return { user: auth.user, trusted, db: portalDatabase() };
}

export function portalJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, X-Makeborne-Account" } });
}
export function portalFail(error: unknown) {
  const response = apiError(error instanceof RequestError ? error : new RequestError("PORTAL_FAILED", "We couldn’t confirm that. Please try again.", 503));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie, X-Makeborne-Account");
  return response;
}

export function validUuid(value: string, what = "record") {
  if (!z.string().uuid().safeParse(value).success) throw new RequestError("NOT_FOUND", `This ${what} is not available.`, 404);
  return value.toLowerCase();
}
export function portalRequestKey(request: Request) {
  const result = z.string().uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!result.success) throw new RequestError("REQUEST_KEY_REQUIRED", "Provide a stable UUID Idempotency-Key for this change.");
  return result.data;
}

/** The portal tables or functions are not deployed yet (migration pending). */
export const missingPortal = (error: DatabaseError) => !!error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "");
/** Messages raised by the portal functions are written for people; anything else is replaced. */
const plain = (message: string | undefined, fallback: string) => message && /^[\p{L}\p{N} ,.;:'’()*@/-]{1,240}$/u.test(message) ? message : fallback;

export function portalDatabaseError(error: DatabaseError) {
  if (!error) return;
  const code = error.code ?? "";
  if (missingPortal(error)) throw new RequestError("PORTAL_SETUP", PORTAL_SETUP_MESSAGE, 503);
  if (code === "PT409") throw new RequestError("CHANGE_CONFLICT", plain(error.message, "Your agency updated this content since you opened it. Reload to see the latest version, then make your change again."), 409);
  if (code === "MB429") throw new RequestError("TOO_MANY", plain(error.message, "Too many changes in a short time. Please wait a little and try again."), 429);
  if (code === "MB409") throw new RequestError("IDEMPOTENCY_CONFLICT", "This request key was already used for different content. Reload and save again.", 409);
  if (code === "P0002") throw new RequestError("NOT_AVAILABLE", "This site is not available to you. Ask your agency if you think this is a mistake.", 404);
  if (code === "42501") throw new RequestError("AUTH_REQUIRED", "Sign in again to continue.", 401);
  if (code === "PP403") throw new RequestError("WRONG_ACCOUNT", plain(error.message, "This invite is for a different email address."), 403);
  if (code === "PP404") throw new RequestError("INVITE_UNAVAILABLE", plain(error.message, "This invite is no longer available. Ask your agency for a new one."), 404);
  if (code === "PP409") throw new RequestError("INVITE_USED", plain(error.message, "This invite has already been used."), 409);
  if (code === "PP410") throw new RequestError("INVITE_EXPIRED", plain(error.message, "This invite has expired. Ask your agency to send it again."), 410);
  if (code === "PP422") throw new RequestError("NOT_EDITABLE", "That part of the site cannot be edited here.", 403);
  if (["22023", "23514", "22P02"].includes(code)) throw new RequestError("INVALID", plain(error.message, "Some content is not valid. Check it and try again."), 400);
  throw new RequestError("PORTAL_FAILED", "We couldn’t confirm that. Please try again.", 503);
}

// ---------------------------------------------------------------- invites

/** 256-bit token for the URL; only its SHA-256 reaches the database. Never log the token. */
export const newPortalInvite = () => newReviewToken();
export const portalInviteUrl = (request: Request, token: string) => `${new URL(request.url).origin}/portal/join/${token}`;
export function requireInviteToken(value: string) {
  if (!validReviewToken(value)) throw new RequestError("INVITE_UNAVAILABLE", "This invite link is not valid.", 404);
  return value;
}
/** Cookie-less client for the public invite read, so a signed-in visitor gains nothing. */
export const anonymousPortalDatabase = () => anonymousReviewDatabase();

// ---------------------------------------------------------------- content validation

export type SiteContent = { manifest: string | null; collections: { key: string; path: string; text: string }[]; images: string[]; routes: string[] };

/**
 * Validates proposed collection files with content-model against the site's
 * manifest and current images and routes. Returns the normalised text to
 * store (never the raw text) and plain-English change lines. A file whose
 * normalised value equals the current one keeps the current text exactly.
 */
export function validateDraft(site: SiteContent, files: Record<string, string>) {
  const parsed = parseManifest(site.manifest ?? undefined);
  if (!parsed.ok) throw new RequestError("CONTENT_UNAVAILABLE", "This site’s editable content is being updated by your agency. Please try again later.", 409);
  const allowed = new Map(site.collections.map(entry => [entry.path, entry]));
  const context = { assets: new Set(site.images), routes: site.routes };
  const normalised: Record<string, string> = {}, lines: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const current = allowed.get(path);
    const key = path.startsWith(CONTENT_DIR) && path.endsWith(".json") ? path.slice(CONTENT_DIR.length, -".json".length) : "";
    const collection = current && current.key === key && Object.hasOwn(parsed.manifest.collections, key) ? parsed.manifest.collections[key] : null;
    if (!current || !collection) throw new RequestError("NOT_EDITABLE", "That part of the site cannot be edited here.", 403);
    const result = checkCollection(collection, text, context);
    if (!result.ok) throw new RequestError("INVALID_CONTENT", `${collection.label} ${result.message}`, 422);
    const before = checkCollection(collection, current.text, context);
    normalised[path] = before.ok && before.text === result.text ? current.text : result.text;
    const line = describeChange(collection, before.ok ? before.value : null, result.value);
    if (line) lines.push(line);
  }
  return { files: normalised, lines };
}
