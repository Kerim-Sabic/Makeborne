import type { Slide } from "./schema";
import { mix, contrast, luminance, readableOn } from "./theme";
import { H, W, ellipse, hline, image, line, measure, rect, scaled, text, toneColors, tryCompose, vline, type Ctx, type ImageTreatment, type RectPrim } from "./scene-kit";
import { scrimOpacity, zoneBrightness } from "./compose-image";
import { area, display, divider, fitDisplay, footer, label, labelStyle, labelWidth, leadStyle, numberedRows, numeral, numeralStyle, sectionNumber, stack, displayStyle } from "./design";
import { archPath, arrowPath, graphic, glowField, dotField } from "./graphics";
import { path } from "./scene-kit";
import type { GraphicKind } from "./directions";

/** Cover, closing, section, statement and quote compositions. */

export function applyTone(ctx: Ctx, tone: Slide["tone"]) { ctx.c = toneColors(ctx.theme, tone, ctx.dir.ground); }
/** A colour field that differs from the slide's own tone. */
/** A colour field for a light slide; a slide the author already set dark or accent keeps its tone. */
export const fieldTone = (ctx: Ctx): Slide["tone"] => ctx.tone === "light" ? "accent" : ctx.tone;
/** A graphic from the direction's language, varied per slide. Illustrative plates are kept for covers. */
export const pickGraphic = (ctx: Ctx, offset = 0): GraphicKind => {
  const pool = ctx.dir.graphics.filter(kind => kind !== "plate" || ctx.index === 0);
  return pool[(ctx.seed + offset) % pool.length];
};
export const subOf = (slide: Slide) => slide.subtitle ?? slide.body;
const deckLabel = (ctx: Ctx, slide: Slide) => ctx.deck.title && slide.title !== ctx.deck.title ? ctx.deck.title : "";

export function treatment(ctx: Ctx): ImageTreatment | undefined {
  const p = ctx.theme.palette;
  if (ctx.dir.image === "duotone") return { kind: "duotone", dark: mix(p.dark, "#000000", 0.35), light: mix(p.accent, "#FFFFFF", 0.25) };
  if (ctx.dir.image === "mono") return { kind: "mono", dark: mix(p.ink, "#000000", 0.2), light: mix(p.background, "#FFFFFF", 0.4) };
  return undefined;
}

/* ---------- covers ---------- */

function metaRow(ctx: Ctx, slide: Slide, y: number, rule = true) {
  const a = area(ctx), right = ctx.deck.author || deckLabel(ctx, slide);
  if (slide.eyebrow) label(ctx, slide.eyebrow, { x: a.x, y, w: a.w * 0.55 });
  if (right) label(ctx, right, { x: a.r - a.w * 0.4, y, w: a.w * 0.4 }, { align: "right" });
  if (rule && ctx.dir.rule) hline(ctx, a.x, a.r, y + 34, ctx.c.ink, Math.min(ctx.dir.rule.width, 3));
}

export function coverPoster(ctx: Ctx, slide: Slide, closing = false) {
  const a = area(ctx), sub = subOf(slide), size = closing ? ctx.dir.sizes.cover * 0.82 : ctx.dir.sizes.cover;
  metaRow(ctx, slide, a.y);
  // Poster-like directions run a band of stripes down the right edge; the title takes the rest.
  const band = !closing && (ctx.dir.id === "poster" || ctx.dir.id === "brutalist") ? 150 : 0;
  if (band) graphic(ctx, "stripes", { x: W - band - 24, y: a.y + 56, w: band, h: H - a.y - 56 - 40 });
  const tw = a.w - (band ? band + 40 : 0);
  const subStyle = leadStyle(ctx), subW = Math.min(780, tw * 0.7), subH = sub ? measure(ctx, sub, subW, subStyle) : 0;
  const bottom = H - 56, titleBottom = sub ? bottom - subH - 34 : bottom;
  const fit = fitDisplay(ctx, slide.title, tw, titleBottom - (a.y + 64), size, 56);
  const titleTop = titleBottom - fit.h;
  display(ctx, slide.title, { x: a.x, y: titleTop, w: tw, h: fit.h }, size, { min: 56 });
  if (sub) text(ctx, sub, { x: a.x, y: bottom - subH, w: subW, h: subH }, subStyle);
  const room = titleTop - 24 - (a.y + 60);
  if (!band && room >= 120) graphic(ctx, closing ? pickGraphic(ctx, 1) : ctx.dir.graphics[0], { x: a.x + a.w * 0.52, y: a.y + 60, w: a.w * 0.48, h: Math.min(room, 300) });
}

export function coverSplit(ctx: Ctx, slide: Slide, closing = false) {
  const a = area(ctx), kind = closing ? pickGraphic(ctx) : ctx.dir.graphics[0], sub = subOf(slide), p = ctx.theme.palette;
  const tile = H / 4, fx = kind === "mosaic" ? W - Math.round(tile * 3) : Math.round(W * 0.56), fw = W - fx;
  if (kind === "mosaic") graphic(ctx, kind, { x: fx, y: 0, w: fw, h: H }, 0, { cols: 3, rows: 4 });
  else {
    const fill = kind === "glow" ? ctx.c.bg : ctx.dir.id === "swiss" || ctx.dir.id === "architect" ? ctx.c.bg : ctx.c.surface;
    if (fill !== ctx.c.bg) rect(ctx, { x: fx, y: 0, w: fw, h: H, fill });
    else vline(ctx, fx, 0, H, ctx.c.rule, 1);
    graphic(ctx, kind, kind === "glow" ? { x: fx - 120, y: 0, w: fw + 120, h: H } : { x: fx + 48, y: 72, w: fw - 96, h: H - 144 });
  }
  void p;
  const tw = fx - a.x - 64;
  if (deckLabel(ctx, slide) && !closing) label(ctx, deckLabel(ctx, slide), { x: a.x, y: a.y, w: tw });
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: (closing ? 0.7 : 0.82) * ctx.dir.sizes.cover, min: 40, sub }, { x: a.x, y: a.y + 70, w: tw, h: H - 150 - (a.y + 70) }, "bottom");
  if (ctx.deck.author && !closing) label(ctx, ctx.deck.author, { x: a.x, y: H - 76, w: tw }, { color: ctx.c.muted });
}

