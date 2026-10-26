import type { ImageQuality, ImageSize } from "../ai/prices";
import { imageCallBoundMicrousd, MEASURED_HEADROOM } from "../ai/prices";
import { resolveCell, type ResolvedCell } from "../ai/image-cells";
import { ART_QUALITIES, BOOK_SHAPES, DECK_ASPECTS, type ArtQuality, type BookShape, type DeckAspect } from "./schema";

export { ART_QUALITIES, BOOK_SHAPES, DECK_ASPECTS, type ArtQuality, type BookShape, type DeckAspect };

/**
 * The client's image choices for presentations and books (owner, Kerim, 26 Oct 2026: "for presentations and books u
 * can add quality button and aspect ratio so user can choose"). Plain words for the client; each choice maps to an
 * image quality and to the canvases that can render it: the native size first (2560x1440 for 16:9, as the reference
 * reel used), then a measured canvas cropped to the shape. A choice whose canvases are all unmeasured is not offered
 * (prices.ts refuses it); the model stays automatic and is never named to the client.
 */
export const ART_QUALITY_IMAGE: Readonly<Record<ArtQuality, ImageQuality>> = Object.freeze({ standard: "medium", high: "high", best: "xhigh" });
export const ART_QUALITY_TEXT: Readonly<Record<ArtQuality, { label: string; hint: string }>> = Object.freeze({
  standard: { label: "Standard", hint: "Good for drafts and long decks; fewest credits" },
  high: { label: "High", hint: "Sharper type and finer detail (recommended)" },
  best: { label: "Best", hint: "The finest detail, for covers and important pitches; most credits" },
});

type Canvases = Readonly<Record<ArtQuality, readonly ImageSize[]>>;
/** Slide shapes: the page in px (always 1280 wide, so editable layouts keep their 1280x720 geometry and are centred
 * on taller pages), the PPTX slide in inches (96 px per inch), and the canvases per quality. */
export const DECK_ASPECT_SPECS: Readonly<Record<DeckAspect, { label: string; hint: string; words: string; ratio: number; page: { width: number; height: number }; canvases: Canvases }>> = Object.freeze({
  "16:9": { label: "Widescreen 16:9", hint: "Screens and projectors (default)", words: "16:9 widescreen", ratio: 16 / 9, page: { width: 1280, height: 720 },
    canvases: { standard: ["1536x1024"], high: ["2560x1440", "1536x1024"], best: ["2560x1440"] } },
  "4:3": { label: "Standard 4:3", hint: "Older projectors and print handouts", words: "4:3", ratio: 4 / 3, page: { width: 1280, height: 960 },
    canvases: { standard: ["1536x1024"], high: ["2048x1536", "1536x1024"], best: ["2048x1536"] } },
  "1:1": { label: "Square 1:1", hint: "Social posts and carousels", words: "square 1:1", ratio: 1, page: { width: 1280, height: 1280 },
    canvases: { standard: ["1024x1024"], high: ["1920x1920", "1024x1024"], best: ["1920x1920"] } },
  "9:16": { label: "Vertical 9:16", hint: "Stories, reels and phones", words: "vertical 9:16", ratio: 9 / 16, page: { width: 1280, height: 2276 },
    canvases: { standard: ["1024x1536"], high: ["1440x2560", "1024x1536"], best: ["1440x2560"] } },
});

