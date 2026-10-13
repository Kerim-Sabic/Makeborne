-- Run only through check-ai-operations-disposable.mjs. Every fixture rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.operation_settlement_fault() returns trigger language plpgsql as $$ begin
 if new.kind='settle' and current_setting('makeborne.test_operation_settlement_fault',true)='on' then
  raise exception 'Synthetic settlement failure after artifact save';
 end if;
 return new;
end $$;
create trigger operation_test_settlement_fault before insert on public.credit_ledger for each row execute function pg_temp.operation_settlement_fault();
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 action uuid:=gen_random_uuid(); step uuid:=gen_random_uuid(); authkey uuid:=gen_random_uuid(); op jsonb; x jsonb; y jsonb; run jsonb; call_id uuid:=gen_random_uuid();
 candidate jsonb; rate bigint:=30000; hash text:=repeat('a',64); total bigint; recovery_run uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@operation.invalid',now()),(outsider,outsider||'@operation.invalid',now());
 update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
 insert into public.workspaces(id,name,owner_id) values(w,'Operation fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
 perform public.makeborne_credit_grant(u,500,'topup','operation-fixture','{}');
 op:=public.makeborne_ai_operation_create(u,w,a,action,'build','medium',hash,0,50,rate,'{}');
 assert (op->>'authorizedCredits')::int=50;
 assert public.makeborne_ai_operation_create(u,w,a,action,'build','medium',hash,0,50,rate,'{}')->>'id'=op->>'id';
 begin perform public.makeborne_ai_operation_create(u,w,a,action,'build','medium',hash,0,49,rate,'{}'); raise exception 'create changed cap accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_create(outsider,w,a,gen_random_uuid(),'build','medium',hash,0,50,rate,'{}'); raise exception 'outsider accepted'; exception when insufficient_privilege then null; end;
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'build',hash,0,50);run:=x->'run';
 assert (run->>'amount')::int=50;
 assert (public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'build',hash,0,50)->>'replayed')::boolean;
 assert public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,0,50)->'error'->>'code'='OPERATION_BUSY';
 begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'build',repeat('b',64),0,50); raise exception 'changed step accepted'; exception when sqlstate 'PT409' then null; end;
 perform makeborne_private.set_live_provider_limit('global',true,10000000,false,'Operation fixture');
 perform makeborne_private.set_live_provider_limit('anthropic',true,10000000,false,'Operation fixture');
 x:=public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',100000);
 assert (x->>'started')::boolean;
 assert (public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',100000)->>'replayed')::boolean;
 perform public.makeborne_provider_call_finish(call_id,1,1,'{}');
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,1,'review_no_change','{"finished":true,"changed":false}',null);
 assert (x->>'charged')::int=1 and x->>'outcome'='review_no_change',x::text;
 assert not (x->'operation'->>'canContinue')::boolean,'Finished work offered extra spending';
 assert x->'operation'->'pendingKind'='null'::jsonb;
 assert (public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,1,'review_no_change','{"finished":true,"changed":false}',null)->>'replayed')::boolean;
 -- Cumulative rounding: 1 + 1 micro dollars is still one credit, not two.
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'review',hash,0,50);run:=x->'run';
 assert x->'operation'->'pendingKind'='null'::jsonb;
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,1,'review_no_change','{}',null);
 assert (x->>'charged')::int=0 and (x->'operation'->>'chargedCredits')::int=1,x::text;
 assert x->'operation'->>'pendingKind'='review';
 -- Failed stages are absorbed and cannot be charged through the next stage.
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,0,50);run:=x->'run';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,900000,'failed','{"code":"FAILED"}',null);
 assert (x->>'charged')::int=0;
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,0,50);run:=x->'run';
 candidate:=jsonb_build_object('expectedVersion',0,'summary','Atomic save','content',jsonb_build_object('schemaVersion',1,'kind','website','title','Saved','sections','[]'::jsonb),
 'style','{"id":"test","name":"Test","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{},"description":"","referenceAssetIds":[]}'::jsonb,'assetIds','[]'::jsonb);
 perform set_config('request.jwt.claim.sub',outsider::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider)::text,true);
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'saved','{"finished":false}',candidate);
 assert x->>'outcome'='saved' and (x->>'charged')::int=1,x::text;
 assert (x->'result'->>'version')::int=1 and (x->'operation'->>'lastVersion')::int=1;
 assert auth.uid()=outsider,'Actor context leaked';
 assert (select created_by=u from public.artifact_versions where artifact_id=a and version_number=1);
 -- Conflict preserves candidate and releases credits, without replacing source.
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,1,50);run:=x->'run';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'saved','{}',candidate);
 assert x->>'outcome'='conflict' and (x->>'charged')::int=0 and x->'recovery'->'candidate'=candidate,x::text;
 assert (select current_version from public.artifacts where id=a)=1;
 assert auth.uid()=outsider,'Failure context leaked';
 -- Consent bounded by original quote, expected revision and exact replay.
 x:=public.makeborne_ai_operation_authorize(u,(op->>'id')::uuid,1,authkey,50);
 assert (x->'operation'->>'authorizedCredits')::int=100;
 assert (public.makeborne_ai_operation_authorize(u,(op->>'id')::uuid,1,authkey,50)->'operation'->>'authorizedCredits')::int=100;
 begin perform public.makeborne_ai_operation_authorize(u,(op->>'id')::uuid,1,gen_random_uuid(),50); raise exception 'stale consent accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_authorize(u,(op->>'id')::uuid,2,gen_random_uuid(),51); raise exception 'oversized consent accepted'; exception when invalid_parameter_value then null; end;
 -- Expired worker cannot dispatch or charge; recovery remains durable.
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,1,50);run:=x->'run';
 update makeborne_private.ai_operation_runs set expires_at=clock_timestamp()-interval '1 second' where id=(run->>'id')::uuid;
 begin perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1); raise exception 'expired worker dispatched'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_ai_operation_read(u,w,a,(op->>'id')::uuid,null);
 assert (x->'operation'->>'reservedCredits')::int=0;
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'saved','{}',candidate);
 assert x->>'outcome'='expired' and (x->>'charged')::int=0 and x->'recovery' is not null;
 recovery_run:=(run->>'id')::uuid;
 -- Provider uncertainty survives release and uses cumulative operation authority.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,1,1,rate,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,1,1);run:=x->'run';call_id:=gen_random_uuid();
 perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',rate);
 perform public.makeborne_provider_call_finish(call_id,null,0,'{}');
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'failed','{}',null);
 assert (x->'operation'->>'providerRemainingMicrousd')::int=0 and (x->>'charged')::int=0;
 assert public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,1,1)->'error'->>'code'='OPERATION_BUDGET_REACHED';
 assert (public.makeborne_ai_operation_read(u,w,a,(op->>'id')::uuid,null))->'operation'->>'pendingKind'='continuation';
 -- Plan persisted with its charge in same transaction and survives replay.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'plan','medium',hash,1,5,rate,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'plan',hash,1,5);run:=x->'run';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'plan','{}','{"stored":{"plan":{"title":"Plan"},"status":"draft","revision":1,"basedOnVersion":1}}');
 assert x->>'outcome'='plan' and (x->>'charged')::int=1,x::text;
 assert not (x->'operation'->>'canContinue')::boolean,'Completed plan offered extra spending';
 assert (select (plan->>'charged')::int=1 from public.artifact_plans where artifact_id=a);
 -- Explicit recovery uses stored bytes with no new provider or credit charge.
 x:=public.makeborne_ai_operation_recover(u,recovery_run,1);
 assert (x->'result'->>'version')::int=2 and (x->'result'->>'charged')::int=0 and x->'recovery'='null'::jsonb;
 assert public.makeborne_ai_operation_recover(u,recovery_run,1)->'result'=x->'result';
 assert auth.uid()=outsider;
 -- Customer cap across chained HTTP runs; wallet topups never change authority.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,2,3,rate,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,2,3);run:=x->'run';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,2*rate,'incomplete','{}',null);
 assert (x->>'charged')::int=2;
 assert x->'operation'->>'pendingKind'='continuation';
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,2,3);run:=x->'run';
 assert (run->>'amount')::int=1;
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,2*rate,'review_no_change','{"finished":true}',null);
 assert (x->>'charged')::int=1 and (x->'operation'->>'chargedCredits')::int=3;
 assert not (x->'operation'->>'canContinue')::boolean;
 perform public.makeborne_credit_grant(u,500,'topup','second-operation-fixture','{}');
 assert public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'review',hash,2,3)->'error'->>'code'='OPERATION_BUDGET_REACHED';
 x:=public.makeborne_ai_operation_read(u,w,a,(op->>'id')::uuid,null);
 assert (x->'operation'->>'canContinue')::boolean and x->'operation'->>'pendingKind'='review','Declined review lost exact pending stage';
 -- A database failure AFTER source insertion rolls back both save and charge.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,2,3,rate,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,2,3);run:=x->'run';
 candidate:=candidate||jsonb_build_object('expectedVersion',2);
 perform set_config('makeborne.test_operation_settlement_fault','on',true);
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'saved','{}',candidate);
 perform set_config('makeborne.test_operation_settlement_fault','off',true);
 assert x->>'outcome'='save_failed' and (x->>'charged')::int=0 and x->'recovery'->'candidate'=candidate;
 assert (select current_version from public.artifacts where id=a)=2;
 assert not exists(select 1 from public.artifact_versions where artifact_id=a and version_number=3);
 assert (select status='released' from makeborne_private.credit_reservations where user_id=u and reference=run->>'reference');
 -- Unlimited users still have positive run allocations and provider ceilings.
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,true,'Operation fixture');
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,2,1,rate,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,2,1);run:=x->'run';
 assert (run->>'exempt')::boolean and (run->>'amount')::int=1;
 assert public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',rate+1)->'error'->>'code'='OPERATION_BUDGET_REACHED';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,rate,'review_no_change','{}',null);
 assert (x->>'charged')::int=0;
 -- Privileges: anonymous/authenticated cannot call wrapper or private entry.
 assert not has_function_privilege('authenticated','public.makeborne_ai_operation_read(uuid,uuid,uuid,uuid,uuid)','execute');
 assert not has_function_privilege('anon','makeborne_private.ai_operation_read(uuid,uuid,uuid,uuid,uuid)','execute');
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'makeborne_ai_operation_%' and p.prosecdef);
 raise notice 'PASS cumulative cap, idempotency, rounding, absorption, atomic save, recovery, consent, expiry, provider uncertainty, plans, ACL';
