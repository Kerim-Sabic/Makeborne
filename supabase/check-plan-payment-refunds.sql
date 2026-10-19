-- Local, disposable candidate database only (chain including 20261020090000). Every fixture rolls back.
-- Subscription refunds, disputes, payment-level credit provenance and the support refund workflow.
-- Provider evidence here is simulated with the normalized shape the app sends; it is not a provider observation.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
do $$ begin
  if to_regprocedure('public.makeborne_reconcile_plan_payment(uuid,text,jsonb,timestamptz,timestamptz)') is null then
    raise exception 'Refusing: migration 20261020090000 is not applied to this database';
  end if;
end $$;
update makeborne_private.billing_settings set creation_enabled = true, free_tier_enabled = false where singleton;
insert into makeborne_private.billing_access_plans(plan_id, enabled) values('plan_refundCreate', true) on conflict (plan_id) do update set enabled = true;

create function pg_temp.customer() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); begin
  insert into auth.users(id, email, email_confirmed_at) values(u, u || '@refunds.example.invalid', now()); return u;
end $$;
create function pg_temp.admin() returns uuid language plpgsql as $$
declare u uuid := pg_temp.customer(); begin
  insert into makeborne_private.account_privileges(user_id, is_admin, unlimited_credits, reason) values(u, true, false, 'Disposable refund fixture'); return u;
end $$;
-- A bound, freshly verified membership (what the webhook/access check records).
create function pg_temp.member(u uuid, m text, e timestamptz) returns void language plpgsql as $$
declare k text := substr(m, 5); begin
  insert into public.billing_checkouts(request_id, user_id, plan_id, checkout_id, return_path, status) values(gen_random_uuid(), u, 'plan_refundCreate', 'ch_' || k, '/studio', 'ready');
  insert into public.billing_memberships(membership_id, user_id, checkout_id, whop_user_id, plan_id, status, period_end, verified_until)
  values(m, u, 'ch_' || k, 'user_' || k, 'plan_refundCreate', 'active', e, least(now() + interval '4 minutes', e));
end $$;
create function pg_temp.observe(u uuid, m text, s timestamptz, e timestamptz) returns jsonb language sql as $$
  select public.makeborne_record_plan_observation(u, m, 'plan_refundCreate', 'create', 'monthly', 300, 'active', true, s, e, 'webhook');
$$;
create function pg_temp.pay(id text, m text, paid timestamptz, upd timestamptz, refunded bigint default 0, dispute text default 'none',
  reason text default 'subscription_create', principal bigint default 2900) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'membershipId', m, 'planId', 'plan_refundCreate', 'billingReason', reason, 'currency', 'usd',
    'principalCents', principal::text, 'refundedPrincipalCents', refunded::text,
    'status', case when refunded = principal and principal > 0 then 'refunded' else 'paid' end, 'dispute', dispute, 'paidAt', paid, 'updatedAt', upd);
