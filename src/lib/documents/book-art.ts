import type { Book, BookPageKind, BookShape } from "./schema";
import { parseBookMarkup, plainText } from "./book-markup";
import { BOOK_SHAPE_SPECS } from "./art-formats";
import { AVOID_AI_LOOK, TYPE_STYLE, accentInText, article, capital, displayLines, quotedLines, swatch, tailBook } from "./art-direction";
import { placeholderIn, type ArtCanvas, type ArtLine } from "./slide-art";

/**
 * Full-image book pages (owner, Kerim, 26 Oct 2026: books should turn out like the reference covers r_fungi, r_soup and
 * r_cat, and picture-book spreads like r_whale). In a book whose art mode is "image", the cover and every chapter opener
 * (and, in a picture book, every chapter as one double-page spread) are generated as one picture that carries its own
 * words. The book's fields stay the source of truth: the words a page must show (pageText), a render verified against
 * them (pageTextKey), shown only while they are unchanged and the page shape is the same (verifiedPage). Any page
 * without a verified render is typeset exactly as before, so a book is never shown with wrong words.
 */

export const bookShape = (book: Pick<Book, "shape">): BookShape => book.shape ?? "portrait";
export const isPictureBook = (book: Pick<Book, "imagePlan">) => book.imagePlan?.placement === "picture";
/** Words on a spread at most (a picture book's page of text), on a cover title and on an opener title. */
export const SPREAD_WORDS = 45, COVER_TITLE_WORDS = 12;
const words = (value: string) => value.trim() ? value.trim().split(/\s+/).length : 0;

/** What kind of generated page a target is in this book, or null when it has none (an inline chapter, a plan without it). */
export function pageKind(book: Book, target: string): BookPageKind | null {
  if (book.art?.mode !== "image") return null;
  const placement = book.imagePlan?.placement ?? "openers";
  if (target === "cover") return placement === "none" ? null : "cover";
  const chapter = book.chapters.find(entry => entry.id === target);
  if (!chapter) return null;
  if (isPictureBook(book)) return "spread";
  if (placement === "none" || placement === "cover" || chapter.opening === "inline") return null;
  return "opener";
}
/** Every page the book should generate, in reading order. */
export function pagesWanted(book: Book): { target: string; kind: BookPageKind }[] {
  return ["cover", ...book.chapters.map(chapter => chapter.id)].flatMap(target => { const kind = pageKind(book, target); return kind ? [{ target, kind }] : []; });
}

/** Budget-deferred pages remain resumable; an explicitly checked fallback is terminal. */
export function pendingBookPages(book: Book): string[] {
  return pagesWanted(book).filter(({ target }) => !verifiedPage(book, target)
    && !book.art?.renders.some(render => render.target === target && render.outcome === "fallback"
      && render.verified === pageTextKey(book, target) && (render.shape ?? "portrait") === bookShape(book))).map(page => page.target);
}

