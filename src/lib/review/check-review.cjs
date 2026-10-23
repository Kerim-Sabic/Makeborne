/* eslint-disable @typescript-eslint/no-require-imports -- Offline independent-review contract harness: fake reviewer with recorded findings, in-memory operation RPCs; no network, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fake = require("./operation-fake.cjs");

const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc: (n, a) => { const result = Promise.resolve().then(() => fake.rpc(n, a)); result.abortSignal = () => result; return result; } }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000 };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const contract = require("./contract.ts"), claims = require("./claims.ts"), validate = require("./validate.ts"), reviewer = require("./reviewer.ts");
const assemble = require("./assemble.ts"), loop = require("./loop.ts"), cross = require("./cross-provider.ts"), operation = require("./operation.ts");
const deterministic = require("./deterministic.ts"), guard = require("./guard.ts");
const task = require("../agency/task.ts"), server = require("../builder/operation-server.ts");
const { RunSpend, memoryGate } = require("../ai/run-spend.ts");
const { aiCostUsdPerCredit } = require("../builder/pricing.ts");
const { emptyDocument } = require("../documents/editor.ts");
const RATE = Math.round(aiCostUsdPerCredit() * 1_000_000);

const ACTOR = randomUUID(), W = randomUUID(), P = randomUUID(), ARTIFACT = randomUUID();
fake.setup({ W, P, ACTOR });
let passed = 0;
async function check(name, fn) { fake.reset(); fake.db.artifactVersion = 3; await fn(); passed++; console.log(`PASS ${name}`); }

// ---- Fixtures (all generated here) ----
const BUILDER_SUMMARY = "Fixed: everything is now perfect and fully accessible.";
const pixel = "/9j/" + "A".repeat(200);
const image = (id, label) => ({ id, label, mediaType: "image/jpeg", width: 1080, height: 675, data: pixel });
const brief = { id: "brief-1", version: 2, approved: true, summary: "A warm one-page site for Harbour Bakery that sells the weekly bread box.",
  requirements: [{ id: "price-visible", text: "Show the weekly bread box price on the first screen." }, { id: "contact", text: "Visitors can send a message." }] };
const facts = { snapshotId: "facts-7", facts: [{ id: "price-box", statement: "The weekly bread box costs €49 per month.", value: "€49" }, { id: "founded", statement: "Founded in 1998." }] };
const subject = (version = 3, body = "v3") => ({ artifactId: ARTIFACT, version, contentSha: contract.contentSha({ body, version }) });
const route = (path, viewport, selector = null) => ({ kind: "route", route: path, viewport, selector });
function websiteRequest(extra = {}) {
  const diagnostics = extra.diagnostics ?? [
    { id: "site.render:/:desktop", check: "site.render", location: route("/", "desktop"), status: "passed", measured: "820 characters of visible text" },
    { id: "site.broken-asset:/:desktop:0", check: "site.broken-asset", location: route("/", "desktop", "img"), status: "failed", measured: "image failed to load: /assets/missing.png" },
    { id: "site.claims:/:0", check: "site.claims", location: route("/", "desktop"), status: "failed", measured: "\"€59\" (price) is not in the approved facts" },
  ];
  return assemble.assembleRequest({
    subject: extra.subject ?? subject(), brief, facts, diagnostics,
    evidence: { kind: "website", images: [image("img-root-desktop-1", "/ desktop 1440px, screen 1 of 1"), image("img-root-phone-1", "/ phone 390px, screen 1 of 1")],
      routes: [{ path: "/", text: extra.text ?? "Bread baked at dawn\nWeekly bread box: €59 per month\nOpen daily from seven until two", viewports: [
        { viewport: "desktop", width: 1440, height: 900, pageHeight: 900, capturedHeight: 900, images: ["img-root-desktop-1"] },
        { viewport: "phone", width: 390, height: 844, pageHeight: 844, capturedHeight: 844, images: ["img-root-phone-1"] }] }] },
    coverage: { inspected: ["/ at desktop 1440×900", "/ at phone 390×844"], notInspected: [{ what: "scripts, motion, hover, focus and menus", reason: "static snapshot" }] },
  });
}
/** Recorded reviewer answers (fixtures). */
const finding = extra => ({ id: "f-1", category: "legibility", location: route("/", "desktop", "h1"), evidence: { type: "crop", imageId: "img-root-desktop-1", box: { x: 40, y: 80, w: 600, h: 120 } },
  severity: "major", briefRequirement: null, factRefs: [], proposedRepair: "Raise the heading contrast against the photo.", verificationMethod: { type: "visual", note: "Re-check the hero heading." }, ...extra });