$$;
-- Payment evidence for a past period (what the reconcile job records from Whop's payment list).
create function pg_temp.evidence(u uuid, m text, id text, paid timestamptz, reason text default 'subscription_create') returns jsonb language sql as $$
  select public.makeborne_record_plan_payment(u, m, id, 'plan_refundCreate', 'create', 'monthly', 300, reason, paid, false);
$$;
create function pg_temp.reconcile(u uuid, m text, p jsonb, s timestamptz default null, e timestamptz default null) returns jsonb language sql as $$
  select public.makeborne_reconcile_plan_payment(u, m, p, s, e);
$$;
-- The ledger is the wallet: the sum of entries equals spendable credits.
create function pg_temp.ledger_ok(u uuid) returns boolean language sql as $$
  select coalesce((select sum(delta) from public.credit_ledger where user_id = u), 0) = makeborne_private.credit_available(u);
$$;

-- A. The reported defect: full refund of an unused subscription payment.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseA'; r jsonb; c jsonb; n integer;
  s timestamptz := date_trunc('second', now()) - interval '1 day'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '20 hours';
begin
  perform pg_temp.member(u, m, e);
  -- Webhook order: verified payment first (with the live membership's period), then the observation.
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseA', m, s + interval '1 second', t), s, e);
  assert r->>'outcome' = 'recorded' and r->>'state' = 'funded' and r->>'attribution' = 'period', 'A1 ' || r;
  perform pg_temp.observe(u, m, s, e);
  assert makeborne_private.credit_available(u) = 300, 'A2';
  assert (select funding_payment_id from makeborne_private.credit_lots where user_id = u and source = 'plan') = 'pay_caseA', 'A3 plan lot records its funding payment';
  assert makeborne_private.has_creation_membership_for_actor(u), 'A4';
  c := public.makeborne_support_payment_refund_check(adm, 'pay_caseA');
  assert c->>'decision' = 'eligible' and (c->'credits'->>'unused')::int = 300, 'A5 ' || c;
  select count(*) into n from public.credit_ledger where user_id = u;
  -- Provider refunds 29/29; Whop keeps the membership active.
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseA', m, s + interval '1 second', t + interval '1 hour', 2900), s, e);
  assert r->>'outcome' = 'updated' and r->>'state' = 'reversed' and (r->>'revoked')::boolean and (r->>'withheldCredits')::int = 300, 'A6 ' || r;
  assert not makeborne_private.has_creation_membership_for_actor(u), 'A7 refunded period keeps no creation access';
  assert makeborne_private.credit_available(u) = 0, 'A8';
  -- A live membership refresh and a paid observation cannot restore access or credits.
  update public.billing_memberships set status = 'active', checked_at = now(), verified_until = least(now() + interval '4 minutes', e) where membership_id = m;
  perform pg_temp.observe(u, m, s, e);
  perform makeborne_private.reconcile_plan_membership(m, now());
  assert not makeborne_private.has_creation_membership_for_actor(u) and makeborne_private.credit_available(u) = 0, 'A9';
  assert public.makeborne_membership_access_revoked(m), 'A10';
  assert (public.makeborne_account_revoked_period(u)->>'reason') = 'refunded', 'A11';
  -- Nothing deleted: the grant stays, one withhold entry is added.
  assert (select count(*) from public.credit_ledger where user_id = u) = n + 1, 'A12';
  assert exists(select 1 from public.credit_ledger where user_id = u and kind = 'plan_grant' and delta = 300), 'A13';
  assert (select count(*) from makeborne_private.credit_lot_withholds where payment_id = 'pay_caseA' and reason = 'refunded' and credits = 300) = 1, 'A14';
  assert pg_temp.ledger_ok(u), 'A15';
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseA')->>'decision' = 'already_refunded', 'A16';
  raise notice 'PASS refunds A: full refund of a subscription payment revokes that period''s access and withholds its unused credits; refresh and reconcile cannot undo it';
end $$;

-- B. Partial usage: not eligible; an external refund after use records exposure for review.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseB'; r jsonb; c jsonb;
  s timestamptz := date_trunc('second', now()) - interval '2 days'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '1 day';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);   -- observation first: the lot is linked when the payment arrives
  assert (select funding_payment_id is null from makeborne_private.credit_lots where user_id = u), 'B1';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseB', m, s + interval '2 seconds', t), s, e);
  assert (select funding_payment_id from makeborne_private.credit_lots where user_id = u) = 'pay_caseB', 'B2 existing lot linked on attribution';
  perform makeborne_private.credit_reserve(u, 40, 'run_caseB');
  perform makeborne_private.credit_settle(u, 'run_caseB', 25);
  c := public.makeborne_support_payment_refund_check(adm, 'pay_caseB');
  assert c->>'decision' = 'not_eligible_used' and (c->'credits'->>'spent')::int = 25 and jsonb_array_length(c->'usage') = 1, 'B3 ' || c;
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseB', 'Customer asked for a refund');
  assert not (c->>'began')::boolean and c->>'decision' = 'not_eligible_used', 'B4';
  assert makeborne_private.credit_available(u) = 275, 'B5 begin refusal changes nothing';
  -- Support refunds in Whop anyway: reconcile, never erase.
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseB', m, s + interval '2 seconds', t + interval '1 hour', 2900), s, e);
  assert r->>'state' = 'reversed' and (r->>'withheldCredits')::int = 275 and (r->>'consumedExposureCredits')::int = 25 and (r->>'needsReview')::boolean, 'B6 ' || r;
  assert exists(select 1 from makeborne_private.plan_credit_issues where user_id = u and kind = 'refund_after_use' and resolved_at is null
    and (detail->>'consumedCredits')::int = 25), 'B7 exposure open for review';
  assert (select spent from makeborne_private.credit_lots where user_id = u) = 25, 'B8 used credits stay recorded as spent';
  assert makeborne_private.credit_available(u) = 0 and pg_temp.ledger_ok(u), 'B9';
  raise notice 'PASS refunds B: used credits make a payment ineligible; an external refund after use withholds the rest and opens the exposure for review';
end $$;

-- C. Active hold blocks the decision; a released hold is not consumption; begin/cancel/begin; provider completes.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); other uuid := pg_temp.customer(); m text := 'mem_caseC'; r jsonb; c jsonb;
  s timestamptz := date_trunc('second', now()) - interval '3 days'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '2 days';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseC', m, s + interval '1 second', t), s, e);
  perform pg_temp.observe(u, m, s, e);
  begin perform public.makeborne_support_payment_refund_check(other, 'pay_caseC'); raise exception 'C non-admin read a refund decision';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_support_payment_refund_begin(other, 'pay_caseC', 'Not an administrator'); raise exception 'C non-admin began a refund';
  exception when sqlstate '42501' then null; end;
  perform makeborne_private.credit_reserve(u, 10, 'run_caseC');
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseC')->>'decision' = 'blocked_active_hold', 'C1';
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseC', 'Unused subscription, customer request');
  assert not (c->>'began')::boolean and c->>'decision' = 'blocked_active_hold', 'C2';
  perform makeborne_private.credit_release(u, 'run_caseC');
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseC')->>'decision' = 'eligible', 'C3 released hold is not consumption';
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseC', 'Unused subscription, customer request');
  assert (c->>'began')::boolean and (c->>'withheldCredits')::int = 300 and c->>'decision' = 'refund_in_progress', 'C4 ' || c;
  assert makeborne_private.credit_available(u) = 0, 'C5';
  begin perform makeborne_private.credit_reserve(u, 1, 'run_caseC2'); raise exception 'C credits spent during a refund';
  exception when sqlstate 'MB402' then null; end;
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseC', 'Second request while open');
  assert not (c->>'began')::boolean and c->>'decision' = 'refund_in_progress', 'C6';
  -- Abandoned: the provider shows no refund, so support cancels and credits return.
  c := public.makeborne_support_payment_refund_cancel(adm, 'pay_caseC', 'Customer kept the subscription');
  assert (c->>'canceled')::boolean and (c->>'restoredCredits')::int = 300 and c->>'decision' = 'eligible', 'C7 ' || c;
  assert makeborne_private.credit_available(u) = 300 and pg_temp.ledger_ok(u), 'C8';
  assert (select count(*) from public.credit_ledger where user_id = u and reference like 'payment:pay\_caseC:%') = 2, 'C9 withhold and restore both recorded';
  -- Begin again; the support refund in Whop then arrives through reconciliation and completes the case.
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseC', 'Customer asked again; unused');
  assert (c->>'began')::boolean, 'C10';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseC', m, s + interval '1 second', t + interval '1 hour', 2900), s, e);
  assert r->>'state' = 'reversed' and (r->>'withheldCredits')::int = 0 and (r->>'consumedExposureCredits')::int = 0 and not (r->>'needsReview')::boolean, 'C11 ' || r;
  assert (select state from makeborne_private.refund_cases where payment_id = 'pay_caseC' order by id desc limit 1) = 'completed', 'C12';
  assert (select count(*) from makeborne_private.refund_cases where payment_id = 'pay_caseC') = 2, 'C13 case history kept';
  assert public.makeborne_support_payment_refund_cancel(adm, 'pay_caseC', 'Too late to cancel')->>'decision' = 'no_open_case', 'C14';
  assert not makeborne_private.has_creation_membership_for_actor(u) and makeborne_private.credit_available(u) = 0 and pg_temp.ledger_ok(u), 'C15';
  raise notice 'PASS refunds C: live holds block, released holds do not count, begin freezes spending, cancel restores, provider refund completes the case';
