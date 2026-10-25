import type { Chart, Deck, ImagePlacement, Slide, Theme } from "./schema";
import { FONTS, contrast, mix, readableOn } from "./theme";
import type { DirectionSpec, FontRole, Weight } from "./directions";

/** Primitives shared by the HTML/PDF renderer and the native PPTX writer. Every
 * deck slide is composed once into these on a 1280×720 canvas, so what the user
 * approves in the preview is what they export. */
export const W = 1280, H = 720;

export type TextPrim = { k: "text"; x: number; y: number; w: number; h: number; text: string; font: FontRole; size: number; weight: Weight; color: string; align: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; lh: number; tracking?: number; upper?: boolean; italic?: boolean; role?: "title" | "body"; list?: TextList };
/** One text box holding a list: each line of `text` is an item with a hanging marker; items are `gap` px apart. The PPTX writes one bulleted text box. */
export type TextList = { marker: "dash" | "square"; color: string; indent: number; gap: number };
export type RectPrim = { k: "rect"; x: number; y: number; w: number; h: number; fill: string; opacity?: number; radius?: number; fade?: "up" | "left" | "right"; stroke?: string; strokeWidth?: number; noFill?: true };
export type EllipsePrim = { k: "ellipse"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };
export type LinePrim = { k: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number; arrow?: boolean; opacity?: number; dash?: boolean };
export type PathSeg = { op: "M" | "L"; x: number; y: number } | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: "Z" };
/** A vector shape in slide coordinates; the PPTX writer emits native custom geometry. */
export type PathPrim = { k: "path"; x: number; y: number; w: number; h: number; d: PathSeg[]; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };
/** Trusted generative artwork (gradients, dense patterns) as SVG markup in local
 * coordinates. It never contains user text; PPTX embeds it as a rendered PNG. */
export type ArtPrim = { k: "art"; x: number; y: number; w: number; h: number; svg: string; opacity?: number };
export type ImageTreatment = { kind: "duotone" | "mono"; dark: string; light: string };
export type ImagePrim = { k: "image"; x: number; y: number; w: number; h: number; name: string; alt: string; crop?: "center"; round?: boolean; mask?: "arch"; treatment?: ImageTreatment };
export type ChartColors = { ink: string; muted: string; grid: string; series: string[]; highlight: string; dim: string; background: string; highlightInk?: string };
/** text: multiplies the chart's label sizes (1 = the base sizes); a chart given more room sets its labels larger, the same in HTML and PPTX. */
export type ChartStyle = { mono?: boolean; radius: number; grid: boolean; text?: number };
export type ChartPrim = { k: "chart"; x: number; y: number; w: number; h: number; chart: Chart; colors: ChartColors; style?: ChartStyle };
export type Prim = TextPrim | RectPrim | EllipsePrim | LinePrim | ImagePrim | ChartPrim | PathPrim | ArtPrim;
export type SlideScene = { background: string; prims: Prim[]; issues: string[]; composition?: string; imagePlacement?: ImagePlacement };

