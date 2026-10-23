import { BUILDER_ATTACHMENT_LIMITS, BUILDER_SOURCE_TYPES_LABEL, BuilderSourceError, builderSourceMediaType, checkBuilderSourceBytes, type BuilderMediaType } from "./attachments";
import type { Attachment } from "../attachments";
import { coverageSentence, type SourceInspection } from "../ingest/record";
import { ingestedMediaType } from "../ingest/client";
import { INGEST_REQUEST_LIMITS } from "../ingest/request";

/** What happens to one saved file when the user presses Send.
 * ready: AI reads it with this request. local-only: kept, deliberately not sent (left out, or a duplicate).
 * unsupported: a type AI cannot read. too-large: over a per-file, text, count or combined limit (never trimmed).
 * failed: the bytes could not be read or are damaged; Retry re-reads the same saved copy.
 * partial: the source-ingestion check found that only part of the file can be read (cells,
 * slides or pages over a limit, a damaged sheet). It is never sent as if complete.
 * checking is transient: Send waits until every file has a final state.
 * Without the ingestion check (no inspector, or the server switch off) text is never trimmed and
 * AI returns no page-by-page report for PDFs or images, so ready PDFs say so instead of implying
 * every page was read. With the check, Office/CSV/PDF files show their measured coverage. */
export type SourceState = "ready" | "local-only" | "unsupported" | "too-large" | "failed" | "partial" | "checking";
/** Facts about one stored file on its own, independent of the rest of the selection. */
export type SourceAnalysis =
  | { kind: "readable"; mediaType: BuilderMediaType; bytes: number; digest: string; inspection?: SourceInspection }
  /** Office/CSV (inline, inspected) or a large Office/CSV/PDF file stored by reference when sent (inspected then). */
  | { kind: "ingested"; sourceType: string; bytes: number; digest: string; transport: "inline" | "reference"; inspection: SourceInspection | null }
  | { kind: "incomplete"; sourceType: string; bytes: number; inspection: SourceInspection }
  | { kind: "unsupported"; typeLabel: string }
  | { kind: "file-too-large"; bytes: number; limit?: number }
  | { kind: "text-too-long"; characters: number }
  | { kind: "failed"; reason: string; readError: boolean };
export type SourceEntry = {
  file: Attachment; state: SourceState; label: string; reason: string;
  mediaType?: BuilderMediaType; duplicateOf?: string; excluded: boolean;
  /** A read error the user has not seen resolved; Send stops until Retry or Leave out. */
  blocking: boolean;
  /** Ingested files: the declared source type and how it travels. */
  sourceType?: string; transport?: "inline" | "reference";
  /** Reading notes and content that was not read (shown under the file). */
  details?: string[];
  /** For a left-out file: the state it had before (so the request can record why it was left out). */
  priorState?: SourceState;
};
export type SourceReadiness = {
  entries: SourceEntry[];
  /** Exactly the stored files bound to the request, in order. */
  ready: Attachment[];
  checking: boolean; blocking: SourceEntry[];
  readSummary: string; skippedSummary: string;
};
/** The server-side ingestion check, injected by the browser hook; absent = existing behaviour. */
export type SourceInspector = {
  capabilities(): Promise<{ enabled: boolean; referenceBytes: number }>;
  inspect(file: Attachment, mediaType: string): Promise<SourceInspection>;
};

export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  ready: "Will be read by AI", "local-only": "Saved · not sent", unsupported: "AI can’t read this type",
  "too-large": "Over the AI limit", failed: "Couldn’t be read", partial: "Only partly readable", checking: "Checking…",
};
const SHORT: Record<SourceState, string> = {
  ready: "read", "local-only": "not sent", unsupported: "type AI can’t read", "too-large": "over the limit", failed: "couldn’t be read", partial: "only partly readable", checking: "checking",
};

