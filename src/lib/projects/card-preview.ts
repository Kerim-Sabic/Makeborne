import { z } from "zod";
import type { ArtifactContent, StyleProfile } from "../domain";
import { BookSchema, DeckSchema, type Book, type Deck } from "../documents/schema";
import type { OutlineCardSource } from "../documents/render-card";
import { previewBlocks, previewSlides } from "../cloud/preview-content";
import { canonicalSourceJson } from "./canonical-json";
import { SlideDesignSchema } from "../presentations/slide-design";

/**
 * Library card previews (audit M06). A preview belongs to exactly one account,
 * workspace, artifact and saved version: the card asks for the version its
 * label names, and a response is shown only while that same card still names
 * it. Anything else (loading, failure, no saved version, unsupported, too large,
 * revoked access) is the format icon with an honest label, never a blank frame
 * or another project's content. Client-safe; the route adds authorization.
 */

export const CARD_LIMITS = {
  /** Outline blocks and characters a card ever receives. */
  outlineBlocks: 8, blockText: 600,
  /** One slide keeps all its blocks (a saved slide design refers to them by id). */
  slideBlocks: 40,
  /** Rendered card document, including inlined images. */
  cardHtmlBytes: 2_000_000,
  /** Website source a card may compile once to capture its home page. */
  captureSourceBytes: 1_500_000, captureAssets: 24,
  /** Authorized artwork reads per card. */
  images: 3,
} as const;

export type CardFallbackReason = "no-version" | "not-captured" | "too-large" | "unsupported" | "failed" | "unavailable";

