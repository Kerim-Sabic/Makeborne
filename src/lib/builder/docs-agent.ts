import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaImageBlockParam, BetaMessageParam, BetaRawMessageStreamEvent, BetaTextBlockParam, BetaToolResultBlockParam, BetaToolUnion, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { DocToolError, DocToolInputs, DocumentEditor, docToolDefinitions } from "../documents/editor";
import type { DocumentSource, Slide } from "../documents/schema";
import { MIN_STEP_TOKENS, builderModel, isProviderOrSpendError } from "./agent";
import { IMAGE_SIZES, imageConfiguration, openaiImageClient, storeGeneratedImage } from "./images";
import { routeImage } from "./image-router";
import { ART_IMAGE_SHARE, BOOK_IMAGE_CAP, BUILDER_EFFORT, DECK_ART_IMAGE_CAP, DOCUMENT_IMAGE_CAP, aiCostUsdPerCredit, bookImageMax, deckArtImageMax, deckArtSlidesFor, documentImageMax } from "./pricing";
import { ContextMeter, IMAGE_BLOCK_TOKEN_BOUND, budgetedStream, builderModels, type AnthropicLike } from "../ai/anthropic-call";
import { fullImageSlidesEnabled } from "./features";
import { startBudgetedImage, type ImageClientLike } from "../ai/image-call";
import { imageCallBoundMicrousd, maxInputTokenMicrousd, maxOutputTokenMicrousd, type ImageQuality, type ImageSize } from "../ai/prices";
import { SpendError, type RunSpend } from "../ai/run-spend";
import { BOOK_ART_SYSTEM, BOOK_SYSTEM, DECK_ART_SYSTEM, DECK_SYSTEM } from "./docs-prompt";
import { imageLuma, imageShade } from "../documents/image-luma";
import { composeSlide } from "../documents/slide-scene";
import { ART_SAFE_MARGIN_PCT, LEGACY_CANVAS, artAlt, deckAspect, gateText, platePrompt, artPrompt, artTextIssues, artPlaceholders, compareSlideText, describeComparison, slideClaimIssues, slideNumerals, textKey, verifiedArt, type ArtCanvas } from "../documents/slide-art";
import { ART_QUALITY_TEXT, BOOK_SHAPE_SPECS, DECK_ASPECT_SPECS, artCellOrLower, expectedRenderUsd } from "../documents/art-formats";
import { bookImagePlanText, bookPlan, plannedBookImages } from "../documents/book-images";
import { bookArtPrompt, bookShape, pageAlt, pageArtIssues, pageKind, pageText, pageTextKey, verifiedPage } from "../documents/book-art";

/** Events streamed to the chat. Shares the website builder's text/status/
 * usage/done/error shapes, plus live document snapshots. */
export type DocBuilderEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | { type: "progress"; delta: string }
  | { type: "item_start"; key: string; label: string }
  | { type: "item"; key: string; label: string }
  | { type: "document"; document: DocumentSource; focus?: string }
  | { type: "image_start"; name: string; prompt: string }
  | { type: "image"; path: string; url: string; assetId: string }
  | { type: "check"; record: CheckRecord }
  | { type: "tool_error"; tool: string; message: string }
  | { type: "usage"; credits: number }
  | { type: "done"; version: number; summary: string; charged: number }
  | { type: "error"; code: string; message: string; retryable?: boolean };

/** One outcome of the vision check: a full-image slide's text gate or a generated image's artifact check. */
export type CheckRecord = { target: "slide" | "image"; id: string; attempt: number; outcome: "passed" | "retry" | "fallback" | "dropped" | "unchecked"; problems: string[] };

export type DocBuilderRun = {
  client: SupabaseClient;
  scope: { workspaceId: string; projectId: string };
  editor: DocumentEditor;
  effort: EffortLevel;
  /** Provider and customer limits for this run; every call is bounded against it. */
  spend: RunSpend;
  request: string;
  context: string;
  attachments: BetaContentBlockParam[];
  emit: (event: DocBuilderEvent) => void;
  signal: AbortSignal;
  deadline: number;
  /** Injected providers (tests). Production uses the SDKs with retries disabled. */
  anthropic?: AnthropicLike;
  imageClient?: ImageClientLike;
  storeImage?: (request: { name: string; prompt: string; model: string }, bytes: Buffer) => ReturnType<typeof storeGeneratedImage>;
  /** Image models to route among (tests); production reads the allowlist (imageConfiguration). */
  imageModels?: string[];
};
export type DocBuilderResult = { summary: string; credits: number; usd: number; finished: boolean; stopped: string | null; checks: CheckRecord[] };

const LIVE_TOOLS = new Set(["set_theme", "set_deck_details", "set_book_details", "write_slide", "delete_slide", "move_slide", "write_chapter", "edit_chapter", "delete_chapter", "move_chapter"]);
/** Full-image slides of decks saved before the client's quality choice: medium (A/B of 22 Oct 2026: correct spelling of
 * 12-word lines and chart labels at medium, at a quarter of high's price). New decks render at the chosen quality on the
 * best measured canvas for their shape (art-formats.ts); an unmeasured choice falls back to the next lower one. */
export const ART_QUALITY: ImageQuality = "medium";
/** Attempts per slide or image: the first, then one regeneration with a corrected prompt. */
export const CHECK_ATTEMPTS = 2;
/** Longest side of an image sent back to the model for its check. */
const VISION_EDGE = 1280;

/** Human label for an in-flight or finished tool call, shown in the chat. */
export function describeTool(name: string, input: Record<string, unknown> | null, editor: DocumentEditor): string {
  const slide = input?.slide as { id?: string; title?: string; layout?: string } | undefined;
  const chapter = input?.chapter as { id?: string; title?: string } | undefined;
  const id = typeof input?.id === "string" ? input.id : undefined;
  const position = (itemId?: string) => {
    const list = editor.doc.kind === "deck" ? editor.doc.slides : editor.doc.chapters;
    const index = list.findIndex(item => item.id === itemId);
    return index >= 0 ? ` ${index + 1}` : "";
  };
  switch (name) {
    case "set_theme": return "Setting the theme";
    case "set_deck_details": case "set_book_details": return "Updating the title details";
    case "write_slide": return `Slide${position(slide?.id)}${slide?.title ? `: ${slide.title}` : ""}${slide?.layout ? ` (${slide.layout})` : ""}`;
    case "write_chapter": return `Chapter${position(chapter?.id)}${chapter?.title ? `: ${chapter.title}` : ""}`;
    case "edit_chapter": return `Editing chapter${position(id)}`;
    case "delete_slide": case "delete_chapter": return `Removing ${id ?? "an item"}`;
    case "move_slide": case "move_chapter": return `Reordering ${id ?? ""}`.trim();
    default: return name;
  }
}

