import "server-only";
import {createHash} from "node:crypto";
import projectPackage from "../../../infra/project-runtime/toolchain/package.json";
import projectLock from "../../../infra/project-runtime/toolchain/package-lock.json";
import {ArtifactVersionSchema} from "../domain";
import {canonicalSourceJson} from "./canonical-json";
import {websiteProjectManifest} from "./source-manifest";
import {websiteSourceFiles} from "./source-files";
import type {resolveWebsiteSourceAssets} from "./source-assets";

export const PROJECT_TOOLCHAIN = {id: "react-vite-v1", package: projectPackage, lock: projectLock} as const;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Pure preflight. Call only after existing account/role/revision authority and
 * authenticated original-asset resolution. This never executes project code. */
export function websiteBuildInput(input: unknown, artwork: Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>) {
  const version = ArtifactVersionSchema.parse(input);
  if (!version.content.websiteSource) throw new Error("Choose a saved full-source website revision.");
  const {source, sourceHash, manifest: sourceManifest} = websiteProjectManifest(version.content.websiteSource);
  for (const [path, expected] of [["package.json", projectPackage], ["package-lock.json", projectLock]] as const) {
    const file = source.files.find(file => file.path === path)!;
    if (canonicalSourceJson(JSON.parse(file.content)) !== canonicalSourceJson(expected)) {
      throw new Error("This project needs the approved React/Vite dependency lock. Package changes need a reviewed toolchain update.");
    }
  }
  // Fail explicitly rather than ignore project configuration the user expects.
  if (source.files.some(file => /(?:^|\/)(?:vite|postcss|tailwind)\.config\./i.test(file.path))) {
    throw new Error("Custom build configuration needs a supported toolchain. Keep visual styles in the project's source and CSS.");
  }
  const toolchainHash = digest(canonicalSourceJson(PROJECT_TOOLCHAIN));
  const files = websiteSourceFiles(source, artwork).map(file => ({path: file.path, bytes: file.bytes.byteLength,
    sha256: digest(file.bytes), base64: Buffer.from(file.bytes).toString("base64")}));
  return {schemaVersion: 1 as const, artifactId: version.artifactId, revisionId: version.id, version: version.number,
    sourceHash, sourceManifest, toolchainId: source.toolchainId, toolchainHash, routes: source.routes, files};
}
