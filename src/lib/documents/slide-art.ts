import type { Deck, DeckAspect, FontPairing, Slide, SlideFrame } from "./schema";
import { contrast, mix } from "./theme";
import { directionOf } from "./directions";
import { formatValue } from "./chart-svg";
import { W, H, type Prim, type RectPrim, type SlideScene } from "./scene-kit";
import { AVOID_AI_LOOK, NUMBER_WORDS as COUNT_WORDS, TYPE_STYLE, accentInText, article, capital, displayLines, quotedLines, swatch, tailNoText, tailSlide } from "./art-direction";

/** Full-image slides (owner, Kerim, 22 Oct 2026: "for presentations i want each slide full image gen ... each slide
 * fully unique nice modern not looking ai slop and text also generated"). Each slide of a deck in image mode is one
 * generated 16:9 picture that carries its own typography. The structured slide stays the source of truth: its fields
 * give the exact words the image must show (slideText), the render is accepted only after the text gate reads those
 * words back (compareSlideText), and the render is shown only while the slide's text still matches what was verified
 * (verifiedArt). Any slide without a verified render, or any deck in "live" mode, is drawn by the editable layout
 * engine instead, so a deck is never shown with wrong words. */

export const ART_COMPOSITION = "full-image";
/** The legacy canvas (1536x1024, measured at medium and high) and the 16:9 band cut from it; other shapes and
 * qualities choose their canvas through art-formats.ts (artCell). */
export const ART_SOURCE = { width: 1536, height: 1024 } as const;
export const ART_CROP = { left: 0, top: 80, width: 1536, height: 864 } as const;
/** The canvas a render is generated on and the part of it that becomes the slide. */
export type ArtCanvas = { size: `${number}x${number}`; crop: { left: number; top: number; width: number; height: number } };
export const LEGACY_CANVAS: ArtCanvas = { size: "1536x1024", crop: ART_CROP };
export const deckAspect = (deck: { art?: Deck["art"] }): DeckAspect => deck.art?.aspect ?? "16:9";
const ASPECT_WORDS: Record<DeckAspect, string> = { "16:9": "16:9", "4:3": "4:3", "1:1": "square 1:1", "9:16": "vertical 9:16" };
/** Image slides read in seconds and image models misspell long text: these are the hard limits a render needs. */
/** Clear space on the finished slide above the first line of text and below the last (the gate enforces it), and the
 * same margin on the 1536×1024 canvas the prompt describes: 80 px cropped + 6.5% of 864 px ≈ 136 px ≈ 14%. */
export const ART_SAFE_MARGIN_PCT = 6.5, ART_CANVAS_MARGIN_PCT = 14;
export const ART_TITLE_WORDS = 10, ART_BODY_WORDS = 35, ART_TARGET_TITLE = 8, ART_TARGET_BODY = 25;

export const FRAME_NOTES: Record<SlideFrame, string> = {
  "full-bleed": "a photograph or illustration fills the whole slide; the type sits on a calm, uncluttered area of it",
  split: "the slide divides into an image field and a type field (halves or thirds), hard edge, no frame",
  "type-poster": "a typographic poster: very large type is the image, little or no picture",
  "big-number": "one or two huge figures are the hero, with a short label and a small supporting image or none",
  "chart-feature": "a clean drawn chart is the hero, labelled with exactly the given values, beside a short takeaway",
  "card-grid": "two to four modular tiles or cards on a strict grid, each with its own short title",
  timeline: "steps or dates placed along one line or path, numbered, read left to right",
  quote: "a large quotation set as the focal point with generous space and a quiet image or texture",
  comparison: "two columns side by side with a clear divider; the recommended side is emphasised",
  "inset-frame": "an image placed inside a generous margin like a gallery print, with type beside or below it",
  collage: "layered image fragments, cut-outs and type overlapping deliberately, magazine style",
  diagram: "a drawn structure (cycle, funnel, matrix, map or flow) that explains the idea, labelled with the given words",
};

export type ArtLine = { role: string; text: string };

const words = (value: string) => value.trim() ? value.trim().split(/\s+/).length : 0;

/** Every word a full-image slide shows, in reading order, with the role it plays in the design. */
export function slideText(slide: Slide): ArtLine[] {
  const out: ArtLine[] = [];
  const add = (role: string, text: string | undefined) => { if (text?.trim()) out.push({ role, text: text.trim() }); };
  add("small label above the title", slide.eyebrow);
  if (slide.layout === "canvas") {
    for (const block of slide.blocks ?? []) if (block.type === "text") add(block.style === "display" || block.style === "headline" ? "title" : block.style, block.text);
    return out;
  }
  add("title (largest type)", slide.title);
  add("subtitle", slide.subtitle);
  add("body", slide.body);
  (slide.points ?? []).forEach((point, index) => { add(`item ${index + 1} title`, point.title); add(`item ${index + 1} text`, point.text); });
  (slide.stats ?? []).forEach((stat, index) => { add(`figure ${index + 1} (very large)`, stat.value); add(`figure ${index + 1} label`, stat.label); add(`figure ${index + 1} detail`, stat.detail); });
  if (slide.chart) {
    const chart = slide.chart;
    if (chart.series.length > 1) chart.series.forEach((series, index) => add(`chart legend ${index + 1}`, series.name));
    chart.categories.forEach((category, index) => {
      add(`chart category ${index + 1}`, category);
      chart.series.forEach(series => add(`chart value for ${category}${chart.series.length > 1 ? ` (${series.name})` : ""}`, formatValue(chart, series.values[index])));
    });
    add("chart source (small)", chart.source);
  }
  (slide.diagram?.items ?? []).forEach((item, index) => { add(`step ${index + 1} label`, item.label); add(`step ${index + 1} detail`, item.detail); });
  if (slide.diagram?.axes) { add("horizontal axis", slide.diagram.axes.x); add("vertical axis", slide.diagram.axes.y); }
  if (slide.compare) for (const [side, value] of [["left", slide.compare.left], ["right (emphasised)", slide.compare.right]] as const) {
    add(`${side} column heading`, value.heading);
    value.points.forEach((point, index) => add(`${side} column point ${index + 1}`, point));
  }
  if (slide.quote) { add("quotation (large)", `“${slide.quote.text.replace(/^["“]|["”]$/g, "")}”`); add("attribution", slide.quote.attribution ? `— ${slide.quote.attribution.replace(/^[—–-]\s*/, "")}` : undefined); }
  if (slide.table) {
    slide.table.columns.forEach((column, index) => add(`table heading ${index + 1}`, column));
    slide.table.rows.forEach((row, r) => row.forEach((cell, c) => add(`table row ${r + 1} cell ${c + 1}`, cell)));
  }
  (slide.people ?? []).forEach((person, index) => { add(`person ${index + 1} name`, person.name); add(`person ${index + 1} role`, person.role); add(`person ${index + 1} detail`, person.detail); });
  (slide.tiers ?? []).forEach((tier, index) => {
    add(`option ${index + 1} name`, tier.name); add(`option ${index + 1} price`, tier.price); add(`option ${index + 1} period`, tier.period);
    add(`option ${index + 1} description`, tier.description); tier.features.forEach((feature, f) => add(`option ${index + 1} feature ${f + 1}`, feature));
  });
  return out;
}