export function coverCentered(ctx: Ctx, slide: Slide, closing = false) {
  const c = ctx.c, inset = 36, sub = subOf(slide);
  rect(ctx, { x: inset, y: inset, w: W - inset * 2, h: H - inset * 2, fill: c.bg, noFill: true, stroke: c.rule, strokeWidth: 1 });
  const top = slide.eyebrow ?? (closing ? "" : deckLabel(ctx, slide));
  if (top) label(ctx, top, { x: 240, y: 82, w: 800 }, { align: "center" });
  const r = 30;
  if (ctx.dir.id === "organic") { path(ctx, archPath({ x: W / 2 - 26, y: 140, w: 52, h: 70 }), { fill: ctx.c.signal }); hline(ctx, W / 2 - 60, W / 2 + 60, 210, c.ink, 1.5); }
  else if (ctx.dir.id === "luxury" || ctx.dir.id === "editorial") {
    // The emblem is chosen by the deck's seed: a ringed diamond, a pair of rules with a diamond, or three rings.
    const emblem = ctx.seed % 3;
    if (emblem === 0) ellipse(ctx, { x: W / 2 - r, y: 150, w: r * 2, h: r * 2, stroke: c.accent, strokeWidth: 1 });
    if (emblem === 1) { hline(ctx, W / 2 - 90, W / 2 - 20, 180, c.accent, 1); hline(ctx, W / 2 + 20, W / 2 + 90, 180, c.accent, 1); }
    if (emblem === 2) [-34, 0, 34].forEach(dx => ellipse(ctx, { x: W / 2 + dx - 12, y: 168, w: 24, h: 24, stroke: c.accent, strokeWidth: 1 }));
    else path(ctx, [{ op: "M", x: W / 2, y: 172 }, { op: "L", x: W / 2 + 8, y: 180 }, { op: "L", x: W / 2, y: 188 }, { op: "L", x: W / 2 - 8, y: 180 }, { op: "Z" }], { fill: c.accent });
  } else rect(ctx, { x: W / 2 - 24, y: 176, w: 48, h: 4, fill: c.signal });
  stack(ctx, { title: slide.title, size: closing ? ctx.dir.sizes.cover * 0.8 : ctx.dir.sizes.cover, min: 40, sub, subW: 760, align: "center" }, { x: 170, y: 232, w: W - 340, h: 330 }, "middle");
  if (ctx.deck.author && !closing) label(ctx, ctx.deck.author, { x: 240, y: 604, w: 800 }, { align: "center" });
}

export function coverMasthead(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, sub = subOf(slide);
  hline(ctx, a.x, a.r, 52, c.ink, 2.5); hline(ctx, a.x, a.r, 59, c.ink, 0.8);
  if (slide.eyebrow) label(ctx, slide.eyebrow, { x: a.x, y: 72, w: a.w * 0.5 });
  if (ctx.deck.author) label(ctx, ctx.deck.author, { x: a.r - a.w * 0.45, y: 72, w: a.w * 0.45 }, { align: "right", color: c.muted });
  const pw = 400, px = a.r - pw;
  graphic(ctx, "plate", { x: px, y: 128, w: pw, h: 470 });
  stack(ctx, { title: slide.title, size: ctx.dir.sizes.cover, min: 44, sub, gap: 24 }, { x: a.x, y: 128, w: px - a.x - 56, h: 470 }, "bottom");
  hline(ctx, a.x, a.r, H - 64, c.rule, 1);
  if (deckLabel(ctx, slide)) text(ctx, deckLabel(ctx, slide), { x: a.x, y: H - 52, w: 700, h: 20 }, { size: 13, color: c.muted, upper: true, tracking: 0.14, lh: 1.3 });
}

export function coverModules(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, sub = subOf(slide);
  const cells = [slide.eyebrow, ctx.deck.author, deckLabel(ctx, slide)].filter((value): value is string => !!value).slice(0, 3);
  cells.forEach((value, i) => label(ctx, value, { x: a.x + i * (a.w / 3), y: a.y, w: a.w / 3 - 24 }, i ? { color: c.muted } : {}));
  hline(ctx, a.x, a.r, a.y + 40, c.ink, 1.5);
  const gx = a.x + a.w * 0.5 + 24, gTop = a.y + 72, gh = 220;
  graphic(ctx, ctx.dir.id === "architect" ? "plan" : "modules", { x: gx, y: gTop, w: a.r - gx, h: gh });
  const subStyle = leadStyle(ctx), subW = Math.min(640, a.w * 0.55), subH = sub ? measure(ctx, sub, subW, subStyle) : 0;
  const bottom = H - 56, titleBottom = sub ? bottom - subH - 30 : bottom;
  // Full width below the graphic when the title stays big there; otherwise the left column beside it.
  const wide = fitDisplay(ctx, slide.title, a.w * 0.92, titleBottom - (gTop + gh + 28), ctx.dir.sizes.cover, 40);
  const narrow = fitDisplay(ctx, slide.title, a.w * 0.5 - 8, titleBottom - gTop, ctx.dir.sizes.cover, 40);
  const useWide = wide.size >= Math.min(narrow.size * 0.98, ctx.dir.sizes.cover * 0.6);
  const fit = useWide ? wide : narrow, w = useWide ? a.w * 0.92 : a.w * 0.5 - 8;
  display(ctx, slide.title, { x: a.x, y: titleBottom - fit.h, w, h: fit.h }, ctx.dir.sizes.cover, { min: 40 });
  if (sub) text(ctx, sub, { x: a.x, y: bottom - subH, w: subW, h: subH }, subStyle);
}

