import type { Slide } from "./schema";
import { FONTS, mix, readableOn, contrast } from "./theme";
import { H, W, ellipse, estimateLines, glyphWidth, hline, measure, placed, rect, scaled, text, textWidth, tryCompose, vline, line, initials, image, type Ctx, type TextStyle, type ChartColors, type Tone } from "./scene-kit";
import { area, bodyStyle, display, displayStyle, divider, fitDisplay, footer, header, headlineUp, readableMark, label, labelStyle, leadStyle, marker, numberedRows, numeral, numeralMark, numeralStyle, panel, stack, ruleColor } from "./design";
import { formatValue } from "./chart-svg";
import { arrowPath } from "./graphics";
import { path } from "./scene-kit";

/** Points, agenda, numbers, charts, diagrams, comparisons, people, pricing and tables. */

const titleStyle = (ctx: Ctx, size: number, extra: Partial<TextStyle> = {}): TextStyle => ({ ...displayStyle(ctx, size), role: undefined, lh: 1.14, ...(ctx.dir.display.upper ? { tracking: 0.01 } : {}), ...extra });
/** Largest step whose tallest column fits the band. */
function steps<T>(options: T[], fits: (option: T) => boolean) { return options.find(fits) ?? options[options.length - 1]; }

/* ---------- points ---------- */

export function pointsColumns(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, points = slide.points!, n = points.length;
  let top = header(ctx, slide, { standfirst: slide.body, size: headlineUp(ctx) });
  top += 44;
  const gap = n === 4 ? 32 : 48, colW = (a.w - gap * (n - 1)) / n, band = a.b - top;
  const numSize = Math.round((n <= 3 ? 64 : 52) * Math.max(1, ctx.dir.sizes.number / 176)), center = ctx.dir.axis === "center", align = center ? "center" as const : "left" as const;
  const sizes = n <= 2 ? [[38, 25], [34, 23], [30, 22], [26, 21]] : n === 3 ? [[32, 23], [29, 22], [26, 21], [24, 20]] : [[28, 21], [26, 20], [24, 19]];
  const columnH = ([t, b]: number[]) => Math.max(...points.map(point => scaled(ctx, numSize) * 1.05 + 30 + (point.title ? measure(ctx, point.title, colW, titleStyle(ctx, t)) + 14 : 0) + measure(ctx, point.text, colW, bodyStyle(ctx, { size: b }))));
  const [ts, bs] = steps(sizes, step => columnH(step) <= band);
  const ns = numeralStyle(ctx, numSize, { align }), nh = Math.ceil(ns.size * 1.05);
  placed(ctx, top, a.b, sub => {
    let titleRow = 0;
    points.forEach((point, i) => {
      const x = a.x + i * (colW + gap);
      text(sub, numeral(ctx, i), { x, y: top, w: colW, h: nh }, ns);
      divider(sub, center ? x + colW / 2 - 20 : x, center ? x + colW / 2 + 20 : x + colW, top + nh + 12, true);
      if (point.title) titleRow = Math.max(titleRow, measure(ctx, point.title, colW, titleStyle(ctx, ts)) + 14);
    });
    points.forEach((point, i) => {
      const x = a.x + i * (colW + gap), y = top + nh + 30;
      if (point.title) text(sub, point.title, { x, y, w: colW, h: titleRow - 14 }, { ...titleStyle(ctx, ts, { align }), valign: "bottom" });
      text(sub, point.text, { x, y: y + titleRow, w: colW }, bodyStyle(ctx, { size: bs, color: point.title ? c.muted : c.ink, maxH: a.b - y - titleRow, min: 17, align }));
    });
  }, 0.3);
  footer(ctx);
}

/** Beside an image rail a title column would be a word per line: the title runs across the top, the rows below. */
function pointsRowsStacked(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, points = slide.points!;
  const top = header(ctx, slide, { size: headlineUp(ctx), maxLines: 3, standfirst: slide.body }) + 24;
  const rows = numberedRows(ctx, points, { x: a.x, r: a.r, top, bottom: a.b, mark: numeralMark(ctx), sizes: POINT_ROWS_STACKED,
    title: ts => titleStyle(ctx, ts), body: (bs, titled) => bodyStyle(ctx, { size: bs, color: titled ? c.muted : c.ink }), pad: [28, 64], anchor: 0.3 });
  if (!rows.fits) ctx.issues.push("the points have too much text beside the image");
  footer(ctx);
}
/** POINT ROW SIZES ([item title, supporting text], largest first; the last step is the minimum). Beside an image
 * rail the rows run the width of the text column, so they start larger than in the two-column composition. */
export const POINT_ROWS_STACKED = [[40, 25], [38, 25], [36, 24], [34, 24], [32, 23], [30, 22], [28, 21], [26, 20], [24, 19], [22, 18]];
export const POINT_ROWS = [[34, 23], [32, 22], [30, 22], [27, 21], [24, 20], [22, 19], [20, 18]];

export function pointsRows(ctx: Ctx, slide: Slide) {
  if (area(ctx).w < 760 && tryCompose(ctx, sub => pointsRowsStacked(sub, slide))) return;
  const a = area(ctx), c = ctx.c, points = slide.points!, n = points.length;
  const lw = Math.round(a.w * 0.36), rx = a.x + lw + 56;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 32, sub: slide.body, subStyle: { size: 22 } }, { x: a.x, y: a.y, w: lw, h: a.b - a.y }, "top");
  numberedRows(ctx, points, { x: rx, r: a.r, top: a.y, bottom: a.b, mark: numeralMark(ctx), sizes: POINT_ROWS,
    title: ts => titleStyle(ctx, ts), body: (bs, titled) => bodyStyle(ctx, { size: bs, color: titled ? c.muted : c.ink }), pad: [36, 72], anchor: n <= 3 ? 0.35 : 0 });
  footer(ctx);
}

export function pointsCards(ctx: Ctx, slide: Slide) {
  const a = area(ctx), points = slide.points!, n = points.length;
  const top = header(ctx, slide, { standfirst: slide.body, size: headlineUp(ctx) }) + 36;
  const cols = n <= 4 ? n : 3, rows = Math.ceil(n / cols), gap = 20, cw = (a.w - gap * (cols - 1)) / cols, band = a.b - top, ch = (band - gap * (rows - 1)) / rows, pad = cols >= 4 ? 24 : 30;
  const iw = cw - pad * 2, glyphS = rows > 1 ? 30 : 40;
  const contentH = (ts: number, bs: number) => Math.max(...points.map(point => glyphS + 24 + (point.title ? measure(ctx, point.title, iw, titleStyle(ctx, ts)) + 10 : 0) + measure(ctx, point.text, iw, bodyStyle(ctx, { size: bs })))) + pad * 2;
  const [ts, bs] = steps(rows > 1 ? [[24, 19], [22, 18], [20, 17]] : [[30, 21], [27, 20], [24, 19], [22, 18]], ([t, b]) => contentH(t, b) <= ch);
  const height = rows > 1 ? ch : Math.min(ch, Math.max(contentH(ts, bs) + 40, ch * 0.86));
  placed(ctx, top, a.b, sub => {
    points.forEach((point, i) => {
      const x = a.x + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
      const strong = ctx.dir.id !== "colorblock" && ctx.dir.id !== "organic" && i === 0 && ctx.dir.panel !== "none";
      const ink = panel(sub, { x, y, w: cw, h: height }, strong, i);
      marker(sub, i, x + pad, y + pad, glyphS, strong ? ink.ink : ink.accent);
      if (ctx.dir.id === "tech" || ctx.dir.id === "brutalist" || ctx.dir.id === "architect") text(sub, numeral(ctx, i), { x: x + cw - pad - 60, y: y + pad, w: 60, h: 22 }, { font: "mono", size: 14, color: ink.muted, align: "right", lh: 1.3 });
      const th = point.title ? measure(ctx, point.title, iw, titleStyle(ctx, ts)) + 10 : 0, bh = measure(ctx, point.text, iw, bodyStyle(ctx, { size: bs }));
      let ty = Math.max(y + pad + glyphS + 24, y + height - pad - th - bh);
      if (point.title) ty += text(sub, point.title, { x: x + pad, y: ty, w: iw }, titleStyle(ctx, ts, { color: ink.ink })) + 10;
      text(sub, point.text, { x: x + pad, y: ty, w: iw }, bodyStyle(ctx, { size: bs, color: point.title ? ink.muted : ink.ink, maxH: y + height - pad - ty + 2, min: 15 }));
    });
  }, 0.4);
  footer(ctx);
}

