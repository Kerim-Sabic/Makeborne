import type { Slide } from "./schema";
import { FONTS, mix, readableOn, contrast } from "./theme";
import { H, ROMAN, W, ellipse, fitStyle, hline, line, measure, path, rect, scaled, text, textWidth, type Ctx, type TextStyle, type TextPrim } from "./scene-kit";
import { archPath, glyph, halfPath, quarterPath } from "./graphics";
import type { Weight } from "./directions";

/** Direction-aware typography and page furniture: labels, display type,
 * content headers, footers, panels and numerals. Compositions use these so one
 * composition reads differently in every art direction. */

export const area = (ctx: Ctx) => ({ x: ctx.dir.mx, y: ctx.dir.top, w: W - 2 * ctx.dir.mx, r: W - ctx.dir.mx, b: ctx.dir.bottom });
const headingWeight = (ctx: Ctx) => FONTS[ctx.theme.fonts].headingWeight as Weight;

export function labelStyle(ctx: Ctx, extra: Partial<TextStyle> = {}): TextStyle {
  const l = ctx.dir.label, color = l.color === "accent" ? ctx.c.accent : l.color === "muted" ? ctx.c.muted : ctx.c.ink;
  return { font: l.font, size: l.size, weight: l.weight, upper: l.upper, tracking: l.tracking, color, lh: 1.3, ...extra };
}
/** Labels carry the direction's prefix (e.g. "// "), except attributions that already open with a dash. */
export const labelText = (ctx: Ctx, value: string) => /^[—–-]/.test(value) ? value : `${ctx.dir.label.prefix ?? ""}${value}`;
/** A label line; long labels shrink, then wrap. Returns the height. */
export function label(ctx: Ctx, value: string, box: { x: number; y: number; w: number; h?: number }, extra: Partial<TextStyle> = {}) {
  const style = labelStyle(ctx, extra);
  return text(ctx, labelText(ctx, value), box, { ...style, maxH: box.h ?? Math.ceil(style.size * 1.3 * 2) + 2, min: Math.min(style.size, 12) });
}
export const labelWidth = (ctx: Ctx, value: string, extra: Partial<TextStyle> = {}) => textWidth(ctx, labelText(ctx, value), labelStyle(ctx, extra)) + 4;

export function displayStyle(ctx: Ctx, size: number, extra: Partial<TextStyle> = {}): TextStyle {
  const d = ctx.dir.display;
  // Capitals need air; mixed case keeps the pairing's own (usually negative) display tracking.
  return { font: "heading", size: scaled(ctx, size), upper: d.upper, lh: d.lh, weight: d.weight ?? headingWeight(ctx), ...(d.upper ? { tracking: d.tracking ?? 0.01 } : {}), role: "title", ...extra };
}
/** Fit display type into a box; returns the size and natural height without placing it. */
export const fitDisplay = (ctx: Ctx, value: string, w: number, maxH: number, size: number, min = 30, extra: Partial<TextStyle> = {}) => fitStyle(ctx, value, w, maxH, { ...displayStyle(ctx, size, extra), min: scaled(ctx, min) });
/** Place display type in a box (size fitted to the box height). */
export function display(ctx: Ctx, value: string, box: { x: number; y: number; w: number; h: number }, size: number, extra: Partial<TextStyle> & { min?: number } = {}) {
  const style = { ...displayStyle(ctx, size, extra), min: scaled(ctx, extra.min ?? 30) };
  const fit = fitStyle(ctx, value, box.w, box.h, style);
  // A little room under the last line: Office faces sit lower in their line box than the web faces.
  text(ctx, value, { x: box.x, y: box.y, w: box.w, h: Math.max(box.h, fit.h + Math.ceil(fit.size * 0.06)) }, { ...style, size: fit.size, maxH: undefined, min: undefined });
  return fit;
}
export const bodyStyle = (ctx: Ctx, extra: Partial<TextStyle> = {}): TextStyle => ({ size: ctx.dir.sizes.body, color: ctx.c.muted, lh: 1.42, ...extra });
export const leadStyle = (ctx: Ctx, extra: Partial<TextStyle> = {}): TextStyle => {
  const editorial = ctx.dir.id === "editorial" || ctx.dir.id === "luxury";
  return { size: editorial ? scaled(ctx, ctx.dir.sizes.lead) : ctx.dir.sizes.lead, color: ctx.c.muted, lh: 1.36, ...(editorial ? { font: "heading" as const, italic: true, weight: 400 as Weight } : {}), ...extra };
};

