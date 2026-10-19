-- Payment-level credit provenance, subscription refund/dispute reconciliation,
-- billing-period revocation and the support refund workflow. Forward only:
-- applied migrations are untouched; two functions are redefined below.
--
-- Defect fixed (real Whop sandbox, 2026-10-19, payments-go-live report): a fully
-- refunded $29 subscription payment left the Whop membership "active" (Whop keeps
-- it active after a refund), so Makeborne kept creation access and the 300-credit
-- plan lot, and a reconcile did not change that. Membership status cannot be the
-- refund authority. Each subscription payment's verified state is now recorded,
-- and a refunded period's entitlement no longer depends on membership refreshes.
--
-- * credit_lots.funding_payment_id: the provider payment that supplied a lot, set
--   once. Pack lots link to their order's payment; plan lots to the one
--   subscription payment of their billing period. Trial, adjustment and legacy
--   lots have none. Unattributed plan lots are never guessed: a refund that cannot
--   be attributed opens a review issue instead.
-- * plan_payments (+ append-only observations): funded / held / reversed, from
--   freshly retrieved provider evidence, with stale, duplicate and regression
--   guards (same rules as credit-pack orders).
-- * held (partial refund, open dispute): live holds on the payment's lots are
--   released and every unused credit is withheld; a won dispute restores them.
-- * reversed (full refund, lost dispute): the same, plus a revocation of creation
--   access for that billing period, which a membership refresh cannot undo, and no
--   further allocations for it. Credits already used stay recorded as exposure and
--   open a review issue; no ledger row is deleted and no debt is written off.
-- * Support refund workflow (administrators, through the app; the runtime Whop key
--   gains no refund permission): check payment-specific eligibility (refundable only
--   while none of that payment's credits were used), begin (withholds them under the
--   wallet lock so nothing can be spent while support refunds in Whop), cancel
--   (restores them if the provider shows no refund). The provider's refund then
--   arrives through the webhook/reconcile path and completes the case.
-- * Spend order is unchanged and deterministic: credits expiring soonest first; then
--   plan, trial, pack, adjustment, refund credits (lot_spend_rank); then oldest lot.
begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table makeborne_private.credit_lots
  add column funding_payment_id text constraint credit_lots_funding_payment_check check (funding_payment_id ~ '^pay_[A-Za-z0-9]{1,64}$');
create index credit_lots_funding_payment on makeborne_private.credit_lots(funding_payment_id) where funding_payment_id is not null;
comment on column makeborne_private.credit_lots.funding_payment_id is
  'Provider payment that supplied these credits; recorded once. Null for trial, adjustment and legacy credits, and for plan credits not yet attributed to a payment.';

create table makeborne_private.plan_payments(
  payment_id text primary key check (payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id text not null check (membership_id ~ '^mem_[A-Za-z0-9]{1,64}$'),
  plan_id text not null check (plan_id ~ '^plan_[A-Za-z0-9]{1,64}$'),
  billing_reason text not null check (length(billing_reason) between 1 and 40),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  principal_cents bigint not null check (principal_cents >= 0),
  refunded_cents bigint not null check (refunded_cents >= 0 and refunded_cents <= principal_cents),
  dispute text not null check (dispute in ('none','open','won','lost')),
  paid_at timestamptz not null,
  state text not null check (state in ('funded','held','reversed')),
  attribution text not null default 'pending' check (attribution in ('pending','period','none','ambiguous')),
  period_start timestamptz,
  period_end timestamptz,
  consumed_exposure_credits bigint not null default 0 check (consumed_exposure_credits >= 0),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 4096),
  observed_at timestamptz not null,
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((attribution = 'period') = (period_start is not null and period_end is not null)),
  check (period_end is null or period_end > period_start)
);
create index plan_payments_membership on makeborne_private.plan_payments(membership_id, paid_at);
create index plan_payments_user on makeborne_private.plan_payments(user_id, paid_at desc);
create unique index plan_payments_one_per_period on makeborne_private.plan_payments(membership_id, period_start) where attribution = 'period';
comment on table makeborne_private.plan_payments is
  'Verified state of each subscription payment (hundredths of its currency). Refund authority for plan credits and creation access; membership status is not.';

create table makeborne_private.plan_payment_observations(
  payment_id text not null references makeborne_private.plan_payments(payment_id) on delete cascade,
  revision bigint not null,
  evidence jsonb not null,
  outcome text not null check (outcome in ('funded','held','reversed')),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (payment_id, revision)
);

create table makeborne_private.refund_cases(
  id bigint generated always as identity primary key,
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_kind text not null check (payment_kind in ('subscription','credit_pack')),
  state text not null default 'pending' check (state in ('pending','completed','canceled')),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  withheld_credits bigint not null default 0 check (withheld_credits >= 0),
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  close_reason text check (close_reason is null or length(btrim(close_reason)) between 5 and 500),
  check ((state = 'pending') = (closed_at is null))
);
create unique index refund_cases_one_open on makeborne_private.refund_cases(payment_id) where state = 'pending';
create index refund_cases_user on makeborne_private.refund_cases(user_id, opened_at desc);

create table makeborne_private.credit_lot_withholds(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lot_id bigint not null references makeborne_private.credit_lots(id) on delete cascade,
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  reason text not null check (reason in ('refund_review','partially_refunded','disputed','refunded','dispute_lost')),
  refund_case bigint references makeborne_private.refund_cases(id),
  credits bigint not null check (credits > 0),
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  restore_reason text check (restore_reason is null or length(btrim(restore_reason)) between 5 and 200),
  check ((restored_at is null) = (restore_reason is null))
);
create index credit_lot_withholds_payment on makeborne_private.credit_lot_withholds(payment_id) where restored_at is null;

