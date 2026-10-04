import { ArtifactContentSchema, type ArtifactContent } from "../domain";
import { z } from "zod";

export function appendAccountSection(input: ArtifactContent, id: string, title: string) {
  const content = ArtifactContentSchema.parse(input);
  content.sections.push({ id: z.string().uuid().parse(id), title, blocks: [] });
  return ArtifactContentSchema.parse(content);
}

export function appendAccountBlock(input: ArtifactContent, sectionId: string, id: string, type: "heading" | "paragraph" | "quote") {
  const content = ArtifactContentSchema.parse(input);
  const section = content.sections.find(item => item.id === sectionId);
  if (!section) throw new Error("This section is no longer available.");
  section.blocks.push({ id, type: z.enum(["heading", "paragraph", "quote"]).parse(type), text: "", sourceIds: [], assetId: null, locked: false });
  return ArtifactContentSchema.parse(content);
}
