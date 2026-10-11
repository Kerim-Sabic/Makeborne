import type { Chart, Deck, Slide, Theme } from "./schema";
import { FONTS, contrast, mix, readableOn } from "./theme";

/** Every deck slide is composed once into absolute primitives on a 1280×720
 * canvas. The HTML preview/PDF and the editable PPTX both draw these same
 * primitives, so what the user approves in the preview is what they export. */
export const W = 1280, H = 720;
const MX = 72, TOP = 64, SAFE_BOTTOM = 640, CONTENT_W = W - 2 * MX;

export type TextPrim = { k: "text"; x: number; y: number; w: number; h: number; text: string; font: "heading" | "body"; size: number; weight: 400 | 600 | 700; color: string; align: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; lh: number; tracking?: number; upper?: boolean; italic?: boolean; role?: "title" | "body" };
export type RectPrim = { k: "rect"; x: number; y: number; w: number; h: number; fill: string; opacity?: number; radius?: number; fade?: "up" };
export type EllipsePrim = { k: "ellipse"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };
export type LinePrim = { k: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number; arrow?: boolean; opacity?: number };
export type ImagePrim = { k: "image"; x: number; y: number; w: number; h: number; name: string; alt: string };
export type ChartColors = { ink: string; muted: string; grid: string; series: string[]; highlight: string; dim: string; background: string };
export type ChartPrim = { k: "chart"; x: number; y: number; w: number; h: number; chart: Chart; colors: ChartColors };
export type Prim = TextPrim | RectPrim | EllipsePrim | LinePrim | ImagePrim | ChartPrim;
export type SlideScene = { background: string; prims: Prim[]; issues: string[] };

type Tone = { bg: string; ink: string; muted: string; accent: string; accent2: string; surface: string; rule: string };
export function toneColors(theme: Theme, tone: Slide["tone"]): Tone {
  const p = theme.palette;
  if (tone === "light") return { bg: p.background, ink: p.ink, muted: p.muted, accent: p.accent, accent2: p.accent2, surface: p.surface, rule: mix(p.muted, p.background, 0.55) };
  const bg = tone === "dark" ? p.dark : p.accent;
  const ink = readableOn(bg, p.background, "#FFFFFF", p.dark, p.ink);
  const muted = [0.25, 0.18, 0.1, 0].map(amount => mix(ink, bg, amount)).find(color => contrast(color, bg) >= 4.6) ?? ink;
  const accentOn = (color: string) => contrast(color, bg) >= 3 ? color : [0.3, 0.5, 0.7].map(amount => mix(color, ink, amount)).find(value => contrast(value, bg) >= 3) ?? ink;
  return { bg, ink, muted, accent: tone === "accent" ? ink : accentOn(p.accent), accent2: accentOn(p.accent2), surface: mix(bg, ink, 0.09), rule: mix(ink, bg, 0.7) };
}

const BODY_WIDTH: Record<Theme["fonts"], number> = { editorial: 0.52, modern: 0.52, geometric: 0.52, classic: 0.5, garamond: 0.46, grotesk: 0.5, humanist: 0.58, condensed: 0.52 };
type Metrics = { heading: number; body: number };
const metrics = (theme: Theme): Metrics => ({ heading: FONTS[theme.fonts].width, body: BODY_WIDTH[theme.fonts] });

/** Greedy word wrap estimate with a conservative average glyph width. */
export function estimateLines(text: string, width: number, size: number, charWidth: number) {
  const perLine = Math.max(1, Math.floor(width / (size * charWidth)));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines++;
    let current = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!current) current = word.length;
      else if (current + 1 + word.length <= perLine) current += 1 + word.length;
      else { lines++; current = word.length; }
      while (current > perLine) { lines++; current -= perLine; }
    }
  }
  return lines;
}
export const textHeight = (text: string, width: number, size: number, lh: number, charWidth: number) => Math.ceil(estimateLines(text, width, size, charWidth) * size * lh);
/** Largest size ≤ max (≥ min) whose wrapped text fits the box height. */
export function fitSize(text: string, width: number, height: number, max: number, min: number, lh: number, charWidth: number) {
  let size = max;
  while (size > min && textHeight(text, width, size, lh, charWidth) > height) size--;
  return size;
}

