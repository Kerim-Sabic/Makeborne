-- Local, disposable candidate DB only; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
create function pg_temp.billing_user() returns uuid language plpgsql as $$
declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@billing-lifecycle.example.invalid',now()); return u;
end $$;
create function pg_temp.billing_period(u uuid,m text,s timestamptz,e timestamptz,iv text default 'monthly') returns void language sql as $$
 insert into makeborne_private.plan_periods(membership_id,user_id,period_start,period_end,billing_interval) values(m,u,s,e,iv);
$$;
create function pg_temp.billing_obs(u uuid,m text,at timestamptz,s timestamptz,e timestamptz,c int,iv text default 'monthly',outcome text default 'recorded') returns void language sql as $$
 insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,period_start,period_end,outcome)
 values(m,u,at,'fixture','active',true,'plan_lifecycle',case when c=300 then 'create' else 'studio' end,iv,c,s,e,outcome);
$$;

do $$ declare u uuid:=pg_temp.billing_user(); r jsonb; s timestamptz:='2027-01-15Z'; e timestamptz:='2027-02-15Z'; begin
 perform pg_temp.billing_period(u,'mem_renewal',s,e);
 perform pg_temp.billing_period(u,'mem_renewal',e,e+interval '1 month');
 perform pg_temp.billing_obs(u,'mem_renewal',s+interval '1 second',s,e,850);
 r:=makeborne_private.reconcile_plan_membership('mem_renewal',e+interval '2 days');
 assert (r->>'granted')::int=1 and (r->>'unresolved')::int=1,'Previous paid month must not authorize renewal: '||r;
 perform pg_temp.billing_obs(u,'mem_renewal',e+interval '1 second',e,e+interval '1 month',300);
 r:=makeborne_private.reconcile_plan_membership('mem_renewal',e+interval '2 days');
 assert (select sum(delta) from public.credit_ledger where user_id=u and kind='plan_grant')=1150,'Renewal must use its own lower tier';
 -- A late old-period observation carries its exact old anchor and cannot raise this renewal.
 perform pg_temp.billing_obs(u,'mem_renewal',e+interval '1 day',s,e,850);
 r:=makeborne_private.reconcile_plan_membership('mem_renewal',e+interval '2 days');
 assert (r->>'granted')::int=0,'Late prior-period observation must not top up renewal';
 perform pg_temp.billing_obs(u,'mem_renewal',e+interval '1 day',e,e+interval '1 month',850,'monthly','anchor_conflict');
 perform pg_temp.billing_obs(u,'mem_renewal',e+interval '1 day',null,null,850,'monthly','missing_period');
 r:=makeborne_private.reconcile_plan_membership('mem_renewal',e+interval '2 days');
 assert (r->>'granted')::int=0,'Invalid/missing anchors must not authorize a top-up';
 raise notice 'PASS lifecycle: renewal requires period-local evidence; stale older and invalid anchors cannot increase renewal credits';
end $$;

do $$ declare u uuid:=pg_temp.billing_user(); r jsonb; s timestamptz:='2027-03-01Z'; begin
 -- Paid renewal delivered before the initial period is discovered; each stays in its month.
 perform public.makeborne_record_plan_payment(u,'mem_reverse','pay_reverseRenew','plan_lifecycle','studio','monthly',850,'subscription_cycle',s+interval '1 month 1 second',false);
 perform pg_temp.billing_period(u,'mem_reverse',s,s+interval '1 month');
 perform pg_temp.billing_period(u,'mem_reverse',s+interval '1 month',s+interval '2 months');
 r:=makeborne_private.reconcile_plan_membership('mem_reverse',s+interval '1 month 2 days');
 assert (r->>'unresolved')::int=1 and (r->>'granted')::int=1,'Late renewal cannot fund older month';
 perform public.makeborne_record_plan_payment(u,'mem_reverse','pay_reverseInitial','plan_lifecycle','create','monthly',300,'subscription_create',s+interval '1 second',false);
 r:=makeborne_private.reconcile_plan_membership('mem_reverse',s+interval '1 month 2 days');
 assert (select sum(delta) from public.credit_ledger where user_id=u and kind='plan_grant')=1150;
 r:=makeborne_private.reconcile_plan_membership('mem_reverse',s+interval '1 month 2 days');
 assert (r->>'granted')::int=0;
 raise notice 'PASS lifecycle: reversed renewal/initial evidence order and repeated reconciliation preserve exactly one grant per paid month';
end $$;

