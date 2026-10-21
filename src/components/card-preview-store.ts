import { CARD_LIMITS, acceptCardPreview, cardFrameKey, cardScopeKey, createCardPreviewCache, createLimiter, type CardPreview, type CardPreviewState, type CardRequest } from "@/lib/projects/card-preview";
import { CARD_CANVAS, bookCardHtml, bookCardImages, deckCardHtml, deckCardImages, outlineCardHtml } from "@/lib/documents/render-card";
import { CardPreviewError, readCardCaptureSource, readCardImage, readCardPreview, saveCardCapture } from "./card-preview-api";

/**
 * One in-memory cache and two queues for every library card. The cache holds
 * rendered previews for a single account + workspace; changing either, signing
 * out, refreshing the list or leaving the library drops it. Nothing is written
 * to localStorage/sessionStorage/IndexedDB, so no preview survives a reload.
 */
const cache = createCardPreviewCache<CardPreviewState>();
/** At most two preview reads (plus their artwork) at once; one website capture at a time. */
const reads = createLimiter(2), captures = createLimiter(1);

export const cachedCardPreview = (key: string) => cache.get(key);
export function setCardPreviewScope(accountId: string | null, workspaceId: string | null) { cache.setScope(accountId && workspaceId ? cardScopeKey(accountId, workspaceId) : null); }
export function clearCardPreviews() { cache.clear(); }
/** Drops previews of projects that are no longer listed (deleted, moved or no longer visible). */
export function retainCardPreviews(artifactIds: Iterable<string>) { cache.retain(new Set(artifactIds)); }
export function rememberCardPreview(state: CardPreviewState) {
  if (state.status === "ready" || (state.status === "fallback" && state.reason !== "failed" && state.reason !== "unavailable")) cache.set(state.key, state);
  else cache.delete(state.key);
}

const bytes = (value: string) => new TextEncoder().encode(value).length;
const statusOf = (error: unknown) => error instanceof CardPreviewError || (typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number") ? (error as { status: number }).status : null;
async function images(request: CardRequest, ids: (string | null | undefined)[], signal: AbortSignal) {
  const map: Record<string, string> = {};
  for (const id of [...new Set(ids.filter((value): value is string => !!value))].slice(0, CARD_LIMITS.images)) {
    // Artwork that can't be read with the editor's authorization is omitted (the renderers draw a placeholder).
    try { map[id] = await readCardImage(request, id, signal); } catch { signal.throwIfAborted(); }
  }
  return map;
}

function ready(key: string, preview: CardPreview, html: string, canvas: keyof typeof CARD_CANVAS, sandbox: "" | "allow-same-origin"): CardPreviewState {
  if (bytes(html) > CARD_LIMITS.cardHtmlBytes) return { status: "fallback", key, reason: "too-large", versionNumber: preview.versionNumber };
  return { status: "ready", key, frameKey: cardFrameKey(key, preview), html, canvas, sandbox, versionNumber: preview.versionNumber };
}

/** Renders one accepted preview. Documents use the editor's same-origin font
 * files (no scripts are allowed either way); website HTML runs fully sandboxed. */
async function render(request: CardRequest, key: string, preview: CardPreview, signal: AbortSignal): Promise<CardPreviewState> {
  const source = preview.source, fallback = (reason: Extract<CardPreviewState, { status: "fallback" }>["reason"]): CardPreviewState => ({ status: "fallback", key, reason, versionNumber: preview.versionNumber });
  switch (source.format) {
    case "deck": {
      const names = deckCardImages(source.deck), byName = Object.fromEntries(source.deck.assets.map(asset => [asset.name, asset.id]));
      const loaded = await images(request, names.map(name => byName[name]), signal);
      return ready(key, preview, deckCardHtml(source.deck, Object.fromEntries(names.map(name => [name, loaded[byName[name]]]))), "deck", "allow-same-origin");
    }
    case "book": {
      const names = bookCardImages(source.book), byName = Object.fromEntries(source.book.assets.map(asset => [asset.name, asset.id]));
      const loaded = await images(request, names.map(name => byName[name]), signal);
      return ready(key, preview, bookCardHtml(source.book, Object.fromEntries(names.map(name => [name, loaded[byName[name]]]))), "book", "allow-same-origin");
    }
    case "outline": {
      const outline = source.outline;
      const wanted = outline.kind === "presentation" ? outline.slide?.blocks.filter(block => block.type === "image").map(block => block.assetId) ?? []
        : outline.kind === "book" ? [outline.blocks[0]?.type === "image" ? outline.blocks[0].assetId : null] : outline.blocks.map(block => block.assetId);
      const loaded = await images(request, wanted, signal);
      return ready(key, preview, outlineCardHtml(outline, loaded), outline.kind === "presentation" ? "deck" : outline.kind === "book" ? "book" : "website", "allow-same-origin");
    }
    case "website-design": case "website-snapshot":
      return ready(key, preview, source.html, "website", "");
    case "unavailable":
      return fallback(source.reason);
  }
}

/** Compiles the saved website once in the existing opaque sandbox and stores the server-sanitized capture. */
async function capture(request: CardRequest, key: string, preview: CardPreview, signal: AbortSignal): Promise<CardPreviewState> {
  const stored = await captures.run(async inner => {
    const input = await readCardCaptureSource(request, inner);
    if (input.versionId !== preview.versionId || input.fingerprint !== preview.fingerprint) throw new CardPreviewError(409, "The saved website changed.");
    const { captureProjectSnapshot } = await import("@/lib/builder/publish-snapshot");
    const snapshot = await captureProjectSnapshot(input.source, { accountId: request.accountId, workspaceId: request.workspaceId, artifactId: request.artifactId });
    inner.throwIfAborted();
    return saveCardCapture(request, input, bytes(snapshot) > 3_900_000 ? { outcome: "too_large" } : { outcome: "ready", snapshot }, inner);
  }, signal);
  if (!acceptCardPreview(request, stored) || stored.versionId !== preview.versionId) return { status: "fallback", key, reason: "failed", versionNumber: request.versionNumber };
  return render(request, key, stored, signal);
}

/** The preview state for one card's exact request; never throws. */
export async function resolveCardPreview(request: CardRequest, key: string, canCapture: boolean, signal: AbortSignal): Promise<CardPreviewState> {
  // Nothing saved yet: the listing already says so; no request is needed.
  if (request.versionNumber === 0) return { status: "fallback", key, reason: "no-version", versionNumber: 0 };
  try {
    const result = await reads.run(async inner => {
      const preview = await readCardPreview(request, inner);
      // A response for another workspace, artifact or version is never shown on this card.
      if (!acceptCardPreview(request, preview)) return { preview: null, state: { status: "fallback", key, reason: "failed", versionNumber: request.versionNumber } as CardPreviewState };
      return { preview, state: await render(request, key, preview, inner) };
    }, signal);
    const source = result.preview?.source;
    if (result.preview && source?.format === "unavailable" && source.reason === "not-captured" && source.capture && canCapture) {
      try { return await capture(request, key, result.preview, signal); }
      catch (error) { signal.throwIfAborted(); return { status: "fallback", key, reason: statusOf(error) === 409 ? "not-captured" : "failed", versionNumber: request.versionNumber }; }
    }
    return result.state;
  } catch (error) {
    signal.throwIfAborted();
    const status = statusOf(error), unavailable = status === 403 || status === 404;
    return { status: "fallback", key, reason: unavailable ? "unavailable" : "failed", versionNumber: request.versionNumber };
  }
}
