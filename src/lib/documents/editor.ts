import { z } from "zod";
import {
  AssetSchema, BookSchema, ChapterSchema, CHAPTER_TEXT_LIMIT, DeckSchema, DOCUMENT_BYTE_LIMIT, DocumentSourceSchema, ImageName, ItemId, SlideSchema, ThemeSchema,
  type Book, type Deck, type DocumentAsset, type DocumentSource, type Slide,
} from "./schema";
import { defaultTheme, themeIssues } from "./theme";
import { composeSlide } from "./slide-scene";
import { parseBookMarkup, wordCount } from "./book-markup";

export class DocToolError extends Error {}

const position = z.string().max(48).optional().describe('Insert after this id, or "start". Omit to keep an existing item in place or append a new one.');
const DeckDetails = z.object({ title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(220).optional(), author: z.string().trim().max(120).optional() }).strict();
const BookDetails = z.object({
  title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(220).optional(), author: z.string().trim().max(120).optional(),
  dedication: z.string().trim().max(400).optional(), cover_image: ImageName.optional(), tagline: z.string().trim().max(160).optional(),
}).strict();

/** Tool inputs validated before any change is applied. */
export const DocToolInputs = {
  set_theme: ThemeSchema.extend({ mood: z.string().trim().max(300).optional(), imageStyle: z.string().trim().max(600).optional().describe("Omit to keep the current image style") }).strict(),
  set_deck_details: DeckDetails,
  set_book_details: BookDetails,
  write_slide: z.object({ slide: SlideSchema, after: position }).strict(),
  delete_slide: z.object({ id: ItemId }).strict(),
  move_slide: z.object({ id: ItemId, after: z.string().max(48) }).strict(),
  write_chapter: z.object({ chapter: ChapterSchema, after: position }).strict(),
  edit_chapter: z.object({ id: ItemId, old_string: z.string().min(1).max(CHAPTER_TEXT_LIMIT), new_string: z.string().max(CHAPTER_TEXT_LIMIT), replace_all: z.boolean().optional() }).strict(),
  delete_chapter: z.object({ id: ItemId }).strict(),
  move_chapter: z.object({ id: ItemId, after: z.string().max(48) }).strict(),
  generate_image: z.object({ name: ImageName, prompt: z.string().min(20).max(3000), aspect: z.enum(["landscape", "portrait", "square"]), alt: z.string().trim().min(3).max(300) }).strict(),
  finish: z.object({ summary: z.string().trim().min(1).max(2000) }).strict(),
} as const;
export type DocToolName = keyof typeof DocToolInputs;

export const DECK_TOOLS: DocToolName[] = ["set_theme", "set_deck_details", "write_slide", "delete_slide", "move_slide", "generate_image", "finish"];
export const BOOK_TOOLS: DocToolName[] = ["set_theme", "set_book_details", "write_chapter", "edit_chapter", "delete_chapter", "move_chapter", "generate_image", "finish"];

const DESCRIPTIONS: Record<DocToolName, string> = {
  set_theme: "Set the visual theme: a 7-color palette (contrast is checked), a font pairing, the mood, and one image style that every generated image will share. Call it first on a new document and whenever the user asks for a different look.",
  set_deck_details: "Set the presentation title (shown in slide footers), subtitle and presenter/author.",
  set_book_details: "Set the book title, subtitle, author, dedication, the cover image name and an optional cover tagline.",
  write_slide: "Create a slide or replace an existing slide with the same id (send the complete slide). The slide appears in the live preview immediately. Use `after` to position it.",
  delete_slide: "Remove a slide.",
  move_slide: 'Move a slide after another slide id, or to "start".',
  write_chapter: "Create a chapter or replace a whole chapter with the same id. Write the body in Makeborne book markup. It appears in the live preview immediately.",
  edit_chapter: "Replace an exact passage in a chapter's text (old_string must match exactly and be unique unless replace_all). Use for targeted edits, cuts and rewrites inside long chapters.",
  delete_chapter: "Remove a chapter.",
  move_chapter: 'Move a chapter after another chapter id, or to "start".',
  generate_image: "Generate one original image and register it under `name` for use in slides, the cover, chapter openers or figures. The theme's imageStyle is appended automatically so all art is consistent. Never ask for text, letters, logos or watermarks.",
  finish: "Call once the document is complete and checked. Give a short, friendly summary (2–4 sentences, no markup) of what you made or changed.",
};

