import { z } from "zod";
import {
  AssetSchema, BookImagePlanSchema, BookSchema, ChapterSchema, CHAPTER_TEXT_LIMIT, DeckSchema, DOCUMENT_BYTE_LIMIT, DocumentSourceSchema, ImageName, ItemId, PageArtSchema, SLIDE_MODES, SlideSchema, ThemeSchema,
  type ArtQuality, type Book, type BookImagePlan, type BookShape, type Deck, type DeckAspect, type DocumentAsset, type DocumentSource, type Slide,
} from "./schema";
import { defaultTheme, themeIssues } from "./theme";
import { composeSlide } from "./slide-scene";
import { directionOf } from "./directions";
import { parseBookMarkup, wordCount } from "./book-markup";
import { CoverCompositionSchema } from "./composition-schema";
import { imageSupport } from "./compose-image";
import { artAccentIssue, artFontsFor, artPlaceholders, artPlanIssues, artTextIssues, textKey, verifiedArt, type ArtRender } from "./slide-art";
import { bookImageIssues } from "./book-images";
import { pagesWanted, verifiedPage } from "./book-art";

export class DocToolError extends Error {}

const position = z.string().max(48).optional().describe('Insert after this id, or "start". Omit to keep an existing item in place or append a new one.');
const DeckDetails = z.object({ title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(220).optional(), author: z.string().trim().max(120).optional(),
  art_system: z.string().trim().min(40).max(1600).optional().describe("Full-image decks: the one design system every generated slide follows (grid, type style described precisely, palette use, photographic or illustrative language, recurring motif). Omit to keep the current one."),
  slide_mode: z.enum(SLIDE_MODES).optional().describe("image = each slide is one generated picture including its text; live = editable text slides. Change only when the user asks. Omit to keep."),
  wordmark: z.string().trim().min(1).max(40).nullable().optional().describe("Full-image decks: the client's brand or organisation name as a small wordmark on every slide (only a name the brief gives; never invented). null removes it; omit to keep."),
}).strict();
const BookDetails = z.object({
  title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(220).optional(), author: z.string().trim().max(120).optional(),
  dedication: z.string().trim().max(400).optional(), cover_image: ImageName.optional(), tagline: z.string().trim().max(160).optional(),
  cover_composition: CoverCompositionSchema.nullable().optional().describe("Authored portrait cover geometry. Omit to preserve the current composition; null explicitly restores the legacy cover."),
  image_plan: BookImagePlanSchema.optional().describe("How the book is illustrated. Change only when the user asks for more, fewer or different images. Omit to keep."),
  art_system: z.string().trim().min(40).max(1600).optional().describe("Full-image books: the one design system every generated page follows (the illustration or photographic technique, palette use, the hand-lettered or typeset title style, recurring motif). Omit to keep."),
  cover_art: PageArtSchema.optional().describe("Full-image books: the generated cover's plan {layout, subject, accent, brief}; the cover's words are the title, subtitle, author and tagline. Omit to keep."),
}).strict();

/** Tool inputs validated before any change is applied. */
export const DocToolInputs = {
  set_theme: ThemeSchema.extend({ mood: z.string().trim().max(300).optional(), imageStyle: z.string().trim().max(600).optional().describe("Omit to keep the current image style"), motif: ThemeSchema.shape.motif.describe("Decorative system: grid, band, frame, quiet or orbit. Omit to keep the current one."),
    direction: ThemeSchema.shape.direction.describe("Presentations: the art direction (swiss, editorial, poster, luxury, colorblock, tech, organic, data, architect, brutalist). Omit to keep the current one.") }).strict(),
  set_deck_details: DeckDetails,
  set_book_details: BookDetails,
  write_slide: z.object({ slide: SlideSchema, after: position }).strict(),
  delete_slide: z.object({ id: ItemId }).strict(),
  move_slide: z.object({ id: ItemId, after: z.string().max(48) }).strict(),
  write_chapter: z.object({ chapter: ChapterSchema, after: position }).strict(),
  render_pages: z.object({ targets: z.array(ItemId).min(1).max(12).describe('"cover" and/or chapter ids') }).strict(),
  check_page: z.object({ target: ItemId,
    transcript: z.string().max(4000).describe("Every word, number and symbol you can read on the generated page, verbatim and in reading order, including any misspelling or stray letters. Never copy the intended text; read the image."),
    artifacts: z.array(z.string().trim().min(3).max(240)).max(8).describe("Visual problems you see; empty when there are none"),
    verdict: z.enum(["pass", "fail"]),
    fix: z.string().trim().max(700).optional().describe("For a failed page: what the next attempt must change"),
  }).strict(),
  edit_chapter: z.object({ id: ItemId, old_string: z.string().min(1).max(CHAPTER_TEXT_LIMIT), new_string: z.string().max(CHAPTER_TEXT_LIMIT), replace_all: z.boolean().optional() }).strict(),
  delete_chapter: z.object({ id: ItemId }).strict(),
  move_chapter: z.object({ id: ItemId, after: z.string().max(48) }).strict(),
  generate_image: z.object({ name: ImageName, prompt: z.string().min(20).max(3000), aspect: z.enum(["landscape", "portrait", "square"]), alt: z.string().trim().min(3).max(300) }).strict(),
  render_slides: z.object({ ids: z.array(ItemId).min(1).max(12) }).strict(),
  check_slide: z.object({ id: ItemId,
    transcript: z.string().max(4000).describe("Every word, number and symbol you can read in the rendered slide, verbatim and in reading order, including any misspelling or stray letters. Never copy the intended text; read the image."),
    artifacts: z.array(z.string().trim().min(3).max(240)).max(8).describe("Visual problems you see; empty when there are none"),
    verdict: z.enum(["pass", "fail"]),
    fix: z.string().trim().max(700).optional().describe("For a failed render: what the next attempt must change (layout, spacing, a word to spell out, an element to remove)"),
  }).strict(),
  check_image: z.object({ name: ImageName,
    artifacts: z.array(z.string().trim().min(3).max(240)).max(8).describe("Visual problems you see; empty when there are none"),
    verdict: z.enum(["pass", "fail"]),
    fix: z.string().trim().max(700).optional().describe("For a failed image: what the next attempt must change"),
  }).strict(),
  finish: z.object({ summary: z.string().trim().min(1).max(2000) }).strict(),
} as const;
export type DocToolName = keyof typeof DocToolInputs;