export function pointsFeature(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, points = slide.points!, [first, ...rest] = points;
  const top = header(ctx, slide, { size: headlineUp(ctx) }) + 36, band = a.b - top, lw = Math.round(a.w * 0.47), rx = a.x + lw + 48, rw = a.r - rx;
  const ink = panel(ctx, { x: a.x, y: top, w: lw, h: band }, ctx.dir.panel !== "none" && ctx.dir.id !== "organic", 0);
  const pad = 40;
  const ns = numeralStyle(ctx, 72, { color: ink.accent });
  text(ctx, numeral(ctx, 0), { x: a.x + pad, y: top + pad, w: 200, h: Math.ceil(ns.size * 1.04) }, ns);
  const s = stack({ ...ctx, c: { ...c, ink: ink.ink, muted: ink.muted, accent: ink.accent } } as Ctx, { title: first.title ?? first.text, size: 40, min: 24, sub: first.title ? first.text : undefined, subStyle: { size: 22, color: ink.muted, font: "body", italic: false }, extra: { role: undefined }, gap: 18 }, { x: a.x + pad, y: top + pad + 96, w: lw - pad * 2, h: band - pad * 2 - 96 }, "bottom");
  void s;
  const rowsAt = (bs: number) => rest.map(point => (point.title ? measure(ctx, point.title, rw, titleStyle(ctx, bs + 3)) + 4 : 0) + measure(ctx, point.text, rw, bodyStyle(ctx, { size: bs })) + 36);
  const bs = steps([21, 20, 19, 18, 17], size => rowsAt(size).reduce((t, h) => t + h, 0) <= band);
  const rows = rowsAt(bs), spare = Math.max(0, band - rows.reduce((t, h) => t + h, 0)) / Math.max(1, rest.length);
  rows.forEach((_, i) => { rows[i] += Math.min(spare, 60); });
  let y = top;
  rest.forEach((point, i) => {
    if (i) divider(ctx, rx, a.r, y);
    let ty = y + (i ? 18 : 0);
    if (point.title) ty += text(ctx, point.title, { x: rx, y: ty, w: rw }, titleStyle(ctx, bs + 3)) + 4;
    text(ctx, point.text, { x: rx, y: ty, w: rw }, bodyStyle(ctx, { size: bs, color: point.title ? c.muted : c.ink }));
    y += rows[i];
  });
  footer(ctx);
}

export function pointsGrid(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, points = slide.points!, n = points.length;
  // Six cells need the height: a long headline steps down to one line rather than squeezing the grid.
  const top = header(ctx, slide, { standfirst: slide.body, ...(n >= 5 ? { maxLines: 1, size: ctx.dir.sizes.headline * 0.9 } : { size: headlineUp(ctx) }) }) + 32;
  const cols = n === 4 ? 2 : 3, rows = Math.ceil(n / cols), band = a.b - top, boxed = ctx.dir.panel === "outline" || ctx.dir.panel === "heavy" || ctx.dir.panel === "fill";
  const gap = boxed ? 16 : 0, cw = (a.w - gap * (cols - 1)) / cols, ch = (band - gap * (rows - 1)) / rows, pad = boxed ? 28 : 24;
  const iw = cw - pad * 2 - (boxed ? 0 : 0);
  const fits = (ts: number, bs: number) => Math.max(...points.map(point => 34 + (point.title ? measure(ctx, point.title, iw, titleStyle(ctx, ts)) + 8 : 0) + measure(ctx, point.text, iw, bodyStyle(ctx, { size: bs })))) + pad * 2 <= ch;
  const [ts, bs] = steps([[26, 21], [24, 20], [22, 19], [20, 18], [19, 17]], ([t, b]) => fits(t, b));
  points.forEach((point, i) => {
    const col = i % cols, row = Math.floor(i / cols), x = a.x + col * (cw + gap), y = top + row * (ch + gap);
    let ink = { ink: c.ink, muted: c.muted, accent: c.accent };
    if (boxed) ink = panel(ctx, { x, y, w: cw, h: ch }, false, i);
    else {
      if (row === 0) divider(ctx, x, x + cw, y, true);
      if (row > 0) divider(ctx, x, x + cw, y);
      if (col > 0) vline(ctx, x, y + 16, y + ch - 16, c.rule, 1);
    }
    const ix = x + (boxed || col > 0 ? pad : 0);
    if (boxed && ctx.dir.id !== "brutalist") marker(ctx, i, x + cw - pad - 30, y + pad, 30, ink.accent);
    text(ctx, numeral(ctx, i), { x: ix, y: y + pad, w: 80, h: 22 }, { ...labelStyle(ctx), font: ctx.dir.numerals.font === "mono" ? "mono" : "body", color: ink.accent, size: 15 });
    // Copy sits low in the cell; the numeral marks the top.
    const th = point.title ? measure(ctx, point.title, iw, titleStyle(ctx, ts)) + 8 : 0, bh = measure(ctx, point.text, iw, bodyStyle(ctx, { size: bs }));
    let ty = Math.max(y + pad + 34, y + ch - pad - th - bh);
    if (point.title) ty += text(ctx, point.title, { x: ix, y: ty, w: iw }, titleStyle(ctx, ts, { color: ink.ink })) + 8;
    text(ctx, point.text, { x: ix, y: ty, w: iw }, bodyStyle(ctx, { size: bs, color: point.title ? ink.muted : ink.ink, maxH: y + ch - pad - ty + 4, min: 15 }));
  });
  footer(ctx);
}

export function agendaList(ctx: Ctx, slide: Slide) {
  const a = area(ctx), items = slide.points!, n = items.length;
  const lw = Math.round(a.w * 0.34), rx = a.x + lw + 64, rw = a.r - rx;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 32, sub: slide.body, subStyle: { size: 22 } }, { x: a.x, y: a.y, w: lw, h: a.b - a.y }, "top");
  const rowH = (a.b - a.y) / n, numW = 96, size = Math.min(40, Math.max(22, rowH * 0.36));
  items.forEach((item, i) => {
    const y = a.y + i * rowH;
    divider(ctx, rx, a.r, y, i === 0);
    const ns = numeralStyle(ctx, size, { lh: 1.05 });
    text(ctx, numeral(ctx, i), { x: rx, y: y + 14, w: numW - 16, h: Math.ceil(ns.size * 1.1) }, ns);
    const main = item.title ?? item.text, detail = item.title ? item.text : undefined;
    const th = text(ctx, main, { x: rx + numW, y: y + 12, w: rw - numW }, titleStyle(ctx, size, { maxH: detail ? rowH * 0.5 : rowH - 24, min: 18 }));
    if (detail) text(ctx, detail, { x: rx + numW, y: y + 16 + th, w: rw - numW }, bodyStyle(ctx, { size: 19, maxH: rowH - th - 28, min: 15 }));
  });
  divider(ctx, rx, a.r, a.b);
  footer(ctx);
}

export function agendaColumns(ctx: Ctx, slide: Slide) { pointsColumns(ctx, { ...slide, points: slide.points!.slice(0, 4) }); }

/* ---------- numbers ---------- */

const valueWeight = (ctx: Ctx) => (ctx.dir.display.weight ?? FONTS[ctx.theme.fonts].headingWeight) >= 600 ? 700 : (ctx.dir.display.weight ?? FONTS[ctx.theme.fonts].headingWeight) as 400;
/** Largest size ≤ max at which a value stays on one line in w. */
function oneLine(ctx: Ctx, value: string, w: number, max: number, min = 40) {
  const style: TextStyle = { font: ctx.dir.numerals.font === "mono" ? "mono" : "heading", weight: valueWeight(ctx), size: max, upper: ctx.dir.display.upper };
  // Figures must never wrap: digits and wide capitals run wider than a face's average, so keep 8% in hand (15% in capitals).
  const { cw, mode } = glyphWidth(ctx, style);
  let size = scaled(ctx, max);
  while (size > min && estimateLines(style.upper ? value.toUpperCase() : value, w, size, cw * (style.upper ? 1.15 : 1.08), mode) > 1) size--;
  return size;
}
const valueStyle = (ctx: Ctx, size: number, color: string): TextStyle => ({ font: ctx.dir.numerals.font === "mono" ? "mono" : "heading", size, weight: valueWeight(ctx), color, lh: 1, upper: ctx.dir.display.upper, ...(ctx.dir.display.upper ? { tracking: 0.01 } : {}) });