/** The small furniture a full-image slide carries besides its own words (the reference's wordmark and page number). */
export function slideFurniture(deck: Pick<Deck, "slides"> & { art?: Deck["art"] }, slide: Slide): ArtLine[] {
  const out: ArtLine[] = [];
  if (deck.art?.wordmark) out.push({ role: "wordmark (small)", text: deck.art.wordmark });
  const index = deck.slides.findIndex(entry => entry.id === slide.id);
  if (deck.art?.pageNumbers && index >= 0) out.push({ role: "page number (tiny)", text: String(index + 1).padStart(2, "0") });
  return out;
}
/** Every word the gate expects on a render: the slide's own words, then its furniture. */
export const gateText = (deck: Pick<Deck, "slides"> & { art?: Deck["art"] }, slide: Slide) => [...slideText(slide), ...slideFurniture(deck, slide)];

/** A short stable key of a slide's visible words: a render is shown only while the slide still says what was verified. */
export function textKey(slide: Slide) {
  let hash = 0x811c9dc5;
  const text = slideText(slide).map(line => line.text).join("␞");
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `t1-${hash.toString(16).padStart(8, "0")}-${text.length}`;
}

/** Why a slide cannot be rendered as one image (too much text for an image model to set reliably). */
export function artTextIssues(slide: Slide): string[] {
  const issues: string[] = [];
  const lines = slideText(slide), title = lines.find(line => line.role.startsWith("title"));
  if (title && words(title.text) > ART_TITLE_WORDS) issues.push(`the title has ${words(title.text)} words (at most ${ART_TITLE_WORDS}, ideally ${ART_TARGET_TITLE} or fewer)`);
  const body = lines.filter(line => line !== title && !/^chart (value|category)|^figure \d+ \(very large\)|^table/.test(line.role)).reduce((sum, line) => sum + words(line.text), 0);
  if (body > ART_BODY_WORDS) issues.push(`${body} words besides the title (at most ${ART_BODY_WORDS}, ideally ${ART_TARGET_BODY} or fewer); move the detail into the speaker notes`);
  if ((slide.table?.rows.length ?? 0) * (slide.table?.columns.length ?? 0) > 16) issues.push("a table with more than 16 cells");
  if ((slide.chart?.categories.length ?? 0) * (slide.chart?.series.length ?? 1) > 10) issues.push("a chart with more than 10 values");
  return issues;
}

export type DeckArt = NonNullable<Deck["art"]>;
export type ArtRender = DeckArt["renders"][number];
type DeckLike = Pick<Deck, "assets"> & { art?: Deck["art"]; slides?: Deck["slides"] };

/** The asset to show as this whole slide, or null to draw the editable layout. A render is shown only while the slide
 * says what was verified, in the deck's current shape, with the wordmark it shows and at the page number it shows. */
export function verifiedArt(deck: DeckLike, slide: Slide): string | null {
  if (deck.art?.mode !== "image") return null;
  const render = deck.art.renders.find(entry => entry.slide === slide.id);
  if (!render || render.outcome !== "passed" || !render.image || render.verified !== textKey(slide)) return null;
  if ((render.aspect ?? "16:9") !== deckAspect(deck)) return null;
  if ((render.wordmark ?? "") !== (deck.art.wordmark ?? "")) return null;
  if (deck.slides && (render.page !== undefined || deck.art.pageNumbers)) {
    const page = deck.slides.findIndex(entry => entry.id === slide.id) + 1;
    if (deck.art.pageNumbers ? render.page !== page : render.page !== undefined) return null;
  }
  return deck.assets.some(asset => asset.name === render.image) ? render.image : null;
}

/** The scene of a full-image deck's slide: a verified render, the picture full-bleed (its words are its description);
 * or, for a slide kept as editable text that has a checked plate, the editable layout (`live`) set over the plate in
 * the deck's art direction. Null: the editable layout as usual. */
