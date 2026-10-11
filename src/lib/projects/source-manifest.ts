import "server-only";
import {createHash} from "node:crypto";
import {canonicalSourceJson} from "./canonical-json";
import {WebsiteProjectSourceSchema} from "./website-source";

/** Validate and identify source without running code, fetching assets or claiming
 * build readiness. The runtime will bind this hash to its verified build. */
export function websiteProjectManifest(input: unknown) {
  const source = WebsiteProjectSourceSchema.parse(input);
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const manifest = {
    schemaVersion: 1 as const, adapter: "makeborne-react-vite-source-v1" as const,
    toolchainId: source.toolchainId, entrypoint: source.entrypoint,
    files: source.files.map(file => ({path: file.path, bytes: Buffer.byteLength(file.content, "utf8"), sha256: digest(file.content)})),
    assets: source.assets, routes: source.routes,
    // Omit the optional field entirely for historical revisions so their
    // existing identity remains stable. New decisions change source identity.
    ...(source.designDirection ? {designDirection: source.designDirection} : {}),
  };
  const manifestJson = `${canonicalSourceJson(manifest)}\n`;
  return {source, manifest, manifestJson, sourceHash: digest(manifestJson)};
}
