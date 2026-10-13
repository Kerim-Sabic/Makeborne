-- Credit lots: every credit has a traceable source and (for plan allocations)
-- an expiry. Replaces the single undifferentiated wallet balance.
--
-- * credit_lots: one row per grant. Plan allocations expire at their exact
--   allocation end (UTC instant; at that instant they are expired). Trial,
--   top-up, adjustment (goodwill, reason required), refund (existing kind,
--   unchanged) and legacy lots never expire.
-- * Spending order: soonest-expiring first; then non-expiring trial, top-up,
--   adjustment, refund, legacy (lot_spend_rank).
-- * Holds: credit_hold_lots records exactly which lots fund each reservation.
--   Settlement charges at most the reservation, from those lots; unspent
--   credits return to their own lot with their own expiry, so expired credits
--   never come back (they lapse, audited) and never become non-expiring.
-- * Hold timeout (15 minutes, unchanged): the next wallet write releases a
--   stale hold the same way; a later settle of that reference fails (PT409),
--   so a reclaimed hold can never also be spent.
-- * Late plan catch-up: an allocation whose end has passed is recorded (lot +
--   ledger, for audit) and lapses in the same transaction: never spendable.
-- * Existing balances migrate into one audited, non-expiring legacy lot per
--   wallet that funds its open holds; the migration aborts unless every
--   wallet's balance, reserved and available are unchanged.
-- * Ledger invariant kept: sum(delta) = available. Expiry of unheld credits is
--   an 'expire' row (negative); a held credit lapsing is an 'expire' row with
--   delta 0 (it already left "available" when reserved). Reads always exclude
--   expired lots; ledger rows for time-based expiry are written at the next
--   wallet write or by makeborne_credit_expire_due (reconciliation job).
begin;

alter table public.credit_ledger drop constraint credit_ledger_kind_check;
alter table public.credit_ledger add constraint credit_ledger_kind_check
  check (kind in ('trial','plan_grant','topup','reserve','settle','release','refund','adjust','expire'));

create table makeborne_private.credit_lots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('plan','trial','topup','adjust','refund','legacy')),
  reference text not null check (length(reference) between 1 and 200),
  amount bigint not null check (amount > 0),
  spent bigint not null default 0 check (spent >= 0),
  held bigint not null default 0 check (held >= 0),
  lapsed bigint not null default 0 check (lapsed >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  check (spent + held + lapsed <= amount),
  check ((source = 'plan') = (expires_at is not null)),
  unique (user_id, source, reference)
);
create index credit_lots_spendable on makeborne_private.credit_lots(user_id, expires_at);
alter table makeborne_private.credit_lots enable row level security;
revoke all on makeborne_private.credit_lots from public,anon,authenticated,service_role;

create table makeborne_private.credit_hold_lots (
  user_id uuid not null,
  reference text not null,
  lot_id bigint not null references makeborne_private.credit_lots(id) on delete cascade,
  amount bigint not null check (amount > 0),
  charged bigint check (charged >= 0),
  returned bigint check (returned >= 0),
  lapsed bigint check (lapsed >= 0),
  primary key (user_id, reference, lot_id),
  foreign key (user_id, reference) references makeborne_private.credit_reservations(user_id, reference) on delete cascade,
  check (coalesce(charged,0) + coalesce(returned,0) + coalesce(lapsed,0) <= amount)
);
alter table makeborne_private.credit_hold_lots enable row level security;
revoke all on makeborne_private.credit_hold_lots from public,anon,authenticated,service_role;

create table makeborne_private.credit_lot_migration (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_before bigint not null, reserved_before bigint not null, available_before bigint not null,
  balance_after bigint not null, reserved_after bigint not null, available_after bigint not null,
  legacy_lot_id bigint, holds_migrated integer not null, migrated_at timestamptz not null default now()
);
alter table makeborne_private.credit_lot_migration enable row level security;
revoke all on makeborne_private.credit_lot_migration from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function makeborne_private.lot_spend_rank(p_source text) returns integer
language sql immutable set search_path='' as $$
  select case p_source when 'plan' then 0 when 'trial' then 1 when 'topup' then 2 when 'adjust' then 3 when 'refund' then 4 else 5 end;
