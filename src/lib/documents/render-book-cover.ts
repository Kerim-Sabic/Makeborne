import type { Book } from "./schema";
import type { ImageMap } from "./render-deck";
import { bookCoverScene } from "./cover-composition";
import { esc } from "./chart-svg";
import { FONTS } from "./theme";

/** The portrait equivalent of slide primitives. Cover text stays real selectable
 * text in preview/PDF; decorative geometry is authored data, never raw markup. */
export function authoredBookCover(book: Book, images: ImageMap) {
  const scene = bookCoverScene(book), fonts = FONTS[book.theme.fonts];
  if (scene.issues.length) throw new Error(`Invalid authored book cover: ${scene.issues.join(" ")}`);
  const box = (p: { x: number; y: number; w: number; h: number }) => `position:absolute;left:${p.x / 576 * 100}%;top:${p.y / 864 * 100}%;width:${p.w / 576 * 100}%;height:${p.h / 864 * 100}%`;
  const content = scene.prims.map(prim => {
    switch (prim.k) {
      case "rect": return `<div aria-hidden="true" style="${box(prim)};background:${prim.fill};border-radius:${(prim.radius ?? 0) * 0.75}pt"></div>`;
      case "ellipse": return `<div aria-hidden="true" style="${box(prim)};background:${prim.fill};border-radius:50%"></div>`;
      case "line": return `<svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 576 864"><line x1="${prim.x1}" y1="${prim.y1}" x2="${prim.x2}" y2="${prim.y2}" stroke="${prim.color}" stroke-width="${prim.width}" stroke-linecap="round"/></svg>`;
      case "image": return images[prim.name] ? `<img style="${box(prim)};object-fit:cover;object-position:center" src="${esc(images[prim.name]!)}" alt="${esc(prim.alt)}">` : `<div role="img" aria-label="${esc(prim.alt)}" style="${box(prim)};background:${book.theme.palette.surface}"></div>`;
      case "text": {
        const tag = prim.role === "title" ? "h1" : "p";
        return `<${tag} data-cover-text="true" style="${box(prim)};margin:0;font-family:${esc(prim.font === "heading" ? fonts.heading : fonts.body)};font-size:${prim.size * 0.75}pt;line-height:${prim.lh};font-weight:${prim.weight};font-style:${prim.italic ? "italic" : "normal"};color:${prim.color};text-align:${prim.align};white-space:pre-wrap;overflow-wrap:anywhere">${esc(prim.text)}</${tag}>`;
      }
      default: throw new Error("Unsupported authored cover primitive.");
    }
  }).join("");
  return `<section class="full authored-cover" aria-label="${esc(book.title)}" style="background:${scene.background}">${content}</section>`;
}
