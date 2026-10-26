\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
create function pg_temp.repurchase_user() returns uuid language plpgsql as $$
declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@repurchase.example.invalid',now()); return u;
end $$;
create function pg_temp.expect_repurchase_block(u uuid,r uuid) returns void language plpgsql as $$
begin
 begin
  insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(r,u,'plan_repurchase','/studio','pending');
  raise exception 'Expected pre-checkout overlap refusal';
 exception when sqlstate 'PBC03' then null; end;
end $$;

do $$ declare u uuid:=pg_temp.repurchase_user(); req uuid:=gen_random_uuid(); before_ledger bigint;
 s timestamptz:=date_trunc('second',now())-interval '1 day'; e timestamptz:=s+interval '1 month'; p jsonb; begin
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,purchase_url,return_path,status)
 values(req,u,'plan_repurchase','ch_repurchase','https://sandbox.whop.com/checkout/ch_repurchase','/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end)
 values('mem_repurchase',u,'ch_repurchase','user_repurchase','plan_repurchase','active',e);
 p:=jsonb_build_object('id','pay_repurchase','membershipId','mem_repurchase','planId','plan_repurchase','billingReason','subscription_create',
 'currency','usd','principalCents','2000','refundedPrincipalCents','0','status','paid','dispute','none','paidAt',s+interval '1 second','updatedAt',s+interval '1 hour');
 perform public.makeborne_reconcile_plan_payment(u,'mem_repurchase',p,s,e);
 perform public.makeborne_record_plan_observation(u,'mem_repurchase','plan_repurchase','create','monthly',300,'active',true,s,e,'webhook');
 assert makeborne_private.credit_available(u)=300;
 perform public.makeborne_reconcile_plan_payment(u,'mem_repurchase',p||jsonb_build_object('status','refunded','refundedPrincipalCents','2000','updatedAt',now()),s,e);
 update public.billing_memberships set status='canceled' where membership_id='mem_repurchase';
 -- A real full-refund reversal empties the wallet but retains grant evidence.
 select count(*) into before_ledger from public.credit_ledger where user_id=u;
 perform pg_temp.expect_repurchase_block(u,gen_random_uuid());
 perform pg_temp.expect_repurchase_block(u,req);
 assert (select count(*) from public.billing_checkouts where user_id=u)=1,'No new checkout row/payment link';
 assert (select count(*) from public.credit_ledger where user_id=u)=before_ledger,'No grant/refund mutation';
 assert (select balance from makeborne_private.credit_wallets where user_id=u)=0;
 raise notice 'PASS repurchase: current prior allowance blocks new and retained request IDs before unique/resume, even with zero wallet';
end $$;

do $$ declare u uuid:=pg_temp.repurchase_user(); begin
 perform makeborne_private.credit_grant_plan_allocation(u,'mem_expiredRepurchase',now()-interval '65 days',now()-interval '35 days','create',300,null,'{}');
 insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(gen_random_uuid(),u,'plan_repurchase','/studio','pending');
 raise notice 'PASS repurchase: non-overlapping historical allocation permits subscription';
end $$;

do $$ declare u uuid:=pg_temp.repurchase_user(); begin
 perform public.makeborne_credit_grant(u,100,'topup','repurchase-topup','{}');
 insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(gen_random_uuid(),u,'plan_repurchase','/studio','pending');
 raise notice 'PASS repurchase: top-up-only account may subscribe';
end $$;

do $$ declare u uuid:=pg_temp.repurchase_user(); begin
 perform public.makeborne_credit_grant(u,300,'plan_grant','plan:mem_unknownRepurchase:legacy',jsonb_build_object('expiresAt',now()+interval '1 month'));
 perform pg_temp.expect_repurchase_block(u,gen_random_uuid());
 raise notice 'PASS repurchase: unknown legacy allocation dates fail closed';
end $$;

do $$ declare u uuid:=pg_temp.repurchase_user(); req uuid:=gen_random_uuid(); begin
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(req,u,'plan_repurchase','ch_activeRepurchase','/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end)
 values('mem_activeRepurchase',u,'ch_activeRepurchase','user_activeRepurchase','plan_repurchase','active',now()+interval '30 days');
 begin
  insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(gen_random_uuid(),u,'plan_repurchase','/studio','pending');
  raise exception 'Expected active subscription refusal';
 exception when sqlstate 'PBC01' then null; end;
 assert not has_function_privilege('anon','makeborne_private.guard_creation_checkout()','EXECUTE');
 assert not has_function_privilege('authenticated','makeborne_private.guard_creation_checkout()','EXECUTE');
 assert not has_function_privilege('service_role','makeborne_private.guard_creation_checkout()','EXECUTE');
 raise notice 'PASS repurchase: active guard and trigger-only permissions preserved';
end $$;
rollback;
