// Applies supabase/migrations/20261027090000_launch_waitlist.sql to a fresh, in-memory Postgres (PGlite, WebAssembly; no
// Docker, network or real database) with Supabase's roles stubbed, then checks behaviour and the permission boundary.
// Run: MAKEBORNE_PGLITE=<path to an installed @electric-sql/pglite package> node scripts/check-launch-waitlist-sql.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modulePath = process.env.MAKEBORNE_PGLITE;
if (!modulePath) { console.log("SKIP set MAKEBORNE_PGLITE to an installed @electric-sql/pglite package to run the SQL check"); process.exit(0); }
const { PGlite } = await import(pathToFileURL(path.join(modulePath, "dist", "index.js")).href);
const db = new PGlite();
const migration = readFileSync(new URL("../supabase/migrations/20261027090000_launch_waitlist.sql", import.meta.url), "utf8");
let count = 0;
const pass = name => { count++; console.log(`PASS ${name}`); };
const hash = n => n.toString(16).padStart(64, "0");
const as = async (role, sql, params) => { await db.exec(`set role ${role}`); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } };
const fails = async (role, sql, params, code) => {
  try { await as(role, sql, params); } catch (error) { assert.equal(error.code, code, `${sql}: ${error.message}`); return; }
  assert.fail(`expected ${code}: ${sql}`);
};
const join = (email, ip = 1, source = null) => as("service_role", "select public.makeborne_join_launch_waitlist($1,$2,'waitlist-2026-10-27',$3,$4) as r", [email, source, hash(ip), hash(99)]);

// Supabase's roles and the foundation schema grants (20261003114223), as on a fresh project.
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema if not exists makeborne_private; revoke all on schema makeborne_private from public, anon;
  grant usage on schema makeborne_private to authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(migration);
pass("migration applies to a fresh database");

assert.deepEqual((await join("Ana.Reed@Example.com ", 1, "utm_source=instagram;ref=story")).rows[0].r, { accepted: true });
assert.deepEqual((await join("ana.reed@example.com", 2)).rows[0].r, { accepted: true });
const rows = (await db.query("select email, source, consent_text_version, invited_at from makeborne_private.launch_waitlist")).rows;
assert.deepEqual(rows, [{ email: "ana.reed@example.com", source: "utm_source=instagram;ref=story", consent_text_version: "waitlist-2026-10-27", invited_at: null }]);
pass("joins are trimmed, lower-cased and idempotent: a repeat says accepted and changes nothing");

for (const bad of ["no-at-sign", "a@b", "two@@example.com", "spaces in@example.com", "x".repeat(250) + "@example.com"]) await fails("service_role", "select public.makeborne_join_launch_waitlist($1,null,'waitlist-2026-10-27',$2,null)", [bad, hash(3)], "22023");
await fails("service_role", "select public.makeborne_join_launch_waitlist('a@example.com',null,'other',$1,null)", [hash(3)], "22023");
await fails("service_role", "select public.makeborne_join_launch_waitlist('a@example.com',null,'waitlist-2026-10-27','not-a-hash',null)", [], "22023");
await fails("service_role", "select public.makeborne_join_launch_waitlist('a@example.com','<script>','waitlist-2026-10-27',$1,null)", [hash(3)], "22023");
pass("invalid emails, consent versions, hashes and sources are refused (22023)");

for (let n = 0; n < 4; n++) await join(`person${n}@example.com`, 7);
await join("person4@example.com", 7); // fifth new address from this connection
await fails("service_role", "select public.makeborne_join_launch_waitlist('person5@example.com',null,'waitlist-2026-10-27',$1,null)", [hash(7)], "MB429");
// An address that is already on the list gets the same limit answer, so the limit never reveals membership.
await fails("service_role", "select public.makeborne_join_launch_waitlist('person0@example.com',null,'waitlist-2026-10-27',$1,null)", [hash(7)], "MB429");
assert.deepEqual((await join("person5@example.com", 8)).rows[0].r, { accepted: true });
pass("five new addresses per connection hash per 10 minutes (MB429), identical for existing addresses");

for (const role of ["anon", "authenticated"]) {
  await fails(role, "select public.makeborne_join_launch_waitlist('x@example.com',null,'waitlist-2026-10-27',$1,null)", [hash(9)], "42501");
  await fails(role, "select * from public.makeborne_launch_waitlist_pending(10)", [], "42501");
  await fails(role, "select public.makeborne_unsubscribe_launch_waitlist(gen_random_uuid())", [], "42501");
  await fails(role, "select public.makeborne_launch_waitlist_count()", [], "42501");
  await fails(role, "select count(*) from makeborne_private.launch_waitlist", [], "42501");
  await fails(role, "select makeborne_private.join_launch_waitlist('x@example.com',null,'waitlist-2026-10-27',$1,null)", [hash(9)], "42501");
}
await fails("service_role", "select count(*) from makeborne_private.launch_waitlist", [], "42501");
await fails("service_role", "insert into makeborne_private.launch_waitlist(email,consent_text_version,ip_hash) values('y@example.com','waitlist-2026-10-27',$1)", [hash(9)], "42501");
const security = (await db.query(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='makeborne_private' and p.proname like '%launch_waitlist%' order by 1`)).rows;
assert.equal(security.length, 5);
for (const fn of security) { assert.equal(fn.prosecdef, true, fn.proname); assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname); }
const rls = (await db.query("select relrowsecurity from pg_class where oid='makeborne_private.launch_waitlist'::regclass")).rows[0];
assert.equal(rls.relrowsecurity, true);
pass("anon and authenticated can execute nothing and read nothing; even service_role has no table privileges; definer functions pin an empty search_path; RLS on");

assert.equal((await as("service_role", "select public.makeborne_launch_waitlist_count() as n")).rows[0].n, 7);
const pending = (await as("service_role", "select id, email from public.makeborne_launch_waitlist_pending(100)")).rows;
assert.equal(pending.length, 7);
assert.equal(pending[0].email, "ana.reed@example.com"); // oldest first
const unsubscribed = pending[1].id;
assert.deepEqual((await as("service_role", "select public.makeborne_unsubscribe_launch_waitlist($1) as r", [unsubscribed])).rows[0].r, { unsubscribed: true });
assert.deepEqual((await as("service_role", "select public.makeborne_unsubscribe_launch_waitlist(gen_random_uuid()) as r")).rows[0].r, { unsubscribed: true });
await join(pending[1].email, 11); // re-joining does not undo an unsubscribe
const marked = (await as("service_role", "select public.makeborne_mark_launch_waitlist_invited($1::uuid[]) as n", [pending.map(row => row.id)])).rows[0].n;
assert.equal(marked, 6, "unsubscribed row is not marked invited");
assert.equal((await as("service_role", "select public.makeborne_mark_launch_waitlist_invited($1::uuid[]) as n", [pending.map(row => row.id)])).rows[0].n, 0, "marking twice changes nothing");
assert.equal((await as("service_role", "select count(*)::int as n from public.makeborne_launch_waitlist_pending(100)")).rows[0].n, 0);
await fails("service_role", "select public.makeborne_mark_launch_waitlist_invited('{}'::uuid[])", [], "22023");
assert.equal((await as("service_role", "select public.makeborne_launch_waitlist_count() as n")).rows[0].n, 6, "the count leaves out unsubscribed addresses");
pass("invite export lists pending rows oldest first; unsubscribe is idempotent and blind; invited_at is set once and never for unsubscribed rows; the count excludes unsubscribed");

await db.close();
console.log(`${count} launch waitlist SQL groups passed on a disposable in-memory Postgres`);
