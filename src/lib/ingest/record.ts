import { z } from "zod";

/** Must equal EXTRACTION_VERSION in parsers/common.cjs; the host refuses any other version. */
export const EXTRACTION_VERSION = "ingest-2026-10-23.1";

export const SOURCE_FORMATS = ["docx", "pptx", "xlsx", "csv", "pdf", "text", "markdown", "png", "jpeg", "webp", "gif", "office", "legacy", "unknown"] as const;
export type SourceFormat = typeof SOURCE_FORMATS[number];
export const EXTRACTION_STATUSES = ["complete", "partial", "failed", "unsupported", "encrypted"] as const;
export type ExtractionStatus = typeof EXTRACTION_STATUSES[number];

const short = z.string().max(2_000);
const label = z.string().max(500);
const CellValueSchema = z.object({
  text: z.string().max(100_000), number: z.number().finite().optional(), unit: z.string().max(8).optional(),
  currency: z.string().max(8).optional(), date: z.string().max(32).optional(), ambiguous: z.enum(["number", "date"]).optional(),
}).strict();
const TableSchema = z.object({ id: z.string().max(32), source: label, headerRows: z.number().int().min(0).max(1000), rows: z.array(z.array(CellValueSchema).max(2_000)).max(50_000) }).strict();
const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(6), text: z.string().max(200_000), location: label.optional() }).strict(),
  z.object({ type: z.literal("paragraph"), text: z.string().max(200_000), list: z.number().int().min(1).max(10).optional(), location: label.optional() }).strict(),
  z.object({ type: z.literal("note"), label, text: z.string().max(200_000), location: label.optional() }).strict(),
  z.object({ type: z.literal("table"), table: z.string().max(32), location: label.optional() }).strict(),
  z.object({ type: z.literal("image"), image: z.string().max(32), location: label.optional() }).strict(),
]);
export const SheetCellSchema = z.object({
  ref: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/), row: z.number().int().min(0), col: z.number().int().min(0),
  kind: z.enum(["string", "number", "date", "percent", "currency", "boolean", "error", "empty"]),
  value: z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()]), text: z.string().max(100_000),
  formula: z.string().max(10_000).optional(), formulaLike: z.literal(true).optional(), numFmt: z.string().max(500).optional(),
  number: z.number().finite().optional(), currency: z.string().max(16).optional(), unit: z.string().max(8).optional(), date: z.string().max(32).optional(),
}).strict();
const SheetSchema = z.object({
  name: z.string().max(500), index: z.number().int().min(1), hidden: z.boolean(), kind: z.literal("chart").optional(),
  rows: z.number().int().min(0), columns: z.number().int().min(0), cells: z.array(SheetCellSchema).max(200_000),
  cellsTotal: z.number().int().min(0), truncated: z.boolean(), error: short.optional(),
}).strict();
const SlideSchema = z.object({
  index: z.number().int().min(1), title: z.string().max(10_000), hidden: z.boolean(), body: z.array(z.string().max(200_000)).max(10_000),
  notes: z.string().max(200_000), tables: z.array(z.string().max(32)).max(1000), images: z.array(z.string().max(32)).max(100), error: short.optional(),
}).strict();
const ImageSchema = z.object({
  id: z.string().max(32), part: z.string().max(1024), mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000), bytes: z.number().int().min(1).max(3_750_000),
  data: z.string().max(5_000_000), locations: z.array(label).max(200),
}).strict();
const UnsupportedSchema = z.object({ kind: z.string().max(40), count: z.number().int().min(0), detail: short }).strict();
export const CoverageSchema = z.object({
  unit: z.enum(["pages", "slides", "sheets", "paragraphs", "rows", "characters", "image"]),
  total: z.number().int().min(0), read: z.number().int().min(0),
  cells: z.object({ total: z.number().int().min(0), read: z.number().int().min(0) }).strict().optional(),
  /** native: AI views pages/pictures itself; not-rendered: slides/pages were not turned into pictures; none: no visual content. */
  visual: z.enum(["native", "not-rendered", "none"]),
  notes: z.array(short).max(10),
}).strict();

