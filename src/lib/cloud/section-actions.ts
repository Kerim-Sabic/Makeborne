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
  if(section.slideDesign)throw new Error("Adding content to a custom slide requires placing its new element on the canvas.");
  section.blocks.push({ id, type: z.enum(["heading", "paragraph", "quote"]).parse(type), text: "", sourceIds: [], assetId: null, locked: false });
  return ArtifactContentSchema.parse(content);
}

export type RemovedAccountSection = { index: number; section: ArtifactContent["sections"][number] };
function locateSection(input: ArtifactContent, sectionId: string) {
  const content = ArtifactContentSchema.parse(input);
  const index = content.sections.findIndex(section => section.id === sectionId);
  if (index < 0) throw new Error("This section is no longer available.");
  if (content.sections[index].blocks.some(block => block.locked)) throw new Error("This section contains locked content.");
  return { content, index };
}
export function moveAccountSection(input: ArtifactContent, sectionId: string, direction: -1 | 1) {
  if (direction !== -1 && direction !== 1) throw new Error("Choose an adjacent section position.");
  const { content, index } = locateSection(input, sectionId);
  const next = index + direction;
  if (next < 0 || next >= content.sections.length) throw new Error("This section is already at the edge of the document.");
  if (content.sections[next].blocks.some(block => block.locked)) throw new Error("A section containing locked content cannot be moved.");
  [content.sections[index], content.sections[next]] = [content.sections[next], content.sections[index]];
  return content;
}
export function removeAccountSection(input: ArtifactContent, sectionId: string) {
  const { content, index } = locateSection(input, sectionId);
  const [section] = content.sections.splice(index, 1);
  return { content, removed: { index, section } };
}
export function restoreAccountSection(input: ArtifactContent, removed: RemovedAccountSection) {
  const content = ArtifactContentSchema.parse(input);
  if (!Number.isInteger(removed.index) || removed.index < 0) throw new Error("Invalid original section position.");
  content.sections.splice(Math.min(removed.index, content.sections.length), 0, structuredClone(removed.section));
  return ArtifactContentSchema.parse(content);
}

export function appendAccountImage(input: ArtifactContent, sectionId: string, blockId: string, assetId: string) {
  const content = ArtifactContentSchema.parse(input);
  const section = content.sections.find(item => item.id === sectionId);
  if (!section) throw new Error("The target section is no longer available.");
  if(section.slideDesign)throw new Error("Adding artwork to a custom slide requires placing its new element on the canvas.");
  section.blocks.push({ id: blockId, type: "image", text: "", sourceIds: [], assetId: z.string().uuid().parse(assetId), locked: false });
  return ArtifactContentSchema.parse(content);
}
