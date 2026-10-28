-- Launch GO, Thu 29 Oct 2026 (production rklojnmmsmhwnkbzuidp). Run only after the owner says GO.
-- Preconditions: the 15 launch migrations applied (scripts/apply-production-migrations.mjs --apply), the launch build deployed with
-- the production env in docs/release-review/launch-runbook-20261029.md §6, and the Whop production webhook /api/billing/webhook enabled.
-- Checkout still needs each Whop plan in stock (unlimited) before anyone can pay.

-- Step 1 (smoke test, ~00:45 CET): open the database gate for Create monthly only.
begin;
insert into makeborne_private.billing_access_plans(plan_id, enabled) values ('plan_ZP50769xuOJp1', true)
  on conflict (plan_id) do update set enabled = true;
update makeborne_private.billing_settings set creation_enabled = true where singleton;
commit;

-- Step 2 (AI for launch weekend; owner-approved amount): $30/day overall and for Anthropic, $10/day for OpenAI images.
begin;
update makeborne_private.live_provider_limits
   set enabled = true, emergency_stop = false, daily_limit_microusd = 30000000,
       note = 'Launch weekend, owner GO 28 Oct 2026; review Mon 2 Nov 09:00 CET', updated_at = now()
 where scope in ('global', 'anthropic');
update makeborne_private.live_provider_limits
   set enabled = true, emergency_stop = false, daily_limit_microusd = 10000000,
       note = 'Launch weekend images, owner GO 28 Oct 2026; review Mon 2 Nov 09:00 CET', updated_at = now()
 where scope = 'openai';
commit;

-- Step 3 (GO, 01:15 CET): all six launch plans.
begin;
insert into makeborne_private.billing_access_plans(plan_id, enabled) values
  ('plan_ZP50769xuOJp1', true), ('plan_XSD4xNiNgwxuH', true),
  ('plan_L8g7nPoOyQXRX', true), ('plan_jXC1Ihy89I2V0', true),
  ('plan_AJDmGRXPbkgV9', true), ('plan_uAni1CxtnkD8j', true)
  on conflict (plan_id) do update set enabled = true;
commit;

-- Read back.
select (select creation_enabled from makeborne_private.billing_settings where singleton) as creation_enabled,
       (select count(*) from makeborne_private.billing_access_plans where enabled) as plans_enabled,
       public.makeborne_billing_creation_enabled('plan_ZP50769xuOJp1') as create_monthly_gate,
       (select json_agg(json_build_object('scope', scope, 'enabled', enabled, 'usd_per_day', daily_limit_microusd / 1e6)) from makeborne_private.live_provider_limits) as ai_limits;

-- ROLLBACK (stop new sales; existing members keep access):
--   1. Whop: set every launch plan's stock to 0 (unlimited off).
--   2. update makeborne_private.billing_access_plans set enabled = false
--        where plan_id in ('plan_ZP50769xuOJp1','plan_XSD4xNiNgwxuH','plan_L8g7nPoOyQXRX','plan_jXC1Ihy89I2V0','plan_AJDmGRXPbkgV9','plan_uAni1CxtnkD8j');
--   Never set billing_settings.creation_enabled = false as an emergency stop: it also stops serving published sites.
-- AI emergency stop: update makeborne_private.live_provider_limits set emergency_stop = true where scope = 'global';
