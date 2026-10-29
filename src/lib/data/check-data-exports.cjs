/* eslint-disable @typescript-eslint/no-require-imports -- Real export round trips for data reports: generated datasets → saved report (fake RLS storage) → the real PDF printer (offline Chromium) and PPTX writer → files parsed back. No network, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip");
const { chromium } = require("playwright");
const fx = require("./fixtures.cjs");
const { extract } = require("../ingest/parsers/core.cjs");
const { WorkerRecordSchema } = require("../ingest/record.ts");
const report = require("./report.ts"), templates = require("./templates.ts"), narrative = require("./narrative.ts"), persist = require("./persist.ts"), decimal = require("./decimal.ts");
const { documentPdf, documentPptx } = require("../documents/export-server.ts");
const { mapVersion } = require("../cloud/mappers.ts");
const { inspectPptx } = require("../review/pptx-inspect.ts");
const { inspectPdf } = require("../review/pdf-inspect.ts");

let passed = 0;
async function check(name, fn) { const started = Date.now(); await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`); }
const record = (bytes, name) => ({ ...WorkerRecordSchema.parse(extract({ bytes, name, declaredType: name.endsWith(".csv") ? "text/csv" : fx.XLSX })), sourceSha256: createHash("sha256").update(bytes).digest("hex") });
const same = (a, b) => decimal.cmp(decimal.parseDec(String(a)), decimal.parseDec(String(b))) === 0;
const decode = text => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Reads every native chart back out of the PPTX: series names, category labels and cached values from the c:chart parts, plus the embedded workbook. */
async function chartsIn(bytes) {
  const zip = await JSZip.loadAsync(bytes), out = [];
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  for (const slide of slides) {
    const rels = await zip.file(slide.replace("slides/", "slides/_rels/") + ".rels")?.async("string") ?? "";
    for (const match of (await zip.file(slide).async("string")).matchAll(/<c:chart\b[^>]*r:id="([^"]+)"/g)) {
      const target = new RegExp(`Id="${match[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${match[1]}"`).exec(rels)?.[1];
      const part = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join("ppt/slides", target));
      const xml = await zip.file(part).async("string");
      const series = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map(([, ser]) => ({
        name: decode(/<c:tx>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/.exec(ser)?.[1] ?? ""),
        categories: [.../<c:cat>([\s\S]*?)<\/c:cat>/.exec(ser)[1].matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)].map(item => decode(item[1])),
        values: [.../<c:val>([\s\S]*?)<\/c:val>/.exec(ser)[1].matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)].map(item => item[1]),
      }));
      const chartRels = await zip.file(part.replace("charts/", "charts/_rels/") + ".rels")?.async("string") ?? "";
      const embedded = /Target="([^"]+\.xlsx)"/.exec(chartRels)?.[1];
      const workbook = embedded ? await zip.file(embedded.startsWith("/") ? embedded.slice(1) : path.posix.normalize(path.posix.join("ppt/charts", embedded))).async("nodebuffer") : null;
      out.push({ slide, part, type: /<c:(barChart|lineChart|doughnutChart|pieChart)>/.exec(xml)?.[1], series, workbook });
    }
  }
  return out;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); await browser.close(); }
  catch (error) { console.log(`SKIP data report export round trips: Chromium is unavailable (${String(error.message).split("\n")[0]})`); return; }

  async function generate(bytes, name, template, kind) {
    const cloud = fx.makeCloud();
    const artifactId = fx.addArtifact(cloud, kind);
    const prepared = report.prepareReport(record(bytes, name), report.ReportRequestSchema.parse({ source: { assetId: randomUUID(), sha256: "a".repeat(64) }, template }), name);
    const facts = prepared.facts;
    const current = mapVersion(cloud.tables.artifact_versions.find(row => row.artifact_id === artifactId));
    const saved = await persist.persistDataReport({ client: fx.clientFor(cloud, fx.EDITOR), scope: { workspaceId: fx.W1, projectId: fx.P1 }, artifact: { id: artifactId, kind, current_version: 1 }, current, expectedVersion: 1, actionKey: randomUUID(),
      facts, narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), narrativeSource: "plain", mode: "replace", sourceName: name, sourceAsset: { id: randomUUID(), sha256: "a".repeat(64) } },
      { renderPdf: documentPdf, renderPptx: documentPptx, loadImages: async () => ({}) });
    const fileBytes = format => { const file = saved.files.find(item => item.format === format); const row = cloud.tables.assets.find(item => item.id === file.assetId); const object = cloud.storage.get(row.object_path);
      assert.equal(createHash("sha256").update(object.bytes).digest("hex"), row.sha256); return object.bytes; };
    return { cloud, facts, saved, fileBytes, version: mapVersion(cloud.tables.artifact_versions.find(row => row.artifact_id === artifactId && row.version_number === 2)) };
  }

  async function roundTrip(result) {
    const { facts, fileBytes } = result;
    const pptx = fileBytes("pptx");
    const inspection = await inspectPptx(pptx);
    const charts = await chartsIn(pptx);
    assert.equal(charts.length, facts.charts.length, "one native chart per computed chart");
    const nativeSlides = inspection.slides.filter(slide => slide.charts.length);
    assert.equal(nativeSlides.length, facts.charts.length);
    for (const slide of nativeSlides) for (const chart of slide.charts) assert.deepEqual([chart.native, chart.embeddedData], [true, true], "editable in PowerPoint: a real plot with its embedded workbook");
    // The stored facts sheet is the reference: every plotted value equals its fact, category by category.
    const stored = JSON.parse(fileBytes("facts").toString("utf8"));
    assert.equal(stored.digest, facts.digest);
    charts.forEach((chart, index) => {
      const source = stored.charts[index];
      assert.equal(chart.series.length, source.chart.series.length, source.id);
      chart.series.forEach((series, s) => {
        const points = source.points.filter(point => point.series.slice(0, 40) === source.chart.series[s].name);
        assert.equal(series.name, source.chart.series[s].name);
        assert.deepEqual(series.categories, source.chart.categories, `${source.id} categories`);
        assert.equal(series.values.length, points.length);
        series.values.forEach((value, i) => {
          assert.ok(same(value, points[i].value), `${source.id}: ${series.name} ${series.categories[i]} = ${value}, fact ${points[i].factId} = ${points[i].value}`);
          assert.equal(stored.facts.find(item => item.id === points[i].factId).value, points[i].value);
        });
      });
      // The embedded workbook (what PowerPoint edits) holds the same numbers, read back with the ingestion parser.
      const workbook = record(chart.workbook, "embedded.xlsx");
      const cells = workbook.sheets[0].cells;
      source.chart.series.forEach((series, s) => points(source, s).forEach((point, i) => {
        const cell = cells.find(item => item.row === i + 1 && item.col === s + 1);
        assert.ok(cell && same(decimal.decText(decimal.fromNumber(cell.value)), point.value), `${source.id} workbook ${cell?.ref}`);
      }));
    });
    // PDF produced from the same saved document.
    const pdf = fileBytes("pdf");
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(inspectPdf(pdf).pageCount, result.version.content.document.slides.length);
  }
  const points = (source, s) => source.points.filter(point => point.series.slice(0, 40) === source.chart.series[s].name);

  await check("campaign client report: native editable charts in the saved PPTX round-trip to exactly the facts sheet (chart XML caches and embedded workbooks); the PDF has one page per slide", async () => {
    const result = await generate(fx.CAMPAIGN_CSV, "campaigns.csv", "campaign_report", "presentation");
    assert.deepEqual(result.saved.files.map(file => file.format), ["facts", "pdf", "pptx"]);
    await roundTrip(result);
    const charts = await chartsIn(result.fileBytes("pptx"));
    assert.deepEqual(charts.map(chart => chart.type), ["barChart", "barChart", "barChart", "barChart", "lineChart"]);
  });

  await check("survey findings deck: shares per answer and the cross-tab round-trip exactly; speaker notes carry fact ids and cells", async () => {
    const result = await generate(fx.SURVEY_CSV, "survey.csv", "survey_findings", "presentation");
    await roundTrip(result);
    const inspection = await inspectPptx(result.fileBytes("pptx"));
    assert.ok(inspection.slides.filter(slide => slide.charts.length).every(slide => /F\d{3} .*survey!/.test(slide.notes ?? "")));
  });

  await check("monthly sales report (book): PDF with chart figures and an outline including the data notes; the figures are stored project images from the same chart data", async () => {
    const result = await generate(fx.SALES_CSV, "sales.csv", "sales_monthly", "book");
    assert.deepEqual(result.saved.files.map(file => file.format), ["facts", "pdf"]);
    const pdf = inspectPdf(result.fileBytes("pdf"));
    assert.ok(pdf.pageCount >= 3);
    assert.ok(pdf.outline.some(entry => entry.title === "About the data"), JSON.stringify(pdf.outline));
    assert.ok(pdf.pages.reduce((sum, page) => sum + page.images, 0) >= result.facts.charts.length, "chart figures are printed");
    const charts = result.cloud.tables.assets.filter(row => row.provenance.kind === "data_report_chart");
    assert.equal(charts.length, result.facts.charts.length);
    assert.ok(charts.every(row => result.version.assetIds.includes(row.id) && row.object_path.endsWith(".webp")));
  });

  console.log(`\n${passed} data report export checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
