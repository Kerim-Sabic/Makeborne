import { emptyDocument } from "../documents/editor";
import { DOCUMENT_BYTE_LIMIT, DocumentSourceSchema, type Book, type Chapter, type Deck, type DocumentAsset, type DocumentSource, type Slide } from "../documents/schema";
import { DataError } from "./dataset";
import { rangeText, type Fact, type FactsSheet } from "./facts";
import type { RenderedNarrative } from "./narrative";

/**
 * Turns a facts sheet and its (checked, rendered) narrative into the existing
 * document source: a book for reports and comparison sections, a deck for
 * findings and client reports. Deck charts are the existing ChartSchema, so the
 * existing PPTX writer emits native, editable charts with the same numbers;
 * book charts are figures rendered from the same chart data (PDF has no native
 * charts). Every figure on the page is a fact's display text, and an "About
 * the data" part lists the source, the cells used, missing values and method.
 */
export type ChartImages = Readonly<Record<string, { name: string; assetId: string }>>;
export type BuildInput = {
  facts: FactsSheet; narrative: RenderedNarrative; base: DocumentSource | null; mode: "replace" | "append";
  title?: string; sourceName: string; chartImages?: ChartImages; styleId?: string;
};

const clip = (text: string, max: number) => { const clean = text.replace(/\s+/g, " ").trim(); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; };
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "—";
const caption = (text: string) => text.replace(/[|\]\[]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
const table = (header: string[], rows: string[][]) => [`| ${header.map(cell).join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map(row => `| ${row.map(cell).join(" | ")} |`)].join("\n");
const factLine = (fact: Fact) => `${fact.id} ${fact.label}: ${fact.display} (${fact.refs || "no cells"}${fact.missing ? `; ${fact.missing.count} missing: ${fact.missing.refs}` : ""})`;

function uniqueId(base: string, taken: Set<string>) {
  let id = base.slice(0, 44), index = 2;
  while (taken.has(id)) id = `${base.slice(0, 40)}-${index++}`;
  taken.add(id);
  return id;
}

function dataNotes(facts: FactsSheet, sourceName: string): string[] {
  const lines: string[] = [];
  lines.push(`Source: ${sourceName}, sheet “${facts.source.sheet}” (file fingerprint ${facts.source.sha256.slice(0, 12)}, read with ${facts.source.extractionVersion}). Values are the ones last saved in the file; no formula was recalculated.`);
  if (facts.period) lines.push(`Period: ${facts.period.from} to ${facts.period.to} (calendar dates from column ${facts.period.column}; no time zone applies).`);
  lines.push("Figures are computed with exact decimal arithmetic. Averages, shares and changes are rounded half away from zero to the places shown. Amounts in different currencies or units are never added together.");
  return lines;
}

function aboutChapter(facts: FactsSheet, sourceName: string, id: string): Chapter {
  const parts: string[] = [...dataNotes(facts, sourceName)];
  parts.push("## Columns used", table(["Role", "Heading", "Column", "Cells"], facts.columnsUsed.map(column => [column.role, column.header, column.letter, rangeText(column.ranges, 6)])));
  if (facts.issues.length) {
    parts.push("## Values that could not be used", `${facts.issues.length} value${facts.issues.length === 1 ? "" : "s"} could not be read and ${facts.issues.length === 1 ? "is" : "are"} left out of every figure:`,
      table(["Cell", "Reason"], facts.issues.slice(0, 80).map(issue => [issue.ref, issue.reason])));
    if (facts.issues.length > 80) parts.push(`The other ${facts.issues.length - 80} are listed in the facts file saved with this report.`);
  } else parts.push("## Values that could not be used", "Every value in the columns used could be read.");
  if (facts.warnings.length) parts.push("## Notes", facts.warnings.map(warning => `- ${warning}`).join("\n"));
  const rows: string[][] = [];
  let size = parts.join("\n\n").length;
  for (const fact of facts.facts) {
    const row = [fact.id, fact.label, fact.display, fact.refs + (fact.missing ? `; missing ${fact.missing.refs}` : "")];
    size += row.join(" | ").length + 8;
    if (size > 34_000) break;
    rows.push(row);
  }
  parts.push("## Where each figure comes from", table(["Id", "Figure", "Value", "Cells"], rows));
  if (rows.length < facts.facts.length) parts.push(`${facts.facts.length - rows.length} more figures are listed in the facts file saved with this report.`);
  return { id, title: "About the data", opening: "inline", text: parts.join("\n\n") };
}

function book(input: BuildInput): Book {
  const { facts, narrative } = input;
  const base = input.base?.kind === "book" ? input.base : null;
  if (input.base && !base) throw new DataError("WRONG_DOCUMENT", "This report is a document; open a book project to create it.", 409);
  const start = input.mode === "append" && base ? base : emptyDocument("book", input.title ?? facts.title, input.styleId) as Book;
  const theme = base?.theme ?? start.theme;
  const taken = new Set(input.mode === "append" ? start.chapters.map(chapter => chapter.id) : []);
  const prefix = input.mode === "append" ? "data-" : "";
  const assets: DocumentAsset[] = input.mode === "append" ? [...start.assets] : [];
  const chapters: Chapter[] = [];
  const overview = facts.sections.find(section => section.id === "overview");
  const keyFacts = (overview?.factIds ?? []).map(id => facts.facts.find(fact => fact.id === id)).filter((fact): fact is Fact => Boolean(fact));
  const summary = [...narrative.summary];
  if (narrative.highlights.length) summary.push("## Highlights", narrative.highlights.map(item => `- **${item.title}**: ${item.text}`).join("\n"));
  if (keyFacts.length) summary.push("## Key figures", table(["Figure", "Value", "Cells"], keyFacts.map(fact => [fact.label, fact.display, fact.refs])));
  chapters.push({ id: uniqueId(`${prefix}summary`, taken), title: clip(input.mode === "append" ? facts.title : "Summary", 120), opening: "inline", text: summary.join("\n\n") });
  for (const section of facts.sections.filter(item => item.id !== "overview")) {
    const parts: string[] = [];
    if (narrative.sections[section.id]) parts.push(narrative.sections[section.id]);
    for (const chart of facts.charts.filter(item => item.section === section.id)) {
      const image = input.chartImages?.[chart.id];
      if (!image) continue;
      parts.push(`[[figure:${image.name}|${caption(`${chart.title}. Source: ${chart.chart.source ?? input.sourceName}`)}]]`);
      if (!assets.some(asset => asset.name === image.name)) assets.push({ name: image.name, id: image.assetId, aspect: "landscape", alt: clip(`${chart.title}: ${chart.points.map(point => `${point.category} ${facts.facts.find(fact => fact.id === point.factId)?.display ?? ""}`).join(", ")}`, 300), prompt: "" });
    }
    const tables = facts.tables.filter(item => item.id === section.id || item.id.startsWith(`${section.id}.`));
    for (const item of tables) parts.push(...(tables.length > 1 ? [`## ${item.title}`] : []), table(item.columns, item.rows.map(row => row.cells.map(entry => entry.text))));
    if (!tables.length) {
      const sectionFacts = section.factIds.map(id => facts.facts.find(fact => fact.id === id)).filter((fact): fact is Fact => Boolean(fact));
      if (sectionFacts.length) parts.push(table(["Figure", "Value", "Cells"], sectionFacts.map(fact => [fact.label, fact.display, fact.refs])));
    }
    if (parts.length) chapters.push({ id: uniqueId(`${prefix}${section.id}`, taken), title: clip(section.title, 120), opening: "inline", text: parts.join("\n\n") });
  }
  chapters.push(aboutChapter(facts, input.sourceName, uniqueId(`${prefix}about-data`, taken)));
  const next: Book = input.mode === "append" ? { ...start, chapters: [...start.chapters, ...chapters], assets }
    : { ...start, title: clip(input.title ?? narrative.headline ?? facts.title, 160), subtitle: clip(`${input.sourceName}${facts.period ? `, ${facts.period.from} to ${facts.period.to}` : ""}`, 220), theme, chapters, assets };
  if (next.chapters.length > 40) throw new DataError("DOCUMENT_FULL", "This document already has too many chapters to add the report. Use a new document.", 409);
  return next;
}

