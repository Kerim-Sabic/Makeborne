import type { ArtifactContent } from "../domain";
type Block = ArtifactContent["sections"][number]["blocks"][number];
export function previewBlocks(content: ArtifactContent): Block[] {
  return content.sections.flatMap(section => [
    ...(section.title && !(section.blocks[0]?.type === "heading" && section.blocks[0].text === section.title)
      ? [{ id: section.id, type: "heading" as const, text: section.title, assetId: null, locked: false, sourceIds: [] }] : []),
    ...section.blocks,
  ]);
}
export function previewSlides(content: ArtifactContent) {
  const slides: { id: string; title: string; blocks: Block[] }[] = [];
  for (const block of previewBlocks(content)) {
    if (block.type === "heading") slides.push({ id: block.id, title: block.text, blocks: [] });
    else {
      if (!slides.length) slides.push({ id: block.id, title: content.title, blocks: [] });
      slides[slides.length - 1].blocks.push(block);
    }
  }
  return slides.length ? slides : [{ id: "title", title: content.title, blocks: [] }];
}
