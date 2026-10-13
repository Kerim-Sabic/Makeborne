-- Plan credit allocation checks from recorded billing history.
-- LOCAL DATABASE; everything runs in rolled-back transactions and commits nothing.
-- Concurrency across real sessions is in check-plan-credit-concurrency.sql (isolated database only).
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-plan-credit-allocations.sql
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';

-- Fixture helpers (session-temporary, rolled back with the transaction).
create function pg_temp.obs(m text, u uuid, at timestamptz, tier text, credits integer, paid boolean, iv text default 'yearly', st text default 'active') returns void
language sql as $$
  insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome)
  values(m,u,at,'fixture',st,paid,'plan_fixture',tier,iv,credits,'recorded');
$$;
create function pg_temp.period(m text, u uuid, s timestamptz, e timestamptz, iv text default 'yearly') returns void
language sql as $$
  insert into makeborne_private.plan_periods(membership_id,period_start,period_end,user_id,billing_interval) values(m,s,e,u,iv);
$$;
create function pg_temp.month_total(u uuid, m text, s timestamptz) returns bigint
language sql as $$
  select coalesce(sum(delta),0) from public.credit_ledger where user_id=u and kind='plan_grant'
    and left(reference, length('plan:'||m||':'||to_char(s at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':'))
      = 'plan:'||m||':'||to_char(s at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':';
$$;
-- Totals per allocation month, in order, for one membership.
create function pg_temp.months(u uuid, m text) returns bigint[]
language sql as $$
  select coalesce(array_agg(total order by month), '{}') from (
    select split_part(substr(reference, length('plan:'||m||':')+1), ':', 1) || ':' || split_part(substr(reference, length('plan:'||m||':')+1), ':', 2)
      || ':' || split_part(substr(reference, length('plan:'||m||':')+1), ':', 3) as month, sum(delta) as total
    from public.credit_ledger where user_id=u and kind='plan_grant' and left(reference, length('plan:'||m||':')) = 'plan:'||m||':'
    group by 1) t;
$$;

do $$
declare
  u uuid:=gen_random_uuid(); r jsonb; s timestamptz := '2027-01-31T10:00:00Z'; e timestamptz := '2028-01-31T10:00:00Z'; k integer;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@plan-history.example.invalid',now());

  -- 1. Upgrade in month 6 (Jun 30 - Jul 31) seen in a delayed catch-up: months 1-5 keep Create.
  perform pg_temp.period('mem_up',u,s,e);
  perform pg_temp.obs('mem_up',u,s + interval '5 seconds','create',300,true);
  perform pg_temp.obs('mem_up',u,'2027-07-10T00:00:00Z','studio',850,true);
  r := makeborne_private.reconcile_plan_membership('mem_up','2027-07-15T00:00:00Z');   -- first reconcile ever: catch-up across the change
  assert pg_temp.months(u,'mem_up') = '{300,300,300,300,300,850}', 'Upgrade in month 6: '||pg_temp.months(u,'mem_up')::text;
  r := makeborne_private.reconcile_plan_membership('mem_up','2027-08-05T00:00:00Z');
  assert pg_temp.months(u,'mem_up') = '{300,300,300,300,300,850,850}', 'Month 7 at Studio: '||pg_temp.months(u,'mem_up')::text;
  assert pg_temp.month_total(u,'mem_up','2027-02-28T10:00:00Z') = 300, 'February must stay at 300 (no retroactive top-up)';
  raise notice 'PASS upgrade in month 6: months 1-5 unchanged, month 6 topped up, month 7 at the new tier (incl. delayed catch-up)';

  -- 2. Downgrade in month 6: month 6 keeps Studio (no clawback, no extra), month 7 is Create.
  perform pg_temp.period('mem_down',u,s,e);
  perform pg_temp.obs('mem_down',u,s + interval '5 seconds','studio',850,true);
  r := makeborne_private.reconcile_plan_membership('mem_down','2027-03-01T00:00:00Z');  -- months 1-2 granted before the change
  perform pg_temp.obs('mem_down',u,'2027-07-10T00:00:00Z','create',300,true);
  r := makeborne_private.reconcile_plan_membership('mem_down','2027-08-05T00:00:00Z');
  assert pg_temp.months(u,'mem_down') = '{850,850,850,850,850,850,300}', 'Downgrade: '||pg_temp.months(u,'mem_down')::text;
  raise notice 'PASS downgrade in month 6: month 6 unchanged, month 7 at the lower tier, no clawback';

  -- 3. Repeated changes: up and down inside one month, then up again.
  perform pg_temp.period('mem_flip',u,s,e);
  perform pg_temp.obs('mem_flip',u,s + interval '5 seconds','create',300,true);
  perform pg_temp.obs('mem_flip',u,'2027-03-05T00:00:00Z','studio',850,true);   -- month 2 (Feb 28 - Mar 31): upgrade
  perform pg_temp.obs('mem_flip',u,'2027-03-20T00:00:00Z','create',300,true);   -- month 2: downgrade
  perform pg_temp.obs('mem_flip',u,'2027-04-10T00:00:00Z','scale',2200,true);   -- month 3 (Mar 31 - Apr 30): upgrade over Create
  perform pg_temp.obs('mem_flip',u,'2027-04-20T00:00:00Z','studio',850,true);   -- month 3: downgrade to Studio
  r := makeborne_private.reconcile_plan_membership('mem_flip','2027-05-10T00:00:00Z');
  assert pg_temp.months(u,'mem_flip') = '{300,850,2200,850}', 'Repeated changes: '||pg_temp.months(u,'mem_flip')::text;
  -- Running again (duplicate deliveries) changes nothing.
  for k in 1..3 loop r := makeborne_private.reconcile_plan_membership('mem_flip','2027-05-10T00:00:00Z'); end loop;
  assert pg_temp.months(u,'mem_flip') = '{300,850,2200,850}', 'Repeats changed grants';
  raise notice 'PASS repeated upgrades/downgrades: each month gets its historical tier plus in-month upgrades only; repeats idempotent';

  -- 4. Monthly -> yearly at renewal, then yearly -> monthly at the next renewal.
  perform pg_temp.period('mem_iv',u,'2027-01-15T00:00:00Z','2027-02-15T00:00:00Z','monthly');
  perform pg_temp.obs('mem_iv',u,'2027-01-15T00:00:05Z','create',300,true,'monthly');
  perform pg_temp.period('mem_iv',u,'2027-02-15T00:00:00Z','2028-02-15T00:00:00Z','yearly');
  perform pg_temp.obs('mem_iv',u,'2027-02-15T00:00:05Z','create',300,true,'yearly');
  perform pg_temp.period('mem_iv',u,'2028-02-15T00:00:00Z','2028-03-15T00:00:00Z','monthly');
  perform pg_temp.obs('mem_iv',u,'2028-02-15T00:00:05Z','studio',850,true,'monthly');
  r := makeborne_private.reconcile_plan_membership('mem_iv','2028-02-20T00:00:00Z');
  assert array_length(pg_temp.months(u,'mem_iv'),1) = 14, 'Monthly(1) + yearly(12) + monthly(1) allocations: '||pg_temp.months(u,'mem_iv')::text;
  assert pg_temp.months(u,'mem_iv') = array_fill(300::bigint, array[13]) || array[850::bigint], 'Interval transitions: '||pg_temp.months(u,'mem_iv')::text;
  raise notice 'PASS monthly->yearly->monthly transitions at renewal boundaries: 14 allocations, no gap or duplicate';

  -- 5. Month ends and leap years: allocation starts follow the anchor, clamped, never drifting.
  perform pg_temp.period('mem_leap',u,'2028-02-29T09:30:00Z','2029-02-28T09:30:00Z');
  perform pg_temp.obs('mem_leap',u,'2028-02-29T09:30:05Z','create',300,true);
  r := makeborne_private.reconcile_plan_membership('mem_leap','2029-02-01T00:00:00Z');
  assert pg_temp.month_total(u,'mem_leap','2028-02-29T09:30:00Z')=300 and pg_temp.month_total(u,'mem_leap','2028-03-29T09:30:00Z')=300
    and pg_temp.month_total(u,'mem_leap','2029-01-29T09:30:00Z')=300 and array_length(pg_temp.months(u,'mem_leap'),1)=12, 'Leap-day anchor: '||pg_temp.months(u,'mem_leap')::text;
  perform pg_temp.period('mem_end',u,s,e);
  perform pg_temp.obs('mem_end',u,s + interval '5 seconds','create',300,true);
  r := makeborne_private.reconcile_plan_membership('mem_end','2027-05-01T00:00:00Z');
  assert pg_temp.month_total(u,'mem_end','2027-02-28T10:00:00Z')=300 and pg_temp.month_total(u,'mem_end','2027-03-31T10:00:00Z')=300
    and pg_temp.month_total(u,'mem_end','2027-04-30T10:00:00Z')=300 and array_length(pg_temp.months(u,'mem_end'),1)=4, 'Month-end anchor: '||pg_temp.months(u,'mem_end')::text;
  -- Renewal boundary: month 12 of one year and month 1 of the next are separate, each once.
  perform pg_temp.period('mem_end',u,e,'2029-01-31T10:00:00Z');
  r := makeborne_private.reconcile_plan_membership('mem_end','2028-02-15T00:00:00Z');
  assert pg_temp.month_total(u,'mem_end','2027-12-31T10:00:00Z')=300 and pg_temp.month_total(u,'mem_end',e)=300 and array_length(pg_temp.months(u,'mem_end'),1)=13, 'Renewal boundary (12 + first month of year 2): '||pg_temp.months(u,'mem_end')::text;
  raise notice 'PASS month ends (Jan 31 anchor), leap years (Feb 29 anchor) and renewal boundaries';

  -- 6. Cancellation: canceling keeps paid months; an immediate cancel stops later months; reactivation resumes.
  perform pg_temp.period('mem_cancel',u,s,e);
  perform pg_temp.obs('mem_cancel',u,s + interval '5 seconds','create',300,true);
  perform pg_temp.obs('mem_cancel',u,'2027-03-10T00:00:00Z','create',300,true,'yearly','canceling');
  perform pg_temp.obs('mem_cancel',u,'2027-05-10T00:00:00Z','create',300,false,'yearly','canceled');
  perform pg_temp.obs('mem_cancel',u,'2027-08-10T00:00:00Z','create',300,true,'yearly','active');
  r := makeborne_private.reconcile_plan_membership('mem_cancel','2027-09-15T00:00:00Z');
  -- Months starting Jan 31..Apr 30 paid (4), May 31..Jul 31 cancelled (0), Aug 31 resumed (1).
  assert pg_temp.months(u,'mem_cancel') = '{300,300,300,300,300}' and pg_temp.month_total(u,'mem_cancel','2027-05-31T10:00:00Z')=0
    and pg_temp.month_total(u,'mem_cancel','2027-08-31T10:00:00Z')=300, 'Cancellation: '||pg_temp.months(u,'mem_cancel')::text;
  raise notice 'PASS cancellation: canceling keeps months, cancelled months not granted, reactivation resumes';

  -- 7. A grant from the previous release (one reference per period) counts for allocation 1.
  perform public.makeborne_credit_grant(u,300,'plan_grant','plan:mem_legacy:2028-01-31T10:00:00.000Z','{"expiresAt":"2027-02-28T10:00:00Z"}');
  perform pg_temp.period('mem_legacy',u,s,e);
  perform pg_temp.obs('mem_legacy',u,s + interval '5 seconds','create',300,true);
  r := makeborne_private.reconcile_plan_membership('mem_legacy','2027-03-15T00:00:00Z');
  assert (select count(*) from public.credit_ledger where user_id=u and reference like 'plan:mem_legacy:%')=2
    and pg_temp.month_total(u,'mem_legacy','2027-02-28T10:00:00Z')=300, 'Legacy grant must cover allocation 1 only';
  raise notice 'PASS earlier single-reference grants honoured';

  -- 8. First seen in month 6 (missed webhooks): no evidence for months 1-5, so they become open issues;
  --    nothing borrows the later tier. Months 6-8 follow the evidence.
  perform pg_temp.period('mem_late',u,s,e);
  insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,period_start,period_end,outcome)
  values('mem_late',u,'2027-07-10T00:00:00Z','fixture','active',true,'plan_fixture','create','yearly',300,s,e,'recorded');
  perform pg_temp.obs('mem_late',u,'2027-08-15T00:00:00Z','scale',2200,true);
  r := makeborne_private.reconcile_plan_membership('mem_late','2027-09-05T00:00:00Z');
  assert pg_temp.months(u,'mem_late') = '{300,2200,2200}' and (r->>'unresolved')::int = 5, 'Late first observation: '||pg_temp.months(u,'mem_late')::text||' '||r::text;
  assert (select count(*) from makeborne_private.plan_credit_issues where membership_id='mem_late' and resolved_at is null and kind='no_evidence')=5, 'Five open issues expected';
  -- Recoverable: a paid initial payment (Whop billing_reason subscription_create) at the period start is evidence.
  r := public.makeborne_record_plan_payment(u,'mem_late','pay_late1','plan_fixture','create','yearly',300,'subscription_create',s + interval '1 minute',false);
  r := makeborne_private.reconcile_plan_membership('mem_late','2027-09-05T00:00:00Z');   -- simulated "now" for this 2027 timeline
  assert pg_temp.months(u,'mem_late') = '{300,300,300,300,300,300,2200,2200}', 'Payment evidence: '||pg_temp.months(u,'mem_late')::text;
  assert not exists(select 1 from makeborne_private.plan_credit_issues where membership_id='mem_late' and resolved_at is null), 'Issues not resolved by evidence';
  r := public.makeborne_record_plan_payment(u,'mem_late','pay_late1','plan_fixture','create','yearly',300,'subscription_create',s + interval '1 minute',false);
  assert r->>'outcome'='duplicate' and (r->>'granted')::int=0, 'Duplicate payment: '||r::text;
  raise notice 'PASS no inferred history: months before evidence open issues; paid initial payment resolves them; duplicates ignored';

  -- 9. Payments that are not entitlement evidence (plan-change proration, refunds) are kept but never used.
  perform pg_temp.period('mem_pay',u,s,e);
  perform public.makeborne_record_plan_payment(u,'mem_pay','pay_upd1','plan_fixture','scale','yearly',2200,'subscription_update',s + interval '1 minute',false);
  perform public.makeborne_record_plan_payment(u,'mem_pay','pay_ref1','plan_fixture','scale','yearly',2200,'subscription_cycle',s + interval '2 minutes',true);
  r := makeborne_private.reconcile_plan_membership('mem_pay','2027-04-05T00:00:00Z');
  assert pg_temp.months(u,'mem_pay') = '{}' and (r->>'unresolved')::int = 3, 'Unverified/refunded payments used: '||r::text;
  assert (select array_agg(outcome order by evidence_ref) from makeborne_private.plan_observations where membership_id='mem_pay') = '{evidence_refunded,evidence_unverified}', 'Payment outcomes';
  raise notice 'PASS subscription_update and refunded payments are stored but are not entitlement evidence';

  -- 10. Manual review: an operator resolves one month as owed (Studio) and one as not owed.
  r := makeborne_private.resolve_plan_credit_issue((select id from makeborne_private.plan_credit_issues where membership_id='mem_pay' and allocation_start=s),
    'studio',850,'Verified Studio receipt in Whop dashboard');
  r := makeborne_private.resolve_plan_credit_issue((select id from makeborne_private.plan_credit_issues where membership_id='mem_pay' and allocation_start='2027-02-28T10:00:00Z'),
    null,null,'Refunded in full; month not owed');
  r := makeborne_private.reconcile_plan_membership('mem_pay','2027-04-05T00:00:00Z');
  assert pg_temp.month_total(u,'mem_pay',s) = 850 and pg_temp.month_total(u,'mem_pay','2027-02-28T10:00:00Z') = 0, 'Manual resolution: '||pg_temp.months(u,'mem_pay')::text;
  assert (select count(*) from makeborne_private.plan_credit_issues where membership_id='mem_pay' and resolved_at is null) = 1, 'Third month stays open';
  begin perform makeborne_private.resolve_plan_credit_issue(1,null,null,'no'); raise exception 'Short note accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS manual review: owed and not-owed resolutions, audit note required, other months stay open';

  -- Wallet = sum of every grant; nothing else touched.
  assert (select balance from makeborne_private.credit_wallets where user_id=u) = (select sum(delta) from public.credit_ledger where user_id=u), 'Wallet out of balance';
end $$;
rollback;

-- ---- Recording through the real entry point: anchors, duplicates, out-of-order and inconsistent data.
begin;
do $$
declare
  u uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); r jsonb; ps timestamptz; pe timestamptz; before bigint;
