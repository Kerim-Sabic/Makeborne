-- Reproduces the 2026-10-19 sandbox failure in SQL (simulated provider; disposable local DB only; rolls back).
-- Sequence = what the app records for a fully refunded, unused $29 subscription payment when Whop keeps the
-- membership "active": membership refresh, active observation, refunded payment evidence. With migration
-- 20261020090000 the webhook also records the verified payment (makeborne_reconcile_plan_payment) first.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
update makeborne_private.billing_settings set creation_enabled = true, free_tier_enabled = false where singleton;
insert into makeborne_private.billing_access_plans(plan_id, enabled) values('plan_reproCreate', true) on conflict (plan_id) do update set enabled = true;
do $$
declare u uuid := gen_random_uuid(); m text := 'mem_reproRefund'; s timestamptz := date_trunc('second', now()) - interval '1 hour';
  e timestamptz := s + interval '1 month'; fixed boolean := to_regprocedure('public.makeborne_reconcile_plan_payment(uuid,text,jsonb,timestamptz,timestamptz)') is not null;
begin
  insert into auth.users(id, email, email_confirmed_at) values(u, u || '@repro.example.invalid', now());
  insert into public.billing_checkouts(request_id, user_id, plan_id, checkout_id, return_path, status) values(gen_random_uuid(), u, 'plan_reproCreate', 'ch_reproRefund', '/studio', 'ready');
  insert into public.billing_memberships(membership_id, user_id, checkout_id, whop_user_id, plan_id, status, period_end, verified_until)
  values(m, u, 'ch_reproRefund', 'user_reproRefund', 'plan_reproCreate', 'active', e, now() + interval '4 minutes');
  -- Purchase: payment.succeeded -> active observation -> 300 credits.
  perform public.makeborne_record_plan_observation(u, m, 'plan_reproCreate', 'create', 'monthly', 300, 'active', true, s, e, 'webhook');
  raise notice 'before refund: creation access %, available credits %', makeborne_private.has_creation_membership_for_actor(u), makeborne_private.credit_available(u);
  -- Full refund 29/29 in the Whop dashboard; the membership stays active.
  if fixed then
    perform public.makeborne_reconcile_plan_payment(u, m, jsonb_build_object('id', 'pay_reproRefund', 'membershipId', m, 'planId', 'plan_reproCreate',
      'billingReason', 'subscription_create', 'currency', 'usd', 'principalCents', '2900', 'refundedPrincipalCents', '2900', 'status', 'refunded',
      'dispute', 'none', 'paidAt', s + interval '1 second', 'updatedAt', now() - interval '1 minute'), s, e);
  end if;
  update public.billing_memberships set status = 'active', checked_at = now(), verified_until = now() + interval '4 minutes' where membership_id = m;
  perform public.makeborne_record_plan_observation(u, m, 'plan_reproCreate', 'create', 'monthly', 300, 'active', true, s, e, 'webhook');
  perform public.makeborne_record_plan_payment(u, m, 'pay_reproRefund', 'plan_reproCreate', 'create', 'monthly', 300, 'subscription_create', s + interval '1 second', true);
  perform makeborne_private.reconcile_plan_membership(m, now());
  raise notice 'after refund (%): creation access %, available credits %', case when fixed then 'with 20261020090000' else 'chain without the fix' end,
    makeborne_private.has_creation_membership_for_actor(u), makeborne_private.credit_available(u);
end $$;
rollback;
