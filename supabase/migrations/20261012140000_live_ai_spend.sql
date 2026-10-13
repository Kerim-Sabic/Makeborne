-- Live builder AI spending: provider-dollar limits and per-run outcomes.
--
-- Provider dollars (independent of customer credits; admins included):
-- * live_provider_limits: per-scope daily limits ('global' plus each provider).
--   Disabled with a zero limit by default, so live calls fail closed until an
--   operator (database owner) sets limits.
-- * live_provider_calls: one row per provider call, opened with its
--   conservative bound before the call and closed with the actual cost. Unknown
--   usage is recorded at the bound ('uncertain'); calls left open by a killed
--   process expire at the bound after 20 minutes ('expired'). A call that cost
--   more than its bound stops further calls for its provider (emergency stop).
-- Customer credits:
-- * makeborne_credit_settle_run / makeborne_credit_release_run settle or
--   release a run's hold and record ai_run_outcomes: measured usage, the
--   customer charge (never above the hold), what was absorbed, the provider
--   cost from live_provider_calls, and an explicit outcome: settled, replayed,
--   exempt, missing_hold (no reservation: a billing fault, not a success),
--   released_hold (already released or timed out: cannot be charged), released.
begin;

create table makeborne_private.live_provider_limits (
  scope text primary key check (scope in ('global','anthropic','openai')),
  enabled boolean not null default false,
  emergency_stop boolean not null default false,
  daily_limit_microusd bigint not null default 0 check (daily_limit_microusd >= 0),
  note text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now()
);
insert into makeborne_private.live_provider_limits(scope) values ('global'),('anthropic'),('openai');
alter table makeborne_private.live_provider_limits enable row level security;
revoke all on makeborne_private.live_provider_limits from public,anon,authenticated,service_role;

create table makeborne_private.live_provider_days (
  scope text not null references makeborne_private.live_provider_limits(scope),
  day date not null,
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0),
  primary key (scope, day)
);
alter table makeborne_private.live_provider_days enable row level security;
revoke all on makeborne_private.live_provider_days from public,anon,authenticated,service_role;

create table makeborne_private.live_provider_calls (
  id uuid primary key,
  run_reference text not null check (length(run_reference) between 1 and 200),
  user_id uuid,
  provider text not null check (provider in ('anthropic','openai')),
  model text not null check (length(model) between 1 and 160),
  day date not null,
  bound_microusd bigint not null check (bound_microusd > 0),
  actual_microusd bigint check (actual_microusd >= 0),
  partial_microusd bigint not null default 0 check (partial_microusd >= 0),
  charged_microusd bigint check (charged_microusd >= 0),
  status text not null default 'open' check (status in ('open','settled','uncertain','expired')),
  overrun boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
  check ((status = 'open') = (resolved_at is null)),
  check ((status = 'open') = (charged_microusd is null))
);
create index live_provider_calls_open on makeborne_private.live_provider_calls(created_at) where status = 'open';
create index live_provider_calls_run on makeborne_private.live_provider_calls(run_reference);
alter table makeborne_private.live_provider_calls enable row level security;
revoke all on makeborne_private.live_provider_calls from public,anon,authenticated,service_role;

