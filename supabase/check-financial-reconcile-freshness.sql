\set ON_ERROR_STOP on
begin;
do $$ declare u uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); e timestamptz:=now()+interval '30 days'; begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@financial-freshness.example.invalid',now());
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(req,u,'plan_financialFresh','ch_financialFresh','/studio','ready');
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until,checked_at)
    values('mem_financialFresh',u,'ch_financialFresh','user_financialFresh','plan_financialFresh','active',e,'1970-01-01',now());
  perform public.makeborne_record_plan_observation(u,'mem_financialFresh','plan_financialFresh','create','monthly',300,'active',true,now()-interval '1 minute',e,'reconcile');
  update makeborne_private.plan_observations set recorded_at=now()-interval '21 hours' where membership_id='mem_financialFresh';
  perform public.makeborne_record_plan_observation(u,'mem_financialFresh','plan_financialFresh','create','monthly',300,'active',true,now()-interval '1 minute',e,'access_check');
  assert exists(select 1 from public.makeborne_billing_job_due_memberships(500,72000) where membership_id='mem_financialFresh'),'A recent login must not suppress an overdue financial check';
  perform public.makeborne_record_plan_observation(u,'mem_financialFresh','plan_financialFresh','create','monthly',300,'active',true,now()-interval '1 minute',e,'webhook');
  assert exists(select 1 from public.makeborne_billing_job_due_memberships(500,72000) where membership_id='mem_financialFresh'),'A membership-only webhook must not suppress payment verification';
  perform public.makeborne_record_plan_observation(u,'mem_financialFresh','plan_financialFresh','create','monthly',300,'active',true,now()-interval '1 minute',e,'reconcile');
  assert not exists(select 1 from public.makeborne_billing_job_due_memberships(500,72000) where membership_id='mem_financialFresh'),'A completed financial pass observes the cooldown';
  update makeborne_private.plan_observations set recorded_at=now()-interval '21 hours' where membership_id='mem_financialFresh' and source='reconcile';
  update public.billing_memberships set status='canceled' where membership_id='mem_financialFresh';
  assert exists(select 1 from public.makeborne_billing_job_due_memberships(500,72000) where membership_id='mem_financialFresh'),'Recently canceled memberships still need refund recovery';
  assert not has_function_privilege('anon','public.makeborne_billing_job_due_memberships(integer,integer)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_billing_job_due_memberships(integer,integer)','execute');
  assert has_function_privilege('service_role','public.makeborne_billing_job_due_memberships(integer,integer)','execute');
  assert not (select prosecdef from pg_proc where oid='public.makeborne_billing_job_due_memberships(integer,integer)'::regprocedure);
  raise notice 'PASS financial freshness: logins and membership events cannot starve refunds; financial cooldown, cancellation and privileges preserved';
end $$;
rollback;
