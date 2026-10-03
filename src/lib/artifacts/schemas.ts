import { z } from "zod";
import { ContentBlockSchema, StyleProfileSchema } from "../domain";

export const ElementIdSchema = z.string().uuid();
/** Preserve literal markup/code as data; reject only XML-invalid text characters. */
export function isXmlSafeText(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point === 0x09 || point === 0x0a || point === 0x0d) continue;
    if ((point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff)) continue;
    return false;
  }
  return true;
}
const plain = (max = 50000) => z.string().max(max).refine(isXmlSafeText, "Text contains an XML-forbidden control character or invalid Unicode surrogate.");
const title = plain(200).refine((value) => value.trim().length > 0, "A title is required.");
const refs = z.array(ElementIdSchema).max(200).default([]);
export const SafeHttpUrlSchema = z.string().max(2048).url().refine((value) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "Only HTTP(S) URLs without credentials are supported.");
export const NavigationHrefSchema = z.union([
  SafeHttpUrlSchema,
  z.string().max(200).regex(/^\/[a-zA-Z0-9/_-]*$/),
  z.string().max(100).regex(/^#[a-zA-Z][a-zA-Z0-9_-]*$/),
]);

export const AssetReferenceSchema = z.object({
  id: ElementIdSchema,
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  origin: z.enum(["authored", "uploaded", "openai_generated", "sample"]),
  state: z.enum(["pending_upload", "available", "missing"]),
  alt: plain(2000),
  width: z.number().int().positive().max(40000).optional(),
  height: z.number().int().positive().max(40000).optional(),
  sourceIds: refs,
  // No browser-supplied storage path or remotely executable markup lives here.
}).strict();
export type AssetReference = z.infer<typeof AssetReferenceSchema>;

export const StyleRefSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() }).strict();
export const VersionedStyleSchema = StyleProfileSchema.extend({
  schemaVersion: z.literal(1),
  scope: z.enum(["workspace", "client", "project", "preset"]),
  layout: z.object({ density: z.enum(["spacious", "balanced", "compact"]), radius: z.number().min(0).max(32), maxColumns: z.number().int().min(1).max(6) }).strict(),
}).strict();
export type VersionedStyle = z.infer<typeof VersionedStyleSchema>;

// Reuse the application's block format instead of inventing a second body model.
export const NativeBodyBlockSchema = ContentBlockSchema.extend({
  text: plain(),
  sourceIds: refs,
}).strict();
const body = z.array(NativeBodyBlockSchema).max(500);
const shared = {
  schemaVersion: z.literal(1),
  id: ElementIdSchema,
  title,
  styleRef: StyleRefSchema,
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).default("en"),
  sourceIds: refs,
  assets: z.array(AssetReferenceSchema).max(500).default([]),
  authorship: z.enum(["authored", "generated", "mixed", "sample"]).default("authored"),
};
const item = { id: ElementIdSchema, title, description: plain(10000), sourceIds: refs };
const baseSection = {
  id: ElementIdSchema,
  anchor: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  responsive: z.object({ desktopColumns: z.number().int().min(1).max(6).default(1), mobileColumns: z.literal(1).default(1), imagePlacement: z.enum(["before", "after", "background", "none"]).default("none") }).strict(),
  sourceIds: refs,
};
const link = z.object({ id: ElementIdSchema, label: title, href: NavigationHrefSchema }).strict();
export const SiteSectionSchema = z.discriminatedUnion("type", [
  z.object({ ...baseSection, type: z.literal("hero"), heading: title, body: plain(20000), imageAssetId: ElementIdSchema.nullable().default(null), links: z.array(link).max(4).default([]) }).strict(),
  z.object({ ...baseSection, type: z.literal("features"), heading: title, items: z.array(z.object(item).strict()).max(24) }).strict(),
  z.object({ ...baseSection, type: z.literal("services"), heading: title, items: z.array(z.object({ ...item, imageAssetId: ElementIdSchema.nullable().default(null) }).strict()).max(24) }).strict(),
  z.object({ ...baseSection, type: z.literal("gallery"), heading: title, items: z.array(z.object({ id: ElementIdSchema, assetId: ElementIdSchema, caption: plain(2000), sourceIds: refs }).strict()).max(60) }).strict(),
  z.object({ ...baseSection, type: z.literal("testimonials"), heading: title, items: z.array(z.object({ id: ElementIdSchema, quote: plain(5000), attribution: title, sourceIds: z.array(ElementIdSchema).min(1).max(20), permissionConfirmed: z.literal(true) }).strict()).max(24) }).strict(),
  z.object({ ...baseSection, type: z.literal("faq"), heading: title, items: z.array(z.object({ id: ElementIdSchema, question: title, answer: plain(20000), sourceIds: refs }).strict()).max(50) }).strict(),
  z.object({ ...baseSection, type: z.literal("contact"), heading: title, body: plain(20000), email: z.string().email().optional(), formIntegrationId: ElementIdSchema.nullable().default(null), submitLabel: title.default("Send enquiry") }).strict(),
  z.object({ ...baseSection, type: z.literal("footer"), text: plain(10000), links: z.array(link).max(30).default([]) }).strict(),
  z.object({ ...baseSection, type: z.literal("content"), heading: title, blocks: body }).strict(),
]);
const siteShape = z.object({
  ...shared, kind: z.literal("website"),
  navigation: z.array(link).max(30).default([]),
  pages: z.array(z.object({ id: ElementIdSchema, path: z.string().max(200).regex(/^\/[a-zA-Z0-9/_-]*$/), title, description: plain(400), sections: z.array(SiteSectionSchema).max(100) }).strict()).min(1).max(100),
}).strict();

