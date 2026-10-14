import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { ArtifactVersionSchema } from "@/lib/domain";
import { cleanWebsite, websiteDocument } from "./website-document";
import {canonicalSourceJson} from "@/lib/projects/canonical-json";
export {canonicalSourceJson} from "@/lib/projects/canonical-json";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** A reproducible export of one saved static design. This is a derived source
 * adapter, not yet the canonical multi-file React project or an offline asset pack. */
export async function websiteSourceBundle(versionInput: unknown) {
  const version = ArtifactVersionSchema.parse(versionInput);
  if (version.content.kind !== "website" || !version.content.website) {
    throw new Error("Save a generated website design before downloading its source.");
  }
  const site = cleanWebsite(version.content.website);
  const files: Record<string, string> = {
    "index.html": websiteDocument(version.content.title, site),
    "source/body.html": site.html,
    "source/styles.css": site.css,
    "source/design.json": `${canonicalSourceJson({description: site.description, designNotes: site.designNotes})}\n`,
    "README.txt": [
      `${version.content.title} — Makeborne saved website source`,
      `Artifact: ${version.artifactId}`,
      `Revision: ${version.id} (version ${version.number})`,
      "",
      "Open index.html to view the exported static website.",
      "source/body.html and source/styles.css contain the normalised editable design.",
      "index.html includes the same sanitised document used for website download.",
      "The renderer removes unsupported markup and includes baseline accessibility and security rules.",
      "Approved external images require internet access and are not embedded in this archive.",
      "This export does not include backend services, credentials or a React application toolchain.",
      "Editing the source files does not automatically rebuild index.html or update Makeborne.",
      "manifest.json binds the saved revision and lists SHA-256 hashes for exported files.",
      "",
    ].join("\n"),
  };
  const manifest = {
    schemaVersion: 1,
    adapter: "makeborne-static-website-v1",
    artifactId: version.artifactId,
    revisionId: version.id,
    revisionNumber: version.number,
    parentRevisionId: version.parentVersionId,
    entrypoint: "index.html",
    sourceHash: digest(canonicalSourceJson({content: version.content, style: version.style, assetIds: version.assetIds})),
    externalAssets: "approved_remote_images_not_embedded",
    files: Object.keys(files).sort().map(path => ({path, bytes: Buffer.byteLength(files[path], "utf8"), sha256: digest(files[path])})),
  };
  const manifestJson = `${canonicalSourceJson(manifest)}\n`;
  const bundleHash = digest(manifestJson);
  const zip = new JSZip();
  // Fixed timestamps and ordering make identical accepted input byte reproducible.
  for (const name of [...Object.keys(files), "manifest.json"].sort()) {
    zip.file(name, name === "manifest.json" ? manifestJson : files[name], {
      date: new Date("2020-01-01T00:00:00Z"), createFolders: false,
    });
  }
  const bytes = await zip.generateAsync({type: "uint8array", compression: "DEFLATE", compressionOptions: {level: 6}, platform: "UNIX"});
  return {bytes, manifest, bundleHash, filename: `makeborne-website-v${version.number}.zip`};
}