export const DECK_TOOLS: DocToolName[] = ["set_theme", "set_deck_details", "write_slide", "delete_slide", "move_slide", "render_slides", "check_slide", "generate_image", "check_image", "finish"];
export const BOOK_TOOLS: DocToolName[] = ["set_theme", "set_book_details", "write_chapter", "edit_chapter", "delete_chapter", "move_chapter", "render_pages", "check_page", "generate_image", "check_image", "finish"];
/** Tools the agent runs itself (images and the checks); apply() refuses them. */
export const AGENT_TOOLS = new Set<string>(["generate_image", "check_image", "render_slides", "check_slide", "render_pages", "check_page", "finish"]);
const IMAGE_TOOLS = new Set<string>(["generate_image", "check_image"]), ART_TOOLS = new Set<string>(["render_slides", "check_slide", "render_pages", "check_page"]);

const DESCRIPTIONS: Record<DocToolName, string> = {
  set_theme: "Set the visual theme: a 7-color palette (contrast is checked), a font pairing, the art direction (presentations) or decorative motif (books), the mood, and one image style that every generated image will share. Call it first on a new document and whenever the user asks for a different look; changing the direction recomposes every slide.",
  set_deck_details: "Set the presentation title (shown in slide footers), subtitle and presenter/author.",
  set_book_details: "Set the book title, subtitle, author, dedication, the cover image name and an optional cover tagline. Use cover_composition for an original editable portrait cover; omit it to preserve the existing composition, or null to explicitly restore the legacy cover.",
  write_slide: "Create a slide or replace an existing slide with the same id (send the complete slide). The slide appears in the live preview immediately. Use `after` to position it.",
  delete_slide: "Remove a slide.",
  move_slide: 'Move a slide after another slide id, or to "start".',
  write_chapter: "Create a chapter or replace a whole chapter with the same id. The chapter argument MUST be a JSON object with id, title and text fields; never a string containing JSON or prose. Write the body in the text field using Makeborne book markup. Optional opening:inline puts the heading with the body; opening:page or omission keeps a separate opener. A supplied label is authoritative and suppresses the automatic numeral. Preserve an existing opening choice on edits. It appears in the live preview immediately.",
  edit_chapter: "Replace an exact passage in a chapter's text (old_string must match exactly and be unique unless replace_all). Use for targeted edits, cuts and rewrites inside long chapters.",
  delete_chapter: "Remove a chapter.",
  move_chapter: 'Move a chapter after another chapter id, or to "start".',
  generate_image: "Generate one original image and register it under `name` for use in slides, the cover, chapter openers or figures. The theme's imageStyle is appended automatically so all art is consistent. Never ask for text, letters, logos or watermarks. Slides show an image on cover, closing, image and split layouts, beside statement, points, stats, agenda, quote and section slides (side rail, portrait; statement, quote and section may also be full-bleed), and as a top band over chart, table and diagram slides (landscape); compare, team, pricing and canvas slides do not show a slide image.",
  render_slides: "Full-image decks: generate these slides, each as one finished image in the deck's slide shape that includes its own text, from the deck's art_system, the slide's art {frame, layout, subject, accent, brief} and the slide's exact words. Renders run in parallel; each comes back as an image for you to check with check_slide. A slide whose neighbour has the same layout or frame, or with too much text for an image, is refused.",
  check_slide: "Full-image decks: the text gate for one rendered slide. Read the image yourself and report the words you actually see (transcript), any visual problems (artifacts) and your verdict. Makeborne also compares your transcript with the slide's words. A failed first attempt is regenerated once with your fix; a second failure keeps the slide as an editable live-text slide, so the deck is never wrong.",
  render_pages: "Full-image books: generate these pages (\"cover\" and chapter ids), each as one finished picture that includes its own words (the cover's title, subtitle and author; an opener's label and title; a picture-book spread's text), from the book's art_system, the page's art plan and its exact words. Each comes back as an image for you to check with check_page.",
  check_page: "Full-image books: the text gate for one generated page. Read the image yourself and report the words you actually see (transcript), any visual problems (artifacts) and your verdict. Makeborne compares your transcript with the page's words. A failed first attempt is regenerated once with your fix; a second failure keeps the page typeset, so the book is never wrong.",
  check_image: "Check one generated image before relying on it: report visual problems (garbled pseudo-text, warped hands or faces, plastic or uncanny people, extra limbs, oversaturation, HDR glow, clip-art, random gradients, a subject that does not fit its job) and a verdict. A failed first attempt is regenerated once with your fix; a second failure removes the image and every reference to it, keeping the layout intact.",
  finish: "Call once the document is complete and checked. Give a short, friendly summary (2–4 sentences, no markup) of what you made or changed.",
};

