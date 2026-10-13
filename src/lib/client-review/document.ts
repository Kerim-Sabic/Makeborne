import { DocumentSourceSchema, type DocumentSource } from "../documents/schema";
import { deckHtml } from "../documents/render-deck";
import { bookHtml } from "../documents/render-book";
import { parseBookMarkup } from "../documents/book-markup";

/** Only artwork actually placed in the canonical document is fetched. */
export function reviewDocumentAssets(doc: DocumentSource) {
  const names = new Set<string>();
  const add = (name?: string) => { if (name) names.add(name); };
  if (doc.kind === "deck") doc.slides.forEach(slide => add(slide.image));
  else {
    add(doc.cover.image);
    doc.chapters.forEach(chapter => {
      add(chapter.image);
      parseBookMarkup(chapter.text).forEach(block => { if (block.type === "figure") add(block.image); });
    });
  }
  return [...names].map(name => {
    const asset = doc.assets.find(item => item.name === name);
    if (!asset) throw new Error("A placed image is missing from this document. Ask the team to save a complete version.");
    return asset;
  });
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; form-action 'none'; base-uri 'none'">`;

/** Reuse the owner's canonical preview layout, without presenter-only markup.
 * Images are decoded raster data from the token-authorized asset route. */
export function reviewDocumentHtml(input: unknown, images: Readonly<Record<string, string>>) {
  const doc = DocumentSourceSchema.parse(input);
  const placed = reviewDocumentAssets(doc);
  const safeImages: Record<string, string> = {};
  for (const asset of placed) {
    const image = images[asset.name];
    if (!image || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      throw new Error("Artwork is still unavailable. Retry before approving this version.");
    }
    safeImages[asset.name] = image;
  }
  // Erase the values before rendering as defense in depth. The anonymous read
  // projection also removes these fields before this component ever receives it.
  doc.assets.forEach(asset => { asset.prompt = ""; });
  doc.theme.imageStyle = ""; doc.theme.mood = "";
  if (doc.kind === "deck") doc.slides.forEach(slide => { slide.notes = ""; });
  const html = doc.kind === "deck"
    ? deckHtml(doc, safeImages, "preview").replace(/<details><summary>Speaker notes<\/summary><p>[\s\S]*?<\/p><\/details>/g, "")
    : bookHtml(doc, safeImages, "preview");
  return html.replace("<head>", `<head>${CSP}`);
}
