// Read-only: how makeborne_private is protected in production (schema exposure, USAGE, RLS convention).
import fs from "node:fs"; import pg from "pg"; import { rootCertificates } from "node:tls";
const MAIN = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app";
let pw = fs.readFileSync(`${MAIN}/.env.production-db.private`, "utf8").replace(/^\uFEFF/, "").match(/^SUPABASE_PRODUCTION_DB_PASSWORD\s*=\s*([^\r\n]+)/m)[1].trim(); if (pw.startsWith('"')) pw = JSON.parse(pw);
const token = fs.readFileSync("C:/Users/kerim/.supabase/access-token", "utf8").trim();
const api = r => fetch(`https://api.supabase.com/v1/projects/rklojnmmsmhwnkbzuidp${r}`, { headers: { Authorization: `Bearer ${token}` } }).then(x => x.json());
const pool = (await api("/config/database/pooler")).find(p => p.database_type === "PRIMARY"); const url = new URL(pool.connection_string ?? pool.connectionString);
const db = new pg.Client({ host: url.hostname, port: 5432, user: url.username, password: pw, database: "postgres", ssl: { rejectUnauthorized: true, ca: rootCertificates.join("\n") + "\n" + fs.readFileSync(`${MAIN}/work/release-auth-stack/supabase-ca.crt`, "utf8") } });
await db.connect(); await db.query("begin read only");
const q = async s => (await db.query(s)).rows;
const out = {
  exposedSchemas: (await api("/postgrest")).db_schema,
  privateSchemaUsage: await q("select r.rolname, has_schema_privilege(r.rolname,'makeborne_private','USAGE') usage from pg_roles r where r.rolname in ('anon','authenticated','service_role')"),
  newTablePrivileges: await q("select t, r, has_table_privilege(r, 'makeborne_private.'||t, 'SELECT') sel, has_table_privilege(r, 'makeborne_private.'||t, 'INSERT,UPDATE,DELETE') write from unnest(array['app_error_groups','app_error_days','telemetry_salts','studio_visits']) t, unnest(array['anon','authenticated']) r"),
  privateTablesRls: await q("select count(*) filter (where c.relrowsecurity)::int rls_on, count(*) filter (where not c.relrowsecurity)::int rls_off from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='makeborne_private' and c.relkind='r'"),
  examplesWithoutRls: await q("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='makeborne_private' and c.relkind='r' and not c.relrowsecurity and c.relname not in ('app_error_groups','app_error_days','telemetry_salts','studio_visits') order by 1 limit 6"),
};
await db.query("commit"); await db.end(); console.log(JSON.stringify(out, null, 2));
