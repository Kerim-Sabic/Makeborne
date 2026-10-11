import { ArtifactContentSchema, StyleProfileSchema } from "../domain";
import type { ExportRequest } from "../server/export";
import {previewSlides} from "./preview-content";

export type AccountExportFormat = "html" | "pdf" | "pptx" | "epub";
export function accountExportRequest(contentInput: unknown, styleInput: unknown, options: {
  format: AccountExportFormat; documentId: string; author?: string; language?: string;
}, artwork: ReadonlyMap<string, string> = new Map()): ExportRequest {
  const content = ArtifactContentSchema.parse(contentInput);
  if (content.websiteSource) throw new Error("Download this project's source. Rendered exports require its verified build.");
  const style = StyleProfileSchema.parse(styleInput);
  if ((options.format === "html" && content.kind !== "website") || (options.format === "pptx" && content.kind !== "presentation") || (options.format === "epub" && content.kind !== "book")) throw new Error("Choose a format supported by this project.");
  if (options.format === "epub" && !options.language) throw new Error("Choose a book language before exporting EPUB.");
  const blocks: ExportRequest["blocks"] = [];
  for (const section of content.sections) {
    if (section.title && !(section.blocks[0]?.type === "heading" && section.blocks[0].text === section.title)) blocks.push({ id: section.id, type: "heading", text: section.title });
    for (const block of section.blocks) {
      if (block.type === "image" && block.assetId) {
        const image = artwork.get(block.assetId);
        if (!image || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error("Artwork could not be included. Retry the export; nothing has been removed.");
        blocks.push({ id: block.id, type: "image", text: block.text, image });
        continue;
      }
      if (block.assetId || !["heading", "paragraph", "quote"].includes(block.type)) throw new Error("This document contains artwork or structured blocks that this export cannot preserve yet. Download its source draft instead; nothing has been removed.");
      blocks.push({ id: block.id, type: block.type as "heading" | "paragraph" | "quote", text: block.text });
    }
  }
  if (blocks.length > 150 || blocks.some(block => block.text.length > 20000)) throw new Error("This document exceeds the current export limit of 150 blocks and 20,000 characters per block. Your full source draft remains available.");
  const heading = style.typography.headingFont;
  if (!["Source Serif 4", "Georgia", "Inter", "Arial"].includes(heading) || !["Inter", "Arial"].includes(style.typography.bodyFont)) throw new Error("This export does not support the document’s fonts yet. Its source draft preserves your typography settings.");
  const { accent, canvas, ink } = style.colors;
  if (!accent || !canvas || !ink) throw new Error("Choose a complete colour palette before exporting.");
  const byId=new Map(blocks.map(block=>[block.id,block]));
  const slides:ExportRequest["slides"]=content.kind==='presentation'&&content.sections.some(section=>section.slideDesign)?previewSlides(content).map(slide=>{
    const sourceBlocks=slide.blocks.map(block=>({...byId.get(block.id)!,id:block.id,assetId:block.assetId,type:block.type as 'paragraph'|'quote'|'image'}));
    const image=sourceBlocks.find(block=>block.image)?.image;
    return {id:slide.id,title:slide.title,body:sourceBlocks.map(block=>block.text).filter(Boolean).join('\n\n'),...(slide.design?{design:slide.design,sourceBlocks}:image?{image}:{})};
  }):[];
  return {
    ...options, kind: content.kind, title: content.title, styleId: style.id,
    style: { id: style.id, name: style.name, color: accent, background: canvas, textColor: ink, font: heading === "Source Serif 4" || heading === "Georgia" ? "serif" : "sans" },
    presentationMode: "native", blocks, slides,
  };
}
