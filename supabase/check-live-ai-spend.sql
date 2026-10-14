-- Live builder AI spending: provider-dollar gate and run settlement outcomes.
-- LOCAL DATABASE; one rolled-back transaction, commits nothing. Limits are set
-- inside the transaction only. Concurrency is in check-live-ai-spend-concurrency.sql (isolated database).
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-live-ai-spend.sql
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
do $$
declare
  u uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid(); s jsonb; c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  d date := (clock_timestamp() at time zone 'UTC')::date; n bigint;
begin
  insert into auth.users(id,email,email_confirmed_at) values (u,u||'@live-spend.example.invalid',now()), (admin_id,admin_id||'@live-spend.example.invalid',now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(admin_id,true,true,'Transaction fixture');

  -- 1. Fails closed by default --------------------------------------------
  assert not exists(select 1 from makeborne_private.live_provider_limits where enabled), 'Live provider spending must ship disabled';
  begin perform public.makeborne_provider_call_begin(c1,u,'run-a','anthropic','claude-opus-5-5',1000); raise exception 'Disabled gate admitted a call';
  exception when sqlstate 'MB423' then null; end;
  assert not exists(select 1 from makeborne_private.live_provider_calls where id = c1), 'Refused call recorded as open';
  raise notice 'PASS gate ships disabled and refuses calls';

  -- 2. Daily limits: global and per provider -------------------------------
  perform makeborne_private.set_live_provider_limit('global', true, 1000000, false, 'Transaction fixture');
  perform makeborne_private.set_live_provider_limit('anthropic', true, 600000, false, 'Transaction fixture');
  perform makeborne_private.set_live_provider_limit('openai', true, 600000, false, 'Transaction fixture');
  s := public.makeborne_provider_call_begin(c1,u,'run-a','anthropic','claude-opus-5-5',500000);
  assert (s->>'started')::boolean, 'Call within limits refused';
  assert (public.makeborne_provider_call_begin(c1,u,'run-a','anthropic','claude-opus-5-5',500000)->>'replayed')::boolean, 'Begin not idempotent';
  begin perform public.makeborne_provider_call_begin(c2,u,'run-a','anthropic','claude-opus-5-5',200000); raise exception 'Provider limit ignored';
  exception when sqlstate 'MB402' then null; end;
  s := public.makeborne_provider_call_begin(c2,u,'run-b','openai','gpt-image-1',400000);
  begin perform public.makeborne_provider_call_begin(c3,u,'run-b','openai','gpt-image-1',150000); raise exception 'Global limit ignored';
  exception when sqlstate 'MB402' then null; end;
  assert (select reserved_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = 900000, 'Global reservation wrong';
  raise notice 'PASS global and per-provider daily limits are both enforced; begin is idempotent';

  -- 3. Settle actual, uncertain at bound, overrun stops the provider ------
  s := public.makeborne_provider_call_finish(c1, 120000, 120000, '{"model":"claude-opus-5-5"}');
  assert (s->>'charged')::bigint = 120000 and not (s->>'overrun')::boolean, 'Actual settle wrong';
  assert (public.makeborne_provider_call_finish(c1, 999, 0, '{}')->>'replayed')::boolean, 'Finish not idempotent';
  s := public.makeborne_provider_call_finish(c2, null, 30000, '{"reason":"usage_missing"}');
  assert s->>'status' = 'uncertain' and (s->>'charged')::bigint = 400000, 'Unknown usage not charged at the bound';
  assert (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = 520000
     and (select reserved_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = 0, 'Day totals wrong';
  perform public.makeborne_provider_call_begin(c3,u,'run-c','anthropic','claude-opus-5-5',1000);
  s := public.makeborne_provider_call_finish(c3, 5000, 5000, '{}');
  assert (s->>'overrun')::boolean, 'Overrun not detected';
  assert (select emergency_stop from makeborne_private.live_provider_limits where scope='anthropic'), 'Overrun did not stop the provider';
  begin perform public.makeborne_provider_call_begin(gen_random_uuid(),u,'run-d','anthropic','claude-opus-5-5',1); raise exception 'Stopped provider admitted a call';
  exception when sqlstate 'MB423' then null; end;
  assert (public.makeborne_provider_spend_health()->>'overrunsToday')::int = 1, 'Health misses the overrun';
  perform makeborne_private.set_live_provider_limit('anthropic', true, 600000, true, 'Transaction fixture: reviewed overrun');
  raise notice 'PASS actual cost settled once, unknown usage charged at the bound, overrun stops the provider until an operator clears it';

  -- 4. Calls abandoned by a killed process expire at their bound -----------
  c1 := gen_random_uuid();
  perform public.makeborne_provider_call_begin(c1,u,'run-killed','anthropic','claude-opus-5-5',7000);
  update makeborne_private.live_provider_calls set created_at = clock_timestamp() - interval '21 minutes' where id = c1;
  assert (public.makeborne_provider_spend_health()->>'staleOpenCalls')::int = 1, 'Health misses a stale call';
  s := public.makeborne_provider_calls_expire(100);
  assert (s->>'expired')::int = 1 and (select status from makeborne_private.live_provider_calls where id = c1) = 'expired'
     and (select charged_microusd from makeborne_private.live_provider_calls where id = c1) = 7000, 'Abandoned call not expired at its bound';
  raise notice 'PASS abandoned calls expire at their full bound';

  -- 4b. UTC day boundaries and late usage after worst-case reconciliation ----
  perform makeborne_private.set_live_provider_limit(s2, true, 1000000, true, 'Transaction fixture') from unnest(array['global','anthropic','openai']) s2;
  c1 := gen_random_uuid();
  perform public.makeborne_provider_call_begin(c1,u,'run-midnight','anthropic','claude-opus-5-5',300000);
  -- Simulate a call opened just before UTC midnight: it belongs to yesterday.
  insert into makeborne_private.live_provider_days(scope, day) values ('global', d - 1), ('anthropic', d - 1) on conflict do nothing;
  update makeborne_private.live_provider_days set reserved_microusd = reserved_microusd - 300000 where day = d and scope in ('global','anthropic');
  update makeborne_private.live_provider_days set reserved_microusd = reserved_microusd + 300000, spent_microusd = 700000 where day = d - 1 and scope in ('global','anthropic');
  update makeborne_private.live_provider_calls set day = d - 1 where id = c1;
  n := (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d);
  -- Yesterday is full, but today is a fresh day.
  c2 := gen_random_uuid();
  assert (public.makeborne_provider_call_begin(c2,u,'run-today','anthropic','claude-opus-5-5',300000)->>'started')::boolean, 'New UTC day not admitted';
  perform public.makeborne_provider_call_finish(c1, 250000, 250000, '{}');
  assert (select row(reserved_microusd, spent_microusd)::text from makeborne_private.live_provider_days where scope='global' and day=d-1) = '(0,950000)', 'Late finish not charged to its own day';
  assert (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = n
     and (select reserved_microusd from makeborne_private.live_provider_days where scope='global' and day=d) >= 300000, 'Late finish touched today';
  perform public.makeborne_provider_call_finish(c2, 1000, 1000, '{}');
  -- A crashed call expires at its bound, then its real usage arrives: trued up once, reservation never released twice.
  c3 := gen_random_uuid();
  perform public.makeborne_provider_call_begin(c3,u,'run-crash','anthropic','claude-opus-5-5',80000);
  update makeborne_private.live_provider_calls set created_at = clock_timestamp() - interval '21 minutes' where id = c3;
  perform public.makeborne_provider_calls_expire(100);
  n := (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d);
  assert (select reserved_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = 0, 'Expiry left a reservation';
  s := public.makeborne_provider_call_finish(c3, 30000, 30000, '{"late":true}');
  assert s->>'status' = 'reconciled' and (s->>'charged')::bigint = 30000, 'Late usage not reconciled: '||s::text;
  assert (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = n - 50000
     and (select reserved_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = 0, 'Reconciliation double-counted or released twice';
  assert (public.makeborne_provider_call_finish(c3, 99999, 0, '{}')->>'replayed')::boolean, 'Second late report changed the call';
  assert (public.makeborne_provider_call_finish(c3, null, 0, '{}')->>'replayed')::boolean, 'Unknown-usage report after reconciliation changed the call';
  assert (select spent_microusd from makeborne_private.live_provider_days where scope='global' and day=d) = n - 50000, 'Replays changed spend';
  assert (select row(status, reconciled_from, charged_microusd)::text from makeborne_private.live_provider_calls where id = c3) = '(reconciled,80000,30000)', 'Reconciliation audit wrong';
  -- Operator reconciliation of an app-reported unknown call.
  c3 := gen_random_uuid();
  perform public.makeborne_provider_call_begin(c3,u,'run-unknown','openai','gpt-image-1',90000);
  perform public.makeborne_provider_call_finish(c3, null, 0, '{}');
  s := makeborne_private.reconcile_provider_call(c3, 63610, 'Invoice line matched for this image');
  assert s->>'status' = 'reconciled' and (select charged_microusd from makeborne_private.live_provider_calls where id = c3) = 63610, 'Operator reconciliation failed';
  begin perform makeborne_private.reconcile_provider_call(c3, 1, 'Second attempt'); exception when others then null; end;
  assert (select charged_microusd from makeborne_private.live_provider_calls where id = c3) = 63610, 'Reconciled twice';
  assert (public.makeborne_provider_spend_status('anthropic')->>'available')::boolean, 'Status should allow work';
  update makeborne_private.live_provider_limits set emergency_stop = true where scope = 'openai';
  assert public.makeborne_provider_spend_status('openai') = '{"available": false, "reason": "paused"}'::jsonb, 'Stop not reported as paused';
  update makeborne_private.live_provider_limits set emergency_stop = false, daily_limit_microusd = 1 where scope = 'openai';
  assert public.makeborne_provider_spend_status('openai') = '{"available": false, "reason": "limit"}'::jsonb, 'Exhausted limit not reported';
  assert not (public.makeborne_provider_spend_status('openai') ? 'spent'), 'Status leaks amounts';
  raise notice 'PASS UTC days: calls charge their own day, a new day is a fresh allowance; late usage reconciles once, never released twice; preflight reports only paused/limit';

  -- 5. Run settlement outcomes ---------------------------------------------
  perform public.makeborne_credit_grant(u, 100, 'topup', 'live-spend-topup', '{}');
  perform public.makeborne_credit_reserve(u, 20, 'run-a');
  s := public.makeborne_credit_settle_run(u, 'run-a', 34, false, '{"kind":"saved"}');
  assert s->>'outcome' = 'settled' and (s->>'charged')::bigint = 20 and (s->>'absorbed')::bigint = 14, 'Capped settle wrong: '||s::text;
  assert (s->>'providerMicrousd')::bigint = 120000, 'Provider cost not taken from the call records';
  assert (select (metadata->>'shortfall')::bigint from public.credit_ledger where user_id = u and kind = 'settle' and reference = 'run-a') = 14, 'Shortfall not in the ledger';
  assert (select row(outcome, measured_credits, charged_credits, absorbed_credits)::text from makeborne_private.ai_run_outcomes where user_id = u and reference = 'run-a') = '(settled,34,20,14)', 'Outcome not recorded';
  s := public.makeborne_credit_settle_run(u, 'run-a', 40, false, '{}');
  assert s->>'outcome' = 'replayed' and (s->>'charged')::bigint = 20, 'Replay changed the charge';
  s := public.makeborne_credit_settle_run(u, 'run-none', 7, false, '{}');
  assert s->>'outcome' = 'missing_hold' and (s->>'charged')::bigint = 0 and (s->>'absorbed')::bigint = 7, 'Missing hold not flagged';
  perform public.makeborne_credit_reserve(u, 10, 'run-late');
  update makeborne_private.credit_reservations set created_at = now() - interval '16 minutes' where user_id = u and reference = 'run-late';
  assert not (public.makeborne_credit_hold_status(u, 'run-late')->>'active')::boolean, 'Timed-out hold reported active';
  s := public.makeborne_credit_settle_run(u, 'run-late', 5, false, '{}');
  assert s->>'outcome' = 'released_hold' and (s->>'charged')::bigint = 0, 'Timed-out hold was charged: '||s::text;
  perform public.makeborne_credit_reserve(u, 10, 'run-cancel');
  assert (public.makeborne_credit_hold_status(u, 'run-cancel')->>'active')::boolean, 'Live hold reported inactive';
  s := public.makeborne_credit_release_run(u, 'run-cancel', 3, false, 'build_failed', '{}');
  assert (select row(outcome, charged_credits, absorbed_credits)::text from makeborne_private.ai_run_outcomes where user_id = u and reference = 'run-cancel') = '(released,0,3)', 'Release outcome wrong';
  s := public.makeborne_credit_settle_run(admin_id, 'run-admin', 12, true, '{}');
  assert s->>'outcome' = 'exempt' and (s->>'charged')::bigint = 0 and (s->>'absorbed')::bigint = 12, 'Exempt outcome wrong';
  assert (public.makeborne_credit_hold_status(u, 'never')->>'status') = 'missing', 'Missing hold status wrong';
  select coalesce(sum(delta),0) into n from public.credit_ledger where user_id = u;
  assert n = (public.makeborne_credit_wallet(u)->>'available')::bigint, 'Ledger out of balance';
  raise notice 'PASS run outcomes: settled (capped at the hold, excess absorbed), replayed, missing_hold, released_hold, released, exempt';

  -- 6. Privileges -----------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_provider_call_begin(gen_random_uuid(),u,'x','anthropic','claude-opus-5-5',1); raise exception 'Browser opened a provider call';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_settle_run(u,'x',1,true,'{}'); raise exception 'Browser settled a run as exempt';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_provider_spend_health(); raise exception 'Browser read spend health';
  exception when insufficient_privilege then null; end;
  begin perform makeborne_private.set_live_provider_limit('global', true, 1, true, 'browser attempt'); raise exception 'Browser changed limits';
  exception when insufficient_privilege or undefined_function then null; end;
  reset role;
  set local role service_role;
  begin perform makeborne_private.set_live_provider_limit('global', true, 1, true, 'service attempt'); raise exception 'Service role changed limits';
  exception when insufficient_privilege or undefined_function then null; end;
  begin perform 1 from makeborne_private.live_provider_calls; raise exception 'Service role read calls directly';
  exception when insufficient_privilege then null; end;
  perform public.makeborne_provider_spend_health();
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  raise notice 'PASS privileges: service role uses the gate; only the database owner sets limits; browsers have no access';
end $$;
select 'PASS: live AI spend gate (fail closed, daily limits, actual/uncertain/overrun/expired) and run outcomes' as result;
rollback;