export function docToolDefinitions(kind: "deck" | "book", images: boolean, art = false) {
  return (kind === "deck" ? DECK_TOOLS : BOOK_TOOLS).filter(name => (images || !IMAGE_TOOLS.has(name)) && (art || !ART_TOOLS.has(name))).map(name => {
    const schema = z.toJSONSchema(DocToolInputs[name], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    // Let the provider validate complete JSON arguments. Eager input streaming
    // can emit malformed long chapter strings that the SDK cannot assemble.
    // Completed tool calls still appear individually in the live preview.
    return { name, description: DESCRIPTIONS[name], input_schema: schema as { type: "object"; [key: string]: unknown } };
  });
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** A new document. A new deck records its slide mode (full-image by default; editable text when chosen) and a new
 * book its image plan; documents saved before these options keep editable slides and cover-plus-openers. */
export function emptyDocument(kind: "deck" | "book", title: string, styleId?: string, options: { slideMode?: "image" | "live"; imagePlan?: BookImagePlan; aspect?: DeckAspect; quality?: ArtQuality; pageNumbers?: boolean; shape?: BookShape; bookArt?: boolean } = {}): DocumentSource {
  const theme = defaultTheme(kind, styleId);
  // The client's shape and quality apply to full-image decks; editable decks stay 16:9.
  const format = options.slideMode === "image" ? { ...(options.aspect && options.aspect !== "16:9" ? { aspect: options.aspect } : {}), ...(options.quality ? { quality: options.quality } : {}), ...(options.pageNumbers ? { pageNumbers: true } : {}) } : {};
  return kind === "deck"
    ? { kind: "deck", schemaVersion: 1, title: title.slice(0, 160) || "Untitled presentation", theme, slides: [], assets: [], ...(options.slideMode ? { art: { mode: options.slideMode, system: "", ...format, renders: [] } } : {}) }
    : { kind: "book", schemaVersion: 1, title: title.slice(0, 160) || "Untitled book", cover: {}, theme, chapters: [], assets: [], ...(options.imagePlan ? { imagePlan: options.imagePlan } : {}),
      ...(options.shape && options.shape !== "portrait" ? { shape: options.shape } : {}),
      // Full-image pages (cover, openers, picture-book spreads) when the client's plan has a cover at all.
      ...(options.bookArt && options.imagePlan?.placement !== "none" ? { art: { mode: "image" as const, system: "", ...(options.quality ? { quality: options.quality } : {}), renders: [] } } : {}) };
}

/** Mutable working copy of one document during a builder run. Every operation
 * validates fully and leaves the document unchanged when it fails. */
export class DocumentEditor {
  doc: DocumentSource;
  changed = false;
  /** False when no text-capable image model is enabled: full-image slides cannot be rendered and are drawn as editable slides. */
  artAvailable = true;
  private finishAttempts = 0;
  constructor(doc: DocumentSource) { this.doc = DocumentSourceSchema.parse(structuredClone(doc)); }

  get kind() { return this.doc.kind; }
  /** Starts again from `doc`, as a fresh editor would (an escalated stage restarts from the saved document). */
  restore(doc: DocumentSource) { this.doc = DocumentSourceSchema.parse(structuredClone(doc)); this.changed = false; this.finishAttempts = 0; }
  private commit(next: DocumentSource) {
    const parsed = DocumentSourceSchema.safeParse(next);
    if (!parsed.success) throw new DocToolError(parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" "));
    if (bytes(parsed.data) > DOCUMENT_BYTE_LIMIT) throw new DocToolError("The document is too large. Shorten chapters or remove slides.");
    this.doc = parsed.data;
    this.changed = true;
  }
  private deck() { if (this.doc.kind !== "deck") throw new DocToolError("This tool is only for presentations."); return this.doc; }
  private book() { if (this.doc.kind !== "book") throw new DocToolError("This tool is only for books."); return this.doc; }

  private place<T extends { id: string }>(list: T[], item: T, after: string | undefined) {
    const existing = list.findIndex(entry => entry.id === item.id);
    const next = list.filter(entry => entry.id !== item.id);
    let index: number;
    if (after === undefined) index = existing >= 0 ? existing : next.length;
    else if (after === "start") index = 0;
    else {
      const anchor = next.findIndex(entry => entry.id === after);
      if (anchor < 0) throw new DocToolError(`No item with id "${after}". Existing ids: ${next.map(entry => entry.id).join(", ") || "(none)"}.`);
      index = anchor + 1;
    }
    next.splice(index, 0, item);
    return { list: next, index, replaced: existing >= 0 };
  }
  private moveIn<T extends { id: string }>(list: T[], id: string, after: string) {
    const item = list.find(entry => entry.id === id);
    if (!item) throw new DocToolError(`No item with id "${id}".`);
    if (after === id) throw new DocToolError("An item cannot be moved after itself.");
    return this.place(list, item, after).list;
  }

  setTheme(input: z.infer<typeof DocToolInputs.set_theme>) {
    const motif = input.motif ?? this.doc.theme.motif;
    // Art directions compose slides; books keep their motif-based covers.
    const direction = this.doc.kind === "deck" ? input.direction ?? this.doc.theme.direction : undefined;
    // A full-image deck's editable slides use the pairing mapped from its art system, whatever set_theme names.
    const artFonts = this.doc.kind === "deck" && this.doc.art?.mode === "image" ? this.doc.art.fonts : undefined;
    const theme = { palette: input.palette, fonts: artFonts ?? input.fonts, mood: input.mood ?? this.doc.theme.mood, imageStyle: input.imageStyle ?? this.doc.theme.imageStyle, ...(motif ? { motif } : {}), ...(direction ? { direction } : {}) };
    const issues = themeIssues(theme);
    if (issues.length) throw new DocToolError(`Palette contrast is too low: ${issues.join(" ")} Adjust the colors and call set_theme again.`);
    this.commit({ ...this.doc, theme } as DocumentSource);
    return `Theme set (${input.fonts}${direction ? `, ${direction} direction` : ""}${motif ? `, ${motif} motif` : ""}).`;
  }
  setDeckDetails(input: z.infer<typeof DeckDetails>) {
    const deck = this.deck();
    const mode = input.slide_mode ?? deck.art?.mode;
    const system = input.art_system ?? deck.art?.system ?? "";
    // Editable slides of a full-image deck set their live text in the bundled faces closest to the art system's type.
    const fonts = mode === "image" && system ? artFontsFor(system, deck.theme.fonts) : deck.art?.fonts;
    // Keep the client's shape, quality and furniture; the wordmark changes only when given (null removes it).
    const { fonts: _fonts, wordmark: _wordmark, ...kept } = deck.art ?? { renders: [] };
    void _fonts; void _wordmark;
    const wordmark = input.wordmark === undefined ? deck.art?.wordmark : input.wordmark ?? undefined;
    const art = mode ? { ...kept, mode, system, ...(fonts ? { fonts } : {}), ...(wordmark ? { wordmark } : {}), renders: deck.art?.renders ?? [] } : undefined;
    this.commit({ ...deck, title: input.title, subtitle: input.subtitle, author: input.author, ...(art ? { art } : {}), ...(fonts && mode === "image" ? { theme: { ...deck.theme, fonts } } : {}) });
    return `Presentation details saved.${art?.mode === "image" && !art.system ? " Set art_system (the deck's design system) before rendering slides." : ""}`;
  }
  setBookDetails(input: z.infer<typeof BookDetails>) {
    const book = this.book();
    const imagePlan = input.image_plan ?? book.imagePlan;
    const art = book.art ? { ...book.art, ...(input.art_system ? { system: input.art_system } : {}), ...(input.cover_art ? { cover: input.cover_art } : {}) } : undefined;
    this.commit({ ...book, title: input.title, subtitle: input.subtitle, author: input.author, dedication: input.dedication, ...(imagePlan ? { imagePlan } : {}), ...(art ? { art } : {}),
      cover: { ...(input.cover_image ? { image: input.cover_image } : {}), ...(input.tagline ? { tagline: input.tagline } : {}),
        ...((input.cover_composition === undefined ? book.cover.composition : input.cover_composition) ? { composition: input.cover_composition ?? book.cover.composition } : {}) } });
    return `Book details saved.${input.cover_image && !this.hasImage(input.cover_image) ? ` Generate the image "${input.cover_image}" (portrait) before finishing.` : ""}`;
  }
  writeSlide(input: z.infer<typeof DocToolInputs.write_slide>) {
    const deck = this.deck();
    if (deck.slides.length >= 40 && !deck.slides.some(slide => slide.id === input.slide.id)) throw new DocToolError("A presentation can have at most 40 slides.");
    // Refused before any image is generated for it: a placed image is always shown.
    const support = imageSupport(input.slide as Slide);
    if (!support.ok) throw new DocToolError(`Slide ${input.slide.id}: ${support.message}.`);
    const accent = artAccentIssue(input.slide as Slide);
    if (accent) throw new DocToolError(`Slide ${input.slide.id}: ${accent}.`);
    const { list, index, replaced } = this.place(deck.slides, input.slide as Slide, input.after);
    this.commit({ ...deck, slides: list });
    // A rewritten slide keeps its verified render only while its words are unchanged; a stale render is dropped.
    const render = this.deck().art?.renders.find(entry => entry.slide === input.slide.id);
    if (render && render.verified !== textKey(this.deck().slides[index])) this.dropRender(input.slide.id);
    const composed = composeSlide(this.deck(), this.deck().slides[index], index, list.length).composition;
    return `${replaced ? "Updated" : "Added"} slide ${index + 1} of ${list.length} (${input.slide.layout}${composed && !this.deck().slides[index].composition ? ` as ${composed}` : ""}).${this.slideWarnings(this.deck(), index)}`;
  }
  private slideWarnings(deck: Deck, index: number) {
    const slide = deck.slides[index], notes: string[] = [];
    if (slide.image && !this.hasImage(slide.image)) notes.push(`image "${slide.image}" does not exist yet; generate it before finishing`);
    for (const person of slide.people ?? []) if (person.image && !this.hasImage(person.image)) notes.push(`portrait "${person.image}" does not exist yet; generate it or drop the image field`);
    const rhythm = deckRhythmIssues(deck).find(issue => issue.slides.includes(index));
    if (rhythm) notes.push(rhythm.message);
    if (deck.art?.mode === "image") {
      if (!slide.art) notes.push("add art {frame, brief}: this deck renders every slide as one image");
      const text = artTextIssues(slide);
      if (text.length) notes.push(`too much text for a full-image slide (${text.join("; ")})`);
      const plan = artPlanIssues(deck).find(issue => issue.slides.includes(index));
      if (plan) notes.push(plan.message);
      const placeholders = artPlaceholders(slide);
      if (placeholders.length) notes.push(`a fill-in field (${placeholders.join("; ")}) cannot be baked into an image: omit the unknown value or this slide stays editable text`);
    } else {
      const scene = composeSlide(deck, slide, index, deck.slides.length);
      if (scene.issues.length) notes.push(`text may not fit: ${scene.issues.slice(0, 3).join("; ")}. Tighten the copy`);
    }
    return notes.length ? ` Check: ${notes.join(". ")}.` : "";
  }
  deleteSlide(id: string) {
    const deck = this.deck();
    if (!deck.slides.some(slide => slide.id === id)) throw new DocToolError(`No slide with id "${id}".`);
    this.commit({ ...deck, slides: deck.slides.filter(slide => slide.id !== id), ...(deck.art ? { art: { ...deck.art, renders: deck.art.renders.filter(entry => entry.slide !== id) } } : {}) });
    return `Deleted slide ${id}.`;
  }
  moveSlide(id: string, after: string) {
    const deck = this.deck();
    this.commit({ ...deck, slides: this.moveIn(deck.slides, id, after) });
    return `Moved slide ${id}. Order: ${this.deck().slides.map(slide => slide.id).join(", ")}.`;
  }
  writeChapter(input: z.infer<typeof DocToolInputs.write_chapter>) {
    const book = this.book();
    const { list, index, replaced } = this.place(book.chapters, input.chapter, input.after);
    this.commit({ ...book, chapters: list });
    return `${replaced ? "Rewrote" : "Added"} chapter ${index + 1} of ${list.length} (${wordCount(input.chapter.text)} words).${this.chapterWarnings(this.book(), index)}`;
  }
  private chapterWarnings(book: Book, index: number) {
    const chapter = book.chapters[index], missing = this.chapterImages(chapter).filter(name => !this.hasImage(name));
    return missing.length ? ` Check: image${missing.length > 1 ? "s" : ""} ${missing.map(name => `"${name}"`).join(", ")} not generated yet.` : "";
  }
  private chapterImages(chapter: Book["chapters"][number]) {
    return [...(chapter.image ? [chapter.image] : []), ...parseBookMarkup(chapter.text).flatMap(block => block.type === "figure" ? [block.image] : [])];
  }
  editChapter(input: z.infer<typeof DocToolInputs.edit_chapter>) {
    const book = this.book(), chapter = book.chapters.find(entry => entry.id === input.id);
    if (!chapter) throw new DocToolError(`No chapter with id "${input.id}".`);
    const count = chapter.text.split(input.old_string).length - 1;
    if (!count) throw new DocToolError("old_string was not found in the chapter text. Copy it exactly from the current text, including punctuation.");
    if (count > 1 && !input.replace_all) throw new DocToolError(`old_string appears ${count} times. Include more surrounding text or set replace_all.`);
    const text = input.replace_all ? chapter.text.split(input.old_string).join(input.new_string) : chapter.text.replace(input.old_string, () => input.new_string);
    if (text.length > CHAPTER_TEXT_LIMIT) throw new DocToolError(`A chapter can hold at most ${CHAPTER_TEXT_LIMIT} characters. Split it into two chapters.`);
    this.commit({ ...book, chapters: book.chapters.map(entry => entry.id === chapter.id ? { ...entry, text } : entry) });
    return `Edited chapter ${input.id} (${wordCount(text)} words now).`;
  }
  deleteChapter(id: string) {
    const book = this.book();
    if (!book.chapters.some(chapter => chapter.id === id)) throw new DocToolError(`No chapter with id "${id}".`);
    this.commit({ ...book, chapters: book.chapters.filter(chapter => chapter.id !== id) });
    return `Deleted chapter ${id}.`;
  }
  moveChapter(id: string, after: string) {
    const book = this.book();
    this.commit({ ...book, chapters: this.moveIn(book.chapters, id, after) });
    return `Moved chapter ${id}.`;
  }
  hasImage(name: string) { return this.doc.assets.some(asset => asset.name === name); }
  /** The client's image choices for a full-image deck (from the composer's controls; never from the model). A new
   * shape invalidates every render made in the old one (verifiedArt), so the slides render again. */
  setDeckFormat(format: { aspect?: DeckAspect; quality?: ArtQuality }) {
    const deck = this.deck();
    if (deck.art?.mode !== "image") return false;
    const aspect = format.aspect ?? deck.art.aspect ?? "16:9", quality = format.quality ?? deck.art.quality;
    if (aspect === (deck.art.aspect ?? "16:9") && quality === deck.art.quality) return false;
    const { aspect: _aspect, quality: _quality, ...rest } = deck.art;
    void _aspect; void _quality;
    this.commit({ ...deck, art: { ...rest, ...(aspect !== "16:9" ? { aspect } : {}), ...(quality ? { quality } : {}) } });
    return true;
  }
  /** The client's page shape and image quality for a book (from the composer; never from the model). A new shape
   * invalidates every generated page (verifiedPage) and changes the trim of the whole book. */
  setBookFormat(format: { shape?: BookShape; quality?: ArtQuality }) {
    const book = this.book();
    const shape = format.shape ?? book.shape ?? "portrait", quality = format.quality ?? book.art?.quality;
    if (shape === (book.shape ?? "portrait") && quality === book.art?.quality) return false;
    const { shape: _shape, ...rest } = book;
    void _shape;
    this.commit({ ...rest, ...(shape !== "portrait" ? { shape } : {}), ...(book.art ? { art: { ...book.art, ...(quality ? { quality } : {}) } } : {}) });
    return true;
  }
  /** Full-image books: record one page's text-gate outcome (builder only). */
  recordPageRender(render: NonNullable<Book["art"]>["renders"][number]) {
    const book = this.book();
    if (!book.art) throw new DocToolError("This book does not generate its pages.");
    this.commit({ ...book, art: { ...book.art, renders: [...book.art.renders.filter(entry => entry.target !== render.target), render] } });
  }
  /** Full-image decks: record one slide's text-gate outcome (builder only; the model never writes renders). */
  recordRender(render: ArtRender) {
    const deck = this.deck();
    if (!deck.art) throw new DocToolError("This presentation does not use full-image slides.");
    this.commit({ ...deck, art: { ...deck.art, renders: [...deck.art.renders.filter(entry => entry.slide !== render.slide), render] } });
  }
  private dropRender(id: string) {
    const deck = this.deck();
    if (deck.art) this.commit({ ...deck, art: { ...deck.art, renders: deck.art.renders.filter(entry => entry.slide !== id) } });
  }
  /** Remove an image that failed its check and every reference to it. The layout stays intact: a chapter opener or
   * the cover is set without a picture, a figure line disappears, a slide's rail or band closes up. */
  dropImage(name: string) {
    const assets = this.doc.assets.filter(asset => asset.name !== name);
    if (this.doc.kind === "book") {
      const chapters = this.doc.chapters.map(chapter => {
        const text = chapter.text.split("\n").filter(line => !line.trim().startsWith(`[[figure:${name}|`) && line.trim() !== `[[figure:${name}]]`).join("\n").replace(/\n{3,}/g, "\n\n");
        const { image, ...rest } = chapter;
        return { ...(image === name ? rest : chapter), text };
      });
      const { image, ...cover } = this.doc.cover;
      // A generated page whose image is removed is typeset again.
      const art = this.doc.art ? { ...this.doc.art, renders: this.doc.art.renders.filter(entry => entry.image !== name) } : undefined;
      this.commit({ ...this.doc, assets, chapters, cover: image === name ? cover : this.doc.cover, ...(art ? { art } : {}) } as DocumentSource);
    } else {
      const slides = this.doc.slides.map(slide => {
        if (slide.image !== name || ["split", "image"].includes(slide.layout)) return slide;
        const { image, imagePlacement, ...rest } = slide;
        void image; void imagePlacement;
        return rest as Slide;
      });
      this.commit({ ...this.doc, assets, slides } as DocumentSource);
    }
  }
  addAsset(asset: DocumentAsset) {
    const parsed = AssetSchema.parse(asset);
    this.commit({ ...this.doc, assets: [...this.doc.assets.filter(entry => entry.name !== parsed.name), parsed] } as DocumentSource);
  }
  imagePrompt(prompt: string) {
    const style = this.doc.theme.imageStyle;
    return `${prompt.trim()}${style ? `\n\nArt direction (keep consistent across the whole ${this.kind === "book" ? "book" : "presentation"}): ${style}` : ""}\n\nAvoid the AI look: no oversaturated colour, HDR glow, lens flare, plastic-looking or posed stock people, clip-art, random gradients or bokeh; photographs read as real editorial photography, illustration as one consistent hand.\n\nNo text, letters, numbers, captions, logos or watermarks anywhere in the image.`;
  }

  /** Blocking problems for finish. Layout fit warnings block once; a second
   * finish accepts them so a heuristic can never trap the run. */
  problems(): string[] {
    const issues: string[] = [...themeIssues(this.doc.theme)];
    const fit: string[] = [];
    if (this.doc.kind === "deck") {
      const deck = this.doc;
      if (!deck.slides.length) issues.push("The presentation has no slides yet.");
      deck.slides.forEach((slide, index) => {
        const support = imageSupport(slide);
        if (!support.ok) issues.push(`Slide ${index + 1} (${slide.id}): ${support.message}.`);
        else if (slide.image && !this.hasImage(slide.image)) issues.push(`Slide ${index + 1} (${slide.id}) uses image "${slide.image}", which was not generated. Generate it or change the slide.`);
        for (const person of slide.people ?? []) if (person.image && !this.hasImage(person.image)) issues.push(`Slide ${index + 1} (${slide.id}) uses portrait "${person.image}", which was not generated. Generate it or remove that image field.`);
        const scene = composeSlide(deck, slide, index, deck.slides.length);
        if (scene.issues.length) fit.push(`Slide ${index + 1} (${slide.id}): ${scene.issues[0]}.`);
      });
    } else {
      const book = this.doc;
      if (!book.chapters.length) issues.push("The book has no chapters yet.");
      if (book.cover.image && !this.hasImage(book.cover.image)) issues.push(`The cover uses image "${book.cover.image}", which was not generated.`);
      book.chapters.forEach((chapter, index) => {
        if (!chapter.text.trim()) issues.push(`Chapter ${index + 1} (${chapter.id}) has no text.`);
        for (const name of this.chapterImages(chapter)) if (!this.hasImage(name)) issues.push(`Chapter ${index + 1} (${chapter.id}) uses image "${name}", which was not generated.`);
      });
    }
    // Visual rhythm is advisory like fit: it blocks the first finish only.
    if (this.doc.kind === "deck" && this.doc.art?.mode === "image") {
      const deck = this.doc;
      fit.push(...artPlanIssues(deck).map(issue => `rhythm: ${issue.message}.`));
      deck.slides.forEach((slide, index) => {
        const render = deck.art!.renders.find(entry => entry.slide === slide.id);
        if (this.artAvailable && !verifiedArt(deck, slide) && render?.outcome !== "fallback") fit.push(`Slide ${index + 1} (${slide.id}) has no verified full-image render yet; call render_slides for it (an unrendered slide is shown as an editable text slide).`);
      });
    } else if (this.doc.kind === "deck") fit.push(...deckRhythmIssues(this.doc).map(issue => `${issue.message}.`));
    if (this.doc.kind === "book") {
      const plan = bookImageIssues(this.doc);
      issues.push(...plan.blocking);
      fit.push(...plan.advisory);
      const book = this.doc;
      if (this.artAvailable && book.art?.mode === "image") for (const { target, kind } of pagesWanted(book)) {
        const render = book.art.renders.find(entry => entry.target === target);
        if (!verifiedPage(book, target) && render?.outcome !== "fallback") fit.push(`The ${kind === "cover" ? "cover" : `${kind} of chapter ${target}`} has no verified generated page yet; call render_pages for "${target}" (an ungenerated page is typeset).`);
      }
    }
    // Unfinished fill-in fields block the first finish too: kept only when the user asked to supply them later.
    const unfinished = placeholderIssues(this.doc);
    const first = (unfinished.length > 0 || fit.length > 0) && this.finishAttempts++ === 0;
    if (unfinished.length && first) issues.push(`Unfinished placeholders: ${unfinished.slice(0, 6).join("; ")}. Write the finished content (or omit the field). Keep a clearly marked fill-in field only if the user explicitly asked to supply it later, and say so in your summary.`);
    if (fit.length && first) issues.push(...fit.slice(0, 8).map(message => /rhythm|render|image/.test(message) ? message : `${message} Shorten the copy or choose a roomier layout.`));
    return issues;
  }

  /** Apply one validated tool call. generate_image and finish are handled by the agent. */
  apply(name: string, rawInput: unknown): string {
    if (!(name in DocToolInputs) || AGENT_TOOLS.has(name)) throw new DocToolError(`Unknown tool ${name}.`);
    if (!(this.kind === "deck" ? DECK_TOOLS : BOOK_TOOLS).includes(name as DocToolName)) throw new DocToolError(`${name} is not available for a ${this.kind === "deck" ? "presentation" : "book"}.`);
    const input = DocToolInputs[name as DocToolName].parse(unescapeLiterals(rawInput)) as never;
    switch (name as DocToolName) {
      case "set_theme": return this.setTheme(input);
      case "set_deck_details": return this.setDeckDetails(input);
      case "set_book_details": return this.setBookDetails(input);
      case "write_slide": return this.writeSlide(input);
      case "delete_slide": return this.deleteSlide((input as { id: string }).id);
      case "move_slide": return this.moveSlide((input as { id: string }).id, (input as { after: string }).after);
      case "write_chapter": return this.writeChapter(input);
      case "edit_chapter": return this.editChapter(input);
      case "delete_chapter": return this.deleteChapter((input as { id: string }).id);
      case "move_chapter": return this.moveChapter((input as { id: string }).id, (input as { after: string }).after);
      default: throw new DocToolError(`Unknown tool ${name}.`);
    }
  }

  /** Compact model-facing snapshot of the current document. */
  snapshot() { return JSON.stringify(this.doc); }
}

/** A model sometimes double-escapes a character in tool JSON, leaving a literal "\u00e9" in prose (seen live in a figure
 * caption, 22 Oct 2026). Document text never contains a backslash-u sequence on purpose, so they are decoded. */
export function unescapeLiterals<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) as T;
  if (Array.isArray(value)) return value.map(unescapeLiterals) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unescapeLiterals(item)])) as T;
  return value;
}

