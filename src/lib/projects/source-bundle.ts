import "server-only";
import JSZip from "jszip";
import {createHash} from "node:crypto";
import {ArtifactVersionSchema} from "../domain";
import {canonicalSourceJson} from "./canonical-json";
import {websiteProjectManifest} from "./source-manifest";
import {websiteSourceFiles} from "./source-files";
import type {resolveWebsiteSourceAssets} from "./source-assets";
import portableFonts from "../../../infra/project-runtime/font-portability.cjs";
import fontLicenseFiles from "../../../infra/project-runtime/font-licenses.cjs";
import compatibility from "../../../infra/project-runtime/toolchain-compatibility.cjs";
import projectPackage from "../../../infra/project-runtime/toolchain/package.json";
import projectLock from "../../../infra/project-runtime/toolchain/package-lock.json";

/** The portable project tree shared by the source archive and GitHub sync: the
 * saved text files (adapted only for portable fonts or a superseded approved
 * toolchain) plus verified original artwork. No Makeborne metadata is added. */
export function websiteProjectExportFiles(input: unknown, artwork: Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>) {
  const version = ArtifactVersionSchema.parse(input);
  if (!version.content.websiteSource) throw new Error("Choose a full-source website revision.");
  const {source, sourceHash, manifest: sourceManifest} = websiteProjectManifest(version.content.websiteSource);
  const verified = websiteSourceFiles(source, artwork);
  const toolchain = compatibility.portableToolchainFiles(source.files, projectPackage, projectLock);
  const portable = portableFonts.portableFontFiles(toolchain.files);
  const textFiles = [...portable.files, ...fontLicenseFiles(portable.fonts)];
  const textPaths = new Set(textFiles.map(file => file.path.toLowerCase()));
  if (textPaths.size !== textFiles.length || source.assets.some(asset => textPaths.has(asset.path.toLowerCase()))) throw new Error("Portable font files conflict with project artwork or source.");
  const allPaths = [...textPaths, ...source.assets.map(asset => asset.path.toLowerCase())];
  if (allPaths.some(path => allPaths.some(other => path !== other && path.startsWith(`${other}/`)))) throw new Error("Portable font files conflict with a project directory.");
  const entries = [...textFiles.map(file => ({path: file.path, bytes: Buffer.from(file.content)})),
    ...verified.filter(file => source.assets.some(asset => asset.path === file.path))];
  return {version, source, sourceHash, sourceManifest, toolchain, portable, entries};
}

/** Export saved source with an identified, deterministic portable font adaptation. */
export async function websiteProjectSourceBundle(input: unknown, artwork: Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>) {
  const {version, source, sourceHash, sourceManifest, toolchain, portable, entries} = websiteProjectExportFiles(input, artwork);
  const zip = new JSZip();
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  if (portable.fonts.length || toolchain.compatibility !== "current") entries.push({path: ".makeborne/original-source.json", bytes: Buffer.from(`${canonicalSourceJson(source)}\n`)});
  const manifest = {schemaVersion: 1, adapter: "makeborne-full-source-archive-v2", artifactId: version.artifactId,
    revisionId: version.id, version: version.number, sourceHash, source: sourceManifest,
    materialization: "makeborne-portable-fonts-v1", compatibility: toolchain.compatibility,
    toolchainHash: createHash("sha256").update(canonicalSourceJson({id: source.toolchainId, package: projectPackage, lock: projectLock})).digest("hex"),
    fonts: portable.styles.map(({font, style}) => ({id: font.id, family: font.family, style})),
    files: entries.map(file => ({path: file.path, bytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex")})).sort((a, b) => a.path < b.path ? -1 : 1)};
  const manifestJson = `${canonicalSourceJson(manifest)}\n`;
  entries.push({path: ".makeborne/manifest.json", bytes: Buffer.from(manifestJson)},
    {path: ".makeborne/README.txt", bytes: Buffer.from("This archive contains revision-bound source and verified original project artwork.\nThe source hash identifies the unchanged saved revision; files lists hashes of the derived archive files.\nWhen catalogue fonts are used, original-source.json preserves the exact saved source, and a portable stylesheet plus OFL license files are added. Optional Makeborne font markers are rewritten to that stylesheet.\nRun npm ci --ignore-scripts, then npm run build in an isolated environment. Locked Fontsource dependencies supply the local WOFF2 files; Vite includes them in dist. No external font service is required.\nA source archive does not certify a successful build or safe execution.\nNo platform secrets or customer database contents are included.\n")});
  for (const entry of entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    zip.file(entry.path, entry.bytes, {date: fixedDate, createFolders: false, binary: true, unixPermissions: 0o100644});
  }
  const bytes = await zip.generateAsync({type: "uint8array", compression: "DEFLATE", compressionOptions: {level: 6}, platform: "UNIX"});
  return {bytes, manifest, bundleHash: createHash("sha256").update(manifestJson).digest("hex"), filename: `makeborne-${version.artifactId}-v${version.number}-source.zip`};
}
