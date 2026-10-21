/* eslint-disable @typescript-eslint/no-require-imports -- Offline library title search checks. */
// M05: project title search covers every saved project in the workspace (server-side, keyset pages),
// stays inside one readable workspace and titles only, and the browser never shows a response for
// another query, workspace or account, nor turns a failed search into "no matches".
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {}, URLSearchParams };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./title-search.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const s = context.exports;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const plain = value => JSON.parse(JSON.stringify(value));
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const W1 = "33333333-3333-4333-8333-333333333333", W2 = "44444444-4444-4444-8444-444444444444";
const item = (id, title = "Maple", kind = "website", createdAt = "2026-10-01T00:00:00.000Z") => ({ id, title, kind, createdAt });
const page = (items, total = items.length, nextCursor = null) => ({ artifacts: items, pagination: { total, nextCursor } });

check("a result key is the exact account, workspace, type and query", () => {
  const key = s.titleSearchKey(A, W1, "all", "  Maple   bakery ");
  assert.equal(key, s.titleSearchKey(A, W1, "all", "Maple bakery"), "spacing does not make a new search");
  for (const other of [s.titleSearchKey(B, W1, "all", "Maple bakery"), s.titleSearchKey(A, W2, "all", "Maple bakery"), s.titleSearchKey(A, W1, "book", "Maple bakery"), s.titleSearchKey(A, W1, "all", "Maple bakers")])
    assert.notEqual(key, other);
  assert.equal(s.normalizeTitleQuery("x".repeat(300)).length, 200);
});
check("the cursor is opaque, keeps microseconds and rejects tampering", () => {
  const cursor = s.encodeTitleCursor({ createdAt: "2026-01-01T01:11:00.123456+00:00", id: "AAAAAAAA-1111-4111-8111-111111111111" });
  assert.deepEqual(plain(s.decodeTitleCursor(cursor)), { createdAt: "2026-01-01T01:11:00.123456+00:00", id: "aaaaaaaa-1111-4111-8111-111111111111" });
  for (const bad of ["", "2026-01-01~not-a-uuid", `x~${A}`, `2026-01-01T00:00:00Z~${A}~extra`, `2026-01-01T00:00:00Z;drop~${A}`]) assert.equal(s.decodeTitleCursor(bad), null, bad);
  assert.throws(() => s.encodeTitleCursor({ createdAt: "yesterday", id: A }));
});
check("the server accepts only a bounded query, a known type and a valid cursor", () => {
  const parse = query => plain(s.parseTitleSearch(new URLSearchParams(query)));
  assert.deepEqual(parse("q=%20Maple%20&kind=book"), { query: "Maple", kind: "book", after: null });
  assert.deepEqual(parse("q=Maple"), { query: "Maple", kind: "all", after: null });
  const cursor = s.encodeTitleCursor({ createdAt: "2026-01-01T00:00:00.5+00:00", id: A });
  assert.deepEqual(parse(new URLSearchParams({ q: "Maple", cursor }).toString()).after, { createdAt: "2026-01-01T00:00:00.5+00:00", id: A });
  for (const bad of ["", "q=", "q=%20%20", "kind=all", "q=Maple&kind=notes", "q=Maple&cursor=bad", `q=${"x".repeat(401)}`]) assert.equal(s.parseTitleSearch(new URLSearchParams(bad)), null, bad);
  assert.match(s.titleSearchPath(W1, " Maple & Co ", "all", cursor), new RegExp(`^/api/cloud/workspaces/${W1}/artifacts\\?q=Maple\\+%26\\+Co&kind=all&cursor=`));
});
check("a response is shown only while its own key is current (older query, other workspace, previous account)", () => {
  const keyA = s.titleSearchKey(A, W1, "all", "maple"), keyNew = s.titleSearchKey(A, W1, "all", "maples");
  const keyOtherAccount = s.titleSearchKey(B, W1, "all", "maple"), keyOtherWorkspace = s.titleSearchKey(A, W2, "all", "maple");
  const idle = s.idleTitleSearch();
  for (const active of [keyNew, keyOtherAccount, keyOtherWorkspace, null])
    assert.equal(s.firstPage(idle, active, keyA, page([item("1")])), idle, "late response for another key is dropped");
  const ready = s.firstPage(idle, keyA, keyA, page([item("1")], 1));
  assert.equal(ready.status, "ready");
  assert.deepEqual(plain(s.currentMatches(ready, keyA)), [item("1")]);
  assert.deepEqual(plain(s.currentMatches(ready, keyNew)), [], "while a newer query is pending, old rows cannot be shown or opened");
  assert.deepEqual(plain(s.currentMatches(ready, keyOtherAccount)), []);
  assert.equal(s.titleSearchNotice(ready, keyNew), "searching");
  assert.equal(s.titleSearchNotice(ready, null), null, "no query, no search notice");
});
check("a failed search is an error with the loaded fallback, never no-matches; an empty result is empty", () => {
  const key = s.titleSearchKey(A, W1, "all", "maple");
  const failed = s.failedSearch(s.idleTitleSearch(), key, key, false);
  assert.equal(s.titleSearchNotice(failed, key), "error");
  assert.equal(s.failedSearch(s.idleTitleSearch(), "other", key, false).status, "idle", "a stale failure is ignored too");
  const empty = s.firstPage(s.idleTitleSearch(), key, key, page([], 0));
  assert.equal(s.titleSearchNotice(empty, key), "empty");
  assert.equal(s.titleSearchNotice({ status: "loading", key }, key), "searching");
});
check("further pages append without repeats, only onto the same key, and a failed page keeps what was found", () => {
  const key = s.titleSearchKey(A, W1, "all", "probe"), other = s.titleSearchKey(A, W1, "book", "probe");
  const first = s.firstPage(s.idleTitleSearch(), key, key, page([item("1"), item("2")], 3, "c1"));
  const second = s.nextPage(first, key, key, page([item("2"), item("3")], 3, null));
  assert.deepEqual(plain(second.items.map(entry => entry.id)), ["1", "2", "3"]);
  assert.equal(second.nextCursor, null);
  assert.equal(s.nextPage(first, other, key, page([item("9")])), first, "the type changed while the page loaded");
  assert.equal(s.nextPage(first, key, other, page([item("9")])), first);
  const failed = s.failedSearch({ ...first, more: "loading" }, key, key, true);
  assert.equal(failed.more, "error"); assert.equal(failed.items.length, 2); assert.equal(failed.nextCursor, "c1");
});
check("loaded matches use the same query, type filter and newest-created order as the server", () => {
  const items = [item("a", "Maple Bakery", "website", "2026-10-01T00:00:00.000Z"), item("b", "maple notes", "book", "2026-10-03T00:00:00.000Z"),
    item("c", "Oak", "website", "2026-10-04T00:00:00.000Z"), item("d", "MAPLE", "website", "2026-10-01T00:00:00.000Z")];
  assert.deepEqual(plain(s.loadedTitleMatches(items, " maple ", "all").map(entry => entry.id)), ["b", "d", "a"]);
  assert.deepEqual(plain(s.loadedTitleMatches(items, "maple", "website").map(entry => entry.id)), ["d", "a"]);
});

