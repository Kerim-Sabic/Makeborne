import "server-only";
import {createHash} from "node:crypto";
import type {resolveWebsiteSourceAssets} from "./source-assets";
import {WebsiteProjectSourceSchema} from "./website-source";

/** Materialise exact text and verified original artwork for archives or builds. */
export function websiteSourceFiles(input: unknown, artwork: Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>) {
  const source = WebsiteProjectSourceSchema.parse(input);
  const assets = new Map(artwork.map(asset => [asset.id, asset]));
  if (assets.size !== artwork.length || assets.size !== source.assets.length) throw new Error("Source artwork could not be matched.");
  const entries: {path: string; bytes: Uint8Array}[] = source.files.map(file => ({path: file.path, bytes: Buffer.from(file.content, "utf8")}));
  for (const descriptor of source.assets) {
    const asset = assets.get(descriptor.id);
    if (!asset || asset.path !== descriptor.path || asset.mediaType !== descriptor.mediaType
      || asset.bytes.byteLength !== descriptor.bytes || createHash("sha256").update(asset.bytes).digest("hex") !== descriptor.sha256) {
      throw new Error("Source artwork changed. Recheck the original asset before using this source.");
    }
    entries.push({path: descriptor.path, bytes: asset.bytes});
  }
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
