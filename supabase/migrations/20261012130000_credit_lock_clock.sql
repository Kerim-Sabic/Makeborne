-- Credit writes judge expiry at the instant they hold the wallet lock.
-- A write that started before an allocation's end but waited for the wallet
-- lock until after it must not spend that allocation. lock_credit_wallet now
-- records clock_timestamp() once the lock is held (transaction-local setting),
-- and every validity decision in a write (expiry, hold timeout, availability)
-- uses it. Reads use the same clock: now() unless the transaction holds the lock.
begin;

create function makeborne_private.credit_clock() returns timestamptz
language sql stable set search_path='' as $$
  select coalesce(nullif(current_setting('makeborne.credit_clock', true), '')::timestamptz, now());
$$;
revoke all on function makeborne_private.credit_clock() from public,anon,authenticated,service_role;

create or replace function makeborne_private.credit_state(w makeborne_private.credit_wallets) returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_totals(w.user_id, makeborne_private.credit_clock()) - 'nextExpiry';
$$;

create or replace function makeborne_private.credit_available(p_user uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select (makeborne_private.credit_totals(p_user, makeborne_private.credit_clock())->>'available')::bigint;
$$;

create or replace function makeborne_private.refresh_wallet_cache(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare t jsonb := makeborne_private.credit_totals(p_user, makeborne_private.credit_clock()); w makeborne_private.credit_wallets%rowtype;
begin
  update makeborne_private.credit_wallets set balance = (t->>'balance')::bigint, reserved = (t->>'reserved')::bigint, updated_at = now()
  where user_id = p_user returning * into w;
  return w;
end $$;

create or replace function makeborne_private.lock_credit_wallet(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; dead record;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then
    raise exception 'Account unavailable' using errcode='P0002';
  end if;
  insert into makeborne_private.credit_wallets(user_id) values(p_user) on conflict(user_id) do nothing;
  select * into w from makeborne_private.credit_wallets where user_id = p_user for update;
  -- Every decision below is taken at the instant the wallet lock is held.
  perform set_config('makeborne.credit_clock', clock_timestamp()::text, true);
  for dead in select reference from makeborne_private.credit_reservations
      where user_id = p_user and status = 'reserved' and created_at < makeborne_private.credit_clock() - interval '15 minutes' order by created_at loop
    perform makeborne_private.resolve_hold(p_user, dead.reference, 0, 'release', makeborne_private.credit_clock(), jsonb_build_object('reason','hold timeout'));
  end loop;
  perform makeborne_private.expire_lots(p_user, makeborne_private.credit_clock());
  return makeborne_private.refresh_wallet_cache(p_user);
end $$;

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
  if expires is not null and expires <= makeborne_private.credit_clock() then perform makeborne_private.expire_lots(p_user, makeborne_private.credit_clock()); end if;
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('granted',true,'amount',p_amount,'ledgerId',entry,'lot',lot,'expiresAt',expires);
end $$;

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
      and makeborne_private.lot_free(credit_lots, makeborne_private.credit_clock()) > 0
      order by expires_at nulls last, makeborne_private.lot_spend_rank(source), id for update loop
    exit when remaining = 0;
    take := least(remaining, makeborne_private.lot_free(l, makeborne_private.credit_clock()));
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
  res := makeborne_private.resolve_hold(p_user, p_reference, case when unlimited then 0 else p_actual end, 'settle', makeborne_private.credit_clock(),
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
  res := makeborne_private.resolve_hold(p_user, p_reference, 0, 'release', makeborne_private.credit_clock(), '{}'::jsonb);
  w := makeborne_private.refresh_wallet_cache(p_user);
  return makeborne_private.credit_state(w) || jsonb_build_object('released',(res->>'returned')::bigint,'lapsed',(res->>'lapsed')::bigint,'replayed',false);
end $$;

create or replace function public.makeborne_credit_expire_due(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; wallets integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Limit out of range' using errcode='22023'; end if;
  for u in select distinct l.user_id from makeborne_private.credit_lots l
      where l.expires_at <= clock_timestamp() and l.amount - l.spent - l.held - l.lapsed > 0 limit p_limit loop
    perform makeborne_private.lock_credit_wallet(u);
    wallets := wallets + 1;
  end loop;
  for u in select distinct r.user_id from makeborne_private.credit_reservations r
      where r.status = 'reserved' and r.created_at < clock_timestamp() - interval '15 minutes' limit p_limit loop
    perform makeborne_private.lock_credit_wallet(u);
    wallets := wallets + 1;
  end loop;
  return jsonb_build_object('wallets',wallets);
end $$;

-- Reads: the same clock (now() unless this transaction already holds the wallet lock).
create or replace function makeborne_private.credit_wallet(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select makeborne_private.credit_totals(p_user, makeborne_private.credit_clock()) || jsonb_build_object('unlimited',makeborne_private.has_unlimited_credits(p_user));
$$;

create or replace function makeborne_private.my_credit_balance() returns jsonb
language sql stable security definer set search_path='' as $$
  select case when (select auth.role()) = 'authenticated' and auth.uid() is not null
    then makeborne_private.credit_totals(auth.uid(), makeborne_private.credit_clock())
    else jsonb_build_object('balance',0,'reserved',0,'available',0,'nextExpiry',null) end;
$$;

commit;
