-- Conservative billing protections, not provider plan-switch support.
-- Drain billing grant/reconcile invocations before rollout. No historical rows,
-- grants, lots, expiries or top-ups are rewritten. Unknown historic allocation
-- boundaries require operator review rather than authorizing a replacement.
begin;

create function makeborne_private.guard_creation_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creation-checkout:'||new.user_id::text,0));
  if exists(select 1 from public.billing_memberships m where m.checkout_id=new.checkout_id and m.membership_id<>new.membership_id) then
    raise exception 'Checkout already belongs to a membership' using errcode='PBC03';
  end if;
  if new.status not in ('canceled','expired','completed') and exists(select 1 from public.billing_memberships m
    where m.user_id=new.user_id and m.membership_id<>new.membership_id and m.status not in ('canceled','expired','completed')) then
    raise exception 'Account already has a subscription; replacement requires review' using errcode='PBC01';
  end if;
  return new;
end $$;
alter function makeborne_private.guard_creation_membership() owner to postgres;
revoke all on function makeborne_private.guard_creation_membership() from public,anon,authenticated,service_role;
create trigger prevent_duplicate_creation_membership before insert or update on public.billing_memberships
for each row execute function makeborne_private.guard_creation_membership();

alter table makeborne_private.plan_credit_issues drop constraint plan_credit_issues_kind_check;
alter table makeborne_private.plan_credit_issues add constraint plan_credit_issues_kind_check check(kind in ('no_evidence','account_overlap'));

-- Only validated observations can authorize an allocation. Invalid anchors and
-- missing/mismatched periods must not become paid evidence on a known period.
create or replace function makeborne_private.plan_evidence_usable(p_outcome text) returns boolean
language sql immutable set search_path='' as $$
  select p_outcome in ('recorded','extended','unchanged','not_paid','evidence','manual');
$$;
alter function makeborne_private.plan_evidence_usable(text) owner to postgres;
revoke all on function makeborne_private.plan_evidence_usable(text) from public,anon,authenticated,service_role;

-- Called only after locking the account wallet. Ledger grants remain evidence
-- even after spending/expiry: a replacement cannot mint the same paid time again.
create function makeborne_private.plan_allocation_conflict(p_user uuid,p_membership text,p_start timestamptz,p_end timestamptz) returns text
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare g record; s timestamptz; e timestamptz;
begin
  for g in select reference,metadata from public.credit_ledger where user_id=p_user and kind='plan_grant'
    and split_part(reference,':',2)<>p_membership loop
    begin
      s:=(g.metadata->>'allocationStart')::timestamptz;
      e:=(g.metadata->>'allocationEnd')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then s:=null; e:=null;
    end;
    if s is null or e is null or e<=s or not isfinite(s) or not isfinite(e) or (s<p_end and e>p_start) then
      return g.reference;
    end if;
  end loop;
  return null;
end $$;
alter function makeborne_private.plan_allocation_conflict(uuid,text,timestamptz,timestamptz) owner to postgres;
revoke all on function makeborne_private.plan_allocation_conflict(uuid,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function makeborne_private.credit_grant_plan_allocation(p_user uuid,p_membership text,p_month_start timestamptz,p_month_end timestamptz,
  p_tier text,p_target bigint,p_legacy_reference text,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare w makeborne_private.credit_wallets%rowtype; prefix text; already bigint; amount bigint; conflict_reference text;
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
  conflict_reference:=makeborne_private.plan_allocation_conflict(p_user,p_membership,p_month_start,p_month_end);
  if conflict_reference is not null then
    insert into makeborne_private.plan_credit_issues(membership_id,user_id,allocation_start,kind,detail)
    values(p_membership,p_user,p_month_start,'account_overlap',jsonb_build_object('allocationStart',p_month_start,'allocationEnd',p_month_end,'conflictingGrant',conflict_reference))
    on conflict(membership_id,allocation_start,kind) do update set last_seen_at=now(),resolved_at=null,resolution=null;
    return makeborne_private.credit_state(w)||jsonb_build_object('granted',false,'amount',0,'alreadyGranted',already,'blocked','account_overlap');
  end if;
  return makeborne_private.credit_grant(p_user,amount,'plan_grant',prefix||p_tier,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('monthlyCredits',p_target,'alreadyGranted',already,'allocationStart',p_month_start,'allocationEnd',p_month_end,'rolloverExtendedAt',now(),'expiresAt',p_month_end + makeborne_private.plan_credit_rollover()))
    || jsonb_build_object('alreadyGranted',already);
end $$;

alter function makeborne_private.credit_grant_plan_allocation(uuid,text,timestamptz,timestamptz,text,bigint,text,jsonb) owner to postgres;
revoke all on function makeborne_private.credit_grant_plan_allocation(uuid,text,timestamptz,timestamptz,text,bigint,text,jsonb) from public,anon,authenticated,service_role;

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
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome) and (not o.paid or o.period_start=p.period_start
          or (o.period_start is null and o.observed_at>=p.period_start and o.observed_at<p.period_end))
        and o.observed_at <= a_start and (o.source <> 'manual' or o.observed_at = a_start)
      order by (o.source = 'manual') desc, o.observed_at desc, o.id desc limit 1;
      if not found then
        select o.* into base from makeborne_private.plan_observations o
        where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome) and (not o.paid or o.period_start=p.period_start
          or (o.period_start is null and o.observed_at>=p.period_start and o.observed_at<p.period_end))
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
      where membership_id = p_membership and allocation_start = a_start and kind='no_evidence' and resolved_at is null;
      if not base.paid then skipped := skipped + 1; continue; end if;
      tier := base.tier; target := base.monthly_credits;
      select o.tier, o.monthly_credits into up from makeborne_private.plan_observations o
      where o.membership_id = p_membership and o.user_id = p.user_id and makeborne_private.plan_evidence_usable(o.outcome) and (not o.paid or o.period_start=p.period_start
          or (o.period_start is null and o.observed_at>=p.period_start and o.observed_at<p.period_end))
        and o.source <> 'manual' and o.paid and o.observed_at > a_start and o.observed_at < a_end and o.observed_at <= p_now
      order by o.monthly_credits desc, o.observed_at limit 1;
      if found and up.monthly_credits > target then tier := up.tier; target := up.monthly_credits; end if;
      owed := owed + 1;
      result := makeborne_private.credit_grant_plan_allocation(p.user_id, p_membership, a_start, a_end, tier, target,
        case when k = 0 then 'plan:'||p_membership||':'||to_char(p.period_end,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        jsonb_build_object('allocation',k+1,'allocationStart',a_start,'allocationEnd',a_end,'periodStart',p.period_start,
          'periodEnd',p.period_end,'interval',p.billing_interval,'tier',tier,'evidence',base.source,'source','reconcile'));
      if result->>'blocked'='account_overlap' then unresolved:=unresolved+1; end if;
      if (result->>'granted')::boolean then granted := granted + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('owed',owed,'granted',granted,'notPaid',skipped,'unresolved',unresolved);
end $$;
revoke all on function makeborne_private.reconcile_plan_membership(text,timestamptz) from public,anon,authenticated,service_role;

alter function makeborne_private.reconcile_plan_membership(text,timestamptz) owner to postgres;
commit;