$$;

-- Credits a lot can still fund at p_at (0 once expired: expired AT expires_at).
create function makeborne_private.lot_free(l makeborne_private.credit_lots, p_at timestamptz) returns bigint
language sql immutable set search_path='' as $$
  select case when l.expires_at is not null and l.expires_at <= p_at then 0 else l.amount - l.spent - l.held - l.lapsed end;
$$;

-- Wallet totals at p_at. Holds older than 15 minutes belong to dead runs: their
-- credits count as available if their lot is still valid (released lazily).
create function makeborne_private.credit_totals(p_user uuid, p_at timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
  with live as (
    select h.lot_id, sum(h.amount) as amount from makeborne_private.credit_hold_lots h
    join makeborne_private.credit_reservations r on r.user_id = h.user_id and r.reference = h.reference
    where h.user_id = p_user and r.status = 'reserved' and r.created_at >= p_at - interval '15 minutes'
    group by h.lot_id
  ), stale as (
    select h.lot_id, sum(h.amount) as amount from makeborne_private.credit_hold_lots h
    join makeborne_private.credit_reservations r on r.user_id = h.user_id and r.reference = h.reference
    where h.user_id = p_user and r.status = 'reserved' and r.created_at < p_at - interval '15 minutes'
    group by h.lot_id
  ), lots as (
    select l.*, coalesce(live.amount,0) as live_held, coalesce(stale.amount,0) as stale_held,
      (l.expires_at is not null and l.expires_at <= p_at) as expired
    from makeborne_private.credit_lots l left join live on live.lot_id = l.id left join stale on stale.lot_id = l.id
    where l.user_id = p_user
  )
  select jsonb_build_object(
    'available', coalesce(sum(case when expired then 0 else amount - spent - lapsed - live_held end),0),
    'reserved', coalesce(sum(live_held),0),
    'balance', coalesce(sum(case when expired then live_held else amount - spent - lapsed end),0),
    'nextExpiry', (select jsonb_build_object('at', n.at, 'credits', n.credits) from (
        select expires_at as at, sum(amount - spent - lapsed - live_held) as credits from lots
        where not expired and expires_at is not null and amount - spent - lapsed - live_held > 0
        group by expires_at order by expires_at limit 1) n))
  from lots;
$$;
revoke all on function makeborne_private.credit_totals(uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function makeborne_private.credit_state(w makeborne_private.credit_wallets) returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_totals(w.user_id, now()) - 'nextExpiry';
$$;

create function makeborne_private.credit_available(p_user uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select (makeborne_private.credit_totals(p_user, now())->>'available')::bigint;
$$;

create function makeborne_private.refresh_wallet_cache(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare t jsonb := makeborne_private.credit_totals(p_user, now()); w makeborne_private.credit_wallets%rowtype;
begin
  update makeborne_private.credit_wallets set balance = (t->>'balance')::bigint, reserved = (t->>'reserved')::bigint, updated_at = now()
  where user_id = p_user returning * into w;
  return w;
end $$;

-- Records expiry of unheld credits in lots whose end has passed.
create function makeborne_private.expire_lots(p_user uuid, p_at timestamptz) returns integer
language plpgsql security definer set search_path='' as $$
declare l record; n integer := 0; free bigint;
begin
  for l in select * from makeborne_private.credit_lots where user_id = p_user and expires_at is not null and expires_at <= p_at
      and amount - spent - held - lapsed > 0 order by expires_at, id for update loop
    free := l.amount - l.spent - l.held - l.lapsed;
    update makeborne_private.credit_lots set lapsed = lapsed + free where id = l.id;
    insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
    values(p_user,-free,'expire','expire:lot:'||l.id||':'||(l.lapsed + free),greatest(makeborne_private.credit_available(p_user),0),
      jsonb_build_object('lot',l.id,'source',l.source,'expiredAt',l.expires_at,'credits',free));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Resolves an open hold: charge up to p_charge (never above the hold) from its
-- lots, soonest-expiring first; return the rest to each lot unless that lot has
-- expired, in which case it lapses. Writes ledger rows; returns a summary.
create function makeborne_private.resolve_hold(p_user uuid, p_reference text, p_charge bigint, p_kind text, p_at timestamptz, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r makeborne_private.credit_reservations%rowtype; h record; remaining bigint; c bigint; u bigint;
  v_charged bigint := 0; v_returned bigint := 0; v_lapsed bigint := 0; v_expired boolean;
begin
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference for update;
  remaining := least(greatest(p_charge,0), r.amount);
  for h in select hl.*, l.expires_at, l.source from makeborne_private.credit_hold_lots hl
      join makeborne_private.credit_lots l on l.id = hl.lot_id
      where hl.user_id = p_user and hl.reference = p_reference
      order by l.expires_at nulls last, makeborne_private.lot_spend_rank(l.source), l.id for update of hl loop
    c := least(remaining, h.amount); remaining := remaining - c; u := h.amount - c;
    v_expired := h.expires_at is not null and h.expires_at <= p_at;
    update makeborne_private.credit_lots set spent = spent + c, held = held - h.amount,
      lapsed = lapsed + case when v_expired then u else 0 end where id = h.lot_id;
    update makeborne_private.credit_hold_lots set charged = c, returned = case when v_expired then 0 else u end, lapsed = case when v_expired then u else 0 end
    where user_id = p_user and reference = p_reference and lot_id = h.lot_id;
    v_charged := v_charged + c;
    if v_expired then v_lapsed := v_lapsed + u; else v_returned := v_returned + u; end if;
  end loop;
  update makeborne_private.credit_reservations set status = case when p_kind = 'settle' then 'settled' else 'released' end,
    charged = case when p_kind = 'settle' then v_charged end, resolved_at = now()
  where user_id = p_user and reference = p_reference;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,v_returned,p_kind,p_reference,greatest(makeborne_private.credit_available(p_user),0),
    coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('held',r.amount,'charged',v_charged,'returned',v_returned,'lapsed',v_lapsed));
  if v_lapsed > 0 then
    insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
    values(p_user,0,'expire','hold:'||left(p_reference,190),greatest(makeborne_private.credit_available(p_user),0),
      jsonb_build_object('lapsedFromHold',v_lapsed,'reason','allocation expired while held'));
  end if;
  return jsonb_build_object('charged',v_charged,'returned',v_returned,'lapsed',v_lapsed);
end $$;

-- Lock order everywhere: wallet row, then lots/reservations. Creates the
-- wallet, records due expiries and releases holds from dead runs.
create or replace function makeborne_private.lock_credit_wallet(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; dead record;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then
    raise exception 'Account unavailable' using errcode='P0002';
  end if;
  insert into makeborne_private.credit_wallets(user_id) values(p_user) on conflict(user_id) do nothing;
  select * into w from makeborne_private.credit_wallets where user_id = p_user for update;
  for dead in select reference from makeborne_private.credit_reservations
      where user_id = p_user and status = 'reserved' and created_at < now() - interval '15 minutes' order by created_at loop
    perform makeborne_private.resolve_hold(p_user, dead.reference, 0, 'release', now(), jsonb_build_object('reason','hold timeout'));
  end loop;
  perform makeborne_private.expire_lots(p_user, now());
  return makeborne_private.refresh_wallet_cache(p_user);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.credit_grant(p_user uuid,p_amount bigint,p_kind text,p_reference text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; prior public.credit_ledger%rowtype; entry uuid; lot bigint;
  expires timestamptz; source text;
begin
  if p_kind is null or p_kind not in ('trial','plan_grant','topup','refund','adjust') then
    raise exception 'Unsupported grant kind' using errcode='22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Grant amount must be positive' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Grant reference required' using errcode='22023'; end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then raise exception 'Metadata must be an object' using errcode='22023'; end if;
  if p_kind = 'plan_grant' then
    begin expires := (p_metadata->>'expiresAt')::timestamptz; exception when others then expires := null; end;
    if expires is null then raise exception 'Plan credits need their allocation end (expiresAt)' using errcode='22023'; end if;
  end if;
  if p_kind = 'adjust' and length(trim(coalesce(p_metadata->>'reason',''))) < 5 then
    raise exception 'Adjustments need a reason (metadata.reason, 5+ characters)' using errcode='22023';
  end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into prior from public.credit_ledger where user_id = p_user and kind = p_kind and reference = p_reference;
  if found then
    return makeborne_private.credit_state(w) || jsonb_build_object('granted',false,'amount',prior.delta,'ledgerId',prior.id);
  end if;
  source := case p_kind when 'plan_grant' then 'plan' else p_kind end;
  insert into makeborne_private.credit_lots(user_id,source,reference,amount,expires_at,metadata)
  values(p_user,source,p_reference,p_amount,expires,coalesce(p_metadata,'{}'::jsonb)) returning id into lot;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,p_amount,p_kind,p_reference,makeborne_private.credit_available(p_user),
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('lot',lot,'expiresAt',expires))
  returning id into entry;
  -- An allocation whose end has passed is recorded for audit and lapses now.
  if expires is not null and expires <= now() then perform makeborne_private.expire_lots(p_user, now()); end if;
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('granted',true,'amount',p_amount,'ledgerId',entry,'lot',lot,'expiresAt',expires);
end $$;

-- One plan allocation (replaces credit_grant_plan_month): tops the month up to
-- its tier's credits; every grant for the month expires at the allocation end.
create function makeborne_private.credit_grant_plan_allocation(p_user uuid,p_membership text,p_month_start timestamptz,p_month_end timestamptz,
  p_tier text,p_target bigint,p_legacy_reference text,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; prefix text; already bigint; amount bigint;
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
  return makeborne_private.credit_grant(p_user,amount,'plan_grant',prefix||p_tier,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('monthlyCredits',p_target,'alreadyGranted',already,'expiresAt',p_month_end))
    || jsonb_build_object('alreadyGranted',already);
end $$;
revoke all on function makeborne_private.credit_grant_plan_allocation(uuid,text,timestamptz,timestamptz,text,bigint,text,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Reserve / settle / release
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.credit_reserve(p_user uuid,p_amount bigint,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype; l makeborne_private.credit_lots%rowtype;
  remaining bigint; take bigint; funding jsonb := '[]'::jsonb; available bigint;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Reservation amount must be positive' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  if makeborne_private.has_unlimited_credits(p_user) then
    return jsonb_build_object('unlimited',true,'amount',0,'status','waived','replayed',false);
  end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference;
  if found then
    return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',false,'amount',r.amount,'status',r.status,'replayed',true);
  end if;
  available := makeborne_private.credit_available(p_user);
  if available < p_amount then
    raise exception 'Insufficient credits' using errcode='MB402', detail=format('available=%s required=%s',available,p_amount);
  end if;
  insert into makeborne_private.credit_reservations(user_id,reference,amount) values(p_user,p_reference,p_amount);
  remaining := p_amount;
  for l in select * from makeborne_private.credit_lots where user_id = p_user
      and makeborne_private.lot_free(credit_lots, now()) > 0
      order by expires_at nulls last, makeborne_private.lot_spend_rank(source), id for update loop
    exit when remaining = 0;
    take := least(remaining, makeborne_private.lot_free(l, now()));
    update makeborne_private.credit_lots set held = held + take where id = l.id;
    insert into makeborne_private.credit_hold_lots(user_id,reference,lot_id,amount) values(p_user,p_reference,l.id,take);
    funding := funding || jsonb_build_array(jsonb_build_object('lot',l.id,'source',l.source,'credits',take,'expiresAt',l.expires_at));
    remaining := remaining - take;
  end loop;
  if remaining <> 0 then raise exception 'Credit lots out of balance' using errcode='XX000'; end if;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,-p_amount,'reserve',p_reference,makeborne_private.credit_available(p_user),jsonb_build_object('amount',p_amount,'lots',funding));
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',false,'amount',p_amount,'status','reserved','replayed',false);
end $$;

-- Charges actual usage from the hold's own lots, never above the reservation.
-- No reservation means nothing was authorised: nothing is charged.
create or replace function makeborne_private.credit_settle(p_user uuid,p_reference text,p_actual bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype; unlimited boolean; res jsonb;
begin
  if p_actual is null or p_actual < 0 or p_actual > 1000000000 then raise exception 'Actual credits must be non-negative' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  unlimited := makeborne_private.has_unlimited_credits(p_user);
  if unlimited and not exists(select 1 from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference and status = 'reserved') then
    return jsonb_build_object('unlimited',true,'charged',0,'replayed',false);
  end if;
  w := makeborne_private.lock_credit_wallet(p_user);   -- may release this hold if it timed out
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference for update;
  if not found then
    return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',unlimited,'charged',0,'replayed',false,'reason','no_reservation');
  end if;
  if r.status = 'settled' then
    return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',unlimited,'charged',r.charged,'replayed',true);
  end if;
  if r.status = 'released' then raise exception 'Reservation already released' using errcode='PT409'; end if;
  res := makeborne_private.resolve_hold(p_user, p_reference, case when unlimited then 0 else p_actual end, 'settle', now(),
    jsonb_build_object('actual',p_actual,'shortfall',greatest(p_actual - r.amount,0),'waived',unlimited));
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',unlimited,'charged',(res->>'charged')::bigint,
    'returned',(res->>'returned')::bigint,'lapsed',(res->>'lapsed')::bigint,'replayed',false);
end $$;

create or replace function makeborne_private.credit_release(p_user uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype; res jsonb;
begin
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference for update;
  if not found or r.status <> 'reserved' then
    return makeborne_private.credit_state(w) || jsonb_build_object('released',0,'replayed',true);
  end if;
  res := makeborne_private.resolve_hold(p_user, p_reference, 0, 'release', now(), '{}'::jsonb);
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('released',(res->>'returned')::bigint,'lapsed',(res->>'lapsed')::bigint,'replayed',false);
end $$;

-- ---------------------------------------------------------------------------
-- Reads (exact at read time, including expiry not yet written to the ledger)
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.credit_wallet(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_totals(p_user, now()) || jsonb_build_object('unlimited',makeborne_private.has_unlimited_credits(p_user));
$$;
revoke all on function makeborne_private.credit_wallet(uuid) from public,anon,authenticated;
grant execute on function makeborne_private.credit_wallet(uuid) to service_role;

create or replace function makeborne_private.my_credit_balance() returns jsonb
language sql stable security definer set search_path='' as $$
  select case when (select auth.role()) = 'authenticated' and auth.uid() is not null
    then makeborne_private.credit_totals(auth.uid(), now())
    else jsonb_build_object('balance',0,'reserved',0,'available',0,'nextExpiry',null) end;
$$;
revoke all on function makeborne_private.my_credit_balance() from public,anon,service_role;
grant execute on function makeborne_private.my_credit_balance() to authenticated;

-- Writes due expiry rows for every wallet (reconciliation job). Idempotent.
create function public.makeborne_credit_expire_due(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; wallets integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Limit out of range' using errcode='22023'; end if;
  for u in select distinct l.user_id from makeborne_private.credit_lots l
      where l.expires_at <= now() and l.amount - l.spent - l.held - l.lapsed > 0 limit p_limit loop
    perform makeborne_private.lock_credit_wallet(u);
    wallets := wallets + 1;
  end loop;
  for u in select distinct r.user_id from makeborne_private.credit_reservations r
      where r.status = 'reserved' and r.created_at < now() - interval '15 minutes' limit p_limit loop
    perform makeborne_private.lock_credit_wallet(u);
    wallets := wallets + 1;
  end loop;
  return jsonb_build_object('wallets',wallets);
end $$;
revoke all on function public.makeborne_credit_expire_due(integer) from public,anon,authenticated;
grant execute on function public.makeborne_credit_expire_due(integer) to service_role;

do $$ declare f text; begin
  foreach f in array array['makeborne_private.lot_spend_rank(text)','makeborne_private.lot_free(makeborne_private.credit_lots,timestamptz)',
    'makeborne_private.credit_state(makeborne_private.credit_wallets)','makeborne_private.credit_available(uuid)',
    'makeborne_private.refresh_wallet_cache(uuid)','makeborne_private.expire_lots(uuid,timestamptz)',
    'makeborne_private.resolve_hold(uuid,text,bigint,text,timestamptz,jsonb)','makeborne_private.lock_credit_wallet(uuid)',
    'makeborne_private.credit_grant(uuid,bigint,text,text,jsonb)','makeborne_private.credit_reserve(uuid,bigint,text)',
    'makeborne_private.credit_settle(uuid,text,bigint)','makeborne_private.credit_release(uuid,text)'] loop
    execute format('revoke all on function %s from public,anon,authenticated', f);
  end loop;
  -- The public wrappers (security invoker) still need these for the service role.
  foreach f in array array['makeborne_private.credit_grant(uuid,bigint,text,text,jsonb)','makeborne_private.credit_reserve(uuid,bigint,text)',
    'makeborne_private.credit_settle(uuid,text,bigint)','makeborne_private.credit_release(uuid,text)'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Migrate existing balances: one audited non-expiring legacy lot per wallet,
-- funding its open holds. Aborts unless every wallet reconciles exactly.
-- ---------------------------------------------------------------------------
create function makeborne_private.migrate_wallet_to_lots(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; held_total bigint; lot bigint; holds integer := 0; r record; v_after jsonb;
  stale_held bigint;
begin
  select * into w from makeborne_private.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'Wallet not found' using errcode='P0002'; end if;
  if exists(select 1 from makeborne_private.credit_lots where user_id = p_user) then raise exception 'Wallet already has lots' using errcode='MB409'; end if;
  select coalesce(sum(amount),0) into held_total from makeborne_private.credit_reservations where user_id = p_user and status = 'reserved';
  if held_total <> w.reserved then
    raise exception 'Wallet % reserved % does not match its open holds %', p_user, w.reserved, held_total using errcode='MB409';
  end if;
  if w.balance > 0 then
    insert into makeborne_private.credit_lots(user_id,source,reference,amount,held,metadata)
    values(p_user,'legacy','legacy:pre-lots',w.balance,w.reserved,
      jsonb_build_object('reason','Balance before credit lots; source not attributable','balanceBefore',w.balance,'reservedBefore',w.reserved))
    returning id into lot;
    for r in select reference, amount from makeborne_private.credit_reservations where user_id = p_user and status = 'reserved' loop
      insert into makeborne_private.credit_hold_lots(user_id,reference,lot_id,amount) values(p_user,r.reference,lot,r.amount);
      holds := holds + 1;
    end loop;
  end if;
  -- Compare like for like: the previous reads also treated holds older than
  -- 15 minutes as available.
  select coalesce(sum(amount),0) into stale_held from makeborne_private.credit_reservations
  where user_id = p_user and status = 'reserved' and created_at < now() - interval '15 minutes';
  v_after := makeborne_private.credit_totals(p_user, now());
  insert into makeborne_private.credit_lot_migration(user_id,balance_before,reserved_before,available_before,balance_after,reserved_after,available_after,legacy_lot_id,holds_migrated)
  values(p_user,w.balance,w.reserved - stale_held,w.balance - w.reserved + stale_held,(v_after->>'balance')::bigint,(v_after->>'reserved')::bigint,(v_after->>'available')::bigint,lot,holds);
  if (v_after->>'available')::bigint <> w.balance - w.reserved + stale_held or (v_after->>'reserved')::bigint <> w.reserved - stale_held
     or (v_after->>'balance')::bigint <> w.balance then
    raise exception 'Wallet % does not reconcile after migration: before balance %/reserved %, after %', p_user, w.balance, w.reserved, v_after using errcode='MB409';
  end if;
  return jsonb_build_object('user',p_user,'legacyLot',lot,'holds',holds) || v_after;
end $$;
revoke all on function makeborne_private.migrate_wallet_to_lots(uuid) from public,anon,authenticated,service_role;

do $$ declare u uuid; begin
  for u in select user_id from makeborne_private.credit_wallets order by user_id loop
    perform makeborne_private.migrate_wallet_to_lots(u);
  end loop;
end $$;

drop function if exists makeborne_private.stale_credit_holds(uuid);

-- ---------------------------------------------------------------------------
-- Plan reconcile now grants allocations with their expiry.
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.reconcile_plan_membership(p_membership text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare p record; k integer; months integer; a_start timestamptz; a_end timestamptz; base record; up record;
  tier text; target integer; result jsonb; granted integer := 0; owed integer := 0; skipped integer := 0; unresolved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('makeborne.plan:'||p_membership, 0));
  for p in select * from makeborne_private.plan_periods where membership_id = p_membership order by period_start loop
    months := case p.billing_interval when 'yearly' then 12 else 1 end;
    for k in 0..months-1 loop
      a_start := p.period_start + make_interval(months => k);
      exit when a_start >= p.period_end or a_start > p_now;
      a_end := case when k = months-1 then p.period_end else least(p.period_start + make_interval(months => k+1), p.period_end) end;
      -- An operator's "not owed" decision is final for this allocation.
      if exists(select 1 from makeborne_private.plan_credit_issues where membership_id = p_membership and allocation_start = a_start
          and resolution = 'manual:not_owed') then skipped := skipped + 1; continue; end if;
      -- Evidence in force at the allocation start, else the first evidence inside it.
      select o.* into base from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
        and o.observed_at <= a_start and (o.source <> 'manual' or o.observed_at = a_start)
      order by (o.source = 'manual') desc, o.observed_at desc, o.id desc limit 1;
      if not found then
        select o.* into base from makeborne_private.plan_observations o
        where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
          and o.source <> 'manual' and o.observed_at >= a_start and o.observed_at < a_end and o.observed_at <= p_now
        order by o.observed_at, o.id limit 1;
      end if;
      if base is null then
        -- No evidence for this month: keep it recoverable, never borrow a later tier.
        insert into makeborne_private.plan_credit_issues(membership_id,user_id,allocation_start,kind,detail)
        values(p_membership,p.user_id,a_start,'no_evidence',jsonb_build_object('allocation',k+1,'allocationEnd',a_end,'periodStart',p.period_start,'periodEnd',p.period_end))
        on conflict (membership_id,allocation_start,kind) do update set last_seen_at = now()
          where makeborne_private.plan_credit_issues.resolved_at is null;
        unresolved := unresolved + 1;
        continue;
      end if;
      update makeborne_private.plan_credit_issues set resolved_at = now(), resolution = 'evidence:'||base.source||':'||base.id
      where membership_id = p_membership and allocation_start = a_start and resolved_at is null;
      if not base.paid then skipped := skipped + 1; continue; end if;
      tier := base.tier; target := base.monthly_credits;
      select o.tier, o.monthly_credits into up from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome)
        and o.source <> 'manual' and o.paid and o.observed_at > a_start and o.observed_at < a_end and o.observed_at <= p_now
      order by o.monthly_credits desc, o.observed_at limit 1;
      if found and up.monthly_credits > target then tier := up.tier; target := up.monthly_credits; end if;
      owed := owed + 1;
      result := makeborne_private.credit_grant_plan_allocation(p.user_id, p_membership, a_start, a_end, tier, target,
        case when k = 0 then 'plan:'||p_membership||':'||to_char(p.period_end,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        jsonb_build_object('allocation',k+1,'allocationStart',a_start,'allocationEnd',a_end,'periodStart',p.period_start,
          'periodEnd',p.period_end,'interval',p.billing_interval,'tier',tier,'evidence',base.source,'source','reconcile'));
      if (result->>'granted')::boolean then granted := granted + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('owed',owed,'granted',granted,'notPaid',skipped,'unresolved',unresolved);
end $$;
revoke all on function makeborne_private.reconcile_plan_membership(text,timestamptz) from public,anon,authenticated,service_role;

-- The undated grant path is gone: every plan grant now carries its allocation end.
drop function public.makeborne_credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb);
drop function makeborne_private.credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb);

commit;
