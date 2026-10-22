/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for library card previews (audit M06): version-bound keying, late-response rejection, fallbacks, cache scope/retention, bounded concurrency, script-free renderers and source guards. The mounted journey is scripts/check-library-previews-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const card = require("./card-preview.ts");
const render = require("../documents/render-card.ts");
const { emptyDocument } = require("../documents/editor.ts");
const { DeckSchema, BookSchema } = require("../documents/schema.ts");

const root = path.join(__dirname, "..", "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let count = 0;
const pending = [];
const check = (name, fn) => pending.push([name, fn]);

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const W1 = "33333333-3333-4333-8333-333333333333", W2 = "44444444-4444-4444-8444-444444444444";
const P1 = "55555555-5555-4555-8555-555555555555", P2 = "66666666-6666-4666-8666-666666666666";
const V3 = "77777777-7777-4777-8777-777777777777", V4 = "88888888-8888-4888-8888-888888888888";
const hash = c => c.repeat(64);
const request = (extra = {}) => ({ accountId: A, workspaceId: W1, artifactId: P1, versionNumber: 4, ...extra });
const preview = (extra = {}) => ({ workspaceId: W1, artifactId: P1, kind: "presentation", versionNumber: 4, versionId: V4, fingerprint: hash("b"), source: { format: "unavailable", reason: "unsupported" }, ...extra });

function deckFixture() {
  const base = emptyDocument("deck", "Fixture deck");
  return DeckSchema.parse({ ...base, slides: [
    { id: "s1", layout: "cover", title: "Opening slide title", notes: "Say hello." },
    { id: "s2", layout: "statement", title: "SECOND-SLIDE-ONLY", notes: "Then this." },
  ] });
}
function bookFixture() {
  const base = emptyDocument("book", "Fixture book");
  return BookSchema.parse({ ...base, subtitle: "A cover subtitle", chapters: [{ id: "c1", title: "Chapter heading", text: "CHAPTER-BODY-SECRET ".repeat(50) }] });
}
const style = { id: "s", name: "Style", version: 1, typography: { headingFont: "Georgia", bodyFont: "Arial" }, colors: { canvas: "#FFFFFF", ink: "#111111", accent: "#7862A7" }, description: "", referenceAssetIds: [] };
const block = (id, type, text, assetId = null) => ({ id, type, text, assetId, locked: false, sourceIds: [] });

check("a card's key names account, workspace, project and version", () => {
  const keys = new Set([request(), request({ accountId: B }), request({ workspaceId: W2 }), request({ artifactId: P2 }), request({ versionNumber: 3 })].map(card.cardRequestKey));
  assert.equal(keys.size, 5);
  assert.equal(card.cardRequestKey(request()), card.cardRequestKey(request()));
  assert.equal(card.cardPreviewPath(request()), `/api/cloud/workspaces/${W1}/artifacts/${P1}/card-preview?version=4`);
  assert.equal(card.cardPreviewPath(request(), "source"), `/api/cloud/workspaces/${W1}/artifacts/${P1}/card-preview?version=4&include=source`);
});

check("only the exact requested version is accepted; an older or another project's answer never is", () => {
  assert.equal(card.acceptCardPreview(request(), preview()), true);
  assert.equal(card.acceptCardPreview(request(), preview({ versionNumber: 3, versionId: V3 })), false, "version 3 is never shown on a version-4 card");
  assert.equal(card.acceptCardPreview(request({ versionNumber: 3 }), preview()), false, "version 4 is never shown on a version-3 card");
  assert.equal(card.acceptCardPreview(request(), preview({ workspaceId: W2 })), false);
  assert.equal(card.acceptCardPreview(request(), preview({ artifactId: P2 })), false);
  assert.equal(card.acceptCardPreview(request(), preview({ versionId: null })), false, "a saved version always carries its immutable id");
  assert.equal(card.acceptCardPreview(request(), preview({ fingerprint: null })), false);
  assert.equal(card.acceptCardPreview(request({ versionNumber: 0 }), preview({ versionNumber: 0, versionId: null, fingerprint: null })), true);
  assert.notEqual(card.cardFrameKey("k", { versionId: V3, fingerprint: hash("a") }), card.cardFrameKey("k", { versionId: V4, fingerprint: hash("a") }));
});

check("a late answer only settles the key it was requested for", () => {
  const k3 = card.cardRequestKey(request({ versionNumber: 3 })), k4 = card.cardRequestKey(request());
  const late = { status: "ready", key: k3, frameKey: "f3", html: "<p>v3</p>", canvas: "deck", sandbox: "allow-same-origin", versionNumber: 3 };
  const current = { status: "loading", key: k4 };
  assert.equal(card.settleCardPreview(current, k4, late), current, "version 3 arriving after the card moved to version 4 is dropped");
  assert.equal(card.settleCardPreview({ status: "loading", key: k3 }, k4, late).status, "loading", "the shown key decides, not the stored one");
  const fresh = { ...late, key: k4, versionNumber: 4 };
  assert.equal(card.settleCardPreview(current, k4, fresh), fresh);
});

check("every state has an honest label naming the depicted version", () => {
  const key = "k";
  const ready = card.cardPreviewText({ status: "ready", key, frameKey: "f", html: "x", canvas: "deck", sandbox: "allow-same-origin", versionNumber: 4 }, "presentation", 4);
  assert.equal(ready.caption, null);
  assert.match(ready.description, /^Preview shows Version 4, first slide\.$/);
  assert.match(card.cardPreviewText({ status: "ready", key, frameKey: "f", html: "x", canvas: "book", sandbox: "allow-same-origin", versionNumber: 2 }, "book", 2).description, /Version 2, cover/);
  assert.match(card.cardPreviewText({ status: "ready", key, frameKey: "f", html: "x", canvas: "website", sandbox: "", versionNumber: 7 }, "website", 7).description, /Version 7, top of the home page/);
  assert.match(card.cardPreviewText({ status: "loading", key }, "book", 2).description, /Version 2 loading/);
  for (const reason of ["no-version", "not-captured", "too-large", "unsupported", "failed", "unavailable"]) {
    const text = card.cardPreviewText({ status: "fallback", key, reason, versionNumber: 5 }, "website", 5);
    assert.ok(text.caption && text.caption.length <= 24, `${reason} has a short visible caption`);
    assert.ok(text.description.startsWith("No preview") || text.description.includes("couldn’t load"), `${reason} never claims a preview exists`);
  }
  assert.match(card.cardPreviewText({ status: "fallback", key, reason: "unavailable", versionNumber: 5 }, "website", 5).description, /unavailable to your account/);
});

check("the cache is one account + workspace; switching drops everything; deleted projects are dropped", () => {
  const cache = card.createCardPreviewCache(3);
  const kA = card.cardRequestKey(request()), kB = card.cardRequestKey(request({ accountId: B })), kW2 = card.cardRequestKey(request({ workspaceId: W2 }));
  assert.equal(cache.set(kA, "a"), false, "nothing is cached before a scope exists");
  cache.setScope(card.cardScopeKey(A, W1));
  assert.equal(cache.set(kA, "a"), true);
  assert.equal(cache.set(kB, "b"), false, "another account's key is refused");
  assert.equal(cache.set(kW2, "w"), false, "another workspace's key is refused");
  assert.equal(cache.get(kA), "a");
  cache.setScope(card.cardScopeKey(B, W1));
  assert.equal(cache.size, 0, "account switch empties the cache");
  assert.equal(cache.get(kA), undefined);
  cache.setScope(card.cardScopeKey(A, W1));
  assert.equal(cache.get(kA), undefined, "switching back does not resurrect account A's previews");
  cache.set(kA, "a"); cache.set(card.cardRequestKey(request({ artifactId: P2 })), "p2");
  cache.retain(new Set([P2]));
  assert.equal(cache.get(kA), undefined, "a project no longer listed loses its preview");
  assert.equal(cache.get(card.cardRequestKey(request({ artifactId: P2 }))), "p2");
  for (let i = 0; i < 5; i++) cache.set(card.cardRequestKey(request({ versionNumber: 10 + i })), i);
  assert.equal(cache.size, 3, "bounded");
  cache.clear();
  assert.equal(cache.size, 0); assert.equal(cache.scope, null);
});

check("bounded concurrency; queued work that is aborted never starts", async () => {
  const limiter = card.createLimiter(2), started = [], release = [];
  const task = name => () => new Promise(resolve => { started.push(name); release.push(resolve); });
  const controllers = [0, 1, 2, 3].map(() => new AbortController());
  const runs = controllers.map((controller, index) => limiter.run(task(index), controller.signal).catch(error => `aborted:${error.name}`));
  assert.deepEqual(started, [0, 1]); assert.equal(limiter.active, 2); assert.equal(limiter.queued, 2);
  controllers[2].abort();
  release.shift()("done0");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(started, [0, 1, 3], "the aborted queued task is skipped");
  release.shift()("done1"); release.shift()("done3");
  assert.deepEqual(await Promise.all(runs), ["done0", "done1", "aborted:AbortError", "done3"]);
  const gone = new AbortController(); gone.abort();
  await assert.rejects(limiter.run(() => Promise.resolve(1), gone.signal));
});

check("the server sends only the bounded part a card needs", () => {
  const deck = deckFixture(), book = bookFixture();
  const deckSource = card.cardPreviewSource({ schemaVersion: 1, kind: "presentation", title: "Deck", sections: [], document: deck }, style);
  assert.equal(deckSource.format, "deck"); assert.equal(deckSource.deck.slides.length, 2, "the opening slide is composed with its deck");
  const bookSource = card.cardPreviewSource({ schemaVersion: 1, kind: "book", title: "Book", sections: [], document: book }, style);
  assert.equal(bookSource.format, "book"); assert.equal(bookSource.chapterCount, 1);
  assert.doesNotMatch(JSON.stringify(bookSource), /CHAPTER-BODY-SECRET/, "chapter text never reaches a card");
  const long = "x".repeat(5000);
  const outline = card.cardPreviewSource({ schemaVersion: 1, kind: "website", title: "Site", sections: [{ id: "a", title: "Intro", blocks: Array.from({ length: 20 }, (_, i) => block(`b${i}`, "paragraph", long)) }] }, style);
  assert.equal(outline.format, "outline"); assert.ok(outline.outline.blocks.length <= card.CARD_LIMITS.outlineBlocks);
  assert.ok(outline.outline.blocks.every(item => item.text.length <= card.CARD_LIMITS.blockText + 1));
  const slides = card.cardPreviewSource({ schemaVersion: 1, kind: "presentation", title: "Talk", sections: [{ id: "s1", title: "First", blocks: [block("p", "paragraph", "Hello")] }, { id: "s2", title: "Second", blocks: [block("q", "paragraph", "Later")] }] }, style);
  assert.equal(slides.outline.slide.title, "First"); assert.equal(slides.outline.slideCount >= 2, true);
  const source = { files: [{ path: "src/App.tsx", content: "export default () => null" }], assets: [], routes: [] };
  assert.deepEqual(card.cardPreviewSource({ schemaVersion: 1, kind: "website", title: "Src", sections: [], websiteSource: source }, style), { format: "website-source" });
  for (const value of [deckSource, bookSource, outline, slides]) assert.equal(card.CardPreviewSourceSchema.safeParse(value).success, true, `${value.format} validates on the client`);
  assert.equal(card.CardPreviewSourceSchema.safeParse({ format: "website-snapshot", html: "x".repeat(card.CARD_LIMITS.cardHtmlBytes + 1) }).success, false, "oversized HTML is refused");
  assert.equal(card.websiteCaptureFits(source), true);
  assert.equal(card.websiteCaptureFits({ ...source, files: [{ path: "a", content: "x".repeat(card.CARD_LIMITS.captureSourceBytes + 1) }] }), false);
  assert.equal(card.websiteCaptureFits({ ...source, assets: Array.from({ length: 25 }, () => ({})) }), false);
});

check("card documents are script-free with a CSP first; only the opening slide or cover is painted", () => {
  const csp = /^<!doctype html><html[^>]*><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">/;
  const deckHtml = render.deckCardHtml(deckFixture(), {});
  assert.match(deckHtml, csp);
  assert.match(deckHtml, /Opening slide title/); assert.doesNotMatch(deckHtml, /SECOND-SLIDE-ONLY/);
  assert.equal((deckHtml.match(/<section class="slide"/g) ?? []).length, 1);
  const bookHtml = render.bookCardHtml(bookFixture(), {});
  assert.match(bookHtml, csp); assert.match(bookHtml, /Fixture book/); assert.doesNotMatch(bookHtml, /CHAPTER-BODY-SECRET/);
  const hostile = { kind: "website", title: "<script>alert(1)</script>", palette: { canvas: "#fff\"><script>", ink: "#000", accent: "#123456", heading: "Georgia", body: "Arial" }, blocks: [{ id: "b", type: "paragraph", text: "<img src=x onerror=alert(1)>", assetId: null }] };
  const outlineHtml = render.outlineCardHtml(hostile, {});
  assert.match(outlineHtml, csp);
  assert.doesNotMatch(outlineHtml, /<script|<img src=x/i, "outline text is escaped");
  for (const html of [deckHtml, bookHtml, outlineHtml]) assert.doesNotMatch(html, /<script(?![^>]*application\/ld\+json)/i);
  const slideHtml = render.outlineCardHtml({ ...hostile, kind: "presentation", title: "Talk", slide: { title: "Slide one", blocks: [{ id: "p", type: "paragraph", text: "Body", assetId: null }] }, slideCount: 3 }, {});
  assert.match(slideHtml, /Slide one/); assert.match(slideHtml, /ap-native-slide/);
  assert.match(render.withCardCsp("<!doctype html><html><head><title>x</title></head><body></body></html>"), /<head><meta http-equiv="Content-Security-Policy"/);
  assert.deepEqual(render.deckCardImages({ ...deckFixture(), slides: [] }), []);
});

check("source guards: sandboxed, non-focusable frames; no persistent cache; no signed URLs; authorized private route", () => {
  const component = read("src/components/library-card-preview.tsx"), store = read("src/components/card-preview-store.ts"), api = read("src/components/card-preview-api.ts");
  const route = read("src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/card-preview/route.ts"), projects = read("src/components/account-projects.tsx");
  const migration = read("supabase/migrations/20261020210000_artifact_card_previews.sql");
  assert.match(component, /<iframe key=\{current\.frameKey\} className=\{`library-card-frame \$\{current\.canvas\}`\} title="" tabIndex=\{-1\} aria-hidden="true"\s+sandbox=\{current\.sandbox\} referrerPolicy="no-referrer" srcDoc=\{current\.html\}/);
  assert.match(component, /className=\{`library-card-thumb \$\{artifact\.kind\} \$\{current\.status\}`\} aria-hidden="true"/);
  assert.match(component, /<span id=\{descriptionId\} hidden>\{text\.description\}<\/span>/);
  assert.doesNotMatch(component + store, /allow-scripts|allow-forms|allow-popups|allow-top-navigation/, "card frames never run scripts");
  assert.match(store, /"deck", "allow-same-origin"\)/); assert.match(store, /return ready\(key, preview, source\.html, "website", ""\);/, "website HTML is fully sandboxed");
  for (const source of [component, store, api]) assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]|caches\.open/, "no persistent client cache");
  for (const source of [component, store, api, route, migration]) assert.doesNotMatch(source, /createSignedUrl|signedUrl|getPublicUrl|token=/i, "no signed or public URL is created, stored or cached");
  assert.match(api, /"X-Makeborne-Account": request\.accountId/); assert.match(api, /cache: "no-store"/); assert.match(api, /assertAccount\(\);/);
  assert.match(route, /await cloudContext\(workspaceId\)/); assert.doesNotMatch(route, /new Response\(|Response\.json\(/, "every answer goes through cloudJson/cloudError (private, no-store)");
  assert.match(route, /if \(workspace!\.role === "reviewer"\) throw new RequestError\("ACCESS_DENIED"/);
  assert.match(route, /renderHostedSnapshot\(body\.snapshot!/, "captures are sanitized by the publishing sanitizer before storage");
  assert.match(projects, /currentAccount\.current = next; requestVersion\.current\+\+;\r?\n\s+\/\/ Another account[^\n]*\r?\n\s+clearCardPreviews\(\);/);
  assert.match(projects, /setCardPreviewScope\(accountId, snapshot\?\.workspace\.id \?\? null\);/);
  assert.match(projects, /if \(snapshot\) retainCardPreviews\(snapshot\.artifacts\.map\(artifact => artifact\.id\)\);/);
  assert.match(projects, /useEffect\(\(\) => \(\) => clearCardPreviews\(\), \[\]\);/);
  assert.match(projects, /if \(!append\) \{ clearCardPreviews\(\);/);
  assert.match(projects, /<a className="account-project-link" href=\{projectHref\(inWorkspace, artifact\.id\)\} aria-describedby=\{described\}/);
  assert.match(migration, /revoke all on public\.artifact_card_previews from public, anon, authenticated, service_role;/);
  assert.match(migration, /revoke all on function public\.makeborne_save_artifact_card_preview\([^)]*\) from public, anon, authenticated;/);
  assert.doesNotMatch(migration, /grant [^;]* to (anon|authenticated)/i);
  assert.match(migration, /references public\.artifacts\(id, workspace_id\) on delete cascade/);
  assert.match(migration, /references public\.artifact_versions\(id, artifact_id, workspace_id\) on delete cascade/);
  assert.match(migration, /if v_number is distinct from a\.current_version then raise exception 'A newer version was saved' using errcode = 'PT409'/);
  assert.match(migration, /delete from public\.artifact_card_previews where artifact_id = p_artifact and version_id <> p_version;/);
});

(async () => {
  for (const [name, fn] of pending) { await fn(); count++; console.log(`PASS ${name}`); }
  console.log(`${count} library card preview checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