/** The chapter label as the opener shows it (chapterLabel without importing the renderer). */
function label(book: Book, index: number) {
  const ordinal = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
  const n = book.chapters.slice(0, index + 1).filter(chapter => chapter.label === undefined).length;
  return book.chapters[index].label ?? `Chapter ${ordinal[n - 1] ?? n}`;
}
/** A picture-book spread's words: the chapter's paragraphs as plain lines (markup removed). */
export function spreadLines(text: string) {
  return parseBookMarkup(text).flatMap(block => block.type === "paragraph" ? [plainText(block.text).replace(/\s+/g, " ").trim()] : []).filter(Boolean);
}
/** Every word a generated page shows, in reading order. */
export function pageText(book: Book, target: string): ArtLine[] {
  const out: ArtLine[] = [];
  const add = (role: string, text?: string) => { if (text?.trim()) out.push({ role, text: plainText(text.trim()) }); };
  if (target === "cover") {
    add("small line above the title", book.cover.tagline); add("title (largest type)", book.title); add("subtitle", book.subtitle); add("author", book.author);
    return out;
  }
  const index = book.chapters.findIndex(chapter => chapter.id === target);
  if (index < 0) return out;
  const chapter = book.chapters[index];
  if (isPictureBook(book)) { spreadLines(chapter.text).forEach((line, i) => add(`story text ${i + 1}`, line)); return out; }
  add("chapter label (small)", label(book, index)); add("chapter title (large)", chapter.title);
  return out;
}
/** A stable key of a page's words and shape: a render is shown only while both are what was verified. */
export function pageTextKey(book: Book, target: string) {
  let hash = 0x811c9dc5;
  const text = `${bookShape(book)}␞${pageText(book, target).map(line => line.text).join("␞")}`;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `p1-${hash.toString(16).padStart(8, "0")}-${text.length}`;
}
/** Why a page cannot be generated as one image (too many words, a fill-in field, no plan); [] when it can. */
export function pageArtIssues(book: Book, target: string): string[] {
  const kind = pageKind(book, target), lines = pageText(book, target), issues: string[] = [];
  if (!kind) return ["this page is not generated in this book"];
  if (target !== "cover" && !book.chapters.find(chapter => chapter.id === target)?.art) issues.push("it has no art plan: rewrite the chapter with art {layout, subject, accent, brief}");
  if (target === "cover" && !book.art?.cover) issues.push("the cover has no art plan: set cover_art with set_book_details");
  const title = lines.find(line => line.role.startsWith("title") || line.role.startsWith("chapter title"));
  if (title && words(title.text) > COVER_TITLE_WORDS) issues.push(`the title has ${words(title.text)} words (at most ${COVER_TITLE_WORDS} on a generated page)`);
  if (kind === "spread") {
    const count = lines.reduce((sum, line) => sum + words(line.text), 0);
    if (count > SPREAD_WORDS) issues.push(`the spread has ${count} words (a picture-book spread sets at most ${SPREAD_WORDS}; split the chapter or shorten it)`);
    if (!count) issues.push("the spread has no words yet");
  }
  const placeholders = lines.flatMap(line => { const match = placeholderIn(line.text); return match ? [`${line.role}: "${match}"`] : []; });
  if (placeholders.length) issues.push(`a fill-in field (${placeholders.join("; ")}) cannot be baked into an image`);
  const accent = target === "cover" ? book.art?.cover?.accent : book.chapters.find(chapter => chapter.id === target)?.art?.accent;
  if (accent && !lines.some(line => accentInText(accent, line.text))) issues.push(`the accent "${accent}" is not in the page's words`);
  return issues;
}

/** The asset to show as this whole page (or spread), or null to typeset it. */
export function verifiedPage(book: Book, target: string): string | null {
  if (!pageKind(book, target)) return null;
  const render = book.art?.renders.find(entry => entry.target === target);
  if (!render || render.outcome !== "passed" || !render.image || render.verified !== pageTextKey(book, target)) return null;
  if ((render.shape ?? "portrait") !== bookShape(book)) return null;
  return book.assets.some(asset => asset.name === render.image) ? render.image : null;
}

const q = (text: string) => `"${text.replace(/"/g, "'")}"`;
const sentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const DEFAULT_LAYOUT: Record<BookPageKind, string> = {
  cover: "The illustration or photograph fills the whole cover edge to edge; the title sits large across the calmest area, the top third, with the author small at the bottom",
  opener: "Top 62%: the illustration or photograph full-bleed to the top and side edges; bottom 38%: the chapter heading on the ground colour with generous space",
  spread: "One wide illustration across both pages; the words sit on the calmest area of the left page, within its middle 80%, and never cross the centre gutter",
};