/** Book page shapes: the trim in inches and the canvases for one page (cover, opener) and for a two-page spread. */
export const BOOK_SHAPE_SPECS: Readonly<Record<BookShape, { label: string; hint: string; words: string; trim: { width: number; height: number }; page: Canvases; spread: Canvases }>> = Object.freeze({
  portrait: { label: "Portrait 6 × 9 in", hint: "Novels, guides and most books (default)", words: "portrait 2:3", trim: { width: 6, height: 9 },
    page: { standard: ["1024x1536"], high: ["1536x2304", "1024x1536"], best: ["1536x2304"] },
    spread: { standard: ["1536x1024"], high: ["2048x1536", "1536x1024"], best: ["2048x1536"] } },
  square: { label: "Square 8.5 × 8.5 in", hint: "Picture books, photo and cookbooks", words: "square", trim: { width: 8.5, height: 8.5 },
    page: { standard: ["1024x1024"], high: ["1920x1920", "1024x1024"], best: ["1920x1920"] },
    spread: { standard: ["1536x1024"], high: ["2560x1280", "1536x1024"], best: ["2560x1280"] } },
  landscape: { label: "Landscape 10 × 8 in", hint: "Picture books and wide illustration", words: "landscape 5:4", trim: { width: 10, height: 8 },
    page: { standard: ["1536x1024"], high: ["1600x1280", "1536x1024"], best: ["1600x1280"] },
    spread: { standard: ["1536x1024"], high: ["2880x1152", "1536x1024"], best: ["2880x1152"] } },
});
export const bookPageRatio = (shape: BookShape) => BOOK_SHAPE_SPECS[shape].trim.width / BOOK_SHAPE_SPECS[shape].trim.height;

export type ArtTarget = { kind: "deck"; aspect: DeckAspect } | { kind: "book"; shape: BookShape; spread?: boolean };
const targetOf = (target: ArtTarget) => target.kind === "deck"
  ? { ratio: DECK_ASPECT_SPECS[target.aspect].ratio, canvases: DECK_ASPECT_SPECS[target.aspect].canvases }
  : { ratio: bookPageRatio(target.shape) * (target.spread ? 2 : 1), canvases: BOOK_SHAPE_SPECS[target.shape][target.spread ? "spread" : "page"] };

/** The canvas for a target at a quality on a model, or why it is refused (no measured canvas). */
export function artCell(model: string, target: ArtTarget, quality: ArtQuality): ResolvedCell {
  const { ratio, canvases } = targetOf(target);
  return resolveCell(model, ART_QUALITY_IMAGE[quality], canvases[quality], ratio);
}
/** The chosen quality if it can render, else the next lower one that can (a stored choice never fails a run);
 * null when nothing can. */
export function artCellOrLower(model: string, target: ArtTarget, quality: ArtQuality): (Extract<ResolvedCell, { ok: true }> & { chosen: ArtQuality; downgraded: boolean }) | null {
  for (const candidate of ART_QUALITIES.slice(0, ART_QUALITIES.indexOf(quality) + 1).reverse()) {
    const cell = artCell(model, target, candidate);
    if (cell.ok) return { ...cell, chosen: candidate, downgraded: candidate !== quality };
  }
  return null;
}
/** The default for new decks and books: High when it can render on this model, else Standard. */
export function defaultArtQuality(model: string | null, target: ArtTarget): ArtQuality {
  return model && artCell(model, target, "high").ok ? "high" : "standard";
}

/** A typical full-image prompt (about 4,500 bytes) for the credit preview; the run bounds every call by its real prompt. */
export const PREVIEW_PROMPT_BYTES = 4500;
/** Expected cost of one finished image: the measured tokens (bound / headroom) plus the prompt, times the share of
 * regenerations and the vision check measured on decks (22 Oct 2026: $0.015 a render, $0.025 with both). */
export const RENDER_OVERHEAD = 5 / 3;
export type ArtOffer = { quality: ArtQuality; available: boolean; size?: ImageSize; native?: boolean; perImage?: { expected: number; max: number } };
/** What each quality costs per image for a target, in credits at `rate` USD per credit, before anything is generated:
 * the most is the reserved bound of one image and its one regeneration; the expected is the measured cost with the
 * usual regenerations. Unavailable qualities carry no price. */
