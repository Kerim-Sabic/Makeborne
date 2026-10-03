import "server-only";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { escapeHtml, exportStyle, type ExportRequest } from "./export";
import { RequestError } from "./http";

/** Reflowable EPUB: owned plain text + normalized raster artwork only.
 * Call after ExportRequestSchema and prepareExport. No remote files or scripts.
 */
export async function epubDocument(input: ExportRequest) {
  if (input.kind !== "book" || !input.language)
    throw new RequestError(
      "EPUB_METADATA",
      "Choose the book language before exporting EPUB.",
    );
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const style = exportStyle(input),
    title = escapeHtml(input.title),
    language = escapeHtml(input.language);
  const css = `body{font-family:${style.font === "serif" ? "Georgia,serif" : "Arial,sans-serif"};line-height:1.6;margin:5%;color:#16181D}h1,h2{line-height:1.2}p{white-space:pre-wrap;overflow-wrap:break-word}img{max-width:100%;height:auto}figure{margin:1.5em 0;break-inside:avoid}figcaption{font-size:.8em}blockquote{border-left:3px solid ${style.color};padding-left:1em;margin-left:0}a{color:inherit}.cover{text-align:center}.cover img{max-height:70vh}.cover h1{font-size:2em}.byline{font-style:italic}`;
  zip.file("EPUB/styles.css", css);
  const xhtml = (pageTitle: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}"><head><meta charset="utf-8"/><title>${escapeHtml(pageTitle)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
  const imageFiles = new Map<
    string,
    { href: string; id: string; mime: string }
  >();
  const art = input.blocks.find((block) => block.type === "image");
  for (const block of input.blocks) {
    if (!block.image || imageFiles.has(block.image)) continue;
    const comma = block.image.indexOf(","),
      mime = block.image.slice(5, comma - 7);
    if (!["image/png", "image/jpeg"].includes(mime))
      throw new RequestError(
        "EPUB_IMAGE",
        "EPUB artwork must be normalized before packaging.",
      );
    const id = `image-${imageFiles.size + 1}`,
      href = `images/${id}.${mime === "image/jpeg" ? "jpg" : "png"}`;
    zip.file(
      `EPUB/${href}`,
      Buffer.from(block.image.slice(comma + 1), "base64"),
    );
    imageFiles.set(block.image, { id, href, mime });
  }
  const imageHtml = (block: ExportRequest["blocks"][number]) => {
    const image = block.image ? imageFiles.get(block.image) : undefined;
    if (!image)
      throw new RequestError("EPUB_IMAGE", "The book artwork is missing.");
    return `<figure><img src="${image.href}" alt="${escapeHtml(block.text)}"/>${block.text ? `<figcaption>${escapeHtml(block.text)}</figcaption>` : ""}</figure>`;
  };
  zip.file(
    "EPUB/cover.xhtml",
    xhtml(
      input.title,
      `<section epub:type="cover" class="cover"><h1>${title}</h1>${input.author ? `<p class="byline">${escapeHtml(input.author)}</p>` : ""}${art ? imageHtml(art) : ""}</section>`,
    ),
  );
  const chapters: { title: string; blocks: ExportRequest["blocks"] }[] = [];
  for (const block of input.blocks.filter((block) => block !== art)) {
    if (block.type === "heading" || !chapters.length)
      chapters.push({
        title: block.type === "heading" ? block.text : input.title,
        blocks: block.type === "heading" ? [] : [block],
      });
    else chapters[chapters.length - 1].blocks.push(block);
  }
  if (!chapters.length) chapters.push({ title: input.title, blocks: [] });
  const chapterBody = (block: ExportRequest["blocks"][number]) =>
    block.type === "image"
      ? imageHtml(block)
      : block.type === "quote"
        ? `<blockquote><p>${escapeHtml(block.text)}</p></blockquote>`
        : `<p>${escapeHtml(block.text)}</p>`;
  chapters.forEach((chapter, index) =>
    zip.file(
      `EPUB/chapter-${index + 1}.xhtml`,
      xhtml(
        chapter.title,
        `<section epub:type="chapter"><h1>${escapeHtml(chapter.title)}</h1>${chapter.blocks.map(chapterBody).join("")}</section>`,
      ),
    ),
  );
  const toc = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${escapeHtml(chapter.title)}</a></li>`).join("")}</ol></nav><nav epub:type="landmarks" hidden="hidden"><h2>Landmarks</h2><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="chapter-1.xhtml">Start reading</a></li></ol></nav>`;
  zip.file("EPUB/nav.xhtml", xhtml("Contents", toc));
  const identifier = `urn:uuid:${input.documentId ?? randomUUID()}`,
    modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = `<item id="css" href="styles.css" media-type="text/css"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>${chapters.map((_, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${[...imageFiles.entries()].map(([uri, image]) => `<item id="${image.id}" href="${image.href}" media-type="${image.mime}"${art?.image === uri ? ' properties="cover-image"' : ""}/>`).join("")}`;
  zip.file(
    "EPUB/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:language>${language}</dc:language>${input.author ? `<dc:creator>${escapeHtml(input.author)}</dc:creator>` : ""}<meta property="dcterms:modified">${modified}</meta><meta property="rendition:layout">reflowable</meta></metadata><manifest>${manifest}</manifest><spine><itemref idref="cover"/>${chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join("")}</spine></package>`,
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: "application/epub+zip",
  });
}
