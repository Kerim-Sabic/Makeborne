import "server-only";
import { chromium, type Browser, type BrowserContext } from "playwright";
import sharp from "sharp";
import type { Book, Deck } from "../documents/schema";
import { deckFaces, deckHtml } from "../documents/render-deck";
import { BOOK_TRIM, bookHtml } from "../documents/render-book";
import { FONTS } from "../documents/theme";
import { embeddedFontSources } from "../documents/fonts-server";
import { documentPdf, documentPptx } from "../documents/export-server";
import { chromiumLaunchOptions } from "../server/export";
import type { BookEvidence, Coverage, DeckEvidence, ReviewImage, WebsiteEvidence } from "./contract";
import { BOOK_PAGE_PT, type WebsiteProbe } from "./deterministic";
import { inspectPdf, type PdfInspection } from "./pdf-inspect";
import { inspectPptx, type PptxInspection } from "./pptx-inspect";
import { probeSlides, probeWebsite, type ProbeReport, type SlideProbe } from "./probe";

/**
 * Rendered evidence for the independent review, produced on the server from
 * the exact revision: an offline Chromium (no network: only the project's own
 * assets are served, everything else is refused and recorded), scripts off
 * (the static snapshot is what is reviewed), fixed desktop and phone sizes.
 * Exports are the real exporters (documentPdf / documentPptx), inspected as
 * files. Every limitation is returned as coverage, never implied away.
 */
export const REVIEW_VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900, tiles: 2, scale: 0.75 },
  phone: { width: 390, height: 844, tiles: 3, scale: 1 },
});
const ORIGIN = "https://review.makeborne.invalid";
if (BOOK_TRIM.width * 72 !== BOOK_PAGE_PT.width || BOOK_TRIM.height * 72 !== BOOK_PAGE_PT.height) throw new Error("Book trim size and review page size disagree.");

/** Serves a project asset for a same-origin path; null: it does not exist (the image is broken); "unavailable": not served here (unknown, not broken). */
export type AssetResolver = (path: string) => Promise<{ body: Buffer; contentType: string } | null | "unavailable">;
export type Launch = () => Promise<Browser>;
const defaultLaunch: Launch = async () => chromium.launch({ headless: true, ...(await chromiumLaunchOptions()) });

async function offlineContext(browser: Browser, viewport: { width: number; height: number }, documents: Map<string, string>, assets: AssetResolver, blocked: Set<string>): Promise<BrowserContext> {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport, deviceScaleFactor: 1 });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { blocked.add(route.request().url()); return route.abort("blockedbyclient"); }
    const html = documents.get(url.pathname);
    if (html !== undefined && route.request().resourceType() === "document") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    const asset = await assets(url.pathname).catch(() => "unavailable" as const);
    if (asset === "unavailable") { blocked.add(route.request().url()); return route.abort("blockedbyclient"); }
    return asset ? route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body }) : route.fulfill({ status: 404, body: "" });
  });
  return context;
}

async function jpeg(png: Buffer, width: number): Promise<{ data: string; width: number; height: number }> {
  const { data, info } = await sharp(png).resize({ width, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true });
  return { data: data.toString("base64"), width: info.width, height: info.height };
}
const slug = (value: string) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";

