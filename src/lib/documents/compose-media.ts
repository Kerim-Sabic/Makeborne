import type { Block, Slide } from "./schema";
import { contrast, readableOn } from "./theme";
import { H, W, ellipse, fitStyle, image, measure, rect, text, scaled, type Ctx, type TextStyle } from "./scene-kit";
import { area, bodyStyle, display, divider, footer, header, label, labelStyle, leadStyle, numeralStyle, stack, displayStyle } from "./design";
import { archPath, dotField, glowField, halfPath, quarterPath } from "./graphics";
import { path } from "./scene-kit";
import { subOf, treatment } from "./compose-title";

/** Image-led compositions and the free canvas. */

export function imageFull(ctx: Ctx, slide: Slide) {
  const a = area(ctx), sub = subOf(slide);
  image(ctx, slide.image!, { x: 0, y: 0, w: W, h: H }, { treatment: treatment(ctx) });
  rect(ctx, { x: 0, y: 330, w: W, h: H - 330, fill: "#000000", opacity: 0.66, fade: "up" });
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.statement * 0.66, min: 30, sub, titleColor: "#FFFFFF", labelColor: "#FFFFFF", subStyle: { color: "#F2F2F2", size: 22 }, subW: 880 }, { x: a.x, y: 300, w: a.w * 0.82, h: H - 52 - 300 }, "bottom");
}

export function imageFramed(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, sub = subOf(slide), ih = 400;
  image(ctx, slide.image!, { x: a.x, y: a.y, w: a.w, h: ih }, { treatment: treatment(ctx) });
  const y = a.y + ih + 28, lw = Math.round(a.w * 0.56);
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline * 0.92, min: 26 }, { x: a.x, y, w: lw, h: a.b - y }, "top");
  if (sub) text(ctx, sub, { x: a.x + lw + 48, y: y + 4, w: a.w - lw - 48 }, bodyStyle(ctx, { size: 20, maxH: a.b - y - 4, min: 15, color: c.muted }));
  footer(ctx);
}

export function imageBand(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, sub = subOf(slide), ih = 430;
  image(ctx, slide.image!, { x: 0, y: 0, w: W, h: ih }, { treatment: treatment(ctx) });
  rect(ctx, { x: 0, y: ih, w: W, h: H - ih, fill: c.strong });
  const ink = c.onStrong;
  const lw = Math.round(a.w * 0.6);
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 26, titleColor: ink, labelColor: ink }, { x: a.x, y: ih + 30, w: lw, h: H - ih - 60 }, "middle");
  if (sub) text(ctx, sub, { x: a.x + lw + 48, y: ih + 36, w: a.w - lw - 48 }, bodyStyle(ctx, { size: 20, color: ink, maxH: H - ih - 72, min: 15 }));
}

function splitText(ctx: Ctx, slide: Slide, x: number, w: number) {
  const a = area(ctx), c = ctx.c;
  if (slide.points) {
    const s = stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline * 0.9, min: 28 }, { x, y: a.y + 10, w, h: 230 }, "top");
    const points = slide.points, gap = 20, avail = a.b - s.bottom - 36;
    const heightAt = (size: number) => points.reduce((t, point) => t + (point.title ? Math.ceil(size * 1.3) + 4 : 0) + measure(ctx, point.text, w - 34, bodyStyle(ctx, { size })), 0) + gap * (points.length - 1);
    let size = 22; while (size > 15 && heightAt(size) > avail) size--;
    let y = s.bottom + 36;
    points.forEach((point, i) => {
      rect(ctx, { x, y: y + size * 0.45, w: 10, h: 10, fill: c.accent, radius: ctx.dir.radius ? 5 : 0 });
      if (point.title) y += text(ctx, point.title, { x: x + 34, y, w: w - 34 }, { size, weight: 700, color: c.ink }) + 4;
      y += text(ctx, point.text, { x: x + 34, y, w: w - 34 }, bodyStyle(ctx, { size, color: point.title ? c.muted : c.ink })) + gap;
      void i;
    });
  } else stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 30, sub: slide.body, subStyle: { size: 23 } }, { x, y: a.y + 20, w, h: a.b - a.y - 40 }, "middle");
  text(ctx, String(ctx.index + 1).padStart(2, "0"), { x, y: 672, w: 80, h: 20 }, { size: 13, color: c.muted, weight: 600, lh: 1.3 });
}

export function splitHalf(ctx: Ctx, slide: Slide) {
  const left = slide.imageSide === "left";
  image(ctx, slide.image!, { x: left ? 0 : 640, y: 0, w: 640, h: H }, { treatment: treatment(ctx) });
  splitText(ctx, slide, left ? 712 : ctx.dir.mx, 640 - ctx.dir.mx - 72);
}

export function splitInset(ctx: Ctx, slide: Slide) {
  const a = area(ctx), left = slide.imageSide === "left", iw = 520, ix = left ? a.x : a.r - iw;
  image(ctx, slide.image!, { x: ix, y: a.y, w: iw, h: a.b - a.y }, { treatment: treatment(ctx) });
  if (ctx.dir.panel === "heavy") rect(ctx, { x: ix, y: a.y, w: iw, h: a.b - a.y, fill: ctx.c.bg, noFill: true, stroke: ctx.c.ink, strokeWidth: ctx.dir.rule?.width ?? 4 });
  splitText(ctx, slide, left ? ix + iw + 64 : a.x, a.w - iw - 64);
}