export function artScene<D extends DeckLike & Pick<Deck, "theme">>(deck: D, slide: Slide, live?: (deck: D) => SlideScene): SlideScene | null {
  const image = verifiedArt(deck, slide);
  if (image) return { background: deck.theme.palette.dark, composition: ART_COMPOSITION, issues: [],
    prims: [{ k: "image", x: 0, y: 0, w: W, h: H, name: image, alt: artAlt(slide), crop: "center" }] };
  const render = deck.art?.mode === "image" ? deck.art.renders.find(entry => entry.slide === slide.id && entry.outcome === "fallback") : undefined;
  const plate = render?.plate ? deck.assets.find(asset => asset.name === render.plate) : undefined;
  if (!plate || !live) return null;
  return plateScene(live({ ...deck, art: undefined }), plate, PAGE_HEIGHT[deckAspect(deck)]);
}

export const PLATE_COMPOSITION = "plate";
/** WCAG AA for the live text set over a plate. */
export const PLATE_CONTRAST = 4.5;
const gray = (value: number) => `#${Math.round(value).toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
type Box = { x: number; y: number; w: number; h: number };
/** The plate's brightest and darkest pixels under a box (the plate fills the 16:9 slide; luma and shade are 8×8 grids of it). */
export function plateRange(plate: { luma?: number[]; shade?: number[] }, box: Box, pageHeight = H) {
  // The plate fills the page; a 1280x720 layout on a taller page sits centred on it.
  const cell = (value: number, size: number) => Math.max(0, Math.min(7, Math.floor(value / size * 8)));
  const top = (pageHeight - H) / 2;
  const u0 = cell(box.x, W), u1 = cell(box.x + box.w - 1e-6, W), v0 = cell(top + box.y, pageHeight), v1 = cell(top + box.y + box.h - 1e-6, pageHeight);
  let bright = 0, dark = 255;
  for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) { bright = Math.max(bright, plate.luma?.[v * 8 + u] ?? 255); dark = Math.min(dark, plate.shade?.[v * 8 + u] ?? 0); }
  return { bright, dark };
}
/** Opacity of a `ground` scrim behind text of `color` so it reaches PLATE_CONTRAST over every pixel of the plate under it; 0 when none is needed. */
export function plateScrim(color: string, ground: string, range: { bright: number; dark: number }) {
  for (const alpha of [0, 0.55, 0.7, 0.8, 0.88, 0.94, 1]) {
    if ([range.bright, range.dark].every(value => contrast(color, mix(gray(value), ground, alpha)) >= PLATE_CONTRAST)) return alpha;
  }
  return 1;
}
/** The editable layout over its plate: full-canvas colour fields give way to the plate, and every text or chart that is
 * not already on an opaque panel gets a scrim of its own ground at the opacity its contrast needs (measured from the
 * plate's luma and shade grids, the same rule as text over slide images in compose-image.ts). */
function plateScene(scene: SlideScene, plate: { name: string; luma?: number[]; shade?: number[] }, pageHeight = H): SlideScene {
  const full = (prim: Prim) => prim.k === "rect" && !prim.noFill && (prim.opacity ?? 1) >= 0.95 && prim.w * prim.h >= W * H * 0.95;
  const ground = (scene.prims.find(full) as RectPrim | undefined)?.fill ?? scene.background;
  const panels: Box[] = [], scrims: (Box & { alpha: number })[] = [];
  const prims: Prim[] = [];
  for (const prim of scene.prims) {
    if (full(prim)) continue;
    // Any filled shape under a text is its designed ground (a card, a badge behind a numeral): such text is never scrimmed.
    if ((prim.k === "rect" && !prim.noFill && (prim.opacity ?? 1) >= 0.5 && !prim.fade) || ((prim.k === "ellipse" || prim.k === "path") && prim.fill && (prim.opacity ?? 1) >= 0.5)) panels.push(prim);
    if (prim.k === "text" || prim.k === "chart") {
      const cx = prim.x + prim.w / 2, cy = prim.y + prim.h / 2;
      const onPanel = panels.some(panel => cx >= panel.x && cx <= panel.x + panel.w && cy >= panel.y && cy <= panel.y + panel.h);
      const color = prim.k === "text" ? prim.color : prim.colors.ink;
      // Text not designed for the slide's ground (light type for a coloured shape) is left as composed.
      if (!onPanel && contrast(color, ground) < PLATE_CONTRAST) { prims.push(prim); continue; }
      const pad = 14, box = { x: Math.max(0, prim.x - pad), y: Math.max(0, prim.y - pad), w: Math.min(W, prim.w + 2 * pad), h: Math.min(H, prim.h + 2 * pad) };
      const alpha = onPanel ? 0 : plateScrim(color, ground, plateRange(plate, box, pageHeight));
      if (alpha > 0) scrims.push({ ...box, alpha });
    }
    prims.push(prim);
  }
  // Scrims that touch or nearly touch become one calm panel at the strongest opacity any of its texts needs (the live
  // Helio deck showed a stack of overlapping boxes); every panel sits under the whole layout, right above the plate.
  const merged: (Box & { alpha: number })[] = [];
  for (const scrim of scrims) {
    let box = { ...scrim };
    for (let changed = true; changed;) {
      changed = false;
      for (let i = merged.length - 1; i >= 0; i--) {
        const other = merged[i], gap = 28;
        if (box.x - gap < other.x + other.w && other.x - gap < box.x + box.w && box.y - gap < other.y + other.h && other.y - gap < box.y + box.h) {
          const x = Math.min(box.x, other.x), y = Math.min(box.y, other.y);
          box = { x, y, w: Math.max(box.x + box.w, other.x + other.w) - x, h: Math.max(box.y + box.h, other.y + other.h) - y, alpha: Math.max(box.alpha, other.alpha) };
          merged.splice(i, 1); changed = true;
        }
      }
    }
    merged.push(box);
  }
  const plateImage: Prim = { k: "image", x: 0, y: 0, w: W, h: H, name: plate.name, alt: "", crop: "center" };
  return { ...scene, prims: [plateImage, ...merged.map(box => ({ k: "rect" as const, x: box.x, y: box.y, w: box.w, h: box.h, fill: ground, opacity: box.alpha, radius: 6 })), ...prims], composition: `${PLATE_COMPOSITION}-${scene.composition ?? "layout"}` };
}

/** The prompt for a text-free plate behind an editable slide: same design system and palette, the area where the live
 * text goes left as a calm, nearly plain field. `text` is that area on the slide (px of the 1280×720 canvas). */
export function platePrompt(deck: Pick<Deck, "theme" | "slides" | "title"> & { art?: Deck["art"] }, slide: Slide, text: Box, fix?: string, canvas: ArtCanvas = LEGACY_CANVAS) {
  const index = deck.slides.findIndex(entry => entry.id === slide.id), total = deck.slides.length;
  const { palette, imageStyle } = deck.theme;
  const ground = slide.tone === "dark" ? palette.dark : slide.tone === "accent" ? palette.accent : palette.background;
  // Editable layouts are 1280x720; on a taller page they sit centred, so the reserved area is measured on the page first.
  const page = PAGE_HEIGHT[deckAspect(deck)], top = (page - H) / 2;
  const [cw, ch] = canvas.size.split("x").map(Number);
  const pctX = (x: number) => Math.round((canvas.crop.left + x / W * canvas.crop.width) / cw * 100), pctY = (y: number) => Math.round((canvas.crop.top + (top + y) / page * canvas.crop.height) / ch * 100);
  return [
    `A text-free background plate for slide ${index + 1} of ${total} of the presentation "${deck.title}": the artwork behind a slide whose words are set separately as live text, in the same family as the deck's other slides.`,
    `${swatch(ground)} ground, ${swatch(palette.surface)} surface, ${swatch(palette.accent)} accent, ${swatch(palette.dark)} for deep areas.${imageStyle ? ` Imagery: ${imageStyle}.` : ""}`,
    `Deck design system (the same on every slide): ${deck.art?.system ?? ""}`,
    `Reserved area: from ${pctX(text.x)}% to ${pctX(text.x + text.w)}% across and from ${pctY(text.y)}% to ${pctY(text.y + text.h)}% down the canvas the slide's text will be set. Keep that area a calm, nearly plain field of ${swatch(ground)} with at most a faint paper grain: no objects, lines, patterns or strong tone changes inside it. Put the imagery, the recurring motif and any texture in the rest of the canvas, quietly, so it frames the text.`,
    cropNote(canvas, "continue the background there"),
    AVOID_AI_LOOK,
    tailNoText(ASPECT_WORDS[deckAspect(deck)]),
    fix ? `CORRECTION — the previous attempt had these problems; fix them: ${fix}` : "",
  ].filter(Boolean).join("\n\n");
}
/** Page height (px, 1280 wide) of each slide shape. */
export const PAGE_HEIGHT: Record<DeckAspect, number> = { "16:9": 720, "4:3": 960, "1:1": 1280, "9:16": 2276 };
/** What the prompt says about a cropped canvas: which margins are cut away. */
function cropNote(canvas: ArtCanvas, then: string) {
  const [cw, ch] = canvas.size.split("x").map(Number);
  const y = Math.round(canvas.crop.top / ch * 1000) / 10, x = Math.round(canvas.crop.left / cw * 1000) / 10;
  if (!x && !y) return "";
  return y ? `The top ${y}% and bottom ${y}% of the canvas are cropped away to make the finished slide: ${then}.` : `The left ${x}% and right ${x}% of the canvas are cropped away to make the finished slide: ${then}.`;
}