end $$;

-- D. Partial refund holds; the remainder reverses; duplicate, stale, conflicting and regressing evidence.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseD'; r jsonb; c jsonb;
  s timestamptz := date_trunc('second', now()) - interval '4 days'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '3 days';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t), s, e);
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_caseD', 'Customer request before partial refund');
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '1 hour', 1000), s, e);
  assert r->>'state' = 'held' and not (r->>'revoked')::boolean and (r->>'needsReview')::boolean, 'D1 ' || r;
  assert makeborne_private.has_creation_membership_for_actor(u) and makeborne_private.credit_available(u) = 0, 'D2 partial refund withholds credits, keeps access';
  c := public.makeborne_support_payment_refund_cancel(adm, 'pay_caseD', 'Trying to cancel after a partial refund');
  assert not (c->>'canceled')::boolean and c->>'blocked' = 'provider_refunded', 'D3';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '2 hours', 2900), s, e);
  assert r->>'state' = 'reversed' and (r->>'revoked')::boolean and (r->>'withheldCredits')::int = 0, 'D4 ' || r;
  assert not makeborne_private.has_creation_membership_for_actor(u), 'D5';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '2 hours', 2900), s, e);
  assert r->>'outcome' = 'duplicate', 'D6';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t), s, e);
  assert r->>'outcome' = 'stale' and r->>'state' = 'reversed', 'D7 out-of-order paid evidence cannot restore';
  begin perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '2 hours', 2900, 'open'), s, e);
    raise exception 'D conflicting evidence accepted'; exception when sqlstate 'PT409' then null; end;
  begin perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '3 hours', 1000), s, e);
    raise exception 'D refund regression accepted'; exception when sqlstate 'PT409' then null; end;
  begin perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseD', m, s + interval '1 second', t + interval '3 hours', 0) || jsonb_build_object('status', 'failed'), s, e);
    raise exception 'D refunded payment regressed to failed'; exception when sqlstate 'PT409' then null; end;
  assert (select count(*) from makeborne_private.plan_payment_observations where payment_id = 'pay_caseD') = 3, 'D8 one observation per accepted revision';
  assert (select state from makeborne_private.refund_cases where payment_id = 'pay_caseD') = 'completed', 'D9';
  assert pg_temp.ledger_ok(u), 'D10';
  raise notice 'PASS refunds D: partial refund holds, full refund reverses; duplicate/stale/conflicting/regressing evidence handled';
