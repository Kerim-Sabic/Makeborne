import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {parseBuildReceipt, type BuildReceipt} from "./build-receipt";
import {canonicalSourceJson} from "./canonical-json";

/** Private immutable object storage, never a public bucket. Implementations must
 * enforce the read limit before allocating and make putIfAbsent atomic. Existing
 * bytes must never be replaced. Credentials belong only to the trusted process. */
export type CompiledOutputStore = {
  putIfAbsent(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  get(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | null>;
};
type ReadFile = (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>;
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const fail = (code: string): never => {throw Object.assign(new Error(code), {code});};

// This is an internal locator, not an access token. Preview callers must first
// resolve the receipt through current authenticated workspace/version authority.
function location(workspaceId: string, input: BuildReceipt) {
  const workspace = z.string().uuid().parse(workspaceId), receipt = parseBuildReceipt(input);
  return {receipt, prefix: `compiled-v1/${workspace}/${receipt.artifactId}/${receipt.revisionId}/${receipt.buildHash}`};
}

async function verifyObject(store: CompiledOutputStore, key: string, expected: Uint8Array, signal: AbortSignal) {
  signal.throwIfAborted();
  await store.putIfAbsent(key, expected, signal);
  signal.throwIfAborted();
  const stored = await store.get(key, expected.byteLength, signal);
  signal.throwIfAborted();
  if (!stored || stored.byteLength !== expected.byteLength || digest(stored) !== digest(expected)) fail("OUTPUT_RETENTION_UNCONFIRMED");
}

/** Publish the receipt marker only after every exact compiled file is durable
 * and read back. A failed/cancelled upload cannot become a completed build.
 * Partial immutable objects are unreachable without the marker; retention/GC
 * must remove abandoned objects independently of customer-visible build state. */
export async function retainCompiledOutput(store: CompiledOutputStore, workspaceId: string, input: BuildReceipt,
  readFile: ReadFile, signal: AbortSignal) {
  signal.throwIfAborted();
  const {receipt, prefix} = location(workspaceId, input);
  for (const file of receipt.files) {
    signal.throwIfAborted();
    const bytes = await readFile(file.path, file.bytes, signal);
    signal.throwIfAborted();
    if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) fail("OUTPUT_BYTES_CHANGED");
    await verifyObject(store, `${prefix}/files/${file.path}`, bytes, signal);
  }
  const marker = Buffer.from(canonicalSourceJson(receipt));
  await verifyObject(store, `${prefix}/receipt.json`, marker, signal);
}

/** Read exact manifest-listed bytes only. No arbitrary paths, SPA fallback or
 * executable serving policy here. An isolated authenticated preview gateway
 * must own routing, current access checks, MIME types and response headers. */
export async function readCompiledOutputFile(store: CompiledOutputStore, workspaceId: string, input: BuildReceipt,
  path: string, signal: AbortSignal): Promise<Uint8Array | null> {
  signal.throwIfAborted();
  const {receipt, prefix} = location(workspaceId, input);
  const file = receipt.files.find(file => file.path === path);
  if (!file) return null;
  const expectedMarker = Buffer.from(canonicalSourceJson(receipt));
  const marker = await store.get(`${prefix}/receipt.json`, 262144, signal);
  signal.throwIfAborted();
  if (!marker || marker.byteLength !== expectedMarker.byteLength || digest(marker) !== digest(expectedMarker)) fail("OUTPUT_NOT_RETAINED");
  const bytes = await store.get(`${prefix}/files/${file.path}`, file.bytes, signal);
  signal.throwIfAborted();
  if (!bytes || bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) fail("OUTPUT_BYTES_CHANGED");
  return bytes;
}