/** The pairing for a deck's editable slides, from the art system's type description: the bundled faces closest to it,
 * named first, then by style. The same pairing is recorded on deck.art and used for every editable slide. */
export function artFontsFor(system: string, current: FontPairing): FontPairing {
  const text = system.toLowerCase();
  const named: [RegExp, FontPairing][] = [[/fraunces/, "fraunces"], [/newsreader/, "newsreader"], [/playfair/, "playfair"], [/instrument serif/, "instrument"], [/archivo/, "archivo"],
    [/bricolage/, "bricolage"], [/space grotesk/, "space-grotesk"], [/\bsora\b/, "sora"], [/\bgeist\b/, "geist"], [/garamond/, "garamond"]];
  const styles: [RegExp, FontPairing][] = [
    [/condensed|compressed|narrow|din\b|industrial|poster grotesk/, "archivo"],
    [/ink[- ]trap|quirky|characterful (sans|grotesk)/, "bricolage"],
    [/didone|fashion|luxury serif|hairline serif/, "playfair"],
    [/soft serif|warm serif|wonky|chunky serif/, "fraunces"],
    [/high[- ]contrast (editorial )?serif|editorial serif|text serif|newspaper|book serif|literary/, "newsreader"],
    [/tall (display )?serif|display serif/, "instrument"],
    [/techno|monospace|mono labels|grotesk with (a )?technical/, "space-grotesk"],
    [/wide geometric|geometric sans|futur/, "sora"],
    [/swiss|neo-grotesk|neutral grotesk|precise sans/, "geist"],
    [/serif/, "newsreader"],
    [/grotesk|sans/, "geist"],
  ];
  return (named.find(([pattern]) => pattern.test(text)) ?? styles.find(([pattern]) => pattern.test(text)))?.[1] ?? current;
}

/** Alt text and searchable text of a full-image slide: its exact words in reading order. */
export function artAlt(slide: Slide) {
  return slideText(slide).map(line => line.text).join(". ").replace(/([.!?…])\./g, "$1").slice(0, 1500);
}