do $$ declare u uuid:=pg_temp.billing_user(); other uuid:=pg_temp.billing_user(); r jsonb; s timestamptz:=date_trunc('second',now())-interval '10 days'; e timestamptz:=s+interval '1 month'; begin
 perform makeborne_private.credit_grant_plan_allocation(u,'mem_original',s,e,'create',300,null,'{}');
 perform public.makeborne_credit_grant(u,50,'topup','lifecycle-topup','{}');
 r:=makeborne_private.credit_grant_plan_allocation(u,'mem_replacement',s+interval '1 day',e+interval '1 day','studio',850,null,'{}');
 assert r->>'blocked'='account_overlap' and (r->>'amount')::int=0;
 assert exists(select 1 from makeborne_private.plan_credit_issues where user_id=u and membership_id='mem_replacement' and kind='account_overlap' and resolved_at is null);
 assert makeborne_private.credit_available(u)=350,'Original credits and top-up stay untouched';
 assert (select expires_at is null and amount=50 and lapsed=0 from makeborne_private.credit_lots where user_id=u and reference='lifecycle-topup');
 r:=makeborne_private.credit_grant_plan_allocation(u,'mem_original',s,e,'studio',850,null,'{}');
 assert (r->>'amount')::int=550,'Same membership allocation retains difference-only upgrade';
 r:=makeborne_private.credit_grant_plan_allocation(u,'mem_replacement',e,e+interval '1 month','create',300,null,'{}');
 assert (r->>'amount')::int=300,'Adjacent replacement allocation is not overlapping';
 r:=makeborne_private.credit_grant_plan_allocation(other,'mem_other',s,e,'create',300,null,'{}');
 assert (r->>'amount')::int=300,'Independent account unaffected';
 raise notice 'PASS lifecycle: account overlap refused durably; same-membership difference-only grants, adjacent time and other accounts allowed; top-ups unchanged';
end $$;

do $$ declare u uuid:=pg_temp.billing_user(); r jsonb; s timestamptz:=date_trunc('month',now())-interval '11 months'; e timestamptz:=s+interval '1 year'; begin
 perform pg_temp.billing_period(u,'mem_annualExpiry',s,e,'yearly');
 perform pg_temp.billing_obs(u,'mem_annualExpiry',s+interval '1 second',s,e,300,'yearly');
 r:=makeborne_private.reconcile_plan_membership('mem_annualExpiry',e-interval '1 second');
 assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='plan')=12,'Annual must allocate twelve monthly lots';
 assert not exists(select 1 from makeborne_private.credit_lots where user_id=u and expires_at<>(metadata->>'allocationEnd')::timestamptz+interval '2 months'),'Every annual lot expires from its month, never annual renewal or late delivery';
 assert (select count(*) from makeborne_private.credit_lots where user_id=u and lapsed=amount)=9,'Delayed catch-up leaves nine expired months lapsed';
 assert makeborne_private.credit_available(u)=900,'Only current month plus two rollover months remain';
 r:=makeborne_private.reconcile_plan_membership('mem_annualExpiry',e-interval '1 second');
 assert (r->>'granted')::int=0;
 assert not exists(select 1 from makeborne_private.credit_lots where user_id=u and (metadata->>'allocationStart')::timestamptz>=e),'No thirteenth annual allocation';
 raise notice 'PASS lifecycle: twelve annual monthly lots; late catch-up never resurrects expired months; every lot uses allocation end plus two months';
end $$;

do $$ declare u uuid:=pg_temp.billing_user(); begin
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),u,'plan_lifecycle','ch_lifecycle1','/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end) values('mem_lifecycle1',u,'ch_lifecycle1','user_lifecycle','plan_lifecycle','active',now()+interval '1 month');
 begin
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),u,'plan_lifecycle','ch_lifecycle2','/studio','ready');
  raise exception 'Duplicate active account checkout allowed';
 exception when sqlstate 'PBC01' then null; end;
 update public.billing_memberships set status='expired' where membership_id='mem_lifecycle1';
 begin
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end) values('mem_replayed',u,'ch_lifecycle1','user_lifecycle','plan_lifecycle','active',now()+interval '1 month');
  raise exception 'Reused completed checkout allowed';
 exception when sqlstate 'PBC03' then null; end;
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),u,'plan_lifecycle','ch_lifecycle2','/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end) values('mem_lifecycle2',u,'ch_lifecycle2','user_lifecycle','plan_lifecycle','active',now()+interval '1 month');
 begin
  update public.billing_memberships set status='active' where membership_id='mem_lifecycle1';
  raise exception 'Old membership reactivation created duplicate active subscription';
 exception when sqlstate 'PBC01' then null; end;
 raise notice 'PASS lifecycle: active subscription blocks checkout; completed checkout cannot bind another membership; stale reactivation cannot duplicate account subscription';
end $$;

do $$ declare r text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(r,'makeborne_private.credit_grant_plan_allocation(uuid,text,timestamptz,timestamptz,text,bigint,text,jsonb)','EXECUTE');
  assert not has_function_privilege(r,'makeborne_private.plan_allocation_conflict(uuid,text,timestamptz,timestamptz)','EXECUTE');
  assert not has_function_privilege(r,'makeborne_private.guard_creation_membership()','EXECUTE');
 end loop;
 assert has_function_privilege('service_role','public.makeborne_record_plan_observation(uuid,text,text,text,text,integer,text,boolean,timestamptz,timestamptz,text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.makeborne_record_plan_observation(uuid,text,text,text,text,integer,text,boolean,timestamptz,timestamptz,text)','EXECUTE');
 raise notice 'PASS lifecycle: private helpers unavailable to browser and service roles; original service-only observation entry point retained';
end $$;
rollback;
