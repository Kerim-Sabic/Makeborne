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
const SPEAKER_NOTES = /^Speaker notes:\s*/;
/** Generated decks store each slide's presenter notes as a callout block starting
 * "Speaker notes:". They belong to the presenter, never on the slide itself. */
export const isSpeakerNotes = (block: Pick<Block, "type" | "text">) => block.type === "callout" && SPEAKER_NOTES.test(block.text);
export const speakerNotesText = (block: Pick<Block, "text">) => block.text.replace(SPEAKER_NOTES, "").trim();
/** Slides with presenter notes separated from visible content. */
export function previewSlides(content: ArtifactContent): {id:string;title:string;blocks:Block[];design?:SlideDesign;notes?:string}[] {
  // A section's slide takes the section id, or its leading heading block's id when it has one.
  const notes = new Map(content.sections.flatMap(section => {
    const text = section.blocks.filter(isSpeakerNotes).map(speakerNotesText).join("\n\n");
    const heading = section.blocks[0]?.type === "heading" ? [[section.blocks[0].id, text] as const] : [];
    return [[section.id, text] as const, ...heading];
  }));
  const visible = {...content, sections: content.sections.map(section => ({...section, blocks: section.blocks.filter(block => !isSpeakerNotes(block))}))};
  return slidesFor(visible).map(slide => notes.get(slide.id) ? {...slide, notes: notes.get(slide.id)} : slide);
}
function slidesFor(content: ArtifactContent): {id:string;title:string;blocks:Block[];design?:SlideDesign}[] {
  if(content.sections.some(section=>section.slideDesign))return content.sections.flatMap(section=>section.slideDesign?[{id:section.id,title:section.title,blocks:section.blocks,design:section.slideDesign}]:groupPresentationBlocks(content.title,previewBlocks({...content,sections:[section]})));
  return groupPresentationBlocks(content.title, previewBlocks(content));
}
