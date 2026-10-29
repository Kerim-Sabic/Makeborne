/* eslint-disable @typescript-eslint/no-require-imports -- Real local-stack run of the export and deletion jobs (src/lib/account-rights/jobs.ts) with fictional accounts. */
// LOCAL ISOLATED STACK ONLY. Refuses any non-loopback URL. Needs migration 20261026100000 applied.
//   MAKEBORNE_RIGHTS_STACK_URL=http://127.0.0.1:55615 MAKEBORNE_RIGHTS_STACK_KEY=<local sb_secret_...>
//   MAKEBORNE_RIGHTS_STACK_DB=supabase_db_makeborne-journey-audit node scripts/check-account-rights-local-stack.cjs
// Creates two fictional accounts, exports one, deletes it through every step, verifies storage,
// sign-in, retention and the other account, then removes everything it created.
const fs = require("node:fs"), assert = require("node:assert/strict"), { execFileSync } = require("node:child_process"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { createClient } = require("@supabase/supabase-js");
const JSZip = require("jszip");
const { runAccountExportWith, runDueAccountDeletionsWith, expireAccountExportsWith } = require("../src/lib/account-rights/jobs.ts");

const url = process.env.MAKEBORNE_RIGHTS_STACK_URL, key = process.env.MAKEBORNE_RIGHTS_STACK_KEY, container = process.env.MAKEBORNE_RIGHTS_STACK_DB;
if (!url || !key || !container) { console.error("Set MAKEBORNE_RIGHTS_STACK_URL, MAKEBORNE_RIGHTS_STACK_KEY and MAKEBORNE_RIGHTS_STACK_DB."); process.exit(2); }
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) { console.error("Refusing: local isolated stack only."); process.exit(2); }
const psql = sql => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], { input: sql, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = Date.now().toString(36);
let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
const created = { users: [], objects: [] };

async function user(label) {
  const { data, error } = await db.auth.admin.createUser({ email: `${label}-${tag}@rights-stack.invalid`, email_confirm: true, user_metadata: { name: `Fictional ${label}` } });
  if (error) throw error; created.users.push(data.user.id); return data.user.id;
}
async function put(path, text) {
  const { error } = await db.storage.from("project-assets").upload(path, Buffer.from(text), { contentType: "image/png", upsert: true });
  if (error) throw error; created.objects.push(path);
}
async function exists(bucket, path) {
  const folder = path.slice(0, path.lastIndexOf("/")), name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await db.storage.from(bucket).list(folder, { limit: 100 });
  return (data ?? []).some(item => item.name === name);
}

async function main() {
  const a = await user("owner"), b = await user("other");
  const ids = JSON.parse(psql(`select json_build_object('wa',gen_random_uuid(),'wb',gen_random_uuid(),'pa',gen_random_uuid(),'pb',gen_random_uuid(),'aa',gen_random_uuid(),'asA',gen_random_uuid(),'asA2',gen_random_uuid(),'asB',gen_random_uuid())`));
  const { wa, wb, pa, pb, aa, asA, asA2, asB } = ids;
  const pathA = `${wa}/${pa}/artwork/hero.png`, pathA2 = `${wa}/${pa}/artwork/nested/logo.png`, pathB = `${wb}/${pb}/artwork/other.png`;
  psql(`
    insert into public.workspaces(id,name,owner_id) values('${wa}','Stack owner studio','${a}'),('${wb}','Stack other studio','${b}');
    insert into public.workspace_members(workspace_id,user_id,role) values('${wb}','${a}','reviewer');
    insert into public.clients(workspace_id,name,email,notes) values('${wa}','Stack client A','client-a@rights-stack.invalid','A note'),('${wb}','Stack client B','client-b@rights-stack.invalid','B-ONLY');
    insert into public.projects(id,workspace_id,title,kind) values('${pa}','${wa}','A project','website'),('${pb}','${wb}','B project','website');
    insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${aa}','${wa}','${pa}','A site','website');
    insert into public.assets(id,workspace_id,project_id,object_path,content_type) values('${asA}','${wa}','${pa}','${pathA}','image/png'),('${asA2}','${wa}','${pa}','${pathA2}','image/png'),('${asB}','${wb}','${pb}','${pathB}','image/png');
    insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by,asset_manifest) values('${wa}','${aa}',1,'{"v":"a"}','{}','${a}',jsonb_build_array('${asA}'));
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id) values('${aa}','${wa}','${a}','rights-stack-${tag}',1,'<!doctype html><html><body>a</body></html>',true,gen_random_uuid());
    insert into public.github_connections(user_id,github_user_id,login,token_ciphertext,expires_at) values('${a}',4242,'stack-login','STACK-SECRET-CIPHER',now()+interval '1 hour');
    insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values('${a}',300,'trial','stack-${tag}',300);`);
  await put(pathA, "PNG-A"); await put(pathA2, "PNG-A2"); await put(pathB, "PNG-B");

  // ---- Export: real RPCs, real storage, signed link ----
  const { data: requested, error: requestError } = await db.rpc("makeborne_account_export_request", { p_user: a, p_key: crypto.randomUUID() });
  assert.ifError(requestError); assert.equal(requested.status, "queued");
  const built = await runAccountExportWith(db, { requestId: requested.id });
  assert.equal(built.status, "ready", JSON.stringify(built));
  const { data: path } = await db.rpc("makeborne_account_export_part", { p_user: a, p_request: requested.id, p_part: 1 });
  assert.equal(path, `${a}/${requested.id}/part-1.zip`);
  const { data: foreign } = await db.rpc("makeborne_account_export_part", { p_user: b, p_request: requested.id, p_part: 1 });
  assert.equal(foreign, null, "another account received a part");
  const { data: signed, error: signError } = await db.storage.from("account-exports").createSignedUrl(path, 120, { download: "makeborne-data-part-1.zip" });
  assert.ifError(signError);
  const token = new URL(signed.signedUrl).searchParams.get("token");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(claims.exp - claims.iat, 120, "link lifetime");
  const response = await fetch(signed.signedUrl);
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  const names = Object.keys(zip.files);
  assert.ok(names.includes(`files/${wa}/${pa}/${asA}-hero.png`) && names.includes(`files/${wa}/${pa}/${asA2}-logo.png`), "own files missing");
  assert.ok(!names.some(name => name.includes(wb)), "other workspace file leaked");
  assert.equal(await zip.file(`files/${wa}/${pa}/${asA}-hero.png`).async("string"), "PNG-A");
  const text = (await Promise.all(names.filter(n => n.endsWith(".json") || n.endsWith(".csv") || n.endsWith(".txt")).map(n => zip.file(n).async("string")))).join("\n");
  assert.match(text, /Stack client A/); assert.doesNotMatch(text, /Stack client B|B-ONLY|STACK-SECRET-CIPHER|token_ciphertext/);
  assert.match(text, /stack-login/); assert.match(text, /Fictional owner/);
  pass("export on the real stack: scoped rows and files, secrets excluded, owner-only part, 120-second signed link");

  // Expiry removes the file.
  psql(`update makeborne_private.account_export_requests set expires_at = now() - interval '1 minute' where id = '${requested.id}';`);
  assert.equal(await expireAccountExportsWith(db), 1);
  assert.equal(await exists("account-exports", path), false, "expired export file kept");
  assert.equal((await fetch(signed.signedUrl)).status >= 400, true, "issued link still serves after expiry");
  pass("export expiry removes the stored part; an issued link stops working");

  // ---- Deletion through every step ----
  const { data: scheduled } = await db.rpc("makeborne_account_deletion_request", { p_user: a, p_key: crypto.randomUUID(), p_grace_days: 7 });
  assert.equal(scheduled.status, "scheduled");
  assert.deepEqual(await runDueAccountDeletionsWith(db, async () => {}), [], "ran before the grace period ended");
  psql(`update makeborne_private.account_deletion_requests set scheduled_for = now() - interval '1 minute' where id = '${scheduled.id}';`);
  const subject = psql(`select subject_ref from makeborne_private.account_deletion_requests where id = '${scheduled.id}'`);
  const results = await runDueAccountDeletionsWith(db, async () => {});
  assert.deepEqual(results.map(r => r.status), ["completed"], JSON.stringify(results));
  const { error: gone } = await db.auth.admin.getUserById(a);
  assert.ok(gone, "sign-in record still present");
  assert.equal(await exists("project-assets", pathA), false); assert.equal(await exists("project-assets", pathA2), false, "nested object kept");
  assert.equal(await exists("project-assets", pathB), true, "another account's file removed");
  const after = JSON.parse(psql(`select json_build_object(
    'state',(select state from makeborne_private.account_deletion_requests where id='${scheduled.id}'),
    'userId',(select user_id from makeborne_private.account_deletion_requests where id='${scheduled.id}'),
    'workspace',(select count(*) from public.workspaces where id='${wa}'),
    'site',(select count(*) from public.hosted_sites where artifact_id='${aa}'),
    'github',(select count(*) from public.github_connections where github_user_id=4242),
    'retained',(select count(*) from makeborne_private.retained_account_records where subject_ref='${subject}' and source_table='credit_ledger'),
    'linked',(select count(*) from makeborne_private.retained_account_records where subject_ref='${subject}' and record::text like '%${a}%'),
    'other',(select count(*) from public.clients where workspace_id='${wb}'),
    'membership',(select count(*) from public.workspace_members where user_id='${a}'))`));
  assert.deepEqual(after, { state: "completed", userId: null, workspace: 0, site: 0, github: 0, retained: 1, linked: 0, other: 1, membership: 0 });
  assert.deepEqual(await runDueAccountDeletionsWith(db, async () => {}), [], "completed request ran again");
  pass("deletion on the real stack: grace period, sign-in removed, files removed (nested), other account untouched, pseudonymized retention, idempotent");

  console.log(`${passed}/3 local-stack account data rights checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Remove everything this run created (fictional data only): workspaces first, then the accounts.
  if (created.users.length) try { psql(`delete from public.workspaces where owner_id in (${created.users.map(id => `'${id}'`).join(",")});`); } catch { /* already gone */ }
  for (const id of created.users) await db.auth.admin.deleteUser(id).catch(() => undefined);
  if (created.objects.length) await db.storage.from("project-assets").remove(created.objects).catch(() => undefined);
});
