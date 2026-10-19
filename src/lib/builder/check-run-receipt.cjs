/* eslint-disable @typescript-eslint/no-require-imports -- Offline: credit estimates and run receipts (no network, no AI). */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { builderEstimates, creditRange, parseBuilderEstimates, MEASURED_FIRST_BUILD_USD, MEASURED_REVIEW_ROUND_USD } = require("./credit-estimate.ts");
const { newRunMeter, meterEvent, meterRefused, meterLost, runReceipt, formatDuration } = require("./run-receipt.ts");

// Estimates: whole credits rounded up, exactly like settlement, from the measured costs only.
assert.equal(MEASURED_FIRST_BUILD_USD.website.length, 20);
assert.equal(MEASURED_REVIEW_ROUND_USD.length, 20);
const at3 = builderEstimates(0.03);
assert.deepEqual(at3.firstBuild.website, { min: 16, median: 32, max: 45, samples: 20 });
assert.deepEqual(at3.firstBuild.presentation, { min: 7, median: 8, max: 9, samples: 2 });
assert.deepEqual(at3.firstBuild.book, { min: 9, median: 12, max: 14, samples: 2 });
assert.deepEqual(at3.reviewRound, { min: 8, median: 9, max: 11, samples: 20 });
assert.equal(at3.effort, "medium");
// A cheaper rate gives more credits for the same work; the measurement never moves.
assert.equal(builderEstimates(0.02).firstBuild.website.max, 68);
assert.throws(() => creditRange([], 0.03));
assert.throws(() => creditRange([1], 0));
// The measured first-build range stays inside the Medium ceiling it was measured under.
const { BUILDER_EFFORT } = require("./pricing.ts");
assert(at3.firstBuild.website.max <= BUILDER_EFFORT.medium.ceilingCredits);
// The client accepts only well-formed estimates.
assert.deepEqual(parseBuilderEstimates(JSON.parse(JSON.stringify(at3))), at3);
for (const bad of [null, {}, { ...at3, effort: "high" }, { ...at3, reviewRound: { min: 3, median: 2, max: 1, samples: 1 } }, { ...at3, firstBuild: { ...at3.firstBuild, book: { min: -1, median: 0, max: 1, samples: 1 } } }])
  assert.equal(parseBuilderEstimates(bad), null);

// Receipt: a first build with a continuation and a review round, all saved.
let meter = newRunMeter(1_000);
meterEvent(meter, { type: "file", path: "src/App.tsx" });
meterEvent(meter, { type: "file", path: "src/style.css" });
meterEvent(meter, { type: "done", version: 2, changed: true, finished: false, charged: 30 });
meterEvent(meter, { type: "file", path: "src/App.tsx" });
meterEvent(meter, { type: "delete", path: "src/old.tsx" });
meterEvent(meter, { type: "done", version: 3, changed: true, finished: true, charged: 8 });
meterEvent(meter, { type: "done", version: 4, changed: true, finished: true, charged: 9 }); meter.reviews++;
meter.render = { ok: true };
let receipt = runReceipt(meter, { website: true, unlimited: false, now: 103_000 });
assert.equal(receipt.charged, 47);
assert.equal(receipt.version, 4);
assert.equal(receipt.saved, true);
assert.deepEqual(receipt.files, ["src/App.tsx", "src/old.tsx", "src/style.css"]);
assert.deepEqual(receipt.checks.map(check => check.ok), [true, true, true]);
assert.match(receipt.checks[0].label, /Project check passed/);
assert.match(receipt.checks[1].label, /1 round /);
assert.equal(receipt.notCharged, false);
assert.equal(formatDuration(receipt.durationMs), "1 min 42 s");
assert.equal(formatDuration(400), "1 s");
assert.equal(formatDuration(120_000), "2 min");

// A review that changed nothing keeps the earlier save state and still reports its charge.
meter = newRunMeter(0);
meterEvent(meter, { type: "done", version: 7, changed: false, charged: 6 });
receipt = runReceipt(meter, { website: true, unlimited: false, now: 5_000 });
assert.equal(receipt.saved, false); assert.equal(receipt.charged, 6); assert.equal(receipt.notCharged, false);
assert.deepEqual(receipt.checks, []);

