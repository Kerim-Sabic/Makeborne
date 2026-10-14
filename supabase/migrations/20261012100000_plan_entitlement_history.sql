-- Plan credits from recorded billing history.
--
-- 20261012090000 granted every started month at the tier passed in by the
-- caller, so an upgrade in month 6 retroactively topped up months 1-5. This
-- migration makes the database the authority:
--   * plan_observations: every verified look at a Whop membership (webhook or
--     access check), stamped with server time: status, plan, tier and the
--     billing period Whop reported. Append-only.
--   * plan_periods: paid periods anchored on Whop's own renewal_period_start
--     and renewal_period_end. A period is recorded only when both are present,
--     its length matches the plan interval, and it does not overlap a recorded
--     period with a different start. Anything else is kept as an observation
--     outcome and grants nothing (no guessed anchors, no speculative grants).
--     The same start with a later end (comp days, seller edits) extends it.
--   * reconcile_plan_membership: allocation k of a period starts at
--     period_start + k months (UTC, clamped at month end by Postgres) and
--     ends at the next allocation or the period end. It is owed when the
--     membership's recorded status at its start was paid (active/canceling).
--     Its tier is the tier in force at its start; an upgrade observed inside
--     the allocation tops up that allocation only; a downgrade applies from
--     the next allocation. Grants go through credit_grant_plan_month, which is
--     idempotent per allocation and never claws back.
begin;

