import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import type { AnthropicLike } from "@/lib/ai/anthropic-call";
import { anthropicModelPort } from "@/lib/agency/model-port";
import { AGENCY_SETTINGS } from "@/lib/agency/task";
import type { ModelPort } from "@/lib/agency/loop";
import { imageEditingEnabled } from "@/lib/images/edit/contract";
import { openaiEditClient, openaiUpload, projectEditAssets } from "@/lib/images/edit/server";
import type { ImageEditDeps } from "@/lib/images/edit/run";

/** Off unless MAKEBORNE_IMAGE_EDITING=on on the server; the browser cannot enable it. */
export function requireImageEditing() {
  if (!imageEditingEnabled()) throw new RequestError("IMAGE_EDITING_UNAVAILABLE", "Image editing isn't available yet.", 404);
}

/** The body must name this route's artifact. */
export function sameArtifact(body: unknown, artifactId: string) {
  if (!body || typeof body !== "object" || String((body as { artifactId?: unknown }).artifactId).toLowerCase() !== artifactId.toLowerCase())
    throw new RequestError("EDIT_REQUEST_INVALID", "This edit belongs to another project.");
}

/** The signed-in editor, the artifact's own project, and the edit dependencies bound to them. */
export async function editContext(params: Promise<{ workspaceId: string; artifactId: string }>, write: boolean) {
  requireImageEditing();
  const { workspaceId, artifactId } = await params;
  validId(artifactId);
  const { client, user } = await cloudContext(workspaceId, write);
  const { data: artifact, error } = await client.from("artifacts").select("id,project_id").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  databaseError(error);
  if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  const scope = { workspaceId, projectId: artifact.project_id as string };
  const assets = projectEditAssets(client, scope);
  const setting = AGENCY_SETTINGS.find(item => item.profile === "standard");
  // Provider clients are built lazily: an unqualified setting or an unbounded cell is refused before either exists.
  let port: ModelPort | null = null;
  const model: ModelPort = request => {
    if (!setting) throw new RequestError("AGENCY_SETTINGS_UNQUALIFIED", "Image editing isn't available yet.", 409);
    port ??= anthropicModelPort(new Anthropic({ maxRetries: 0, timeout: 120_000 }) as unknown as AnthropicLike, setting);
    return port(request);
  };
  const deps = (): ImageEditDeps => ({
    assets, model, toUpload: openaiUpload,
    imageClient: { images: { edit: (body, options) => openaiEditClient().images.edit(body, options) } },
    rateMicrousd: Math.round(aiCostUsdPerCredit() * 1_000_000), platformDeadline: Date.now() + 280_000,
  });
  return { client, user, workspaceId, artifactId, scope, assets, deps };
}
