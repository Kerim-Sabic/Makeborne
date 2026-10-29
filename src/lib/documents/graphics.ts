import { mix, readableOn, contrast } from "./theme";
import { art, ellipse, line, path, rect, rng, type Ctx, type PathSeg } from "./scene-kit";
import type { GraphicKind } from "./directions";

/** Generative, on-brand graphic language for decks without photography. Every
 * mark is seeded per deck and slide (stable across renders) and built from
 * primitives the PPTX writer maps to native shapes; gradients and dense
 * patterns are trusted SVG that the PPTX writer embeds as a rendered image. */

type Box = { x: number; y: number; w: number; h: number };
const K = 0.5523;

export function circlePath(cx: number, cy: number, r: number): PathSeg[] {
  return [{ op: "M", x: cx + r, y: cy },
    { op: "C", x1: cx + r, y1: cy + r * K, x2: cx + r * K, y2: cy + r, x: cx, y: cy + r },
    { op: "C", x1: cx - r * K, y1: cy + r, x2: cx - r, y2: cy + r * K, x: cx - r, y: cy },
    { op: "C", x1: cx - r, y1: cy - r * K, x2: cx - r * K, y2: cy - r, x: cx, y: cy - r },
    { op: "C", x1: cx + r * K, y1: cy - r, x2: cx + r, y2: cy - r * K, x: cx + r, y: cy }, { op: "Z" }];
}
/** Cubic approximation of a circular arc from angle a0 to a1 (radians, clockwise on screen). */
export function arcSegs(cx: number, cy: number, r: number, a0: number, a1: number, move = true): PathSeg[] {
  const segs: PathSeg[] = [], steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), step = (a1 - a0) / steps;
  if (move) segs.push({ op: "M", x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) });
  for (let i = 0; i < steps; i++) {
    const s = a0 + i * step, e = s + step, k = 4 / 3 * Math.tan(step / 4);
    segs.push({ op: "C", x1: cx + r * (Math.cos(s) - k * Math.sin(s)), y1: cy + r * (Math.sin(s) + k * Math.cos(s)), x2: cx + r * (Math.cos(e) + k * Math.sin(e)), y2: cy + r * (Math.sin(e) - k * Math.cos(e)), x: cx + r * Math.cos(e), y: cy + r * Math.sin(e) });
  }
  return segs;
}
/** Quarter disc filling a square, its centre at one corner (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left). */
export function quarterPath(x: number, y: number, s: number, corner: number): PathSeg[] {
  const [cx, cy] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]][corner % 4];
  const a0 = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][corner % 4];
  return [{ op: "M", x: cx, y: cy }, { op: "L", x: cx + s * Math.cos(a0), y: cy + s * Math.sin(a0) }, ...arcSegs(cx, cy, s, a0, a0 + Math.PI / 2, false), { op: "Z" }];
}
/** Half disc on one side of a box (0 bottom half facing up, 1 left, 2 top, 3 right). */
export function halfPath(b: Box, side: number): PathSeg[] {
  const s = side % 4;
  if (s === 0) { const r = Math.min(b.w / 2, b.h); const cx = b.x + b.w / 2, cy = b.y + b.h; return [{ op: "M", x: cx - r, y: cy }, ...arcSegs(cx, cy, r, Math.PI, Math.PI * 2, false), { op: "Z" }]; }
  if (s === 2) { const r = Math.min(b.w / 2, b.h); const cx = b.x + b.w / 2, cy = b.y; return [{ op: "M", x: cx + r, y: cy }, ...arcSegs(cx, cy, r, 0, Math.PI, false), { op: "Z" }]; }
  if (s === 1) { const r = Math.min(b.h / 2, b.w); const cx = b.x, cy = b.y + b.h / 2; return [{ op: "M", x: cx, y: cy - r }, ...arcSegs(cx, cy, r, -Math.PI / 2, Math.PI / 2, false), { op: "Z" }]; }
  const r = Math.min(b.h / 2, b.w); const cx = b.x + b.w, cy = b.y + b.h / 2; return [{ op: "M", x: cx, y: cy + r }, ...arcSegs(cx, cy, r, Math.PI / 2, Math.PI * 1.5, false), { op: "Z" }];
}
/** Arch window: a rectangle with a semicircular top. */
export function archPath(b: Box): PathSeg[] {
  const r = b.w / 2;
  return [{ op: "M", x: b.x, y: b.y + b.h }, { op: "L", x: b.x, y: b.y + r }, ...arcSegs(b.x + r, b.y + r, r, Math.PI, Math.PI * 2, false), { op: "L", x: b.x + b.w, y: b.y + b.h }, { op: "Z" }];
}
/** Smooth closed pebble through n jittered points (Catmull-Rom as cubics). */
export function blobPath(cx: number, cy: number, rx: number, ry: number, rand: () => number, n = 7): PathSeg[] {
  const pts = Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2, k = 0.82 + rand() * 0.3; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  const segs: PathSeg[] = [{ op: "M", x: pts[0][0], y: pts[0][1] }];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    segs.push({ op: "C", x1: p1[0] + (p2[0] - p0[0]) / 6, y1: p1[1] + (p2[1] - p0[1]) / 6, x2: p2[0] - (p3[0] - p1[0]) / 6, y2: p2[1] - (p3[1] - p1[1]) / 6, x: p2[0], y: p2[1] });
  }
  segs.push({ op: "Z" });
  return segs;
}
const poly = (points: number[][]): PathSeg[] => [...points.map(([x, y], i) => ({ op: i ? "L" as const : "M" as const, x, y })), { op: "Z" }];
/** A bold arrow inside a square, rotated by `angle` degrees (0 points right, 45 down-right). */
export function arrowPath(x: number, y: number, s: number, angle = 45): PathSeg[] {
  const shape = [[0.08, 0.4], [0.56, 0.4], [0.56, 0.18], [0.94, 0.5], [0.56, 0.82], [0.56, 0.6], [0.08, 0.6]];
  const a = angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return poly(shape.map(([px, py]) => { const dx = (px - 0.5) * s, dy = (py - 0.5) * s; return [x + s / 2 + dx * cos - dy * sin, y + s / 2 + dx * sin + dy * cos]; }));
}