export function coverGlow(ctx: Ctx, slide: Slide, closing = false) {
  const a = area(ctx), c = ctx.c, p = ctx.theme.palette, sub = subOf(slide);
  glowField(ctx, { x: 480, y: 0, w: 800, h: H }, [p.accent, p.accent2]);
  dotField(ctx, { x: 560, y: 40, w: 680, h: 640 }, c.ink, 0.3, true, 22);
  // The orbit's centre, size and the marker's angle follow the deck's seed.
  const r = 200 + (ctx.seed % 4) * 15, cx = 880 + ((ctx.seed >> 2) % 5) * 22, cy = 300 + ((ctx.seed >> 5) % 4) * 18, angle = -Math.PI / 4 + ((ctx.seed >> 7) % 6) * 0.45;
  ellipse(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: c.rule, strokeWidth: 1 });
  ellipse(ctx, { x: cx - r * 0.6, y: cy - r * 0.6, w: r * 1.2, h: r * 1.2, stroke: c.rule, strokeWidth: 1 });
  ellipse(ctx, { x: cx + r * Math.cos(angle) - 5, y: cy + r * Math.sin(angle) - 5, w: 10, h: 10, fill: c.accent });
  metaRow(ctx, slide, a.y, false);
  stack(ctx, { title: slide.title, size: closing ? ctx.dir.sizes.cover * 0.78 : ctx.dir.sizes.cover, min: 40, sub }, { x: a.x, y: a.y + 80, w: 760, h: H - 150 - (a.y + 80) }, closing ? "middle" : "bottom");
  hline(ctx, a.x, a.r, H - 84, c.rule, 1);
  text(ctx, `[ ${deckLabel(ctx, slide) || ctx.deck.title} ]`.toUpperCase(), { x: a.x, y: H - 68, w: 760, h: 20 }, { font: "mono", size: 13, color: c.muted, lh: 1.3 });
}

export function coverBoxed(ctx: Ctx, slide: Slide, closing = false) {
  const c = ctx.c, bw = ctx.dir.rule?.width ?? 4, x0 = 24, x1 = W - 24, sub = subOf(slide);
  rect(ctx, { x: x0, y: x0, w: x1 - x0, h: H - 2 * x0, fill: c.bg, noFill: true, stroke: c.ink, strokeWidth: bw + 2 });
  hline(ctx, x0, x1, 96, c.ink, bw);
  if (slide.eyebrow) {
    const lw = Math.min(560, labelWidth(ctx, slide.eyebrow) + 32);
    rect(ctx, { x: 48, y: 44, w: lw, h: 34, fill: c.ink });
    label(ctx, slide.eyebrow, { x: 62, y: 51, w: lw - 24, h: 20 }, { color: c.bg });
  }
  const right = ctx.deck.author || (closing ? "" : deckLabel(ctx, slide));
  if (right) label(ctx, right, { x: W - 48 - 520, y: 52, w: 520 }, { align: "right" });
  // The ruled band's height and the column split follow the deck's seed.
  const bandTop = 540 + (ctx.seed % 3) * 20, split = 820 + ((ctx.seed >> 3) % 4) * 40;
  hline(ctx, x0, x1, bandTop, c.ink, bw);
  vline(ctx, split, bandTop, H - x0, c.ink, bw);
  display(ctx, slide.title, { x: 48, y: 120, w: W - 96, h: bandTop - 120 - 24 }, closing ? ctx.dir.sizes.cover * 0.8 : ctx.dir.sizes.cover, { min: 44, valign: "bottom" });
  if (sub) text(ctx, sub, { x: 48, y: bandTop + 22, w: split - 80, h: H - x0 - bandTop - 38 }, { ...leadStyle(ctx), size: 22, min: 16, maxH: H - x0 - bandTop - 38, color: c.ink });
  rect(ctx, { x: split + bw, y: bandTop + bw / 2, w: x1 - split - bw - bw / 2, h: H - x0 - bandTop - bw, fill: c.signal });
  path(ctx, arrowPath(split + (x1 - split) / 2 - 55, bandTop + 10, 110, 45), { fill: readableOn(c.signal, c.ink, c.bg) });
}

export function coverArch(ctx: Ctx, slide: Slide, closing = false) {
  const a = area(ctx), c = ctx.c, p = ctx.theme.palette, sub = subOf(slide), gx = Math.round(W * 0.56);
  if (ctx.dir.id === "luxury") {
    // Width, height and the inner mark follow the deck's seed, so two luxury decks do not share one window.
    const v = ctx.seed % 4, aw = [300, 260, 340, 280][v], ah = [470, 500, 440, 480][v], ax = gx + (W - gx - aw) / 2, ay = (H - ah) / 2 + 10;
    path(ctx, archPath({ x: ax, y: ay, w: aw, h: ah }), { stroke: c.accent, strokeWidth: 1 });
    path(ctx, archPath({ x: ax + 22, y: ay + 22, w: aw - 44, h: ah - 22 }), { fill: c.surface });
    if (v % 2) hline(ctx, ax + 60, ax + aw - 60, ay + 150, c.accent, 1);
    else ellipse(ctx, { x: ax + aw / 2 - 40, y: ay + 110 + v * 20, w: 80, h: 80, stroke: c.accent, strokeWidth: 1 });
    hline(ctx, ax - 60, ax + aw + 60, ay + ah, c.rule, 1);
  } else graphic(ctx, "arches", { x: gx, y: 70, w: W - gx - 40, h: H - 150 });
  void p;
  const tw = gx - a.x - 48;
  if (deckLabel(ctx, slide) && !closing) label(ctx, deckLabel(ctx, slide), { x: a.x, y: a.y, w: tw });
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: closing ? ctx.dir.sizes.cover * 0.72 : ctx.dir.sizes.cover * 0.86, min: 40, sub }, { x: a.x, y: a.y + 60, w: tw, h: H - 140 - (a.y + 60) }, "middle");
  if (ctx.deck.author && !closing) label(ctx, ctx.deck.author, { x: a.x, y: H - 76, w: tw }, { color: c.muted });
}