export function artOffers(model: string | null, target: ArtTarget, rate: number): ArtOffer[] {
  return ART_QUALITIES.map(quality => {
    const cell = model ? artCell(model, target, quality) : null;
    if (!model || !cell?.ok) return { quality, available: false };
    const bound = imageCallBoundMicrousd(model, cell.quality, cell.size, "x".repeat(PREVIEW_PROMPT_BYTES)) / 1e6;
    const expected = (bound / MEASURED_HEADROOM) * RENDER_OVERHEAD;
    const credits = (usd: number) => Math.max(1, Math.ceil(usd / rate - 1e-9));
    return { quality, available: true, size: cell.size, native: cell.native, perImage: { expected: credits(expected), max: credits(bound * 2) } };
  });
}
/** Expected USD of one finished render at a cell (planning only; every call still reserves its bound). */
export function expectedRenderUsd(model: string, quality: ImageQuality, size: ImageSize) {
  return imageCallBoundMicrousd(model, quality, size, "x".repeat(PREVIEW_PROMPT_BYTES)) / 1e6 / MEASURED_HEADROOM * RENDER_OVERHEAD;
}

/** The client's choices as written into a brief by the questions before a first build ("- Topic: Label"). */
export const ART_QUALITY_TOPIC = "Image quality";
export const DECK_ASPECT_TOPIC = "Slide shape";
export const BOOK_SHAPE_TOPIC = "Page shape";
function answer(brief: string, topic: string) {
  const line = brief.split(/\r?\n/).reverse().find(row => row.trim().toLowerCase().startsWith(`- ${topic.toLowerCase()}:`));
  return line ? line.trim().slice(topic.length + 3).trim() : null;
}
export function artQualityFromBrief(brief: string): ArtQuality | null {
  const chosen = answer(brief, ART_QUALITY_TOPIC)?.toLowerCase() ?? "";
  return ART_QUALITIES.find(quality => chosen.startsWith(ART_QUALITY_TEXT[quality].label.toLowerCase())) ?? null;
}
export function deckAspectFromBrief(brief: string): DeckAspect | null {
  const chosen = answer(brief, DECK_ASPECT_TOPIC) ?? "";
  const named = DECK_ASPECTS.find(aspect => chosen.includes(aspect) || chosen.toLowerCase().startsWith(DECK_ASPECT_SPECS[aspect].label.toLowerCase()));
  if (named) return named;
  const text = brief.toLowerCase();
  if (/\b(9:16|vertical (slides?|deck|format)|instagram stor(y|ies)|reels?)\b/.test(text)) return "9:16";
  if (/\b(1:1|square (slides?|deck|format|carousel)|carousel)\b/.test(text)) return "1:1";
  if (/\b4:3\b/.test(text)) return "4:3";
  return null;
}
export function bookShapeFromBrief(brief: string): BookShape | null {
  const chosen = answer(brief, BOOK_SHAPE_TOPIC)?.toLowerCase() ?? "";
  const named = BOOK_SHAPES.find(shape => chosen.startsWith(BOOK_SHAPE_SPECS[shape].label.toLowerCase().split(" ")[0]));
  if (named) return named;
  const text = brief.toLowerCase();
  if (/\bsquare (book|format|pages?)\b/.test(text)) return "square";
  if (/\blandscape (book|format|pages?)\b/.test(text)) return "landscape";
  return null;
}

/** The model full-image pages render on: the text-capable 2.5 models in the router's order for exact text (both share
 * one measured price table). Null when neither is enabled. */
export function artTextModel(models: readonly string[]) {
  return ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"].find(model => models.includes(model)) ?? null;
}

/** The client's image options sent with a build (composer controls) or chosen in the questions. */
export type ImageOptions = { quality?: ArtQuality; aspect?: DeckAspect; shape?: BookShape };
/** Why the server refuses these options for this document kind, or null. A quality is refused when no measured canvas
 * can render it in the chosen (or current) shape; the message is for the client and names no provider or model. */
