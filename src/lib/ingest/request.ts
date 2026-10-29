import { z } from "zod";
import { BUILDER_ATTACHMENT_LIMITS, BuilderAttachmentSchema, type BuilderAttachment } from "../builder/attachments";

/** Formats read through the ingestion pipeline (server-side extraction in an isolated worker). */
export const INGESTED_MEDIA_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
} as const;
export type IngestedFormat = keyof typeof INGESTED_MEDIA_TYPES;
const ingestedTypes = Object.values(INGESTED_MEDIA_TYPES) as [string, ...string[]];
/** PDFs over the inline limit travel as storage references too. */
const referenceTypes = [...ingestedTypes, "application/pdf"] as [string, ...string[]];

export const INGEST_REQUEST_LIMITS = {
  /** Readable files per request, as today. */
  count: BUILDER_ATTACHMENT_LIMITS.count,
  /** Inline bytes (base64 in the request body) stay within the existing 3 MB combined limit. */
  inlineTotalBytes: BUILDER_ATTACHMENT_LIMITS.totalBytes,
  /** Larger files are uploaded to the project's private storage and referenced by id. */
  referenceFileBytes: 25 * 1024 * 1024, referenceTotalBytes: 60 * 1024 * 1024,
  omitted: 20,
};

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalBase64 = (data: string) => data.length > 0 && data.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data);
export const decodedLength = (data: string) => data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

export const SourceReferenceSchema = z.object({ assetId: z.string().uuid(), sha256, bytes: z.number().int().positive().max(INGEST_REQUEST_LIMITS.referenceFileBytes) }).strict();
export type SourceReference = z.output<typeof SourceReferenceSchema>;
/** An Office/CSV file inline (small) or any ingested format by storage reference (large). */
export const IngestedAttachmentSchema = z.union([
  z.object({ name: z.string().min(1).max(255), mediaType: z.enum(ingestedTypes), data: z.string().max(4_000_000).refine(canonicalBase64, "The file encoding is invalid.") }).strict()
    .refine(file => decodedLength(file.data) <= BUILDER_ATTACHMENT_LIMITS.fileBytes, "Each inline AI source file can be up to 3 MB."),
  z.object({ name: z.string().min(1).max(255), mediaType: z.enum(referenceTypes), reference: SourceReferenceSchema }).strict(),
]);
export type IngestedAttachment = z.output<typeof IngestedAttachmentSchema>;
export type BuilderSource = BuilderAttachment | IngestedAttachment;
export const isIngested = (file: BuilderSource): file is IngestedAttachment => "reference" in file || (ingestedTypes as string[]).includes(file.mediaType);

/** The existing attachment list, extended with ingested files. Existing entries are validated exactly as before. */
export const BuilderSourcesSchema = z.array(z.union([BuilderAttachmentSchema, IngestedAttachmentSchema])).max(INGEST_REQUEST_LIMITS.count).superRefine((files, context) => {
  const inline = files.reduce((sum, file) => sum + ("data" in file ? decodedLength(file.data) : 0), 0);
  if (inline > INGEST_REQUEST_LIMITS.inlineTotalBytes) context.addIssue({ code: "custom", message: "Keep AI source files under 3 MB (3,000,000 bytes) combined." });
  const referenced = files.reduce((sum, file) => sum + ("reference" in file ? file.reference.bytes : 0), 0);
  if (referenced > INGEST_REQUEST_LIMITS.referenceTotalBytes) context.addIssue({ code: "custom", message: "Keep stored AI source files under 60 MB combined." });
});

/** Files the user explicitly chose to continue without (never decided automatically). */
export const OmittedSourceSchema = z.object({ name: z.string().min(1).max(255), reason: z.enum(["left-out", "unreadable", "partial"]) }).strict();
export const OmittedSourcesSchema = z.array(OmittedSourceSchema).max(INGEST_REQUEST_LIMITS.omitted);
