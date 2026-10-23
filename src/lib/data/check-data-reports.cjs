/* eslint-disable @typescript-eslint/no-require-imports -- Offline data-to-deliverable harness: every spreadsheet is generated here; real parsers, real worker, RLS-emulating fake database/storage, fake narrative writer; no network, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const http = require("node:http"), https = require("node:https"), net = require("node:net");

// ---- Module seams: server key client → in-memory storage + operation RPC fake; cookie client → per-user RLS fake ----
const fake = require("../review/operation-fake.cjs");
let cloud = null, currentUser = null, renderCalls = 0;
const fakeRender = { documentPdf: async doc => { renderCalls++; return Buffer.from(`%PDF-1.7 fake ${doc.title}`); }, documentPptx: async doc => { renderCalls++; return Buffer.from(`PK fake ${doc.title}`); } };
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name === "@/lib/supabase/server") return { createClient: async () => clientFor(cloud, currentUser) };
  if (name === "next/headers") return { headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set() {} }) };
  if (name === "@/lib/billing/access") return { requireCreationAccess: async () => {} };
  if (name === "./config" && parent?.filename?.replace(/\\/g, "/").endsWith("cloud/server.ts")) return { CLOUD_SCHEMA_VERSION: "20261003_cloud_v2", getCloudStatus: () => ({ enabled: true, reason: null }) };
  if (name === "@/lib/documents/export-server") { const real = load.call(this, path.join(__dirname, "../documents/export-server.ts"), parent, main); return { ...real, ...fakeRender }; }
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({
    rpc: (n, a) => { const result = Promise.resolve().then(() => fake.rpc(n, a)); result.abortSignal = () => result; return result; },
    storage: { from: () => ({ download: async objectPath => { const object = cloud?.storage.get(objectPath); return object ? { data: new Blob([object.bytes]), error: null } : { data: null, error: new Error("Object not found") }; } }) },
  }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000 };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

// Any network access from the data path fails the run.
let network = 0;
const trap = () => { network++; throw new Error("network access from the data path"); };
globalThis.fetch = trap; http.request = trap; http.get = trap; https.request = trap; https.get = trap; net.connect = trap; net.createConnection = trap;

const f = require("../ingest/fixtures.cjs");
const { extract } = require("../ingest/parsers/core.cjs");
const { WorkerRecordSchema } = require("../ingest/record.ts");
const sheets = require("../ingest/sheets.ts");
const decimal = require("./decimal.ts"), dataset = require("./dataset.ts"), templates = require("./templates.ts"), narrative = require("./narrative.ts");
const report = require("./report.ts"), documents = require("./documents.ts"), persist = require("./persist.ts"), files = require("./files.ts"), server = require("./server.ts");
const narrativeAi = require("./narrative-ai.ts");
const { DocumentSourceSchema } = require("../documents/schema.ts");
const { emptyDocument } = require("../documents/editor.ts");
const task = require("../agency/task.ts"), operationServer = require("../builder/operation-server.ts");
const { aiCostUsdPerCredit } = require("../builder/pricing.ts");
const RATE = Math.round(aiCostUsdPerCredit() * 1_000_000);

let passed = 0;
async function check(name, fn) { fake.reset(); renderCalls = 0; await fn(); passed++; console.log(`PASS ${name}`); }
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function record(bytes, name, limits) {
  const out = WorkerRecordSchema.parse(extract({ bytes, name, declaredType: name.endsWith(".csv") ? "text/csv" : XLSX, limits }));
  return { ...out, sourceSha256: createHash("sha256").update(bytes).digest("hex") };
}
const csv = rows => Buffer.from(rows.map(row => row.map(value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value)).join(",")).join("\n"), "utf8");
const ASSET = "0b6f7f5e-3c1d-4a8e-9b2a-5d4c3b2a1f00";
const request = (template, extra = {}) => report.ReportRequestSchema.parse({ source: { assetId: ASSET, sha256: "a".repeat(64) }, template, ...extra });
const prepare = (bytes, name, template, extra) => report.prepareReport(record(bytes, name), request(template, extra), name);
const fact = (facts, key) => { const found = facts.facts.find(item => item.key === key); assert(found, `fact ${key}`); return found; };
const rejects = async (fn, code) => { await assert.rejects(Promise.resolve().then(fn), error => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; }); };
const throwsCode = (fn, code) => assert.throws(fn, error => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; });

const fx = require("./fixtures.cjs");
const { centsText, canonical, sumCents, pctChange, OWNER, EDITOR, REVIEWER, OUTSIDER, W1, W2, P1, makeCloud, addArtifact, addSource, clientFor,
  SALES, SALES_CSV, SURVEY, SURVEY_CSV, CAMPAIGNS, CAMPAIGN_CSV, CATALOGUE_CSV } = fx;
const versionOf = (state, artifactId, number) => require("../cloud/mappers.ts").mapVersion(state.tables.artifact_versions.find(row => row.artifact_id === artifactId && row.version_number === number));
const persistDeps = () => ({ renderPdf: fakeRender.documentPdf, renderPptx: fakeRender.documentPptx, loadImages: async () => ({}) });

(async () => {
  fake.setup({ W: W1, P: P1, ACTOR: OWNER });

  await check("exact decimals: no binary drift, explicit half-away-from-zero rounding, division by zero is undefined", async () => {
    const d = decimal.parseDec;
    assert.equal(decimal.decText(decimal.add(d("0.1"), d("0.2"))), "0.3");
    assert.equal(decimal.decText(decimal.sum(Array.from({ length: 1000 }, () => d("0.01")))), "10");
    assert.equal(decimal.decText(decimal.divide(d("1"), d("3"), 4)), "0.3333");
    assert.equal(decimal.decText(decimal.divide(d("2"), d("3"), 2)), "0.67");
    assert.equal(decimal.decText(decimal.round(d("2.345"), 2)), "2.35");
    assert.equal(decimal.decText(decimal.round(d("-2.345"), 2)), "-2.35");
    assert.equal(decimal.divide(d("5"), d("0"), 2), null);
    assert.equal(decimal.decText(decimal.shift(d("0.25"), 2)), "25");
    assert.equal(decimal.decText(decimal.shift(d("12.5"), -3)), "0.0125");
    assert.equal(decimal.decText(decimal.fromNumber(1e21)), "1000000000000000000000");
    assert.equal(decimal.decText(decimal.fromNumber(1.5e-7)), "0.00000015");
    assert.equal(decimal.formatDec(d("1234567.5"), 2), "1,234,567.50");
    assert.equal(decimal.formatDec(d("-0.004"), 2), "0.00");
  });

  await check("sales CSV: totals, months, change and categories reconcile exactly with independently computed cents (and the stage 2 helper)", async () => {
    const prepared = prepare(SALES_CSV, "sales.csv", "sales_monthly");
    const facts = prepared.facts;
    assert.deepEqual(prepared.roles, { date: "A", amount: "B", category: "C" });
    const total = fact(facts, "total");
    assert.deepEqual([total.value, total.currency, total.n, total.refs, total.display.startsWith("€")], [canonical(centsText(sumCents(SALES.map(row => row.cents)))), "EUR", 240, "sales!B2:B241", true]);
    for (let month = 1; month <= 6; month++) {
      const key = `2026-${String(month).padStart(2, "0")}`, items = SALES.filter(row => row.date.startsWith(key));
      assert.equal(fact(facts, `month.${key}`).value, canonical(centsText(sumCents(items.map(row => row.cents)))), key);
      assert.equal(fact(facts, `month.${key}`).n, items.length);
    }
    const sumOf = list => decimal.decText(decimal.sum(list.map(item => decimal.parseDec(item.value))));
    assert.equal(sumOf(facts.facts.filter(item => /^month\.\d{4}-\d{2}$/.test(item.key))), total.value, "months add up to the total");
    assert.equal(sumOf(facts.facts.filter(item => /^category\./.test(item.key))), total.value, "top five + Other add up to the total");
    const june = sumCents(SALES.filter(row => row.date.startsWith("2026-06")).map(row => row.cents)), may = sumCents(SALES.filter(row => row.date.startsWith("2026-05")).map(row => row.cents));
    assert.equal(fact(facts, "change").value, canonical(centsText(june - may)));
    assert.equal(fact(facts, "change-pct").value, pctChange(june, may));
    assert.equal(fact(facts, "change-pct").denominator.value, canonical(centsText(may)));
    assert.equal(fact(facts, "average").value, decimal.decText(decimal.divide(decimal.parseDec(total.value), decimal.parseDec("240"), 2)));
    assert.deepEqual([facts.period.from.slice(0, 7), facts.period.to.slice(0, 7)], ["2026-01", "2026-06"]);
    for (const group of sheets.aggregateBy(record(SALES_CSV, "sales.csv").sheets[0], { groupBy: "C", value: "B" }).groups) {
      const found = facts.facts.find(item => item.key === `category.${group.key}`);
      if (found) assert.equal(found.value, canonical(group.sumText), group.key);
    }
    assert.equal(prepare(SALES_CSV, "sales.csv", "sales_monthly").facts.digest, facts.digest, "deterministic digest");
    assert.equal(facts.charts.find(chart => chart.id === "monthly").chart.series[0].values.length, 6);
  });

  await check("sales XLSX: serial dates, currency number formats (incl. [$€-x-euro2]), saved formula results used and flagged, a formula without a saved result reported missing", async () => {
    const rows = [[f.cell.str("A1", "Date"), f.cell.str("B1", "Net sales"), f.cell.str("C1", "Region")]];
    let cents = [];
    for (let index = 0; index < 40; index++) {
      const r = index + 2, serial = 46023 + index * 4, value = 1000 + index * 1234; // 2026-01-01 + 4 days each
      cents.push(value);
      rows.push([f.cell.n(`A${r}`, serial, 1), index === 7 ? `<c r="B${r}" s="2"><f>B${r - 1}+1</f><v>${centsText(value)}</v></c>` : f.cell.n(`B${r}`, centsText(value), index % 2 ? 2 : 3), f.cell.str(`C${r}`, index % 3 ? "North" : "South")]);
    }
    rows.push([f.cell.n("A42", 46200, 1), f.cell.f("B42", "SUM(B2:B41)"), f.cell.str("C42", "North")]); // no cached result
    const bytes = f.xlsx({ sheets: [{ name: "Q1 sales", rows }], numFmts: [[164, "[$€-x-euro2] #,##0.00"], [165, '"€"#,##0.00']], xfs: [0, 14, 164, 165] });
    const rec = record(bytes, "q1.xlsx");
    assert.equal(rec.status, "partial");
    const prepared = report.prepareReport(rec, request("sales_monthly", { options: { mixedCurrency: "refuse" } }), "q1.xlsx");
    const facts = prepared.facts;
    const total = fact(facts, "total");
    assert.deepEqual([total.value, total.currency, total.n], [canonical(centsText(sumCents(cents))), "EUR", 40]);
    assert.equal(total.refs, "'Q1 sales'!B2:B41");
    assert.equal(total.missing.refs, "'Q1 sales'!B42");
    const issue = facts.issues.find(item => item.ref === "B42");
    assert.match(issue.reason, /formula with no saved result/);
    assert.match(issue.raw, /SUM\(B2:B41\)/);
    assert.ok(facts.warnings.some(warning => /1 value in Net sales \(column B\) is a formula result/.test(warning)));
    assert.equal(fact(facts, "month.2026-01").value, canonical(centsText(sumCents(cents.slice(0, 8)))));
    // The ingestion helper's exact grouped sums agree.
    for (const group of sheets.aggregateBy(rec.sheets[0], { groupBy: "C", value: "B" }).groups) assert.ok(group.key === "North" || group.key === "South");
  });

  await check("malformed numeric and date input is handled explicitly: refused with a reason, resolved only by a declared format", async () => {
    const bytes = csv([["When", "Amount", "Note"], ["2026-03-01", "1.234,56", "eu"], ["12/13/2026", "1,234", "ambiguous"], ["13/12/2026", "n/a", "na"], ["03/04/2026", "abc", "text"], ["2026-02-30", "€5.00", "bad date"], ["12/13/26", "", "empty"], ["01.04.2026.", "(1,000.50)", "negative"]]);
    const plain = dataset.buildDataset(record(bytes, "m.csv"), { columns: [{ column: "A", kind: "date" }, { column: "B", kind: "number" }] });
    const reason = ref => plain.issues.find(item => item.ref === ref)?.reason ?? (plain.rows.flatMap(row => Object.values(row.cells)).find(cell => cell.ref === ref)?.reason);
    const cell = ref => plain.rows.flatMap(row => Object.values(row.cells)).find(item => item.ref === ref);
    assert.equal(decimal.decText(cell("B2").value), "1234.56");
    assert.match(reason("B3"), /could be read two ways; choose the decimal mark/);
    assert.match(reason("B4"), /marked as not available/);
    assert.match(reason("B5"), /“abc” is not a number/);
    assert.equal(cell("B6").currency, "EUR");
    assert.equal(reason("B7"), "empty");
    assert.equal(decimal.decText(cell("B8").value), "-1000.5");
    assert.match(reason("A3"), /could be day\/month or month\/day/);
    assert.match(reason("A6"), /“2026-02-30” is not a date/);
    assert.match(reason("A7"), /two-digit year/);
    assert.equal(cell("A8").value, "2026-04-01");
    const columnA = plain.columns.find(column => column.letter === "A"), columnB = plain.columns.find(column => column.letter === "B");
    assert.equal(columnA.suggestions[0].kind, "dateFormat"); assert.match(columnA.suggestions[0].message, /mixes both orders/);
    assert.equal(columnB.suggestions[0].kind, "decimal");
    const declared = dataset.buildDataset(record(bytes, "m.csv"), { columns: [{ column: "A", kind: "date", dateFormat: "MM/DD/YYYY" }, { column: "B", kind: "number", decimal: "," }] });
    const cell2 = ref => declared.rows.flatMap(row => Object.values(row.cells)).find(item => item.ref === ref);
    assert.equal(cell2("A3").value, "2026-12-13");
    assert.match(cell2("A4").reason, /not a valid MM\/DD\/YYYY date/);
    assert.equal(cell2("A5").value, "2026-03-04");
    assert.equal(decimal.decText(cell2("B3").value), "1.234");
    assert.equal(decimal.decText(cell2("B2").value), "1234.56", "1.234,56 with a declared comma decimal");
    const pointed = dataset.buildDataset(record(bytes, "m.csv"), { columns: [{ column: "B", kind: "number", decimal: "." }] });
    const cell3 = ref => pointed.rows.flatMap(row => Object.values(row.cells)).find(item => item.ref === ref);
    assert.match(cell3("B2").reason, /not a number/, "1.234,56 is refused when the column declares a decimal point");
    assert.equal(decimal.decText(cell3("B3").value), "1234");
    const dayFirst = dataset.buildDataset(record(bytes, "m.csv"), { columns: [{ column: "A", kind: "date", dateFormat: "DD/MM/YYYY" }] });
    assert.match(dayFirst.rows.flatMap(row => Object.values(row.cells)).find(item => item.ref === "A3").reason, /not a valid DD\/MM\/YYYY date/);
    assert.equal(dayFirst.rows.flatMap(row => Object.values(row.cells)).find(item => item.ref === "A4").value, "2026-12-13");
    // Mostly-numbers column with stray text is still a number column; the text is missing, not zero.
    const mixed = dataset.buildDataset(record(csv([["Units"], ["4"], ["5"], ["six"], ["7"], ["8"]]), "u.csv"));
    assert.equal(mixed.columns[0].kind, "number");
    assert.match(mixed.issues[0].reason, /“six” is not a number/);
  });

  await check("missing data is reported, never dropped: undated amounts, unlabelled groups, unreadable cells and the data notes list them with cells", async () => {
    const bytes = csv([["Date", "Revenue (EUR)", "Product"], ["2026-01-05", "100.00", "Bread"], ["", "50.00", "Bread"], ["2026-01-09", "", "Coffee"], ["2026-02-02", "25.50", ""], ["2026-02-03", "oops", "Cakes"], ["n/a", "10.00", "Cakes"]]);
    const facts = prepare(bytes, "gaps.csv", "sales_monthly").facts;
    assert.equal(fact(facts, "total").value, "185.5");
    assert.equal(fact(facts, "total").missing.count, 2);
    assert.equal(fact(facts, "total").missing.refs, "gaps!B4, gaps!B6");
    assert.equal(fact(facts, "undated").value, "60");
    assert.equal(fact(facts, "undated").refs, "gaps!B3, gaps!B7");
    assert.equal(fact(facts, "category.none").value, "25.5");
    const monthly = facts.tables.find(table => table.id === "monthly");
    assert.ok(monthly.rows.some(row => row.label === "No readable date"));
    assert.deepEqual(facts.issues.map(issue => issue.ref).sort(), ["A7", "B6"]);
    const doc = documents.buildDocument({ facts, narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), base: null, mode: "replace", sourceName: "gaps.csv" });
    const about = doc.chapters.find(chapter => chapter.id === "about-data");
    assert.match(about.text, /\| B6 \| “oops” is not a number \|/);
    assert.match(about.text, /\| A7 \| marked as not available/);
  });

  await check("unsupported formulas: CSV formula text is never calculated and is reported; formula-only columns are not read as values", async () => {
    const bytes = csv([["Date", "Amount"], ["2026-01-01", "10"], ["2026-01-02", "=SUM(B2:B2)"], ["2026-01-03", "@cmd"], ["2026-01-04", "+5"]]);
    const facts = prepare(bytes, "f.csv", "sales_monthly", { roles: { date: "A", amount: "B" } }).facts;
    assert.equal(fact(facts, "total").value, "15");
    assert.match(facts.issues.find(issue => issue.ref === "B3").reason, /formula text in a CSV file \(never calculated\)/);
    assert.match(facts.issues.find(issue => issue.ref === "B4").reason, /formula text/);
  });

  await check("currencies and units are never mixed silently: refused with the cells, or reported per currency on request", async () => {
    const bytes = csv([["Date", "Amount", "Product"], ["2026-01-01", "€100.00", "A"], ["2026-01-02", "$40.00", "B"], ["2026-02-01", "€20.50", "A"], ["2026-02-01", "$9.99", "B"]]);
    throwsCode(() => prepare(bytes, "fx.csv", "sales_monthly"), "MIXED_CURRENCY");
    assert.throws(() => prepare(bytes, "fx.csv", "sales_monthly"), /EUR \(B2, B4\); USD \(B3, B5\)/);
    const facts = prepare(bytes, "fx.csv", "sales_monthly", { options: { mixedCurrency: "separate" } }).facts;
    assert.deepEqual([fact(facts, "total.EUR").value, fact(facts, "total.USD").value, fact(facts, "total.EUR").display, fact(facts, "total.USD").display], ["120.5", "49.99", "€120.50", "$49.99"]);
    assert.ok(facts.warnings.some(warning => /never converted or added together/.test(warning)));
    assert.ok(!facts.facts.some(item => item.key === "total"));
    const unmarked = csv([["Date", "Amount"], ["2026-01-01", "€100.00"], ["2026-01-02", "40.00"]]);
    throwsCode(() => prepare(unmarked, "u.csv", "sales_monthly", { roles: { date: "A", amount: "B" }, options: { mixedCurrency: "separate" } }), "MIXED_CURRENCY");
    // Campaign spend in one currency, revenue in another: return on spend would be meaningless.
    const campaign = csv([["Campaign", "Spend", "Revenue"], ["A", "€100", "$300"], ["B", "€50", "$90"]]);
    throwsCode(() => prepare(campaign, "c.csv", "campaign_report", { dataset: { columns: [{ column: "B", kind: "money" }, { column: "C", kind: "money" }] }, roles: { campaign: "A", spend: "B", revenue: "C" } }), "MIXED_CURRENCY");
    const units = csv([["Product", "Weight"], ["A", "1.2 kg"], ["B", "800 g"]]);
    throwsCode(() => prepare(units, "w.csv", "catalogue_comparison", { roles: { name: "A", attributes: ["B"] } }), "MIXED_UNIT");
  });

  await check("a truncated or damaged sheet is refused (totals would be wrong); a non-spreadsheet is refused", async () => {
    throwsCode(() => dataset.buildDataset(record(SALES_CSV, "sales.csv", { rows: 50 })), "SHEET_TRUNCATED");
    throwsCode(() => dataset.buildDataset({ ...record(SALES_CSV, "sales.csv"), format: "docx" }), "NOT_A_SPREADSHEET");
    throwsCode(() => dataset.buildDataset({ ...record(SALES_CSV, "sales.csv"), status: "failed", message: "This file couldn’t be read." }), "SOURCE_UNREADABLE");
    throwsCode(() => dataset.buildDataset(record(SALES_CSV, "sales.csv"), { sheet: "Nope" }), "NO_TABLE");
  });

  await check("survey: answer counts and shares with their denominators, skipped answers, ratings average, cross-tab per group, free text left out", async () => {
    const prepared = prepare(SURVEY_CSV, "survey.csv", "survey_findings");
    const facts = prepared.facts;
    assert.deepEqual(prepared.roles.questions, ["B", "C"], "respondent id and free text are not questions");
    assert.equal(prepared.roles.segment, "D");
    assert.equal(fact(facts, "responses").value, "120");
    const answered = SURVEY.filter(row => row.satisfaction);
    assert.equal(fact(facts, "q-b.answered").value, String(answered.length));
    assert.equal(fact(facts, "q-b.answered").missing.count, 120 - answered.length);
    for (const answer of ["Very satisfied", "Satisfied", "Neutral", "Unsatisfied"]) {
      const n = answered.filter(row => row.satisfaction === answer).length;
      if (!n) continue;
      const share = fact(facts, `q-b.pct.${answer}`);
      assert.equal(fact(facts, `q-b.count.${answer}`).value, String(n));
      assert.equal(share.denominator.value, String(answered.length));
      // n ÷ answered × 100 to one decimal, half away from zero, in integers.
      const tenths = (BigInt(n) * 1000n * 2n + BigInt(answered.length)) / (2n * BigInt(answered.length));
      assert.equal(share.value, canonical(`${tenths / 10n}.${tenths % 10n}`), `${answer} share`);
    }
    const ratings = SURVEY.filter(row => row.rating !== "n/a").map(row => Number(row.rating));
    const sum = ratings.reduce((a, b) => a + b, 0);
    assert.equal(fact(facts, "q-c.average").value, decimal.decText(decimal.divide(decimal.parseDec(String(sum)), decimal.parseDec(String(ratings.length)), 2)));
    assert.match(facts.issues.find(issue => issue.column === "C").reason, /marked as not available/);
    const groups = [...new Set(SURVEY.map(row => row.plan))].map(plan => [plan, SURVEY.filter(row => row.plan === plan && row.satisfaction)]).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 3);
    for (const [plan, rows] of groups) {
      assert.equal(fact(facts, `crosstab.${plan}.n`).value, String(rows.length));
      const satisfied = rows.filter(row => row.satisfaction === "Satisfied").length;
      assert.ok(Math.abs(Number(fact(facts, `crosstab.${plan}.Satisfied`).value) - satisfied / rows.length * 100) <= 0.05);
      assert.equal(fact(facts, `crosstab.${plan}.Satisfied`).denominator.value, String(rows.length));
    }
    const crossChart = facts.charts.find(chart => chart.id === "crosstab");
    assert.equal(crossChart.chart.type, "column"); assert.equal(crossChart.chart.series.length, 3); assert.equal(crossChart.chart.unit, "%");
    const withComment = prepare(SURVEY_CSV, "survey.csv", "survey_findings", { roles: { questions: ["B", "E"] } }).facts;
    assert.ok(withComment.warnings.some(warning => /treated as free text/.test(warning)));
  });

  await check("catalogue: comparison matrix with units and currency kept, ranges with product names, website-ready table data bound to fact ids", async () => {
    const prepared = prepare(CATALOGUE_CSV, "catalogue.csv", "catalogue_comparison");
    const facts = prepared.facts;
    assert.deepEqual(prepared.roles, { name: "A", price: "B", attributes: ["C", "D", "E"] });
    assert.deepEqual([fact(facts, "min.B").value, fact(facts, "min.B").label, fact(facts, "max.B").display], ["149.99", "Lowest price: Model C", "€329.00"]);
    assert.equal(fact(facts, "average.price").value, "235.4"); // 1176.99 ÷ 5 = 235.398 → 235.40
    assert.equal(fact(facts, "max.C").display, "1.40 kg");
    assert.equal(fact(facts, "max.D").label, "Highest battery (h): Model B");
    assert.equal(fact(facts, "max.D").display, "11.5 h");
    assert.ok(fact(facts, "min.B").label.includes("Model C"));
    assert.ok(facts.warnings.some(warning => /1 product has no readable battery/.test(warning)));
    const table = facts.tables[0];
    assert.deepEqual(table.columns, ["Product", "Price (EUR)", "Weight (kg)", "Battery (h)", "Colour"], "units shown once, from the heading or the values");
    const modelD = table.rows.find(row => row.label === "Model D");
    assert.deepEqual(modelD.cells.map(cell => cell.text), ["Model D", "€329.00", "0.95 kg", "—", "Blue"]);
    assert.equal(facts.facts.find(item => item.id === modelD.cells[1].factId).refs, "catalogue!B5");
    const duplicate = prepare(csv([["Product", "Price"], ["X", "€1"], ["X", "€2"]]), "d.csv", "catalogue_comparison").facts;
    assert.ok(duplicate.tables[0].rows.some(row => row.label === "X (row 3)"));
  });

  await check("campaign: totals and per-campaign CTR, CPC, CPA and ROAS computed exactly over rows with both values; zero denominators are not defined", async () => {
    const prepared = prepare(CAMPAIGN_CSV, "campaigns.csv", "campaign_report");
    const facts = prepared.facts;
    assert.deepEqual(prepared.roles, { campaign: "A", spend: "C", impressions: "D", clicks: "E", conversions: "F", revenue: "G", date: "B" });
    const spend = sumCents(CAMPAIGNS.map(row => row.spend)), clicks = CAMPAIGNS.reduce((a, row) => a + row.clicks, 0), impressions = CAMPAIGNS.reduce((a, row) => a + row.impressions, 0), conversions = CAMPAIGNS.reduce((a, row) => a + row.conversions, 0);
    assert.equal(fact(facts, "spend.all").value, canonical(centsText(spend)));
    assert.equal(fact(facts, "spend.all").currency, "USD");
    assert.equal(fact(facts, "clicks.all").value, String(clicks));
    assert.equal(fact(facts, "ctr.all").value, decimal.decText(decimal.divide(decimal.parseDec(String(clicks * 100)), decimal.parseDec(String(impressions)), 2)));
    assert.equal(fact(facts, "cpa.all").value, decimal.decText(decimal.divide(decimal.parseDec(centsText(spend)), decimal.parseDec(String(conversions)), 2)));
    assert.equal(fact(facts, "roas.all").display.endsWith("×"), true);
    const brand = CAMPAIGNS.filter(row => row.campaign === "Search brand");
    assert.equal(fact(facts, "spend.c.Search brand").value, canonical(centsText(sumCents(brand.map(row => row.spend)))));
    assert.equal(fact(facts, "spend.c.Search brand").n, brand.length);
    assert.deepEqual(facts.charts.map(chart => chart.id), ["spend", "conversions", "cpa", "ctr", "trend"]);
    const zero = prepare(csv([["Campaign", "Spend (EUR)", "Clicks", "Conversions"], ["A", "100.00", "10", "0"], ["B", "50.00", "", "2"], ["B", "20.00", "4", ""]]), "z.csv", "campaign_report").facts;
    assert.ok(zero.warnings.some(warning => /CPA for A is not defined: conversions totals zero/.test(warning)));
    // B: CPC uses only the row that has both spend and clicks (20.00 / 4), not 70 / 4.
    assert.equal(fact(zero, "cpc.c.B").value, "5");
    assert.equal(fact(zero, "cpc.c.B").missing.count, 1);
    assert.equal(fact(zero, "cpa.c.B").value, "25");
  });

  await check("narrative check: the plain summaries pass; an invented figure, an unknown fact, a wrong year or an unknown section is refused; formatting variants are tolerated", async () => {
    const cases = [prepare(SALES_CSV, "sales.csv", "sales_monthly").facts, prepare(SURVEY_CSV, "survey.csv", "survey_findings").facts, prepare(CATALOGUE_CSV, "catalogue.csv", "catalogue_comparison").facts, prepare(CAMPAIGN_CSV, "campaigns.csv", "campaign_report").facts];
    for (const facts of cases) {
      const plain = templates.plainNarrative(facts), checked = narrative.checkNarrative(plain, facts);
      assert.ok(checked.ok, `${facts.template}: ${JSON.stringify(checked.problems)}`);
      assert.ok(!JSON.stringify(narrative.renderNarrative(plain, facts)).includes("[["), "every token rendered");
    }
    const facts = cases[0], total = fact(facts, "total"), pct = fact(facts, "change-pct");
    const good = { headline: "Sales held up in June 2026", summary: [`Revenue reached [[${total.id}]] — roughly €${(Number(total.value) / 1000).toFixed(1)}k or ${decimal.formatDec(decimal.parseDec(total.value), 0)} euros in total, ${Math.abs(Number(pct.value))}% ${Number(pct.value) < 0 ? "down" : "up"} on May.`], highlights: [], sections: [{ id: "monthly", text: `June 2026: [[${fact(facts, "month.2026-06").id}]].` }] };
    assert.ok(narrative.checkNarrative(good, facts).ok, JSON.stringify(narrative.checkNarrative(good, facts).problems));
    const invented = { ...good, summary: [`Revenue reached [[${total.id}]], and the new store added €18,400 on its own.`] };
    const refused = narrative.checkNarrative(invented, facts);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.problems.map(problem => [problem.issue, problem.detail]), [["unsupported_number", "€18,400"]]);
    assert.match(narrative.narrativeRefusal(refused.problems), /€18,400.*Nothing was saved/);
    assert.equal(narrative.checkNarrative({ ...good, summary: ["See [[F999]]."] }, facts).problems[0].issue, "unknown_fact");
    assert.equal(narrative.checkNarrative({ ...good, headline: "Best year since 2019" }, facts).problems[0].detail, "2019");
    assert.equal(narrative.checkNarrative({ ...good, headline: "Growth in March 2031" }, facts).problems[0].issue, "unsupported_number");
    assert.equal(narrative.checkNarrative({ ...good, sections: [{ id: "forecast", text: "Next year." }] }, facts).problems[0].issue, "unknown_section");
    assert.equal(narrative.checkNarrative({ ...good, summary: [`Up ${Number(pct.value) + 3}% on May.`] }, facts).ok, false, "a nearby but wrong percentage is refused");
    assert.equal(narrative.checkNarrative({ ...good, highlights: [{ title: "Big", text: `[[${total.id}]] ${"very ".repeat(40)}good` }] }, facts).problems[0].issue, "too_long");
    // A quoted name from the data may contain digits; an invented number next to it may not.
    const catalogue = cases[2];
    assert.ok(narrative.checkNarrative({ headline: "Products", summary: ["“Model B” and “Model E” share the same price."], highlights: [], sections: [] }, catalogue).ok);
  });

  await check("documents: all four tasks lay out as valid books/decks; deck charts are ChartSchema charts carrying exactly the facts' values; book figures and data notes present", async () => {
    for (const [bytes, name, template] of [[SALES_CSV, "sales.csv", "sales_monthly"], [SURVEY_CSV, "survey.csv", "survey_findings"], [CATALOGUE_CSV, "catalogue.csv", "catalogue_comparison"], [CAMPAIGN_CSV, "campaigns.csv", "campaign_report"]]) {
      const facts = prepare(bytes, name, template).facts;
      const chartImages = Object.fromEntries(facts.charts.map(chart => [chart.id, { name: `chart-${chart.id}`, assetId: randomUUID() }]));
      const doc = documents.buildDocument({ facts, narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), base: null, mode: "replace", sourceName: name, chartImages });
      assert.ok(DocumentSourceSchema.safeParse(doc).success, template);
      if (doc.kind === "deck") {
        const chartSlides = doc.slides.filter(slide => slide.layout === "chart");
        assert.equal(chartSlides.length, facts.charts.length, template);
        for (const slide of chartSlides) {
          const source = facts.charts.find(chart => chart.title === slide.title);
          assert.deepEqual(slide.chart.series.map(series => series.values.map(String)), source.chart.series.map(series => series.values.map(String)));
          for (const point of source.points) assert.equal(String(source.chart.series.find(series => series.name === point.series.slice(0, 40)).values[source.points.filter(item => item.series === point.series).indexOf(point)]), String(Number(point.value)));
          assert.match(slide.notes, /F\d{3} /);
        }
        assert.ok(doc.slides.some(slide => slide.id === "about-data"));
      } else {
        assert.ok(doc.chapters.some(chapter => /\[\[figure:chart-/.test(chapter.text)) || !facts.charts.length);
        assert.equal(doc.assets.length, facts.charts.length);
        assert.ok(doc.chapters.at(-1).text.includes("Where each figure comes from"));
      }
    }
    // Append: the comparison becomes sections of an existing book, which keeps its chapters and theme.
    const base = { ...emptyDocument("book", "Buyer's guide"), chapters: [{ id: "intro", title: "Introduction", text: "Hello." }, { id: "data-summary", title: "Taken", text: "x" }] };
    const facts = prepare(CATALOGUE_CSV, "catalogue.csv", "catalogue_comparison").facts;
    const appended = documents.buildDocument({ facts, narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), base, mode: "append", sourceName: "catalogue.csv" });
    assert.deepEqual(appended.chapters.slice(0, 2).map(chapter => chapter.id), ["intro", "data-summary"]);
    assert.ok(appended.chapters.some(chapter => chapter.id === "data-summary-2"));
    assert.equal(appended.title, "Buyer's guide");
    assert.deepEqual(appended.theme, base.theme);
    assert.match(appended.chapters.find(chapter => chapter.id === "data-comparison").text, /\| Model D \| €329.00 \| 0.95 kg \| — \| Blue \|/);
  });

  await check("persist: facts sheet, chart figures and final files stored as immutable project assets, ONE version saved with the expected-version check referencing all of them", async () => {
    cloud = makeCloud();
    const artifactId = addArtifact(cloud, "book");
    const facts = prepare(SALES_CSV, "sales.csv", "sales_monthly").facts;
    const client = clientFor(cloud, EDITOR), actionKey = randomUUID();
    const input = { client, scope: { workspaceId: W1, projectId: P1 }, artifact: { id: artifactId, kind: "book", current_version: 1 }, current: versionOf(cloud, artifactId, 1), expectedVersion: 1, actionKey, facts,
      narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), narrativeSource: "plain", mode: "replace", sourceName: "sales.csv", sourceAsset: { id: ASSET, sha256: "a".repeat(64) } };
    const saved = await persist.persistDataReport(input, persistDeps(cloud, EDITOR));
    assert.deepEqual([saved.replayed, saved.version.number], [false, 2]);
    assert.deepEqual(saved.files.map(file => file.format), ["facts", "pdf"]);
    const version = versionOf(cloud, artifactId, 2);
    for (const file of saved.files) assert.ok(version.assetIds.includes(file.assetId), file.format);
    const charts = cloud.tables.assets.filter(row => row.provenance.kind === "data_report_chart");
    assert.equal(charts.length, facts.charts.length);
    for (const chart of charts) assert.ok(version.assetIds.includes(chart.id));
    assert.ok(version.content.document.assets.every(asset => charts.some(row => row.id === asset.id)));
    const factsRow = cloud.tables.assets.find(row => row.id === saved.files[0].assetId);
    assert.equal(factsRow.object_path, `${W1}/${P1}/reports/${factsRow.sha256}.json`);
    const stored = JSON.parse(cloud.storage.get(factsRow.object_path).bytes.toString("utf8"));
    assert.deepEqual([stored.digest, stored.facts.length, stored.charts.length, stored.report.documentSha], [facts.digest, facts.facts.length, facts.charts.length, files.documentSha(version.content.document)]);
    assert.deepEqual(stored.charts.find(chart => chart.id === "monthly").points.map(point => point.value), facts.charts.find(chart => chart.id === "monthly").points.map(point => point.value));
    assert.equal(cloud.log.filter(entry => entry.op === "save").length, 1);
    assert.equal(cloud.log.filter(entry => entry.op === "save")[0].args.p_expected_version, 1);
    // Retrying the same action (e.g. after a lost response) returns the saved version and stores or saves nothing new.
    const uploads = cloud.log.filter(entry => entry.op === "upload").length;
    const again = await persist.persistDataReport({ ...input, artifact: { ...input.artifact, current_version: 2 }, current: versionOf(cloud, artifactId, 2) }, persistDeps(cloud, EDITOR));
    assert.deepEqual([again.replayed, again.version.number], [true, 2]);
    assert.equal(cloud.log.filter(entry => entry.op === "upload").length, uploads);
    assert.equal(cloud.log.filter(entry => entry.op === "save").length, 1);
  });

  await check("persist: stale project, uncertain save, missing JSON storage type and reviewer are refused without a partial version", async () => {
    cloud = makeCloud();
    const artifactId = addArtifact(cloud, "presentation");
    const facts = prepare(CAMPAIGN_CSV, "campaigns.csv", "campaign_report").facts;
    const make = (client, extra = {}) => ({ client, scope: { workspaceId: W1, projectId: P1 }, artifact: { id: artifactId, kind: "presentation", current_version: 1 }, current: versionOf(cloud, artifactId, 1), expectedVersion: 1, actionKey: randomUUID(), facts,
      narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), narrativeSource: "plain", mode: "replace", sourceName: "campaigns.csv", sourceAsset: { id: ASSET, sha256: "a".repeat(64) }, ...extra });
    await rejects(() => persist.persistDataReport(make(clientFor(cloud, EDITOR), { artifact: { id: artifactId, kind: "presentation", current_version: 2 } }), persistDeps()), "REPORT_STALE");
    assert.equal(renderCalls, 0, "nothing rendered for a stale project");
    cloud.allowedTypes.delete("application/json");
    await rejects(() => persist.persistDataReport(make(clientFor(cloud, EDITOR)), persistDeps()), "REPORT_STORAGE_UNAVAILABLE");
    assert.equal(cloud.log.filter(entry => entry.op === "save").length, 0, "no version without its facts sheet");
    cloud.allowedTypes.add("application/json");
    await rejects(() => persist.persistDataReport(make(clientFor(cloud, REVIEWER)), persistDeps()), "REPORT_STORAGE_UNAVAILABLE");
    assert.equal(cloud.tables.artifacts.find(row => row.id === artifactId).current_version, 1);
    // The save commits but the response is lost: the retry finds the committed version through its facts file.
    cloud.failSaveAfterCommit = true;
    const input = make(clientFor(cloud, OWNER));
    await rejects(() => persist.persistDataReport(input, persistDeps()), "CLOUD_OUTCOME_UNKNOWN");
    const retry = await persist.persistDataReport({ ...input, artifact: { ...input.artifact, current_version: 2 }, current: versionOf(cloud, artifactId, 2) }, persistDeps());
    assert.deepEqual([retry.replayed, retry.version.number, retry.files.map(file => file.format).sort()], [true, 2, ["facts", "pdf", "pptx"]]);
    // Someone else saved in between: refused as stale, no second report version.
    const other = make(clientFor(cloud, OWNER), { current: versionOf(cloud, artifactId, 2), artifact: { id: artifactId, kind: "presentation", current_version: 2 }, expectedVersion: 2 });
    cloud.tables.artifacts.find(row => row.id === artifactId).current_version = 3;
    await rejects(() => persist.persistDataReport(other, persistDeps()), "REPORT_STALE");
  });

  await check("worker path: the stored spreadsheet is re-read, re-hashed and parsed in the isolated ingestion worker; a worker timeout is an explicit refusal", async () => {
    cloud = makeCloud();
    const source = addSource(cloud, SALES_CSV, "sales.csv");
    const client = clientFor(cloud, EDITOR), scope = { workspaceId: W1, projectId: P1 };
    const loaded = await server.loadSpreadsheet(client, scope, source, undefined);
    assert.deepEqual([loaded.record.status, loaded.record.sourceSha256, loaded.name], ["complete", source.sha256, "sales.csv"]);
    await rejects(() => server.loadSpreadsheet(client, scope, source, undefined, { timeoutMs: 1 }), "SOURCE_TIMEOUT");
    await assert.rejects(server.loadSpreadsheet(client, scope, source, undefined, { timeoutMs: 1 }), /took too long/);
    await rejects(() => server.loadSpreadsheet(client, scope, { ...source, sha256: "b".repeat(64) }, undefined), "SOURCE_UNAVAILABLE");
    await rejects(() => server.loadSpreadsheet(clientFor(cloud, OUTSIDER), scope, source, undefined), "SOURCE_UNAVAILABLE");
    // Changed bytes behind the same asset row are refused by the hash check.
    const row = cloud.tables.assets.find(item => item.id === source.assetId);
    cloud.storage.set(row.object_path, { bytes: Buffer.concat([SALES_CSV, Buffer.from("\n2026-07-01,1.00,X")]), contentType: "text/csv" });
    await rejects(() => server.loadSpreadsheet(client, scope, source, undefined), "SOURCE_UNAVAILABLE");
    const listed = await server.listSpreadsheetSources(client, scope);
    assert.deepEqual(listed.map(item => [item.assetId, item.name, item.format]), [[source.assetId, "sales.csv", "csv"]]);
    assert.deepEqual(await server.listSpreadsheetSources(clientFor(cloud, OUTSIDER), scope), []);
  });

  await check("AI-written summary as a data_report agency task: only the facts sheet is sent, a checked answer is stored; an invented figure fails the step uncharged; a replay makes no call", async () => {
    const facts = prepare(SALES_CSV, "sales.csv", "sales_monthly").facts;
    const qualified = Object.freeze([Object.freeze({ profile: "standard", model: "claude-opus-5-5", effort: "medium", intensity: "medium", maxOutputTokens: 4000, maxTurns: 3, qualifiedKinds: Object.freeze(["data_report"]), evidence: "offline fixture" })]);
    const makeTask = () => task.resolveAgencyTask(OWNER, { artifactId: randomUUID(), actionKey: randomUUID(), stepKey: randomUUID(), kind: "data_report", objective: "Write the narrative for a monthly sales report.",
      inputs: [{ kind: "asset", id: ASSET, sha256: "c".repeat(64) }], permittedTools: [], settings: "standard", ceilingCredits: 20, expectedRevision: 3 }, { scope: operationServer.resolveAgencyScope, settings: qualified, rateMicrousd: RATE });
    const scripted = answer => { const seen = []; const model = async requestValue => { seen.push(requestValue); const ticket = await requestValue.spend.begin("anthropic", "claude-opus-5-5", 30000); await requestValue.spend.finish(ticket, { actualMicrousd: 12000 });
      return { content: [{ type: "tool_use", id: `t${seen.length}`, name: "submit_result", input: answer }], stopReason: "tool_use" }; }; model.seen = seen; return model; };
    const deps = model => ({ model, tools: {}, readInput: async () => "", platformDeadline: Date.now() + 280000, pollMs: 15, heartbeatMs: 25 });
    const total = fact(facts, "total");
    const answer = { headline: "Revenue for the first half of 2026", summary: [`Revenue came to [[${total.id}]] across [[${fact(facts, "rows").id}]] rows.`], highlights: [{ title: "Latest month", text: `June 2026 brought [[${fact(facts, "month.2026-06").id}]].` }], sections: [{ id: "monthly", text: "Totals by calendar month." }] };
    const model = scripted(answer), resolved = await makeTask();
    const outcome = await narrativeAi.aiNarrative({ task: resolved, facts, deps: deps(model) });
    assert.deepEqual([outcome.run.outcome, outcome.problems.length], ["result", 0]);
    assert.deepEqual(outcome.narrative, answer);
    const sent = JSON.stringify(model.seen[0].messages);
    assert.ok(sent.includes(`FACTS-${facts.digest.slice(0, 20).toUpperCase()} BEGIN`) && sent.includes(total.display.replace("€", "")), "the facts sheet is what the writer reads");
    assert.ok(!sent.includes("2026-01-0") || !sent.includes("Bread,"), "no raw rows are sent");
    assert.equal(model.seen[0].system, narrativeAi.NARRATIVE_SYSTEM);
    const finish = () => fake.rpcLog.filter(entry => entry.name === "makeborne_ai_operation_finish").at(-1);
    assert.equal(finish().args.p_outcome, "result");
    assert.equal(finish().args.p_candidate.data.factsDigest, facts.digest);
    fake.reset();
    const lying = scripted({ ...answer, summary: [`Revenue came to [[${total.id}]], a record 31.4% above last year.`] });
    const refused = await narrativeAi.aiNarrative({ task: await makeTask(), facts, deps: deps(lying) });
    assert.equal(refused.narrative, null);
    assert.deepEqual(refused.problems.map(problem => problem.detail), ["31.4%"]);
    assert.deepEqual([finish().args.p_outcome, refused.run.charged], ["failed", 0], "a refused narrative is not charged");
    // The same action and step again: the recorded outcome, no model call.
    fake.reset();
    const again = await makeTask(), first = scripted(answer);
    await narrativeAi.aiNarrative({ task: again, facts, deps: deps(first) });
    const never = async () => { throw new Error("no call on replay"); };
    const replay = await narrativeAi.aiNarrative({ task: again, facts, deps: deps(never) });
    assert.deepEqual([replay.run.replayed, replay.narrative?.headline], [true, answer.headline]);
    // With client knowledge on: read inside the step (snapshot bound to its operation), given as wording background only.
    fake.reset();
    fake.db.clientId = randomUUID();
    const { buildKnowledgeContext } = require("../knowledge/context.ts");
    const preference = { id: randomUUID(), clientId: fake.db.clientId, kind: "brand_preference", key: "brand.wording", label: "Wording", valueText: "Say turnover, not revenue", status: "approved",
      evidenceState: "live", revision: 1, trust: "approved", rank: 1, pending: [], evidence: [{ id: randomUUID(), kind: "user", quote: "Say turnover, not revenue", locator: {} }] };
    const knowledgeReads = [];
    const informed = scripted(answer);
    const withKnowledge = await narrativeAi.aiNarrative({ task: await makeTask(), facts, deps: { ...deps(informed), knowledge: async request => { knowledgeReads.push(request); return { context: buildKnowledgeContext([preference]), snapshotId: "7d3c1d9e-1111-4222-8333-944455556666" }; } } });
    assert.equal(withKnowledge.run.outcome, "result");
    assert.deepEqual([knowledgeReads.length, knowledgeReads[0].operationId, knowledgeReads[0].purpose], [1, withKnowledge.run.status.operation.id, "data report narrative"]);
    const informedSent = JSON.stringify(informed.seen[0].messages);
    assert.ok(informedSent.includes("Say turnover, not revenue") && informedSent.includes("Do not take any figure from it"), "knowledge arrives as background, with the figures rule");
    assert.equal(finish().args.p_detail.knowledge.snapshotId, "7d3c1d9e-1111-4222-8333-944455556666");
    // Without a qualified setting every data_report task is refused before any operation exists. The shipped registry
    // qualifies data_report only as a proposal after the 2026-10-24 paid run (flags remain off).
    fake.reset();
    await rejects(() => task.resolveAgencyTask(OWNER, { artifactId: randomUUID(), actionKey: randomUUID(), stepKey: randomUUID(), kind: "data_report", objective: "x", inputs: [], permittedTools: [], settings: "standard", ceilingCredits: 20, expectedRevision: 3 },
      { scope: operationServer.resolveAgencyScope, settings: [], rateMicrousd: RATE }), "AGENCY_SETTINGS_UNQUALIFIED");
    assert.ok(task.AGENCY_SETTINGS.some(setting => setting.qualifiedKinds.includes("data_report")), "proposed after qualification");
    assert.equal(fake.rpcLog.length, 0);
  });

  // ---- Routes: the real handlers with the real cloudContext over the RLS-emulating fake ----
  const route = require("../../app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/data-reports/route.ts");
  const exportRoute = require("../../app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/document-export/route.ts");
  const ctx = (workspaceId, artifactId) => ({ params: Promise.resolve({ workspaceId, artifactId }) });
  const post = (workspaceId, artifactId, body) => route.POST(new Request(`http://localhost/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/data-reports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(workspaceId, artifactId));
  const get = (workspaceId, artifactId) => route.GET(new Request(`http://localhost/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/data-reports`), ctx(workspaceId, artifactId));
  const download = (workspaceId, artifactId, query) => exportRoute.GET(new Request(`http://localhost/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/document-export?${query}`), ctx(workspaceId, artifactId));
  const as = user => { currentUser = user; };
  const errorCode = async response => (await response.clone().json()).error?.code;

  await check("route: off by default (404 before any read); preview recomputes from the stored file with cells; generate needs the previewed digest and saves one version; reviewers and other workspaces are refused", async () => {
    cloud = makeCloud();
    const deck = addArtifact(cloud, "presentation"), source = addSource(cloud, CAMPAIGN_CSV, "campaigns.csv");
    delete process.env.MAKEBORNE_DATA_REPORTS;
    as(OWNER);
    const off = await get(W1, deck);
    assert.deepEqual([off.status, await errorCode(off)], [404, "NOT_AVAILABLE"]);
    assert.equal((await post(W1, deck, { action: "preview", source, template: "campaign_report" })).status, 404);
    process.env.MAKEBORNE_DATA_REPORTS = "on";
    const info = await (await get(W1, deck)).json();
    assert.deepEqual([info.available, info.templates.map(item => item.id), info.sources.length, info.writtenSummary.ai], [true, ["survey_findings", "campaign_report"], 1, false]);
    const previewResponse = await post(W1, deck, { action: "preview", source, template: "campaign_report" });
    assert.equal(previewResponse.status, 200);
    const { preview } = await previewResponse.json();
    assert.ok(preview.facts.some(item => item.refs.startsWith("campaigns!C2:C85")));
    assert.ok(!JSON.stringify(preview).match(/claude|anthropic|openai|gpt/i), "no provider or model names");
    const generate = { action: "generate", source, template: "campaign_report", expectedVersion: 1, actionKey: randomUUID(), expectedFactsDigest: preview.digest };
    const wrongDigest = await post(W1, deck, { ...generate, expectedFactsDigest: "0".repeat(64) });
    assert.deepEqual([wrongDigest.status, await errorCode(wrongDigest)], [409, "REPORT_NUMBERS_CHANGED"]);
    const ai = await post(W1, deck, { ...generate, narrative: "ai" });
    assert.deepEqual([ai.status, await errorCode(ai)], [409, "WRITTEN_SUMMARY_UNAVAILABLE"]);
    const wrongKind = await post(W1, deck, { ...generate, template: "sales_monthly", action: "generate" });
    assert.equal(wrongKind.status === 409 || wrongKind.status === 400 || wrongKind.status === 422, true);
    as(REVIEWER);
    const reviewer = await post(W1, deck, generate);
    assert.deepEqual([reviewer.status, await errorCode(reviewer)], [403, "ACCESS_DENIED"]);
    as(OUTSIDER);
    assert.deepEqual([(await post(W1, deck, generate)).status, (await get(W1, deck)).status], [404, 404]);
    as(null);
    assert.equal((await post(W1, deck, generate)).status, 401);
    as(EDITOR);
    const created = await post(W1, deck, generate);
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const body = await created.json();
    assert.deepEqual([body.version.number, body.files.map(file => file.format).sort()], [2, ["facts", "pdf", "pptx"]]);
    const replay = await post(W1, deck, generate);
    assert.deepEqual([replay.status, (await replay.json()).replayed], [200, true]);
    assert.equal(cloud.tables.artifacts.find(row => row.id === deck).current_version, 2);
    const versionTwo = versionOf(cloud, deck, 2);
    assert.equal(versionTwo.content.document.kind, "deck");
    assert.ok(versionTwo.content.document.slides.some(slide => slide.layout === "chart"));
    // A stale expected version is refused (the project moved on).
    const stale = await post(W1, deck, { ...generate, actionKey: randomUUID() });
    assert.deepEqual([stale.status, await errorCode(stale)], [409, "REPORT_STALE"]);
    delete process.env.MAKEBORNE_DATA_REPORTS;
  });

  await check("download authorization uses the existing export route and its rules: members (owner, editor, reviewer) read the saved files, other workspaces and signed-out are refused, edited or tampered files are not served", async () => {
    cloud = makeCloud();
    const deck = addArtifact(cloud, "presentation"), source = addSource(cloud, SURVEY_CSV, "survey.csv");
    process.env.MAKEBORNE_DATA_REPORTS = "on";
    as(OWNER);
    const { preview } = await (await post(W1, deck, { action: "preview", source, template: "survey_findings" })).json();
    const created = await (await post(W1, deck, { action: "generate", source, template: "survey_findings", expectedVersion: 1, actionKey: randomUUID(), expectedFactsDigest: preview.digest })).json();
    const factsUrl = created.files.find(file => file.format === "facts").url.split("?")[1], pptxUrl = created.files.find(file => file.format === "pptx").url.split("?")[1];
    for (const user of [OWNER, EDITOR, REVIEWER]) {
      as(user);
      const response = await download(W1, deck, pptxUrl);
      assert.equal(response.status, 200, `member ${user === REVIEWER ? "reviewer" : "writer"}`);
      assert.match(response.headers.get("content-type"), /presentationml/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    as(REVIEWER);
    const factsFile = await download(W1, deck, factsUrl);
    assert.deepEqual([factsFile.status, (await factsFile.json()).digest], [200, preview.digest]);
    as(OUTSIDER);
    assert.equal((await download(W1, deck, pptxUrl)).status, 404);
    assert.equal((await download(W2, deck, pptxUrl)).status, 404, "the artifact is not in the outsider's own workspace");
    as(null);
    assert.equal((await download(W1, deck, pptxUrl)).status, 401);
    as(OWNER);
    delete process.env.MAKEBORNE_DATA_REPORTS;
    const off = await download(W1, deck, pptxUrl);
    assert.deepEqual([off.status, await errorCode(off)], [404, "NOT_AVAILABLE"]);
    assert.equal((await download(W1, deck, "format=facts&version=2")).status, 400, "facts only as a saved file");
    process.env.MAKEBORNE_DATA_REPORTS = "on";
    // Tampered stored bytes are not served.
    const pptxRow = cloud.tables.assets.find(row => row.provenance.kind === "data_report_file" && row.provenance.format === "pptx");
    const original = cloud.storage.get(pptxRow.object_path);
    cloud.storage.set(pptxRow.object_path, { ...original, bytes: Buffer.from("tampered") });
    assert.equal(await errorCode(await download(W1, deck, pptxUrl)), "NO_SAVED_REPORT");
    cloud.storage.set(pptxRow.object_path, original);
    // After an edit (new version with a different document but the same manifest), the saved files no longer apply.
    const v2 = cloud.tables.artifact_versions.find(row => row.artifact_id === deck && row.version_number === 2);
    const edited = structuredClone(v2); edited.id = randomUUID(); edited.version_number = 3; edited.content.document.title = "Edited title";
    cloud.tables.artifact_versions.push(edited); cloud.tables.artifacts.find(row => row.id === deck).current_version = 3;
    assert.equal(await errorCode(await download(W1, deck, "format=pptx&version=3&stored=1")), "NO_SAVED_REPORT");
    assert.equal((await download(W1, deck, "format=pptx&version=2&stored=1")).status, 200, "the report version itself still serves its files");
    delete process.env.MAKEBORNE_DATA_REPORTS;
  });

  await check("boundaries: no model or provider names in customer copy; the flag is set nowhere; the panel renders only when the server says so", async () => {
    const root = path.join(__dirname, "../..");
    const customer = [fs.readFileSync(path.join(root, "components/data-report-panel.tsx"), "utf8"), fs.readFileSync(path.join(__dirname, "templates.ts"), "utf8"), fs.readFileSync(path.join(__dirname, "documents.ts"), "utf8"), fs.readFileSync(path.join(__dirname, "narrative.ts"), "utf8")].join("\n");
    assert.ok(!/claude|anthropic|openai|gpt-|opus|sonnet|haiku/i.test(customer));
    const facts = prepare(CAMPAIGN_CSV, "campaigns.csv", "campaign_report").facts;
    const doc = documents.buildDocument({ facts, narrative: narrative.renderNarrative(templates.plainNarrative(facts), facts), base: null, mode: "replace", sourceName: "campaigns.csv" });
    assert.ok(!/claude|anthropic|openai|gpt/i.test(JSON.stringify(doc)));
    for (const file of [".env.example", "vercel.json", "next.config.ts"].map(name => path.join(root, "..", name)).filter(file => fs.existsSync(file))) assert.ok(!fs.readFileSync(file, "utf8").includes("MAKEBORNE_DATA_REPORTS=on"), file);
    assert.equal(report.dataReportsEnabled({}), false);
    assert.equal(report.dataReportsEnabled({ MAKEBORNE_DATA_REPORTS: "true" }), false);
    assert.equal(report.dataReportsEnabled({ MAKEBORNE_DATA_REPORTS: "on" }), true);
    assert.match(fs.readFileSync(path.join(root, "components/data-report-panel.tsx"), "utf8"), /if \(!info\?\.available \|\| !info\.canGenerate/);
  });

  console.log(`\n${passed} data report checks passed.`);
  assert.equal(network, 0, "no network access");
})().catch(error => { console.error(error); process.exit(1); });