export function numeral(ctx: Ctx, index: number) {
  const style = ctx.dir.numerals.style;
  return style === "roman" ? ROMAN[index] ?? String(index + 1) : style === "padded" ? String(index + 1).padStart(2, "0") : String(index + 1);
}
export function numeralStyle(ctx: Ctx, size: number, extra: Partial<TextStyle> = {}): TextStyle {
  const n = ctx.dir.numerals, color = n.color === "accent" ? ctx.c.accent : n.color === "muted" ? ctx.c.muted : ctx.c.ink;
  return { font: n.font, size: n.font === "heading" ? scaled(ctx, size) : Math.round(size * 0.82), weight: n.weight ?? (n.font === "mono" ? 400 : headingWeight(ctx)), color, lh: 1, ...extra };
}
/** The deck's chapter number for a section slide (its eyebrow when that is short and numeric). */
export function sectionNumber(ctx: Ctx, slide: Slide) {
  if (slide.eyebrow && slide.eyebrow.length <= 4) return slide.eyebrow;
  const order = ctx.sections.findIndex(section => section.index === ctx.index);
  return numeral(ctx, order >= 0 ? order : 0);
}

/** Title block of a content slide in the direction's manner; returns where content may start. */
export function header(ctx: Ctx, slide: Slide, opts: { x?: number; w?: number; size?: number; standfirst?: string; maxLines?: number } = {}) {
  const a = area(ctx), d = ctx.dir, c = ctx.c, x = opts.x ?? a.x, w = opts.w ?? a.w, size = opts.size ?? d.sizes.headline;
  const center = d.header === "centered";
  let y = a.y;
  const eyebrow = slide.eyebrow;
  // Directions with a brand device in the top-right corner keep the headline clear of it.
  const device = signature(ctx, opts.x === undefined && opts.w === undefined && !center);
  const titleBox = (tx: number, ty: number, tw0: number) => {
    const tw = tw0 - (device && tx + tw0 > W - ctx.dir.mx - device ? device : 0);
    const max = Math.ceil(scaled(ctx, size) * d.display.lh * (opts.maxLines ?? 2) + 6);
    const fit = fitDisplay(ctx, slide.title, tw, max, size, 30);
    text(ctx, slide.title, { x: tx, y: ty, w: tw, h: fit.h + Math.ceil(fit.size * 0.12) }, { ...displayStyle(ctx, size), size: fit.size, align: center ? "center" : "left" });
    return fit.h + Math.ceil(fit.size * 0.12);
  };
  switch (d.header) {
    case "rule": {
      hline(ctx, x, x + w, y, c.ink, 1.5);
      const hang = Math.min(296, Math.round(w * 0.25));
      if (eyebrow) label(ctx, eyebrow, { x, y: y + 18, w: hang - 24 });
      y += 18 + titleBox(x + hang, y + 14, w - hang);
      break;
    }
    case "kicker": {
      if (eyebrow) { rect(ctx, { x, y: y + 8, w: 28, h: 2, fill: c.signal }); y += label(ctx, eyebrow, { x: x + 40, y, w: w - 40 }) + 14; }
      y += titleBox(x, y, w);
      break;
    }
    case "centered": {
      if (eyebrow) { y += label(ctx, eyebrow, { x, y, w }, { align: "center" }) + 12; }
      rect(ctx, { x: x + w / 2 - 20, y, w: 40, h: 1, fill: c.accent }); y += 22;
      y += titleBox(x, y, w);
      break;
    }
    case "pill": {
      if (eyebrow) {
        const lw = Math.min(w, labelWidth(ctx, eyebrow) + 36);
        rect(ctx, { x, y, w: lw, h: 32, fill: c.strong, radius: 16 });
        label(ctx, eyebrow, { x: x + 18, y: y + 7, w: lw - 30, h: 20 }, { color: c.onStrong });
        y += 32 + 18;
      }
      y += titleBox(x, y, w);
      break;
    }
    case "mono": {
      if (eyebrow) {
        const lh = label(ctx, eyebrow, { x, y, w: Math.min(w, labelWidth(ctx, eyebrow) + 8) });
        hline(ctx, x + Math.min(w - 40, labelWidth(ctx, eyebrow) + 20), x + w, y + 9, c.rule, 1);
        y += lh + 16;
      }
      y += titleBox(x, y, w);
      break;
    }
    case "bar": {
      rect(ctx, { x, y, w: 72, h: 12, fill: c.signal });
      if (eyebrow) label(ctx, eyebrow, { x: x + w - 420, y: y - 2, w: 420 }, { align: "right" });
      y += 34;
      y += titleBox(x, y, w);
      break;
    }
    case "boxed": {
      if (eyebrow) {
        const heavy = d.panel === "heavy", lw = Math.min(w, labelWidth(ctx, eyebrow) + 28);
        if (heavy) rect(ctx, { x, y, w: lw, h: 32, fill: c.ink }); else rect(ctx, { x, y, w: lw, h: 30, fill: c.bg, noFill: true, stroke: c.ink, strokeWidth: 1 });
        label(ctx, eyebrow, { x: x + 14, y: y + (heavy ? 7 : 6), w: lw - 22, h: 20 }, heavy ? { color: c.bg } : {});
        y += 32 + 16;
      }
      y += titleBox(x, y, w);
      if (d.panel === "heavy") { hline(ctx, x, x + w, y + 8, c.ink, d.rule?.width ?? 4); y += 12; }
      break;
    }
    case "tab": {
      rect(ctx, { x, y: y - 6, w: 56, h: 8, fill: c.signal }); y += 20;
      if (eyebrow) y += label(ctx, eyebrow, { x, y, w }) + 8;
      y += titleBox(x, y, w);
      break;
    }
    default: {
      if (eyebrow) y += label(ctx, eyebrow, { x, y, w }) + 12;
      y += titleBox(x, y, w);
    }
  }
  if (opts.standfirst) y += 12 + text(ctx, opts.standfirst, { x: center ? x + w * 0.1 : x, y: y + 12, w: center ? w * 0.8 : Math.min(w, 900) }, { ...leadStyle(ctx), size: 22, min: 18, maxH: 64, align: center ? "center" : "left" });
  return y;
}

