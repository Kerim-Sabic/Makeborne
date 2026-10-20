import { createHash } from "node:crypto";
import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { ArtifactContentSchema, StyleProfileSchema } from "@/lib/domain";
import { websiteDocument } from "@/lib/generation/website-document";
import { renderHostedSnapshot } from "@/lib/hosting/snapshot";
import { withCardCsp } from "@/lib/documents/render-card";
import { CARD_LIMITS, cardFingerprintInput, cardPreviewSource, websiteCaptureFits, type CardPreview, type CardPreviewSource } from "@/lib/projects/card-preview";

export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
type Client = Awaited<ReturnType<typeof cloudContext>>["client"];

/**
 * Library card preview of one saved version (audit M06). Every read is
 * authorized with the caller's own session (workspace membership + RLS), so
 * deleted projects, revoked members and other workspaces get 404. Responses
 * are private, no-store JSON; nothing here is a public or signed URL. The card
 * names the version it shows (`?version=N`) and receives exactly that version
 * with its immutable id and content fingerprint, so it can never depict one
 * version under another version's label.
 */
const fingerprint = (content: unknown, style: unknown) => createHash("sha256").update(cardFingerprintInput(content, style)).digest("hex");
const bytes = (value: string) => Buffer.byteLength(value);

function readQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  const keys = [...query.keys()];
  if (keys.some(key => key !== "version" && key !== "include") || query.getAll("version").length !== 1 || query.getAll("include").length > 1) throw new RequestError("INVALID_PREVIEW", "Choose one saved version.");
  const version = Number(query.get("version"));
  if (!/^\d{1,6}$/.test(query.get("version") ?? "") || !Number.isInteger(version)) throw new RequestError("INVALID_PREVIEW", "Choose one saved version.");
  const include = query.get("include");
  if (include !== null && include !== "source") throw new RequestError("INVALID_PREVIEW", "Choose a supported preview.");
  return { version, include };
}

async function readVersion(client: Client, workspaceId: string, artifactId: string, version: number) {
  const { data: artifact, error } = await client.from("artifacts").select("id,kind,title,current_version").eq("id", artifactId).eq("workspace_id", workspaceId).maybeSingle();
  databaseError(error);
  if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  if (version === 0 || version > artifact.current_version) return { artifact, row: null };
  const { data: row, error: versionError } = await client.from("artifact_versions").select("id,version_number,content,style_snapshot")
    .eq("artifact_id", artifactId).eq("workspace_id", workspaceId).eq("version_number", version).maybeSingle();
  databaseError(versionError);
  if (!row) throw new RequestError("NOT_FOUND", "This saved version is unavailable.", 404);
  return { artifact, row };
}

/** A stored capture for this exact version id and fingerprint, or an existing review copy of the same version. */
async function storedWebsite(workspaceId: string, artifactId: string, versionId: string, versionNumber: number, hash: string): Promise<CardPreviewSource | null> {
  let database: ReturnType<typeof billingDatabase>;
  try { database = billingDatabase(); } catch { return null; }
  const { data: card, error } = await database.from("artifact_card_previews").select("outcome,html,content_hash,version_number")
    .eq("artifact_id", artifactId).eq("version_id", versionId).eq("workspace_id", workspaceId).maybeSingle();
  if (!error && card && card.content_hash === hash && card.version_number === versionNumber) {
    if (card.outcome === "too_large") return { format: "unavailable", reason: "too-large" };
    if (typeof card.html === "string" && bytes(card.html) <= CARD_LIMITS.cardHtmlBytes) return { format: "website-snapshot", html: card.html };
  }
  // A client review copy is the same sanitized, script-free renderer, stored for this version number.
  const { data: review, error: reviewError } = await database.from("client_review_snapshots").select("html")
    .eq("artifact_id", artifactId).eq("version_number", versionNumber).eq("workspace_id", workspaceId).maybeSingle();
  if (!reviewError && typeof review?.html === "string" && bytes(review.html) <= CARD_LIMITS.cardHtmlBytes) return { format: "website-snapshot", html: withCardCsp(review.html) };
  return null;
}

function canStoreCaptures() { try { billingDatabase(); return true; } catch { return false; } }

