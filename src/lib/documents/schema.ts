import { z } from "zod";

/** Structured source for live-built presentations and books. It is the single
 * input to the preview renderer, the PDF printer and the PPTX writer, and is
 * stored on the artifact version as `content.document`. */

export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1F2A44.");
export const FONT_PAIRINGS = ["editorial", "modern", "geometric", "classic", "garamond", "grotesk", "humanist", "condensed"] as const;
export const FontPairingSchema = z.enum(FONT_PAIRINGS);
export type FontPairing = z.infer<typeof FontPairingSchema>;

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
}).strict();
export type DocumentAsset = z.infer<typeof AssetSchema>;

const line = (max: number) => z.string().trim().min(1).max(max);

export const SLIDE_LAYOUTS = ["cover", "section", "statement", "points", "split", "stats", "chart", "diagram", "compare", "quote", "image", "closing"] as const;
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

const PointSchema = z.object({ title: z.string().trim().max(60).optional(), text: line(170) }).strict();
const SideSchema = z.object({ heading: line(50), points: z.array(line(110)).min(1).max(5) }).strict();

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
  image: ImageName.optional(),
  imageSide: z.enum(["left", "right"]).optional(),
  notes: z.string().trim().min(1, "Every slide needs speaker notes.").max(3000),
}).strict().superRefine((slide, ctx) => {
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
  }
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
}).strict();
export type Deck = z.infer<typeof DeckSchema>;

export const CHAPTER_TEXT_LIMIT = 40_000;
export const ChapterSchema = z.object({
  id: ItemId,
  label: z.string().trim().max(40).optional().describe("e.g. Chapter One, Part II, Prologue"),
  title: line(120),
  epigraph: z.object({ text: line(300), attribution: z.string().trim().max(90).optional() }).strict().optional(),
  image: ImageName.optional().describe("Opener illustration (landscape)"),
  text: z.string().max(CHAPTER_TEXT_LIMIT).describe("Chapter body in Makeborne book markup"),
}).strict();
export type Chapter = z.infer<typeof ChapterSchema>;

export const BookSchema = z.object({
  kind: z.literal("book"),
  schemaVersion: z.literal(1),
  title: line(160),
  subtitle: z.string().trim().max(220).optional(),
  author: z.string().trim().max(120).optional(),
  dedication: z.string().trim().max(400).optional(),
  cover: z.object({ image: ImageName.optional(), tagline: z.string().trim().max(160).optional() }).strict().default({}),
  theme: ThemeSchema,
  chapters: z.array(ChapterSchema).max(40),
  assets: z.array(AssetSchema).max(60),
}).strict();
export type Book = z.infer<typeof BookSchema>;

export const DocumentSourceSchema = z.discriminatedUnion("kind", [DeckSchema, BookSchema]).superRefine((doc, ctx) => {
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