export function statsHero(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, stats = slide.stats!, n = stats.length;
  let top = header(ctx, slide, { maxLines: 2, size: headlineUp(ctx) });
  top += 24;
  if (n === 1) {
    const s = stats[0], vw = a.w * 0.6, size = oneLine(ctx, s.value, vw, Math.min(280, ctx.dir.sizes.number * 1.5), 80);
    const vh = Math.ceil(size * 1.02), y = a.b - vh;
    text(ctx, s.value, { x: a.x - 4, y, w: vw, h: vh }, valueStyle(ctx, size, c.accent));
    const rx = a.x + vw + 40, rw = a.r - rx;
    const lh = measure(ctx, s.label, rw, titleStyle(ctx, 30)), dh = s.detail ? measure(ctx, s.detail, rw, bodyStyle(ctx)) + 12 : 0, by = Math.max(top, a.b - lh - dh - 8);
    divider(ctx, rx, a.r, by - 20, true);
    text(ctx, s.label, { x: rx, y: by, w: rw, h: lh }, titleStyle(ctx, 30));
    if (s.detail) text(ctx, s.detail, { x: rx, y: by + lh + 12, w: rw }, bodyStyle(ctx, { maxH: a.b - by - lh - 8, min: 16 }));
    if (slide.body) text(ctx, slide.body, { x: rx, y: top + 8, w: rw }, leadStyle(ctx, { size: 22, maxH: Math.max(40, by - top - 60), min: 17 }));
  } else {
    const gap = 64, w = (a.w - gap * (n - 1)) / n, size = Math.min(...stats.map(s => oneLine(ctx, s.value, w, Math.min(220, ctx.dir.sizes.number * 1.15), 64)));
    const vh = Math.ceil(size * 1.02);
    const below = (s: (typeof stats)[number]) => measure(ctx, s.label, w, titleStyle(ctx, 26)) + (s.detail ? 10 + measure(ctx, s.detail, w, bodyStyle(ctx, { size: 20 })) : 0);
    const bh = Math.max(...stats.map(below)), y = Math.max(top, a.b - vh - 28 - bh);
    stats.forEach((s, i) => {
      const x = a.x + i * (w + gap);
      if (i) vline(ctx, x - gap / 2, y, a.b, c.rule, 1);
      text(ctx, s.value, { x, y, w, h: vh }, valueStyle(ctx, size, i === 0 ? c.accent : c.ink));
      const lh = text(ctx, s.label, { x, y: y + vh + 28, w }, titleStyle(ctx, 26));
      if (s.detail) text(ctx, s.detail, { x, y: y + vh + 38 + lh, w }, bodyStyle(ctx, { size: 20, maxH: a.b - (y + vh + 38 + lh) + 4, min: 15 }));
    });
  }
  footer(ctx);
}

export function statsRow(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, stats = slide.stats!, n = stats.length;
  const top = header(ctx, slide, { standfirst: n > 1 ? undefined : slide.body, size: headlineUp(ctx) }) + 40, colW = a.w / n, inset = 32;
  const valueBox = colW - (n > 1 ? inset * 2 : inset), size = Math.min(...stats.map(s => oneLine(ctx, s.value, valueBox, n <= 2 ? 150 : n === 3 ? 124 : 100, 40)));
  const vh = Math.ceil(size * 1.04);
  // Labels shrink together until their longest word fits the column, so the row stays even.
  let labelSize = 24;
  while (labelSize > 16 && stats.some(s => textWidth(ctx, s.label.split(/\s+/).sort((x, y) => y.length - x.length)[0] ?? "", titleStyle(ctx, labelSize)) > valueBox)) labelSize--;
  let labelRow = 0;
  for (const s of stats) labelRow = Math.max(labelRow, measure(ctx, s.label, valueBox, titleStyle(ctx, labelSize)));
  const detailRow = Math.max(0, ...stats.map(s => s.detail ? measure(ctx, s.detail, valueBox, bodyStyle(ctx, { size: 20 })) + 12 : 0));
  const bodyH = slide.body && n > 1 ? 70 : 0, blockH = vh + 24 + labelRow + detailRow;
  const y0 = top + Math.max(0, (a.b - bodyH - top - blockH) * 0.45);
  const align = ctx.dir.axis === "center" ? "center" as const : "left" as const;
  stats.forEach((s, i) => {
    const x = a.x + i * colW + (i ? inset : 0);
    if (i) vline(ctx, a.x + i * colW, y0 + 6, y0 + blockH, c.rule, 1.5);
    text(ctx, s.value, { x, y: y0, w: valueBox, h: vh }, { ...valueStyle(ctx, size, c.accent), align });
    text(ctx, s.label, { x, y: y0 + vh + 24, w: valueBox, h: labelRow }, titleStyle(ctx, labelSize, { align }));
    if (s.detail) text(ctx, s.detail, { x, y: y0 + vh + 36 + labelRow, w: valueBox }, bodyStyle(ctx, { size: 20, maxH: detailRow, min: 16, align }));
  });
  if (bodyH) text(ctx, slide.body!, { x: a.x, y: a.b - 56, w: a.w, h: 56 }, bodyStyle(ctx, { size: 20, color: c.ink, maxH: 56, min: 16, valign: "bottom" }));
  footer(ctx);
}

export function statsTiles(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, p = ctx.theme.palette, stats = slide.stats!, n = stats.length;
  const top = header(ctx, slide, { size: headlineUp(ctx) }) + 36, gap = 16, tw = (a.w - gap * (n - 1)) / n, th = a.b - top, pad = n === 4 ? 24 : 32;
  const fills = ctx.dir.id === "colorblock" ? [p.accent, p.accent2, p.dark, p.surface] : ctx.dir.id === "brutalist" ? [c.signal, c.bg, c.bg, c.bg] : [c.strong, c.surface, c.surface, c.surface];
  const size = Math.min(...stats.map(s => oneLine(ctx, s.value, tw - pad * 2, n <= 2 ? 150 : n === 3 ? 120 : 92, 40)));
  stats.forEach((s, i) => {
    const x = a.x + i * (tw + gap), fill = fills[i % fills.length], heavy = ctx.dir.panel === "heavy";
    if (ctx.dir.panel === "outline" && i) rect(ctx, { x, y: top, w: tw, h: th, fill: c.bg, noFill: true, stroke: c.rule, strokeWidth: 1, radius: ctx.dir.radius });
    else rect(ctx, { x, y: top, w: tw, h: th, fill, radius: Math.min(ctx.dir.radius, 24), ...(heavy ? { stroke: c.ink, strokeWidth: ctx.dir.rule?.width ?? 4 } : {}) });
    const bg = ctx.dir.panel === "outline" && i ? c.bg : fill;
    const ink = readableOn(bg, c.ink, "#FFFFFF", p.background, "#111111"), soft = [0.22, 0.12, 0].map(m => mix(ink, bg, m)).find(col => contrast(col, bg) >= 4.6) ?? ink;
    let y = top + pad;
    y += text(ctx, s.label, { x: x + pad, y, w: tw - pad * 2 }, titleStyle(ctx, n === 4 ? 21 : 24, { color: ink, maxH: 90, min: 16 })) + 10;
    if (s.detail) text(ctx, s.detail, { x: x + pad, y, w: tw - pad * 2 }, bodyStyle(ctx, { size: 19, color: soft, maxH: top + th - pad - Math.ceil(size * 1.04) - 24 - y, min: 15 }));
    text(ctx, s.value, { x: x + pad, y: top + th - pad - Math.ceil(size * 1.04), w: tw - pad * 2, h: Math.ceil(size * 1.04) }, valueStyle(ctx, size, ink));
  });
  footer(ctx);
}

export function statsLedger(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, stats = slide.stats!, n = stats.length;
  const lw = Math.round(a.w * 0.36), rx = a.x + lw + 64, rw = a.r - rx;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 32, sub: slide.body, subStyle: { size: 22 } }, { x: a.x, y: a.y, w: lw, h: a.b - a.y }, "top");
  const rowH = (a.b - a.y) / n, vw = Math.round(rw * 0.46), size = Math.min(...stats.map(s => oneLine(ctx, s.value, vw, Math.min(104, rowH * 0.62), 36)));
  stats.forEach((s, i) => {
    const y = a.y + i * rowH;
    divider(ctx, rx, a.r, y, i === 0);
    text(ctx, s.value, { x: rx, y: y + (rowH - size * 1.04) / 2, w: vw, h: Math.ceil(size * 1.04) }, valueStyle(ctx, size, i === 0 ? c.accent : c.ink));
    const tx = rx + vw + 24, tw = rw - vw - 24;
    const lh = measure(ctx, s.label, tw, titleStyle(ctx, 22)), dh = s.detail ? measure(ctx, s.detail, tw, bodyStyle(ctx, { size: 19 })) + 6 : 0;
    const ty = y + Math.max(10, (rowH - lh - dh) / 2);
    text(ctx, s.label, { x: tx, y: ty, w: tw, h: lh }, titleStyle(ctx, 22));
    if (s.detail) text(ctx, s.detail, { x: tx, y: ty + lh + 6, w: tw }, bodyStyle(ctx, { size: 19, maxH: y + rowH - ty - lh - 10, min: 15 }));
  });
  divider(ctx, rx, a.r, a.b);
  footer(ctx);
}

