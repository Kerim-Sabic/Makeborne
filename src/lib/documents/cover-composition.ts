import { CoverCompositionSchema, type CoverComposition } from "./composition-schema";
import type { Book, DocumentAsset, Slide, Theme } from "./schema";
import type { Prim, SlideScene } from "./slide-scene";
import { contrast } from "./theme";
import { plainText } from "./book-markup";

type Box = { x: number; y: number; w: number; h: number };
type Content = Partial<Record<"title" | "subtitle" | "eyebrow" | "body" | "author", string>>;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const contains = (a: Box, b: Box) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const glyphEm = (char: string) => char === "\t" ? 3.2 : /\s/.test(char) ? 0.4 : /[MWmw@%&]/.test(char) ? 1.2 : /[A-Z]/.test(char) ? 0.95 : /[a-z0-9]/.test(char) ? 0.78 : /[.,:;!'`|]/.test(char) ? 0.5 : 1.2;
const linesAt = (text: string, w: number, size: number, emphasis: number) => {
  const advance = (char: string) => glyphEm(char) * size * emphasis;
  return text.split("\n").reduce((total, paragraph) => {
    let lines = 1, used = 0;
    // Preserve internal whitespace because HTML and PowerPoint preserve it too.
    // Use conservative individual glyph widths: an average permits long runs
    // of W/CJK characters to pass validation and overflow in the real browser.
    for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
      const chars = [...token], tokenWidth = chars.reduce((sum, char) => sum + advance(char), 0);
      if (!/^\s/.test(token) && used && used + tokenWidth > w) { lines++; used = 0; }
      for (const char of chars) {
        const width = advance(char);
        if (used && used + width > w) { lines++; used = 0; }
        used += width;
      }
    }
    return total + lines;
  }, 0);
};

/** Authored geometry becomes the existing editable primitive vocabulary. Marks
 * and image frames sit behind text; no executable or arbitrary vector markup. */
export function composeCover(composition: CoverComposition, theme: Theme, content: Content, width: number, height: number, image?: { name: string; alt: string }): SlideScene {
  const spec = CoverCompositionSchema.parse(composition), p = theme.palette;
  const short = Math.min(width, height), scale = (value: number) => value * short / 100;
  const box = (value: Box) => ({ x: value.x * width / 100, y: value.y * height / 100, w: value.w * width / 100, h: value.h * height / 100 });
  const prims: Prim[] = [], issues: string[] = [];
  const marks = spec.elements.filter(element => element.type !== "text");
  for (const element of marks) {
    if (element.type === "rect") prims.push({ k: "rect", ...box(element), fill: p[element.fill], radius: scale(element.radius) });
    else if (element.type === "ellipse") prims.push({ k: "ellipse", ...box(element), fill: p[element.fill] });
    else if (element.type === "line") prims.push({ k: "line", x1: element.x1 * width / 100, y1: element.y1 * height / 100, x2: element.x2 * width / 100, y2: element.y2 * height / 100, color: p[element.color], width: scale(element.width) });
    else if (image) prims.push({ k: "image", ...box(element), name: image.name, alt: image.alt, crop: "center" });
    else issues.push("The authored image frame needs a registered cover or slide image.");
  }
  for (const element of spec.elements) {
    if (element.type !== "text") continue;
    const value = content[element.role]?.trim();
    if (!value) { issues.push(`The authored ${element.role} role has no text. Supply that field or remove its box.`); continue; }
    let background = p[spec.background];
    for (const mark of marks) {
      const frame = mark.type === "line" ? { x: Math.min(mark.x1, mark.x2) - mark.width / 2, y: Math.min(mark.y1, mark.y2) - mark.width / 2, w: Math.abs(mark.x2 - mark.x1) + mark.width, h: Math.abs(mark.y2 - mark.y1) + mark.width } : mark;
      if (!overlaps(frame, element)) continue;
      if (mark.type === "rect" && contains({ x: mark.x + mark.radius, y: mark.y + mark.radius, w: mark.w - mark.radius * 2, h: mark.h - mark.radius * 2 }, element)) background = p[mark.fill];
      else issues.push(`Keep the ${element.role} text clear of artwork and partially overlapping shapes; a solid rectangle may fully contain its box.`);
    }
    if (contrast(p[element.color], background) < 4.5) issues.push(`The ${element.role} text needs at least 4.5:1 contrast against its background.`);
    const frame = box(element), minimum = scale(element.role === "title" ? 4 : 2.2);
    let size = scale(element.size);
    const emphasis = (element.weight >= 600 ? 1.04 : 1) * (element.italic ? 1.04 : 1);
    // Leave ascender room across the supported system-font families. A tight
    // title line box can clip real glyph metrics even when word wrapping fits.
    const lh = element.role === "title" ? 1.3 : 1.4;
    const required = (fontSize: number) => (linesAt(value, frame.w, fontSize, emphasis) * lh + 0.2) * fontSize;
    const widestGlyph = Math.max(...[...value].filter(char => char !== "\n").map(glyphEm)) * emphasis;
    const fits = (fontSize: number) => required(fontSize) <= frame.h && widestGlyph * fontSize <= frame.w;
    while (size > minimum && !fits(size)) size = Math.max(minimum, size - 0.5);
    if (!fits(size)) issues.push(`The ${element.role} text does not fit its authored box. Enlarge the box or shorten the text.`);
    prims.push({ k: "text", ...frame, text: value, font: element.font, size, weight: element.weight, color: p[element.color], align: element.align, valign: "top", lh, italic: element.italic, role: element.role === "title" ? "title" : "body" });
  }
  return { background: p[spec.background], prims, issues: [...new Set(issues)] };
}

const artwork = (name: string | undefined, assets: DocumentAsset[]) => name ? { name, alt: assets.find(asset => asset.name === name)?.alt || name.replace(/-/g, " ") } : undefined;
export function bookCoverScene(book: Book): SlideScene {
  return composeCover(book.cover.composition!, book.theme, { title: plainText(book.title), subtitle: book.subtitle && plainText(book.subtitle), eyebrow: book.cover.tagline && plainText(book.cover.tagline), author: book.author && plainText(book.author) }, 576, 864, artwork(book.cover.image, book.assets));
}
export function slideCoverScene(theme: Theme, slide: Slide, assets: DocumentAsset[], author?: string): SlideScene {
  return composeCover(slide.composition!, theme, { title: slide.title, subtitle: slide.subtitle, eyebrow: slide.eyebrow, body: slide.body, author }, 1280, 720, artwork(slide.image, assets));
}
