-- One provider-dollar authority for every generation path.
--
-- * Durable generation jobs now draw on the same atomic daily limits as the
--   live builder: when a capped dispatch reserves its whole-operation bound
--   (generation_execution_holds), the same bound is reserved in the live gate
--   in the same transaction (a refusal aborts the dispatch); when the job
--   settles (generation_job_settlements), the gate call is closed with the
--   actual cost. The cumulative generation_execution_caps still apply on top.
-- * Gate scopes cover every durable provider (disabled, zero limit by default).
-- * Late usage after worst-case reconciliation: a call already charged at its
--   bound ('uncertain' or 'expired') can be trued up to its actual cost once
--   ('reconciled'). Reservations are never released twice (expiry already
--   released them); repeats are reported as replays and change nothing.
-- * makeborne_provider_spend_status: a preflight that says only whether new
--   work can start ("paused" or "limit"), never amounts.
-- Limits are never enabled by a migration; the database owner sets them.
begin;

alter table makeborne_private.live_provider_limits drop constraint live_provider_limits_scope_check;
alter table makeborne_private.live_provider_limits add constraint live_provider_limits_scope_check
  check (scope in ('global','anthropic','openai','deepseek','qwen_hosted','self_hosted','media_worker'));
insert into makeborne_private.live_provider_limits(scope) values ('deepseek'),('qwen_hosted'),('self_hosted'),('media_worker') on conflict do nothing;

alter table makeborne_private.live_provider_calls drop constraint live_provider_calls_provider_check;
alter table makeborne_private.live_provider_calls add constraint live_provider_calls_provider_check
  check (provider in ('anthropic','openai','deepseek','qwen_hosted','self_hosted','media_worker'));
alter table makeborne_private.live_provider_calls drop constraint live_provider_calls_status_check;
alter table makeborne_private.live_provider_calls add constraint live_provider_calls_status_check
  check (status in ('open','settled','uncertain','expired','reconciled'));
alter table makeborne_private.live_provider_calls add column reconciled_from bigint check (reconciled_from >= 0);
alter table makeborne_private.live_provider_calls add column source text not null default 'live' check (source in ('live','durable'));