/** Plan problems for an image-mode deck: every slide unique in composition, never the same layout or frame twice in a row. */
export function artPlanIssues(deck: Pick<Deck, "slides"> & { art?: Deck["art"] }): { slides: number[]; message: string }[] {
  if (deck.art?.mode !== "image") return [];
  const issues: { slides: number[]; message: string }[] = [];
  const frameOf = (slide: Slide) => deck.art!.renders.find(entry => entry.slide === slide.id && entry.outcome === "passed")?.frame ?? slide.art?.frame;
  deck.slides.forEach((slide, index) => {
    if (!slide.art) issues.push({ slides: [index], message: `slide ${index + 1} (${slide.id}) has no art plan (art.frame and art.brief)` });
    const previous = deck.slides[index - 1];
    if (!previous) return;
    if (previous.layout === slide.layout) issues.push({ slides: [index - 1, index], message: `slides ${index} and ${index + 1} both use the ${slide.layout} layout; full-image decks never repeat a layout on consecutive slides` });
    const a = frameOf(previous), b = frameOf(slide);
    if (a && a === b) issues.push({ slides: [index - 1, index], message: `slides ${index} and ${index + 1} both use the ${a} frame; give consecutive slides different compositions` });
  });
  const frames = new Set(deck.slides.map(frameOf).filter(Boolean));
  const want = Math.min(6, Math.ceil(deck.slides.length * 0.6));
  if (deck.slides.length >= 4 && frames.size < want) issues.push({ slides: [], message: `only ${frames.size} different frames across ${deck.slides.length} slides; use at least ${want} so every slide is unique` });
  return issues;
}


/** Each frame's default split, in the reference's exact percentages; a slide's art.layout overrides it. */
export const FRAME_LAYOUT: Record<SlideFrame, string> = {
  "full-bleed": "The image runs full-bleed across 100% of the slide; the type block sits on its calmest area, the left 45% or the lower 40%",
  split: "Left 46%: a solid type field on the ground colour; right 54%: a full-bleed image to the slide's edges, hard edge, no frame",
  "type-poster": "Typography is the image: the type block spans about 70% of the slide width on the ground colour, with at most one small image accent",
  "big-number": "The figures fill the left 60% at poster size; the right 40% holds a small supporting image or stays empty",
  "chart-feature": "Headline across the top 30%; the chart across the lower 60% at full width inside the margins",
  "card-grid": "Headline across the top 25%; below it the tiles on a strict equal grid across the full width",
  timeline: "Headline across the top 30%; the steps along one horizontal line across the full width below it",
  quote: "The quotation set large across the left 65%; a quiet image or texture in the right 35%",
  comparison: "Headline across the top 25%; below it two equal 50% columns with a thin divider, the recommended side emphasised",
  "inset-frame": "Type on the left 45%; the image inset like a gallery print inside generous margins on the right 55%",
  collage: "Layered image fragments over about 60% of the slide; type overlapping them deliberately in the remaining space",
  diagram: "Headline across the top 25%; the diagram across the lower 70% at full width",
};
const ROLE_NAME: Partial<Record<Slide["layout"], string>> = {
  cover: "Title slide", closing: "The closing slide", section: "A section divider slide", agenda: "The agenda slide", statement: "A statement slide", stats: "A numbers slide",
  chart: "A chart slide", diagram: "A process slide", compare: "A comparison slide", quote: "A quotation slide", image: "An image-led slide", split: "An image-led story slide",
  points: "A key-points slide", table: "A table slide", team: "The team slide", pricing: "The pricing slide", canvas: "A typographic poster slide",
};
const q = (text: string) => `"${text.replace(/"/g, "'")}"`;
const sentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
/** A title whose accent is its last words breaks before the accent, as the reference sets "A second" / "oven.". */
function accentLines(title: string, accent: string | undefined, huge: boolean) {
  const lines = displayLines(title, huge ? 3 : 6);
  if (!accent || title.includes("\n")) return lines;
  const clean = title.trim(), tail = accent.trim();
  if (lines.length > 1 && lines[lines.length - 1].toLowerCase().endsWith(tail.toLowerCase())) return lines;
  if (clean.toLowerCase().endsWith(tail.toLowerCase()) && clean.length > tail.length + 2 && clean.split(/\s+/).length >= 2) return [clean.slice(0, clean.length - tail.length).trim(), clean.slice(clean.length - tail.length)];
  return lines;
}

