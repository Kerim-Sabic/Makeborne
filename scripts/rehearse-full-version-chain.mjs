// Disposable full-chain migration rehearsal for claude/full-version-staging.
// One fresh --network=none Postgres container per scenario; never staging or production.
// Bootstrap mirrors scripts/rehearse-candidate.mjs (platform schema, production schema dump,
// production's recorded versions, populated fixture, legacy pause), then migrations, then
// every supabase/check-*.sql. Container is removed afterwards.
// Usage: node scripts/rehearse-full-version-chain.mjs <base|full|staging> <repo root> <out.json> [githubDir]
//   base/full: every migration production has not recorded, in timestamp order, from <repo root>.
//   staging:   MAIN_LIST=<json array of live-main migration files> plus <githubDir> holding the GitHub
//              qualification migrations applied on staging; those and 20261025200000/20261026013451 go first,
//              then the remaining migrations in timestamp order (what --include-all or the apply script does).
// Evidence of the 26 Oct run: docs/release-review/full-version-staging-sql-20261026.json.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [scenario, root, out, githubDir] = process.argv.slice(2);
if (!["base", "full", "staging"].includes(scenario)) { console.error("scenario?"); process.exit(2); }
const IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.002";
const DB = "rehearsal";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const container = `makeborne_candidate_fullstaging_${scenario}_${stamp}`;
const docker = (args, input, timeout) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
function psql(db, sql, { allowFailure = false, user = "postgres", timeout = 600000 } = {}) {
  const r = docker(["exec", "-i", container, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"], sql, timeout);
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const ok = r.status === 0;
  if (!ok && !allowFailure) throw new Error(`psql failed (${r.status ?? r.signal ?? r.error?.code}):\n${output.slice(-3000)}`);
  return { ok, output, timedOut: r.error?.code === "ETIMEDOUT" };
}
const sha = t => createHash("sha256").update(t).digest("hex");
const read = f => readFileSync(join(root, f), "utf8");
const scalar = sql => psql(DB, sql).output.trim().split("\n").filter(l => !/^(NOTICE|WARNING)/.test(l)).at(-1) ?? "";

const baseline = new Set(JSON.parse(read("docs/release-review/production-baseline.json")).rows[0].baseline.versions);
const local = readdirSync(join(root, "supabase", "migrations")).filter(f => f.endsWith(".sql") && !baseline.has(f.slice(0, 14))).sort()
  .map(f => ({ file: f, path: join(root, "supabase", "migrations", f) }));
let order = local;
if (scenario === "staging") {
  // Staging's recorded state before this branch: live main's chain + the two Codex migrations already applied
  // (20261025200000, 20261026013451) + the five GitHub qualification migrations applied there (not in this branch).
  // Then the remaining eight in timestamp order, as `--include-all` / the apply script would.
  const mainSet = new Set(JSON.parse(readFileSync(process.env.MAIN_LIST, "utf8")));
  const applied = new Set(["20261025200000", "20261026013451"]);
  const gh = readdirSync(githubDir).filter(f => f.endsWith(".sql")).sort().map(f => ({ file: f, path: join(githubDir, f), github: true }));
  const first = [...local.filter(m => mainSet.has(m.file) || applied.has(m.file.slice(0, 14))), ...gh].sort((a, b) => a.file.localeCompare(b.file));
  const rest = local.filter(m => !mainSet.has(m.file) && !applied.has(m.file.slice(0, 14)));
  order = [...first, ...rest];
}
const FINGERPRINT = `select md5(string_agg(x, E'\\n' order by x)) from (
  select 'f:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') x
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and p.prokind in ('f','p')
  union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')
    from information_schema.columns where table_schema in ('public','makeborne_private','makeborne_hosting')
  union all select 'p:'||schemaname||'.'||tablename||'.'||policyname||md5(coalesce(qual,'')||'|'||coalesce(with_check,''))
    from pg_policies where schemaname in ('public','makeborne_private','makeborne_hosting','storage')
  union all select 'g:'||n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and c.relkind in ('r','v','S')
) s;`;
const PUBLIC_FUNCTIONS = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1;`;
const SECDEF_EXPOSED = `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('anon', p.oid, 'execute'));`;

const evidence = { scenario, container, image: IMAGE, startedAt: new Date().toISOString(), network: "none", stagingTouched: false, productionTouched: false, providerCalls: 0,
  migrations: order.map(m => ({ file: m.file, sha256: sha(readFileSync(m.path, "utf8")), github: !!m.github })), applied: [], checks: {} };
const save = () => writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
try {
  const started = docker(["run", "--pull=never", "--network=none", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=makeborne-candidate-local-only", "-e", "POSTGRES_USER=supabase_admin", "-e", "POSTGRES_DB=postgres", IMAGE, "postgres", "-D", "/etc/postgresql"]);
  if (started.status !== 0) throw new Error(`start: ${started.stderr}`);
  for (let i = 0; i < 90; i++) {
    if (docker(["exec", container, "pg_isready", "-U", "supabase_admin", "-h", "localhost"]).status === 0 && docker(["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", "select 1"]).status === 0) break;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},2000)"]);
  }
  evidence.networkMode = docker(["inspect", "-f", "{{.HostConfig.NetworkMode}}", container]).stdout.trim();
  const admin = { user: "supabase_admin" };
  psql("postgres", "drop schema auth cascade; drop schema storage cascade; create database rehearsal owner postgres;", admin);
  const platformSql = read("docs/release-review/staging-platform-schema.sql");
  const platform = docker(["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", DB, "-q"], platformSql);
  const errors = `${platform.stdout}${platform.stderr}`.split(/\r?\n/).filter(l => l.includes("ERROR"));
  const unexpected = errors.filter(l => !/already exists|relation "public\.workspaces" does not exist/.test(l));
  if (unexpected.length) throw new Error(`platform: ${unexpected.join(" | ")}`);
  psql(DB, `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
    create extension if not exists "uuid-ossp" with schema extensions; grant usage on schema extensions to postgres, anon, authenticated, service_role;`, admin);
  psql(DB, read("docs/release-review/production-schema.sql"), admin);
  psql(DB, [...platformSql.matchAll(/CREATE POLICY [^;]*?public\.workspaces[\s\S]*?;\n/g)].map(m => m[0]).join(""), admin);
  psql(DB, `create schema supabase_migrations authorization postgres; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    alter table supabase_migrations.schema_migrations owner to postgres;
    insert into supabase_migrations.schema_migrations(version) values ${[...baseline].map(v => `('${v}')`).join(",")};`, admin);
  psql(DB, read("supabase/release-review/populated-baseline-fixture.sql").split("makeborne_populated").join(DB), admin);
  psql(DB, read("supabase/post-deploy/pause_legacy_pilot.sql"));
  const pre = psql(DB, PUBLIC_FUNCTIONS).output.trim().split("\n");
  for (const m of order) {
    const r = psql(DB, readFileSync(m.path, "utf8"), { allowFailure: true });
    if (!r.ok) { evidence.migrationFailure = { file: m.file, error: r.output.slice(-3000) }; throw new Error(`migration ${m.file} failed`); }
    psql(DB, `insert into supabase_migrations.schema_migrations(version,name) values('${m.file.slice(0, 14)}','${m.file.slice(15, -4)}');`);
    evidence.applied.push(m.file);
  }
  evidence.allMigrationsApplied = true;
  evidence.fingerprint = scalar(FINGERPRINT);
  const post = new Set(psql(DB, PUBLIC_FUNCTIONS).output.trim().split("\n"));
  evidence.droppedPublicFunctions = pre.filter(f => !post.has(f));
  evidence.anonExecutableSecurityDefiners = Number(scalar(SECDEF_EXPOSED));
  evidence.recordedVersions = Number(scalar("select count(*) from supabase_migrations.schema_migrations"));
  save();
  const replace = { "check-topup-fulfillment.sql": { "'makeborne_topup_verify','makeborne_topup_isolated'": "'rehearsal'" }, "check-topup-status.sql": { "'makeborne_topup_status_20261013'": "'rehearsal'" } };
  const asAdmin = new Set(["check-publication-controller-boundary.sql"]);
  const checks = readdirSync(join(root, "supabase")).filter(f => /^check-.*\.sql$/.test(f)).sort();
  for (const file of checks) {
    let text = read(`supabase/${file}`);
    for (const [a, b] of Object.entries(replace[file] ?? {})) text = text.split(a).join(b);
    const t0 = Date.now();
    const r = psql(DB, text, { allowFailure: true, user: asAdmin.has(file) ? "supabase_admin" : "postgres", timeout: 240000 });
    const passes = r.output.split("\n").filter(l => /PASS/.test(l)).length;
    const err = (r.output.match(/(ERROR|FATAL):[^\n]*(\n[^\n]*){0,2}/) ?? [""])[0].slice(0, 600);
    evidence.checks[file] = { ok: r.ok, passes, ms: Date.now() - t0, ...(r.timedOut ? { timedOut: true } : {}), ...(r.ok ? {} : { error: err }) };
    // A check that died mid-transaction must not leak: reset connections are per-call, so nothing persists except committed work.
    save();
  }
  evidence.fingerprintAfterChecks = scalar(FINGERPRINT);
} catch (e) {
  evidence.failure = String(e.message ?? e).slice(0, 3000);
} finally {
  evidence.finishedAt = new Date().toISOString();
  const rm = docker(["rm", "-f", container]);
  evidence.containerRemoved = rm.status === 0;
  save();
  const c = Object.values(evidence.checks);
  console.log(JSON.stringify({ scenario, applied: evidence.applied.length, all: !!evidence.allMigrationsApplied, failure: evidence.failure, checks: c.length, ok: c.filter(x => x.ok).length, removed: evidence.containerRemoved }));
}
