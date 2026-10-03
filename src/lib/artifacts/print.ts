import { z } from "zod";
import type { BookSpec } from "./schemas";

export const KDP_RULE_VERSION = "kdp-paperback-6x9-2026-10-03" as const;
export const KDP_SOURCE_CHECKED_DATE = "2026-10-03" as const;
export const KDP_SOURCES = {
  submission: "https://kdp.amazon.com/en_US/help/topic/G201857950",
  options: "https://kdp.amazon.com/en_US/help/topic/G201834180",
  margins: "https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6",
  cover: "https://kdp.amazon.com/en_US/help/topic/G201953020",
  images: "https://kdp.amazon.com/en_US/help/topic/G202169030",
  fixes: "https://kdp.amazon.com/en_US/help/topic/G201834260",
  calculator: "https://kdp.amazon.com/cover-calculator",
  aiDisclosure: "https://kdp.amazon.com/en_US/help/topic/G200672390",
} as const;

export const KdpPaperbackProfileSchema = z.object({
  ruleVersion: z.literal(KDP_RULE_VERSION),
  binding: z.literal("paperback"),
  trimWidthIn: z.literal(6),
  trimHeightIn: z.literal(9),
  // No interior bleed in this initial profile. Cover bleed is still compulsory.
  bleed: z.literal(false),
  ink: z.enum(["black", "standard_color", "premium_color"]),
  paper: z.enum(["white", "cream"]),
  pageCount: z.number().int().min(1).max(5000),
  readingDirection: z.literal("ltr").default("ltr"),
}).strict().superRefine((profile, ctx) => {
  const count = Math.ceil(profile.pageCount / 2) * 2;
  if (profile.ink !== "black" && profile.paper !== "white") ctx.addIssue({ code: "custom", path: ["paper"], message: "Colour paperback profiles require white paper." });
  const minimum = profile.ink === "standard_color" ? 72 : 24;
  const maximum = profile.ink === "standard_color" ? 600 : profile.ink === "black" && profile.paper === "cream" ? 776 : 828;
  if (count < minimum || count > maximum) ctx.addIssue({ code: "custom", path: ["pageCount"], message: `The selected 6×9 profile supports ${minimum}–${maximum} effective pages.` });
});
export type KdpPaperbackProfile = z.infer<typeof KdpPaperbackProfileSchema>;

export function requiredGutterIn(pageCount: number): number {
  const count = Math.ceil(z.number().int().min(24).max(828).parse(pageCount) / 2) * 2;
  if (count <= 150) return 0.375;
  if (count <= 300) return 0.5;
  if (count <= 500) return 0.625;
  if (count <= 700) return 0.75;
  return 0.875;
}

export function calculatePrintGeometry(input: KdpPaperbackProfile) {
  const profile = KdpPaperbackProfileSchema.parse(input);
  const effectivePageCount = Math.ceil(profile.pageCount / 2) * 2;
  // Dedicated cover guide differentiates standard and premium colour.
  // Generic submission guide instead groups colour under 0.002347: preserve conflict.
  const spineFactorIn = profile.ink === "premium_color" ? 0.002347 : profile.paper === "cream" ? 0.0025 : 0.002252;
  const spineWidthIn = effectivePageCount * spineFactorIn;
  return {
    effectivePageCount,
    interiorWidthIn: 6,
    interiorHeightIn: 9,
    minimumInsideMarginIn: requiredGutterIn(effectivePageCount),
    minimumOutsideMarginIn: 0.25,
    minimumTopMarginIn: 0.25,
    minimumBottomMarginIn: 0.25,
    spineFactorIn,
    spineWidthIn,
    coverWidthIn: 12.25 + spineWidthIn,
    coverHeightIn: 9.25,
    coverBleedIn: 0.125,
    coverSafeDistanceFromFileEdgeIn: 0.25,
    minimumSpineTextInsetIn: 0.0625,
    spineTextAllowed: effectivePageCount >= 80,
    minimumFontSizePt: 7,
    minimumImageDpi: 300,
    requiresOfficialCoverTemplateCheck: true,
  };
}

