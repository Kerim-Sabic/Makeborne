/* eslint-disable @typescript-eslint/no-require-imports -- Offline: image cells, size rules and the measurement plan (no network, no AI). */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const cells = require("./image-cells.ts");
const prices = require("./prices.ts");

// Size rules of the 2.5 models (multiples of 16, 1:3 to 3:1, edge <= 3840, pixels within range, never above 2560x1440).
for (const size of ["2560x1440", "1440x2560", "2048x1536", "1920x1920", "1536x2304", "2560x1280", "1600x1280", "2880x1152", "1152x2496", "1536x1024", "1024x1024"]) assert.equal(cells.sizeIssue(size), null, size);
for (const [size, why] of [["2560x1441", /multiples/], ["3840x1080", /edge|ratio|pixels/], ["4000x1000", /edge/], ["3200x960", /ratio/], ["640x640", /fewer/], ["2560x1600", /2560x1440/], ["2048x2048", /2560x1440/], ["abc", /WIDTHxHEIGHT/]])
  assert.match(cells.sizeIssue(size) ?? "", why, size);
// Every planned size is requestable.
for (const cell of cells.MEASUREMENT_PLAN) assert.equal(cells.sizeIssue(cell.size), null, cell.size);

// Crops: centred, to the ratio, whole canvas when it already has it.
assert.deepEqual(cells.cropFor("1536x1024", 16 / 9), { left: 0, top: 80, width: 1536, height: 864 });
assert.deepEqual(cells.cropFor("2560x1440", 16 / 9), { left: 0, top: 0, width: 2560, height: 1440 });
assert.deepEqual(cells.cropFor("1536x1024", 4 / 3), { left: 85, top: 0, width: 1365, height: 1024 });
assert.deepEqual(cells.cropFor("1024x1536", 9 / 16), { left: 80, top: 0, width: 864, height: 1536 });
assert.deepEqual(cells.cropMargins("1536x1024", cells.cropFor("1536x1024", 16 / 9)), { x: 0, y: 7.8 });

// Only measured cells resolve. Measured 2026-10-26: the native document and comp sizes at high and xhigh; a cell
// outside the tables (xhigh 1536x1024, high 1024x1024) still falls back or is refused.
const sun = "gpt-image-2.5-sunburst";
assert.equal(cells.cellMeasured(sun, "high", "1536x1024"), true);
assert.equal(cells.cellMeasured(sun, "high", "2560x1440"), true);
assert.equal(cells.cellMeasured(sun, "xhigh", "2560x1440"), true);
assert.equal(cells.cellMeasured(sun, "xhigh", "1536x1024"), false);
assert.equal(cells.cellMeasured(sun, "high", "1024x1024"), false);
assert.equal(cells.cellMeasured("gpt-image-unknown", "medium", "1024x1024"), false);
const wide = cells.resolveCell(sun, "high", ["2560x1440", "1536x1024"], 16 / 9);
assert.equal(wide.ok, true); assert.equal(wide.size, "2560x1440"); assert.equal(wide.native, true); assert.deepEqual(wide.crop, { left: 0, top: 0, width: 2560, height: 1440 });
const fallback = cells.resolveCell(sun, "high", ["1024x1024", "1536x1024"], 16 / 9);
assert.equal(fallback.size, "1536x1024"); assert.equal(fallback.native, false); assert.deepEqual(fallback.crop, { left: 0, top: 80, width: 1536, height: 864 });
const refused = cells.resolveCell(sun, "xhigh", ["1536x1024", "1024x1024"], 16 / 9);
assert.equal(refused.ok, false); assert.match(refused.error, /no measured xhigh canvas/);
assert.equal(cells.resolveCell(sun, "medium", ["1024x1024"], 1).native, true);
// Every planned cell is now measured, on both models.
for (const cell of cells.MEASUREMENT_PLAN) for (const model of [sun, "gpt-image-2.5-flare"]) assert.ok(cells.cellMeasured(model, cell.quality, cell.size), `${model} ${cell.quality} ${cell.size}`);
assert.equal(prices.imageOutputTokenBound(sun, "high", "2560x1440"), Math.ceil(1843 * prices.MEASURED_HEADROOM), "bound = observed x 1.5 (D8)");

// prices.ts: xhigh and custom sizes are refused unless asked for AND measured.
assert.throws(() => prices.assertSupportedImageRequest({ model: sun, quality: "xhigh", size: "2560x1440" }), error => error.code === "UNSUPPORTED_AI_CONFIG", "xhigh needs allowHigh");
assert.doesNotThrow(() => prices.assertSupportedImageRequest({ model: sun, quality: "xhigh", size: "2560x1440", allowHigh: true }));
assert.throws(() => prices.assertSupportedImageRequest({ model: sun, quality: "xhigh", size: "1536x1024", allowHigh: true }), error => error.code === "UNSUPPORTED_AI_CONFIG", "unmeasured xhigh refused");
assert.throws(() => prices.assertSupportedImageRequest({ model: sun, quality: "high", size: "1024x1024", allowHigh: true }), error => error.code === "UNSUPPORTED_AI_CONFIG", "unmeasured high square refused");
assert.throws(() => prices.assertSupportedImageRequest({ model: sun, quality: "medium", size: "auto" }), error => error.code === "UNSUPPORTED_AI_CONFIG", "auto size refused");
assert.doesNotThrow(() => prices.assertSupportedImageRequest({ model: sun, quality: "high", size: "1536x1024", allowHigh: true }));
assert.throws(() => prices.imageCallBoundMicrousd(sun, "xhigh", "1536x1024", "x"), prices.UnpricedModelError);

// The plan: every wanted size at high and xhigh on sunburst, three flare parity cells; estimate within the reservation.
assert.equal(cells.MEASUREMENT_PLAN.length, Object.keys(cells.WANTED_SIZES).length * 2 + 3);
const estimate = cells.measurementEstimate();
assert.equal(estimate.calls, cells.MEASUREMENT_PLAN.length);
assert(estimate.expectedUsd > 1.5 && estimate.expectedUsd < 2.5, `expected $${estimate.expectedUsd}`);
assert(estimate.boundUsd > estimate.expectedUsd && estimate.boundUsd < 3.5, `bound $${estimate.boundUsd}`);
// The owner's reel observation at the reference size is the expectation there.
assert.equal(estimate.rows.find(row => row.size === "2560x1440" && row.quality === "high" && row.model === sun).reference, 1843);
console.log("image cells: size rules, crops, measured-only resolution, refusal of unmeasured cells and the measurement plan OK");