/** A small, recurring brand device in the top-right corner of content slides. Returns the width it reserves. */
export function signature(ctx: Ctx, draw: boolean) {
  const d = ctx.dir, c = ctx.c, a = area(ctx), p = ctx.theme.palette;
  if (d.id === "colorblock") {
    if (draw) {
      const s = 34, x = a.r - s * 3, y = a.y - 2, fills = [p.accent, p.accent2, p.dark];
      fills.forEach((fill, i) => { rect(ctx, { x: x + i * s, y, w: s, h: s, fill }); });
      path(ctx, quarterPath(x, y, s, 2), { fill: p.background });
      ellipse(ctx, { x: x + s + 7, y: y + 7, w: s - 14, h: s - 14, fill: p.background });
      path(ctx, halfPath({ x: x + 2 * s, y, w: s, h: s }, 0), { fill: p.accent });
    }
    return 130;
  }
  if (d.id === "organic") {
    if (draw) { path(ctx, archPath({ x: a.r - 34, y: a.y - 4, w: 34, h: 46 }), { fill: c.accent2 }); ellipse(ctx, { x: a.r - 50, y: a.y - 10, w: 24, h: 24, fill: c.signal }); }
    return 90;
  }
  if (d.id === "tech") {
    if (draw) ctx.prims.unshift({ k: "art", x: W - 520, y: 0, w: 520, h: 320, svg: `<defs><radialGradient id="sg${ctx.index}" cx="85%" cy="0%" r="80%"><stop offset="0" stop-color="${p.accent}" stop-opacity="0.32"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient></defs><rect width="520" height="320" fill="url(#sg${ctx.index})"/>` });
    return 0;
  }
  return 0;
}