/** `accent` is always readable as text on `bg` (≥3:1); `signal` is the raw brand accent for large fills and marks. */
export type Tone = { bg: string; ink: string; muted: string; accent: string; accent2: string; surface: string; rule: string; strong: string; onStrong: string; signal: string };
const readableAccent = (color: string, bg: string, ink: string) => contrast(color, bg) >= 3 ? color : [0.2, 0.35, 0.5, 0.65, 0.8].map(amount => mix(color, ink, amount)).find(value => contrast(value, bg) >= 3) ?? ink;
/** Colours for a slide's tone. A dark-ground direction sets ordinary slides on the palette's dark colour. */
export function toneColors(theme: Theme, tone: Slide["tone"], ground: "light" | "dark" = "light"): Tone {
  const p = theme.palette;
  const strongFor = (bg: string) => contrast(p.accent, bg) >= 1.8 ? p.accent : contrast(p.dark, bg) >= 1.8 ? p.dark : p.accent2;
  if (tone === "light" && ground === "light") {
    // A brand accent too pale to see on the page hands its marks to accent2; text uses a darkened, readable form of the same hue.
    const strong = strongFor(p.background), signal = contrast(p.accent, p.background) >= 1.25 ? p.accent : p.accent2;
    return { bg: p.background, ink: p.ink, muted: p.muted, accent: readableAccent(signal, p.background, p.ink), accent2: readableAccent(p.accent2, p.background, p.ink), surface: p.surface, rule: mix(p.muted, p.background, 0.55), strong, onStrong: readableOn(strong, "#FFFFFF", p.background, "#111111"), signal };
  }
  const bg = tone === "accent" ? p.accent : tone === "dark" && ground === "dark" ? mix(p.dark, "#000000", 0.45) : p.dark;
  const ink = readableOn(bg, p.background, "#FFFFFF", p.dark, p.ink);
  const muted = [0.25, 0.18, 0.1, 0].map(amount => mix(ink, bg, amount)).find(color => contrast(color, bg) >= 4.6) ?? ink;
  const accentOn = (color: string) => contrast(color, bg) >= 3 ? color : [0.3, 0.5, 0.7].map(amount => mix(color, ink, amount)).find(value => contrast(value, bg) >= 3) ?? ink;
  const accent = tone === "accent" ? ink : accentOn(p.accent);
  const strong = tone === "accent" ? (contrast(p.dark, bg) >= 1.6 ? p.dark : mix(bg, "#000000", 0.3)) : contrast(p.accent, bg) >= 1.6 ? p.accent : p.accent2;
  const signal = tone === "accent" ? ink : contrast(p.accent, bg) >= 1.6 ? p.accent : accent;
  return { bg, ink, muted, accent, accent2: accentOn(p.accent2), surface: mix(bg, ink, 0.09), rule: mix(ink, bg, 0.7), strong, onStrong: readableOn(strong, "#FFFFFF", p.background, "#111111"), signal };
}

/* ---------- text measurement ---------- */

/** Relative advance of one character, normalised so ordinary English text
 * averages 1.0 (Arial-like proportions). Counting characters alone let words
 * full of m, w and capitals overflow while i, l and t runs were over-reserved. */
const CLASS_NORM = 0.445;
export function glyphUnits(char: string) {
  const em = char === " " ? 0.278 : /[ijl]/.test(char) ? 0.222 : /[ftr]/.test(char) ? 0.3 : char === "m" ? 0.833 : char === "w" ? 0.722
    : /[ckszvxy]/.test(char) ? 0.5 : /[a-z0-9]/.test(char) ? 0.556 : char === "I" ? 0.278 : char === "M" ? 0.833 : char === "W" ? 0.944
    : /[CDGHNOQRU]/.test(char) ? 0.722 : /[EFLTJ]/.test(char) ? 0.611 : /[A-Z]/.test(char) ? 0.667 : /[.,:;!'|`]/.test(char) ? 0.278
    : /[()[\]{}\-–/\\"]/.test(char) ? 0.333 : /[%@]/.test(char) ? 0.95 : char === "—" ? 1 : /[&$€£¥#+=<>?…“”‘’·•]/.test(char) ? 0.6
    : /\p{Lu}/u.test(char) ? 0.72 : /\p{L}/u.test(char) && char.charCodeAt(0) < 0x2e80 ? 0.556 : 1;
  return em / CLASS_NORM;
}
/** Uppercase lines are fitted against each pairing's measured capital advance, normalised on the same sample. */
const CAPS_SAMPLE = "THE QUARTERLY PLAN TURNS SCATTERED LEADS INTO A STEADY PIPELINE OF QUALIFIED CUSTOMERS, WITH CLEAR OWNERS, WEEKLY REVIEWS AND 3 MEASURABLE GOALS.";
const CAPS_K = [...CAPS_SAMPLE].reduce((sum, char) => sum + glyphUnits(char), 0) / CAPS_SAMPLE.length;
export type MeasureMode = "prop" | "caps" | "mono";
/** In capitals, figures and currency signs run wider than the letters around them in condensed faces (Impact). */
const unitOf = (char: string, mode: MeasureMode) => mode === "mono" ? 1 : mode === "caps" ? glyphUnits(char.toUpperCase()) / CAPS_K * (/[0-9$€£¥%]/.test(char) ? 1.22 : 1) : glyphUnits(char);
/** Greedy word wrap estimate: `charWidth` is the face's padded average advance (em). */
export function estimateLines(text: string, width: number, size: number, charWidth: number, mode: MeasureMode = "prop") {
  const perLine = Math.max(1, width / (size * charWidth)), space = unitOf(" ", mode);
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines++;
    let current = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let units = 0; for (const char of word) units += unitOf(char, mode);
      if (!current) current = units;
      else if (current + space + units <= perLine) current += space + units;
      else { lines++; current = units; }
      while (current > perLine) { lines++; current -= perLine; }
    }
  }
  return lines;
}
/** Explicit, balanced line breaks for display text: the same number of lines the box was fitted for, each as
 * even as the measurement allows, so the preview, PDF and PPTX break a title at the same words and no line is
 * left with a single word (PowerPoint has no text-wrap: balance). Text that already has breaks, a single line,
 * or a word too long for the line keeps its own wrapping. */
