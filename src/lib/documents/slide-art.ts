import type { Deck, FontPairing, Slide, SlideFrame } from "./schema";
import { FONTS, contrast, mix } from "./theme";
import { directionOf } from "./directions";
import { formatValue } from "./chart-svg";
import { W, H, type Prim, type RectPrim, type SlideScene } from "./scene-kit";

/** Full-image slides (owner, Kerim, 22 Oct 2026: "for presentations i want each slide full image gen ... each slide
 * fully unique nice modern not looking ai slop and text also generated"). Each slide of a deck in image mode is one
 * generated 16:9 picture that carries its own typography. The structured slide stays the source of truth: its fields
 * give the exact words the image must show (slideText), the render is accepted only after the text gate reads those
 * words back (compareSlideText), and the render is shown only while the slide's text still matches what was verified
 * (verifiedArt). Any slide without a verified render, or any deck in "live" mode, is drawn by the editable layout
 * engine instead, so a deck is never shown with wrong words. */

export const ART_COMPOSITION = "full-image";
/** Generated canvas (the only landscape size with a measured bound) and the 16:9 band cut from it. */
export const ART_SOURCE = { width: 1536, height: 1024 } as const;
export const ART_CROP = { left: 0, top: 80, width: 1536, height: 864 } as const;
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
type DeckLike = Pick<Deck, "assets"> & { art?: Deck["art"] };

/** The asset to show as this whole slide, or null to draw the editable layout. */
export function verifiedArt(deck: DeckLike, slide: Slide): string | null {
  if (deck.art?.mode !== "image") return null;
  const render = deck.art.renders.find(entry => entry.slide === slide.id);
  if (!render || render.outcome !== "passed" || !render.image || render.verified !== textKey(slide)) return null;
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
  return plateScene(live({ ...deck, art: undefined }), plate);
}

export const PLATE_COMPOSITION = "plate";
/** WCAG AA for the live text set over a plate. */
export const PLATE_CONTRAST = 4.5;
const gray = (value: number) => `#${Math.round(value).toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
type Box = { x: number; y: number; w: number; h: number };
/** The plate's brightest and darkest pixels under a box (the plate fills the 16:9 slide; luma and shade are 8×8 grids of it). */
export function plateRange(plate: { luma?: number[]; shade?: number[] }, box: Box) {
  const cell = (value: number, size: number) => Math.max(0, Math.min(7, Math.floor(value / size * 8)));
  const u0 = cell(box.x, W), u1 = cell(box.x + box.w - 1e-6, W), v0 = cell(box.y, H), v1 = cell(box.y + box.h - 1e-6, H);
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
function plateScene(scene: SlideScene, plate: { name: string; luma?: number[]; shade?: number[] }): SlideScene {
  const full = (prim: Prim) => prim.k === "rect" && !prim.noFill && (prim.opacity ?? 1) >= 0.95 && prim.w * prim.h >= W * H * 0.95;
  const ground = (scene.prims.find(full) as RectPrim | undefined)?.fill ?? scene.background;
  const panels: Box[] = [];
  const prims: Prim[] = [{ k: "image", x: 0, y: 0, w: W, h: H, name: plate.name, alt: "", crop: "center" }];
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
      const alpha = onPanel ? 0 : plateScrim(color, ground, plateRange(plate, box));
      if (alpha > 0) prims.push({ k: "rect", ...box, fill: ground, opacity: alpha, radius: 6 });
    }
    prims.push(prim);
  }
  return { ...scene, prims, composition: `${PLATE_COMPOSITION}-${scene.composition ?? "layout"}` };
}

/** The prompt for a text-free plate behind an editable slide: same design system and palette, the area where the live
 * text goes left as a calm, nearly plain field. `text` is that area on the slide (px of the 1280×720 canvas). */
export function platePrompt(deck: Pick<Deck, "theme" | "slides" | "title"> & { art?: Deck["art"] }, slide: Slide, text: Box, fix?: string) {
  const index = deck.slides.findIndex(entry => entry.id === slide.id), total = deck.slides.length;
  const { palette, imageStyle } = deck.theme;
  const ground = slide.tone === "dark" ? palette.dark : slide.tone === "accent" ? palette.accent : palette.background;
  // Slide px to canvas %: the 1536×1024 canvas is cropped to the slide's 1536×864 band starting 80 px down.
  const pctX = (x: number) => Math.round(x / W * 100), pctY = (y: number) => Math.round((ART_CROP.top + y / H * ART_CROP.height) / ART_SOURCE.height * 100);
  return [
    `A text-free background plate for slide ${index + 1} of ${total} of the presentation "${deck.title}": the artwork behind a slide whose words are set separately as live text. It belongs to the same deck as the other slides.`,
    `DECK DESIGN SYSTEM (the same on every slide): ${deck.art?.system ?? ""}`,
    `Palette: ground ${ground}, surface ${palette.surface}, ink ${palette.ink}, accent ${palette.accent}, second accent ${palette.accent2}, dark ${palette.dark}.${imageStyle ? ` Imagery: ${imageStyle}.` : ""}`,
    `RESERVED AREA: from ${pctX(text.x)}% to ${pctX(text.x + text.w)}% across and from ${pctY(text.y)}% to ${pctY(text.y + text.h)}% down the canvas the slide's text will be set. Keep that area a calm, nearly plain field of ${ground} with at most a faint paper grain: no objects, lines, patterns or strong tone changes inside it. Put the imagery, the recurring motif and any texture in the rest of the canvas, quietly, so it frames the text.`,
    "Absolutely no text, letters, numbers, labels, logos, charts, tables, icons or user interface anywhere. The top 8% and bottom 8% of the canvas are cropped away: continue the background there.",
    "Avoid the AI look: no oversaturated colour, HDR glow, lens flare, plastic or posed people, clip-art or random gradients.",
    fix ? `CORRECTION — the previous attempt had these problems; fix them: ${fix}` : "",
  ].filter(Boolean).join("\n\n");
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

