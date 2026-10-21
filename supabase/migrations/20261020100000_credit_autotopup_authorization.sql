-- Automatic 100-credit top-ups: customer authorization and charge-safety rules
-- only. Charging is OFF and not implemented: nothing here calls Whop, creates a
-- payment or grants credits. No account is authorized by this migration and no
-- default authorizes anyone; each customer must give explicit, versioned consent.
--
-- * autotopup_settings: global kill switch (charging_enabled, false), terms
--   version, pack size (100 credits) and price. The price is NULL: the owner has
--   not chosen one, and authorization is refused until a price is set.
-- * autotopup_authorizations: one active authorization per account, a snapshot
--   of exactly what the customer agreed to (credits, price, threshold, monthly
--   and daily limits, terms version, SHA-256 of the consent text shown). Any change of
--   price, pack or terms requires a new authorization before a charge.
-- * autotopup_attempts: idempotent attempt records (one open attempt per
--   account, unique provider idempotency key and payment) for a future executor.
-- * makeborne_autotopup_plan_charge: the decision a future executor must obtain
--   under the wallet lock, immediately before submitting a charge: kill switch,
--   authorization, re-consent on change, active creation subscription, threshold
--   on authoritative available credits (live holds, expired and withheld/refunded
--   credits excluded; released holds count as available), one attempt in flight,
--   cooldown, daily and calendar-month limits, and suspension after two
--   consecutive failures. It records a planned attempt; it does not charge.
begin;

create table makeborne_private.autotopup_settings(
  singleton boolean primary key default true check (singleton),
  charging_enabled boolean not null default false,
  terms_version text not null default 'autotopup-2026-10-20-v1' check (length(terms_version) between 1 and 80),
  credits bigint not null default 100 check (credits = 100),
  price_cents bigint check (price_cents is null or price_cents between 100 and 100000),
  max_monthly_charges integer not null default 4 check (max_monthly_charges between 1 and 10),
  max_daily_charges integer not null default 2 check (max_daily_charges between 1 and 10),
  cooldown_seconds integer not null default 600 check (cooldown_seconds between 60 and 86400),
  allowed_thresholds integer[] not null default '{25,50,100}' check (cardinality(allowed_thresholds) between 1 and 6),
  updated_at timestamptz not null default now()
);
insert into makeborne_private.autotopup_settings default values;
comment on table makeborne_private.autotopup_settings is
  'Automatic top-up switch and offer. charging_enabled stays false until separate owner activation; price_cents is NULL until the owner decides.';

create table makeborne_private.autotopup_authorizations(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null check (length(terms_version) between 1 and 80),
  credits bigint not null check (credits = 100),
  price_cents bigint not null check (price_cents between 100 and 100000),
  threshold_credits integer not null check (threshold_credits between 1 and 1000),
  monthly_limit_charges integer not null check (monthly_limit_charges between 1 and 10),
  daily_limit_charges integer not null check (daily_limit_charges between 1 and 10),
  consent_sha256 text not null check (consent_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or length(btrim(revoke_reason)) between 3 and 200),
  check ((revoked_at is null) = (revoke_reason is null))
);
create unique index autotopup_one_active on makeborne_private.autotopup_authorizations(user_id) where revoked_at is null;

create table makeborne_private.autotopup_attempts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  authorization_id bigint not null references makeborne_private.autotopup_authorizations(id),
  idempotency_key text not null unique check (idempotency_key ~ '^autotopup_[0-9a-f]{32}$'),
  state text not null default 'planned' check (state in ('planned','submitted','requires_action','succeeded','failed','canceled')),
  credits bigint not null check (credits = 100),
  price_cents bigint not null check (price_cents between 100 and 100000),
  available_at_plan bigint not null,
  provider_payment_id text unique check (provider_payment_id is null or provider_payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((state in ('succeeded','failed','canceled')) = (resolved_at is not null))
);
create unique index autotopup_one_open on makeborne_private.autotopup_attempts(user_id) where state in ('planned','submitted','requires_action');
create index autotopup_attempts_user on makeborne_private.autotopup_attempts(user_id, created_at desc);

