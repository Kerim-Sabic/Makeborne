import type { Book, BookImagePlan } from "./schema";
import { parseBookMarkup, wordCount } from "./book-markup";
import { WORDS_PER_TEXT_PAGE } from "./book-pagination";

/** Book illustration the client controls (owner, Kerim, 22 Oct 2026: "in books image gen is important u can ask user
 * how many images and how often to put them"). The plan is chosen when the book is created (creation-options.ts) and
 * stored on the book; a book without one keeps the earlier behaviour, a cover and an opener per chapter. */
export const DEFAULT_BOOK_IMAGE_PLAN: BookImagePlan = { placement: "openers", style: "auto" };
export const bookPlan = (book: Pick<Book, "imagePlan">): BookImagePlan => book.imagePlan ?? DEFAULT_BOOK_IMAGE_PLAN;

export type PlannedImages = { cover: number; openers: number; figures: number; total: number; textPages: number };
/** How many images the plan asks for in the book as written so far: a cover, an opener per chapter that opens on its
 * own page, and figures spread through the text (one about every N text pages, or about one per spread). */
export function plannedBookImages(book: Pick<Book, "imagePlan" | "chapters">): PlannedImages {
  const plan = bookPlan(book);
  const textPages = Math.round(book.chapters.reduce((sum, chapter) => sum + wordCount(chapter.text), 0) / WORDS_PER_TEXT_PAGE);
  const pageOpeners = book.chapters.filter(chapter => chapter.opening !== "inline").length;
  const cover = plan.placement === "none" ? 0 : 1;
  // A picture book: every chapter is one illustrated spread with its words on the art (counted as its opener).
  const openers = plan.placement === "none" || plan.placement === "cover" ? 0 : plan.placement === "picture" ? book.chapters.length : pageOpeners;
  const figures = plan.placement === "every" ? Math.floor(textPages / (plan.everyPages ?? 6)) : plan.placement === "rich" ? Math.floor(textPages / 2) : 0;
  return { cover, openers, figures, total: cover + openers + figures, textPages };
}

const STYLE_WORDS: Record<BookImagePlan["style"], string> = {
  photo: "photography: one consistent photographic language (lens, light, colour grade) across the whole book",
  illustration: "illustration: one consistent drawn style across the whole book",
  technique: "one hand-made technique across the whole book",
  auto: "your choice of one consistent technique that suits the book (photography or one illustration style), kept identical across the whole book",
};
/** The plan in words for the book designer, with what it means for this book so far. */
export function bookImagePlanText(book: Pick<Book, "imagePlan" | "chapters">) {
  const plan = bookPlan(book), planned = plannedBookImages(book);
  const where = plan.placement === "none" ? "No images at all: no cover image, no openers, no figures. Do not call generate_image."
    : plan.placement === "cover" ? "A cover image only: no chapter openers or figures."
    : plan.placement === "openers" ? "A cover image and a landscape opener image for every chapter that opens on its own page; no figures in the text."
    : plan.placement === "every" ? `A cover, an opener for every chapter that opens on its own page, and inside the text one figure about every ${plan.everyPages ?? 6} pages (about one per ${(plan.everyPages ?? 6) * WORDS_PER_TEXT_PAGE} words), placed where it helps.`
    : plan.placement === "picture" ? "A picture book: a cover, and every chapter is ONE double-page spread whose few words (at most 45) are set on the illustration; keep each chapter's text to those words, no subheadings, lists or figures."
    : "Richly illustrated: a cover, an opener for every chapter that opens on its own page, and about one figure per spread (one per two text pages, about one per 460 words).";
  const style = `${STYLE_WORDS[plan.style]}${plan.technique ? `: ${plan.technique}` : ""}`;
  const counts = book.chapters.length ? ` For the book as written so far that is about ${planned.total} image${planned.total === 1 ? "" : "s"} (${planned.cover} cover, ${planned.openers} opener${planned.openers === 1 ? "" : "s"}, ${planned.figures} figure${planned.figures === 1 ? "" : "s"}).` : "";
  return `IMAGE PLAN (the client chose this; follow it exactly): ${where} Style: ${style}.${counts}`;
}

/** Plan adherence. Blocking: images the client did not want. Advisory (first finish only): too few planned figures. */
export function bookImageIssues(book: Book): { blocking: string[]; advisory: string[] } {
  const plan = bookPlan(book), blocking: string[] = [], advisory: string[] = [];
  const figures = book.chapters.flatMap((chapter, index) => parseBookMarkup(chapter.text).flatMap(block => block.type === "figure" ? [{ index, image: block.image, caption: block.caption }] : []));
  const openers = book.chapters.filter(chapter => chapter.image).length;
  if (plan.placement === "none" && (book.cover.image || openers || figures.length)) blocking.push("The client asked for no images: remove the cover image, chapter opener images and figures.");
  if (plan.placement === "cover" && (openers || figures.length)) blocking.push("The client asked for a cover image only: remove chapter opener images and figures.");
  if ((plan.placement === "openers" || plan.placement === "picture") && figures.length) blocking.push(plan.placement === "picture" ? "A picture book's chapters are spreads with their words on the art: remove the figures from the text." : "The client asked for a cover and chapter openers only: remove the figures from the text.");
  if (plan.placement === "every" || plan.placement === "rich") {
    const planned = plannedBookImages(book).figures;
    if (planned >= 2 && figures.length < Math.ceil(planned * 0.6)) advisory.push(`The image plan asks for about ${planned} figures in the text and the book has ${figures.length}. Add figures where they genuinely help the reader (an explanatory drawing, a step, a place), each with a short honest caption, or say in your summary why fewer fit.`);
    const uncaptioned = figures.filter(figure => !figure.caption?.trim()).length;
    if (uncaptioned) advisory.push(`${uncaptioned} figure${uncaptioned === 1 ? " has" : "s have"} no caption. Give every explanatory figure a short caption that says what it shows.`);
  }
  return { blocking, advisory };
}