export function imageOptionsIssue(kind: "presentation" | "book", options: ImageOptions, model: string | null, current: { aspect?: DeckAspect; shape?: BookShape } = {}): string | null {
  if (kind === "presentation" && options.shape) return "Page shapes apply to books; presentations choose a slide shape.";
  if (kind === "book" && options.aspect) return "Slide shapes apply to presentations; books choose a page shape.";
  if (!options.quality && !options.aspect && !options.shape) return null;
  if (!model) return "Generated slides and pages are not available right now, so image quality and shape cannot be chosen.";
  const quality = options.quality ?? "standard";
  const target: ArtTarget = kind === "presentation" ? { kind: "deck", aspect: options.aspect ?? current.aspect ?? "16:9" } : { kind: "book", shape: options.shape ?? current.shape ?? "portrait" };
  if (!artCell(model, target, quality).ok) {
    const shape = target.kind === "deck" ? DECK_ASPECT_SPECS[target.aspect].label : BOOK_SHAPE_SPECS[target.shape].label;
    return `${ART_QUALITY_TEXT[quality].label} quality is not available for ${shape} yet. Choose another quality or shape.`;
  }
  return null;
}

export type DocumentImageOffers = {
  presentation: Record<DeckAspect, ArtOffer[]>;
  book: Record<BookShape, { page: ArtOffer[]; spread: ArtOffer[] }>;
};
/** Every quality for every shape, with its credit impact, for the composer and the questions (GET /api/build). */
export function documentImageOffers(model: string | null, rate: number): DocumentImageOffers {
  return {
    presentation: Object.fromEntries(DECK_ASPECTS.map(aspect => [aspect, artOffers(model, { kind: "deck", aspect }, rate)])) as Record<DeckAspect, ArtOffer[]>,
    book: Object.fromEntries(BOOK_SHAPES.map(shape => [shape, { page: artOffers(model, { kind: "book", shape }, rate), spread: artOffers(model, { kind: "book", shape, spread: true }, rate) }])) as Record<BookShape, { page: ArtOffer[]; spread: ArtOffer[] }>,
  };
}
const isOffer = (value: unknown): value is ArtOffer => {
  const offer = value as ArtOffer;
  return Boolean(offer) && (ART_QUALITIES as readonly string[]).includes(offer.quality) && typeof offer.available === "boolean"
    && (!offer.available || (Number.isSafeInteger(offer.perImage?.expected) && Number.isSafeInteger(offer.perImage?.max) && offer.perImage!.expected >= 1 && offer.perImage!.max >= offer.perImage!.expected));
};
/** The client accepts only well-formed offers (anything else: no controls with prices). */
export function parseDocumentImageOffers(value: unknown): DocumentImageOffers | null {
  const offers = value as DocumentImageOffers;
  if (!offers || typeof offers !== "object") return null;
  const list = (items: unknown) => Array.isArray(items) && items.length === ART_QUALITIES.length && items.every(isOffer);
  if (!DECK_ASPECTS.every(aspect => list(offers.presentation?.[aspect]))) return null;
  if (!BOOK_SHAPES.every(shape => list(offers.book?.[shape]?.page) && list(offers.book?.[shape]?.spread))) return null;
  return offers;
}

/** The client's format choices for a new document: the composer's options, else the questions' answers or the brief's
 * words, else the defaults (16:9 or 6 x 9 in; High quality where it can render, else Standard). */
export function newDocumentFormat(kind: "book" | "presentation", text: string, options: ImageOptions = {}, model: string | null) {
  if (kind === "presentation") {
    const aspect = options.aspect ?? deckAspectFromBrief(text) ?? "16:9";
    return { aspect, quality: options.quality ?? artQualityFromBrief(text) ?? defaultArtQuality(model, { kind: "deck", aspect }) };
  }
  const shape = options.shape ?? bookShapeFromBrief(text) ?? "portrait";
  return { shape, quality: options.quality ?? artQualityFromBrief(text) ?? defaultArtQuality(model, { kind: "book", shape }) };
}