export function coverImage(ctx: Ctx, slide: Slide, closing = false) {
  const a = area(ctx), sub = subOf(slide), name = slide.image!, mode = ctx.dir.image;
  if (mode === "full" || mode === "duotone" || mode === "mono") {
    const tr = treatment(ctx), box = { x: 0, y: 0, w: W, h: H };
    image(ctx, name, box, { crop: "center", ...(tr ? { treatment: tr } : {}) });
    // A solid scrim behind the text block, sized from the image's measured brightness there, with a soft fade above it.
    const fade: RectPrim = { k: "rect", x: 0, y: 0, w: W, h: 140, fill: "#000000", opacity: 0.6, fade: "up" }, scrim: RectPrim = { k: "rect", x: 0, y: 0, w: W, h: H, fill: "#000000", opacity: 0.6 };
    ctx.prims.push(fade, scrim);
    const white = "#FFFFFF", start = ctx.prims.length;
    // The eyebrow sits with the title on the scrim, not alone on the bare image.
    const s = stack(ctx, { label: slide.eyebrow, labelColor: white, title: slide.title, size: ctx.dir.sizes.cover * (closing ? 0.76 : 0.86), min: 40, sub, titleColor: white, subStyle: { color: "#EDEDED" } }, { x: a.x, y: 160, w: a.w * 0.8, h: H - 56 - 160 }, "bottom");
    const top = Math.max(0, s.top - 36), zone = { x: 0, y: top, w: W, h: H - top };
    const dimmest = Math.min(1, ...ctx.prims.slice(start).flatMap(prim => prim.k === "text" ? [luminance(prim.color)] : []));
    const opacity = Math.round(scrimOpacity(zoneBrightness(ctx.deck.assets.find(asset => asset.name === name), box, zone, tr), dimmest) * 100) / 100;
    Object.assign(scrim, { y: top, h: H - top, opacity });
    if (top >= 140) Object.assign(fade, { y: top - 140, opacity }); else fade.opacity = 0;
    if (!fade.opacity) ctx.prims.splice(ctx.prims.indexOf(fade), 1);
    return;
  }
  if (mode !== "arch" && bleedCover(ctx, slide, closing)) return;
  const left = slide.imageSide === "left", ix = left ? 0 : W / 2, tx = left ? W / 2 + 56 : a.x, tw = W / 2 - 56 - a.x;
  if (mode === "arch") image(ctx, name, { x: ix + 80, y: 72, w: W / 2 - 160, h: H - 144 }, { mask: "arch" });
  else image(ctx, name, { x: ix + (left ? 0 : 24), y: 0, w: W / 2 - 24, h: H }, { treatment: treatment(ctx) });
  // Larger beside the image, but at most four lines: a longer title steps down instead.
  const size = ctx.dir.sizes.cover * 0.7;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size, min: 36, sub, maxTitleH: Math.ceil(scaled(ctx, size) * ctx.dir.display.lh * 4.2) }, { x: tx, y: a.y + 30, w: tw, h: H - 120 - a.y }, "middle");
}

/** Where a split direction's cover photograph is dark enough on the text side (measured: asset.luma), it runs
 * full bleed with a solid scrim under the text half and a fade beyond, so white text reaches 4.5:1 while most
 * of the picture stays visible. A bright (mean of the measured cell highlights on the text side above BLEED_MEAN_MAX, or needing a scrim
 * above BLEED_SCRIM_MAX), unmeasured or portrait image keeps the split. */
const BLEED_SCRIM_MAX = 0.55, BLEED_MEAN_MAX = 180;
function bleedCover(ctx: Ctx, slide: Slide, closing: boolean) {
  const name = slide.image!, asset = ctx.deck.assets.find(entry => entry.name === name);
  if (!asset?.luma || asset.aspect === "portrait") return false;
  const textLeft = slide.imageSide !== "left", side = asset.luma.filter((_, i) => textLeft ? i % 8 < 5 : i % 8 > 2);
  if (side.reduce((sum, value) => sum + value, 0) / side.length > BLEED_MEAN_MAX) return false;
  const a = area(ctx), white = "#FFFFFF", tw = Math.round(W * 0.56) - a.x, panel = a.x + tw + 40, fadeW = 300;
  const words: Ctx = { ...ctx, prims: [], issues: [] };
  const s = stack(words, { label: slide.eyebrow, labelColor: white, title: slide.title, size: ctx.dir.sizes.cover * (closing ? 0.72 : 0.8), min: 40, sub: subOf(slide), titleColor: white, subStyle: { color: "#EDEDED" } }, { x: textLeft ? a.x : W - a.x - tw, y: a.y + 30, w: tw, h: H - 120 - a.y }, "middle");
  if (words.issues.length) return false;
  const tr = treatment(ctx), box = { x: 0, y: 0, w: W, h: H }, top = Math.max(0, s.top - 32), zone = { x: textLeft ? 0 : W - panel, y: top, w: panel, h: Math.min(H, s.bottom + 32) - top };
  const dimmest = Math.min(1, ...words.prims.flatMap(prim => prim.k === "text" ? [luminance(prim.color)] : []));
  const opacity = Math.round(scrimOpacity(zoneBrightness(asset, box, zone, tr), dimmest) * 100) / 100;
  if (opacity > BLEED_SCRIM_MAX) return false;
  image(ctx, name, box, { crop: "center", ...(tr ? { treatment: tr } : {}) });
  ctx.prims.push({ k: "rect", x: textLeft ? 0 : W - panel, y: 0, w: panel, h: H, fill: "#000000", opacity },
    { k: "rect", x: textLeft ? panel : W - panel - fadeW, y: 0, w: fadeW, h: H, fill: "#000000", opacity, fade: textLeft ? "right" : "left" }, ...words.prims);
  return true;
}