/* ---------- charts ---------- */

export function chartColors(ctx: Ctx, c: Tone = ctx.c): ChartColors {
  // Non-highlighted bars are a quiet tint of the highlight hue, so the emphasis reads at a glance.
  return { ink: c.ink, muted: c.muted, grid: c.rule, series: [c.signal, c.accent2, mix(c.signal, c.bg, 0.5)], highlight: c.signal, highlightInk: c.accent, dim: mix(c.signal, c.bg, ctx.dir.ground === "dark" ? 0.6 : 0.72), background: c.bg };
}
const chartStyle = (ctx: Ctx) => ({ mono: ctx.dir.label.font === "mono", radius: ctx.dir.radius >= 20 ? 8 : ctx.dir.radius ? 3 : 0, grid: ctx.dir.id === "data" || ctx.dir.id === "swiss" || ctx.dir.id === "tech" });
function chartPrim(ctx: Ctx, slide: Slide, box: { x: number; y: number; w: number; h: number }, textScale = 1) {
  // Below this a chart's bars and labels no longer read (e.g. a long standfirst over a narrowed text zone).
  if (box.h < 180 || box.w < 320) ctx.issues.push("the chart has too little room");
  ctx.prims.push({ k: "chart", ...box, chart: slide.chart!, colors: chartColors(ctx), style: { ...chartStyle(ctx), ...(textScale !== 1 ? { text: textScale } : {}) } });
}
const focusOf = (slide: Slide) => {
  const chart = slide.chart!, values = chart.series[0].values;
  const i = chart.highlight ?? (chart.type === "line" ? values.length - 1 : values.indexOf(Math.max(...values)));
  return { i, value: formatValue(chart, values[i]), category: chart.categories[i] };
};
function source(ctx: Ctx, slide: Slide, x: number, y: number, w: number) {
  if (slide.chart!.source) text(ctx, slide.chart!.source, { x, y, w, h: 20 }, { size: 13, color: ctx.c.muted, italic: true, lh: 1.3, ...(ctx.dir.label.font === "mono" ? { font: "mono" as const, italic: false, size: 12 } : {}) });
}

/** CHART CALLOUT SIZES. The annotated chart's headline is set 1.12× like points and numbers; its statistic up to
 * CALLOUT_VALUE px (on one line), its caption at CALLOUT_CAPTION px (in steps to five lines, then down to CALLOUT_CAPTION_MIN), and the
 * chart's own labels CHART_TEXT_UP× their base sizes in the preview, PDF and PPTX alike. */
export const CALLOUT_VALUE = 132, CALLOUT_CAPTION = 38, CALLOUT_CAPTION_MIN = 20, CHART_TEXT_UP = 1.25;
const CALLOUT_CAPTIONS = [CALLOUT_CAPTION, 34, 30, 26, 22];
export function chartAnnotated(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, chart = slide.chart!, f = focusOf(slide), size = headlineUp(ctx);
  const cw = Math.round(a.w * 0.62), px = a.x + cw + 48, pw = a.r - px;
  // The headline shares the chart's column when it keeps 90% of its size there in no more lines; the callout then rises beside it instead of
  // waiting below a full-width title, and the chart keeps the height.
  const titleAt = (titleW?: number) => { const sub: Ctx = { ...ctx, prims: [], issues: [] }; header(sub, slide, { size, titleW }); return sub.prims.flatMap(prim => prim.k === "text" && prim.role === "title" ? [{ size: prim.size, lines: prim.text.split("\n").length }] : [])[0] ?? { size: 0, lines: 0 }; };
  const [inColumn, across] = [titleAt(cw), titleAt()];
  const beside = ctx.dir.header !== "centered" && inColumn.size >= across.size * 0.9 && inColumn.lines <= across.lines;
  const top = header(ctx, slide, { size, ...(beside ? { titleW: cw } : {}) }) + 24;
  const big = cw >= 560 && a.b - top >= 240;
  chartPrim(ctx, slide, { x: a.x, y: top, w: cw, h: a.b - top }, big ? CHART_TEXT_UP : 1);
  // The callout ends with the chart (the source line beneath it); it starts level with the chart when it fits, else higher.
  const end = chart.source ? a.b - 30 : a.b, ceiling = beside ? a.y + 56 : top;
  const single = chart.type !== "donut" && chart.series.length === 1;
  const lab = single ? Math.ceil(labelStyle(ctx).size * 1.3) + 24 : 0;
  // A short caption is set large; a longer one steps down until it takes at most five lines.
  const captionAt = (px_: number) => ({ ...titleStyle(ctx, px_, { lh: 1.16 }), upper: false });
  const captionSize = CALLOUT_CAPTIONS.find(step => !slide.body || measure(ctx, slide.body, pw, captionAt(step)) <= Math.ceil(scaled(ctx, step) * 1.16 * 5)) ?? CALLOUT_CAPTIONS[CALLOUT_CAPTIONS.length - 1];
  const caption = captionAt(captionSize);
  // The statistic gives way before the caption reaches its minimum.
  const room = end - ceiling - 32 - lab - (slide.body ? measure(ctx, slide.body, pw, { ...caption, size: scaled(ctx, CALLOUT_CAPTION_MIN) }) : 0);
  const vSize = single ? Math.max(40, Math.min(oneLine(ctx, f.value, pw, CALLOUT_VALUE, 40), Math.floor(room / 1.04))) : 0, vh = single ? Math.ceil(vSize * 1.04) : 0;
  const notes = slide.points?.map(point => `${point.title ? `${point.title}: ` : ""}${point.text}`) ?? [];
  const below = slide.body ? measure(ctx, slide.body, pw, caption) : notes.reduce((sum, note) => sum + measure(ctx, note, pw, bodyStyle(ctx, { size: 22 })) + 14, 0);
  const need = 24 + (vh ? vh + 8 + lab : 0) + below;
  let y = Math.max(ceiling, Math.min(top, end - need));
  divider(ctx, px, a.r, y, true);
  y += 24;
  if (single) {
    // The statistic is the slide's message: its accent reads at 4.5:1 like small text, not only the 3:1 of large type.
    text(ctx, f.value, { x: px, y, w: pw, h: vh }, valueStyle(ctx, vSize, readableMark(ctx, c.accent)));
    y += vh + 8;
    y += label(ctx, f.category, { x: px, y, w: pw }) + 24;
  }
  if (slide.body) text(ctx, slide.body, { x: px, y, w: pw }, { ...caption, maxH: end - y, min: CALLOUT_CAPTION_MIN });
  else notes.forEach(note => { y += text(ctx, note, { x: px, y, w: pw }, bodyStyle(ctx, { size: 22, color: c.ink, maxH: Math.min(132, end - y), min: 15 })) + 14; });
  source(ctx, slide, px, a.b - 14, pw);
  footer(ctx);
}

export function chartHero(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, chart = slide.chart!, f = focusOf(slide);
  const lw = Math.round(a.w * 0.38), cx = a.x + lw + 56;
  const s = stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 30 }, { x: a.x, y: a.y, w: lw, h: 230 }, "top");
  const vSize = oneLine(ctx, f.value, lw, Math.min(190, ctx.dir.sizes.number), 56), vh = Math.ceil(vSize * 1.03);
  const bodyH = slide.body ? measure(ctx, slide.body, lw, leadStyle(ctx, { size: 22 })) : 0;
  const vy = Math.max(s.bottom + 30, a.b - vh - 46 - (bodyH ? bodyH + 18 : 0));
  text(ctx, f.value, { x: a.x - 3, y: vy, w: lw, h: vh }, valueStyle(ctx, vSize, c.accent));
  label(ctx, `${f.category}${chart.series.length > 1 ? ` · ${chart.series[0].name}` : ""}`, { x: a.x, y: vy + vh + 10, w: lw });
  if (slide.body) text(ctx, slide.body, { x: a.x, y: vy + vh + 46, w: lw }, leadStyle(ctx, { size: 22, maxH: a.b - vy - vh - 44, min: 16 }));
  const bottom = chart.source ? a.b - 22 : a.b;
  chartPrim(ctx, slide, { x: cx, y: a.y + 10, w: a.r - cx, h: bottom - a.y - 10 });
  source(ctx, slide, cx, a.b - 14, a.r - cx);
  footer(ctx);
}