end $$;

-- E. Disputes: open holds, won restores; lost reverses with its own reason.
do $$
declare u uuid := pg_temp.customer(); u2 uuid := pg_temp.customer(); m text := 'mem_caseE'; m2 text := 'mem_caseEtwo'; r jsonb;
  s timestamptz := date_trunc('second', now()) - interval '5 days'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '4 days';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseE', m, s + interval '1 second', t), s, e);
  perform makeborne_private.credit_reserve(u, 30, 'run_caseE');
  perform makeborne_private.credit_settle(u, 'run_caseE', 30);
  perform makeborne_private.credit_reserve(u, 20, 'run_caseEopen');
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseE', m, s + interval '1 second', t + interval '1 hour', 0, 'open'), s, e);
  assert r->>'state' = 'held' and (r->>'releasedHolds')::int = 1 and (r->>'withheldCredits')::int = 270 and (r->>'consumedExposureCredits')::int = 30, 'E1 ' || r;
  assert (select status from makeborne_private.credit_reservations where user_id = u and reference = 'run_caseEopen') = 'released', 'E2 in-flight hold aborted';
  begin perform makeborne_private.credit_settle(u, 'run_caseEopen', 20); raise exception 'E late result charged a released hold';
  exception when sqlstate 'PT409' then null; end;
  assert makeborne_private.has_creation_membership_for_actor(u), 'E3 open dispute does not revoke';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseE', m, s + interval '1 second', t + interval '2 hours', 0, 'won'), s, e);
  assert r->>'state' = 'funded' and (r->>'restoredCredits')::int = 270, 'E4 ' || r;
  assert makeborne_private.credit_available(u) = 270 and pg_temp.ledger_ok(u), 'E5';
  perform pg_temp.member(u2, m2, e);
  perform pg_temp.observe(u2, m2, s, e);
  perform pg_temp.reconcile(u2, m2, pg_temp.pay('pay_caseEtwo', m2, s + interval '1 second', t), s, e);
  r := pg_temp.reconcile(u2, m2, pg_temp.pay('pay_caseEtwo', m2, s + interval '1 second', t + interval '1 hour', 0, 'lost'), s, e);
  assert r->>'state' = 'reversed' and (r->>'revoked')::boolean, 'E6 ' || r;
  assert (select reason from makeborne_private.membership_revocations where payment_id = 'pay_caseEtwo') = 'dispute_lost', 'E7';
  assert not makeborne_private.has_creation_membership_for_actor(u2) and makeborne_private.credit_available(u2) = 0 and pg_temp.ledger_ok(u2), 'E8';
  raise notice 'PASS refunds E: open dispute holds and aborts live holds, won dispute restores, lost dispute revokes';
