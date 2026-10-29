/* eslint-disable @typescript-eslint/no-require-imports -- Local real-browser check of the generated-site verifier. */
// Runs infra/project-runtime/site-verifier.mjs against small fictional sites (site-verifier-fixtures.mjs): a good site
// and one defect each. Asserts the exact status of every result and that nothing left the verifier: a localhost
// canary server that the fixture page tries to reach by fetch, image, WebSocket and beacon must see zero requests.
// No provider, database, cloud or paid call. The verifier is Chromium-only, like the publication renderer it shares
// its launch with, so other engines print SKIP. Usage: node scripts/check-site-verifier-browser.cjs [--engine x] [--keep]
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { engineOnly } = require("./browser-engine.cjs");

const viewport = (width, height) => ({ width, height });
const PHONE = viewport(390, 844), SMALL = viewport(360, 740), DESKTOP = viewport(1440, 900);
const HOME = [{ path: "/", title: "Home" }];

async function main() {
  if (!engineOnly("chromium", "generated-site verifier (hardened Chromium launch and CDP isolated world shared with the publication renderer)")) return;
  const { verifySite, siteDigest } = await import("../infra/project-runtime/site-verifier.mjs");
  const { fixtureSite, FIXTURE_ROUTES } = await import("../infra/project-runtime/site-verifier-fixtures.mjs");
  const canaryHits = [];
  const canary = http.createServer((req, res) => { canaryHits.push(`${req.method} ${req.url}`); res.end("canary"); });
  await new Promise(resolve => canary.listen(0, "127.0.0.1", resolve));
  const port = canary.address().port;
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "makeborne-site-verifier-check-"));
  let count = 0;
  const run = async (name, options, request) => {
    const report = await verifySite({ identity: { artifactId: `fixture-${name}`, version: 1, sourceRevision: "fixture", ...(request.identity ?? {}) }, site: request.site ?? fixtureSite(options), routes: request.routes ?? FIXTURE_ROUTES, viewports: request.viewports, only: request.only, limits: request.limits, evidenceDir: path.join(evidenceRoot, name) });
    // Every request was fulfilled from the fixture bytes, answered by the local sink or aborted.
    const fromOutputs = path.relative(path.resolve(__dirname, "..", "outputs"), report.evidenceDir);
    assert.ok(fromOutputs.startsWith("..") || path.isAbsolute(fromOutputs), "evidence stays outside outputs/");
    for (const result of report.results) {
      assert.ok(["passed", "failed", "not_checked"].includes(result.status), result.id);
      if (result.status === "not_checked") assert.ok(result.reason, `${result.id} not_checked without a reason`);
      if (result.status === "passed") assert.equal(result.reason, undefined, `${result.id} passed with a reason`);
      assert.ok(Array.isArray(result.steps) && Array.isArray(result.evidence.log) && "screenshot" in result.evidence, result.id);
    }
    return report;
  };
  const statuses = report => Object.fromEntries(report.results.map(result => [result.id, result.status]));
  const find = (report, id) => report.results.find(result => result.id === id);
  async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }

  await check("good site: every check runs and passes; only the unverifiable version and external links are not_checked", async () => {
    const report = await run("good", {}, {});
    const notChecked = report.results.filter(result => result.status === "not_checked").map(result => result.id);
    assert.deepEqual(report.results.filter(result => result.status === "failed").map(result => `${result.id}: ${result.observed}`), []);
    assert.deepEqual(notChecked, ["version", "external-links:/:1440x900"]);
    assert.equal(report.summary.passed, report.results.length - 2);
    const checks = new Set(report.results.map(result => result.check));
    for (const name of ["route-load", "overflow", "occlusion", "fixed-bars", "navigation", "unknown-route", "mobile-menu", "mobile-menu-escape", "keyboard-reach", "focus-visible", "keyboard-trap", "primary-action", "form-empty-submit", "form-submit", "reduced-motion"]) assert.ok(checks.has(name), name);
    assert.equal(report.network.sink, 1, "exactly one enquiry reached the local sink");
    assert.equal(report.network.offOrigin, 0);
    assert.deepEqual(report.violations, []);
    assert.ok(fs.existsSync(find(report, "route-load:/:390x844").evidence.screenshot), "route screenshots are written to the evidence folder");
    assert.match(find(report, "external-links:/:1440x900").observed, /tel:\+441234567890.*maps\.example\.com/);
  });

  const cases = [
    ["dead internal link", { deadLink: true }, { only: ["navigation"], viewports: [DESKTOP] }, { "navigation:/:1440x900": "failed", "navigation:/menu:1440x900": "failed" }, report => assert.match(find(report, "navigation:/:1440x900").observed, /#\/journal is not a declared route.*opening-hours/)],
    ["mobile menu that never opens", { menuNeverOpens: true }, { only: ["mobile-menu", "mobile-menu-escape"], viewports: [PHONE] }, { "mobile-menu:/:390x844": "failed", "mobile-menu-escape:/:390x844": "not_checked" }, report => assert.match(find(report, "mobile-menu:/:390x844").reason, /never opens/)],
    ["menu that cannot be closed with Escape", { menuNoEscape: true }, { only: ["mobile-menu", "mobile-menu-escape"], viewports: [PHONE] }, { "mobile-menu:/:390x844": "passed", "mobile-menu-escape:/:390x844": "failed" }, report => assert.match(find(report, "mobile-menu-escape:/:390x844").reason, /Escape/)],
    ["horizontal overflow at 360 only", { overflow360: true }, { only: ["overflow"], viewports: [SMALL, PHONE], routes: HOME }, { "overflow:/:360x740": "failed", "overflow:/:390x844": "passed" }, report => assert.match(find(report, "overflow:/:360x740").observed, /scrolls 6 px sideways/)],
    ["fixed bar covering the primary action", { fixedBar: true }, { only: ["occlusion", "fixed-bars"], viewports: [PHONE], routes: HOME }, { "occlusion:/:390x844": "failed", "fixed-bars:/:390x844": "failed" }, report => { assert.match(find(report, "occlusion:/:390x844").observed, /covered by div\.promo.*fixed/); assert.match(find(report, "fixed-bars:/:390x844").observed, /div\.promo.*covers 7\d%/); }],
    ["broken image and missing asset", { brokenImage: true }, { only: ["route-load"], viewports: [DESKTOP], routes: HOME }, { "route-load:/:1440x900": "failed" }, report => assert.match(find(report, "route-load:/:1440x900").observed, /missing asset: \/images\/missing\.png \(image\); broken image/)],
    ["runtime error", { runtimeError: true }, { only: ["route-load"], viewports: [DESKTOP], routes: HOME }, { "route-load:/:1440x900": "failed" }, report => assert.match(find(report, "route-load:/:1440x900").observed, /runtime error: fixture boom/)],
    ["form with no status message", { formNoStatus: true }, { only: ["form-empty-submit", "form-submit"], viewports: [DESKTOP], routes: HOME }, { "form-empty-submit:/:1440x900#0": "passed", "form-submit:/:1440x900#0": "failed" }, report => { assert.equal(report.network.sink, 1); assert.match(find(report, "form-submit:/:1440x900#0").observed, /accepted but no visible status/); }],
    ["form that posts twice", { formTwice: true }, { only: ["form-submit"], viewports: [DESKTOP], routes: HOME }, { "form-submit:/:1440x900#0": "failed" }, report => { assert.equal(report.network.sink, 2); assert.match(find(report, "form-submit:/:1440x900#0").observed, /2 POSTs/); }],
    ["form posting off-origin is blocked and recorded", { formOffOrigin: true }, { only: ["form-submit"], viewports: [DESKTOP], routes: HOME }, { "form-submit:/:1440x900#0": "failed" }, report => {
      assert.equal(report.network.sink, 0);
      assert.ok(report.violations.some(item => item.kind === "off-origin" && item.url === "https://collector.example/enquiries"), JSON.stringify(report.violations));
      assert.match(find(report, "form-submit:/:1440x900#0").observed, /collector\.example.*aborted/);
    }],
    ["content hidden and looping under reduced motion", { reducedHidden: true }, { only: ["reduced-motion"], viewports: [PHONE], routes: HOME }, { "reduced-motion:/:390x844": "failed" }, report => assert.match(find(report, "reduced-motion:/:390x844").observed, /stay hidden: h2 "Visit" \(opacity 0\.00\).*infinite animation.*spin/)],
    ["unknown route renders a blank page", { unknownBlank: true }, { only: ["unknown-route"], viewports: [DESKTOP], routes: HOME }, { "unknown-route:/__makeborne_unknown__:1440x900": "failed" }, report => assert.match(find(report, "unknown-route:/__makeborne_unknown__:1440x900").observed, /blank \(only the document title/)],
    ["primary button without an effect", { primaryNoop: true }, { only: ["primary-action"], viewports: [DESKTOP], routes: HOME }, { "primary-action:/:1440x900#0": "failed" }, report => assert.match(find(report, "primary-action:/:1440x900#0").observed, /nothing happened/)],
    ["focus outline removed", { focusInvisible: true }, { only: ["focus-visible"], viewports: [DESKTOP], routes: HOME }, { "focus-visible:/:1440x900": "failed" }, report => assert.match(find(report, "focus-visible:/:1440x900").observed, /a\.mark "Fixture Bistro"/)],
    ["a date input is neither a trap nor an unfillable field", { dateField: true }, { only: ["keyboard-trap", "form-submit"], viewports: [DESKTOP], routes: HOME }, { "keyboard-trap:/:1440x900": "passed", "form-submit:/:1440x900#0": "passed" }, null],
    ["keyboard trap", { keyboardTrap: true }, { only: ["keyboard-trap", "keyboard-reach"], viewports: [DESKTOP], routes: HOME }, { "keyboard-reach:/:1440x900": "failed", "keyboard-trap:/:1440x900": "failed" }, null],
  ];
  for (const [name, options, request, expected, extra] of cases) {
    await check(name, async () => {
      const report = await run(name.replace(/\W+/g, "-"), options, request);
      assert.deepEqual(statuses(report), expected, JSON.stringify(report.results.map(result => [result.id, result.status, result.observed]), null, 1));
      if (extra) extra(report);
    });
  }

  await check("nothing leaves the verifier: localhost fetch, image, socket and beacon are blocked and recorded", async () => {
    const report = await run("canary", { canaryPort: port }, { only: ["route-load"], viewports: [DESKTOP], routes: HOME });
    assert.deepEqual(statuses(report), { "route-load:/:1440x900": "failed" });
    assert.match(find(report, "route-load:/:1440x900").observed, /127\.0\.0\.1/);
    assert.ok(report.violations.some(item => item.url.includes(`127.0.0.1:${port}`)), JSON.stringify(report.violations));
    assert.ok(report.network.offOrigin >= 1);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(canaryHits, [], "the canary server on localhost received a request");
  });

  await check("step budget exhaustion: remaining checks are not_checked with a reason, never passed", async () => {
    const report = await run("budget", {}, { limits: { maxSteps: 3, timeMs: 60_000 } });
    assert.equal(report.budget.stopped, "steps");
    assert.ok(report.budget.steps <= 3);
    const firstSkipped = report.results.findIndex(result => /step budget exhausted/.test(result.reason ?? ""));
    assert.ok(firstSkipped > 0, "some checks ran before the budget ran out");
    assert.ok(report.results.slice(firstSkipped).every(result => result.status === "not_checked"), "nothing after exhaustion is passed or failed");
    assert.ok(report.summary.not_checked > report.summary.passed);
    assert.ok(report.results.length >= 50, "the whole plan is still reported, as not_checked");
  });

  await check("time budget exhaustion stops the run in time", async () => {
    const started = Date.now();
    const report = await run("time", {}, { limits: { timeMs: 4000, maxSteps: 3000 } });
    assert.equal(report.budget.stopped, "time");
    assert.ok(Date.now() - started < 25_000, `took ${Date.now() - started} ms`);
    assert.ok(report.results.some(result => /time budget exhausted/.test(result.reason ?? "")));
  });

  await check("publication digest: a mismatch fails, the digest of the verified bytes passes", async () => {
    const site = fixtureSite({});
    const wrong = await run("digest-wrong", {}, { site, only: ["version", "route-load"], viewports: [DESKTOP], routes: HOME, identity: { publicationDigest: `sha256:${"0".repeat(64)}` } });
    assert.deepEqual(statuses(wrong), { version: "failed", "route-load:/:1440x900": "passed" });
    assert.match(find(wrong, "version").reason, /not the publication/);
    const right = await run("digest-right", {}, { site, only: ["version"], identity: { publicationDigest: siteDigest(site) } });
    assert.deepEqual(statuses(right), { version: "passed" });
  });

  canary.close();
  if (!process.argv.includes("--keep")) fs.rmSync(evidenceRoot, { recursive: true, force: true });
  else console.log(`Evidence kept in ${evidenceRoot}`);
  console.log(`${count} site-verifier browser groups passed (canary hits: ${canaryHits.length}).`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
