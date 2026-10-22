import type { DocumentAsset, ImagePlacement, Slide } from "./schema";
import { luminance } from "./theme";
import { H, W, image, type Ctx, type Frame, type ImageTreatment, type Prim, type RectPrim } from "./scene-kit";

/** Where a slide's image goes when its layout is not itself image-led.
 *
 * - side: a full-height image rail (38% of the width) on imageSide (default right); the
 *   composition lays out in the remaining text zone.
 * - band: a full-width image band across the top (200 px) above a chart, table or diagram,
 *   which stay native and editable.
 * - full: the image full-bleed with a dark scrim over a declared text-safe zone (the lower
 *   62% of the slide). The scrim's opacity is computed from the image's measured
 *   brightness in that zone (asset.luma, or the brightest case without it) so every text
 *   colour placed there reaches 4.5:1.
 *
 * Every layout either shows its image (natively, or through one of these) or the editor
 * refuses the slide before an image is paid for (see imageSupport). */
export const NATIVE_IMAGE_LAYOUTS = new Set<Slide["layout"]>(["cover", "closing", "image", "split"]);
export const PLACEMENTS: Partial<Record<Slide["layout"], readonly ImagePlacement[]>> = {
  statement: ["side", "full"], points: ["side"], stats: ["side"], agenda: ["side"], quote: ["side", "full"], section: ["side", "full"],
  chart: ["band", "side"], table: ["band", "side"], diagram: ["band", "side"],
};
export const RAIL_W = Math.round(W * 0.38), RAIL_GAP = 56, BAND_H = 200, BAND_GAP = 32, SCRIM_TOP = Math.round(H * 0.38);

/** Whether a slide's image will be shown, and why not when it won't. */
export function imageSupport(slide: Pick<Slide, "layout" | "image" | "imagePlacement">): { ok: true } | { ok: false; message: string } {
  if (!slide.image && !slide.imagePlacement) return { ok: true };
  const placements = PLACEMENTS[slide.layout];
  if (slide.image && !NATIVE_IMAGE_LAYOUTS.has(slide.layout) && !placements) {
    const shows = [...NATIVE_IMAGE_LAYOUTS, ...Object.keys(PLACEMENTS)].join(", ");
    return { ok: false, message: `layout ${slide.layout} does not show images: drop the image field or use a layout that shows it (${shows})` };
  }
  if (slide.imagePlacement && !(placements ?? []).includes(slide.imagePlacement)) {
    return { ok: false, message: `imagePlacement ${slide.imagePlacement} is not available on a ${slide.layout} slide${placements ? `; use ${placements.join(" or ")}` : " (its layout places the image itself)"}` };
  }
  return { ok: true };
}
/** Placements to try for this slide, the author's choice first; [] when the layout places the image itself or there is none. */
export function placementsFor(slide: Slide): ImagePlacement[] {
  // A closing with next steps keeps its image beside them; otherwise cover and closing images are full or half bleed.
  if (slide.image && slide.layout === "closing" && (slide.points?.length ?? 0) >= 1) return ["side"];
  const placements = slide.image ? PLACEMENTS[slide.layout] : undefined;
  if (!placements) return [];
  return slide.imagePlacement && placements.includes(slide.imagePlacement) ? [slide.imagePlacement, ...placements.filter(p => p !== slide.imagePlacement)] : [...placements];
}

/* ---------- measured brightness and the scrim ---------- */

const toSrgb = (y: number) => y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
const rgb = (hex: string) => [16, 8, 0].map(shift => parseInt(hex.slice(1), 16) >> shift & 255);
type Box = { x: number; y: number; w: number; h: number };
const ASPECT: Record<DocumentAsset["aspect"], number> = { landscape: 1.5, portrait: 2 / 3, square: 1 };

/** Brightest channel (0–255) the image can show inside `zone`, given how it fills `box` (object-fit cover, centred). */
export function zoneBrightness(asset: Pick<DocumentAsset, "aspect" | "luma"> | undefined, box: Box, zone: Box, treatment?: ImageTreatment) {
  let bright = 255;
  if (asset?.luma) {
    const a = ASPECT[asset.aspect], s = Math.max(box.w / a, box.h), ox = (a * s - box.w) / 2, oy = (s - box.h) / 2;
    const cell = (value: number) => Math.max(0, Math.min(7, Math.floor(value * 8)));
    const u0 = cell((zone.x - box.x + ox) / (a * s)), u1 = cell((zone.x + zone.w - box.x + ox) / (a * s) - 1e-9);
    const v0 = cell((zone.y - box.y + oy) / s), v1 = cell((zone.y + zone.h - box.y + oy) / s - 1e-9);
    bright = 0;
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) bright = Math.max(bright, asset.luma[v * 8 + u]);
  }
  if (!treatment) return bright;
  // Duotone and mono map pixel luminance onto a dark→light ramp (render-deck.ts treatmentMatrix, pptx.ts cropped).
  const d = rgb(treatment.dark), l = rgb(treatment.light), lum = bright / 255;
  return Math.max(...d.map((dark, i) => Math.max(dark, dark + (l[i] - dark) * lum)));
}
/** Black scrim opacity at which text of luminance `textLum` reaches `target`:1 over pixels whose brightest channel is `bright`. */
export function scrimOpacity(bright: number, textLum: number, target = 4.6) {
  const maxLum = (textLum + 0.05) / target - 0.05;
  if (maxLum <= 0) return 0.92;
  const allowed = toSrgb(maxLum) * 255;
  // Compositing is in sRGB: a black layer at opacity α scales every channel by (1 - α).
  return Math.min(0.92, Math.max(0.2, bright <= allowed ? 0 : 1 - allowed / bright));
}

