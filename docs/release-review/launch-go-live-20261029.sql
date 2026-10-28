-- Launch GO, Thu 29 Oct 2026 (production rklojnmmsmhwnkbzuidp). Run only after the owner says GO.
-- PREPARED ONLY. No schedule or this file grants production approval.
-- Preconditions: the 16 launch migrations applied (scripts/apply-production-migrations.mjs --apply), the launch build deployed with
-- the production env in docs/release-review/launch-runbook-20261029.md §6, and the Whop production webhook /api/billing/webhook enabled.
-- Checkout still needs each Whop plan in stock (unlimited) before anyone can pay.
-- After final owner GO, the release operator must explicitly set the session's
-- makeborne.owner_release_go to 'approved-final-launch-20261029' before this script.
do $$ begin
 if current_setting('makeborne.owner_release_go',true) is distinct from 'approved-final-launch-20261029' then
  raise exception 'Final owner GO and qualified release gates are required';
 end if;
 if not exists (select 1 from supabase_migrations.schema_migrations where version='20261028213151') then
  raise exception 'The mail fencing repair must be applied before activation';
 end if;
end $$;

-- Step 1 (smoke test, ~00:45 CET): open the database gate for Create monthly only.
begin;
insert into makeborne_private.billing_access_plans(plan_id, enabled) values ('plan_ZP50769xuOJp1', true)
  on conflict (plan_id) do update set enabled = true;
update makeborne_private.billing_settings set creation_enabled = true where singleton;
commit;

-- Step 2: previously approved $10/day global and Anthropic. Images remain OFF.
-- Use the audited owner function; do not clear an overrun emergency stop here.
begin;
select makeborne_private.set_live_provider_limit('global',true,10000000,false,'Final owner GO; initial approved ceiling $10/day');
select makeborne_private.set_live_provider_limit('anthropic',true,10000000,false,'Final owner GO; initial approved ceiling $10/day');
select makeborne_private.set_live_provider_limit('openai',false,0,false,'Images remain unqualified for this release');
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
--   2. Set WHOP_CREATION_ENABLED=false and WHOP_TOPUPS_ENABLED=false; redeploy.
--   Preserve existing billing_access_plans and paid-member access.
--   Never set billing_settings.creation_enabled = false as an emergency stop: it also stops serving published sites.
-- AI emergency stop: update makeborne_private.live_provider_limits set emergency_stop = true where scope = 'global';