create table makeborne_private.membership_revocations(
  payment_id text primary key references makeborne_private.plan_payments(payment_id) on delete cascade,
  membership_id text not null check (membership_id ~ '^mem_[A-Za-z0-9]{1,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  reason text not null check (reason in ('refunded','dispute_lost')),
  revoked_at timestamptz not null default now(),
  lifted_at timestamptz,
  lift_reason text check (lift_reason is null or length(btrim(lift_reason)) between 5 and 200),
  check (period_end > period_start),
  check ((lifted_at is null) = (lift_reason is null))
);
create index membership_revocations_active on makeborne_private.membership_revocations(membership_id, period_start) where lifted_at is null;
comment on table makeborne_private.membership_revocations is
  'Creation access removed for a refunded or charged-back billing period. Independent of the provider membership status.';

alter table makeborne_private.plan_credit_issues drop constraint plan_credit_issues_kind_check,
  add constraint plan_credit_issues_kind_check check (kind in ('no_evidence','account_overlap','refund_after_use','refund_unattributed'));

revoke all on makeborne_private.plan_payments, makeborne_private.plan_payment_observations, makeborne_private.refund_cases,
  makeborne_private.credit_lot_withholds, makeborne_private.membership_revocations from public, anon, authenticated, service_role;

-- Funding is recorded once and never re-pointed.
create function makeborne_private.guard_lot_funding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.funding_payment_id is not null and new.funding_payment_id is distinct from old.funding_payment_id then
    raise exception 'Credit funding cannot change once recorded' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger guard_lot_funding before update of funding_payment_id on makeborne_private.credit_lots
  for each row execute function makeborne_private.guard_lot_funding();

-- Pack lots: link from the order (existing rows now, new grants by trigger), and
-- complete an open support refund case when the provider confirms the refund.
update makeborne_private.credit_lots l set funding_payment_id = o.payment_id
from makeborne_private.topup_orders o where o.lot_id = l.id and o.payment_id is not null and l.funding_payment_id is null;

create function makeborne_private.topup_order_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lot_id is not null and new.payment_id is not null then
    update makeborne_private.credit_lots set funding_payment_id = new.payment_id where id = new.lot_id and funding_payment_id is null;
  end if;
  if new.state = 'reversed' and new.payment_id is not null then
    update makeborne_private.refund_cases set state = 'completed', closed_at = now(), close_reason = 'Provider confirmed the refund'
    where payment_id = new.payment_id and state = 'pending';
  end if;
  return null;
end $$;
create trigger topup_order_effects after insert or update of lot_id, payment_id, state on makeborne_private.topup_orders
  for each row execute function makeborne_private.topup_order_effects();

-- ---------------------------------------------------------------------------
-- Internal helpers (owner only)
-- ---------------------------------------------------------------------------
create function makeborne_private.lot_period_start(p_metadata jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return (p_metadata->>'periodStart')::timestamptz;
exception when others then
  return null;
end $$;

create function makeborne_private.membership_access_revoked(p_membership text, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from makeborne_private.membership_revocations r
    left join makeborne_private.plan_periods p on p.membership_id = r.membership_id and p.period_start = r.period_start
    where r.membership_id = p_membership and r.lifted_at is null
      and p_at >= r.period_start and p_at < greatest(r.period_end, coalesce(p.period_end, r.period_end)));
$$;

-- Abort in-flight reservations on a payment's lots. A late provider result then
-- sees a released hold and cannot charge (same rule as credit-pack reversals).
create function makeborne_private.release_payment_holds(p_user uuid, p_payment text, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; n integer := 0;
begin
  for h in select distinct r.reference from makeborne_private.credit_reservations r
      join makeborne_private.credit_hold_lots hl on hl.user_id = r.user_id and hl.reference = r.reference
      join makeborne_private.credit_lots l on l.id = hl.lot_id
      where r.user_id = p_user and r.status = 'reserved' and l.funding_payment_id = p_payment order by r.reference loop
    perform makeborne_private.resolve_hold(p_user, h.reference, 0, 'release', makeborne_private.credit_clock(),
      jsonb_build_object('reason', p_reason, 'payment', p_payment));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Withhold every unused credit of a payment's lots. Caller holds the wallet lock.
create function makeborne_private.withhold_payment_lots(p_user uuid, p_payment text, p_reason text, p_case bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare l makeborne_private.credit_lots%rowtype; v_free bigint; v_total bigint := 0; v_id bigint;
begin
  for l in select * from makeborne_private.credit_lots where user_id = p_user and funding_payment_id = p_payment order by id for update loop
    v_free := l.amount - l.spent - l.held - l.lapsed;
    continue when v_free <= 0;
    update makeborne_private.credit_lots set lapsed = lapsed + v_free where id = l.id;
    insert into makeborne_private.credit_lot_withholds(user_id, lot_id, payment_id, reason, refund_case, credits)
    values(p_user, l.id, p_payment, p_reason, p_case, v_free) returning id into v_id;
    insert into public.credit_ledger(user_id, delta, kind, reference, balance_after, metadata)
    values(p_user, -v_free, 'adjust', 'payment:' || p_payment || ':withhold:' || v_id, makeborne_private.credit_available(p_user),
      jsonb_build_object('payment', p_payment, 'lot', l.id, 'reason', p_reason, 'refundCase', p_case));
    v_total := v_total + v_free;
  end loop;
  return v_total;
end $$;

-- Return withheld credits of the given reasons. Caller holds the wallet lock.
-- Credits whose allocation ended meanwhile lapse again, with their own ledger row.
create function makeborne_private.restore_payment_lots(p_user uuid, p_payment text, p_reasons text[], p_restore_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare w record; v_total bigint := 0;
begin
  for w in select x.* from makeborne_private.credit_lot_withholds x where x.user_id = p_user and x.payment_id = p_payment
      and x.restored_at is null and x.reason = any(p_reasons) order by x.id for update loop
    update makeborne_private.credit_lots set lapsed = lapsed - w.credits where id = w.lot_id;
    update makeborne_private.credit_lot_withholds set restored_at = now(), restore_reason = p_restore_reason where id = w.id;
    insert into public.credit_ledger(user_id, delta, kind, reference, balance_after, metadata)
    values(p_user, w.credits, 'adjust', 'payment:' || p_payment || ':restore:' || w.id, makeborne_private.credit_available(p_user),
      jsonb_build_object('payment', p_payment, 'lot', w.lot_id, 'reason', p_restore_reason, 'withhold', w.id));
    v_total := v_total + w.credits;
  end loop;
  if v_total > 0 then perform makeborne_private.expire_lots(p_user, makeborne_private.credit_clock()); end if;
  return v_total;
end $$;

-- Attribute recorded subscription payments to recorded billing periods, link the
-- plan lots of each attributed period, and apply a refund or dispute that was
-- recorded before its period was known. One paid subscription payment per period;
-- anything else is left for review rather than guessed. p_skip names a payment
-- the caller applies itself. Caller holds the membership lock and the wallet lock.
create function makeborne_private.attribute_plan_payments(p_membership text, p_skip text default null) returns integer
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare x record; c integer; s timestamptz; e timestamptz; n integer := 0; v_late text[] := '{}'; v_payment text;
begin
  for x in select * from makeborne_private.plan_payments where membership_id = p_membership and attribution = 'pending'
      order by paid_at, payment_id for update loop
    if x.billing_reason not in ('subscription_create','subscription_cycle') then
      update makeborne_private.plan_payments set attribution = 'none', updated_at = now() where payment_id = x.payment_id;
      continue;
    end if;
    select count(*), min(period_start), min(period_end) into c, s, e from makeborne_private.plan_periods
    where membership_id = p_membership and user_id = x.user_id and x.paid_at >= period_start - interval '1 day' and x.paid_at < period_end;
    continue when c = 0;
    if c > 1 or exists(select 1 from makeborne_private.plan_payments y where y.membership_id = p_membership and y.attribution = 'period' and y.period_start = s) then
      update makeborne_private.plan_payments set attribution = 'ambiguous', updated_at = now() where payment_id = x.payment_id;
      continue;
    end if;
    update makeborne_private.plan_payments set attribution = 'period', period_start = s, period_end = e, updated_at = now() where payment_id = x.payment_id;
    if x.state <> 'funded' and x.payment_id is distinct from p_skip then v_late := v_late || x.payment_id; end if;
    n := n + 1;
  end loop;
  update makeborne_private.credit_lots l set funding_payment_id = pp.payment_id
  from makeborne_private.plan_payments pp
  where pp.membership_id = p_membership and pp.attribution = 'period' and l.user_id = pp.user_id and l.source = 'plan'
    and l.funding_payment_id is null and split_part(l.reference, ':', 2) = p_membership
    and makeborne_private.lot_period_start(l.metadata) = pp.period_start;
  foreach v_payment in array v_late loop
    perform makeborne_private.apply_plan_payment_state(v_payment);
  end loop;
  return n;
end $$;

-- Converge credits, access and review issues on a payment's recorded state.
-- Idempotent. Caller holds the membership lock and the wallet lock.
create function makeborne_private.apply_plan_payment_state(p_payment text) returns jsonb
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare pp makeborne_private.plan_payments%rowtype; v_released integer := 0; v_withheld bigint := 0; v_restored bigint := 0;
  v_exposure bigint := 0; v_reason text;
begin
  select * into pp from makeborne_private.plan_payments where payment_id = p_payment for update;
  if pp.state in ('held','reversed') then
    v_reason := case when pp.state = 'reversed' and pp.dispute = 'lost' then 'dispute_lost' when pp.state = 'reversed' then 'refunded'
      when pp.dispute = 'open' then 'disputed' else 'partially_refunded' end;
    v_released := makeborne_private.release_payment_holds(pp.user_id, p_payment, 'subscription payment ' || pp.state);
    v_withheld := makeborne_private.withhold_payment_lots(pp.user_id, p_payment, v_reason, null);
    select coalesce(sum(spent), 0) into v_exposure from makeborne_private.credit_lots where user_id = pp.user_id and funding_payment_id = p_payment;
    update makeborne_private.plan_payments set consumed_exposure_credits = v_exposure, updated_at = now() where payment_id = p_payment;
    if pp.state = 'reversed' and pp.attribution = 'period' then
      insert into makeborne_private.membership_revocations(payment_id, membership_id, user_id, period_start, period_end, reason)
      values(p_payment, pp.membership_id, pp.user_id, pp.period_start, pp.period_end, case when pp.dispute = 'lost' then 'dispute_lost' else 'refunded' end)
      on conflict (payment_id) do nothing;
      update makeborne_private.refund_cases set state = 'completed', closed_at = now(), close_reason = 'Provider confirmed the refund'
      where payment_id = p_payment and state = 'pending';
    end if;
    if pp.state = 'reversed' and v_exposure > 0 then
      insert into makeborne_private.plan_credit_issues(membership_id, user_id, allocation_start, kind, detail)
      values(pp.membership_id, pp.user_id, coalesce(pp.period_start, pp.paid_at), 'refund_after_use',
        jsonb_build_object('payment', p_payment, 'consumedCredits', v_exposure, 'refundedCents', pp.refunded_cents, 'principalCents', pp.principal_cents))
      on conflict (membership_id, allocation_start, kind) do update set last_seen_at = now(), detail = excluded.detail;
    end if;
    if pp.attribution <> 'period' then
      insert into makeborne_private.plan_credit_issues(membership_id, user_id, allocation_start, kind, detail)
      values(pp.membership_id, pp.user_id, pp.paid_at, 'refund_unattributed',
        jsonb_build_object('payment', p_payment, 'state', pp.state, 'attribution', pp.attribution, 'billingReason', pp.billing_reason))
      on conflict (membership_id, allocation_start, kind) do update set last_seen_at = now(), detail = excluded.detail, resolved_at = null, resolution = null;
    end if;
  elsif pp.state = 'funded' then
    v_restored := makeborne_private.restore_payment_lots(pp.user_id, p_payment, array['disputed'], 'Dispute resolved in the merchant''s favour');
  end if;
  if pp.attribution = 'period' then
    update makeborne_private.plan_credit_issues set resolved_at = now(), resolution = 'attributed:' || p_payment
    where membership_id = pp.membership_id and kind = 'refund_unattributed' and resolved_at is null and detail->>'payment' = p_payment;
  end if;
  return jsonb_build_object('releasedHolds', v_released, 'withheldCredits', v_withheld, 'restoredCredits', v_restored);
end $$;

-- ---------------------------------------------------------------------------
-- Subscription payment reconciliation (service role: webhook, reconcile job)
-- ---------------------------------------------------------------------------
create function public.makeborne_reconcile_plan_payment(p_user uuid, p_membership text, p_payment jsonb,
  p_period_start timestamptz default null, p_period_end timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare m public.billing_memberships%rowtype; pp makeborne_private.plan_payments%rowtype; v_found boolean;
  v_id text; v_status text; v_dispute text; v_currency text; v_reason text; v_principal bigint; v_refund bigint;
  v_paid timestamptz; v_at timestamptz; v_evidence jsonb; v_next text; v_outcome text; v_rev bigint; v_effect jsonb;
begin
  if p_membership is null or p_membership !~ '^mem_[A-Za-z0-9]{1,64}$' then raise exception 'Membership reference is invalid' using errcode = '22023'; end if;
  if p_payment is null or jsonb_typeof(p_payment) <> 'object' or octet_length(p_payment::text) > 4096 then raise exception 'Invalid evidence' using errcode = '22023'; end if;
  -- Same lock order as plan observations and allocations: membership, then wallet.
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:' || p_membership, 0));
  perform makeborne_private.lock_credit_wallet(p_user);
  select * into m from public.billing_memberships where membership_id = p_membership and user_id = p_user;
  if not found then raise exception 'Membership binding missing' using errcode = 'P0002'; end if;
  v_id := p_payment->>'id';
  if v_id is null or v_id !~ '^pay_[A-Za-z0-9]{1,64}$'
    or (p_payment->>'membershipId') is distinct from p_membership or (p_payment->>'planId') is distinct from m.plan_id
    or (p_payment->>'currency') is null or (p_payment->>'currency') !~ '^[a-z]{3}$'
    or (p_payment->>'billingReason') is null or length(p_payment->>'billingReason') not between 1 and 40
    or (p_payment->>'principalCents') is null or (p_payment->>'principalCents') !~ '^(0|[1-9][0-9]{0,12})$'
    or (p_payment->>'refundedPrincipalCents') is null or (p_payment->>'refundedPrincipalCents') !~ '^(0|[1-9][0-9]{0,12})$'
    or (p_payment->>'status') is null or (p_payment->>'status') not in ('paid','refunded','pending','failed')
    or (p_payment->>'dispute') is null or (p_payment->>'dispute') not in ('none','open','won','lost')
    or (p_payment->>'updatedAt') is null then raise exception 'Evidence does not match the membership' using errcode = 'PT409'; end if;
  v_status := p_payment->>'status'; v_dispute := p_payment->>'dispute'; v_currency := p_payment->>'currency'; v_reason := p_payment->>'billingReason';
  v_principal := (p_payment->>'principalCents')::bigint; v_refund := (p_payment->>'refundedPrincipalCents')::bigint;
  begin
    v_at := (p_payment->>'updatedAt')::timestamptz;
    v_paid := (p_payment->>'paidAt')::timestamptz;
  exception when others then raise exception 'Invalid evidence time' using errcode = '22023';
  end;
  if not isfinite(v_at) or v_at > clock_timestamp() + interval '5 minutes' or v_refund > v_principal
    or (v_status = 'refunded' and v_refund <> v_principal) or (v_status in ('pending','failed') and v_refund <> 0)
    or (v_status in ('paid','refunded') and (v_paid is null or not isfinite(v_paid) or v_paid > clock_timestamp() + interval '5 minutes'))
    then raise exception 'Invalid amount or state' using errcode = '22023'; end if;
  if p_period_start is not null and (p_period_end is null or p_period_end <= p_period_start or p_period_end > p_period_start + interval '400 days') then
    raise exception 'Invalid period' using errcode = '22023'; end if;

  select * into pp from makeborne_private.plan_payments where payment_id = v_id for update;
  v_found := found;
  if v_found and (pp.user_id <> p_user or pp.membership_id <> p_membership) then raise exception 'Payment already bound' using errcode = 'PT409'; end if;
  -- Unpaid attempts fund nothing. A recorded payment cannot regress to unpaid.
  if v_status in ('pending','failed') then
    if not v_found then return jsonb_build_object('outcome', 'ignored_unpaid'); end if;
    if v_at > pp.observed_at then raise exception 'Funded payment regressed' using errcode = 'PT409'; end if;
    return jsonb_build_object('outcome', 'stale', 'state', pp.state);
  end if;
  v_evidence := jsonb_build_object('id', v_id, 'membershipId', p_membership, 'planId', m.plan_id, 'billingReason', v_reason, 'currency', v_currency,
    'principalCents', v_principal::text, 'refundedPrincipalCents', v_refund::text, 'status', v_status, 'dispute', v_dispute, 'paidAt', v_paid, 'updatedAt', v_at);
  if not v_found then
    v_outcome := 'recorded';
  elsif v_at < pp.observed_at then
    v_outcome := 'stale';
  elsif v_at = pp.observed_at then
    if v_evidence <> pp.evidence then raise exception 'Conflicting evidence timestamp' using errcode = 'PT409'; end if;
    v_outcome := 'duplicate';
  else
    if v_refund < pp.refunded_cents then raise exception 'Refund evidence regressed' using errcode = 'PT409'; end if;
    if v_principal <> pp.principal_cents or v_currency <> pp.currency or v_reason <> pp.billing_reason then
      raise exception 'Payment terms changed' using errcode = 'PT409'; end if;
    v_outcome := 'updated';
  end if;
  if v_outcome in ('recorded','updated') then
    v_next := case when (v_found and pp.state = 'reversed') or (v_refund = v_principal and v_principal > 0) or v_dispute = 'lost' then 'reversed'
      when v_refund > 0 or v_dispute = 'open' then 'held' else 'funded' end;
    if v_found then
      update makeborne_private.plan_payments set refunded_cents = v_refund, dispute = v_dispute, state = v_next, evidence = v_evidence,
        observed_at = v_at, revision = revision + 1, updated_at = now() where payment_id = v_id returning revision into v_rev;
    else
      insert into makeborne_private.plan_payments(payment_id, user_id, membership_id, plan_id, billing_reason, currency, principal_cents,
        refunded_cents, dispute, paid_at, state, evidence, observed_at)
      values(v_id, p_user, p_membership, m.plan_id, v_reason, v_currency, v_principal, v_refund, v_dispute, v_paid, v_next, v_evidence, v_at);
      v_rev := 1;
    end if;
    insert into makeborne_private.plan_payment_observations(payment_id, revision, evidence, outcome, observed_at) values(v_id, v_rev, v_evidence, v_next, v_at);
  end if;

  perform makeborne_private.attribute_plan_payments(p_membership, v_id);
  -- A payment can arrive before its period is recorded. The live membership's
  -- current period (same provider read) attributes it when nothing else claims it.
  select * into pp from makeborne_private.plan_payments where payment_id = v_id for update;
  if pp.attribution = 'pending' and p_period_start is not null and pp.billing_reason in ('subscription_create','subscription_cycle')
    and pp.paid_at >= p_period_start - interval '1 day' and pp.paid_at < p_period_end
    and not exists(select 1 from makeborne_private.plan_payments x where x.membership_id = p_membership and x.attribution = 'period' and x.period_start = p_period_start)
    and not exists(select 1 from makeborne_private.plan_periods p where p.membership_id = p_membership and p.period_start <> p_period_start
      and p.period_start < p_period_end and p.period_end > p_period_start) then
    update makeborne_private.plan_payments set attribution = 'period', period_start = p_period_start, period_end = p_period_end, updated_at = now()
    where payment_id = v_id;
    perform makeborne_private.attribute_plan_payments(p_membership, v_id);
  end if;
  v_effect := makeborne_private.apply_plan_payment_state(v_id);
  perform makeborne_private.refresh_wallet_cache(p_user);
  select * into pp from makeborne_private.plan_payments where payment_id = v_id;
  return jsonb_build_object('outcome', v_outcome, 'state', pp.state, 'attribution', pp.attribution, 'periodStart', pp.period_start,
      'periodEnd', pp.period_end, 'consumedExposureCredits', pp.consumed_exposure_credits,
      'revoked', exists(select 1 from makeborne_private.membership_revocations r where r.payment_id = v_id and r.lifted_at is null),
      'needsReview', pp.state = 'held' or (pp.state = 'reversed' and (pp.consumed_exposure_credits > 0 or pp.attribution <> 'period')))
    || v_effect;
end $$;
comment on function public.makeborne_reconcile_plan_payment(uuid, text, jsonb, timestamptz, timestamptz) is
  'Service role only. Records freshly retrieved subscription payment evidence and converges plan credits and creation access on it.';

create function public.makeborne_membership_access_revoked(p_membership text) returns boolean
language sql stable security definer set search_path = '' as $$
  select makeborne_private.membership_access_revoked(p_membership, now());
$$;

-- ---------------------------------------------------------------------------
-- Redefined: creation access excludes revoked periods
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.has_creation_membership_for_actor(p_actor uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
 select p_actor is not null and (makeborne_private.has_account_privilege(p_actor,'admin')
 or (coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
   and exists(select 1 from public.billing_memberships m
     join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
     where m.user_id=p_actor and m.status in ('active','canceling')
       and m.period_end>now() and m.verified_until>now()
       and not makeborne_private.membership_access_revoked(m.membership_id, now()))));
$function$;

-- ---------------------------------------------------------------------------
-- Redefined: plan allocations respect payment state and record their funding
-- (body unchanged except the marked additions)
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.credit_grant_plan_allocation(p_user uuid, p_membership text, p_month_start timestamp with time zone, p_month_end timestamp with time zone, p_tier text, p_target bigint, p_legacy_reference text, p_metadata jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
 set "TimeZone" to 'UTC'
as $function$
declare w makeborne_private.credit_wallets%rowtype; prefix text; already bigint; amount bigint; conflict_reference text;
  v_period timestamptz; v_funding makeborne_private.plan_payments%rowtype; v_result jsonb;
begin
  if p_membership is null or p_membership !~ '^mem_[A-Za-z0-9]{1,64}$' then raise exception 'Membership reference is invalid' using errcode='22023'; end if;
  if p_month_start is null or p_month_end is null or p_month_end <= p_month_start then raise exception 'Allocation window is required' using errcode='22023'; end if;
  if p_tier is null or p_tier not in ('create','studio','scale') then raise exception 'Unknown plan tier' using errcode='22023'; end if;
  if p_target is null or p_target not between 1 and 100000 then raise exception 'Monthly credits out of range' using errcode='22023'; end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  prefix := 'plan:'||p_membership||':'||to_char(p_month_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':';
  select coalesce(sum(delta),0) into already from public.credit_ledger
  where user_id = p_user and kind = 'plan_grant' and (left(reference, length(prefix)) = prefix or reference = p_legacy_reference);
  amount := p_target - already;
  if amount <= 0 then
    return makeborne_private.credit_state(w) || jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already);
  end if;
  -- Added: a refunded/charged-back period, or one whose payment is under review or
  -- has an open support refund, receives no further allocations.
  perform makeborne_private.attribute_plan_payments(p_membership);
  if makeborne_private.membership_access_revoked(p_membership, p_month_start) then
    return makeborne_private.credit_state(w)||jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already,'blocked','refunded');
  end if;
  v_period := makeborne_private.lot_period_start(p_metadata);
  select * into v_funding from makeborne_private.plan_payments where membership_id = p_membership and attribution = 'period' and period_start = v_period;
  if found and (v_funding.state <> 'funded' or exists(select 1 from makeborne_private.refund_cases c where c.payment_id = v_funding.payment_id and c.state = 'pending')) then
    return makeborne_private.credit_state(w)||jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already,'blocked','payment_review');
  end if;
  conflict_reference:=makeborne_private.plan_allocation_conflict(p_user,p_membership,p_month_start,p_month_end);
  if conflict_reference is not null then
    insert into makeborne_private.plan_credit_issues(membership_id,user_id,allocation_start,kind,detail)
    values(p_membership,p_user,p_month_start,'account_overlap',jsonb_build_object('allocationStart',p_month_start,'allocationEnd',p_month_end,'conflictingGrant',conflict_reference))
    on conflict(membership_id,allocation_start,kind) do update set last_seen_at=now(),resolved_at=null,resolution=null;
    return makeborne_private.credit_state(w)||jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already,'blocked','account_overlap');
  end if;
  v_result := makeborne_private.credit_grant(p_user,amount,'plan_grant',prefix||p_tier,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('monthlyCredits',p_target,'alreadyGranted',already,'allocationStart',p_month_start,'allocationEnd',p_month_end,'rolloverExtendedAt',now(),'expiresAt',p_month_end + makeborne_private.plan_credit_rollover()))
    || jsonb_build_object('alreadyGranted',already);
  -- Added: record the payment that funds this period's credits.
  if v_funding.payment_id is not null and coalesce((v_result->>'granted')::boolean, false) then
    update makeborne_private.credit_lots set funding_payment_id = v_funding.payment_id where id = (v_result->>'lot')::bigint and funding_payment_id is null;
  end if;
  return v_result;
end $function$;

-- ---------------------------------------------------------------------------
-- Support refund workflow (administrators; the app passes the verified actor)
-- ---------------------------------------------------------------------------
create function makeborne_private.payment_refund_snapshot(p_payment text) returns jsonb
language plpgsql stable security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare pp makeborne_private.plan_payments%rowtype; o makeborne_private.topup_orders%rowtype;
  v_kind text; v_user uuid; v_state text; v_principal bigint; v_refunded bigint; v_dispute text; v_attr text; v_currency text;
  v_lots jsonb; v_lot_count integer; v_spent bigint; v_free bigint; v_live integer; v_withheld bigint; v_case jsonb; v_decision text;
  v_at timestamptz := makeborne_private.credit_clock();
begin
  if p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]{1,64}$' then raise exception 'Payment reference is invalid' using errcode = '22023'; end if;
  select * into pp from makeborne_private.plan_payments where payment_id = p_payment;
  if found then
    v_kind := 'subscription'; v_user := pp.user_id; v_state := pp.state; v_principal := pp.principal_cents; v_refunded := pp.refunded_cents;
    v_dispute := pp.dispute; v_attr := pp.attribution; v_currency := pp.currency;
  else
    select * into o from makeborne_private.topup_orders where payment_id = p_payment;
    if not found then return jsonb_build_object('payment', p_payment, 'decision', 'unknown_payment'); end if;
    v_kind := 'credit_pack'; v_user := o.user_id; v_state := o.state; v_principal := o.price_cents; v_currency := 'usd';
    v_refunded := coalesce((o.evidence->>'refundedPrincipalCents')::bigint, 0); v_dispute := coalesce(o.evidence->>'dispute', 'none');
    v_attr := case when o.lot_id is null then 'none' else 'order' end;
  end if;
  select count(*), coalesce(sum(l.spent), 0), coalesce(sum(makeborne_private.lot_free(l, v_at)), 0),
    coalesce(jsonb_agg(jsonb_build_object('lot', l.id, 'source', l.source, 'amount', l.amount, 'spent', l.spent, 'held', l.held, 'lapsed', l.lapsed,
      'expiresAt', l.expires_at, 'createdAt', l.created_at) order by l.id), '[]'::jsonb)
  into v_lot_count, v_spent, v_free, v_lots
  from makeborne_private.credit_lots l where l.user_id = v_user and l.funding_payment_id = p_payment;
  -- Live holds block a decision; a timed-out hold is released at the next wallet lock and is not consumption.
  select count(distinct r.reference) into v_live from makeborne_private.credit_reservations r
    join makeborne_private.credit_hold_lots hl on hl.user_id = r.user_id and hl.reference = r.reference
    join makeborne_private.credit_lots l on l.id = hl.lot_id
  where r.user_id = v_user and r.status = 'reserved' and r.created_at >= v_at - interval '15 minutes' and l.funding_payment_id = p_payment;
  select coalesce(sum(credits), 0) into v_withheld from makeborne_private.credit_lot_withholds where payment_id = p_payment and restored_at is null;
  select jsonb_build_object('id', c.id, 'state', c.state, 'reason', c.reason, 'withheldCredits', c.withheld_credits, 'openedBy', c.opened_by,
      'openedAt', c.opened_at, 'closedBy', c.closed_by, 'closedAt', c.closed_at, 'closeReason', c.close_reason)
  into v_case from makeborne_private.refund_cases c where c.payment_id = p_payment order by c.id desc limit 1;
  v_decision := case
    when v_state = 'reversed' then 'already_refunded'
    when coalesce(v_case->>'state', '') = 'pending' then 'refund_in_progress'
    when v_state = 'held' then 'held_for_review'
    when v_kind = 'subscription' and v_attr <> 'period' then 'manual_review_unattributed'
    when v_state <> 'funded' then 'not_paid'
    when v_principal = 0 then 'nothing_to_refund'
    when v_lot_count = 0 then 'manual_review_no_credits'
    when v_spent > 0 then 'not_eligible_used'
    when v_live > 0 then 'blocked_active_hold'
    else 'eligible' end;
  return jsonb_build_object('payment', p_payment, 'kind', v_kind, 'userId', v_user, 'decision', v_decision,
    'provider', jsonb_build_object('state', v_state, 'principalCents', v_principal, 'refundedCents', v_refunded, 'currency', v_currency, 'dispute', v_dispute),
    'subscription', case when v_kind = 'subscription' then jsonb_build_object('membershipId', pp.membership_id, 'billingReason', pp.billing_reason,
      'paidAt', pp.paid_at, 'attribution', pp.attribution, 'periodStart', pp.period_start, 'periodEnd', pp.period_end,
      'consumedExposureCredits', pp.consumed_exposure_credits,
      'revoked', exists(select 1 from makeborne_private.membership_revocations r where r.payment_id = p_payment and r.lifted_at is null)) end,
    'creditPack', case when v_kind = 'credit_pack' then jsonb_build_object('orderId', o.id, 'packId', o.pack_id, 'credits', o.credits,
      'withheldCredits', o.withheld_credits, 'consumedExposureCredits', o.consumed_exposure_credits) end,
    'credits', jsonb_build_object('lots', v_lots, 'spent', v_spent, 'unused', v_free, 'withheld', v_withheld, 'activeHolds', v_live),
    'usage', coalesce((select jsonb_agg(s.u order by s.created_at desc) from (
        select jsonb_build_object('reference', r.reference, 'status', r.status, 'lot', hl.lot_id, 'held', hl.amount, 'charged', hl.charged,
          'returned', hl.returned, 'createdAt', r.created_at, 'resolvedAt', r.resolved_at) as u, r.created_at
        from makeborne_private.credit_hold_lots hl join makeborne_private.credit_reservations r on r.user_id = hl.user_id and r.reference = hl.reference
        join makeborne_private.credit_lots l on l.id = hl.lot_id
        where l.user_id = v_user and l.funding_payment_id = p_payment order by r.created_at desc limit 50) s), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(s.x order by s.created_at) from (
        select jsonb_build_object('kind', e.kind, 'delta', e.delta, 'reference', e.reference, 'balanceAfter', e.balance_after, 'createdAt', e.created_at) as x, e.created_at
        from public.credit_ledger e where e.user_id = v_user and (
          e.reference in (select l.reference from makeborne_private.credit_lots l where l.user_id = v_user and l.funding_payment_id = p_payment)
          or left(e.reference, length('payment:' || p_payment || ':')) = 'payment:' || p_payment || ':'
          or left(e.reference, length('credit_topup:' || p_payment || ':')) = 'credit_topup:' || p_payment || ':')
        order by e.created_at limit 50) s), '[]'::jsonb),
    'refundCase', v_case,
    'spendOrder', 'Credits expiring soonest are used first; then plan, trial, pack, adjustment and refund credits; then the oldest lot.');
end $$;

create function public.makeborne_support_payment_refund_check(p_actor uuid, p_payment text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform makeborne_private.require_admin(p_actor);
  return makeborne_private.payment_refund_snapshot(p_payment);
end $$;

create function public.makeborne_support_payment_refund_begin(p_actor uuid, p_payment text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare v_user uuid; v_kind text; v_snapshot jsonb; v_case bigint; v_withheld bigint;
begin
  perform makeborne_private.require_admin(p_actor);
  if p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]{1,64}$' then raise exception 'Payment reference is invalid' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'A refund reason is required (5-500 characters)' using errcode = '22023'; end if;
  select user_id, 'subscription' into v_user, v_kind from makeborne_private.plan_payments where payment_id = p_payment;
  if v_user is null then select user_id, 'credit_pack' into v_user, v_kind from makeborne_private.topup_orders where payment_id = p_payment; end if;
  if v_user is null then return jsonb_build_object('payment', p_payment, 'decision', 'unknown_payment', 'began', false); end if;
  -- The wallet lock serializes this decision with every reserve, settle and grant,
  -- and releases timed-out holds first: nothing can be spent between check and withhold.
  perform makeborne_private.lock_credit_wallet(v_user);
  v_snapshot := makeborne_private.payment_refund_snapshot(p_payment);
  if v_snapshot->>'decision' <> 'eligible' then return v_snapshot || jsonb_build_object('began', false); end if;
  insert into makeborne_private.refund_cases(payment_id, user_id, payment_kind, reason, opened_by)
  values(p_payment, v_user, v_kind, btrim(p_reason), p_actor) returning id into v_case;
  v_withheld := makeborne_private.withhold_payment_lots(v_user, p_payment, 'refund_review', v_case);
  update makeborne_private.refund_cases set withheld_credits = v_withheld where id = v_case;
  perform makeborne_private.refresh_wallet_cache(v_user);
  return makeborne_private.payment_refund_snapshot(p_payment) || jsonb_build_object('began', true, 'withheldCredits', v_withheld);
end $$;

create function public.makeborne_support_payment_refund_cancel(p_actor uuid, p_payment text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare c makeborne_private.refund_cases%rowtype; v_state text; v_refunded bigint; v_restored bigint;
begin
  perform makeborne_private.require_admin(p_actor);
  if p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]{1,64}$' then raise exception 'Payment reference is invalid' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'A cancellation reason is required (5-500 characters)' using errcode = '22023'; end if;
  select * into c from makeborne_private.refund_cases where payment_id = p_payment and state = 'pending';
  if not found then return jsonb_build_object('payment', p_payment, 'decision', 'no_open_case', 'canceled', false); end if;
  perform makeborne_private.lock_credit_wallet(c.user_id);
  select * into c from makeborne_private.refund_cases where id = c.id for update;
  if c.state <> 'pending' then return makeborne_private.payment_refund_snapshot(p_payment) || jsonb_build_object('canceled', false); end if;
  if c.payment_kind = 'subscription' then
    select state, refunded_cents into v_state, v_refunded from makeborne_private.plan_payments where payment_id = p_payment;
  else
    select state, coalesce((evidence->>'refundedPrincipalCents')::bigint, 0) into v_state, v_refunded from makeborne_private.topup_orders where payment_id = p_payment;
  end if;
  -- Once the provider shows any refund, the credits stay withheld.
  if v_state is distinct from 'funded' or v_refunded <> 0 then
    return makeborne_private.payment_refund_snapshot(p_payment) || jsonb_build_object('canceled', false, 'blocked', 'provider_refunded');
  end if;
  v_restored := makeborne_private.restore_payment_lots(c.user_id, p_payment, array['refund_review'], 'Refund request canceled: ' || left(btrim(p_reason), 150));
  update makeborne_private.refund_cases set state = 'canceled', closed_by = p_actor, closed_at = now(), close_reason = btrim(p_reason) where id = c.id;
  perform makeborne_private.refresh_wallet_cache(c.user_id);
  return makeborne_private.payment_refund_snapshot(p_payment) || jsonb_build_object('canceled', true, 'restoredCredits', v_restored);
end $$;

-- Payments, refund decisions and revocations for one customer (admin console).
create function public.makeborne_admin_user_payments(p_actor uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform makeborne_private.require_admin(p_actor);
  return jsonb_build_object(
    'subscriptionPayments', coalesce((select jsonb_agg(makeborne_private.payment_refund_snapshot(p.payment_id) - 'usage' - 'ledger' order by p.paid_at desc)
      from (select payment_id, paid_at from makeborne_private.plan_payments where user_id = p_user order by paid_at desc limit 24) p), '[]'::jsonb),
    'creditPackPayments', coalesce((select jsonb_agg(makeborne_private.payment_refund_snapshot(o.payment_id) - 'usage' - 'ledger' order by o.created_at desc)
      from (select payment_id, created_at from makeborne_private.topup_orders where user_id = p_user and payment_id is not null order by created_at desc limit 24) o), '[]'::jsonb),
    'revocations', coalesce((select jsonb_agg(jsonb_build_object('payment', payment_id, 'membershipId', membership_id, 'periodStart', period_start,
      'periodEnd', period_end, 'reason', reason, 'revokedAt', revoked_at, 'liftedAt', lifted_at) order by revoked_at desc)
      from makeborne_private.membership_revocations where user_id = p_user), '[]'::jsonb));
end $$;

-- Customer view: is the current billing period of the account's membership revoked?
create function public.makeborne_account_revoked_period(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('periodStart', r.period_start, 'periodEnd', greatest(r.period_end, coalesce(p.period_end, r.period_end)), 'reason', r.reason)
    from makeborne_private.membership_revocations r
    left join makeborne_private.plan_periods p on p.membership_id = r.membership_id and p.period_start = r.period_start
    where r.user_id = p_user and r.lifted_at is null and now() >= r.period_start and now() < greatest(r.period_end, coalesce(p.period_end, r.period_end))
    order by r.period_start desc limit 1);
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role reaches public entry points only; helpers are owner-only.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.makeborne_reconcile_plan_payment(uuid,text,jsonb,timestamptz,timestamptz)', 'public.makeborne_membership_access_revoked(text)',
    'public.makeborne_support_payment_refund_check(uuid,text)', 'public.makeborne_support_payment_refund_begin(uuid,text,text)',
    'public.makeborne_support_payment_refund_cancel(uuid,text,text)', 'public.makeborne_admin_user_payments(uuid,uuid)',
    'public.makeborne_account_revoked_period(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'makeborne_private.guard_lot_funding()', 'makeborne_private.topup_order_effects()', 'makeborne_private.lot_period_start(jsonb)',
    'makeborne_private.membership_access_revoked(text,timestamptz)', 'makeborne_private.release_payment_holds(uuid,text,text)',
    'makeborne_private.withhold_payment_lots(uuid,text,text,bigint)', 'makeborne_private.restore_payment_lots(uuid,text,text[],text)',
    'makeborne_private.attribute_plan_payments(text,text)', 'makeborne_private.apply_plan_payment_state(text)',
    'makeborne_private.payment_refund_snapshot(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

commit;
