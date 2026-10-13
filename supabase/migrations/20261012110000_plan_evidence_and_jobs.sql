-- Plan credits: evidence-only entitlements, recoverable issues, payment
-- evidence, manual resolution and the reconciliation job's control tables.
--
-- * An allocation is granted only from evidence about that month: a verified
--   observation in force at its start, an observation inside it, a paid
--   initial/renewal payment from Whop (subscription_create/subscription_cycle,
--   not refunded) at or before its start, or an operator's manual resolution.
--   Without evidence the allocation becomes an open plan_credit_issue instead
--   of borrowing a later tier; the issue resolves itself when evidence arrives.
--   Manual evidence covers only the allocation it resolves; an operator's
--   "not owed" decision is final for that allocation.
-- * Payments whose meaning Whop does not document for entitlement
--   (subscription_update and others) or that were refunded are stored but never
--   used as evidence.
-- * billing_job_runs gives the reconciliation job a lease (no overlapping
--   runs, recovery after a crash), run history and a health check.
begin;

-- ---------------------------------------------------------------------------
-- 1. Evidence on observations.
-- ---------------------------------------------------------------------------
alter table makeborne_private.plan_observations
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists evidence_ref text check (evidence_ref is null or length(evidence_ref) between 1 and 200),
  add column if not exists detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096);
alter table makeborne_private.plan_observations drop constraint if exists plan_observations_source_check;
alter table makeborne_private.plan_observations add constraint plan_observations_source_check
  check (source in ('webhook','access_check','reconcile','payment','manual','fixture'));
alter table makeborne_private.plan_observations drop constraint if exists plan_observations_outcome_check;
alter table makeborne_private.plan_observations add constraint plan_observations_outcome_check check (outcome in (
  'recorded','extended','unchanged','not_paid','missing_period','interval_mismatch','anchor_conflict','user_mismatch',
  'evidence','evidence_unverified','evidence_refunded','manual'));
create unique index if not exists plan_observations_evidence_ref on makeborne_private.plan_observations(membership_id, evidence_ref)
  where evidence_ref is not null;

-- Observations usable as entitlement evidence.
create or replace function makeborne_private.plan_evidence_usable(p_outcome text) returns boolean
language sql immutable set search_path='' as $$
  select p_outcome not in ('evidence_unverified','evidence_refunded','user_mismatch');
