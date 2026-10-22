import { z } from "zod";
import { CoverCompositionSchema } from "./composition-schema";
import { bookCoverScene, slideCoverScene } from "./cover-composition";
import { DIRECTIONS } from "./directions";
import { ALL_COMPOSITIONS, COMPOSITIONS } from "./composition-catalog";

/** Structured source for live-built presentations and books. It is the single
 * input to the preview renderer, the PDF printer and the PPTX writer, and is
 * stored on the artifact version as `content.document`. */

export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1F2A44.");
export const FONT_PAIRINGS = ["editorial", "modern", "geometric", "classic", "garamond", "grotesk", "humanist", "condensed", "fraunces", "instrument", "playfair", "newsreader", "space-grotesk", "bricolage", "sora", "geist", "archivo"] as const;
export const FontPairingSchema = z.enum(FONT_PAIRINGS);
export type FontPairing = z.infer<typeof FontPairingSchema>;
export const MOTIFS = ["orbit", "grid", "band", "frame", "quiet"] as const;
export type Motif = (typeof MOTIFS)[number];

export const PaletteSchema = z.object({
  background: hex.describe("Main page/slide background (usually a warm or cool off-white)"),
  surface: hex.describe("Panels and cards, slightly different from background"),
  ink: hex.describe("Primary text on background; must have strong contrast"),
  muted: hex.describe("Secondary text on background; still readable (≥4.5:1)"),
  accent: hex.describe("One confident brand accent for emphasis, numbers, markers"),
  accent2: hex.describe("Supporting accent for charts and secondary marks"),
  dark: hex.describe("Deep background for dark slides/covers; light text sits on it"),
}).strict();
export const ThemeSchema = z.object({
  palette: PaletteSchema,
  fonts: FontPairingSchema,
  mood: z.string().trim().max(300).default(""),
  imageStyle: z.string().trim().max(600).default("").describe("One consistent art direction appended to every image prompt (medium, texture, palette, lighting)"),
  motif: z.enum(MOTIFS).optional().describe("Decorative system for covers, dividers and page furniture: grid (Swiss rules), band (bold color blocks), frame (inset frame, formal), quiet (type only), orbit (circles). Omitted keeps orbit."),
  direction: z.enum(DIRECTIONS).optional().describe("Deck art direction: the composition system for every slide (grid, type scale, colour use, graphics, motion). Omitted maps from the motif and pairing."),
}).strict();
export type Theme = z.infer<typeof ThemeSchema>;

export const ItemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "Use a short kebab-case id like market-size.");
export const ImageName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use the kebab-case name of a generated image.");
export const AssetSchema = z.object({
  name: ImageName,
  id: z.string().uuid(),
  aspect: z.enum(["landscape", "portrait", "square"]),
  alt: z.string().trim().max(300).default(""),
  prompt: z.string().max(3000).default(""),
  /** Measured brightness of the image: an 8×8 grid (row-major) of each cell's 98th-percentile brightest channel, 0–255. Text over the image gets a scrim sized from it; without it the brightest case is assumed. */
  luma: z.array(z.number().int().min(0).max(255)).length(64).optional(),
}).strict();
export type DocumentAsset = z.infer<typeof AssetSchema>;

const line = (max: number) => z.string().trim().min(1).max(max);

