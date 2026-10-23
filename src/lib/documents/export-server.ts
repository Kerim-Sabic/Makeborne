import "server-only";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentSource } from "./schema";
import { deckFaces, deckHtml } from "./render-deck";
import { bookHtml } from "./render-book";
import { deckPptx } from "./pptx";
import { FONTS } from "./theme";
import { embeddedFontSources } from "./fonts-server";
import { chromiumLaunchOptions } from "../server/export";
import { downloadProjectAsset } from "../cloud/asset-storage";

/** Read the document's generated artwork through the caller's RLS-bound client.
 * Bytes are re-hashed against the registered sha256: an object whose bytes do
 * not match its record is left out (never rendered), like a missing one. */
export async function loadDocumentImages(client: SupabaseClient, workspaceId: string, projectId: string, doc: DocumentSource, download = downloadProjectAsset) {
  const buffers: Record<string, Buffer> = {};
  const ids = [...new Set(doc.assets.map(asset => asset.id))];
  if (!ids.length) return buffers;
  const { data, error } = await client.from("assets").select("id,object_path,content_type,sha256").eq("workspace_id", workspaceId).eq("project_id", projectId).in("id", ids);
  if (error) throw new Error("Asset registry unavailable.");
  for (const asset of doc.assets) {
    const row = data?.find(entry => entry.id === asset.id);
    if (!row || !String(row.object_path).startsWith(`${workspaceId}/`) || !["image/png", "image/jpeg", "image/webp"].includes(row.content_type) || !/^[a-f0-9]{64}$/.test(String(row.sha256))) continue;
    const file = await download(client, { workspaceId, projectId }, row.object_path);
    if (file.error || !file.data || file.data.size > 12_000_000) continue;
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) continue;
    buffers[asset.name] = bytes;
  }
  return buffers;
}

/** Downscale for print: 300 dpi at the largest placement is plenty. */
export async function dataUrls(buffers: Record<string, Buffer>) {
  const urls: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(buffers)) {
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    urls[name] = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  }
  return urls;
}

/** Print the same HTML the preview shows, in an offline, script-free browser.
 * The document's typefaces are embedded: the serverless Chromium has only Open Sans. */
export async function documentPdf(doc: DocumentSource, buffers: Record<string, Buffer>) {
  const images = await dataUrls(buffers);
  // A deck's art direction may add faces (monospaced labels) beyond its pairing.
  const fonts = await embeddedFontSources(doc.kind === "deck" ? deckFaces(doc) : FONTS[doc.theme.fonts].faces);
  const html = doc.kind === "deck" ? deckHtml(doc, images, "print", fonts) : bookHtml(doc, images, "print", fonts);
  const browser = await chromium.launch({ headless: true, ...(await chromiumLaunchOptions()) });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: doc.kind === "deck" ? { width: 1280, height: 720 } : { width: 576, height: 864 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    // Embedded faces decode asynchronously; print only once they are ready.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: doc.kind === "book" }));
  } finally {
    await browser.close();
  }
}

export async function documentPptx(doc: DocumentSource, buffers: Record<string, Buffer>) {
  if (doc.kind !== "deck") throw new Error("PPTX is available for presentations.");
  return deckPptx(doc, buffers);
}