/* ---------- SVG artwork (gradients and patterns) ---------- */
const id = (ctx: Ctx, name: string) => `${name}${ctx.seed.toString(36)}${ctx.prims.length}`;
function glowSvg(ctx: Ctx, b: Box, rand: () => number, colors: string[]) {
  const orbs = colors.map((color, i) => {
    const gid = id(ctx, `g${i}`), cx = b.w * (0.35 + rand() * 0.4), cy = b.h * (0.3 + rand() * 0.45), r = Math.min(b.w, b.h) * (0.38 + rand() * 0.22);
    return `<radialGradient id="${gid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${color}" stop-opacity="${i ? 0.55 : 0.85}"/><stop offset="0.45" stop-color="${color}" stop-opacity="${i ? 0.22 : 0.35}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>|<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(r * 1.25).toFixed(1)}" ry="${r.toFixed(1)}" fill="url(#${gid})"/>`;
  });
  return `<defs>${orbs.map(o => o.split("|")[0]).join("")}</defs>${orbs.map(o => o.split("|")[1]).join("")}`;
}
function dotsSvg(ctx: Ctx, b: Box, gap: number, r: number, color: string, opacity: number, fade: boolean) {
  const pid = id(ctx, "p"), mid = id(ctx, "m"), gid = id(ctx, "f");
  const mask = fade ? `<radialGradient id="${gid}" cx="60%" cy="45%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><mask id="${mid}"><rect width="${b.w}" height="${b.h}" fill="url(#${gid})"/></mask>` : "";
  return `<defs><pattern id="${pid}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><circle cx="${gap / 2}" cy="${gap / 2}" r="${r}" fill="${color}" fill-opacity="${opacity}"/></pattern>${mask}</defs><rect width="${b.w}" height="${b.h}" fill="url(#${pid})"${fade ? ` mask="url(#${mid})"` : ""}/>`;
}
function hatchSvg(ctx: Ctx, b: Box, gap: number, color: string, width: number, opacity: number) {
  const pid = id(ctx, "h");
  return `<defs><pattern id="${pid}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"/></pattern></defs><rect width="${b.w}" height="${b.h}" fill="url(#${pid})"/>`;
}
export const dotField = (ctx: Ctx, b: Box, color: string, opacity = 0.35, fade = true, gap = 18) => art(ctx, b, dotsSvg(ctx, b, gap, 1.6, color, opacity, fade));
export const glowField = (ctx: Ctx, b: Box, colors: string[]) => art(ctx, b, glowSvg(ctx, b, rng(ctx.seed ^ 0x51), colors));

