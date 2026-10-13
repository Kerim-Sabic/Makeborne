// Concurrency qualification ONLY in this suite's own disposable container.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function checkOperationConcurrency(container) {
  assert.match(container, /^makeborne_operations_\d{8}_\d{14}$/);
  const query = sql => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'rehearsal', '-v', 'ON_ERROR_STOP=1', '-Atq']);
    let output = '', error = '';
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => error += x);
    child.on('error', reject); child.on('close', code => resolve({ code, output: output.trim(), error })); child.stdin.end(sql);
  });
  const one = async sql => { const r = await query(sql); assert.equal(r.code, 0, r.error); return JSON.parse(r.output.split('\n').at(-1)); };
  const u=randomUUID(), w=randomUUID(), p=randomUUID(), a=randomUUID(), hash='a'.repeat(64);
  await one(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@operation-concurrency.invalid',now());
    update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
    insert into public.workspaces(id,name,owner_id) values('${w}','Operation concurrent fixture','${u}');
    insert into public.projects(id,workspace_id,title,kind) values('${p}','${w}','Fixture','website');
    insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${a}','${w}','${p}','Fixture','website');
    select public.makeborne_credit_grant('${u}',500,'topup','concurrency-fixture','{}');`);
  const op=await one(`select public.makeborne_ai_operation_create('${u}','${w}','${a}','${randomUUID()}','build','medium','${hash}',0,50,30000,'{}');`);
  const begin = step => `select public.makeborne_ai_operation_begin('${u}','${op.id}','${step}','build','${hash}',0,50);`;
  const results=await Promise.all([one(begin(randomUUID())),one(begin(randomUUID()))]);
  assert.equal(results.filter(r=>r.error?.code==='OPERATION_BUSY').length,1);
  const run=results.find(r=>r.run).run;
  const finish=`select public.makeborne_ai_operation_finish('${u}','${run.id}','${run.fence}',30000,'incomplete','{}',null);`;
  const finished=await Promise.all([one(finish),one(finish)]);
  assert.equal(finished.filter(r=>r.replayed).length,1);
  assert(finished.every(r=>r.operation.chargedCredits===1));
  const consent=request=>`select public.makeborne_ai_operation_authorize('${u}','${op.id}',1,'${request}',50);`;
  const consentResults=await Promise.all([query(consent(randomUUID())),query(consent(randomUUID()))]);
  assert.equal(consentResults.filter(r=>r.code===0).length,1);
  assert.match(consentResults.find(r=>r.code!==0).error,/Authorization conflict/);
  const x=await one(begin(randomUUID()));
  await one(`select makeborne_private.set_live_provider_limit('global',true,10000000,false,'Concurrent operation fixture');
    select makeborne_private.set_live_provider_limit('anthropic',true,10000000,false,'Concurrent operation fixture');`);
  const provider=call=>`select public.makeborne_ai_operation_provider_begin('${u}','${x.run.id}','${x.run.fence}','${call}','anthropic','fixture',1000000);`;
  const calls=await Promise.all([one(provider(randomUUID())),one(provider(randomUUID()))]);
  assert.equal(calls.filter(r=>r.started).length,1);
  assert.equal(calls.filter(r=>r.error?.code==='OPERATION_BUDGET_REACHED').length,1);
  const state=await one(`select public.makeborne_ai_operation_read('${u}','${w}','${a}','${op.id}',null);`);
  assert.equal(state.operation.chargedCredits,1);
  assert(state.operation.reservedCredits+state.operation.chargedCredits<=state.operation.authorizedCredits);
  console.log('PASS concurrent child allocation, finalization replay, consent revision, provider allocation');

  // Race an artifact deletion holding the artifact lock against a finalizer
  // holding operation/wallet locks. PostgreSQL can abort either conflicting
  // transaction; retrying deletion must leave one durable billing outcome.
  const candidate={expectedVersion:0,summary:'Race fixture',content:{schemaVersion:1,kind:'website',title:'Generated',sections:[]},
    style:{id:'test',name:'Test',version:1,typography:{headingFont:'Inter',bodyFont:'Inter'},colors:{},description:'',referenceAssetIds:[]},assetIds:[]};
  const deleteSql = artifact => `begin; select id from public.artifacts where id='${artifact}' for update; select pg_sleep(0.15); delete from public.artifacts where id='${artifact}'; commit;`;
  const race=await Promise.all([query(deleteSql(a)),query(`select public.makeborne_ai_operation_finish('${u}','${x.run.id}','${x.run.fence}',30000,'saved','{"finished":true}','${JSON.stringify(candidate)}');`)]);
  if(race[0].code!==0){ assert.match(race[0].error,/deadlock detected/); const retry=await query(deleteSql(a));assert.equal(retry.code,0,retry.error); }
  if(race[1].code!==0) assert.match(race[1].error,/deadlock detected|Operation unavailable/);
  const deleted=await one(`select json_build_object('artifact',(select count(*) from public.artifacts where id='${a}'),
    'run',(select count(*) from makeborne_private.ai_operation_runs where id='${x.run.id}'),
    'hold',(select status from makeborne_private.credit_reservations where user_id='${u}' and reference='${x.run.reference}'),
    'releases',(select count(*) from public.credit_ledger where user_id='${u}' and reference='${x.run.reference}' and kind='release'),
    'audit',(select count(*) from makeborne_private.ai_run_outcomes where user_id='${u}' and reference='${x.run.reference}'),
    'provider',(select coalesce(sum(coalesce(charged_microusd,bound_microusd)),0) from makeborne_private.live_provider_calls where run_reference='${x.run.reference}'));`);
  assert.equal(deleted.artifact,0);assert.equal(deleted.run,0);assert(['released','settled'].includes(deleted.hold));assert.equal(deleted.audit,1);
  assert.equal(deleted.releases,deleted.hold==='released'?1:0);assert.equal(deleted.provider,1000000);

  const newArtifact=async()=>{const id=randomUUID();await one(`insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${id}','${w}','${p}','Race fixture','website');select '{}'::json;`);return id;};
  const start=async(artifact,kind='build')=>{const operation=await one(`select public.makeborne_ai_operation_create('${u}','${w}','${artifact}','${randomUUID()}','${kind}','medium','${hash}',0,5,30000,'{}');`);
    return one(`select public.makeborne_ai_operation_begin('${u}','${operation.id}','${randomUUID()}','${kind}','${hash}',0,5);`);};
  const providerArtifact=await newArtifact(), providerRun=(await start(providerArtifact)).run, raceCall=randomUUID();
  const providerRace=await Promise.all([query(deleteSql(providerArtifact)),query(`select public.makeborne_ai_operation_provider_begin('${u}','${providerRun.id}','${providerRun.fence}','${raceCall}','anthropic','fixture',1000);`)]);
  if(providerRace[0].code!==0){assert.match(providerRace[0].error,/deadlock detected/);assert.equal((await query(deleteSql(providerArtifact))).code,0);}
  if(providerRace[1].code!==0)assert.match(providerRace[1].error,/Operation unavailable|Editor permission required|deadlock detected/);
  const pending=await one(`select json_build_object('status',(select status from makeborne_private.credit_reservations where user_id='${u}' and reference='${providerRun.reference}'),'calls',(select count(*) from makeborne_private.live_provider_calls where id='${raceCall}'));`);
  assert.equal(pending.status,'released');
  if(pending.calls){await one(`select public.makeborne_provider_call_finish('${raceCall}',500,500,'{}');`);const retained=await one(`select json_build_object('cost',(select charged_microusd from makeborne_private.live_provider_calls where id='${raceCall}'));`);assert.equal(retained.cost,500);}
  assert.notEqual((await query(`select public.makeborne_ai_operation_provider_begin('${u}','${providerRun.id}','${providerRun.fence}','${randomUUID()}','anthropic','fixture',1);`)).code,0);
  console.log('PASS deletion/finalization/provider races, exact release, retained pending/confirmed provider costs');

  // Existing manual edit vs generated plan: one revision wins; the other
  // conflicts. A generated conflict preserves the candidate without charging.
  const planArtifact=await newArtifact();
  await one(`insert into public.artifact_plans(artifact_id,workspace_id,updated_by,plan) values('${planArtifact}','${w}','${u}','{"plan":{"title":"Original"},"status":"draft","revision":0,"basedOnVersion":0,"charged":0}') returning plan;`);
  const planRun=(await start(planArtifact,'plan')).run;
  const manual=await Promise.all([query(`begin;update public.artifact_plans set plan='{"plan":{"title":"Manual"},"status":"draft","revision":1,"basedOnVersion":0,"charged":0}' where artifact_id='${planArtifact}';select pg_sleep(0.1);commit;`),
    query(`select public.makeborne_ai_operation_finish('${u}','${planRun.id}','${planRun.fence}',30000,'plan','{}','{"stored":{"plan":{"title":"Generated"},"status":"draft","revision":2,"basedOnVersion":0,"charged":0}}');`)]);
  assert.equal(manual[1].code,0,manual[1].error);
  const finalPlan=await one(`select plan from public.artifact_plans where artifact_id='${planArtifact}';`), finalization=JSON.parse(manual[1].output);
  assert.equal(finalPlan.revision,2);
  if(manual[0].code===0){assert.equal(finalPlan.plan.title,'Manual');assert.equal(finalization.outcome,'conflict');assert.equal(finalization.charged,0);assert(finalization.recovery);}
  else{assert.match(manual[0].error,/Plan revision conflict/);assert.equal(finalPlan.plan.title,'Generated');assert.equal(finalization.outcome,'plan');assert.equal(finalization.charged,1);}
  // Revision supplied by a stale browser cannot overwrite either winner.
  const stale=await query(`update public.artifact_plans set plan='{"plan":{"title":"Stale browser"},"status":"draft","revision":1,"basedOnVersion":0,"charged":0}' where artifact_id='${planArtifact}';`);
  assert.notEqual(stale.code,0);assert.match(stale.error,/Plan revision conflict/);
  // Concurrent creation uses INSERT, never UPSERT; the generated loser is a
  // recoverable uncharged result and the manual loser is a uniqueness error.
  const initialArtifact=await newArtifact(),initialRun=(await start(initialArtifact,'plan')).run;
  const initial=await Promise.all([query(`insert into public.artifact_plans(artifact_id,workspace_id,updated_by,plan) values('${initialArtifact}','${w}','${u}','{"plan":{"title":"First manual"},"status":"draft","revision":0,"basedOnVersion":0,"charged":0}');`),
    query(`select public.makeborne_ai_operation_finish('${u}','${initialRun.id}','${initialRun.fence}',30000,'plan','{}','{"stored":{"plan":{"title":"First generated"},"status":"draft","revision":1,"basedOnVersion":0,"charged":0}}');`)]);
  assert.equal(initial[1].code,0,initial[1].error);const first=JSON.parse(initial[1].output);
  const savedFirst=await one(`select plan from public.artifact_plans where artifact_id='${initialArtifact}';`);assert.equal(savedFirst.revision,1);
  if(initial[0].code===0){assert.equal(savedFirst.plan.title,'First manual');assert.equal(first.outcome,'conflict');assert.equal(first.charged,0);}
  else{assert.match(initial[0].error,/duplicate key/);assert.equal(savedFirst.plan.title,'First generated');assert.equal(first.charged,1);}
  console.log('PASS generated/manual plan races, authoritative revisions, stale-browser rejection, first-plan insert race');
}

if (process.argv[1]?.endsWith('check-ai-operations-concurrency.mjs')) await checkOperationConcurrency(process.argv[2]);
