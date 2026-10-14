import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/supabase/config";
import { ArtifactContentSchema } from "@/lib/domain";
import { renderHostedSnapshot } from "@/lib/hosting/snapshot";
import { websiteDocument } from "@/lib/generation/website-document";
import { RequestError } from "@/lib/server/http";
import { validReviewToken } from "./contracts";

/** 256-bit token for the URL; only its SHA-256 reaches the database. */
export function newReviewToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: `\\x${createHash("sha256").update(token, "utf8").digest("hex")}` };
}

export function reviewUrl(request: Request, token: string) {
  return `${new URL(request.url).origin}/review/${token}`;
}

export function requireReviewToken(value: string) {
  if (!validReviewToken(value)) throw new RequestError("NOT_FOUND", "This review link is not available.", 404);
  return value;
}

/** Anonymous database client: no cookies, so a signed-in visitor gains nothing. */
export function anonymousReviewDatabase() {
  const { url, key } = requireSupabaseConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function reviewDatabaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "P0002") throw new RequestError("REVIEW_UNAVAILABLE", "This review link has expired or was turned off. Ask for a new link.", 404);
  if (error.code === "PT409") throw new RequestError("REVIEW_STALE", "This review changed since you opened it. Copy your comment, refresh the page and review the updated version before sending.", 409);
  if (error.code === "MB429") throw new RequestError("TOO_MANY", error.message || "Too many requests. Please wait a few minutes.", 429);
  if (error.code === "22023") throw new RequestError("INVALID", error.message || "Check the details and try again.", 400);
  throw new RequestError("REVIEW_FAILED", "We couldn’t save that. Please try again.", 503);
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; form-action 'none'; base-uri 'none'">`;

/** Script-free review copy of a website version, using the publishing renderers.
 * Returns null when the version is an outline that renders from content. */
export function reviewWebsiteHtml(contentInput: unknown, snapshot: string | undefined, origin: string) {
  const content = ArtifactContentSchema.parse(contentInput);
  if (content.kind !== "website") return null;
  if (content.websiteSource) {
    if (!snapshot) throw new RequestError("SNAPSHOT_REQUIRED", "Open the preview so the latest render can be captured, then try again.", 409);
    const html = renderHostedSnapshot(snapshot, content.title, content.title, origin);
    return html.replace("<head>", `<head>${CSP}`);
  }
  if (content.website) return websiteDocument(content.title, content.website, true);
  return null;
}