begin
  insert into auth.users(id,email,email_confirmed_at) select id,id::text||'@plan-record.example.invalid',now() from unnest(array[u,other]) id;
  -- Period 1 ended ~9 days ago and is first seen now (late, out of order): the period is recorded,
  -- but with no evidence for its month it becomes an open issue; the renewal payment resolves it.
  ps := date_trunc('second', now()) - interval '40 days'; pe := ps + interval '1 month';
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,ps,pe,'webhook');
  assert r->>'outcome'='recorded' and (r->>'granted')::int=0 and (r->>'unresolved')::int=1, 'Late period: '||r::text;
  r := public.makeborne_record_plan_payment(u,'mem_rec','pay_rec1','plan_rec','create','monthly',300,'subscription_cycle',ps + interval '30 seconds',false);
  assert (r->>'granted')::int=1 and (r->>'unresolved')::int=0, 'Renewal payment evidence: '||r::text;
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,ps,pe,'webhook');
  assert r->>'outcome'='unchanged' and (r->>'granted')::int=0, 'Duplicate delivery granted: '||r::text;
  before := (select sum(delta) from public.credit_ledger where user_id=u);
  -- Out-of-order / inconsistent: a shifted anchor over time already covered is never re-keyed.
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,ps + interval '1 day',pe + interval '1 day','webhook');
  assert r->>'outcome'='anchor_conflict' and (r->>'granted')::int=0, 'Shifted anchor: '||r::text;
  -- Missing start (never derived), wrong length, and a different account are refused.
  r := public.makeborne_record_plan_observation(u,'mem_rec2','plan_rec','create','monthly',300,'active',true,null,pe,'webhook');
  assert r->>'outcome'='missing_period' and (r->>'granted')::int=0, 'Missing start: '||r::text;
  r := public.makeborne_record_plan_observation(u,'mem_rec3','plan_rec','create','yearly',300,'active',true,ps,pe,'webhook');
  assert r->>'outcome'='interval_mismatch' and (r->>'granted')::int=0, 'Yearly plan with a monthly period: '||r::text;
  r := public.makeborne_record_plan_observation(other,'mem_rec','plan_rec','create','monthly',300,'active',true,ps,pe,'webhook');
  assert r->>'outcome'='user_mismatch' and (r->>'granted')::int=0, 'Other account: '||r::text;
  assert (select sum(delta) from public.credit_ledger where user_id=u) = before, 'Refused observations granted credits';
  assert not exists(select 1 from public.credit_ledger where user_id=other), 'Other account received credits';
  -- Comp days extend the same period without new allocations; the renewal starts the next.
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,ps,pe + interval '5 days','access_check');
  assert r->>'outcome'='extended' and (r->>'granted')::int=0, 'Extension: '||r::text;
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,pe + interval '5 days',pe + interval '5 days' + interval '1 month','webhook');
  assert r->>'outcome'='recorded' and (r->>'granted')::int=1, 'Renewal: '||r::text;
  -- An older period delivered late after the renewal is already known: no change.
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'active',true,ps,pe + interval '5 days','webhook');
  assert r->>'outcome'='unchanged' and (r->>'granted')::int=0, 'Late older period: '||r::text;
  -- A non-paid observation records status only.
  r := public.makeborne_record_plan_observation(u,'mem_rec','plan_rec','create','monthly',300,'canceled',false,null,null,'webhook');
  assert r->>'outcome'='not_paid' and (r->>'granted')::int=0, 'Cancellation observation: '||r::text;
  assert (select count(*) from makeborne_private.plan_observations where membership_id in ('mem_rec','mem_rec2','mem_rec3'))=11, 'Every observation kept';
  -- Unknown tiers cannot be recorded.
  begin perform public.makeborne_record_plan_observation(u,'mem_rec4','plan_rec','enterprise','monthly',300,'active',true,ps,pe,'webhook'); raise exception 'Unknown tier recorded';
  exception when check_violation then null; end;
  raise notice 'PASS recording: stable anchors, duplicates, out-of-order, extension, renewal, missing/inconsistent data refused, unknown tiers rejected';
