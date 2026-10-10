import "server-only";
import JSZip from "jszip";
import {createHash} from "node:crypto";
import {ArtifactVersionSchema} from "../domain";
import {canonicalSourceJson} from "./canonical-json";
import {websiteProjectManifest} from "./source-manifest";
import {websiteSourceFiles} from "./source-files";
import type {resolveWebsiteSourceAssets} from "./source-assets";

/** Export authoritative saved files, never a rendered outline or a stale build. */
export async function websiteProjectSourceBundle(input: unknown, artwork: Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>) {
  const version = ArtifactVersionSchema.parse(input);
  if (!version.content.websiteSource) throw new Error("Choose a full-source website revision.");
  const {source, sourceHash, manifest: sourceManifest} = websiteProjectManifest(version.content.websiteSource);
  const zip = new JSZip();
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  const entries = websiteSourceFiles(source, artwork);
  const manifest = {schemaVersion: 1, adapter: "makeborne-full-source-archive-v1", artifactId: version.artifactId,
    revisionId: version.id, version: version.number, sourceHash, source: sourceManifest};
  const manifestJson = `${canonicalSourceJson(manifest)}\n`;
  entries.push({path: ".makeborne/manifest.json", bytes: Buffer.from(manifestJson)},
    {path: ".makeborne/README.txt", bytes: Buffer.from("This archive contains the exact saved source and verified original project artwork.\nA source archive does not certify a successful build or safe execution.\nUse the declared toolchain and locked dependencies in an isolated environment.\nNo platform secrets or customer database contents are included.\n")});
  for (const entry of entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    zip.file(entry.path, entry.bytes, {date: fixedDate, createFolders: false, binary: true, unixPermissions: 0o100644});
  }
  const bytes = await zip.generateAsync({type: "uint8array", compression: "DEFLATE", compressionOptions: {level: 6}, platform: "UNIX"});
  return {bytes, manifest, bundleHash: createHash("sha256").update(manifestJson).digest("hex"), filename: `makeborne-${version.artifactId}-v${version.number}-source.zip`};
}
