import { BUILDER_ATTACHMENT_LIMITS, prepareBuilderAttachments, type BuilderAttachment } from "../builder/attachments";
import type { Attachment } from "../attachments";
import { SourceInspectionSchema, type SourceInspection } from "./record";
import { INGESTED_MEDIA_TYPES, INGEST_REQUEST_LIMITS, type BuilderSource, type IngestedAttachment } from "./request";

/** Browser side of source ingestion: which files go through the pipeline, the pre-Send
 * inspection call, and the large-file upload that turns a file into a storage reference. */

export type IngestCapabilities = { enabled: boolean; formats: string[]; inlineBytes: number; referenceBytes: number };
const DISABLED: IngestCapabilities = { enabled: false, formats: [], inlineBytes: BUILDER_ATTACHMENT_LIMITS.fileBytes, referenceBytes: 0 };
let capabilities: Promise<IngestCapabilities> | null = null;
/** Fetched once per page; any failure means "not available" (the existing behaviour). */
export function ingestCapabilities(): Promise<IngestCapabilities> {
  capabilities ??= fetch("/api/build/sources", { cache: "no-store" }).then(async response => {
    if (!response.ok) return DISABLED;
    const value = await response.json() as Partial<IngestCapabilities>;
    return value.enabled === true ? { enabled: true, formats: Array.isArray(value.formats) ? value.formats : [], inlineBytes: Number(value.inlineBytes) || DISABLED.inlineBytes, referenceBytes: Number(value.referenceBytes) || 0 } : DISABLED;
  }).catch(() => DISABLED);
  return capabilities;
}

const EXTENSION_TYPES: Record<string, string> = { docx: INGESTED_MEDIA_TYPES.docx, docm: INGESTED_MEDIA_TYPES.docx, pptx: INGESTED_MEDIA_TYPES.pptx, pptm: INGESTED_MEDIA_TYPES.pptx, xlsx: INGESTED_MEDIA_TYPES.xlsx, xlsm: INGESTED_MEDIA_TYPES.xlsx, csv: INGESTED_MEDIA_TYPES.csv, tsv: INGESTED_MEDIA_TYPES.csv };
/** The ingested media type a file claims by its name or declared type (the server checks the bytes). */
export function ingestedMediaType(name: string, type: string): string | null {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (EXTENSION_TYPES[extension]) return EXTENSION_TYPES[extension];
  const declared = type.toLowerCase().split(";")[0].trim();
  return (Object.values(INGESTED_MEDIA_TYPES) as string[]).includes(declared) ? declared : declared === "text/tab-separated-values" ? INGESTED_MEDIA_TYPES.csv : null;
}
export const INGEST_ACCEPT = ".docx,.pptx,.xlsx,.csv,.tsv";