/** Honest limit: no per-page result comes back, so partial reading can't be shown. */
export const PDF_PAGES_NOTE = "The whole PDF is sent, but Makeborne doesn’t receive a page-by-page report, so it can’t show whether a page (such as a scan or a chart) was only partly understood. Mention the pages that matter in your message.";
const number = (value: number) => value.toLocaleString("en-US");
const count = (value: number, unit: string) => `${number(value)} ${unit}${value === 1 ? "" : "s"}`;
const extension = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const NAMED_TYPES: Record<string, string> = {
  csv: "CSV spreadsheets", tsv: "TSV spreadsheets", xlsx: "Excel spreadsheets", xls: "Excel spreadsheets", ods: "Spreadsheets",
  docx: "Word documents", doc: "Word documents", odt: "Text documents", rtf: "RTF documents", pages: "Pages documents",
  pptx: "PowerPoint presentations", ppt: "PowerPoint presentations", odp: "Presentations", key: "Keynote presentations",
  svg: "SVG images", heic: "HEIC photos", heif: "HEIF photos", tif: "TIFF images", tiff: "TIFF images", bmp: "BMP images", avif: "AVIF images",
  zip: "Archives", rar: "Archives", "7z": "Archives", gz: "Archives", tar: "Archives",
  json: "JSON files", html: "HTML files", htm: "HTML files", xml: "XML files", js: "Code files", ts: "Code files", css: "Code files",
  mp4: "Videos", mov: "Videos", webm: "Videos", mp3: "Audio files", wav: "Audio files", m4a: "Audio files",
};
function typeLabel(name: string, type: string) {
  const ext = extension(name);
  if (NAMED_TYPES[ext]) return NAMED_TYPES[ext];
  if (ext) return `.${ext.toUpperCase()} files`;
  return type && type !== "application/octet-stream" ? `${type} files` : "Files of this type";
}
const CLAIMED: Record<string, string> = { png: "PNG", jpg: "JPEG", jpeg: "JPEG", webp: "WebP", gif: "GIF", pdf: "PDF",
  "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "image/gif": "GIF", "application/pdf": "PDF" };

async function digest(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return Array.from(new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource)), byte => byte.toString(16).padStart(2, "0")).join("");
  // Insecure-context fallback (no SubtleCrypto): FNV-1a over every byte, prefixed by the length.
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv:${bytes.length}:${hash.toString(16)}`;
}

const isPdfClaim = (file: Attachment) => extension(file.name) === "pdf" || file.type === "application/pdf";
const checkFailed = (error: unknown): SourceAnalysis => ({ kind: "failed", readError: true, reason: error instanceof Error ? error.message : "This file couldn’t be checked right now. Retry reads the same saved file again." });

/** Reads one immutable stored file with the same rules the route schema enforces.
 * Never trims or rewrites: an over-limit text file is reported, not shortened.
 * With an inspector (and the server switch on), Office/CSV files and PDFs are also checked by
 * the server's isolated parser, and large Office/CSV/PDF files become storage references. */
export async function analyzeSource(file: Attachment, inspector?: SourceInspector): Promise<SourceAnalysis> {
  const ingested = inspector ? ingestedMediaType(file.name, file.type) : null;
  const capabilities = inspector && (ingested || isPdfClaim(file)) ? await inspector.capabilities().catch(() => ({ enabled: false, referenceBytes: 0 })) : null;
  if (inspector && capabilities?.enabled && (ingested || isPdfClaim(file)) && file.blob.size > BUILDER_ATTACHMENT_LIMITS.fileBytes) {
    if (file.blob.size > capabilities.referenceBytes) return { kind: "file-too-large", bytes: file.blob.size, limit: capabilities.referenceBytes };
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.blob.arrayBuffer()); }
    catch { return { kind: "failed", readError: true, reason: "This browser couldn’t read the saved copy. Retry reads the same saved file again." }; }
    return { kind: "ingested", sourceType: ingested ?? "application/pdf", bytes: bytes.length, digest: await digest(bytes), transport: "reference", inspection: null };
  }
  if (inspector && capabilities?.enabled && ingested) {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.blob.arrayBuffer()); }
    catch { return { kind: "failed", readError: true, reason: "This browser couldn’t read the saved copy. Retry reads the same saved file again." }; }
    if (!bytes.length) return { kind: "failed", readError: false, reason: "This file is empty." };
    let inspection: SourceInspection;
    try { inspection = await inspector.inspect(file, ingested); }
    catch (error) { return checkFailed(error); }
    if (inspection.status !== "complete") return { kind: "incomplete", sourceType: ingested, bytes: bytes.length, inspection };
    return { kind: "ingested", sourceType: ingested, bytes: bytes.length, digest: await digest(bytes), transport: "inline", inspection };
  }
  // Matches prepareBuilderAttachments: the per-file size is refused before reading.
  if (file.blob.size > BUILDER_ATTACHMENT_LIMITS.fileBytes) return { kind: "file-too-large", bytes: file.blob.size };
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.blob.arrayBuffer()); }
  catch { return { kind: "failed", readError: true, reason: "This browser couldn’t read the saved copy. Retry reads the same saved file again." }; }
  const mediaType = builderSourceMediaType(bytes, file.name, file.type);
  if (!mediaType) {
    const claimed = CLAIMED[extension(file.name)] ?? CLAIMED[file.type];
    if (claimed && bytes.length) return { kind: "failed", readError: false, reason: `Its contents aren’t a valid ${claimed} file, so AI can’t read it. The file may be damaged or renamed.` };
    if (!bytes.length) return { kind: "failed", readError: false, reason: "This file is empty." };
    return { kind: "unsupported", typeLabel: typeLabel(file.name, file.type) };
  }
  try { checkBuilderSourceBytes(bytes, mediaType); }
  catch (error) {
    if (!(error instanceof BuilderSourceError)) return { kind: "failed", readError: false, reason: "This file couldn’t be checked." };
    if (error.problem === "text-too-long") return { kind: "text-too-long", characters: error.characters ?? 0 };
    if (error.problem === "file-too-large") return { kind: "file-too-large", bytes: bytes.length };
    if (error.problem === "signature") return { kind: "failed", readError: false, reason: "Its contents don’t match its image or PDF type. The file may be damaged or renamed." };
    return { kind: "failed", readError: false, reason: error.problem === "encoding" ? "This text isn’t UTF-8, so AI can’t read it. Save it as UTF-8 text and attach that copy."
      : error.problem === "binary" ? "This text file contains binary data. Save it as plain UTF-8 text and attach that copy." : error.message };
  }
  if (mediaType === "application/pdf" && inspector && capabilities?.enabled) {
    let inspection: SourceInspection;
    try { inspection = await inspector.inspect(file, mediaType); }
    catch (error) { return checkFailed(error); }
    if (inspection.status !== "complete") return { kind: "incomplete", sourceType: mediaType, bytes: bytes.length, inspection };
    return { kind: "readable", mediaType, bytes: bytes.length, digest: await digest(bytes), inspection };
  }
  return { kind: "readable", mediaType, bytes: bytes.length, digest: await digest(bytes) };
}

/** What the ingestion check found, as short lines for the file's card. */
function inspectionDetails(inspection: SourceInspection | null | undefined): string[] {
  if (!inspection) return [];
  return [...inspection.warnings, ...inspection.unsupported.map(item => item.detail)].slice(0, 12);
}
function inspectedNote(inspection: SourceInspection) {
  if (inspection.format === "pdf") {
    const pages = inspection.details.pages;
    return `${pages ? `${count(pages, "page")}, all sent to AI. ` : ""}${inspection.coverage?.notes.join(" ") ?? ""}`.trim();
  }
  return coverageSentence(inspection);
}
const priorStateOf = (analysis: SourceAnalysis | undefined): SourceState | undefined => !analysis ? undefined
  : analysis.kind === "readable" || analysis.kind === "ingested" ? "ready"
    : analysis.kind === "incomplete" ? (analysis.inspection.status === "partial" ? "partial" : analysis.inspection.status === "unsupported" ? "unsupported" : "failed")
      : analysis.kind === "unsupported" ? "unsupported" : analysis.kind === "failed" ? "failed" : "too-large";

const limits = BUILDER_ATTACHMENT_LIMITS;
/** Pure: decides every file's state from analyses, in selection order. The ready set obeys
 * the same count, per-file and combined bounds as the server, so it is never refused for size. */
export function decideSources(files: readonly Attachment[], analyses: ReadonlyMap<string, SourceAnalysis>, excluded: ReadonlySet<string> = new Set()): SourceReadiness {
  const seen = new Map<string, Attachment>(), names = new Map<string, number>();
  const entries: SourceEntry[] = [], ready: Attachment[] = [];
  let total = 0, stored = 0;
  for (const file of files) {
    const analysis = analyses.get(file.id);
    const entry = (state: SourceState, reason: string, extra: Partial<SourceEntry> = {}): SourceEntry =>
      ({ file, state, label: SOURCE_STATE_LABELS[state], reason, excluded: excluded.has(file.id), blocking: false, ...extra });
    if (excluded.has(file.id)) { const prior = priorStateOf(analysis); entries.push(entry("local-only", "Left out of this request. The file stays saved on this device; choose Include to send it.", prior ? { priorState: prior } : {})); continue; }
    if (!analysis) { entries.push(entry("checking", "Checking whether AI can read this file…")); continue; }
    if (analysis.kind === "unsupported") { entries.push(entry("unsupported", `${analysis.typeLabel} can’t be read by AI. AI reads ${BUILDER_SOURCE_TYPES_LABEL}. It stays saved on this device; export it as PDF or paste its text into a .txt file to include it.`)); continue; }
    if (analysis.kind === "failed") { entries.push(entry("failed", analysis.reason, { blocking: analysis.readError })); continue; }
    if (analysis.kind === "incomplete") {
      const status = analysis.inspection.status;
      const state: SourceState = status === "partial" ? "partial" : status === "unsupported" ? "unsupported" : "failed";
      const coverage = analysis.inspection.coverage ? ` ${coverageSentence(analysis.inspection)}` : "";
      entries.push(entry(state, `${analysis.inspection.message}${coverage} Generation that depends on it is stopped: remove it, or choose “Continue without it”.`,
        { blocking: true, sourceType: analysis.sourceType, details: inspectionDetails(analysis.inspection) }));
      continue;
    }
    if (analysis.kind === "file-too-large") {
      const max = analysis.limit ?? limits.fileBytes;
      const size = analysis.limit ? `${Math.round(max / 1024 / 1024)} MB` : `${max / 1_000_000} MB`;
      entries.push(entry("too-large", `This file is ${count(analysis.bytes, "byte")}. Each AI source file can be up to ${size} (${number(max)} bytes), so it is ${count(analysis.bytes - max, "byte")} over. It isn’t trimmed or sent; use a smaller copy.`));
      continue;
    }
    if (analysis.kind === "text-too-long") { entries.push(entry("too-large", `${number(analysis.characters)} characters. Text files can contain up to ${number(limits.textCharacters)} characters, so this is ${count(analysis.characters - limits.textCharacters, "character")} over. It isn’t trimmed or sent; split it into smaller files.`)); continue; }
    const mediaType = analysis.kind === "readable" ? analysis.mediaType : undefined;
    const typed = analysis.kind === "ingested" ? { sourceType: analysis.sourceType, transport: analysis.transport } : {};
    const key = `${file.name}\u0000${analysis.bytes}\u0000${analysis.digest}`;
    const original = seen.get(key);
    if (original) { entries.push(entry("local-only", `Same name, size and contents as another ${file.name} in this list. AI reads it once.`, { duplicateOf: original.id, mediaType, ...typed })); continue; }
    seen.set(key, file);
    if (ready.length >= limits.count) { entries.push(entry("too-large", `AI reads up to ${limits.count} files per request and ${limits.count} are already included. Leave one out to include this file.`, { mediaType, ...typed })); continue; }
    const reference = analysis.kind === "ingested" && analysis.transport === "reference";
    if (reference) {
      if (stored + analysis.bytes > INGEST_REQUEST_LIMITS.referenceTotalBytes) {
        entries.push(entry("too-large", `Large files stored for AI are limited to ${INGEST_REQUEST_LIMITS.referenceTotalBytes / 1024 / 1024} MB combined per request. Leave another large file out to include this one.`, typed));
        continue;
      }
      stored += analysis.bytes;
    } else if (total + analysis.bytes > limits.totalBytes) {
      const after = total + analysis.bytes;
      entries.push(entry("too-large", `Adding this file (${count(analysis.bytes, "byte")}) would bring this request to ${count(after, "byte")}. AI files are limited to ${limits.totalBytes / 1_000_000} MB (${number(limits.totalBytes)} bytes) combined: ${count(after - limits.totalBytes, "byte")} over. Leave another file out to include it.`, { mediaType, ...typed }));
      continue;
    } else total += analysis.bytes;
    const sameName = names.get(file.name) ?? 0;
    names.set(file.name, sameName + 1);
    const lead = sameName ? "Shares a name with another file but its contents differ, so both are read." : "AI reads this file with your next request.";
    let note = "";
    if (reference) note = " It’s over 3 MB, so when you send it is stored privately in this project and checked there first; if it can’t be read completely, sending stops and you choose what to do.";
    else if (analysis.inspection) note = ` ${inspectedNote(analysis.inspection)}`;
    else if (mediaType === "application/pdf") note = ` ${PDF_PAGES_NOTE}`;
    entries.push(entry("ready", lead + note, { mediaType, ...typed, ...(analysis.inspection ? { details: inspectionDetails(analysis.inspection) } : {}) }));
    ready.push(file);
  }
  const skipped = entries.filter(item => item.state !== "ready" && item.state !== "checking");
  const checking = entries.some(item => item.state === "checking");
  return {
    entries, ready, checking, blocking: entries.filter(item => item.blocking),
    readSummary: checking ? "Checking which files AI can read…" : ready.length ? `Will be read: ${ready.map(file => file.name).join(", ")}` : "No files will be read by AI with this request.",
    skippedSummary: skipped.length ? `Not sent: ${skipped.map(item => `${item.file.name} (${SHORT[item.state]})`).join(", ")}` : "",
  };
}

/** An unreadable selection requires an explicit fix or Leave out decision before
 * any AI request, including automatic home-page handoff and tailored questions. */
export function sourceIntentIssue(report: SourceReadiness): string | null {
  if (report.checking) return "Wait for your source files to finish checking. Your message is kept.";
  const unresolved = report.entries.filter(entry => entry.state !== "ready" && !entry.excluded && !entry.duplicateOf);
  return unresolved.length
    ? `Resolve ${unresolved.map(entry => entry.file.name).join(", ")} before generation: retry, replace, or explicitly leave the file out. Your message is kept; this request has not started.`
    : null;
}

/** The request's record of files the user explicitly left out (with the state that led to it). */
export function omittedSources(report: SourceReadiness): { name: string; reason: "left-out" | "unreadable" | "partial" }[] {
  return report.entries.filter(entry => entry.excluded).map(entry => ({ name: entry.file.name.slice(0, 255),
    reason: entry.priorState === "partial" ? "partial" : entry.priorState && entry.priorState !== "ready" ? "unreadable" : "left-out" }));
}

/** Analyses every file (reusing a cache keyed by the immutable stored id) and decides. */
export async function classifySources(files: readonly Attachment[], excluded: ReadonlySet<string> = new Set(), cache: Map<string, SourceAnalysis> = new Map(), inspector?: SourceInspector) {
  for (const file of files) if (!cache.has(file.id) && !excluded.has(file.id)) cache.set(file.id, await analyzeSource(file, inspector));
  return decideSources(files, cache, excluded);
}