/** What the worker returns (before the host adds the source hash). */
export const WorkerRecordSchema = z.object({
  extractionVersion: z.literal(EXTRACTION_VERSION), bytes: z.number().int().min(0), format: z.enum(SOURCE_FORMATS),
  status: z.enum(EXTRACTION_STATUSES), problem: z.string().max(40).optional(), message: short,
  coverage: CoverageSchema.nullable().default(null), text: z.string().max(600_000).default(""),
  blocks: z.array(BlockSchema).max(200_000).default([]), tables: z.array(TableSchema).max(5_000).default([]),
  slides: z.array(SlideSchema).max(200).default([]), sheets: z.array(SheetSchema).max(50).default([]),
  images: z.array(ImageSchema).max(12).default([]), warnings: z.array(short).max(50).default([]),
  unsupported: z.array(UnsupportedSchema).max(50).default([]), details: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type ExtractionRecord = z.output<typeof WorkerRecordSchema> & { sourceSha256: string };
export type SheetCell = z.output<typeof SheetCellSchema>;
export type ExtractionSheet = ExtractionRecord["sheets"][number];
export type SourceCoverage = z.output<typeof CoverageSchema>;

/** The thin reference a task envelope keeps for a source: identity, version and outcome, never content. */
export type IngestionReference = { sourceId: string; sha256: string; extractionVersion: string; format: SourceFormat; status: ExtractionStatus };
export function ingestionReference(record: ExtractionRecord, sourceId: string): IngestionReference {
  return { sourceId, sha256: record.sourceSha256, extractionVersion: record.extractionVersion, format: record.format, status: record.status };
}

/** What the browser is shown before Send: coverage and findings, no extracted content. */
export const SourceInspectionSchema = z.object({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), extractionVersion: z.string().max(64), format: z.enum(SOURCE_FORMATS), bytes: z.number().int().min(0),
  status: z.enum(EXTRACTION_STATUSES), problem: z.string().max(40).optional(), message: short,
  coverage: CoverageSchema.nullable(), warnings: z.array(short).max(50), unsupported: z.array(UnsupportedSchema).max(50),
  counts: z.object({ tables: z.number().int().min(0), images: z.number().int().min(0), slides: z.number().int().min(0), sheets: z.number().int().min(0), characters: z.number().int().min(0) }).strict(),
  details: z.object({ pages: z.number().int().min(0).optional(), textLayer: z.enum(["present", "absent", "unknown"]).optional() }).strict(),
}).strict();
export type SourceInspection = z.output<typeof SourceInspectionSchema>;
export function inspectionOf(record: ExtractionRecord): SourceInspection {
  const pdf = record.details.pdf as { pages?: number; textLayer?: "present" | "absent" | "unknown" } | undefined;
  return {
    sourceSha256: record.sourceSha256, extractionVersion: record.extractionVersion, format: record.format, bytes: record.bytes,
    status: record.status, ...(record.problem ? { problem: record.problem } : {}), message: record.message, coverage: record.coverage,
    warnings: record.warnings, unsupported: record.unsupported,
    counts: { tables: record.tables.length, images: record.images.length, slides: record.slides.length, sheets: record.sheets.length, characters: record.text.length },
    details: pdf ? { ...(typeof pdf.pages === "number" ? { pages: pdf.pages } : {}), ...(pdf.textLayer ? { textLayer: pdf.textLayer } : {}) } : {},
  };
}

const count = (value: number, unit: string) => `${value.toLocaleString("en-US")} ${unit}${value === 1 ? "" : "s"}`;
/** One customer-facing sentence about what was read. */
export function coverageSentence(inspection: Pick<SourceInspection, "coverage" | "counts" | "details" | "format">): string {
  const coverage = inspection.coverage;
  if (!coverage) return "";
  const unit = coverage.unit === "image" ? "picture" : coverage.unit.replace(/s$/, "");
  const parts = [coverage.unit === "image" ? "The picture is viewed by AI" : `${coverage.read.toLocaleString("en-US")} of ${count(coverage.total, unit)} read`];
  if (coverage.cells) parts.push(`${coverage.cells.read.toLocaleString("en-US")} of ${count(coverage.cells.total, "cell")}`);
  if (inspection.counts.tables) parts.push(count(inspection.counts.tables, "table"));
  if (inspection.counts.images) parts.push(`${count(inspection.counts.images, "embedded picture")} shown to AI`);
  return `${parts.join(" · ")}.${coverage.notes.length ? ` ${coverage.notes.join(" ")}` : ""}`;
}