export type WebsiteCapture = { evidence: WebsiteEvidence; probes: WebsiteProbe[]; coverage: Coverage };
export async function captureWebsite(input: {
  routes: readonly { path: string; html: string }[]; assets: AssetResolver; targets?: readonly string[];
  declaredRoutes?: readonly string[]; launch?: Launch; screenshots?: boolean;
  /** Sanitised snapshots drop image sources they cannot vouch for: an image without src is then unknown, not broken. */
  absentSrcUnknown?: boolean;
}): Promise<WebsiteCapture> {
  const documents = new Map(input.routes.map(route => [route.path, route.html] as const));
  const browser = await (input.launch ?? defaultLaunch)();
  const images: ReviewImage[] = [], probes: WebsiteProbe[] = [];
  const routes: WebsiteEvidence["routes"] = [];
  const notInspected: Coverage["notInspected"] = [
    { what: "scripts, motion, hover, focus and menus", reason: "the review renders the saved static snapshot with scripts off" },
    { what: "form sending", reason: "forms are inspected for labels and submit buttons but never submitted" },
  ];
  try {
    for (const route of input.routes) {
      let text = "";
      const viewports: WebsiteEvidence["routes"][number]["viewports"] = [];
      for (const viewport of ["desktop", "phone"] as const) {
        const size = REVIEW_VIEWPORTS[viewport], blocked = new Set<string>();
        const context = await offlineContext(browser, { width: size.width, height: size.height }, documents, input.assets, blocked);
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(15_000);
          let report: ProbeReport | null = null, error: string | undefined;
          try {
            await page.goto(`${ORIGIN}${route.path}`, { waitUntil: "load", timeout: 15_000 });
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
            report = await page.evaluate(probeWebsite, { width: size.width, targets: [...(input.targets ?? [])] });
          } catch (cause) { error = cause instanceof Error ? cause.message.split("\n")[0].slice(0, 200) : "the route did not render"; }
          // Image URLs refused as off-project are unknown, not broken.
          const off = report ? report.failedImages.filter(image => {
            if (!image.src.trim()) return Boolean(input.absentSrcUnknown);
            try { const url = new URL(image.src, `${ORIGIN}${route.path}`); return url.origin !== ORIGIN || blocked.has(url.href); } catch { return false; }
          }).map(image => image.src) : [];
          probes.push({ route: route.path, viewport, report, ...(error ? { error } : {}), blocked: off });
          if (off.length) notInspected.push({ what: `${off.length} image(s) on ${route.path} at ${viewport}`, reason: "not loaded by the review capture (outside the project, not served here, or removed by the snapshot sanitiser)" });
          const ids: string[] = [];
          if (report && input.screenshots !== false) {
            const tiles = Math.min(size.tiles, Math.max(1, Math.ceil(report.pageHeight / size.height)));
            for (let tile = 0; tile < tiles; tile++) {
              const top = tile * size.height, height = Math.min(size.height, report.pageHeight - top);
              if (height < 120 && tile > 0) break;
              const shot = await page.screenshot({ type: "png", clip: { x: 0, y: top, width: size.width, height }, fullPage: true });
              const image = await jpeg(shot, Math.round(size.width * size.scale));
              const id = `img-${slug(route.path)}-${viewport}-${tile + 1}`.slice(0, 60);
              images.push({ id, label: `${route.path} ${viewport} ${size.width}px, screen ${tile + 1} of ${tiles}`, mediaType: "image/jpeg", ...image });
              ids.push(id);
            }
            if (report.pageHeight > tiles * size.height) notInspected.push({ what: `${route.path} ${viewport} below ${tiles * size.height}px (screenshots)`, reason: "screenshots are limited per route; deterministic checks cover the whole page" });
          }
          if (viewport === "desktop") text = report?.text ?? "";
          viewports.push({ viewport, width: size.width, height: size.height, pageHeight: report?.pageHeight ?? 0, capturedHeight: Math.min(report?.pageHeight ?? 0, ids.length * size.height), images: ids });
        } finally { await context.close(); }
      }
      routes.push({ path: route.path, text: text.slice(0, 20_000), viewports });
    }
  } finally { await browser.close(); }
  const supplied = new Set(input.routes.map(route => route.path));
  const internal = new Set<string>(input.declaredRoutes ?? []);
  for (const probe of probes) for (const link of probe.report?.links ?? []) {
    const match = /^(?:#)?(\/[A-Za-z0-9/_-]*)$/.exec(link.href);
    if (match) internal.add(match[1] === "" ? "/" : match[1]);
  }
  for (const path of [...internal].filter(path => !supplied.has(path)).slice(0, 20)) notInspected.push({ what: `route ${path}`, reason: "not supplied for this review" });
  return {
    evidence: { kind: "website", routes, images },
    probes,
    coverage: { inspected: input.routes.flatMap(route => [`${route.path} at desktop 1440×900`, `${route.path} at phone 390×844`]), notInspected: notInspected.slice(0, 40) },
  };
}

