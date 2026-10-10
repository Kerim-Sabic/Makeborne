import "server-only";
import {createHash} from "node:crypto";
import { z } from "zod";
import PptxGenJS from "pptxgenjs";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { RequestError } from "./http";
import { artifactDesignCss } from "../artifact-design";
import {BOOK_PAGE} from "../book-layout";
import {groupPresentationBlocks, slideBoxPercent} from "../presentations/composition";
import {SlideDesignSchema,slideDesignSourceIssues} from "../presentations/slide-design";
import {presentationScene} from "../presentations/render-scene";
import {NATIVE_SLIDE_CSS} from "../presentations/native-css";

const imageSchema = z
  .string()
  .max(4_100_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const styleSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(["serif", "sans"]),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();
export const ExportRequestSchema = z
  .object({
    format: z.enum(["pdf", "pptx", "html", "epub"]),
    documentId: z.string().uuid().optional(),
    author: z.string().trim().max(200).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .optional(),
    kind: z.enum(["website", "book", "presentation"]).default("book"),
    title: z.string().trim().min(1).max(200),
    styleId: z.string().min(1).max(100).default("editorial"),
    style: styleSchema.optional(),
    presentationMode: z.enum(["native", "visual"]).default("native"),
    slideAspectRatio: z.enum(["16:9", "3:2", "4:3", "1:1"]).optional(),
    blocks: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            type: z.enum(["heading", "paragraph", "quote", "image"]),
            text: z.string().max(20000).default(""),
            image: imageSchema.optional(),

          })
          .strict(),
      )
      .max(150)
      .default([]),
    slides: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            title: z.string().max(200),
            body: z.string().max(5000),
            notes: z.string().max(10000).optional(),
            design: SlideDesignSchema.optional(),
            sourceBlocks: z.array(z.object({id:z.string().uuid(),type:z.enum(["paragraph","quote","image"]),text:z.string().max(20000),assetId:z.string().uuid().nullable(),image:imageSchema.optional()}).strict()).max(40).optional(),
            image: imageSchema.optional(),
          })
          .strict(),
      )
      .max(40)
      .default([]),
  })
  .superRefine((input, ctx) => {
    if (input.format === "epub" && (input.kind !== "book" || !input.language))
      ctx.addIssue({
        code: "custom",
        path: ["language"],
        message: "Choose the book language before exporting EPUB.",
      });
    if (input.format === "epub") {
      const values = [
        input.title,
        input.author ?? "",
        ...input.blocks.map((block) => block.text),
      ];
      if (
        values.some(
          (value) =>
            /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(
              value,
            ) ||
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
              value,
            ),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["blocks"],
          message:
            "This text contains characters unsupported by EPUB XML. Review the source text.",
        });
    }
    if (
      !input.style &&
      !["editorial", "venture", "studio"].includes(input.styleId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["style"],
        message: "Include the custom style snapshot.",
      });
    if (input.style && input.style.id !== input.styleId)
      ctx.addIssue({
        code: "custom",
        path: ["style", "id"],
        message: "Style snapshot must match the selected style.",
      });
    const ids = new Set<string>();
    input.blocks.forEach((block, index) => {
      if (ids.has(block.id))
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index, "id"],
          message: "Block IDs must be unique.",
        });
      ids.add(block.id);
      if (block.type === "image" && !block.image)
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index, "image"],
          message: "An image block needs artwork.",
        });
      if (block.type !== "image" && block.image)
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index, "image"],
          message: "Place artwork in an image block.",
        });
    });
    const slideIds = new Set<string>();
    input.slides.forEach((slide, index) => {
      if(slide.design){
        if(input.kind!=="presentation"||input.presentationMode!=="native"||!slide.sourceBlocks||slide.image)ctx.addIssue({code:"custom",path:["slides",index,"design"],message:"Custom geometry requires native slide source blocks."});
        else{
          for(const message of slideDesignSourceIssues(slide.design,{title:slide.title,blocks:slide.sourceBlocks}))ctx.addIssue({code:"custom",path:["slides",index,"design"],message});
          if(slide.body!==slide.sourceBlocks.map(block=>block.text).filter(Boolean).join("\n\n"))ctx.addIssue({code:"custom",path:["slides",index,"body"],message:"Custom slide text must match the supplied source blocks."});
          for(const block of slide.sourceBlocks)if((block.type==='image')!==!!block.image)ctx.addIssue({code:"custom",path:["slides",index,"sourceBlocks"],message:"Each image block requires its own embedded artwork."});
          if(new Set(slide.sourceBlocks.map(block=>block.id)).size!==slide.sourceBlocks.length)ctx.addIssue({code:"custom",path:["slides",index,"sourceBlocks"],message:"Slide source block IDs must be unique."});
        }
      }else if(slide.sourceBlocks)ctx.addIssue({code:"custom",path:["slides",index,"sourceBlocks"],message:"Custom source blocks require saved geometry."});
      if (slideIds.has(slide.id))
        ctx.addIssue({
          code: "custom",
          path: ["slides", index, "id"],
          message: "Slide IDs must be unique.",
        });
      slideIds.add(slide.id);
    });
    if (
      input.presentationMode === "visual" &&
      (!input.slides.length || input.slides.some((slide) => !slide.image))
    )
      ctx.addIssue({
        code: "custom",
        path: ["slides"],
        message:
          "Complete visual slides require one full slide image per slide.",
      });
  });
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function exportStyle(input: ExportRequest): z.infer<typeof styleSchema> {
  return (
    input.style ?? {
      id: input.styleId,
      name: input.styleId,
      color:
        input.styleId === "studio"
          ? "#33544C"
          : input.styleId === "editorial"
            ? "#9B583C"
            : "#3358D4",
      font:
        input.styleId === "editorial" ? ("serif" as const) : ("sans" as const),
    }
  );
}

