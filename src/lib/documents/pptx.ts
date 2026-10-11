import "server-only";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import type { Deck } from "./schema";
import { FONTS } from "./theme";
import { composeSlide, H, W, type ChartPrim, type Prim } from "./slide-scene";

const IN = 96; // the 1280×720 canvas is 13.333 × 7.5 in
const inch = (px: number) => px / IN;
const pt = (px: number) => Math.round(px * 0.75 * 10) / 10;
const color = (hex: string) => hex.replace("#", "").toUpperCase();
const transparency = (opacity = 1) => Math.round((1 - opacity) * 100);

/** Excel number format that mirrors the preview's value labels. */
function numberFormat(chart: ChartPrim["chart"]) {
  const values = chart.series.flatMap(series => series.values), top = Math.max(...values.map(Math.abs));
  const fractional = values.some(value => !Number.isInteger(value)), digits = top < 1 ? 2 : top < 100 && fractional ? 1 : 0;
  const base = `#,##0${digits ? `.${"0".repeat(digits)}` : ""}`;
  if (!chart.unit) return base;
  // Backslash-escape each literal: pptxgenjs writes the code into an XML attribute unescaped, so quotes would corrupt the file.
  const literal = (value: string) => [...value].filter(char => /[\p{L}\p{N}\p{Sc}%. /-]/u.test(char)).map(char => `\\${char}`).join("");
  const unit = chart.unit;
  const prefix = chart.unitPosition === "prefix" || (!chart.unitPosition && /^[$€£¥]/.test(unit));
  return prefix ? `${literal(unit)}${base}` : `${base}${literal(`${/^[A-Za-z]/.test(unit) ? " " : ""}${unit}`)}`;
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, prim: ChartPrim, fonts: { body: string }) {
  const { chart, colors } = prim, multi = chart.series.length > 1;
  const data = chart.series.map(series => ({ name: series.name, labels: chart.categories, values: series.values }));
  const pointColors = chart.categories.map((_, index) => color(chart.highlight === undefined ? colors.series[0] : index === chart.highlight ? colors.highlight : colors.dim));
  const common = {
    x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h),
    showLegend: multi, legendPos: "t" as const, legendFontFace: fonts.body, legendFontSize: 11, legendColor: color(colors.ink),
    catAxisLabelColor: color(colors.muted), catAxisLabelFontFace: fonts.body, catAxisLabelFontSize: 11,
    valAxisLabelColor: color(colors.muted), valAxisLabelFontFace: fonts.body, valAxisLabelFontSize: 10,
    dataLabelColor: color(colors.ink), dataLabelFontFace: fonts.body, dataLabelFontSize: 11, dataLabelFontBold: true,
    dataLabelFormatCode: numberFormat(chart), valAxisLabelFormatCode: numberFormat(chart),
    altText: `${chart.type} chart: ${chart.categories.join(", ")}`,
  };
  if (chart.type === "donut") {
    const palette = [colors.series[0], colors.series[1], colors.series[2], colors.dim, colors.muted, colors.grid];
    slide.addChart(pptx.ChartType.doughnut, data, { ...common, holeSize: 62, showLegend: true, legendPos: "r", showPercent: true, showValue: false,
      chartColors: chart.categories.map((_, index) => color(chart.highlight === undefined ? palette[index] : index === chart.highlight ? colors.highlight : palette[(index + 1) % palette.length])),
      dataBorder: { pt: 2, color: color(colors.background) }, dataLabelColor: "FFFFFF", dataLabelFormatCode: "0%", legendFontSize: 14 });
    return;
  }
  if (chart.type === "line") {
    slide.addChart(pptx.ChartType.line, data, { ...common, chartColors: chart.series.map((_, index) => color(colors.series[index])), lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 7,
      valGridLine: { color: color(colors.grid), style: "dash", size: 1 }, catGridLine: { style: "none" }, showValue: false, valAxisLineShow: false });
    return;
  }
  slide.addChart(pptx.ChartType.bar, data, { ...common, barDir: chart.type === "bar" ? "bar" : "col", barGapWidthPct: 55,
    chartColors: multi ? chart.series.map((_, index) => color(colors.series[index])) : pointColors,
    showValue: true, dataLabelPosition: "outEnd", valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, catAxisOrientation: (chart.type === "bar" ? "maxMin" : "minMax") as "minMax" });
}