revoke all on makeborne_private.autotopup_settings, makeborne_private.autotopup_authorizations, makeborne_private.autotopup_attempts
  from public, anon, authenticated, service_role;

-- Offer and the account's current authorization (app server reads with the service role).
create function public.makeborne_autotopup_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'offer', (select jsonb_build_object('chargingEnabled', s.charging_enabled, 'termsVersion', s.terms_version, 'credits', s.credits,
      'priceCents', s.price_cents, 'maxMonthlyCharges', s.max_monthly_charges, 'maxDailyCharges', s.max_daily_charges, 'thresholds', to_jsonb(s.allowed_thresholds))
      from makeborne_private.autotopup_settings s where s.singleton),
    'authorization', (select jsonb_build_object('id', a.id, 'termsVersion', a.terms_version, 'credits', a.credits, 'priceCents', a.price_cents,
      'thresholdCredits', a.threshold_credits, 'monthlyLimitCharges', a.monthly_limit_charges, 'dailyLimitCharges', a.daily_limit_charges, 'authorizedAt', a.authorized_at)
      from makeborne_private.autotopup_authorizations a where a.user_id = p_user and a.revoked_at is null),
    'attempts', coalesce((select jsonb_agg(x) from (select jsonb_build_object('state', t.state, 'credits', t.credits, 'priceCents', t.price_cents,
      'createdAt', t.created_at, 'resolvedAt', t.resolved_at, 'failureCode', t.failure_code) x
      from makeborne_private.autotopup_attempts t where t.user_id = p_user order by t.created_at desc limit 10) q), '[]'::jsonb));
$$;

-- Explicit, versioned consent to the exact offer shown. Never charges.
create function public.makeborne_autotopup_authorize(p_user uuid, p_terms_version text, p_price_cents bigint, p_threshold integer,
  p_monthly_limit integer, p_consent_sha256 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s makeborne_private.autotopup_settings%rowtype; v_id bigint;
begin
  if p_user is null or not exists(select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false) and u.deleted_at is null) then
    raise exception 'A confirmed account is required' using errcode = '42501'; end if;
  select * into s from makeborne_private.autotopup_settings where singleton;
  if s.price_cents is null then raise exception 'Automatic top-ups have no approved price' using errcode = 'PT503'; end if;
  -- The customer must have seen exactly the current offer.
  if p_terms_version is distinct from s.terms_version or p_price_cents is distinct from s.price_cents then
    raise exception 'The offer changed; review it again' using errcode = 'PT409'; end if;
  if p_threshold is null or not (p_threshold = any(s.allowed_thresholds)) then raise exception 'Unsupported threshold' using errcode = '22023'; end if;
  if p_monthly_limit is null or p_monthly_limit not between 1 and s.max_monthly_charges then raise exception 'Unsupported monthly limit' using errcode = '22023'; end if;
  if p_consent_sha256 is null or p_consent_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Consent record missing' using errcode = '22023'; end if;
  -- Same lock as charge decisions: a decision sees either the old or the new authorization.
  perform makeborne_private.lock_credit_wallet(p_user);
  update makeborne_private.autotopup_authorizations set revoked_at = now(), revoke_reason = 'Replaced by a new authorization'
  where user_id = p_user and revoked_at is null;
  insert into makeborne_private.autotopup_authorizations(user_id, terms_version, credits, price_cents, threshold_credits, monthly_limit_charges, daily_limit_charges, consent_sha256)
  values(p_user, s.terms_version, s.credits, s.price_cents, p_threshold, p_monthly_limit, s.max_daily_charges, p_consent_sha256) returning id into v_id;
  return public.makeborne_autotopup_status(p_user) || jsonb_build_object('authorized', true, 'authorizationId', v_id);
end $$;

