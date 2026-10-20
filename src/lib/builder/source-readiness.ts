import { BUILDER_ATTACHMENT_LIMITS, BUILDER_SOURCE_TYPES_LABEL, BuilderSourceError, builderSourceMediaType, checkBuilderSourceBytes, type BuilderMediaType } from "./attachments";
import type { Attachment } from "../attachments";

/** What happens to one saved file when the user presses Send.
 * ready: AI reads it with this request. local-only: kept, deliberately not sent (left out, or a duplicate).
 * unsupported: a type AI cannot read. too-large: over a per-file, text, count or combined limit (never trimmed).
 * failed: the bytes could not be read or are damaged; Retry re-reads the same saved copy.
 * checking is transient: Send waits until every file has a final state. */
export type SourceState = "ready" | "local-only" | "unsupported" | "too-large" | "failed" | "checking";
/** Facts about one stored file on its own, independent of the rest of the selection. */
export type SourceAnalysis =
  | { kind: "readable"; mediaType: BuilderMediaType; bytes: number; digest: string }
  | { kind: "unsupported"; typeLabel: string }
  | { kind: "file-too-large"; bytes: number }
  | { kind: "text-too-long"; characters: number }
  | { kind: "failed"; reason: string; readError: boolean };
export type SourceEntry = {
  file: Attachment; state: SourceState; label: string; reason: string;
  mediaType?: BuilderMediaType; duplicateOf?: string; excluded: boolean;
  /** A read error the user has not seen resolved; Send stops until Retry or Leave out. */
  blocking: boolean;
};
export type SourceReadiness = {
  entries: SourceEntry[];
  /** Exactly the stored files bound to the request, in order. */
  ready: Attachment[];
  checking: boolean; blocking: SourceEntry[];
  readSummary: string; skippedSummary: string;
};

export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  ready: "Will be read by AI", "local-only": "Saved · not sent", unsupported: "AI can’t read this type",
  "too-large": "Over the AI limit", failed: "Couldn’t be read", checking: "Checking…",
};
const SHORT: Record<SourceState, string> = {
  ready: "read", "local-only": "not sent", unsupported: "type AI can’t read", "too-large": "over the limit", failed: "couldn’t be read", checking: "checking",
};

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

/** Reads one immutable stored file with the same rules the route schema enforces.
 * Never trims or rewrites: an over-limit text file is reported, not shortened. */
export async function analyzeSource(file: Attachment): Promise<SourceAnalysis> {
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
  return { kind: "readable", mediaType, bytes: bytes.length, digest: await digest(bytes) };
}

const limits = BUILDER_ATTACHMENT_LIMITS;
/** Pure: decides every file's state from analyses, in selection order. The ready set obeys
 * the same count, per-file and combined bounds as the server, so it is never refused for size. */
export function decideSources(files: readonly Attachment[], analyses: ReadonlyMap<string, SourceAnalysis>, excluded: ReadonlySet<string> = new Set()): SourceReadiness {
  const seen = new Map<string, Attachment>(), names = new Map<string, number>();
  const entries: SourceEntry[] = [], ready: Attachment[] = [];
  let total = 0;
  for (const file of files) {
    const analysis = analyses.get(file.id);
    const entry = (state: SourceState, reason: string, extra: Partial<SourceEntry> = {}): SourceEntry =>
      ({ file, state, label: SOURCE_STATE_LABELS[state], reason, excluded: excluded.has(file.id), blocking: false, ...extra });
    if (excluded.has(file.id)) { entries.push(entry("local-only", "Left out of this request. The file stays saved on this device; choose Include to send it.")); continue; }
    if (!analysis) { entries.push(entry("checking", "Checking whether AI can read this file…")); continue; }
    if (analysis.kind === "unsupported") { entries.push(entry("unsupported", `${analysis.typeLabel} can’t be read by AI. AI reads ${BUILDER_SOURCE_TYPES_LABEL}. It stays saved on this device; export it as PDF or paste its text into a .txt file to include it.`)); continue; }
    if (analysis.kind === "failed") { entries.push(entry("failed", analysis.reason, { blocking: analysis.readError })); continue; }
    if (analysis.kind === "file-too-large") { entries.push(entry("too-large", `This file is ${count(analysis.bytes, "byte")}. Each AI source file can be up to ${limits.fileBytes / 1_000_000} MB (${number(limits.fileBytes)} bytes), so it is ${count(analysis.bytes - limits.fileBytes, "byte")} over. It isn’t trimmed or sent; use a smaller copy.`)); continue; }
    if (analysis.kind === "text-too-long") { entries.push(entry("too-large", `${number(analysis.characters)} characters. Text files can contain up to ${number(limits.textCharacters)} characters, so this is ${count(analysis.characters - limits.textCharacters, "character")} over. It isn’t trimmed or sent; split it into smaller files.`)); continue; }
    const key = `${file.name}\u0000${analysis.bytes}\u0000${analysis.digest}`;
    const original = seen.get(key);
    if (original) { entries.push(entry("local-only", `Same name, size and contents as another ${file.name} in this list. AI reads it once.`, { duplicateOf: original.id, mediaType: analysis.mediaType })); continue; }
    seen.set(key, file);
    if (ready.length >= limits.count) { entries.push(entry("too-large", `AI reads up to ${limits.count} files per request and ${limits.count} are already included. Leave one out to include this file.`, { mediaType: analysis.mediaType })); continue; }
    if (total + analysis.bytes > limits.totalBytes) {
      const after = total + analysis.bytes;
      entries.push(entry("too-large", `Adding this file (${count(analysis.bytes, "byte")}) would bring this request to ${count(after, "byte")}. AI files are limited to ${limits.totalBytes / 1_000_000} MB (${number(limits.totalBytes)} bytes) combined: ${count(after - limits.totalBytes, "byte")} over. Leave another file out to include it.`, { mediaType: analysis.mediaType }));
      continue;
    }
    total += analysis.bytes;
    const sameName = names.get(file.name) ?? 0;
    names.set(file.name, sameName + 1);
    entries.push(entry("ready", sameName ? "Shares a name with another file but its contents differ, so both are read." : "AI reads this file with your next request.", { mediaType: analysis.mediaType }));
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

/** Analyses every file (reusing a cache keyed by the immutable stored id) and decides. */
export async function classifySources(files: readonly Attachment[], excluded: ReadonlySet<string> = new Set(), cache: Map<string, SourceAnalysis> = new Map()) {
  for (const file of files) if (!cache.has(file.id) && !excluded.has(file.id)) cache.set(file.id, await analyzeSource(file));
  return decideSources(files, cache, excluded);
}
