-- Disposable local candidate only. All fixtures and limits roll back. No provider calls.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
  op jsonb; run jsonb; x jsonb; replay jsonb; candidate jsonb; receipt jsonb; call_id uuid; before_ bigint; hash text:=repeat('c',64);
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@cancel.invalid',now()),(stranger,stranger||'@cancel.invalid',now());
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into public.workspaces(id,name,owner_id) values(w,'Cancellation fixture',u);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
  perform public.makeborne_credit_grant(u,500,'topup','cancel-fixture','{}');
  perform makeborne_private.set_live_provider_limit('global',true,10000000,false,'Cancellation fixture');
  perform makeborne_private.set_live_provider_limit('anthropic',true,10000000,false,'Cancellation fixture');
  -- Before the first paid attempt: zero charge and no provider ledger entry.
  op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,0,50,30000,'{}');
  x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,50);run:=x->'run';
  begin perform public.makeborne_ai_operation_cancel(stranger,(op->>'id')::uuid,1);raise exception 'Wrong actor stopped operation';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,999);raise exception 'Stale revision stopped operation';exception when sqlstate 'PT409' then null;end;
  x:=public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,1);
  assert (x->'operation'->>'cancelRequested')::boolean and x->'operation'->>'status'='running','durable request while hold settles';
  assert (select cancel_requested_at is not null from makeborne_private.ai_operation_runs where id=(run->>'id')::uuid),'active run marker';
  replay:=public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,1);
  assert x->'operation'=replay->'operation','double Stop is idempotent with original revision';
  begin perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1000);raise exception 'Paid call admitted after Stop';exception when sqlstate 'MB499' then null;end;
  assert not exists(select 1 from makeborne_private.live_provider_calls where run_reference=run->>'reference'),'no provider call reserved';
  x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'failed','{}',null);
  assert x->>'outcome'='cancelled' and (x->>'charged')::int=0 and x->'operation'->>'status'='cancelled','zero-cost finalization';
  assert (x->'operation'->>'reservedCredits')::int=0 and not (x->'operation'->>'canContinue')::boolean,'hold released, no continuation';
  assert (public.makeborne_ai_operation_read(u,w,a,(op->>'id')::uuid,null)->'operation'->>'status')='cancelled','reload sees durable final result';
  raise notice 'PASS cancellation A: ownership, revision, before-call zero charge, double Stop, provider refusal, reload and released hold';

  -- Mid-run confirmed usage: settle once; do not save the racing candidate.
  op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,0,50,30000,'{}');
  x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,50);run:=x->'run';call_id:=gen_random_uuid();
  perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',200000);
  perform public.makeborne_provider_call_finish(call_id,45000,45000,'{}');
  candidate:=jsonb_build_object('expectedVersion',0,'summary','Retained partial work','content',jsonb_build_object('schemaVersion',1,'kind','website','title','Recovered','sections','[]'::jsonb),
    'style','{"id":"test","name":"Test","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{},"description":"","referenceAssetIds":[]}'::jsonb,'assetIds','[]'::jsonb);
  perform public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,1);
  x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,45000,'saved','{"finished":true}',candidate);
  assert x->>'outcome'='cancelled' and (x->>'charged')::int=2,'confirmed usage rounded cumulatively';
  assert (select current_version from public.artifacts where id=a)=0 and x->'recovery'->'candidate'=candidate,'no save after Stop wins; candidate retained';
  assert (x->'operation'->>'reservedCredits')::int=0,'unused 48-credit remainder released';
  select count(*) into before_ from public.credit_ledger where user_id=u;
  replay:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,45000,'saved','{"finished":true}',candidate);
  assert (replay->>'replayed')::boolean and (select count(*) from public.credit_ledger where user_id=u)=before_,'exact finish replay charges once';
  x:=public.makeborne_ai_operation_recover(u,(run->>'id')::uuid,0);
  assert (x->'result'->>'version')::int=1 and (x->'result'->>'charged')::int=2 and x->'recovery'='null'::jsonb,'explicit recovery saves valid partial work';
  assert (select count(*) from public.credit_ledger where user_id=u)=before_,'recovery does not charge twice';
  begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,1,50);raise exception 'Stopped operation restarted';exception when sqlstate 'PT409' then null;end;
  raise notice 'PASS cancellation B: measured charge, no automatic save, released remainder, idempotent settlement and explicit recovery without recharging';

  -- Finish wins the race: a late Stop must preserve the receipt and charge.
  op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'review','medium',hash,1,20,30000,'{}');
  x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'review',hash,1,20);run:=x->'run';
  x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,1000,'review_no_change','{"finished":true}',null);receipt:=x->'result';
  x:=public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,999);
  assert not (x->'operation'->>'cancelRequested')::boolean and x->'result'=receipt,'late Stop leaves successful result unchanged';
  raise notice 'PASS cancellation C: Stop after finish is a no-op';

  -- Uncertain provider use remains bounded exposure, not a fabricated charge.
  op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,1,20,30000,'{}');
  x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,1,20);run:=x->'run';call_id:=gen_random_uuid();
  perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture',200000);
  perform public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,1);
  perform public.makeborne_provider_call_finish(call_id,null,0,'{}');
  x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'failed','{}',null);
  assert (x->>'charged')::int=0 and (x->'operation'->>'providerRemainingMicrousd')::bigint=400000,'unknown usage retains full bound against provider allowance';
  raise notice 'PASS cancellation D: uncertain provider exposure retained, customer charged only confirmed usage';
end $$;
do $$
begin
  assert has_function_privilege('service_role','public.makeborne_ai_operation_cancel(uuid,uuid,integer)','execute');
  assert not has_function_privilege('anon','public.makeborne_ai_operation_cancel(uuid,uuid,integer)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_ai_operation_cancel(uuid,uuid,integer)','execute');
  assert not has_function_privilege('authenticated','makeborne_private.ai_operation_cancel(uuid,uuid,integer)','execute');
  raise notice 'PASS cancellation E: service-only invoker wrapper and private definer grants';
end $$;
rollback;