end $$;

-- F. Mixed subscription + credit pack: deterministic spend order and payment-specific eligibility.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseF'; r jsonb; c jsonb; o jsonb; oid uuid; req jsonb; p jsonb;
  s timestamptz := date_trunc('second', now()) - interval '6 days'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '5 days';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseF', m, s + interval '1 second', t), s, e);
  update makeborne_private.topup_catalog set enabled = true, merchant_id = 'biz_Refund', plan_id = 'plan_refundPack' where pack_id = 'boost_100';
  o := public.makeborne_prepare_topup(u, gen_random_uuid(), 'boost_100', 'credit-packs-preview-2026-10-05', 'user_caseF'); oid := (o->>'id')::uuid;
  req := jsonb_build_object('plan_id', 'plan_refundPack', 'mode', 'payment', 'metadata', jsonb_build_object('makeborne_topup_order_id', oid), 'redirect_url', 'https://sandbox.whop.com/');
  perform public.makeborne_claim_topup_checkout(u, oid, req);
  perform public.makeborne_save_topup_checkout(u, oid, 'ch_packF', 'https://sandbox.whop.com/checkout/ch_packF');
  perform public.makeborne_bind_topup_checkout(u, oid, 'ch_packF');
  p := jsonb_build_object('id', 'pay_packF', 'merchantId', 'biz_Refund', 'planId', 'plan_refundPack', 'checkoutId', 'ch_packF', 'whopUserId', 'user_caseF',
    'currency', 'usd', 'principalCents', '1200', 'refundedPrincipalCents', '0', 'status', 'paid', 'dispute', 'none', 'updatedAt', t);
  perform public.makeborne_reconcile_topup(u, oid, p);
  assert (select funding_payment_id from makeborne_private.credit_lots where user_id = u and source = 'topup') = 'pay_packF', 'F1 pack lot records its payment';
  assert makeborne_private.credit_available(u) = 400, 'F2';
  perform makeborne_private.credit_reserve(u, 50, 'run_caseF');
  perform makeborne_private.credit_settle(u, 'run_caseF', 50);
  assert (select spent from makeborne_private.credit_lots where user_id = u and source = 'plan') = 50
    and (select spent from makeborne_private.credit_lots where user_id = u and source = 'topup') = 0, 'F3 expiring plan credits are used before pack credits';
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseF')->>'decision' = 'not_eligible_used', 'F4';
  c := public.makeborne_support_payment_refund_check(adm, 'pay_packF');
  assert c->>'decision' = 'eligible' and c->>'kind' = 'credit_pack', 'F5 ' || c;
  c := public.makeborne_support_payment_refund_begin(adm, 'pay_packF', 'Unused credit pack, customer request');
  assert (c->>'began')::boolean and (c->>'withheldCredits')::int = 100, 'F6';
  assert makeborne_private.credit_available(u) = 250, 'F7 only the pack is frozen';
  begin perform makeborne_private.credit_reserve(u, 251, 'run_caseF2'); raise exception 'F frozen pack credits spent';
  exception when sqlstate 'MB402' then null; end;
  r := public.makeborne_reconcile_topup(u, oid, p || jsonb_build_object('status', 'refunded', 'refundedPrincipalCents', '1200', 'updatedAt', t + interval '1 hour'));
  assert r->>'state' = 'reversed' and (r->>'consumedExposureCredits')::int = 0, 'F8 ' || r;
  assert (select state from makeborne_private.refund_cases where payment_id = 'pay_packF') = 'completed', 'F9 pack refund completes the case';
  assert public.makeborne_support_payment_refund_check(adm, 'pay_packF')->>'decision' = 'already_refunded', 'F10';
  assert makeborne_private.has_creation_membership_for_actor(u) and makeborne_private.credit_available(u) = 250 and pg_temp.ledger_ok(u), 'F11 subscription untouched';
  raise notice 'PASS refunds F: subscription and pack credits are separate payments; spend order is deterministic; a pack refund leaves the subscription intact';