export function chartFull(ctx: Ctx, slide: Slide) {
  const a = area(ctx), chart = slide.chart!;
  const top = header(ctx, slide, { standfirst: slide.body ?? undefined }) + 24, bottom = chart.source ? a.b - 22 : a.b;
  chartPrim(ctx, slide, { x: a.x, y: top, w: a.w, h: bottom - top });
  source(ctx, slide, a.x, a.b - 14, a.w);
  footer(ctx);
}

/* ---------- diagrams ---------- */

export function diagramRail(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, d = slide.diagram!, n = d.items.length;
  let top = header(ctx, slide);
  if (slide.body) top += 12 + text(ctx, slide.body, { x: a.x, y: top + 12, w: 900 }, bodyStyle(ctx, { size: 21, maxH: 64, min: 17 }));
  top += 40;
  const col = a.w / n, big = n <= 3, labelSize = big ? 34 : n === 4 ? 28 : 24, detailSize = big ? 23 : n === 4 ? 21 : 19, r = big ? 46 : 38;
  placed(ctx, top, a.b, sub => {
    const mid = top + (d.kind === "timeline" ? 120 : r + 4);
    sub.prims.push({ k: "line", x1: a.x + col / 2, y1: mid, x2: a.x + col * (n - 0.5), y2: mid, color: d.kind === "timeline" ? c.signal : c.rule, width: d.kind === "timeline" ? 4 : 2 });
    let labelRow = 0;
    d.items.forEach((item, i) => {
      const cx = a.x + col * (i + 0.5);
      if (d.kind === "process") {
        const last = i === n - 1;
        sub.prims.push({ k: "ellipse", x: cx - r, y: mid - r, w: r * 2, h: r * 2, fill: last ? c.signal : c.bg, stroke: last ? c.signal : c.accent, strokeWidth: 3 });
        text(sub, String(i + 1), { x: cx - r, y: mid - r, w: r * 2, h: r * 2 }, { font: ctx.dir.numerals.font === "mono" ? "mono" : "heading", size: big ? 38 : 32, align: "center", valign: "middle", color: last ? readableOn(c.signal, c.bg, c.ink, "#FFFFFF") : c.accent, weight: 700, lh: 1 });
        labelRow = Math.max(labelRow, text(sub, item.label, { x: cx - col / 2 + 14, y: mid + r + 28, w: col - 28 }, titleStyle(ctx, labelSize, { align: "center" })));
      } else {
        sub.prims.push({ k: "ellipse", x: cx - 14, y: mid - 14, w: 28, h: 28, fill: c.bg, stroke: c.accent, strokeWidth: 5 });
        text(sub, item.label, { x: cx - col / 2 + 8, y: mid - 104, w: col - 16, h: 80 }, { ...titleStyle(ctx, n <= 4 ? 40 : 32, { align: "center", valign: "bottom", color: c.accent }), maxH: 80, min: 20 });
        if (item.detail) text(sub, item.detail, { x: cx - col / 2 + 14, y: mid + 40, w: col - 28 }, bodyStyle(ctx, { size: detailSize, align: "center", color: c.ink, lh: 1.35 }));
      }
    });
    // Process labels share one row even when they wrap differently, so the descriptions align.
    if (d.kind === "process") d.items.forEach((item, i) => { if (item.detail) text(sub, item.detail, { x: a.x + col * i + 14, y: mid + r + 28 + labelRow + 12, w: col - 28 }, bodyStyle(ctx, { size: detailSize, align: "center", lh: 1.35 })); });
  }, 0.4);
  footer(ctx);
}

export function diagramSteps(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, d = slide.diagram!, n = d.items.length;
  const top = header(ctx, slide, { standfirst: slide.body }) + 40, gap = n >= 5 ? 24 : 40, colW = (a.w - gap * (n - 1)) / n;
  const numSize = n <= 3 ? 110 : n === 4 ? 92 : 72, labelSize = n <= 3 ? 30 : n === 4 ? 26 : 22;
  placed(ctx, top, a.b, sub => {
    let labelRow = 0;
    d.items.forEach((item, i) => {
      const x = a.x + i * (colW + gap);
      const ns = numeralStyle(ctx, numSize, { color: i === n - 1 ? c.accent : ctx.dir.numerals.color === "ink" ? c.ink : c.accent });
      text(sub, d.kind === "timeline" ? String(i + 1).padStart(2, "0") : numeral(ctx, i), { x, y: top, w: colW, h: Math.ceil(ns.size * 1.02) }, ns);
      if (i < n - 1) path(sub, arrowPath(x + colW - 34 + gap / 2, top + numSize * 0.5 - 17, 34, 0), { fill: c.rule });
      labelRow = Math.max(labelRow, measure(ctx, item.label, colW, titleStyle(ctx, labelSize)));
    });
    const ly = top + Math.ceil(numeralStyle(ctx, numSize).size * 1.02) + 16;
    d.items.forEach((item, i) => {
      const x = a.x + i * (colW + gap);
      divider(sub, x, x + colW, ly - 4, true);
      text(sub, item.label, { x, y: ly + 12, w: colW, h: labelRow }, titleStyle(ctx, labelSize, { valign: "top" }));
    });
    d.items.forEach((item, i) => { if (item.detail) text(sub, item.detail, { x: a.x + i * (colW + gap), y: ly + 12 + labelRow + 12, w: colW }, bodyStyle(ctx, { size: n <= 4 ? 21 : 19, maxH: a.b - (ly + 24 + labelRow), min: 15 })); });
  }, 0.3);
  footer(ctx);
}

export function diagramBlocks(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, p = ctx.theme.palette, d = slide.diagram!, n = d.items.length;
  const top = header(ctx, slide) + 32, gap = 12, colW = (a.w - gap * (n - 1)) / n, detailSize = n <= 4 ? 20 : 18;
  const detailRow = Math.max(0, ...d.items.map(item => item.detail ? measure(ctx, item.detail, colW - 8, bodyStyle(ctx, { size: detailSize })) : 0));
  const base = a.b - detailRow - (detailRow ? 22 : 0), maxH = base - top, minH = Math.max(150, maxH * 0.42);
  if (minH > maxH) ctx.issues.push("the diagram blocks have no room under the title");
  d.items.forEach((item, i) => {
    const h = n === 1 ? maxH : minH + (maxH - minH) * i / (n - 1), x = a.x + i * (colW + gap), y = base - h;
    // Steps grow in height and in colour: tints of the signal colour, or the full palette in colour-block decks.
    const blocks = [p.accent2, p.dark, p.accent, mix(p.accent2, p.background, 0.5), p.surface, mix(p.accent, p.dark, 0.4)];
    const fill = ctx.dir.id === "architect" ? (i === n - 1 ? c.ink : c.bg) : ctx.dir.id === "brutalist" ? (i === n - 1 ? c.signal : c.bg) : ctx.dir.id === "colorblock" ? blocks[i % blocks.length] : mix(c.signal, c.bg, n === 1 ? 0 : 0.72 * (1 - i / (n - 1)));
    const outline = ctx.dir.id === "architect" || ctx.dir.id === "brutalist";
    rect(ctx, { x, y, w: colW, h, fill, radius: Math.min(ctx.dir.radius, 18), ...(outline ? { stroke: c.ink, strokeWidth: ctx.dir.id === "brutalist" ? 4 : 1 } : {}) });
    const ink = readableOn(fill, "#FFFFFF", "#111111", c.ink, c.bg);
    text(ctx, numeral(ctx, i), { x: x + 18, y: y + 16, w: colW - 36, h: 22 }, { font: ctx.dir.label.font === "mono" ? "mono" : "body", size: 15, weight: 700, color: ink, lh: 1.3 });
    text(ctx, item.label, { x: x + 18, y: y + 46, w: colW - 36, h: Math.min(h - 62, 140) }, titleStyle(ctx, n <= 4 ? 28 : 23, { color: ink, maxH: Math.min(h - 62, 140), min: 16 }));
  });
  hline(ctx, a.x, a.r, base, c.ink, 2);
  d.items.forEach((item, i) => { if (item.detail) text(ctx, item.detail, { x: a.x + i * (colW + gap), y: base + 16, w: colW - 8, h: detailRow + 4 }, bodyStyle(ctx, { size: detailSize })); });
  footer(ctx);
}

