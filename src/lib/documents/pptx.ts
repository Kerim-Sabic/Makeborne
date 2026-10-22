import "server-only";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import sharp from "sharp";
import type { Deck } from "./schema";
import { FONTS } from "./theme";
import { composeSlide, H, W, type ArtPrim, type ChartPrim, type ImagePrim, type PathPrim, type Prim, type TextPrim } from "./slide-scene";

/** Office face for monospaced labels (the preview and PDF embed JetBrains Mono). */
export const PPTX_MONO = "Consolas";

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

async function cropped(image: Buffer, prim: ImagePrim) {
  const { w, h } = prim, position = prim.crop ?? (prim.round ? "center" : "attention");
  const scale = Math.min(2, 2400 / Math.max(w, h)), width = Math.round(w * scale), height = Math.round(h * scale);
  let pipeline = sharp(image, { limitInputPixels: 40_000_000 }).rotate().resize(width, height, { fit: "cover", position });
  if (prim.treatment) {
    // The same luminance → two-colour ramp as the preview's SVG colour matrix.
    const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgb = (hex: string) => [16, 8, 0].map(shift => parseInt(hex.slice(1), 16) >> shift & 255);
    const d = rgb(prim.treatment.dark), l = rgb(prim.treatment.light);
    for (let i = 0; i < data.length; i += 3) {
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(d[c] + (l[c] - d[c]) * lum);
    }
    pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
  }
  if (prim.mask === "arch") {
    const r = width / 2, mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="M0 ${height}L0 ${r}A${r} ${r} 0 0 1 ${width} ${r}L${width} ${height}Z" fill="#fff"/></svg>`;
    const bytes = await pipeline.ensureAlpha().composite([{ input: Buffer.from(mask), blend: "dest-in" }]).png().toBuffer();
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  const bytes = await pipeline.jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

/** Generative artwork (gradients, patterns) has no native PPTX equivalent: embed it rendered at 2×. */
async function artImage(prim: ArtPrim) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(prim.w * 2)}" height="${Math.round(prim.h * 2)}" viewBox="0 0 ${prim.w} ${prim.h}"><g opacity="${prim.opacity ?? 1}">${prim.svg}</g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** Native custom geometry: points are inches relative to the shape's box. */
function geometry(prim: PathPrim) {
  const px = (x: number) => inch(x - prim.x), py = (y: number) => inch(y - prim.y);
  return prim.d.map(seg => seg.op === "Z" ? { close: true as const }
    : seg.op === "C" ? { x: px(seg.x), y: py(seg.y), curve: { type: "cubic" as const, x1: px(seg.x1), y1: py(seg.y1), x2: px(seg.x2), y2: py(seg.y2) } }
    : { x: px(seg.x), y: py(seg.y), ...(seg.op === "M" ? { moveTo: true } : {}) });
}

/** Native, editable PPTX: real text boxes, shapes and charts at the same
 * geometry as the preview; images are cropped to their frames. An image that
 * is not available is left out (never a grey stand-in) and its name is pushed
 * to `missing` so the caller can report it. */
export async function deckPptx(deck: Deck, images: Record<string, Buffer | undefined>, missing: string[] = []) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "MAKEBORNE_16x9", width: W / IN, height: H / IN });
  pptx.layout = "MAKEBORNE_16x9";
  pptx.title = deck.title;
  pptx.author = deck.author || "Makeborne";
  pptx.subject = deck.subtitle ?? "";
  const fonts = FONTS[deck.theme.fonts];
  const total = deck.slides.length;
  const caps: Set<string>[] = [];
  for (const [index, source] of deck.slides.entries()) {
    const scene = composeSlide(deck, source, index, total);
    const slide = pptx.addSlide();
    // Accessibility: one shape per slide is the slide title (a title placeholder, see accessible()); capitals are formatting, not baked text.
    const title = slideTitle(scene.prims, source.title), upper = new Set<string>();
    caps.push(upper);
    let shape = 0;
    slide.background = { color: color(scene.background) };
    for (const prim of scene.prims as Prim[]) {
      switch (prim.k) {
        case "rect":
          slide.addShape(prim.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), ...(prim.fade ? { objectName: FADE } : {}),
            fill: prim.noFill ? { type: "none" } : { color: color(prim.fill), transparency: transparency(prim.opacity) },
            line: prim.stroke ? { color: color(prim.stroke), width: pt(prim.strokeWidth ?? 1) } : { type: "none" },
            // pptxgenjs takes the corner radius in inches.
            ...(prim.radius ? { rectRadius: inch(Math.min(prim.radius, Math.min(prim.w, prim.h) / 2)) } : {}) });
          break;
        case "path":
          // custGeom exists at runtime (pptxgenjs 4) but is missing from its ShapeType typings.
          slide.addShape("custGeom" as PptxGenJS.ShapeType, { x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), points: geometry(prim),
            fill: prim.fill ? { color: color(prim.fill), transparency: transparency(prim.opacity) } : { type: "none" },
            line: prim.stroke ? { color: color(prim.stroke), width: pt(prim.strokeWidth ?? 1), transparency: transparency(prim.opacity) } : { type: "none" } });
          break;
        case "art":
          // Decorative: accessible() marks it so and clears pptxgenjs's "preencoded.png" description.
          slide.addImage({ data: await artImage(prim), x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), altText: DECORATIVE });
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
          if (bytes) slide.addImage({ data: await cropped(bytes, prim), x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), altText: prim.alt || prim.name.replace(/-/g, " "), objectName: `Image ${prim.name}`, ...(prim.round ? { rounding: true } : {}) });
          else if (!missing.includes(prim.name)) missing.push(prim.name);
          break;
        }
        case "chart":
          addChart(pptx, slide, prim, { body: fonts.pptxBody });
          break;
        case "text": {
          const heading = prim.font === "heading", semibold = heading && /Semibold/.test(fonts.pptxHeading);
          const legacyBold = prim.weight >= 700 || (prim.weight >= 600 && !semibold);
          // Headings at the pairing's own weight follow its Office mapping; heavier emphasis stays bold.
          const bold = heading && fonts.pptxHeadingBold !== undefined ? prim.weight > fonts.headingWeight || fonts.pptxHeadingBold : legacyBold;
          // The preview tracks headings tighter by default; PowerPoint needs the same spacing or titles run wider and rewrap.
          const tracking = prim.tracking ?? (heading ? parseFloat(fonts.headingTracking) || 0 : 0);
          const objectName = prim === title ? "Title" : `Text ${++shape}`;
          if (prim.upper) upper.add(objectName);
          slide.addText(prim.text, { objectName,
            x: inch(prim.x), y: inch(prim.y), w: inch(prim.w), h: inch(prim.h), margin: 0,
            fontFace: heading ? fonts.pptxHeading : prim.font === "mono" ? PPTX_MONO : fonts.pptxBody, fontSize: pt(prim.size), color: color(prim.color),
            bold, italic: prim.italic ?? false,
            // Exact line pitch, as in CSS. A "multiple" is relative to each face's own
            // line metrics (Segoe UI's single line is 1.33 em), which made PPTX text
            // up to 11% taller than the preview and pushed titles into subtitles.
            align: prim.align, valign: prim.valign, lineSpacing: pt(prim.size * prim.lh),
            ...(tracking ? { charSpacing: Math.round(tracking * prim.size * 0.75 * 10) / 10 } : {}),
            fit: "shrink", paraSpaceBefore: 0, paraSpaceAfter: 0,
          });
          break;
        }
      }
    }
    slide.addNotes(source.notes);
  }
  return withTransitions(Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer), caps);
}

const DECORATIVE = "makeborne:decorative", FADE = "Scrim fade";
/** The shape that carries the slide title: the display text that states it, else the first display text. */
function slideTitle(prims: Prim[], title: string) {
  const texts = prims.filter((prim): prim is TextPrim => prim.k === "text");
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return texts.find(prim => prim.role === "title" && norm(prim.text) === norm(title)) ?? texts.find(prim => prim.role === "title");
}
const DECORATIVE_EXT = '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';
/** Accessibility in the package XML (pptxgenjs has no API for these):
 * - the title shape becomes the slide's title placeholder, so the outline, screen readers and the accessibility checker see a title;
 * - text set in capitals keeps its own case with all-caps formatting (cap="all"), so it reads and copies as written;
 * - artwork and shapes without text are marked decorative, and artwork loses pptxgenjs's "preencoded.png" description. */
export function accessible(xml: string, upper: Set<string>) {
  return xml.replace(/<p:(sp|pic)>([\s\S]*?)<\/p:\1>/g, (whole, kind: string, body: string) => {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(body)?.[1] ?? "";
    if (kind === "pic") return whole.replace(`descr="${DECORATIVE}">`, `descr="">${DECORATIVE_EXT}`);
    if (!/<a:t>[^<]/.test(body)) {
      // Scrim fades are a vertical gradient to the scrim's opacity, as in the preview (pptxgenjs writes only solid fills).
      const faded = name === FADE ? whole.replace(/<a:solidFill><a:srgbClr val="([0-9A-F]{6})"><a:alpha val="(\d+)"\/><\/a:srgbClr><\/a:solidFill>/, (_m, hex: string, alpha: string) =>
        `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${hex}"><a:alpha val="0"/></a:srgbClr></a:gs><a:gs pos="55000"><a:srgbClr val="${hex}"><a:alpha val="${Math.round(Number(alpha) * 0.75)}"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="${hex}"><a:alpha val="${alpha}"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`) : whole;
      return faded.replace(/(<p:cNvPr id="\d+" name="[^"]*">)(<\/p:cNvPr>)/, `$1${DECORATIVE_EXT}$2`);
    }
    let out = whole;
    if (name === "Title") out = out.replace("<p:nvPr></p:nvPr>", '<p:nvPr><p:ph type="title"/></p:nvPr>');
    if (upper.has(name)) out = out.replace(/<a:rPr lang=/g, '<a:rPr cap="all" lang=');
    return out;
  });
}

/** A gentle fade between slides, matching the presenter view. PptxGenJS has no
 * transition API; <p:transition> is plain PresentationML and must follow
 * <p:clrMapOvr> inside <p:sld>. It changes no geometry, text or fonts. */
export async function withTransitions(bytes: Buffer, caps: Set<string>[] = []) {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry))) {
    const xml = accessible(await zip.file(name)!.async("string"), caps[Number(/(\d+)\.xml$/.exec(name)![1]) - 1] ?? new Set());
    zip.file(name, xml);
    if (xml.includes("<p:transition") || !xml.endsWith("</p:clrMapOvr></p:sld>")) continue;
    zip.file(name, xml.replace(/<\/p:clrMapOvr><\/p:sld>$/, '</p:clrMapOvr><p:transition spd="med"><p:fade/></p:transition></p:sld>'));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