export function closingAsk(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, sub = subOf(slide);
  if (slide.eyebrow) label(ctx, slide.eyebrow, { x: a.x, y: a.y, w: a.w * 0.6 });
  if (ctx.dir.rule) hline(ctx, a.x, a.r, a.y + 34, c.ink, Math.min(ctx.dir.rule.width, 3));
  const tw = a.w * 0.74;
  const s = stack(ctx, { title: slide.title, size: ctx.dir.sizes.cover * 0.78, min: 40, sub, subW: 760 }, { x: a.x, y: a.y + 70, w: tw, h: H - 130 - (a.y + 70) }, "middle");
  const gx = a.x + tw + 40;
  if (a.r - gx >= 160) graphic(ctx, pickGraphic(ctx, 1), { x: gx, y: Math.max(a.y + 70, s.top), w: a.r - gx, h: Math.min(300, s.bottom - s.top + 40) });
  const foot = ctx.deck.author || ctx.deck.title;
  if (foot) { divider(ctx, a.x, a.r, H - 84); text(ctx, foot, { x: a.x, y: H - 68, w: 900, h: 22 }, { ...labelStyle(ctx), color: c.muted, size: 13 }); }
}

export function closingField(ctx: Ctx, slide: Slide) {
  applyTone(ctx, fieldTone(ctx));
  coverPoster(ctx, { ...slide, eyebrow: slide.eyebrow }, true);
}

export function closingSplit(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, cw = Math.round(W * 0.38), sub = subOf(slide);
  rect(ctx, { x: 0, y: 0, w: cw, h: H, fill: c.strong });
  const sub2: Ctx = { ...ctx, prims: [], c: { ...c, bg: c.strong, ink: c.onStrong, muted: c.onStrong, accent: c.onStrong, signal: mix(c.onStrong, c.strong, 0.25), rule: mix(c.onStrong, c.strong, 0.6), surface: mix(c.strong, c.onStrong, 0.12) } };
  const kind = pickGraphic(ctx, 2);
  if (kind === "mosaic") graphic(ctx, "mosaic", { x: 0, y: 0, w: cw, h: cw * 0.5 }, 0, { cols: 4, rows: 2 });
  else if (kind === "arches" || kind === "rings" || kind === "disc" || kind === "stripes") { graphic(sub2, kind, { x: 48, y: 64, w: cw - 96, h: 300 }); ctx.prims.push(...sub2.prims); }
  if (slide.eyebrow) display(ctx, slide.eyebrow, { x: a.x, y: H - 210, w: cw - a.x - 40, h: 150 }, 44, { min: 24, valign: "bottom", color: c.onStrong, role: undefined });
  stack(ctx, { title: slide.title, size: ctx.dir.sizes.cover * 0.62, min: 36, sub }, { x: cw + 72, y: a.y + 40, w: W - cw - 72 - a.x, h: H - 120 - a.y }, "middle");
}

export function closingBoxed(ctx: Ctx, slide: Slide) { coverBoxed(ctx, slide, true); }

/** The close as a decision: the ask on the left, the agreed next steps numbered on the right (step, then who/when),
 * and the contact line (the slide body, else the presenter) under a rule. No decorative graphic competes with the ask. */
export function closingNext(ctx: Ctx, slide: Slide) {
  // Beside an image rail the ask runs across the top and the steps below, rather than a word per line.
  if (area(ctx).w < 760 && tryCompose(ctx, sub => closingNextLayout(sub, slide, true))) return;
  closingNextLayout(ctx, slide, false);
}
/** NEXT-STEP SIZES ([step, who/when], largest first; the last step is the minimum). */
export const CLOSING_STEPS_STACKED = [[40, 25], [38, 24], [36, 24], [34, 23], [32, 22], [30, 21], [27, 20], [24, 19], [22, 18], [20, 17]];
export const CLOSING_STEPS = [[34, 23], [32, 22], [30, 21], [27, 20], [24, 19], [22, 18], [20, 17]];
function closingNextLayout(ctx: Ctx, slide: Slide, stacked: boolean) {
  const a = area(ctx), c = ctx.c, steps = slide.points ?? [], sub = slide.subtitle;
  const contact = slide.body ?? ctx.deck.author, foot = contact ? 64 : 0, bottom = a.b - foot;
  // At most three lines: in a narrow column the ask is set smaller rather than one word per line.
  const askSize = ctx.dir.sizes.cover * (stacked ? 0.6 : 0.66), lines = (count: number) => Math.ceil(scaled(ctx, askSize) * ctx.dir.display.lh * (count + 0.2));
  // Above the steps the ask takes two lines when it keeps 85% of its size there, so the steps keep theirs; else three.
  const twoLines = stacked && fitDisplay(ctx, slide.title, area(ctx).w, lines(2), askSize, 36).size >= scaled(ctx, askSize) * 0.85;
  const maxTitleH = lines(twoLines ? 2 : 3);
  const ask = { label: slide.eyebrow, title: slide.title, size: askSize, min: stacked ? 36 : 34, sub, subStyle: { size: 22 }, maxTitleH };
  let rx: number, top: number;
  if (stacked) {
    const s = stack(ctx, ask, { x: a.x, y: a.y, w: a.w, h: Math.round((bottom - a.y) * 0.52) }, "top");
    rx = a.x; top = s.bottom + 32;
  } else {
    const lw = Math.round(a.w * (a.w < 900 ? 0.46 : 0.42));
    stack(ctx, ask, { x: a.x, y: a.y, w: lw, h: bottom - a.y }, "middle");
    rx = a.x + lw + 56; top = a.y;
  }
  // The steps are numbered with figures at heading scale (a decision list, not a set of reasons).
  const rows = numberedRows(ctx, steps, { x: rx, r: a.r, top, bottom, mark: "figure", markColor: c.accent, sizes: stacked ? CLOSING_STEPS_STACKED : CLOSING_STEPS,
    title: ts => displayStyle(ctx, ts, { role: undefined, lh: 1.14, color: c.ink }), body: (bs, titled) => ({ size: bs, lh: 1.4, color: titled ? c.muted : c.ink }),
    pad: stacked ? [28, 56] : [36, 64], anchor: stacked ? 0 : 0.5, closeRule: !contact });
  if (!rows.fits) ctx.issues.push("the next steps have too much text for the closing slide");
  if (contact) {
    hline(ctx, a.x, a.r, a.b - foot + 18, c.rule, 1);
    text(ctx, contact, { x: a.x, y: a.b - foot + 32, w: a.w, h: 28 }, { ...labelStyle(ctx), upper: false, tracking: 0, size: 17, weight: 600, color: c.ink, maxH: 28, min: 13 });
  }
}

