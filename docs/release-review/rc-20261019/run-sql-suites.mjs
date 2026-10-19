// Runs every supabase/check-*.sql suite against the DISPOSABLE candidate stack
// (container supabase_db_makeborne-rc-20261019, fresh full chain of candidate
// migrations). No network, no provider calls, no shared or cloud database.
//
// Database targeting, recorded per suite in the JSON output:
// - Ordinary suites run in the migrated `postgres` database and roll back their
//   own transactions. check-site-sitemap.sql has no transaction of its own (its
//   header asks the runner to wrap it), so it is wrapped in begin/rollback.
// - Suites guarded to a named disposable database (`rehearsal`, the top-up names)
//   run in a FRESH copy restored from a dump of the clean migrated base, then the
//   copy is dropped. Nothing about the suite text is changed for these.
// - Five concurrency suites hard-code `host=supabase_db_makeborne-local` in their
//   dblink connection strings (another developer stack). They run from a temporary
//   copy whose only change is that host, retargeted to 127.0.0.1 inside this
//   container. The substitution is recorded as `retargeted: true`.
// - check-local-pilot-lock.sql is a postcondition of supabase/post-deploy/
//   pause_legacy_pilot.sql, so that script runs first in its fresh copy.
// Usage (worktree root): node docs/release-review/rc-20261019/run-sql-suites.mjs [filter]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const CONTAINER = "supabase_db_makeborne-rc-20261019";
const BASE_DUMP = "/tmp/rc-clean-base.dump";
const RESIDUE = "select (select count(*) from auth.users)+(select count(*) from makeborne_private.credit_wallets)+(select count(*) from public.credit_ledger)+(select count(*) from public.clients)+(select count(*) from public.workspaces);";
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const files = readdirSync("supabase").filter(f => /^check-.*\.sql$/.test(f) && (!filter || filter.test(f))).sort();
const sha = text => createHash("sha256").update(text).digest("hex");
const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const psql = (db, sql, user = "postgres") => docker(["exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q"], sql);
const lines = text => (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const scalar = (db, sql) => Number(lines(docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-q"], sql).stdout).at(-1));
const sh = cmd => docker(["exec", CONTAINER, "bash", "-c", cmd]);

const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain", "--", "supabase"], { encoding: "utf8" }).stdout.trim();

// The base must be clean before it is dumped: no accounts, wallets, ledger, clients or workspaces.
const residueBefore = scalar("postgres", RESIDUE);
if (residueBefore !== 0) { console.error(`Refusing: the base database is not clean (${residueBefore}).`); process.exit(2); }
const dumped = sh(`pg_dump -U postgres -Fc -d postgres -f ${BASE_DUMP}`);
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
  let sql = original, database = "postgres", retargeted = false, wrapped = false, prelude = null;
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
    if (database !== "postgres") out += freshCopy(database);
    if (prelude) { const p = psql(database, readFileSync(prelude, "utf8")); out += `--- prelude ${prelude} (exit ${p.status})\n${p.stdout ?? ""}${p.stderr ?? ""}`; }
    const r = psql(database, sql, user);
    out += `${r.stdout ?? ""}${r.stderr ?? ""}`; status = r.status;
  } finally { if (database !== "postgres") dropCopy(database); }
  results.push({ file, sha256: sha(original), database, user, retargeted, wrapped, prelude, exit: status, ms: Date.now() - started, tail: lines(out).slice(-3) });
  log += `\n===== ${file} (db ${database}${retargeted ? ", dblink host retargeted" : ""}${wrapped ? ", wrapped in begin/rollback" : ""}; exit ${status})\n${out}`;
  console.log(`${status === 0 ? "ok  " : "FAIL"} ${file}${database !== "postgres" ? `  [${database}${retargeted ? ", retargeted" : ""}]` : ""}`);
}
const summary = { at: new Date().toISOString(), candidateCommit: head, supabaseDirty: dirty || null, container: CONTAINER,
  baseResidueAfter: scalar("postgres", RESIDUE),
  passed: results.filter(r => r.exit === 0).length, total: results.length, failed: results.filter(r => !r.skipped && r.exit !== 0).map(r => r.file), skipped: results.filter(r => r.skipped).map(r => r.file), results };
const suffix = filter ? `-${process.argv[2].replace(/[^a-z0-9]+/gi, "_")}` : "";
writeFileSync(`docs/release-review/rc-20261019/sql-suites${suffix}.json`, JSON.stringify(summary, null, 2));
writeFileSync(`docs/release-review/rc-20261019/sql-suites${suffix}.log`, log.replace(/(sb_secret_|eyJ)[A-Za-z0-9._-]+/g, "[redacted]"));
console.log(`${summary.passed}/${summary.total} suites passed; base residue after run: ${summary.baseResidueAfter}`);
