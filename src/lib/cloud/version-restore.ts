import { ArtifactContentSchema, ArtifactVersionSchema, type ArtifactContent, type ArtifactVersion } from "../domain";

export function prepareVersionRestore(current: ArtifactContent, version: ArtifactVersion, artifactId: string, currentVersion: number) {
  const content = ArtifactContentSchema.parse(current);
  const target = ArtifactVersionSchema.parse(version);
  if (target.artifactId !== artifactId || target.content.kind !== content.kind) throw new Error("This version belongs to a different project.");
  if (target.number >= currentVersion) throw new Error("Choose an earlier saved version.");
  for (const section of content.sections) {
    for (const [index, block] of section.blocks.entries()) {
      if (!block.locked) continue;
      const restored = target.content.sections.find(item => item.id === section.id)?.blocks[index];
      if (JSON.stringify(restored) !== JSON.stringify(block)) throw new Error("This version would change locked content. Unlock it before restoring.");
    }
  }
  return { content: target.content, style: target.style, assetIds: target.assetIds, changeSummary: `Restored from version ${target.number}` };
}
