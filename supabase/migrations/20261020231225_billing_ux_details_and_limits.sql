-- Caller-scoped billing display and independent optional credit-usage limit.
-- Existing v1 usage contract stays unchanged for rollback/older app compatibility.
begin;
create table makeborne_private.credit_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 alert_below integer check(alert_below between 1 and 1000000),
 monthly_limit bigint check(monthly_limit between 1 and 1000000000)
);
alter table makeborne_private.credit_preferences enable row level security;
revoke all on makeborne_private.credit_preferences from public,anon,authenticated,service_role;

-- Caller must hold the wallet lock; both reservation and auto-top-up already do.
-- Count actual charges this UTC month and all active holds. Credit grants cannot
-- reset it. No preference means no additional limit (existing behaviour).
create function makeborne_private.credit_usage_room(p_user uuid,p_amount bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select coalesce((select sum(case when r.status='settled' and r.resolved_at>=date_trunc('month',makeborne_private.credit_clock() at time zone 'UTC') at time zone 'UTC' and r.resolved_at<(date_trunc('month',makeborne_private.credit_clock() at time zone 'UTC')+interval '1 month') at time zone 'UTC' then r.charged when r.status='reserved' and r.created_at>=makeborne_private.credit_clock()-interval '15 minutes' then r.amount else 0 end) from makeborne_private.credit_reservations r where r.user_id=p_user),0)+p_amount<=s.monthly_limit from makeborne_private.credit_preferences s where s.user_id=p_user and s.monthly_limit is not null),true);
$$;
revoke all on function makeborne_private.credit_usage_room(uuid,bigint) from public,anon,authenticated,service_role;
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
  if not makeborne_private.credit_usage_room(p_user,p_amount) then
    raise exception 'Monthly credit usage limit reached' using errcode='MB403';
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
create or replace function public.makeborne_autotopup_plan_charge(p_user uuid) returns jsonb
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
  if not makeborne_private.credit_usage_room(p_user,s.credits) then return jsonb_build_object('decision','usage_limit'); end if;
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