/** Speaker notes listing each figure with its cells (newlines kept), at most 3,000 characters. */
const note = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000) || "Figures computed from the source file.";
function notesFor(facts: FactsSheet, ids: readonly string[], lead = "") {
  const lines = ids.map(id => facts.facts.find(fact => fact.id === id)).filter((fact): fact is Fact => Boolean(fact)).map(factLine);
  let text = lead ? `${lead}\n\n` : "", included = 0;
  for (const line of lines) {
    if (text.length + line.length > 2850) { text += `…and ${lines.length - included} more figures in the facts file saved with this report.`; break; }
    text += `${line}\n`; included++;
  }
  return note(text);
}

function deck(input: BuildInput): Deck {
  const { facts, narrative } = input;
  const base = input.base?.kind === "deck" ? input.base : null;
  if (input.base && !base) throw new DataError("WRONG_DOCUMENT", "This report is a presentation; open a presentation project to create it.", 409);
  const start = input.mode === "append" && base ? base : emptyDocument("deck", input.title ?? facts.title, input.styleId) as Deck;
  const theme = base?.theme ?? start.theme;
  const taken = new Set(input.mode === "append" ? start.slides.map(slide => slide.id) : []);
  const prefix = input.mode === "append" ? "data-" : "";
  const slides: Slide[] = [];
  const subtitle = clip(`${input.sourceName}${facts.period ? ` · ${facts.period.from} to ${facts.period.to}` : ""}`, 220);
  const overview = facts.sections.find(section => section.id === "overview");
  if (input.mode === "replace") slides.push({ id: uniqueId("cover", taken), layout: "cover", tone: "dark", title: clip(input.title ?? narrative.headline, 120), subtitle, notes: note(`${narrative.summary.join("\n\n")}\n\nSource: ${dataNotes(facts, input.sourceName).join(" ")}`) });
  if (narrative.highlights.length >= 2) slides.push({ id: uniqueId(`${prefix}summary`, taken), layout: "points", tone: "light", eyebrow: "Summary", title: clip(input.mode === "append" ? narrative.headline : "What the numbers show", 120),
    points: narrative.highlights.slice(0, 6).map(item => ({ title: clip(item.title, 60), text: clip(item.text, 170) })), notes: notesFor(facts, overview?.factIds ?? [], narrative.summary.join("\n\n")) });
  else slides.push({ id: uniqueId(`${prefix}summary`, taken), layout: "statement", tone: "light", eyebrow: "Summary", title: clip(narrative.headline, 120), body: clip(narrative.summary[0], 420), notes: notesFor(facts, overview?.factIds ?? [], narrative.summary.join("\n\n")) });
  if (facts.template === "campaign_report" && overview) {
    const stats = ["spend.all", "conversions.all", "cpa.all", "roas.all", "ctr.all", "clicks.all"].map(key => facts.facts.find(fact => fact.key === key)).filter((fact): fact is Fact => Boolean(fact)).slice(0, 4);
    if (stats.length) slides.push({ id: uniqueId(`${prefix}totals`, taken), layout: "stats", tone: "accent", eyebrow: "Totals", title: "Across all campaigns",
      stats: stats.map(fact => ({ value: fact.compact.length <= 12 ? fact.compact : clip(fact.compact, 12), label: clip(fact.label.replace(/, all campaigns$/, ""), 60) })), notes: notesFor(facts, stats.map(fact => fact.id)) });
  }
  for (const section of facts.sections.filter(item => item.id !== "overview")) {
    const charts = facts.charts.filter(item => item.section === section.id);
    charts.forEach((chart, index) => slides.push({ id: uniqueId(`${prefix}${chart.id}`.replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "c"), taken), layout: "chart", tone: "light", eyebrow: clip(section.title, 40),
      title: clip(chart.title, 120), ...(index === 0 && narrative.sections[section.id] ? { subtitle: clip(narrative.sections[section.id], 220) } : {}), chart: chart.chart,
      notes: notesFor(facts, chart.points.map(point => point.factId), `Chart data (editable in PowerPoint). Source: ${chart.chart.source ?? input.sourceName}.`) }));
  }
  for (const item of facts.tables.filter(entry => entry.id === "campaigns")) {
    if (item.columns.length < 2) continue;
    slides.push({ id: uniqueId(`${prefix}table`, taken), layout: "table", tone: "light", eyebrow: "Detail", title: clip(item.title, 120),
      table: { columns: item.columns.slice(0, 6).map(column => clip(column, 32)), rows: item.rows.slice(0, 8).map(row => row.cells.slice(0, 6).map(entry => clip(entry.text, 60))) },
      notes: notesFor(facts, item.rows.flatMap(row => row.cells.flatMap(entry => entry.factId ? [entry.factId] : [])), item.rows.length > 8 ? `Showing 8 of ${item.rows.length} rows; the facts file has all of them.` : "") });
  }
  const method = [
    { title: "Source", text: clip(`${input.sourceName}, sheet “${facts.source.sheet}”. Values as last saved; formulas not recalculated.`, 170) },
    { title: "Missing data", text: clip(facts.issues.length ? `${facts.issues.length} value${facts.issues.length === 1 ? "" : "s"} could not be read and ${facts.issues.length === 1 ? "is" : "are"} left out. Cells are listed in the notes.` : "Every value in the columns used could be read.", 170) },
    { title: "Method", text: "Exact decimal arithmetic; shares and ratios rounded half away from zero. Different currencies are never combined." },
  ];
  slides.push({ id: uniqueId(`${prefix}about-data`, taken), layout: "points", tone: "light", eyebrow: "About the data", title: "How these figures were computed", points: method,
    notes: note([...dataNotes(facts, input.sourceName), ...facts.warnings, ...facts.issues.slice(0, 40).map(issue => `${issue.ref}: ${issue.reason}`), facts.issues.length > 40 ? `…${facts.issues.length - 40} more in the facts file.` : ""].filter(Boolean).join("\n")) });
  const next: Deck = input.mode === "append" ? { ...start, slides: [...start.slides, ...slides] } : { ...start, title: clip(input.title ?? narrative.headline, 160), subtitle, theme, slides };
  if (next.slides.length > 40) throw new DataError("DOCUMENT_FULL", "This presentation would have more than 40 slides. Use a new presentation for the report.", 409);
  return next;
}

/** The validated document source (the same schema every saved document passes). */
export function buildDocument(input: BuildInput): DocumentSource {
  const doc = (input.facts.template === "sales_monthly" || input.facts.template === "catalogue_comparison") ? book(input) : deck(input);
  const parsed = DocumentSourceSchema.safeParse(doc);
  if (!parsed.success) throw new DataError("DOCUMENT_INVALID", `The report could not be laid out: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".")} ${issue.message}`).join("; ")}`, 500);
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > DOCUMENT_BYTE_LIMIT) throw new DataError("DOCUMENT_TOO_LARGE", "The report is too large for one document. Choose fewer columns or split the file.");
  return parsed.data;
}
