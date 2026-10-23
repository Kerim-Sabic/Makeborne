/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for preview image loading (preview-assets.ts): classification, bounded retry, cache, abort and the image-vs-code error split. Mounted: scripts/check-preview-assets-browser.cjs. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const assets = require("./preview-assets.ts");
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`PASS ${name}`); };
const failure = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), status === null ? extra : { status, ...extra });
const NO_WAIT = [0, 0];
const DOG = { id: "a1", path: "src/artwork/coastal-dog.webp" }, SKY = { id: "a2", path: "public/sky.webp" };

(async () => {
  await check("failures are classified by what happened, not lumped together", () => {
    assert.equal(assets.classifyAssetFailure(failure(404)), "missing");
    assert.equal(assets.classifyAssetFailure(failure(410)), "missing");
    assert.equal(assets.classifyAssetFailure(failure(401)), "denied");
    assert.equal(assets.classifyAssetFailure(failure(403)), "denied");
    for (const status of [408, 429, 500, 502, 503]) assert.equal(assets.classifyAssetFailure(failure(status)), "unavailable", String(status));
    assert.equal(assets.classifyAssetFailure(new TypeError("Failed to fetch")), "unavailable", "no answer at all is a passing failure");
    assert.equal(assets.classifyAssetFailure(failure(200, { invalid: true })), "invalid");
    assert.deepEqual(["missing", "denied", "unavailable", "invalid"].map(assets.retryable), [false, false, true, false]);
  });

  await check("a passing failure is retried within the bound and then loads; the import key keeps the saved path", async () => {
    let calls = 0;
    const result = await assets.loadPreviewAssets([DOG], async () => { calls++; if (calls < 3) throw failure(503); return "data:image/webp;base64,AAA"; }, { signal: new AbortController().signal, delays: NO_WAIT });
    assert.equal(calls, 3);
    assert.deepEqual(result, { images: { "/src/artwork/coastal-dog.webp": "data:image/webp;base64,AAA" }, problems: [] });
    assert.equal(assets.previewAssetKey("public/sky.webp"), "/sky.webp", "public/ is served from the site root");
  });

  await check("retries stop at the bound and say why; missing and denied images are never retried", async () => {
    const calls = { a1: 0, a2: 0, a3: 0 };
    const result = await assets.loadPreviewAssets([DOG, SKY, { id: "a3", path: "src/logo.webp" }], async asset => {
      calls[asset.id]++;
      throw asset.id === "a1" ? new TypeError("Failed to fetch") : asset.id === "a2" ? failure(404) : failure(403);
    }, { signal: new AbortController().signal, delays: NO_WAIT });
    assert.deepEqual(calls, { a1: 3, a2: 1, a3: 1 });
    assert.deepEqual(result.problems, [{ path: DOG.path, reason: "unavailable" }, { path: SKY.path, reason: "missing" }, { path: "src/logo.webp", reason: "denied" }]);
    assert.deepEqual(result.images, {}, "nothing is invented in place of an image");
  });

  await check("a cached image is not fetched again (warm open)", async () => {
    const cache = new Map([["a1", "data:cached"]]);
    let calls = 0;
    const result = await assets.loadPreviewAssets([DOG], async () => { calls++; return "data:new"; }, { signal: new AbortController().signal, cache, delays: NO_WAIT });
    assert.equal(calls, 0);
    assert.equal(result.images["/src/artwork/coastal-dog.webp"], "data:cached");
    await assets.loadPreviewAssets([SKY], async () => "data:sky", { signal: new AbortController().signal, cache, delays: NO_WAIT });
    assert.equal(cache.get("a2"), "data:sky", "a loaded image joins the cache");
  });

  await check("an aborted (superseded) load never reports a result, even while waiting to retry", async () => {
    const controller = new AbortController();
    const pending = assets.loadPreviewAssets([DOG], async () => { throw failure(503); }, { signal: controller.signal, delays: [60_000, 60_000] });
    setTimeout(() => controller.abort(new Error("superseded")), 20);
    await assert.rejects(pending, /superseded/);
    const early = new AbortController(); early.abort(new Error("gone"));
    await assert.rejects(assets.loadPreviewAssets([DOG], async () => "data:x", { signal: early.signal }), /gone/);
  });

  await check("a compile failure is an image problem only when it names an image that could not be loaded", () => {
    const error = 'src/main.tsx:5: Cannot find "./artwork/coastal-dog.webp" imported from src/main.tsx';
    assert.equal(assets.compileBlockedByAssets(error, [{ path: DOG.path, reason: "unavailable" }]), true);
    assert.equal(assets.compileBlockedByAssets(error, []), false, "with every image loaded, Cannot find is a real code error");
    assert.equal(assets.compileBlockedByAssets('src/App.tsx:3: Expected ";"', [{ path: DOG.path, reason: "unavailable" }]), false, "an unrelated syntax error stays a build error");
    assert.equal(assets.describeAssetProblem({ path: DOG.path, reason: "unavailable" }), "artwork/coastal-dog.webp couldn't be loaded (connection problem)");
    assert.equal(assets.describeAssetProblem({ path: SKY.path, reason: "missing" }), "sky.webp isn't in this project's saved images");
  });

  await check("source guards: the preview compiles only once this exact image load has finished, and readCloudImage keeps the status", () => {
    const preview = fs.readFileSync(require.resolve("../../components/live-preview.tsx"), "utf8");
    assert.match(preview, /const loadKey = `\$\{scope\.accountId\}\|\$\{scope\.workspaceId\}\|\$\{scope\.artifactId\}\|\$\{assetKey\}\|\$\{imageAttempt\}`;/);
    assert.match(preview, /const assetsReady = !originals\.length \|\| assetLoad\.key === loadKey;/);
    assert.match(preview, /if \(!assetsReady\) return;\s*let cancelled = false;/, "no compile before the images for this identity are known");
    const api = fs.readFileSync(require.resolve("../../components/cloud-api.ts"), "utf8");
    assert.match(api, /\{ status: response\.status \}\);/);
  });
  console.log(`${count} preview asset checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