end $$;
rollback;

-- ---- Permissions.
begin;
do $$
declare u uuid:=gen_random_uuid(); claims jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@plan-perm.example.invalid',now());
  assert to_regprocedure('public.makeborne_credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb)') is null
    and to_regprocedure('makeborne_private.credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb)') is null, 'Undated plan grant path still exists';
  foreach claims in array array['{"role":"anon"}','{"role":"authenticated"}','{"role":"service_role"}']::jsonb[] loop
    perform set_config('request.jwt.claims',jsonb_set(claims,'{sub}',to_jsonb(u::text))::text,true);
    execute format('set local role %I', claims->>'role');
    begin perform makeborne_private.credit_grant_plan_allocation(u,'mem_x',now(),now() + interval '1 month','create',300,null,'{}'); raise exception '% can grant with a caller-chosen tier', claims->>'role';
    exception when insufficient_privilege or undefined_function then null; end;   -- no schema usage: not even visible
    if claims->>'role' <> 'service_role' then
      begin perform public.makeborne_record_plan_observation(u,'mem_x','plan_x','create','monthly',300,'active',true,null,null,'webhook'); raise exception '% can record', claims->>'role';
      exception when insufficient_privilege then null; end;
      begin perform public.makeborne_reconcile_plan_credits(10); raise exception '% can reconcile', claims->>'role';
      exception when insufficient_privilege then null; end;
    else
      perform public.makeborne_record_plan_observation(u,'mem_x','plan_x','create','monthly',300,'canceled',false,null,null,'webhook');
      perform public.makeborne_reconcile_plan_credits(10);
    end if;
    reset role;
  end loop;
  raise notice 'PASS permissions: only the service role records and reconciles; nobody grants with a caller-chosen tier';
