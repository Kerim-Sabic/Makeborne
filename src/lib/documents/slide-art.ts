import type { Deck, Slide, SlideFrame } from "./schema";
import { FONTS } from "./theme";
import { directionOf } from "./directions";
import { formatValue } from "./chart-svg";
import { W, H, type SlideScene } from "./scene-kit";

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

/** The scene of a verified full-image slide: the picture, full-bleed. Its words are the picture's description. */
export function artScene(deck: DeckLike & Pick<Deck, "theme">, slide: Slide): SlideScene | null {
  const image = verifiedArt(deck, slide);
  if (!image) return null;
  return { background: deck.theme.palette.dark, composition: ART_COMPOSITION, issues: [],
    prims: [{ k: "image", x: 0, y: 0, w: W, h: H, name: image, alt: artAlt(slide), crop: "center" }] };
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
    "Keep every word and every important element inside the central 84% of the height: leave the top 8% and bottom 8% of the canvas as plain continuation of the background (the slide is cropped to 16:9). Keep text at least 5% from the left and right edges.",
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
export type TextComparison = { ok: boolean; missing: string[]; extra: string[] };
/** The text gate's programmatic half: the words read back from the rendered slide (by the vision model) against the
 * slide's own words, as multisets (reading order on a designed slide is not fixed). Any missing, misspelled, extra or
 * changed word or number fails. */
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
  return { ok: !missing.length && !extra.length, missing, extra };
}

/** How many step numerals an ordered slide may show beside its words (points, steps, timelines and next steps). */
export function slideNumerals(slide: Slide) {
  if (slide.chart || slide.stats || slide.table) return 0;
  return Math.max(slide.diagram?.items.length ?? 0, ["agenda", "points", "closing"].includes(slide.layout) ? slide.points?.length ?? 0 : 0);
}

/** A plain description of a failed comparison, for the corrected prompt and the record. */
export function describeComparison(result: TextComparison) {
  return [result.missing.length ? `missing or misspelled: ${result.missing.slice(0, 12).map(word => `"${word}"`).join(", ")}` : "",
    result.extra.length ? `extra or wrong words: ${result.extra.slice(0, 12).map(word => `"${word}"`).join(", ")}` : ""].filter(Boolean).join("; ");
}

