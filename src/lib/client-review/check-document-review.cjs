/* eslint-disable @typescript-eslint/no-require-imports -- Offline canonical review and token asset boundary checks. */
const fs = require("node:fs"), ts = require("typescript"), vm = require("node:vm"), Module = require("node:module"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { emptyDocument } = require("../documents/editor.ts");
const { deckHtml } = require("../documents/render-deck.ts");
const { bookHtml } = require("../documents/render-book.ts");
const { reviewDocumentAssets, reviewDocumentHtml } = require("./document.ts");
const pixel = "data:image/webp;base64,UklGRg==";
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
let deck = emptyDocument("deck", "Client chart");
deck.slides = [{ id: "chart", layout: "chart", title: "Public growth", notes: "PRIVATE SPEAKER NOTES", chart: { type: "bar", categories: ["A", "B"], series: [{ name: "Public values", values: [12, 24] }] } },
  { id: "art", layout: "image", title: "Public artwork", image: "artwork", notes: "MORE PRIVATE NOTES" }];
deck.assets = [{ name: "artwork", id: crypto.randomUUID(), aspect: "landscape", alt: "Public illustration", prompt: "PRIVATE IMAGE PROMPT" }];
deck.theme.imageStyle = "PRIVATE ART DIRECTION";
deck = require("../documents/schema.ts").DocumentSourceSchema.parse(deck);

const token = "a".repeat(43), workspace = crypto.randomUUID(), project = crypto.randomUUID(), assetId = crypto.randomUUID();
const original = new Uint8Array([1, 2, 3]), hash = crypto.createHash("sha256").update(original).digest("hex");
const baseline = { assetId, workspaceId: workspace, projectId: project, version: 4, objectPath: `${workspace}/${project}/artwork/${assetId}.webp`, contentType: "image/webp", sha256: hash };
let locator = baseline, rpcError = null, secondError = null, calls = [], downloads = 0, decoded = 0, bytes = original, oversized = false, decodeFails = false;
class RequestError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
const client = { async rpc(name, args) { calls.push({ name, args }); return { data: locator, error: calls.length === 2 && secondError ? secondError : rpcError }; }, storage: { from(bucket) { assert.equal(bucket, "project-assets"); return { async download(path) { downloads++; assert.equal(path, locator.objectPath); return { data: oversized ? { size: 101 } : new Blob([bytes]), error: null }; } }; } } };
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync("src/app/api/review/[token]/assets/[assetId]/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: mod.exports, module: mod, Response, Uint8Array, URL, require(name) {
  if (name === "node:crypto") return crypto;
  if (name === "zod") return require("zod");
  if (name.endsWith("/billing/database")) return { billingDatabase: () => client };
  if (name.endsWith("/client-review/server")) return {
    requireReviewToken(value) { if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new RequestError("NOT_FOUND", "Unavailable", 404); return value; },
    reviewDatabaseError(error) { if (error) throw new RequestError("REVIEW_UNAVAILABLE", "Unavailable", error.code === "PT409" ? 409 : 404); },
  };
  if (name.endsWith("/cloud/image-preview")) return { MAX_PREVIEW_SOURCE_BYTES: 100, async renderAssetPreview() { decoded++; if (decodeFails) throw Error("bad input"); return new Uint8Array([7, 8, 9]); } };
  if (name.endsWith("/server/http")) return { RequestError, apiError: error => Response.json({ error: { message: error.message } }, { status: error.status || 500 }) };
  throw Error(name);
} });
const get = (version = "4", id = assetId, tok = token) => mod.exports.GET(new Request(`http://localhost/api/review/${tok}/assets/${id}?version=${version}`), { params: Promise.resolve({ token: tok, assetId: id }) });
const reset = () => { locator = baseline; rpcError = secondError = null; calls = []; downloads = decoded = 0; bytes = original; oversized = decodeFails = false; };

