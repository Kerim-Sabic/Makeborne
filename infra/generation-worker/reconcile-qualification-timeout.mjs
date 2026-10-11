/** One explicitly observed Claude Console outcome. Not a provider receipt or a
 * generic cost override. Local owner reconciliation only; no network/API calls. */
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {qualificationRound as round,assertLocalQualificationDatabase} from './qualification-round.mjs';

const jobId='df8cf70a-06b0-4e73-870b-4dfeaf427d7c';
const requestId='req_011CfqPWZyoR5QZWSts8Py5A';
const privateRoot=resolve('.env.qualification-round-1');
const evidenceDirectory=resolve('docs/execution/evidence/M03-T01-R23');
const observation={version:'operator-console-observation-v1',jobId,roundId:round.id,
  observedAt:'2026-10-08T20:26:00.000Z',provider:'anthropic',model:'claude-opus-5-5',
  providerRequestId:requestId,sourceUrl:`https://platform.claude.com/workspaces/default/logs?request=${requestId}`,
  observationMethod:'Read-only signed-in Claude Console request detail via computer use',
  status:499,description:'Client disconnected before response completed',serviceTier:'Standard',latencySeconds:117.422,
  usage:{input_tokens:'3908',output_tokens:'9651',cache_read_tokens:'0',cache_write_5m_tokens:'0',cache_write_1h_tokens:'0'},
  responseId:null,sourceResultAvailable:false,thinkingTokensKnown:false,
  correlation:'Only request on October 8 in the visible request list; model, uncached input count 3908 and ~120-second duration match the single local dispatch. Other listed requests are October 7. No response body or response ID recovered.'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function retain(file,bytes){
  try {const handle=await open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
  catch(error){if(error.code!=='EEXIST')throw error;}
  assert.equal(hash(await readFile(file)),hash(bytes));
}
async function main(){
  assert.equal(process.env.MAKEBORNE_RECONCILE_OBSERVED_TIMEOUT,'true');
  assert(process.execArgv.includes('--conditions=react-server'));
  const config=JSON.parse((await readFile('.env.makeborne-local-status.json','utf8')).replace(/^\uFEFF/,''));
  const url=assertLocalQualificationDatabase(config.DB_URL);
  await mkdir(join(privateRoot,'usage'),{recursive:true});
  await build({entryPoints:['infra/generation-worker/qualification-entry.ts'],outfile:join(privateRoot,'runtime.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
  const lib=createRequire(import.meta.url)(join(privateRoot,'runtime.cjs'));
  const db=new Client({connectionString:url.href,connectionTimeoutMillis:5000,query_timeout:5000});
  await db.connect();let locked=false;
  try{
    locked=(await db.query('select pg_try_advisory_lock(hashtextextended($1,0)) locked',[`run:${round.id}`])).rows[0].locked;
    assert(locked,'ROUND_ALREADY_RUNNING');await db.query('begin');
    const rows=(await db.query('select j.workspace_id,j.run_revision,d.id dispatch_id,d.started_at,p.snapshot,b.spending_enabled from public.generation_jobs j join makeborne_private.generation_reservations r on r.id=j.reservation_id join makeborne_private.generation_dispatches d on d.reservation_id=r.id join makeborne_private.generation_proposals p on p.id=r.proposal_id join makeborne_private.generation_budgets b on b.workspace_id=j.workspace_id where j.id=$1',[jobId])).rows;
    assert.equal(rows.length,1);const row=rows[0];assert.equal(row.workspace_id,round.workspaceId);assert.equal(row.spending_enabled,false);
    assert.equal(row.snapshot.purpose,'operator_qualification');assert.equal(row.snapshot.qualificationRound,round.id);
    const route=row.snapshot.workflow.stages[0].route;
    assert.equal(route.model,observation.model);assert.equal(route.provider,observation.provider);assert.equal(route.price.version,'opus-5-5-standard-20261008');
    const attempt=JSON.parse(await readFile(join(evidenceDirectory,`attempt-${jobId}.json`),'utf8'));
    assert.equal(attempt.paidDispatches,1);assert.equal(attempt.countedInputTokens,Number(observation.usage.input_tokens));assert.equal(attempt.unresolved,true);
    assert.equal(row.started_at.toISOString().slice(0,10),'2026-10-08');
    const cost=lib.quotePlainTextUsage(route,{input_tokens:observation.usage.input_tokens,output_tokens:observation.usage.output_tokens});assert.equal(cost,'208652');
    const payload={...observation,dispatchId:row.dispatch_id,tariff:route.price,actualVendorMicrousd:cost};
    const bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),evidenceHash=hash(bytes);
    await retain(join(privateRoot,'usage',`console-${requestId}.json`),bytes);
    await db.query('select makeborne_private.record_generation_outcome_core($1,$2,false,$3,$4,$5,$6,$7,$8,null)',[jobId,row.dispatch_id,cost,route.provider,route.model,route.price.version,requestId,evidenceHash]);
    const revision=(await db.query('select run_revision from public.generation_jobs where id=$1',[jobId])).rows[0].run_revision;
    await db.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[jobId,round.ownerId,revision,evidenceHash]);
    await db.query('commit');
    const budget=(await db.query('select spending_enabled,vendor_limit,vendor_spent,vendor_reserved,credit_spent,credit_reserved,active_reservations from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0];
    assert.equal(budget.vendor_spent,cost);assert.equal(budget.vendor_reserved,'0');assert.equal(budget.active_reservations,0);assert.equal(budget.credit_spent,'0');assert.equal(budget.spending_enabled,false);
    const caps=(await db.query("select scope,enabled,vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope in ('global','anthropic') order by scope")).rows;
    for(const cap of caps){assert.equal(cap.enabled,false);assert.equal(cap.vendor_spent,cost);assert.equal(cap.vendor_reserved,'0');assert.equal(cap.active_dispatches,0);}
    const summary={jobId,requestId,evidenceHash,source:'operator-console-observation-v1',actualVendorMicrousd:cost,customerCredits:'0',resultAvailable:false,budget,caps};
    await retain(join(evidenceDirectory,`reconciliation-${jobId}.json`),Buffer.from(JSON.stringify(summary,null,2)+'\n'));
    console.log(JSON.stringify(summary));
  }catch(error){await db.query('rollback').catch(()=>{});throw error;}
  finally{if(locked)await db.query('select pg_advisory_unlock(hashtextextended($1,0))',[`run:${round.id}`]);await db.end();}
}
main().catch(error=>{console.error(JSON.stringify({code:'QUALIFICATION_RECONCILIATION_UNCONFIRMED',kind:error?.code,assertion:error?.code==='ERR_ASSERTION'?{actual:error.actual,expected:error.expected}:undefined}));process.exitCode=1;});

