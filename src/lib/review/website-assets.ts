import { renderHostedSnapshot } from "../hosting/snapshot";
import { ArtifactContentSchema } from "../domain";
import type { AssetResolver } from "./capture-server";

/**
 * Project images for the server-side review capture (stage 6). The saved
 * snapshot references a website's own images by public path (`/images/hero.webp`,
 * `/artwork/<id>.png`). The review copy keeps exactly those references (the
 * sanitiser drops any other image source), and the offline capture serves each
 * one from the project's registered asset: identity from the version's
 * `websiteSource.assets`, bytes re-read through the caller's RLS-bound client
 * and verified against the registered sha256 and size before they are served.
 *
 * - served: the bytes match the registered asset;
 * - broken (404): the asset row or object is missing, or its bytes changed —
 *   the published site would show a broken image too;
 * - unavailable (not checked): storage could not be confirmed, or the capture's
 *   byte budget is used up; reported as coverage, never as a pass.
 * Anything that is not one of the project's assets is not served (unchanged).
 */
export type ReviewSiteAsset = Readonly<{ id: string; path: string; sha256: string; mediaType: string; bytes: number }>;
export class ReviewAssetMissing extends Error {}

/** `/images/hero.webp` → the registered asset at `public/images/hero.webp`. */
export function reviewAssetPaths(assets: readonly ReviewSiteAsset[]): Map<string, ReviewSiteAsset> {
  const map = new Map<string, ReviewSiteAsset>();
  for (const asset of assets) if (asset.path.startsWith("public/") && asset.path.length > 7) map.set(`/${asset.path.slice("public/".length)}`, asset);
  return map;
}

// Images may come from the review copy's own origin (the offline capture serves only project assets there).
const CSP_WITH_ASSETS = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'; font-src data:; script-src 'none'; form-action 'none'; base-uri 'none'">`;

/**
 * Script-free review copy of a React website version that keeps its project
 * image references (the client-review copy embeds nothing and allows only data:
 * images; this one is used only inside the offline review capture).
 * Returns null when the version has no React source (callers fall back to the
 * client-review copy for static and outline versions).
 */
export function reviewWebsiteHtmlWithAssets(contentInput: unknown, snapshot: string, origin: string): { html: string; assets: Map<string, ReviewSiteAsset> } | null {
  const content = ArtifactContentSchema.parse(contentInput);
  if (content.kind !== "website" || !content.websiteSource) return null;
  const assets = reviewAssetPaths(content.websiteSource.assets);
  const html = renderHostedSnapshot(snapshot, content.title, content.title, origin, { assetPaths: new Set(assets.keys()) });
  return { html: html.replace("<head>", `<head>${CSP_WITH_ASSETS}`), assets };
}

export type ProjectImageReport = { served: string[]; broken: string[]; unavailable: string[] };
/**
 * The capture's asset resolver over the project's registered images. `load`
 * returns verified original bytes or throws ReviewAssetMissing (missing/changed)
 * or anything else (not confirmed). Each path is resolved once per review.
 */
export function projectImageResolver(assets: ReadonlyMap<string, ReviewSiteAsset>, load: (asset: ReviewSiteAsset) => Promise<Uint8Array>, budgetBytes = 40_000_000): { resolve: AssetResolver; report: () => ProjectImageReport } {
  const cache = new Map<string, Promise<{ body: Buffer; contentType: string } | null | "unavailable">>();
  const report: ProjectImageReport = { served: [], broken: [], unavailable: [] };
  let used = 0;
  const once = (path: string, asset: ReviewSiteAsset) => (async () => {
    if (used + asset.bytes > budgetBytes) { report.unavailable.push(path); return "unavailable" as const; }
    used += asset.bytes;
    try {
      const bytes = await load(asset);
      if (bytes.byteLength !== asset.bytes) { report.broken.push(path); return null; }
      report.served.push(path);
      return { body: Buffer.from(bytes), contentType: asset.mediaType };
    } catch (error) {
      if (error instanceof ReviewAssetMissing) { report.broken.push(path); return null; }
      report.unavailable.push(path); return "unavailable" as const;
    }
  })();
  const resolve: AssetResolver = async path => {
    const asset = assets.get(path);
    if (!asset) return "unavailable";
    if (!cache.has(path)) cache.set(path, once(path, asset));
    return cache.get(path)!;
  };
  return { resolve, report: () => ({ served: [...new Set(report.served)], broken: [...new Set(report.broken)], unavailable: [...new Set(report.unavailable)] }) };
}