// Unfinished save: progress saved, the project check is reported as not reached.
meter = newRunMeter(0);
meterEvent(meter, { type: "done", version: 2, changed: true, finished: false, charged: 50 });
receipt = runReceipt(meter, { website: true, unlimited: false, now: 1 });
assert.equal(receipt.checks[0].ok, false);

// Failure settled at zero: the receipt says so, only because the server said 0.
meter = newRunMeter(0);
meterEvent(meter, { type: "error", code: "BUILD_FAILED", charged: 0 });
receipt = runReceipt(meter, { website: true, unlimited: false, now: 1 });
assert.equal(receipt.charged, 0); assert.equal(receipt.notCharged, true);
// An incomplete run is charged for the work it used: no "not charged" claim.
meter = newRunMeter(0);
meterEvent(meter, { type: "error", code: "BUILD_INCOMPLETE", charged: 12 });
receipt = runReceipt(meter, { website: true, unlimited: false, now: 1 });
assert.equal(receipt.charged, 12); assert.equal(receipt.notCharged, false);
// Refused before running: nothing ran, nothing charged.
meter = newRunMeter(0); meterRefused(meter);
assert.equal(runReceipt(meter, { website: true, unlimited: false, now: 1 }).notCharged, true);
// Lost connection or a pending recovery: the charge is unknown, never shown as zero.
meter = newRunMeter(0);
meterEvent(meter, { type: "done", version: 2, changed: true, finished: true, charged: 20 });
meterLost(meter);
receipt = runReceipt(meter, { website: true, unlimited: false, now: 1 });
assert.equal(receipt.charged, null); assert.equal(receipt.notCharged, false);
meter = newRunMeter(0);
meterEvent(meter, { type: "error", code: "OPERATION_RECOVERY_PENDING" });
assert.equal(runReceipt(meter, { website: true, unlimited: false, now: 1 }).charged, null);
// Unlimited allowances settle at zero: never presented as a free failed run.
meter = newRunMeter(0);
meterEvent(meter, { type: "error", code: "BUILD_FAILED", charged: 0 });
assert.equal(runReceipt(meter, { website: true, unlimited: true, now: 1 }).notCharged, false);
// Documents list their changes, not files, and make no website project-check claim.
meter = newRunMeter(0);
meterEvent(meter, { type: "item", label: "Wrote chapter 1" });
meterEvent(meter, { type: "done", version: 3, changed: true, finished: true, charged: 9 });
receipt = runReceipt(meter, { website: false, unlimited: false, now: 1 });
assert.deepEqual(receipt.items, ["Wrote chapter 1"]); assert.deepEqual(receipt.checks, []);
// No step reached the server: no receipt at all.
assert.equal(runReceipt(newRunMeter(0), { website: true, unlimited: false }), null);

// Build check: passed is shown as passed; a compiler that could not run is "needs attention", never a pass;
// results stored before the build field existed add no build line (no claim either way).
const buildChecks = build => {
  const m = newRunMeter(0);
  meterEvent(m, { type: "done", version: 2, changed: true, finished: true, charged: 5, ...(build === undefined ? {} : { build }) });
  return runReceipt(m, { website: true, unlimited: false, now: 1 }).checks.filter(check => /build/i.test(check.label));
};
assert.deepEqual(buildChecks("passed").map(check => check.ok), [true]);
assert.deepEqual(buildChecks("unverified").map(check => check.ok), [false]);
assert.match(buildChecks("unverified")[0].label, /could not run.*not verified/);
assert.deepEqual(buildChecks(undefined), []);
assert.deepEqual(buildChecks("ok"), [], "unknown values are not read as a pass");
// A later saving step replaces the earlier verdict.
meter = newRunMeter(0);
meterEvent(meter, { type: "done", version: 2, changed: true, finished: true, charged: 5, build: "passed" });
meterEvent(meter, { type: "done", version: 3, changed: true, finished: true, charged: 5, build: "unverified" });
assert.deepEqual(runReceipt(meter, { website: true, unlimited: false, now: 1 }).checks.filter(check => /build/i.test(check.label)).map(check => check.ok), [false]);
console.log("PASS credit estimates and run receipts");
