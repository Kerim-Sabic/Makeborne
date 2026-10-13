-- Plan credits per allocation month. A yearly membership has twelve monthly
-- allocations in one paid period; a monthly membership has one.
-- NOTE: superseded as an entry point by 20261012100000_plan_entitlement_history,
-- which computes allocations and tiers from recorded billing history and calls
-- this primitive itself; the app can no longer call it. Every call is idempotent.
--
-- One allocation month of one membership is worth at most its tier's monthly
-- credits. The function locks the wallet, sums what this membership already
-- received for that month (any tier, plus the earlier single-reference
-- format), and grants only the shortfall:
--   * duplicate or repeated deliveries grant nothing;
--   * an upgrade inside the month grants the difference (reference ...:tier);
--   * a downgrade grants nothing extra; the lower tier applies from the next
--     allocation month. Granted credits are never clawed back.
begin;

create function makeborne_private.credit_grant_plan_month(p_user uuid,p_membership text,p_month_start timestamptz,p_tier text,
  p_target bigint,p_legacy_reference text,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w makeborne_private.credit_wallets%rowtype; prefix text; already bigint; amount bigint;
begin
  if p_membership is null or p_membership !~ '^mem_[A-Za-z0-9]{1,64}$' then raise exception 'Membership reference is invalid' using errcode='22023'; end if;
  if p_month_start is null then raise exception 'Allocation month is required' using errcode='22023'; end if;
  if p_tier is null or p_tier not in ('create','studio','scale') then raise exception 'Unknown plan tier' using errcode='22023'; end if;
  if p_target is null or p_target not between 1 and 100000 then raise exception 'Monthly credits out of range' using errcode='22023'; end if;
  if p_legacy_reference is not null and length(p_legacy_reference) > 200 then raise exception 'Legacy reference too long' using errcode='22023'; end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then raise exception 'Metadata must be an object' using errcode='22023'; end if;
  w := makeborne_private.lock_credit_wallet(p_user);
  prefix := 'plan:'||p_membership||':'||to_char(p_month_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':';
  select coalesce(sum(delta),0) into already from public.credit_ledger
  where user_id = p_user and kind = 'plan_grant'
    and (left(reference, length(prefix)) = prefix or reference = p_legacy_reference);
  amount := p_target - already;
  if amount <= 0 then
    return makeborne_private.credit_state(w) || jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already);
  end if;
  return makeborne_private.credit_grant(p_user,amount,'plan_grant',prefix||p_tier,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('monthlyCredits',p_target,'alreadyGranted',already))
    || jsonb_build_object('alreadyGranted',already);
end $$;
revoke all on function makeborne_private.credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) from public,anon,authenticated,service_role;

create function public.makeborne_credit_grant_plan_month(p_user uuid,p_membership text,p_month_start timestamptz,p_tier text,
  p_target bigint,p_legacy_reference text default null,p_metadata jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.credit_grant_plan_month(p_user,p_membership,p_month_start,p_tier,p_target,p_legacy_reference,p_metadata);
$$;
revoke all on function public.makeborne_credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.makeborne_credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) to service_role;
grant execute on function makeborne_private.credit_grant_plan_month(uuid,text,timestamptz,text,bigint,text,jsonb) to service_role;

commit;