export const IMAGE_PLACEMENTS = ["side", "band", "full"] as const;
export type ImagePlacement = (typeof IMAGE_PLACEMENTS)[number];
export const SLIDE_LAYOUTS = ["cover", "section", "statement", "points", "split", "stats", "chart", "diagram", "compare", "quote", "image", "closing", "team", "pricing", "table", "agenda", "canvas"] as const;
export const ChartSchema = z.object({
  type: z.enum(["bar", "column", "line", "donut"]),
  categories: z.array(line(28)).min(2).max(12),
  series: z.array(z.object({ name: line(40), values: z.array(z.number().finite()).min(2).max(12) }).strict()).min(1).max(3),
  unit: z.string().trim().max(8).optional().describe("Suffix or prefix shown with values, e.g. % or $M"),
  unitPosition: z.enum(["prefix", "suffix"]).optional(),
  highlight: z.number().int().min(0).max(11).optional().describe("Category index to emphasise in the accent color"),
  source: z.string().trim().max(140).optional().describe("Data source; write 'Illustrative data' when figures are examples"),
}).strict().superRefine((chart, ctx) => {
  chart.series.forEach((series, index) => {
    if (series.values.length !== chart.categories.length) ctx.addIssue({ code: "custom", path: ["series", index, "values"], message: `Series "${series.name}" needs exactly ${chart.categories.length} values (one per category).` });
  });
  if (chart.type === "donut") {
    if (chart.series.length !== 1) ctx.addIssue({ code: "custom", path: ["series"], message: "A donut chart has exactly one series." });
    if (chart.series[0]?.values.some(value => value < 0)) ctx.addIssue({ code: "custom", path: ["series"], message: "Donut values must be zero or positive." });
    if (chart.categories.length > 6) ctx.addIssue({ code: "custom", path: ["categories"], message: "A donut chart reads best with at most 6 slices." });
  }
  if (chart.highlight !== undefined && chart.highlight >= chart.categories.length) ctx.addIssue({ code: "custom", path: ["highlight"], message: "highlight must be a valid category index." });
});
export type Chart = z.infer<typeof ChartSchema>;

export const DiagramSchema = z.object({
  kind: z.enum(["process", "cycle", "pyramid", "funnel", "timeline", "matrix"]),
  items: z.array(z.object({ label: line(40), detail: z.string().trim().max(120).optional() }).strict()).min(2).max(6),
  axes: z.object({ x: line(30), y: line(30) }).strict().optional().describe("matrix only: axis names"),
}).strict().superRefine((diagram, ctx) => {
  if (diagram.kind === "matrix" && diagram.items.length !== 4) ctx.addIssue({ code: "custom", path: ["items"], message: "A matrix diagram has exactly 4 quadrants." });
  if (diagram.kind === "cycle" && diagram.items.length < 3) ctx.addIssue({ code: "custom", path: ["items"], message: "A cycle needs at least 3 steps." });
});
export type Diagram = z.infer<typeof DiagramSchema>;

/** Free composition: text and shape blocks placed on the art direction's 12-column × 8-row grid. */
const cell = { col: z.number().int().min(1).max(12), span: z.number().int().min(1).max(12), row: z.number().int().min(1).max(8), rows: z.number().int().min(1).max(8) };
export const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), style: z.enum(["display", "headline", "lead", "body", "label", "number", "quote"]), text: line(220), ...cell,
    align: z.enum(["left", "center", "right"]).optional(), color: z.enum(["ink", "muted", "accent", "accent2"]).optional() }).strict(),
  z.object({ type: z.literal("shape"), shape: z.enum(["rect", "circle", "half-circle", "quarter-circle", "arch", "rule", "dots", "glow"]), ...cell,
    fill: z.enum(["accent", "accent2", "dark", "surface", "ink", "muted"]), turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe("Rotation for half and quarter circles") }).strict(),
]);
export type Block = z.infer<typeof BlockSchema>;
const PointSchema = z.object({ title: z.string().trim().max(60).optional(), text: line(170) }).strict();
const SideSchema = z.object({ heading: line(50), points: z.array(line(110)).min(1).max(5) }).strict();
export const PersonSchema = z.object({
  name: line(48), role: line(60),
  detail: z.string().trim().max(140).optional().describe("One short credential or responsibility"),
  image: ImageName.optional().describe("Optional portrait; without one an initials monogram is drawn. Never generate a fake photo of a real person."),
}).strict();
export const TierSchema = z.object({
  name: line(32), price: line(16).describe('Price exactly as quoted, e.g. "$18,000" or "€49"'),
  period: z.string().trim().max(24).optional().describe('e.g. "per month", "one-off", "6 weeks"'),
  description: z.string().trim().max(120).optional(),
  features: z.array(line(70)).max(6).default([]),
  highlight: z.boolean().optional().describe("Emphasise the recommended option (at most one)"),
}).strict();
export const TableSchema = z.object({
  columns: z.array(z.string().trim().max(32)).min(2).max(6).describe("Column headings; the first may be empty when the first column holds row labels"),
  rows: z.array(z.array(z.string().trim().max(60)).min(2).max(6)).min(1).max(8),
  highlight: z.number().int().min(0).max(5).optional().describe("Column index to emphasise, usually your own offer"),
}).strict().superRefine((table, ctx) => {
  table.columns.forEach((column, index) => { if (index > 0 && !column) ctx.addIssue({ code: "custom", path: ["columns", index], message: "Only the first column heading may be empty." }); });
  table.rows.forEach((row, index) => { if (row.length !== table.columns.length) ctx.addIssue({ code: "custom", path: ["rows", index], message: `Each row needs exactly ${table.columns.length} cells (one per column).` }); });
  if (table.highlight !== undefined && table.highlight >= table.columns.length) ctx.addIssue({ code: "custom", path: ["highlight"], message: "highlight must be a valid column index." });
});

