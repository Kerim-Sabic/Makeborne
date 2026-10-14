/** Local separate-transaction/restricted LOGIN result race. No provider/network generation. */
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from 'pg';
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE){console.log('NOT RUN: explicit local verification and ignored configuration required.');process.exit(2);}
let admin,first,second,fixture,baseline,created=false,loginCreated=false,pending,stage='configuration';
const name=`makeborne_result_probe_${randomUUID().replaceAll('-','').slice(0,12)}`;
const password=randomBytes(32).toString('hex');
const sql='select makeborne_private.commit_generation_worker_result($1,$2,$3,$4,0,\'anthropic\',\'offline\',\'fixture-v1\',$5,$6,$7,$8,\'[]\',\'Generated source\') as result';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const config=JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,''));
 const url=new URL(config.DB_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');assert.equal(url.pathname,'/postgres');
 const connect=async(worker=false)=>{const target=new URL(url);if(worker){target.username=name;target.password=password;}
   const c=new Client({connectionString:target.href,connectionTimeoutMillis:2000,query_timeout:7000,options:`-c statement_timeout=6000${worker?' -c role=makeborne_generation_worker':''}`});c.on('error',()=>{});await c.connect();return c;};
 admin=await connect();stage='fixture';
 baseline=(await admin.query("select scope,enabled,emergency_stop,vendor_limit,concurrency_limit from makeborne_private.generation_execution_caps where scope in ('global','anthropic')")).rows;
 assert(baseline.every(row=>!row.enabled),'LOCAL_CAPS_MUST_START_DISABLED');
 const check=await readFile(new URL('./check-generation-result.sql',import.meta.url),'utf8');
 let setup=check.slice(0,check.indexOf(" perform set_config('request.jwt.claims'"));
 setup=setup.replace(/^.*\n/,'').replace('begin;','begin; create temporary table generation_result_fixture(fixture jsonb);');
 setup=setup.replace(/ -- This single rolled-back transaction[\s\S]*?update makeborne_private\.generation_reservations set dispatch_started_at=transaction_timestamp\(\) where id=job\.reservation_id;\n/,'');
 setup+=`insert into pg_temp.generation_result_fixture values(jsonb_build_object('actor',actor,'session',session_uuid,'workspace',workspace,'artifact',artifact,'job',job.id,'worker',worker,'fence',job.fence::text,'dispatch',dispatch,'content',content,'style',style)); end $$;commit;`;
 await admin.query(setup);created=true;fixture=(await admin.query('select fixture from pg_temp.generation_result_fixture')).rows[0].fixture;
 await admin.query(`create role "${name}" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);loginCreated=true;
 await admin.query(`grant makeborne_generation_worker to "${name}"`);
 first=await connect(true);second=await connect(true);
 const args=[fixture.job,fixture.worker,fixture.fence,fixture.dispatch,`local-result-${fixture.job}`,'e'.repeat(64),fixture.content,fixture.style];
 stage='atomic commit contention';
 await first.query('begin');
 const a=(await first.query(sql,args)).rows[0].result;
 let finished=false;pending=second.query(sql,args).then(value=>{finished=true;return value;});
 const pid=(await admin.query('select pid from pg_stat_activity where usename=$1 and pid<>$2 order by backend_start desc limit 1',[name,first.processID])).rows[0].pid;
 let locked=false;
 for(let i=0;i<30;i++){locked=(await admin.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1",[pid])).rows[0]?.locked;if(locked)break;await sleep(25);}
 assert(locked&&!finished,'REPLAY_MUST_WAIT_FOR_COMMIT');await first.query('commit');
 const b=(await pending).rows[0].result;pending=null;
 assert.equal(a.versionId,b.versionId);assert.equal(a.outcomeId,b.outcomeId);assert.equal(b.replayed,true);
 const counts=(await admin.query(`select (select count(*) from public.artifact_versions where artifact_id=$1)::int as versions,
 (select count(*) from makeborne_private.cloud_mutation_receipts where workspace_id=$2)::int as receipts,
 (select count(*) from makeborne_private.generation_provider_outcomes where job_id=$3)::int as outcomes,
 (select count(*) from public.usage_ledger where job_id=$3)::int as usage`,[fixture.artifact,fixture.workspace,fixture.job])).rows[0];
 assert.deepEqual(counts,{versions:1,receipts:1,outcomes:1,usage:1});
 for(const c of [first,second]){
   const context=(await c.query("select current_setting('request.jwt.claim.sub',true) as actor,current_setting('request.jwt.claim.role',true) as role,current_setting('request.jwt.claims',true) as claims")).rows[0];
   assert(!context.actor&&!context.role&&!context.claims,'ACTOR_CONTEXT_MUST_NOT_LEAK');
 }
 console.log('PASS actual restricted LOGIN commits across separate transactions with real dispatch time; concurrent replay waits and saves/records exactly once');
 stage='canonical writer race';
 await admin.query('begin');
 await admin.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[fixture.actor]);
 await admin.query("select makeborne_private.save_idempotent_version($1,$2,1,$3,$4,'[]','Later customer edit',$5)",[fixture.workspace,fixture.artifact,{...fixture.content,title:'Later customer edit'},fixture.style,randomUUID()]);
 const rejected=second.query(sql,args).then(()=>null,error=>error.code);await sleep(100);await admin.query('commit');
 assert.equal(await rejected,'PT409');
 assert.equal((await admin.query('select count(*)::int as n from public.artifact_versions where artifact_id=$1',[fixture.artifact])).rows[0].n,2);
 console.log('PASS concurrent canonical customer edit wins; worker replay cannot replace a later revision');
 console.log(`PASS local atomic result fixture ${fixture.workspace}; no paid call, build, publication or customer debit`);
}catch(error){console.error(`LOCAL RESULT QUALIFICATION FAILED at ${stage}: ${typeof error?.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION'}; driver/configuration details omitted.`);process.exitCode=1;}
finally{
 await first?.query('rollback').catch(()=>{});await admin?.query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});
 await first?.end();await second?.end();
 if(created&&fixture){try{
   const outcome=(await admin.query('select id from makeborne_private.generation_provider_outcomes where job_id=$1',[fixture.job])).rows[0];
   if(!outcome)await admin.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,'anthropic','offline','fixture-v1',$3,$4,null)",[fixture.job,fixture.dispatch,`local-result-${fixture.job}`,'e'.repeat(64)]);
   const latest=(await admin.query('select run_revision from public.generation_jobs where id=$1',[fixture.job])).rows[0];
   await admin.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[fixture.job,fixture.actor,latest.run_revision,'f'.repeat(64)]);
   await admin.query('update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1',[fixture.workspace]);
   await admin.query('delete from auth.sessions where id=$1',[fixture.session]);
   await admin.query('delete from makeborne_private.account_privileges where user_id=$1',[fixture.actor]);
   for(const cap of baseline)await admin.query('update makeborne_private.generation_execution_caps set enabled=$2,emergency_stop=$3,vendor_limit=$4,concurrency_limit=$5 where scope=$1',[cap.scope,cap.enabled,cap.emergency_stop,cap.vendor_limit,cap.concurrency_limit]);
   console.log('PASS immutable synthetic zero-cost receipts retained in stopped fixture; holds settled with no customer charge, session/grant removed, cap policies restored');
 }catch{console.error('FAIL scoped local fixture cleanup requires review');process.exitCode=1;}}
 if(loginCreated){try{await admin.query(`drop role "${name}"`);console.log('PASS ephemeral restricted LOGIN removed');}catch{console.error('FAIL temporary LOGIN cleanup requires review');process.exitCode=1;}}
 await admin?.end();
}