export const PrintImagePlacementSchema = z.object({
  assetId: z.string().uuid(),
  pixelWidth: z.number().int().positive().max(100000),
  pixelHeight: z.number().int().positive().max(100000),
  croppedPixelWidth: z.number().int().positive().optional(),
  croppedPixelHeight: z.number().int().positive().optional(),
  placedWidthIn: z.number().positive().max(40),
  placedHeightIn: z.number().positive().max(40),
}).strict().superRefine((image, ctx) => {
  if ((image.croppedPixelWidth ?? image.pixelWidth) > image.pixelWidth || (image.croppedPixelHeight ?? image.pixelHeight) > image.pixelHeight) ctx.addIssue({ code: "custom", message: "Crop dimensions cannot exceed the actual image pixels." });
});
export type PrintImagePlacement = z.infer<typeof PrintImagePlacementSchema>;
export function effectiveImageDpi(input: PrintImagePlacement) {
  const image = PrintImagePlacementSchema.parse(input);
  const horizontal = (image.croppedPixelWidth ?? image.pixelWidth) / image.placedWidthIn;
  const vertical = (image.croppedPixelHeight ?? image.pixelHeight) / image.placedHeightIn;
  return { horizontal, vertical, minimum: Math.min(horizontal, vertical), meets300Dpi: horizontal >= 300 && vertical >= 300 };
}

const observedPdf = z.object({
  fileId: z.string().uuid(),
  mime: z.string().max(100),
  byteLength: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  pagesHaveConsistentDimensions: z.boolean().optional(),
  singlePages: z.boolean().optional(),
  fontsEmbedded: z.boolean().optional(),
  encrypted: z.boolean().optional(),
  transparencyFlattened: z.boolean().optional(),
  containsCropOrTrimMarks: z.boolean().optional(),
  containsAnnotationsOrBookmarks: z.boolean().optional(),
  containsPlaceholderOrCreationMarks: z.boolean().optional(),
  minimumFontSizePt: z.number().positive().optional(),
}).strict();
export const PaperbackMetadataInputSchema = z.object({
  profile: KdpPaperbackProfileSchema,
  margins: z.object({ insideIn: z.number().nonnegative(), outsideIn: z.number().nonnegative(), topIn: z.number().nonnegative(), bottomIn: z.number().nonnegative() }).strict(),
  interior: observedPdf.optional(),
  cover: observedPdf.optional(),
  imagePlacements: z.array(PrintImagePlacementSchema).max(2000).default([]),
  imagePlacementInventoryComplete: z.boolean().default(false),
  includesSpineText: z.boolean().default(false),
  spineTextInsetIn: z.number().nonnegative().optional(),
  coverTextEdgeDistanceIn: z.number().nonnegative().optional(),
  officialCoverTemplate: z.object({ widthIn: z.number().positive(), heightIn: z.number().positive(), spineWidthIn: z.number().positive(), effectivePageCount: z.number().int().positive() }).strict().optional(),
  aiGeneratedImages: z.boolean().default(false),
  aiGeneratedText: z.boolean().default(false),
  aiGeneratedTranslations: z.boolean().default(false),
}).strict();
export type PaperbackMetadataInput = z.input<typeof PaperbackMetadataInputSchema>;
export type PrintFinding = { code: string; severity: "error" | "unknown" | "warning"; message: string; source: string };

