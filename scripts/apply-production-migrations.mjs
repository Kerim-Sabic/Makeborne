// Applies the launch build's 16 reviewed migrations to PRODUCTION, hash-pinned, in order. Never a bare `supabase db push`.
// Run from the repository root that holds `.env.production-db.private` (SUPABASE_PRODUCTION_DB_PASSWORD=...):
//   node <launch-build>/scripts/apply-production-migrations.mjs             dry run: verify the ledger, list pending, change nothing
//   --rehearse is REFUSED: use disposable Docker copies, not rolled-back writes to production.
//   --apply requires MAKEBORNE_RELEASE_GO_SHA matching this clean Git HEAD and
//   MAKEBORNE_PRODUCTION_BACKUP_MANIFEST pointing to verified fresh private backup evidence.
// TLS verification is mandatory; SUPABASE_CA may add the official Supabase CA.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const pg = createRequire(path.join(repo, "package.json"))("pg");
const REF = "rklojnmmsmhwnkbzuidp";
// Exact files and LF-normalized SHA-256, matching the staging ledger where staging has them (20261028100000 is new).
const PENDING = [
  ["20261022100000_brief_enhancement_actions.sql", "75dca905bfcd06eab46e65a12ea249413d746b7e45019003dd82c1859c92663f"],
  ["20261023130000_project_source_uploads.sql", "9dd7356f20863424c9b258c739a1d66b143b8a38d26a0ff684d33f3036fb7fe6"],
  ["20261023200000_agency_operation_contract.sql", "cdd35bb4e328ece84849786d1d5ade540e086f23aefb7b324c32c6a54274a2c4"],
  ["20261023210000_client_knowledge.sql", "6b0b3bffac403cc7131a5d52366fb8837160fd9f0dd147054254ad185b9742df"],
  ["20261024010000_client_research.sql", "dca6b9a5c7ec8e3c8308867445a91a74016bd4f5aadf9507f4187d0c50758052"],
  ["20261024020000_data_report_files.sql", "2c44771f523614a68e4b6914991b43ae8969d482e061c49fc5ac6ea0b2570401"],
  ["20261025200000_paying_workspace_publication.sql", "aaa816b87e2f1cc46be99fd5538270fda6912ffad9e6a39eb9c782d938d4af5a"],
  ["20261025300000_crm_research.sql", "72779dc062a254515f104fe213ab6fcf85c115314afd4316599a458efe9906ff"],
  ["20261026013451_prevent_unsupported_creation_repurchase.sql", "3eea04af7aae57298a94ed3d322cc5309c0cb1d1c4dd4167b6016f9400ead0f1"],
  ["20261026100000_account_data_rights.sql", "6a8eab98884b7ab8fa4c39dbf0ba24215e8c3bca1f31f0e119f24a2b6903fa00"],
  ["20261026120000_crm_server_writes.sql", "40599228e22edfbf539679f1b8bbac9901b3aa5e04699ae34f58504b493bfa1e"],
  ["20261026120100_research_daily_limits.sql", "12b6001d51dc9c0ab96d22bd471be1554acc5bad23fd55df007f3ca711403ec7"],
  ["20261026125554_billing_checkout_consent.sql", "2131c2174a803c1c889c25d3ac9133703cf5c3b507ef52c1bc6d98e242c50baa"],
  ["20261026135550_crm_next_step_rpc_boundary.sql", "5e988c90f532a632532dc9a573f46c18a3f2148f9a99205dd2cea029b4d6d7df"],
  ["20261028100000_purchase_confirmations.sql", "fc2388611f192e335e80439def9807cf8dfc19705592a5f4e6e1782ce9e2afc0"],
  ["20261028213151_transactional_mail_delivery_fencing.sql", "343b61225df53fb18c0215bdcef1cb438ec3e4a99d75e2614e9a7b87a533f95d"],
];
const args = process.argv.slice(2);
if (args.includes("--rehearse")) throw new Error("Production mutation rehearsals are prohibited. Run scripts/rehearse-candidate.mjs on disposable local containers.");
if (!(args.length === 0 || (args.length === 1 && args[0] === "--apply"))) throw new Error("Expected dry-run (no arguments) or --apply after final owner GO");
const mode = args[0] === "--apply" ? "apply" : "dry-run";
const read = file => fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const sha = text => createHash("sha256").update(text).digest("hex");
/** The migration body without its own outer `begin;`/`commit;` (exactly one of each, on their own lines). */
function body(file, text) {
  const begins = text.match(/^begin;[ \t]*$/gm) ?? [], commits = text.match(/^commit;[ \t]*$/gm) ?? [];
  if (begins.length !== 1 || commits.length !== 1) throw new Error(`${file}: expected one top-level begin; and one commit;`);
  return text.replace(/^begin;[ \t]*$/m, "").replace(/^commit;[ \t]*$/m, "");
}
if (mode === "apply") {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  if (process.env.MAKEBORNE_RELEASE_GO_SHA !== head) throw new Error("Final owner GO for this exact committed candidate is required");
  execFileSync("git", ["diff", "--quiet", "HEAD"], { cwd: repo });
  const file = process.env.MAKEBORNE_PRODUCTION_BACKUP_MANIFEST;
  if (!file) throw new Error("Fresh verified production backup evidence required");
  const backup = JSON.parse(read(file));
  const age = Date.now() - Date.parse(backup.createdAt);
  if (backup.projectRef !== REF || !backup.restoreVerified || !Number.isFinite(age) || age < 0 || age > 6 * 60 * 60 * 1000 || !backup.dumpPath)
    throw new Error("Backup must name this project, be restore-verified, and be less than six hours old");
  const dump = fs.readFileSync(backup.dumpPath);
  if (dump.length < 100 || createHash("sha256").update(dump).digest("hex") !== backup.sha256) throw new Error("Backup file/hash verification failed");
}