/* ---------- palette helpers ---------- */
/** Bold fills for tiles and blocks, each with a readable ink. */
export function fieldColors(ctx: Ctx) {
  const p = ctx.theme.palette, bg = ctx.c.bg;
  return [p.accent, p.accent2, p.dark, p.surface, mix(p.accent, p.background, 0.55), p.background].filter(color => contrast(color, bg) > 1.15 || color === p.surface);
}
export const inkOn = (fill: string, ctx: Ctx) => readableOn(fill, ctx.theme.palette.ink, "#FFFFFF", ctx.theme.palette.background, "#111111");

/* ---------- the graphic catalogue ---------- */
export function graphic(ctx: Ctx, kind: GraphicKind, b: Box, variant = 0, grid?: { cols: number; rows: number }) {
  const rand = rng(ctx.seed ^ (variant * 7919 + kind.length * 104729));
  const c = ctx.c, p = ctx.theme.palette;
  switch (kind) {
    case "modules": {
      // Swiss modular grid: hairline cells, a few solid signal marks, one large disc spanning four cells.
      const cols = b.w > b.h * 1.3 ? 6 : 4, cell = Math.floor(Math.min(b.w / cols, b.h / Math.max(3, Math.round(b.h / (b.w / cols)))));
      const rows = Math.max(2, Math.floor(b.h / cell)), x0 = b.x + b.w - cols * cell, y0 = b.y;
      const mono = ctx.dir.id === "architect", signal = mono ? c.ink : c.signal;
      for (let i = 0; i <= cols; i++) line(ctx, x0 + i * cell, y0, x0 + i * cell, y0 + rows * cell, c.rule, 1);
      for (let j = 0; j <= rows; j++) line(ctx, x0, y0 + j * cell, x0 + cols * cell, y0 + j * cell, c.rule, 1);
      const big = { i: Math.floor(rand() * (cols - 1)), j: Math.floor(rand() * (rows - 1)) };
      const taken = new Set([`${big.i},${big.j}`, `${big.i + 1},${big.j}`, `${big.i},${big.j + 1}`, `${big.i + 1},${big.j + 1}`]);
      ellipse(ctx, { x: x0 + big.i * cell + 6, y: y0 + big.j * cell + 6, w: cell * 2 - 12, h: cell * 2 - 12, fill: signal });
      let marks = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (taken.has(`${i},${j}`)) continue;
        const roll = rand(), x = x0 + i * cell, y = y0 + j * cell;
        if (roll < 0.1 || (marks < 2 && roll < 0.2)) { rect(ctx, { x: x + 6, y: y + 6, w: cell - 12, h: cell - 12, fill: marks % 2 ? c.ink : signal }); marks++; }
        else if (roll < 0.2) path(ctx, quarterPath(x + 6, y + 6, cell - 12, Math.floor(rand() * 4)), { fill: c.ink });
        else if (roll < 0.28) ellipse(ctx, { x: x + cell / 2 - 5, y: y + cell / 2 - 5, w: 10, h: 10, fill: c.ink });
      }
      return;
    }
    case "disc": {
      // Swiss poster: one large signal disc on a heavy rule that runs out of the frame.
      const r = Math.min(b.w * 0.36, b.h * 0.5), cx = b.x + b.w - r - 4, cy = b.y + r + (b.h - 2 * r) * (0.2 + rand() * 0.5);
      rect(ctx, { x: b.x + b.w * 0.08, y: cy - 4, w: cx - b.x - b.w * 0.08, h: 8, fill: c.ink });
      ellipse(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill: c.signal });
      ellipse(ctx, { x: b.x + b.w * 0.08 - 10, y: cy - 10, w: 20, h: 20, fill: c.ink });
      return;
    }
    case "mosaic": {
      // Bauhaus tiles: each square holds a quarter, half, full disc or block in a contrasting palette colour.
      const colors = fieldColors(ctx), cols = grid?.cols ?? Math.max(2, Math.round(b.w / Math.min(b.w / 2, b.h / 2.6))), size = grid ? Math.min(b.w / grid.cols, b.h / grid.rows) : Math.min(b.w / cols, b.h / Math.max(2, Math.round(b.h / (b.w / cols))));
      const rows = grid?.rows ?? Math.max(1, Math.floor(b.h / size + 0.01)), x0 = b.x + (b.w - cols * size) / 2, y0 = b.y + (b.h - rows * size) / 2;
      let last = -1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        let bgIndex = Math.floor(rand() * colors.length); if (bgIndex === last) bgIndex = (bgIndex + 1) % colors.length; last = bgIndex;
        const tileBg = colors[bgIndex], shape = colors[(bgIndex + 1 + Math.floor(rand() * (colors.length - 1))) % colors.length];
        const x = x0 + i * size, y = y0 + j * size, roll = rand();
        rect(ctx, { x, y, w: size, h: size, fill: tileBg });
        if (roll < 0.34) path(ctx, quarterPath(x, y, size, Math.floor(rand() * 4)), { fill: shape });
        else if (roll < 0.6) path(ctx, halfPath({ x, y, w: size, h: size }, Math.floor(rand() * 4)), { fill: shape });
        else if (roll < 0.82) ellipse(ctx, { x: x + size * 0.14, y: y + size * 0.14, w: size * 0.72, h: size * 0.72, fill: shape });
        else if (roll < 0.92) ellipse(ctx, { x: x + size * 0.36, y: y + size * 0.36, w: size * 0.28, h: size * 0.28, fill: shape });
      }
      return;
    }
    case "arches": {
      // The seed (deck title, slide and direction) picks the arrangement, so unrelated decks in this direction do not share one cover:
      // one tall arch or a pair, the sun left, right or set low as a half disc, and the stone on either side.
      const layout = Math.floor(rand() * 6), pair = layout % 2 === 1, sunAt = Math.floor(layout / 2) % 3;
      const aw = Math.min(b.w * (pair ? 0.46 : 0.62), b.h * (pair ? 0.5 : 0.62)), ah = Math.min(b.h * 0.92, aw * 1.55), ax = b.x + b.w * (pair ? 0.1 + rand() * 0.08 : 0.18 + rand() * 0.16), ay = b.y + b.h - ah;
      const field = contrast(p.accent2, c.bg) > 1.4 ? p.accent2 : p.dark, second = contrast(p.dark, c.bg) > 1.4 && p.dark !== field ? p.dark : mix(field, c.bg, 0.4);
      if (pair) {
        const bw = aw * 0.78, bh = ah * 0.72, bx = ax + aw * 0.72;
        path(ctx, archPath({ x: bx, y: b.y + b.h - bh, w: bw, h: bh }), { fill: second });
      }
      path(ctx, archPath({ x: ax, y: ay, w: aw, h: ah }), { fill: field });
      path(ctx, archPath({ x: ax + aw * 0.16, y: ay + aw * 0.16, w: aw * 0.68, h: ah - aw * 0.16 }), { stroke: mix(field, "#FFFFFF", 0.35), strokeWidth: 2 });
      const sun = aw * (sunAt === 2 ? 0.6 : 0.42);
      if (sunAt === 0) ellipse(ctx, { x: ax + aw * 0.62, y: ay - sun * 0.28, w: sun, h: sun, fill: c.signal });
      else if (sunAt === 1) ellipse(ctx, { x: ax - sun * 0.45, y: ay + ah * 0.18, w: sun, h: sun, fill: c.signal });
      else path(ctx, halfPath({ x: Math.min(b.x + b.w - sun, ax + aw * (pair ? 1.55 : 1.05)), y: b.y + b.h - sun / 2, w: sun, h: sun / 2 }, 0), { fill: c.signal });
      const stoneLeft = sunAt === 2 || rand() < 0.5;
      path(ctx, blobPath(stoneLeft ? ax - aw * 0.1 : ax + aw * 0.8, b.y + b.h - aw * 0.16, aw * 0.3, aw * 0.16, rand), { fill: mix(p.surface, p.accent, 0.12) });
      line(ctx, Math.max(b.x, ax - aw * 0.45), b.y + b.h, Math.min(b.x + b.w, ax + aw * (pair ? 1.9 : 1.45)), b.y + b.h, c.ink, 2);
      return;
    }
    case "glow": {
      glowField(ctx, b, [p.accent, p.accent2]);
      dotField(ctx, b, c.ink, 0.28, true, 20);
      const r = Math.min(b.w, b.h) * 0.42, cx = b.x + b.w * 0.58, cy = b.y + b.h * 0.5;
      ellipse(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: c.rule, strokeWidth: 1 });
      ellipse(ctx, { x: cx - r * 0.62, y: cy - r * 0.62, w: r * 1.24, h: r * 1.24, stroke: c.rule, strokeWidth: 1 });
      ellipse(ctx, { x: cx + r * 0.62 - 5, y: cy - r * 0.78 - 5, w: 10, h: 10, fill: c.signal });
      return;
    }
    case "plan": {
      // Plan drawing: walls, a door swing, a column and a dimension line.
      const x0 = b.x + 8, y0 = b.y + 28, w = b.w - 16, h = b.h - 36, ink = c.ink;
      line(ctx, x0, b.y + 8, x0 + w, b.y + 8, c.muted, 1); line(ctx, x0, b.y + 2, x0, b.y + 14, c.muted, 1); line(ctx, x0 + w, b.y + 2, x0 + w, b.y + 14, c.muted, 1);
      rect(ctx, { x: x0, y: y0, w, h, fill: c.bg, noFill: true, stroke: ink, strokeWidth: 2.5 });
      const vx = x0 + w * (0.38 + rand() * 0.2), hy = y0 + h * (0.42 + rand() * 0.2);
      line(ctx, vx, y0, vx, hy - 34, ink, 2.5); line(ctx, vx, hy + 30, vx, y0 + h, ink, 2.5);
      line(ctx, vx, hy, x0 + w, hy, ink, 2.5);
      const door = Math.min(64, w * 0.16);
      path(ctx, [{ op: "M", x: vx, y: hy - 34 + door }, ...arcSegs(vx, hy - 34 + door, door, -Math.PI / 2, 0, false).map(s => s)], { stroke: c.muted, strokeWidth: 1 });
      line(ctx, vx, hy - 34 + door, vx + door, hy - 34 + door, c.muted, 1);
      const col = Math.min(28, w * 0.07);
      ellipse(ctx, { x: x0 + w * 0.2 - col / 2, y: y0 + h * 0.72 - col / 2, w: col, h: col, stroke: ink, strokeWidth: 1.5 });
      rect(ctx, { x: vx + (x0 + w - vx) * 0.55, y: hy + (y0 + h - hy) * 0.35, w: Math.min(64, w * 0.14), h: Math.min(64, w * 0.14), fill: c.signal });
      for (let i = 1; i < 6; i++) line(ctx, x0 + w * 0.62 + i * 8, y0 + 2, x0 + w * 0.62 + i * 8, y0 + 16, c.muted, 1);
      return;
    }
    case "stripes": {
      // Parallel slanted bars kept wholly inside the box.
      // The seed sets the slant direction, bar weight and which bar is set in ink, so each deck's band differs.
      const weight = 0.75 + rand() * 0.5, lean = rand() < 0.5 ? 1 : -1, inkEvery = 2 + Math.floor(rand() * 3), inkOffset = Math.floor(rand() * inkEvery);
      const band = Math.max(16, Math.min(60, b.w / 9 * weight)), slant = Math.min(b.h * 0.55, b.w * 0.35), step = band * (1.6 + rand() * 0.6);
      const n = Math.max(1, Math.floor((b.w - slant - band) / step) + 1), x0 = b.x + (b.w - slant - band - (n - 1) * step) / 2;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, top = lean > 0 ? x + slant : x, bottom = lean > 0 ? x : x + slant;
        path(ctx, poly([[top, b.y], [top + band, b.y], [bottom + band, b.y + b.h], [bottom, b.y + b.h]]), { fill: i % inkEvery === inkOffset ? c.ink : c.signal });
      }
      return;
    }
    case "plate": {
      // Engraved plate: framed panel with a sun over hatched water.
      rect(ctx, { x: b.x, y: b.y, w: b.w, h: b.h, fill: c.surface });
      rect(ctx, { x: b.x + 14, y: b.y + 14, w: b.w - 28, h: b.h - 28, fill: c.surface, noFill: true, stroke: c.rule, strokeWidth: 1 });
      const horizon = b.y + b.h * (0.56 + rand() * 0.1), r = Math.min(b.w, b.h) * 0.22, cx = b.x + b.w * (0.4 + rand() * 0.2);
      art(ctx, { x: b.x + 28, y: horizon, w: b.w - 56, h: b.y + b.h - 28 - horizon }, hatchSvg(ctx, { x: 0, y: 0, w: b.w - 56, h: b.y + b.h - 28 - horizon }, 9, c.ink, 1.2, 0.5));
      ellipse(ctx, { x: cx - r, y: horizon - r * 1.25, w: r * 2, h: r * 2, fill: c.signal });
      for (let i = 1; i <= 3; i++) ellipse(ctx, { x: cx - r - i * 16, y: horizon - r * 1.25 - i * 16, w: (r + i * 16) * 2, h: (r + i * 16) * 2, stroke: c.rule, strokeWidth: 1 });
      rect(ctx, { x: b.x + 28, y: horizon - 1, w: b.w - 56, h: Math.min(b.y + b.h - 28, horizon + r * 0.8) - horizon + 1, fill: c.surface, opacity: 0 });
      line(ctx, b.x + 28, horizon, b.x + b.w - 28, horizon, c.ink, 1.5);
      return;
    }
    case "contour": {
      const r = Math.min(b.w, b.h) * 0.42, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ellipse(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: c.accent, strokeWidth: 1 });
      ellipse(ctx, { x: cx - r * 0.5 + r * 0.5, y: cy - r * 0.5, w: r, h: r, stroke: c.rule, strokeWidth: 1 });
      line(ctx, cx, b.y, cx, b.y + b.h, c.rule, 1);
      path(ctx, poly([[cx, cy - 7], [cx + 7, cy], [cx, cy + 7], [cx - 7, cy]]), { fill: c.accent });
      return;
    }
    case "dots": {
      dotField(ctx, b, c.muted, 0.5, false, 22);
      // Ring size and position follow the seed.
      const r = Math.min(b.w, b.h) * (0.28 + rand() * 0.14), fx = 0.4 + rand() * 0.3, fy = 0.38 + rand() * 0.24;
      ellipse(ctx, { x: b.x + b.w * fx - r, y: b.y + b.h * fy - r, w: r * 2, h: r * 2, stroke: c.accent, strokeWidth: 3 });
      ellipse(ctx, { x: b.x + b.w * fx - 7, y: b.y + b.h * fy - 7, w: 14, h: 14, fill: c.accent });
      return;
    }
    case "blocks": {
      const s = Math.min(b.w * 0.5, b.h * 0.62) * (0.8 + rand() * 0.2), w = ctx.dir.rule?.width ?? 4;
      rect(ctx, { x: b.x + b.w - s - 8, y: b.y + 8, w: s, h: s, fill: c.signal, stroke: c.ink, strokeWidth: w });
      rect(ctx, { x: b.x + b.w - s * 1.45, y: b.y + s * 0.5, w: s * 0.8, h: s * 0.8, fill: c.bg, noFill: true, stroke: c.ink, strokeWidth: w });
      path(ctx, arrowPath(b.x + b.w - s * 1.45 + s * 0.1, b.y + s * 0.6, s * 0.6, 45), { fill: c.ink });
      return;
    }
    case "rings": {
      const r = Math.min(b.w, b.h) * (0.4 + rand() * 0.08), cx = b.x + b.w * (0.5 + rand() * 0.2), cy = b.y + b.h * 0.5, moon = rand() * Math.PI * 2;
      for (let i = 0; i < 4; i++) ellipse(ctx, { x: cx - r + i * r * 0.18, y: cy - r + i * r * 0.18, w: (r - i * r * 0.18) * 2, h: (r - i * r * 0.18) * 2, stroke: i === 0 ? c.accent : c.rule, strokeWidth: i === 0 ? 2 : 1 });
      ellipse(ctx, { x: cx + r * Math.cos(moon) - r * 0.13, y: cy + r * Math.sin(moon) - r * 0.13, w: r * 0.26, h: r * 0.26, fill: c.signal });
      return;
    }
  }
}

/** Small icon-like marks built from primitives, for cards and lists. */
export function glyph(ctx: Ctx, index: number, x: number, y: number, s: number, color: string, outline = false) {
  const style = outline ? { stroke: color, strokeWidth: 2.5 } : { fill: color };
  switch (index % 6) {
    case 0: ctx.prims.push({ k: "ellipse", x, y, w: s, h: s, ...(outline ? { stroke: color, strokeWidth: 2.5 } : { fill: color }) }); return;
    case 1: path(ctx, quarterPath(x, y, s, 3), style); return;
    case 2: path(ctx, poly([[x + s / 2, y], [x + s, y + s], [x, y + s]]), style); return;
    case 3: path(ctx, halfPath({ x, y, w: s, h: s / 2 + s * 0.1 }, 0), style); rect(ctx, { x, y: y + s * 0.68, w: s, h: s * 0.32, fill: color }); return;
    case 4: rect(ctx, { x: x + s * 0.36, y, w: s * 0.28, h: s, fill: color }); rect(ctx, { x, y: y + s * 0.36, w: s, h: s * 0.28, fill: color }); return;
    default: path(ctx, poly([[x + s / 2, y], [x + s, y + s / 2], [x + s / 2, y + s], [x, y + s / 2]]), style);
  }
}
