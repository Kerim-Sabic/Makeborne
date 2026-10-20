// Runs every supabase/check-*.sql suite against the DISPOSABLE local stack
// (container supabase_db_makeborne-rc-20261019) on the full chain: the clean
// 94-migration base from production's chain plus this branch's new migrations
// (20261020090000, 20261020100000). Adapted from
// docs/release-review/rc-20261019/run-sql-suites.mjs with one difference: every
// suite, including ordinary ones, runs in a FRESH copy restored from the migrated
// base, so the stack's own `postgres` database is neither read nor changed.
// Usage (worktree root): node docs/release-review/launch-20261020/run-sql-suites.mjs [filter]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const CONTAINER = "supabase_db_makeborne-rc-20261019";
const CLEAN_DUMP = "/tmp/refunds-base.dump";
const BASE_DUMP = "/tmp/launch-20261020-migrated.dump";
const NEW_MIGRATIONS = readdirSync("supabase/migrations").filter(f => f > "20261019090000_app_observability.sql").sort();
const RESIDUE = "select (select count(*) from auth.users)+(select count(*) from makeborne_private.credit_wallets)+(select count(*) from public.credit_ledger)+(select count(*) from public.clients)+(select count(*) from public.workspaces);";
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const files = readdirSync("supabase").filter(f => /^check-.*\.sql$/.test(f) && (!filter || filter.test(f))).sort();
if (!files.length) throw new Error("SQL_SUITE_FILTER_MATCHED_NOTHING");
const sha = text => createHash("sha256").update(text).digest("hex");
const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const psql = (db, sql, user = "postgres") => docker(["exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q"], sql);
const lines = text => (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const scalar = (db, sql) => Number(lines(docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-q"], sql).stdout).at(-1));
const sh = cmd => docker(["exec", CONTAINER, "bash", "-c", cmd]);

const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain", "--", "supabase"], { encoding: "utf8" }).stdout.trim();

// Base: the clean 94-migration dump taken from the stack before any fixture
// (CLEAN_DUMP, 2026-10-20), never the stack's live `postgres` database, which
// may hold browser-check fixtures. The restored copy must have no residue and
// exactly the 94 production-chain migrations.
sh(`psql -U postgres -d postgres -qc "drop database if exists launch_migrated_base with (force)"`);
const base = sh(`test -s ${CLEAN_DUMP} && psql -U postgres -d postgres -qc "create database launch_migrated_base" && pg_restore -U postgres -d launch_migrated_base ${CLEAN_DUMP} >/dev/null 2>&1; true`);
if (base.status !== 0) { console.error(base.stderr); process.exit(2); }
const residueBefore = scalar("launch_migrated_base", RESIDUE);
const chainBefore = scalar("launch_migrated_base", "select count(*) from supabase_migrations.schema_migrations;");
if (residueBefore !== 0 || chainBefore !== 94) { console.error(`Refusing: the clean base is not clean (${residueBefore}) or not the 94-migration chain (${chainBefore}).`); process.exit(2); }
for (const file of NEW_MIGRATIONS) {
  const applied = psql("launch_migrated_base", readFileSync(`supabase/migrations/${file}`, "utf8"));
  if (applied.status !== 0) { console.error(`migration ${file} failed: ${applied.stderr}`); process.exit(2); }
}
const dumped = sh(`pg_dump -U postgres -Fc -d launch_migrated_base -f ${BASE_DUMP} && psql -U postgres -d postgres -qc "drop database launch_migrated_base with (force)"`);
if (dumped.status !== 0) { console.error(dumped.stderr); process.exit(2); }

const dropCopy = name => sh(`psql -U postgres -d postgres -qc "drop database if exists ${name} with (force)"`);
function freshCopy(name) {
  dropCopy(name);
  const created = sh(`psql -U postgres -d postgres -qc "create database ${name}" && pg_restore -U postgres -d ${name} ${BASE_DUMP} 2>&1 | grep -v 'already exists' | tail -3`);
  if (created.status !== 0) throw new Error(`restore ${name} failed: ${created.stderr}`);
  return created.stdout;
}

// Suites that test something other than the final candidate chain, with the reason.
const SKIP = {
  "check-crm-mail-upgrade.sql": "Upgrade-path test: runs mid-chain with the 20261013260000 migration body substituted for its placeholder (scripts/rehearse-candidate.mjs). That migration is already applied in production and unchanged in this candidate.",
  "check-mail-granted-scopes-upgrade.sql": "Upgrade-path test: runs mid-chain with the 20261013270000 migration body substituted (scripts/rehearse-candidate.mjs). Already applied in production; unchanged in this candidate.",
  "check-local-pilot-lock.sql": "Postcondition of one developer stack (requires its dedicated local source fixture); not a property of the migration chain.",
};
const results = [];
let log = "";
for (const file of files) {
  const original = readFileSync(`supabase/${file}`, "utf8");
  let sql = original, database = "launch_suite", retargeted = false, wrapped = false, prelude = null;
  const named = original.match(/current_database\(\)\s*(?:<>|not in \(|=)\s*'(rehearsal|makeborne_topup_[a-z0-9_]+)'/);
  if (named) database = named[1];
  else if (/current_database\(\)\s*=\s*'postgres'/.test(original)) database = "rehearsal";
  if (sql.includes("host=supabase_db_makeborne-local port=5432")) { sql = sql.replaceAll("host=supabase_db_makeborne-local port=5432", `host=${CONTAINER} port=5432`); retargeted = true; }
  // Same suite family without a host: dblink from a non-superuser needs a password-requesting (scram) connection.
  if (file === "check-billing-lifecycle-concurrency.sql") { sql = sql.replaceAll("format('dbname=%s user=postgres',current_database())", `format('host=${CONTAINER} port=5432 dbname=%s user=postgres password=postgres',current_database())`).replaceAll("format('dbname=%s user=postgres', current_database())", `format('host=${CONTAINER} port=5432 dbname=%s user=postgres password=postgres', current_database())`); retargeted = true; }
  if (SKIP[file]) { results.push({ file, sha256: sha(original), skipped: SKIP[file] }); log += `
===== ${file} SKIPPED: ${SKIP[file]}
`; console.log(`skip ${file}`); continue; }
  const user = file === "check-publication-controller-boundary.sql" ? "supabase_admin" : "postgres";
  if (file === "check-site-sitemap.sql") { sql = `begin;\n${sql}\nrollback;\n`; wrapped = true; }
  const started = Date.now();
  let out = "", status = null;
  try {
    out += freshCopy(database);
    if (prelude) { const p = psql(database, readFileSync(prelude, "utf8")); out += `--- prelude ${prelude} (exit ${p.status})\n${p.stdout ?? ""}${p.stderr ?? ""}`; }
    const r = psql(database, sql, user);
    out += `${r.stdout ?? ""}${r.stderr ?? ""}`; status = r.status;
  } finally { dropCopy(database); }
  results.push({ file, sha256: sha(original), database, user, retargeted, wrapped, prelude, exit: status, ms: Date.now() - started, tail: lines(out).slice(-3) });
  log += `\n===== ${file} (db ${database}${retargeted ? ", dblink host retargeted" : ""}${wrapped ? ", wrapped in begin/rollback" : ""}; exit ${status})\n${out}`;
  console.log(`${status === 0 ? "ok  " : "FAIL"} ${file}  [${database}${retargeted ? ", retargeted" : ""}]`);
}
const summary = { at: new Date().toISOString(), candidateCommit: head, supabaseDirty: dirty || null, container: CONTAINER, newMigrations: NEW_MIGRATIONS,
  baseResidueBefore: residueBefore, baseChain: chainBefore,
  passed: results.filter(r => r.exit === 0).length, total: results.length, failed: results.filter(r => !r.skipped && r.exit !== 0).map(r => r.file), skipped: results.filter(r => r.skipped).map(r => r.file), results };
const suffix = filter ? `-${process.argv[2].replace(/[^a-z0-9]+/gi, "_")}` : "";
writeFileSync(`docs/release-review/launch-20261020/sql-suites${suffix}.json`, JSON.stringify(summary, null, 2));
writeFileSync(`docs/release-review/launch-20261020/sql-suites${suffix}.log`, log.replace(/(sb_secret_|eyJ)[A-Za-z0-9._-]+/g, "[redacted]"));
console.log(`${summary.passed}/${summary.total} suites passed; clean base: ${chainBefore} migrations, residue ${residueBefore}; every suite ran in its own dropped copy`);
if (summary.failed.length) process.exitCode = 1;
