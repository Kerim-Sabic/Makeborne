import { buildPublishBundle, captureStaticSnapshot } from "./browser-bundler";
import { readCloudImage } from "@/components/cloud-api";
import type { WebsiteProjectSource } from "../projects/website-source";

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export type ProjectPublication = { snapshot: string; bundle: { js: string; css: string } };

/** Render the saved project in the sandbox for the static first paint / no-JS
 * fallback, and build the minified production bundle that the isolated site
 * host runs on top of it. Image data URLs used for the sandboxed render are
 * mapped back to their public paths, which the site host serves itself. */
export async function captureProjectPublication(source: WebsiteProjectSource, scope: { accountId: string; workspaceId: string; artifactId: string }): Promise<ProjectPublication> {
  const files = Object.fromEntries(source.files.filter(file => !/^package(-lock)?\.json$/.test(file.path)).map(file => [file.path, file.content]));
  const assets: Record<string, string> = {};
  const signal = AbortSignal.timeout(60_000);
  for (const asset of source.assets) {
    const blob = await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, signal);
    assets[`/${asset.path.replace(/^public\//, "")}`] = await toDataUrl(blob);
  }
  const bundle = await buildPublishBundle(files);
  let snapshot = await captureStaticSnapshot(files, assets);
  for (const [path, url] of Object.entries(assets)) snapshot = snapshot.split(url).join(path);
  return { snapshot, bundle };
}
