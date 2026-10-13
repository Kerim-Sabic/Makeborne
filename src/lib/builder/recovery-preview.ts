import { ArtifactContentSchema } from "../domain";

/** Validate a durable candidate before sending it to the owner's isolated
 * preview. This never writes a version or authorizes another provider call. */
export function recoveryPreview(candidate: unknown, kind: "website" | "book" | "presentation") {
  const raw = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const parsed = ArtifactContentSchema.safeParse(raw.content);
  if (!parsed.success || parsed.data.kind !== kind) throw new Error("This saved draft cannot be previewed in the current project.");
  const content = parsed.data;
  if (kind === "website") {
    if (!content.websiteSource) throw new Error("This saved website has no complete source preview.");
    return { files: Object.fromEntries(content.websiteSource.files.map(file => [file.path, file.content])), assets: content.websiteSource.assets.map(asset => ({ id: asset.id, path: asset.path })) };
  }
  if (!content.document) throw new Error("This saved draft has no complete document preview.");
  return { files: {}, document: content.document, assets: content.document.assets.map(asset => ({ id: asset.id, path: `public/images/${asset.name}.webp` })) };
}