end $$;

-- G. Several payments: refund only the unused renewal; the older period is untouched.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseG'; r jsonb; c jsonb;
  s1 timestamptz := date_trunc('second', now()) - interval '1 month' - interval '5 days'; e1 timestamptz := s1 + interval '1 month';
  s2 timestamptz := e1; e2 timestamptz := s2 + interval '1 month'; t timestamptz := now() - interval '1 hour';
begin
  perform pg_temp.member(u, m, e2);
  perform pg_temp.observe(u, m, s1, e1);
  perform pg_temp.evidence(u, m, 'pay_caseGone', s1 + interval '1 second');
  perform pg_temp.observe(u, m, s2, e2);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseGone', m, s1 + interval '1 second', t));
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseGtwo', m, s2 + interval '2 seconds', t, 0, 'none', 'subscription_cycle'), s2, e2);
  assert (select count(*) from makeborne_private.credit_lots where user_id = u and funding_payment_id is not null) = 2, 'G1';
  perform makeborne_private.credit_reserve(u, 100, 'run_caseG');
  perform makeborne_private.credit_settle(u, 'run_caseG', 100);
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseGone')->>'decision' = 'not_eligible_used', 'G2';
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseGtwo')->>'decision' = 'eligible', 'G3 eligibility is per payment';
  perform public.makeborne_support_payment_refund_begin(adm, 'pay_caseGtwo', 'Renewal charged by mistake, unused');
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseGtwo', m, s2 + interval '2 seconds', t + interval '1 minute', 2900, 'none', 'subscription_cycle'), s2, e2);
  assert r->>'state' = 'reversed' and (r->>'revoked')::boolean, 'G4';
  assert (select lapsed from makeborne_private.credit_lots where funding_payment_id = 'pay_caseGone') = 0, 'G5 older period credits untouched';
  assert makeborne_private.credit_available(u) = 200 and not makeborne_private.has_creation_membership_for_actor(u) and pg_temp.ledger_ok(u), 'G6';
  raise notice 'PASS refunds G: with several payments only the refunded payment''s credits and period are affected';
end $$;

-- H. Renewal after a revoked period restores access for the newly paid period.
do $$
declare u uuid := pg_temp.customer(); m text := 'mem_caseH'; r jsonb;
  s1 timestamptz := date_trunc('second', now()) - interval '1 month' - interval '2 days'; e1 timestamptz := s1 + interval '1 month';
  s2 timestamptz := e1; e2 timestamptz := s2 + interval '1 month'; t timestamptz := now() - interval '3 days';
begin
  perform pg_temp.member(u, m, e2);
  perform pg_temp.observe(u, m, s1, e1);
  perform pg_temp.evidence(u, m, 'pay_caseHone', s1 + interval '1 second');
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseHone', m, s1 + interval '1 second', t));
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseHone', m, s1 + interval '1 second', t + interval '1 hour', 2900));
  assert r->>'state' = 'reversed' and (r->>'revoked')::boolean, 'H1';
  perform pg_temp.observe(u, m, s2, e2);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseHtwo', m, s2 + interval '1 second', now() - interval '1 minute', 0, 'none', 'subscription_cycle'), s2, e2);
  assert makeborne_private.has_creation_membership_for_actor(u), 'H2 paid renewal restores access';
  assert makeborne_private.credit_available(u) = 300 and (select funding_payment_id from makeborne_private.credit_lots where user_id = u and lapsed = 0) = 'pay_caseHtwo', 'H3';
  assert pg_temp.ledger_ok(u), 'H4';
  raise notice 'PASS refunds H: a revocation is limited to its period; a later paid renewal grants access and credits';