const envFile = [".env.production-db.private", path.join(repo, ".env.production-db.private")].find(f => fs.existsSync(f));
if (!envFile) throw new Error("No .env.production-db.private in the current directory or the launch build");
const password = read(envFile).match(/^SUPABASE_PRODUCTION_DB_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!password) throw new Error("SUPABASE_PRODUCTION_DB_PASSWORD is missing");
const ssl = { rejectUnauthorized: true, ...(process.env.SUPABASE_CA ? { ca: fs.readFileSync(process.env.SUPABASE_CA, "utf8") } : {}) };

const migrations = PENDING.map(([file, pinned]) => {
  const text = read(path.join(repo, "supabase/migrations", file));
  if (sha(text) !== pinned) throw new Error(`${file} changed since it was reviewed (hash mismatch)`);
  return { file, version: file.slice(0, 14), name: file.slice(15, -4), text, sha256: pinned };
});
const preparedManifest = JSON.parse(read(path.join(repo, "docs/release-review/launch-preparation-manifest-20261028.json")));
if (JSON.stringify(preparedManifest.productionPending.map(x => [x.file,x.sha256])) !== JSON.stringify(PENDING))
  throw new Error("Prepared production delta and pinned executor differ; stop and review");

let db;
for (const target of [{ host: `db.${REF}.supabase.co`, user: "postgres" }, { host: "aws-0-eu-central-1.pooler.supabase.com", user: `postgres.${REF}` }, { host: "aws-1-eu-central-1.pooler.supabase.com", user: `postgres.${REF}` }]) {
  const client = new pg.Client({ ...target, port: 5432, password, database: "postgres", ssl, connectionTimeoutMillis: 10000, application_name: "makeborne-launch-migrations" });
  try { await client.connect(); db = client; console.log(`Connected to production ${REF} via ${target.host}`); break; }
  catch (error) { await client.end().catch(() => {}); console.log(`No verified connection via ${target.host}: ${error.code ?? "CONNECTION_FAILED"}`); }
}
if (!db) throw new Error("Could not connect to production");

const report = { project: REF, mode, startedAt: new Date().toISOString(), pending: [], applied: [], checks: [] };
try {
  await db.query("set statement_timeout = '180s'; set lock_timeout = '15s'");
  if (mode === "dry-run") await db.query("set default_transaction_read_only = on");
  const { rows: [who] } = await db.query("select current_database() db, (select count(*)::int from auth.users) users");
  if (mode === "apply") {
    const { rows: [lock] } = await db.query("select pg_try_advisory_lock(hashtextextended('makeborne-production-launch-migrations',0)) as locked");
    if (!lock.locked) throw new Error("Another release migration session is active; stop");
  }
  const ledger = new Set((await db.query("select version from supabase_migrations.schema_migrations")).rows.map(r => r.version));
  const manifest = JSON.parse(read(path.join(repo, "docs/release-review/launch-preparation-manifest-20261028.json")));
  if (manifest.productionProject.supabase !== REF || sha([...ledger].sort().join("\n")) !== manifest.productionAppliedVersionsSha256)
    throw new Error("Production migration baseline changed; regenerate and review the exact delta before proceeding");
  if (!ledger.has("20261027020420") || !ledger.has("20261023000417")) throw new Error("Unexpected production ledger: the waitlist or account-chat migration is missing");
  const pending = migrations.filter(m => !ledger.has(m.version));
  if (pending.length && pending.length !== migrations.length) throw new Error(`Partially applied (${migrations.length - pending.length} of ${migrations.length}): stop and review`);
  report.pending = pending.map(m => m.file);
  console.log(`Database ${who.db}, ${who.users} accounts. Pending: ${pending.length ? pending.map(m => m.file).join(", ") : "none"}`);

  if (mode === "apply") {
    for (const m of pending) {
      await db.query("begin");
      try {
        await db.query(body(m.file, m.text));
        await db.query("insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, array[$3])", [m.version, m.name, m.text]);
        await db.query("commit");
      } catch (error) { await db.query("rollback"); throw new Error(`${m.file} failed and was rolled back: ${error.message}`); }
      report.applied.push({ file: m.file, sha256: m.sha256, at: new Date().toISOString() });
      console.log(`  applied ${m.file}`);
    }
    console.log(`DONE: ${report.applied.length} applied.`);
  }
} catch (error) {
  report.error = error.message; console.error(`STOPPED: ${error.message}`); process.exitCode = 1;
} finally {
  await db.end();
  if (mode !== "dry-run") fs.writeFileSync(path.join(repo, `docs/release-review/production-migrations-${mode}-20261029.json`), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + "\n");
}