/** Full-image slides (slide-art.ts): the composition frame each slide is generated in. */
export const SLIDE_FRAMES = ["full-bleed", "split", "type-poster", "big-number", "chart-feature", "card-grid", "timeline", "quote", "comparison", "inset-frame", "collage", "diagram"] as const;
export type SlideFrame = (typeof SLIDE_FRAMES)[number];
/** A full-image slide's plan, written by the designer with the slide. */
export const SlideArtSchema = z.object({
  frame: z.enum(SLIDE_FRAMES).describe("The composition this slide is generated in; consecutive slides never share one"),
  brief: z.string().trim().min(20).max(900).describe("This slide's own composition: where the type block sits and how large, the focal subject or graphic, crop, light, and how it differs from the slides around it. No words to render here; the slide's fields are the text."),
}).strict();
export const SLIDE_MODES = ["image", "live"] as const;
/** A full-image deck's design system and its verified renders (set by the builder, never by the model). */
export const DeckArtSchema = z.object({
  mode: z.enum(SLIDE_MODES).describe("image: every slide is one generated picture that includes its text; live: editable text slides"),
  system: z.string().trim().max(1600).default("").describe("The deck's design system for every generated slide: grid, type style, palette use, photographic or illustrative language, recurring motif"),
  renders: z.array(z.object({
    slide: ItemId,
    frame: z.enum(SLIDE_FRAMES).optional(),
    image: ImageName.optional(),
    /** textKey() of the slide's words the image was verified against. */
    verified: z.string().max(80).optional(),
    attempts: z.number().int().min(0).max(9),
    outcome: z.enum(["passed", "fallback"]),
    problems: z.array(z.string().max(300)).max(6).default([]),
  }).strict()).max(40).default([]),
}).strict();