$$;
revoke all on function makeborne_private.plan_evidence_usable(text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Unresolved allocations (recoverable).
-- ---------------------------------------------------------------------------
create table if not exists makeborne_private.plan_credit_issues (
  id bigint generated always as identity primary key,
  membership_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  allocation_start timestamptz not null,
  kind text not null check (kind in ('no_evidence')),
  detail jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution is null or length(resolution) between 1 and 200),
  unique (membership_id, allocation_start, kind)
);
create index if not exists plan_credit_issues_open on makeborne_private.plan_credit_issues(membership_id) where resolved_at is null;
alter table makeborne_private.plan_credit_issues enable row level security;
revoke all on makeborne_private.plan_credit_issues from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Reconcile from evidence only.
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.reconcile_plan_membership(p_membership text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare p record; k integer; months integer; a_start timestamptz; a_end timestamptz; base record; up record;
  tier text; target integer; result jsonb; granted integer := 0; owed integer := 0; skipped integer := 0; unresolved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:'||p_membership, 0));
  for p in select * from makeborne_private.plan_periods where membership_id = p_membership order by period_start loop
    months := case p.billing_interval when 'yearly' then 12 else 1 end;
    for k in 0..months-1 loop
      a_start := p.period_start + make_interval(months => k);
      exit when a_start >= p.period_end or a_start > p_now;
      a_end := case when k = months-1 then p.period_end else least(p.period_start + make_interval(months => k+1), p.period_end) end;
      -- An operator's "not owed" decision is final for this allocation.
      if exists(select 1 from makeborne_private.plan_credit_issues where membership_id = p_membership and allocation_start = a_start
          and resolution = 'manual:not_owed') then skipped := skipped + 1; continue; end if;
      -- Evidence in force at the allocation start, else the first evidence inside it.
      select o.* into base from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
        and o.observed_at <= a_start and (o.source <> 'manual' or o.observed_at = a_start)
      order by (o.source = 'manual') desc, o.observed_at desc, o.id desc limit 1;
      if not found then
        select o.* into base from makeborne_private.plan_observations o
        where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
          and o.source <> 'manual' and o.observed_at >= a_start and o.observed_at < a_end and o.observed_at <= p_now
        order by o.observed_at, o.id limit 1;
      end if;
      if base is null then
        -- No evidence for this month: keep it recoverable, never borrow a later tier.
        insert into makeborne_private.plan_credit_issues(membership_id,user_id,allocation_start,kind,detail)
        values(p_membership,p.user_id,a_start,'no_evidence',jsonb_build_object('allocation',k+1,'allocationEnd',a_end,'periodStart',p.period_start,'periodEnd',p.period_end))
        on conflict (membership_id,allocation_start,kind) do update set last_seen_at = now()
          where makeborne_private.plan_credit_issues.resolved_at is null;
        unresolved := unresolved + 1;
        continue;
      end if;
      update makeborne_private.plan_credit_issues set resolved_at = now(), resolution = 'evidence:'||base.source||':'||base.id
      where membership_id = p_membership and allocation_start = a_start and resolved_at is null;
      if not base.paid then skipped := skipped + 1; continue; end if;
      tier := base.tier; target := base.monthly_credits;
      select o.tier, o.monthly_credits into up from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
        and o.source <> 'manual' and o.paid and o.observed_at > a_start and o.observed_at < a_end and o.observed_at <= p_now
      order by o.monthly_credits desc, o.observed_at limit 1;
      if found and up.monthly_credits > target then tier := up.tier; target := up.monthly_credits; end if;
      owed := owed + 1;
      result := makeborne_private.credit_grant_plan_month(p.user_id, p_membership, a_start, tier, target,
        case when k = 0 then 'plan:'||p_membership||':'||to_char(p.period_end,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        jsonb_build_object('allocation',k+1,'allocationStart',a_start,'allocationEnd',a_end,'periodStart',p.period_start,
          'periodEnd',p.period_end,'interval',p.billing_interval,'tier',tier,'evidence',base.source,'source','reconcile'));
      if (result->>'granted')::boolean then granted := granted + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('owed',owed,'granted',granted,'notPaid',skipped,'unresolved',unresolved);
end $$;
revoke all on function makeborne_private.reconcile_plan_membership(text,timestamptz) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 4. Payment evidence (service role; the server passes Whop's payment record).
-- ---------------------------------------------------------------------------
create or replace function public.makeborne_record_plan_payment(p_user uuid,p_membership text,p_payment_id text,p_whop_plan_id text,p_tier text,
  p_interval text,p_monthly_credits integer,p_billing_reason text,p_paid_at timestamptz,p_refunded boolean)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare outcome text; inserted integer;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then raise exception 'Account unavailable' using errcode='P0002'; end if;
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9]{1,64}$' then raise exception 'Payment reference is invalid' using errcode='22023'; end if;
  if p_paid_at is null or p_refunded is null or p_billing_reason is null or length(p_billing_reason) > 40 then raise exception 'Payment record incomplete' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:'||p_membership, 0));
  outcome := case
    when exists(select 1 from makeborne_private.plan_periods where membership_id = p_membership and user_id <> p_user) then 'user_mismatch'
    when p_refunded then 'evidence_refunded'
    when p_billing_reason in ('subscription_create','subscription_cycle') then 'evidence'
    else 'evidence_unverified' end;
  insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome,evidence_ref,detail)
  values(p_membership,p_user,p_paid_at,'payment','paid',true,p_whop_plan_id,p_tier,p_interval,p_monthly_credits,outcome,'payment:'||p_payment_id,
    jsonb_build_object('billingReason',p_billing_reason,'refunded',p_refunded))
  on conflict (membership_id, evidence_ref) where evidence_ref is not null do nothing;
  get diagnostics inserted = row_count;
  return jsonb_build_object('outcome',case when inserted = 0 then 'duplicate' else outcome end)
    || makeborne_private.reconcile_plan_membership(p_membership, now());
end $$;
revoke all on function public.makeborne_record_plan_payment(uuid,text,text,text,text,text,integer,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.makeborne_record_plan_payment(uuid,text,text,text,text,text,integer,text,timestamptz,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Manual resolution (database owner only, after reviewing records).
--    p_tier null = not owed (resolve without granting).
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.resolve_plan_credit_issue(p_issue bigint,p_tier text,p_monthly_credits integer,p_note text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare i makeborne_private.plan_credit_issues%rowtype; iv text;
begin
  if p_note is null or length(trim(p_note)) not between 5 and 500 then raise exception 'Explain the resolution (5-500 characters)' using errcode='22023'; end if;
  select * into i from makeborne_private.plan_credit_issues where id = p_issue for update;
  if not found or i.resolved_at is not null then raise exception 'Open issue not found' using errcode='P0002'; end if;
  if p_tier is null then
    update makeborne_private.plan_credit_issues set resolved_at = now(), resolution = 'manual:not_owed' where id = p_issue;
    return jsonb_build_object('resolved',true,'granted',0);
  end if;
  select billing_interval into iv from makeborne_private.plan_periods where membership_id = i.membership_id
    and period_start <= i.allocation_start and period_end > i.allocation_start;
  insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome,evidence_ref,detail)
  values(i.membership_id,i.user_id,i.allocation_start,'manual','paid',true,'plan_manual',p_tier,coalesce(iv,'monthly'),p_monthly_credits,'manual',
    'manual:issue:'||p_issue,jsonb_build_object('note',left(p_note,500),'by',current_user));
  return jsonb_build_object('resolved',true) || makeborne_private.reconcile_plan_membership(i.membership_id, now());
end $$;
revoke all on function makeborne_private.resolve_plan_credit_issue(bigint,text,integer,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 6. Reconciliation job control.
-- ---------------------------------------------------------------------------
create table if not exists makeborne_private.billing_job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('plan_credits')),
  started_at timestamptz not null default now(),
  lease_until timestamptz not null,
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed','abandoned')),
  stats jsonb not null default '{}'::jsonb,
  error text check (error is null or length(error) <= 2000)
);
create index if not exists billing_job_runs_recent on makeborne_private.billing_job_runs(job, started_at desc);
alter table makeborne_private.billing_job_runs enable row level security;
revoke all on makeborne_private.billing_job_runs from public,anon,authenticated,service_role;

-- Starts a run unless another live run holds the lease. Runs whose lease
-- expired (crashed or timed out) are marked abandoned so the next run recovers.
create or replace function public.makeborne_billing_job_begin(p_job text,p_lease_seconds integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare run bigint;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'Lease out of range' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne.job:'||p_job, 0));
  update makeborne_private.billing_job_runs set status = 'abandoned', finished_at = now(), error = coalesce(error,'lease expired')
  where job = p_job and status = 'running' and lease_until <= now();
  if exists(select 1 from makeborne_private.billing_job_runs where job = p_job and status = 'running') then return null; end if;
  insert into makeborne_private.billing_job_runs(job,lease_until) values(p_job, now() + make_interval(secs => p_lease_seconds)) returning id into run;
  return run;
end $$;

create or replace function public.makeborne_billing_job_heartbeat(p_run bigint,p_lease_seconds integer) returns boolean
language sql security definer set search_path='' as $$
  update makeborne_private.billing_job_runs set lease_until = now() + make_interval(secs => greatest(30,least(p_lease_seconds,3600)))
  where id = p_run and status = 'running' and lease_until > now() returning true;
$$;

create or replace function public.makeborne_billing_job_finish(p_run bigint,p_status text,p_stats jsonb,p_error text) returns boolean
language sql security definer set search_path='' as $$
  update makeborne_private.billing_job_runs set status = p_status, finished_at = now(), stats = coalesce(p_stats,'{}'::jsonb), error = left(p_error,2000)
  where id = p_run and status = 'running' and p_status in ('succeeded','partial','failed') returning true;
$$;

-- Memberships to refresh from Whop, stalest first. Recovery after missed runs
-- is by staleness, not by date window: a skipped day only means more rows are due.
create or replace function public.makeborne_billing_job_due_memberships(p_limit integer,p_stale_seconds integer)
returns table(membership_id text,user_id uuid,plan_id text,checkout_id text,whop_user_id text,needs_payments boolean,last_observed_at timestamptz)
language sql stable security definer set search_path='' as $$
  select m.membership_id, m.user_id, m.plan_id, m.checkout_id, m.whop_user_id,
    exists(select 1 from makeborne_private.plan_credit_issues i where i.membership_id = m.membership_id and i.resolved_at is null),
    (select max(o.recorded_at) from makeborne_private.plan_observations o where o.membership_id = m.membership_id and o.source <> 'payment')
  from public.billing_memberships m
  where (m.status in ('active','canceling','past_due','trialing') or m.period_end > now() - interval '40 days'
         or exists(select 1 from makeborne_private.plan_credit_issues i where i.membership_id = m.membership_id and i.resolved_at is null))
    and coalesce((select max(o.recorded_at) from makeborne_private.plan_observations o where o.membership_id = m.membership_id and o.source <> 'payment'), '-infinity')
        < now() - make_interval(secs => greatest(p_stale_seconds,60))
  order by 7 nulls first, m.membership_id
  limit greatest(1,least(p_limit,500));
$$;

-- Monitoring: overdue when no successful run in 36 hours.
create or replace function public.makeborne_billing_job_health() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'lastSuccessAt',(select max(finished_at) from makeborne_private.billing_job_runs where job='plan_credits' and status='succeeded'),
    'lastRun',(select to_jsonb(r) - 'stats' from makeborne_private.billing_job_runs r where job='plan_credits' order by started_at desc limit 1),
    'failuresLast24h',(select count(*) from makeborne_private.billing_job_runs where job='plan_credits' and status in ('failed','abandoned','partial') and started_at > now() - interval '24 hours'),
    'openIssues',(select count(*) from makeborne_private.plan_credit_issues where resolved_at is null),
    'overdue',coalesce((select max(finished_at) from makeborne_private.billing_job_runs where job='plan_credits' and status='succeeded') < now() - interval '36 hours', true));
$$;

do $$ declare f text; begin
  foreach f in array array['public.makeborne_billing_job_begin(text,integer)','public.makeborne_billing_job_heartbeat(bigint,integer)',
    'public.makeborne_billing_job_finish(bigint,text,jsonb,text)','public.makeborne_billing_job_due_memberships(integer,integer)',
    'public.makeborne_billing_job_health()'] loop
    execute format('revoke all on function %s from public,anon,authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