end $$;

-- I. Refund evidence first; payment before period; refunded period receives no allocation.
do $$
declare u uuid := pg_temp.customer(); u2 uuid := pg_temp.customer(); u3 uuid := pg_temp.customer(); m text := 'mem_caseI'; m2 text := 'mem_caseItwo'; m3 text := 'mem_caseIthree'; r jsonb;
  s timestamptz := date_trunc('second', now()) - interval '1 day'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '1 hour';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseI', m, s + interval '1 second', t, 2900), s, e);
  assert r->>'outcome' = 'recorded' and r->>'state' = 'reversed' and (r->>'withheldCredits')::int = 300 and (r->>'revoked')::boolean, 'I1 ' || r;
  perform pg_temp.member(u2, m2, e);
  r := pg_temp.reconcile(u2, m2, pg_temp.pay('pay_caseItwo', m2, s + interval '1 second', t, 2900), s, e);
  assert r->>'attribution' = 'period' and (r->>'revoked')::boolean, 'I2';
  r := pg_temp.observe(u2, m2, s, e);
  assert makeborne_private.credit_available(u2) = 0 and not exists(select 1 from public.credit_ledger where user_id = u2 and kind = 'plan_grant'), 'I3 refunded period never granted';
  assert pg_temp.ledger_ok(u) and pg_temp.ledger_ok(u2), 'I4';
  -- Refund recorded with no known period and no live period hint; the period appears later.
  perform pg_temp.member(u3, m3, e);
  r := pg_temp.reconcile(u3, m3, pg_temp.pay('pay_caseIthree', m3, s + interval '1 second', t, 2900));
  assert r->>'attribution' = 'pending' and not (r->>'revoked')::boolean, 'I5 ' || r;
  perform pg_temp.observe(u3, m3, s, e);
  assert (select attribution from makeborne_private.plan_payments where payment_id = 'pay_caseIthree') = 'period', 'I6';
  assert exists(select 1 from makeborne_private.membership_revocations where payment_id = 'pay_caseIthree'), 'I7 revoked as soon as attributed';
  assert not makeborne_private.has_creation_membership_for_actor(u3) and makeborne_private.credit_available(u3) = 0, 'I8';
  assert not exists(select 1 from makeborne_private.plan_credit_issues where membership_id = m3 and kind = 'refund_unattributed' and resolved_at is null), 'I9 review issue resolved';
  raise notice 'PASS refunds I: refund evidence arriving first reverses at once; a refunded period receives no allocation; a refund matched to its period later is applied then';
end $$;

-- J. Unattributable or ambiguous payments go to manual review instead of guessing.
do $$
declare u uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseJ'; r jsonb;
  s timestamptz := date_trunc('second', now()) - interval '1 day'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '1 hour';
begin
  perform pg_temp.member(u, m, e);
  perform pg_temp.observe(u, m, s, e);
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseJone', m, s - interval '10 days', t), s, e);
  assert r->>'attribution' = 'pending', 'J1 ' || r;
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseJone')->>'decision' = 'manual_review_unattributed', 'J2';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseJone', m, s - interval '10 days', t + interval '1 minute', 2900), s, e);
  assert r->>'state' = 'reversed' and not (r->>'revoked')::boolean and (r->>'needsReview')::boolean, 'J3';
  assert exists(select 1 from makeborne_private.plan_credit_issues where membership_id = m and kind = 'refund_unattributed' and resolved_at is null), 'J4';
  assert makeborne_private.credit_available(u) = 300, 'J5 no credits guessed away';
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseJtwo', m, s + interval '1 second', t), s, e);
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseJthree', m, s + interval '12 hours', t, 0, 'none', 'subscription_cycle'), s, e);
  assert r->>'attribution' = 'ambiguous', 'J6';
  assert public.makeborne_support_payment_refund_check(adm, 'pay_caseJthree')->>'decision' = 'manual_review_unattributed', 'J7';
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseJfour', m, s + interval '1 second', t, 0, 'none', 'manual'), s, e);
  assert r->>'attribution' = 'none', 'J8';
  raise notice 'PASS refunds J: unattributable and ambiguous payments are held for manual review';