/** Bracketed fill-in fields ("[Your name]", "[market size in EUR]", "[x%]") and template instructions ("Replace this with…")
 * in visible deck or book text. Not flagged: checklist boxes ("[ ]", "[x]"), Markdown links ("[text](url)") and book
 * directives ("[[figure:…]]"). Speaker notes are the presenter's own and are not scanned. */
const FILL_IN = /(?<!\[)\[(?!\[)([^\][\n]{1,60})\](?![(\]])/g, TEMPLATE = /\b(?:replace (?:this|with)|lorem ipsum|insert (?:your|the|a)\b)/i;
export function placeholderIssues(doc: DocumentSource): string[] {
  const found: string[] = [];
  const scan = (where: string, value: unknown) => {
    if (typeof value === "string") {
      const text = value.replace(/\[\[[\s\S]*?\]\]/g, match => match.replace(/^\[\[(figure|note|pullquote):/, "").replace(/\]\]$/, ""));
      for (const match of text.matchAll(FILL_IN)) if (!/^\s*[xX✓✔]?\s*$/.test(match[1])) found.push(`${where} "[${match[1]}]"`);
      if (TEMPLATE.test(text)) found.push(`${where} "${(TEMPLATE.exec(text)?.[0] ?? "").slice(0, 40)}…"`);
    } else if (Array.isArray(value)) value.forEach(item => scan(where, item));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) if (!["id", "notes", "image", "variant", "composition", "layout", "tone"].includes(key)) scan(where, item);
  };
  scan("title", [doc.title, doc.subtitle, doc.author]);
  if (doc.kind === "deck") doc.slides.forEach((slide, index) => scan(`slide ${index + 1}`, slide));
  else {
    scan("front matter", [doc.dedication, doc.cover.tagline]);
    doc.chapters.forEach((chapter, index) => scan(`chapter ${index + 1}`, { label: chapter.label, title: chapter.title, epigraph: chapter.epigraph, text: chapter.text }));
  }
  return [...new Set(found)];
}

/** Layouts that are mostly running text; three in a row read as a document, not a deck. */
const TEXT_HEAVY = new Set<Slide["layout"]>(["points", "compare", "split", "table"]);
/** Advisory rhythm checks so decks vary their compositions instead of repeating one template. */
export function deckRhythmIssues(deck: Pick<Deck, "slides"> & Partial<Pick<Deck, "theme">>) {
  const issues: { slides: number[]; message: string }[] = [], slides = deck.slides;
  for (let i = 2; i < slides.length; i++) {
    const run = [slides[i - 2], slides[i - 1], slides[i]];
    if (run.every(slide => slide.layout === run[0].layout) && run[0].layout !== "section") issues.push({ slides: [i - 2, i - 1, i], message: `rhythm: slides ${i - 1}–${i + 1} all use the ${run[0].layout} layout; vary the composition (stats, chart, diagram, quote, team, table, statement)` });
    else if (run.every(slide => TEXT_HEAVY.has(slide.layout))) issues.push({ slides: [i - 2, i - 1, i], message: `rhythm: slides ${i - 1}–${i + 1} are all text-heavy (${run.map(slide => slide.layout).join(", ")}); turn one into a statement, stats, chart, diagram or image slide` });
  }
  if (slides.length >= 8 && (!deck.theme || directionOf(deck.theme).ground === "light") && slides.every(slide => slide.tone === "light")) issues.push({ slides: [0, slides.length - 1], message: "rhythm: every slide is light; set the cover or closing and one key statement, stat or quote to tone dark (or accent) for contrast" });
  const content = slides.filter(slide => !["cover", "closing", "section"].includes(slide.layout));
  if (content.length >= 6) {
    const counts = new Map<string, number>();
    for (const slide of content) counts.set(slide.layout, (counts.get(slide.layout) ?? 0) + 1);
    const [layout, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (count / content.length > 0.5) issues.push({ slides: slides.flatMap((slide, index) => slide.layout === layout ? [index] : []), message: `rhythm: ${count} of ${content.length} content slides use the ${layout} layout; use a wider range of layouts` });
  }
  return issues;
}

export const parseDeck = (value: unknown) => DeckSchema.parse(value);
export const parseBook = (value: unknown) => BookSchema.parse(value);