type Ctx = { theme: Theme; m: Metrics; c: Tone; prims: Prim[]; issues: string[]; index: number; total: number; deck: Pick<Deck, "title" | "assets"> };
function text(ctx: Ctx, value: string, box: { x: number; y: number; w: number; h?: number }, style: { font?: "heading" | "body"; size: number; min?: number; maxH?: number; weight?: 400 | 600 | 700; color?: string; align?: TextPrim["align"]; valign?: TextPrim["valign"]; lh?: number; tracking?: number; upper?: boolean; italic?: boolean; role?: TextPrim["role"] }) {
  const font = style.font ?? "body", lh = style.lh ?? (font === "heading" ? 1.08 : 1.4);
  const width = (font === "heading" ? ctx.m.heading : ctx.m.body) * (style.upper ? 1.18 : 1) * (style.weight && style.weight >= 600 ? 1.05 : 1);
  const content = style.upper ? value.toUpperCase() : value;
  const size = style.maxH ? fitSize(content, box.w, style.maxH, style.size, style.min ?? Math.round(style.size * 0.6), lh, width) : style.size;
  const raw = textHeight(content, box.w, size, lh, width), needed = raw + Math.ceil(size * 0.15);
  const h = box.h ?? needed;
  if ((box.h !== undefined && raw > box.h + 4) || (style.maxH !== undefined && raw > style.maxH + 4) || box.y + Math.min(h, raw) > H - 12)
    ctx.issues.push(`"${value.length > 48 ? `${value.slice(0, 48)}…` : value}" is too long for its space`);
  ctx.prims.push({ k: "text", x: box.x, y: box.y, w: box.w, h: Math.max(h, Math.ceil(size * lh)), text: value, font, size, weight: style.weight ?? (font === "heading" ? FONTS[ctx.theme.fonts].headingWeight as 400 | 600 | 700 : 400),
    color: style.color ?? ctx.c.ink, align: style.align ?? "left", valign: style.valign ?? "top", lh, ...(style.tracking ? { tracking: style.tracking } : {}), ...(style.upper ? { upper: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.role ? { role: style.role } : {}) });
  return Math.max(h, Math.ceil(size * lh));
}
const rect = (ctx: Ctx, prim: Omit<RectPrim, "k">) => ctx.prims.push({ k: "rect", ...prim });
const image = (ctx: Ctx, name: string, box: { x: number; y: number; w: number; h: number }) =>
  ctx.prims.push({ k: "image", ...box, name, alt: ctx.deck.assets.find(asset => asset.name === name)?.alt ?? "" });
const eyebrowStyle = (ctx: Ctx) => ({ size: 15, weight: 700 as const, color: ctx.c.accent, upper: true, tracking: 0.14 });

/** Title block at the top of content slides; returns the y where content starts. */
function header(ctx: Ctx, slide: Slide, width = CONTENT_W, x = MX) {
  let y = TOP;
  if (slide.eyebrow) y += text(ctx, slide.eyebrow, { x, y, w: width }, eyebrowStyle(ctx)) + 14;
  y += text(ctx, slide.title, { x, y, w: width }, { font: "heading", size: 46, min: 30, maxH: 120, role: "title" });
  return y;
}
function footer(ctx: Ctx) {
  const color = ctx.c.muted, title = ctx.deck.title.length > 90 ? `${ctx.deck.title.slice(0, 88)}…` : ctx.deck.title;
  text(ctx, title, { x: MX, y: 668, w: 860, h: 22 }, { size: 13, color, tracking: 0.04 });
  text(ctx, String(ctx.index + 1).padStart(2, "0"), { x: W - MX - 80, y: 668, w: 80, h: 22 }, { size: 13, color, align: "right", weight: 600 });
}
/** Stack of eyebrow/title/subtitle/body measured first, then vertically centred in a band. */
function centeredStack(ctx: Ctx, slide: Slide, area: { x: number; w: number; top: number; bottom: number; titleSize: number; titleMin: number; align?: TextPrim["align"]; bodyText?: string; rule?: boolean }) {
  const { x, w } = area, align = area.align ?? "left";
  const lhTitle = 1.06, titleW = (ctx.m.heading) * (FONTS[ctx.theme.fonts].headingWeight >= 600 ? 1.05 : 1);
  const titleSize = fitSize(slide.title, w, (area.bottom - area.top) * 0.62, area.titleSize, area.titleMin, lhTitle, titleW);
  const titleH = textHeight(slide.title, w, titleSize, lhTitle, titleW) + Math.ceil(titleSize * 0.15);
  const sub = area.bodyText ?? slide.subtitle ?? slide.body;
  const subSize = sub && sub.length > 160 ? 20 : 24;
  const subH = sub ? textHeight(sub, Math.min(w, 860), subSize, 1.4, ctx.m.body) + 6 : 0;
  const eyebrowH = slide.eyebrow ? 22 + 18 : 0, ruleH = area.rule ? 4 + 28 : 0;
  const total = ruleH + eyebrowH + titleH + (sub ? 26 + subH : 0);
  let y = Math.max(area.top, area.top + (area.bottom - area.top - total) / 2);
  if (area.rule) { rect(ctx, { x: align === "center" ? x + w / 2 - 28 : x, y, w: 56, h: 4, fill: ctx.c.accent }); y += ruleH; }
  if (slide.eyebrow) { text(ctx, slide.eyebrow, { x, y, w, h: 22 }, { ...eyebrowStyle(ctx), align }); y += eyebrowH; }
  text(ctx, slide.title, { x, y, w, h: titleH }, { font: "heading", size: titleSize, lh: lhTitle, align, role: "title" });
  y += titleH;
  if (sub) { y += 26; text(ctx, sub, { x: align === "center" ? x + (w - Math.min(w, 860)) / 2 : x, y, w: Math.min(w, 860), h: subH }, { size: subSize, color: ctx.c.muted, align, lh: 1.4 }); y += subH; }
  return y;
}

function bulletList(ctx: Ctx, points: NonNullable<Slide["points"]>, box: { x: number; y: number; w: number; bottom: number }) {
  const gap = 22, available = box.bottom - box.y;
  let size = 21;
  const heightAt = (s: number) => points.reduce((sum, point) => sum + (point.title ? Math.ceil(s * 1.3) + 4 : 0) + textHeight(point.text, box.w - 34, s, 1.4, ctx.m.body), 0) + gap * (points.length - 1);
  while (size > 15 && heightAt(size) > available) size--;
  let y = box.y;
  for (const point of points) {
    rect(ctx, { x: box.x, y: y + size * 0.45, w: 10, h: 10, fill: ctx.c.accent, radius: 2 });
    if (point.title) y += text(ctx, point.title, { x: box.x + 34, y, w: box.w - 34 }, { size, weight: 700 }) + 4;
    y += text(ctx, point.text, { x: box.x + 34, y, w: box.w - 34 }, { size, color: point.title ? ctx.c.muted : ctx.c.ink }) + gap;
  }
  return y;
}

export function chartColors(theme: Theme, c: Tone): ChartColors {
  return { ink: c.ink, muted: c.muted, grid: c.rule, series: [c.accent, c.accent2, mix(c.accent, c.bg, 0.5)], highlight: c.accent, dim: mix(c.accent2, c.bg, 0.35), background: c.bg };
}

function diagram(ctx: Ctx, slide: Slide, top: number) {
  const d = slide.diagram!, n = d.items.length, c = ctx.c, bottom = SAFE_BOTTOM;
  const label = (value: string, box: { x: number; y: number; w: number }, align: TextPrim["align"] = "center", color = c.ink) => text(ctx, value, box, { size: 21, weight: 700, align, color });
  const detail = (value: string | undefined, box: { x: number; y: number; w: number }, align: TextPrim["align"] = "center", color = c.muted) => value ? text(ctx, value, box, { size: 16, align, color, lh: 1.4 }) : 0;
  if (d.kind === "process" || d.kind === "timeline") {
    const col = CONTENT_W / n, mid = top + Math.max(90, (bottom - top) * 0.36);
    ctx.prims.push({ k: "line", x1: MX + col / 2, y1: mid, x2: MX + col * (n - 0.5), y2: mid, color: d.kind === "timeline" ? c.accent : c.rule, width: d.kind === "timeline" ? 3 : 2 });
    d.items.forEach((item, i) => {
      const cx = MX + col * (i + 0.5);
      if (d.kind === "process") {
        ctx.prims.push({ k: "ellipse", x: cx - 34, y: mid - 34, w: 68, h: 68, fill: i === n - 1 ? c.accent : c.bg, stroke: c.accent, strokeWidth: 3 });
        text(ctx, String(i + 1), { x: cx - 34, y: mid - 34, w: 68, h: 68 }, { font: "heading", size: 28, align: "center", valign: "middle", color: i === n - 1 ? readableOn(c.accent, c.bg, c.ink) : c.accent, weight: 700 });
        const h = label(item.label, { x: cx - col / 2 + 12, y: mid + 58, w: col - 24 });
        detail(item.detail, { x: cx - col / 2 + 12, y: mid + 58 + h + 8, w: col - 24 });
      } else {
        ctx.prims.push({ k: "ellipse", x: cx - 13, y: mid - 13, w: 26, h: 26, fill: c.bg, stroke: c.accent, strokeWidth: 4 });
        text(ctx, item.label, { x: cx - col / 2 + 8, y: mid - 74, w: col - 16, h: 52 }, { font: "heading", size: 26, align: "center", valign: "bottom", color: c.accent, weight: 700 });
        detail(item.detail, { x: cx - col / 2 + 12, y: mid + 34, w: col - 24 }, "center", c.ink);
      }
    });
    return;
  }
  if (d.kind === "pyramid" || d.kind === "funnel") {
    const tierGap = 10, height = Math.min(92, (bottom - top - 20 - tierGap * (n - 1)) / n), left = MX, maxW = 560, minW = 220;
    d.items.forEach((item, i) => {
      const rank = d.kind === "pyramid" ? i : n - 1 - i;
      const width = minW + (maxW - minW) * (n === 1 ? 1 : rank / (n - 1));
      const y = top + 20 + i * (height + tierGap), x = left + (maxW - width) / 2;
      const fill = mix(c.accent, c.accent2, n === 1 ? 0 : i / (n - 1));
      rect(ctx, { x, y, w: width, h: height, fill, radius: 4 });
      text(ctx, item.label, { x: x + 12, y, w: width - 24, h: height }, { size: 19, weight: 700, align: "center", valign: "middle", color: readableOn(fill, "#FFFFFF", "#111111") });
      if (item.detail) text(ctx, item.detail, { x: left + maxW + 56, y, w: CONTENT_W - maxW - 56, h: height }, { size: 18, valign: "middle", color: c.ink });
      ctx.prims.push({ k: "line", x1: x + width + 8, y1: y + height / 2, x2: left + maxW + 40, y2: y + height / 2, color: c.rule, width: 1.5 });
    });
    return;
  }
  if (d.kind === "matrix") {
    const gridTop = top + 24, gridH = bottom - gridTop - 30, gridW = 860, x0 = MX + 140, cellW = gridW / 2 - 6, cellH = gridH / 2 - 6;
    d.items.forEach((item, i) => {
      const x = x0 + (i % 2) * (cellW + 12), y = gridTop + Math.floor(i / 2) * (cellH + 12), strong = i === 1;
      const fill = strong ? c.accent : c.surface, ink = strong ? readableOn(c.accent, "#FFFFFF", c.ink) : c.ink;
      rect(ctx, { x, y, w: cellW, h: cellH, fill, radius: 6 });
      const h = text(ctx, item.label, { x: x + 28, y: y + 26, w: cellW - 56 }, { size: 26, weight: 700, color: ink, maxH: 70, min: 18 });
      if (item.detail) text(ctx, item.detail, { x: x + 28, y: y + 26 + h + 10, w: cellW - 56 }, { size: 19, color: strong ? ink : c.muted, lh: 1.4, maxH: cellH - h - 60, min: 14 });
    });
    if (d.axes) {
      text(ctx, `↑ ${d.axes.y}`, { x: MX, y: gridTop, w: 128, h: 60 }, { size: 15, weight: 700, color: c.accent, upper: true, tracking: 0.08 });
      text(ctx, `${d.axes.x} →`, { x: x0, y: gridTop + gridH + 8, w: gridW, h: 22 }, { size: 15, weight: 700, color: c.accent, upper: true, tracking: 0.08, align: "right" });
    }
    return;
  }
  // cycle
  const cy = top + (bottom - top) / 2 - 4, cx = W / 2, r = Math.max(90, Math.min(150, (bottom - top) / 2 - 78));
  ctx.prims.push({ k: "ellipse", x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: c.rule, strokeWidth: 2 });
  d.items.forEach((item, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / n, nx = cx + r * Math.cos(angle), ny = cy + r * Math.sin(angle);
    ctx.prims.push({ k: "ellipse", x: nx - 26, y: ny - 26, w: 52, h: 52, fill: c.accent });
    text(ctx, String(i + 1), { x: nx - 26, y: ny - 26, w: 52, h: 52 }, { font: "heading", size: 22, weight: 700, align: "center", valign: "middle", color: readableOn(c.accent, "#FFFFFF", "#111111") });
    const right = Math.cos(angle) > 0.2, left = Math.cos(angle) < -0.2, boxW = 300;
    const bx = right ? nx + 40 : left ? nx - 40 - boxW : nx - boxW / 2;
    const by = right || left ? ny - 24 : Math.sin(angle) < 0 ? ny - 34 - (item.detail ? 54 : 30) : ny + 34;
    const align = right ? "left" : left ? "right" : "center";
    const h = label(item.label, { x: bx, y: by, w: boxW }, align);
    detail(item.detail, { x: bx, y: by + h + 4, w: boxW }, align);
  });
}

function compose(ctx: Ctx, slide: Slide) {
  const c = ctx.c;
  switch (slide.layout) {
    case "cover": case "closing": {
      const centered = slide.layout === "closing";
      if (slide.image && !centered) {
        const left = slide.imageSide === "left";
        image(ctx, slide.image, { x: left ? 0 : 640, y: 0, w: 640, h: H });
        centeredStack(ctx, slide, { x: left ? 712 : MX, w: 496, top: 96, bottom: 600, titleSize: 64, titleMin: 36, rule: true });
      } else if (slide.image && centered) {
        image(ctx, slide.image, { x: 0, y: 0, w: W, h: H });
        rect(ctx, { x: 0, y: 0, w: W, h: H, fill: c.bg, opacity: 0.78 });
        centeredStack(ctx, slide, { x: 140, w: 1000, top: 110, bottom: 610, titleSize: 64, titleMin: 36, align: "center", rule: true });
      } else if (centered) {
        ctx.prims.push({ k: "ellipse", x: -180, y: 470, w: 420, h: 420, fill: c.accent2, opacity: 0.16 });
        ctx.prims.push({ k: "ellipse", x: 1060, y: -160, w: 360, h: 360, stroke: c.accent, strokeWidth: 3, opacity: 0.6 });
        centeredStack(ctx, slide, { x: 140, w: 1000, top: 110, bottom: 610, titleSize: 68, titleMin: 38, align: "center", rule: true });
      } else {
        ctx.prims.push({ k: "ellipse", x: 900, y: -190, w: 520, h: 520, fill: c.accent, opacity: 0.92 });
        ctx.prims.push({ k: "ellipse", x: 820, y: 120, w: 260, h: 260, stroke: c.accent2, strokeWidth: 3 });
        centeredStack(ctx, slide, { x: MX, w: 820, top: 300, bottom: 640, titleSize: 80, titleMin: 40, rule: true });
      }
      if (ctx.deck.title && slide.layout === "cover" && slide.title !== ctx.deck.title && !slide.image) text(ctx, ctx.deck.title, { x: MX, y: 60, w: 600, h: 22 }, { size: 14, weight: 700, color: c.muted, upper: true, tracking: 0.12 });
      return;
    }
    case "section": {
      const number = slide.eyebrow || String(ctx.index + 1).padStart(2, "0");
      text(ctx, number, { x: MX, y: 110, w: 900, h: 200 }, { font: "heading", size: number.length > 4 ? 64 : 180, color: c.accent, lh: 1, valign: "bottom", weight: FONTS[ctx.theme.fonts].headingWeight as 400 | 600 | 700 });
      ctx.prims.push({ k: "line", x1: MX, y1: 352, x2: W - MX, y2: 352, color: c.rule, width: 1.5 });
      let y = 384;
      y += text(ctx, slide.title, { x: MX, y, w: 960 }, { font: "heading", size: 60, min: 36, maxH: 170, role: "title" });
      const sub = slide.subtitle ?? slide.body;
      if (sub) text(ctx, sub, { x: MX, y: y + 18, w: 860 }, { size: 22, color: c.muted, maxH: 600 - y });
      return;
    }
    case "statement": {
      const top = 120, bottom = 610;
      const end = centeredStack(ctx, { ...slide, eyebrow: slide.eyebrow }, { x: MX + 44, w: 1040, top, bottom, titleSize: 62, titleMin: 34, bodyText: slide.body ?? slide.subtitle });
      const first = ctx.prims.find(prim => prim.k === "text" && prim.role === "title") as TextPrim | undefined;
      if (first) rect(ctx, { x: MX, y: first.y + 6, w: 6, h: Math.max(60, end - first.y - 6), fill: c.accent });
      footer(ctx);
      return;
    }
    case "points": {
      let y = header(ctx, slide);
      if (slide.body) y += 14 + text(ctx, slide.body, { x: MX, y: y + 14, w: 900 }, { size: 21, color: c.muted, maxH: 90 });
      const points = slide.points!, n = points.length, top = y + (n <= 3 ? 72 : 48);
      if (n <= 3) {
        const gap = 48, colW = (CONTENT_W - gap * (n - 1)) / n;
        points.forEach((point, i) => {
          const x = MX + i * (colW + gap);
          text(ctx, String(i + 1).padStart(2, "0"), { x, y: top, w: colW, h: 44 }, { font: "heading", size: 38, color: c.accent, lh: 1 });
          rect(ctx, { x, y: top + 58, w: colW, h: 2, fill: c.rule });
          let py = top + 82;
          if (point.title) py += text(ctx, point.title, { x, y: py, w: colW }, { size: n === 2 ? 30 : 26, weight: 700, maxH: 74, min: 19 }) + 12;
          text(ctx, point.text, { x, y: py, w: colW }, { size: n === 2 ? 24 : 22, color: point.title ? c.muted : c.ink, maxH: SAFE_BOTTOM - py, min: 15 });
        });
      } else {
        const rows = Math.ceil(n / 2), gapX = 56, colW = (CONTENT_W - gapX) / 2, rowH = (SAFE_BOTTOM - top) / rows;
        points.forEach((point, i) => {
          const x = MX + (i % 2) * (colW + gapX), py0 = top + Math.floor(i / 2) * rowH;
          text(ctx, String(i + 1).padStart(2, "0"), { x, y: py0, w: 56, h: 34 }, { font: "heading", size: 28, color: c.accent, lh: 1 });
          let py = py0;
          if (point.title) py += text(ctx, point.title, { x: x + 64, y: py, w: colW - 64 }, { size: 21, weight: 700, maxH: 56, min: 17 }) + 6;
          text(ctx, point.text, { x: x + 64, y: py, w: colW - 64 }, { size: 18, color: point.title ? c.muted : c.ink, maxH: py0 + rowH - py - 12, min: 14 });
        });
      }
      footer(ctx);
      return;
    }
    case "split": {
      const left = slide.imageSide === "left";
      image(ctx, slide.image!, { x: left ? 0 : 640, y: 0, w: 640, h: H });
      const x = left ? 712 : MX, w = 496;
      if (slide.points) {
        let y = TOP + 24;
        if (slide.eyebrow) y += text(ctx, slide.eyebrow, { x, y, w }, eyebrowStyle(ctx)) + 14;
        y += text(ctx, slide.title, { x, y, w }, { font: "heading", size: 42, min: 28, maxH: 150, role: "title" }) + 36;
        bulletList(ctx, slide.points, { x, y, w, bottom: SAFE_BOTTOM });
      } else centeredStack(ctx, slide, { x, w, top: 90, bottom: 620, titleSize: 46, titleMin: 30, bodyText: slide.body });
      text(ctx, String(ctx.index + 1).padStart(2, "0"), { x, y: 668, w: 80, h: 22 }, { size: 13, color: c.muted, weight: 600 });
      return;
    }
    case "stats": {
      const top = header(ctx, slide) + 40, stats = slide.stats!, n = stats.length, colW = CONTENT_W / n;
      const bottom = slide.body ? 560 : SAFE_BOTTOM;
      const valueSize = Math.min(...stats.map(stat => fitSize(stat.value, colW - 48, 110, n <= 2 ? 104 : n === 3 ? 88 : 72, 40, 1, ctx.m.heading * 1.05)));
      const blockH = valueSize + 22 + 34 + 60, y0 = top + Math.max(0, (bottom - top - blockH) / 2);
      stats.forEach((stat, i) => {
        const x = MX + i * colW + (i ? 32 : 0), w = colW - (i ? 56 : 32);
        if (i) ctx.prims.push({ k: "line", x1: MX + i * colW, y1: y0 + 8, x2: MX + i * colW, y2: y0 + blockH, color: c.rule, width: 1.5 });
        text(ctx, stat.value, { x, y: y0, w, h: valueSize * 1.05 }, { font: "heading", size: valueSize, color: c.accent, lh: 1, weight: FONTS[ctx.theme.fonts].headingWeight >= 600 ? 700 : 400 });
        const h = text(ctx, stat.label, { x, y: y0 + valueSize + 22, w }, { size: 21, weight: 700, maxH: 60, min: 16 });
        if (stat.detail) text(ctx, stat.detail, { x, y: y0 + valueSize + 30 + h, w }, { size: 16, color: c.muted, maxH: 70, min: 13 });
      });
      if (slide.body) text(ctx, slide.body, { x: MX, y: 580, w: CONTENT_W, h: 56 }, { size: 20, color: c.ink, maxH: 56, min: 15, valign: "bottom" });
      footer(ctx);
      return;
    }
    case "chart": {
      const top = header(ctx, slide) + 36, chart = slide.chart!;
      const panel = slide.body || slide.points;
      const chartW = panel ? 740 : CONTENT_W, bottom = chart.source ? 618 : 636;
      ctx.prims.push({ k: "chart", x: MX, y: top, w: chartW, h: bottom - top, chart, colors: chartColors(ctx.theme, c) });
      if (chart.source) text(ctx, chart.source, { x: MX, y: 626, w: chartW, h: 20 }, { size: 13, color: c.muted, italic: true });
      if (panel) {
        const px = MX + chartW + 48, pw = CONTENT_W - chartW - 48;
        rect(ctx, { x: px, y: top, w: pw, h: bottom - top, fill: c.surface, radius: 6 });
        rect(ctx, { x: px, y: top, w: 6, h: bottom - top, fill: c.accent });
        text(ctx, "Takeaway", { x: px + 34, y: top + 30, w: pw - 60, h: 22 }, eyebrowStyle(ctx));
        if (slide.body) text(ctx, slide.body, { x: px + 34, y: top + 68, w: pw - 60, h: bottom - top - 96 }, { font: "heading", size: 34, min: 18, maxH: bottom - top - 96, lh: 1.22 });
        else bulletList(ctx, slide.points!, { x: px + 34, y: top + 70, w: pw - 60, bottom: bottom - 24 });
      }
      footer(ctx);
      return;
    }
    case "diagram": {
      let top = header(ctx, slide);
      if (slide.body) top += 12 + text(ctx, slide.body, { x: MX, y: top + 12, w: 960 }, { size: 20, color: c.muted, maxH: 64 });
      diagram(ctx, slide, top + 40);
      footer(ctx);
      return;
    }
    case "compare": {
      const top = header(ctx, slide) + 40, cmp = slide.compare!, gap = 32, pw = (CONTENT_W - gap) / 2;
      const many = [cmp.left, cmp.right].some(side => side.points.length > 4 || side.points.some(point => point.length > 80));
      const limit = SAFE_BOTTOM - top;
      // Lay both sides out, shrinking the type until the taller side fits; then size the panels to it.
      const layout = (size: number) => {
        const sides = ([["left", cmp.left], ["right", cmp.right]] as const).map(([side, data], i) => {
          const x = MX + i * (pw + gap), strong = side === "right";
          const fill = strong ? c.accent : c.surface, ink = strong ? readableOn(c.accent, "#FFFFFF", "#111111", c.bg) : c.ink;
          const sub: Ctx = { ...ctx, prims: [], issues: [] };
          let y = top + 34;
          y += text(sub, data.heading, { x: x + 36, y, w: pw - 72 }, { font: "heading", size: 34, weight: 700, color: ink, maxH: 84, min: 22 }) + 26;
          for (const point of data.points) {
            sub.prims.push({ k: "line", x1: x + 36, y1: y + size * 0.7, x2: x + 52, y2: y + size * 0.7, color: strong ? ink : c.accent, width: 3 });
            y += text(sub, point, { x: x + 66, y, w: pw - 102 }, { size, color: ink }) + 16;
          }
          return { x, fill, prims: sub.prims, height: y - top + 18 };
        });
        return { sides, height: Math.max(...sides.map(side => side.height)) };
      };
      let size = many ? 20 : 23, result = layout(size);
      while (result.height > limit && size > 14) result = layout(--size);
      if (result.height > limit) ctx.issues.push("the comparison has too much text for one slide");
      const ph = Math.min(limit, Math.max(260, result.height));
      for (const side of result.sides) { rect(ctx, { x: side.x, y: top, w: pw, h: ph, fill: side.fill, radius: 8 }); ctx.prims.push(...side.prims); }
      footer(ctx);
      return;
    }
    case "quote": {
      const q = slide.quote!;
      const size = fitSize(q.text, 1000, 330, 48, 26, 1.25, ctx.m.heading);
      const h = textHeight(q.text, 1000, size, 1.25, ctx.m.heading) + 8, block = 120 + h + (q.attribution ? 56 : 0);
      const top = Math.max(40, (H - block) / 2 - 10), y = top + 120;
      text(ctx, "“", { x: MX + 60, y: top - 40, w: 200, h: 224 }, { font: "heading", size: 220, color: c.accent, lh: 1 });
      text(ctx, q.text, { x: MX + 72, y, w: 1000, h }, { font: "heading", size, lh: 1.25, italic: true, role: "title" });
      if (q.attribution) text(ctx, `— ${q.attribution}`, { x: MX + 72, y: y + h + 28, w: 900, h: 26 }, { size: 18, weight: 700, color: c.accent, upper: true, tracking: 0.1 });
      footer(ctx);
      return;
    }
    case "image": {
      image(ctx, slide.image!, { x: 0, y: 0, w: W, h: H });
      rect(ctx, { x: 0, y: 380, w: W, h: 340, fill: "#000000", opacity: 0.62, fade: "up" });
      const sub = slide.subtitle ?? slide.body;
      const subH = sub ? textHeight(sub, 900, 21, 1.4, ctx.m.body) + 6 : 0;
      const titleSize = fitSize(slide.title, 1000, 150, 50, 30, 1.08, ctx.m.heading);
      const titleH = textHeight(slide.title, 1000, titleSize, 1.08, ctx.m.heading) + 6;
      let y = 650 - subH - (sub ? 16 : 0) - titleH;
      if (slide.eyebrow) text(ctx, slide.eyebrow, { x: MX, y: y - 36, w: 800, h: 22 }, { ...eyebrowStyle(ctx), color: "#FFFFFF" });
      text(ctx, slide.title, { x: MX, y, w: 1000, h: titleH }, { font: "heading", size: titleSize, color: "#FFFFFF", role: "title" });
      y += titleH + 16;
      if (sub) text(ctx, sub, { x: MX, y, w: 900, h: subH }, { size: 21, color: "#F2F2F2" });
      return;
    }
  }
}

export function composeSlide(deck: Pick<Deck, "title" | "theme" | "assets">, slide: Slide, index: number, total: number): SlideScene {
  const c = toneColors(deck.theme, slide.tone);
  const ctx: Ctx = { theme: deck.theme, m: metrics(deck.theme), c, prims: [], issues: [], index, total, deck };
  compose(ctx, slide);
  return { background: c.bg, prims: ctx.prims, issues: [...new Set(ctx.issues)] };
}