export function splitArch(ctx: Ctx, slide: Slide) {
  const a = area(ctx), left = slide.imageSide === "left", iw = 440, ix = left ? a.x + 20 : a.r - iw - 20, top = 60, h = H - 120;
  path(ctx, archPath({ x: ix - 18, y: top - 18, w: iw + 36, h: h + 18 }), { stroke: ctx.c.accent, strokeWidth: 1.5 });
  image(ctx, slide.image!, { x: ix, y: top, w: iw, h }, { mask: "arch", treatment: treatment(ctx) });
  splitText(ctx, slide, left ? ix + iw + 72 : a.x, a.w - iw - 112);
}

/* ---------- free canvas ---------- */

const STYLE_SIZES: Record<Extract<Block, { type: "text" }>["style"], number> = { display: 132, headline: 64, lead: 28, body: 22, label: 15, number: 170, quote: 52 };
/** Blocks on the direction's 12-column × 8-row grid. Shapes sit behind text; text colour is chosen for contrast with what is behind it. */
export function canvas(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, p = ctx.theme.palette, gutter = 24, rowGap = 16;
  const colW = (a.w - gutter * 11) / 12, rowH = (a.b - a.y - rowGap * 7) / 8;
  const box = (b: { col: number; span: number; row: number; rows: number }) => ({ x: a.x + (b.col - 1) * (colW + gutter), y: a.y + (b.row - 1) * (rowH + rowGap), w: b.span * colW + (b.span - 1) * gutter, h: b.rows * rowH + (b.rows - 1) * rowGap });
  const fills: Record<string, string> = { accent: p.accent, accent2: p.accent2, dark: p.dark, surface: c.surface, ink: c.ink, muted: c.muted };
  const shapes: { b: ReturnType<typeof box>; fill: string; solid: boolean }[] = [];
  const blocks = slide.blocks ?? [];
  for (const block of blocks) {
    if (block.type !== "shape") continue;
    const b = box(block), fill = fills[block.fill], turn = (block.turn ?? 0) / 90;
    switch (block.shape) {
      case "rect": rect(ctx, { ...b, fill, radius: Math.min(ctx.dir.radius, b.h / 2) }); shapes.push({ b, fill, solid: true }); break;
      case "circle": { const s = Math.min(b.w, b.h); ellipse(ctx, { x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s, fill }); shapes.push({ b, fill, solid: false }); break; }
      case "half-circle": path(ctx, halfPath(b, turn), { fill }); shapes.push({ b, fill, solid: false }); break;
      case "quarter-circle": { const s = Math.min(b.w, b.h); path(ctx, quarterPath(b.x, b.y, s, turn), { fill }); shapes.push({ b, fill, solid: false }); break; }
      case "arch": path(ctx, archPath({ x: b.x, y: b.y, w: Math.min(b.w, b.h), h: b.h }), { fill }); shapes.push({ b, fill, solid: false }); break;
      case "rule": rect(ctx, { x: b.x, y: b.y + b.h / 2 - 2, w: b.w, h: 4, fill }); break;
      case "dots": dotField(ctx, b, fill, 0.6, false, 20); shapes.push({ b, fill, solid: false }); break;
      case "glow": glowField(ctx, b, [fill, p.accent2]); shapes.push({ b, fill, solid: false }); break;
    }
  }
  const inside = (outer: ReturnType<typeof box>, inner: ReturnType<typeof box>) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
  const overlaps = (x: ReturnType<typeof box>, y: ReturnType<typeof box>) => x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
  let titled = false;
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const b = box(block);
    let bg = c.bg;
    for (const shape of shapes) if (overlaps(shape.b, b)) { if (shape.solid && inside(shape.b, b)) bg = shape.fill; else ctx.issues.push(`canvas text "${block.text.slice(0, 30)}" overlaps a shape; give it its own cells or a rect behind it`); }
    const pad = bg !== c.bg ? 24 : 0, inner = { x: b.x + pad, y: b.y + pad, w: b.w - pad * 2, h: b.h - pad * 2 };
    const want = block.color === "muted" ? c.muted : block.color === "accent" ? p.accent : block.color === "accent2" ? p.accent2 : c.ink;
    const color = contrast(want, bg) >= 4.5 ? want : readableOn(bg, c.ink, "#FFFFFF", p.background, "#111111");
    const base: TextStyle = block.style === "display" || block.style === "headline" || block.style === "quote"
      ? { ...displayStyle(ctx, STYLE_SIZES[block.style], { role: !titled ? "title" : undefined }), ...(block.style === "quote" ? { italic: true, upper: false, lh: 1.18 } : {}) }
      : block.style === "number" ? { ...numeralStyle(ctx, STYLE_SIZES.number), upper: false }
      : block.style === "label" ? labelStyle(ctx) : block.style === "lead" ? leadStyle(ctx) : bodyStyle(ctx, { color: c.ink });
    if (block.style === "display" || block.style === "headline") titled = true;
    const style: TextStyle = { ...base, color, align: block.align ?? (ctx.dir.axis === "center" ? "center" : "left"), min: block.style === "label" ? 11 : block.style === "body" ? 17 : Math.round(scaled(ctx, 20)) };
    const fit = fitStyle(ctx, block.text, inner.w, inner.h, style);
    if (fit.h > inner.h + 4) ctx.issues.push(`canvas text "${block.text.slice(0, 30)}" does not fit its cells; give it more rows or columns`);
    text(ctx, block.style === "label" ? `${ctx.dir.label.prefix ?? ""}${block.text}` : block.text, { ...inner, h: Math.max(inner.h, fit.h) }, { ...style, size: fit.size, min: undefined, valign: block.style === "display" || block.style === "number" ? "bottom" : "top" });
  }
  void divider; void header; void label; void display; void measure;
  footer(ctx);
}