// The SQL function: one readable workspace, titles only, least privilege, stable keyset pages.
const sql = fs.readFileSync("supabase/migrations/20261020120000_artifact_title_search.sql", "utf8").replace(/\r\n/g, "\n");
const body = sql.slice(sql.indexOf("as $$"), sql.indexOf("end $$;"));
check("the migration is a security-invoker function with a fixed search path and authenticated-only execute", () => {
  assert.match(sql, /returns jsonb language plpgsql stable security invoker set search_path=''/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.makeborne_artifact_title_search\(uuid,text,text,timestamptz,uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.makeborne_artifact_title_search\(uuid,text,text,timestamptz,uuid\) to authenticated;/);
  assert.equal((sql.match(/\bgrant\b/gi) ?? []).length, 1, "no other grants");
  assert.match(sql, /^begin;$/m); assert.match(sql, /^commit;$/m);
});
check("it checks workspace access first, reads only artifact titles in that workspace and pages on (created_at, id)", () => {
  assert.match(body, /if p_workspace_id is null or not makeborne_private\.can_read\(p_workspace_id\) then\s+raise exception 'Workspace access required' using errcode='42501';/);
  assert.deepEqual([...body.matchAll(/\bfrom\s+(public\.[a-z_]+|makeborne_[a-z_]+\.[a-z_]+)/g)].map(match => match[1]), ["public.artifacts"], "no other table");
  assert.match(body, /where a\.workspace_id = p_workspace_id/);
  assert.match(body, /strpos\(lower\(a\.title\), needle\) > 0/, "literal substring on the title only");
  assert.doesNotMatch(body, /brief|notes|content|ilike|like\b/i);
  assert.match(body, /\(m\.created_at, m\.id\) < \(p_after_created_at, p_after_id\)/);
  assert.match(body, /order by m\.created_at desc, m\.id desc\s+limit 51/);
  assert.match(body, /length\(needle\) not between 1 and 200/);
});

const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
check("the route authorizes the workspace before searching and maps only card fields", () => {
  const route = read("src/app/api/cloud/workspaces/[workspaceId]/artifacts/route.ts");
  assert.ok(route.indexOf("await cloudContext(workspaceId)") > 0 && route.indexOf("await cloudContext(workspaceId)") < route.indexOf('client.rpc("makeborne_artifact_title_search"'));
  assert.doesNotMatch(route, /\.from\(|createAdminClient|service_role|SECRET/i, "user-scoped client and the RPC only");
  assert.match(route, /artifacts: result\.artifacts\.map\(mapArtifact\)/);
  assert.match(route, /if \(error\?\.code === "42501"\) throw new RequestError\("NOT_FOUND"/);
  const api = read("src/components/cloud-api.ts");
  assert.match(api, /\/\^\\\/api\\\/cloud\\\/workspaces\\\/\[a-f0-9-\]\+\\\/artifacts\$\/\.test\(base\) && method === "GET"/);
});
check("the library uses server results for a query, keyed and stale-guarded, with honest scope text", () => {
  const projects = read("src/components/account-projects.tsx");
  assert.match(projects, /const searchKey = accountId && searchWorkspace && query \? titleSearchKey\(accountId, searchWorkspace, filter, query\) : null;/);
  assert.match(projects, /firstPage\(current, shownSearch\.current, key, page\)/);
  assert.match(projects, /nextPage\(current, shownSearch\.current, key, page\)/);
  assert.match(projects, /failedSearch\(current, shownSearch\.current, key, false\)/);
  assert.match(projects, /shownSearch\.current = searchKey;/);
  assert.match(projects, /\{!query && snapshot\?\.pagination\.artifacts\.nextOffset != null && <button/, "browsing Load more is not offered as search scope");
  assert.match(projects, /We couldn’t search all saved projects\. Showing title matches among the/);
  assert.match(projects, /Briefs, notes and project content aren’t searched\./);
  assert.doesNotMatch(projects, /Search applies to loaded account projects/);
  // Existing guards stay.
  assert.match(projects, /version !== requestVersion\.current/);
  assert.match(projects, /currentAccount\.current !== next/);
});

console.log(`${count} title search checks passed.`);
