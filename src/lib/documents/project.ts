import type { DocumentSource } from "./schema";
import { parseBookMarkup, plainText } from "./book-markup";
import { formatValue } from "./chart-svg";

type Block = { id: string; type: "heading" | "paragraph" | "image" | "quote" | "list" | "table" | "chart" | "callout"; text: string; assetId: string | null; locked: boolean; sourceIds: string[] };
type Section = { id: string; title: string; blocks: Block[] };

/** Outline projection of a document into the artifact's sections/blocks, so
 * existing listings, search, EPUB export and version history keep working. */
export function projectDocument(doc: DocumentSource, newId: () => string = () => crypto.randomUUID()): Section[] {
  const assetId = (name?: string) => name ? doc.assets.find(asset => asset.name === name)?.id ?? null : null;
  const block = (type: Block["type"], text: string, asset: string | null = null): Block => ({ id: newId(), type, text: text.slice(0, 50_000), assetId: asset, locked: false, sourceIds: [] });
  if (doc.kind === "deck") {
    return doc.slides.map(slide => {
      const blocks: Block[] = [];
      const lead = [slide.subtitle, slide.body].filter(Boolean).join("\n\n");
      if (lead) blocks.push(block("paragraph", lead));
      if (slide.points) blocks.push(block("list", slide.points.map(point => `${point.title ? `${point.title}: ` : ""}${point.text}`).join("\n")));
      if (slide.stats) blocks.push(block("list", slide.stats.map(stat => `${stat.value} — ${stat.label}${stat.detail ? ` (${stat.detail})` : ""}`).join("\n")));
      if (slide.chart) blocks.push(block("chart", `${slide.chart.type} chart\n${slide.chart.categories.map((category, index) => `${category}: ${slide.chart!.series.map(series => `${slide.chart!.series.length > 1 ? `${series.name} ` : ""}${formatValue(slide.chart!, series.values[index])}`).join(", ")}`).join("\n")}${slide.chart.source ? `\nSource: ${slide.chart.source}` : ""}`));
      if (slide.diagram) blocks.push(block("list", slide.diagram.items.map(item => `${item.label}${item.detail ? ` — ${item.detail}` : ""}`).join("\n")));
      if (slide.compare) blocks.push(block("list", [slide.compare.left, slide.compare.right].map(side => `${side.heading}: ${side.points.join("; ")}`).join("\n")));
      if (slide.quote) blocks.push(block("quote", `${slide.quote.text}${slide.quote.attribution ? ` — ${slide.quote.attribution}` : ""}`));
      if (slide.people) blocks.push(block("list", slide.people.map(person => `${person.name} — ${person.role}${person.detail ? ` (${person.detail})` : ""}`).join("\n")));
      if (slide.tiers) blocks.push(block("list", slide.tiers.map(tier => `${tier.name}: ${tier.price}${tier.period ? ` ${tier.period}` : ""}${tier.description ? ` — ${tier.description}` : ""}${tier.features.length ? ` (${tier.features.join("; ")})` : ""}`).join("\n")));
      if (slide.table) blocks.push(block("list", [slide.table.columns, ...slide.table.rows].map(row => row.join(" | ")).join("\n")));
      if (slide.image && assetId(slide.image)) blocks.push(block("image", doc.assets.find(asset => asset.name === slide.image)?.alt ?? "", assetId(slide.image)));
      blocks.push(block("callout", `Speaker notes: ${slide.notes}`));
      return { id: newId(), title: slide.title.slice(0, 200), blocks };
    });
  }
  return doc.chapters.map(chapter => {
    const blocks: Block[] = [block("heading", chapter.title)];
    if (chapter.image && assetId(chapter.image)) blocks.push(block("image", doc.assets.find(asset => asset.name === chapter.image)?.alt ?? "", assetId(chapter.image)));
    if (chapter.epigraph) blocks.push(block("quote", `${chapter.epigraph.text}${chapter.epigraph.attribution ? ` — ${chapter.epigraph.attribution}` : ""}`));
    for (const entry of parseBookMarkup(chapter.text)) {
      if (entry.type === "paragraph") blocks.push(block("paragraph", plainText(entry.text)));
      else if (entry.type === "subheading") blocks.push(block("heading", plainText(entry.text)));
      else if (entry.type === "quote") blocks.push(block("quote", plainText(`${entry.text}${entry.attribution ? ` — ${entry.attribution}` : ""}`)));
      else if (entry.type === "list") blocks.push(block("list", entry.items.map(plainText).join("\n")));
      else if (entry.type === "table") blocks.push(block("list", [...(entry.header ? [entry.header] : []), ...entry.rows].map(row => row.map(plainText).join(" | ")).join("\n")));
      else if (entry.type === "note") blocks.push(block("callout", plainText(`${entry.title ? `${entry.title}: ` : ""}${entry.text}`)));
      else if (entry.type === "pullquote") blocks.push(block("quote", plainText(`${entry.text}${entry.attribution ? ` — ${entry.attribution}` : ""}`)));
      else if (entry.type === "figure" && assetId(entry.image)) blocks.push(block("image", plainText(entry.caption ?? ""), assetId(entry.image)));
    }
    return { id: newId(), title: chapter.title.slice(0, 200), blocks };
  });
}

/** Asset ids the saved version must list in its manifest. */
export const documentAssetIds = (doc: DocumentSource) => doc.assets.map(asset => asset.id);
