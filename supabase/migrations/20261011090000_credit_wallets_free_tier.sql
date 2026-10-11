-- Per-user credit wallets and a free tier for confirmed accounts.
-- Workspace generation budgets (durable worker path) are unchanged; this wallet
-- is the customer's own spendable balance. All writes go through the service-only
-- functions below. Browser roles may read only their own ledger and balance.
begin;

alter table makeborne_private.billing_settings
  add column free_tier_enabled boolean not null default true,
  add column trial_credits integer not null default 150 check(trial_credits between 0 and 100000);

-- balance: credits owned, including amounts held by open reservations.
-- reserved: credits held for work in progress. available = balance - reserved.
create table makeborne_private.credit_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check(balance >= 0),
  reserved bigint not null default 0 check(reserved >= 0),
  updated_at timestamptz not null default now(),
  check(reserved <= balance)
);
alter table makeborne_private.credit_wallets enable row level security;
revoke all on makeborne_private.credit_wallets from public,anon,authenticated,service_role;
grant select on makeborne_private.credit_wallets to service_role;

-- One row per reservation reference; holds the amount a later settle/release resolves.
create table makeborne_private.credit_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null check(length(reference) between 1 and 200),
  amount bigint not null check(amount >= 0),
  status text not null default 'reserved' check(status in ('reserved','settled','released')),
  charged bigint check(charged >= 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(user_id,reference),
  check((status = 'reserved') = (resolved_at is null)),
  check((status = 'settled') = (charged is not null))
);
create index credit_reservations_open on makeborne_private.credit_reservations(user_id) where status = 'reserved';
alter table makeborne_private.credit_reservations enable row level security;
revoke all on makeborne_private.credit_reservations from public,anon,authenticated,service_role;
grant select on makeborne_private.credit_reservations to service_role;

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta bigint not null,
  kind text not null check(kind in ('trial','plan_grant','topup','reserve','settle','release','refund','adjust')),
  reference text not null check(length(reference) between 1 and 200),
  balance_after bigint not null check(balance_after >= 0),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  created_at timestamptz not null default now(),
  unique(user_id,kind,reference)
);
comment on column public.credit_ledger.delta is 'Change in available credits (balance - reserved). The sum of a user''s deltas equals their available credits.';
comment on column public.credit_ledger.balance_after is 'Available credits (balance - reserved) after this entry.';
create index credit_ledger_user_recent on public.credit_ledger(user_id,created_at desc);
alter table public.credit_ledger enable row level security;
revoke all on public.credit_ledger from public,anon,authenticated,service_role;
grant select on public.credit_ledger to authenticated,service_role;
create policy credit_ledger_own_read on public.credit_ledger for select to authenticated
  using(user_id = (select auth.uid()));

-- Free tier: any confirmed, non-anonymous, active account while the switch is on.
create function makeborne_private.has_free_tier_access(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user is not null
    and coalesce((select free_tier_enabled from makeborne_private.billing_settings where singleton),false)
    and exists(select 1 from auth.users u where u.id = p_user and u.email is not null
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now()));
$$;
revoke all on function makeborne_private.has_free_tier_access(uuid) from public,anon,authenticated,service_role;

-- Browser/RLS creation gate: admins, free tier, or a verified paid membership.
-- The trusted worker predicate (has_creation_membership_for_actor) stays paid/admin only.
create or replace function makeborne_private.has_creation_membership() returns boolean
language sql stable security definer set search_path='' as $$
  select makeborne_private.has_creation_membership_for_actor((select auth.uid()))
    or makeborne_private.has_free_tier_access((select auth.uid()));
$$;

create function public.makeborne_creation_access() returns boolean
language sql stable security invoker set search_path='' as $$
  select (select auth.role()) = 'authenticated' and makeborne_private.has_creation_membership();
$$;
revoke all on function public.makeborne_creation_access() from public,anon;
grant execute on function public.makeborne_creation_access() to authenticated;

