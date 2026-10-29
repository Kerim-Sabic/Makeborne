import "server-only";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Worker, type ResourceLimits } from "node:worker_threads";
import { EXTRACTION_VERSION, WorkerRecordSchema, type ExtractionRecord } from "./record";

/** Per-file isolation: one short-lived worker thread, no environment, bounded heap and stack, hard wall clock. */
export const INGEST_RESOURCE_LIMITS: Required<Pick<ResourceLimits, "maxOldGenerationSizeMb" | "maxYoungGenerationSizeMb" | "stackSizeMb" | "codeRangeSizeMb">> = {
  maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 48, stackSizeMb: 4, codeRangeSizeMb: 32,
};
export const INGEST_TIMEOUT_MS = 25_000;
/** Bytes accepted by the parser at all (storage references included). */
export const INGEST_MAX_BYTES = 25 * 1024 * 1024;

/** Extraction was cancelled by the caller: there is no result, partial or otherwise. */
export class IngestCancelledError extends Error {
  constructor() { super("Reading the source file was cancelled."); this.name = "IngestCancelledError"; }
}

export type ParserLimitOverrides = Partial<Record<"pages" | "slides" | "sheets" | "cells" | "rows" | "columns" | "textCharacters" | "images" | "zipEntries" | "zipTotalBytes" | "zipEntryBytes" | "zipRatio", number>>;
export type ExtractInput = {
  bytes: Uint8Array; name: string; declaredType: string;
  signal?: AbortSignal; timeoutMs?: number;
  /** Lower-only overrides (the parser ignores raises). */
  limits?: ParserLimitOverrides;
  resourceLimits?: Partial<typeof INGEST_RESOURCE_LIMITS>;
};

// Resolved from the app root at run time (not bundled): next.config traces these files into the routes that use them.
const workerFile = () => join(process.cwd(), "src", "lib", "ingest", "parse-worker.cjs");
const hostFailure = (sha256: string, bytes: number, problem: string, message: string): ExtractionRecord => ({
  sourceSha256: sha256, extractionVersion: EXTRACTION_VERSION, bytes, format: "unknown", status: "failed", problem, message,
  coverage: null, text: "", blocks: [], tables: [], slides: [], sheets: [], images: [], warnings: [], unsupported: [], details: {},
});

/** Parser workers per server instance; further files wait in a short queue, then are refused as busy. */
export const INGEST_CONCURRENCY = 2;
const INGEST_QUEUE = 16;
let running = 0;
const waiting: (() => void)[] = [];
export class IngestBusyError extends Error {
  constructor() { super("Too many files are being read right now. Try again in a moment."); this.name = "IngestBusyError"; }
}
async function slot(signal?: AbortSignal): Promise<() => void> {
  if (running < INGEST_CONCURRENCY) running++;
  else {
    if (waiting.length >= INGEST_QUEUE) throw new IngestBusyError();
    // A released slot is handed straight to the next waiter, so `running` never exceeds the limit.
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { const index = waiting.indexOf(ready); if (index >= 0) waiting.splice(index, 1); reject(new IngestCancelledError()); };
      waiting.push(ready);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  let released = false;
  return () => { if (released) return; released = true; const next = waiting.shift(); if (next) next(); else running--; };
}

/** Runs the parser for one file in an isolated worker. Resolves with a record for every
 * outcome of the file itself (complete, partial, failed, unsupported, encrypted), including
 * timeouts and memory exhaustion; rejects only with IngestCancelledError when cancelled
 * (or IngestBusyError when the instance is saturated). */
export async function extractSource(input: ExtractInput): Promise<ExtractionRecord> {
  const release = await slot(input.signal);
  try { return await runWorker(input); }
  finally { release(); }
}

function runWorker(input: ExtractInput): Promise<ExtractionRecord> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (input.signal?.aborted) return Promise.reject(new IngestCancelledError());
  if (input.bytes.byteLength > INGEST_MAX_BYTES) return Promise.resolve(hostFailure(sha256, input.bytes.byteLength, "file-too-large", `This file is larger than ${INGEST_MAX_BYTES / 1024 / 1024} MB, the most AI reads from one source file. Use a smaller copy.`));
  // A private copy is transferred, so the caller's buffer is never detached or shared.
  const copy = new Uint8Array(input.bytes.byteLength);
  copy.set(input.bytes);
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(/* webpackIgnore: true */ /* turbopackIgnore: true */ workerFile(), {
      env: {}, argv: [], execArgv: [], stdout: true, stderr: true, trackUnmanagedFds: true,
      resourceLimits: { ...INGEST_RESOURCE_LIMITS, ...input.resourceLimits },
    });
    worker.stdout.resume(); worker.stderr.resume();
    const finish = (outcome: { record?: ExtractionRecord; cancelled?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (outcome.cancelled) reject(new IngestCancelledError());
      else resolve(outcome.record!);
    };
    const abort = () => finish({ cancelled: true });
    const timer = setTimeout(() => finish({ record: hostFailure(sha256, copy.byteLength, "timeout", "Reading this file took too long, so it was stopped. Split it into smaller files or save a simpler copy.") }), input.timeoutMs ?? INGEST_TIMEOUT_MS);
    input.signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (reply: unknown) => {
      const parsed = typeof reply === "object" && reply !== null && (reply as { ok?: unknown }).ok === true ? WorkerRecordSchema.safeParse((reply as { record?: unknown }).record) : null;
      if (!parsed?.success) return finish({ record: hostFailure(sha256, copy.byteLength, "malformed", "This file couldn’t be read. Save a fresh copy from the original app and attach that.") });
      finish({ record: { ...parsed.data, sourceSha256: sha256 } });
    });
    worker.once("error", (error: NodeJS.ErrnoException) => finish({ record: error?.code === "ERR_WORKER_OUT_OF_MEMORY"
      ? hostFailure(sha256, copy.byteLength, "memory", "This file needs more memory to read than AI sources allow. Split it into smaller files.")
      : hostFailure(sha256, copy.byteLength, "malformed", "This file couldn’t be read. Save a fresh copy from the original app and attach that.") }));
    worker.once("exit", () => finish({ record: hostFailure(sha256, copy.byteLength, "malformed", "This file couldn’t be read. Save a fresh copy from the original app and attach that.") }));
    worker.postMessage({ bytes: copy.buffer, name: input.name, declaredType: input.declaredType, limits: input.limits ?? {} }, [copy.buffer]);
  });
}