(async () => {
  await check("canonical deck chart and artwork match owner layout; notes absent from source", () => {
    const html = reviewDocumentHtml(deck, { artwork: pixel });
    // The review frame allows only data: fonts, so it renders with explicit (here empty) font sources instead of same-origin font URLs.
    const canonical = deckHtml(deck, { artwork: pixel }, "preview", {}).replace(/<details><summary>Speaker notes<\/summary><p>[\s\S]*?<\/p><\/details>/g, "");
    assert.equal(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""), canonical);
    assert.ok(html.includes("<svg") && html.includes(pixel) && html.includes("Public growth"));
    assert.ok(!html.includes("PRIVATE") && !html.includes("Speaker notes") && !html.includes("<details>"));
    assert.ok(html.includes("script-src 'none'") && html.includes("img-src data:") && !html.includes("<script"));
    assert.equal(deck.slides[0].notes, "PRIVATE SPEAKER NOTES");
  });
  await check("canonical book cover, authored markup and artwork retain owner rendering", () => {
    const book = emptyDocument("book", "Public book"); book.assets = deck.assets; book.cover.image = "artwork";
    book.chapters = [{ id: "opening", title: "Opening", image: "artwork", text: "A **clear** opening.\n\n## A heading\n\nA paragraph." }];
    const html = reviewDocumentHtml(book, { artwork: pixel });
    assert.equal(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""), bookHtml(book, { artwork: pixel }, "preview", {}));
    assert.ok(!html.includes("/builder-runtime/fonts/"), "no font request the frame's CSP would block");
    const woff = "data:font/woff2;base64,d09GMgABAAAAAA==";
    const withFonts = reviewDocumentHtml(book, { artwork: pixel }, { "newsreader:normal": woff, "cormorant:normal": "https://external.invalid/font.woff2" });
    assert.ok(withFonts.includes(`src:url(${woff})`) && !withFonts.includes("external.invalid"), "only inline font data is embedded");
    assert.ok(html.includes('class="cover-art"') && html.includes('id="chapter-opening"') && html.includes("<strong>clear</strong>"));
    assert.equal(reviewDocumentAssets(book).length, 1);
  });
  await check("missing or external artwork fails visibly instead of showing placeholders", () => {
    assert.throws(() => reviewDocumentHtml(deck, {}), /Artwork/);
    assert.throws(() => reviewDocumentHtml(deck, { artwork: "https://external.invalid/image" }), /Artwork/);
    const invalid = structuredClone(deck); invalid.assets = [];
    assert.throws(() => reviewDocumentAssets(invalid), /missing/);
    const injected = structuredClone(deck); injected.slides[0].title = '<script>alert("secret")</script>';
    assert.ok(!reviewDocumentHtml(injected, { artwork: pixel }).includes("<script>"));
  });
  await check("valid asset uses exact token/version/id, verifies hash, returns reencoded private raster", async () => {
    reset(); const response = await get(); assert.equal(response.status, 200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7, 8, 9]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(downloads, 1); assert.equal(decoded, 1); assert.equal(calls.length, 2);
    assert.equal(calls[0].name, "makeborne_client_review_asset");
    assert.equal(calls[0].args.p_token, token); assert.equal(calls[0].args.p_version, 4); assert.equal(calls[0].args.p_asset, assetId);
  });
  await check("invalid request identifiers never authorize or read storage", async () => {
    for (const args of [["0"], ["4.5"], [""], ["4", "not-a-uuid"], ["4", assetId, "short"]]) { reset(); assert.ok((await get(...args)).status >= 400); assert.equal(downloads, 0); assert.equal(calls.length, 0); }
  });
  await check("revoked/expired/foreign and stale tokens fail before storage", async () => {
    for (const code of ["P0002", "PT409"]) { reset(); rpcError = { code }; assert.equal((await get()).status, code === "PT409" ? 409 : 404); assert.equal(downloads, 0); }
  });
  await check("locator cannot substitute another asset/version/path or active format", async () => {
    for (const patch of [{ assetId: crypto.randomUUID() }, { version: 3 }, { objectPath: "foreign/image.webp" }, { objectPath: `${workspace}/${project}/../other.webp` }, { objectPath: `${workspace}/${project}/%2e%2e/other.webp` }, { contentType: "image/svg+xml" }]) {
      reset(); locator = { ...baseline, ...patch }; assert.equal((await get()).status, 404); assert.equal(downloads, 0);
    }
  });
  await check("changed, oversized and undecodable source bytes are never served", async () => {
    reset(); bytes = new Uint8Array([9]); assert.equal((await get()).status, 409); assert.equal(decoded, 0);
    reset(); oversized = true; assert.equal((await get()).status, 413); assert.equal(decoded, 0);
    reset(); decodeFails = true; assert.equal((await get()).status, 415);
  });
  await check("revocation or version change during download discards the decoded response", async () => {
    for (const code of ["P0002", "PT409"]) { reset(); secondError = { code }; assert.equal((await get()).status, code === "PT409" ? 409 : 404); assert.equal(downloads, 1); assert.equal(decoded, 1); }
  });
  console.log(`${count} document review checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