export function diagramClassic(ctx: Ctx, slide: Slide) {
  const d = slide.diagram!;
  if (d.kind === "process" || d.kind === "timeline") { diagramRail(ctx, slide); return; }
  const a = area(ctx), c = ctx.c, n = d.items.length;
  let top = header(ctx, slide);
  if (slide.body) top += 12 + text(ctx, slide.body, { x: a.x, y: top + 12, w: 960 }, bodyStyle(ctx, { size: 20, maxH: 64, min: 16 }));
  top += 36;
  const bottom = a.b;
  if (d.kind === "pyramid" || d.kind === "funnel") {
    const tierGap = 10, height = Math.min(92, (bottom - top - tierGap * (n - 1)) / n), left = a.x, maxW = 560, minW = 220;
    d.items.forEach((item, i) => {
      const rank = d.kind === "pyramid" ? i : n - 1 - i, width = minW + (maxW - minW) * (n === 1 ? 1 : rank / (n - 1));
      const y = top + i * (height + tierGap), x = left + (maxW - width) / 2, fill = mix(c.accent, c.accent2, n === 1 ? 0 : i / (n - 1));
      rect(ctx, { x, y, w: width, h: height, fill, radius: Math.min(ctx.dir.radius, 8) });
      text(ctx, item.label, { x: x + 12, y, w: width - 24, h: height }, { size: 20, weight: 700, align: "center", valign: "middle", color: readableOn(fill, "#FFFFFF", "#111111"), maxH: height, min: 14 });
      if (item.detail) text(ctx, item.detail, { x: left + maxW + 56, y, w: a.w - maxW - 56, h: height }, bodyStyle(ctx, { size: 20, valign: "middle", color: c.ink, maxH: height, min: 15 }));
      line(ctx, x + width + 8, y + height / 2, left + maxW + 40, y + height / 2, c.rule, 1.5);
    });
  } else if (d.kind === "matrix") {
    const gridTop = top, gridH = bottom - gridTop - 30, gridW = Math.min(900, a.w - 150), x0 = a.x + 150, cellW = gridW / 2 - 6, cellH = gridH / 2 - 6;
    d.items.forEach((item, i) => {
      const x = x0 + (i % 2) * (cellW + 12), y = gridTop + Math.floor(i / 2) * (cellH + 12);
      const ink = panel(ctx, { x, y, w: cellW, h: cellH }, i === 1, -1);
      const h = text(ctx, item.label, { x: x + 28, y: y + 24, w: cellW - 56 }, titleStyle(ctx, 26, { color: ink.ink, maxH: 70, min: 18 }));
      if (item.detail) text(ctx, item.detail, { x: x + 28, y: y + 24 + h + 10, w: cellW - 56 }, bodyStyle(ctx, { size: 19, color: ink.muted, maxH: cellH - h - 60, min: 15 }));
    });
    if (d.axes) {
      text(ctx, `↑ ${d.axes.y}`, { x: a.x, y: gridTop, w: 138, h: 60 }, { ...labelStyle(ctx), color: c.accent, maxH: 60, min: 11 });
      text(ctx, `${d.axes.x} →`, { x: x0, y: gridTop + gridH + 8, w: gridW, h: 22 }, { ...labelStyle(ctx), color: c.accent, align: "right", maxH: 22, min: 11 });
    }
  } else {
    const cy = top + (bottom - top) / 2 - 4, cx = W / 2, r = Math.max(90, Math.min(150, (bottom - top) / 2 - 78));
    ellipse(ctx, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: c.rule, strokeWidth: 2 });
    d.items.forEach((item, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / n, nx = cx + r * Math.cos(angle), ny = cy + r * Math.sin(angle);
      ellipse(ctx, { x: nx - 26, y: ny - 26, w: 52, h: 52, fill: c.accent });
      text(ctx, String(i + 1), { x: nx - 26, y: ny - 26, w: 52, h: 52 }, { font: "heading", size: 22, weight: 700, align: "center", valign: "middle", color: readableOn(c.accent, "#FFFFFF", "#111111"), lh: 1 });
      const right = Math.cos(angle) > 0.2, left = Math.cos(angle) < -0.2, boxW = 300;
      const bx = right ? nx + 40 : left ? nx - 40 - boxW : nx - boxW / 2;
      const by = right || left ? ny - 24 : Math.sin(angle) < 0 ? ny - 34 - (item.detail ? 54 : 30) : ny + 34;
      const align = right ? "left" : left ? "right" : "center";
      const h = text(ctx, item.label, { x: bx, y: by, w: boxW }, { size: 21, weight: 700, align, color: c.ink });
      if (item.detail) text(ctx, item.detail, { x: bx, y: by + h + 4, w: boxW }, { size: 19, align, color: c.muted, lh: 1.35 });
    });
  }
  footer(ctx);
}

/* ---------- comparisons ---------- */

function compareSides(ctx: Ctx, slide: Slide, boxes: { x: number; y: number; w: number; h: number }[], inks: { ink: string; muted: string; accent: string }[], headSize = 34, pad = 36) {
  const cmp = slide.compare!, sides = [cmp.left, cmp.right];
  const layout = (size: number) => sides.map((side, i) => (pad + measure(ctx, side.heading, boxes[i].w - pad * 2, titleStyle(ctx, headSize)) + 26 + side.points.reduce((t, point) => t + measure(ctx, point, boxes[i].w - pad * 2 - 30, bodyStyle(ctx, { size })) + 16, 0)));
  let size = 26;
  while (size > 15 && Math.max(...layout(size)) > Math.min(...boxes.map(b => b.h))) size--;
  if (Math.max(...layout(size)) > Math.min(...boxes.map(b => b.h)) + 4) ctx.issues.push("the comparison has too much text for one slide");
  sides.forEach((side, i) => {
    const b = boxes[i], ink = inks[i];
    let y = b.y + pad;
    y += text(ctx, side.heading, { x: b.x + pad, y, w: b.w - pad * 2 }, titleStyle(ctx, headSize, { color: ink.ink, maxH: 90, min: 22 })) + 26;
    // One text box per side: the items flow as rendered (no gaps from estimated per-item heights) and the PPTX gets one bulleted list.
    text(ctx, side.points.join("\n"), { x: b.x + pad, y, w: b.w - pad * 2 }, bodyStyle(ctx, { size, color: ink.ink, list: { marker: "dash", color: ink.accent, indent: 30, gap: 16 } }));
  });
}

export function comparePanels(ctx: Ctx, slide: Slide) {
  const a = area(ctx), top = header(ctx, slide) + 36, gap = 24, pw = (a.w - gap) / 2, h = a.b - top;
  const inks = [0, 1].map(i => panel(ctx, { x: a.x + i * (pw + gap), y: top, w: pw, h }, i === 1, -1));
  compareSides(ctx, slide, [0, 1].map(i => ({ x: a.x + i * (pw + gap), y: top, w: pw, h })), inks);
  footer(ctx);
}

export function compareVersus(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, top = header(ctx, slide) + 32, half = W / 2;
  rect(ctx, { x: 0, y: top, w: half, h: H - top, fill: c.surface });
  rect(ctx, { x: half, y: top, w: half, h: H - top, fill: c.strong });
  const onStrong = c.onStrong, soft = [0.2, 0.1, 0].map(m => mix(onStrong, c.strong, m)).find(col => contrast(col, c.strong) >= 4.6) ?? onStrong;
  compareSides(ctx, slide, [{ x: a.x - 36 + 36, y: top + 8, w: half - a.x - 24, h: H - top - 40 }, { x: half + 24, y: top + 8, w: half - a.x - 24, h: H - top - 40 }],
    [{ ink: c.ink, muted: c.muted, accent: c.accent }, { ink: onStrong, muted: soft, accent: onStrong }], 36, 32);
  const r = 34;
  ellipse(ctx, { x: half - r, y: top - r, w: r * 2, h: r * 2, fill: c.ink });
  text(ctx, "vs", { x: half - r, y: top - r, w: r * 2, h: r * 2 }, { font: "heading", size: 24, weight: 700, color: c.bg, align: "center", valign: "middle", lh: 1, italic: ctx.dir.id === "editorial" });
}

