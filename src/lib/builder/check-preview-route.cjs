/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: preview route state, action wording, preview runtime and busy guards (no network, no paid calls). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "esbuild-wasm" && parent?.filename?.endsWith("browser-bundler.ts")) return { ...load.call(this, name, parent, main), initialize: async () => {} };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const root = path.join(__dirname, "..", "..", "..");
const route = require("./preview-route.ts");
const actions = require("./action-semantics.ts");
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }

const ROUTES = [{ path: "/", title: "Home" }, { path: "/collections", title: "Collections" }, { path: "/workshops", title: "Workshops" }];

(async () => {
  await check("path, query and fragment target parse as separate parts; invalid input never becomes a page", () => {
    assert.deepEqual(route.parsePreviewPath("/collections#ash"), { path: "/collections", query: "", target: "ash" });
    assert.deepEqual(route.parsePreviewPath("/shop/?tag=blue#top"), { path: "/shop", query: "?tag=blue", target: "top" });
    assert.deepEqual(route.parsePreviewPath("/caf%C3%A9#%C5%A1ivanje"), { path: "/caf%C3%A9", query: "", target: "šivanje" });
    for (const bad of ["", "collections", "//evil.example/x", "/a b", "/%E0%A4%A", "/x#%", "/x#a b", `/${"a".repeat(400)}`, "/x?<script>", null, 7])
      assert.equal(route.parsePreviewPath(bad), null, String(bad));
    assert.equal(route.formatPreviewPath({ path: "/collections", query: "?x=1", target: "ash glaze" }), "/collections?x=1#ash%20glaze");
  });
  await check("frame hashes: #/page is a page, #section is a target on the page already shown", () => {
    assert.deepEqual(route.parseFrameHash(""), route.HOME);
    assert.deepEqual(route.parseFrameHash("#/"), route.HOME);
    assert.deepEqual(route.parseFrameHash("#/workshops?x=1"), { path: "/workshops", query: "?x=1", target: "" });
    assert.deepEqual(route.parseFrameHash("#ash", "/collections"), { path: "/collections", query: "", target: "ash" });
    assert.equal(route.frameHashFor({ path: "/collections", query: "", target: "ash" }, ROUTES), "#/collections");
    assert.equal(route.frameHashFor(route.HOME, ROUTES), "#/");
    assert.equal(route.frameHashFor({ path: "/", query: "", target: "about" }, [{ path: "/" }]), "#about", "single-page sites keep native section anchors");
  });
  await check("missing pages are recognised only against known saved routes, with their own title", () => {
    const missing = { path: "/research-missing-route", query: "", target: "" };
    assert.equal(route.isMissingPage(missing, ROUTES), true);
    assert.equal(route.isMissingPage(missing, []), false, "unknown routes (live build) never claim a page is missing");
    assert.equal(route.isMissingPage({ path: "/collections", query: "", target: "" }, [{ path: "/collections/" }, { path: "/" }]), false);
    assert.equal(route.previewPageTitle(missing, ROUTES, "Stillform — Handmade Ceramics Studio"), "Page not found", "never the home title");
    assert.equal(route.previewPageTitle({ path: "/workshops", query: "", target: "" }, ROUTES, ""), "Workshops");
  });
  await check("the editor URL carries the page without touching its other parameters", () => {
    const href = "https://app.test/studio?tab=projects&workspace=w&artifact=a#x";
    assert.equal(route.withPreviewPathParam(href, { path: "/collections", query: "", target: "ash" }), "/studio?tab=projects&workspace=w&artifact=a&preview-path=%2Fcollections%23ash#x");
    assert.equal(route.withPreviewPathParam(`${href.replace("#x", "")}&preview-path=%2Fold`, route.HOME), "/studio?tab=projects&workspace=w&artifact=a");
  });
  await check("preview documents embed the start state safely and send nothing", () => {
    const html = route.preparePreviewDocument(`<html><head><title>x</title><script>var START=${route.PREVIEW_START_MARKER};</script></head><body></body></html>`, { hash: "#/a</script><script>alert(1)//", target: "", y: 5 });
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'">/);
    assert.doesNotMatch(html, /<\/script><script>alert/, "start state cannot close the script");
    assert.match(html, /var START=\{"hash":"#\/a\\u003c\/script>/);
  });
  await check("the preview runtime keeps navigation inside the sandbox and drafts in frame memory only", () => {
    const source = fs.readFileSync(path.join(__dirname, "browser-bundler.ts"), "utf8");
    const shim = source.slice(source.indexOf("const PREVIEW_SHIM"), source.indexOf("const CAPTURE_SHIM"));
    assert.match(shim, /var START=\$\{PREVIEW_START_MARKER\}/);
    assert.match(shim, /location\.href\.split\("#"\)\[0\]\+u/, "fragments apply to the srcdoc URL, not the editor URL");
    assert.doesNotMatch(shim, /localStorage|sessionStorage|indexedDB|document\.cookie/, "form drafts never leave frame memory");
    assert.match(shim, /password\|hidden\|file/, "passwords, hidden and file fields are never kept");
    assert.match(shim, /post\(\{type:"form-blocked"\}\)/);
    assert.doesNotMatch(shim, /\.submit\(\)|requestSubmit/, "the runtime never submits a form");
  });
  await check("a failed runtime fetch is a transport failure that Try again can recover from", async () => {
    const origin = "http://runtime.test", runtime = path.join(root, "public", "builder-runtime");
    const prepared = require("node:child_process").spawnSync(process.execPath, ["scripts/prepare-builder-runtime.mjs"], { cwd: root, encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    let failing = true;
    globalThis.location = { origin };
    globalThis.fetch = async url => {
      if (failing && String(url).includes("/vendor/react")) throw new TypeError("Failed to fetch");
      const file = String(url).startsWith(`${origin}/builder-runtime/`) ? path.join(runtime, String(url).slice(`${origin}/builder-runtime/`.length)) : "";
      return file && fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response("missing", { status: 404 });
    };
    const { bundleProject } = require("./browser-bundler.ts");
    const files = { "index.html": '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>', "src/main.tsx": 'import { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<h1>Hi</h1>);\n' };
    const lost = await bundleProject(files, {}, "preview");
    assert.equal(lost.ok, false); assert.equal(lost.kind, "transport", lost.error);
    failing = false;
    const again = await bundleProject(files, {}, "preview");
    assert.equal(again.ok, true, "the failed fetch was not cached");
    const broken = await bundleProject({ ...files, "src/main.tsx": "import x from './missing';\nconsole.log(x);" }, {}, "preview");
    assert.equal(broken.ok, false); assert.equal(broken.kind, "code", "a project error stays a build error");
  });
  await check("each recovery-type action states its own operation, version and budget effect", () => {
    const op = { id: "44444444-4444-4444-8444-444444444444", status: "paused", cancelRequested: false, canContinue: true, maximumAdditionalCredits: 20, authorizedCredits: 20, chargedCredits: 20, recoverable: false };
    assert.equal(actions.operationPhase(op).label, "Paused at its allowance");
    assert.equal(actions.operationPhase({ ...op, status: "running" }).label, "Running");
    assert.match(actions.operationPhase({ ...op, status: "running" }).detail, /Follow-ups are not queued/);
    assert.equal(actions.operationPhase({ ...op, status: "running", cancelRequested: true }).label, "Stopping");
    assert.equal(actions.operationPhase({ ...op, status: "cancelled", canContinue: false }).label, "Stopped");
    assert.match(actions.operationPhase({ ...op, status: "cancelled" }, { recovery: true }).detail, /can't be continued\. Its retained draft/);
    assert.equal(actions.operationPhase(null, { pendingCancel: true }).label, "Stop requested");
    assert.equal(actions.operationPhase(null), null);
    assert.match(actions.stopEffect(op, 3), /Stop ends request 44444444\. Confirmed usage is charged and unused credits are returned\. Version 3/);
    assert.match(actions.stopEffect(op, 3, true), /Retry Stop sends Stop again for request 44444444\. It can't start or charge anything new/);
    assert.match(actions.continueEffect(op, 3), /keeps request 44444444 and its original files, starting from version 3\. It authorizes up to 20 credits more \(new maximum 40 credits\)\. No new message is sent/);
    assert.match(actions.recoverEffect(3), /no AI call and uses no credits\. Saving adds version 4 after checking that version 3/);
    const restore = actions.restoreEffect(2, 5, true);
    for (const part of [/version 2 as new version 6/, /no AI and no credits/, /doesn't change until you publish/, /doesn't refund earlier usage/, /sent mail, received enquiries or payments/]) assert.match(restore, part);
    assert.doesNotMatch(actions.restoreEffect(2, 5), /publish/, "books and decks are not told about publishing");
    assert.match(actions.CHECK_EFFECT, /never starts, repeats or charges/);
    assert.match(actions.PREVIEW_ACTIONS.retryPreview.effect, /same saved files\. No AI call, no credits/);
    assert.match(actions.PREVIEW_ACTIONS.fixError.effect, /new AI request that uses credits/);
    const labels = ["Stop", "Retry Stop", "Approve allowance & continue", "Preview retained draft", "Save reviewed draft", "Check saved result & charge", "Restore as new version", actions.PREVIEW_ACTIONS.retryPreview.label, actions.PREVIEW_ACTIONS.fixError.label];
    assert.equal(new Set(labels).size, labels.length, "no two actions share a label");
  });
  await check("busy guards remain: no send, continue, recover or mode change while a request runs", () => {
    const builder = fs.readFileSync(path.join(root, "src/components/live-builder.tsx"), "utf8");
    const guard = "if (!text.trim() || busy || disabled || operationRunning || previewingRecovery) return;";
    assert.ok(builder.split(guard).length - 1 >= 2, "send and plan keep their busy/running guard");
    assert.match(builder, /const operationRunning = buildOperation\?\.status === "running" \|\| planner\.operation\?\.status === "running" \|\| buildPendingCancel \|\| Boolean\(planner\.pendingCancel\);/);
    assert.match(builder, /if \(!operation \|\| busy \|\| disabled \|\| authorizing\.current \|\| !operation\.canContinue \|\| operation\.kind !== "build"\) return;/, "Continue keeps its guard");
    assert.match(builder, /previewingRecovery\?\.runId !== buildRecovery\.runId \|\| previewingRecovery\.version !== version \|\| busy \|\| disabled \|\| authorizing\.current\) return;/, "recovery save keeps its version fence");
    assert.match(builder, /\(busy \|\| operationRunning\) \? <button type="button" className="lb-stop" disabled=\{cancelling \|\| operation\?\.cancelRequested === true\}/, "Stop replaces Send while running and cannot be sent twice");
    assert.match(builder, /<textarea ref=\{composer\}[^>]*disabled=\{busy \|\| preparingSources \|\| !sources\.ready \|\| sources\.busy \|\| disabled \|\| operationRunning/, "composer stays disabled while running");
    assert.match(builder, /operation\?\.kind === "build" && operation\.canContinue && operation\.status !== "running"/, "Continue is never offered for a running request");
    const studio = fs.readFileSync(path.join(root, "src/components/cloud-studio.tsx"), "utf8");
    assert.match(studio, /disabled=\{dirty \|\| busy \|\| savePaused \|\| uncertainSave \|\| conflict \|\| !!recovery\} aria-describedby=\{`restore-effect-/, "Restore keeps its draft/save guard");
  });
  console.log(`${count} preview route and action-semantics checks passed (offline).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
