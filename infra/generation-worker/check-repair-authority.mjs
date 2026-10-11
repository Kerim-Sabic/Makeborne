/** Real local transaction/role qualification; every fixture and DDL is rolled back. */
import {build} from 'esbuild';
import {Client} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {qualificationRound as round,assertLocalQualificationDatabase} from './qualification-round.mjs';
const reviewId='eb3cd5d2-0d38-40a2-873b-927a2be906d7',versionId='170e66ff-f5f0-49bd-a04d-010a859bfc32';
let db,locked=false,transaction=false,stage='preflight';const checks=[];
async function main(){
 assert.equal(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS,'true');assert(process.execArgv.includes('--conditions=react-server'));
 const config=JSON.parse((await readFile('.env.makeborne-local-status.json','utf8')).replace(/^\uFEFF/,'')),url=assertLocalQualificationDatabase(config.DB_URL);
 await build({entryPoints:['infra/generation-worker/repair-review-entry.ts'],outfile:'.env.qualification-round-1/repair-review.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
 const lib=createRequire(import.meta.url)(resolve('.env.qualification-round-1/repair-review.cjs'));
 db=new Client({connectionString:url.href,connectionTimeoutMillis:5000,query_timeout:10000});await db.connect();
 locked=(await db.query('select pg_try_advisory_lock(hashtextextended($1,0)) locked',[`run:${round.id}`])).rows[0].locked;assert(locked);
 const snapshot=async()=>({budget:(await db.query('select * from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0],caps:(await db.query('select * from makeborne_private.generation_execution_caps order by scope')).rows});
 const before=await snapshot();assert(!before.budget.spending_enabled&&before.budget.vendor_reserved==='0');assert(before.caps.every(c=>!c.enabled&&c.vendor_reserved==='0'));
 await db.query('begin');transaction=true;stage='rollback-migration';
 const migration=await readFile('supabase/migrations/20261008210222_operator_website_repair_review.sql','utf8');await db.query(migration.replace(/^begin;\s*/,'').replace(/commit;\s*$/,''));
 const row=(await db.query(`select v.*,a.project_id,b.receipt,q.snapshot from public.artifact_versions v
 join public.artifacts a on a.id=v.artifact_id and a.workspace_id=v.workspace_id
 join makeborne_private.project_builds b on b.version_id=v.id and b.workspace_id=v.workspace_id
 join public.generation_jobs j on j.id=b.job_id join makeborne_private.generation_reservations r on r.id=j.reservation_id
 join makeborne_private.generation_proposals q on q.id=r.proposal_id where v.id=$1 and v.workspace_id=$2`,[versionId,round.workspaceId])).rows[0];assert(row);
 const version={id:row.id,artifactId:row.artifact_id,number:row.version_number,parentVersionId:row.parent_version_id,content:row.content,style:row.style_snapshot,assetIds:row.asset_manifest,createdAt:row.created_at.toISOString(),createdBy:row.created_by,changeSummary:row.change_summary};
 const workload=lib.websiteBuildInput(version,[]),reviewRow=(await db.query('select id,workspace_id,version_id,reviewer_id,decision,body from public.reviews where id=$1',[reviewId])).rows[0];
 const review=lib.readWebsiteRepairReview(reviewRow,{scope:row.snapshot.input.scope,jobId:JSON.parse(reviewRow.body).jobId,reviewerId:round.ownerId},workload,row.receipt);
 const now=new Date().toISOString(),input={...row.snapshot.input,baseVersionId:versionId,content:row.content,style:row.style_snapshot};
 const proposal=lib.prepareWebsiteRepairQualification(input,{now,effort:'light',processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},review),record=lib.generationProposalRecord(proposal,now),proposalId=randomUUID(),session=randomUUID(),worker=randomUUID(),deadline=new Date(Date.now()+600000).toISOString();
 await db.query('insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),$3)',[session,round.ownerId,deadline]);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Rolled-back repair authority fixture')",[round.ownerId]);
 await db.query('update makeborne_private.generation_budgets set spending_enabled=true where workspace_id=$1',[round.workspaceId]);
 await db.query('insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[proposalId,record.workspace_id,record.project_id,record.artifact_id,record.base_version_id,record.input_hash,record.approval_hash,record.snapshot,record.maximum_vendor_microusd,'0',record.prepared_at,record.expires_at]);
 stage='authorize-repair';const job=(await db.query('select (makeborne_private.authorize_and_enqueue_generation_job($1,$2,$3,$4,$5,$6,$7,$8,true,true,true)).*',[proposalId,randomUUID(),round.ownerId,proposal.approvalHash,proposal.inputHash,deadline,session,deadline])).rows[0];
 const lease=(await db.query('select (makeborne_private.acquire_generation_job_lease($1,$2,120)).*',[job.id,worker])).rows[0];
 const binding=[job.id,worker,lease.fence];
 await db.query('set local role makeborne_generation_worker');const approved=(await db.query('select makeborne_private.load_generation_worker_input($1,$2,$3) input',binding)).rows[0].input;await db.query('reset role');
 assert.equal(approved.proposal.repairReview.reportHash,review.reportHash);assert.deepEqual(approved.proposal.input.content,row.content);checks.push('restricted worker loads exact saved repair source and review');
 async function denied(name,mutate,dispatch=false){await db.query('savepoint mutation');await mutate();await db.query('set local role makeborne_generation_worker');let denied=false;try{await db.query(dispatch?'select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4)':'select makeborne_private.load_generation_worker_input($1,$2,$3)',dispatch?[...binding,randomUUID()]:binding);}catch(error){assert.equal(error.code,'PT409');denied=true;}await db.query('rollback to savepoint mutation');assert(denied);checks.push(name);}
 stage='review-revocation-checks';
 await denied('deleted review refuses restricted input',()=>db.query('delete from public.reviews where id=$1',[reviewId]));
 await denied('deleted review refuses capped dispatch before any paid claim',()=>db.query('delete from public.reviews where id=$1',[reviewId]),true);
 await denied('changed review body refuses restricted input',()=>db.query("update public.reviews set body=body||' ' where id=$1",[reviewId]));
 await denied('changed review decision refuses restricted input',()=>db.query("update public.reviews set decision='approved' where id=$1",[reviewId]));
 await denied('intervening source version refuses repair dispatch',()=>db.query('insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,asset_manifest,created_by,change_summary) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),round.workspaceId,row.artifact_id,row.version_number+1,versionId,row.content,row.style_snapshot,JSON.stringify(row.asset_manifest),round.ownerId,'Rolled-back intervening version']),true);
 await db.query('savepoint immutable_receipt');await assert.rejects(db.query("update makeborne_private.project_builds set receipt=jsonb_set(receipt,'{buildHash}',to_jsonb(repeat('a',64))) where version_id=$1",[versionId]),error=>error.code==='23514');await db.query('rollback to savepoint immutable_receipt');checks.push('existing immutable compiled receipt guard prevents tampering');
 await db.query('set local role makeborne_generation_worker');await assert.rejects(db.query('select * from public.reviews where id=$1',[reviewId]),error=>error.code==='42501');
 await db.query('rollback');transaction=false;checks.push('restricted worker has no direct review table grant');
 assert.deepEqual(await snapshot(),before);checks.push('all fixtures/DDL/authority/budget changes rolled back without spending');
 await mkdir('docs/execution/evidence/M03-T01-R25',{recursive:true});await writeFile('docs/execution/evidence/M03-T01-R25/repair-authority.json',JSON.stringify({checks,paidCalls:0,rolledBack:true,financialStateUnchanged:true,reviewId,versionId,reportHash:review.reportHash},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,paidCalls:0,rolledBack:true}));
}
try{await main();}catch(error){console.error(JSON.stringify({error:'REPAIR_AUTHORITY_CHECK_FAILED',stage,code:/^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/.test(error.code??'')?error.code:'VALIDATION'}));process.exitCode=1;}finally{if(db){if(transaction)await db.query('rollback').catch(()=>{});if(locked)await db.query('select pg_advisory_unlock(hashtextextended($1,0))',[`run:${round.id}`]).catch(()=>{});await db.end();}}
