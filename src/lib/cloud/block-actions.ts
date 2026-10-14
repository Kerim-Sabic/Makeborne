import { ArtifactContentSchema, type ArtifactContent } from "../domain";
import type {SlideDesign} from "../presentations/slide-design";
export type RemovedAccountBlock = { sectionId: string; index: number; block: ArtifactContent["sections"][number]["blocks"][number]; designElements?:{index:number;element:SlideDesign["elements"][number]}[] };
function locate(input: ArtifactContent, sectionId: string, blockId: string) {
  const content = ArtifactContentSchema.parse(input);
  const section = content.sections.find(item => item.id === sectionId);
  const index = section?.blocks.findIndex(item => item.id === blockId) ?? -1;
  if (!section || index < 0) throw new Error("This block is no longer available. Reload the latest content.");
  if (section.blocks[index].locked) throw new Error("This block is locked.");
  return { content, section, index };
}
export function moveAccountBlock(input: ArtifactContent, sectionId: string, blockId: string, direction: -1 | 1) {
  if (direction !== -1 && direction !== 1) throw new Error("Choose an adjacent block position.");
  const { content, section, index } = locate(input, sectionId, blockId);
  const next = index + direction;
  if (next < 0 || next >= section.blocks.length) throw new Error("This block is already at the edge of its section.");
  if (section.blocks[next].locked) throw new Error("A locked block cannot be moved.");
  [section.blocks[index], section.blocks[next]] = [section.blocks[next], section.blocks[index]];
  return content;
}
export function removeAccountBlock(input: ArtifactContent, sectionId: string, blockId: string) {
  const { content, section, index } = locate(input, sectionId, blockId);
  const [block] = section.blocks.splice(index, 1);
  const designElements=section.slideDesign?.elements.flatMap((element,index)=>(element.kind==='image'?element.blockId===blockId:element.source.kind==='block'&&element.source.blockId===blockId)?[{index,element}]:[]);
  if(section.slideDesign)section.slideDesign.elements=section.slideDesign.elements.filter(element=>!designElements!.some(removed=>removed.element.id===element.id));
  return { content:ArtifactContentSchema.parse(content), removed: { sectionId, index, block,...(designElements?{designElements}:{}) } };
}
export function restoreAccountBlock(input: ArtifactContent, removed: RemovedAccountBlock) {
  const content = ArtifactContentSchema.parse(input);
  const section = content.sections.find(item => item.id === removed.sectionId);
  if (!section) throw new Error("The original section is no longer available.");
  if (content.sections.some(item => item.id === removed.block.id || item.blocks.some(block => block.id === removed.block.id))) throw new Error("This block has already been restored.");
  section.blocks.splice(Math.min(removed.index, section.blocks.length), 0, structuredClone(removed.block));
  if(removed.designElements?.length){
    if(!section.slideDesign)throw new Error("The original slide composition is no longer available.");
    for(const {index,element}of removed.designElements){
      if(section.slideDesign.elements.some(current=>current.id===element.id))throw new Error("This slide element has already been restored.");
      section.slideDesign.elements.splice(Math.min(index,section.slideDesign.elements.length),0,structuredClone(element));
    }
  }
  return ArtifactContentSchema.parse(content);
}