const ROLE_GUIDE: Partial<Record<Slide["layout"], string>> = {
  cover: "the cover: the deck's most striking image and the title set large",
  closing: "the closing ask: the decision requested, with the next steps",
  section: "a section divider: a short number and title, bold and spare",
  agenda: "the agenda: a short numbered list",
  statement: "a big statement: one sentence set huge",
  stats: "the key numbers, set huge",
  chart: "the data slide: an accurate chart is the hero",
  diagram: "the process or structure, drawn clearly",
  compare: "a comparison of two options",
  quote: "a quotation",
  image: "an image-led story moment",
  split: "an image-led story slide",
  points: "a few short points",
  table: "a compact table",
  team: "the people (no photographs of real people: initials or abstract marks)",
  pricing: "the options and prices",
  canvas: "a typographic poster moment",
};

/** The image prompt for one full-image slide: the deck's design system, this slide's composition and its exact words. */
export function artPrompt(deck: Pick<Deck, "theme" | "slides" | "title"> & { art?: Deck["art"] }, slide: Slide, fix?: string) {
  const index = deck.slides.findIndex(entry => entry.id === slide.id), total = deck.slides.length;
  const { palette, fonts, imageStyle, mood } = deck.theme;
  const pairing = FONTS[fonts], direction = directionOf(deck.theme);
  const ground = slide.tone === "dark" ? `deep ${palette.dark} background with light type` : slide.tone === "accent" ? `${palette.accent} colour field` : `${palette.background} background with ${palette.ink} type`;
  const text = slideText(slide).map(line => `- ${line.role}: "${line.text.replace(/"/g, "'")}"`).join("\n") + (slideNumerals(slide) ? `\n(The items may carry the step numbers 1 to ${slideNumerals(slide)} as numerals; no other numbers.)` : "");
  const chart = slide.chart ? `\nChart: a ${slide.chart.type} chart; ${slide.chart.categories.map((category, i) => `${category} = ${slide.chart!.series.map(series => series.values[i]).join(" / ")}`).join(", ")}. Bar lengths, line points or slices in exact proportion to these values, each value written once as its label${slide.chart.highlight !== undefined ? `; ${slide.chart.categories[slide.chart.highlight]} highlighted in ${palette.accent}, the others muted` : ""}. No axis numbers, gridline labels or tick values beyond these labels.` : "";
  return [
    `Design one finished 16:9 presentation slide: slide ${index + 1} of ${total} of "${deck.title}". It is a flat, print-ready slide (not a photo of a screen or a mock-up), designed to the standard of a world-class keynote by a top studio such as Pentagram, Stripe or Apple: a precise grid, generous margins, one clear focal point, confident contrast in scale between the title and everything else.`,
    `DECK DESIGN SYSTEM (identical on every slide, so the deck reads as one family): ${deck.art?.system || mood || direction.name}`,
    `Palette: background ${palette.background}, surface ${palette.surface}, ink ${palette.ink}, muted ${palette.muted}, accent ${palette.accent}, second accent ${palette.accent2}, dark ${palette.dark}. Typography: ${pairing.label} style (${pairing.voice}); headings in the heading face, everything else in the body face, set crisply with real kerning.${imageStyle ? ` Imagery: ${imageStyle}.` : ""}`,
    `THIS SLIDE: ${ROLE_GUIDE[slide.layout] ?? slide.layout}. Composition "${slide.art?.frame ?? "split"}" — ${FRAME_NOTES[slide.art?.frame ?? "split"]}. ${slide.art?.brief ?? ""} Ground: ${ground}.`,
    `TEXT: render exactly these words, each once, spelled exactly letter for letter, with their capitalisation and punctuation, and no other words, letters or numbers anywhere:\n${text}${chart}`,
    `SAFE MARGINS: the top ${ART_CANVAS_MARGIN_PCT}% and bottom ${ART_CANVAS_MARGIN_PCT}% of the canvas hold no words at all, not even a small label or eyebrow (the top and bottom 8% are cropped away to make the 16:9 slide, and the finished slide keeps ${ART_SAFE_MARGIN_PCT}% clear above the first line and below the last); continue the background there. Keep text at least 6% from the left and right edges.`,
    "Avoid the AI look: no oversaturated colour, no HDR glow, no lens flare, no plastic-looking or posed stock people, no clip-art or emoji icons, no random gradients or bokeh, no fake user interface, no watermark, logo, page number, signature or lorem ipsum. Photographs look like real editorial photography; illustration is one consistent hand.",
    fix ? `CORRECTION — the previous attempt of this slide had these problems; fix them: ${fix}` : "",
  ].filter(Boolean).join("\n\n");
}

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

export function compareSlideText(expected: readonly string[], transcript: string, options: { numerals?: number } = {}): TextComparison {
  const want = new Map<string, number>();
  for (const token of expected.flatMap(textTokens)) want.set(token, (want.get(token) ?? 0) + 1);
  // Step numbers 1..N on an ordered list or diagram are design, not copy: each may appear once.
  const numerals = new Set(Array.from({ length: options.numerals ?? 0 }, (_, i) => String(i + 1)));
  const extra: string[] = [];
  for (const token of textTokens(transcript)) {
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
  return slideText(slide).flatMap(line => { const match = PLACEHOLDER.exec(line.text); return match ? [`${line.role}: "${match[0]}"`] : []; });
}

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