export async function inspectSourceFile(file: Pick<Attachment, "name" | "type" | "blob">, mediaType: string): Promise<SourceInspection> {
  const response = await fetch("/api/build/sources", { method: "POST", body: file.blob, headers: { "Content-Type": mediaType, "X-Source-Name": encodeURIComponent(file.name) }, cache: "no-store" });
  const value = await response.json().catch(() => null) as { inspection?: unknown; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(value?.error?.message ?? "This file couldn’t be checked right now. Retry reads the same saved file again.");
  return SourceInspectionSchema.parse(value?.inspection);
}

async function sha256(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
}
export type UploadTarget = { workspaceId: string; artifactId: string; accountHeader?: Record<string, string> };
/** Uploads one large file to the project's private storage (exact server-named path, never overwriting),
 * registers it, and returns the reference plus the server's inspection of the stored bytes. */
export async function uploadSourceReference(file: Attachment, mediaType: string, target: UploadTarget, upload: (objectPath: string, blob: Blob, contentType: string) => Promise<{ error: { message: string } | null }>) {
  if (file.blob.size > INGEST_REQUEST_LIMITS.referenceFileBytes) throw new Error(`${file.name}: each stored AI source file can be up to 25 MB.`);
  const digest = await sha256(file.blob);
  const url = `/api/cloud/workspaces/${target.workspaceId}/artifacts/${target.artifactId}/sources`;
  const call = async (action: "prepare" | "register") => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...target.accountHeader }, body: JSON.stringify({ action, sha256: digest, bytes: file.blob.size, mediaType, name: file.name.slice(0, 255) }) });
    const value = await response.json().catch(() => null) as Record<string, unknown> & { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(`${file.name}: ${value?.error?.message ?? "the file couldn’t be stored for AI. Retry."}`);
    return value ?? {};
  };
  const prepared = await call("prepare") as { objectPath?: string; registered?: boolean };
  if (!prepared.registered) {
    if (typeof prepared.objectPath !== "string") throw new Error(`${file.name}: the file couldn’t be stored for AI. Retry.`);
    const stored = await upload(prepared.objectPath, file.blob, mediaType);
    // An earlier interrupted attempt may already have stored the same bytes at this path.
    if (stored.error && !/exists|duplicate/i.test(stored.error.message)) throw new Error(`${file.name}: the upload didn’t finish (${stored.error.message}). Retry.`);
  }
  const registered = await call("register") as { reference?: { assetId: string; sha256: string; bytes: number }; inspection?: unknown };
  return { reference: registered.reference!, inspection: SourceInspectionSchema.parse(registered.inspection) };
}

export type PrepareSourcesOptions = {
  /** Uploads files over the inline limit; absent outside a project (those files are refused instead). */
  storeLarge?: (file: Attachment, mediaType: string) => Promise<{ reference: { assetId: string; sha256: string; bytes: number }; inspection: SourceInspection }>;
};
/** Existing image/PDF/text files are prepared exactly as before; Office/CSV files go inline when
 * small and by storage reference when large; large PDFs by reference. All-or-nothing, in order. */
export async function prepareBuilderSources(files: readonly Attachment[], options: PrepareSourcesOptions = {}): Promise<BuilderSource[]> {
  if (files.length > INGEST_REQUEST_LIMITS.count) throw new Error("AI can read up to five source files per request. Remove extra files before sending.");
  const result: BuilderSource[] = [];
  let inline = 0;
  for (const file of files) {
    const ingested = ingestedMediaType(file.name, file.type);
    const large = file.blob.size > BUILDER_ATTACHMENT_LIMITS.fileBytes;
    const pdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (large && (ingested || pdf)) {
      if (!options.storeLarge) throw new Error(`${file.name}: files over 3 MB are stored in the project first. Open the project to send it.`);
      const stored = await options.storeLarge(file, ingested ?? "application/pdf");
      if (stored.inspection.status !== "complete") throw new Error(`${file.name}: ${stored.inspection.message} Remove it, or choose “Continue without it”.`);
      result.push({ name: file.name, mediaType: ingested ?? "application/pdf", reference: stored.reference } as IngestedAttachment);
      continue;
    }
    inline += file.blob.size;
    if (inline > INGEST_REQUEST_LIMITS.inlineTotalBytes) throw new Error("Keep AI source files under 3 MB (3,000,000 bytes) combined, or send larger files one at a time from the project.");
    if (ingested) {
      let binary = "";
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
      result.push(Object.freeze({ name: file.name, mediaType: ingested, data: btoa(binary) }) as IngestedAttachment);
    } else result.push(...await prepareBuilderAttachments([file]));
  }
  return result;
}
/** Field order fixed for the operation fingerprint. */
export function builderSourceWire(file: BuilderSource): BuilderSource {
  if ("reference" in file) return { name: file.name, mediaType: file.mediaType, reference: { assetId: file.reference.assetId, sha256: file.reference.sha256, bytes: file.reference.bytes } } as IngestedAttachment;
  return { name: file.name, mediaType: file.mediaType, data: file.data } as BuilderAttachment;
}
