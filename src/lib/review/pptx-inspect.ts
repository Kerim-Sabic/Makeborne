import JSZip from "jszip";

/**
 * Reads an exported PPTX package (the actual file, not the source): slide
 * order, each slide's text, native chart parts (a c:chart graphic frame whose
 * part has a plot of a real chart type and an embedded workbook, i.e. editable
 * in PowerPoint), pictures, and speaker-notes text.
 */
export type PptxSlide = {
  slide: number; text: string; notes: string | null; pictures: number;
  charts: { part: string; type: string; native: boolean; embeddedData: boolean }[];
};
export type PptxInspection = { slides: PptxSlide[] };

const CHART_TYPES = ["barChart", "bar3DChart", "lineChart", "line3DChart", "pieChart", "pie3DChart", "doughnutChart", "areaChart", "scatterChart", "radarChart", "bubbleChart"];
const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => decode(match[1]));
const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const segment of target.split("/")) { if (segment === "..") parts.pop(); else if (segment !== ".") parts.push(segment); }
  return parts.join("/");
};
const relsPath = (part: string) => { const parts = part.split("/"); const name = parts.pop()!; return [...parts, "_rels", `${name}.rels`].join("/"); };
async function relationships(zip: JSZip, part: string) {
  const file = zip.file(relsPath(part));
  if (!file) return [] as { id: string; type: string; target: string }[];
  const xml = await file.async("string");
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(match => ({
    id: /\bId="([^"]+)"/.exec(match[1])?.[1] ?? "", type: /\bType="([^"]+)"/.exec(match[1])?.[1] ?? "",
    target: resolve(part, decode(/\bTarget="([^"]+)"/.exec(match[1])?.[1] ?? "")),
  }));
}

export async function inspectPptx(bytes: Buffer): Promise<PptxInspection | null> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return null; }
  const presentation = zip.file("ppt/presentation.xml");
  if (!presentation) return null;
  const order = [...(await presentation.async("string")).matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map(match => match[1]);
  const rels = await relationships(zip, "ppt/presentation.xml");
  const slides: PptxSlide[] = [];
  for (const [index, id] of order.entries()) {
    const part = rels.find(rel => rel.id === id)?.target;
    const file = part ? zip.file(part) : null;
    if (!part || !file) return null;
    const xml = await file.async("string");
    const slideRels = await relationships(zip, part);
    const charts: PptxSlide["charts"] = [];
    for (const match of xml.matchAll(/<c:chart\b[^>]*r:id="([^"]+)"/g)) {
      const rel = slideRels.find(item => item.id === match[1] && item.type.endsWith("/chart"));
      const chartFile = rel ? zip.file(rel.target) : null;
      if (!rel || !chartFile) { charts.push({ part: rel?.target ?? match[1], type: "missing", native: false, embeddedData: false }); continue; }
      const chartXml = await chartFile.async("string");
      const type = CHART_TYPES.find(name => chartXml.includes(`<c:${name}>`) || chartXml.includes(`<c:${name} `)) ?? "unknown";
      const chartRels = await relationships(zip, rel.target);
      const embedded = /<c:externalData\b/.test(chartXml) && chartRels.some(item => /\/package$/.test(item.type) && zip.file(item.target) !== null);
      charts.push({ part: rel.target, type, native: type !== "unknown" && /<c:plotArea>/.test(chartXml) && /<c:ser>/.test(chartXml), embeddedData: embedded });
    }
    const notesRel = slideRels.find(rel => rel.type.endsWith("/notesSlide"));
    let notes: string | null = null;
    if (notesRel && zip.file(notesRel.target)) {
      const notesXml = await zip.file(notesRel.target)!.async("string");
      // Only the notes body placeholder (not the slide image or slide number).
      const bodies = [...notesXml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(match => match[1]).filter(shape => /<p:ph\b[^>]*type="body"/.test(shape));
      const text = bodies.flatMap(texts).join(" ").replace(/\s+/g, " ").trim();
      notes = text || null;
    }
    slides.push({ slide: index + 1, text: texts(xml).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000), notes: notes?.slice(0, 3000) ?? null,
      pictures: (xml.match(/<p:pic>/g) ?? []).length, charts });
  }
  return { slides };
}
