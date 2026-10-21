\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); c jsonb; next_claim jsonb; e timestamptz:=now()+interval '30 days'; before_events bigint;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@recovery.example.invalid',now()),(other_user,other_user||'@recovery.example.invalid',now());
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(req,u,'plan_recovery','ch_recovery','/studio','ready');
  assert public.makeborne_claim_checkout_recovery(other_user,req) is null,'Another account cannot claim the request';
  c:=public.makeborne_claim_checkout_recovery(u,req); assert c->>'checkout_id'='ch_recovery';
  assert public.makeborne_claim_checkout_recovery(u,req) is null,'Parallel/duplicate return must not contact provider';
  assert not public.makeborne_bind_checkout_recovery(req,gen_random_uuid(),'mem_recovery','user_buyer','pay_recovery','active',e),'Wrong fence cannot bind';
  select count(*) into before_events from public.billing_webhook_events;
  assert public.makeborne_bind_checkout_recovery(req,(c->>'lease')::uuid,'mem_recovery','user_buyer','pay_recovery','active',e);
  assert (select verified_until='1970-01-01'::timestamptz from public.billing_memberships where membership_id='mem_recovery'),'Binding alone must not open access';
  assert (select count(*) from public.credit_ledger where user_id=u)=0,'Binding alone cannot mint credits';
  assert (select count(*) from public.billing_webhook_events)=before_events,'Recovery must never invent a signed webhook';
  assert not public.makeborne_finish_checkout_recovery(req,(c->>'lease')::uuid,'recovered','funded'),'Cannot complete before payment SQL is funded';
  begin
    perform public.makeborne_bind_checkout_recovery(req,(c->>'lease')::uuid,'mem_recovery','user_other','pay_recovery','active',e);
    raise exception 'Expected immutable payer refusal';
  exception when insufficient_privilege then null; end;
  update makeborne_private.checkout_recoveries set lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where request_id=req;
  next_claim:=public.makeborne_claim_checkout_recovery(u,req); assert next_claim is not null and next_claim->>'lease'<>c->>'lease','A killed process can resume after lease expiry';
  assert not public.makeborne_bind_checkout_recovery(req,(c->>'lease')::uuid,'mem_recovery','user_buyer','pay_recovery','active',e),'Old process fenced';
  assert public.makeborne_bind_checkout_recovery(req,(next_claim->>'lease')::uuid,'mem_recovery','user_buyer','pay_recovery','active',e);
  assert (select count(*) from public.billing_memberships where membership_id='mem_recovery')=1,'No duplicate binding on recovery';
  perform public.makeborne_reconcile_plan_payment(u,'mem_recovery',jsonb_build_object('id','pay_recovery','membershipId','mem_recovery','planId','plan_recovery',
    'billingReason','subscription_create','currency','usd','principalCents','2900','refundedPrincipalCents','0','status','paid','dispute','none','paidAt',now(),'updatedAt',now()),now()-interval '1 minute',e);
  perform public.makeborne_record_plan_observation(u,'mem_recovery','plan_recovery','create','monthly',300,'active',true,now()-interval '1 minute',e,'reconcile');
  assert public.makeborne_finish_checkout_recovery(req,(next_claim->>'lease')::uuid,'recovered','funded');
  assert public.makeborne_claim_checkout_recovery(u,req) is null,'Finished recovery cannot run again';
  assert (select sum(delta) from public.credit_ledger where user_id=u)=300,'Actual wallet receives exactly one allocation';
  assert (select count(*) from public.billing_webhook_events)=before_events;
  raise notice 'PASS checkout recovery: ownership, lease contention, stale fence, no fake events, no access/grant before payment, restart and exactly one allocation';
end $$;
do $$ declare f text; begin
  foreach f in array array['makeborne_claim_checkout_recovery(uuid,uuid)','makeborne_bind_checkout_recovery(uuid,uuid,text,text,text,text,timestamptz)',
    'makeborne_finish_checkout_recovery(uuid,uuid,text,text)','makeborne_due_checkout_recoveries(integer)','makeborne_checkout_recovery_health()'] loop
    assert not has_function_privilege('anon','public.'||f,'EXECUTE');
    assert not has_function_privilege('authenticated','public.'||f,'EXECUTE');
    assert has_function_privilege('service_role','public.'||f,'EXECUTE');
    assert not (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure),'No exposed security definer';
  end loop;
  assert (select relrowsecurity from pg_class where oid='makeborne_private.checkout_recoveries'::regclass);
  assert not has_table_privilege('anon','makeborne_private.checkout_recoveries','SELECT');
  assert not has_table_privilege('authenticated','makeborne_private.checkout_recoveries','SELECT');
  raise notice 'PASS checkout recovery: service-only wrappers, no new exposed definer, private table RLS and no browser grants';
end $$;
rollback;