/** A JPEG for the model to look at (at most 1280 px on the long edge). */
async function visionBlock(bytes: Buffer): Promise<BetaImageBlockParam | BetaTextBlockParam> {
  try {
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: VISION_EDGE, height: VISION_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch {
    return { type: "text", text: "(The image could not be decoded for viewing; treat it as failed.)" };
  }
}
/** The slide cut from its generated canvas (the prompt keeps the cropped margins free of words); the whole canvas when
 * it already has the slide's shape. */
export async function cropSlide(bytes: Buffer, canvas: ArtCanvas = LEGACY_CANVAS) {
  const meta = await sharp(bytes).metadata();
  const [width, height] = canvas.size.split("x").map(Number);
  const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
  const whole = canvas.crop.left === 0 && canvas.crop.top === 0 && canvas.crop.width === width && canvas.crop.height === height;
  const out = meta.width === width && meta.height === height ? (whole ? image : image.extract(canvas.crop)) : image.resize(canvas.crop.width, canvas.crop.height, { fit: "cover" });
  return out.png().toBuffer();
}
const artName = (id: string) => `art-${id}`.slice(0, 49).replace(/-+$/, "");

/** Agentic edit loop for presentations and books. Structural tools are applied
 * the moment their input finishes streaming, so the preview updates slide by
 * slide; images and full-image slides run at the end of the step and come back
 * to the model as images to check; finish validates. */
export async function runDocumentBuilder(run: DocBuilderRun): Promise<DocBuilderResult> {
  const policy = BUILDER_EFFORT[run.effort];
  const model = builderModel();
  const models = builderModels(model);
  const anthropic = run.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 600_000 }) as unknown as AnthropicLike);
  const rate = aiCostUsdPerCredit();
  const spend = run.spend;
  const kind = run.editor.kind;
  // The configured image models, or none when images are off (see imageConfiguration).
  const configured = policy.maxImages > 0 && !run.imageModels ? imageConfiguration() : null;
  const allowed: string[] = policy.maxImages > 0 ? run.imageModels ?? (configured?.models?.length ? [...configured.models] : configured?.model ? [configured.model] : []) : [];
  const imageModelId = allowed[0] ?? null;
  // Full-image slides need a model that renders text exactly where asked (router: sunburst first, then flare).
  const deck = () => run.editor.doc.kind === "deck" ? run.editor.doc : null;
  // Not yet qualified for production: full-image slides also need MAKEBORNE_DECK_FULL_IMAGE=on (lib/builder/features.ts).
  const artEnabled = fullImageSlidesEnabled();
  const artWanted = artEnabled && kind === "deck" && deck()?.art?.mode === "image";
  const bookDoc = () => run.editor.doc.kind === "book" ? run.editor.doc : null;
  const bookArtWanted = kind === "book" && bookDoc()?.art?.mode === "image" && bookPlan(bookDoc()!).placement !== "none";
  const artRoute = artWanted || bookArtWanted ? routeImage({ kind: "illustration", aspect: "landscape", text: "page text", textPlacement: "exact" }, "page", allowed) : null;
  const artModel = artRoute?.ok ? artRoute.model : null;
  // The client's slide shape and quality: the best measured canvas for them (a stored choice that cannot render falls
  // back to the next lower quality; nothing renders when no canvas of the shape is measured).
  const shape = deckAspect(deck() ?? {}), wantedQuality = deck()?.art?.quality ?? "standard";
  const artChoice = artWanted && artModel ? artCellOrLower(artModel, { kind: "deck", aspect: shape }, wantedQuality) : null;
  const art = Boolean(artWanted && artModel && artChoice);
  const artCanvas: ArtCanvas = artChoice ? { size: artChoice.size, crop: artChoice.crop } : LEGACY_CANVAS;
  const artQuality: ImageQuality = artChoice?.quality ?? ART_QUALITY;
  // Plates sit behind live text: the Standard canvas of the same shape is enough.
  const plateChoice = art ? artCellOrLower(artModel!, { kind: "deck", aspect: shape }, "standard") : null;
  const plateCanvas: ArtCanvas = plateChoice ? { size: plateChoice.size, crop: plateChoice.crop } : artCanvas;
  const plateQuality: ImageQuality = plateChoice?.quality ?? artQuality;
  // Books: the cover and openers on the page canvas of the book's shape, picture-book spreads on the spread canvas.
  const bookQuality = bookDoc()?.art?.quality ?? "standard", shapeOfBook = bookDoc() ? bookShape(bookDoc()!) : "portrait";
  const pageChoice = bookArtWanted && artModel ? artCellOrLower(artModel, { kind: "book", shape: shapeOfBook }, bookQuality) : null;
  const spreadChoice = bookArtWanted && artModel ? artCellOrLower(artModel, { kind: "book", shape: shapeOfBook, spread: true }, bookQuality) : null;
  const bookArt = Boolean(bookArtWanted && artModel && pageChoice && spreadChoice);
  const pageCanvas = (spread: boolean): { canvas: ArtCanvas; quality: ImageQuality } => {
    const choice = spread ? spreadChoice! : pageChoice!;
    return { canvas: { size: choice.size, crop: choice.crop }, quality: choice.quality };
  };
  run.editor.artAvailable = kind === "deck" ? art : bookArt;
  const imageBound = art ? imageCallBoundMicrousd(artModel!, artQuality, artCanvas.size, "x".repeat(4500))
    : bookArt ? Math.max(imageCallBoundMicrousd(artModel!, pageChoice!.quality, pageChoice!.size, "x".repeat(4500)), imageCallBoundMicrousd(artModel!, spreadChoice!.quality, spreadChoice!.size, "x".repeat(4500)))
    : imageModelId ? imageCallBoundMicrousd(imageModelId, "medium", IMAGE_SIZES.portrait, "x".repeat(4000)) : Infinity;
  // Images may take at most a third of the run's allowance. Within that: a full-image deck one render per slide plus
  // retries (deckArtImageMax); an editable deck one image per slide; a book its image plan plus regenerations.
  // A full-image deck is not limited by a count: its images may use ART_IMAGE_SHARE of the allowance (checked on every
  // call against reserved bounds plus settled costs, see imageShareLeft), and the deck is planned at any length.
  const imageBudget = art ? DECK_ART_IMAGE_CAP : imageModelId ? Math.max(0, Math.floor(spend.allowanceMicrousd / imageBound / 3)) : 0;
  /** Image spend of this run so far: settled costs plus the worst-case bounds of calls still running. */
  let imageMicrousd = 0, imagesInFlight = 0, lastContext = 0;
  /** What the next turn that checks `images` renders may cost at worst (its context, each image at its token bound, a
   * check turn's output): an image starts only if this still fits after its own bound, so the gate can always run. */
  const checkReserve = (images: number) => Math.ceil((lastContext + 4000 + images * IMAGE_BLOCK_TOKEN_BOUND) * maxInputTokenMicrousd(model) + 4096 * maxOutputTokenMicrousd(model));
  const items = () => run.editor.doc.kind === "deck" ? run.editor.doc.slides.length : run.editor.doc.chapters.length;
  const bookCap = () => {
    const doc = run.editor.doc;
    if (doc.kind !== "book") return 0;
    if (bookPlan(doc).placement === "none") return 0;
    return run.effort === "light" ? policy.maxImages : bookImageMax(Math.max(plannedBookImages(doc).total, bookPlan(doc).placement === "cover" ? 1 : doc.chapters.length + 1));
  };
  const imageLimitNow = () => Math.min(imageBudget, art ? deckArtImageMax(items()) : kind === "book" ? bookCap() : documentImageMax(kind, run.effort, items()));
  const bookCeiling = kind === "book" && run.editor.doc.kind === "book" && bookPlan(run.editor.doc).placement === "none" ? 0 : run.effort === "light" ? policy.maxImages : BOOK_IMAGE_CAP;
  const imageLimit = Math.min(imageBudget, art ? DECK_ART_IMAGE_CAP : kind === "book" ? bookCeiling : documentImageMax(kind, run.effort, DOCUMENT_IMAGE_CAP));
  const imageClient = imageModelId && imageLimit > 0 ? run.imageClient ?? openaiImageClient() : null;
  const storeImage = run.storeImage ?? ((request: { name: string; prompt: string; model: string }, bytes: Buffer) => storeGeneratedImage(run.client, run.scope, request, bytes));
  const tools = docToolDefinitions(kind, imageLimit > 0, (art || bookArt) && imageLimit > 0) as unknown as BetaToolUnion[];
  // The system prompt carries its own cache marker, so every run (builds, edits,
  // reviews, every user) reuses it; the automatic breakpoint caches the conversation.
  const system = [{ type: "text" as const, text: kind === "deck" ? (art ? `${DECK_SYSTEM}\n\n${DECK_ART_SYSTEM}` : DECK_SYSTEM) : bookArt && imageLimit > 0 ? `${BOOK_SYSTEM}\n\n${BOOK_ART_SYSTEM}` : BOOK_SYSTEM, cache_control: { type: "ephemeral" as const } }];
  const meter = new ContextMeter(async messages => (await anthropic.beta.messages.countTokens({ model, system, tools, messages }, { signal: run.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
  const usage = () => run.emit({ type: "usage", credits: spend.customerCredits(rate) });
  let imagesUsed = 0, summary = "", finished = false, malformedTurns = 0, blockedFinishes = 0;
  const checks: CheckRecord[] = [];
  const record = (entry: CheckRecord) => { checks.push(entry); run.emit({ type: "check", record: entry }); };
  /** Renders waiting for check_slide, by slide id. */
  const pendingArt = new Map<string, { key: string; prompt: string; attempts: number; bytes: Buffer; problems: string[] }>();
  /** Claims-check refusals per slide: the second keeps the slide as an editable text slide. */
  const claimStrikes = new Map<string, number>();
  /** Everything the client gave (brief, answers, files as text, the current document): the source every slide claim must trace to. */
  const source = [run.request, run.context, ...run.attachments.flatMap(block => block.type === "document" && block.source.type === "text" ? [block.source.data] : block.type === "text" ? [block.text] : [])].join("\n");
  /** Generated images and slide plates waiting for check_image, by name: what a pass keeps, a failure regenerates, a second failure drops. */
  type Checked = { ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] };
  const pendingImages = new Map<string, { attempts: number; accept: () => void; retry: (fix: string) => Promise<Checked>; drop: () => void }>();
  /** Slides that just became editable text in a full-image deck: each gets a text-free plate in the deck's art direction. */
  const platesWanted: string[] = [];
  /** Images that passed check_image this run. */
  const passedImages = new Set<string>();

  const renderUsd = art ? expectedRenderUsd(artModel!, artQuality, artCanvas.size) : 0;
  const expected = art ? deckArtSlidesFor(spend.allowanceMicrousd / 1e6, renderUsd) : 0;
  const shapeLine = art ? ` Every slide is ${DECK_ASPECT_SPECS[shape].words} (${shape}): compose for that shape${shape === "9:16" ? " (a tall, phone-first page: stack the type and the image vertically)" : shape === "1:1" ? " (a square page)" : ""}.` : "";
  const waitingSlides = () => deck()?.art?.renders.filter(entry => entry.deferred).map(entry => entry.slide) ?? [];
  const deferredAtStart = art ? waitingSlides() : [];
  const imageLine = art
    ? imageLimit > 0
      ? `Full-image slides: on (each slide is one generated image including its text; model ${artModel}).${shapeLine} Plan the deck at the length the brief needs: there is no slide limit. This request's credits cover about ${expected} renders (first attempts and regenerations); if the deck needs more, render the slides that fit and finish: the rest are saved as waiting and rendered when the client continues.${deferredAtStart.length ? ` CONTINUATION: ${(deck()?.slides.length ?? 0) - deferredAtStart.length} of ${deck()?.slides.length ?? 0} slides are done; these slides are waiting to be rendered: ${deferredAtStart.join(", ")}. Render them with render_slides (no need to rewrite them unless the request asks), check them, then finish.` : ""}`
      : "Full-image slides: the run's budget cannot pay for slide renders. Design editable text slides (no art fields, no images) and say so in your summary."
    : artWanted && artModel ? `Full-image slides cannot be rendered in the ${shape} shape yet (no measured image size for it). Design editable text slides; say so in your summary.`
    : artWanted ? "Full-image slides are not available here (no text-capable image model is enabled). Design editable text slides; say so in your summary."
    : kind === "deck" && !artEnabled && deck()?.art?.mode === "image" ? "Full-image slides are not offered yet. Design editable text slides (no art fields); say so in your summary, without blaming the client's choice."
    : `Image generation: ${imageLimit > 0 ? `available (up to ${imageLimit} images this run${imageLimit > policy.maxImages ? `, about one per ${kind === "deck" ? "slide" : "chapter plus the cover"}` : ""})` : "unavailable — design without images"}.`;
  const pagesLine = bookArt && imageLimit > 0 ? ` Full-image pages: on. The cover${isPicture() ? " and every chapter's spread" : " and every chapter opener"} are generated with their words by render_pages (the book's pages are ${BOOK_SHAPE_SPECS[shapeOfBook].label}).` : bookArtWanted ? " Full-image pages are not available this run: the cover and openers are typeset; say so in your summary." : "";
  const planLine = run.editor.doc.kind === "book" ? `\n\n${bookImagePlanText(run.editor.doc)}${imageLimit > 0 ? ` Up to ${imageLimit} image generations this run, regenerations included.` : bookPlan(run.editor.doc).placement === "none" ? "" : " Image generation is unavailable this run: design without images and say so in your summary."}${pagesLine}` : "";
  const messages: BetaMessageParam[] = [{ role: "user", content: [
    ...run.attachments,
    { type: "text", text: `${run.context}\n\n${imageLine}${planLine}\n\n<request>\n${run.request}\n</request>` },
  ] }];

  /** Reserve and start one image; null (with a reason) when the budget or the plan does not allow it. */
  async function startImage(prompt: string, size: ImageSize, modelId: string, quality: ImageQuality) {
    if (!imageClient) return { error: "Image generation is unavailable." } as const;
    if (imagesUsed >= imageLimit || spend.remainingMicrousd - imageBound < spend.allowanceMicrousd * 0.1 || !imageShareLeft(imageCallBoundMicrousd(modelId, quality, size, prompt))
      || spend.remainingMicrousd - imageCallBoundMicrousd(modelId, quality, size, prompt) < checkReserve(imagesInFlight + pendingArt.size + pendingImages.size + 1)) return { error: "The image budget for this run is used up." } as const;
    try {
      const bound = imageCallBoundMicrousd(modelId, quality, size, prompt);
      // Above-medium quality is the client's choice for full-image slides; the price card still refuses unmeasured cells.
      const job = await startBudgetedImage({ client: imageClient, spend, model: modelId, prompt, size, quality, signal: run.signal, allowHigh: quality === "high" || quality === "xhigh" });
      imagesUsed++;
      // Counted at its worst case until the call reports its cost.
      imageMicrousd += bound;
      imagesInFlight++;
      void job.detail.then(detail => { imageMicrousd += (detail.costMicrousd ?? bound) - bound; imagesInFlight--; });
      return { job } as const;
    } catch (error) {
      return { error: error instanceof SpendError && !error.graceful ? `${error.message}` : "The image budget for this run is used up." } as const;
    }
  }

  /** Full-image decks: images stay within ART_IMAGE_SHARE of the allowance; other documents keep the third above. */
  function imageShareLeft(bound: number) {
    return !art || imageMicrousd + bound <= spend.allowanceMicrousd * ART_IMAGE_SHARE;
  }
  const canAffordImage = () => Boolean(imageClient) && imagesUsed < imageLimit && spend.remainingMicrousd - imageBound >= spend.allowanceMicrousd * 0.1 && imageShareLeft(imageBound)
    && spend.remainingMicrousd - imageBound >= checkReserve(imagesInFlight + pendingArt.size + pendingImages.size + 1);
  const slideOf = (id: string) => deck()?.slides.find(slide => slide.id === id);
  const slideNumber = (id: string) => (deck()?.slides.findIndex(slide => slide.id === id) ?? -1) + 1;
  /** Why a slide cannot be rendered now, or null. */
  function renderRefusal(slide: Slide | undefined, id: string) {
    const doc = deck();
    if (!slide || !doc) return `No slide with id "${id}".`;
    if (!doc.art?.system) return "Set art_system with set_deck_details first: it is the design system every slide is generated in.";
    if (!slide.art) return `Slide ${slideNumber(id)} has no art plan: rewrite it with art {frame, brief}.`;
    if (pendingArt.has(id)) return `Slide ${slideNumber(id)} is waiting for check_slide.`;
    if (verifiedArt(doc, slide)) return `Slide ${slideNumber(id)} already has a verified render for its current text.`;
    const text = artTextIssues(slide);
    if (text.length) return `Slide ${slideNumber(id)} has too much text for one image: ${text.join("; ")}. Shorten it with write_slide, or leave it as an editable slide.`;
    // A fill-in field baked into an image could never be typed in by the client: the slide stays editable text.
    const placeholders = artPlaceholders(slide);
    if (placeholders.length) {
      fallback(id, 0, [`placeholder in a full-image slide: ${placeholders.join("; ")}`]);
      return `Slide ${slideNumber(id)} contains a fill-in field (${placeholders.join("; ")}). It is kept as an editable text slide so the client can type the value. To make it a full image instead, rewrite it so the unknown value is simply omitted (no brackets, TBD or XX) and render it again.`;
    }
    // Claims: every figure and status on the slide must trace to the client's own words.
    const claims = slideClaimIssues(slide, source);
    if (claims.length) {
      const strikes = (claimStrikes.get(id) ?? 0) + 1;
      claimStrikes.set(id, strikes);
      if (strikes >= CHECK_ATTEMPTS) {
        fallback(id, 0, claims.map(claim => `claim: ${claim}`));
        return `Slide ${slideNumber(id)} still makes claims the brief does not support (${claims.join("; ")}). It is kept as an editable text slide; correct its words with write_slide before finishing.`;
      }
      return `Slide ${slideNumber(id)} was not rendered: ${claims.join("; ")}. Rewrite it with write_slide so every figure and status is the client's own (or labelled illustrative), then render it again.`;
    }
    const index = doc.slides.indexOf(slide);
    for (const neighbour of [doc.slides[index - 1], doc.slides[index + 1]]) {
      if (!neighbour) continue;
      const frame = doc.art.renders.find(entry => entry.slide === neighbour.id && entry.outcome === "passed")?.frame ?? neighbour.art?.frame;
      if (neighbour.layout === slide.layout) return `Slide ${slideNumber(id)} uses the ${slide.layout} layout like slide ${slideNumber(neighbour.id)} beside it; full-image decks never repeat a layout on consecutive slides. Change one of them.`;
      if (frame === slide.art.frame) return `Slide ${slideNumber(id)} uses the ${slide.art.frame} frame like slide ${slideNumber(neighbour.id)} beside it. Give one of them a different frame and brief.`;
    }
    return null;
  }
  /** The content block for one render to check. */
  async function renderContent(id: string, bytes: Buffer, attempt: number): Promise<(BetaTextBlockParam | BetaImageBlockParam)[]> {
    const slide = slideOf(id)!;
    const words = gateText(deck()!, slide).map(line => `- ${line.role}: "${line.text}"`).join("\n");
    return [{ type: "text", text: `Slide ${slideNumber(id)} (${id}), attempt ${attempt} of ${CHECK_ATTEMPTS}. It must show exactly these words and nothing else:\n${words}\nLook at the image and call check_slide for "${id}": transcript = every word and number you can actually read, verbatim with its exact capitalisation (with any misspelling, missing or extra letter, or odd capital), in reading order, including small footers, corner labels and every repetition (a wordmark or label that appears twice must be written twice); artifacts = any garbled or malformed glyph, stray or extra text, cut-off text, any word or label closer than ${ART_SAFE_MARGIN_PCT}% of the slide height to the top or bottom edge or closer than 5% to a side, poor contrast, warped or plastic people, oversaturation, HDR glow, clip-art icons, random gradients, or a composition that repeats its neighbour; verdict pass only if every word is exactly right and it looks like professional editorial design.` },
      await visionBlock(bytes)];
  }
  /** Start one slide render; resolves to the tool-result blocks (the image to check, or why it failed). */
  async function renderSlide(id: string, attempt: number, fix?: string): Promise<(BetaTextBlockParam | BetaImageBlockParam)[]> {
    const doc = deck()!, slide = slideOf(id)!;
    const prompt = artPrompt(doc, slide, fix, artCanvas);
    const started = await startImage(prompt, artCanvas.size, artModel!, artQuality);
    if ("error" in started) return [{ type: "text", text: `Slide ${slideNumber(id)} (${id}) was not rendered: ${started.error} It stays an editable text slide.` }];
    run.emit({ type: "image_start", name: artName(id), prompt: `Slide ${slideNumber(id)}: ${slide.title}` });
    const key = textKey(slide);
    try {
      const bytes = await cropSlide(await started.job.done, artCanvas);
      pendingArt.set(id, { key, prompt, attempts: attempt, bytes, problems: [] });
      return renderContent(id, bytes, attempt);
    } catch {
      return [{ type: "text", text: `Rendering slide ${slideNumber(id)} (${id}) failed at the image service. It stays an editable text slide unless you render it again.` }];
    }
  }
  /** Keep a slide as an editable live-text slide after a failed gate; the deck is never shown with wrong words. */
  function fallback(id: string, attempts: number, problems: string[], options: { deferred?: boolean } = {}) {
    pendingArt.delete(id);
    const slide = slideOf(id);
    if (!slide) return;
    // A slide waiting for the client's Continue borrows a checked plate of this deck, so it already reads as one family.
    const shared = options.deferred ? deck()?.art?.renders.find(entry => entry.plate && run.editor.hasImage(entry.plate))?.plate : undefined;
    run.editor.recordRender({ slide: id, frame: slide.art?.frame, attempts, outcome: "fallback", problems: problems.slice(0, 6).map(item => item.slice(0, 300)), ...(options.deferred ? { deferred: true } : {}), ...(shared ? { plate: shared } : {}) });
    record({ target: "slide", id, attempt: attempts, outcome: "fallback", problems });
    run.emit({ type: "document", document: run.editor.doc, focus: id });
    if (!options.deferred && !platesWanted.includes(id)) platesWanted.push(id);
  }
  /** The request's credits are used up before this slide was rendered: it waits for the client's Continue. */
  const defer = (id: string) => fallback(id, 0, ["waiting to render: this request's credits are used up; Continue renders it"], { deferred: true });
  /** A text-free plate for an editable slide: the same art system, the live text's area kept calm. Checked like book images. */
  async function makePlate(id: string, attempt: number, fix?: string): Promise<(BetaTextBlockParam | BetaImageBlockParam)[]> {
    const doc = deck(), slide = slideOf(id);
    if (!doc || !slide || !artModel || !imageClient) return [];
    const index = doc.slides.indexOf(slide), live = composeSlide({ ...doc, art: undefined }, slide, index, doc.slides.length);
    const boxes = live.prims.filter(prim => prim.k === "text" || prim.k === "chart" || prim.k === "rect" && prim.w * prim.h < 1280 * 720 * 0.9).map(prim => prim as { x: number; y: number; w: number; h: number });
    const area = boxes.length ? { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)), w: 0, h: 0 } : { x: 80, y: 80, w: 1120, h: 560 };
    if (boxes.length) { area.w = Math.max(...boxes.map(b => b.x + b.w)) - area.x; area.h = Math.max(...boxes.map(b => b.y + b.h)) - area.y; }
    const prompt = platePrompt(doc, slide, area, fix, plateCanvas);
    const started = await startImage(prompt, plateCanvas.size, artModel, plateQuality);
    if ("error" in started) return [{ type: "text", text: `No background plate for slide ${slideNumber(id)}: ${started.error} It keeps the plain editable layout.` }];
    const name = `plate-${id}`.slice(0, 49).replace(/-+$/, "");
    run.emit({ type: "image_start", name, prompt: `Background for slide ${slideNumber(id)}: ${slide.title}` });
    try {
      const bytes = await cropSlide(await started.job.done, plateCanvas);
      const [asset, luma, shade] = await Promise.all([storeImage({ name, prompt, model: artModel }, bytes), imageLuma(bytes), imageShade(bytes)]);
      run.editor.addAsset({ name, id: asset.id, aspect: "landscape", alt: "", prompt: prompt.slice(0, 3000), luma, shade });
      pendingImages.set(name, { attempts: attempt,
        accept: () => { const render = deck()?.art?.renders.find(entry => entry.slide === id && entry.outcome === "fallback"); if (render) run.editor.recordRender({ ...render, plate: name }); run.emit({ type: "document", document: run.editor.doc, focus: id }); },
        retry: async correction => { const content = await makePlate(id, attempt + 1, correction); return { ok: content.length > 0, content: content.length ? content : "The plate could not be regenerated." }; },
        drop: () => run.editor.dropImage(name) });
      return [{ type: "text", text: `Slide ${slideNumber(id)} (${id}) stays editable text; this is its text-free background plate in the deck's art direction (attempt ${attempt} of ${CHECK_ATTEMPTS}). The live text will sit over the calm area. Call check_image for "${name}": artifacts = any letters, numbers or pseudo-text, a busy or patterned area where the text goes, a look that does not match the deck's other slides, or AI artifacts; verdict pass only if it is a calm, professional background of this deck.` }, await visionBlock(bytes)];
    } catch {
      return [{ type: "text", text: `The background plate for slide ${slideNumber(id)} failed at the image service; it keeps the plain editable layout.` }];
    }
  }
  /** Plates for every slide that became editable text since the last call (one image each, within the image budget). */
  async function platesFor(): Promise<(BetaTextBlockParam | BetaImageBlockParam)[]> {
    const ids = platesWanted.splice(0).filter(id => deck()?.art?.renders.some(entry => entry.slide === id && entry.outcome === "fallback" && !entry.plate)).filter(id => {
      // A plate the designer already generated under this name and checked is used as it is (no second image).
      const name = `plate-${id}`.slice(0, 49).replace(/-+$/, ""), render = deck()?.art?.renders.find(entry => entry.slide === id);
      if (!passedImages.has(name) || !run.editor.hasImage(name) || !render) return true;
      run.editor.recordRender({ ...render, plate: name });
      return false;
    });
    return (await Promise.all(ids.map(id => makePlate(id, 1)))).flat();
  }
  async function checkSlide(input: z.infer<typeof DocToolInputs.check_slide>): Promise<{ ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] }> {
    const pending = pendingArt.get(input.id), slide = slideOf(input.id);
    if (!pending || !slide) return { ok: false, content: `No render of "${input.id}" is waiting for a check. Render it with render_slides first.` };
    if (textKey(slide) !== pending.key) { pendingArt.delete(input.id); return { ok: false, content: `Slide ${slideNumber(input.id)} changed after it was rendered; render it again.` }; }
    const comparison = compareSlideText(gateText(deck()!, slide).map(line => line.text), input.transcript, { numerals: slideNumerals(slide) });
    // The image must say only what the slide says; the slide was checked against the brief before it was rendered.
    const problems = [...input.artifacts, ...(comparison.ok ? [] : [describeComparison(comparison)])];
    if (input.verdict === "pass" && comparison.ok && !input.artifacts.length) {
      const name = artName(input.id);
      try {
        const asset = await storeImage({ name, prompt: pending.prompt, model: artModel! }, pending.bytes);
        run.editor.addAsset({ name, id: asset.id, aspect: "landscape", alt: artAlt(slide).slice(0, 300), prompt: pending.prompt.slice(0, 3000) });
        const doc = deck()!, page = doc.art?.pageNumbers ? doc.slides.findIndex(entry => entry.id === input.id) + 1 : undefined;
        run.editor.recordRender({ slide: input.id, frame: slide.art?.frame, image: name, verified: pending.key, attempts: pending.attempts, outcome: "passed", problems: [],
          ...(shape !== "16:9" ? { aspect: shape } : {}), ...(page ? { page } : {}), ...(doc.art?.wordmark ? { wordmark: doc.art.wordmark } : {}) });
        pendingArt.delete(input.id);
        record({ target: "slide", id: input.id, attempt: pending.attempts, outcome: "passed", problems: [] });
        run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id });
        run.emit({ type: "document", document: run.editor.doc, focus: input.id });
        return { ok: true, content: `Slide ${slideNumber(input.id)} passed the text gate and is shown as its full image.` };
      } catch {
        fallback(input.id, pending.attempts, ["the render could not be stored"]);
        return { ok: false, content: `Slide ${slideNumber(input.id)} passed but could not be stored; it stays an editable text slide.` };
      }
    }
    if (input.verdict === "pass" && !comparison.ok) problems.unshift("your transcript does not match the slide's words");
    if (pending.attempts < CHECK_ATTEMPTS) {
      record({ target: "slide", id: input.id, attempt: pending.attempts, outcome: "retry", problems });
      pendingArt.delete(input.id);
      const fix = [input.fix, comparison.ok ? "" : `Text errors: ${describeComparison(comparison)}. Spell every word exactly as listed; add no other words.`, input.artifacts.length ? `Visual problems: ${input.artifacts.join("; ")}.` : ""].filter(Boolean).join(" ");
      const content = await renderSlide(input.id, pending.attempts + 1, fix);
      if (!pendingArt.has(input.id)) { fallback(input.id, pending.attempts, problems); return { ok: true, content: [...content, { type: "text", text: "It is kept as an editable text slide." }, ...await platesFor()] }; }
      return { ok: true, content: [{ type: "text", text: `Slide ${slideNumber(input.id)} failed (${problems.join("; ").slice(0, 400)}) and was regenerated with a corrected prompt. Check the new attempt:` }, ...content] };
    }
    fallback(input.id, pending.attempts, problems);
    return { ok: true, content: [{ type: "text", text: `Slide ${slideNumber(input.id)} failed the gate twice (${problems.join("; ").slice(0, 400)}). It is now an editable live-text slide, set over a text-free plate in the deck's art direction, so the deck is never wrong.` }, ...await platesFor()] };
  }

  function isPicture() { const book = bookDoc(); return Boolean(book && bookPlan(book).placement === "picture"); }
  /** Generated book pages waiting for check_page, by target. */
  const pendingPages = new Map<string, { key: string; prompt: string; attempts: number; bytes: Buffer }>();
  const pageName = (target: string) => `page-${target}`.slice(0, 49).replace(/-+$/, "");
  /** Why a page cannot be generated now, or null. */
  function pageRefusal(target: string) {
    const book = bookDoc();
    if (!book) return "This is not a book.";
    if (!book.art?.system) return "Set art_system with set_book_details first: it is the design system every generated page follows.";
    if (!pageKind(book, target)) return `"${target}" has no generated page in this book (the cover, chapters that open on their own page${isPicture() ? ", or picture-book chapters" : ""}).`;
    if (pendingPages.has(target)) return `"${target}" is waiting for check_page.`;
    if (verifiedPage(book, target)) return `"${target}" already has a verified page for its current words.`;
    const issues = pageArtIssues(book, target);
    return issues.length ? `"${target}" cannot be generated yet: ${issues.join("; ")}.` : null;
  }
  async function renderPage(target: string, attempt: number, fix?: string): Promise<(BetaTextBlockParam | BetaImageBlockParam)[]> {
    const book = bookDoc()!, kindOfPage = pageKind(book, target)!;
    const { canvas, quality } = pageCanvas(kindOfPage === "spread");
    const prompt = bookArtPrompt(book, target, canvas, fix);
    const started = await startImage(prompt, canvas.size, artModel!, quality);
    if ("error" in started) return [{ type: "text", text: `"${target}" was not generated: ${started.error} It stays typeset.` }];
    run.emit({ type: "image_start", name: pageName(target), prompt: target === "cover" ? "The cover" : `Chapter page: ${book.chapters.find(chapter => chapter.id === target)?.title ?? target}` });
    const key = pageTextKey(book, target);
    try {
      const bytes = await cropSlide(await started.job.done, canvas);
      pendingPages.set(target, { key, prompt, attempts: attempt, bytes });
      const words = pageText(book, target).map(line => `- ${line.role}: "${line.text}"`).join("\n");
      return [{ type: "text", text: `Page "${target}" (${kindOfPage}), attempt ${attempt} of ${CHECK_ATTEMPTS}. It must show exactly these words and nothing else:\n${words}\nLook at the image and call check_page for "${target}": transcript = every word you can actually read, verbatim with its capitalisation, in reading order; artifacts = any garbled glyph, stray or extra text, cut-off words, words closer than 7% to an edge${kindOfPage === "spread" ? " or crossing the centre gutter" : ""}, poor contrast, warped or plastic figures, oversaturation or anything that is not museum-quality book design; verdict pass only if every word is exactly right.` }, await visionBlock(bytes)];
    } catch {
      return [{ type: "text", text: `Generating "${target}" failed at the image service. It stays typeset unless you render it again.` }];
    }
  }
  function pageFallback(target: string, attempts: number, problems: string[]) {
    pendingPages.delete(target);
    const book = bookDoc(), kindOfPage = book ? pageKind(book, target) : null;
    if (!book || !kindOfPage) return;
    run.editor.recordPageRender({ target, kind: kindOfPage, attempts, outcome: "fallback", problems: problems.slice(0, 6).map(item => item.slice(0, 300)) });
    record({ target: "image", id: pageName(target), attempt: attempts, outcome: "fallback", problems });
    run.emit({ type: "document", document: run.editor.doc });
  }
  async function checkPage(input: z.infer<typeof DocToolInputs.check_page>): Promise<{ ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] }> {
    const pending = pendingPages.get(input.target), book = bookDoc();
    if (!pending || !book) return { ok: false, content: `No page "${input.target}" is waiting for a check. Generate it with render_pages first.` };
    if (pageTextKey(book, input.target) !== pending.key) { pendingPages.delete(input.target); return { ok: false, content: `The words of "${input.target}" changed after it was generated; render it again.` }; }
    const comparison = compareSlideText(pageText(book, input.target).map(line => line.text), input.transcript);
    const problems = [...input.artifacts, ...(comparison.ok ? [] : [describeComparison(comparison)])];
    if (input.verdict === "pass" && comparison.ok && !input.artifacts.length) {
      const name = pageName(input.target), kindOfPage = pageKind(book, input.target)!;
      try {
        const asset = await storeImage({ name, prompt: pending.prompt, model: artModel! }, pending.bytes);
        run.editor.addAsset({ name, id: asset.id, aspect: kindOfPage === "spread" ? "landscape" : "portrait", alt: pageAlt(book, input.target).slice(0, 300), prompt: pending.prompt.slice(0, 3000) });
        run.editor.recordPageRender({ target: input.target, kind: kindOfPage, image: name, verified: pending.key, attempts: pending.attempts, outcome: "passed", problems: [], ...(shapeOfBook !== "portrait" ? { shape: shapeOfBook } : {}) });
        pendingPages.delete(input.target);
        record({ target: "image", id: name, attempt: pending.attempts, outcome: "passed", problems: [] });
        run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id });
        run.emit({ type: "document", document: run.editor.doc });
        return { ok: true, content: `"${input.target}" passed the text gate and is shown as its generated page.` };
      } catch {
        pageFallback(input.target, pending.attempts, ["the page could not be stored"]);
        return { ok: false, content: `"${input.target}" passed but could not be stored; it stays typeset.` };
      }
    }
    if (input.verdict === "pass" && !comparison.ok) problems.unshift("your transcript does not match the page's words");
    if (pending.attempts < CHECK_ATTEMPTS) {
      record({ target: "image", id: pageName(input.target), attempt: pending.attempts, outcome: "retry", problems });
      pendingPages.delete(input.target);
      const fix = [input.fix, comparison.ok ? "" : `Text errors: ${describeComparison(comparison)}. Spell every word exactly as listed; add no other words.`, input.artifacts.length ? `Visual problems: ${input.artifacts.join("; ")}.` : ""].filter(Boolean).join(" ");
      const content = await renderPage(input.target, pending.attempts + 1, fix);
      if (!pendingPages.has(input.target)) { pageFallback(input.target, pending.attempts, problems); return { ok: true, content: [...content, { type: "text", text: "It stays typeset." }] }; }
      return { ok: true, content: [{ type: "text", text: `"${input.target}" failed (${problems.join("; ").slice(0, 400)}) and was regenerated with a corrected prompt. Check the new attempt:` }, ...content] };
    }
    pageFallback(input.target, pending.attempts, problems);
    return { ok: true, content: `"${input.target}" failed the gate twice (${problems.join("; ").slice(0, 400)}). It stays typeset, so the book is never wrong${input.target === "cover" || pageKind(book, input.target) === "opener" ? "; if the plan has room you may generate a text-free picture for it with generate_image (cover_image or the chapter's image) and check it" : ""}.` };
  }

  /** One generate_image call: the stored image comes back to the model to check (check_image). */
  async function generate(input: z.infer<typeof DocToolInputs.generate_image>, attempt: number, fix?: string): Promise<{ ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] }> {
    const prompt = run.editor.imagePrompt(fix ? `${input.prompt}\n\nCORRECTION — the previous attempt had these problems; avoid them: ${fix}` : input.prompt);
    const started = await startImage(prompt, IMAGE_SIZES[input.aspect], imageModelId!, "medium");
    if ("error" in started) return { ok: false, content: `${started.error} Continue without this image (reuse an existing one or remove the reference).` };
    run.emit({ type: "image_start", name: input.name, prompt: input.prompt });
    try {
      const bytes = await started.job.done;
      // The brightness map sizes the scrim under any text set over this image (documents/compose-image.ts).
      const [asset, luma] = await Promise.all([storeImage({ name: input.name, prompt, model: imageModelId! }, bytes), imageLuma(bytes).catch(() => undefined)]);
      run.editor.addAsset({ name: input.name, id: asset.id, aspect: input.aspect, alt: input.alt, prompt: input.prompt, ...(luma ? { luma } : {}) });
      run.emit({ type: "image", path: asset.path, url: asset.url, assetId: asset.id });
      run.emit({ type: "document", document: run.editor.doc });
      pendingImages.set(input.name, { attempts: attempt, accept: () => undefined, retry: correction => generate(input, attempt + 1, correction),
        drop: () => { run.editor.dropImage(input.name); run.emit({ type: "document", document: run.editor.doc }); } });
      return { ok: true, content: [{ type: "text", text: `Image "${input.name}" is ready (${input.aspect}), attempt ${attempt} of ${CHECK_ATTEMPTS}. Reference it by name. Look at it and call check_image for "${input.name}": artifacts = any garbled pseudo-text or letters, warped hands, faces or objects, plastic or uncanny people, extra limbs, oversaturation, HDR glow, clip-art, random gradients, or a subject that does not do its job (${input.alt.slice(0, 160)}); verdict pass only if it looks like real, professional ${kind === "book" ? "book art" : "editorial imagery"}.` }, await visionBlock(bytes)] };
    } catch {
      return { ok: false, content: `Image generation for "${input.name}" failed. Continue without it (remove the reference).` };
    }
  }
  async function checkImage(input: z.infer<typeof DocToolInputs.check_image>): Promise<{ ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] }> {
    const pending = pendingImages.get(input.name);
    if (!pending) return { ok: false, content: `No image "${input.name}" is waiting for a check.` };
    pendingImages.delete(input.name);
    if (input.verdict === "pass" && !input.artifacts.length) { pending.accept(); passedImages.add(input.name); record({ target: "image", id: input.name, attempt: pending.attempts, outcome: "passed", problems: [] }); return { ok: true, content: `Image "${input.name}" passed.` }; }
    const problems = input.artifacts.length ? input.artifacts : ["failed the visual check"];
    if (pending.attempts < CHECK_ATTEMPTS) {
      record({ target: "image", id: input.name, attempt: pending.attempts, outcome: "retry", problems });
      const result = await pending.retry([input.fix, problems.join("; ")].filter(Boolean).join(" "));
      if (pendingImages.has(input.name)) return { ok: true, content: [{ type: "text", text: `Image "${input.name}" failed (${problems.join("; ").slice(0, 300)}) and was regenerated with a corrected prompt.` }, ...(typeof result.content === "string" ? [{ type: "text" as const, text: result.content }] : result.content)] };
      // Could not regenerate: the failed image is not kept.
    }
    pending.drop();
    record({ target: "image", id: input.name, attempt: pending.attempts, outcome: "dropped", problems });
    run.emit({ type: "document", document: run.editor.doc });
    return { ok: true, content: `Image "${input.name}" failed its check ${pending.attempts < CHECK_ATTEMPTS ? "and could not be regenerated" : "twice"}; it was removed with every reference to it and the layout closes up around it. Do not reference it again.` };
  }

  /** At the end of a run: slides never rendered or checked are recorded as editable fallbacks; unchecked images are logged. */
  function settlePending(reason: string) {
    for (const [id, pending] of pendingArt) fallback(id, pending.attempts, [reason]);
    for (const [target, pending] of pendingPages) pageFallback(target, pending.attempts, [reason]);
    const doc = deck();
    if (doc && art && doc.art) for (const slide of doc.slides) if (!verifiedArt(doc, slide) && !doc.art.renders.some(entry => entry.slide === slide.id)) defer(slide.id);
    for (const [name, pending] of pendingImages) record({ target: "image", id: name, attempt: pending.attempts, outcome: "unchecked", problems: [reason] });
    pendingImages.clear();
  }

  for (let turn = 0; turn < policy.maxTurns && !finished; turn++) {
    const deadline = Math.min(run.deadline, spend.deadline);
    if (run.signal.aborted || Date.now() > deadline - 45_000) break;

    const partial = new Map<number, { id: string; name: string; json: string; announced: boolean }>();
    const applied = new Map<string, { ok: boolean; text: string }>();
    const onEvent = (event: BetaRawMessageStreamEvent) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        partial.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: "", announced: false });
        return;
      }
      if (event.type === "content_block_stop") {
        const block = partial.get(event.index);
        partial.delete(event.index);
        if (!block || !LIVE_TOOLS.has(block.name)) return;
        // Apply as soon as the call is complete: the preview grows slide by slide.
        let input: Record<string, unknown> | null = null;
        try { input = JSON.parse(block.json || "{}"); } catch { return; /* reported when the turn completes */ }
        try {
          const text = run.editor.apply(block.name, input);
          applied.set(block.id, { ok: true, text });
          const focus = (input?.slide as { id?: string } | undefined)?.id ?? (input?.chapter as { id?: string } | undefined)?.id ?? (typeof input?.id === "string" ? input.id : undefined);
          run.emit({ type: "document", document: run.editor.doc, ...(focus ? { focus } : {}) });
          run.emit({ type: "item", key: block.id, label: describeTool(block.name, input, run.editor) });
        } catch (error) {
          applied.set(block.id, { ok: false, text: toolMessage(block.name, error) });
        }
        return;
      }
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "text_delta") run.emit({ type: "text", delta: event.delta.text });
      else if (event.delta.type === "thinking_delta" && event.delta.thinking) run.emit({ type: "progress", delta: event.delta.thinking });
      else if (event.delta.type === "input_json_delta") {
        const block = partial.get(event.index);
        if (!block) return;
        block.json += event.delta.partial_json;
        if (block.announced || !LIVE_TOOLS.has(block.name)) return;
        const title = /"title"\s*:\s*"((?:[^"\\]|\\.){3,})"/.exec(block.json.slice(0, 1200))?.[1];
        if (title || block.json.length > 400 || !["write_slide", "write_chapter"].includes(block.name)) {
          block.announced = true;
          let name = "";
          try { name = title ? `: ${JSON.parse(`"${title}"`)}` : ""; } catch { /* partial escape: show no title */ }
          const label = block.name === "write_slide" ? `Writing slide${name}` : block.name === "write_chapter" ? `Writing chapter${name}` : describeTool(block.name, null, run.editor);
          run.emit({ type: "item_start", key: block.id, label });
        }
      }
    };

    let message;
    try {
      ({ message } = await budgetedStream({ client: anthropic, spend, meter, models, maxTokens: policy.maxTokens, minTokens: MIN_STEP_TOKENS, signal: run.signal, onEvent,
        params: { betas: ["thinking-display-updates-2026-08-18"], thinking: { type: "adaptive", display: "updates" }, output_config: { effort: policy.intensity },
          cache_control: { type: "ephemeral" }, system, tools, messages } }));
    } catch (error) {
      usage();
      if (error instanceof SpendError && error.graceful) break;
      console.error("document builder step failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : error);
      if (isProviderOrSpendError(error) || run.signal.aborted || ++malformedTurns > 2) { settlePending("the run stopped"); throw error; }
      run.emit({ type: "status", message: "Retrying an incomplete step…" });
      // Tool calls that completed before the step broke are already applied; don't redo them.
      const done = [...applied.values()].filter(result => result.ok).map(result => result.text);
      messages.push({ role: "user", content: `The previous step did not return valid complete tool arguments. Use exactly one tool call in the next response, with one valid JSON object, properly escaped text, and no trailing text inside its arguments. ${kind === "book" ? "Write one chapter at a time; keep this next chapter under 600 words." : "Write one slide at a time."}${done.length ? ` These changes were already applied:\n- ${done.join("\n- ")}\nDo not repeat them.` : " No completed changes from that step were applied."} Continue with what remains, then call finish.` });
      continue;
    }
    malformedTurns = 0;
    usage();
    const content = message.content as BetaContentBlock[];
    messages.push({ role: "assistant", content: content as BetaContentBlockParam[] });
    meter.afterReply(message.usage, messages);
    lastContext = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + message.usage.output_tokens;

    if (message.stop_reason === "refusal") throw Object.assign(new Error("The request was declined by the model's safety policy."), { code: "REFUSED" });
    const uses = content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
    if (!uses.length) {
      if (message.stop_reason === "end_turn") { messages.push({ role: "user", content: "Continue. When the document is complete and checked, call finish." }); continue; }
      break;
    }

    const truncated = message.stop_reason === "max_tokens";
    const results: BetaToolResultBlockParam[] = [];
    const imageJobs: Promise<void>[] = [];
    let finishUse: BetaToolUseBlock | undefined;
    for (const use of uses) {
      const ok = (text: string | (BetaTextBlockParam | BetaImageBlockParam)[]) => results.push({ type: "tool_result", tool_use_id: use.id, content: text });
      const fail = (text: string) => { results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: text }); run.emit({ type: "tool_error", tool: use.name, message: text }); };
      const settle = (result: { ok: boolean; content: string | (BetaTextBlockParam | BetaImageBlockParam)[] }): void => { if (result.ok || typeof result.content !== "string") ok(result.content); else fail(result.content); };
      const early = applied.get(use.id);
      if (early) { if (early.ok) ok(early.text); else fail(early.text); continue; }
      if (truncated) { fail("Your response hit the output limit before this tool call completed. Write fewer or shorter items per step."); continue; }
      try {
        if (use.name === "finish") { finishUse = use; continue; }
        if (use.name === "generate_image") {
          const input = DocToolInputs.generate_image.parse(use.input);
          if (!imageClient || !imageModelId) { fail("Image generation is unavailable. Design without images."); continue; }
          if (imagesUsed >= imageLimitNow() && imagesUsed < imageLimit) { fail(kind === "book" ? `The image plan allows about ${imageLimitNow()} images for the book as written so far. Write the chapters and figures that will show images first, then generate them; never add filler images.` : `Images follow the document: about one per slide. Write the slides that will show images first, then generate them.`); continue; }
          if (imagesUsed >= imageLimitNow() || spend.remainingMicrousd - imageBound < spend.allowanceMicrousd * 0.1) { fail("The image budget for this run is used up. Reuse existing images or remove the image field."); continue; }
          imageJobs.push(generate(input, 1).then(settle));
          continue;
        }
        if (use.name === "check_image") { const input = DocToolInputs.check_image.parse(use.input); imageJobs.push(checkImage(input).then(settle)); continue; }
        if (use.name === "render_slides") {
          const input = DocToolInputs.render_slides.parse(use.input);
          if (!art) { fail("This deck does not use full-image slides."); continue; }
          const refusals: string[] = [], started: Promise<(BetaTextBlockParam | BetaImageBlockParam)[]>[] = [];
          for (const id of [...new Set(input.ids)]) {
            const refusal = renderRefusal(slideOf(id), id);
            if (refusal) { refusals.push(refusal); continue; }
            if (imagesUsed + started.length >= imageLimitNow() || !canAffordImage()) { defer(id); refusals.push(`Slide ${slideNumber(id)} was not rendered: this request's credits are used up. It is saved as waiting and rendered when the client continues.`); continue; }
            started.push(renderSlide(id, 1));
          }
          imageJobs.push(Promise.all(started).then(async blocks => {
            const flat = [...blocks.flat(), ...await platesFor()];
            if (!flat.length) { fail(refusals.join("\n") || "Nothing to render."); return; }
            ok([...(refusals.length ? [{ type: "text" as const, text: `Not rendered:\n- ${refusals.join("\n- ")}` }] : []), ...flat]);
          }));
          continue;
        }
        if (use.name === "check_slide") { const input = DocToolInputs.check_slide.parse(use.input); imageJobs.push(checkSlide(input).then(settle)); continue; }
        if (use.name === "render_pages") {
          const input = DocToolInputs.render_pages.parse(use.input);
          if (!bookArt) { fail("This book does not generate its pages."); continue; }
          const refusals: string[] = [], started: Promise<(BetaTextBlockParam | BetaImageBlockParam)[]>[] = [];
          for (const target of [...new Set(input.targets)]) {
            const refusal = pageRefusal(target);
            if (refusal) { refusals.push(refusal); continue; }
            if (imagesUsed + started.length >= imageLimitNow() || !canAffordImage()) { refusals.push(`"${target}" was not generated: the image budget for this run is used up. It stays typeset.`); continue; }
            started.push(renderPage(target, 1));
          }
          imageJobs.push(Promise.all(started).then(blocks => {
            const flat = blocks.flat();
            if (!flat.length) { fail(refusals.join("\n") || "Nothing to generate."); return; }
            ok([...(refusals.length ? [{ type: "text" as const, text: `Not generated:\n- ${refusals.join("\n- ")}` }] : []), ...flat]);
          }));
          continue;
        }
        if (use.name === "check_page") { const input = DocToolInputs.check_page.parse(use.input); imageJobs.push(checkPage(input).then(settle)); continue; }
        const text = run.editor.apply(use.name, use.input);
        run.emit({ type: "document", document: run.editor.doc });
        ok(text);
      } catch (error) {
        fail(toolMessage(use.name, error));
      }
    }
    await Promise.all(imageJobs);
    if (finishUse) {
      // Validate after this step's images exist.
      try {
        const input = DocToolInputs.finish.parse(finishUse.input);
        const problems = run.editor.problems();
        if (results.some(result => result.is_error)) problems.unshift("A tool failed in this step. Correct that tool input before declaring the document complete.");
        // Slides the designer left unrendered stay editable text: each gets its plate now, checked before the deck is finished.
        const doc0 = deck();
        // Unrendered slides the run can no longer pay to render (or to plate) wait for the client's Continue instead.
        if (art && doc0?.art && blockedFinishes < 2) for (const slide of doc0.slides) if (!verifiedArt(doc0, slide) && !pendingArt.has(slide.id) && !doc0.art.renders.some(entry => entry.slide === slide.id && !entry.deferred)) {
          if (canAffordImage() && !doc0.art.renders.some(entry => entry.slide === slide.id && entry.deferred)) fallback(slide.id, 0, ["not rendered as a full image; kept as an editable text slide"]); else if (!doc0.art.renders.some(entry => entry.slide === slide.id)) defer(slide.id);
        }
        const plates = blockedFinishes < 2 ? await platesFor() : [];
        const waiting = [...[...pendingArt.keys()].map(id => `slide ${slideNumber(id)} (check_slide)`), ...[...pendingPages.keys()].map(target => `page "${target}" (check_page)`), ...[...pendingImages.keys()].map(name => `image "${name}" (check_image)`)];
        // Checks block the first finish; a second finish keeps the deck correct by itself (unchecked renders become editable slides).
        // Claims on slides that stay editable text (placeholders, fallbacks) are checked too, once: they are not rendered, so render_slides never saw them.
        const doc = deck(), claims = art && doc ? doc.slides.flatMap((slide, index) => verifiedArt(doc, slide) ? [] : slideClaimIssues(slide, source).map(claim => `Slide ${index + 1} (${slide.id}): ${claim}.`)) : [];
        // Checks block up to two finishes (a plate made at the first may still need its check); claims block once.
        const firstBlock = (waiting.length || claims.length) && blockedFinishes++ < (waiting.length ? 2 : 1);
        if (firstBlock && claims.length) problems.unshift(...claims.slice(0, 6));
        if (firstBlock && waiting.length) problems.unshift(`Check these before finishing: ${waiting.join(", ")}.`);
        if (problems.length) {
          const text = `Not finished yet. Fix these, then call finish again:\n- ${problems.join("\n- ")}`;
          // Plates made at this finish come back with it to be checked (one tool result per call).
          results.push(plates.length ? { type: "tool_result", tool_use_id: finishUse.id, content: [{ type: "text", text }, ...plates] } : { type: "tool_result", tool_use_id: finishUse.id, is_error: true, content: text });
          run.emit({ type: "tool_error", tool: "finish", message: problems[0] });
        } else { summary = input.summary; finished = true; results.push({ type: "tool_result", tool_use_id: finishUse.id, content: "Saved." }); }
      } catch (error) { results.push({ type: "tool_result", tool_use_id: finishUse.id, is_error: true, content: toolMessage("finish", error) }); }
    }
    usage();
    if (finished) break;
    const order = new Map(uses.map((use, index) => [use.id, index]));
    results.sort((a, b) => order.get(a.tool_use_id)! - order.get(b.tool_use_id)!);
    messages.push({ role: "user", content: results });
    if (spend.stopped || spend.remainingMicrousd <= 0) break;
    if (spend.remainingMicrousd < spend.allowanceMicrousd * 0.25 || turn === policy.maxTurns - 2 || Date.now() > deadline - 120_000) {
      messages.push({ role: "user", content: "Budget or time is nearly used up. Finish the most important remaining work in this step and call finish now." });
    }
  }
  settlePending(finished ? "the run finished before it was checked" : "the run ended before it was checked");
  // A full-image deck with slides still waiting is saved progress, not a finished deck: the client's Continue renders the rest.
  const left = art ? waitingSlides() : [];
  if (left.length) {
    const total = deck()?.slides.length ?? 0, credits = Math.ceil(left.length * (renderUsd + 0.03) / rate);
    summary = `${total - left.length} of ${total} slides rendered. Continue to render the remaining ${left.length} (about ${credits} credits); until then they show as editable text slides in the deck's style.${summary ? `\n\n${summary}` : ""}`;
    finished = false;
  }
  if (art && artChoice?.downgraded) summary = `${summary}${summary ? "\n\n" : ""}Rendered at ${ART_QUALITY_TEXT[artChoice.chosen].label} quality: ${ART_QUALITY_TEXT[wantedQuality].label} is not available for this slide shape yet.`;
  return { summary, credits: spend.customerCredits(rate), usd: spend.providerMicrousd / 1e6, finished, stopped: spend.stopped, checks };
}

function toolMessage(name: string, error: unknown) {
  if (error instanceof DocToolError) return error.message;
  if (error instanceof z.ZodError) return `Invalid ${name} input: ${error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}.`;
  return `${name} failed.`;
}
