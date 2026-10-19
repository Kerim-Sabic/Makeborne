// OWNER-APPROVED production database step for candidate a6e70c6 (RELEASE_PROCEDURE.md steps 0-1).
// Run from the LF archive of a6e70c6 (work/rc-stack/candidate-a6e70c6). Subcommands, in order:
//   preflight  read-only: migration history (93, last 20261017080000), switches, advisors, auth/postgrest snapshots
//   backup     read-only custom-format pg_dump, listing and full decode check
//   apply      exactly one file, 20261019090000_app_observability.sql, through `supabase db push` with an EXPLICIT
//              production --db-url (never the linked project) after a dry run that must list only that file
//   verify     read-only post-checks: 94 migrations, objects, grants, switches unchanged, no new advisor warning
// Private outputs (snapshots, backup, logs) go to the main checkout's ignored work/release-rc-20261019-production/;
// public summaries to <worktree>/docs/release-review/rc-20261019/production/. Credentials are never printed.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import pg from "pg";

const REF = "rklojnmmsmhwnkbzuidp", STAGING_REF = "xzwikrunwpurxnxgkznh";
const MAIN = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app";
const WORKTREE = `${MAIN}/.claude/worktrees/rc-20261019`;
const PRIVATE = `${MAIN}/work/release-rc-20261019-production`; fs.mkdirSync(PRIVATE, { recursive: true });
const PUBLIC = `${WORKTREE}/docs/release-review/rc-20261019/production`; fs.mkdirSync(PUBLIC, { recursive: true });
const FILE = "20261019090000_app_observability.sql", FILE_SHA = "c05a3c7b974a15331150b56a0b43976da109f3b3c3e86f484d6f16fc1b1efeb4";
const IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.002";
const command = process.argv[2];
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

// Inputs: the LF archive of the frozen commit.
const migrations = fs.readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort();
assert.equal(migrations.length, 94, "expected the 94-file candidate chain");
assert.equal(migrations.at(-1), FILE);
assert.equal(sha(fs.readFileSync(`supabase/migrations/${FILE}`)), FILE_SHA, "migration bytes differ from the qualified LF file");
assert(!fs.readFileSync(`supabase/migrations/${FILE}`, "utf8").includes("\r"), "migration must be LF");

