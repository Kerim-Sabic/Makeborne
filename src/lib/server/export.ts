import "server-only";
import { z } from "zod";
import PptxGenJS from "pptxgenjs";
import { chromium } from "playwright";

export const ExportRequestSchema = z.object({
  format: z.enum(["pdf", "pptx", "html"]),
  title: z.string().trim().min(1).max(200),
  styleId: z.enum(["editorial", "venture", "studio"]).default("editorial"),
  blocks: z
    .array(
      z
        .object({
          id: z.string().max(100),
          type: z.enum(["heading", "paragraph", "quote"]),
          text: z.string().max(20000).default(""),
        })
        .strict(),
    )
    .max(150)
    .default([]),
  slides: z
    .array(
      z.object({
        id: z.string().max(100),
        title: z.string().max(200),
        body: z.string().max(5000),
        notes: z.string().max(10000).optional(),
      }),
    )
    .max(40)
    .default([]),
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

export function htmlDocument(input: ExportRequest) {
  const serif = input.styleId === "editorial";
  const color =
    input.styleId === "studio"
      ? "#33544C"
      : input.styleId === "editorial"
        ? "#9B583C"
        : "#3358D4";
  const content = input.slides.length
    ? input.slides
        .map(
          (slide) =>
            `<section class="slide"><h2>${escapeHtml(slide.title)}</h2><p>${escapeHtml(slide.body)}</p></section>`,
        )
        .join("")
    : input.blocks
        .map((block) => {
          if (block.type === "heading")
            return `<h2>${escapeHtml(block.text)}</h2>`;
          if (block.type === "quote")
            return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
          return `<p>${escapeHtml(block.text)}</p>`;
        })
        .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(input.title)}</title><style>@page{size:A4;margin:22mm 20mm}*{box-sizing:border-box}body{margin:0;background:#F8F7F4;color:#16181D;font:16px/1.65 ${serif ? "Georgia,serif" : "Arial,sans-serif"}}main{max-width:780px;margin:auto;padding:64px 32px}h1{font-size:42px;line-height:1.12;letter-spacing:-1.3px;margin:0 0 40px}h2{font-size:26px;line-height:1.25;margin:36px 0 16px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}blockquote{border-left:3px solid ${color};margin:32px 0;padding-left:24px}.slide{break-before:page;min-height:50vh}.asset-note{color:#5C616D;font-style:italic}footer{margin-top:48px;font:12px Arial,sans-serif;color:#5C616D}@media print{body{background:white}main{padding:0;max-width:none}}</style></head><body><main><h1>${escapeHtml(input.title)}</h1>${content}<footer>Made with Makeborne</footer></main></body></html>`;
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
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}

export async function presentationDocument(input: ExportRequest) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Makeborne";
  pptx.subject = "Native editable manual content export";
  pptx.title = input.title;
  const slides = input.slides.length
    ? input.slides
    : [
        {
          id: "title",
          title: input.title,
          body: input.blocks.map((block) => block.text).join("\n\n"),
        },
      ];
  const accent =
    input.styleId === "studio"
      ? "33544C"
      : input.styleId === "editorial"
        ? "9B583C"
        : "3358D4";
  for (const [index, content] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: "F8F7F4" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55,
      y: 0.55,
      w: 0.65,
      h: 0.07,
      line: { color: accent },
      fill: { color: accent },
    });
    slide.addText(content.title, {
      x: 0.55,
      y: 0.9,
      w: 12.1,
      h: 1.15,
      fontFace: "Arial",
      fontSize: 32,
      bold: true,
      color: "16181D",
      margin: 0,
      breakLine: false,
    });
    slide.addText(content.body, {
      x: 0.55,
      y: 2.3,
      w: 11.7,
      h: 4.1,
      fontFace: "Arial",
      fontSize: 20,
      color: "16181D",
      margin: 0,
      valign: "top",
      paraSpaceAfter: 10,
    });
    slide.addText(`${index + 1}`, {
      x: 12,
      y: 6.8,
      w: 0.7,
      h: 0.25,
      color: "5C616D",
      fontSize: 10,
    });
    if (content.notes) slide.addNotes(content.notes);
  }
  return Buffer.from(
    (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
  );
}
