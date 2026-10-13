-- Plan credit rollover (owner decision 2026-10-13): unused included credits stay
-- spendable for two months after their allocation month ends. Spending order is
-- unchanged (soonest expiry first), so older credits are always used first.
-- Credits not yet expired get the same extension once; expired credits stay lapsed.
-- Rollout requirement: drain existing plan-reconciliation/grant transactions
-- before applying. A PL/pgSQL invocation already executing the old grant body
-- can otherwise resume after replacement and still issue its old expiry.
-- Existing reservations/settlements are protected by wallet serialization below.
begin;

create or replace function makeborne_private.plan_credit_rollover() returns interval
language sql immutable set search_path='' as $$ select interval '2 months' $$;
revoke all on function makeborne_private.plan_credit_rollover() from public,anon,authenticated,service_role;

create or replace function makeborne_private.credit_grant_plan_allocation(p_user uuid,p_membership text,p_month_start timestamptz,p_month_end timestamptz,
  p_tier text,p_target bigint,p_legacy_reference text,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
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
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('monthlyCredits',p_target,'alreadyGranted',already,'allocationEnd',p_month_end,'rolloverExtendedAt',now(),'expiresAt',p_month_end + makeborne_private.plan_credit_rollover()))
    || jsonb_build_object('alreadyGranted',already);
end $$;

-- Serialize with grant/reserve/settle/expiry using their wallet-first lock order.
-- Evaluate the cutoff AFTER acquiring the wallet, so waiting across an expiry
-- never resurrects an allocation that has already expired. Keep grant ledger
-- entries immutable; the lot records both the original and effective expiry.
create or replace function makeborne_private.extend_plan_credit_rollover(p_user uuid) returns integer
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare cutoff timestamptz; changed integer;
begin
  perform 1 from makeborne_private.credit_wallets where user_id=p_user for update;
  if not found then return 0; end if;
  cutoff := clock_timestamp();
  update makeborne_private.credit_lots
  set expires_at = expires_at + makeborne_private.plan_credit_rollover(),
      metadata = metadata || jsonb_build_object('allocationEnd',coalesce(metadata->>'allocationEnd',expires_at::text),
        'originalExpiresAt',expires_at,'expiresAt',expires_at + makeborne_private.plan_credit_rollover(),'rolloverExtendedAt',cutoff)
  where user_id=p_user and source='plan' and expires_at>cutoff and not (metadata ? 'rolloverExtendedAt')
    and (metadata->>'allocationEnd' is null or expires_at=(metadata->>'allocationEnd')::timestamptz);
  get diagnostics changed = row_count;
  return changed;
end $$;
revoke all on function makeborne_private.extend_plan_credit_rollover(uuid) from public,anon,authenticated,service_role;

do $$ declare u uuid; begin
  for u in select user_id from makeborne_private.credit_wallets order by user_id loop
    perform makeborne_private.extend_plan_credit_rollover(u);
  end loop;
end $$;

commit;