async function cropped(image: Buffer, w: number, h: number) {
  const scale = Math.min(2, 2400 / Math.max(w, h));
  const bytes = await sharp(image, { limitInputPixels: 40_000_000 }).rotate().resize(Math.round(w * scale), Math.round(h * scale), { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

/** Native, editable PPTX: real text boxes, shapes and charts at the same
 * geometry as the preview; images are cropped to their frames. */
export async function deckPptx(deck: Deck, images: Record<string, Buffer | undefined>) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "MAKEBORNE_16x9", width: W / IN, height: H / IN });
  pptx.layout = "MAKEBORNE_16x9";
  pptx.title = deck.title;
  pptx.author = deck.author || "Makeborne";
  pptx.subject = deck.subtitle ?? "";
  const fonts = FONTS[deck.theme.fonts];
  const total = deck.slides.length;
  for (const [index, source] of deck.slides.entries()) {
    const scene = composeSlide(deck, source, index, total);
    const slide = pptx.addSlide();
    slide.background = { color: color(scene.background) };
    for (const prim of scene.prims as Prim[]) {
      switch (prim.k) {
        case "rect":
          slide.addShape(prim.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h),
            fill: { color: color(prim.fill), transparency: transparency(prim.fade ? (prim.opacity ?? 1) * 0.85 : prim.opacity) }, line: { type: "none" },
            ...(prim.radius ? { rectRadius: Math.min(0.5, prim.radius / Math.min(prim.w, prim.h)) } : {}) });
          break;
        case "ellipse":
          slide.addShape(pptx.ShapeType.ellipse, { x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h),
            fill: prim.fill ? { color: color(prim.fill), transparency: transparency(prim.opacity) } : { type: "none" },
            line: prim.stroke ? { color: color(prim.stroke), width: pt(prim.strokeWidth ?? 2), transparency: transparency(prim.opacity) } : { type: "none" } });
          break;
        case "line":
          slide.addShape(pptx.ShapeType.line, { x: inch(Math.min(prim.x1, prim.x2)), y: inch(Math.min(prim.y1, prim.y2)), w: Math.max(0.001, inch(Math.abs(prim.x2 - prim.x1))), h: Math.max(0.001, inch(Math.abs(prim.y2 - prim.y1))),
            flipH: (prim.x2 < prim.x1) !== (prim.y2 < prim.y1) && prim.x1 !== prim.x2 && prim.y1 !== prim.y2,
            line: { color: color(prim.color), width: pt(prim.width), transparency: transparency(prim.opacity) } });
          break;
        case "image": {
          const bytes = images[prim.name];
          if (bytes) slide.addImage({ data: await cropped(bytes, prim.w, prim.h), x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), altText: prim.alt });
          else slide.addShape(pptx.ShapeType.rect, { x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), fill: { color: "D9D6CF" }, line: { type: "none" } });
          break;
        }
        case "chart":
          addChart(pptx, slide, prim, { body: fonts.pptxBody });
          break;
        case "text": {
          const heading = prim.font === "heading", semibold = heading && /Semibold/.test(fonts.pptxHeading);
          slide.addText(prim.upper ? prim.text.toUpperCase() : prim.text, {
            x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), margin: 0,
            fontFace: heading ? fonts.pptxHeading : fonts.pptxBody, fontSize: pt(prim.size), color: color(prim.color),
            bold: prim.weight >= 700 || (prim.weight >= 600 && !semibold), italic: prim.italic ?? false,
            align: prim.align, valign: prim.valign, lineSpacingMultiple: Math.max(0.8, Math.round(prim.lh / 1.2 * 100) / 100),
            ...(prim.tracking ? { charSpacing: Math.round(prim.tracking * prim.size * 0.75 * 10) / 10 } : {}),
            fit: "shrink", paraSpaceBefore: 0, paraSpaceAfter: 0,
          });
          break;
        }
      }
    }
    slide.addNotes(source.notes);
  }
  return Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
}
