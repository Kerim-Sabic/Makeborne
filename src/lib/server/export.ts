import "server-only";
import { z } from "zod";
import PptxGenJS from "pptxgenjs";
import { chromium } from "playwright";
import sharp from "sharp";
import { RequestError } from "./http";
import { artifactDesignCss } from "../artifact-design";

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
  for (const slide of input.slides)
    slides.push({
      ...slide,
      ...(slide.image ? { image: await normalise(slide.image) } : {}),
    });
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
export function htmlDocument(input: ExportRequest) {
  const style = exportStyle(input);
  const title = escapeHtml(input.title);
  const font = style.font === "serif" ? "Georgia,serif" : "Arial,sans-serif";
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'";
  const shared = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${style.background ?? "#F8F7F4"};color:${style.textColor ?? "#16181D"};font:16px/1.65 ${font}}h1,h2,h3{line-height:1.15;letter-spacing:-.035em}h1{font-size:clamp(36px,5vw,64px)}h2{font-size:30px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}blockquote{border-left:3px solid ${style.color};padding:12px 0 12px 24px;margin:32px 0;font-size:22px}figure{margin:32px 0;break-inside:avoid}img{display:block;max-width:100%;height:auto}figure img{max-height:170mm;object-fit:contain;margin:auto}figcaption{font:12px/1.5 Arial,sans-serif;color:inherit;opacity:.75;margin-top:10px}footer{font:12px/1.5 Arial,sans-serif;color:inherit;opacity:.75;padding:24px 0}a{color:inherit}:focus-visible{outline:3px solid ${style.color};outline-offset:4px}`;
  let content = "",
    css = "";
  if (input.kind === "presentation") {
    const dimensions = slideDimensions(input);
    const slides = effectiveSlides(input);
    content = slides
      .map((slide, index) =>
        input.presentationMode === "visual"
          ? `<section class="slide visual" aria-label="Slide ${index + 1}"><img src="${slide.image}" alt="${escapeHtml(slide.title || `Slide ${index + 1}`)}"></section>`
          : `<section class="slide${!slide.image && slide.title.length <= 100 && slide.body.length <= 180 ? " slide-statement" : ""}"><span class="slide-number">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(slide.title)}</h2><div class="slide-body">${slide.image ? `<img src="${slide.image}" alt="${escapeHtml(slide.title)}">` : ""}<p>${escapeHtml(slide.body)}</p></div></section>`,
      )
      .join("");
    css = `@page{size:13.333in 7.5in;margin:0}.slide{width:100%;aspect-ratio:16/9;padding:6%;background:${style.background ?? "#F8F7F4"};break-after:page;position:relative;overflow:hidden}.slide h2{font-size:36px;max-width:90%}.slide-number{font:12px Arial,sans-serif;color:${style.color};display:block;margin-bottom:30px}.slide-body{display:flex;gap:5%;align-items:flex-start;font-size:23px}.slide-body img{width:43%;max-height:300px;object-fit:contain}.visual{padding:0;background:#16181D;display:flex;align-items:center;justify-content:center}.visual img{width:100%;height:100%;object-fit:contain}@media print{.slide{width:13.333in;height:7.5in;aspect-ratio:auto}.slide:last-child{break-after:auto}}`;
    css = css
      .replace(
        "size:13.333in 7.5in",
        `size:${dimensions.width}in ${dimensions.height}in`,
      )
      .replace("aspect-ratio:16/9", `aspect-ratio:${dimensions.ratio}`)
      .replace("height:7.5in", `height:${dimensions.height}in`);
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
    content = `<section class="cover"><h1>${title}</h1>${input.author ? `<p class="book-author">${escapeHtml(input.author)}</p>` : ""}${art ? `<figure><img class="cover-art" src="${art.image}" alt="${escapeHtml(art.text)}">${art.text ? `<figcaption>${escapeHtml(art.text)}</figcaption>` : ""}</figure>` : ""}<span class="cover-rule"></span></section>${toc}<main class="book-body">${input.blocks
      .filter((block) => block !== art)
      .map(blockHtml)
      .join("")}<footer>Made with Makeborne</footer></main>`;
    css = `@page{size:A4;margin:22mm 20mm}.cover{min-height:240mm;break-after:page;padding:12mm 0;display:flex;flex-direction:column;gap:12mm}.cover h1{font-size:44px;margin:0;overflow-wrap:anywhere}.eyebrow{font:11px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${style.color}}.cover-art{width:100%;height:145mm;object-fit:contain}.cover-rule{height:2px;width:60px;background:${style.color};margin-top:auto}.contents{break-after:page;padding:20mm 0}.contents li{padding:8px 0;border-bottom:1px solid #DCDDD9}.book-body h2{margin:35px 0 18px}.book-body h2:not(:first-child){break-before:page}.book-body{font-size:16px}.book-body p{margin-bottom:20px}.book-body>figure{margin:25px 0}body{padding:40px;max-width:920px;margin:auto}@media print{body{padding:0;max-width:none}.cover{min-height:240mm}.cover h1{font-size:40px}.book-body h2{margin-top:0}}`;
  }
  return `<!doctype html><html lang="${escapeHtml(input.language ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${title}</title><style>${shared}${css}${input.presentationMode === "visual" ? "" : artifactDesignCss(input.styleId, input.kind)}</style></head><body>${content}</body></html>`;
}
export async function pdfDocument(input: ExportRequest) {
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
    if (input.kind === "presentation" && input.presentationMode === "native") {
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: 1280, height: 720 });
      const overflowing = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".slide"))
          .flatMap((slide, index) =>
            slide.scrollHeight > slide.clientHeight + 2 ||
            slide.scrollWidth > slide.clientWidth + 2 ||
            Array.from(slide.querySelectorAll<HTMLElement>("h2,p")).some(
              (text) => text.scrollWidth > text.clientWidth + 2,
            ) ? [index + 1] : [],
          ),
      );
      if (overflowing.length)
        throw new RequestError(
          "SLIDE_CONTENT_OVERFLOW",
          `Slide ${overflowing.join(", ")} contains more content than fits on the page. Split it into shorter slides before exporting; your original text is preserved.`,
        );
    }
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}
function effectiveSlides(input: ExportRequest): ExportRequest["slides"] {
  if (input.slides.length) return input.slides;
  const slides: ExportRequest["slides"] = [];
  for (const block of input.blocks) {
    if (block.type === "heading" || !slides.length)
      slides.push({
        id: block.id,
        title: block.type === "heading" ? block.text : input.title,
        body:
          block.type === "heading"
            ? ""
            : block.text,
        ...(block.image ? { image: block.image } : {}),
      });
    else if (block.type === "image") {
      if (slides[slides.length - 1].image)
        slides.push({
          id: block.id,
          title: input.title,
          body: block.text,
          image: block.image,
        });
      else {
        const slide = slides[slides.length - 1];
        slide.image = block.image;
        if (block.text) slide.body += `${slide.body ? "\n\n" : ""}${block.text}`;
      }
    } else
      slides[slides.length - 1].body +=
        `${slides[slides.length - 1].body ? "\n\n" : ""}${block.text}`;
  }
  return slides.length
    ? slides
    : [{ id: "title", title: input.title, body: "" }];
}
export async function presentationDocument(input: ExportRequest) {
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
  const slides = effectiveSlides(input);
  if (
    slides.length > 40 ||
    slides.some((slide) => slide.title.length > 200 || slide.body.length > 5000)
  )
    throw new RequestError(
      "SLIDE_LIMIT",
      "Split large sections into shorter slides before exporting.",
    );
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
      const statement = !content.image && content.title.length <= 100 && content.body.length <= 180;
      const signal = style.id === "direction-signal";
      const atlas = style.id === "direction-atlas";
      if (signal && statement) {
        // Native vectors remain editable. Artwork stays out of the text area.
        for (const diameter of [2.2, 1.7, 1.2])
          slide.addShape(pptx.ShapeType.ellipse, {
            x: 12.05 - diameter / 2, y: 1.8 - diameter / 2,
            w: diameter, h: diameter,
            line: { color: accent, transparency: 55, width: 0.8 },
            fill: { color: accent, transparency: 100 },
          });
      }
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.6,
        y: 0.5,
        w: atlas ? 12.1 : 0.7,
        h: 0.06,
        line: { color: accent },
        fill: { color: accent },
      });
      slide.addText(content.title, {
        x: 0.6,
        y: statement ? 1.5 : 0.9,
        w: statement && signal ? 9.3 : 12.1,
        h: statement ? 2.1 : 1.3,
        fontFace: font,
        fontSize: statement ? 48 : 32,
        bold: !atlas,
        color: (style.textColor ?? "#16181D").slice(1),
        margin: 0,
        fit: "shrink",
        valign: "top",
      });
      if (content.image)
        slide.addImage({
          data: content.image,
          x: 0.6,
          y: 2.5,
          w: 5.65,
          h: 3.8,
          sizing: { type: "contain", w: 5.65, h: 3.8 },
          altText: content.title,
        });
      slide.addText(content.body, {
        x: content.image ? 6.7 : 0.6,
        y: statement ? 4.1 : 2.5,
        w: content.image ? 5.9 : 12.1,
        h: statement ? 1.8 : 3.8,
        fontFace: font,
        fontSize: statement ? 24 : 20,
        color: (style.textColor ?? "#16181D").slice(1),
        margin: 0,
        valign: "top",
        paraSpaceAfter: 10,
        fit: "shrink",
      });
      slide.addText(
        `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`,
        {
          x: 11.5,
          y: 6.9,
          w: 1.2,
          h: 0.2,
          color: (style.textColor ?? "#5C616D").slice(1),
          fontSize: 10,
          align: "right",
        },
      );
    }
    if (content.notes) slide.addNotes(content.notes);
  }
  return Buffer.from(
    (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
  );
}
