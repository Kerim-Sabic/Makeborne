import type { CompositionId, CompositionLayout } from "./composition-catalog";
import type { FaceId } from "./fonts";

/** Art directions: each is a complete design system for a deck — grid and
 * margins, type scale and casing, how colour is applied, page furniture, the
 * generative graphic language, image treatment, motion and, above all, which
 * compositions each slide role may take. Choosing a direction changes the
 * structure of every slide, not only its colours.
 *
 * The ids are stored in theme.direction. Decks saved before directions existed
 * map to one through legacyDirection (their motif and pairing). */
export const DIRECTIONS = ["swiss", "editorial", "poster", "luxury", "colorblock", "tech", "organic", "data", "architect", "brutalist"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type FontRole = "heading" | "body" | "mono";
export type GraphicKind = "modules" | "disc" | "mosaic" | "arches" | "glow" | "plan" | "stripes" | "plate" | "contour" | "dots" | "blocks" | "rings";
export type MotionKind = "rise" | "wipe" | "fade" | "pop" | "blur" | "draw" | "snap";
export type Weight = 400 | 600 | 700;

export type DirectionSpec = {
  id: Direction; name: string; voice: string;
  /** Pairings that suit it, best first (advice for the agent; any pairing renders). */
  pairings: string[];
  /** Side margin, top of the content area and bottom of the safe area (px on 1280×720). */
  mx: number; top: number; bottom: number;
  axis: "left" | "center";
  display: { upper: boolean; lh: number; weight?: Weight; tracking?: number };
  /** Base display sizes before the pairing's own scale. */
  sizes: { cover: number; statement: number; headline: number; section: number; number: number; body: number; lead: number };
  label: { font: FontRole; size: number; weight: Weight; upper: boolean; tracking: number; color: "accent" | "muted" | "ink"; prefix?: string };
  numerals: { font: FontRole; style: "padded" | "plain" | "roman"; weight?: Weight; color: "accent" | "ink" | "muted" };
  rule: { width: number; color: "rule" | "ink" | "accent" } | null;
  /** How grouped content is contained: tinted fill, outline, heavy black border or nothing. */
  panel: "fill" | "outline" | "heavy" | "none";
  radius: number;
  /** "dark" renders ordinary (light-tone) slides on the palette's dark colour. */
  ground: "light" | "dark";
  header: "rule" | "kicker" | "plain" | "centered" | "pill" | "mono" | "bar" | "boxed" | "tab";
  footer: "running" | "folio" | "corner" | "center" | "mono" | "bar" | "pill" | "box" | "none";
  graphics: GraphicKind[];
  image: "full" | "duotone" | "mono" | "framed" | "arch";
  motion: MotionKind;
  faces: FaceId[];
  compositions: Record<CompositionLayout, CompositionId[]>;
};

const all = (...ids: CompositionId[]) => ids;

/** Shared fallbacks: every direction can always fall back to these roomy forms. */
const common = {
  canvas: all("canvas"),
  agenda: all("agenda-list", "agenda-columns"),
  table: all("table-clean", "table-boxed"),
  pricing: all("pricing-cards", "pricing-columns"),
};

export const DIRECTION_SPECS: Record<Direction, DirectionSpec> = {
  swiss: {
    id: "swiss", name: "Swiss grid", voice: "International Typographic Style: 12-column grid, hairline rules, flush-left grotesk at large sizes, numbered modules, one signal colour used in solid geometric marks. Analytical, technical, B2B, finance, engineering.",
    pairings: ["geist", "modern", "space-grotesk", "grotesk", "condensed"],
    mx: 64, top: 64, bottom: 640, axis: "left",
    display: { upper: false, lh: 0.98, tracking: -0.01 },
    sizes: { cover: 132, statement: 92, headline: 60, section: 72, number: 176, body: 22, lead: 26 },
    label: { font: "body", size: 14, weight: 700, upper: true, tracking: 0.08, color: "ink" },
    numerals: { font: "heading", style: "padded", color: "accent" },
    rule: { width: 1.5, color: "ink" }, panel: "none", radius: 0, ground: "light",
    header: "rule", footer: "running", graphics: ["modules", "disc", "dots"], image: "mono", motion: "wipe", faces: [],
    compositions: {
      cover: all("cover-modules", "cover-poster", "cover-split"), closing: all("closing-ask", "closing-split", "closing-field"),
      section: all("section-numeral", "section-index", "section-split"), statement: all("statement-hanging", "statement-hero", "statement-split"),
      points: all("points-columns", "points-rows", "points-grid", "points-feature"), stats: all("stats-ledger", "stats-row", "stats-hero"),
      chart: all("chart-annotated", "chart-full", "chart-hero"), diagram: all("diagram-rail", "diagram-steps", "diagram-classic"),
      compare: all("compare-columns", "compare-versus", "compare-panels"), quote: all("quote-giant", "quote-centered"),
      team: all("team-list", "team-row", "team-grid"), image: all("image-framed", "image-full", "image-band"), split: all("split-half", "split-inset"), ...common,
    },
  },
  editorial: {
    id: "editorial", name: "Editorial magazine", voice: "Magazine spreads: a large serif display with italic standfirsts, kicker rules, drop numerals, asymmetric 2/3 + 1/3 columns, art plates and folios. Culture, consulting, research, proposals, nonprofits.",
    pairings: ["fraunces", "newsreader", "playfair", "instrument", "editorial"],
    mx: 80, top: 64, bottom: 640, axis: "left",
    display: { upper: false, lh: 1.02 },
    sizes: { cover: 112, statement: 84, headline: 58, section: 72, number: 150, body: 22, lead: 27 },
    label: { font: "body", size: 14, weight: 700, upper: true, tracking: 0.16, color: "accent" },
    numerals: { font: "heading", style: "plain", color: "accent" },
    rule: { width: 1.2, color: "rule" }, panel: "fill", radius: 2, ground: "light",
    header: "kicker", footer: "folio", graphics: ["plate", "rings", "contour"], image: "framed", motion: "fade", faces: [],
    compositions: {
      cover: all("cover-masthead", "cover-split", "cover-poster"), closing: all("closing-centered", "closing-ask", "closing-split"),
      section: all("section-numeral", "section-split", "section-centered"), statement: all("statement-split", "statement-hero", "statement-hanging"),
      points: all("points-feature", "points-rows", "points-columns", "points-grid"), stats: all("stats-row", "stats-ledger", "stats-hero"),
      chart: all("chart-annotated", "chart-hero", "chart-full"), diagram: all("diagram-steps", "diagram-rail", "diagram-classic"),
      compare: all("compare-columns", "compare-panels", "compare-versus"), quote: all("quote-giant", "quote-centered", "quote-field"),
      team: all("team-row", "team-list", "team-grid"), image: all("image-framed", "image-band", "image-full"), split: all("split-inset", "split-half"), ...common,
    },
  },
  poster: {
    id: "poster", name: "Bold poster", voice: "Oversized condensed capitals that fill the frame, full-bleed colour fields, stripes and arrows, almost no furniture. Launches, campaigns, sport, events, consumer brands.",
    pairings: ["archivo", "condensed", "bricolage", "grotesk"],
    mx: 56, top: 56, bottom: 648, axis: "left",
    display: { upper: true, lh: 0.9, tracking: 0 },
    sizes: { cover: 200, statement: 150, headline: 84, section: 120, number: 240, body: 23, lead: 28 },
    label: { font: "body", size: 15, weight: 700, upper: true, tracking: 0.1, color: "ink" },
    numerals: { font: "heading", style: "plain", color: "accent" },
    rule: { width: 6, color: "ink" }, panel: "fill", radius: 0, ground: "light",
    header: "bar", footer: "corner", graphics: ["stripes", "disc", "blocks"], image: "full", motion: "snap", faces: [],
    compositions: {
      cover: all("cover-poster", "cover-split"), closing: all("closing-field", "closing-ask"),
      section: all("section-field", "section-numeral"), statement: all("statement-hero", "statement-field"),
      points: all("points-columns", "points-cards", "points-rows"), stats: all("stats-hero", "stats-tiles", "stats-row"),
      chart: all("chart-hero", "chart-full", "chart-annotated"), diagram: all("diagram-steps", "diagram-blocks", "diagram-classic"),
      compare: all("compare-versus", "compare-panels"), quote: all("quote-field", "quote-giant"),
      team: all("team-list", "team-row", "team-grid"), image: all("image-full", "image-band"), split: all("split-half", "split-inset"), ...common,
    },
  },
  luxury: {
    id: "luxury", name: "Luxury minimal", voice: "Vast whitespace, centred light serif display, wide-tracked small capitals, hairline frames and a single ornament. Hospitality, fashion, real estate, premium services, private wealth.",
    pairings: ["instrument", "playfair", "garamond", "fraunces"],
    mx: 120, top: 80, bottom: 624, axis: "center",
    display: { upper: false, lh: 1.08, weight: 400 },
    sizes: { cover: 96, statement: 68, headline: 52, section: 64, number: 112, body: 21, lead: 24 },
    label: { font: "body", size: 13, weight: 600, upper: true, tracking: 0.32, color: "muted" },
    numerals: { font: "heading", style: "roman", weight: 400, color: "accent" },
    rule: { width: 1, color: "rule" }, panel: "outline", radius: 0, ground: "light",
    header: "centered", footer: "center", graphics: ["contour", "rings"], image: "arch", motion: "fade", faces: [],
    compositions: {
      cover: all("cover-centered", "cover-arch"), closing: all("closing-centered", "closing-ask"),
      section: all("section-centered", "section-numeral"), statement: all("statement-centered", "statement-split"),
      points: all("points-columns", "points-feature", "points-rows"), stats: all("stats-row", "stats-hero"),
      chart: all("chart-annotated", "chart-hero"), diagram: all("diagram-rail", "diagram-steps", "diagram-classic"),
      compare: all("compare-columns", "compare-panels"), quote: all("quote-centered", "quote-giant"),
      team: all("team-row", "team-list"), image: all("image-framed", "image-full"), split: all("split-arch", "split-inset"), ...common,
    },
  },
  colorblock: {
    id: "colorblock", name: "Playful colour-block", voice: "Bauhaus-inspired colour fields and tiles of circles, quarter-circles and squares in the full palette, chunky geometric sans, rounded cards. Consumer apps, education, kids, food, community, creative studios.",
    pairings: ["sora", "bricolage", "geometric", "space-grotesk"],
    mx: 64, top: 60, bottom: 640, axis: "left",
    display: { upper: false, lh: 1.0, tracking: -0.01 },
    sizes: { cover: 120, statement: 88, headline: 60, section: 80, number: 168, body: 22, lead: 26 },
    label: { font: "body", size: 14, weight: 700, upper: true, tracking: 0.08, color: "ink" },
    numerals: { font: "heading", style: "plain", color: "ink" },
    rule: null, panel: "fill", radius: 28, ground: "light",
    header: "pill", footer: "pill", graphics: ["mosaic", "disc"], image: "arch", motion: "pop", faces: [],
    compositions: {
      cover: all("cover-split", "cover-poster"), closing: all("closing-split", "closing-field"),
      section: all("section-split", "section-field"), statement: all("statement-split", "statement-field", "statement-hero"),
      points: all("points-cards", "points-grid", "points-columns"), stats: all("stats-tiles", "stats-hero", "stats-row"),
      chart: all("chart-hero", "chart-annotated", "chart-full"), diagram: all("diagram-blocks", "diagram-steps", "diagram-classic"),
      compare: all("compare-panels", "compare-versus"), quote: all("quote-field", "quote-giant"),
      team: all("team-grid", "team-row"), image: all("image-band", "image-full"), split: all("split-arch", "split-half"), ...common,
    },
  },
  tech: {
    id: "tech", name: "Dark tech", voice: "Dark ground with luminous gradient light, monospaced labels and indices, fine 1px structure, dot grids and glowing data. AI, developer tools, security, deep tech, crypto, mobility.",
    pairings: ["geist", "space-grotesk", "sora", "modern"],
    mx: 72, top: 64, bottom: 636, axis: "left",
    display: { upper: false, lh: 1.0, tracking: -0.01 },
    sizes: { cover: 112, statement: 80, headline: 56, section: 72, number: 150, body: 22, lead: 25 },
    label: { font: "mono", size: 14, weight: 400, upper: true, tracking: 0.04, color: "accent", prefix: "// " },
    numerals: { font: "mono", style: "padded", color: "accent" },
    rule: { width: 1, color: "rule" }, panel: "outline", radius: 10, ground: "dark",
    header: "mono", footer: "mono", graphics: ["glow", "dots", "rings"], image: "duotone", motion: "blur", faces: ["jetbrains-mono"],
    compositions: {
      cover: all("cover-glow", "cover-split"), closing: all("closing-ask", "closing-centered"),
      section: all("section-numeral", "section-index"), statement: all("statement-hero", "statement-split"),
      points: all("points-grid", "points-cards", "points-rows"), stats: all("stats-tiles", "stats-row", "stats-hero"),
      chart: all("chart-hero", "chart-annotated", "chart-full"), diagram: all("diagram-rail", "diagram-steps", "diagram-classic"),
      compare: all("compare-panels", "compare-versus"), quote: all("quote-giant", "quote-centered"),
      team: all("team-grid", "team-row"), image: all("image-full", "image-framed"), split: all("split-inset", "split-half"), ...common,
    },
  },
  organic: {
    id: "organic", name: "Warm craft", voice: "Soft serif display, arches, pebbles and sun discs, warm earthy fields, rounded cards and generous rhythm. Food and drink, hospitality, wellness, craft, sustainability, local business.",
    pairings: ["fraunces", "bricolage", "playfair", "newsreader"],
    mx: 80, top: 64, bottom: 636, axis: "left",
    display: { upper: false, lh: 1.04 },
    sizes: { cover: 108, statement: 80, headline: 58, section: 72, number: 150, body: 22, lead: 26 },
    label: { font: "body", size: 14, weight: 600, upper: true, tracking: 0.14, color: "accent" },
    numerals: { font: "heading", style: "plain", color: "accent" },
    rule: { width: 1.2, color: "rule" }, panel: "fill", radius: 26, ground: "light",
    header: "kicker", footer: "pill", graphics: ["arches", "rings"], image: "arch", motion: "rise", faces: [],
    compositions: {
      cover: all("cover-arch", "cover-split", "cover-centered"), closing: all("closing-split", "closing-centered", "closing-field"),
      section: all("section-split", "section-centered", "section-numeral"), statement: all("statement-split", "statement-centered", "statement-field"),
      points: all("points-cards", "points-feature", "points-columns", "points-rows"), stats: all("stats-tiles", "stats-row", "stats-hero"),
      chart: all("chart-annotated", "chart-hero"), diagram: all("diagram-steps", "diagram-rail", "diagram-classic"),
      compare: all("compare-panels", "compare-columns"), quote: all("quote-field", "quote-centered"),
      team: all("team-row", "team-grid"), image: all("image-framed", "image-band"), split: all("split-arch", "split-inset"), ...common,
    },
  },
  data: {
    id: "data", name: "Data journalism", voice: "Newsroom data graphics: a colour tab, bold sentence headlines with a standfirst, big numbers with context, annotated charts that dominate the slide, thin grids and source lines. Research, reports, investor updates, policy, impact.",
    pairings: ["newsreader", "geist", "grotesk", "editorial", "modern"],
    mx: 72, top: 60, bottom: 636, axis: "left",
    display: { upper: false, lh: 1.04, weight: 600 },
    sizes: { cover: 100, statement: 76, headline: 50, section: 64, number: 168, body: 22, lead: 25 },
    label: { font: "body", size: 14, weight: 700, upper: true, tracking: 0.06, color: "accent" },
    numerals: { font: "heading", style: "plain", color: "accent" },
    rule: { width: 1, color: "rule" }, panel: "none", radius: 2, ground: "light",
    header: "tab", footer: "running", graphics: ["dots", "rings"], image: "framed", motion: "rise", faces: [],
    compositions: {
      cover: all("cover-split", "cover-poster"), closing: all("closing-ask", "closing-split"),
      section: all("section-index", "section-numeral"), statement: all("statement-hanging", "statement-hero"),
      points: all("points-rows", "points-columns", "points-grid"), stats: all("stats-row", "stats-ledger", "stats-hero"),
      chart: all("chart-full", "chart-annotated", "chart-hero"), diagram: all("diagram-rail", "diagram-steps", "diagram-classic"),
      compare: all("compare-columns", "compare-panels"), quote: all("quote-centered", "quote-giant"),
      team: all("team-list", "team-row"), image: all("image-framed", "image-band"), split: all("split-inset", "split-half"), ...common,
    },
  },
  architect: {
    id: "architect", name: "Architectural mono", voice: "Monochrome drawing-board precision: construction lines, plan-like geometry, outlined modules, dimension ticks, light large numerals and one restrained accent. Architecture, property, engineering, industrial design, hardware.",
    pairings: ["geist", "instrument", "space-grotesk", "condensed"],
    mx: 64, top: 64, bottom: 640, axis: "left",
    display: { upper: false, lh: 1.0, weight: 400 },
    sizes: { cover: 116, statement: 80, headline: 54, section: 72, number: 190, body: 21, lead: 24 },
    label: { font: "mono", size: 13, weight: 400, upper: true, tracking: 0.06, color: "muted" },
    numerals: { font: "heading", style: "padded", weight: 400, color: "ink" },
    rule: { width: 1, color: "ink" }, panel: "outline", radius: 0, ground: "light",
    header: "boxed", footer: "box", graphics: ["plan", "modules"], image: "mono", motion: "draw", faces: ["jetbrains-mono"],
    compositions: {
      cover: all("cover-modules", "cover-split"), closing: all("closing-split", "closing-ask"),
      section: all("section-index", "section-numeral"), statement: all("statement-hanging", "statement-split"),
      points: all("points-grid", "points-rows", "points-columns"), stats: all("stats-ledger", "stats-row", "stats-tiles"),
      chart: all("chart-annotated", "chart-full"), diagram: all("diagram-blocks", "diagram-rail", "diagram-classic"),
      compare: all("compare-columns", "compare-panels"), quote: all("quote-centered", "quote-giant"),
      team: all("team-grid", "team-list"), image: all("image-framed", "image-full"), split: all("split-inset", "split-half"), ...common,
    },
  },
  brutalist: {
    id: "brutalist", name: "Brutalist", voice: "Raw and loud: heavy black borders, boxed modules, monospaced labels, capitals, oversized index numbers and one electric colour. Agencies, fashion, music, youth brands, manifestos.",
    pairings: ["space-grotesk", "archivo", "grotesk", "geist"],
    mx: 48, top: 48, bottom: 640, axis: "left",
    display: { upper: true, lh: 0.94 },
    sizes: { cover: 150, statement: 108, headline: 64, section: 96, number: 220, body: 22, lead: 25 },
    label: { font: "mono", size: 14, weight: 700, upper: true, tracking: 0.02, color: "ink" },
    numerals: { font: "mono", style: "padded", weight: 700, color: "ink" },
    rule: { width: 4, color: "ink" }, panel: "heavy", radius: 0, ground: "light",
    header: "boxed", footer: "bar", graphics: ["blocks", "stripes"], image: "mono", motion: "snap", faces: ["jetbrains-mono"],
    compositions: {
      cover: all("cover-boxed", "cover-poster"), closing: all("closing-boxed", "closing-field"),
      section: all("section-field", "section-numeral"), statement: all("statement-hero", "statement-field"),
      points: all("points-grid", "points-rows", "points-cards"), stats: all("stats-tiles", "stats-hero", "stats-ledger"),
      chart: all("chart-hero", "chart-full"), diagram: all("diagram-blocks", "diagram-steps", "diagram-classic"),
      compare: all("compare-versus", "compare-panels"), quote: all("quote-field", "quote-giant"),
      team: all("team-grid", "team-list"), image: all("image-full", "image-band"), split: all("split-half", "split-inset"), ...common,
    },
  },
};

// Tables and pricing follow the direction's container habit: boxed grids where boxes are the language, open rules elsewhere.
for (const spec of Object.values(DIRECTION_SPECS)) {
  const boxed = spec.panel === "outline" || spec.panel === "heavy";
  spec.compositions.table = boxed && spec.id !== "luxury" ? ["table-boxed", "table-clean"] : ["table-clean", "table-boxed"];
  spec.compositions.pricing = spec.panel === "none" || spec.id === "luxury" || spec.id === "poster" ? ["pricing-columns", "pricing-cards"] : ["pricing-cards", "pricing-columns"];
}

const SERIF = new Set(["editorial", "classic", "garamond", "fraunces", "instrument", "playfair", "newsreader"]);
/** Saved decks predate directions: their motif and pairing choose the nearest one. */
export function legacyDirection(theme: { motif?: string; fonts: string }): Direction {
  const serif = SERIF.has(theme.fonts);
  switch (theme.motif) {
    case "grid": return serif ? "data" : "swiss";
    case "band": return serif ? "organic" : theme.fonts === "archivo" ? "poster" : "colorblock";
    case "frame": return "luxury";
    case "quiet": return serif ? "editorial" : "architect";
    default: return serif ? "editorial" : "colorblock";
  }
}
export const directionOf = (theme: { direction?: Direction; motif?: string; fonts: string }): DirectionSpec => DIRECTION_SPECS[theme.direction ?? legacyDirection(theme)];