/* ---------- sections ---------- */

export function sectionNumeral(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, num = sectionNumber(ctx, slide), sub = subOf(slide);
  const big = Math.min(300, ctx.dir.sizes.number * 1.45), style = numeralStyle(ctx, num.length > 3 ? big * 0.5 : big, { color: c.accent });
  if (ctx.dir.axis === "left" && (ctx.dir.id === "swiss" || ctx.dir.id === "architect" || ctx.dir.id === "data")) {
    hline(ctx, a.x, a.r, a.y, c.ink, 1.5);
    text(ctx, num, { x: a.r - 640, y: a.y + 16, w: 640, h: Math.ceil(style.size * 1.02) }, { ...style, align: "right", maxH: 300, min: 60 });
    stack(ctx, { title: slide.title, size: ctx.dir.sizes.section, min: 36, sub, subW: 760 }, { x: a.x, y: 360, w: a.w * 0.78, h: a.b - 360 }, "bottom");
    return;
  }
  // Numeral and title on the left half; the direction's graphic language holds the right.
  const tw = a.w * 0.56, nh = Math.ceil(style.size * 1.02);
  text(ctx, num, { x: a.x - 6, y: a.y, w: tw, h: nh }, { ...style, maxH: 300, min: 60 });
  stack(ctx, { title: slide.title, size: ctx.dir.sizes.section, min: 36, sub, subW: tw, rule: !!ctx.dir.rule }, { x: a.x, y: a.y + nh + 20, w: tw, h: a.b - (a.y + nh + 20) }, "top");
  const kind = pickGraphic(ctx, 2), gx = a.x + tw + 64;
  if (kind === "glow") graphic(ctx, kind, { x: gx - 40, y: 0, w: W - gx + 40, h: H });
  else graphic(ctx, kind, { x: gx, y: a.y + 30, w: a.r - gx, h: a.b - a.y - 60 });
}

export function sectionField(ctx: Ctx, slide: Slide) {
  applyTone(ctx, ctx.tone === "light" ? "accent" : ctx.tone);
  const a = area(ctx), c = ctx.c, num = sectionNumber(ctx, slide), sub = subOf(slide);
  const ghost = mix(c.ink, c.bg, 0.78);
  text(ctx, num, { x: W - 40 - 700, y: 30, w: 700, h: 400 }, { ...numeralStyle(ctx, 380, { color: ghost }), align: "right", maxH: 400, min: 80 });
  if (ctx.dir.id === "poster" || ctx.dir.id === "brutalist") graphic(ctx, "stripes", { x: 0, y: H - 40, w: W, h: 40 });
  stack(ctx, { label: slide.eyebrow && slide.eyebrow !== num ? slide.eyebrow : undefined, title: slide.title, size: ctx.dir.sizes.section * 1.1, min: 40, sub, subW: 760 }, { x: a.x, y: 220, w: a.w * 0.8, h: H - 88 - 220 }, "bottom");
}

export function sectionSplit(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, cw = Math.round(W * 0.4), num = sectionNumber(ctx, slide), sub = subOf(slide);
  rect(ctx, { x: 0, y: 0, w: cw, h: H, fill: c.strong });
  if (ctx.dir.id === "colorblock") {
    const sub2: Ctx = { ...ctx, prims: [] };
    graphic(sub2, "mosaic", { x: 0, y: 0, w: cw, h: cw * 0.5 });
    ctx.prims.push(...sub2.prims);
  } else if (ctx.dir.id === "organic") path(ctx, archPath({ x: cw / 2 - 110, y: 70, w: 220, h: 240 }), { fill: mix(c.strong, c.onStrong, 0.16) });
  text(ctx, num, { x: a.x, y: H - 56 - 260, w: cw - a.x - 32, h: 260 }, { ...numeralStyle(ctx, 240, { color: c.onStrong }), valign: "bottom", maxH: 260, min: 60 });
  stack(ctx, { label: slide.eyebrow && slide.eyebrow !== num ? slide.eyebrow : undefined, title: slide.title, size: ctx.dir.sizes.section, min: 36, sub }, { x: cw + 72, y: a.y + 30, w: W - cw - 72 - a.x, h: a.b - a.y - 30 }, "middle");
}

