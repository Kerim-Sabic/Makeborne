/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS check fixture. */
/* Synthetic, illustrative fixtures for the art-direction checks: every layout and diagram kind at the
 * copy lengths the agent prompt recommends, plus a legacy (pre-direction) deck as it was saved. */
const { deckSlides, palette } = require("./design-quality.cjs");
const notes = "Synthetic art-direction fixture.";

function slides() {
  const base = deckSlides().filter(slide => slide.id !== "points6" && slide.id !== "team6");
  return [
    ...base,
    { id: "agenda", layout: "agenda", tone: "light", eyebrow: "Today", title: "What we will cover", notes, points: [{ title: "Where you are", text: "What we heard in the workshop." }, { title: "What we will make", text: "Identity, packaging, website." }, { title: "How we work", text: "Four phases, ten weeks." }, { title: "Investment", text: "Two ways to start." }] },
    { id: "hero1", layout: "stats", tone: "accent", eyebrow: "The number", title: "Half the weight of a typical e-bike", notes, stats: [{ value: "12 kg", label: "Total weight, battery included", detail: "A typical city e-bike weighs about 25 kg" }] },
    { id: "hero2", layout: "stats", tone: "light", eyebrow: "Why us", title: "A small senior team, start to finish", notes, stats: [{ value: "3", label: "Senior designers on your project" }, { value: "10 wks", label: "From workshop to launch" }] },
    { id: "line", layout: "chart", tone: "light", eyebrow: "Meals", title: "Demand peaked in winter and stayed", body: "Q4 meals were 46% above Q1.", notes, chart: { type: "line", categories: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Meals", values: [390, 430, 505, 570] }], highlight: 3, source: "Illustrative" } },
    { id: "bar", layout: "chart", tone: "light", eyebrow: "Spending", title: "87 cents of every dollar reached families", body: "Overheads stayed under 13%.", notes, chart: { type: "bar", categories: ["Food", "Logistics", "Programs", "Fundraising"], series: [{ name: "Share", values: [52, 21, 14, 13] }], unit: "%", highlight: 0 } },
    { id: "donut", layout: "chart", tone: "light", eyebrow: "Mix", title: "Most revenue is recurring", notes, chart: { type: "donut", categories: ["Subscriptions", "Services", "Hardware"], series: [{ name: "Revenue", values: [62, 23, 15] }], highlight: 0 } },
    { id: "cycle", layout: "diagram", tone: "light", eyebrow: "Loop", title: "Every fix makes the model sharper", notes, diagram: { kind: "cycle", items: [{ label: "Sense" }, { label: "Detect" }, { label: "Fix", detail: "Plumber confirms" }, { label: "Learn" }] } },
    { id: "funnel", layout: "diagram", tone: "light", eyebrow: "Funnel", title: "Pilots convert at every stage", notes, diagram: { kind: "funnel", items: [{ label: "Leads", detail: "1,200 owners" }, { label: "Pilots", detail: "140 buildings" }, { label: "Paying", detail: "92 buildings" }] } },
    { id: "matrix", layout: "diagram", tone: "light", eyebrow: "Position", title: "Cheap to install, easy to read", notes, diagram: { kind: "matrix", axes: { x: "Ease", y: "Cost" }, items: [{ label: "Manual checks", detail: "Cheap, unreliable" }, { label: "Tidewell", detail: "Cheap, reliable" }, { label: "Plumbers", detail: "Costly, reactive" }, { label: "BMS", detail: "Costly, complex" }] } },
    { id: "canvas", layout: "canvas", tone: "light", title: "Twelve kilograms", notes, blocks: [
      { type: "shape", shape: "rect", col: 8, span: 5, row: 1, rows: 8, fill: "accent" },
      { type: "shape", shape: "circle", col: 9, span: 3, row: 2, rows: 3, fill: "dark" },
      { type: "text", style: "label", text: "The number", col: 1, span: 4, row: 1, rows: 1 },
      { type: "text", style: "display", text: "12 kg", col: 1, span: 7, row: 2, rows: 4 },
      { type: "text", style: "lead", text: "Half the weight of a typical city e-bike, battery included.", col: 1, span: 6, row: 6, rows: 2 },
      { type: "text", style: "body", text: "Carry it up three flights.", col: 8, span: 5, row: 7, rows: 2 } ] },
  ];
}

const deck = (fonts, direction, extra = {}) => ({
  kind: "deck", schemaVersion: 1, title: "Art direction fixture", author: "Synthetic studio",
  theme: { palette, fonts, mood: "", imageStyle: "", ...(direction ? { direction } : {}), ...extra },
  slides: slides(), assets: [{ name: "art", id: "00000000-0000-4000-8000-0000000000a1", aspect: "landscape", alt: "Abstract artwork", prompt: "" }],
});

/** A deck exactly as decks were saved before art directions: no direction field. */
const legacy = motif => ({
  kind: "deck", schemaVersion: 1, title: "Tidewell — Seed round", theme: { palette, fonts: "geist", mood: "Precise", imageStyle: "", ...(motif ? { motif } : {}) }, assets: [],
  slides: [
    { id: "cover", layout: "cover", tone: "dark", eyebrow: "Seed round · 2026", title: "Stop paying for water you never see", subtitle: "Tidewell finds hidden leaks before they become claims.", notes },
    { id: "problem", layout: "statement", tone: "light", eyebrow: "The problem", title: "Most leaks are found eight months too late.", body: "Slow leaks hide behind walls.", notes },
    { id: "stats", layout: "stats", tone: "light", eyebrow: "Market", title: "Mid-size owners are big and ignored", stats: [{ value: "$14B", label: "Claims a year" }, { value: "380K", label: "Buildings" }, { value: "23%", label: "Wasted" }], notes },
    { id: "close", layout: "closing", tone: "dark", eyebrow: "The ask", title: "$2.5M to reach 600 buildings", body: "18 months of runway.", notes },
  ],
});

module.exports = { slides, deck, legacy, palette };
