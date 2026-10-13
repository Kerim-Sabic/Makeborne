import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const root='work/release-auth-stack/';
const config=JSON.parse(readFileSync(root+'cloud-staging.json','utf8').replace(/^\uFEFF/,''));
const project=JSON.parse(readFileSync(root+'cloud-create-result.json','utf8').replace(/^\uFEFF/,''));
assert.equal(project.ref,'xzwikrunwpurxnxgkznh');assert.equal(project.name,'Makeborne release staging');assert.notEqual(project.ref,config.productionRef);
const db=new pg.Client({host:`db.${project.ref}.supabase.co`,user:'postgres',password:config.password,database:'postgres',port:5432,ssl:{rejectUnauthorized:true,ca:readFileSync(root+'supabase-ca.crt','utf8')},connectionTimeoutMillis:10000});await db.connect();
const report={projectRef:project.ref,productionMutations:0,source:'Exported production application DDL; no customer data',migrations:[],checks:[],startedAt:new Date().toISOString()};
const sha=s=>createHash('sha256').update(s).digest('hex');
try{
 const baseline=JSON.parse(readFileSync('docs/release-review/migrations.json','utf8'));
 const applied=new Set(baseline.files.filter(x=>x.productionApplied).map(x=>x.version));assert.equal(applied.size,20);
 const exists=(await db.query("select to_regclass('public.workspaces') present")).rows[0].present;
 if(!exists){
  const ddl=readFileSync('docs/release-review/production-schema.sql','utf8');
  await db.query('begin');try{await db.query(ddl);await db.query('commit');}catch(e){await db.query('rollback');throw e;}
 }
 await db.query('create schema if not exists makeborne_release_test; revoke all on schema makeborne_release_test from public,anon,authenticated; create table if not exists makeborne_release_test.applied(version text primary key, sha256 text not null)');
 // A schema-only export omits singleton configuration data. Seed the original
 // migration's safe OFF default, never copy production credentials or users.
 await db.query('insert into makeborne_private.billing_settings(singleton,creation_enabled) values(true,false) on conflict do nothing');
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
  const version=file.split('_')[0];if(applied.has(version))continue;
  const sql=readFileSync('supabase/migrations/'+file,'utf8'),hash=sha(sql);
  const existing=(await db.query('select sha256 from makeborne_release_test.applied where version=$1',[version])).rows[0];
  if(existing){assert.equal(existing.sha256,hash,`Changed migration ${file}: repeat rehearsal from baseline`);report.migrations.push({file,sha256:hash,status:'previously_applied'});continue;}
  try{await db.query(sql);}catch(e){await db.query('rollback');throw new Error(`${file}: ${e.message}`);}
  await db.query('insert into makeborne_release_test.applied values($1,$2)',[version,hash]);
  report.migrations.push({file,sha256:hash,status:'applied'});console.log(`Applied ${file}`);
 }
 const settings=(await db.query('select scope,enabled from makeborne_private.live_provider_limits')).rows;
 assert(settings.every(x=>!x.enabled));report.checks.push('All provider spending limits remain disabled');
 const users=(await db.query('select count(*)::int n from auth.users')).rows[0].n;assert.equal(users,0);report.checks.push('No production users copied');
 // Fresh hosted Supabase projects grant broader default table privileges than
 // the exported production project. A pg_dump GRANT does not revoke those.
 // Normalize only this disposable staging project's application-table ACLs,
 // then restore the exact explicit grants from the baseline and migrations.
 const sources=[readFileSync('docs/release-review/production-schema.sql','utf8'),...report.migrations.map(m=>readFileSync('supabase/migrations/'+m.file,'utf8'))];
 await db.query('begin');
 await db.query('revoke all on all tables in schema public from public,anon,authenticated,service_role');
 for(const source of sources)for(const match of source.matchAll(/^\s*grant\s+[\s\S]*?;/gmi))if(/\bon\s+(?:table\s+)?"?public"?\./i.test(match[0]))await db.query(match[0]);
 await db.query('commit');report.checks.push('Staging table grants normalized to exported baseline plus migration grants');
 if(process.argv.includes('--checks'))for(const file of ['check-plan-credit-allocations.sql','check-credit-lots-expiry.sql','check-crm-sales-delivery.sql','check-live-ai-spend.sql','check-hosting-modes.sql']){
  const sql=readFileSync('supabase/'+file,'utf8').replace(/^\\set[^\r\n]*$/gm,'');
  try{await db.query(sql);report.checks.push(`${file}: passed (rolled back)`);console.log(`PASS ${file}`);}catch(e){await db.query('rollback');throw new Error(`${file}: ${e.message}`);}
 }
 report.completedAt=new Date().toISOString();console.log(`PASS cloud staging upgrade: ${report.migrations.length} migrations`);
}catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}finally{writeFileSync('docs/release-review/cloud-database-rehearsal.json',JSON.stringify(report,null,2)+'\n');await db.end();}