export function sectionCentered(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, num = sectionNumber(ctx, slide), sub = subOf(slide);
  if (ctx.dir.id === "luxury") rect(ctx, { x: 36, y: 36, w: W - 72, h: H - 72, fill: c.bg, noFill: true, stroke: c.rule, strokeWidth: 1 });
  const ns = numeralStyle(ctx, Math.min(140, ctx.dir.sizes.number * 0.8), { color: c.accent, align: "center" });
  text(ctx, num, { x: W / 2 - 300, y: 120, w: 600, h: Math.ceil(ns.size * 1.05) }, ns);
  const y = 120 + Math.ceil(ns.size * 1.05) + 18;
  hline(ctx, W / 2 - 36, W / 2 + 36, y, c.accent, 1.5);
  stack(ctx, { title: slide.title, size: ctx.dir.sizes.section, min: 34, sub, subW: 760, align: "center" }, { x: a.x + 40, y: y + 34, w: a.w - 80, h: a.b - y - 34 }, "top");
}

export function sectionIndex(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, num = sectionNumber(ctx, slide), sub = subOf(slide), list = ctx.sections.slice(0, 8);
  const lx = a.x + a.w * 0.6, lw = a.r - lx;
  hline(ctx, a.x, a.r, a.y, c.ink, 1.5);
  text(ctx, num, { x: a.x, y: a.y + 24, w: a.w * 0.5, h: 180 }, { ...numeralStyle(ctx, 170, { color: c.accent }), maxH: 180, min: 60 });
  stack(ctx, { title: slide.title, size: ctx.dir.sizes.section, min: 34, sub }, { x: a.x, y: a.y + 230, w: a.w * 0.52, h: a.b - a.y - 230 }, "bottom");
  const rowH = Math.min(64, (a.b - a.y - 24) / list.length), y0 = a.y + 24;
  list.forEach((section, i) => {
    const y = y0 + i * rowH, current = section.index === ctx.index;
    if (i) divider(ctx, lx, a.r, y);
    if (current) rect(ctx, { x: lx - 18, y: y + 12, w: 6, h: rowH - 24, fill: c.accent });
    text(ctx, numeral(ctx, i), { x: lx, y: y + 14, w: 56, h: 24 }, { font: ctx.dir.label.font === "mono" ? "mono" : "body", size: 15, weight: 700, color: current ? c.accent : c.muted, lh: 1.3 });
    text(ctx, section.title, { x: lx + 60, y: y + 12, w: lw - 60, h: rowH - 18 }, { size: current ? 20 : 18, min: 13, maxH: rowH - 18, weight: current ? 700 : 400, color: current ? c.ink : c.muted, lh: 1.25 });
  });
}

/* ---------- statements ---------- */

export function statementHero(ctx: Ctx, slide: Slide) {
  const a = area(ctx), body = slide.body ?? slide.subtitle;
  if (slide.eyebrow) label(ctx, slide.eyebrow, { x: a.x, y: a.y, w: a.w * 0.6 });
  if (ctx.dir.rule && ctx.dir.rule.width >= 4) hline(ctx, a.x, a.r, a.y + 32, ctx.c.ink, ctx.dir.rule.width);
  const bw = Math.min(520, a.w * 0.44), bodyStyle = { ...leadStyle(ctx), size: 24 };
  const bh = body ? measure(ctx, body, bw, bodyStyle) : 0;
  const top = a.y + (slide.eyebrow ? 52 : 8), titleMax = a.b - top - (body ? bh + 36 : 0);
  // The headline is the slide: set it as large as three lines allow.
  const big = Math.min(220, ctx.dir.sizes.statement * 1.3), lines = Math.ceil(scaled(ctx, big) * ctx.dir.display.lh * 3.2);
  const fit = fitDisplay(ctx, slide.title, a.w * 0.96, Math.min(titleMax, lines), big, 44);
  display(ctx, slide.title, { x: a.x, y: top, w: a.w * 0.96, h: fit.h }, big, { min: 44 });
  if (body) {
    const by = Math.max(top + fit.h + 36, a.b - bh);
    rect(ctx, { x: a.r - bw, y: by - 18, w: 40, h: 3, fill: ctx.c.accent });
    text(ctx, body, { x: a.r - bw, y: by, w: bw, h: bh }, bodyStyle);
  }
  footer(ctx);
}

export function statementHanging(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, hang = Math.round(a.w * 0.25), body = slide.body ?? slide.subtitle;
  hline(ctx, a.x, a.r, a.y, c.ink, 1.5);
  if (slide.eyebrow) label(ctx, slide.eyebrow, { x: a.x, y: a.y + 20, w: hang - 32 });
  const tx = a.x + hang, tw = a.w - hang;
  const s = stack(ctx, { title: slide.title, size: ctx.dir.sizes.statement * 1.05, min: 40, sub: body, subW: 720, subStyle: { size: 24 }, maxTitleH: Math.ceil(scaled(ctx, ctx.dir.sizes.statement * 1.05) * ctx.dir.display.lh * 3.3) }, { x: tx, y: a.y + 16, w: tw, h: a.b - a.y - 16 }, "top");
  // A small graphic anchors the empty column under the label.
  if (a.b - s.bottom > 150 || hang > 220) {
    const kind = ctx.dir.id === "architect" ? "plan" : ctx.dir.id === "swiss" ? "modules" : pickGraphic(ctx);
    if (kind === "modules" || kind === "plan" || kind === "dots" || kind === "rings") graphic(ctx, kind, { x: a.x, y: a.b - 200, w: hang - 40, h: 200 });
  }
  footer(ctx);
}