/** Validates supplied measurements. Does not inspect PDF bytes or claim Amazon approval. */
export function validatePaperbackMetadata(input: PaperbackMetadataInput) {
  const parsed = PaperbackMetadataInputSchema.safeParse(input);
  const findings: PrintFinding[] = [];
  const add = (code: string, severity: PrintFinding["severity"], message: string, source: string = KDP_SOURCES.submission) => findings.push({ code, severity, message, source });
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => add("invalid_profile_or_observation", "error", `${issue.path.join(".")}: ${issue.message}`));
    return { ruleVersion: KDP_RULE_VERSION, sourceCheckedDate: KDP_SOURCE_CHECKED_DATE, status: "failed" as const, renderedFilesVerified: false as const, amazonAcceptance: false as const, geometry: null, findings, disclosureRequired: null };
  }
  const value = parsed.data;
  const geometry = calculatePrintGeometry(value.profile);
  if (value.profile.pageCount !== geometry.effectivePageCount) add("odd_page_count", "warning", "KDP rounds the page count up to an even number; cover geometry uses that count. Prefer an explicit final-page proof.", KDP_SOURCES.fixes);
  for (const [name, actual, minimum] of [["inside", value.margins.insideIn, geometry.minimumInsideMarginIn], ["outside", value.margins.outsideIn, 0.25], ["top", value.margins.topIn, 0.25], ["bottom", value.margins.bottomIn, 0.25]] as const) if (actual < minimum) add("insufficient_margin", "error", `${name} margin must be at least ${minimum} inches.`, KDP_SOURCES.margins);
  if (value.margins.insideIn + value.margins.outsideIn >= 6 || value.margins.topIn + value.margins.bottomIn >= 9) add("empty_content_area", "error", "Margins consume the whole page; there is no usable content area.", KDP_SOURCES.margins);

  for (const role of ["interior", "cover"] as const) {
    const file = value[role];
    if (!file) { add(`missing_${role}`, "unknown", `A separate ${role} PDF measurement is required.`); continue; }
    if (file.mime !== "application/pdf") add("wrong_file_type", "error", `${role} must be supplied as PDF in this workflow.`);
    if (file.byteLength === 0 || file.byteLength > 650000000) add("file_size", "error", `${role} must be nonempty and no larger than the conservatively interpreted 650 MB limit.`);
    if (role === "interior" && file.pageCount !== value.profile.pageCount) add("pagination_changed", "error", "Measured interior page count differs from the count used for cover geometry.");
    if (role === "cover" && file.pageCount !== 1) add("cover_not_single_wrap", "error", "The cover must be one PDF page containing back, spine and front.", KDP_SOURCES.cover);
    const width = role === "interior" ? geometry.interiorWidthIn : geometry.coverWidthIn;
    const height = role === "interior" ? geometry.interiorHeightIn : geometry.coverHeightIn;
    if (Math.abs(file.widthIn - width) > 0.001 || Math.abs(file.heightIn - height) > 0.001) add("file_dimensions", "error", `${role} dimensions differ from the selected profile geometry.`, role === "cover" ? KDP_SOURCES.cover : KDP_SOURCES.margins);
    for (const [key, expected] of [["pagesHaveConsistentDimensions", true], ["fontsEmbedded", true], ["encrypted", false], ["transparencyFlattened", true], ["containsCropOrTrimMarks", false], ["containsAnnotationsOrBookmarks", false], ["containsPlaceholderOrCreationMarks", false]] as const) {
      if (file[key] === undefined) add("missing_pdf_inspection", "unknown", `${role}: ${key} has not been inspected.`);
      else if (file[key] !== expected) add("pdf_inspection_failure", "error", `${role}: ${key} does not satisfy this workflow.`);
    }
    if (role === "interior") {
      if (file.singlePages === undefined) add("missing_page_layout_inspection", "unknown", "Interior single-page layout has not been inspected.");
      else if (!file.singlePages) add("interior_spreads", "error", "Interior files must use individual pages rather than spreads.");
    }
    if (file.minimumFontSizePt === undefined) add("missing_font_size_inspection", "unknown", `${role}: minimum font size has not been inspected.`);
    else if (file.minimumFontSizePt < 7) add("font_too_small", "error", `${role}: text is below KDP's 7 point minimum.`);
  }
  if (value.interior && value.cover && value.interior.fileId === value.cover.fileId) add("same_interior_and_cover", "error", "Interior and complete wrap cover must be separate files.");
  if (!value.imagePlacementInventoryComplete) add("uninspected_image_inventory", "unknown", "All actual placed raster images need pixel and physical-size measurements.", KDP_SOURCES.images);
  value.imagePlacements.forEach((image) => {
    const dpi = effectiveImageDpi(image);
    if (!dpi.meets300Dpi) add("image_resolution", "error", `Image ${image.assetId} has ${dpi.minimum.toFixed(1)} effective DPI after placement/crop; at least 300 is required.`, KDP_SOURCES.images);
    else if (dpi.minimum > 600) add("large_image_resolution", "warning", `Image ${image.assetId} exceeds the suggested 600 DPI optimization target; consider file size.`, KDP_SOURCES.submission);
  });
  if (value.includesSpineText) {
    if (!geometry.spineTextAllowed) add("spine_text_page_count", "error", "Use spine text only with at least 80 effective pages.", KDP_SOURCES.cover);
    if (value.spineTextInsetIn === undefined) add("spine_text_unmeasured", "unknown", "Spine text inset needs an actual measurement.", KDP_SOURCES.cover);
    else if (value.spineTextInsetIn < 0.0625) add("spine_text_inset", "error", "Spine text needs at least 0.0625 inch clearance on either side.", KDP_SOURCES.cover);
  }
  if (value.coverTextEdgeDistanceIn === undefined) add("cover_safe_area_unmeasured", "unknown", "Cover text safe-area clearance has not been measured.", KDP_SOURCES.cover);
  else if (value.coverTextEdgeDistanceIn < 0.25) add("cover_safe_area", "error", "Cover text needs at least 0.25 inch distance from the file outer edges including bleed.", KDP_SOURCES.submission);
  const template = value.officialCoverTemplate;
  if (!template) add("official_template_unchecked", "unknown", "Reconcile the final cover with KDP's official calculator/template; colour-spine guidance differs between help pages.", KDP_SOURCES.calculator);
  else if (template.effectivePageCount !== geometry.effectivePageCount || Math.abs(template.widthIn - geometry.coverWidthIn) > 0.001 || Math.abs(template.heightIn - geometry.coverHeightIn) > 0.001 || Math.abs(template.spineWidthIn - geometry.spineWidthIn) > 0.001) add("official_template_mismatch", "error", "Official template dimensions/count differ from computed geometry; resolve before release.", KDP_SOURCES.calculator);
  const disclosureRequired = value.aiGeneratedImages || value.aiGeneratedText || value.aiGeneratedTranslations;
  if (disclosureRequired) add("ai_content_disclosure", "warning", "KDP submission must disclose the applicable AI-generated images, text or translations, even if subsequently edited.", KDP_SOURCES.aiDisclosure);
  return { ruleVersion: KDP_RULE_VERSION, sourceCheckedDate: KDP_SOURCE_CHECKED_DATE, status: findings.some((finding) => finding.severity === "error") ? "failed" as const : findings.some((finding) => finding.severity === "unknown") ? "incomplete" as const : "passed_metadata" as const, renderedFilesVerified: false as const, amazonAcceptance: false as const, geometry, findings, disclosureRequired };
}

/** Connects a BookSpec edition to this specific supported profile without widening it. */
export function printProfileFromBook(book: BookSpec, editionId: string, actualPageCount: number): KdpPaperbackProfile {
  const edition = book.editions.find((item) => item.id === editionId);
  if (!edition || edition.type !== "print") throw new Error("The selected book edition is not a print edition.");
  return KdpPaperbackProfileSchema.parse({ ruleVersion: edition.ruleVersion, binding: edition.binding, trimWidthIn: edition.trimWidthIn, trimHeightIn: edition.trimHeightIn, bleed: edition.bleed, ink: edition.ink, paper: edition.paper, pageCount: actualPageCount, readingDirection: "ltr" });
}
