/* eslint-disable @typescript-eslint/no-require-imports -- Offline image routing checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { if (name === "server-only") return {}; return load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);

const {routeImage, allowedImageModels} = require("./image-router.ts");
const prices = require("../ai/prices.ts");
const health = require("../ai/image-health.ts");
const {startBudgetedImage} = require("../ai/image-call.ts");
const {RunSpend, memoryGate} = require("../ai/run-spend.ts");

const pending = [];
const check = (name, fn) => pending.push(async () => { await fn(); console.log(`PASS ${name}`); });
const ALL = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"];
const env = (models, extra = {}) => ({ OPENAI_API_KEY: "sk-offline-never-sent", MAKEBORNE_IMAGE_MODELS: models, ...extra });

check("routing table: text and transparency need 2.5, edits are refused, plain images take the cheapest bounded model", () => {
  const cases = [
    // [task, allowed, expected model | error pattern, quality]
    [{ kind: "photo", aspect: "landscape", text: null }, ALL, "gpt-image-2.5-flare", "medium"],
    [{ kind: "photo", aspect: "landscape", text: null }, ["gpt-image-2"], "gpt-image-2", "medium"],
    [{ kind: "illustration", aspect: "square", text: null }, ALL, "gpt-image-2.5-flare", "medium"],
    [{ kind: "texture", aspect: "square", text: null }, ALL, "gpt-image-2", "low"],
    [{ kind: "texture", aspect: "portrait", text: null }, ["gpt-image-2.5-flare"], "gpt-image-2.5-flare", "medium"],
    [{ kind: "photo", aspect: "portrait", text: "OPEN SATURDAYS", textPlacement: "loose" }, ALL, "gpt-image-2.5-flare", "medium"],
    [{ kind: "photo", aspect: "landscape", text: "Ovenbird", textPlacement: "exact" }, ALL, "gpt-image-2.5-sunburst", "medium"],
    [{ kind: "photo", aspect: "landscape", text: "Ovenbird", textPlacement: "exact" }, ["gpt-image-2", "gpt-image-2.5-flare"], "gpt-image-2.5-flare", "medium"],
    [{ kind: "photo", aspect: "square", text: "SALE" }, ["gpt-image-2"], /needs a GPT Image 2\.5 model, which isn't enabled/],
    [{ kind: "cutout", aspect: "square", text: null }, ALL, "gpt-image-2.5-flare", "medium"],
    [{ kind: "cutout", aspect: "portrait", text: null }, ["gpt-image-2.5-sunburst", "gpt-image-2"], "gpt-image-2.5-sunburst", "medium"],
    [{ kind: "cutout", aspect: "square", text: null }, ["gpt-image-2"], /Transparent cut-outs need a GPT Image 2\.5 model/],
    [{ kind: "photo", aspect: "square", text: null, edit: true }, ALL, /Editing an existing image needs gpt-image-2\.5-sunburst/],
    [{ kind: "icon", aspect: "square", text: null }, ALL, "gpt-image-2.5-flare", "medium"],
    [{ kind: "photo", aspect: "square", text: null }, [], /unavailable/],
  ];
  const table = [];
  for (const [task, allowed, expected, quality] of cases) {
    const route = routeImage(task, "A calm harbour at dawn, linen sails, watercolour", allowed);
    if (expected instanceof RegExp) { assert.equal(route.ok, false, JSON.stringify(task)); assert.match(route.error, expected); table.push([JSON.stringify(task), allowed.join("|"), "error"]); continue; }
    assert.equal(route.ok, true, `${JSON.stringify(task)} ${route.error}`);
    assert.equal(route.model, expected, JSON.stringify(task));
    assert.equal(route.quality, quality, JSON.stringify(task));
    assert.equal(route.background, task.kind === "cutout" ? "transparent" : "opaque");
    assert.ok(route.boundMicrousd > 0 && route.reason.length > 10);
    table.push([JSON.stringify(task), allowed.join("|"), `${route.model} ${route.quality} ${route.size}`]);
  }
  assert.equal(table.length, cases.length);
});

check("prompts: exact words quoted with 'spelled exactly' for text images, 'no text' for the rest; text is never dropped", () => {
  const text = routeImage({ kind: "photo", aspect: "landscape", text: "Bread \"club\" 8–11", textPlacement: "exact" }, "A chalkboard by the bakery door.", ALL);
  assert.match(text.prompt, /spelled exactly, letter for letter, and nothing else: "Bread 'club' 8–11"/);
  assert.match(text.prompt, /placed exactly where described above/);
  const plain = routeImage({ kind: "photo", aspect: "landscape", text: null }, "A bakery counter at dawn.", ALL);
  assert.match(plain.prompt, /No text, no letters, no logos, no watermarks\.$/);
  const already = routeImage({ kind: "photo", aspect: "landscape", text: "  " }, "A bakery counter. No text or logos.", ALL);
  assert.ok(!/No text, no letters/.test(already.prompt), "blank text is no text; an existing no-text line is not repeated");
});

check("allowlist: ordered MAKEBORNE_IMAGE_MODELS, MAKEBORNE_IMAGE_MODEL as a one-model list, gpt-image-1 and retired or unpriced models excluded", () => {
  assert.deepEqual(allowedImageModels(env("gpt-image-2, gpt-image-2.5-flare,gpt-image-2")).models, ["gpt-image-2", "gpt-image-2.5-flare"]);
  assert.deepEqual(allowedImageModels({ OPENAI_API_KEY: "k", MAKEBORNE_IMAGE_MODEL: "gpt-image-2.5-sunburst" }).models, ["gpt-image-2.5-sunburst"]);
  assert.deepEqual(allowedImageModels({ MAKEBORNE_IMAGE_MODELS: "gpt-image-2" }).models, [], "no key, no models");
  const before = allowedImageModels(env("gpt-image-1,gpt-image-2"), Date.parse("2026-10-21T00:00:00Z"));
  assert.deepEqual(before.models, ["gpt-image-2"]);
  assert.match(before.issues[0], /gpt-image-1 is never routed/);
  const retired = allowedImageModels(env("gpt-image-1"), Date.parse("2026-10-24T00:00:00Z"));
  assert.deepEqual(retired.models, []);
  assert.match(allowedImageModels(env("gpt-image-7,dall-e-3")).issues.join(" "), /gpt-image-7 has no price card.*dall-e-3 has no price card/);
  // A price card past its shutdown date is excluded generically.
  const card = prices.PRICE_EVIDENCE.find(item => item.model === "gpt-image-1");
  assert.equal(card.retiresAt, "2026-10-23T00:00:00Z");
  assert.throws(() => prices.imagePrice("gpt-image-1", Date.parse("2026-10-23T00:00:01Z")), /retired/);
});

check("bounds: 2.5 holds are measured tokens x 1.5 plus the prompt; high only on request and only where measured", () => {
  const prompt = "x".repeat(800);
  const bound = prices.imageCallBoundMicrousd("gpt-image-2.5-flare", "medium", "1024x1024", prompt);
  assert.equal(bound, Math.ceil(((800 + 64) * 5 + Math.ceil(439 * 1.5) * 30) * 1.1 + 1e-6));
  assert.ok(bound < 27_000, "a medium square 2.5 image with an 800-byte prompt is held at about $0.027");
  assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2.5-flare", quality: "high", size: "1536x1024" }), error => error.code === "UNSUPPORTED_AI_CONFIG");
  prices.assertSupportedImageRequest({ model: "gpt-image-2.5-flare", quality: "high", size: "1536x1024", allowHigh: true });
  assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2.5-flare", quality: "high", size: "1024x1024", allowHigh: true }), error => error.code === "UNSUPPORTED_AI_CONFIG", "unmeasured high square refused");
  assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", background: "transparent" }), error => error.code === "UNSUPPORTED_AI_CONFIG");
});

check("overrun: output tokens above the bound settle at actual, stop the run and stop routing to that model until cleared", async () => {
  health.clearImageOverrun();
  const errors = [], error = console.error; console.error = line => errors.push(line);
  try {
    const spend = new RunSpend({ run: "r", providerCapMicrousd: 1_000_000, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 600_000 });
    const client = { images: { generate: async () => ({ data: [{ b64_json: Buffer.from("img").toString("base64") }], usage: { input_tokens: 100, output_tokens: 900, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } }) } };
    const job = await startBudgetedImage({ client, spend, model: "gpt-image-2.5-flare", prompt: "A cup", size: "1024x1024", quality: "medium", signal: new AbortController().signal });
    await job.done;
    const detail = await job.detail;
    assert.equal(detail.overrun, true);
    assert.equal(detail.outputTokens, 900);
    assert.equal(detail.boundOutputTokens, 659);
    assert.equal(spend.calls[0].actualMicrousd, 100 * 5 + 900 * 30, "settled at the actual cost");
    assert.equal(spend.stopped, "OVERRUN");
    await assert.rejects(spend.begin("openai", "gpt-image-2.5-flare", 1000), error => error.code === "OVERRUN", "no further calls in this run");
    assert.ok(health.imageModelDisabled("gpt-image-2.5-flare"));
    assert.ok(errors.some(line => /image_model_overrun/.test(line)), "logged");
    const after = allowedImageModels(env(ALL.join(",")));
    assert.deepEqual(after.models, ["gpt-image-2.5-sunburst", "gpt-image-2"]);
    assert.match(after.issues.join(" "), /stopped after an overrun until reviewed/);
    assert.equal(routeImage({ kind: "photo", aspect: "landscape", text: "OPEN" }, "A sign", after.models).model, "gpt-image-2.5-sunburst", "text falls back to the other 2.5 model");
    // Within the bound: no overrun.
    const ok = await startBudgetedImage({ client: { images: { generate: async () => ({ data: [{ b64_json: "aW1n" }], usage: { input_tokens: 90, output_tokens: 439 } }) } },
      spend: new RunSpend({ run: "s", providerCapMicrousd: 1_000_000, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 600_000 }), model: "gpt-image-2.5-sunburst", prompt: "A cup", size: "1024x1024", quality: "medium", signal: new AbortController().signal });
    await ok.done;
    assert.equal((await ok.detail).overrun, false);
    assert.ok(!health.imageModelDisabled("gpt-image-2.5-sunburst"));
  } finally { console.error = error; health.clearImageOverrun(); }
});

(async () => {
  for (const run of pending) await run();
  console.log(`${pending.length} image routing checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