export type DeckCapture = { evidence: DeckEvidence; pptx: PptxInspection | null; exportError: string | null; probes: SlideProbe[] | null; coverage: Coverage };
export async function captureDeck(deck: Deck, buffers: Record<string, Buffer>, imageUrls: Record<string, string>, options: { launch?: Launch; screenshots?: boolean; pptx?: (deck: Deck) => Promise<Buffer> } = {}): Promise<DeckCapture> {
  let pptx: PptxInspection | null = null, exportError: string | null = null;
  try { pptx = await inspectPptx(await (options.pptx ?? (doc => documentPptx(doc, buffers)))(deck)); }
  catch (cause) { exportError = cause instanceof Error ? cause.message.slice(0, 200) : "PPTX export failed"; }
  const images: ReviewImage[] = [];
  let probes: SlideProbe[] | null = null;
  const browser = await (options.launch ?? defaultLaunch)();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: 1280, height: 720 } });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.setContent(deckHtml(deck, imageUrls, "print", await embeddedFontSources(deckFaces(deck))), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    probes = await page.evaluate(probeSlides);
    if (options.screenshots !== false) {
      const slides = await page.$$("section.slide");
      for (const [index, slide] of slides.slice(0, 20).entries()) {
        const image = await jpeg(await slide.screenshot({ type: "png" }), 960);
        images.push({ id: `img-slide-${index + 1}`, label: `Slide ${index + 1} as rendered (1280×720)`, mediaType: "image/jpeg", ...image });
      }
    }
    await context.close();
  } catch { probes = null; } finally { await browser.close(); }
  const evidence: DeckEvidence = {
    kind: "deck", images,
    slides: deck.slides.map((slide, index) => ({
      slide: index + 1, slideId: slide.id, title: slide.title.slice(0, 200), text: (probes?.[index]?.text ?? pptx?.slides[index]?.text ?? slide.title).slice(0, 4000),
      imageId: images[index]?.id ?? null, notes: pptx?.slides[index]?.notes ?? null, charts: pptx?.slides[index]?.charts ?? [], pictures: pptx?.slides[index]?.pictures ?? 0,
      sourceHasChart: slide.layout === "chart" && Boolean(slide.chart),
    })),
  };
  const notInspected: Coverage["notInspected"] = [{ what: "presenter-mode motion and transitions", reason: "slides are reviewed as still print renders" },
    { what: "PowerPoint's own rendering of the PPTX", reason: "the PPTX is inspected as a package (charts, notes, text), not rendered by PowerPoint" }];
  if (deck.slides.length > 20) notInspected.push({ what: `slides 21–${deck.slides.length} (images)`, reason: "at most 20 slide images are reviewed visually; deterministic checks cover every slide" });
  if (!probes) notInspected.push({ what: "slide text fit", reason: "the slides could not be rendered" });
  return { evidence, pptx, exportError, probes, coverage: { inspected: [`${deck.slides.length} slide(s) rendered at 1280×720`, "exported PPTX package"], notInspected } };
}