/** Running page furniture for content slides. */
export function footer(ctx: Ctx) {
  // Architectural sheets carry crop marks; technical decks carry corner brackets.
  if (ctx.dir.id === "architect" || ctx.dir.id === "tech") {
    const m = 20, l = ctx.dir.id === "architect" ? 18 : 12, color = ctx.dir.id === "architect" ? ctx.c.ink : ctx.c.rule;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { line(ctx, x, y, x + dx * l, y, color, 1); line(ctx, x, y, x, y + dy * l, color, 1); }
  }
  const d = ctx.dir, c = ctx.c, a = area(ctx), page = String(ctx.index + 1).padStart(2, "0"), total = String(ctx.total).padStart(2, "0");
  const title = ctx.deck.title.length > 80 ? `${ctx.deck.title.slice(0, 78)}…` : ctx.deck.title, y = 672;
  const small = (value: string, box: { x: number; w: number; align?: TextPrim["align"] }, extra: Partial<TextStyle> = {}) => text(ctx, value, { x: box.x, y, w: box.w, h: 20 }, { size: 13, color: c.muted, align: box.align ?? "left", lh: 1.3, ...extra });
  switch (d.footer) {
    case "running": hline(ctx, a.x, a.r, 660, c.rule, 1); small(title, { x: a.x, w: 760 }); small(`${page} / ${total}`, { x: a.r - 120, w: 120, align: "right" }, { weight: 600 }); return;
    case "folio": hline(ctx, a.x, a.r, 660, c.rule, 1); small(title, { x: a.x, w: 760 }, { upper: true, tracking: 0.14, size: 12 }); small(page, { x: a.r - 80, w: 80, align: "right" }, { font: "heading", size: 16, italic: true, color: c.ink }); return;
    case "corner": small(page, { x: a.r - 80, w: 80, align: "right" }, { weight: 700, color: c.ink, size: 15 }); return;
    case "center": small(`—  ${page}  —`, { x: W / 2 - 100, w: 200, align: "center" }, { tracking: 0.3, size: 12 }); return;
    case "mono": rect(ctx, { x: a.x, y: y + 5, w: 8, h: 8, fill: c.accent }); small(`${page}/${total}`, { x: a.x + 18, w: 120 }, { font: "mono" }); small(title, { x: a.r - 700, w: 700, align: "right" }, { font: "mono", upper: true, size: 12 }); return;
    case "bar": hline(ctx, a.x, a.r, 656, c.ink, d.rule?.width ?? 4); small(title, { x: a.x, w: 800 }, { font: "mono", upper: true, color: c.ink, weight: 700 }); small(`[${page}]`, { x: a.r - 120, w: 120, align: "right" }, { font: "mono", color: c.ink, weight: 700 }); return;
    case "pill": small(title, { x: a.x, w: 760 }); rect(ctx, { x: a.r - 56, y: y - 6, w: 56, h: 30, fill: c.surface, radius: 15 }); text(ctx, page, { x: a.r - 56, y: y - 6, w: 56, h: 30 }, { size: 13, weight: 700, color: c.ink, align: "center", valign: "middle", lh: 1.2 }); return;
    case "box": small(title, { x: a.x, w: 760 }, { font: "mono", upper: true, size: 12 }); rect(ctx, { x: a.r - 52, y: y - 6, w: 52, h: 30, fill: c.bg, noFill: true, stroke: c.ink, strokeWidth: 1 }); text(ctx, page, { x: a.r - 52, y: y - 6, w: 52, h: 30 }, { font: "mono", size: 13, color: c.ink, align: "center", valign: "middle", lh: 1.2 }); line(ctx, a.r - 72, y + 9, a.r - 60, y + 9, c.ink, 1); return;
    default: return;
  }
}

