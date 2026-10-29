// A real three-session refund/publication race, restricted to a fresh local
// network-disabled rehearsal container. Synthetic users/payments only.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runRefundRace(container,{expectSerialized=false,refundFirst=false}={}){
 assert.match(container,/^makeborne_candidate_[0-9]{8}_publication_beta_[0-9]+$/);
 const inspected=spawnSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container],{encoding:'utf8'});
 assert.equal(inspected.status,0);assert.equal(inspected.stdout.trim(),'none');
 const schema='publication_beta_test_'+Date.now();
 const args=['exec','-i',container,'psql','-X','-U','postgres','-d','rehearsal','-q','-At','-v','ON_ERROR_STOP=1'];
 function sql(text){const r=spawnSync('docker',args,{input:text,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
 function session(text){
  const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let output='',error='';
  p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>error+=b);
  const done=new Promise((resolve,reject)=>p.on('close',code=>code===0?resolve(output):reject(Error(error||output))));
  // Observe rejections while sessions intentionally remain blocked.
  done.catch(()=>{});p.stdin.write(text+'\n');
  return {p,done,output:()=>output,error:()=>error};
 }
 async function until(check,label){const end=Date.now()+4000;while(Date.now()<end){if(check())return;await delay(40);}throw Error('Timed out waiting for '+label);}
 let setup=readFileSync('supabase/check-paying-workspace-publication.sql','utf8').replace(/\r\n/g,'\n').split('\ndo $$\ndeclare')[0];
 setup=setup.replaceAll('pg_temp.',schema+'.').replace('begin;','begin;\ncreate schema '+schema+';');
 setup+=`\ncreate table ${schema}.binding(actor uuid,session uuid,workspace uuid,artifact uuid,preparation uuid,membership text,payment jsonb,period_start timestamptz,period_end timestamptz);
 do $$ declare u uuid:=gen_random_uuid(); s uuid; w uuid; a uuid; prep uuid; m text;
  plan text:='plan_BetaRace'||left(${schema}.token(),12); payment jsonb; starts timestamptz:=now()-interval '1 day'; ends timestamptz:=now()+interval '20 days';
 begin
  update makeborne_private.billing_settings set creation_enabled=true where singleton;
  perform makeborne_private.configure_trusted_publication_scope('entitled');
  insert into makeborne_private.billing_access_plans(plan_id,enabled) values(plan,true);
  s:=${schema}.account(u,false);w:=${schema}.workspace(u,'Local publication race');a:=${schema}.website(w,u);
  m:=${schema}.member(u,plan,'active',ends,now(),true);
  payment:=jsonb_build_object('id','pay_'||${schema}.token(),'membershipId',m,'planId',plan,'currency','usd','billingReason','subscription_create',
   'principalCents',2000,'refundedPrincipalCents',0,'status','paid','dispute','none','paidAt',starts,'updatedAt',now());
  perform public.makeborne_reconcile_plan_payment(u,m,payment,starts,ends);
  prep:=${schema}.prepare(u,s,w,a,'race-'||left(${schema}.token(),12),0,'Before refund');
  perform public.makeborne_promote_publication_preparation(prep,u,s,now()+interval '20 minutes');
  prep:=${schema}.prepare(u,s,w,a,(select slug from public.hosted_sites where artifact_id=a),1,'Racing refund');
  insert into ${schema}.binding values(u,s,w,a,prep,m,payment,starts,ends);
 end $$;\ncommit;`;
 sql(setup);
 const name='pub_beta_'+Date.now();
 const refundSql=`select public.makeborne_reconcile_plan_payment(actor,membership,
   payment||jsonb_build_object('refundedPrincipalCents',2000,'status','refunded','updatedAt',clock_timestamp()+interval '1 second'),period_start,period_end) from ${schema}.binding;`;
 const stateSql=`select jsonb_build_object('revision',s.revision,'live',s.live,'revoked',makeborne_private.membership_access_revoked(b.membership,clock_timestamp()),
   'preparationState',p.state,'ownerCanHost',makeborne_hosting.owner_can_host(b.actor)) from ${schema}.binding b join public.hosted_sites s on s.artifact_id=b.artifact join makeborne_private.publication_preparations p on p.id=b.preparation`;
 const holder=session(`begin;set application_name='${name}_holder';${refundFirst?refundSql:`select artifact_id from public.hosted_sites where artifact_id=(select artifact from ${schema}.binding) for update;`}\n\\echo HOLDER_READY`);
 let publisher,refund;
 try{
  await until(()=>holder.output().includes('HOLDER_READY'),'holder row lock');
  publisher=session(`set application_name='${name}_publish';select public.makeborne_promote_publication_preparation(preparation,actor,session,now()+interval '20 minutes') from ${schema}.binding;\n\\echo PUBLISH_DONE`);
  publisher.p.stdin.end();
  await until(()=>sql(`select count(*) from pg_stat_activity where application_name='${name}_publish' and wait_event_type='Lock'`)==='1','publisher blocked after authority');
  if(refundFirst){
   holder.p.stdin.end('commit;\n');await holder.done;
   await assert.rejects(publisher.done,/Creation membership required/);
   const state=JSON.parse(sql(stateSql));
   assert.equal(state.revision,1);assert.equal(state.revoked,true);assert.equal(state.preparationState,'ready');
   return {refundFirst:true,publisherWaitedForRefund:true,promotionRefused:true,state};
  }
  refund=session(`set application_name='${name}_refund';${refundSql}\n\\echo REFUND_DONE`);
  refund.p.stdin.end();
  if(expectSerialized){
   await until(()=>sql(`select count(*) from pg_stat_activity where application_name='${name}_refund' and wait_event_type='Lock'`)==='1','refund waits for publication transaction');
   assert(!refund.output().includes('REFUND_DONE'));
  }else{
   await refund.done;
   assert(refund.output().includes('REFUND_DONE'));
   assert.equal(sql(`select makeborne_private.membership_access_revoked(membership,clock_timestamp()) from ${schema}.binding`),'t');
   assert(!publisher.output().includes('PUBLISH_DONE'),'publisher should still be blocked when refund commits');
  }
  holder.p.stdin.end('commit;\n');await holder.done;await publisher.done;await refund.done;
  const state=JSON.parse(sql(stateSql));
  assert.equal(state.revision,2);assert.equal(state.revoked,true);assert.equal(state.preparationState,'promoted');
  const refused=spawnSync('docker',args,{input:`select public.makeborne_request_publication_preparation(actor,session,now()+interval '20 minutes',workspace,artifact,1,2,'after-refund-race',false,gen_random_uuid()) from ${schema}.binding;`,encoding:'utf8'});
  assert.notEqual(refused.status,0);assert.match(refused.stderr,/Creation membership required/);
  return {expectSerialized,refundCommittedBeforePromotion:!expectSerialized,refundWaitedForPromotion:expectSerialized,state,futureRequestRefused:true};
 }finally{
  for(const s of [holder,publisher,refund])if(s&&!s.p.stdin.destroyed)s.p.stdin.end('rollback;\n');
  await Promise.allSettled([holder,publisher,refund].filter(Boolean).map(s=>s.done));
  // These exact fixtures exist only in this network-disabled disposable DB.
  // Remove them before the next namespace/rollback suite; ready preparations
  // must not leak between independent scenarios and block staging transitions.
  sql(`begin;
   delete from makeborne_private.publication_preparations where workspace_id in(select workspace from ${schema}.binding);
   delete from public.hosted_sites where artifact_id in(select artifact from ${schema}.binding);
   delete from public.workspaces where id in(select workspace from ${schema}.binding);
   delete from auth.users where id in(select actor from ${schema}.binding);
   drop schema ${schema} cascade;
   commit;`);
 }
}