/** The words of a slide as the reference writes them: every line quoted exactly, display lines broken, accent named. */
export function slideCopy(deck: Pick<Deck, "theme" | "slides"> & { art?: Deck["art"] }, slide: Slide): string[] {
  const { palette, fonts } = deck.theme, style = TYPE_STYLE[fonts], accent = slide.art?.accent;
  const out: string[] = [];
  const titleBlock = slide.layout === "canvas" ? slide.blocks?.find(block => block.type === "text" && (block.style === "display" || block.style === "headline")) : undefined;
  const titleText = slide.layout === "canvas" ? (titleBlock?.type === "text" ? titleBlock.text : undefined) : slide.title;
  // On an accent-coloured slide the accent words cannot be the accent colour (the live Helio "ask" slide set "€2M" yellow
  // on yellow and failed twice): they take whichever of the deep and light colours reads best on that ground.
  const accentInk = slide.tone === "accent" ? (contrast(palette.dark, palette.accent) >= contrast(palette.background, palette.accent) ? palette.dark : palette.background) : palette.accent;
  const accentClause = (text: string) => accent && accentInText(accent, text) ? ` with ${q(accent)} in ${swatch(accentInk)}${style.italicAccent ? " italic" : slide.tone === "accent" ? " underlined with a thick rule" : ""}` : "";
  const size = ["cover", "statement", "section", "canvas", "closing"].includes(slide.layout) ? "huge" : "large";
  if (slide.eyebrow) out.push(`a small label ${q(slide.eyebrow)} above the headline`);
  if (titleText) out.push(`${article(size)} ${style.heading} headline ${quotedLines(titleText, accentLines(titleText, accent, size === "huge"))}${accentClause(titleText)}`);
  if (slide.layout === "canvas") {
    for (const block of slide.blocks ?? []) if (block.type === "text" && block.text !== titleText) out.push(`a ${block.style} line ${q(block.text)}`);
    return out;
  }
  if (slide.subtitle) out.push(`below it a line ${q(slide.subtitle)}`);
  if (slide.body) out.push(`a short line ${q(slide.body)}`);
  if (slide.points?.length) out.push(`${COUNT_WORDS[slide.points.length - 1]} short items in ${style.body}: ${slide.points.map((point, i) => `${i + 1}) ${point.title ? `${q(point.title)} with ` : ""}${q(point.text)}`).join("; ")}`);
  if (slide.stats?.length) out.push(`${slide.stats.length === 1 ? "one big figure" : `${COUNT_WORDS[slide.stats.length - 1]} big figures in a row`} with small labels underneath: ${slide.stats.map(stat => `${q(stat.value)} labelled ${q(stat.label)}${stat.detail ? ` and ${q(stat.detail)}` : ""}`).join(", ")}`);
  if (slide.chart) {
    const chart = slide.chart, multi = chart.series.length > 1;
    out.push(`a clean minimal ${chart.type} chart in ${swatch(palette.accent)}${multi ? ` with a legend ${chart.series.map(series => q(series.name)).join(" ")}` : ""}, labelled ${chart.categories.map(category => q(category)).join(" ")}, with exactly these values written once each as labels: ${chart.categories.map((category, i) => `${category} ${chart.series.map(series => q(formatValue(chart, series.values[i]))).join(" / ")}`).join(", ")}${chart.highlight !== undefined ? `; ${q(chart.categories[chart.highlight])} highlighted, the others muted` : ""}; bars, points or slices in exact proportion to the values; no axis numbers or tick values${chart.source ? `; a tiny source line ${q(chart.source)}` : ""}`);
  }
  if (slide.diagram) out.push(`a drawn ${slide.diagram.kind} with ${slide.diagram.items.length} labelled steps: ${slide.diagram.items.map(item => `${q(item.label)}${item.detail ? ` (${q(item.detail)})` : ""}`).join(", ")}${slide.diagram.axes ? `; axes ${q(slide.diagram.axes.x)} and ${q(slide.diagram.axes.y)}` : ""}`);
  if (slide.compare) out.push(`two columns: left headed ${q(slide.compare.left.heading)} with ${slide.compare.left.points.map(q).join(", ")}; right (emphasised) headed ${q(slide.compare.right.heading)} with ${slide.compare.right.points.map(q).join(", ")}`);
  if (slide.quote) out.push(`a large quotation ${q(`“${slide.quote.text.replace(/^["“]|["”]$/g, "")}”`)}${slide.quote.attribution ? ` with the attribution ${q(`— ${slide.quote.attribution.replace(/^[—–-]\s*/, "")}`)}` : ""}`);
  if (slide.table) out.push(`a compact table with the headings ${slide.table.columns.filter(Boolean).map(q).join(" ")} and the rows ${slide.table.rows.map(row => row.map(q).join(" ")).join("; ")}`);
  if (slide.people?.length) out.push(`${slide.people.length} people as initials monograms (no photographs), each with ${slide.people.map(person => `${q(person.name)} ${q(person.role)}${person.detail ? ` ${q(person.detail)}` : ""}`).join("; ")}`);
  if (slide.tiers?.length) out.push(`${slide.tiers.length} options side by side: ${slide.tiers.map(tier => [tier.name, tier.price, tier.period, tier.description, ...tier.features].filter(Boolean).map(text => q(text!)).join(" ")).join("; ")}`);
  return out;
}

/** The image prompt for one full-image slide, in the reference pattern: one precise art-direction paragraph (brand,
 * colours as words plus hex, typeface style, the split in percentages, every line quoted with its breaks, the accent,
 * the wordmark and page number, the subject), the deck's design system, the safe margins and TAIL_SLIDE. */