export type PanelInk = { ink: string; muted: string; accent: string; fill?: string };
/** Draw a container in the direction's manner. `strong` marks the highlighted one; `tint` cycles fills for colour-block decks. */
export function panel(ctx: Ctx, box: { x: number; y: number; w: number; h: number }, strong = false, tint = -1): PanelInk {
  const d = ctx.dir, c = ctx.c, p = ctx.theme.palette, radius = Math.min(d.radius, box.h / 2, box.w / 2);
  if (strong) {
    rect(ctx, { x: box.x, y: box.y, w: box.w, h: box.h, fill: c.strong, radius, ...(d.panel === "heavy" ? { stroke: c.ink, strokeWidth: d.rule?.width ?? 4 } : {}) });
    const ink = c.onStrong;
    return { ink, muted: [0.2, 0.12, 0].map(a => mix(ink, c.strong, a)).find(color => contrast(color, c.strong) >= 4.6) ?? ink, accent: ink, fill: c.strong };
  }
  if (tint >= 0 && (d.id === "colorblock" || d.id === "organic")) {
    const fills = d.id === "colorblock" ? [p.accent2, p.dark, mix(p.accent, p.background, 0.7), p.surface] : [p.surface, mix(p.accent2, p.background, 0.78), mix(p.accent, p.background, 0.82)];
    const fill = fills[tint % fills.length];
    rect(ctx, { x: box.x, y: box.y, w: box.w, h: box.h, fill, radius });
    const ink = readableOn(fill, p.ink, "#FFFFFF", p.background);
    return { ink, muted: [0.25, 0.15, 0].map(a => mix(ink, fill, a)).find(color => contrast(color, fill) >= 4.6) ?? ink, accent: contrast(c.accent, fill) >= 3 ? c.accent : ink, fill };
  }
  switch (d.panel) {
    case "fill": rect(ctx, { x: box.x, y: box.y, w: box.w, h: box.h, fill: c.surface, radius }); return { ink: c.ink, muted: contrast(c.muted, c.surface) >= 4.5 ? c.muted : c.ink, accent: contrast(c.accent, c.surface) >= 3 ? c.accent : c.ink, fill: c.surface };
    case "outline": rect(ctx, { x: box.x, y: box.y, w: box.w, h: box.h, fill: c.bg, noFill: true, stroke: d.id === "architect" ? c.ink : c.rule, strokeWidth: 1, radius }); return { ink: c.ink, muted: c.muted, accent: c.accent };
    case "heavy": rect(ctx, { x: box.x, y: box.y, w: box.w, h: box.h, fill: c.bg, stroke: c.ink, strokeWidth: d.rule?.width ?? 4 }); return { ink: c.ink, muted: c.muted, accent: c.accent, fill: c.bg };
    default: return { ink: c.ink, muted: c.muted, accent: c.accent };
  }
}

/** Small mark that opens a card or list item, in the direction's manner. */
export function marker(ctx: Ctx, index: number, x: number, y: number, s: number, color: string) {
  const id = ctx.dir.id;
  if (id === "colorblock" || id === "organic") glyph(ctx, index, x, y, s, color);
  else if (id === "tech" || id === "architect") glyph(ctx, index, x, y, s, color, true);
  else if (id === "luxury") glyph(ctx, 5, x + s * 0.3, y + s * 0.3, s * 0.4, color);
  else rect(ctx, { x, y, w: s * 0.5, h: s * 0.5, fill: color });
}

/** Optical fill for a direction's rules (used for dividers inside compositions). */
export const ruleColor = (ctx: Ctx) => !ctx.dir.rule ? ctx.c.rule : ctx.dir.rule.color === "ink" ? ctx.c.ink : ctx.dir.rule.color === "accent" ? ctx.c.accent : ctx.c.rule;
export const ruleWidth = (ctx: Ctx, heavy = false) => !ctx.dir.rule ? 1.5 : heavy ? ctx.dir.rule.width : Math.min(ctx.dir.rule.width, 2);
export const divider = (ctx: Ctx, x1: number, x2: number, y: number, heavy = false) => line(ctx, x1, y, x2, y, heavy ? ruleColor(ctx) : ctx.dir.rule?.width && ctx.dir.rule.width >= 4 ? ctx.c.ink : ctx.c.rule, heavy ? ruleWidth(ctx, true) : ctx.dir.rule?.width && ctx.dir.rule.width >= 4 ? 2 : 1);