export function statementCentered(ctx: Ctx, slide: Slide) {
  const a = area(ctx), body = slide.body ?? slide.subtitle;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.statement * 0.96, min: 38, sub: body, subW: 760, align: "center", rule: ctx.dir.id !== "luxury" }, { x: a.x + 30, y: a.y + 70, w: a.w - 60, h: a.b - a.y - 90 }, "middle");
  footer(ctx);
}

export function statementField(ctx: Ctx, slide: Slide) {
  applyTone(ctx, fieldTone(ctx));
  const a = area(ctx), body = slide.body ?? slide.subtitle, gw = Math.round(a.w * 0.3), kind = pickGraphic(ctx, 3);
  graphic(ctx, kind === "glow" ? "rings" : kind, { x: a.r - gw, y: a.y + 20, w: gw, h: a.b - a.y - 40 });
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.statement, min: 40, sub: body, subW: 680 }, { x: a.x, y: a.y, w: a.w - gw - 56, h: a.b - a.y }, "middle");
  footer(ctx);
}

export function statementSplit(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, half = Math.round(W * 0.54), body = slide.body ?? slide.subtitle, kind = pickGraphic(ctx, 1);
  const field = kind === "glow" ? c.bg : kind === "mosaic" ? c.bg : c.surface;
  if (field !== c.bg) rect(ctx, { x: half, y: 0, w: W - half, h: H, fill: field });
  else vline(ctx, half, 0, H, c.rule, 1);
  const g = kind === "mosaic" ? { x: half, y: 0, w: W - half, h: H } : kind === "glow" ? { x: half - 80, y: 0, w: W - half + 80, h: H } : { x: half + 56, y: 80, w: W - half - 112, h: H - 160 };
  if (kind === "mosaic") { const tile = H / 4; graphic(ctx, kind, { x: W - Math.floor((W - half) / tile) * tile, y: 0, w: Math.floor((W - half) / tile) * tile, h: H }); if (W - Math.floor((W - half) / tile) * tile > half) rect(ctx, { x: half, y: 0, w: W - Math.floor((W - half) / tile) * tile - half, h: H, fill: c.strong }); }
  else graphic(ctx, kind, g);
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.statement * 0.8, min: 36, sub: body, subStyle: { size: 23 } }, { x: a.x, y: a.y, w: half - a.x - 64, h: a.b - a.y }, "middle");
  text(ctx, String(ctx.index + 1).padStart(2, "0"), { x: a.x, y: 672, w: 80, h: 20 }, { size: 13, color: c.muted, weight: 600, lh: 1.3 });
}

/* ---------- quotes ---------- */

const quoteSize = (ctx: Ctx, value: string) => Math.round((value.length < 90 ? 68 : value.length < 160 ? 54 : 44) * (ctx.dir.display.upper ? 1.15 : 1));
/** Capitals suit short quotes in poster-like directions; long ones stay in sentence case. */
const quoteCase = (ctx: Ctx, value: string) => ({ upper: ctx.dir.display.upper && value.length <= 120, italic: !ctx.dir.display.upper && ctx.dir.id !== "brutalist" });
export function quoteGiant(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, q = slide.quote!;
  text(ctx, "“", { x: a.x - 10, y: 30, w: 320, h: 324 }, { font: "heading", size: 300, lh: 1, color: c.accent });
  const x = a.x + 140, w = a.w - 140 - 40;
  const attribution = q.attribution ? `— ${q.attribution}` : "";
  const s = stack(ctx, { title: q.text, size: quoteSize(ctx, q.text), min: 26, extra: { ...quoteCase(ctx, q.text), lh: ctx.dir.display.upper ? 0.98 : 1.16 } }, { x, y: a.y + 70, w, h: a.b - a.y - 70 - (attribution ? 70 : 0) }, "middle");
  if (attribution) { rect(ctx, { x, y: s.bottom + 26, w: 36, h: 2, fill: c.accent }); label(ctx, attribution, { x: x + 52, y: s.bottom + 16, w: w - 52 }, { color: c.ink }); }
  footer(ctx);
}

export function quoteField(ctx: Ctx, slide: Slide) {
  applyTone(ctx, fieldTone(ctx));
  const a = area(ctx), c = ctx.c, q = slide.quote!;
  const attribution = q.attribution ? `— ${q.attribution}` : "";
  text(ctx, "“", { x: a.r - 340, y: 40, w: 340, h: 390 }, { font: "heading", size: 360, lh: 1, color: mix(c.ink, c.bg, 0.7), align: "right" });
  const s = stack(ctx, { title: q.text, size: quoteSize(ctx, q.text) + 4, min: 26, extra: { ...quoteCase(ctx, q.text), italic: false, lh: ctx.dir.display.upper ? 0.98 : 1.14 } }, { x: a.x, y: a.y + 60, w: a.w * 0.82, h: a.b - a.y - 60 - (attribution ? 70 : 0) }, "middle");
  if (attribution) label(ctx, attribution, { x: a.x, y: s.bottom + 22, w: a.w * 0.8 }, { color: c.ink });
  footer(ctx);
}

export function quoteCentered(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, q = slide.quote!;
  const attribution = q.attribution ? `— ${q.attribution}` : "";
  hline(ctx, W / 2 - 30, W / 2 + 30, a.y + 40, c.accent, 1.5);
  const s = stack(ctx, { title: q.text, size: quoteSize(ctx, q.text) - 4, min: 26, align: "center", extra: { ...quoteCase(ctx, q.text), lh: ctx.dir.display.upper ? 0.98 : 1.18 } }, { x: a.x + 40, y: a.y + 70, w: a.w - 80, h: a.b - a.y - 70 - (attribution ? 60 : 0) }, "middle");
  if (attribution) label(ctx, attribution, { x: a.x, y: s.bottom + 28, w: a.w }, { align: "center", color: c.muted });
  footer(ctx);
}

export { contrast, line, displayStyle };
