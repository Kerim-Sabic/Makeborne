import { ArtifactContentSchema, type ArtifactContent, type StyleProfile } from "../domain";
import type { Block, Style } from "../../components/studio-model";
import { z } from "zod";

/** A view over account content, never a replacement for its canonical structure. */
export function inspectAccountContent(input: unknown) {
  const content = ArtifactContentSchema.parse(input);
  const reasons: string[] = [];
  const blocks: Block[] = [];
  for (const section of content.sections) for (const block of section.blocks) {
    if (!["heading", "paragraph", "quote"].includes(block.type)) reasons.push(`The editor needs support for ${block.type} blocks.`);
    else if (block.assetId) reasons.push("Linked assets need the account asset editor.");
    else blocks.push({ id: block.id, type: block.type as Block["type"], text: block.text });
  }
  if (blocks.length > 500) reasons.push("This document exceeds the current editor block limit.");
  return { editable: reasons.length === 0, reasons: [...new Set(reasons)], blocks: reasons.length ? null : blocks, content };
}

const editedBlocks = z.array(z.object({ id: z.string().uuid(), type: z.enum(["heading", "paragraph", "quote"]), text: z.string().max(50000) }).strict()).max(500);

/** Preserve section titles/IDs, provenance and locks. Ambiguous structural edits
 * fail explicitly instead of flattening a rich account document on its next save.
 */
export function applyAccountTextEdits(original: unknown, input: unknown): ArtifactContent {
  const view = inspectAccountContent(original);
  if (!view.editable) throw new Error(view.reasons.join(" "));
  const blocks = editedBlocks.parse(input);
  const ids = new Set(blocks.map(block => block.id));
  if (ids.size !== blocks.length) throw new Error("Block IDs must be unique.");
  const sectionIds = new Set(view.content.sections.map(section => section.id));
  if (blocks.some(block => sectionIds.has(block.id))) throw new Error("A block cannot reuse a section ID.");
  const originals = new Map(view.content.sections.flatMap((section, index) => section.blocks.map(block => [block.id, { block, index }] as const)));
  for (const { block } of originals.values()) {
    const edited = blocks.find(item => item.id === block.id);
    if (block.locked && (!edited || edited.text !== block.text || edited.type !== block.type)) throw new Error("Unlock this block before changing or removing it.");
  }
  const content = structuredClone(view.content);
  if (!content.sections.length && blocks.length) throw new Error("Create a section before adding content.");
  content.sections.forEach(section => { section.blocks = []; });
  let sectionIndex = blocks.map(block => originals.get(block.id)?.index).find(index => index !== undefined) ?? 0;
  for (const block of blocks) {
    const prior = originals.get(block.id);
    if (prior && prior.index < sectionIndex) throw new Error("Move blocks between sections in the structured editor.");
    sectionIndex = prior?.index ?? sectionIndex;
    content.sections[sectionIndex].blocks.push(prior ? { ...prior.block, ...block } : { ...block, assetId: null, sourceIds: [], locked: false });
  }
  return ArtifactContentSchema.parse(content);
}

export function accountStyleFromStudio(style: Style): StyleProfile {
  return {
    id: style.id, name: style.name, version: 1,
    typography: { headingFont: style.font === "serif" ? "Source Serif 4" : "Inter", bodyFont: "Inter" },
    colors: { accent: style.color, ink: style.textColor ?? "#16181D", canvas: style.background ?? "#F8F7F4" },
    description: style.description, referenceAssetIds: [],
  };
}