export function artPrompt(deck: Pick<Deck, "theme" | "slides" | "title"> & { art?: Deck["art"] }, slide: Slide, fix?: string, canvas: ArtCanvas = LEGACY_CANVAS) {
  const index = deck.slides.findIndex(entry => entry.id === slide.id), total = deck.slides.length;
  const { palette, fonts, imageStyle, mood } = deck.theme, style = TYPE_STYLE[fonts], direction = directionOf(deck.theme);
  const ground = slide.tone === "dark" ? palette.dark : slide.tone === "accent" ? palette.accent : palette.background;
  const ink = slide.tone === "light" || !slide.tone ? palette.ink : contrast("#FFFFFF", ground) >= contrast(palette.ink, ground) ? palette.background : palette.ink;
  const frame = slide.art?.frame ?? "split";
  const role = ROLE_NAME[slide.layout] ?? "A slide";
  const furniture = slideFurniture(deck, slide);
  const wordmark = furniture.find(line => line.role.startsWith("wordmark")), page = furniture.find(line => line.role.startsWith("page"));
  const parts = [
    // The same wordmark on every slide: one size, face and tracking (the live Alba deck varied it between serif, sans and tracked caps).
    ...(wordmark ? [`a small wordmark ${q(wordmark.text)} at the top-left, set in the ${style.heading} at the same small size and normal letter spacing as on every slide of this deck`] : []),
    ...slideCopy(deck, slide),
    ...(page ? [`bottom-left a tiny page number ${q(page.text)}`] : []),
  ];
  const numerals = slideNumerals(slide);
  const paragraph = [
    `${role} (slide ${index + 1} of ${total}) of a premium presentation ${q(deck.title)}${deck.art?.wordmark && deck.art.wordmark !== deck.title ? ` for ${q(deck.art.wordmark)}` : ""}: ${swatch(ground)} background, ${swatch(ink)} text, ${swatch(palette.accent)} accent; ${article(style.heading)} for headlines and ${article(style.body)} for text and figures.`,
    sentence(slide.art?.layout ?? FRAME_LAYOUT[frame]),
    `${sentence(capital(parts.join("; ")))}${numerals ? ` The items may carry the step numbers 1 to ${numerals} as numerals; no other numbers.` : ""}`,
    slide.art?.subject ? sentence(`The image: ${slide.art.subject}`) : "",
    slide.art?.brief ? sentence(`Composition: ${slide.art.brief}`) : "",
  ].filter(Boolean).join(" ");
  const margins = cropNote(canvas, `keep every word inside the rest, and on the finished slide at least ${ART_SAFE_MARGIN_PCT}% of its height clear above the first line and below the last`)
    || `Keep at least ${ART_SAFE_MARGIN_PCT}% of the slide's height clear above the first line of text and below the last, and text at least 6% from the left and right edges.`;
  return [
    paragraph,
    `Deck design system (identical on every slide, so the deck reads as one family): ${deck.art?.system || mood || direction.name}${imageStyle ? ` Imagery: ${imageStyle}.` : ""}`,
    `${margins} Render exactly the quoted words, each once, letter for letter with their capitalisation and punctuation, and no other words, letters or numbers anywhere: no logo, signature, watermark or lorem ipsum.`,
    AVOID_AI_LOOK,
    tailSlide(ASPECT_WORDS[deckAspect(deck)]),
    fix ? `CORRECTION — the previous attempt of this slide had these problems; fix them: ${fix}` : "",
  ].filter(Boolean).join("\n\n");
}
/** Why a slide's accent cannot be drawn: it must be words of the slide's own text. */
export function artAccentIssue(slide: Slide) {
  const accent = slide.art?.accent;
  if (!accent) return null;
  return slideText(slide).some(line => accentInText(accent, line.text)) ? null : `art.accent "${accent}" is not in the slide's text; name words the slide actually shows`;
}
/** Display line breaks of a slide title, as the prompt quotes them. */
export const titleLines = (slide: Slide) => displayLines(slide.title);

const normalise = (value: string) => value.toLowerCase()
  .replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-")
  .replace(/ /g, " ");