export function docToolDefinitions(kind: "deck" | "book", images: boolean) {
  return (kind === "deck" ? DECK_TOOLS : BOOK_TOOLS).filter(name => images || name !== "generate_image").map(name => {
    const schema = z.toJSONSchema(DocToolInputs[name], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description: DESCRIPTIONS[name], input_schema: schema as { type: "object"; [key: string]: unknown },
      ...(["write_slide", "write_chapter", "edit_chapter"].includes(name) ? { eager_input_streaming: true } : {}) };
  });
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function emptyDocument(kind: "deck" | "book", title: string, styleId?: string): DocumentSource {
  const theme = defaultTheme(kind, styleId);
  return kind === "deck"
    ? { kind: "deck", schemaVersion: 1, title: title.slice(0, 160) || "Untitled presentation", theme, slides: [], assets: [] }
    : { kind: "book", schemaVersion: 1, title: title.slice(0, 160) || "Untitled book", cover: {}, theme, chapters: [], assets: [] };
}

/** Mutable working copy of one document during a builder run. Every operation
 * validates fully and leaves the document unchanged when it fails. */
export class DocumentEditor {
  doc: DocumentSource;
  changed = false;
  private finishAttempts = 0;
  constructor(doc: DocumentSource) { this.doc = DocumentSourceSchema.parse(structuredClone(doc)); }

  get kind() { return this.doc.kind; }
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
    const theme = { palette: input.palette, fonts: input.fonts, mood: input.mood ?? this.doc.theme.mood, imageStyle: input.imageStyle ?? this.doc.theme.imageStyle };
    const issues = themeIssues(theme);
    if (issues.length) throw new DocToolError(`Palette contrast is too low: ${issues.join(" ")} Adjust the colors and call set_theme again.`);
    this.commit({ ...this.doc, theme } as DocumentSource);
    return `Theme set (${input.fonts}).`;
  }
  setDeckDetails(input: z.infer<typeof DeckDetails>) {
    const deck = this.deck();
    this.commit({ ...deck, title: input.title, subtitle: input.subtitle, author: input.author });
    return "Presentation details saved.";
  }
  setBookDetails(input: z.infer<typeof BookDetails>) {
    const book = this.book();
    this.commit({ ...book, title: input.title, subtitle: input.subtitle, author: input.author, dedication: input.dedication,
      cover: { ...(input.cover_image ? { image: input.cover_image } : {}), ...(input.tagline ? { tagline: input.tagline } : {}) } });
    return `Book details saved.${input.cover_image && !this.hasImage(input.cover_image) ? ` Generate the image "${input.cover_image}" (portrait) before finishing.` : ""}`;
  }
  writeSlide(input: z.infer<typeof DocToolInputs.write_slide>) {
    const deck = this.deck();
    if (deck.slides.length >= 40 && !deck.slides.some(slide => slide.id === input.slide.id)) throw new DocToolError("A presentation can have at most 40 slides.");
    const { list, index, replaced } = this.place(deck.slides, input.slide as Slide, input.after);
    this.commit({ ...deck, slides: list });
    return `${replaced ? "Updated" : "Added"} slide ${index + 1} of ${list.length} (${input.slide.layout}).${this.slideWarnings(this.deck(), index)}`;
  }
  private slideWarnings(deck: Deck, index: number) {
    const slide = deck.slides[index], notes: string[] = [];
    if (slide.image && !this.hasImage(slide.image)) notes.push(`image "${slide.image}" does not exist yet; generate it before finishing`);
    const scene = composeSlide(deck, slide, index, deck.slides.length);
    if (scene.issues.length) notes.push(`text may not fit: ${scene.issues.slice(0, 3).join("; ")}. Tighten the copy`);
    return notes.length ? ` Check: ${notes.join(". ")}.` : "";
  }
  deleteSlide(id: string) {
    const deck = this.deck();
    if (!deck.slides.some(slide => slide.id === id)) throw new DocToolError(`No slide with id "${id}".`);
    this.commit({ ...deck, slides: deck.slides.filter(slide => slide.id !== id) });
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
  addAsset(asset: DocumentAsset) {
    const parsed = AssetSchema.parse(asset);
    this.commit({ ...this.doc, assets: [...this.doc.assets.filter(entry => entry.name !== parsed.name), parsed] } as DocumentSource);
  }
  imagePrompt(prompt: string) {
    const style = this.doc.theme.imageStyle;
    return `${prompt.trim()}${style ? `\n\nArt direction (keep consistent across the whole ${this.kind === "book" ? "book" : "presentation"}): ${style}` : ""}\n\nNo text, letters, numbers, captions, logos or watermarks anywhere in the image.`;
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
        if (slide.image && !this.hasImage(slide.image)) issues.push(`Slide ${index + 1} (${slide.id}) uses image "${slide.image}", which was not generated. Generate it or change the slide.`);
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
    if (fit.length && this.finishAttempts++ === 0) issues.push(...fit.slice(0, 8).map(message => `${message} Shorten the copy or choose a roomier layout.`));
    return issues;
  }

  /** Apply one validated tool call. generate_image and finish are handled by the agent. */
  apply(name: string, rawInput: unknown): string {
    if (!(name in DocToolInputs) || name === "generate_image" || name === "finish") throw new DocToolError(`Unknown tool ${name}.`);
    if (!(this.kind === "deck" ? DECK_TOOLS : BOOK_TOOLS).includes(name as DocToolName)) throw new DocToolError(`${name} is not available for a ${this.kind === "deck" ? "presentation" : "book"}.`);
    const input = DocToolInputs[name as DocToolName].parse(rawInput) as never;
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

export const parseDeck = (value: unknown) => DeckSchema.parse(value);
export const parseBook = (value: unknown) => BookSchema.parse(value);
