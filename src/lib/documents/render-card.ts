import type { Book, Deck } from "./schema";
import { deckHtml, type ImageMap } from "./render-deck";
import { bookHtml } from "./render-book";
import { composeSlide } from "./slide-scene";
import { bookCoverScene } from "./cover-composition";
import { esc } from "./chart-svg";
import { presentationScene } from "../presentations/render-scene";
import { slideBoxPercent } from "../presentations/composition";
import { NATIVE_SLIDE_CSS } from "../presentations/native-css";

/**
 * Library card previews: the same script-free renderers the editor, review
 * copy and PDF printer use, reduced to the first slide, the cover or the top
 * of the page. Every document carries a CSP that forbids scripts, network,
 * forms and navigation, so a card frame can only paint what it was given.
 * Images are data: URLs read with the editor's own authorization, or omitted.
 */
export const CARD_FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CARD_FRAME_CSP}">`;

/** Puts the card CSP first in <head>, ahead of anything the document declares. */
export function withCardCsp(html: string) {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${CSP_META}`) : `<!doctype html><html><head>${CSP_META}</head><body>${html}</body></html>`;
}

/** Native canvas sizes, in CSS pixels, for each card format. */
export const CARD_CANVAS = {
  deck: { width: 1280, height: 720 },
  book: { width: 576, height: 864 },
  website: { width: 1280, height: 800 },
} as const;

/** Image names the opening slide paints; only these are read for a card. */
export function deckCardImages(deck: Deck): string[] {
  if (!deck.slides.length) return [];
  const scene = composeSlide(deck, deck.slides[0], 0, deck.slides.length);
  return [...new Set(scene.prims.flatMap(prim => prim.k === "image" ? [prim.name] : []))];
}

/** The deck's opening slide, composed in the context of the whole deck, on its 1280×720 page. */
export function deckCardHtml(deck: Deck, images: ImageMap) {
  return withCardCsp(deckHtml(deck, images, "print", undefined, 1).replace("</style>", "html,body{overflow:hidden}</style>"));
}

/** Image names the cover paints. */
export function bookCardImages(book: Book): string[] {
  if (book.cover.composition) return [...new Set(bookCoverScene(book).prims.flatMap(prim => prim.k === "image" ? [prim.name] : []))];
  return book.cover.image ? [book.cover.image] : [];
}

/** The book's cover page (6 × 9 in). Chapter text is not needed for a cover and is never sent to a card. */
export function bookCardHtml(book: Book, images: ImageMap) {
  return withCardCsp(bookHtml({ ...book, chapters: [] }, images, "print").replace("</style>", "html,body{overflow:hidden}</style>"));
}

/** Text outline blocks a card may show: bounded, already trimmed by the server. */
export type OutlineCardBlock = { id: string; type: string; text: string; assetId: string | null };
export type OutlineCardSource = {
  kind: "website" | "book" | "presentation";
  title: string;
  palette: { canvas: string; ink: string; accent: string; heading: string; body: string };
  blocks: OutlineCardBlock[];
  /** Presentations: the first slide as the editor groups it. */
  slide?: { title: string; blocks: OutlineCardBlock[]; design?: Parameters<typeof presentationScene>[0]["design"] };
  slideCount?: number;
};

const FONT_STACKS: Record<string, string> = {
  "Source Serif 4": '"Source Serif 4", Georgia, serif', Georgia: "Georgia, serif", Inter: "Inter, Arial, sans-serif", Arial: "Arial, sans-serif",
};
export const outlineFont = (name: string, fallback: string) => FONT_STACKS[name] ?? fallback;
const css = (value: string) => value.replace(/[<>"]/g, "");
const imageOrPlaceholder = (block: OutlineCardBlock, images: ImageMap, className: string) => {
  const src = block.assetId ? images[block.assetId] : undefined;
  return src ? `<img class="${className}" src="${esc(src)}" alt="">` : `<div class="${className} ph" aria-hidden="true">${esc(block.text || "Artwork")}</div>`;
};

/** Outline projects (no designed document yet): the same reading order and theme as the account preview. */
export function outlineCardHtml(source: OutlineCardSource, images: ImageMap) {
  const p = source.palette;
  const vars = `--canvas:${css(p.canvas)};--ink:${css(p.ink)};--accent:${css(p.accent)};--heading:${css(p.heading)};--body:${css(p.body)}`;
  const base = `*{box-sizing:border-box}html,body{margin:0;overflow:hidden}body{${vars};background:var(--canvas);color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
.ph{display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(135deg,rgba(127,127,127,.14) 0 12px,rgba(127,127,127,.05) 12px 24px);color:rgba(80,80,80,.85);font:600 14px/1.3 Arial,sans-serif;text-align:center;padding:16px}`;
  if (source.kind === "presentation" && source.slide) {
    const slide = source.slide, total = Math.max(1, source.slideCount ?? 1);
    const scene = presentationScene(slide, 0, total);
    const elements = scene.elements.map(element => {
      const box = slideBoxPercent(element), position = `left:${box.left};top:${box.top};width:${box.width};height:${box.height}`;
      if (element.kind === "image") {
        const image = slide.blocks.find(block => block.id === element.blockId);
        return image ? `<div class="ap-native-image" style="${position};--native-image-fit:${element.fit}">${imageOrPlaceholder(image, images, "card-img")}</div>` : "";
      }
      const style = `${position};font-size:${element.fontSize / 12.8}cqw;line-height:${element.lineHeight};font-family:${element.font === "heading" ? "var(--native-heading)" : "Arial,sans-serif"};font-weight:${element.weight === "bold" ? 700 : 400};text-align:${element.align}${element.color ? `;color:${css(element.color)}` : ""}`;
      return element.role === "title" ? `<h3 class="ap-native-text ap-native-title" style="${style}">${esc(element.text)}</h3>` : `<p class="ap-native-text ap-native-${element.role}" style="${style}">${esc(element.text)}</p>`;
    }).join("");
    return withCardCsp(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${base}${NATIVE_SLIDE_CSS}.card-img{width:100%;height:100%;object-fit:var(--native-image-fit,contain)}</style></head><body><article class="ap-native-slide" style="--native-paper:${css(scene.background ?? p.canvas)};--native-ink:var(--ink);--native-accent:var(--accent);--native-heading:var(--heading);width:1280px">${elements}</article></body></html>`);
  }
  if (source.kind === "book") {
    const art = source.blocks[0]?.type === "image" ? source.blocks[0] : undefined;
    return withCardCsp(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${base}
.cover{width:576px;height:864px;padding:62px;display:flex;flex-direction:column;justify-content:space-between;gap:30px}
.rule{display:block;height:4px;width:58px;background:var(--accent)}h2{font-family:var(--heading);font-weight:500;font-size:46px;line-height:1.1;margin:0;overflow-wrap:anywhere}
.art{flex:1;min-height:0;width:100%;object-fit:contain}</style></head><body><section class="cover"><span class="rule"></span><h2>${esc(source.title)}</h2>${art ? imageOrPlaceholder(art, images, "art") : ""}<span class="rule"></span></section></body></html>`);
  }
  const body = source.blocks.map(block => {
    if (block.type === "image" || block.assetId) return imageOrPlaceholder(block, images, "figure");
    if (block.type === "heading") return `<h3>${esc(block.text)}</h3>`;
    if (block.type === "quote") return `<blockquote>${esc(block.text)}</blockquote>`;
    return `<p>${esc(block.text)}</p>`;
  }).join("");
  return withCardCsp(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${base}
header{display:flex;align-items:center;justify-content:space-between;padding:28px 64px;border-bottom:1px solid rgba(0,0,0,.08);font:600 22px/1.2 var(--heading)}header span{width:12px;height:12px;border-radius:50%;background:var(--accent)}
main{padding:56px 64px;max-width:980px}h3{font:500 52px/1.1 var(--heading);margin:0 0 24px;overflow-wrap:anywhere}p,blockquote{font-size:22px;line-height:1.6;margin:0 0 20px;white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:4px solid var(--accent);padding-left:20px}
.figure{display:block;width:100%;max-height:420px;object-fit:cover;margin:0 0 24px;border-radius:8px}.figure.ph{height:260px}</style></head><body><header>${esc(source.title)}<span></span></header><main>${body || `<p>Add content to begin shaping your ${source.kind}.</p>`}</main></body></html>`);
}
