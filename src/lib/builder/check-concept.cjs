/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the concept step: rubric choice, distinctness, the source comment, the receipt, and the real builder loop with a scripted provider. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const load = Module._load, script = [];
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.resolve(process.cwd(), "src", name.slice(2)), parent, main);
  // A scripted provider: each call returns the next assistant message.
  if (name === "../ai/anthropic-call") return { ContextMeter: class { afterReply() {} }, builderModels: () => ["claude-opus-5-5"], budgetedStream: async input => {
    const next = script.shift();
    if (!next) throw new Error("script exhausted");
    next.seen = input.params.tools.map(tool => tool.name);
    return { message: { content: next.content, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 } } };
  } };
  if (name === "./images" && /builder[\\/]agent\.ts$/.test(parent?.filename ?? "")) return { imageConfiguration: () => ({ model: null, models: [] }), IMAGE_SIZES: { portrait: "1024x1536" }, openaiImageClient: () => null, storeGeneratedImage: async () => null };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { checkConcept, conceptComment, withConceptComment, conceptSummary, conceptTotal, CONCEPT_TOOL, CONCEPT_COMMENT_MARK } = require("./concept.ts");
const { newRunMeter, meterEvent, runReceipt } = require("./run-receipt.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const concept = (name, headline, device, scores) => ({ name, headline, angle: `An angle for ${name}`, device, archetype: "Poster", ground: "a saturated harbour blue", action: "the booking button sits under the headline", scores });
const tide = concept("Tide table", "Open when the tide is in", "a tide-table strip whose rows are the opening hours", { memorable: 5, specific: 5, action: 4, buildable: 5 });
const docket = concept("Fish docket", "Today's catch, stamped", "a stamped market docket listing the day's fish", { memorable: 4, specific: 4, action: 4, buildable: 4 });
const generic = concept("Calm hero", "Fresh food by the sea", "a full-width photo of plates", { memorable: 2, specific: 2, action: 3, buildable: 5 });

(async () => {
  await check("the rubric decides: the chosen concept must have the highest total, and concepts must differ", () => {
    const ok = checkConcept({ concepts: [tide, docket, generic], chosen: 0, why: "It turns the opening hours into the idea." });
    assert.ok(ok.ok); assert.equal(ok.record.chosen.name, "Tide table"); assert.deepEqual(ok.record.runnersUp.map(item => item.name), ["Fish docket", "Calm hero"]);
    assert.equal(conceptTotal(tide), 19);
    const weaker = checkConcept({ concepts: [tide, docket, generic], chosen: 2, why: "Safe choice." });
    assert.ok(!weaker.ok && /highest rubric total \(19\)/.test(weaker.problem));
    const same = checkConcept({ concepts: [tide, { ...docket, name: "Tide again", device: "a tide-table strip whose rows are the opening hours" }], chosen: 0, why: "x".repeat(10) });
    assert.ok(!same.ok && /same idea reworded/.test(same.problem));
    assert.ok(!checkConcept({ concepts: [tide], chosen: 0, why: "Only one." }).ok, "at least two concepts");
    assert.ok(!checkConcept({ concepts: [tide, docket], chosen: 2, why: "Out of range." }).ok);
    assert.ok(!checkConcept({ concepts: [{ ...tide, scores: { ...tide.scores, memorable: 9 } }, docket], chosen: 0, why: "Bad score." }).ok, "scores are 1-5");
    assert.equal(CONCEPT_TOOL.input_schema.properties.concepts.maxItems, 3);
    assert.doesNotMatch(CONCEPT_TOOL.description, /Ledgerline|Relay|Saltbush|Saffron|Hollis/, "no eval-brief names in the model-facing tool");
  });

  await check("the source comment records the choice and runners-up, is idempotent and cannot break out of the comment", () => {
    const record = checkConcept({ concepts: [tide, { ...docket, headline: "Today's catch */ stamped" }], chosen: 0, why: "Hours become the idea." }).record;
    const comment = conceptComment(record);
    assert.match(comment, /^\/\*\n \* Makeborne concept: Tide table: "Open when the tide is in"; device: a tide-table strip/);
    assert.match(comment, / \* Runner-up: Fish docket: "Today's catch \* \/ stamped"/, "a */ inside the text is neutralised");
    const app = 'export default function App() { return <main />; }\n';
    const once = withConceptComment(app, record), twice = withConceptComment(once, record);
    assert.equal(twice, once, "re-applying replaces, never stacks"); assert.ok(once.endsWith(app));
    assert.equal(once.split(CONCEPT_COMMENT_MARK).length, 2);
  });

  await check("the receipt shows the chosen concept and the runners-up from the stream", () => {
    const meter = newRunMeter(0);
    meterEvent(meter, { type: "concept", chosen: "Tide table", runnersUp: ["Fish docket", "Calm hero", "ignored third"] });
    meterEvent(meter, { type: "done", charged: 12, changed: true, version: 2, finished: true, build: "passed" });
    const receipt = runReceipt(meter, { website: true, unlimited: false, now: 1000 });
    assert.deepEqual(receipt.concept, { chosen: "Tide table", runnersUp: ["Fish docket", "Calm hero"] });
    assert.equal(conceptSummary(receipt.concept), "Tide table (runners-up: Fish docket, Calm hero)");
    const client = fs.readFileSync(path.join(__dirname, "..", "..", "components", "live-builder.tsx"), "utf8");
    assert.match(client, /<dt>Concept<\/dt>/);
  });

  const { runBuilder } = require("./agent.ts"), { ProjectFiles } = require("./files.ts");
  const run = async (extra = {}) => {
    const files = new ProjectFiles(), events = [];
    const deadline = Date.now() + 280_000;
    const spend = { allowanceMicrousd: 1_500_000, remainingMicrousd: 1_500_000, providerMicrousd: 0, uncertainMicrousd: 0, stopped: null, deadline, customerCredits: () => 0, timeLeftMs: () => 200_000 };
    const result = await runBuilder({ client: {}, scope: { workspaceId: "w", projectId: "p" }, files, effort: "medium", spend, request: "Website for a harbour café", context: "Fixture",
      attachments: [], emit: event => events.push(event), signal: new AbortController().signal, deadline, anthropic: {}, compile: async () => ({ status: "passed" }), stepGuardMs: 0, ...extra });
    return { files, events, result };
  };
  const write = (id, filePath, content) => ({ type: "tool_use", id, name: "write_file", input: { path: filePath, content } });
  const site = id => [
    write(`${id}a`, "index.html", '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Café</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'),
    write(`${id}b`, "src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n'),
    write(`${id}c`, "src/App.tsx", 'export default function App() { return <main><h1>Open when the tide is in</h1></main>; }\n'),
  ];
  const finish = id => ({ type: "tool_use", id, name: "finish", input: { summary: "Built the café site.", title: "Harbour Café" } });

  await check("builder loop: a first build offers the tool, records the concept, builds it and writes the comment into App.tsx", async () => {
    script.length = 0;
    script.push({ content: [{ type: "tool_use", id: "c1", name: "concept", input: { concepts: [tide, docket, generic], chosen: 0, why: "The hours become the idea." } }, ...site("s")] }, { content: [finish("f1")] });
    const { files, events, result } = await run({ concept: true });
    assert.ok(result.finished); assert.equal(result.concept.chosen.name, "Tide table");
    assert.deepEqual(events.find(event => event.type === "concept"), { type: "concept", chosen: "Tide table", runnersUp: ["Fish docket", "Calm hero"], why: "The hours become the idea." });
    assert.match(files.files.get("src/App.tsx"), /^\/\*\n \* Makeborne concept: Tide table/);
  });

  await check("builder loop: finishing a first build without concepts is blocked once, then accepted; edits never get the tool", async () => {
    script.length = 0;
    script.push({ content: site("t") }, { content: [finish("f2")] }, { content: [finish("f3")] });
    const { result } = await run({ concept: true });
    assert.ok(result.finished, "a repeat finish is accepted (never strands the work)"); assert.equal(result.concept, null);
    assert.equal(script.length, 0, "exactly one extra finish was needed");
    script.length = 0;
    const edit = { content: [...site("u"), finish("f4")] };
    script.push(edit);
    await run({ concept: false });
    assert.ok(!edit.seen.includes("concept"), "the concept tool is offered only on a first build");
  });

  await check("builder loop: a contrast finding blocks one finish with its instruction; the next finish is accepted", async () => {
    script.length = 0;
    script.push({ content: [...site("v"), finish("f5")] }, { content: [finish("f6")] });
    let calls = 0;
    const { events, result } = await run({ contrastCheck: async () => { calls++; return ['Contrast: p "Muted note" is 2.1:1 (#9da3a7 on #f2ba9b) and needs 4.5:1 at its size.']; } });
    assert.ok(result.finished); assert.equal(calls, 2);
    assert.ok(events.some(event => event.type === "tool_error" && /Muted note/.test(event.message ?? "")), "the instruction reaches the model");
    script.length = 0;
    script.push({ content: [...site("w"), finish("f7")] });
    const unverified = await run({ contrastCheck: async () => null });
    assert.ok(unverified.result.finished, "an unavailable browser never blocks");
  });

  console.log(`\n${passed} concept step checks passed (scripted provider, no network).`);
})().catch(error => { console.error(error); process.exit(1); });