/** Safe vertical bounds for full-slide compositions without page furniture. */
export const FULL = { top: 48, bottom: H - 48 };
export const measureBody = (ctx: Ctx, value: string, w: number, size = ctx.dir.sizes.body) => measure(ctx, value, w, bodyStyle(ctx, { size }));

export type StackSpec = {
  label?: string; title: string; size: number; min?: number; sub?: string; subStyle?: Partial<TextStyle>; subW?: number;
  align?: TextPrim["align"]; titleColor?: string; labelColor?: string; gap?: number; rule?: boolean; extra?: Partial<TextStyle>; maxTitleH?: number;
};
/** Label, display title and standfirst measured together, then placed in a box (anchored top, middle or bottom). */
export function stack(ctx: Ctx, spec: StackSpec, box: { x: number; y: number; w: number; h: number }, anchor: "top" | "middle" | "bottom" = "middle") {
  const align = spec.align ?? "left", lStyle = labelStyle(ctx, { align, ...(spec.labelColor ? { color: spec.labelColor } : {}) });
  const labelH = spec.label ? measure(ctx, labelText(ctx, spec.label), box.w, lStyle) : 0;
  const subW = Math.min(box.w, spec.subW ?? box.w);
  let subStyle: TextStyle = { ...leadStyle(ctx), align, ...spec.subStyle };
  let subH = spec.sub ? measure(ctx, spec.sub, subW, subStyle) : 0;
  while (spec.sub && subH > box.h * 0.38 && subStyle.size > 19) { subStyle = { ...subStyle, size: subStyle.size - 1 }; subH = measure(ctx, spec.sub, subW, subStyle); }
  const gapL = spec.label ? 20 : 0, gapS = spec.sub ? (spec.gap ?? 28) : 0, ruleH = spec.rule ? 34 : 0;
  const titleMax = Math.min(spec.maxTitleH ?? Infinity, box.h - labelH - gapL - subH - gapS - ruleH);
  const fit = fitDisplay(ctx, spec.title, box.w, titleMax, spec.size, spec.min ?? 34, spec.extra);
  if (fit.h > titleMax + 4) ctx.issues.push(`"${spec.title.length > 48 ? `${spec.title.slice(0, 48)}…` : spec.title}" is too long for its space`);
  const titleH = fit.h + Math.ceil(fit.size * 0.1), total = ruleH + labelH + gapL + titleH + gapS + subH;
  let y = Math.max(box.y, anchor === "top" ? box.y : anchor === "bottom" ? box.y + box.h - total : box.y + (box.h - total) / 2);
  const top = y;
  if (spec.rule) { rect(ctx, { x: align === "center" ? box.x + box.w / 2 - 24 : align === "right" ? box.x + box.w - 48 : box.x, y, w: 48, h: 3, fill: ctx.c.accent }); y += ruleH; }
  if (spec.label) { text(ctx, labelText(ctx, spec.label), { x: box.x, y, w: box.w, h: labelH }, lStyle); y += labelH + gapL; }
  const titleTop = y;
  text(ctx, spec.title, { x: box.x, y, w: box.w, h: titleH }, { ...displayStyle(ctx, spec.size, spec.extra), size: fit.size, align, color: spec.titleColor ?? ctx.c.ink });
  y += titleH;
  if (spec.sub) { y += gapS; text(ctx, spec.sub, { x: align === "center" ? box.x + (box.w - subW) / 2 : align === "right" ? box.x + box.w - subW : box.x, y, w: subW, h: subH }, subStyle); y += subH; }
  return { top, bottom: y, titleTop, titleBottom: titleTop + titleH, titleSize: fit.size };
}