/** Decode only bounded raster inputs, validate actual format/pixels, strip metadata.
 * No URL fetching, arbitrary file access, SVG, or executable upload is permitted.
 */
export async function prepareExport(
  input: ExportRequest,
): Promise<ExportRequest> {
  const cache = new Map<string, string>();
  let inputBytes = 0,
    outputBytes = 0;
  async function normalise(uri: string) {
    const found = cache.get(uri);
    if (found) return found;
    const comma = uri.indexOf(",");
    const encoded = uri.slice(comma + 1);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || bytes.length > 3_000_000)
      throw new RequestError(
        "IMAGE_SIZE",
        "Each image must be a valid raster image smaller than 3 MB.",
      );
    inputBytes += bytes.length;
    if (inputBytes > 12_000_000)
      throw new RequestError(
        "IMAGE_BUDGET",
        "This export exceeds the 12 MB artwork limit.",
      );
    try {
      const image = sharp(bytes, {
        limitInputPixels: 16_777_216,
        failOn: "warning",
      });
      const metadata = await image.metadata();
      const declared = uri.slice(11, comma - 7);
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 4096 ||
        metadata.height > 4096 ||
        (metadata.pages ?? 1) !== 1 ||
        !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
        metadata.format !== declared
      )
        throw new RequestError(
          "IMAGE_FORMAT",
          "Artwork must be a single PNG, JPEG, or WebP image, at most 4096 pixels per side.",
        );
      const format = metadata.format === "jpeg" ? "jpeg" : "png";
      const pipeline = image
        .rotate()
        .toColourspace("srgb")
        .timeout({ seconds: 8 });
      const output = await (
        format === "jpeg"
          ? pipeline.jpeg({ quality: 95 })
          : pipeline.png({ compressionLevel: 6 })
      ).toBuffer();
      outputBytes += output.length;
      if (output.length > 6_000_000 || outputBytes > 24_000_000)
        throw new RequestError(
          "IMAGE_OUTPUT_SIZE",
          "Artwork is too complex for this bounded export. Use smaller images.",
        );
      const result = `data:image/${format};base64,${output.toString("base64")}`;
      cache.set(uri, result);
      return result;
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(
        "IMAGE_INVALID",
        "This artwork could not be decoded safely. Choose another image.",
      );
    }
  }
  const blocks = [];
  for (const block of input.blocks)
    blocks.push({
      ...block,
      ...(block.image ? { image: await normalise(block.image) } : {}),
    });
  const slides = [];
  for (const slide of input.slides) {
    const sourceBlocks: ExportRequest["slides"][number]["sourceBlocks"] = slide.sourceBlocks ? [] : undefined;
    for (const block of slide.sourceBlocks ?? []) sourceBlocks!.push({...block, ...(block.image ? {image: await normalise(block.image)} : {})});
    slides.push({...slide, ...(slide.image ? {image: await normalise(slide.image)} : {}), ...(sourceBlocks ? {sourceBlocks} : {})});
  }
  let slideAspectRatio = input.slideAspectRatio;
  if (input.presentationMode === "visual") {
    const ratios = { "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "1:1": 1 };
    for (const slide of slides) {
      const bytes = Buffer.from(slide.image!.split(",")[1], "base64");
      const { width, height } = await sharp(bytes, {
        limitInputPixels: 16_777_216,
      }).metadata();
      const ratio = width! / height!;
      if (!slideAspectRatio)
        slideAspectRatio = (
          Object.keys(ratios) as (keyof typeof ratios)[]
        ).sort(
          (a, b) => Math.abs(ratios[a] - ratio) - Math.abs(ratios[b] - ratio),
        )[0];
      if (Math.abs(ratio / ratios[slideAspectRatio] - 1) > 0.01)
        throw new RequestError(
          "SLIDE_ASPECT",
          "Full visual slides must share a supported canvas ratio. Export matching 16:9, 3:2, 4:3, or square images; your original artwork is unchanged.",
        );
    }
  }
  return { ...input, blocks, slides, slideAspectRatio };
}
function slideDimensions(input: ExportRequest) {
  const ratios = { "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "1:1": 1 };
  const ratio =
    input.presentationMode === "visual"
      ? ratios[input.slideAspectRatio ?? "16:9"]
      : 16 / 9;
  return { width: 13.333333, height: 13.333333 / ratio, ratio };
}
function blockHtml(block: ExportRequest["blocks"][number]) {
  const text = escapeHtml(block.text);
  if (block.type === "heading") return `<h2 id="heading-${escapeHtml(block.id)}">${text}</h2>`;
  if (block.type === "quote") return `<blockquote>${text}</blockquote>`;
  if (block.type === "image")
    return `<figure><img src="${block.image}" alt="${text}">${text ? `<figcaption>${text}</figcaption>` : ""}</figure>`;
  return `<p>${text}</p>`;
}
/** Keep a closing quote with its preceding paragraph when they fit together. */
function bookBodyHtml(blocks: ExportRequest["blocks"]) {
  const parts: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index], next = blocks[index + 1], after = blocks[index + 2];
    if (block.type === "paragraph" && next?.type === "quote" && (!after || after.type === "heading")) {
      parts.push(`<div class="book-quote-context">${blockHtml(block)}${blockHtml(next)}</div>`);
      index++;
    } else parts.push(blockHtml(block));
  }
  return parts.join("");
}
export function htmlDocument(input: ExportRequest) {
  const style = exportStyle(input);
  const title = escapeHtml(input.title);
  const font = style.font === "serif" ? "Georgia,serif" : "Arial,sans-serif";
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'";
  const shared = `@page{background:${style.background ?? "#F8F7F4"}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{--artifact-accent:${style.color};margin:0;background:${style.background ?? "#F8F7F4"};color:${style.textColor ?? "#16181D"};font:16px/1.65 ${font}}h1,h2,h3{line-height:1.15;letter-spacing:-.035em}h1{font-size:clamp(36px,5vw,64px)}h2{font-size:30px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}blockquote{border-left:3px solid ${style.color};padding:12px 0 12px 24px;margin:32px 0;font-size:22px}figure{margin:32px 0;break-inside:avoid}img{display:block;max-width:100%;height:auto}figure img{max-height:170mm;object-fit:contain;margin:auto}figcaption{font:12px/1.5 Arial,sans-serif;color:inherit;opacity:.75;margin-top:10px}footer{font:12px/1.5 Arial,sans-serif;color:inherit;opacity:.75;padding:24px 0}a{color:inherit}:focus-visible{outline:3px solid ${style.color};outline-offset:4px}`;
  let content = "",
    css = "";
  if (input.kind === "presentation") {
    const dimensions = slideDimensions(input);
    const slides = effectiveSlides(input);
    content = slides
      .map((slide, index) =>
        input.presentationMode === "visual"
          ? `<section class="slide visual" aria-label="Slide ${index + 1}"><img src="${slide.image}" alt="${escapeHtml(slide.title || `Slide ${index + 1}`)}"></section>`
          : nativeSlideHtml(slide, index, slides.length),
      )
      .join("");
    css = input.presentationMode === "native"
      ? `@page{size:13.333333in 7.5in;margin:0}body{--native-paper:${style.background ?? "#F8F7F4"};--native-ink:${style.textColor ?? "#16181D"};--native-accent:${style.color};--native-heading:${font}}${NATIVE_SLIDE_CSS}.slide{break-after:page}.slide:last-child{break-after:auto}@media print{.slide{width:13.333333in;height:7.5in;aspect-ratio:auto}}`
      : `@page{size:${dimensions.width}in ${dimensions.height}in;margin:0}.slide{width:100%;aspect-ratio:${dimensions.ratio};break-after:page;overflow:hidden}.visual{padding:0;background:#16181D;display:flex;align-items:center;justify-content:center}.visual img{width:100%;height:100%;object-fit:contain}@media print{.slide{width:${dimensions.width}in;height:${dimensions.height}in;aspect-ratio:auto}.slide:last-child{break-after:auto}}`;
  } else if (input.kind === "website") {
    const sections: { title: string; blocks: ExportRequest["blocks"] }[] = [];
    for (const block of input.blocks) {
      if (block.type === "heading" || !sections.length)
        sections.push({
          title: block.type === "heading" ? block.text : "",
          blocks: block.type === "heading" ? [] : [block],
        });
      else sections[sections.length - 1].blocks.push(block);
    }
    const hero = sections.shift();
    const heroImage = hero?.blocks.find((block) => block.type === "image");
    content = `<header class="site-nav"><a href="#home">${title}</a><nav>${sections
      .slice(0, 5)
      .map(
        (section, index) =>
          `<a href="#section-${index}">${escapeHtml(section.title || `Section ${index + 1}`)}</a>`,
      )
      .join(
        "",
      )}</nav></header><main id="home"><section class="site-hero"><div><span class="eyebrow">${escapeHtml(style.name)}</span><h1>${escapeHtml(hero?.title || input.title)}</h1>${
      hero?.blocks
        .filter((block) => block !== heroImage)
        .map(blockHtml)
        .join("") || ""
    }</div>${heroImage ? blockHtml(heroImage) : ""}</section>${sections.map((section, index) => `<section class="site-section" id="section-${index}">${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}<div>${section.blocks.map(blockHtml).join("")}</div></section>`).join("")}</main><footer>© ${new Date().getFullYear()} ${title} · Made with Makeborne</footer>`;
    css = `.site-nav{display:flex;justify-content:space-between;align-items:center;gap:30px;padding:26px 6%;border-bottom:1px solid #DCDDD9;font:14px Arial,sans-serif}.site-nav>a{font-weight:bold;font-size:20px;text-decoration:none}.site-nav nav{display:flex;gap:24px}.site-nav nav a{text-decoration:none}main,body>footer{max-width:1280px;padding:0 6%;margin:auto}.site-hero{display:grid;grid-template-columns:1fr 1fr;gap:8%;align-items:center;padding:90px 0}.site-hero:has(>div:only-child){grid-template-columns:1fr}.site-hero h1{max-width:780px;margin:20px 0 30px}.site-hero figure{margin:0}.site-hero img{max-height:520px;object-fit:contain;border-radius:4px}.eyebrow{font:11px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${style.color}}.site-section{padding:65px 0;border-top:1px solid #DCDDD9}.site-section>div{max-width:850px}.site-section h2{margin-bottom:30px}.site-section figure{max-width:900px}body>footer{padding-top:30px;padding-bottom:30px;border-top:1px solid #DCDDD9}@media(max-width:700px){.site-nav nav{display:none}.site-hero{grid-template-columns:1fr;padding:50px 0;gap:30px}.site-section{padding:40px 0}}@page{size:A4;margin:20mm}@media print{.site-nav nav{display:none}.site-hero{padding:20px 0}.site-section{padding:20px 0}}`;
  } else {
    const art = input.blocks[0]?.type === "image" ? input.blocks[0] : undefined;
    const chapters = input.blocks.filter((block) => block.type === "heading");
    const toc =
      chapters.length > 1
        ? `<section class="contents"><span class="eyebrow">CONTENTS</span><h2>A guide to what follows.</h2><ol>${chapters.map((chapter) => `<li><a href="#heading-${escapeHtml(chapter.id)}">${escapeHtml(chapter.text)}</a></li>`).join("")}</ol></section>`
        : "";
    content = `<section class="cover"><h1>${title}</h1>${input.author ? `<p class="book-author">${escapeHtml(input.author)}</p>` : ""}${art ? `<figure><img class="cover-art" src="${art.image}" alt="${escapeHtml(art.text)}">${art.text ? `<figcaption>${escapeHtml(art.text)}</figcaption>` : ""}</figure>` : ""}<span class="cover-rule"></span></section>${toc}<main class="book-body">${bookBodyHtml(input.blocks.filter((block) => block !== art))}<footer>Made with Makeborne</footer></main>`;
    css = `@page{size:${BOOK_PAGE.widthInches}in ${BOOK_PAGE.heightInches}in;margin:${BOOK_PAGE.marginYInches}in ${BOOK_PAGE.marginXInches}in;@bottom-center{content:counter(page) " / " counter(pages);font:9px Arial,sans-serif;color:${style.textColor ?? "#5C616D"}}}@page:first{@bottom-center{content:none}}.book-quote-context{break-inside:avoid}.cover{min-height:7.8in;break-after:page;padding:12mm 0;display:flex;flex-direction:column;gap:12mm}.cover h1{font-size:44px;margin:0;overflow-wrap:anywhere}.eyebrow{font:11px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${style.color}}.cover-art{width:100%;height:145mm;object-fit:contain}.cover-rule{height:2px;width:60px;background:${style.color};margin-top:auto}.contents{break-after:page;padding:20mm 0}.contents li{padding:8px 0;border-bottom:1px solid #DCDDD9}.book-body h2{margin:35px 0 18px}.book-body h2:not(:first-child){break-before:page}.book-body{font-size:11pt}.book-body p{margin-bottom:20px}.book-body>figure{margin:25px 0}body{padding:40px;max-width:920px;margin:auto}@media print{body{padding:0;max-width:none}.cover{min-height:7.8in}.cover h1{font-size:36px}.book-body h2{margin-top:0}}`;
  }
  const coverPrint = input.kind === "book" ? `@media print{.cover{height:7.8in;min-height:0;gap:6mm}.cover h1{flex:none;margin:0}.cover .book-author{flex:none;margin:0}.cover figure{flex:1;min-height:0;display:flex;flex-direction:column;margin:0}.cover .cover-art{flex:1;min-height:0;height:0;width:100%;max-height:none;object-fit:contain}.cover figcaption{flex:none}.cover-rule{flex:none;margin-top:auto}}` : "";
  return `<!doctype html><html lang="${escapeHtml(input.language ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${title}</title><style>${shared}${css}${input.kind === "presentation" ? "" : artifactDesignCss(input.styleId, input.kind)}${coverPrint}</style></head><body>${content}</body></html>`;
}
async function withExportPage<T>(input: ExportRequest, operation: (page: Page) => Promise<T>, options: {reviewOnly?: boolean} = {}): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setContent(htmlDocument(input), {
      waitUntil: "load",
      timeout: 15000,
    });
    if (input.kind === "book") {
      await page.emulateMedia({ media: "print" });
      // Match the physical book content box used by @page and its cover guard.
      await page.setViewportSize({width: Math.round((BOOK_PAGE.widthInches - 2 * BOOK_PAGE.marginXInches) * 96), height: Math.round((BOOK_PAGE.heightInches - 2 * BOOK_PAGE.marginYInches) * 96)});
      const coverOverflow = await page.evaluate(() => {
        const cover = document.querySelector<HTMLElement>(".cover");
        return !!cover && (cover.scrollHeight > cover.clientHeight + 2 || cover.scrollWidth > cover.clientWidth + 2);
      });
      if (coverOverflow)
        throw new RequestError("BOOK_COVER_OVERFLOW", "The cover text does not fit on one page. Shorten the title or move a long artwork caption into the book before exporting. Your source is preserved.");
    }
    if (input.kind === "presentation" && input.presentationMode === "native") {
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 1280, height: 720 });
      const overflowing = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".slide"))
          .flatMap((slide, index) =>
            slide.scrollHeight > slide.clientHeight + 2 ||
            slide.scrollWidth > slide.clientWidth + 2 ||
            Array.from(slide.querySelectorAll<HTMLElement>("h2,p")).some(
              (text) => text.scrollWidth > text.clientWidth + 2 || text.scrollHeight > text.clientHeight + 2,
            ) ? [index + 1] : [],
          ),
      );
      if (overflowing.length && !options.reviewOnly)
        throw new RequestError(
          "SLIDE_CONTENT_OVERFLOW",
          `Slide ${overflowing.join(", ")} contains more content than fits on the page. Split it into shorter slides before exporting; your original text is preserved.`,
        );
    }
    return await operation(page);
  } finally {
    await browser.close();
  }
}
export async function pdfDocument(input: ExportRequest) {
  return withExportPage(input, page => page.pdf({printBackground: true, preferCSSPageSize: true, tagged: true}));
}
/** Measured native layout check for the generation workflow, without creating a
 * PDF. This is not an aesthetic, factual, OCR, font-fidelity or publication gate. */
