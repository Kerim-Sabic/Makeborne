-- Credit holds expire. A run that the platform kills (time limit, crash, deploy)
-- never settles or releases its reservation, which would lock those credits
-- forever. Runs are capped at 300-800s, so a hold still open after 15 minutes
-- belongs to a dead run: the next wallet mutation releases it, and balance
-- reads already treat it as available.
begin;

create function makeborne_private.stale_credit_holds(p_user uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(amount),0)::bigint from makeborne_private.credit_reservations
  where user_id = p_user and status = 'reserved' and created_at < now() - interval '15 minutes';
$$;
revoke all on function makeborne_private.stale_credit_holds(uuid) from public,anon,authenticated,service_role;

-- Same contract as before (create on first use, row lock), plus expiry of dead holds.
create or replace function makeborne_private.lock_credit_wallet(p_user uuid) returns makeborne_private.credit_wallets
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; expired record;
begin
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then
    raise exception 'Account unavailable' using errcode='P0002';
  end if;
  insert into makeborne_private.credit_wallets(user_id) values(p_user) on conflict(user_id) do nothing;
  select * into w from makeborne_private.credit_wallets where user_id = p_user for update;
  for expired in
    update makeborne_private.credit_reservations set status = 'released', resolved_at = now()
    where user_id = p_user and status = 'reserved' and created_at < now() - interval '15 minutes'
    returning reference, amount
  loop
    update makeborne_private.credit_wallets set reserved = reserved - expired.amount, updated_at = now()
    where user_id = p_user returning * into w;
    insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
    values(p_user,expired.amount,'release',expired.reference,w.balance - w.reserved,
      jsonb_build_object('amount',expired.amount,'expired',true));
  end loop;
  return w;
end $$;
revoke all on function makeborne_private.lock_credit_wallet(uuid) from public,anon,authenticated,service_role;

create or replace function makeborne_private.credit_wallet(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('balance',coalesce(w.balance,0),'reserved',held,'available',coalesce(w.balance,0) - held,
    'unlimited',makeborne_private.has_unlimited_credits(p_user))
  from (select 1) one left join makeborne_private.credit_wallets w on w.user_id = p_user
  cross join lateral (select greatest(coalesce(w.reserved,0) - makeborne_private.stale_credit_holds(p_user),0) as held) h;
$$;
revoke all on function makeborne_private.credit_wallet(uuid) from public,anon,authenticated;
grant execute on function makeborne_private.credit_wallet(uuid) to service_role;

create or replace function makeborne_private.my_credit_balance() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('balance',coalesce(w.balance,0),'reserved',held,'available',coalesce(w.balance,0) - held)
  from (select 1) one left join makeborne_private.credit_wallets w
    on (select auth.role()) = 'authenticated' and w.user_id = (select auth.uid())
  cross join lateral (select greatest(coalesce(w.reserved,0) - makeborne_private.stale_credit_holds(w.user_id),0) as held) h;
$$;
revoke all on function makeborne_private.my_credit_balance() from public,anon,service_role;
grant execute on function makeborne_private.my_credit_balance() to authenticated;

commit;
