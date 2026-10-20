import { z } from "zod";
import { WebsiteProjectSourceSchema } from "@/lib/projects/website-source";
import { CardPreviewResponseSchema, cardPreviewPath, type CardPreview, type CardRequest } from "@/lib/projects/card-preview";
import { CardMetaResponseSchema, cardMetaPath, type CardMetaItem } from "@/lib/projects/library-card-meta";
import { cloudAccountGuard, readCloudImage } from "./cloud-api";

/**
 * Library card preview requests. Every read carries the signed-in account and
 * is re-checked against the account fence when it returns, like the editor's
 * own reads; nothing is written to browser storage. Errors keep the HTTP status
 * so a 403/404 (revoked or deleted) can drop any cached preview.
 */
export class CardPreviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readJson(path: string, request: CardRequest, signal: AbortSignal, init?: RequestInit) {
  const assertAccount = cloudAccountGuard(request.accountId);
  const response = await fetch(path, { ...init, headers: { ...init?.headers, "X-Makeborne-Account": request.accountId }, cache: "no-store", signal });
  const data: unknown = await response.json().catch(() => null);
  assertAccount();
  if (!response.ok) throw new CardPreviewError(response.status, "The preview could not load.");
  return data;
}

export async function readCardPreview(request: CardRequest, signal: AbortSignal): Promise<CardPreview> {
  const parsed = CardPreviewResponseSchema.safeParse(await readJson(cardPreviewPath(request), request, signal));
  if (!parsed.success) throw new CardPreviewError(502, "The preview response could not be verified.");
  return parsed.data.preview;
}

const CaptureSchema = z.object({ capture: z.object({
  workspaceId: z.string().uuid(), artifactId: z.string().uuid(), versionNumber: z.number().int().positive(), versionId: z.string().uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), title: z.string().min(1).max(200), kind: z.literal("website"), source: WebsiteProjectSourceSchema,
}) });
export type CardCaptureInput = z.infer<typeof CaptureSchema>["capture"];

/** The saved website source of exactly this version, for an editor's one-time capture. */
export async function readCardCaptureSource(request: CardRequest, signal: AbortSignal): Promise<CardCaptureInput> {
  const parsed = CaptureSchema.safeParse(await readJson(cardPreviewPath(request, "source"), request, signal));
  if (!parsed.success || parsed.data.capture.versionNumber !== request.versionNumber || parsed.data.capture.artifactId !== request.artifactId || parsed.data.capture.workspaceId !== request.workspaceId)
    throw new CardPreviewError(502, "The saved website could not be verified.");
  return parsed.data.capture;
}

/** Stores the capture; the server sanitizes it and refuses it if a newer version was saved meanwhile. */
export async function saveCardCapture(request: CardRequest, capture: Pick<CardCaptureInput, "versionId" | "fingerprint">, result: { outcome: "ready"; snapshot: string } | { outcome: "too_large" }, signal: AbortSignal): Promise<CardPreview> {
  const parsed = CardPreviewResponseSchema.safeParse(await readJson(cardPreviewPath(request).split("?")[0], request, signal, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: capture.versionId, fingerprint: capture.fingerprint, ...result }),
  }));
  if (!parsed.success) throw new CardPreviewError(502, "The preview response could not be verified.");
  return parsed.data.preview;
}

/** Artwork through the editor's own authorized asset route, as a data: URL for the script-free frame. */
export async function readCardImage(request: CardRequest, assetId: string, signal: AbortSignal): Promise<string> {
  const blob = await readCloudImage(`/api/cloud/workspaces/${request.workspaceId}/artifacts/${request.artifactId}/assets/${assetId}`, request.accountId, signal);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Publication state and client label for the cards shown, through the read-only card-meta route. */
export async function readCardMeta(accountId: string, workspaceId: string, artifactIds: string[], signal?: AbortSignal): Promise<CardMetaItem[]> {
  const assertAccount = cloudAccountGuard(accountId);
  const response = await fetch(cardMetaPath(workspaceId, artifactIds), { headers: { "X-Makeborne-Account": accountId }, cache: "no-store", signal });
  const data: unknown = await response.json().catch(() => null);
  assertAccount();
  if (!response.ok) throw new CardPreviewError(response.status, "Project details could not load.");
  const parsed = CardMetaResponseSchema.safeParse(data);
  const asked = new Set(artifactIds);
  if (!parsed.success || parsed.data.workspaceId !== workspaceId || parsed.data.items.some(item => !asked.has(item.artifactId))) throw new CardPreviewError(502, "Project details could not be verified.");
  return parsed.data.items;
}