/* ---------- placement ---------- */

export type PlacementRun = { placement: ImagePlacement; finish: (ctx: Ctx) => void };
const bbox = (prim: Prim): Box => prim.k === "line"
  ? { x: Math.min(prim.x1, prim.x2), y: Math.min(prim.y1, prim.y2), w: Math.abs(prim.x2 - prim.x1), h: Math.abs(prim.y2 - prim.y1) }
  : { x: prim.x, y: prim.y, w: prim.w, h: prim.h };
const inside = (b: Box, zone: Box, tolerance = 2) => b.x >= zone.x - tolerance && b.y >= zone.y - tolerance && b.x + b.w <= zone.x + zone.w + tolerance && b.y + b.h <= zone.y + zone.h + tolerance;

/** Put the slide's image on the canvas and narrow the composition to its text zone. `finish` runs after the composition. */
export function placeImage(ctx: Ctx, slide: Slide, placement: ImagePlacement, treatment?: ImageTreatment): PlacementRun {
  const name = slide.image!, d = ctx.dir;
  let imageBox: Box, zone: Box, frame: Frame, scrim: RectPrim | undefined;
  if (placement === "side") {
    const left = slide.imageSide === "left";
    imageBox = { x: left ? 0 : W - RAIL_W, y: 0, w: RAIL_W, h: H };
    frame = left ? { x: RAIL_W + RAIL_GAP, r: W - d.mx, y: d.top, b: d.bottom } : { x: d.mx, r: W - RAIL_W - RAIL_GAP, y: d.top, b: d.bottom };
    zone = left ? { x: RAIL_W + 1, y: 0, w: W - RAIL_W - 1, h: H } : { x: 0, y: 0, w: W - RAIL_W - 1, h: H };
  } else if (placement === "band") {
    imageBox = { x: 0, y: 0, w: W, h: BAND_H };
    frame = { x: d.mx, r: W - d.mx, y: BAND_H + BAND_GAP, b: d.bottom };
    zone = { x: 0, y: BAND_H + 1, w: W, h: H - BAND_H - 1 };
  } else {
    imageBox = { x: 0, y: 0, w: W, h: H };
    frame = { x: d.mx, r: W - d.mx - Math.round(W * 0.14), y: SCRIM_TOP + 36, b: d.bottom };
    zone = { x: 0, y: SCRIM_TOP, w: W, h: H - SCRIM_TOP };
    // Text on the scrim is white; marks and rules are light greys.
    ctx.c = { ...ctx.c, bg: "#141414", ink: "#FFFFFF", muted: "#F2F2F2", accent: "#FFFFFF", accent2: "#FFFFFF", signal: "#FFFFFF", rule: "#9A9A9A", surface: "#2A2A2A", strong: "#FFFFFF", onStrong: "#111111" };
  }
  image(ctx, name, imageBox, { crop: "center", ...(treatment ? { treatment } : {}) });
  if (placement === "full") {
    // A soft fade above the solid scrim; the text-safe zone itself sits on the solid part.
    ctx.prims.push({ k: "rect", x: 0, y: SCRIM_TOP - 150, w: W, h: 150, fill: "#000000", opacity: 0.5, fade: "up" });
    scrim = { k: "rect", x: 0, y: SCRIM_TOP, w: W, h: H - SCRIM_TOP, fill: "#000000", opacity: 0.6 };
    ctx.prims.push(scrim);
  }
  const start = ctx.prims.length;
  ctx.frame = frame;
  return {
    placement,
    finish(done: Ctx) {
      const placed = done.prims.slice(start);
      if (placed.some(prim => !inside(bbox(prim), zone))) done.issues.push(`this composition reaches into the slide's ${placement === "side" ? "image rail" : placement === "band" ? "image band" : "image outside the text-safe zone"}`);
      // Content that starts in the narrowed zone must also end in it, clear of the page furniture below.
      else if (placed.some(prim => { const b = bbox(prim); return prim.k === "text" && b.y < frame.b && b.y + b.h > frame.b + 8; })) done.issues.push("the content runs below the text zone; shorten it or choose another placement");
      else {
        // A narrowed zone must not squeeze one text onto another (or a filled block onto a text).
        const texts = placed.filter(prim => prim.k === "text").map(bbox), blocks = placed.filter(prim => prim.k === "rect" && !prim.noFill && prim.w > 60 && prim.h > 60).map(bbox);
        const hit = (p: Box, q: Box) => Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 6 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 6;
        const holds = (outer: Box, inner: Box) => inside(inner, outer, 1);
        if (texts.some((p, i) => texts.some((q, j) => j > i && hit(p, q))) || blocks.some(block => texts.some(t => hit(block, t) && !holds(block, t)))) done.issues.push("text collides with other content in the narrowed zone");
      }
      if (scrim) {
        const texts = placed.filter((prim): prim is Extract<Prim, { k: "text" }> => prim.k === "text");
        const dimmest = Math.min(1, ...texts.map(prim => luminance(prim.color)));
        const asset = done.deck.assets.find(entry => entry.name === name);
        scrim.opacity = Math.round(scrimOpacity(zoneBrightness(asset, imageBox, zone, treatment), dimmest) * 100) / 100;
        // The fade above starts from the scrim's own darkness.
        const fade = done.prims[start - 2];
        if (fade?.k === "rect") fade.opacity = scrim.opacity;
      }
    },
  };
}
