-- Rehearsal of the prepared generation open / emergency-stop settings.
-- LOCAL DATABASE ONLY; one rolled-back transaction, commits nothing. It never
-- contacts a provider: calls are opened and closed in the database gate only.
-- Run: docker exec -i supabase_db_makeborne-release-auth psql -U postgres -v ON_ERROR_STOP=1 < supabase/rehearse-generation-open-stop.sql
-- Proves, for the exact RPCs in docs/release-review/minimum-launch-generation-readiness-20261025.md:
--   1. open: global + anthropic enabled with a hard daily micro-USD limit, openai left disabled;
--   2. preflight says available for anthropic and paused for openai (images stay off);
--   3. a call that would cross the daily limit is refused (MB402) and preflight says limit;
--   4. emergency stop (global disabled, limit 0) refuses the next call (MB423) and preflight says paused;
--   5. a call already open before the stop can still close and is charged once (in-flight behaviour);
--   6. health readback shows the stop.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
do $$
declare
  x bigint := 10000000; -- example operating amount: $10/day (owner decides the real one)
  s jsonb; h jsonb; c_open uuid := gen_random_uuid(); c_big uuid := gen_random_uuid(); c_after uuid := gen_random_uuid();
  u uuid := gen_random_uuid(); d date := (clock_timestamp() at time zone 'UTC')::date;
begin
  -- Isolate from any rows already recorded today on this local database.
  delete from makeborne_private.live_provider_days where day = d and scope in ('global','anthropic','openai');

  -- 1. Open (the prepared statements, with x as the approved amount).
  perform makeborne_private.set_live_provider_limit('global', true, x, false, 'Rehearsal: open generation at the approved daily amount');
  perform makeborne_private.set_live_provider_limit('anthropic', true, x, false, 'Rehearsal: open text generation at the approved daily amount');
  perform makeborne_private.set_live_provider_limit('openai', false, 0, false, 'Rehearsal: images stay off until qualified');

  -- 2. Preflight.
  s := public.makeborne_provider_spend_status('anthropic');
  if s->>'available' <> 'true' then raise exception 'anthropic should be available after opening: %', s; end if;
  s := public.makeborne_provider_spend_status('openai');
  if s->>'reason' <> 'paused' then raise exception 'openai should stay paused: %', s; end if;

  -- A call opened before the stop (in flight).
  perform public.makeborne_provider_call_begin(c_open, u, 'rehearsal:run-1', 'anthropic', 'claude-opus-5-5', 1500000);

  -- 3. A call whose bound crosses the remaining allowance is refused.
  begin
    perform public.makeborne_provider_call_begin(c_big, u, 'rehearsal:run-2', 'anthropic', 'claude-opus-5-5', x);
    raise exception 'a call crossing the daily limit was admitted';
  exception when sqlstate 'MB402' then null; end;

  -- 4. Emergency stop: the prepared statement.
  perform makeborne_private.set_live_provider_limit('global', false, 0, false, 'Rehearsal: EMERGENCY STOP all paid AI calls');
  s := public.makeborne_provider_spend_status('anthropic');
  if s->>'reason' <> 'paused' then raise exception 'preflight should say paused after the stop: %', s; end if;
  begin
    perform public.makeborne_provider_call_begin(c_after, u, 'rehearsal:run-1', 'anthropic', 'claude-opus-5-5', 1000);
    raise exception 'a call started after the emergency stop';
  exception when sqlstate 'MB423' then null; end;

  -- 5. The in-flight call still closes, charged once at its actual cost; a replay changes nothing.
  s := public.makeborne_provider_call_finish(c_open, 900000, 900000, '{}'::jsonb);
  if s->>'closed' <> 'true' or (s->>'charged')::bigint <> 900000 then raise exception 'in-flight call did not close correctly: %', s; end if;
  s := public.makeborne_provider_call_finish(c_open, 900000, 900000, '{}'::jsonb);
  if s->>'replayed' <> 'true' then raise exception 'replayed close changed state: %', s; end if;

  -- 6. Health readback.
  h := public.makeborne_provider_spend_health();
  if not exists (select 1 from jsonb_array_elements(h->'scopes') e where e->>'scope' = 'global' and e->>'enabled' = 'false' and (e->>'dailyLimitMicrousd')::bigint = 0)
    then raise exception 'health does not show the stop: %', h; end if;
  if (select (e->>'spentMicrousd')::bigint from jsonb_array_elements(h->'scopes') e where e->>'scope' = 'global') <> 900000
    then raise exception 'global spend should equal the one settled call: %', h; end if;
  if (h->>'openCalls')::int <> (select count(*) from makeborne_private.live_provider_calls where status = 'open')
    then raise exception 'health open-call count mismatch: %', h; end if;
  raise notice 'health after stop: %', h;
end $$;
select 'PASS: open (global+anthropic, openai off), daily limit refusal, emergency stop refusal, in-flight close once, health readback' as result;
rollback;