export async function inspectNativePresentation(input:unknown){
  const parsed=ExportRequestSchema.parse(input);
  if(parsed.kind!=='presentation'||parsed.presentationMode!=='native')throw new RequestError('NATIVE_PRESENTATION_REQUIRED','Choose an editable presentation for this layout check.');
  const prepared=await prepareExport(parsed);
  const review=await withExportPage(prepared,page=>page.evaluate(()=>{
    const results=Array.from(document.querySelectorAll<HTMLElement>('.ap-native-slide')).map((slide,index)=>{
      const text=Array.from(slide.querySelectorAll<HTMLElement>('.ap-native-text')).filter(node=>node.textContent?.trim());
      const images=Array.from(slide.querySelectorAll<HTMLElement>('.ap-native-image')).map(node=>node.getBoundingClientRect());
      const rects=text.map(node=>{const range=document.createRange();range.selectNodeContents(node);return Array.from(range.getClientRects());});
      const intersects=(a:DOMRect,b:DOMRect)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      const overlap:number[][]=[];
      for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++)if(rects[a].some(first=>rects[b].some(second=>intersects(first,second))))overlap.push([a,b]);
      const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)?.slice(0,3).map(Number);if(!rgb||rgb.length!==3)return null;const [r,g,b]=rgb.map(channel=>{const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
      const paper=luminance(getComputedStyle(slide).backgroundColor),lowContrast:number[]=[],textOverImage:number[]=[];
      for(const [position,node]of text.entries()){
        if(rects[position].some(rect=>images.some(image=>intersects(rect,image)))){textOverImage.push(position);continue;}
        const ink=luminance(getComputedStyle(node).color);
        if(paper!==null&&ink!==null&&(Math.max(paper,ink)+.05)/(Math.min(paper,ink)+.05)<3)lowContrast.push(position);
      }
      // Measure actual word placement, not a character-count approximation.
      // These diagnostics never rewrite copy or approve aesthetic quality.
      const title=slide.querySelector<HTMLElement>('.ap-native-title'),titleLines:{top:number;text:string}[]=[];
      if(title){const walker=document.createTreeWalker(title,NodeFilter.SHOW_TEXT);let node:Node|null;
        while((node=walker.nextNode()))for(const word of (node.textContent??'').matchAll(/\S+/gu)){
          const range=document.createRange();range.setStart(node,word.index!);range.setEnd(node,word.index!+word[0].length);
          const box=range.getClientRects()[0];if(!box)continue;
          const line=titleLines.find(line=>Math.abs(line.top-box.top)<2);
          if(line)line.text+=' '+word[0];else titleLines.push({top:box.top,text:word[0]});
        }
      }
      const lines=titleLines.map(line=>line.text),typographyWarnings=lines.slice(0,-1).flatMap((line,index)=>/\b(a|an|the|and|or|to|of|for|with|in|on|at)$/i.test(line)?[{code:'title_line_ends_with_english_function_word' as const,line:index+1}]:[]);
      const overflowingText=text.flatMap((node,element)=>node.scrollWidth>node.clientWidth+2||node.scrollHeight>node.clientHeight+2?[{
        element,elementId:node.dataset.nativeElementId??null,role:node.classList.contains('ap-native-title')?'title':'body',
        width:node.clientWidth,height:node.clientHeight,requiredWidth:node.scrollWidth,requiredHeight:node.scrollHeight,
      }]:[]);
      const slideOverflow=slide.scrollHeight>slide.clientHeight+2||slide.scrollWidth>slide.clientWidth+2;
      return {slide:index+1,textElements:text.length,overflowingText,slideOverflow,overlap,lowContrast,textOverImage,titleLines:lines,typographyWarnings};
    });
    return results;
  }),{reviewOnly:true});
  return {status:'layout_measured' as const,renderer:'native-slide-v1' as const,
    inputDigest:createHash('sha256').update(JSON.stringify(prepared)).digest('hex'),
    htmlDigest:createHash('sha256').update(htmlDocument(prepared)).digest('hex'),slides:review,
    minimumSolidBackgroundContrast:3,fontFidelityVerified:false as const,
    needsVisualReview:true as const,readyForPublication:false as const};
}
/** Private workflow feedback remains available even when the candidate fails.
 * Review never relaxes the independent PDF/PPTX overflow guard. */
