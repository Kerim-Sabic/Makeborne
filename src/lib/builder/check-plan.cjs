/* eslint-disable @typescript-eslint/no-require-imports -- Offline Plan mode checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {SitePlanSchema, StoredPlanSchema, parsePlan, estimatePlanCredits, recommendedEffort, planToBrief, PROPOSE_PLAN_INPUT_SCHEMA, PLAN_CEILING_CREDITS, PLAN_MAX_BYTES} = require("./plan.ts");
const {BUILDER_EFFORT} = require("./pricing.ts");
const {EFFORT_LEVELS} = require("../routing/effort.ts");

let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const section = (name) => ({name, purpose: `Why ${name} exists.`, content: `Key content for ${name}.`});
const sample = () => ({
  kind: "new_site", title: "Lumen Atelier", summary: "A quiet, confident studio site that books consultations.",
  goal: "Book a consultation.", audience: "Homeowners planning a renovation.", positioning: "Calm craft over loud trend.",
  pages: [
    {name: "Home", path: "/", purpose: "Win trust fast.", sections: ["Hero", "Approach", "Selected work", "Contact"].map(section)},
    {name: "Studio", path: "/studio", purpose: "Show the people.", sections: ["Story", "Team"].map(section)},
  ],
  design: {
    concept: "Gallery-white rooms with ink-dark type.",
    typography: {display: "Fraunces", body: "Inter", rationale: "Warm serif against a neutral grotesk."},
    palette: [{name: "Paper", hex: "#f6f3ee", role: "background"}, {name: "Ink", hex: "#1C1A17", role: "text"}, {name: "Clay", hex: "#B5643C", role: "accent"}],
    layout: ["Asymmetric editorial split hero", "Full-bleed project strip"],
    imagery: "Natural-light interiors, no people.", signatureInteraction: "Slow image reveal on scroll.",
  },
  changes: [], questions: ["Do you have project photos?"], assumptions: ["Placeholder contact details."],
});

check("a complete plan validates and normalizes hex values", () => {
  const result = parsePlan(sample());
  assert.ok(result.plan, result.error);
  assert.equal(result.plan.design.palette[0].hex, "#F6F3EE");
});
check("defaults fill optional lists", () => {
  const plan = sample(); delete plan.changes; delete plan.questions; delete plan.assumptions;
  const result = SitePlanSchema.parse(plan);
  assert.deepEqual([result.changes, result.questions, result.assumptions], [[], [], []]);
});
check("invalid plans are rejected with a readable path", () => {
  const cases = [
    [p => { p.design.palette[0].hex = "#fff"; }, /hex/],
    [p => { p.design.palette = p.design.palette.slice(0, 2); }, /palette/],
    [p => { p.questions = ["a?", "b?", "c?", "d?"]; }, /questions/],
    [p => { p.pages[1].path = "/"; }, /Duplicate page path/],
    [p => { p.pages[0].path = "about"; }, /route path/],
    [p => { p.kind = "edit"; }, /changes/],
    [p => { p.title = "   "; }, /title/],
    [p => { p.pages[0].sections = []; }, /sections/],
    [p => { p.extra = true; }, /plan|extra|Unrecognized/i],
  ];
  for (const [mutate, pattern] of cases) {
    const plan = sample(); mutate(plan);
    const result = parsePlan(plan);
    assert.ok(result.error, `expected rejection for ${pattern}`);
    assert.match(result.error, pattern);
  }
});
check("oversized plans are rejected before storage", () => {
  const plan = sample();
  plan.pages = Array.from({length: 12}, (_, page) => ({name: `Page ${page}`, path: page ? `/p${page}` : "/", purpose: "x".repeat(400),
    sections: Array.from({length: 14}, (_, index) => ({name: `S${index}`, purpose: "y".repeat(400), content: "z".repeat(800)}))}));
  assert.match(parsePlan(plan).error, /too long/);
  assert.ok(PLAN_MAX_BYTES < 65536, "stored plans must fit the table's 64 KiB check");
});
check("edit plans need concrete changes and list files", () => {
  const plan = {...sample(), kind: "edit", changes: [{change: "Add an FAQ section to Home.", files: ["src/components/Faq.tsx", "src/App.tsx"]}]};
  const result = parsePlan(plan);
  assert.ok(result.plan, result.error);
  assert.match(planToBrief(result.plan), /Changes to make[\s\S]*src\/components\/Faq\.tsx/);
});
check("credit estimates are sane, ordered and within effort ceilings", () => {
  const plan = SitePlanSchema.parse(sample());
  const estimate = estimatePlanCredits(plan);
  let previous = 0;
  for (const level of EFFORT_LEVELS) {
    const {min, max} = estimate[level];
    assert.ok(Number.isInteger(min) && Number.isInteger(max));
    assert.ok(min >= 2 && min <= max, `${level} ${min}-${max}`);
    assert.ok(max <= BUILDER_EFFORT[level].ceilingCredits, `${level} exceeds ceiling`);
    assert.ok(max >= previous, `${level} should not be cheaper than a lower effort`);
    previous = max;
  }
  const edit = SitePlanSchema.parse({...sample(), kind: "edit", changes: [{change: "Tighten hero copy.", files: ["src/App.tsx"]}]});
  assert.ok(estimatePlanCredits(edit).medium.max < estimate.medium.max, "a small edit costs less than a new site");
});
check("recommended effort fits the plan; light only for edits", () => {
  const plan = SitePlanSchema.parse(sample());
  const level = recommendedEffort(plan);
  assert.ok(EFFORT_LEVELS.includes(level) && level !== "light");
  const edit = SitePlanSchema.parse({...sample(), kind: "edit", changes: [{change: "Fix a typo.", files: ["src/App.tsx"]}]});
  assert.equal(recommendedEffort(edit), "light");
});
check("planning is capped below the cheapest build", () => {
  assert.ok(PLAN_CEILING_CREDITS > 0 && PLAN_CEILING_CREDITS <= BUILDER_EFFORT.light.ceilingCredits);
});
check("the approved brief carries every page, section, color and question", () => {
  const plan = SitePlanSchema.parse(sample());
  const brief = planToBrief(plan);
  for (const page of plan.pages) { assert.ok(brief.includes(`${page.name} (${page.path})`)); for (const item of page.sections) assert.ok(brief.includes(item.name)); }
  for (const color of plan.design.palette) assert.ok(brief.includes(color.hex));
  assert.match(brief, /Open questions[\s\S]*project photos/);
  assert.match(brief, /Signature interaction: Slow image reveal/);
});
check("the tool schema matches the zod schema", () => {
  const zodKeys = Object.keys(SitePlanSchema.shape).sort();
  assert.deepEqual(Object.keys(PROPOSE_PLAN_INPUT_SCHEMA.properties).sort(), zodKeys);
  assert.deepEqual([...PROPOSE_PLAN_INPUT_SCHEMA.required].sort(), zodKeys);
  const design = PROPOSE_PLAN_INPUT_SCHEMA.properties.design;
  assert.deepEqual(Object.keys(design.properties).sort(), Object.keys(SitePlanSchema.shape.design.shape).sort());
  const walk = node => { if (node.type === "object") { assert.equal(node.additionalProperties, false); Object.values(node.properties).forEach(walk); } if (node.type === "array") walk(node.items); };
  walk(PROPOSE_PLAN_INPUT_SCHEMA);
});
check("stored plans default to a first draft and reject unknown status", () => {
  const stored = StoredPlanSchema.parse({plan: sample(), basedOnVersion: 3});
  assert.deepEqual([stored.status, stored.revision, stored.charged], ["draft", 1, 0]);
  assert.equal(StoredPlanSchema.safeParse({plan: sample(), basedOnVersion: 3, status: "approved"}).success, false);
});
console.log(`${count} plan checks passed.`);