export function compareColumns(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, top = header(ctx, slide) + 40, gap = 96, pw = (a.w - gap) / 2, h = a.b - top;
  vline(ctx, a.x + pw + gap / 2, top, a.b, ruleColor(ctx), 1.5);
  divider(ctx, a.x, a.x + pw, top, true); divider(ctx, a.x + pw + gap, a.r, top, true);
  // The headings hang below the rules (they used to start 14 px above them, so the rule ran through the heading).
  const below = 20;
  compareSides(ctx, slide, [{ x: a.x, y: top + below, w: pw, h: h - below }, { x: a.x + pw + gap, y: top + below, w: pw, h: h - below }], [{ ink: c.ink, muted: c.muted, accent: c.muted }, { ink: c.ink, muted: c.muted, accent: c.accent }], 38, 0.0001);
  footer(ctx);
}

/* ---------- people ---------- */

function monogram(ctx: Ctx, person: NonNullable<Slide["people"]>[number], i: number, x: number, y: number, s: number) {
  const c = ctx.c, p = ctx.theme.palette, square = ctx.dir.id === "swiss" || ctx.dir.id === "architect" || ctx.dir.id === "brutalist" || ctx.dir.id === "poster";
  if (person.image) { image(ctx, person.image, { x, y, w: s, h: s }, square ? {} : { round: true }); return; }
  const solid = ctx.dir.id === "swiss" || ctx.dir.id === "architect" || ctx.dir.id === "brutalist" || ctx.dir.id === "poster";
  const fills = ctx.dir.id === "colorblock" ? [p.accent, p.accent2, p.dark, p.surface] : solid ? [c.ink, c.signal, c.ink] : ctx.dir.ground === "dark" ? [mix(c.signal, c.bg, 0.6), mix(c.accent2, c.bg, 0.6)] : [mix(c.signal, c.bg, 0.8), mix(c.accent2, c.bg, 0.8)];
  const fill = fills[i % fills.length];
  if (square) rect(ctx, { x, y, w: s, h: s, fill, ...(ctx.dir.panel === "heavy" ? { stroke: c.ink, strokeWidth: 3 } : {}) });
  else ellipse(ctx, { x, y, w: s, h: s, fill });
  text(ctx, initials(person.name), { x, y, w: s, h: s }, { font: "heading", size: Math.round(s * 0.36), weight: valueWeight(ctx), align: "center", valign: "middle", color: readableOn(fill, i % 2 ? c.accent2 : c.accent, c.ink, c.bg, "#FFFFFF"), lh: 1 });
}

export function teamRow(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, people = slide.people!, n = people.length, top = header(ctx, slide) + 44;
  const cols = n <= 4 ? n : 3, rows = Math.ceil(n / cols), gap = n === 4 ? 32 : 48, colW = (a.w - gap * (cols - 1)) / cols;
  placed(ctx, top, a.b, sub => {
    if (rows === 1) {
      const size = cols <= 3 ? 128 : 104;
      const align = ctx.dir.axis === "center" ? "center" as const : "left" as const;
      people.forEach((person, i) => {
        const x = a.x + i * (colW + gap);
        monogram(sub, person, i, align === "center" ? x + (colW - size) / 2 : x, top, size);
        let y = top + size + 24;
        y += text(sub, person.name, { x, y, w: colW }, titleStyle(ctx, cols <= 3 ? 28 : 24, { maxH: 70, min: 18, align })) + 6;
        y += text(sub, person.role, { x, y, w: colW }, { ...labelStyle(ctx), color: c.accent, maxH: 44, min: 11, align }) + 12;
        if (person.detail) text(sub, person.detail, { x, y, w: colW }, bodyStyle(ctx, { size: cols <= 3 ? 21 : 19, maxH: a.b - y, min: 15, align }));
      });
      return;
    }
    const rowH = Math.min(210, (a.b - top) / rows), size = 76;
    people.forEach((person, i) => {
      const x = a.x + (i % cols) * (colW + gap), y0 = top + Math.floor(i / cols) * rowH, tx = x + size + 20, tw = colW - size - 20;
      monogram(sub, person, i, x, y0, size);
      let y = y0 + 4;
      y += text(sub, person.name, { x: tx, y, w: tw }, titleStyle(ctx, 22, { maxH: 56, min: 16 })) + 4;
      y += text(sub, person.role, { x: tx, y, w: tw }, { ...labelStyle(ctx), size: 13, color: c.accent, maxH: 38, min: 11 }) + 8;
      if (person.detail) text(sub, person.detail, { x: tx, y, w: tw }, bodyStyle(ctx, { size: 18, maxH: y0 + rowH - y - 16, min: 15 }));
    });
  });
  footer(ctx);
}

export function teamList(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, people = slide.people!, n = people.length;
  const lw = Math.round(a.w * 0.32), rx = a.x + lw + 56, rw = a.r - rx;
  stack(ctx, { label: slide.eyebrow, title: slide.title, size: ctx.dir.sizes.headline, min: 30, sub: slide.body, subStyle: { size: 22 } }, { x: a.x, y: a.y, w: lw, h: a.b - a.y }, "top");
  const rowH = (a.b - a.y) / n, nameW = Math.round(rw * 0.5), nameSize = Math.min(36, rowH * 0.36);
  people.forEach((person, i) => {
    const y = a.y + i * rowH;
    divider(ctx, rx, a.r, y, i === 0);
    text(ctx, person.name, { x: rx, y: y + 14, w: nameW - 16 }, titleStyle(ctx, nameSize, { maxH: rowH - 24, min: 18 }));
    const dx = rx + nameW, dw = rw - nameW;
    const rh = text(ctx, person.role, { x: dx, y: y + 18, w: dw }, { ...labelStyle(ctx), color: c.accent, maxH: 40, min: 11 });
    if (person.detail) text(ctx, person.detail, { x: dx, y: y + 24 + rh, w: dw }, bodyStyle(ctx, { size: 19, maxH: rowH - rh - 34, min: 15 }));
  });
  divider(ctx, rx, a.r, a.b);
  footer(ctx);
}

export function teamGrid(ctx: Ctx, slide: Slide) {
  const a = area(ctx), people = slide.people!, n = people.length, top = header(ctx, slide) + 32;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 18, cw = (a.w - gap * (cols - 1)) / cols, ch = (a.b - top - gap * (rows - 1)) / rows, pad = 26;
  const ms = rows > 1 ? 64 : 92;
  people.forEach((person, i) => {
    const x = a.x + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
    const ink = panel(ctx, { x, y, w: cw, h: ch }, false, i + 1);
    const horizontal = rows > 1;
    monogram(ctx, person, i, x + pad, y + pad, ms);
    const tx = horizontal ? x + pad + ms + 20 : x + pad, tw = horizontal ? cw - pad * 2 - ms - 20 : cw - pad * 2;
    const blockH = measure(ctx, person.name, tw, titleStyle(ctx, horizontal ? 22 : 26)) + 4 + measure(ctx, person.role, tw, { ...labelStyle(ctx), size: 13 }) + 10 + (person.detail ? measure(ctx, person.detail, tw, bodyStyle(ctx, { size: horizontal ? 18 : 20 })) : 0);
    let ty = horizontal ? y + pad : Math.max(y + pad + ms + 22, y + ch - pad - blockH);
    ty += text(ctx, person.name, { x: tx, y: ty, w: tw }, titleStyle(ctx, horizontal ? 22 : 26, { color: ink.ink, maxH: 60, min: 16 })) + 4;
    ty += text(ctx, person.role, { x: tx, y: ty, w: tw }, { ...labelStyle(ctx), size: 13, color: ink.accent, maxH: 40, min: 11 }) + 10;
    if (person.detail) text(ctx, person.detail, { x: tx, y: ty, w: tw }, bodyStyle(ctx, { size: horizontal ? 18 : 20, color: ink.muted, maxH: y + ch - pad - ty, min: 15 }));
  });
  footer(ctx);
}

/* ---------- pricing ---------- */

