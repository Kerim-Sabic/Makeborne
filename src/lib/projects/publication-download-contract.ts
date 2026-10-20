import "server-only";
import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {publicationBrokerOriginAllowed} from "../../../infra/publication-controller/profiles.mjs";
/** Operator-pinned deployment or stable team alias for this staging project.
 * No default: the selected alias must be verified before broker activation. */
export function assertPublicationAssetOrigin(origin: string, namespace?: "staging" | "production") {
  if (!(namespace ? publicationBrokerOriginAllowed(origin, namespace)
    : publicationBrokerOriginAllowed(origin, "staging") || publicationBrokerOriginAllowed(origin, "production")))
    throw new Error("PUBLICATION_ASSET_CONFIG_INVALID");
}
export const PUBLICATION_ASSET_PATH = "/api/hosting/publication-assets";
export const PUBLICATION_ASSET_MAX_BYTES = 20_000_000;
export const PublicationDownloadContextSchema = z.object({
  preparationId: z.string().uuid(), workerId: z.string().uuid(),
  fence: z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => BigInt(value) <= BigInt("9223372036854775807")),
  assetId: z.string().uuid(),
}).strict();
export type PublicationDownloadContext = z.infer<typeof PublicationDownloadContextSchema>;
export function assertPublicationBrokerSecret(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("PUBLICATION_ASSET_CONFIG_INVALID");
}
export function publicationAssetSignature(secret: string, origin: string, timestamp: string, body: string) {
  assertPublicationBrokerSecret(secret);
  assertPublicationAssetOrigin(origin);
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(["makeborne-publication-asset-v1", "POST", origin, PUBLICATION_ASSET_PATH,
      timestamp, createHash("sha256").update(body).digest("hex")].join("\n")).digest("hex");
}
export function verifyPublicationAssetSignature(secret: string, origin: string, timestamp: string, signature: string, body: string, now: number) {
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)
    || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 30) throw new Error("PUBLICATION_ASSET_AUTH_INVALID");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(publicationAssetSignature(secret, origin, timestamp, body), "hex")))
    throw new Error("PUBLICATION_ASSET_AUTH_INVALID");
}

/** Bound even a transport that fails to honor cancellation. Late HTTP bodies are
 * discarded; no caller-controlled error or response body is exposed. */
export async function publicationAssetWait<T>(start: () => PromiseLike<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {if (!settled) {settled = true; reject(new Error("PUBLICATION_ASSET_ABORTED"));}};
    signal.addEventListener("abort", abort, {once: true});
    Promise.resolve().then(() => {signal.throwIfAborted(); return start();}).then(value => {
      if (settled) {late?.(value); return;}
      settled = true; signal.removeEventListener("abort", abort); resolve(value);
    }, () => {
      if (!settled) {settled = true; signal.removeEventListener("abort", abort); reject(new Error("PUBLICATION_ASSET_UNAVAILABLE"));}
    });
  });
}
export async function readPublicationAsset(body: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal, exact = true) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > PUBLICATION_ASSET_MAX_BYTES) throw new Error("PUBLICATION_ASSET_LIMIT");
  const reader = body.getReader(), bytes = new Uint8Array(maximum); let offset = 0;
  try {
    while (true) {
      const part = await publicationAssetWait(() => reader.read(), signal);
      if (part.done) break;
      if (offset + part.value.byteLength > maximum) throw new Error("PUBLICATION_ASSET_LIMIT");
      bytes.set(part.value, offset); offset += part.value.byteLength;
    }
    if (exact && offset !== maximum) throw new Error("PUBLICATION_ASSET_BYTES_INVALID");
    signal.throwIfAborted(); return bytes.subarray(0, offset);
  } finally {
    void reader.cancel().catch(() => {});
    // A deliberately uncooperative pending read can prevent release; cancellation
    // remains requested and must not delay the bounded caller.
    try {reader.releaseLock();} catch {}
  }
}
