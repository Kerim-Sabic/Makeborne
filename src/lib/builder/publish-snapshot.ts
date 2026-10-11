import { captureStaticSnapshot } from "./browser-bundler";
import { readCloudImage } from "@/components/cloud-api";
import type { WebsiteProjectSource } from "../projects/website-source";

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Render the saved project in the sandbox and return static HTML for publishing. */
export async function captureProjectSnapshot(source: WebsiteProjectSource, scope: { accountId: string; workspaceId: string; artifactId: string }) {
  const files = Object.fromEntries(source.files.filter(file => !/^package(-lock)?\.json$/.test(file.path)).map(file => [file.path, file.content]));
  const assets: Record<string, string> = {};
  const signal = AbortSignal.timeout(60_000);
  for (const asset of source.assets) {
    const blob = await readCloudImage(`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/assets/${asset.id}`, scope.accountId, signal);
    assets[`/${asset.path.replace(/^public\//, "")}`] = await toDataUrl(blob);
  }
  return captureStaticSnapshot(files, assets);
}