create table makeborne_private.ai_run_outcomes (
  user_id uuid not null,
  reference text not null check (length(reference) between 1 and 200),
  outcome text not null check (outcome in ('settled','replayed','exempt','missing_hold','released_hold','released')),
  measured_credits bigint not null check (measured_credits >= 0),
  charged_credits bigint not null check (charged_credits >= 0),
  absorbed_credits bigint not null check (absorbed_credits >= 0),
  provider_microusd bigint not null check (provider_microusd >= 0),
  uncertain_microusd bigint not null check (uncertain_microusd >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
  recorded_at timestamptz not null default now(),
  primary key (user_id, reference),
  check (charged_credits <= measured_credits)
);
alter table makeborne_private.ai_run_outcomes enable row level security;
revoke all on makeborne_private.ai_run_outcomes from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Provider gate
-- ---------------------------------------------------------------------------
-- Closes one open call: moves its bound out of reserved and charges the actual
-- cost (or the bound when unknown). Lock order: global, provider, days, call.
create function makeborne_private.close_provider_call(p_call uuid, p_actual bigint, p_partial bigint, p_status text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c makeborne_private.live_provider_calls%rowtype; charge bigint; over boolean;
begin
  select * into c from makeborne_private.live_provider_calls where id = p_call;
  if not found then raise exception 'Provider call not found' using errcode='P0002'; end if;
  perform 1 from makeborne_private.live_provider_limits where scope in ('global', c.provider) order by scope = 'global' desc for update;
  perform 1 from makeborne_private.live_provider_days where day = c.day and scope in ('global', c.provider) order by scope = 'global' desc for update;
  select * into c from makeborne_private.live_provider_calls where id = p_call for update;
  if c.status <> 'open' then return jsonb_build_object('closed',false,'status',c.status,'replayed',true); end if;
  charge := coalesce(p_actual, c.bound_microusd);
  over := p_actual is not null and p_actual > c.bound_microusd;
  update makeborne_private.live_provider_days set reserved_microusd = reserved_microusd - c.bound_microusd, spent_microusd = spent_microusd + charge
  where day = c.day and scope in ('global', c.provider);
  update makeborne_private.live_provider_calls set status = p_status, actual_microusd = p_actual, partial_microusd = greatest(coalesce(p_partial,0),0),
    charged_microusd = charge, overrun = over, resolved_at = clock_timestamp(), detail = detail || coalesce(p_detail,'{}'::jsonb)
  where id = p_call;
  if over then
    update makeborne_private.live_provider_limits set emergency_stop = true, updated_at = now(),
      note = left(format('Stopped: call %s cost %s microusd, above its bound %s', p_call, p_actual, c.bound_microusd), 500)
    where scope = c.provider;
  end if;
  return jsonb_build_object('closed',true,'status',p_status,'charged',charge,'overrun',over);
end $$;
revoke all on function makeborne_private.close_provider_call(uuid,bigint,bigint,text,jsonb) from public,anon,authenticated,service_role;

-- Calls still open after 20 minutes belong to killed processes: spent at their bound.
create function makeborne_private.expire_provider_calls(p_limit integer) returns integer
language plpgsql security definer set search_path='' as $$
declare c uuid; n integer := 0;
begin
  for c in select id from makeborne_private.live_provider_calls where status = 'open' and created_at < clock_timestamp() - interval '20 minutes'
      order by created_at limit p_limit loop
    if (makeborne_private.close_provider_call(c, null, 0, 'expired', '{"reason":"process ended before the call was closed"}'::jsonb)->>'closed')::boolean then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function makeborne_private.expire_provider_calls(integer) from public,anon,authenticated,service_role;

create function public.makeborne_provider_call_begin(p_call uuid, p_user uuid, p_run text, p_provider text, p_model text, p_bound bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g makeborne_private.live_provider_limits%rowtype; p makeborne_private.live_provider_limits%rowtype;
  gd makeborne_private.live_provider_days%rowtype; pd makeborne_private.live_provider_days%rowtype; d date; prior makeborne_private.live_provider_calls%rowtype;
begin
  if p_call is null or p_run is null or length(p_run) not between 1 and 200 or p_provider not in ('anthropic','openai')
     or p_model is null or length(p_model) not between 1 and 160 or p_bound is null or p_bound <= 0 then
    raise exception 'Invalid provider call' using errcode='22023';
  end if;
  select * into prior from makeborne_private.live_provider_calls where id = p_call;
  if found then return jsonb_build_object('started',false,'replayed',true,'status',prior.status); end if;
  perform makeborne_private.expire_provider_calls(50);
  d := (clock_timestamp() at time zone 'UTC')::date;
  select * into g from makeborne_private.live_provider_limits where scope = 'global' for update;
  select * into p from makeborne_private.live_provider_limits where scope = p_provider for update;
  if not g.enabled or g.emergency_stop or not p.enabled or p.emergency_stop then
    raise exception 'Live AI provider spending is disabled or stopped' using errcode='MB423';
  end if;
  insert into makeborne_private.live_provider_days(scope, day) values ('global', d), (p_provider, d) on conflict do nothing;
  select * into gd from makeborne_private.live_provider_days where scope = 'global' and day = d for update;
  select * into pd from makeborne_private.live_provider_days where scope = p_provider and day = d for update;
  if gd.spent_microusd::numeric + gd.reserved_microusd + p_bound > g.daily_limit_microusd
     or pd.spent_microusd::numeric + pd.reserved_microusd + p_bound > p.daily_limit_microusd then
    raise exception 'Daily AI provider spending limit reached' using errcode='MB402',
      detail = format('global %s+%s/%s, %s %s+%s/%s, call %s', gd.spent_microusd, gd.reserved_microusd, g.daily_limit_microusd,
        p_provider, pd.spent_microusd, pd.reserved_microusd, p.daily_limit_microusd, p_bound);
  end if;
  update makeborne_private.live_provider_days set reserved_microusd = reserved_microusd + p_bound where day = d and scope in ('global', p_provider);
  insert into makeborne_private.live_provider_calls(id, run_reference, user_id, provider, model, day, bound_microusd)
  values (p_call, p_run, p_user, p_provider, p_model, d, p_bound);
  return jsonb_build_object('started',true,'replayed',false,'day',d);
end $$;

create function public.makeborne_provider_call_finish(p_call uuid, p_actual bigint, p_partial bigint, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_call is null or (p_actual is not null and p_actual < 0) or (p_partial is not null and p_partial < 0)
     or (p_detail is not null and jsonb_typeof(p_detail) <> 'object') then
    raise exception 'Invalid provider call result' using errcode='22023';
  end if;
  return makeborne_private.close_provider_call(p_call, p_actual, p_partial, case when p_actual is null then 'uncertain' else 'settled' end,
    coalesce(p_detail,'{}'::jsonb));
end $$;

create function public.makeborne_provider_calls_expire(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Limit out of range' using errcode='22023'; end if;
  return jsonb_build_object('expired', makeborne_private.expire_provider_calls(p_limit));
end $$;

create function public.makeborne_provider_spend_health() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'day', (clock_timestamp() at time zone 'UTC')::date,
    'scopes', (select jsonb_agg(jsonb_build_object('scope', l.scope, 'enabled', l.enabled, 'stopped', l.emergency_stop, 'note', l.note,
        'dailyLimitMicrousd', l.daily_limit_microusd, 'spentMicrousd', coalesce(d.spent_microusd,0), 'reservedMicrousd', coalesce(d.reserved_microusd,0)) order by l.scope)
      from makeborne_private.live_provider_limits l left join makeborne_private.live_provider_days d
        on d.scope = l.scope and d.day = (clock_timestamp() at time zone 'UTC')::date),
    'openCalls', (select count(*) from makeborne_private.live_provider_calls where status = 'open'),
    'staleOpenCalls', (select count(*) from makeborne_private.live_provider_calls where status = 'open' and created_at < clock_timestamp() - interval '20 minutes'),
    'overrunsToday', (select count(*) from makeborne_private.live_provider_calls where overrun and day = (clock_timestamp() at time zone 'UTC')::date),
    'uncertainTodayMicrousd', (select coalesce(sum(charged_microusd - partial_microusd),0) from makeborne_private.live_provider_calls
      where status in ('uncertain','expired') and day = (clock_timestamp() at time zone 'UTC')::date));
$$;

-- Operator control (database owner only): enable a scope with a daily limit, or clear a stop.
create function makeborne_private.set_live_provider_limit(p_scope text, p_enabled boolean, p_daily_limit_microusd bigint, p_clear_stop boolean, p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l makeborne_private.live_provider_limits%rowtype;
begin
  if p_note is null or length(trim(p_note)) not between 5 and 500 then raise exception 'Explain the change (5-500 characters)' using errcode='22023'; end if;
  if p_daily_limit_microusd is null or p_daily_limit_microusd < 0 then raise exception 'Limit must be non-negative' using errcode='22023'; end if;
  update makeborne_private.live_provider_limits set enabled = coalesce(p_enabled, enabled), daily_limit_microusd = p_daily_limit_microusd,
    emergency_stop = case when p_clear_stop then false else emergency_stop end, note = left(p_note, 500), updated_at = now()
  where scope = p_scope returning * into l;
  if not found then raise exception 'Unknown scope' using errcode='22023'; end if;
  return to_jsonb(l);
end $$;
revoke all on function makeborne_private.set_live_provider_limit(text,boolean,bigint,boolean,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Run settlement with explicit outcomes
-- ---------------------------------------------------------------------------
create function makeborne_private.record_ai_run(p_user uuid, p_reference text, p_outcome text, p_measured bigint, p_charged bigint, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_provider bigint; v_uncertain bigint; v_inserted boolean;
begin
  select coalesce(sum(coalesce(charged_microusd, bound_microusd)),0), coalesce(sum(case when status in ('open','uncertain','expired') then coalesce(charged_microusd, bound_microusd) - partial_microusd else 0 end),0)
  into v_provider, v_uncertain from makeborne_private.live_provider_calls where run_reference = p_reference;
  insert into makeborne_private.ai_run_outcomes(user_id, reference, outcome, measured_credits, charged_credits, absorbed_credits, provider_microusd, uncertain_microusd, detail)
  values (p_user, p_reference, p_outcome, p_measured, least(p_charged, p_measured), greatest(p_measured - p_charged, 0), v_provider, v_uncertain, coalesce(p_detail,'{}'::jsonb))
  on conflict (user_id, reference) do nothing
  returning true into v_inserted;
  return jsonb_build_object('outcome', p_outcome, 'charged', p_charged, 'absorbed', greatest(p_measured - p_charged, 0),
    'providerMicrousd', v_provider, 'uncertainMicrousd', v_uncertain, 'recorded', coalesce(v_inserted, false));
end $$;
revoke all on function makeborne_private.record_ai_run(uuid,text,text,bigint,bigint,jsonb) from public,anon,authenticated,service_role;

-- p_measured: the run's full measured usage in credits (not capped). The
-- charge is capped at the hold by credit_settle; the excess is absorbed.
create function public.makeborne_credit_settle_run(p_user uuid, p_reference text, p_measured bigint, p_exempt boolean, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare res jsonb; outcome text; charged bigint := 0;
begin
  if p_measured is null or p_measured < 0 or p_measured > 1000000000 then raise exception 'Measured credits must be non-negative' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  if p_exempt then
    outcome := 'exempt';
  else
    begin
      res := makeborne_private.credit_settle(p_user, p_reference, p_measured);
    exception when sqlstate 'PT409' then
      res := jsonb_build_object('released', true);
    end;
    if res ? 'released' then outcome := 'released_hold';
    elsif res->>'reason' = 'no_reservation' then outcome := 'missing_hold';
    elsif (res->>'replayed')::boolean then outcome := 'replayed'; charged := coalesce((res->>'charged')::bigint, 0);
    elsif (res->>'unlimited')::boolean then outcome := 'exempt';
    else outcome := 'settled'; charged := coalesce((res->>'charged')::bigint, 0);
    end if;
  end if;
  return coalesce(res - 'released', '{}'::jsonb) || makeborne_private.record_ai_run(p_user, p_reference, outcome, p_measured, charged, p_detail);
end $$;

create function public.makeborne_credit_release_run(p_user uuid, p_reference text, p_measured bigint, p_exempt boolean, p_reason text, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare res jsonb := '{}'::jsonb;
begin
  if p_measured is null or p_measured < 0 or p_measured > 1000000000 then raise exception 'Measured credits must be non-negative' using errcode='22023'; end if;
  if p_reason is null or length(p_reason) not between 3 and 120 then raise exception 'Release reason required' using errcode='22023'; end if;
  if not p_exempt then res := makeborne_private.credit_release(p_user, p_reference); end if;
  return res || makeborne_private.record_ai_run(p_user, p_reference, 'released', p_measured, 0,
    coalesce(p_detail,'{}'::jsonb) || jsonb_build_object('reason', p_reason, 'exempt', p_exempt));
end $$;

-- Whether a hold can still be charged (reserved and within the 15-minute lifetime).
create function public.makeborne_credit_hold_status(p_user uuid, p_reference text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('status', r.status, 'amount', r.amount, 'createdAt', r.created_at,
      'expiresAt', r.created_at + interval '15 minutes',
      'active', r.status = 'reserved' and r.created_at + interval '15 minutes' > makeborne_private.credit_clock())
    from makeborne_private.credit_reservations r where r.user_id = p_user and r.reference = p_reference),
    jsonb_build_object('status', 'missing', 'active', false));
$$;

do $$ declare f text; begin
  foreach f in array array['public.makeborne_provider_call_begin(uuid,uuid,text,text,text,bigint)','public.makeborne_provider_call_finish(uuid,bigint,bigint,jsonb)',
    'public.makeborne_provider_calls_expire(integer)','public.makeborne_provider_spend_health()',
    'public.makeborne_credit_settle_run(uuid,text,bigint,boolean,jsonb)','public.makeborne_credit_release_run(uuid,text,bigint,boolean,text,jsonb)',
    'public.makeborne_credit_hold_status(uuid,text)'] loop
    execute format('revoke all on function %s from public,anon,authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
