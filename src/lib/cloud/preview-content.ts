import type { ArtifactContent } from "../domain";
import {groupPresentationBlocks} from "../presentations/composition";
import type {SlideDesign} from "../presentations/slide-design";
type Block = ArtifactContent["sections"][number]["blocks"][number];
export function previewBlocks(content: ArtifactContent): Block[] {
  return content.sections.flatMap(section => [
    ...(section.title && !(section.blocks[0]?.type === "heading" && section.blocks[0].text === section.title)
      ? [{ id: section.id, type: "heading" as const, text: section.title, assetId: null, locked: false, sourceIds: [] }] : []),
    ...section.blocks,
  ]);
}
export function previewSlides(content: ArtifactContent): {id:string;title:string;blocks:Block[];design?:SlideDesign}[] {
  if(content.sections.some(section=>section.slideDesign))return content.sections.flatMap(section=>section.slideDesign?[{id:section.id,title:section.title,blocks:section.blocks,design:section.slideDesign}]:groupPresentationBlocks(content.title,previewBlocks({...content,sections:[section]})));
  return groupPresentationBlocks(content.title, previewBlocks(content));
}