end $$;

-- K. Boundaries: binding, plan, unpaid attempts, funding immutability, admin listing.
do $$
declare u uuid := pg_temp.customer(); other uuid := pg_temp.customer(); adm uuid := pg_temp.admin(); m text := 'mem_caseK'; r jsonb;
  s timestamptz := date_trunc('second', now()) - interval '1 day'; e timestamptz := s + interval '1 month'; t timestamptz := now() - interval '1 hour';
begin
  perform pg_temp.member(u, m, e);
  begin perform pg_temp.reconcile(other, m, pg_temp.pay('pay_caseK', m, s, t)); raise exception 'K other account reconciled a membership';
  exception when sqlstate 'P0002' then null; end;
  begin perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseK', m, s, t) || jsonb_build_object('planId', 'plan_other')); raise exception 'K plan mismatch';
  exception when sqlstate 'PT409' then null; end;
  begin perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseK', 'mem_other', s, t)); raise exception 'K membership mismatch';
  exception when sqlstate 'PT409' then null; end;
  r := pg_temp.reconcile(u, m, pg_temp.pay('pay_caseKfailed', m, s, t) || jsonb_build_object('status', 'failed'));
  assert r->>'outcome' = 'ignored_unpaid' and not exists(select 1 from makeborne_private.plan_payments where payment_id = 'pay_caseKfailed'), 'K1';
  perform pg_temp.observe(u, m, s, e);
  perform pg_temp.reconcile(u, m, pg_temp.pay('pay_caseK', m, s + interval '1 second', t), s, e);
  begin update makeborne_private.credit_lots set funding_payment_id = 'pay_other' where user_id = u; raise exception 'K funding re-pointed';
  exception when sqlstate 'PT409' then null; end;
  r := public.makeborne_admin_user_payments(adm, u);
  assert jsonb_array_length(r->'subscriptionPayments') = 1 and r->'subscriptionPayments'->0->>'decision' = 'eligible', 'K2 ' || r;
  begin perform public.makeborne_admin_user_payments(u, u); raise exception 'K customer read admin payments';
  exception when sqlstate '42501' then null; end;
  raise notice 'PASS refunds K: membership binding, plan, unpaid attempts, funding immutability and administrator boundaries';
end $$;

-- L. Privileges: browsers cannot reach any entry point; helpers are owner-only.
do $$
declare f text;
begin
  foreach f in array array['public.makeborne_reconcile_plan_payment(uuid,text,jsonb,timestamptz,timestamptz)', 'public.makeborne_membership_access_revoked(text)',
    'public.makeborne_support_payment_refund_check(uuid,text)', 'public.makeborne_support_payment_refund_begin(uuid,text,text)',
    'public.makeborne_support_payment_refund_cancel(uuid,text,text)', 'public.makeborne_admin_user_payments(uuid,uuid)', 'public.makeborne_account_revoked_period(uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute'), f;
  end loop;
  foreach f in array array['makeborne_private.withhold_payment_lots(uuid,text,text,bigint)', 'makeborne_private.restore_payment_lots(uuid,text,text[],text)',
    'makeborne_private.apply_plan_payment_state(text)', 'makeborne_private.payment_refund_snapshot(text)', 'makeborne_private.attribute_plan_payments(text,text)'] loop
    assert not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), f;
  end loop;
  assert not has_table_privilege('service_role', 'makeborne_private.plan_payments', 'select') and not has_table_privilege('authenticated', 'makeborne_private.refund_cases', 'select'), 'tables';
  raise notice 'PASS refunds L: service-role entry points only; helpers and tables unreachable from clients';
end $$;

rollback;
