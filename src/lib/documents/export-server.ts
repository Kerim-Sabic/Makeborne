import "server-only";
import { chromium } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentSource } from "./schema";
import { deckFaces, deckHtml, deckPage } from "./render-deck";
import { bookHtml, bookPagePx } from "./render-book";
import { pageKind, verifiedPage } from "./book-art";
import { deckPptx } from "./pptx";
import { FONTS } from "./theme";
import { embeddedFontSources } from "./fonts-server";
import { bookHeadings, bookPagesFromOutline, fixPdfBookmarks, pdfOutline } from "./book-pagination";
import { chromiumLaunchOptions } from "../server/export";
import { downloadProjectAsset } from "../cloud/asset-storage";
import { fitArtwork } from "./artwork-fit";

/** Read the document's generated artwork through the caller's RLS-bound client. */
export async function loadDocumentImages(client: SupabaseClient, workspaceId: string, projectId: string, doc: DocumentSource) {
  const buffers: Record<string, Buffer> = {};
  const ids = doc.assets.map(asset => asset.id);
  if (!ids.length) return buffers;
  const { data, error } = await client.from("assets").select("id,object_path,content_type").eq("workspace_id", workspaceId).eq("project_id", projectId).in("id", ids);
  if (error) throw new Error("Asset registry unavailable.");
  for (const asset of doc.assets) {
    const row = data?.find(entry => entry.id === asset.id);
    if (!row || !String(row.object_path).startsWith(`${workspaceId}/`) || !["image/png", "image/jpeg", "image/webp"].includes(row.content_type)) continue;
    const file = await downloadProjectAsset(client, { workspaceId, projectId }, row.object_path);
    if (file.error || !file.data || file.data.size > 12_000_000) continue;
    buffers[asset.name] = Buffer.from(await file.data.arrayBuffer());
  }
  return buffers;
}

/** Downscale for print (300 dpi at the largest placement is plenty) within the export artwork limits: each image under
 * 3 MB, all together under 12 MB (artwork-fit.ts). */
async function dataUrls(buffers: Record<string, Buffer>) {
  const fitted = await fitArtwork(buffers);
  return Object.fromEntries(Object.entries(fitted).map(([name, jpeg]) => [name, `data:image/jpeg;base64,${jpeg.toString("base64")}`]));
}

/** Print the same HTML the preview shows, in an offline, script-free browser.
 * The document's typefaces are embedded: the serverless Chromium has only Open Sans.
 * Books print twice (book-pagination.ts): the first PDF's bookmarks give each
 * chapter's page, and the second adds the contents page numbers and blank
 * versos so chapter openers fall on right-hand pages. */
export async function documentPdf(doc: DocumentSource, buffers: Record<string, Buffer>) {
  const images = await dataUrls(buffers);
  // A deck's art direction may add faces (monospaced labels) beyond its pairing.
  const fonts = await embeddedFontSources(doc.kind === "deck" ? deckFaces(doc) : FONTS[doc.theme.fonts].faces);
  const browser = await chromium.launch({ headless: true, ...(await chromiumLaunchOptions()) });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: doc.kind === "deck" ? deckPage(doc) : bookPagePx(doc) });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const print = async (html: string) => {
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      await page.emulateMedia({ media: "print" });
      // Embedded faces decode asynchronously; print only once they are ready.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: doc.kind === "book" }));
    };
    if (doc.kind === "deck") return await print(deckHtml(doc, images, "print", fonts));
    const first = await print(bookHtml(doc, images, "print", fonts));
    const spreads = doc.chapters.filter(chapter => verifiedPage(doc, chapter.id) && pageKind(doc, chapter.id) === "spread").map(chapter => chapter.id);
    const pages = bookPagesFromOutline(doc, pdfOutline(first), spreads);
    // Bookmarks carry the headings as written (Chromium drops the space at a soft line break).
    return fixPdfBookmarks(pages ? await print(bookHtml(doc, images, "print", fonts, pages)) : first, bookHeadings(doc));
  } finally {
    await browser.close();
  }
}

/** `missing` receives the names of images the deck places but whose bytes could not be loaded (they are left out, not drawn as boxes). */
export async function documentPptx(doc: DocumentSource, buffers: Record<string, Buffer>, missing: string[] = []) {
  if (doc.kind !== "deck") throw new Error("PPTX is available for presentations.");
  return deckPptx(doc, buffers, missing);
}