end $$;

do $$
declare u uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 op jsonb; x jsonb; run jsonb; call_id uuid:=gen_random_uuid(); hash text:=repeat('a',64); candidate jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@operation-delete.invalid',now()),(owner_id,owner_id||'@operation-owner.invalid',now());
 insert into public.workspaces(id,name,owner_id) values(w,'Delete fixture',owner_id);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'editor');
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Delete fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Delete fixture','website');
 perform public.makeborne_credit_grant(u,50,'topup','operation-delete-fixture','{}');
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,0,5,30000,'{}');
 perform public.makeborne_ai_operation_authorize(u,(op->>'id')::uuid,1,gen_random_uuid(),5);
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,5);run:=x->'run';
 perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',1000);
 delete from public.artifacts where id=a;
 assert not exists(select 1 from makeborne_private.ai_operations where id=(op->>'id')::uuid);
 assert not exists(select 1 from makeborne_private.ai_operation_runs where id=(run->>'id')::uuid);
 assert not exists(select 1 from makeborne_private.ai_operation_authorizations where operation_id=(op->>'id')::uuid);
 assert (select status='released' from makeborne_private.credit_reservations where user_id=u and reference=run->>'reference');
 assert (select count(*)=1 from public.credit_ledger where user_id=u and reference=run->>'reference' and kind='release');
 assert (select status='open' and bound_microusd=1000 from makeborne_private.live_provider_calls where id=call_id);
 assert exists(select 1 from makeborne_private.ai_run_outcomes where user_id=u and reference=run->>'reference');
 begin perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1000); raise exception 'deleted operation dispatched'; exception when no_data_found then null; end;
 perform public.makeborne_provider_call_finish(call_id,500,500,'{}');
 assert (select charged_microusd=500 from makeborne_private.live_provider_calls where id=call_id);
 -- A removed editor account cascades operation context like its wallet, while
 -- its provider audit survives; it does not delete another owner's artifact.
 a:=gen_random_uuid();
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Account delete fixture','website');
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,0,5,30000,'{}');
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,5);run:=x->'run';
 delete from auth.users where id=u;
 assert not exists(select 1 from makeborne_private.ai_operations where actor=u);
 assert not exists(select 1 from makeborne_private.credit_reservations where user_id=u);
 assert exists(select 1 from public.artifacts where id=a);
 assert exists(select 1 from makeborne_private.live_provider_calls where id=call_id);
 -- Workspace cascade releases another actor's still active hold.
 perform public.makeborne_credit_grant(owner_id,50,'topup','workspace-delete-fixture','{}');
 op:=public.makeborne_ai_operation_create(owner_id,w,a,gen_random_uuid(),'build','medium',hash,0,5,30000,'{}');
 x:=public.makeborne_ai_operation_begin(owner_id,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,5);run:=x->'run';
 delete from public.workspaces where id=w;
 assert not exists(select 1 from makeborne_private.ai_operations where id=(op->>'id')::uuid);
 assert (select status='released' from makeborne_private.credit_reservations where user_id=owner_id and reference=run->>'reference');
 raise notice 'PASS artifact/workspace/account deletion, exact hold release, retained provider exposure and audit';
end $$;
rollback;