const RECORDED = {
  grounded: { findings: [finding()], coverageNotes: ["Only the first desktop screen was visible."] },
  mixed: { coverageNotes: [], findings: [
    finding({ id: "visual-ok" }),
    finding({ id: "bad-image", evidence: { type: "crop", imageId: "img-made-up", box: { x: 0, y: 0, w: 10, h: 10 } } }),
    finding({ id: "price-wrong", category: "factual", evidence: { type: "quote", text: "€59 per month", from: "artifact" }, factRefs: ["price-box"], briefRequirement: { ref: "price-visible", quote: "weekly bread box price" }, proposedRepair: "Use the approved €49 price." }),
    finding({ id: "price-fine", category: "factual", location: route("/", "phone"), evidence: { type: "quote", text: "Gift boxes: €49 per month", from: "artifact" }, factRefs: [], proposedRepair: "Check the price." }),
    finding({ id: "invented-fact", category: "factual", location: route("/", "phone", "p"), evidence: { type: "quote", text: "Open daily from seven until two", from: "artifact" }, factRefs: ["opening-hours"], proposedRepair: "Fix the hours." }),
    finding({ id: "fake-quote", category: "content", location: route("/", "phone", "p"), evidence: { type: "quote", text: "Award-winning since 1850", from: "artifact" } }),
    finding({ id: "fake-brief", category: "completeness", location: route("/", "desktop", "form"), evidence: { type: "crop", imageId: "img-root-desktop-1", box: { x: 0, y: 0, w: 10, h: 10 } }, briefRequirement: { ref: "contact", quote: "a booking calendar" } }),
    finding({ id: "redesign", category: "layout", location: { kind: "artifact" }, evidence: { type: "crop", imageId: "img-root-desktop-1", box: { x: 0, y: 0, w: 1080, h: 675 } }, severity: "major", proposedRepair: "Redesign the page with a bolder modern look." }),
    finding({ id: "dup-asset", category: "broken", location: route("/", "desktop", "img"), evidence: { type: "measured", diagnosticId: "site.broken-asset:/:desktop:0", value: "missing" }, proposedRepair: "Fix the image." }),
    finding({ id: "wrong-route", location: route("/about", "desktop", "h1") }),
  ] },
  nits: { coverageNotes: [], findings: [finding({ id: "spacing", severity: "nit", category: "layout", proposedRepair: "Slightly more space under the heading." })] },
  none: { findings: [], coverageNotes: [] },
};
const use = (name, input) => ({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name, input });
/** A fake reviewer turn: reserves its bound through the RunSpend it is given, then records a cost. */
function scripted(turns) {
  const seen = [];
  const model = async request => {
    seen.push(request);
    const step = turns[seen.length - 1];
    if (!step) throw Error("Unscripted model turn");
    const ticket = await request.spend.begin("anthropic", "claude-opus-5-5", step.bound ?? 30000);
    await request.spend.finish(ticket, { actualMicrousd: step.cost ?? 10000 });
    return { content: step.content, stopReason: step.stopReason ?? "tool_use" };
  };
  model.seen = seen;
  return model;
}
const qualified = Object.freeze([Object.freeze({ profile: "standard", model: "claude-opus-5-5", effort: "medium", intensity: "medium", maxOutputTokens: 4000, maxTurns: 4,
  qualifiedKinds: Object.freeze(["independent_review"]), evidence: "offline fixture" })]);
const reviewTask = (extra = {}) => task.resolveAgencyTask(ACTOR, { artifactId: ARTIFACT, actionKey: randomUUID(), stepKey: randomUUID(), kind: "independent_review",
  objective: "Independent review of version 3 against the approved brief.", inputs: [], permittedTools: [], settings: "standard", ceilingCredits: 20, expectedRevision: 3, ...extra },
  { scope: server.resolveAgencyScope, settings: qualified, rateMicrousd: RATE });
const runDeps = model => ({ model, tools: {}, readInput: async () => "", platformDeadline: Date.now() + 280000, pollMs: 15, heartbeatMs: 25 });
const detFindings = request => deterministic.deterministicFindings(request.diagnostics);
const finishCall = () => fake.rpcLog.find(entry => entry.name === "makeborne_ai_operation_finish");
const keepAlive = setInterval(() => {}, 1000);