function pricingLayout(ctx: Ctx, slide: Slide, top: number, cards: boolean) {
  const a = area(ctx), c = ctx.c, tiers = slide.tiers!, n = tiers.length, gap = cards ? (n === 4 ? 18 : 24) : 40;
  const colW = (a.w - gap * (n - 1)) / n, pad = cards ? (n >= 3 ? 24 : 32) : 0, limit = a.b - top;
  const priceMax = scaled(ctx, n <= 2 ? 72 : n === 3 ? 60 : 46), start = n === 4 ? 17 : n === 3 ? 19 : 22;
  const build = (size: number) => {
    const priceSize = Math.max(30, Math.round(priceMax * Math.min(1, 0.3 + 0.7 * size / start)));
    const panels = tiers.map((tier, i) => {
      const x = a.x + i * (colW + gap), strong = !!tier.highlight, w = colW - pad * 2;
      const sub: Ctx = { ...ctx, prims: [], issues: [] };
      const ink = cards && strong ? { ink: c.onStrong, muted: c.onStrong, accent: c.onStrong } : { ink: c.ink, muted: c.muted, accent: c.accent };
      let y = top + (cards ? pad : 22);
      y += text(sub, tier.name, { x: x + pad, y, w }, { ...labelStyle(ctx), size: 15, color: strong && !cards ? c.accent : ink.accent, maxH: 44, min: 12 }) + 14;
      y += text(sub, tier.price, { x: x + pad, y, w }, { ...valueStyle(ctx, priceSize, strong && !cards ? c.accent : ink.ink), maxH: Math.round(priceSize * 1.1), min: 28 }) + 6;
      if (tier.period) y += text(sub, tier.period, { x: x + pad, y, w }, { size: Math.max(15, size - 2), color: ink.muted, maxH: 48, min: 14 }) + 6;
      if (tier.description) y += 10 + text(sub, tier.description, { x: x + pad, y: y + 10, w }, { size: Math.max(15, size - 1), color: ink.muted, maxH: 96, min: 15 });
      if (tier.features.length) {
        y += 18; sub.prims.push({ k: "line", x1: x + pad, y1: y, x2: x + colW - pad, y2: y, color: cards && strong ? mix(ink.ink, c.strong, 0.6) : c.rule, width: 1.5 }); y += 18;
        for (const feature of tier.features) {
          rect(sub, { x: x + pad, y: y + size * 0.5, w: 8, h: 8, fill: cards && strong ? ink.ink : c.accent, radius: ctx.dir.radius ? 4 : 0 });
          y += text(sub, feature, { x: x + pad + 22, y, w: w - 22 }, { size, color: ink.ink, lh: 1.32 }) + 8;
        }
      }
      return { x, strong, prims: sub.prims, issues: sub.issues, height: y - top + (cards ? pad - 6 : 0) };
    });
    return { panels, height: Math.max(...panels.map(panel => panel.height)) };
  };
  let size = start, result = build(size);
  while (result.height > limit && size > 15) result = build(--size);
  if (result.height > limit) ctx.issues.push("the pricing options have too much text for one slide");
  return { result, colW, limit };
}
export function pricingCards(ctx: Ctx, slide: Slide) {
  const a = area(ctx), top = header(ctx, slide, { size: ctx.dir.sizes.headline * 0.88, maxLines: 1 }) + 36;
  const { result, colW, limit } = pricingLayout(ctx, slide, top, true);
  const ph = Math.min(limit, result.height);
  placed(ctx, top, a.b, sub => {
    for (const p of result.panels) {
      panel(sub, { x: p.x, y: top, w: colW, h: ph }, p.strong, -1);
      sub.prims.push(...p.prims); sub.issues.push(...p.issues);
    }
  }, 0.36);
  footer(ctx);
}
export function pricingColumns(ctx: Ctx, slide: Slide) {
  const a = area(ctx), c = ctx.c, top = header(ctx, slide, { size: ctx.dir.sizes.headline * 0.88, maxLines: 1 }) + 32;
  const { result, colW } = pricingLayout(ctx, slide, top, false);
  for (const p of result.panels) {
    hline(ctx, p.x, p.x + colW, top, p.strong ? c.accent : ruleColor(ctx), p.strong ? 6 : 1.5);
    ctx.prims.push(...p.prims); ctx.issues.push(...p.issues);
  }
  void a;
  footer(ctx);
}

/* ---------- tables ---------- */

function tableLayout(ctx: Ctx, slide: Slide, boxed: boolean) {
  const a = area(ctx), c = ctx.c, t = slide.table!, top = header(ctx, slide) + 36;
  const weights = t.columns.map((_, i) => i === 0 ? 1.35 : 1), sum = weights.reduce((x, y) => x + y, 0);
  const widths = weights.map(weight => a.w * weight / sum), xs = widths.map((_, i) => a.x + widths.slice(0, i).reduce((x, y) => x + y, 0));
  const padX = 16, padY = 14, headStyle = (size: number): TextStyle => ({ ...labelStyle(ctx), size: Math.max(12, Math.min(15, size - 5)), lh: 1.25 });
  const rowsAt = (size: number) => {
    const head = Math.max(...t.columns.map((col, i) => col ? measure(ctx, col, widths[i] - padX * 2, headStyle(size)) : 0)) + padY * 2;
    const rows = t.rows.map(row => Math.max(...row.map((cell, i) => cell ? measure(ctx, cell, widths[i] - padX * 2, { size, lh: 1.3, weight: i === 0 || i === t.highlight ? 700 : 400 }) : 0), Math.ceil(size * 1.3)) + padY * 2);
    return { head, rows, total: head + rows.reduce((x, y) => x + y, 0) };
  };
  let size = 23, dims = rowsAt(size);
  while (dims.total > a.b - top && size > 15) dims = rowsAt(--size);
  // Short tables breathe: spare height goes into the rows instead of an empty band.
  const spare = (a.b - top) * 0.92 - dims.total;
  if (spare > 0) { const add = Math.min(28, spare / (t.rows.length + 1)); dims.rows = dims.rows.map(h => h + add); dims.head += add * 0.5; dims.total += add * (t.rows.length + 0.5); }
  if (dims.total > a.b - top) ctx.issues.push("the table has too much text for one slide");
  const headFill = boxed ? (ctx.dir.ground === "dark" ? c.surface : c.ink) : undefined, headInk = headFill ? readableOn(headFill, c.bg, "#FFFFFF", "#111111") : undefined;
  placed(ctx, top, a.b, sub => {
    const total = Math.min(dims.total, a.b - top);
    if (t.highlight !== undefined) rect(sub, { x: xs[t.highlight], y: top, w: widths[t.highlight], h: total, fill: mix(c.accent, c.bg, ctx.dir.ground === "dark" ? 0.75 : 0.86), radius: boxed ? 0 : Math.min(ctx.dir.radius, 6) });
    if (headFill) rect(sub, { x: a.x, y: top, w: a.w, h: dims.head, fill: headFill });
    t.columns.forEach((col, i) => col && text(sub, col, { x: xs[i] + padX, y: top + padY, w: widths[i] - padX * 2, h: dims.head - padY * 2 }, { ...headStyle(size), color: headInk ?? (i === t.highlight ? c.ink : c.accent), valign: "bottom" }));
    let y = top + dims.head;
    if (!boxed) sub.prims.push({ k: "line", x1: a.x, y1: y, x2: a.r, y2: y, color: c.ink, width: 2 });
    t.rows.forEach((row, r) => {
      row.forEach((cell, i) => { if (cell) text(sub, cell, { x: xs[i] + padX, y: y + padY, w: widths[i] - padX * 2, h: dims.rows[r] - padY * 2 }, { size, lh: 1.3, weight: i === 0 || i === t.highlight ? 700 : 400, color: i === 0 || i === t.highlight ? c.ink : c.muted }); });
      y += dims.rows[r];
      if (r < t.rows.length - 1 || boxed) sub.prims.push({ k: "line", x1: a.x, y1: y, x2: a.r, y2: y, color: boxed ? c.ink : c.rule, width: boxed ? (ctx.dir.panel === "heavy" ? 3 : 1) : 1 });
    });
    if (boxed) {
      const bw = ctx.dir.panel === "heavy" ? 3 : 1;
      xs.forEach((x, i) => { if (i) sub.prims.push({ k: "line", x1: x, y1: top, x2: x, y2: top + total, color: c.ink, width: bw }); });
      sub.prims.push({ k: "rect", x: a.x, y: top, w: a.w, h: total, fill: c.bg, noFill: true, stroke: c.ink, strokeWidth: bw + (ctx.dir.panel === "heavy" ? 1 : 0) });
    }
  }, 0.36);
  footer(ctx);
}
export const tableClean = (ctx: Ctx, slide: Slide) => tableLayout(ctx, slide, false);
export const tableBoxed = (ctx: Ctx, slide: Slide) => tableLayout(ctx, slide, true);

export { stack, display, fitDisplay, hline };
