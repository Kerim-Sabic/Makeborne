/** Compare pending hosting/GitHub migrations with real local catalogues. All shadow DDL rolls back. */
import {readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";

if (process.env.MAKEBORNE_VERIFY_LOCAL_MIGRATIONS !== "true") {
  console.log("NOT RUN: set MAKEBORNE_VERIFY_LOCAL_MIGRATIONS=true for the dedicated local database.");
  process.exit(2);
}
const migrationFiles = ["20261005013948_hosted_websites.sql", "20261005021953_github_repository_connections.sql"];
const shadows = {public: "makeborne_reconcile_public", hosting: "makeborne_reconcile_hosting"};
const migrations = await Promise.all(migrationFiles.map(async file => ({file, sql: await readFile(`supabase/migrations/${file}`, "utf8")})));
const rewrite = sql => sql.replace(/^\s*(begin|commit);\s*$/gmi, "")
  .replaceAll("makeborne_hosting", shadows.hosting)
  .replaceAll("public.hosted_sites", `${shadows.public}.hosted_sites`)
  .replaceAll("public.github_connections", `${shadows.public}.github_connections`)
  .replaceAll("public.github_website_links", `${shadows.public}.github_website_links`)
  .replaceAll("public.makeborne_save_hosted_site", `${shadows.public}.makeborne_save_hosted_site`)
  .replaceAll("public.makeborne_read_hosted_site", `${shadows.public}.makeborne_read_hosted_site`);

const snapshotFunction = `
create function pg_temp.makeborne_catalogue(p_public text,p_hosting text) returns jsonb
language sql stable set search_path='' as $catalogue$
 select jsonb_build_object(
  'tables',(select jsonb_agg(jsonb_build_object(
    'name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'persistence',c.relpersistence,'replicaIdentity',c.relreplident,
    'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
      'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type)
      from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
      'default',pg_get_expr(d.adbin,d.adrelid),'collation',co.collname) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      left join pg_collation co on co.oid=a.attcollation where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,true),
      'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    'indexes',(select jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
      'valid',i.indisvalid,'ready',i.indisready) order by ic.relname) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
    'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
      'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r),
      'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid,true) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
  ) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=p_public and c.relkind='r' and c.relname in ('hosted_sites','github_connections','github_website_links')),
  'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
    'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
      'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=p_hosting or
      (n.nspname=p_public and p.proname in ('makeborne_save_hosted_site','makeborne_read_hosted_site'))),
  'hostingSchema',(select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
    'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
      'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type)
      from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x)) from pg_namespace n where n.nspname=p_hosting)
 );
$catalogue$;
`;
const sql = `begin;
set local statement_timeout='20s';
set local lock_timeout='2s';
do $$ begin if to_regnamespace('${shadows.public}') is not null or to_regnamespace('${shadows.hosting}') is not null
 then raise exception 'Shadow namespace already exists; inspection required'; end if; end $$;
create schema ${shadows.public};
-- Public has schema-specific default grants in Supabase. Reproduce them in the
-- shadow so comparison reflects the migration's real creation environment.
do $defaults$ declare g record; begin
 for g in select d.defaclobjtype,x.grantee,x.privilege_type,x.is_grantable
  from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace,
    lateral aclexplode(d.defaclacl) x
  where n.nspname='public' and d.defaclrole=current_user::regrole and d.defaclobjtype in ('r','f','S')
 loop
  execute format('alter default privileges in schema %I grant %s on %s to %s%s',
   '${shadows.public}',g.privilege_type,
   case g.defaclobjtype when 'r' then 'tables' when 'f' then 'functions' else 'sequences' end,
   case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
   case when g.is_grantable then ' with grant option' else '' end);
 end loop;
end $defaults$;
${migrations.map(({sql}) => rewrite(sql)).join("\n")}
${snapshotFunction}
select jsonb_build_object('actual',pg_temp.makeborne_catalogue('public','makeborne_hosting'),
 'expected',pg_temp.makeborne_catalogue('${shadows.public}','${shadows.hosting}'));
rollback;
`;
const output = await new Promise((resolve, reject) => {
  const child = spawn("docker", ["exec", "-i", "supabase_db_makeborne-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    {windowsHide: true, timeout: 30000, stdio: ["pipe", "pipe", "pipe"]});
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => {stdout += bytes;}); child.stderr.on("data", bytes => {stderr += bytes;});
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve(stdout) : reject(new Error(`Local catalogue comparison failed: ${stderr.slice(0, 1500)}`)));
  child.stdin.on("error", reject); child.stdin.end(sql);
});
const raw = JSON.parse(output.trim());
const normalise = value => JSON.parse(JSON.stringify(value).replaceAll(shadows.public, "public").replaceAll(shadows.hosting, "makeborne_hosting"));
// Compare functions by stable definition after normalising shadow namespaces.
const actual = normalise(raw.actual), expected = normalise(raw.expected);
actual.functions?.sort((a, b) => a.definition.localeCompare(b.definition));
expected.functions?.sort((a, b) => a.definition.localeCompare(b.definition));
const differences = [];
function compare(a, b, at = "catalogue") {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], `${at}.${key}`);
  } else differences.push({path: at, actual: a ?? null, expected: b ?? null});
}
compare(actual, expected);
const result = {checkedAt: new Date().toISOString(), environment: "dedicated_local_database", transaction: "shadow_definitions_rolled_back",
  migrations: migrations.map(({file, sql}) => ({file, sha256: createHash("sha256").update(sql).digest("hex")})),
  status: differences.length ? "mismatch" : "match", differences, actual, expected};
if (process.env.MAKEBORNE_MIGRATION_PARITY_OUTPUT) await writeFile(process.env.MAKEBORNE_MIGRATION_PARITY_OUTPUT, JSON.stringify(result, null, 2) + "\n");
console.log(`Local migration catalogue ${result.status}: ${differences.length} differences across tables, constraints, indexes, policies, triggers, functions, owners and grants.`);
for (const difference of differences) console.log(difference.path);
assert.equal(differences.length, 0, "Existing objects differ from repository migrations; do not repair history as applied.");
