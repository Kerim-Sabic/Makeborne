-- Local, disposable candidate database only (chain including 20261020100000). Every fixture rolls back.
-- Automatic top-up authorization and charge-decision rules. Nothing here charges; the executor does not exist.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
do $$ begin
  if to_regprocedure('public.makeborne_autotopup_plan_charge(uuid)') is null then
    raise exception 'Refusing: migration 20261020100000 is not applied to this database';
  end if;
end $$;

do $$
declare u uuid := gen_random_uuid(); unconfirmed uuid := gen_random_uuid(); r jsonb; h text := repeat('a', 64); attempt uuid;
begin
  -- Shipped state: switch off, no price, nobody authorized.
  assert (select not charging_enabled and price_cents is null and credits = 100 from makeborne_private.autotopup_settings), 'shipped settings';
  assert not exists(select 1 from makeborne_private.autotopup_authorizations), 'no account is authorized by the migration';
  insert into auth.users(id, email, email_confirmed_at) values(u, u || '@autotopup.example.invalid', now()), (unconfirmed, unconfirmed || '@autotopup.example.invalid', null);
  update makeborne_private.billing_settings set creation_enabled = true, free_tier_enabled = true where singleton;
  insert into makeborne_private.billing_access_plans(plan_id, enabled) values('plan_autotopup', true) on conflict (plan_id) do update set enabled = true;
  begin perform public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 4, h); raise exception 'authorized without an approved price';
  exception when sqlstate 'PT503' then null; end;
  -- Disposable price for the rules below only (the live price is the owner's decision).
  update makeborne_private.autotopup_settings set price_cents = 1200 where singleton;
  begin perform public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1100, 50, 4, h); raise exception 'stale price accepted';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_autotopup_authorize(u, 'autotopup-old', 1200, 50, 4, h); raise exception 'stale terms accepted';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 40, 4, h); raise exception 'unsupported threshold accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 5, h); raise exception 'monthly limit above the cap accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_autotopup_authorize(unconfirmed, 'autotopup-2026-10-20-v1', 1200, 50, 4, h); raise exception 'unconfirmed account authorized';
  exception when sqlstate '42501' then null; end;
  r := public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 2, h);
  assert (r->>'authorized')::boolean and (r->'authorization'->>'monthlyLimitCharges')::int = 2 and (r->'authorization'->>'dailyLimitCharges')::int = 2
    and (r->'authorization'->>'priceCents')::int = 1200, 'authorize ' || r;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'charging_disabled', 'kill switch';
  raise notice 'PASS auto top-up: ships off with no price and no authorized account; consent must match the exact current offer';

  update makeborne_private.autotopup_settings set charging_enabled = true where singleton;
  perform makeborne_private.credit_grant(u, 80, 'adjust', 'autotopup-fixture', jsonb_build_object('reason', 'disposable fixture credits'));
  -- Free-tier access alone does not qualify: a paid creation subscription is required.
  perform makeborne_private.credit_reserve(u, 40, 'run_autotopup_nosub');
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'no_active_subscription', 'subscription required';
  perform makeborne_private.credit_release(u, 'run_autotopup_nosub');
  insert into public.billing_checkouts(request_id, user_id, plan_id, checkout_id, return_path, status) values(gen_random_uuid(), u, 'plan_autotopup', 'ch_autotopup', '/studio', 'ready');
  insert into public.billing_memberships(membership_id, user_id, checkout_id, whop_user_id, plan_id, status, period_end, verified_until)
  values('mem_autotopup', u, 'ch_autotopup', 'user_autotopup', 'plan_autotopup', 'active', now() + interval '20 days', now() + interval '4 minutes');
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'above_threshold', 'threshold';
  perform makeborne_private.credit_reserve(u, 40, 'run_autotopup'); perform makeborne_private.credit_settle(u, 'run_autotopup', 40);
  r := public.makeborne_autotopup_plan_charge(u);
  assert r->>'decision' = 'charge' and r->>'idempotencyKey' ~ '^autotopup_[0-9a-f]{32}$' and (r->>'priceCents')::int = 1200, 'charge ' || r;
  attempt := (r->>'attemptId')::uuid;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'attempt_in_progress', 'one attempt in flight';
  update makeborne_private.autotopup_attempts set state = 'succeeded', resolved_at = now(), provider_payment_id = 'pay_autoOne' where id = attempt;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'cooldown', 'cooldown';
  update makeborne_private.autotopup_attempts set created_at = now() - interval '11 minutes' where id = attempt;
  r := public.makeborne_autotopup_plan_charge(u);
  assert r->>'decision' = 'charge', 'second charge after cooldown';
  update makeborne_private.autotopup_attempts set state = 'succeeded', resolved_at = now(), provider_payment_id = 'pay_autoTwo', created_at = now() - interval '11 minutes' where id = (r->>'attemptId')::uuid;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'monthly_limit', 'calendar-month limit';
  begin insert into makeborne_private.autotopup_attempts(user_id, authorization_id, idempotency_key, credits, price_cents, available_at_plan, provider_payment_id, state, resolved_at)
    select u, id, 'autotopup_' || repeat('b', 32), 100, 1200, 0, 'pay_autoOne', 'succeeded', now() from makeborne_private.autotopup_authorizations where user_id = u and revoked_at is null;
    raise exception 'one provider payment recorded twice'; exception when unique_violation then null; end;
  -- A wider monthly limit still stops at the agreed daily limit (2 per UTC day).
  perform public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 4, h);
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'daily_limit', 'daily limit';
  raise notice 'PASS auto top-up: subscription required, threshold, one attempt in flight, cooldown, daily and calendar-month limits, unique provider payment';

  -- Raising the monthly limit or any offer change needs a new authorization.
  r := public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 4, h);
  assert (select count(*) from makeborne_private.autotopup_authorizations where user_id = u and revoked_at is null) = 1, 'one active authorization';
  assert (select count(*) from makeborne_private.autotopup_authorizations where user_id = u) = 3, 'history kept';
  update makeborne_private.autotopup_settings set price_cents = 1300 where singleton;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'reauthorization_required', 'price change needs consent';
  update makeborne_private.autotopup_settings set price_cents = 1200 where singleton;
  update makeborne_private.autotopup_attempts set created_at = created_at - interval '40 days' where user_id = u;
  r := public.makeborne_autotopup_plan_charge(u);
  update makeborne_private.autotopup_attempts set state = 'failed', resolved_at = now(), failure_code = 'card_declined', created_at = now() - interval '1 hour' where id = (r->>'attemptId')::uuid;
  r := public.makeborne_autotopup_plan_charge(u);
  update makeborne_private.autotopup_attempts set state = 'failed', resolved_at = now(), failure_code = 'card_declined', created_at = now() - interval '30 minutes' where id = (r->>'attemptId')::uuid;
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'suspended_after_failures', 'two failures suspend';
  assert not exists(select 1 from makeborne_private.autotopup_authorizations where user_id = u and revoked_at is null), 'authorization ended';
  assert public.makeborne_autotopup_plan_charge(u)->>'decision' = 'not_authorized';
  r := public.makeborne_autotopup_authorize(u, 'autotopup-2026-10-20-v1', 1200, 50, 4, h);
  r := public.makeborne_autotopup_plan_charge(u);
  assert r->>'decision' = 'charge';
  r := public.makeborne_autotopup_revoke(u, 'Customer turned it off');
  assert (r->>'revoked')::boolean and (select state from makeborne_private.autotopup_attempts where user_id = u order by created_at desc limit 1) = 'canceled', 'revoke cancels the planned attempt';
  raise notice 'PASS auto top-up: re-consent on offer change, suspension after two failures, revocation cancels planned attempts';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.makeborne_autotopup_status(uuid)', 'public.makeborne_autotopup_authorize(uuid,text,bigint,integer,integer,text)',
    'public.makeborne_autotopup_revoke(uuid,text)', 'public.makeborne_autotopup_plan_charge(uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute'), f;
  end loop;
  assert not has_table_privilege('authenticated', 'makeborne_private.autotopup_settings', 'update') and not has_table_privilege('service_role', 'makeborne_private.autotopup_settings', 'update'), 'switch not writable by clients';
  raise notice 'PASS auto top-up: service-role entry points only; the switch is not writable through the API';
end $$;

rollback;