export type BookCapture = { evidence: BookEvidence; pdf: PdfInspection | null; exportError: string | null; coverage: Coverage };
export async function captureBook(book: Book, buffers: Record<string, Buffer>, imageUrls: Record<string, string>, options: { launch?: Launch; screenshots?: boolean; pdf?: (book: Book) => Promise<Buffer> } = {}): Promise<BookCapture> {
  let pdf: PdfInspection | null = null, exportError: string | null = null;
  try { pdf = inspectPdf(await (options.pdf ?? (doc => documentPdf(doc, buffers)))(book)); }
  catch (cause) { exportError = cause instanceof Error ? cause.message.slice(0, 200) : "PDF export failed"; }
  const images: ReviewImage[] = [];
  const notInspected: Coverage["notInspected"] = [{ what: "rasters of the exported PDF pages", reason: "no PDF rasteriser runs here: page images use the PDF page box and margins, paginated by whole lines (breaks, heads, folios may differ); size, count and balance are measured on the PDF" }];
  if (options.screenshots !== false) {
    const browser = await (options.launch ?? defaultLaunch)();
    try {
      // The PDF's page box: full pages (cover, title, contents, openers) print without margins; text pages inside the @page margins.
      const px = (inches: number) => Math.round(inches * 96);
      const pageW = px(BOOK_TRIM.width), pageH = px(BOOK_TRIM.height), top = px(BOOK_TRIM.top), contentH = pageH - top - px(BOOK_TRIM.bottom);
      const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: pageW, height: pageH } });
      await context.route("**/*", route => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      // On screen @page margins do not apply: text pages get the same side margins (recto: inside left, outside right).
      const margins = `<style>.chapter{box-sizing:border-box;padding-left:${px(BOOK_TRIM.inside)}px!important;padding-right:${px(BOOK_TRIM.outside)}px!important}</style>`;
      await page.setContent(bookHtml(book, imageUrls, "print", await embeddedFontSources(FONTS[book.theme.fonts].faces)).replace("</head>", `${margins}</head>`), { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const plan = await page.evaluate(({ contentH }) => {
        const slices: { kind: "full" | "text"; y: number; h: number }[] = [];
        const range = document.createRange();
        for (const element of Array.from(document.body.children)) {
          const box = element.getBoundingClientRect(), start = box.top + window.scrollY, end = start + box.height;
          if (box.height < 1) continue;
          if (element.classList.contains("full")) { slices.push({ kind: "full", y: Math.round(start), h: Math.round(box.height) }); continue; }
          if (!element.classList.contains("chapter")) continue;
          // Units a page break must not cut: every line box, and pictures, tables, notes and quotes.
          const units: [number, number][] = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) if (rect.height > 0) units.push([rect.top + window.scrollY, rect.bottom + window.scrollY]);
          }
          for (const block of Array.from(element.querySelectorAll("img,figure,table,.note,.ph,.table,blockquote"))) {
            const rect = block.getBoundingClientRect();
            if (rect.height > 0 && rect.height < contentH) units.push([rect.top + window.scrollY, rect.bottom + window.scrollY]);
          }
          for (let pageStart = start; pageStart < end - 1;) {
            let cut = Math.min(pageStart + contentH, end), moved = true;
            while (moved) { moved = false; for (const [a, b] of units) if (a > pageStart + 1 && a < cut && b > cut) { cut = a; moved = true; } }
            if (cut <= pageStart + 1) cut = Math.min(pageStart + contentH, end);
            slices.push({ kind: "text", y: Math.floor(pageStart), h: Math.max(1, Math.ceil(cut - pageStart)) });
            pageStart = cut;
          }
        }
        return { slices, background: getComputedStyle(document.body).backgroundColor };
      }, { contentH });
      const [r, g, b] = (plan.background.match(/\d+(\.\d+)?/g) ?? ["255", "255", "255"]).map(Number);
      const shown = plan.slices.slice(0, 8);
      for (const [index, slice] of shown.entries()) {
        const shot = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: slice.y, width: pageW, height: Math.min(slice.kind === "full" ? pageH : contentH, slice.h) } });
        const png = slice.kind === "full" ? shot : await sharp({ create: { width: pageW, height: pageH, channels: 3, background: { r, g, b } } }).composite([{ input: shot, left: 0, top }]).png().toBuffer();
        const image = await jpeg(png, pageW);
        images.push({ id: `img-print-${index + 1}`, label: slice.kind === "full" ? `Page ${index + 1}: full page as printed (not a raster of the PDF)` : `Page ${index + 1}: text page with the PDF's page box and margins (not a raster of the PDF)`, mediaType: "image/jpeg", ...image });
      }
      if (plan.slices.length > shown.length) notInspected.push({ what: `pages after page ${shown.length} of the print layout`, reason: "at most 8 pages are reviewed visually" });
      await context.close();
    } catch { notInspected.push({ what: "print layout images", reason: "the print layout could not be rendered" }); }
    finally { await browser.close(); }
  }
  if (!pdf && !exportError) notInspected.push({ what: "exported PDF structure", reason: "the PDF could not be read by the inspector" });
  return {
    evidence: { kind: "book", pdf, images, chapters: book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title.slice(0, 200), text: chapter.text.slice(0, 40_000) })) },
    pdf, exportError,
    coverage: { inspected: [pdf ? `exported PDF: ${pdf.pageCount} page(s)` : "PDF export attempted", ...(images.length ? [`${images.length} print layout slice(s)`] : [])], notInspected },
  };
}
