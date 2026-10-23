import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalSourceJson } from "../projects/canonical-json";

/**
 * Source-ingestion choices a request was admitted with: the files the person chose to
 * "Continue without it" and the ingestion reference of every file that was read
 * (stored asset id or inline:<sha256>, sha256, extraction version, format, status).
 * Recorded once with a new operation; every continuation must present the same set.
 */
export const OperationSourcesSchema = z.object({
  omitted: z.array(z.object({ name: z.string().min(1).max(255), reason: z.enum(["left-out", "unreadable", "partial"]) }).strict()).max(20),
  references: z.array(z.object({ sourceId: z.string().min(1).max(80), sha256: z.string().regex(/^[a-f0-9]{64}$/), extractionVersion: z.string().min(1).max(64),
    format: z.string().min(1).max(16), status: z.string().min(1).max(16) }).strict()).max(10),
}).strict();
export type OperationSources = z.infer<typeof OperationSourcesSchema>;
/** Canonical digest of the source choices; null when nothing was omitted or ingested (requests without ingestion are unchanged). */
export function sourcesFingerprint(sources: OperationSources | null | undefined): string | null {
  if (!sources || (!sources.omitted.length && !sources.references.length)) return null;
  const parsed = OperationSourcesSchema.parse(sources);
  return createHash("sha256").update(canonicalSourceJson({ omitted: parsed.omitted, references: parsed.references })).digest("hex");
}