create table if not exists makeborne_private.plan_observations (
  id bigint generated always as identity primary key,
  membership_id text not null check (membership_id ~ '^mem_[A-Za-z0-9]{1,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('webhook','access_check','reconcile','fixture')),
  status text not null check (length(status) between 1 and 40),
  paid boolean not null,
  whop_plan_id text not null check (whop_plan_id ~ '^plan_[A-Za-z0-9]{1,64}$'),
  tier text not null check (tier in ('create','studio','scale')),
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  monthly_credits integer not null check (monthly_credits between 1 and 100000),
  period_start timestamptz,
  period_end timestamptz,
  outcome text not null check (outcome in ('recorded','extended','unchanged','not_paid','missing_period','interval_mismatch','anchor_conflict','user_mismatch'))
);
create index if not exists plan_observations_membership on makeborne_private.plan_observations(membership_id, observed_at, id);
alter table makeborne_private.plan_observations enable row level security;
revoke all on makeborne_private.plan_observations from public,anon,authenticated,service_role;

create table if not exists makeborne_private.plan_periods (
  membership_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (membership_id, period_start),
  check (period_end > period_start)
);
alter table makeborne_private.plan_periods enable row level security;
revoke all on makeborne_private.plan_periods from public,anon,authenticated,service_role;

-- Grants every owed allocation of a membership's recorded periods that has
-- started by p_now. Safe to run any number of times (cron, webhooks, access).
create or replace function makeborne_private.reconcile_plan_membership(p_membership text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare p record; k integer; months integer; a_start timestamptz; a_end timestamptz; base record; up record;
  tier text; target integer; result jsonb; granted integer := 0; owed integer := 0; skipped integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:'||p_membership, 0));
  for p in select * from makeborne_private.plan_periods where membership_id = p_membership order by period_start loop
    months := case p.billing_interval when 'yearly' then 12 else 1 end;
    for k in 0..months-1 loop
      a_start := p.period_start + make_interval(months => k);
      exit when a_start >= p.period_end or a_start > p_now;
      a_end := case when k = months-1 then p.period_end else least(p.period_start + make_interval(months => k+1), p.period_end) end;
      -- State in force at the allocation start. Before the first observation
      -- of a period (purchase seen late, or missed webhooks), the earliest
      -- evidence is the first observation inside this allocation or the first
      -- paid observation that reports this very period from Whop: never a
      -- later state and never today's tier.
      select o.* into base from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and o.observed_at <= a_start order by o.observed_at desc, o.id desc limit 1;
      if not found then
        select o.* into base from makeborne_private.plan_observations o
        where o.membership_id = p_membership and o.user_id = p.user_id and o.observed_at <= p_now
          and ((o.observed_at >= a_start and o.observed_at < a_end) or (o.paid and o.period_start = p.period_start))
        order by o.observed_at, o.id limit 1;
      end if;
      if base is null or not base.paid then skipped := skipped + 1; continue; end if;
      tier := base.tier; target := base.monthly_credits;
      -- Upgrades observed inside this allocation top it up (never downgrades).
      select o.tier, o.monthly_credits into up from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and o.paid and o.observed_at > a_start and o.observed_at < a_end and o.observed_at <= p_now
      order by o.monthly_credits desc, o.observed_at limit 1;
      if found and up.monthly_credits > target then tier := up.tier; target := up.monthly_credits; end if;
      owed := owed + 1;
      result := makeborne_private.credit_grant_plan_month(p.user_id, p_membership, a_start, tier, target,
        case when k = 0 then 'plan:'||p_membership||':'||to_char(p.period_end,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        jsonb_build_object('allocation',k+1,'allocationStart',a_start,'allocationEnd',a_end,'periodStart',p.period_start,
          'periodEnd',p.period_end,'interval',p.billing_interval,'tier',tier,'source','reconcile'));
      if (result->>'granted')::boolean then granted := granted + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('owed',owed,'granted',granted,'notPaid',skipped);
end $$;
revoke all on function makeborne_private.reconcile_plan_membership(text,timestamptz) from public,anon,authenticated,service_role;

-- Records one verified observation of a membership, records/extends its paid
-- period when the anchor is trustworthy, then reconciles. Service role only;
-- the server passes Whop's current membership state (never event payloads).
create or replace function public.makeborne_record_plan_observation(p_user uuid,p_membership text,p_whop_plan_id text,p_tier text,
  p_interval text,p_monthly_credits integer,p_status text,p_paid boolean,p_period_start timestamptz,p_period_end timestamptz,p_source text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare existing makeborne_private.plan_periods%rowtype; outcome text; months integer;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then raise exception 'Account unavailable' using errcode='P0002'; end if;
  if p_paid is null or p_source is null then raise exception 'Observation incomplete' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:'||p_membership, 0));
  if not p_paid then
    outcome := 'not_paid';
  elsif p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    outcome := 'missing_period';
  else
    months := case p_interval when 'yearly' then 12 else 1 end;
    -- A period must be about one interval long (comp days may lengthen it).
    if p_period_end < p_period_start + make_interval(months => months) - interval '3 days'
      or p_period_end > p_period_start + make_interval(months => months) + interval '62 days' then
      outcome := 'interval_mismatch';
    else
      select * into existing from makeborne_private.plan_periods where membership_id = p_membership and period_start = p_period_start;
      if found then
        if existing.user_id <> p_user then outcome := 'user_mismatch';
        elsif p_period_end > existing.period_end then
          if exists(select 1 from makeborne_private.plan_periods where membership_id = p_membership and period_start > existing.period_start and period_start < p_period_end) then
            outcome := 'anchor_conflict';
          else
            update makeborne_private.plan_periods set period_end = p_period_end, last_seen_at = now() where membership_id = p_membership and period_start = p_period_start;
            outcome := 'extended';
          end if;
        else
          update makeborne_private.plan_periods set last_seen_at = now() where membership_id = p_membership and period_start = p_period_start;
          outcome := 'unchanged';
        end if;
      elsif exists(select 1 from makeborne_private.plan_periods where membership_id = p_membership and user_id <> p_user) then
        outcome := 'user_mismatch';
      elsif exists(select 1 from makeborne_private.plan_periods where membership_id = p_membership
          and period_start < p_period_end and period_end > p_period_start) then
        -- A different anchor for time already covered: never re-key it.
        outcome := 'anchor_conflict';
      else
        insert into makeborne_private.plan_periods(membership_id,period_start,period_end,user_id,billing_interval)
        values(p_membership,p_period_start,p_period_end,p_user,p_interval);
        outcome := 'recorded';
      end if;
    end if;
  end if;
  insert into makeborne_private.plan_observations(membership_id,user_id,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,period_start,period_end,outcome)
  values(p_membership,p_user,p_source,left(p_status,40),p_paid,p_whop_plan_id,p_tier,p_interval,p_monthly_credits,p_period_start,p_period_end,outcome);
  return jsonb_build_object('outcome',outcome) || makeborne_private.reconcile_plan_membership(p_membership, now());
end $$;
revoke all on function public.makeborne_record_plan_observation(uuid,text,text,text,text,integer,text,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.makeborne_record_plan_observation(uuid,text,text,text,text,integer,text,boolean,timestamptz,timestamptz,text) to service_role;

-- Durable catch-up without provider calls: reconciles every membership with a
-- recorded period that has not long ended. Meant for a daily schedule
-- (pg_cron or a Vercel cron route); see docs/BILLING_PLAN_CREDITS.md.
create or replace function public.makeborne_reconcile_plan_credits(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare m text; total integer := 0; granted integer := 0; r jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Limit out of range' using errcode='22023'; end if;
  for m in select membership_id from makeborne_private.plan_periods group by membership_id
    having max(period_end) > now() - interval '40 days' order by min(last_seen_at) limit p_limit loop
    r := makeborne_private.reconcile_plan_membership(m, now());
    total := total + 1; granted := granted + (r->>'granted')::integer;
  end loop;
  return jsonb_build_object('memberships',total,'granted',granted);
end $$;
revoke all on function public.makeborne_reconcile_plan_credits(integer) from public,anon,authenticated;
grant execute on function public.makeborne_reconcile_plan_credits(integer) to service_role;

-- The caller-supplied-tier primitive stays (reconcile uses it) but is no longer
-- callable from the app: grants must come from recorded history.
revoke all on function public.makeborne_credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) from service_role;
revoke all on function makeborne_private.credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) from service_role;

commit;
