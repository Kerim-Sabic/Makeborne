// Offline contract + real disposable PostgreSQL admission tests. No provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import ts from 'typescript';
import {localConfig,cleanEnv,sourceInventory,canonical,ledger} from './fresh-quality-common.mjs';
const local=localConfig(),admin=new pg.Client({connectionString:local.DB_URL}),name='fresh_quality_guard_'+randomUUID().replaceAll('-','');
assert.match(name,/^fresh_quality_guard_[a-f0-9]{32}$/);
const url=new URL(local.DB_URL);url.pathname='/'+name;
const db=new pg.Client({connectionString:url.href}),peer=new pg.Client({connectionString:url.href});let created=false,groups=0;
const actor=randomUUID(),workspace=randomUUID(),artifact=randomUUID(),op=randomUUID(),step=randomUUID(),action=randomUUID();
const sql=fs.readFileSync('scripts/fresh-quality-guard.sql','utf8');
async function reset(){await db.query('truncate makeborne_quality_local.calls,makeborne_private.live_provider_calls');await db.query("update makeborne_quality_local.package set enabled=true,day=(clock_timestamp() at time zone 'UTC')::date,deadline=clock_timestamp()+interval '30 minutes',active_action='book',controller_pid=pg_backend_pid(),heartbeat_until=clock_timestamp()+interval '30 minutes'");await db.query("update makeborne_private.ai_operations set input_hash='fixed',rate_microusd=30000,status='active',action_key=$1",[action]);await db.query("update makeborne_private.ai_operation_runs set input_hash='fixed',step_key=$1",[step]);}
async function insert(client=db,overrides={}){const c={id:randomUUID(),user:actor,run:'fixed-run',provider:'anthropic',model:'claude-opus-5-5',bound:100,source:'live',...overrides};return client.query("insert into makeborne_private.live_provider_calls(id,user_id,run_reference,provider,model,bound_microusd,source,day) values($1,$2,$3,$4,$5,$6,$7,current_date)",[c.id,c.user,c.run,c.provider,c.model,c.bound,c.source]);}
async function denied(fn,code='MB423'){await assert.rejects(fn,error=>error.code===code);}
try{
 await admin.connect();const baseline=canonical(await ledger(admin)),limits=canonical((await admin.query('select * from makeborne_private.live_provider_limits order by scope')).rows);
 const clean=cleanEnv(local,'');for(const key of ['NODE_OPTIONS','HTTP_PROXY','HTTPS_PROXY','ANTHROPIC_BASE_URL','VERCEL_TOKEN'])assert(!Object.hasOwn(clean,key));assert.equal(clean.ANTHROPIC_API_KEY,'');groups++;
 const canonicalCode=ts.transpileModule(fs.readFileSync('src/lib/projects/canonical-json.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
 const {canonicalSourceJson}=await import('data:text/javascript;base64,'+Buffer.from(canonicalCode).toString('base64'));
 const normalized={workspaceId:workspace,artifactId:artifact,expectedVersion:0,message:'A fresh brief',effort:'high',attachments:[],mode:'build'};assert.equal(canonical(normalized),canonicalSourceJson(normalized));groups++;
 const inventory=sourceInventory();for(const file of ['src/lib/documents/book-markup.ts','src/lib/documents/slide-scene.ts','src/lib/documents/render-deck.ts','src/lib/documents/export-server.ts'])assert(inventory[file]);assert(Object.keys(inventory).length>100);groups++;
 for(const args of [['scripts/fresh-quality-server.mjs','--dry-run'],['scripts/qualify-fresh-products.mjs','book','--dry-run'],['scripts/qualify-fresh-products.mjs','deck','--dry-run'],['scripts/qualify-fresh-products.mjs','deck-edit','--dry-run']]){const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.providerRequests,0);assert.equal(result.dbWrites,0);}groups++;
 await admin.query(`create database ${name}`);created=true;await db.connect();await peer.connect();
 await db.query(`create schema makeborne_private;
 create table makeborne_private.ai_operations(id uuid primary key,actor uuid,action_key uuid,kind text,effort text,workspace_id uuid,artifact_id uuid,input_hash text,initial_version integer,rate_microusd bigint,authorized_credits bigint,status text,expires_at timestamptz);
 create table makeborne_private.ai_operation_runs(reference text primary key,operation_id uuid,step_key uuid,kind text,status text,expires_at timestamptz,input_hash text,expected_version integer);
 create table makeborne_private.live_provider_calls(id uuid primary key,user_id uuid,run_reference text,provider text,model text,bound_microusd bigint,charged_microusd bigint,source text,day date);
 `);await db.query(sql);
 await db.query("insert into makeborne_quality_local.package values(true,$1,$2,true,current_date,clock_timestamp()+interval '30 minutes',6000000,'book',pg_backend_pid(),clock_timestamp()+interval '30 minutes')",[randomUUID(),actor]);
 await db.query("insert into makeborne_quality_local.actions values('book',$1,$2,2700000,'high',$3,$4,'fixed',0,true)",[action,step,workspace,artifact]);
 await db.query("insert into makeborne_private.ai_operations values($1,$2,$3,'build','high',$4,$5,'fixed',0,30000,90,'active',clock_timestamp()+interval '30 minutes')",[op,actor,action,workspace,artifact]);
 await db.query("insert into makeborne_private.ai_operation_runs values('fixed-run',$1,$2,'build','active',clock_timestamp()+interval '30 minutes','fixed',0)",[op,step]);
 await insert();assert.equal((await db.query('select count(*)::int n from makeborne_quality_local.calls')).rows[0].n,1);groups++;
 for(const override of [{user:randomUUID()},{run:'unknown'},{provider:'openai'},{model:'other'},{source:'fixture'},{bound:0}])await denied(()=>insert(db,override));groups++;
 for(const statement of ["update makeborne_private.ai_operations set input_hash='changed'","update makeborne_private.ai_operations set rate_microusd=29999","update makeborne_private.ai_operations set action_key=gen_random_uuid()","update makeborne_private.ai_operation_runs set step_key=gen_random_uuid()","update makeborne_private.ai_operation_runs set input_hash='changed'"]){await reset();await db.query(statement);await denied(()=>insert());}groups++;
 for(const statement of ["update makeborne_quality_local.package set enabled=false","update makeborne_quality_local.package set active_action=null","update makeborne_quality_local.package set heartbeat_until=clock_timestamp()-interval '1 second'","update makeborne_quality_local.package set controller_pid=-1","update makeborne_quality_local.package set day=current_date-1","update makeborne_quality_local.package set deadline=clock_timestamp()+interval '299 seconds'"]){await reset();await db.query(statement);await denied(()=>insert());}groups++;
 await reset();await insert(db,{bound:2700000});await denied(()=>insert(), 'MB402');groups++;
 await reset();await insert(db,{bound:2699800});const race=await Promise.allSettled([insert(db,{bound:200}),insert(peer,{bound:200})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected'&&x.reason.code==='MB402').length,1);assert.equal((await db.query('select sum(bound_microusd)::text n from makeborne_private.live_provider_calls')).rows[0].n,'2700000');groups++;
 // Previous-day unknown outcome still uses its full bound; rotation cannot erase exposure.
 await reset();await insert(db,{bound:2700000});await db.query('update makeborne_private.live_provider_calls set day=current_date-1');await denied(()=>insert(),'MB402');
 await db.query("update makeborne_quality_local.package set active_action=null,enabled=false");await db.query('update makeborne_private.live_provider_calls set charged_microusd=100');assert.equal((await db.query('select charged_microusd::text n from makeborne_private.live_provider_calls')).rows[0].n,'100');await denied(()=>insert());groups++;
 // Sum across all three actions exactly 6M, then refuse another microUSD.
 await reset();await insert(db,{bound:2700000});for(const [label,cap,effort,credits] of [['deck',2700000,'high',90],['deck-edit',600000,'light',20]]){const a=randomUUID(),s=randomUUID();await db.query('insert into makeborne_quality_local.actions values($1,$2,$3,$4,$5,$6,$7,$8,0,true)',[label,a,s,cap,effort,workspace,artifact,'fixed']);await db.query('update makeborne_quality_local.package set active_action=$1',[label]);await db.query('update makeborne_private.ai_operations set action_key=$1,effort=$2,authorized_credits=$3',[a,effort,credits]);await db.query('update makeborne_private.ai_operation_runs set step_key=$1',[s]);await insert(db,{bound:cap});}assert.equal((await db.query('select sum(bound_microusd)::text n from makeborne_private.live_provider_calls')).rows[0].n,'6000000');await denied(()=>insert(db,{bound:1}),'MB402');groups++;
 for(const role of ['anon','authenticated','service_role']){await db.query(`set role ${role}`);try{await denied(()=>db.query('update makeborne_quality_local.package set enabled=true'),'42501');}finally{await db.query('reset role');}}groups++;
 assert.equal(canonical(await ledger(admin)),baseline,'OLD_CALLS_MUTATED');assert.equal(canonical((await admin.query('select * from makeborne_private.live_provider_limits order by scope')).rows),limits,'ACTUAL_LIMITS_MUTATED');groups++;
 console.log(JSON.stringify({passed:groups,providerRequests:0,actualAuthDatabaseWrites:0,disposableDatabase:true,sourceFiles:Object.keys(inventory).length,scope:'Exact trigger with minimal representative tables; actual API/export smoke check remains root-owned'}));
}finally{await peer.end().catch(()=>{});await db.end().catch(()=>{});if(created)await admin.query(`drop database ${name}`);await admin.end();}