export function balancedBreaks(text: string, width: number, size: number, charWidth: number, mode: MeasureMode = "prop") {
  if (text.includes("\n")) return text;
  const words = text.split(/\s+/).filter(Boolean), lines = estimateLines(text, width, size, charWidth, mode);
  if (lines < 2 || words.length < 2) return text;
  const space = unitOf(" ", mode), units = words.map(word => { let sum = 0; for (const char of word) sum += unitOf(char, mode); return sum; });
  const per = (w: number) => w / (size * charWidth);
  if (Math.max(...units) > per(width)) return text;
  const wrap = (limit: number) => {
    const out: string[][] = [[]];
    let current = 0;
    words.forEach((word, i) => {
      if (!out[out.length - 1].length) { out[out.length - 1].push(word); current = units[i]; }
      else if (current + space + units[i] <= limit) { out[out.length - 1].push(word); current += space + units[i]; }
      else { out.push([word]); current = units[i]; }
    });
    return out;
  };
  // Narrowest line length that still sets the text in the same number of lines.
  let lo = Math.max(...units), hi = per(width);
  for (let step = 0; step < 24; step++) { const mid = (lo + hi) / 2; if (wrap(mid).length <= lines) hi = mid; else lo = mid; }
  const balanced = wrap(hi);
  if (balanced.length !== lines) return text;
  // A short word alone on a line ("a", "of", "to") joins a neighbour when the line still fits.
  const width_ = (words_: string[]) => words_.reduce((sum, word, i) => { let u = 0; for (const char of word) u += unitOf(char, mode); return sum + u + (i ? space : 0); }, 0);
  for (let i = 0; i < balanced.length; i++) {
    if (balanced.length < 2 || balanced[i].length !== 1 || [...balanced[i][0]].length > 3) continue;
    if (i + 1 < balanced.length && width_([...balanced[i], ...balanced[i + 1]]) <= per(width)) { balanced[i + 1] = [...balanced[i], ...balanced[i + 1]]; balanced.splice(i, 1); i--; }
    else if (i > 0 && width_([...balanced[i - 1], ...balanced[i]]) <= per(width)) { balanced[i - 1] = [...balanced[i - 1], ...balanced[i]]; balanced.splice(i, 1); i--; }
  }
  return balanced.map(line => line.join(" ")).join("\n");
}
/** The widest single word, in px: a word can never wrap, so it must fit the box. */
export function longestWord(text: string, size: number, charWidth: number, mode: MeasureMode = "prop") {
  let best = 0;
  for (const word of text.split(/\s+/)) { let units = 0; for (const char of word) units += unitOf(char, mode); best = Math.max(best, units); }
  return best * size * charWidth;
}
export const textHeight = (text: string, width: number, size: number, lh: number, charWidth: number, mode: MeasureMode = "prop") => Math.ceil(estimateLines(text, width, size, charWidth, mode) * size * lh);
/** Largest size ≤ max (≥ min) whose wrapped text fits the box height. */
export function fitSize(text: string, width: number, height: number, max: number, min: number, lh: number, charWidth: number, mode: MeasureMode = "prop") {
  let size = max;
  while (size > min && (textHeight(text, width, size, lh, charWidth, mode) > height || longestWord(text, size, charWidth, mode) > width)) size--;
  return size;
}