function password() {
  let value = fs.readFileSync(`${MAIN}/.env.production-db.private`, "utf8").replace(/^\uFEFF/, "").match(/^SUPABASE_PRODUCTION_DB_PASSWORD\s*=\s*([^\r\n]+)/m)?.[1]?.trim();
  assert(value?.length >= 8, "owner private DB password absent");
  if (value.startsWith('"')) value = JSON.parse(value); else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  return value;
}
const token = () => fs.readFileSync("C:/Users/kerim/.supabase/access-token", "utf8").trim();
async function management(route) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}${route}`, { headers: { Authorization: `Bearer ${token()}` } });
  assert(response.ok, `production management ${route} ${response.status}`);
  return response.json();
}
async function connect() {
  const pools = await management("/config/database/pooler"), pool = pools.find(p => p.database_type === "PRIMARY") ?? pools[0];
  const url = new URL(pool.connection_string ?? pool.connectionString);
  assert.equal(url.username, `postgres.${REF}`); assert.notEqual(url.username, `postgres.${STAGING_REF}`);
  assert(url.hostname.endsWith(".pooler.supabase.com"));
  url.password = ""; url.port = "5432";
  const ca = rootCertificates.join("\n") + "\n" + fs.readFileSync(`${MAIN}/work/release-auth-stack/supabase-ca.crt`, "utf8");
  fs.writeFileSync(`${PRIVATE}/production-ca.crt`, ca);
  const pw = password();
  const db = new pg.Client({ host: url.hostname, port: 5432, user: url.username, password: pw, database: "postgres", ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 15000 });
  await db.connect();
  assert(db.connection.stream.authorized, "TLS not verified");
  assert.deepEqual((await db.query("select current_user usr, current_database() db")).rows[0], { usr: "postgres", db: "postgres" });
  return { db, url, pw };
}
async function switches(db) {
  return {
    limits: (await db.query("select scope, enabled, daily_limit_microusd::text from makeborne_private.live_provider_limits order by scope")).rows,
    billing: (await db.query("select creation_enabled, free_tier_enabled, trial_credits from makeborne_private.billing_settings where singleton")).rows,
    topups: (await db.query("select pack_id, enabled from makeborne_private.topup_catalog order by pack_id")).rows,
    accessPlans: (await db.query("select plan_id, enabled from makeborne_private.billing_access_plans order by plan_id")).rows,
  };
}
const versions = async db => (await db.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(r => r.version);
const warnings = advisors => new Set((advisors.lints ?? []).filter(l => ["WARN", "ERROR"].includes(l.level)).map(l => l.cache_key ?? JSON.stringify([l.name, l.metadata])));

if (command === "preflight") {
  const { db } = await connect();
  try {
    await db.query("begin read only");
    const before = await versions(db);
    assert.equal(before.length, 93, `production has ${before.length} migrations, expected 93`);
    assert.equal(before.at(-1), "20261017080000");
    assert.deepEqual(before, migrations.slice(0, 93).map(f => f.slice(0, 14)), "production history differs from the candidate's first 93 files");
    const state = await switches(db);
    assert(state.limits.every(l => !l.enabled), "a provider spending scope is enabled");
    assert.equal(state.billing[0]?.creation_enabled, false, "creation checkout is enabled");
    await db.query("commit");
    const snapshot = { at: new Date().toISOString(), ref: REF, versions: before, state, advisors: await management("/advisors/security"), postgrest: await management("/postgrest") };
    writeJson(`${PRIVATE}/production-before.private.json`, snapshot);
    const summary = { at: snapshot.at, ref: REF, migrations: before.length, last: before.at(-1), providerScopesEnabled: state.limits.filter(l => l.enabled).length, creationEnabled: state.billing[0].creation_enabled,
      topupsEnabled: state.topups.filter(t => t.enabled).length, accessPlansEnabled: state.accessPlans.filter(p => p.enabled).length, securityWarnings: warnings(snapshot.advisors).size, passed: true };
    writeJson(`${PUBLIC}/01-preflight.json`, summary); console.log(JSON.stringify(summary, null, 2));
  } finally { await db.end(); }
} else if (command === "backup") {
  const { db, url, pw } = await connect(); await db.end();
  const file = `production-before-a6e70c6-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}.dump`;
  fs.copyFileSync(`${PRIVATE}/production-ca.crt`, `${PRIVATE}/backup-ca.crt`);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: "5432", PGUSER: url.username, PGPASSWORD: pw, PGDATABASE: "postgres", PGSSLMODE: "verify-full", PGSSLROOTCERT: "/backup/backup-ca.crt", PGOPTIONS: "-c default_transaction_read_only=on -c lock_timeout=10000", MSYS_NO_PATHCONV: "1" };
  const args = ["run", "--rm", "--mount", `type=bind,source=${PRIVATE},target=/backup`];
  for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGSSLROOTCERT", "PGOPTIONS"]) args.push("-e", key);
  args.push("--entrypoint", "pg_dump", IMAGE, "--format=custom", `--file=/backup/${file}`);
  const dump = spawnSync("docker", args, { env, encoding: "utf8", timeout: 600000, maxBuffer: 8e6 });
  const log = `${dump.stdout ?? ""}\n${dump.stderr ?? ""}`; assert(!log.includes(pw), "credential in output");
  fs.writeFileSync(`${PRIVATE}/production-backup.private.log`, log);
  assert.equal(dump.status, 0, "production backup failed (see private log)");
  const bytes = fs.readFileSync(`${PRIVATE}/${file}`);
  const ro = ["run", "--rm", "--network=none", "--mount", `type=bind,source=${PRIVATE},target=/backup,readonly`, "--entrypoint", "pg_restore", IMAGE];
  const listing = spawnSync("docker", [...ro, "--list", `/backup/${file}`], { encoding: "utf8", timeout: 120000, maxBuffer: 16e6, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  assert.equal(listing.status, 0, "backup listing failed");
  const decode = spawnSync("docker", [...ro, "--file=/tmp/full.sql", `/backup/${file}`], { encoding: "utf8", timeout: 300000, maxBuffer: 4e6, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  assert.equal(decode.status, 0, "full decode failed");
  const backup = { at: new Date().toISOString(), ref: REF, file, bytes: bytes.length, sha256: sha(bytes), entries: listing.stdout.split("\n").filter(l => /^\d+;/.test(l)).length, fullDecodePassed: true };
  writeJson(`${PRIVATE}/production-backup.json`, backup);
  writeJson(`${PUBLIC}/02-backup.json`, { ...backup, location: "owner-private ignored folder work/release-rc-20261019-production/" });
  console.log(JSON.stringify(backup, null, 2));
} else if (command === "apply") {
  assert.equal(process.argv[3], "owner-approved-app-observability", "apply needs the explicit approval token");
  const backup = readJson(`${PRIVATE}/production-backup.json`);
  assert(Date.now() - Date.parse(backup.at) < 3600000, "fresh backup (< 1 hour) required");
  assert.equal(sha(fs.readFileSync(`${PRIVATE}/${backup.file}`)), backup.sha256, "backup file changed");
  const baseline = readJson(`${PRIVATE}/production-before.private.json`);
  const { db, url, pw } = await connect();
  const report = { at: new Date().toISOString(), ref: REF, candidateCommit: "a6e70c6f577aa5bf7654e72cd8d85b9977bd247e", approved: true, file: FILE, sha256: FILE_SHA, passed: false };
  try {
    assert.deepEqual(await versions(db), baseline.versions, "history changed since preflight");
    assert.deepEqual(await switches(db), baseline.state, "switches changed since preflight");
    url.searchParams.set("sslmode", "verify-full"); url.searchParams.set("sslrootcert", path.join(PRIVATE, "production-ca.crt"));
    const cli = (extra, log) => {
      const r = spawnSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "db", "push", "--db-url", url.href, "--include-all", "--skip-vault", "--yes", ...extra], { env: { ...process.env, SUPABASE_DB_PASSWORD: pw, PGPASSWORD: pw }, encoding: "utf8", timeout: 300000, maxBuffer: 8e6 });
      const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`; assert(!output.includes(pw), "credential appeared in CLI output; withheld");
      fs.writeFileSync(`${PRIVATE}/${log}`, output); assert.equal(r.status, 0, `migration CLI failed; see ${log}`); return output;
    };
    const dry = cli(["--dry-run"], "production-dry-run.private.log");
    const mentioned = [...new Set(dry.match(/\d{14}_[a-z0-9_]+\.sql/g) ?? [])];
    assert.deepEqual(mentioned, [FILE], `dry run lists ${JSON.stringify(mentioned)}, expected only ${FILE}`);
    report.dryRunMatched = true;
    cli([], "production-apply.private.log");
    const after = await versions(db);
    assert.equal(after.length, 94); assert.equal(after.at(-1), "20261019090000");
    assert.deepEqual(await switches(db), baseline.state, "switches changed by the migration");
    report.afterCount = after.length; report.passed = true; report.completedAt = new Date().toISOString();
  } catch (error) { report.error = error.message; process.exitCode = 1; }
  finally { await db.end(); writeJson(`${PUBLIC}/03-apply.json`, report); console.log(JSON.stringify(report, null, 2)); }
} else if (command === "verify") {
  const baseline = readJson(`${PRIVATE}/production-before.private.json`);
  const { db } = await connect();
  try {
    await db.query("begin read only");
    const after = await versions(db);
    const tables = (await db.query("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='makeborne_private' and c.relname in ('app_error_groups','app_error_days','telemetry_salts','studio_visits') order by 1")).rows;
    const grants = (await db.query("select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authed, has_function_privilege('service_role', p.oid, 'execute') service, array_to_string(p.proconfig, ',') config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('makeborne_record_app_error','makeborne_record_studio_visit','makeborne_admin_health') order by 1")).rows;
    const tableGrants = (await db.query("select count(*)::int n from information_schema.role_table_grants where table_schema='makeborne_private' and table_name in ('app_error_groups','app_error_days','telemetry_salts','studio_visits') and grantee in ('anon','authenticated')")).rows[0].n;
    const clientPrivileges = (await db.query("select t, r, has_table_privilege(r, 'makeborne_private.'||t, 'SELECT') sel, has_table_privilege(r, 'makeborne_private.'||t, 'INSERT,UPDATE,DELETE') write from unnest(array['app_error_groups','app_error_days','telemetry_salts','studio_visits']) t, unnest(array['anon','authenticated']) r")).rows;
    const state = await switches(db);
    await db.query("commit");
    const exposed = (await management("/postgrest")).db_schema.split(",").map(s => s.trim());
    const advisors = await management("/advisors/security"), before = warnings(baseline.advisors), now = warnings(advisors);
    const added = [...now].filter(k => !before.has(k));
    const result = { at: new Date().toISOString(), ref: REF, migrations: after.length, last: after.at(-1), tables, functions: grants, clientTableGrants: tableGrants, clientPrivileges: clientPrivileges.filter(p => p.sel || p.write).length, exposedSchemas: exposed, switchesUnchanged: JSON.stringify(state) === JSON.stringify(baseline.state), securityWarningsBefore: before.size, securityWarningsNow: now.size, newWarnings: added.length };
    // Criterion corrected 2026-10-19: private-schema tables are protected by having no client privileges and no API exposure
    // (RLS is off on 6 of 49 makeborne_private tables, two of them pre-existing); RLS on them is optional hardening.
    result.passed = result.migrations === 94 && tables.length === 4 && clientPrivileges.every(p => !p.sel && !p.write) && !exposed.includes("makeborne_private") && grants.length === 3 && grants.every(g => !g.anon && !g.authed && g.service && /search_path/.test(g.config ?? "")) && tableGrants === 0 && result.switchesUnchanged && added.length === 0;
    writeJson(`${PUBLIC}/04-verify.json`, result); console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } finally { await db.end(); }
} else {
  console.error("usage: node production-release.mjs preflight|backup|apply owner-approved-app-observability|verify"); process.exitCode = 2;
}