end $$;
rollback;

-- ---- Reconciliation job control: overlap, lease recovery, staleness, health.
begin;
do $$
declare u uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); run1 bigint; run2 bigint; h jsonb; n integer;
begin
  run1 := public.makeborne_billing_job_begin('plan_credits',300);
  assert run1 is not null, 'First run did not start';
  assert public.makeborne_billing_job_begin('plan_credits',300) is null, 'Overlapping run started';
  update makeborne_private.billing_job_runs set lease_until = now() - interval '1 second' where id = run1;   -- crashed run
  run2 := public.makeborne_billing_job_begin('plan_credits',300);
  assert run2 is not null and (select status from makeborne_private.billing_job_runs where id=run1)='abandoned', 'Expired lease not recovered';
  assert public.makeborne_billing_job_heartbeat(run2,300), 'Heartbeat failed';
  assert public.makeborne_billing_job_finish(run2,'succeeded','{"memberships":0}'::jsonb,null), 'Finish failed';
  assert not coalesce(public.makeborne_billing_job_finish(run2,'failed','{}'::jsonb,'late'),false), 'Finished twice';
  h := public.makeborne_billing_job_health();
  assert (h->>'overdue')::boolean = false and (h->>'failuresLast24h')::int >= 1, 'Health: '||h::text;
  -- Due memberships: stalest first; recently observed ones wait.
  insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@plan-job.example.invalid',now());
  insert into auth.users(id,email,email_confirmed_at) values(u2,u2::text||'@plan-job.example.invalid',now());
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values
    (gen_random_uuid(),u,'plan_jobA','ch_jobA','/studio','ready'),(gen_random_uuid(),u2,'plan_jobB','ch_jobB','/studio','ready');
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until) values
    ('mem_jobA',u,'ch_jobA','user_jobA','plan_jobA','active',now()+interval '20 days',now()),
    ('mem_jobB',u2,'ch_jobB','user_jobB','plan_jobB','active',now()+interval '20 days',now());
  insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome)
  values('mem_jobB',u2,now(),'reconcile','active',true,'plan_jobB','create','monthly',300,'unchanged');
  select count(*) into n from public.makeborne_billing_job_due_memberships(50,3600) d where d.membership_id in ('mem_jobA','mem_jobB');
  assert n = 1 and exists(select 1 from public.makeborne_billing_job_due_memberships(50,3600) d where d.membership_id='mem_jobA'), 'Staleness selection';
  raise notice 'PASS job control: no overlapping runs, crashed lease recovered as abandoned, heartbeat/finish once, health, stalest-first selection';
end $$;
rollback;