export const EditionProfileSchema = z.discriminatedUnion("type", [
  z.object({ id: ElementIdSchema, type: z.literal("digital_pdf"), pageSize: z.enum(["a4", "letter", "6x9"]), navigation: z.boolean().default(true) }).strict(),
  z.object({ id: ElementIdSchema, type: z.literal("print"), binding: z.enum(["paperback", "hardcover"]), trimWidthIn: z.number().min(4).max(9), trimHeightIn: z.number().min(6).max(12), ink: z.enum(["black", "standard_color", "premium_color"]), paper: z.enum(["white", "cream"]), bleed: z.boolean(), ruleVersion: z.string().min(1).max(100), preflightState: z.enum(["not_checked", "failed", "passed"]), preflightReportId: ElementIdSchema.nullable().default(null) }).strict(),
  z.object({ id: ElementIdSchema, type: z.literal("epub"), layout: z.enum(["reflowable", "fixed"]), validationState: z.enum(["not_checked", "failed", "passed"]), validationReportId: ElementIdSchema.nullable().default(null) }).strict(),
]);
const bookShape = z.object({
  ...shared, kind: z.literal("book"),
  subtitle: plain(500).default(""),
  coverAssetId: ElementIdSchema.nullable().default(null),
  chapters: z.array(z.object({ id: ElementIdSchema, title, body, artworkAssetIds: refs, sourceIds: refs }).strict()).min(1).max(200),
  editions: z.array(EditionProfileSchema).min(1).max(12),
}).strict();