/** Words of a text for comparison: case, quotes, dashes and surrounding punctuation are ignored; digits, %, currency and decimal separators are kept. */
export function textTokens(value: string) {
  return normalise(value).split(/\s+/).map(token => token.replace(/^[^\p{L}\p{N}$€£¥%#+]+|[^\p{L}\p{N}%+]+$/gu, "")).filter(token => token && /[\p{L}\p{N}]/u.test(token));
}
export type TextComparison = { ok: boolean; missing: string[]; extra: string[]; casing: string[] };
/** The text gate's programmatic half: the words read back from the rendered slide (by the vision model) against the
 * slide's own words, as multisets (reading order on a designed slide is not fixed). Any missing, misspelled, extra or
 * changed word or number fails. */
/** Lines of at most this many words (eyebrows, short labels, step titles) are also checked for capitalisation. */
export const CASED_LINE_WORDS = 3;
/** Case-preserving words of a text (the same splitting as textTokens). */
const casedTokens = (value: string) => value.replace(/[\u2018\u2019\u201a\u201b\u2032`´]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\u00a0/g, " ")
  .split(/\s+/).map(token => token.replace(/^[^\p{L}\p{N}$€£¥%#+]+|[^\p{L}\p{N}%+]+$/gu, "")).filter(token => token && /[\p{L}\p{N}]/u.test(token));
/** How a word may be set and still be the same word: as written, in capitals (eyebrows are often set in caps), or with a
 * capital first letter (title-case styling). Anything else, such as "iT" for "it", is a rendering error. */
const casingOk = (want: string, seen: string) => seen === want || seen === want.toUpperCase() || seen === want.charAt(0).toUpperCase() + want.slice(1);

/** Digits-only tokens compare without leading zeros (a page number "03" read as "3"). */
const numeric = (token: string) => /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, "") : token;
export function compareSlideText(expected: readonly string[], transcript: string, options: { numerals?: number } = {}): TextComparison {
  const want = new Map<string, number>();
  for (const token of expected.flatMap(textTokens).map(numeric)) want.set(token, (want.get(token) ?? 0) + 1);
  // Step numbers 1..N on an ordered list or diagram are design, not copy: each may appear once.
  const numerals = new Set(Array.from({ length: options.numerals ?? 0 }, (_, i) => String(i + 1)));
  const extra: string[] = [];
  for (const token of textTokens(transcript).map(numeric)) {
    const left = want.get(token) ?? 0;
    if (left > 0) want.set(token, left - 1); else if (!numerals.delete(token.replace(/^0+(?=\d)/, ""))) extra.push(token);
  }
  const missing = [...want].flatMap(([token, count]) => Array(count).fill(token) as string[]);
  // Capitalisation. The word comparison above ignores case on purpose: a vision transcript of long body text varies in
  // case (small caps, all-caps headings, a sentence read as title case) and failing on that would regenerate correct
  // slides. Short lines are where a model's casing errors show and are easy to read reliably (live run of 22 Oct 2026:
  // the eyebrow "How it works" rendered as "How iT works" and passed), so on lines of up to CASED_LINE_WORDS words every
  // word must be set as written, in capitals or with a capital first letter (casingOk); some form of it in the
  // transcript must be acceptable.
  const seen = casedTokens(transcript), casing: string[] = [];
  for (const line of expected) {
    const words = casedTokens(line);
    if (!words.length || words.length > CASED_LINE_WORDS) continue;
    for (const word of words) {
      if (!/\p{L}/u.test(word)) continue;
      const forms = seen.filter(token => token.toLowerCase() === word.toLowerCase());
      if (forms.length && !forms.some(form => casingOk(word, form))) casing.push(`"${forms[0]}" for "${word}"`);
    }
  }
  return { ok: !missing.length && !extra.length && !casing.length, missing, extra, casing };
}

/** How many step numerals an ordered slide may show beside its words (points, steps, timelines and next steps). */
export function slideNumerals(slide: Slide) {
  if (slide.chart || slide.stats || slide.table) return 0;
  return Math.max(slide.diagram?.items.length ?? 0, ["agenda", "points", "closing"].includes(slide.layout) ? slide.points?.length ?? 0 : 0);
}

/** A plain description of a failed comparison, for the corrected prompt and the record. */
export function describeComparison(result: TextComparison) {
  return [result.missing.length ? `missing or misspelled: ${result.missing.slice(0, 12).map(word => `"${word}"`).join(", ")}` : "",
    result.extra.length ? `extra or wrong words: ${result.extra.slice(0, 12).map(word => `"${word}"`).join(", ")}` : "",
    result.casing?.length ? `wrong capitalisation: ${result.casing.slice(0, 8).join(", ")}` : ""].filter(Boolean).join("; ");
}

/** Fill-in fields a client would have to type later ("[€ TBD]", "[Founder names and roles]", "TBC", "XX%"). Baked into a
 * generated image they could never be edited, so such a slide is never rendered as one image. */
const PLACEHOLDER = /(?<!\[)\[(?!\[)[^\][\n]{1,60}\](?!\()|\b(?:TBD|TBC|TBA|N\/A|XX+|lorem ipsum)\b|\?\?+|_{3,}/i;
export function artPlaceholders(slide: Slide): string[] {
  return slideText(slide).flatMap(line => { const match = placeholderIn(line.text); return match ? [`${line.role}: "${match}"`] : []; });
}
/** The first fill-in field in a text, or null. */
export const placeholderIn = (text: string) => PLACEHOLDER.exec(text)?.[0] ?? null;

/** Status words that state a fact about the client's business: on a slide each must be the brief's own word in the
 * same form ("raised" is not "raising"), or the slide claims something the client never said. */
export const CLAIM_WORDS = ["raised", "funded", "backed", "invested", "proven", "award", "awards", "award-winning", "certified", "accredited", "guaranteed", "patented", "patent", "profitable",
  "revenue", "launched", "signed", "contracted", "customers", "clients", "partners", "partnered", "subscribers", "sold", "trusted", "leading", "#1", "best-selling", "bestselling"] as const;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12, half: 50, quarter: 25 };
/** Numeric values in a text: "€1.2M" and "EUR 1.2M" are 1,200,000, "12,000" is 12,000, "31%" is 31, "six" is 6. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  // A digit run glued to letters before it ("Q1", "H2", "B2B") is a label, not a figure.
  for (const match of text.matchAll(/(?<![\p{L}\d.,])(\d+(?:[.,]\d+)*)\s*(k|thousand|m|mn|million|bn|b|billion)?\b/giu)) {
    const digits = match[1], unit = (match[2] ?? "").toLowerCase();
    // "1,200" is a thousands separator; "1,5" a decimal comma; "1.2" a decimal point.
    const value = /^\d{1,3}(,\d{3})+$/.test(digits) ? Number(digits.replace(/,/g, "")) : Number(digits.replace(",", "."));
    const scale = unit === "k" || unit === "thousand" ? 1e3 : unit === "m" || unit === "mn" || unit === "million" ? 1e6 : unit === "b" || unit === "bn" || unit === "billion" ? 1e9 : 1;
    if (Number.isFinite(value)) out.push(Math.round(value * scale * 1000) / 1000);
  }
  for (const word of text.toLowerCase().match(/\b[a-z]+\b/g) ?? []) if (word in NUMBER_WORDS) out.push(NUMBER_WORDS[word]);
  return out;
}
/** Labels that make a slide's figures examples rather than claims. */
const ILLUSTRATIVE = /\b(illustrative|illustration only|fictional|hypothetical|example|sample|for discussion)\b/i;
/** The claims check: every number on a slide is in the source (the brief, the client's answers and files, the current
 * document) unless the slide labels its figures illustrative or fictional, step numerals and an index base of 100
 * aside; every status word (CLAIM_WORDS) is the source's own word in the same form. */
export function slideClaimIssues(slide: Slide, source: string): string[] {
  const issues: string[] = [];
  const lines = slideText(slide), text = lines.map(line => line.text).join(" \n ");
  const known = new Set(numbersIn(source));
  const sourceWords = new Set(source.toLowerCase().match(/[#\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []);
  if (!ILLUSTRATIVE.test(text)) {
    const numerals = slideNumerals(slide), index = /\bindex(ed)?\b/i.test(`${text} ${slide.notes}`);
    for (const line of lines) for (const value of numbersIn(line.text)) {
      if (known.has(value) || (Number.isInteger(value) && value >= 1 && value <= numerals) || (index && value === 100)) continue;
      // A percentage may be the brief's own percentage of a quantity it gives (e.g. 31% of 40 homes) only if stated; otherwise it is new.
      issues.push(`${line.role} "${line.text}" has ${value.toLocaleString("en-US")}, which is not in the brief: use the client's figure, or label the figures illustrative`);
    }
  }
  for (const word of text.toLowerCase().match(/[#\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []) {
    if (!(CLAIM_WORDS as readonly string[]).includes(word) || sourceWords.has(word)) continue;
    const stem = word.replace(/-.*$/, "").slice(0, 4), near = [...sourceWords].filter(entry => entry.startsWith(stem)).slice(0, 3);
    issues.push(`"${word}" states something the brief does not${near.length ? ` (it says ${near.map(entry => `"${entry}"`).join(", ")})` : ""}: use the brief's own status`);
  }
  return [...new Set(issues)];
}

