import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { builderAttachmentBlocks, type BuilderAttachment } from "../builder/attachments";
import { RequestError } from "../server/http";
import { UNTRUSTED_SOURCE_RULE, extractedSourceBlocks, omittedSourcesBlock, type OmittedSource } from "./model-blocks";
import { ingestionReference, type ExtractionRecord, type IngestionReference } from "./record";
import { isIngested, type BuilderSource } from "./request";
import { resolveSourceReference } from "./storage";
import { IngestBusyError, IngestCancelledError, extractSource } from "./worker-host";

/** Server-side switch for the ingestion pipeline (Office/CSV, PDF checks, stored references). Off by default:
 * with it off every request is handled exactly as before and new source types are refused. */
export const sourceIngestionEnabled = () => process.env.MAKEBORNE_SOURCE_INGESTION_ENABLED === "true";

/** A specific stop for dependent generation: names the file, the reason and the two choices. */
export function unreadableSourceError(name: string, record: Pick<ExtractionRecord, "status" | "message">) {
  const lead = record.status === "partial" ? "can only be partly read" : record.status === "encrypted" ? "is password-protected" : record.status === "unsupported" ? "can’t be read by AI" : "couldn’t be read";
  return new RequestError("SOURCE_UNREADABLE", `${name} ${lead}: ${record.message} Remove it, or choose “Continue without it” to send this request without it. Nothing was charged and this request has not started.`, 422);
}

export type PreparedSources = { blocks: BetaContentBlockParam[]; references: IngestionReference[] };
/** The provider request must stay well under its size limit: PDFs and pictures travel as base64. */
export const MAX_SOURCE_PAYLOAD_CHARACTERS = 24_000_000;
const payloadOf = (block: BetaContentBlockParam) => {
  if (block.type === "text") return block.text.length;
  if ((block.type === "document" || block.type === "image") && "data" in block.source && typeof block.source.data === "string") return block.source.data.length;
  return 0;
};

function decode(data: string) { return Uint8Array.from(Buffer.from(data, "base64")); }

/** Turns the request's sources into model input, in order. Existing image/PDF/text entries keep
 * their exact blocks; ingested entries are extracted in the isolated worker and must be complete.
 * Runs before any operation or credit hold exists, so a refusal costs nothing. */
export async function prepareBuilderSources(sources: readonly BuilderSource[], omitted: readonly OmittedSource[], context: { client: SupabaseClient; scope: { workspaceId: string; projectId: string }; signal?: AbortSignal }): Promise<PreparedSources> {
  const enabled = sourceIngestionEnabled();
  if (!enabled && sources.some(isIngested)) throw new RequestError("SOURCE_TYPE_UNAVAILABLE", "Word, PowerPoint, Excel and CSV files, and stored large files, can’t be read by AI in this environment yet. Remove them or export them as PDF.", 422);
  const blocks: BetaContentBlockParam[] = [], references: IngestionReference[] = [];
  try {
    for (const source of sources) {
      if (!isIngested(source)) {
        const legacy = source as BuilderAttachment;
        // PDFs get the page, encryption and text-layer check; the block AI receives is unchanged.
        if (enabled && legacy.mediaType === "application/pdf") {
          const record = await extractSource({ bytes: decode(legacy.data), name: legacy.name, declaredType: legacy.mediaType, signal: context.signal });
          if (record.status !== "complete") throw unreadableSourceError(legacy.name, record);
          references.push(ingestionReference(record, `inline:${record.sourceSha256}`));
          // The PDF itself goes to the model unchanged, inside the same untrusted-source rule as every other file.
          blocks.push(...builderAttachmentBlocks([legacy]).map(block => block.type === "document" ? { ...block, context: UNTRUSTED_SOURCE_RULE } : block));
          continue;
        }
        blocks.push(...builderAttachmentBlocks([legacy]));
        continue;
      }
      const bytes = "reference" in source
        ? await resolveSourceReference(context.client, context.scope, source.reference, source.mediaType, context.signal)
        : decode(source.data);
      const record = await extractSource({ bytes, name: source.name, declaredType: source.mediaType, signal: context.signal });
      if (record.status !== "complete") throw unreadableSourceError(source.name, record);
      references.push(ingestionReference(record, "reference" in source ? source.reference.assetId : `inline:${record.sourceSha256}`));
      if (record.format === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") }, title: source.name, context: UNTRUSTED_SOURCE_RULE });
      else blocks.push(...extractedSourceBlocks(record, source.name));
    }
  } catch (error) {
    if (error instanceof IngestCancelledError) throw new RequestError("REQUEST_CANCELLED", "The request was cancelled while reading your source files. Nothing was charged.", 499);
    if (error instanceof IngestBusyError) throw new RequestError("SOURCES_BUSY", "Too many files are being read right now. Send again in a moment; nothing was charged.", 429);
    throw error;
  }
  const payload = blocks.reduce((sum, block) => sum + payloadOf(block), 0);
  if (payload > MAX_SOURCE_PAYLOAD_CHARACTERS) throw new RequestError("SOURCES_TOO_LARGE", `Together, these source files are too large to send to AI in one request (about ${Math.ceil(payload / 1_000_000)} MB once encoded, including pictures inside documents; the limit is ${MAX_SOURCE_PAYLOAD_CHARACTERS / 1_000_000} MB). Leave a file out or use smaller copies. Nothing was charged.`, 413);
  const note = omittedSourcesBlock(omitted);
  if (note) blocks.push(note);
  return { blocks, references };
}
