/* eslint-disable @typescript-eslint/no-require-imports -- Offline check that the image price card's notes match its math and the recorded evidence (no network, no provider call). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const prices = require("./prices.ts");
const source = fs.readFileSync(path.join(__dirname, "prices.ts"), "utf8");
const evidence = model => prices.PRICE_EVIDENCE.find(item => item.model === model);

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("stale price notes are gone", () => {
  for (const stale of [/half a cent/i, /no OpenAI key/i, /publishes no per-image price or output-token count/i, /Not live-qualified/i])
    assert.doesNotMatch(source, stale);
});

check("rounding headroom is 0.05 cent, as the comment and note say", () => {
  assert.match(source, /\$0\.0005 \(0\.05 cent/);
  const square = prices.IMAGE_PRICES["gpt-image-2"].outputTokens;
  const published = { low: 0.006, medium: 0.053, high: 0.211 };
  for (const [quality, usd] of Object.entries(published)) {
    const implied = square[quality]["1024x1024"] * 30 / 1_000_000;
    assert.ok(implied >= usd && implied - usd <= 0.0005 + 30 / 1_000_000, `${quality}: ${implied} vs ${usd}`);
  }
  assert.equal(square.medium["1024x1024"], Math.ceil((0.053 + 0.0005) / 30 * 1_000_000));
});

check("Image 2 note cites the single recorded live run and its usage reproduces the recorded cost", () => {
  const notes = evidence("gpt-image-2").notes.join(" ");
  assert.match(notes, /Live-qualified once, 2026-10-20/);
  assert.match(notes, /docs\/release-review\/openai-images-20261020\.md/);
  assert.match(notes, /not a provider invoice, a builder integration or production activation/);
  // 68 text-input and 1,756 output tokens at $5 and $30 per 1M = $0.05302.
  assert.equal(prices.imageUsageMicrousd("gpt-image-2", { input_tokens: 68, output_tokens: 1756 }), 53_020);
});

check("2.5 evidence carries the 2026-10-20 published rates; D8 (changed by the owner 2026-10-21) bounds them by measured tokens", () => {
  for (const model of ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]) {
    const item = evidence(model);
    assert.equal(item.verifiedAt, "2026-10-20");
    assert.deepEqual(item.components, { textInput: 5, textCachedInput: 1.25, imageInput: 8, imageCachedInput: 2, imageOutput: 30 });
    assert.ok(item.priceSources.some(source => source.startsWith("https://developers.openai.com/api/docs/guides/image-generation (checked 2026-10-20")));
    const notes = item.notes.join(" ");
    assert.match(notes, /An estimate is not a bound/, "the published estimator is not treated as a maximum");
    assert.match(notes, /D8 changed 2026-10-21/, "the owner decision and its evidence are recorded");
    const measured = prices.MEASURED_IMAGE_OUTPUT_TOKENS[model];
    assert.ok(measured && measured.observed.medium["1536x1024"] > 0, "a measured cell exists for the router's default size and quality");
    assert.ok(!prices.UNBOUNDED_IMAGE_MODELS.includes(model), "measured 2.5 models are no longer unbounded");
  }
});

console.log(`${passed}/4 price note checks passed.`);
