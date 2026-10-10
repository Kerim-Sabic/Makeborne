/** Record existing independent R23 findings on their exact saved revision.
 * Fixed local operator fixture only; customer write gates remain enforced. */
import {build} from 'esbuild';
import {Client} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {qualificationRound as round,assertLocalQualificationDatabase} from './qualification-round.mjs';
const jobId='737c43ea-c6b1-4da9-84c2-ca16e1f64233',versionId='170e66ff-f5f0-49bd-a04d-010a859bfc32';
const reviewId='eb3cd5d2-0d38-40a2-873b-927a2be906d7';
const reference='docs/execution/evidence/M03-T01-R23/visual-review-'+jobId+'.json';
const observations={recordedAt:new Date().toISOString(),issues:[
 {id:'desktop-hero',category:'composition',severity:'major',observation:'Desktop headline wraps into too many large lines and pushes the main action below the initial viewport.',requestedChange:'Rebalance the desktop type scale and hero geometry so a complete primary action is visible at 1440×900. Preserve the mobile layout and identity.',evidence:{kind:'browser_observation',reference,viewport:{width:1440,height:900}}},
 {id:'hero-artwork',category:'imagery',severity:'major',observation:'Dog/vector artwork remains elementary rather than premium.',requestedChange:'Develop a more considered original visual composition and product hierarchy. Do not use fake product photography, external images or unsupported claims about materials.',evidence:{kind:'browser_observation',reference,viewport:null}},
 {id:'unsupported-properties',category:'content_accuracy',severity:'blocking',observation:'Some unsupplied matching/product-design properties remain in copy.',requestedChange:'Remove unverified feature, material, service and performance claims. Keep useful product-category navigation; put missing specifications in review questions.',evidence:{kind:'browser_observation',reference,viewport:null}},
 {id:'email-availability',category:'interaction',severity:'major',observation:'Unavailable email service is disclosed only after submission.',requestedChange:'Explain before the email form that this is a demonstration and nothing will be sent or saved. Preserve accessible local validation and feedback.',evidence:{kind:'browser_observation',reference,viewport:{width:390,height:844}}},
]};
let db,locked=false,inTransaction=false,stage='preflight';
async function financialSnapshot(){return {budget:(await db.query('select * from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0],caps:(await db.query('select * from makeborne_private.generation_execution_caps order by scope')).rows};}
async function main(){
 assert.equal(process.env.MAKEBORNE_RECORD_QUALIFICATION_REVIEW,'true');assert(process.execArgv.includes('--conditions=react-server'));
 const config=JSON.parse((await readFile('.env.makeborne-local-status.json','utf8')).replace(/^\uFEFF/,''));
 const url=assertLocalQualificationDatabase(config.DB_URL);
 const prior=JSON.parse(await readFile(reference,'utf8'));assert.equal(prior.accepted,false);assert.equal(prior.revisionId,versionId);assert.equal(prior.remainingIssues.length,observations.issues.length);
 const privateRoot=resolve('.env.qualification-round-1');await mkdir(privateRoot,{recursive:true});
 await build({entryPoints:['infra/generation-worker/repair-review-entry.ts'],outfile:join(privateRoot,'repair-review.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
 const lib=createRequire(import.meta.url)(join(privateRoot,'repair-review.cjs'));
 db=new Client({connectionString:url.href,connectionTimeoutMillis:5000,query_timeout:5000});await db.connect();
 locked=(await db.query('select pg_try_advisory_lock(hashtextextended($1,0)) locked',[`run:${round.id}`])).rows[0].locked;assert(locked);
 stage='financial-preflight';const before=await financialSnapshot();assert(!before.budget.spending_enabled&&before.budget.vendor_reserved==='0'&&before.budget.active_reservations===0);assert(before.caps.every(c=>!c.enabled&&c.vendor_reserved==='0'));
 await db.query('begin');inTransaction=true;
 stage='saved-source-read';const row=(await db.query(`select v.*,a.project_id,a.current_version,w.owner_id,b.receipt,b.status build_status,j.id job_id
 from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.workspace_id=v.workspace_id
 join public.workspaces w on w.id=v.workspace_id join makeborne_private.project_builds b on b.version_id=v.id and b.workspace_id=v.workspace_id
 join public.generation_jobs j on j.id=b.job_id and j.workspace_id=b.workspace_id and j.artifact_id=b.artifact_id
 where v.id=$1 and j.id=$2 and v.workspace_id=$3 for share of v,a,w,b,j`,[versionId,jobId,round.workspaceId])).rows[0];
 assert(row&&row.owner_id===round.ownerId&&row.build_status==='compiled'&&row.current_version===row.version_number);
 assert.equal(row.receipt.buildHash,prior.buildHash);assert.equal(row.asset_manifest.length,0);assert.equal(row.content.websiteSource.assets.length,0);
 const version={id:row.id,artifactId:row.artifact_id,number:row.version_number,parentVersionId:row.parent_version_id,content:row.content,style:row.style_snapshot,assetIds:row.asset_manifest,createdAt:row.created_at.toISOString(),createdBy:row.created_by,changeSummary:row.change_summary};
 stage='workload-validation';const workload=lib.websiteBuildInput(version,[]),context={scope:{workspaceId:round.workspaceId,projectId:row.project_id,artifactId:row.artifact_id},jobId,reviewerId:round.ownerId};
 stage='rls-review-record';let stored=(await db.query('select id,workspace_id,version_id,reviewer_id,decision,body from public.reviews where id=$1',[reviewId])).rows[0];
 let created=false;
 if(!stored){const proposal=lib.createWebsiteRepairReview(context,observations,workload,row.receipt);proposal.row.id=reviewId;const r=proposal.row;stored=(await db.query('insert into public.reviews(id,workspace_id,version_id,reviewer_id,decision,body) values($1,$2,$3,$4,$5,$6) returning id,workspace_id,version_id,reviewer_id,decision,body',[r.id,r.workspace_id,r.version_id,r.reviewer_id,r.decision,r.body])).rows[0];created=true;}
 // This unloginable operator owns no creation subscription. Record its fixed
 // qualification findings as the local operator, then test the real read RLS
 // and write protections without granting a plan or changing any policy.
 await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:round.ownerId,role:'authenticated'})]);
 stored=(await db.query('select id,workspace_id,version_id,reviewer_id,decision,body from public.reviews where id=$1',[reviewId])).rows[0];assert(stored);
 const bound=lib.readWebsiteRepairReview(stored,context,workload,row.receipt);assert.deepEqual(bound.report.observations.issues,observations.issues);
 stage='rls-negative-checks';for(const operation of ['update public.reviews set body=body where id=$1','delete from public.reviews where id=$1']){
  await db.query('savepoint denied_mutation');let denied=false;try{await db.query(operation,[reviewId]);}catch(e){assert.equal(e.code,'42501');denied=true;}await db.query('rollback to savepoint denied_mutation');assert(denied);
 }
 await db.query('savepoint unpaid_write');let denied=false;try{await db.query('insert into public.reviews(workspace_id,version_id,reviewer_id,decision,body) values($1,$2,$3,$4,$5)',[round.workspaceId,versionId,round.ownerId,'changes_requested',stored.body]);}catch(e){assert.equal(e.code,'MB402');denied=true;}await db.query('rollback to savepoint unpaid_write');assert(denied);
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:randomUUID(),role:'authenticated'})]);assert.equal((await db.query('select id from public.reviews where id=$1',[reviewId])).rows.length,0);
 await db.query('reset role');await db.query('commit');inTransaction=false;
 stage='committed-readback';const reloaded=(await db.query('select id,workspace_id,version_id,reviewer_id,decision,body from public.reviews where id=$1',[reviewId])).rows[0];lib.readWebsiteRepairReview(reloaded,context,workload,row.receipt,{reviewId,reportHash:bound.reportHash});
 const after=await financialSnapshot();assert.deepEqual(after,before);
 const evidence={reviewId,jobId,versionId,sourceHash:bound.report.sourceHash,buildHash:bound.report.buildHash,reportHash:bound.reportHash,created,issueCount:bound.report.observations.issues.length,localOperatorInsert:true,existingReviewRls:true,ownerReadback:true,authenticatedUpdateDeleteDenied:true,unpaidCustomerInsertDenied:true,outsiderReadDenied:true,financialStateUnchanged:true,budget:after.budget,paidCalls:0,qualityAccepted:false,repairDispatchImplemented:false};
 const destination=resolve('docs/execution/evidence/M03-T01-R24');await mkdir(destination,{recursive:true});await writeFile(join(destination,created?'record-review.json':'record-review-replay.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
try{await main();}catch(error){console.error(JSON.stringify({error:'QUALIFICATION_REVIEW_RECORD_FAILED',stage,code:/^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/.test(error.code??'')?error.code:'CONTRACT_VALIDATION'}));process.exitCode=1;}finally{if(db){if(inTransaction)await db.query('rollback').catch(()=>{});if(locked)await db.query('select pg_advisory_unlock(hashtextextended($1,0))',[`run:${round.id}`]).catch(()=>{});await db.end();}}
