/* eslint-disable @typescript-eslint/no-require-imports -- Offline M17 asset-read boundary: the real helper with a mocked
   caller client and server reader, plus a source scan of every project-assets read and URL minting call. */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const file = path.join(root, "src/lib/cloud/asset-storage.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const mod = {exports: {}};
vm.runInNewContext(compiled, {module: mod, exports: mod.exports, Error, Promise, Array, require(name) {
  if (name === "server-only") return {};
  throw new Error(`Unexpected dependency at load: ${name}`);
}}, {filename: file});
const {downloadProjectAsset, readPendingUpload} = mod.exports;

const ws = "11111111-1111-4111-8111-111111111111", project = "22222222-2222-4222-8222-222222222222";
const objectPath = `${ws}/${project}/artwork/33333333-3333-4333-8333-333333333333.webp`;
function caller(rows, error = null) {
  const calls = [];
  return {calls, from(table) {
    const query = {select(columns) {calls.push(["select", table, columns]); return query;}, eq(key, value) {calls.push(["eq", key, value]); return query;},
      async limit(n) {calls.push(["limit", n]); return {data: rows, error};}};
    return query;
  }, storage: {from() {throw new Error("caller storage must never be used");}}};
}
function reader() {
  const reads = [];
  const read = async (p, init) => {reads.push([p, init]); return {data: new Blob([new Uint8Array([1, 2, 3])]), error: null};};
  return {reads, read};
}
let passed = 0;
const pass = name => {passed++; console.log(`PASS ${name}`);};

(async () => {
  {
    const client = caller([{id: "a"}]), r = reader();
    const result = await downloadProjectAsset(client, {workspaceId: ws, projectId: project}, objectPath, {cache: "no-store"}, r.read);
    assert.equal(result.error, null); assert.equal(r.reads.length, 1); assert.deepEqual(r.reads[0], [objectPath, {cache: "no-store"}]);
    assert.deepEqual(client.calls.filter(c => c[0] === "eq"), [["eq", "workspace_id", ws], ["eq", "object_path", objectPath], ["eq", "project_id", project]]);
    assert.deepEqual(client.calls[0], ["select", "assets", "id"]);
    pass("caller RLS must see the registered asset (workspace, exact path, project) before the server reads bytes");
  }
  for (const [label, rows, error] of [["no visible row (removed member, other tenant, signed out)", [], null], ["RLS error", null, {code: "42501"}], ["ambiguous rows", [{id: "a"}, {id: "b"}], null]]) {
    const r = reader(); const result = await downloadProjectAsset(caller(rows, error), {workspaceId: ws}, objectPath, undefined, r.read);
    assert.equal(result.data, null); assert.equal(r.reads.length, 0);
    pass(`${label}: no server read`);
  }
  for (const bad of [`${ws}x/${project}/a.webp`, `other/${ws}/a.webp`, `${ws}/../x/a.webp`, `${ws}//a.webp`, `${ws}/a%2e.webp`, `${ws}/a.webp?x`, `${ws}/a\\b.webp`, `${ws}/a\u0000.webp`, `${ws}/${"a".repeat(1100)}`]) {
    const client = caller([{id: "a"}]), r = reader();
    const result = await downloadProjectAsset(client, {workspaceId: ws}, bad, undefined, r.read);
    assert.equal(result.data, null); assert.equal(r.reads.length, 0); assert.equal(client.calls.length, 0);
  }
  pass("foreign-prefix, traversal, encoded, query, control and oversized paths refused before any query");
  {
    const r = reader();
    assert.equal((await readPendingUpload({workspaceId: ws, projectId: project}, objectPath, r.read)).error, null);
    assert.equal((await readPendingUpload({workspaceId: ws, projectId: project}, `${ws}/${project}/other/a.webp`, r.read)).data, null);
    assert.equal((await readPendingUpload({workspaceId: ws, projectId: "44444444-4444-4444-8444-444444444444"}, objectPath, r.read)).data, null);
    assert.equal(r.reads.length, 1);
    pass("pending-upload re-read is limited to this project's artwork prefix");
  }

  // Source scan: every project-assets read in app code is either this helper or a
  // server-key read after a token/grant RPC; nothing mints storage URLs.
  const allowed = new Set(["src/lib/cloud/asset-storage.ts", "src/app/api/review/[token]/assets/[assetId]/route.ts", "src/app/api/portal/sites/[artifactId]/images/[assetId]/route.ts",
    // Account data export: server-key read of paths returned by the owner-scoped export rows RPC.
    "src/lib/account-rights/jobs.ts"]);
  // The only minted URL: a 120-second link to the requester's own export part in the private account-exports bucket.
  const allowedMinting = new Set(["src/lib/account-rights/server.ts"]);
  const offenders = [], minting = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      const text = fs.readFileSync(full, "utf8");
      if (/storage\s*\.\s*from\(\s*["']project-assets["']\s*\)\s*\.\s*download\(/.test(text) && !allowed.has(rel)) offenders.push(rel);
      if (/\.(createSignedUrl|createSignedUrls|getPublicUrl)\(/.test(text) && !allowedMinting.has(rel)) minting.push(rel);
    }
  })(path.join(root, "src"));
  assert.deepEqual(offenders, [], `project-assets downloads outside the helper: ${offenders.join(", ")}`);
  assert.deepEqual(minting, [], `storage URL minting found: ${minting.join(", ")}`);
  {
    const rights = fs.readFileSync(path.join(root, "src/lib/account-rights/server.ts"), "utf8"), jobs = fs.readFileSync(path.join(root, "src/lib/account-rights/jobs.ts"), "utf8");
    assert.equal((rights.match(/createSignedUrl\(/g) ?? []).length, 1);
    assert.match(rights, /storage\.from\(EXPORT_BUCKET\)\.createSignedUrl\(path, EXPORT_LINK_SECONDS/);
    assert.match(rights, /if \(!path \|\| !path\.startsWith\(`\$\{userId\}\/\$\{requestId\}\/`\)\) return null;/);
    assert.match(jobs, /export const EXPORT_BUCKET = "account-exports";/);
    assert.doesNotMatch(rights + jobs, /getPublicUrl|createSignedUrls|from\("project-assets"\)\.createSignedUrl/);
    pass("account export: one owner-bound 120-second link to the private export bucket; project files are only read server-side");
  }
  for (const rel of ["src/app/api/review/[token]/assets/[assetId]/route.ts", "src/app/api/portal/sites/[artifactId]/images/[assetId]/route.ts"]) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.ok(text.indexOf(".rpc(") > -1 && text.indexOf(".rpc(") < text.indexOf('.download('), `${rel} authorises before reading`);
  }
  pass("no route reads project-assets with a browser session or mints signed/public URLs; token and portal reads authorise first");

  // Migration: the browser read policy is dropped and nothing later recreates a storage SELECT policy.
  const dir = path.join(root, "supabase/migrations"), files = fs.readdirSync(dir).filter(name => name.endsWith(".sql")).sort();
  const drop = files.indexOf("20261020203000_scope_revocation_boundaries.sql");
  assert.ok(drop > -1 && /drop policy if exists project_assets_read on storage\.objects/.test(fs.readFileSync(path.join(dir, files[drop]), "utf8")));
  for (const later of files.slice(drop + 1)) assert.ok(!/create policy[^;]*on storage\.objects[^;]*for (select|all)/is.test(fs.readFileSync(path.join(dir, later), "utf8")), `${later} re-opens storage reads`);
  pass("migration drops the member read policy on project-assets and no later migration re-opens it");
  console.log(`${passed} asset-storage boundary checks passed (offline; live storage behaviour is qualified by supabase/check-scope-matrix.sql).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