export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { version, include } = readQuery(request);
    const { client, workspace } = await cloudContext(workspaceId);
    const { artifact, row } = await readVersion(client, workspaceId, artifactId, version);
    const base = { workspaceId, artifactId, kind: artifact.kind as CardPreview["kind"], versionNumber: version };
    if (!row) {
      if (version !== 0) throw new RequestError("NOT_FOUND", "This saved version is unavailable.", 404);
      return cloudJson({ preview: { ...base, versionId: null, fingerprint: null, source: { format: "unavailable", reason: "no-version" } } satisfies CardPreview });
    }
    const content = ArtifactContentSchema.parse(row.content), style = StyleProfileSchema.parse(row.style_snapshot);
    const hash = fingerprint(row.content, row.style_snapshot);
    const identity = { ...base, versionId: row.id as string, fingerprint: hash };
    if (include === "source") {
      // Only an editor compiles a capture, only of the current version, only within bounds.
      if (workspace!.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot create previews.", 403);
      if (!content.websiteSource || version !== artifact.current_version || !websiteCaptureFits(content.websiteSource)) throw new RequestError("NOT_CAPTURABLE", "This version cannot be captured for a card.", 409);
      return cloudJson({ capture: { ...identity, title: content.title, source: content.websiteSource } });
    }
    let source = cardPreviewSource(content, style, (title, website) => { try { return websiteDocument(title, website, true); } catch { return null; } });
    if (source.format === "website-source") {
      source = await storedWebsite(workspaceId, artifactId, row.id, version, hash) ?? {
        format: "unavailable", reason: "not-captured",
        capture: workspace!.role !== "reviewer" && version === artifact.current_version && websiteCaptureFits(content.websiteSource!) && canStoreCaptures(),
      };
    }
    return cloudJson({ preview: { ...identity, source } satisfies CardPreview });
  } catch (error) { return cloudError(error); }
}

const CaptureSchema = z.object({
  versionId: z.string().uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.enum(["ready", "too_large"]), snapshot: z.string().min(100).max(3_900_000).optional(),
}).strict().refine(value => (value.outcome === "ready") === (value.snapshot !== undefined), "A ready capture needs its snapshot.");

/** Stores an editor's capture of the current version's home page, sanitized here (script-free) before storage. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const body = await cloudBody(request, CaptureSchema, 4_200_000);
    const { client, user, workspace } = await cloudContext(workspaceId);
    if (workspace!.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot create previews.", 403);
    const { data: row, error } = await client.from("artifact_versions").select("id,version_number,content,style_snapshot")
      .eq("id", body.versionId).eq("artifact_id", artifactId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!row) throw new RequestError("NOT_FOUND", "This saved version is unavailable.", 404);
    if (fingerprint(row.content, row.style_snapshot) !== body.fingerprint) throw new RequestError("REVISION_CONFLICT", "This capture does not match the saved version.", 409);
    const content = ArtifactContentSchema.parse(row.content);
    if (!content.websiteSource) throw new RequestError("NOT_CAPTURABLE", "This version has no website source.", 409);
    let html: string | null = null, outcome = body.outcome;
    if (outcome === "ready") {
      try { html = withCardCsp(renderHostedSnapshot(body.snapshot!, content.title, content.title, new URL(request.url).origin)); }
      catch { outcome = "too_large"; }
      if (html && bytes(html) > CARD_LIMITS.cardHtmlBytes) { html = null; outcome = "too_large"; }
    }
    const { error: saveError } = await billingDatabase().rpc("makeborne_save_artifact_card_preview", {
      p_actor: user.id, p_workspace: workspaceId, p_artifact: artifactId, p_version: row.id, p_content_hash: body.fingerprint, p_outcome: outcome, p_html: html,
    });
    databaseError(saveError);
    const source: CardPreviewSource = html ? { format: "website-snapshot", html } : { format: "unavailable", reason: "too-large" };
    return cloudJson({ preview: { workspaceId, artifactId, kind: "website", versionNumber: row.version_number, versionId: row.id, fingerprint: body.fingerprint, source } satisfies CardPreview }, 201);
  } catch (error) { return cloudError(error); }
}