create function makeborne_private.has_unlimited_credits(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select makeborne_private.has_account_privilege(p_user,'admin')
    or makeborne_private.has_account_privilege(p_user,'unlimited_credits');
$$;
revoke all on function makeborne_private.has_unlimited_credits(uuid) from public,anon,authenticated,service_role;

create function makeborne_private.credit_state(w makeborne_private.credit_wallets) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('balance',coalesce(w.balance,0),'reserved',coalesce(w.reserved,0),
    'available',coalesce(w.balance,0) - coalesce(w.reserved,0));
$$;
revoke all on function makeborne_private.credit_state(makeborne_private.credit_wallets) from public,anon,authenticated,service_role;

-- Creates the wallet on first use and takes its row lock. Every mutation locks
-- the wallet first, then the reservation, so per-user writes serialize.
create function makeborne_private.lock_credit_wallet(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then
    raise exception 'Account unavailable' using errcode='P0002';
  end if;
  insert into makeborne_private.credit_wallets(user_id) values(p_user) on conflict(user_id) do nothing;
  select * into w from makeborne_private.credit_wallets where user_id = p_user for update;
  return w;
end $$;
revoke all on function makeborne_private.lock_credit_wallet(uuid) from public,anon,authenticated,service_role;

create function makeborne_private.credit_grant(p_user uuid,p_amount bigint,p_kind text,p_reference text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; prior public.credit_ledger%rowtype; entry uuid;
begin
  if p_kind is null or p_kind not in ('trial','plan_grant','topup','refund','adjust') then
    raise exception 'Unsupported grant kind' using errcode='22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Grant amount must be positive' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Grant reference required' using errcode='22023'; end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then raise exception 'Metadata must be an object' using errcode='22023'; end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into prior from public.credit_ledger where user_id = p_user and kind = p_kind and reference = p_reference;
  if found then
    -- Duplicate deliveries are acknowledged without a second credit.
    return makeborne_private.credit_state(w) || jsonb_build_object('granted',false,'amount',prior.delta,'ledgerId',prior.id);
  end if;
  update makeborne_private.credit_wallets set balance = balance + p_amount, updated_at = now()
  where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,p_amount,p_kind,p_reference,w.balance - w.reserved,coalesce(p_metadata,'{}'::jsonb))
  returning id into entry;
  return makeborne_private.credit_state(w) || jsonb_build_object('granted',true,'amount',p_amount,'ledgerId',entry);
end $$;
revoke all on function makeborne_private.credit_grant(uuid,bigint,text,text,jsonb) from public,anon,authenticated,service_role;

create function makeborne_private.credit_ensure_trial(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare amount integer;
begin
  -- Cheap repeat path: no wallet lock once the one-time trial exists.
  if exists(select 1 from public.credit_ledger where user_id = p_user and kind = 'trial' and reference = 'trial') then
    return jsonb_build_object('granted',false,'reason','already_granted');
  end if;
  select trial_credits into amount from makeborne_private.billing_settings where singleton;
  if not makeborne_private.has_free_tier_access(p_user) or coalesce(amount,0) <= 0 then
    return jsonb_build_object('granted',false,'reason','not_eligible');
  end if;
  return makeborne_private.credit_grant(p_user,amount,'trial','trial',jsonb_build_object('source','free_tier'));
end $$;
revoke all on function makeborne_private.credit_ensure_trial(uuid) from public,anon,authenticated,service_role;

create function makeborne_private.credit_reserve(p_user uuid,p_amount bigint,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype;
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
  if w.balance - w.reserved < p_amount then
    raise exception 'Insufficient credits' using errcode='MB402',
      detail=format('available=%s required=%s',w.balance - w.reserved,p_amount);
  end if;
  insert into makeborne_private.credit_reservations(user_id,reference,amount) values(p_user,p_reference,p_amount);
  update makeborne_private.credit_wallets set reserved = reserved + p_amount, updated_at = now()
  where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,-p_amount,'reserve',p_reference,w.balance - w.reserved,jsonb_build_object('amount',p_amount));
  return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',false,'amount',p_amount,'status','reserved','replayed',false);
end $$;
revoke all on function makeborne_private.credit_reserve(uuid,bigint,text) from public,anon,authenticated,service_role;

-- Charges min(actual, held + available) and returns the rest of the hold.
-- A reference without a reservation is charged from available credits only.
create function makeborne_private.credit_settle(p_user uuid,p_reference text,p_actual bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype;
  held bigint := 0; charge bigint; unlimited boolean; has_reservation boolean;
begin
  if p_actual is null or p_actual < 0 or p_actual > 1000000000 then raise exception 'Actual credits must be non-negative' using errcode='22023'; end if;
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  unlimited := makeborne_private.has_unlimited_credits(p_user);
  if unlimited and not exists(select 1 from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference and status = 'reserved') then
    return jsonb_build_object('unlimited',true,'charged',0,'replayed',false);
  end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference for update;
  has_reservation := found;
  if has_reservation then
    if r.status = 'settled' then
      return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',unlimited,'charged',r.charged,'replayed',true);
    end if;
    if r.status = 'released' then raise exception 'Reservation already released' using errcode='PT409'; end if;
    held := r.amount;
  end if;
  charge := least(case when unlimited then 0 else p_actual end, held + (w.balance - w.reserved));
  if has_reservation then
    update makeborne_private.credit_reservations set status = 'settled', charged = charge, resolved_at = now()
    where user_id = p_user and reference = p_reference;
  else
    insert into makeborne_private.credit_reservations(user_id,reference,amount,status,charged,resolved_at)
    values(p_user,p_reference,0,'settled',charge,now());
  end if;
  update makeborne_private.credit_wallets set reserved = reserved - held, balance = balance - charge, updated_at = now()
  where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,held - charge,'settle',p_reference,w.balance - w.reserved,
    jsonb_build_object('held',held,'actual',p_actual,'charged',charge,'shortfall',greatest(p_actual - charge,0),'waived',unlimited));
  return makeborne_private.credit_state(w) || jsonb_build_object('unlimited',unlimited,'charged',charge,'replayed',false);
end $$;
revoke all on function makeborne_private.credit_settle(uuid,text,bigint) from public,anon,authenticated,service_role;

create function makeborne_private.credit_release(p_user uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; r makeborne_private.credit_reservations%rowtype;
begin
  if p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'Reservation reference required' using errcode='22023'; end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  select * into r from makeborne_private.credit_reservations where user_id = p_user and reference = p_reference for update;
  if not found or r.status <> 'reserved' then
    return makeborne_private.credit_state(w) || jsonb_build_object('released',0,'replayed',true);
  end if;
  update makeborne_private.credit_reservations set status = 'released', resolved_at = now()
  where user_id = p_user and reference = p_reference;
  update makeborne_private.credit_wallets set reserved = reserved - r.amount, updated_at = now()
  where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
  values(p_user,r.amount,'release',p_reference,w.balance - w.reserved,jsonb_build_object('amount',r.amount));
  return makeborne_private.credit_state(w) || jsonb_build_object('released',r.amount,'replayed',false);
end $$;
revoke all on function makeborne_private.credit_release(uuid,text) from public,anon,authenticated,service_role;

create function makeborne_private.credit_wallet(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_state(w) || jsonb_build_object('unlimited',makeborne_private.has_unlimited_credits(p_user))
  from (select 1) one left join makeborne_private.credit_wallets w on w.user_id = p_user;
$$;
revoke all on function makeborne_private.credit_wallet(uuid) from public,anon,authenticated,service_role;

-- The browser balance accepts no user ID; it reads only the caller's wallet.
create function makeborne_private.my_credit_balance() returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_state(w)
  from (select 1) one left join makeborne_private.credit_wallets w
    on (select auth.role()) = 'authenticated' and w.user_id = (select auth.uid());
$$;
revoke all on function makeborne_private.my_credit_balance() from public,anon,service_role;
grant execute on function makeborne_private.my_credit_balance() to authenticated;

-- Exposed service-only wrappers. The application passes a verified Auth user ID.
create function public.makeborne_credit_grant(p_user uuid,p_amount bigint,p_kind text,p_reference text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_private.credit_grant(p_user,p_amount,p_kind,p_reference,p_metadata);
$$;
create function public.makeborne_credit_ensure_trial(p_user uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.credit_ensure_trial(p_user);
$$;
create function public.makeborne_credit_reserve(p_user uuid,p_amount bigint,p_reference text) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.credit_reserve(p_user,p_amount,p_reference);
$$;
create function public.makeborne_credit_settle(p_user uuid,p_reference text,p_actual bigint) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.credit_settle(p_user,p_reference,p_actual);
$$;
create function public.makeborne_credit_release(p_user uuid,p_reference text) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.credit_release(p_user,p_reference);
$$;
create function public.makeborne_credit_wallet(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select makeborne_private.credit_wallet(p_user);
$$;
create function public.makeborne_credit_balance() returns jsonb
language sql stable security invoker set search_path='' as $$
  select makeborne_private.my_credit_balance();
$$;

do $$ declare item text; begin
  foreach item in array array[
    'makeborne_private.credit_grant(uuid,bigint,text,text,jsonb)','makeborne_private.credit_ensure_trial(uuid)',
    'makeborne_private.credit_reserve(uuid,bigint,text)','makeborne_private.credit_settle(uuid,text,bigint)',
    'makeborne_private.credit_release(uuid,text)','makeborne_private.credit_wallet(uuid)',
    'public.makeborne_credit_grant(uuid,bigint,text,text,jsonb)','public.makeborne_credit_ensure_trial(uuid)',
    'public.makeborne_credit_reserve(uuid,bigint,text)','public.makeborne_credit_settle(uuid,text,bigint)',
    'public.makeborne_credit_release(uuid,text)','public.makeborne_credit_wallet(uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated',item);
    execute format('grant execute on function %s to service_role',item);
  end loop;
end $$;
revoke all on function public.makeborne_credit_balance() from public,anon,service_role;
grant execute on function public.makeborne_credit_balance() to authenticated;

commit;
