import { z } from "zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Attachment } from "../attachments";

/** Inline sources leave headroom below the deployment 4.5 MB request limit. */
export const BUILDER_ATTACHMENT_LIMITS = { count: 5, fileBytes: 3_000_000, totalBytes: 3_000_000, textCharacters: 200_000 };
export const MAX_BUILDER_REQUEST_BYTES = 4_400_000;
export function serializeBuilderRequest(body: unknown): string {
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BUILDER_REQUEST_BYTES) throw new Error("This request is too large to send. Use smaller source files or fewer review screenshots. Your files remain saved on this device.");
  return serialized;
}
export const BUILDER_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.txt";
const mediaTypes = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown"] as const;
type MediaType = typeof mediaTypes[number];
export type BuilderAttachment = { name: string; mediaType: MediaType; data: string };

function decode(data: string) {
  if (!data.length || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error("The file encoding is invalid.");
  const binary = atob(data);
  if (btoa(binary) !== data) throw new Error("The file encoding is invalid.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function signature(bytes: Uint8Array): MediaType | null {
  const start = String.fromCharCode(...bytes.subarray(0, 12));
  if (start.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (start.startsWith("RIFF") && start.slice(8) === "WEBP") return "image/webp";
  if (start.startsWith("GIF87a") || start.startsWith("GIF89a")) return "image/gif";
  if (start.startsWith("%PDF-")) return "application/pdf";
  return null;
}
function textContent(bytes: Uint8Array) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Use a UTF-8 text file."); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error("This file contains binary data. Use a UTF-8 text file.");
  if (text.length > BUILDER_ATTACHMENT_LIMITS.textCharacters) throw new Error("Text files can contain up to 200,000 characters. Split or shorten this file.");
  return text;
}
function validateBytes(bytes: Uint8Array, mediaType: MediaType) {
  if (!bytes.length) throw new Error("This file is empty.");
  if (bytes.length > BUILDER_ATTACHMENT_LIMITS.fileBytes) throw new Error("Each AI source file can be up to 3 MB (3,000,000 bytes).");
  if (mediaType.startsWith("text/")) { textContent(bytes); return; }
  if (signature(bytes) !== mediaType) throw new Error("The file contents do not match its image or PDF type.");
}

export const BuilderAttachmentSchema = z.object({
  name: z.string().min(1).max(255), mediaType: z.enum(mediaTypes), data: z.string().max(4_000_000),
}).strict().superRefine((file, context) => {
  // Avoid decoding values already rejected by the bounded string schema.
  if (file.data.length > 4_000_000) return;
  try { validateBytes(decode(file.data), file.mediaType); }
  catch (error) { context.addIssue({ code: "custom", message: `${file.name}: ${error instanceof Error ? error.message : "Invalid source file."}` }); }
});
export const BuilderAttachmentsSchema = z.array(BuilderAttachmentSchema).max(BUILDER_ATTACHMENT_LIMITS.count).superRefine((files, context) => {
  const size = files.reduce((sum, file) => sum + (file.data.length / 4 * 3 - (file.data.endsWith("==") ? 2 : file.data.endsWith("=") ? 1 : 0)), 0);
  if (size > BUILDER_ATTACHMENT_LIMITS.totalBytes) context.addIssue({ code: "custom", message: "Keep AI source files under 3 MB (3,000,000 bytes) combined." });
});

/** Stable field order, including file order, for protected operation fingerprints. */
export function canonicalBuilderAttachments(files: readonly BuilderAttachment[]) {
  return JSON.stringify(files.map(({ name, mediaType, data }) => ({ name, mediaType, data })));
}

/** No filtering or truncation: the whole selection succeeds or the request stops. */
export async function prepareBuilderAttachments(files: readonly Attachment[]): Promise<BuilderAttachment[]> {
  if (files.length > BUILDER_ATTACHMENT_LIMITS.count) throw new Error("AI can read up to five source files per request. Remove extra files before sending.");
  if (files.reduce((sum, file) => sum + file.blob.size, 0) > BUILDER_ATTACHMENT_LIMITS.totalBytes) throw new Error("Keep AI source files under 3 MB (3,000,000 bytes) combined.");
  const result: BuilderAttachment[] = [];
  for (const file of files) {
    try {
      if (file.blob.size > BUILDER_ATTACHMENT_LIMITS.fileBytes) throw new Error("Each AI source file can be up to 3 MB (3,000,000 bytes).");
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      const mediaType = signature(bytes) ?? (file.type === "text/markdown" || /\.md$/i.test(file.name) ? "text/markdown"
        : file.type === "text/plain" || /\.txt$/i.test(file.name) ? "text/plain" : null);
      if (!mediaType) throw new Error("AI can read PNG, JPEG, WebP, GIF, PDF, TXT and Markdown files. Convert this file or remove it before sending.");
      validateBytes(bytes, mediaType);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
      result.push(Object.freeze({ name: file.name, mediaType, data: btoa(binary) }));
    } catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Could not read this file."}`); }
  }
  return result;
}

/** Called only after the route schema has checked every byte and bound. */
export function builderAttachmentBlocks(files: readonly BuilderAttachment[]): BetaContentBlockParam[] {
  return files.map(file => file.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data }, title: file.name }
    : file.mediaType === "text/plain" || file.mediaType === "text/markdown"
      ? { type: "document", source: { type: "text", media_type: "text/plain", data: textContent(decode(file.data)) }, title: file.name }
      : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.data } });
}