type Metrics = { heading: number; body: number; headingBold: number; bodyBold: number; headingTitle: number; headingWeight: number; caps: number };
export const metrics = (theme: Theme): Metrics => {
  const font = FONTS[theme.fonts], headingBold = font.headingBold ?? 1.05;
  // Headings at the pairing's own weight are bold in PPTX only for some Office faces (see pptx.ts).
  const titleBold = font.pptxHeadingBold ?? (font.headingWeight >= 700 || !/Semibold/.test(font.pptxHeading));
  return { heading: font.width, body: font.bodyWidth, headingBold, bodyBold: font.bodyBold ?? 1.05, headingWeight: font.headingWeight, caps: font.caps,
    headingTitle: font.headingWeight < 600 || !titleBold ? 1 : headingBold };
};

/* ---------- composition context ---------- */

export type SectionRef = { index: number; title: string };
export type Ctx = {
  theme: Theme; dir: DirectionSpec; m: Metrics; c: Tone; prims: Prim[]; issues: string[];
  index: number; total: number; deck: Pick<Deck, "title" | "assets" | "author">; tone: Slide["tone"]; slide: Slide;
  /** Seeded per deck and slide, so generative art is stable across renders. */
  seed: number; sections: SectionRef[];
  /** The text zone when the slide's image takes part of the canvas (a side rail, a top band or a full-bleed scrim). Compositions lay out inside it. */
  frame?: Frame;
};
export type Frame = { x: number; r: number; y: number; b: number };
/** balance: explicit balanced line breaks (as display type always gets), e.g. for a list item's supporting text. */
export type TextStyle = { font?: FontRole; size: number; min?: number; maxH?: number; weight?: Weight; color?: string; align?: TextPrim["align"]; valign?: TextPrim["valign"]; lh?: number; tracking?: number; upper?: boolean; italic?: boolean; role?: TextPrim["role"]; list?: TextList; balance?: boolean };

/** Glyph width factor and measuring mode for one text style; bold widens by the
 * pairing's measured bold ratio and letter-spacing widens every glyph. */
export function glyphWidth(ctx: Ctx, style: Pick<TextStyle, "font" | "upper" | "weight" | "tracking">): { cw: number; mode: MeasureMode } {
  const font = style.font ?? "body";
  if (font === "mono") return { cw: 0.62 + (style.tracking ?? 0), mode: "mono" };
  const heading = font === "heading", weight = style.weight ?? (heading ? ctx.m.headingWeight : 400);
  const bold = weight < 600 ? 1 : !heading ? ctx.m.bodyBold : weight > ctx.m.headingWeight ? ctx.m.headingBold : ctx.m.headingTitle;
  if (heading && style.upper) return { cw: ctx.m.caps * 1.07 * Math.max(1, bold * 0.98) + (style.tracking ?? 0), mode: "caps" };
  return { cw: (heading ? ctx.m.heading : ctx.m.body) * bold + (style.tracking ?? 0), mode: "prop" };
}
const defaultLh = (style: TextStyle) => style.lh ?? ((style.font ?? "body") === "heading" ? 1.08 : 1.4);
export function measure(ctx: Ctx, value: string, w: number, style: TextStyle) {
  const { cw, mode } = glyphWidth(ctx, style);
  return textHeight(style.upper ? value.toUpperCase() : value, w, style.size, defaultLh(style), cw, mode);
}
/** Width of a single unwrapped line in px. */
export function textWidth(ctx: Ctx, value: string, style: TextStyle) {
  const { cw, mode } = glyphWidth(ctx, style), content = style.upper ? value.toUpperCase() : value;
  let units = 0; for (const char of content) units += unitOf(char, mode);
  return Math.ceil(units * style.size * cw);
}
/** Largest size for a style whose text fits w × maxH. */
export function fitStyle(ctx: Ctx, value: string, w: number, maxH: number, style: TextStyle) {
  const { cw, mode } = glyphWidth(ctx, style);
  const size = fitSize(style.upper ? value.toUpperCase() : value, w, maxH, style.size, style.min ?? Math.round(style.size * 0.6), defaultLh(style), cw, mode);
  return { size, h: textHeight(style.upper ? value.toUpperCase() : value, w, size, defaultLh(style), cw, mode) };
}
/** Display faces that run narrow (e.g. Instrument Serif) are set a little larger. */
export const scaled = (ctx: Ctx, size: number) => Math.round(size * (FONTS[ctx.theme.fonts].scale ?? 1));