/** The image prompt for one generated page, in the reference pattern (one precise paragraph, then TAIL_BOOK). */
export function bookArtPrompt(book: Book, target: string, canvas: ArtCanvas, fix?: string) {
  const kind = pageKind(book, target) ?? "cover", shape = BOOK_SHAPE_SPECS[bookShape(book)];
  const { palette, fonts, imageStyle } = book.theme, style = TYPE_STYLE[fonts];
  const chapter = book.chapters.find(entry => entry.id === target);
  const plan = target === "cover" ? book.art?.cover : chapter?.art;
  const lines = pageText(book, target);
  const accent = plan?.accent;
  const accentClause = (text: string) => accent && accentInText(accent, text) ? ` with ${q(accent)} in ${swatch(palette.accent)}${style.italicAccent ? " italic" : ""}` : "";
  const technique = book.imagePlan?.technique ? ` ${book.imagePlan.technique}.` : "";
  const shapeWords = kind === "spread" ? `${shape.words} double-page spread (two ${shape.trim.width} x ${shape.trim.height} in pages side by side)` : shape.words;
  let opening: string, copy: string;
  if (kind === "cover") {
    const title = lines.find(line => line.role.startsWith("title"))!;
    opening = `The ${shape.words} front cover of a book titled ${q(book.title)}${book.subtitle ? ` with a smaller subtitle ${q(book.subtitle)}` : ""}`;
    copy = [
      ...lines.filter(line => line.role.startsWith("small line")).map(line => `a small line ${q(line.text)} above the title`),
      `the title ${quotedLines(title.text, displayLines(title.text, 3))} set large in ${article(style.heading)}${accentClause(title.text)}`,
      ...lines.filter(line => line.role === "subtitle").map(line => `the subtitle ${q(line.text)} smaller beneath it`),
      ...lines.filter(line => line.role === "author").map(line => `the author's name ${q(line.text)} small`),
    ].join("; ");
  } else if (kind === "opener") {
    const title = lines.find(line => line.role.startsWith("chapter title"))!, small = lines.find(line => line.role.startsWith("chapter label"));
    opening = `A chapter opening page of the book ${q(book.title)}`;
    copy = [small ? `a small label ${q(small.text)}` : "", `the chapter title ${quotedLines(title.text, displayLines(title.text, 4))} in ${article(style.heading)}${accentClause(title.text)}`].filter(Boolean).join("; ");
  } else {
    opening = `A double-page spread from the picture book ${q(book.title)}, shown flat as one wide image with a very subtle centre gutter`;
    copy = `the words in a friendly, very legible ${style.body.replace(/^clean |^crisp |^precise /, "")} on the page, each line as written: ${lines.map(line => q(line.text)).join(" / ")}`;
  }
  const paragraph = [
    `${opening}: ${swatch(palette.background)} ground, ${swatch(palette.ink)} text, ${swatch(palette.accent)} accent.`,
    sentence(plan?.layout ?? DEFAULT_LAYOUT[kind]),
    sentence(capital(copy)),
    plan?.subject ? sentence(`The art: ${plan.subject}`) : "",
    plan?.brief ? sentence(plan.brief) : "",
  ].filter(Boolean).join(" ");
  const [cw, ch] = canvas.size.split("x").map(Number);
  const y = Math.round(canvas.crop.top / ch * 1000) / 10, x = Math.round(canvas.crop.left / cw * 1000) / 10;
  const margins = (y || x ? `The ${y ? `top ${y}% and bottom ${y}%` : `left ${x}% and right ${x}%`} of the canvas are cropped away to make the page: keep every word inside the rest. ` : "")
    + `Keep every word at least 7% from the page's edges${kind === "spread" ? " and at least 8% from the centre gutter" : ""}. Render exactly the quoted words, each once, letter for letter, and no other words, letters or numbers anywhere: no publisher logo, barcode, price, signature or lorem ipsum.`;
  return [
    paragraph,
    `Book design system (the same on every generated page): ${book.art?.system || imageStyle || "one consistent illustration hand"}${imageStyle ? ` Imagery: ${imageStyle}.` : ""}${technique}`,
    margins,
    AVOID_AI_LOOK,
    tailBook(shapeWords),
    fix ? `CORRECTION — the previous attempt of this page had these problems; fix them: ${fix}` : "",
  ].filter(Boolean).join("\n\n");
}
/** Alt text of a generated page: its words in reading order. */
export const pageAlt = (book: Book, target: string) => pageText(book, target).map(line => line.text).join(". ").replace(/([.!?…])\./g, "$1").slice(0, 1500);