-- Opening a call: shared by the live gate and durable dispatch. Lock order:
-- global limit, provider limit, then their day rows (the durable path takes its
-- own caps first; nothing locks in the reverse order).
create function makeborne_private.open_provider_call(p_call uuid, p_user uuid, p_run text, p_provider text, p_model text, p_bound bigint, p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g makeborne_private.live_provider_limits%rowtype; p makeborne_private.live_provider_limits%rowtype;
  gd makeborne_private.live_provider_days%rowtype; pd makeborne_private.live_provider_days%rowtype; d date; prior makeborne_private.live_provider_calls%rowtype;
begin
  if p_call is null or p_run is null or length(p_run) not between 1 and 200 or p_provider is null or p_provider = 'global'
     or p_model is null or length(p_model) not between 1 and 160 or p_bound is null or p_bound <= 0 then
    raise exception 'Invalid provider call' using errcode='22023';
  end if;
  select * into prior from makeborne_private.live_provider_calls where id = p_call;
  if found then return jsonb_build_object('started',false,'replayed',true,'status',prior.status); end if;
  perform makeborne_private.expire_provider_calls(50);
  d := (clock_timestamp() at time zone 'UTC')::date;
  select * into g from makeborne_private.live_provider_limits where scope = 'global' for update;
  select * into p from makeborne_private.live_provider_limits where scope = p_provider for update;
  if not found then raise exception 'Invalid provider call' using errcode='22023'; end if;
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
  insert into makeborne_private.live_provider_calls(id, run_reference, user_id, provider, model, day, bound_microusd, source)
  values (p_call, p_run, p_user, p_provider, p_model, d, p_bound, p_source);
  return jsonb_build_object('started',true,'replayed',false,'day',d);
end $$;
revoke all on function makeborne_private.open_provider_call(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated,service_role;

create or replace function public.makeborne_provider_call_begin(p_call uuid, p_user uuid, p_run text, p_provider text, p_model text, p_bound bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_provider is null or p_provider not in ('anthropic','openai') then raise exception 'Invalid provider call' using errcode='22023'; end if;
  return makeborne_private.open_provider_call(p_call, p_user, p_run, p_provider, p_model, p_bound, 'live');
end $$;

-- Closing a call. Open calls move their bound out of reserved and charge the
-- actual cost (or the bound when unknown). A call already charged at its bound
-- can be trued up to its actual cost once; reserved is not touched again.
-- The day charged is always the call's own day, even after UTC midnight.
create or replace function makeborne_private.close_provider_call(p_call uuid, p_actual bigint, p_partial bigint, p_status text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c makeborne_private.live_provider_calls%rowtype; charge bigint; over boolean;
begin
  select * into c from makeborne_private.live_provider_calls where id = p_call;
  if not found then raise exception 'Provider call not found' using errcode='P0002'; end if;
  perform 1 from makeborne_private.live_provider_limits where scope in ('global', c.provider) order by scope = 'global' desc for update;
  perform 1 from makeborne_private.live_provider_days where day = c.day and scope in ('global', c.provider) order by scope = 'global' desc for update;
  select * into c from makeborne_private.live_provider_calls where id = p_call for update;
  if c.status = 'open' then
    charge := coalesce(p_actual, c.bound_microusd);
    over := p_actual is not null and p_actual > c.bound_microusd;
    update makeborne_private.live_provider_days set reserved_microusd = reserved_microusd - c.bound_microusd, spent_microusd = spent_microusd + charge
    where day = c.day and scope in ('global', c.provider);
    update makeborne_private.live_provider_calls set status = p_status, actual_microusd = p_actual, partial_microusd = greatest(coalesce(p_partial,0),0),
      charged_microusd = charge, overrun = over, resolved_at = clock_timestamp(), detail = detail || coalesce(p_detail,'{}'::jsonb)
    where id = p_call;
  elsif c.status in ('uncertain','expired') and p_actual is not null and p_status in ('settled','reconciled') then
    -- Late usage after worst-case reconciliation: replace the bound with the actual cost, once.
    charge := p_actual;
    over := p_actual > c.bound_microusd;
    update makeborne_private.live_provider_days set spent_microusd = greatest(spent_microusd + (charge - c.charged_microusd), 0)
    where day = c.day and scope in ('global', c.provider);
    update makeborne_private.live_provider_calls set status = 'reconciled', reconciled_from = c.charged_microusd, actual_microusd = p_actual,
      charged_microusd = charge, overrun = over, detail = detail || coalesce(p_detail,'{}'::jsonb) || jsonb_build_object('reconciledAt', clock_timestamp())
    where id = p_call;
    p_status := 'reconciled';
  else
    return jsonb_build_object('closed',false,'status',c.status,'replayed',true);
  end if;
  if over then
    update makeborne_private.live_provider_limits set emergency_stop = true, updated_at = now(),
      note = left(format('Stopped: call %s cost %s microusd, above its bound %s', p_call, p_actual, c.bound_microusd), 500)
    where scope = c.provider;
  end if;
  return jsonb_build_object('closed',true,'status',p_status,'charged',charge,'overrun',over);
end $$;

-- Operator reconciliation of a call whose usage was unknown (owner only).
create function makeborne_private.reconcile_provider_call(p_call uuid, p_actual bigint, p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_note is null or length(trim(p_note)) not between 5 and 500 then raise exception 'Explain the reconciliation (5-500 characters)' using errcode='22023'; end if;
  if p_actual is null or p_actual < 0 then raise exception 'Actual cost required' using errcode='22023'; end if;
  return makeborne_private.close_provider_call(p_call, p_actual, p_actual, 'reconciled', jsonb_build_object('note', left(p_note, 500), 'by', current_user));
end $$;
revoke all on function makeborne_private.reconcile_provider_call(uuid,bigint,text) from public,anon,authenticated,service_role;

-- Preflight: can new work start? Reasons only, never amounts.
create function public.makeborne_provider_spend_status(p_provider text) returns jsonb
language sql stable security definer set search_path='' as $$
  with l as (select * from makeborne_private.live_provider_limits where scope in ('global', p_provider)),
  d as (select scope, spent_microusd + reserved_microusd as used from makeborne_private.live_provider_days
        where day = (clock_timestamp() at time zone 'UTC')::date and scope in ('global', p_provider))
  select case
    when (select count(*) from l) < 2 or exists(select 1 from l where not enabled or emergency_stop) then jsonb_build_object('available', false, 'reason', 'paused')
    when exists(select 1 from l left join d using (scope) where coalesce(d.used, 0) >= l.daily_limit_microusd) then jsonb_build_object('available', false, 'reason', 'limit')
    else jsonb_build_object('available', true, 'reason', null) end;
$$;
revoke all on function public.makeborne_provider_spend_status(text) from public,anon,authenticated;
grant execute on function public.makeborne_provider_spend_status(text) to service_role;

-- ---------------------------------------------------------------------------
-- Durable generation jobs participate in the same limits.
-- ---------------------------------------------------------------------------
create function makeborne_private.reserve_durable_provider_call() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform makeborne_private.open_provider_call(new.dispatch_id, null, 'job:'||new.job_id::text, new.provider, new.model, greatest(new.amount, 1), 'durable');
  return new;
end $$;
revoke all on function makeborne_private.reserve_durable_provider_call() from public,anon,authenticated,service_role;
create trigger generation_holds_provider_gate after insert on makeborne_private.generation_execution_holds
  for each row execute function makeborne_private.reserve_durable_provider_call();

create function makeborne_private.settle_durable_provider_call() returns trigger
language plpgsql security definer set search_path='' as $$
declare hold makeborne_private.generation_execution_holds%rowtype; actual bigint;
begin
  select * into hold from makeborne_private.generation_execution_holds where job_id = new.job_id;
  if not found then return new; end if;  -- historical jobs without a capped dispatch
  if not exists(select 1 from makeborne_private.live_provider_calls where id = hold.dispatch_id) then return new; end if; -- dispatched before this migration
  select actual_vendor_microusd into actual from makeborne_private.generation_provider_outcomes where id = new.outcome_id;
  perform makeborne_private.close_provider_call(hold.dispatch_id, actual, actual, 'settled', jsonb_build_object('job', new.job_id));
  return new;
end $$;
revoke all on function makeborne_private.settle_durable_provider_call() from public,anon,authenticated,service_role;
create trigger generation_settlement_provider_gate after insert on makeborne_private.generation_job_settlements
  for each row execute function makeborne_private.settle_durable_provider_call();

commit;