export class NativePresentationLayoutError extends RequestError {
  constructor(code:string,message:string,readonly review:Awaited<ReturnType<typeof inspectNativePresentation>>){super(code,message);}
}
export async function reviewNativePresentation(input:unknown){
  const review=await inspectNativePresentation(input);
  if(review.slides.some(slide=>slide.slideOverflow||slide.overflowingText.length))throw new NativePresentationLayoutError('SLIDE_CONTENT_OVERFLOW','Presentation text does not fit its allocated boxes. Revise the composition; original copy is preserved.',review);
  if(review.slides.some(slide=>slide.overlap.length))throw new NativePresentationLayoutError('SLIDE_TEXT_OVERLAP','Presentation text overlaps. Revise the composition before accepting it; original copy is preserved.',review);
  if(review.slides.some(slide=>slide.lowContrast.length))throw new NativePresentationLayoutError('SLIDE_LOW_CONTRAST','Presentation text has insufficient contrast against its solid background. Revise the colors before accepting it.',review);
  return {...review,status:'layout_checked' as const};
}
function effectiveSlides(input: ExportRequest): ExportRequest["slides"] {
  const slides = input.slides.length ? input.slides : groupPresentationBlocks(input.title, input.blocks).map(slide => {
    const image = slide.blocks.find(block => block.image)?.image;
    return {id: slide.id, title: slide.title, body: slide.blocks.map(block => block.text).filter(Boolean).join("\n\n"), ...(image ? {image} : {})};
  });
  if (slides.length > 40 || slides.some(slide => slide.title.length > 200 || slide.body.length > 5000)) throw new RequestError("SLIDE_LIMIT", "Split large sections into shorter slides before exporting.");
  return slides;
}
function sceneForSlide(slide: ExportRequest["slides"][number], index:number,total:number) {
  const blocks=slide.sourceBlocks ?? [{id:"body",type:"paragraph",text:slide.body},...(slide.image?[{id:"artwork",type:"image",text:"",image:slide.image}]:[])];
  return {scene:presentationScene({title:slide.title,blocks,design:slide.design},index,total),blocks};
}
function nativeSlideHtml(slide: ExportRequest["slides"][number], index: number, total: number) {
  const {scene,blocks}=sceneForSlide(slide,index,total);
  const boxStyle = (box: Parameters<typeof slideBoxPercent>[0]) => Object.entries(slideBoxPercent(box)).map(([key,value]) => `${key}:${value}`).join(";");
  const elements=scene.elements.map(element=>{
    if(element.kind==='image')return `<div class="ap-native-image" style="${boxStyle(element)};--native-image-fit:${element.fit}"><img src="${blocks.find(block=>block.id===element.blockId)?.image}" alt="${escapeHtml(slide.title)}"></div>`;
    const tag=element.role==='title'?'h2':'p';
    return `<${tag} class="ap-native-text ap-native-${element.role}" data-native-element-id="${escapeHtml(element.id)}" style="${boxStyle(element)};font-size:${element.fontSize / 12.8}cqw;line-height:${element.lineHeight};font-family:${element.font==='heading'?'var(--native-heading)':'Arial,sans-serif'};font-weight:${element.weight==='bold'?700:400};text-align:${element.align}${element.color?`;color:${element.color}`:''}">${escapeHtml(element.text)}</${tag}>`;
  }).join('');
  return `<section class="slide ap-native-slide ap-native-${scene.layout}" ${scene.background?`style="--native-paper:${scene.background}"`:''} aria-label="Slide ${index+1}">${elements}</section>`;
}
export async function presentationDocument(input: ExportRequest) {
  const slides = effectiveSlides(input);
  if (input.presentationMode === "native") await withExportPage(input, async () => undefined);

  const pptx = new PptxGenJS();
  const dimensions = slideDimensions(input);
  if (input.presentationMode === "visual") {
    pptx.defineLayout({
      name: "FULL_VISUAL",
      width: dimensions.width,
      height: dimensions.height,
    });
    pptx.layout = "FULL_VISUAL";
  } else pptx.layout = "LAYOUT_WIDE";
  pptx.author = input.author || "Makeborne";
  pptx.title = input.title;
  pptx.subject =
    input.presentationMode === "visual"
      ? "Complete slide images; text is part of artwork"
      : "Native editable text with placed artwork";
  const style = exportStyle(input),
    accent = style.color.slice(1),
    font = style.font === "serif" ? "Georgia" : "Arial";
  for (const [index, content] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = {
      color: input.presentationMode === "visual" ? "16181D" : (style.background ?? "#F8F7F4").slice(1),
    };
    if (input.presentationMode === "visual") {
      if (!content.image)
        throw new RequestError(
          "VISUAL_SLIDE_IMAGE",
          "Every complete visual slide needs its own image.",
        );
      slide.addImage({
        data: content.image,
        x: 0,
        y: 0,
        w: dimensions.width,
        h: dimensions.height,
        sizing: { type: "contain", w: dimensions.width, h: dimensions.height },
        altText: content.title || `Slide ${index + 1}`,
      });
    } else {
      const {scene,blocks}=sceneForSlide(content,index,slides.length);
      if(scene.background)slide.background={color:scene.background.slice(1)};
      const inch = (pixels: number) => pixels / 96;
      for (const element of scene.elements) {
        if(element.kind==='text')slide.addText(element.text, {
          x:inch(element.x),y:inch(element.y),w:inch(element.width),h:inch(element.height),
          fontFace:element.font==='heading'?font:'Arial',fontSize:element.fontSize*.75,
          color:element.color?.slice(1)??(element.role==='folio'?accent:(style.textColor??'#16181D').slice(1)),
          margin:0,valign:'top',bold:element.weight==='bold',align:element.align,lineSpacingMultiple:element.lineHeight,
        });
        else{
          const image=blocks.find(block=>block.id===element.blockId)?.image;
          if(!image)throw new RequestError('VISUAL_SLIDE_IMAGE','The saved slide artwork is unavailable.');
          slide.addImage({data:image,x:inch(element.x),y:inch(element.y),w:inch(element.width),h:inch(element.height),sizing:{type:element.fit==='cover'?'crop':'contain',w:inch(element.width),h:inch(element.height)},altText:content.title});
        }
      }
    }
    if (content.notes) slide.addNotes(content.notes);
  }
  return Buffer.from(
    (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
  );
}