const clip = (value: string) => value.length > 48 ? `${value.slice(0, 48)}…` : value;
/** Place one text box; returns its height. With maxH the size shrinks (to min) until it fits. */
export function text(ctx: Ctx, value: string, box: { x: number; y: number; w: number; h?: number }, style: TextStyle) {
  const font = style.font ?? "body", lh = defaultLh(style);
  const { cw, mode } = glyphWidth(ctx, style);
  const content = style.upper ? value.toUpperCase() : value;
  // A list's items wrap beside their markers and sit `gap` apart.
  const mw = box.w - (style.list?.indent ?? 0), gaps = style.list ? style.list.gap * (content.split("\n").length - 1) : 0;
  const size = style.maxH ? fitSize(content, mw, style.maxH - gaps, style.size, style.min ?? Math.round(style.size * 0.6), lh, cw, mode) : style.size;
  const raw = textHeight(content, mw, size, lh, cw, mode) + gaps, needed = raw + Math.ceil(size * 0.15);
  const h = box.h ?? needed;
  if ((box.h !== undefined && raw > box.h + 4) || (style.maxH !== undefined && raw > style.maxH + 4) || box.y + Math.min(h, raw) > H - 12 || longestWord(content, size, cw, mode) > mw + 2)
    ctx.issues.push(`"${clip(value)}" is too long for its space`);
  const weight = style.weight ?? (font === "heading" ? FONTS[ctx.theme.fonts].headingWeight as Weight : 400);
  // Small text in the accent colour (eyebrows, labels, roles) must read at 4.5:1; the accent is only guaranteed 3:1
  // (enough for large type), so small accent text takes a deeper form of the same hue.
  let color = style.color ?? ctx.c.ink;
  if (size < 24 && (color === ctx.c.accent || color === ctx.c.accent2) && contrast(color, ctx.c.bg) < 4.5)
    color = [0.15, 0.3, 0.45, 0.6, 0.75, 1].map(amount => mix(color, ctx.c.ink, amount)).find(value => contrast(value, ctx.c.bg) >= 4.5) ?? ctx.c.ink;
  // Titles and display type carry explicit balanced breaks (the same in HTML and PPTX).
  const display = style.role === "title" || (font === "heading" && size >= 20) || (style.balance && !style.list);
  const shown = display ? balancedBreaks(value, box.w, size, cw, mode) : value;
  ctx.prims.push({ k: "text", x: box.x, y: box.y, w: box.w, h: Math.max(h, Math.ceil(size * lh)), text: shown, font, size, weight,
    color, align: style.align ?? "left", valign: style.valign ?? "top", lh, ...(style.tracking !== undefined ? { tracking: style.tracking } : {}), ...(style.upper ? { upper: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.role ? { role: style.role } : {}), ...(style.list ? { list: style.list } : {}) });
  return Math.max(h, Math.ceil(size * lh));
}
export const rect = (ctx: Ctx, prim: Omit<RectPrim, "k">) => { ctx.prims.push({ k: "rect", ...prim }); };
export const ellipse = (ctx: Ctx, prim: Omit<EllipsePrim, "k">) => { ctx.prims.push({ k: "ellipse", ...prim }); };
export const line = (ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5, extra: Partial<LinePrim> = {}) => { ctx.prims.push({ k: "line", x1, y1, x2, y2, color, width, ...extra }); };
export const hline = (ctx: Ctx, x1: number, x2: number, y: number, color = ctx.c.rule, width = 1.5) => line(ctx, x1, y, x2, y, color, width);
export const vline = (ctx: Ctx, x: number, y1: number, y2: number, color = ctx.c.rule, width = 1.5) => line(ctx, x, y1, x, y2, color, width);
export function path(ctx: Ctx, d: PathSeg[], style: { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }) {
  const xs: number[] = [], ys: number[] = [];
  for (const seg of d) if (seg.op !== "Z") { xs.push(seg.x); ys.push(seg.y); if (seg.op === "C") { xs.push(seg.x1, seg.x2); ys.push(seg.y1, seg.y2); } }
  const x = Math.min(...xs), y = Math.min(...ys);
  ctx.prims.push({ k: "path", x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), d, ...style });
}
export const art = (ctx: Ctx, box: { x: number; y: number; w: number; h: number }, svg: string, opacity?: number) => { ctx.prims.push({ k: "art", ...box, svg, ...(opacity !== undefined ? { opacity } : {}) }); };
export function image(ctx: Ctx, name: string, box: { x: number; y: number; w: number; h: number }, extra: Partial<ImagePrim> = {}) {
  // Alt text: the asset's own, else its prompt's opening (an image is never announced by its file name).
  const asset = ctx.deck.assets.find(entry => entry.name === name), prompt = (asset?.prompt ?? "").split(/\n/)[0].trim();
  ctx.prims.push({ k: "image", ...box, name, alt: asset?.alt || (prompt.length > 160 ? `${prompt.slice(0, 157)}…` : prompt), ...extra });
}

