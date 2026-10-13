// Final-candidate database rehearsal in DISPOSABLE local containers only.
//
// Each scenario gets its own fresh Postgres container (the candidate migrations
// create cluster-wide roles, exactly once, as production will). Every container is
// built the same way: Supabase platform schema (docs/release-review/
// staging-platform-schema.sql), the production schema dump (production-schema.sql),
// production's 20 recorded migration versions, and the synthetic populated fixture.
// Migrations and checks then run as "postgres", as `supabase db push` does.
//   full      - every candidate migration in order, then the operator steps and checks
//   fault     - a migration fails midway (injected) and must leave nothing behind;
//               re-running the same file then completes the upgrade
//   interrupt - the rollout stops after the CRM/plan-credit migrations (the previous
//               app still serving), then resumes
// All three must end with the same schema fingerprint. Writes
// docs/release-review/candidate-rehearsal.json. No network, no provider calls.
// Containers are stopped afterwards and left for inspection (remove them by hand).
//
// Usage: node scripts/rehearse-candidate.mjs makeborne_candidate_20261013
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prefix = process.argv[2];
if (!/^makeborne_candidate_[0-9]{8}$/.test(prefix ?? "")) {
  console.error("Refusing: pass a disposable container prefix named makeborne_candidate_YYYYMMDD.");
  process.exit(2);
}
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const PRODUCTION_LAST = "20261007110318";
const IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.002";
const DB = "rehearsal";