(async () => {
  await check("request: bound to {artifact, version, contentSha}; strict, so builder notes and self-assessment cannot be attached", async () => {
    const request = websiteRequest();
    assert.deepEqual(request.subject, subject());
    for (const extra of [{ builderSummary: BUILDER_SUMMARY }, { selfAssessment: { passed: true } }])
      assert.equal(contract.ReviewRequestSchema.safeParse({ ...request, ...extra }).success, false, `${Object.keys(extra)[0]} is refused`);
    assert.equal(contract.ReviewRequestSchema.safeParse({ ...request, evidence: { ...request.evidence, builderNotes: BUILDER_SUMMARY } }).success, false);
    // The reviewer's whole input is a function of the request only.
    const text = reviewer.reviewerText(request);
    assert.ok(!text.includes(BUILDER_SUMMARY) && !/Fixed:/.test(text), "no builder summary in the reviewer's context");
    assert.match(text, new RegExp(`version="3" content_sha256="${request.subject.contentSha}"`));
    assert.match(text, /\[price-box\] The weekly bread box costs €49/);
    assert.match(text, /site\.broken-asset:\/:desktop:0 \| failed/);
    assert.match(text, /not inspected:\n- scripts, motion/);
    assert.equal(reviewer.reviewerImages(request).filter(block => block.type === "image").length, 2);
    assert.notEqual(contract.reviewRequestDigest(request), contract.reviewRequestDigest(websiteRequest({ text: "Bread baked at dawn" })), "different evidence, different review");
    assert.throws(() => assemble.assembleRequest({ ...request, evidence: { ...request.evidence, routes: [{ ...request.evidence.routes[0], viewports: [request.evidence.routes[0].viewports[0]] }] } }), /REVIEW_INPUT_INVALID|desktop|2/);
  });

  await check("claims check: prices and percentages must match an approved fact (€59 unsupported, €49 and 1.200,00 normalised)", async () => {
    const results = claims.defaultClaimsCheck("Bread box €59 per month. Usual price €49. 30% off. Catering from 1.200,00 EUR.", { snapshotId: "s", facts: [...facts.facts, { id: "catering", statement: "Catering starts at €1,200." }] });
    assert.deepEqual(results.map(item => [item.text, item.supported, item.factId]), [["€59", false, null], ["€49", true, "price-box"], ["1.200,00 EUR", true, "catering"], ["30%", false, null]]);
    assert.deepEqual(claims.defaultClaimsCheck("No numbers here.", facts), []);
  });

  await check("server-side validation: refusal, truncation, missing and malformed answers are review_unavailable, never acceptable", async () => {
    const request = websiteRequest({ diagnostics: [{ id: "site.render:/:desktop", check: "site.render", location: route("/", "desktop"), status: "passed", measured: "ok" }] });
    const cases = [
      [{ stopReason: "refusal" }, "refusal"], [{ stopReason: "max_tokens", submitted: { findings: [] } }, "truncated"], [{ stopReason: "end_turn" }, "no_result"],
      [{ stopReason: "tool_use", submitted: { findings: [{ id: "x" }], coverageNotes: [] } }, "malformed"],
      [{ stopReason: "tool_use", submitted: { findings: [], coverageNotes: [], passed: true } }, "malformed"],
    ];
    for (const [reply, reason] of cases) {
      const interpreted = validate.interpretReply(reply);
      assert.deepEqual([interpreted.ok, interpreted.reason], [false, reason]);
      const result = validate.buildResult({ request, deterministic: [], model: interpreted, claims: claims.defaultClaimsCheck });
      assert.deepEqual([result.status, result.unavailableReason, result.reviewer], ["review_unavailable", reason, "deterministic_only"]);
    }
    const ok = validate.buildResult({ request, deterministic: [], model: validate.interpretReply({ stopReason: "tool_use", submitted: RECORDED.none }), claims: claims.defaultClaimsCheck });
    assert.equal(ok.status, "acceptable");
  });

  await check("grounding: schema-valid is not correct — unresolvable evidence, invented facts, false brief quotes and contradicted claims are unverified", async () => {
    const request = websiteRequest();
    const result = validate.buildResult({ request, deterministic: detFindings(request), model: validate.interpretReply({ stopReason: "tool_use", submitted: RECORDED.mixed }), claims: claims.defaultClaimsCheck });
    const by = id => result.findings.find(item => item.id === id);
    assert.equal(by("visual-ok").grounding, "grounded");
    assert.equal(by("price-wrong").grounding, "grounded", "cites the approved fact and quotes the output exactly");
    assert.match(by("bad-image").note, /img-made-up was not supplied/);
    assert.match(by("price-fine").note, /approved facts support this value/);
    assert.match(by("invented-fact").note, /unknown fact\(s\): opening-hours/);
    assert.match(by("fake-quote").note, /does not appear in the reviewed output/);
    assert.match(by("fake-brief").note, /brief quote does not match/);
    assert.match(by("wrong-route").note, /route \/about was not reviewed/);
    for (const id of ["bad-image", "price-fine", "invented-fact", "fake-quote", "fake-brief", "wrong-route"]) {
      assert.equal(by(id).grounding, "unverified", id);
      assert.equal(validate.repairable(by(id)), false, `${id} never reaches a repair`);
    }
    assert.deepEqual([by("redesign").severity, by("redesign").grounding], ["minor", "grounded"], "a whole-page redesign is a suggestion, not a repair");
    assert.equal(by("dup-asset"), undefined, "a model copy of a measured failure is dropped");
    assert.deepEqual(result.findings.filter(item => item.source === "deterministic").map(item => [item.grounding, item.severity, item.verificationMethod.checkId]),
      [["measured", "major", "site.broken-asset"], ["measured", "major", "site.claims"]]);
    assert.equal(result.status, "changes_needed");
    assert.equal(JSON.stringify(result).includes("claude"), false, "no model names in the result");
  });

  await check("acceptable work: only nits → acceptable, and the repair path is never called", async () => {
    const request = websiteRequest({ diagnostics: [{ id: "site.render:/:desktop", check: "site.render", location: route("/", "desktop"), status: "passed", measured: "ok" }], text: "Weekly bread box: €49 per month" });
    const result = validate.buildResult({ request, deterministic: [], model: validate.interpretReply({ stopReason: "tool_use", submitted: RECORDED.nits }), claims: claims.defaultClaimsCheck });
    assert.equal(result.status, "acceptable");
    let repairs = 0;
    const outcome = await loop.runReviewRepairLoop({ review: async () => result, repair: async () => { repairs++; return { ok: false, code: "X" }; }, reverify: async () => [], guard: async () => ({ ok: true, changed: [] }), current: async () => subject() }, { subject: subject() });
    assert.deepEqual([outcome.outcome, outcome.stoppedBy, repairs], ["complete", "acceptable", 0]);
  });

  // A loop harness over versioned fake content: each version holds findings that are still present.
  function loopWorld({ fixes = true, outOfScope = false, staleBefore = false } = {}) {
    const versions = [subject(3, "v3")], log = { repairs: [], reviews: 0, reverify: 0 };
    let present = ["site.broken-asset:/:desktop:0", "site.claims:/:0"];
    const request = websiteRequest();
    const ports = {
      async review(at, spend) {
        log.reviews++;
        if (spend) { const ticket = await spend.begin("anthropic", "claude-opus-5-5", 20000); await spend.finish(ticket, { actualMicrousd: 15000 }); }
        return validate.buildResult({ request, deterministic: detFindings(request), model: validate.interpretReply({ stopReason: "tool_use", submitted: RECORDED.nits }), claims: claims.defaultClaimsCheck });
      },
      async repair(input) {
        log.repairs.push(input);
        if (staleBefore) return { ok: false, code: "unused" };
        if (fixes) present = present.filter(id => !input.findings.some(item => item.evidence.diagnosticId === id));
        const next = subject(versions.at(-1).version + 1, `v${versions.length + 3}`);
        versions.push(next);
        return { ok: true, subject: next };
      },
      async guard({ findings }) { return outOfScope ? { ok: false, changed: ["footer:5"], violations: ["section footer:5 (footer) changed but no finding named it"] } : { ok: true, changed: findings.map(item => item.id) }; },
      async reverify({ findings, spend }) {
        log.reverify++;
        if (spend) { const ticket = await spend.begin("anthropic", "claude-opus-5-5", 20000); await spend.finish(ticket, { actualMicrousd: 15000 }); }
        const diagnostics = request.diagnostics.map(item => item.status === "failed" && !present.includes(item.id) ? { ...item, status: "passed", measured: "fixed" } : item);
        return assemble.reverifyFindings(findings, diagnostics, null);
      },
      async current() { return staleBefore ? subject(4, "someone else edited") : versions.at(-1); },
    };
    return { ports, log, versions };
  }

  await check("bounded repair: only blocker/major findings reach the repair; targeted re-verification proves the fix; complete", async () => {
    const world = loopWorld();
    const outcome = await loop.runReviewRepairLoop(world.ports, { subject: subject() });
    assert.deepEqual([outcome.outcome, outcome.stoppedBy, outcome.rounds.length], ["complete", "verified", 1]);
    assert.deepEqual(world.log.repairs[0].findings.map(item => item.severity), ["major", "major"]);
    assert.equal(world.log.repairs[0].findings.some(item => item.severity === "nit"), false, "nits never trigger a repair");
    assert.match(world.log.repairs[0].instructions, /Change nothing outside the named locations/);
    assert.deepEqual(outcome.rounds[0].verification.map(item => item.status), ["resolved", "resolved"]);
    assert.equal(outcome.subject.version, 4, "the result names the repaired revision");
  });

  await check("a repair that does not fix the defect → incomplete with the findings attached, never complete; rounds bounded (default 1, max 2)", async () => {
    const world = loopWorld({ fixes: false });
    const outcome = await loop.runReviewRepairLoop(world.ports, { subject: subject() });
    assert.deepEqual([outcome.outcome, outcome.stoppedBy, world.log.repairs.length], ["incomplete", "max_rounds", 1]);
    assert.deepEqual(outcome.unresolved.map(item => item.verificationMethod.checkId), ["site.broken-asset", "site.claims"]);
    assert.match(outcome.message, /still present/);
    const capped = loopWorld({ fixes: false });
    await loop.runReviewRepairLoop(capped.ports, { subject: subject(), maxRepairRounds: 9 });
    assert.equal(capped.log.repairs.length, 2, "never more than two repair rounds");
  });

  await check("diff guard: a repair that touches unnamed content is rejected → incomplete", async () => {
    const world = loopWorld({ outOfScope: true });
    const outcome = await loop.runReviewRepairLoop(world.ports, { subject: subject() });
    assert.deepEqual([outcome.outcome, outcome.stoppedBy, outcome.code, world.log.reverify], ["incomplete", "guard", "REPAIR_OUT_OF_SCOPE", 0]);
  });

  await check("stale results: a review is refused for application once the revision changed", async () => {
    const world = loopWorld({ staleBefore: true });
    const outcome = await loop.runReviewRepairLoop(world.ports, { subject: subject() });
    assert.deepEqual([outcome.outcome, outcome.stoppedBy, outcome.code, world.log.repairs.length], ["incomplete", "stale", "REVIEW_STALE", 0]);
    assert.throws(() => loop.assertReviewCurrent({ subject: subject() }, subject(4, "v4")), error => error.code === "REVIEW_STALE");
    assert.throws(() => loop.assertReviewCurrent({ subject: subject() }, { ...subject(), contentSha: "0".repeat(64) }), error => error.code === "REVIEW_STALE", "same number, different content");
    assert.doesNotThrow(() => loop.assertReviewCurrent({ subject: subject() }, subject()));
  });

  await check("allowance: review and re-verification spend through child views of the step's RunSpend and stop when it runs out", async () => {
    const parent = new RunSpend({ run: "operation:test", gate: memoryGate(), providerCapMicrousd: 40000, customerCapMicrousd: null, deadline: Date.now() + 600000, minCallMs: 0 });
    const world = loopWorld({ fixes: false });
    const outcome = await loop.runReviewRepairLoop(world.ports, { subject: subject(), spend: parent, maxRepairRounds: 2, minRoundMicrousd: 20000 });
    assert.equal(parent.calls.length, 2, "both calls recorded in the parent");
    assert.equal(parent.confirmedMicrousd, 30000);
    assert.deepEqual([outcome.outcome, outcome.stoppedBy], ["incomplete", "allowance"], "a second round is not started without allowance");
    const poor = new RunSpend({ run: "operation:test", gate: memoryGate(), providerCapMicrousd: 10000, customerCapMicrousd: null, deadline: Date.now() + 600000, minCallMs: 0 });
    await assert.rejects(loop.runReviewRepairLoop(loopWorld().ports, { subject: subject(), spend: poor }), error => error.code === "RUN_BUDGET", "a child can never exceed the parent's remaining allowance");
  });

  await check("operation: independent_review on the stage 1 contract stores the grounded review bound to the revision; replay makes no call", async () => {
    const request = websiteRequest();
    const resolved = await reviewTask();
    const model = scripted([{ cost: 22000, content: [use("submit_result", RECORDED.mixed)] }]);
    const { result, run } = await operation.runIndependentReview({ task: resolved, request, deterministic: detFindings(request), deps: runDeps(model) });
    assert.deepEqual([run.outcome, result.status, result.reviewer], ["result", "changes_needed", "fresh_context"]);
    assert.deepEqual(result.subject, request.subject);
    const first = model.seen[0].messages[0].content;
    assert.equal(first[1].type, "text"); assert.ok(first[1].text.includes("<approved_brief"));
    assert.equal(first.filter(block => block.type === "image").length, 2, "labelled screenshots reach the reviewer");
    assert.ok(!JSON.stringify(model.seen[0].messages).includes(BUILDER_SUMMARY));
    assert.equal(model.seen[0].system, reviewer.REVIEWER_SYSTEM);
    const stored = finishCall().args.p_candidate.data;
    assert.deepEqual([stored.requestDigest, stored.findings.find(item => item.id === "bad-image").grounding], [contract.reviewRequestDigest(request), "unverified"], "the stored data is the server-validated review");
    assert.equal(finishCall().args.p_outcome, "result");
    assert.equal(JSON.stringify(fake.rpcLog.find(entry => entry.name === "makeborne_ai_operation_create").args.p_context).includes("claude"), false);
    const never = scripted([]);
    const again = await operation.runIndependentReview({ task: resolved, request, deterministic: detFindings(request), deps: runDeps(never) });
    assert.deepEqual([never.seen.length, again.run.replayed, again.result.requestDigest], [0, true, result.requestDigest]);
    // Reconnect: recorded state only, and stale once the project moved on.
    const read = await operation.readIndependentReview({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id: run.status.operation.id }, request.subject);
    assert.deepEqual([read.stale, read.result.requestDigest], [false, result.requestDigest]);
    const moved = await operation.readIndependentReview({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id: run.status.operation.id }, subject(4, "v4"));
    assert.equal(moved.stale, true);
  });

  await check("operation: refusal, truncation and malformed answers end the step uncharged as review_unavailable with deterministic findings kept", async () => {
    const request = websiteRequest();
    const cases = [
      [[{ stopReason: "refusal", content: [{ type: "text", text: "I can't help with that." }] }], "refusal", 1],
      [[{ stopReason: "max_tokens", content: [use("submit_result", { findings: [] })] }], "truncated", 1],
      [[1, 2, 3].map(() => ({ content: [use("submit_result", { findings: "none" })] })), "malformed", 3],
      [[1, 2, 3, 4].map(() => ({ stopReason: "end_turn", content: [{ type: "text", text: "Looks great!" }] })), "no_result", 4],
    ];
    for (const [turns, reason, calls] of cases) {
      fake.reset(); fake.db.artifactVersion = 3;
      const model = scripted(turns);
      const { result, run } = await operation.runIndependentReview({ task: await reviewTask(), request, deterministic: detFindings(request), deps: runDeps(model) });
      assert.deepEqual([result.status, result.unavailableReason, model.seen.length], ["review_unavailable", reason, calls], reason);
      assert.equal(result.findings.filter(item => item.source === "deterministic").length, 2, "measured findings are not hidden");
      assert.notEqual(run.outcome, "result");
      if (reason !== "no_result") assert.equal(run.charged, 0, `${reason}: no charge for a failed review`);
    }
  });

  await check("operation: the review task must match the reviewed revision; the shipped settings registry refuses it until qualified", async () => {
    const request = websiteRequest({ subject: subject(2, "v2") });
    await assert.rejects(operation.runIndependentReview({ task: await reviewTask(), request, deterministic: [], deps: runDeps(scripted([])) }), /different revisions/);
    await assert.rejects(task.resolveAgencyTask(ACTOR, { artifactId: ARTIFACT, actionKey: randomUUID(), stepKey: randomUUID(), kind: "independent_review", objective: "Review", inputs: [], permittedTools: [], settings: "standard", ceilingCredits: 20, expectedRevision: 3 },
      { scope: server.resolveAgencyScope, rateMicrousd: RATE }), error => error.code === "AGENCY_SETTINGS_UNQUALIFIED");
    const only = operation.deterministicOnly(websiteRequest(), detFindings(websiteRequest()), "reviewer_not_qualified");
    assert.deepEqual([only.status, only.unavailableReason, only.reviewer], ["review_unavailable", "reviewer_not_qualified", "deterministic_only"], "deterministic-only is never acceptable");
    assert.equal(operation.independentReviewEnabled({}), false);
    assert.equal(operation.independentReviewEnabled({ MAKEBORNE_INDEPENDENT_REVIEW: "on" }), true);
  });

  await check("stage 1 hooks: a lead's finalizer that throws ends the step failed and uncharged, never with an open run", async () => {
    const { runAgencyTask } = require("../agency/run.ts");
    const outcome = await runAgencyTask(await reviewTask(), { system: "s", result: contract.ModelReviewSchema, resultDescription: "d", finalize: () => { throw new Error("boom"); } },
      runDeps(scripted([{ content: [use("submit_result", RECORDED.none)] }])));
    assert.deepEqual([finishCall().args.p_outcome, outcome.charged], ["failed", 0]);
    assert.equal([...fake.db.runs.values()].every(item => item.status === "finished"), true);
  });

  await check("cross-provider reviewer: off by default, refused while unqualified even when flagged on", async () => {
    const impl = { id: "other", review: async () => ({ stopReason: "end_turn" }) };
    assert.equal(cross.crossProviderFlag({}), "off");
    assert.throws(() => cross.resolveCrossProviderReviewer(impl, { env: {} }), error => error.code === "REVIEWER_DISABLED");
    assert.throws(() => cross.resolveCrossProviderReviewer(impl, { env: { MAKEBORNE_CROSS_PROVIDER_REVIEW: "on" } }), error => error.code === "REVIEWER_NOT_QUALIFIED");
    assert.equal(cross.resolveCrossProviderReviewer(impl, { env: { MAKEBORNE_CROSS_PROVIDER_REVIEW: "on" }, registry: [{ id: "cross_provider", qualified: true }] }), impl, "only a qualified registry entry unlocks it");
    assert.deepEqual(cross.REVIEWER_REGISTRY.map(item => [item.id, item.defaultOn, item.qualified]), [["fresh_context", true, false], ["cross_provider", false, false]]);
  });

  await check("document diff guard: a repair may change only the named slide/chapter and never the theme", async () => {
    const deck = emptyDocument("deck", "Harbour");
    deck.slides = [{ id: "intro", layout: "statement", tone: "light", title: "Bread at dawn", notes: "Open." }, { id: "price", layout: "statement", tone: "light", title: "Box €59", notes: "Price." }];
    const target = [{ ...detFindings(websiteRequest())[1], location: { kind: "slide", slide: 2, slideId: "price" } }];
    const fixed = structuredClone(deck); fixed.slides[1].title = "Box €49";
    assert.deepEqual(guard.documentGuard(deck, fixed, target), { ok: true, changed: ["slide price"] });
    const wider = structuredClone(fixed); wider.slides[0].title = "A new intro";
    assert.match(guard.documentGuard(deck, wider, target).violations.join(), /slide intro changed but no finding named it/);
    const rebrand = structuredClone(fixed); rebrand.theme.palette.accent = "#00FF00";
    assert.match(guard.documentGuard(deck, rebrand, target).violations.join(), /brand identity changed/);
    const book = emptyDocument("book", "Tales");
    book.chapters = [{ id: "one", title: "One", text: "First." }, { id: "two", title: "Two", text: "Costs €59." }];
    const repaired = structuredClone(book); repaired.chapters[1].text = "Costs €49.";
    assert.equal(guard.documentGuard(book, repaired, [{ ...target[0], location: { kind: "page", page: 7, chapterId: "two" } }]).ok, true);
    assert.equal(guard.documentGuard(book, repaired, [{ ...target[0], location: { kind: "page", page: 5, chapterId: "one" } }]).ok, false);
  });

  console.log(`\n${passed} independent review checks passed.`);
  clearInterval(keepAlive);
})().catch(error => { console.error(error); process.exit(1); });
