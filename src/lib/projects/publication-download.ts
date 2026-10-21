import "server-only";
import {assertPublicationBrokerSecret, assertPublicationAssetOrigin, PublicationDownloadContextSchema, type PublicationDownloadContext,
  PUBLICATION_ASSET_PATH, PUBLICATION_ASSET_MAX_BYTES,
  publicationAssetSignature, publicationAssetWait, readPublicationAsset} from "./publication-download-contract";

/** Controller-only credential closure. The storage locator is intentionally not
 * transmitted; the application resolves it again under the current SQL fence. */
export function publicationSourceDownloader(deps: {secret: string; origin: string; namespace?: "staging" | "production"; protectionBypassSecret?: string; fetch?: typeof fetch; now?: () => number}) {
  const {secret, origin, protectionBypassSecret} = deps;
  const namespace = deps.namespace ?? "staging";
  assertPublicationBrokerSecret(secret); assertPublicationAssetOrigin(origin, namespace);
  if (namespace === "production" && protectionBypassSecret !== undefined) throw new Error("PUBLICATION_ASSET_CONFIG_INVALID");
  if (protectionBypassSecret !== undefined && !/^[\x21-\x7e]{1,512}$/.test(protectionBypassSecret)) throw new Error("PUBLICATION_ASSET_CONFIG_INVALID");
  const transport = deps.fetch ?? fetch;
  return async (_objectPath: string, maximum: number, parent: AbortSignal, context: PublicationDownloadContext): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > PUBLICATION_ASSET_MAX_BYTES) throw new Error("PUBLICATION_ASSET_LIMIT");
    const body = JSON.stringify(PublicationDownloadContextSchema.parse(context));
    const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    const signal = AbortSignal.any([parent, AbortSignal.timeout(25_000)]);
    try {
      const response = await publicationAssetWait(() => transport(origin + PUBLICATION_ASSET_PATH, {
        method: "POST", redirect: "error", cache: "no-store", credentials: "omit", signal, body,
        headers: {"content-type": "application/json", "accept-encoding": "identity",
          "x-makeborne-asset-time": timestamp, "x-makeborne-asset-signature": publicationAssetSignature(secret, origin, timestamp, body),
          ...(protectionBypassSecret ? {"x-vercel-protection-bypass": protectionBypassSecret} : {})},
      }), signal, response => {void response.body?.cancel().catch(() => {});});
      if (response.status !== 200 || !response.body || response.headers.get("content-type") !== "application/octet-stream"
        || response.headers.get("x-makeborne-asset-bytes") !== String(maximum)
        || response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity") {
        void response.body?.cancel().catch(() => {}); throw new Error("PUBLICATION_ASSET_UNAVAILABLE");
      }
      return await readPublicationAsset(response.body, maximum, signal);
    } catch {
      throw new Error("PUBLICATION_ASSET_DOWNLOAD_FAILED");
    }
  };
}