create function public.makeborne_autotopup_revoke(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_revoked integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 200 then raise exception 'A reason is required' using errcode = '22023'; end if;
  perform makeborne_private.lock_credit_wallet(p_user);
  update makeborne_private.autotopup_authorizations set revoked_at = now(), revoke_reason = btrim(p_reason) where user_id = p_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  -- A planned attempt has not reached the provider; it is canceled with the authorization.
  update makeborne_private.autotopup_attempts set state = 'canceled', resolved_at = now(), failure_code = 'authorization_revoked'
  where user_id = p_user and state = 'planned';
  return public.makeborne_autotopup_status(p_user) || jsonb_build_object('revoked', v_revoked > 0);
end $$;

-- The only path to a charge, for a future executor. Records a planned attempt; never charges.
create function public.makeborne_autotopup_plan_charge(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' set "TimeZone" to 'UTC' as $$
declare s makeborne_private.autotopup_settings%rowtype; a makeborne_private.autotopup_authorizations%rowtype; v_available bigint;
  v_at timestamptz; v_key text; v_id uuid; v_month integer; v_day integer;
begin
  perform makeborne_private.lock_credit_wallet(p_user);
  v_at := makeborne_private.credit_clock();
  select * into s from makeborne_private.autotopup_settings where singleton;
  if not s.charging_enabled then return jsonb_build_object('decision', 'charging_disabled'); end if;
  select * into a from makeborne_private.autotopup_authorizations where user_id = p_user and revoked_at is null;
  if not found then return jsonb_build_object('decision', 'not_authorized'); end if;
  if a.terms_version <> s.terms_version or a.price_cents is distinct from s.price_cents or a.credits <> s.credits or a.daily_limit_charges > s.max_daily_charges then
    return jsonb_build_object('decision', 'reauthorization_required'); end if;
  if makeborne_private.has_unlimited_credits(p_user) then return jsonb_build_object('decision', 'not_needed'); end if;
  -- Top-ups add to a paid creation subscription; the free tier alone does not qualify.
  if not makeborne_private.has_creation_membership_for_actor(p_user) then return jsonb_build_object('decision', 'no_active_subscription'); end if;
  v_available := makeborne_private.credit_available(p_user);
  if v_available >= a.threshold_credits then return jsonb_build_object('decision', 'above_threshold', 'available', v_available); end if;
  if exists(select 1 from makeborne_private.autotopup_attempts where user_id = p_user and state in ('planned','submitted','requires_action')) then
    return jsonb_build_object('decision', 'attempt_in_progress'); end if;
  if exists(select 1 from makeborne_private.autotopup_attempts where user_id = p_user and created_at > v_at - make_interval(secs => s.cooldown_seconds)) then
    return jsonb_build_object('decision', 'cooldown'); end if;
  select count(*) into v_month from makeborne_private.autotopup_attempts
  where user_id = p_user and state not in ('failed','canceled') and created_at >= date_trunc('month', v_at);
  if v_month >= a.monthly_limit_charges then return jsonb_build_object('decision', 'monthly_limit', 'chargesThisMonth', v_month); end if;
  select count(*) into v_day from makeborne_private.autotopup_attempts
  where user_id = p_user and state not in ('failed','canceled') and created_at >= date_trunc('day', v_at);
  if v_day >= a.daily_limit_charges then return jsonb_build_object('decision', 'daily_limit', 'chargesToday', v_day); end if;
  -- Two failed charges in a row end the authorization; the customer must authorize again.
  if (select count(*) = 2 and bool_and(state = 'failed') from (select state from makeborne_private.autotopup_attempts
      where user_id = p_user and authorization_id = a.id and state in ('succeeded','failed') order by created_at desc limit 2) last_two) then
    update makeborne_private.autotopup_authorizations set revoked_at = now(), revoke_reason = 'Two automatic top-up payments failed' where id = a.id;
    return jsonb_build_object('decision', 'suspended_after_failures');
  end if;
  v_key := 'autotopup_' || replace(gen_random_uuid()::text, '-', '');
  insert into makeborne_private.autotopup_attempts(user_id, authorization_id, idempotency_key, credits, price_cents, available_at_plan)
  values(p_user, a.id, v_key, a.credits, a.price_cents, v_available) returning id into v_id;
  return jsonb_build_object('decision', 'charge', 'attemptId', v_id, 'idempotencyKey', v_key, 'credits', a.credits, 'priceCents', a.price_cents);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.makeborne_autotopup_status(uuid)', 'public.makeborne_autotopup_authorize(uuid,text,bigint,integer,integer,text)',
    'public.makeborne_autotopup_revoke(uuid,text)', 'public.makeborne_autotopup_plan_charge(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
