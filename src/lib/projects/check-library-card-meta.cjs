/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for library card facts (publication state, client label), whole-workspace sort/client scope, URL mirroring and the per-account layout preference (audit M06 reconciliation). Mounted: scripts/check-library-previews-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const meta = require("./library-card-meta.ts");
const { clearAccountLocalData } = require("../account-local-data.ts");
const root = path.join(__dirname, "..", "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", W = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444", P1 = "55555555-5555-4555-8555-555555555555", P2 = "66666666-6666-4666-8666-666666666666";

check("publication state comes from the hosted-site row; never guessed", () => {
  assert.equal(meta.publicationState(3, null), "draft");
  assert.equal(meta.publicationState(3, { live: false, version_number: 3 }), "draft", "offline is not Live");
  assert.equal(meta.publicationState(3, { live: true, version_number: 3 }), "live");
  assert.equal(meta.publicationState(4, { live: true, version_number: 3 }), "live-behind");
  assert.equal(meta.PUBLICATION_LABEL["live-behind"], "Live · newer changes not published");
  assert.equal(meta.PUBLICATION_LABEL.draft, "Draft"); assert.equal(meta.PUBLICATION_LABEL.live, "Live");
});

check("card facts are bound to account + workspace + exact ids, and to the version the card names", () => {
  assert.notEqual(meta.cardMetaKey(A, W, [P1]), meta.cardMetaKey(B, W, [P1]));
  assert.equal(meta.cardMetaKey(A, W, [P2, P1, P1]), meta.cardMetaKey(A, W, [P1, P2]));
  assert.equal(meta.cardMetaPath(W, [P2, P1]), `/api/cloud/workspaces/${W}/artifacts/card-meta?ids=${[P1, P2].sort().join(",")}`);
  const ids = Array.from({ length: 120 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
  assert.deepEqual(meta.cardMetaChunks(ids).map(chunk => chunk.length), [50, 50, 20]);
  const item = { artifactId: P1, currentVersion: 4, client: { id: C, name: "Acme" }, publication: { state: "live", liveVersion: 4 } };
  const items = new Map([[P1, item]]);
  assert.equal(meta.cardFacts(items, { id: P1, currentVersion: 4 }), item);
  assert.equal(meta.cardFacts(items, { id: P1, currentVersion: 3 }), null, "a stale listing shows no state until Refresh");
  assert.equal(meta.cardFacts(items, { id: P2, currentVersion: 1 }), null);
  assert.equal(meta.CardMetaResponseSchema.safeParse({ workspaceId: W, items: [item] }).success, true);
  assert.equal(meta.CardMetaResponseSchema.safeParse({ workspaceId: W, items: [{ ...item, publication: { state: "maybe", liveVersion: 1 } }] }).success, false);
});

check("sort and client filter are whole-workspace listing parameters, validated server-side", () => {
  assert.equal(meta.libraryListPath(W, { sort: "saved", client: "all" }), `/api/cloud/workspaces/${W}?artifactsOffset=0`);
  assert.equal(meta.libraryListPath(W, { offset: 200, sort: "title", client: C }), `/api/cloud/workspaces/${W}?artifactsOffset=200&artifactsSort=title&artifactsClient=${C}`);
  assert.deepEqual(meta.parseLibraryScope(new URLSearchParams("artifactsSort=created&artifactsClient=none")), { sort: "created", client: "none" });
  assert.deepEqual(meta.parseLibraryScope(new URLSearchParams("")), { sort: "saved", client: "all" });
  assert.throws(() => meta.parseLibraryScope(new URLSearchParams("artifactsSort=popular")));
  assert.throws(() => meta.parseLibraryScope(new URLSearchParams("artifactsClient=acme")));
  assert.notEqual(meta.libraryScopeKey({ sort: "title", client: "all" }), meta.libraryScopeKey({ sort: "saved", client: "all" }));
});

check("the URL mirrors search, kind, client and sort; other parameters and defaults are kept clean", () => {
  const state = { q: "harbour pitch", kind: "book", client: C, sort: "title" };
  const href = meta.withLibraryQuery("/studio?tab=projects&workspace=" + W, state);
  assert.equal(href, `/studio?tab=projects&workspace=${W}&q=harbour+pitch&kind=book&client=${C}&sort=title`);
  assert.deepEqual(meta.readLibraryQuery(new URL(href, "http://x").search), state);
  assert.equal(meta.withLibraryQuery(href, meta.DEFAULT_LIBRARY_QUERY), `/studio?tab=projects&workspace=${W}`, "defaults are omitted");
  assert.equal(meta.withLibraryQuery("/studio?create=website&from=home#x", meta.DEFAULT_LIBRARY_QUERY), "/studio?create=website&from=home#x", "creation and handoff links untouched");
  assert.deepEqual(meta.readLibraryQuery("?kind=hack&client=<script>&sort=evil&q=" + "x".repeat(500)), { q: "x".repeat(200), kind: "all", client: "all", sort: "saved" });
  assert.equal(meta.withLibraryQuery("/studio", { ...meta.DEFAULT_LIBRARY_QUERY, q: "   " }), "/studio", "blank search is not stored");
});

check("the layout preference is per device and account; sign-out removes it, other accounts keep theirs", () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(meta.readLibraryView(storage, A), "grid");
  meta.writeLibraryView(storage, A, "list");
  assert.equal(meta.readLibraryView(storage, A), "list");
  assert.equal(meta.readLibraryView(storage, B), "grid", "another account on this device never inherits it");
  assert.equal(meta.readLibraryView(storage, null), "grid");
  assert.equal(meta.readLibraryView({ getItem() { throw new Error("blocked"); } }, A), "grid");
  meta.writeLibraryView(storage, B, "list");
  const keyed = { get length() { return store.size; }, key: i => [...store.keys()][i] ?? null, getItem: key => store.get(key) ?? null, removeItem: key => store.delete(key) };
  clearAccountLocalData(A, [keyed]);
  assert.deepEqual([...store.keys()], [meta.libraryViewKey(B)]);
});

check("source guards: read-only authorized card-meta route; URL updates replace history; restore on load and Back/Forward", () => {
  const route = read("src/app/api/cloud/workspaces/[workspaceId]/artifacts/card-meta/route.ts");
  assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.match(route, /const \{ client \} = await cloudContext\(workspaceId\);/);
  assert.doesNotMatch(route, /billingDatabase|service_role|SECRET/, "the caller's own session and RLS decide what exists");
  assert.match(route, /from\("hosted_sites"\)\.select\("artifact_id,live,version_number"\)/);
  assert.match(route, /return cloudJson\(\{ workspaceId, items \}\);/);
  const listing = read("src/app/api/cloud/workspaces/[workspaceId]/route.ts");
  assert.match(listing, /scope = parseLibraryScope\(search\)/);
  assert.match(listing, /artifacts\.order\(order\.column, \{ ascending: order\.ascending \}\)\.order\("id"\)\.range/);
  const studio = read("src/components/studio.tsx");
  assert.match(studio, /if \(next !== here\) window\.history\.replaceState\(window\.history\.state, "", next\);/);
  assert.equal((studio.match(/applyLibraryQuery\(window\.location\.search\);/g) ?? []).length, 2, "restored on first load and on popstate");
  assert.match(studio, /onClearSearch=\{\(\) => \{ setSearch\(""\); searchInput\.current\?\.focus\(\); \}\}/);
  const projects = read("src/components/account-projects.tsx");
  assert.match(projects, /\{searchReady\?\.total === 0 && onClearSearch && <button type="button" className="button secondary small" onClick=\{onClearSearch\}>Clear search<\/button>\}/);
  assert.match(projects, /setCardMeta\(current => shownMetaScope\.current !== requested \? current :/, "late card facts for another account/workspace are dropped");
  assert.match(projects, /facts = cardFacts\(shownMeta\.items, artifact\)/);
  assert.match(projects, /if \(previous !== null && scopeRef\.current\.client !== "all"\) setScopeRef\.current\(\{ \.\.\.scopeRef\.current, client: "all" \}\);/, "an account switch drops the client filter");
});

console.log(`${count} library card fact checks passed.`);