export const SlideSchema = z.object({
  id: ItemId,
  layout: z.enum(SLIDE_LAYOUTS),
  tone: z.enum(["light", "dark", "accent"]).default("light"),
  eyebrow: z.string().trim().max(40).optional(),
  title: line(120),
  subtitle: z.string().trim().max(220).optional(),
  body: z.string().trim().max(420).optional(),
  points: z.array(PointSchema).min(1).max(6).optional(),
  stats: z.array(z.object({ value: line(12), label: line(60), detail: z.string().trim().max(110).optional() }).strict()).min(1).max(4).optional(),
  chart: ChartSchema.optional(),
  diagram: DiagramSchema.optional(),
  compare: z.object({ left: SideSchema, right: SideSchema }).strict().optional(),
  quote: z.object({ text: line(280), attribution: z.string().trim().max(90).optional() }).strict().optional(),
  people: z.array(PersonSchema).min(1).max(6).optional().describe("team layout: 1–6 people"),
  tiers: z.array(TierSchema).min(1).max(4).optional().describe("pricing layout: 1–4 options or packages"),
  table: TableSchema.optional().describe("table layout: a compact comparison or breakdown"),
  image: ImageName.optional(),
  imageSide: z.enum(["left", "right"]).optional(),
  imagePlacement: z.enum(IMAGE_PLACEMENTS).optional().describe("How a text, number or chart slide shows its image: side (a 38% image rail beside the content), band (a top image band above a chart, table or diagram), full (full-bleed with a dark scrim behind the text; statement, quote and section only). Omit for the layout's default."),
  composition: CoverCompositionSchema.optional().describe("Optional authored geometry for a cover or closing slide. Omit to keep the existing layout."),
  variant: z.enum(ALL_COMPOSITIONS as [string, ...string[]]).optional().describe("Pin one of the art direction's compositions for this layout; omit to let the engine vary them."),
  blocks: z.array(BlockSchema).min(1).max(14).optional().describe("canvas layout: text and shape blocks on the 12×8 grid"),
  art: SlideArtSchema.optional().describe("Full-image decks only: this slide's composition frame and brief"),
  notes: z.string().trim().min(1, "Every slide needs speaker notes.").max(3000),
}).strict().superRefine((slide, ctx) => {
  if (slide.composition && slide.layout !== "cover" && slide.layout !== "closing") ctx.addIssue({ code: "custom", path: ["composition"], message: "Authored composition is supported only on cover and closing slides." });
  const need = (field: keyof typeof slide, why: string) => { if (slide[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: why }); };
  switch (slide.layout) {
    case "points": need("points", "A points slide needs 2–6 points."); if (slide.points && slide.points.length < 2) ctx.addIssue({ code: "custom", path: ["points"], message: "A points slide needs at least 2 points; use a statement slide for one idea." }); break;
    case "split": need("image", "A split slide needs an image name."); if (!slide.body && !slide.points) ctx.addIssue({ code: "custom", path: ["body"], message: "A split slide needs body text or points beside the image." }); break;
    case "stats": need("stats", "A stats slide needs 1–4 stats."); break;
    case "chart": need("chart", "A chart slide needs chart data."); break;
    case "diagram": need("diagram", "A diagram slide needs a diagram."); break;
    case "compare": need("compare", "A compare slide needs left and right sides."); break;
    case "quote": need("quote", "A quote slide needs a quote."); break;
    case "image": need("image", "An image slide needs an image name."); break;
    case "team": need("people", "A team slide needs 1–6 people."); break;
    case "pricing": need("tiers", "A pricing slide needs 1–4 tiers."); if (slide.tiers && slide.tiers.filter(tier => tier.highlight).length > 1) ctx.addIssue({ code: "custom", path: ["tiers"], message: "Highlight at most one tier." }); break;
    case "table": need("table", "A table slide needs columns and rows."); break;
    case "agenda": need("points", "An agenda slide needs 2–6 points (the agenda items)."); if (slide.points && slide.points.length < 2) ctx.addIssue({ code: "custom", path: ["points"], message: "An agenda needs at least 2 items." }); break;
    case "canvas": {
      need("blocks", "A canvas slide needs text and shape blocks.");
      const blocks = slide.blocks ?? [], texts = blocks.flatMap((block, index) => block.type === "text" ? [{ block, index }] : []);
      blocks.forEach((block, index) => {
        if (block.col + block.span - 1 > 12) ctx.addIssue({ code: "custom", path: ["blocks", index, "span"], message: "col + span - 1 must stay within the 12 columns." });
        if (block.row + block.rows - 1 > 8) ctx.addIssue({ code: "custom", path: ["blocks", index, "rows"], message: "row + rows - 1 must stay within the 8 rows." });
      });
      if (blocks.length && !texts.some(({ block }) => block.style === "display" || block.style === "headline")) ctx.addIssue({ code: "custom", path: ["blocks"], message: "A canvas needs one display or headline text block (the slide's message)." });
      texts.forEach(({ block: a, index }) => texts.forEach(({ block: b, index: other }) => {
        if (other > index && a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.rows && b.row < a.row + a.rows) ctx.addIssue({ code: "custom", path: ["blocks", other], message: `Text block ${other + 1} overlaps text block ${index + 1}; give each text its own cells.` });
      }));
      break;
    }
  }
  if (slide.variant && !(COMPOSITIONS[slide.layout] as readonly string[]).includes(slide.variant)) ctx.addIssue({ code: "custom", path: ["variant"], message: `variant ${slide.variant} is not a ${slide.layout} composition; use one of ${COMPOSITIONS[slide.layout].join(", ")}.` });
  if (slide.blocks && slide.layout !== "canvas") ctx.addIssue({ code: "custom", path: ["blocks"], message: "blocks are only used by the canvas layout." });
  if (slide.points && slide.points.length > 4 && slide.points.some(point => point.text.length > 110)) ctx.addIssue({ code: "custom", path: ["points"], message: "With 5–6 points keep each point under 110 characters, or split the slide." });
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckSchema = z.object({
  kind: z.literal("deck"),
  schemaVersion: z.literal(1),
  title: line(160),
  subtitle: z.string().trim().max(220).optional(),
  author: z.string().trim().max(120).optional(),
  theme: ThemeSchema,
  slides: z.array(SlideSchema).max(40),
  assets: z.array(AssetSchema).max(60),
  /** Absent on decks saved before full-image slides: they keep editable text slides. */
  art: DeckArtSchema.optional(),
}).strict();
export type Deck = z.infer<typeof DeckSchema>;

export const CHAPTER_TEXT_LIMIT = 40_000;
export const ChapterSchema = z.object({
  id: ItemId,
  label: z.string().trim().max(40).optional().describe("e.g. Chapter One, Part II, Prologue"),
  opening: z.enum(["page", "inline"]).optional().describe("page (default) gives a separate chapter opener; inline places the heading with the body, useful for short sections."),
  title: line(120),
  epigraph: z.object({ text: line(300), attribution: z.string().trim().max(90).optional() }).strict().optional(),
  image: ImageName.optional().describe("Opener illustration (landscape)"),
  text: z.string().max(CHAPTER_TEXT_LIMIT).describe("Chapter body in Makeborne book markup"),
}).strict();
export type Chapter = z.infer<typeof ChapterSchema>;

/** How a book is illustrated (asked when the book is created; default cover and chapter openers). */
export const BOOK_IMAGE_PLACEMENTS = ["none", "cover", "openers", "every", "rich"] as const;
export const BOOK_IMAGE_STYLES = ["photo", "illustration", "technique", "auto"] as const;
export const BookImagePlanSchema = z.object({
  placement: z.enum(BOOK_IMAGE_PLACEMENTS).describe("none; cover only; cover and chapter openers; openers plus one image about every N pages; richly illustrated (about one per spread)"),
  everyPages: z.number().int().min(2).max(40).optional().describe("placement every: about one image per this many pages"),
  style: z.enum(BOOK_IMAGE_STYLES).default("auto"),
  technique: z.string().trim().max(120).optional().describe("The one technique or medium named by the client, e.g. botanical watercolour"),
}).strict();
export type BookImagePlan = z.infer<typeof BookImagePlanSchema>;

export const BookSchema = z.object({
  kind: z.literal("book"),
  schemaVersion: z.literal(1),
  title: line(160),
  subtitle: z.string().trim().max(220).optional(),
  author: z.string().trim().max(120).optional(),
  dedication: z.string().trim().max(400).optional(),
  cover: z.object({ image: ImageName.optional(), tagline: z.string().trim().max(160).optional(), composition: CoverCompositionSchema.optional() }).strict().default({}),
  theme: ThemeSchema,
  chapters: z.array(ChapterSchema).max(40),
  assets: z.array(AssetSchema).max(60),
  /** Absent on books saved before the image plan: cover and chapter openers. */
  imagePlan: BookImagePlanSchema.optional(),
}).strict();
export type Book = z.infer<typeof BookSchema>;

export const DocumentSourceSchema = z.discriminatedUnion("kind", [DeckSchema, BookSchema]).superRefine((doc, ctx) => {
  // Authored fit/contrast failures must never be silently dropped or accepted on retry.
  if (doc.kind === "book" && doc.cover.composition && CoverCompositionSchema.safeParse(doc.cover.composition).success) {
    for (const message of bookCoverScene(doc).issues) ctx.addIssue({ code: "custom", path: ["cover", "composition"], message });
  } else if (doc.kind === "deck") {
    doc.slides.forEach((slide, index) => {
      if (slide.composition && CoverCompositionSchema.safeParse(slide.composition).success) for (const message of slideCoverScene(doc.theme, slide, doc.assets, doc.author).issues) ctx.addIssue({ code: "custom", path: ["slides", index, "composition"], message });
    });
  }
  const names = new Set<string>();
  doc.assets.forEach((asset, index) => {
    if (names.has(asset.name)) ctx.addIssue({ code: "custom", path: ["assets", index, "name"], message: "Image names must be unique." });
    names.add(asset.name);
  });
  const ids = new Set<string>();
  const items = doc.kind === "deck" ? doc.slides : doc.chapters;
  items.forEach((item, index) => {
    if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: [doc.kind === "deck" ? "slides" : "chapters", index, "id"], message: "Ids must be unique." });
    ids.add(item.id);
  });
});
export type DocumentSource = z.infer<typeof DocumentSourceSchema>;

/** Bound stored size so content plus its outline projection fits the 2 MB version limit. */
export const DOCUMENT_BYTE_LIMIT = 800_000;
