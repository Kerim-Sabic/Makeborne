import "server-only";
import { RequestError } from "../../server/http";
import { DeterministicEditSchema, EDIT_LIMITS, imageEditingEnabled } from "./contract";
import { deterministicEdit, verifyImageBytes } from "./pixels";
import type { EditAssets } from "./run";

/**
 * Resize, crop, compress and exact compositing: ordinary image processing,
 * no model call, no operation, no credits. The result is a NEW asset (the
 * original is untouched) and is accepted like any edit.
 */
export async function runDeterministicEdit(body: unknown, deps: { assets: EditAssets; env?: Record<string, string | undefined> }) {
  if (!imageEditingEnabled(deps.env ?? process.env)) throw new RequestError("IMAGE_EDITING_UNAVAILABLE", "Image editing isn't available yet.", 404);
  const parsed = DeterministicEditSchema.safeParse(body);
  if (!parsed.success) throw new RequestError("EDIT_REQUEST_INVALID", "This change is incomplete or outside the supported limits.");
  const request = parsed.data;
  const load = async (ref: { id: string; sha256: string }) => {
    const row = await deps.assets.read(ref.id);
    if (!row) throw new RequestError("EDIT_ASSET_UNAVAILABLE", "This image isn't available in this project.", 404);
    if (row.sha256 !== ref.sha256) throw new RequestError("EDIT_INPUT_CHANGED", "This image no longer matches the one you chose. Reload the project and try again.", 409);
    return verifyImageBytes(row.bytes, row.sha256, { bytes: EDIT_LIMITS.sourceBytes });
  };
  const source = await load(request.asset);
  const overlay = request.op.type === "composite" ? await load(request.op.overlay) : undefined;
  const result = await deterministicEdit(source, request.op, overlay);
  const stored = await deps.assets.store(result.bytes, { kind: "image_edit_deterministic", of: request.asset.id, ofSha256: request.asset.sha256, op: request.op,
    ...(overlay && request.op.type === "composite" ? { overlay: request.op.overlay } : {}), reviewRequired: false }, { transparent: false, lossless: result.lossless, ...(result.quality ? { quality: result.quality } : {}) });
  return { state: "candidate" as const, message: "Here is the changed version. Compare it with the original, then accept it or discard it. No credits were used.", charged: 0,
    candidate: { original: { assetId: request.asset.id, sha256: request.asset.sha256 }, candidate: { assetId: stored.id, sha256: stored.sha256, width: stored.width, height: stored.height, mediaType: stored.mediaType, bytes: stored.bytes },
      reviewRequired: false, reviewReasons: [] as string[] } };
}