const position = { x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) };
export const NativeSlideElementSchema = z.discriminatedUnion("type", [
  z.object({ id: ElementIdSchema, ...position, type: z.literal("text"), text: plain(20000), role: z.enum(["title", "body", "caption"]), font: z.enum(["sans", "serif"]), fontSizePt: z.number().min(8).max(120), color: z.string().regex(/^#[a-fA-F0-9]{6}$/), sourceIds: refs }).strict(),
  z.object({ id: ElementIdSchema, ...position, type: z.literal("shape"), shape: z.enum(["rectangle", "ellipse", "line"]), fill: z.string().regex(/^#[a-fA-F0-9]{6}$/), sourceIds: refs }).strict(),
  z.object({ id: ElementIdSchema, ...position, type: z.literal("image"), assetId: ElementIdSchema, fit: z.enum(["contain", "cover"]), sourceIds: refs }).strict(),
  z.object({ id: ElementIdSchema, ...position, type: z.literal("chart"), chart: z.enum(["bar", "line", "pie"]), categories: z.array(plain(200)).min(1).max(100), series: z.array(z.object({ name: title, values: z.array(z.number().finite()).min(1).max(100) }).strict()).min(1).max(20), sourceIds: z.array(ElementIdSchema).min(1).max(20) }).strict(),
]).superRefine((element, ctx) => {
  if (element.x + element.width > 1.000001 || element.y + element.height > 1.000001) ctx.addIssue({ code: "custom", message: "Element must fit inside the normalized slide bounds." });
  if (element.type === "chart" && element.series.some((series) => series.values.length !== element.categories.length)) ctx.addIssue({ code: "custom", message: "Each chart series must match the category count." });
});
const slide = z.object({
  id: ElementIdSchema,
  title,
  script: body,
  notes: plain(20000).default(""),
  sourceIds: refs,
  visualAssetId: ElementIdSchema.nullable().default(null),
  textCheck: z.enum(["not_checked", "mismatch", "passed"]).default("not_checked"),
  elements: z.array(NativeSlideElementSchema).max(100).default([]),
}).strict();
const deckShape = z.object({
  ...shared, kind: z.literal("presentation"),
  mode: z.enum(["visual", "native"]).default("visual"),
  aspect: z.enum(["16:9", "4:3", "3:2"]).default("16:9"),
  slides: z.array(slide).min(1).max(100),
}).strict();

type ReferenceNode = { [key: string]: unknown };
function validateSpec(spec: ReferenceNode, ctx: z.RefinementCtx) {
  const declaredAssets = new Set((spec.assets as AssetReference[]).map((asset) => asset.id));
  const declaredSources = new Set(spec.sourceIds as string[]);
  const elements = new Set<string>();
  // Asset IDs are a separate namespace; all structural element IDs are unique.
  function walk(value: unknown, path: (string | number)[], namespace: "content" | "assets" = "content") {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, [...path, index], namespace)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (key === "id" && namespace === "content" && typeof item === "string") {
        if (elements.has(item)) ctx.addIssue({ code: "custom", path: next, message: "Structural element IDs must be unique." });
        elements.add(item);
      }
      if ((key === "assetId" || key === "imageAssetId" || key === "coverAssetId" || key === "visualAssetId") && item && !declaredAssets.has(item as string)) ctx.addIssue({ code: "custom", path: next, message: "Asset reference is not in this artifact manifest." });
      if (key === "artworkAssetIds" && Array.isArray(item)) item.forEach((id, index) => { if (!declaredAssets.has(id)) ctx.addIssue({ code: "custom", path: [...next, index], message: "Artwork reference is not in this artifact manifest." }); });
      if (key === "sourceIds" && path.length && Array.isArray(item)) item.forEach((id, index) => { if (!declaredSources.has(id)) ctx.addIssue({ code: "custom", path: [...next, index], message: "Source reference is not declared for this artifact." }); });
      // Style and report references are not editable artifact elements.
      if (key !== "styleRef") walk(item, next, key === "assets" ? "assets" : namespace);
    }
  }
  walk(spec, []);
  const assetIds = (spec.assets as AssetReference[]).map((asset) => asset.id);
  if (new Set(assetIds).size !== assetIds.length) ctx.addIssue({ code: "custom", path: ["assets"], message: "Asset manifest IDs must be unique." });
  if (declaredSources.size !== (spec.sourceIds as string[]).length) ctx.addIssue({ code: "custom", path: ["sourceIds"], message: "Declared source IDs must be unique." });
}
export const SiteSpecSchema = siteShape.superRefine((spec, ctx) => {
  validateSpec(spec, ctx);
  const paths = spec.pages.map((page) => page.path);
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: "custom", path: ["pages"], message: "Page paths must be unique." });
  spec.pages.forEach((page, pageIndex) => {
    const anchors = page.sections.map((section) => section.anchor);
    if (new Set(anchors).size !== anchors.length) ctx.addIssue({ code: "custom", path: ["pages", pageIndex, "sections"], message: "Section anchors must be unique within a page." });
  });
});
export const BookSpecSchema = bookShape.superRefine(validateSpec);
export const DeckSpecSchema = deckShape.superRefine((spec, ctx) => {
  validateSpec(spec, ctx);
  spec.slides.forEach((item, index) => {
    if (spec.mode === "visual" && item.elements.length) ctx.addIssue({ code: "custom", path: ["slides", index, "elements"], message: "A visual slide image does not expose native editable elements." });
  });
});
export type SiteSpec = z.infer<typeof SiteSpecSchema>;
export type BookSpec = z.infer<typeof BookSpecSchema>;
export type DeckSpec = z.infer<typeof DeckSpecSchema>;
export type ArtifactSpec = SiteSpec | BookSpec | DeckSpec;
export const ArtifactSpecSchema = z.union([SiteSpecSchema, BookSpecSchema, DeckSpecSchema]);

export const ProjectContextSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ElementIdSchema,
  audience: plain(5000),
  purpose: plain(5000),
  wording: z.enum(["preserve", "improve", "summarise"]),
  sources: z.array(z.object({ id: ElementIdSchema, title, url: SafeHttpUrlSchema.optional(), visibility: z.enum(["private", "project", "public"]), processingAllowed: z.boolean(), publicationAllowed: z.boolean(), rightsBasis: z.enum(["owned", "licensed", "consent", "public_domain", "unknown"]), recordedAt: z.string().datetime() }).strict()).max(1000),
  facts: z.array(z.object({ id: ElementIdSchema, statement: plain(20000), state: z.enum(["unverified", "supported", "approved", "rejected"]), sourceIds: refs, locked: z.boolean().default(false) }).strict()).max(2000),
  approvedStyle: StyleRefSchema.nullable().default(null),
}).strict().superRefine((context, ctx) => {
  const sourceIds = new Set(context.sources.map((source) => source.id));
  if (sourceIds.size !== context.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "Source IDs must be unique." });
  if (new Set(context.facts.map((fact) => fact.id)).size !== context.facts.length) ctx.addIssue({ code: "custom", path: ["facts"], message: "Fact IDs must be unique." });
  context.facts.forEach((fact, index) => {
    if (["supported", "approved"].includes(fact.state) && !fact.sourceIds.length) ctx.addIssue({ code: "custom", path: ["facts", index, "sourceIds"], message: "Supported facts need evidence references." });
    fact.sourceIds.forEach((id) => { if (!sourceIds.has(id)) ctx.addIssue({ code: "custom", path: ["facts", index, "sourceIds"], message: "Fact references an unknown source." }); });
  });
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