/** Move composed primitives. */
export function shift(prims: Prim[], dy: number, dx = 0) {
  if (!dy && !dx) return;
  for (const prim of prims) if (prim.k === "line") { prim.y1 += dy; prim.y2 += dy; prim.x1 += dx; prim.x2 += dx; }
  else { prim.y += dy; prim.x += dx; if (prim.k === "path") for (const seg of prim.d) if (seg.op !== "Z") { seg.x += dx; seg.y += dy; if (seg.op === "C") { seg.x1 += dx; seg.x2 += dx; seg.y1 += dy; seg.y2 += dy; } } }
}
export const bottomOf = (prims: Prim[]) => Math.max(0, ...prims.map(prim => prim.k === "line" ? Math.max(prim.y1, prim.y2) : prim.y + prim.h));
export const topOf = (prims: Prim[]) => Math.min(H, ...prims.map(prim => prim.k === "line" ? Math.min(prim.y1, prim.y2) : prim.y));
/** Compose a block in a sub-context, then place it in [top, bottom] by bias (0 top, 0.5 centre, 1 bottom). */
/** Compose into a trial context and keep the result only when it raised no issues. */
export function tryCompose(ctx: Ctx, build: (sub: Ctx) => void) {
  const sub: Ctx = { ...ctx, prims: [], issues: [] };
  build(sub);
  if (sub.issues.length) return false;
  ctx.prims.push(...sub.prims);
  return true;
}
export function placed(ctx: Ctx, top: number, bottom: number, build: (sub: Ctx) => void, bias = 0.42) {
  const sub: Ctx = { ...ctx, prims: [], issues: [] };
  build(sub);
  const free = bottom - Math.max(top, bottomOf(sub.prims));
  if (free > 8) shift(sub.prims, Math.round(free * bias));
  ctx.prims.push(...sub.prims);
  ctx.issues.push(...sub.issues);
}

/* ---------- seeded randomness ---------- */
export function hash(value: string) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: number) {
  let a = seed || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const initials = (name: string) => name.split(/\s+/).filter(word => /^[\p{L}\p{N}]/u.test(word)).slice(0, 2).map(word => [...word][0].toUpperCase()).join("") || "•";
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