const ItemText = z.string().max(CARD_LIMITS.blockText + 1);
const OutlineBlockSchema = z.object({ id: z.string().max(200), type: z.string().max(40), text: ItemText, assetId: z.string().uuid().nullable() }).strict();
const OutlineSchema = z.object({
  kind: z.enum(["website", "book", "presentation"]), title: z.string().max(200),
  palette: z.object({ canvas: z.string().max(40), ink: z.string().max(40), accent: z.string().max(40), heading: z.string().max(120), body: z.string().max(120) }).strict(),
  blocks: z.array(OutlineBlockSchema).max(CARD_LIMITS.outlineBlocks),
  slide: z.object({ title: z.string().max(400), blocks: z.array(OutlineBlockSchema).max(CARD_LIMITS.slideBlocks), design: SlideDesignSchema.optional() }).strict().optional(),
  slideCount: z.number().int().nonnegative().optional(),
}).strict();
const Html = z.string().min(1).max(CARD_LIMITS.cardHtmlBytes);
export const CardPreviewSourceSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("deck"), deck: DeckSchema }).strict(),
  z.object({ format: z.literal("book"), book: BookSchema, chapterCount: z.number().int().nonnegative() }).strict(),
  z.object({ format: z.literal("outline"), outline: OutlineSchema }).strict(),
  /** Script-free HTML from the saved structured design (the editor's own renderer). */
  z.object({ format: z.literal("website-design"), html: Html }).strict(),
  /** Sanitized, script-free capture of the saved website's home page, stored for this exact version. */
  z.object({ format: z.literal("website-snapshot"), html: Html }).strict(),
  z.object({ format: z.literal("unavailable"), reason: z.enum(["no-version", "not-captured", "too-large", "unsupported"]), capture: z.boolean().optional() }).strict(),
]);
export type CardPreviewSource = z.infer<typeof CardPreviewSourceSchema>;
export const CardPreviewSchema = z.object({
  workspaceId: z.string().uuid(), artifactId: z.string().uuid(),
  kind: z.enum(["website", "book", "presentation"]),
  versionNumber: z.number().int().nonnegative(), versionId: z.string().uuid().nullable(),
  /** sha256 of the saved version's canonical content + style. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  source: CardPreviewSourceSchema,
}).strict();
export type CardPreview = z.infer<typeof CardPreviewSchema>;
export const CardPreviewResponseSchema = z.object({ preview: CardPreviewSchema }).strict();

/** What a card asks for: the version its own label names. */
export type CardRequest = { accountId: string; workspaceId: string; artifactId: string; versionNumber: number };
export const cardScopeKey = (accountId: string, workspaceId: string) => `${accountId}\n${workspaceId}`;
export const cardRequestKey = (request: CardRequest) => `${cardScopeKey(request.accountId, request.workspaceId)}\n${request.artifactId}\nv${request.versionNumber}`;
const scopeOf = (key: string) => key.split("\n").slice(0, 2).join("\n");
const artifactOf = (key: string) => key.split("\n")[2];
export const cardPreviewPath = (request: Pick<CardRequest, "workspaceId" | "artifactId" | "versionNumber">, include?: "source") =>
  `/api/cloud/workspaces/${request.workspaceId}/artifacts/${request.artifactId}/card-preview?version=${request.versionNumber}${include ? `&include=${include}` : ""}`;

/** A response is accepted only for the exact card that asked: same workspace,
 * artifact and version number (and a version identity whenever one exists). */
export function acceptCardPreview(request: CardRequest, preview: CardPreview): boolean {
  if (preview.workspaceId !== request.workspaceId || preview.artifactId !== request.artifactId || preview.versionNumber !== request.versionNumber) return false;
  return request.versionNumber === 0 ? preview.versionId === null : preview.versionId !== null && preview.fingerprint !== null;
}

/** Identity of what a frame depicts; the frame remounts whenever it changes. */
export const cardFrameKey = (requestKey: string, preview: Pick<CardPreview, "versionId" | "fingerprint">) => `${requestKey}\n${preview.versionId}\n${preview.fingerprint}`;

export type CardPreviewState =
  | { status: "idle" | "loading"; key: string }
  | { status: "ready"; key: string; frameKey: string; html: string; canvas: "deck" | "book" | "website"; sandbox: "" | "allow-same-origin"; versionNumber: number }
  | { status: "fallback"; key: string; reason: CardFallbackReason; versionNumber: number };

/** A late answer may update only the state of the key it was requested for. */
export function settleCardPreview(current: CardPreviewState, shownKey: string | null, next: CardPreviewState): CardPreviewState {
  return shownKey === next.key && current.key === next.key ? next : current;
}

/** In-memory only, scoped to one account + workspace. Changing scope (account
 * switch, sign-out, workspace switch) drops every entry before anything can be
 * read; entries for projects no longer listed are dropped on each listing. */
export function createCardPreviewCache<Value>(max = 200) {
  let scope: string | null = null;
  const entries = new Map<string, Value>();
  return {
    get scope() { return scope; },
    get size() { return entries.size; },
    setScope(next: string | null) { if (next !== scope) { entries.clear(); scope = next; } },
    clear() { entries.clear(); scope = null; },
    get(key: string) { return scope !== null && scopeOf(key) === scope ? entries.get(key) : undefined; },
    set(key: string, value: Value) {
      if (scope === null || scopeOf(key) !== scope) return false;
      entries.delete(key); entries.set(key, value);
      while (entries.size > max) entries.delete(entries.keys().next().value!);
      return true;
    },
    delete(key: string) { entries.delete(key); },
    /** Keep only entries for artifacts the viewer can currently see listed. */
    retain(artifactIds: ReadonlySet<string>) { for (const key of [...entries.keys()]) if (!artifactIds.has(artifactOf(key))) entries.delete(key); },
  };
}

/** Bounded concurrency. Queued work whose signal aborts never starts. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => { while (active < max && queue.length) queue.shift()!(); };
  return {
    get active() { return active; },
    get queued() { return queue.length; },
    run<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) return abort();
        const start = () => {
          signal.removeEventListener("abort", cancelQueued);
          if (signal.aborted) { abort(); return; }
          active++;
          task(signal).then(resolve, reject).finally(() => { active--; next(); });
        };
        const cancelQueued = () => { const at = queue.indexOf(start); if (at >= 0) { queue.splice(at, 1); abort(); } };
        signal.addEventListener("abort", cancelQueued, { once: true });
        queue.push(start); next();
      });
    },
  };
}

const KIND_PART: Record<CardPreview["kind"], string> = { presentation: "first slide", book: "cover", website: "home page" };
/** Short visible caption (fallbacks only) and the card's spoken description. */
export function cardPreviewText(state: CardPreviewState, kind: CardPreview["kind"], versionNumber: number): { caption: string | null; description: string } {
  const version = `Version ${versionNumber}`;
  if (state.status === "ready") return { caption: null, description: `Preview shows ${`Version ${state.versionNumber}`}, ${kind === "website" ? "top of the home page" : KIND_PART[kind]}.` };
  if (state.status !== "fallback") return { caption: "Loading preview", description: `Preview of ${version} loading.` };
  switch (state.reason) {
    case "no-version": return { caption: "No saved version yet", description: "No preview: nothing has been saved yet." };
    case "not-captured": return { caption: "No preview yet", description: `No preview yet for ${version}. Open the project to see it.` };
    case "too-large": return { caption: "Too large to preview", description: `No preview: ${version} is too large to show on a card.` };
    case "unsupported": return { caption: "No preview available", description: `No preview is available for ${version} of this project.` };
    case "unavailable": return { caption: "Preview unavailable", description: "No preview: this project is unavailable to your account." };
    default: return { caption: "Preview couldn’t load", description: `The preview of ${version} couldn’t load.` };
  }
}

const clip = (text: string) => text.length > CARD_LIMITS.blockText ? `${text.slice(0, CARD_LIMITS.blockText)}…` : text;
const FONT_STACKS: Record<string, string> = { "Source Serif 4": '"Source Serif 4", Georgia, serif', Georgia: "Georgia, serif", Inter: "Inter, Arial, sans-serif", Arial: "Arial, sans-serif" };
type Block = ArtifactContent["sections"][number]["blocks"][number];
const outlineBlock = (block: Pick<Block, "id" | "type" | "text" | "assetId">) => ({ id: block.id, type: block.type, text: clip(block.text), assetId: block.assetId ?? null });

/** Input to the content fingerprint: the saved version's content and style. */
export const cardFingerprintInput = (content: unknown, style: unknown) => canonicalSourceJson({ content, style });

/**
 * The bounded part of one saved version a card needs. Decks are small by
 * schema (≤ 40 slides) and are sent whole so the opening slide is composed in
 * the context of its deck; books lose their chapter text; outlines keep their
 * first few blocks. Website sources are resolved by the route (stored capture).
 */
export function cardPreviewSource(content: ArtifactContent, style: StyleProfile, websiteDesignHtml?: (title: string, website: NonNullable<ArtifactContent["website"]>) => string | null):
  CardPreviewSource | { format: "website-source" } {
  if (content.document?.kind === "deck") return { format: "deck", deck: content.document as Deck };
  if (content.document?.kind === "book") return { format: "book", book: { ...(content.document as Book), chapters: [] }, chapterCount: content.document.chapters.length };
  if (content.websiteSource) return { format: "website-source" };
  if (content.kind === "website" && content.website) {
    const html = websiteDesignHtml?.(content.title, content.website) ?? null;
    if (!html) return { format: "unavailable", reason: "unsupported" };
    return new TextEncoder().encode(html).length > CARD_LIMITS.cardHtmlBytes ? { format: "unavailable", reason: "too-large" } : { format: "website-design", html };
  }
  const palette = {
    canvas: style.colors.canvas ?? "#F8F7F4", ink: style.colors.ink ?? "#16181D", accent: style.colors.accent ?? "#7862A7",
    heading: FONT_STACKS[style.typography.headingFont] ?? "Georgia, serif", body: FONT_STACKS[style.typography.bodyFont] ?? "Arial, sans-serif",
  };
  const outline: OutlineCardSource = { kind: content.kind, title: content.title, palette, blocks: previewBlocks(content).slice(0, CARD_LIMITS.outlineBlocks).map(outlineBlock) };
  if (content.kind === "presentation") {
    const slides = previewSlides(content), first = slides[0];
    if (first) outline.slide = { title: clip(first.title), blocks: first.blocks.slice(0, CARD_LIMITS.slideBlocks).map(outlineBlock), ...(first.design ? { design: first.design } : {}) };
    outline.slideCount = slides.length;
  }
  return { format: "outline", outline };
}

/** Whether a stored capture may be created from this website source (bounded compile + artwork reads). */
export function websiteCaptureFits(source: NonNullable<ArtifactContent["websiteSource"]>) {
  const bytes = source.files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0);
  return bytes <= CARD_LIMITS.captureSourceBytes && source.assets.length <= CARD_LIMITS.captureAssets;
}
