// Disposable container only. No main/staging/production database is accessed.
import { checkOperationConcurrency } from "./check-ai-operations-concurrency.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const prefix = process.argv[2];
if (!/^makeborne_operations_[0-9]{8}$/.test(prefix ?? "")) {
  console.error("Refusing: pass a disposable container prefix named makeborne_operations_YYYYMMDD.");
  process.exit(2);
}
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.002";
const DB = "rehearsal";

const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
function psql(container, db, sql, { allowFailure = false, user = "postgres" } = {}) {
  const result = docker(["exec", "-i", container, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At"], sql);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 && !allowFailure) throw new Error(`psql failed on ${container}/${db}:\n${output.slice(-3000)}`);
  return { ok: result.status === 0, output };
}
const read = file => readFileSync(join(root, file), "utf8");

// Every local migration production has not recorded, including any that sort before
// production's latest version (they need `supabase db push --include-all`).
const productionVersions = new Set(JSON.parse(readFileSync(join(root, "docs", "release-review", "production-baseline.json"), "utf8")).rows[0].baseline.versions);
const migrations = readdirSync(join(root, "supabase", "migrations")).filter(file => file.endsWith(".sql") && !productionVersions.has(file.slice(0, 14))).sort();
const migrationText = file => read(`supabase/migrations/${file}`);
const inputs = ["docs/release-review/staging-platform-schema.sql", "docs/release-review/production-schema.sql", "docs/release-review/production-baseline.json",
  "supabase/release-review/populated-baseline-fixture.sql"];

/** A fresh container holding the production-equivalent populated baseline in database "rehearsal". */
function build(container) {
  const started = docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=makeborne-candidate-local-only", "-e", "POSTGRES_USER=supabase_admin",
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

const container = prefix + '_' + stamp;
try {
 console.log('Creating disposable operation database ' + container);
 build(container);
 for (const file of migrations) { psql(container, DB, migrationText(file)); }
 console.log('Migrations applied to disposable database');
 psql(container, DB, read('supabase/check-ai-operations.sql'));
 console.log('PASS operation SQL regression suite');
 await checkOperationConcurrency(container);
 console.log('DISPOSABLE_CONTAINER=' + container);
} finally { docker(['stop',container]); }
