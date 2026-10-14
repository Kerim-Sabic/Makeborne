-- Disposable database only. Every fixture and grant is rolled back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() not in ('makeborne_topup_verify','makeborne_topup_isolated') then
    raise exception 'Refusing top-up fixtures outside the named disposable database';
  end if;
end $$;
do $$
declare
  u uuid:=gen_random_uuid(); other_ uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
  o jsonb; r jsonb; p jsonb; request_ jsonb; oid uuid; second_ uuid; run_ bigint;
  t timestamptz:=now()-interval '1 minute';
begin
  insert into auth.users(id,email,email_confirmed_at,created_at) values(u,'topup-test@example.invalid',now(),now()),(other_,'topup-other@example.invalid',now(),now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Disposable top-up fixture');
  begin
    perform public.makeborne_prepare_topup(u,req,'boost_100','credit-packs-preview-2026-10-05','user_Test');
    raise exception 'Disabled checkout accepted';
  exception when sqlstate 'PT503' then null; end;
  update makeborne_private.topup_catalog set enabled=true,merchant_id='biz_Test',plan_id='plan_Test' where pack_id='boost_100';
  begin update makeborne_private.topup_catalog set price_cents=1300 where pack_id='boost_100'; raise exception 'Historical price changed';
  exception when sqlstate 'PT409' then null; end;
  o:=public.makeborne_prepare_topup(u,req,'boost_100','credit-packs-preview-2026-10-05','user_Test'); oid:=(o->>'id')::uuid;
  assert public.makeborne_prepare_topup(u,req,'boost_100','credit-packs-preview-2026-10-05','user_Test')->>'id'=oid::text;
  assert public.makeborne_prepare_topup(u,gen_random_uuid(),'boost_100','credit-packs-preview-2026-10-05','user_Test')->>'id'=oid::text;
  begin
    perform public.makeborne_prepare_topup(u,req,'boost_300','credit-packs-preview-2026-10-05','user_Test');
    raise exception 'Request binding changed';
  exception when sqlstate 'PT409' then null; end;
  request_:=jsonb_build_object('plan_id','plan_Test','mode','payment','metadata',jsonb_build_object('makeborne_topup_order_id',oid),
    'redirect_url','https://sandbox.whop.com/');
  assert (public.makeborne_claim_topup_checkout(u,oid,request_)->>'claimed')::boolean;
  assert not (public.makeborne_claim_topup_checkout(u,oid,request_)->>'claimed')::boolean;
  begin perform public.makeborne_claim_topup_checkout(u,oid,request_||jsonb_build_object('metadata',jsonb_build_object('makeborne_topup_order_id',oid,'changed',true)));
    raise exception 'Checkout retry changed its body'; exception when sqlstate 'PT409' then null; end;
  update makeborne_private.topup_orders set checkout_started_at=clock_timestamp()-interval '3 minutes' where id=oid;
  begin perform public.makeborne_claim_topup_checkout(u,oid,request_); raise exception 'Unqualified old key retried';
  exception when sqlstate 'PT409' then null; end;
  update makeborne_private.topup_orders set checkout_started_at=clock_timestamp(),checkout_last_attempt=clock_timestamp()-interval '16 seconds' where id=oid;
  assert (public.makeborne_claim_topup_checkout(u,oid,request_)->>'claimed')::boolean;
  perform public.makeborne_save_topup_checkout(u,oid,'ch_Test','https://sandbox.whop.com/checkout/ch_Test');
  assert not (public.makeborne_claim_topup_checkout(u,oid,request_)->>'claimed')::boolean;
  raise notice 'PASS top-ups: checkout request claims, immutable body, bounded retry and saved checkout resume';
  perform public.makeborne_bind_topup_checkout(u,oid,'ch_Test');
  r:=public.makeborne_find_topup_payment('pay_Test','ch_Test','plan_Test','biz_Test');
  assert r->'purchase'->>'id'=oid::text and (r->>'knownPack')::boolean;
  r:=public.makeborne_find_topup_payment('pay_Unbound','ch_Unbound','plan_Test','biz_Test');
  assert r->'purchase'='null'::jsonb and (r->>'knownPack')::boolean;
  begin perform public.makeborne_bind_topup_checkout(other_,oid,'ch_Other'); raise exception 'Other owner bound checkout';
  exception when no_data_found then null; end;
  begin perform public.makeborne_bind_topup_checkout(u,oid,'ch_Other'); raise exception 'Checkout binding changed';
  exception when sqlstate 'PT409' then null; end;
  raise notice 'PASS top-ups: closed catalogue, replay binding and ownership';

  p:=jsonb_build_object('id','pay_Test','merchantId','biz_Test','planId','plan_Test','checkoutId','ch_Test','whopUserId','user_Test',
    'currency','usd','principalCents','1200','refundedPrincipalCents','0','status','paid','dispute','none','updatedAt',t);
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('id','pay_Failed','status','failed','updatedAt',t+interval '1 second'));
  assert r->>'state'='awaiting_payment' and makeborne_private.credit_available(u)=0;
  assert (select payment_id is null from makeborne_private.topup_orders where id=oid);
  r:=public.makeborne_reconcile_topup(u,oid,p);
  assert r->>'state'='funded' and (r->>'granted')::boolean;
  assert makeborne_private.credit_available(u)=100;
  assert public.makeborne_reconcile_topup(u,oid,p)->>'outcome'='duplicate';
  assert public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('updatedAt',t-interval '1 second'))->>'outcome'='stale';
  begin perform public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('dispute','open')); raise exception 'Timestamp conflict accepted';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('merchantId','biz_Other','updatedAt',t+interval '1 second')); raise exception 'Merchant mismatch accepted';
  exception when sqlstate 'PT409' then null; end;
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='topup')=1;
  assert public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('id','pay_Failed','status','failed','updatedAt',t+interval '1 second'))->>'outcome'='ignored_attempt';
  raise notice 'PASS top-ups: failed attempt cannot bind purchase or block out-of-order successful retry';
  raise notice 'PASS top-ups: single grant, duplicate/stale evidence and identity conflicts';

  -- Remove admin exemption before exercising real reservation accounting.
  update makeborne_private.account_privileges set is_admin=false where user_id=u;
  perform makeborne_private.credit_reserve(u,40,'topup-test-hold');
  assert (select held from makeborne_private.credit_lots where user_id=u and source='topup')=40;
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('dispute','open','updatedAt',t+interval '2 seconds'));
  assert r->>'state'='held' and (r->>'withheldCredits')::int=100;
  assert makeborne_private.credit_available(u)=0;
  assert (select status from makeborne_private.credit_reservations where user_id=u and reference='topup-test-hold')='released';
  r:=public.makeborne_credit_settle_run(u,'topup-test-hold',40,false,'{}'::jsonb);
  assert r->>'outcome'='released_hold', 'Late settlement must refuse a released hold: '||r;
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('dispute','won','updatedAt',t+interval '3 seconds'));
  assert r->>'state'='funded' and makeborne_private.credit_available(u)=100;
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='topup')=1;
  raise notice 'PASS top-ups: dispute aborts funded reservations; winning restores original lot';

  perform makeborne_private.credit_reserve(u,30,'topup-test-spend');
  perform makeborne_private.credit_settle(u,'topup-test-spend',30);
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('refundedPrincipalCents','100','updatedAt',t+interval '4 seconds'));
  assert r->>'state'='held' and (r->>'withheldCredits')::int=70 and (r->>'consumedExposureCredits')::int=30;
  assert makeborne_private.credit_available(u)=0;
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('refundedPrincipalCents','1200','status','refunded','updatedAt',t+interval '5 seconds'));
  assert r->>'state'='reversed' and (r->>'consumedExposureCredits')::int=30;
  r:=public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('refundedPrincipalCents','1200','status','refunded','updatedAt',t+interval '6 seconds'));
  assert makeborne_private.credit_available(u)=0;
  begin perform public.makeborne_reconcile_topup(u,oid,p||jsonb_build_object('updatedAt',t+interval '7 seconds')); raise exception 'Refund regression accepted';
  exception when sqlstate 'PT409' then null; end;
  assert (select sum(delta) from public.credit_ledger where user_id=u)=makeborne_private.credit_available(u);
  raise notice 'PASS top-ups: partial/full refund, consumed exposure, no repeated debit or negative balance';

  update makeborne_private.account_privileges set is_admin=true where user_id=u;
  o:=public.makeborne_prepare_topup(u,gen_random_uuid(),'boost_100','credit-packs-preview-2026-10-05','user_Test'); second_:=(o->>'id')::uuid;
  begin perform public.makeborne_bind_topup_checkout(u,second_,'ch_Test'); raise exception 'Checkout reused';
  exception when unique_violation then null; end;
  perform public.makeborne_bind_topup_checkout(u,second_,'ch_Second');
  p:=p||jsonb_build_object('id','pay_Second','checkoutId','ch_Second','status','refunded','refundedPrincipalCents','1200');
  r:=public.makeborne_reconcile_topup(u,second_,p);
  assert r->>'state'='reversed' and not (r->>'granted')::boolean;
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='topup')=1;
  raise notice 'PASS top-ups: refund before delivery grants nothing; globally unique checkout';

  r:=public.makeborne_topup_due_orders(101,3600);
  assert exists(select 1 from jsonb_array_elements(r) v where v->>'id'=second_::text);
  begin perform public.makeborne_topup_record_check(second_,'cursor2',null,-1); raise exception 'Unleased job advanced cursor';
  exception when sqlstate 'PT409' then null; end;
  run_:=public.makeborne_billing_job_begin('credit_topups',30);
  assert run_ is not null;
  assert public.makeborne_billing_job_begin('credit_topups',30) is null;
  assert public.makeborne_topup_record_check(second_,'cursor2','TOPUP_PAYMENT_SCAN_INCOMPLETE',run_);
  assert not exists(select 1 from jsonb_array_elements(public.makeborne_topup_due_orders(101,3600)) v where v->>'id'=second_::text);
  assert (public.makeborne_topup_job_health()->>'openIssues')::int=1;
  update makeborne_private.billing_job_runs set lease_until=clock_timestamp()-interval '1 second' where id=run_;
  begin perform public.makeborne_topup_record_check(second_,null,null,run_); raise exception 'Expired worker advanced cursor';
  exception when sqlstate 'PT409' then null; end;
  raise notice 'PASS top-ups: fair due queue, durable cursor, monitoring, overlapping/expired lease refusal';

  assert not has_table_privilege('service_role','makeborne_private.topup_orders','SELECT');
  assert has_function_privilege('service_role','public.makeborne_reconcile_topup(uuid,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.makeborne_reconcile_topup(uuid,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('anon','public.makeborne_prepare_topup(uuid,uuid,text,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','makeborne_private.reconcile_topup(uuid,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.makeborne_find_topup_payment(text,text,text,text)','EXECUTE');
  raise notice 'PASS top-ups: browser roles refused; server RPC only, no direct table access';
end $$;
set local role service_role;
select public.makeborne_find_topup_payment('pay_Unbound','ch_Unbound','plan_Unbound','biz_Unbound');
do $$ begin
  begin perform id from makeborne_private.topup_orders; raise exception 'Service role bypassed RPC table boundary';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