const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
function psql(container, db, sql, { allowFailure = false, user = "postgres" } = {}) {
  const result = docker(["exec", "-i", container, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"], sql);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 && !allowFailure) throw new Error(`psql failed on ${container}/${db}:\n${output.slice(-3000)}`);
  return { ok: result.status === 0, output };
}
const scalar = (container, sql) => psql(container, DB, sql).output.trim().split("\n").filter(line => !/^(NOTICE|WARNING)/.test(line)).at(-1) ?? "";
// Pin every consumed input. Concurrent edits must invalidate the evidence,
// never silently mix two candidate definitions between scenarios.
const consumed = new Map();
const read = file => {
  if (!consumed.has(file)) consumed.set(file, readFileSync(join(root, file), "utf8"));
  return consumed.get(file);
};
const sha = text => createHash("sha256").update(text).digest("hex");

// Every local migration production has not recorded, including any that sort before
// production's latest version (they need `supabase db push --include-all`).
const productionVersions = new Set(JSON.parse(readFileSync(join(root, "docs", "release-review", "production-baseline.json"), "utf8")).rows[0].baseline.versions);
const migrations = readdirSync(join(root, "supabase", "migrations")).filter(file => file.endsWith(".sql") && !productionVersions.has(file.slice(0, 14))).sort();
const outOfOrder = migrations.filter(file => file.slice(0, 14) < PRODUCTION_LAST);
const migrationText = file => read(`supabase/migrations/${file}`);
for (const file of migrations) migrationText(file);
const inputs = ["docs/release-review/staging-platform-schema.sql", "docs/release-review/production-schema.sql", "docs/release-review/production-baseline.json",
  "supabase/release-review/populated-baseline-fixture.sql"];

const FINGERPRINT = `select md5(string_agg(x, E'\\n' order by x)) from (
  select 'f:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') x
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and p.prokind in ('f','p')
  union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')
    from information_schema.columns where table_schema in ('public','makeborne_private','makeborne_hosting')
  union all select 'k:'||n.nspname||'.'||c.relname||'.'||k.conname||md5(pg_get_constraintdef(k.oid))
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting')
  union all select 't:'||n.nspname||'.'||c.relname||'.'||t.tgname||md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','makeborne_private','makeborne_hosting')
  union all select 'p:'||schemaname||'.'||tablename||'.'||policyname||md5(coalesce(qual,'')||'|'||coalesce(with_check,''))
    from pg_policies where schemaname in ('public','makeborne_private','makeborne_hosting','storage')
  union all select 'g:'||n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and c.relkind in ('r','v','S')
  union all select 'rls:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and c.relkind='r'
  union all select 'idx:'||n.nspname||'.'||c.relname||':'||pg_get_indexdef(c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and c.relkind='i'
  union all select 'trg:'||n.nspname||'.'||c.relname||':'||t.tgname||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and not t.tgisinternal
  union all select 'gcol:'||n.nspname||'.'||c.relname||'.'||a.attname||':'||coalesce(a.attacl::text,'')
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','makeborne_private','makeborne_hosting') and a.attnum>0 and not a.attisdropped
) s;`;
const DATA = `select json_build_object('users',(select count(*) from auth.users),'clients',(select count(*) from public.clients),
  'clientStage',(select outreach->>'stage' from public.clients limit 1),'versions',(select count(*) from public.artifact_versions),
  'sites',(select count(*) from public.hosted_sites),'pilotReserved',(select reserved_cents from makeborne_private.claude_pilot_budget where id),
  'migrations',(select count(*) from supabase_migrations.schema_migrations))::text`;
const PUBLIC_FUNCTIONS = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1;`;

/** A fresh container holding the production-equivalent populated baseline in database "rehearsal". */
function build(container) {
  const started = docker(["run", "--pull=never", "--network=none", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=makeborne-candidate-local-only", "-e", "POSTGRES_USER=supabase_admin",
    "-e", "POSTGRES_DB=postgres", IMAGE, "postgres", "-D", "/etc/postgresql"]);
  if (started.status !== 0) throw new Error(`Could not start ${container}: ${started.stderr}`);
  for (let attempt = 0; attempt < 90; attempt++) {
    if (docker(["exec", container, "pg_isready", "-U", "supabase_admin", "-h", "localhost"]).status === 0
      && docker(["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", "select 1"]).status === 0) break;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},2000)"]);
  }
  const admin = { user: "supabase_admin" };
  // The image creates auth and storage at boot; the platform dump recreates them.
  psql(container, "postgres", "drop schema auth cascade; drop schema storage cascade; create database rehearsal owner postgres;", admin);
  const platform = docker(["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", DB, "-q"], read(inputs[0]));
  // Expected and harmless: objects the image's template already carries; two storage policies need the app schema first.
  const errors = `${platform.stdout}${platform.stderr}`.split(/\r?\n/).filter(line => line.includes("ERROR"));
  const unexpected = errors.filter(line => !/already exists|relation "public\.workspaces" does not exist/.test(line));
  if (unexpected.length) throw new Error(`Platform schema load failed: ${unexpected.join(" | ")}`);
  // Supabase installs these in every project database (schema "extensions").
  psql(container, DB, `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
    create extension if not exists "uuid-ossp" with schema extensions; grant usage on schema extensions to postgres, anon, authenticated, service_role;`, admin);
  psql(container, DB, read(inputs[1]), admin);
  const policies = [...read(inputs[0]).matchAll(/CREATE POLICY [^;]*?public\.workspaces[\s\S]*?;\n/g)].map(match => match[0]).join("");
  psql(container, DB, policies, admin);
  const versions = JSON.parse(read(inputs[2])).rows[0].baseline.versions;
  psql(container, DB, `create schema supabase_migrations authorization postgres; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    alter table supabase_migrations.schema_migrations owner to postgres;
    insert into supabase_migrations.schema_migrations(version) values ${versions.map(v => `('${v}')`).join(",")};`, admin);
  psql(container, DB, read(inputs[3]).split("makeborne_populated").join(DB), admin);
  return { platformErrorsExpected: errors.length };
}

function apply(container, file, { inject = false } = {}) {
  let text = migrationText(file);
  if (inject) {
    const at = text.lastIndexOf("\ncommit;");
    if (at < 0) throw new Error(`${file} has no final commit to inject before`);
    text = `${text.slice(0, at)}\nselect 1/0; -- injected rehearsal fault\n${text.slice(at)}`;
  }
  const result = psql(container, DB, text, { allowFailure: inject });
  if (result.ok) psql(container, DB, `insert into supabase_migrations.schema_migrations(version,name) values('${file.slice(0, 14)}','${file.slice(15, -4)}');`);
  return result;
}
function check(container, file, replace = {}) {
  let text = read(file);
  for (const [from, to] of Object.entries(replace)) text = text.split(from).join(to);
  return psql(container, DB, text).output.split("\n").filter(line => /PASS/.test(line)).map(line => line.replace(/^.*?(PASS)/, "$1").trim());
}
const pause = container => psql(container, DB, read("supabase/post-deploy/pause_legacy_pilot.sql"));
const stop = container => docker(["stop", container]);

const evidence = { prefix, startedAt: new Date().toISOString(), productionLast: PRODUCTION_LAST, productionTouched: false, providerCalls: 0, image: IMAGE,
  outOfOrder, inputs: inputs.map(file => ({ file, sha256: sha(read(file)) })), candidate: migrations.map(file => ({ file, sha256: sha(migrationText(file)) })), scenarios: {} };
const named = { "makeborne_populated": DB };
writeFileSync(join(root, "docs", "release-review", "candidate-rehearsal.json"), `${JSON.stringify({ ...evidence, passed: false, status: "running" }, null, 2)}\n`);
try {

// 1. Full upgrade, operator steps and checks.
const full = `${prefix}_full_${stamp}`;
try {
  evidence.scenarios.full = { container: full, build: build(full) };
  evidence.baseline = { fingerprint: scalar(full, FINGERPRINT), data: JSON.parse(scalar(full, DATA)) };
  const preFunctions = psql(full, DB, PUBLIC_FUNCTIONS).output.trim().split("\n");
  evidence.baseline.publicFunctions = preFunctions.length;
  pause(full);
  const checks = {};
  for (const file of migrations) {
    if (file === "20261013260000_crm_mail_security_boundaries.sql") {
      const correction = migrationText(file).replace(/^begin;\s*$/m, "").replace(/\ncommit;\s*$/, "");
      checks.mailUpgrade = check(full, "supabase/check-crm-mail-upgrade.sql", { "__CRM_SECURITY_MIGRATION__": correction });
    }
    apply(full, file);
  }
  const fingerprint = scalar(full, FINGERPRINT);
  checks.legacyPause = check(full, "supabase/release-review/check-legacy-pause.sql", named);
  checks.populatedUpgrade = check(full, "supabase/release-review/check-populated-upgrade.sql", named);
  for (const file of ["check-hosting-modes.sql", "check-site-address-changes.sql", "check-site-enquiries.sql", "check-live-ai-spend.sql", "check-credit-lots-expiry.sql",
    "check-credit-wallets.sql", "check-plan-credit-allocations.sql", "check-crm-sales-delivery.sql", "check-generation-caps.sql",
    "check-unlimited-sites.sql", "check-plan-credit-rollover.sql", "check-site-badge-setting.sql", "check-client-review-links.sql",
    "check-client-review-document-assets.sql", "check-ai-operations.sql"]) checks[file] = check(full, `supabase/${file}`);
  // The top-up fixture's database-name guard is narrowed to this freshly
  // created container's rehearsal database. No main/cloud target is accepted.
  if (!full.startsWith(`${prefix}_full_`) || DB !== "rehearsal") throw new Error("Refusing top-up rehearsal target");
  checks.topups = check(full, "supabase/check-topup-fulfillment.sql", { "'makeborne_topup_verify','makeborne_topup_isolated'": "'rehearsal'" });
  checks.topupStatus = check(full, "supabase/check-topup-status.sql", { "'makeborne_topup_status_20261013'": "'rehearsal'" });
  checks.mailSecurity = check(full, "supabase/check-crm-mail-security.sql");
  checks.leadProfile = check(full, "supabase/check-crm-lead-profile.sql");
  checks.mailBoundaries = check(full, "supabase/check-crm-mail-boundaries.sql");
  const post = new Set(psql(full, DB, PUBLIC_FUNCTIONS).output.trim().split("\n"));
  const dropped = preFunctions.filter(fn => !post.has(fn));
  const contract = psql(full, DB, read("supabase/post-deploy/crm_contract_client_stages.sql")).output;
  const afterContract = scalar(full, "select outreach->>'stage' from public.clients limit 1");
  psql(full, DB, "set lock_timeout='30s'; select makeborne_private.crm_freeze_writes('rehearsal rollback');");
  psql(full, DB, "select makeborne_private.crm_rollback_client_stages();");
  psql(full, DB, "select makeborne_private.crm_resume_writes();");
  const crm = { contractReport: /"mode": "contracted"/.test(contract) && /"consistent": true/.test(contract), afterContract,
    afterRollback: scalar(full, "select outreach->>'stage' from public.clients limit 1"), report: JSON.parse(scalar(full, "select makeborne_private.crm_transition_report()::text")) };
  const hosting = { legacyReaderServes: scalar(full, "select public.makeborne_read_hosted_site('preserve-site') is not null") === "t",
    isolatedCopies: Number(scalar(full, "select count(*) from public.hosted_sites where isolated_html is not null")),
    limitsEnabled: Number(scalar(full, "select count(*) from makeborne_private.live_provider_limits where enabled")) };
  Object.assign(evidence.scenarios.full, { fingerprint, data: JSON.parse(scalar(full, DATA)), checks, droppedPublicFunctions: dropped, crm, hosting });
} finally { stop(full); }

// 2. Migration failure midway, then recovery.
const fault = `${prefix}_fault_${stamp}`;
try {
  evidence.scenarios.fault = { container: fault, build: build(fault) };
  pause(fault);
  const targets = new Set(["20261012120000_credit_lots_expiry.sql", "20261013240000_crm_email_automation.sql", "20261013250000_crm_lead_profile.sql", "20261013260000_crm_mail_security_boundaries.sql"]);
  const failures = [];
  for (const file of migrations) {
    if (targets.has(file)) {
      const before = { fingerprint: scalar(fault, FINGERPRINT), data: scalar(fault, DATA) };
      const failed = apply(fault, file, { inject: true });
      const after = { fingerprint: scalar(fault, FINGERPRINT), data: scalar(fault, DATA) };
      failures.push({ migration: file, failed: !failed.ok, error: (failed.output.match(/ERROR:[^\n]*/) ?? [""])[0],
        unchangedAfterFailure: before.fingerprint === after.fingerprint && before.data === after.data });
      if (failed.ok) throw new Error(`Injected failure unexpectedly succeeded: ${file}`);
    }
    apply(fault, file);
  }
  Object.assign(evidence.scenarios.fault, { migrationFaults: failures,
    failed: failures.length === targets.size && failures.every(result => result.failed),
    unchangedAfterFailure: failures.every(result => result.unchangedAfterFailure),
    recoveredFingerprintMatchesFull: scalar(fault, FINGERPRINT) === evidence.scenarios.full.fingerprint });
} finally { stop(fault); }

// 3. Interrupted rollout: stop after the CRM and plan-credit migrations, then resume.
const interrupt = `${prefix}_interrupt_${stamp}`;
try {
  evidence.scenarios.interrupt = { container: interrupt, build: build(interrupt) };
  const preFunctions = psql(interrupt, DB, PUBLIC_FUNCTIONS).output.trim().split("\n");
  pause(interrupt);
  const halt = migrations.indexOf("20261012110000_plan_evidence_and_jobs.sql") + 1;
  for (const file of migrations.slice(0, halt)) apply(interrupt, file);
  const mid = new Set(psql(interrupt, DB, PUBLIC_FUNCTIONS).output.trim().split("\n"));
  Object.assign(evidence.scenarios.interrupt, { stoppedAfter: migrations[halt - 1], appliedBeforeStop: halt,
    oldAppFunctionsMissingWhileStopped: preFunctions.filter(fn => !mid.has(fn)), dataWhileStopped: JSON.parse(scalar(interrupt, DATA)),
    legacySiteServedWhileStopped: scalar(interrupt, "select public.makeborne_read_hosted_site('preserve-site') is not null") === "t" });
  for (const file of migrations.slice(halt)) {
    apply(interrupt, file);
    if (file === "20261013240000_crm_email_automation.sql") {
      const beforeLeadFunctions = new Set(psql(interrupt, DB, PUBLIC_FUNCTIONS).output.trim().split("\n"));
      evidence.scenarios.interrupt.mailBeforeLead = {
        stoppedAfter: file,
        oldAppFunctionsMissing: preFunctions.filter(fn => !beforeLeadFunctions.has(fn)),
        legacySiteServed: scalar(interrupt, "select public.makeborne_read_hosted_site('preserve-site') is not null") === "t",
        leadColumnsAbsent: scalar(interrupt, "select count(*) from information_schema.columns where table_schema='public' and table_name='clients' and column_name in ('tags','deal_value','deal_currency','lead_source','lead_profile')") === "0",
        mailSecurityChecks: check(interrupt, "supabase/check-crm-mail-security.sql"),
      };
    }
  }
  evidence.scenarios.interrupt.resumedFingerprintMatchesFull = scalar(interrupt, FINGERPRINT) === evidence.scenarios.full.fingerprint;
} finally { stop(interrupt); }

const { full: f, fault: x, interrupt: i } = evidence.scenarios;
evidence.finishedAt = new Date().toISOString();
evidence.consumedInputs = [...consumed].map(([file, text]) => ({ file, sha256: sha(text) }));
evidence.changedInputs = evidence.consumedInputs.filter(input => sha(readFileSync(join(root, input.file), "utf8")) !== input.sha256).map(input => input.file);
const finalMigrations = readdirSync(join(root, "supabase", "migrations")).filter(file => file.endsWith(".sql") && !productionVersions.has(file.slice(0, 14))).sort();
evidence.migrationListStable = JSON.stringify(finalMigrations) === JSON.stringify(migrations);
evidence.passed = x.failed && x.unchangedAfterFailure && x.recoveredFingerprintMatchesFull && i.resumedFingerprintMatchesFull && i.legacySiteServedWhileStopped
  && i.mailBeforeLead.oldAppFunctionsMissing.length === 0 && i.mailBeforeLead.legacySiteServed && i.mailBeforeLead.leadColumnsAbsent && i.mailBeforeLead.mailSecurityChecks.length > 0
  && i.oldAppFunctionsMissingWhileStopped.length === 0 && f.droppedPublicFunctions.length === 0 && f.crm.contractReport && f.crm.afterContract === "Conversation"
  && f.crm.afterRollback === "Meeting" && f.crm.report.consistent === true && f.hosting.legacyReaderServes && f.hosting.limitsEnabled === 0
  && Object.values(f.checks).every(list => list.length > 0) && evidence.changedInputs.length === 0 && evidence.migrationListStable;
writeFileSync(join(root, "docs", "release-review", "candidate-rehearsal.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ passed: evidence.passed, migrations: migrations.length, outOfOrder, fingerprint: f.fingerprint, dropped: f.droppedPublicFunctions, crm: f.crm, hosting: f.hosting,
  fault: x, interrupt: { ...i, dataWhileStopped: undefined }, checks: Object.fromEntries(Object.entries(f.checks).map(([key, list]) => [key, list.length])) }, null, 2));
process.exit(evidence.passed ? 0 : 1);
} catch (error) {
  evidence.passed = false;
  evidence.status = "failed";
  evidence.finishedAt = new Date().toISOString();
  evidence.failure = error instanceof Error ? error.message.slice(0, 3000) : "Rehearsal failed";
  writeFileSync(join(root, "docs", "release-review", "candidate-rehearsal.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
}