create function makeborne_rpc.makeborne_credit_preferences(p_save boolean default false,p_alert_below integer default null,p_monthly_limit bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s makeborne_private.credit_preferences%rowtype; used bigint; held bigint;
begin
 if u is null or auth.role() is distinct from 'authenticated' then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_save is null or p_alert_below is not null and p_alert_below not between 1 and 1000000 or p_monthly_limit is not null and p_monthly_limit not between 1 and 1000000000 then raise exception 'Invalid credit preferences' using errcode='22023'; end if;
 perform makeborne_private.lock_credit_wallet(u);
 select coalesce(sum(charged),0) into used from makeborne_private.credit_reservations where user_id=u and status='settled' and resolved_at>=date_trunc('month',makeborne_private.credit_clock() at time zone 'UTC') at time zone 'UTC' and resolved_at<(date_trunc('month',makeborne_private.credit_clock() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
 select coalesce(sum(amount),0) into held from makeborne_private.credit_reservations where user_id=u and status='reserved';
 if p_save then
  if p_monthly_limit is not null and p_monthly_limit<used+held then raise exception 'Limit must cover credits already used and reserved' using errcode='PT409'; end if;
  insert into makeborne_private.credit_preferences(user_id,alert_below,monthly_limit) values(u,p_alert_below,p_monthly_limit) on conflict(user_id) do update set alert_below=excluded.alert_below,monthly_limit=excluded.monthly_limit;
 end if;
 select * into s from makeborne_private.credit_preferences where user_id=u;
 return jsonb_build_object('alertBelow',s.alert_below,'monthlyLimit',s.monthly_limit,'used',used,'reserved',held,'available',makeborne_private.credit_available(u));
end $$;
revoke all on function makeborne_rpc.makeborne_credit_preferences(boolean,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_credit_preferences(boolean,integer,bigint) to authenticated;
create function public.makeborne_credit_preferences(p_save boolean default false,p_alert_below integer default null,p_monthly_limit bigint default null) returns jsonb language sql security invoker set search_path='' as $$select makeborne_rpc.makeborne_credit_preferences(p_save,p_alert_below,p_monthly_limit);$$;
revoke all on function public.makeborne_credit_preferences(boolean,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_credit_preferences(boolean,integer,bigint) to authenticated;

-- Page enrichment needs an indexed lookup even for a 100k-row account.
create index credit_reservations_display_id on makeborne_private.credit_reservations(user_id,(md5(reference)));
create function makeborne_rpc.makeborne_usage_history_v2(p_period_start timestamptz,p_period_end timestamptz,p_before_at timestamptz default null,p_before_id text default null,p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; e jsonb; rows jsonb:='[]'; extra jsonb; funding jsonb; ref text; u uuid:=auth.uid();
begin
 result:=makeborne_rpc.makeborne_usage_history(p_period_start,p_period_end,p_before_at,p_before_id,p_limit);
 for e in select value from jsonb_array_elements(result->'entries') loop
  extra:='{}'; funding:=null; ref:=null;
  if e->>'id' like 'hold:%' then
   select r.reference,jsonb_strip_nulls(jsonb_build_object(
    'workspaceId',case when a.id is not null and makeborne_private.can_read(a.workspace_id) then a.workspace_id end,
    'artifactId',case when a.id is not null and makeborne_private.can_read(a.workspace_id) then a.id end,
    'operationId',o.id,'operationCharged',case when o.id is not null then (select coalesce(sum(cr.charged),0)::text from makeborne_private.ai_operation_runs rr join makeborne_private.credit_reservations cr on cr.reference=rr.reference and cr.user_id=u where rr.operation_id=o.id and cr.status='settled') end,'operationReserved',case when o.id is not null then (select coalesce(sum(cr.amount),0)::text from makeborne_private.ai_operation_runs rr join makeborne_private.credit_reservations cr on cr.reference=rr.reference and cr.user_id=u where rr.operation_id=o.id and cr.status='reserved' and cr.created_at>=makeborne_private.credit_clock()-interval '15 minutes') end))
   into ref,extra from makeborne_private.credit_reservations r
   left join makeborne_private.ai_operation_runs run on run.reference=r.reference
   left join makeborne_private.ai_operations o on o.id=run.operation_id and o.actor=u
   left join public.artifacts a on a.id=o.artifact_id and a.workspace_id=o.workspace_id
   where r.user_id=u and md5(r.reference)=substring(e->>'id' from 6);
   if ref is not null and e->>'status' in ('Reserved','Charged') then
    select jsonb_build_object('plan',coalesce(sum(case when l.source='plan' then case when e->>'status'='Charged' then h.charged else h.amount end else 0 end),0)::text,
     'paid',coalesce(sum(case when l.source='topup' then case when e->>'status'='Charged' then h.charged else h.amount end else 0 end),0)::text,
     'other',coalesce(sum(case when l.source not in ('plan','topup') then case when e->>'status'='Charged' then h.charged else h.amount end else 0 end),0)::text)
    into funding from makeborne_private.credit_hold_lots h join makeborne_private.credit_lots l on l.id=h.lot_id and l.user_id=u where h.user_id=u and h.reference=ref having count(*)>0;
   end if;
  end if;
  rows:=rows||jsonb_build_array(e||coalesce(extra,'{}')||case when funding is null then '{}'::jsonb else jsonb_build_object('funding',funding) end);
 end loop;
 return jsonb_set(result,'{entries}',rows);
end $$;
revoke all on function makeborne_rpc.makeborne_usage_history_v2(timestamptz,timestamptz,timestamptz,text,integer) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_usage_history_v2(timestamptz,timestamptz,timestamptz,text,integer) to authenticated;
create function public.makeborne_usage_history_v2(p_period_start timestamptz,p_period_end timestamptz,p_before_at timestamptz default null,p_before_id text default null,p_limit integer default 100) returns jsonb language sql stable security invoker set search_path='' as $$select makeborne_rpc.makeborne_usage_history_v2(p_period_start,p_period_end,p_before_at,p_before_id,p_limit);$$;
revoke all on function public.makeborne_usage_history_v2(timestamptz,timestamptz,timestamptz,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_usage_history_v2(timestamptz,timestamptz,timestamptz,text,integer) to authenticated;
commit;
