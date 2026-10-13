-- CLI-generated, sequenced after the existing 46-file candidate. No activation:
-- packs start disabled with no provider mapping. All credit writes are atomic.
begin;
alter table makeborne_private.billing_job_runs drop constraint billing_job_runs_job_check;
alter table makeborne_private.billing_job_runs add constraint billing_job_runs_job_check check(job in ('plan_credits','credit_topups'));
create table makeborne_private.topup_catalog (
  version text not null, pack_id text not null,
  credits bigint not null check(credits between 1 and 100000),
  price_cents bigint not null check(price_cents between 1 and 100000000),
  merchant_id text check(merchant_id ~ '^biz_[A-Za-z0-9]+$'),
  plan_id text unique check(plan_id ~ '^plan_[A-Za-z0-9]+$'),
  enabled boolean not null default false,
  primary key(version,pack_id),
  check(not enabled or (merchant_id is not null and plan_id is not null))
);
insert into makeborne_private.topup_catalog(version,pack_id,credits,price_cents) values
 ('credit-packs-preview-2026-10-05','boost_100',100,1200),
 ('credit-packs-preview-2026-10-05','boost_300',300,3200),
 ('credit-packs-preview-2026-10-05','boost_1000',1000,9500);

create table makeborne_private.topup_orders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, pack_id text not null, catalog_version text not null,
  credits bigint not null check(credits > 0), price_cents bigint not null check(price_cents > 0),
  merchant_id text not null, plan_id text not null, whop_user_id text not null check(whop_user_id ~ '^user_[A-Za-z0-9]+$'),
  checkout_id text unique check(checkout_id ~ '^ch_[A-Za-z0-9]+$'), payment_id text unique check(payment_id ~ '^pay_[A-Za-z0-9]+$'),
  state text not null default 'awaiting_payment' check(state in ('awaiting_payment','funded','held','reversed')),
  granted boolean not null default false,
  lot_id bigint unique references makeborne_private.credit_lots(id),
  withheld_credits bigint not null default 0 check(withheld_credits >= 0),
  consumed_exposure_credits bigint not null default 0 check(consumed_exposure_credits >= 0),
  evidence jsonb, observed_at timestamptz, revision bigint not null default 0 check(revision >= 0),
  created_at timestamptz not null default now(),
  checkout_url text, checkout_request jsonb,
  checkout_started_at timestamptz, checkout_last_attempt timestamptz,
  checkout_attempts integer not null default 0 check(checkout_attempts between 0 and 3),
  payment_scan_cursor text check(length(payment_scan_cursor)<=2000), last_checked_at timestamptz,
  reconcile_error text check(reconcile_error ~ '^[A-Z0-9_]{1,100}$'),
  unique(user_id,request_id),
  foreign key(catalog_version,pack_id) references makeborne_private.topup_catalog(version,pack_id),
  check(granted = (lot_id is not null))
);
create index topup_orders_account on makeborne_private.topup_orders(user_id,created_at desc);
create unique index topup_one_open_purchase on makeborne_private.topup_orders(user_id) where state='awaiting_payment';
create table makeborne_private.topup_observations (
  order_id uuid not null references makeborne_private.topup_orders(id) on delete cascade,
  revision bigint not null, evidence jsonb not null, outcome text not null,
  observed_at timestamptz not null, recorded_at timestamptz not null default now(),
  primary key(order_id,revision)
);
alter table makeborne_private.topup_catalog enable row level security;
alter table makeborne_private.topup_orders enable row level security;
alter table makeborne_private.topup_observations enable row level security;
revoke all on makeborne_private.topup_catalog,makeborne_private.topup_orders,makeborne_private.topup_observations from public,anon,authenticated,service_role;

-- Price versions are append-only. Disabling a pack closes new checkout but
-- must never reinterpret an existing payment or change its provider binding.
create function makeborne_private.guard_topup_catalog()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.version,new.pack_id,new.credits,new.price_cents) is distinct from
    (old.version,old.pack_id,old.credits,old.price_cents)
    or ((old.enabled or exists(select 1 from makeborne_private.topup_orders where catalog_version=old.version and pack_id=old.pack_id))
      and (new.merchant_id,new.plan_id) is distinct from (old.merchant_id,old.plan_id)) then
    raise exception 'Use a new catalogue version for a different price or provider binding' using errcode='PT409';
  end if;
  return new;
end $$;
revoke all on function makeborne_private.guard_topup_catalog() from public,anon,authenticated,service_role;
create trigger guard_topup_catalog before update on makeborne_private.topup_catalog
for each row execute function makeborne_private.guard_topup_catalog();

create function makeborne_private.prepare_topup(p_user uuid,p_request uuid,p_pack text,p_version text,p_whop_user text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c makeborne_private.topup_catalog%rowtype; o makeborne_private.topup_orders%rowtype;
begin
  perform makeborne_private.lock_credit_wallet(p_user);
  if not makeborne_private.has_creation_membership_for_actor(p_user) then raise exception 'Creation membership required' using errcode='MB402'; end if;
  if p_request is null or p_whop_user is null or p_whop_user !~ '^user_[A-Za-z0-9]+$' then raise exception 'Invalid purchase identity' using errcode='22023'; end if;
  if not exists(select 1 from makeborne_private.account_privileges where user_id=p_user and is_admin)
    and not exists(select 1 from public.billing_memberships where user_id=p_user and whop_user_id=p_whop_user
      and status in ('active','canceling') and verified_until>now() and period_end>now()) then
    raise exception 'Purchasing identity does not match membership' using errcode='PT409';
  end if;
  select * into o from makeborne_private.topup_orders where user_id=p_user and request_id=p_request for update;
  if found then
    if o.pack_id is distinct from p_pack or o.catalog_version is distinct from p_version or o.whop_user_id is distinct from p_whop_user then
      raise exception 'Purchase request conflicts with its original binding' using errcode='PT409'; end if;
    return to_jsonb(o);
  end if;
  -- A second click with a new client request key resumes the same open pack.
  -- A different pack waits until the first checkout is resolved/cancelled.
  select * into o from makeborne_private.topup_orders where user_id=p_user and state='awaiting_payment' for update;
  if found then
    if o.pack_id is distinct from p_pack or o.catalog_version is distinct from p_version or o.whop_user_id is distinct from p_whop_user then
      raise exception 'Another credit pack checkout is open' using errcode='PT409'; end if;
    return to_jsonb(o);
  end if;
  select * into c from makeborne_private.topup_catalog where pack_id=p_pack and version=p_version and enabled;
  if not found then raise exception 'Credit pack checkout is closed' using errcode='PT503'; end if;
  insert into makeborne_private.topup_orders(user_id,request_id,pack_id,catalog_version,credits,price_cents,merchant_id,plan_id,whop_user_id)
    values(p_user,p_request,p_pack,p_version,c.credits,c.price_cents,c.merchant_id,c.plan_id,p_whop_user) returning * into o;
  return to_jsonb(o);
end $$;

create function makeborne_private.claim_topup_checkout(p_user uuid,p_order uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o makeborne_private.topup_orders%rowtype; at_ timestamptz:=clock_timestamp();
begin
  perform makeborne_private.lock_credit_wallet(p_user);
  select * into o from makeborne_private.topup_orders where id=p_order and user_id=p_user for update;
  if not found then raise exception 'Purchase unavailable' using errcode='P0002'; end if;
  if o.state<>'awaiting_payment' then raise exception 'Purchase already resolved' using errcode='PT409'; end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>2048
    or (p_request->>'mode') is distinct from 'payment' or (p_request->>'plan_id') is distinct from o.plan_id
    or (p_request->'metadata'->>'makeborne_topup_order_id') is distinct from o.id::text
    or (p_request->>'redirect_url') is null
    or (p_request->>'redirect_url') not in ('https://sandbox.whop.com/','https://makeborne.com/billing?topup='||o.id::text) then
    raise exception 'Invalid checkout request' using errcode='22023'; end if;
  if o.checkout_request is not null and o.checkout_request<>p_request then
    raise exception 'Checkout request is immutable' using errcode='PT409'; end if;
  if o.checkout_url is not null then return jsonb_build_object('claimed',false,'purchase',to_jsonb(o)); end if;
  -- Never retry an old key whose provider retention is unqualified. Three
  -- attempts within two minutes only; older ambiguity requires reconciliation.
  if o.checkout_attempts>=3 or (o.checkout_started_at is not null and o.checkout_started_at<at_-interval '2 minutes') then
    raise exception 'Checkout requires provider reconciliation' using errcode='PT409'; end if;
  if o.checkout_last_attempt is not null and o.checkout_last_attempt>at_-interval '15 seconds' then
    return jsonb_build_object('claimed',false,'purchase',to_jsonb(o)); end if;
  update makeborne_private.topup_orders set checkout_request=p_request,checkout_started_at=coalesce(checkout_started_at,at_),
    checkout_last_attempt=at_,checkout_attempts=checkout_attempts+1 where id=o.id returning * into o;
  return jsonb_build_object('claimed',true,'purchase',to_jsonb(o));
end $$;

create function makeborne_private.save_topup_checkout(p_user uuid,p_order uuid,p_checkout text,p_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o makeborne_private.topup_orders%rowtype;
begin
  perform makeborne_private.bind_topup_checkout(p_user,p_order,p_checkout);
  select * into o from makeborne_private.topup_orders where id=p_order and user_id=p_user for update;
  if p_url is null or p_url !~ '^https://(sandbox\.)?whop\.com/checkout/(plan|ch)_[A-Za-z0-9]+/?(\?[^#[:space:]]*)?$'
    or length(p_url)>2000 then raise exception 'Invalid checkout URL' using errcode='22023'; end if;
  if o.checkout_url is not null and o.checkout_url<>p_url then raise exception 'Checkout URL already bound' using errcode='PT409'; end if;
  update makeborne_private.topup_orders set checkout_url=p_url where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create function makeborne_private.bind_topup_checkout(p_user uuid,p_order uuid,p_checkout text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o makeborne_private.topup_orders%rowtype;
begin
  perform makeborne_private.lock_credit_wallet(p_user);
  select * into o from makeborne_private.topup_orders where id=p_order and user_id=p_user for update;
  if not found then raise exception 'Purchase unavailable' using errcode='P0002'; end if;
  if p_checkout is null or p_checkout !~ '^ch_[A-Za-z0-9]+$' then raise exception 'Invalid checkout' using errcode='22023'; end if;
  if o.checkout_id is not null and o.checkout_id <> p_checkout then raise exception 'Checkout already bound' using errcode='PT409'; end if;
  update makeborne_private.topup_orders set checkout_id=p_checkout where id=p_order returning * into o;
  return to_jsonb(o);
end $$;

create function makeborne_private.reconcile_topup(p_user uuid,p_order uuid,p_payment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o makeborne_private.topup_orders%rowtype; l makeborne_private.credit_lots%rowtype;
  at_ timestamptz; refund_ bigint; principal_ bigint; next_ text; free_ bigint; h record; ref_ text; evidence_ jsonb;
begin
  -- Same lock order as every reserve/settle/grant: account wallet before order/lot.
  perform makeborne_private.lock_credit_wallet(p_user);
  select * into o from makeborne_private.topup_orders where id=p_order and user_id=p_user for update;
  if not found then raise exception 'Purchase unavailable' using errcode='P0002'; end if;
  if p_payment is null or jsonb_typeof(p_payment)<>'object' or octet_length(p_payment::text)>4096 then raise exception 'Invalid evidence' using errcode='22023'; end if;
  if o.checkout_id is null or (p_payment->>'merchantId') is distinct from o.merchant_id
    or (p_payment->>'planId') is distinct from o.plan_id or (p_payment->>'checkoutId') is distinct from o.checkout_id
    or (p_payment->>'whopUserId') is distinct from o.whop_user_id or (p_payment->>'currency') is distinct from 'usd'
    or (p_payment->>'id') is null or (p_payment->>'id') !~ '^pay_[A-Za-z0-9]+$'
    or (p_payment->>'principalCents') is null or (p_payment->>'principalCents') !~ '^[1-9][0-9]{0,12}$'
    or (p_payment->>'refundedPrincipalCents') is null or (p_payment->>'refundedPrincipalCents') !~ '^(0|[1-9][0-9]{0,12})$'
    or (p_payment->>'status') is null or (p_payment->>'status') not in ('paid','refunded','pending','failed')
    or (p_payment->>'dispute') is null or (p_payment->>'dispute') not in ('none','open','won','lost')
    or (p_payment->>'updatedAt') is null then raise exception 'Evidence does not match purchase' using errcode='PT409'; end if;
  principal_:=(p_payment->>'principalCents')::bigint; refund_:=(p_payment->>'refundedPrincipalCents')::bigint;
  at_:=(p_payment->>'updatedAt')::timestamptz;
  if principal_<>o.price_cents or refund_>principal_ or not isfinite(at_) or at_>clock_timestamp()+interval '5 minutes'
    or ((p_payment->>'status')='refunded' and refund_<>principal_)
    or ((p_payment->>'status') in ('pending','failed') and refund_<>0)
    then raise exception 'Invalid amount or state' using errcode='22023'; end if;
  if o.payment_id is not null and o.payment_id<>(p_payment->>'id') then
    if (p_payment->>'status') in ('pending','failed') then return jsonb_build_object('outcome','ignored_attempt','state',o.state); end if;
    raise exception 'Payment already bound' using errcode='PT409'; end if;
  evidence_:=jsonb_build_object('id',p_payment->>'id','merchantId',o.merchant_id,'planId',o.plan_id,'checkoutId',o.checkout_id,
    'whopUserId',o.whop_user_id,'currency','usd','principalCents',principal_::text,'refundedPrincipalCents',refund_::text,
    'status',p_payment->>'status','dispute',p_payment->>'dispute','updatedAt',at_);
  -- Failed/pending attempts do not own the purchase. A different successful
  -- attempt may arrive out of order; compare clocks only within a payment.
  if o.observed_at is not null and ((o.evidence->>'id')=(p_payment->>'id') or o.payment_id is not null) then
    if at_<o.observed_at then return jsonb_build_object('outcome','stale','state',o.state); end if;
    if at_=o.observed_at then
      if evidence_<>o.evidence then raise exception 'Conflicting evidence timestamp' using errcode='PT409'; end if;
      return jsonb_build_object('outcome','duplicate','state',o.state);
    end if;
    if refund_<(o.evidence->>'refundedPrincipalCents')::bigint then raise exception 'Refund evidence regressed' using errcode='PT409'; end if;
    if o.granted and (p_payment->>'status') in ('pending','failed') then raise exception 'Funded payment regressed' using errcode='PT409'; end if;
  end if;
  next_:=case when refund_=principal_ or o.state='reversed' then 'reversed'
    when refund_>0 or (p_payment->>'dispute') in ('open','lost') then 'held'
    when (p_payment->>'status')='paid' then 'funded' else 'awaiting_payment' end;
  if next_='funded' and not o.granted then
    perform makeborne_private.credit_grant(p_user,o.credits,'topup','credit_topup:'||(p_payment->>'id')||':grant',
      jsonb_build_object('purchase',o.id,'payment',p_payment->>'id','catalogVersion',o.catalog_version));
    select * into l from makeborne_private.credit_lots where user_id=p_user and source='topup' and reference='credit_topup:'||(p_payment->>'id')||':grant' for update;
    o.lot_id:=l.id; o.granted:=true;
  elsif o.granted and next_ in ('held','reversed') then
    -- Abort any in-flight reservation using this lot before withholding it.
    -- Late provider results see a released hold and cannot save/charge a build.
    for h in select distinct r.reference from makeborne_private.credit_reservations r
      join makeborne_private.credit_hold_lots hl on hl.user_id=r.user_id and hl.reference=r.reference
      where r.user_id=p_user and r.status='reserved' and hl.lot_id=o.lot_id order by r.reference loop
      perform makeborne_private.resolve_hold(p_user,h.reference,0,'release',now(),jsonb_build_object('reason','credit pack payment under review','purchase',o.id));
    end loop;
    select * into l from makeborne_private.credit_lots where id=o.lot_id for update;
    free_:=l.amount-l.spent-l.held-l.lapsed;
    if free_>0 then
      update makeborne_private.credit_lots set lapsed=lapsed+free_ where id=o.lot_id;
      o.withheld_credits:=o.withheld_credits+free_;
      ref_:='credit_topup:'||(p_payment->>'id')||':withhold:'||(o.revision+1)::text;
      insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
        values(p_user,-free_,'adjust',ref_,makeborne_private.credit_available(p_user),jsonb_build_object('purchase',o.id,'reason',next_));
    end if;
    o.consumed_exposure_credits:=l.spent;
  elsif o.granted and o.state='held' and next_='funded' and o.withheld_credits>0 then
    select * into l from makeborne_private.credit_lots where id=o.lot_id for update;
    update makeborne_private.credit_lots set lapsed=lapsed-o.withheld_credits where id=o.lot_id;
    ref_:='credit_topup:'||(p_payment->>'id')||':restore:'||(o.revision+1)::text;
    insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,metadata)
      values(p_user,o.withheld_credits,'adjust',ref_,makeborne_private.credit_available(p_user),jsonb_build_object('purchase',o.id,'reason','payment review resolved'));
    o.withheld_credits:=0;
  end if;
  update makeborne_private.topup_orders set payment_id=case when (p_payment->>'status') in ('paid','refunded') then p_payment->>'id' else payment_id end,
    state=next_,granted=o.granted,lot_id=o.lot_id,
    withheld_credits=o.withheld_credits,consumed_exposure_credits=o.consumed_exposure_credits,
    evidence=evidence_,observed_at=at_,revision=o.revision+1 where id=o.id;
  insert into makeborne_private.topup_observations(order_id,revision,evidence,outcome,observed_at)
    values(o.id,o.revision+1,evidence_,next_,at_);
  perform makeborne_private.refresh_wallet_cache(p_user);
  return jsonb_build_object('outcome','updated','state',next_,'granted',o.granted,'withheldCredits',o.withheld_credits,
    'consumedExposureCredits',o.consumed_exposure_credits,'needsReview',next_='held' or (next_='reversed' and o.consumed_exposure_credits>0));
end $$;

create function public.makeborne_prepare_topup(p_user uuid,p_request uuid,p_pack text,p_version text,p_whop_user text)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.prepare_topup(p_user,p_request,p_pack,p_version,p_whop_user) $$;
create function public.makeborne_bind_topup_checkout(p_user uuid,p_order uuid,p_checkout text)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.bind_topup_checkout(p_user,p_order,p_checkout) $$;
create function public.makeborne_reconcile_topup(p_user uuid,p_order uuid,p_payment jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.reconcile_topup(p_user,p_order,p_payment) $$;
create function public.makeborne_claim_topup_checkout(p_user uuid,p_order uuid,p_request jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.claim_topup_checkout(p_user,p_order,p_request) $$;
create function public.makeborne_save_topup_checkout(p_user uuid,p_order uuid,p_checkout text,p_url text)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.save_topup_checkout(p_user,p_order,p_checkout,p_url) $$;
create function makeborne_private.topup_catalog_available(p_version text,p_merchant text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',pack_id,'credits',credits,'priceCents',price_cents)), '[]'::jsonb)
  from makeborne_private.topup_catalog where version=p_version and merchant_id=p_merchant and enabled;
$$;
create function public.makeborne_topup_catalog_available(p_version text,p_merchant text)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.topup_catalog_available(p_version,p_merchant) $$;
create function makeborne_private.topup_due_orders(p_limit integer,p_stale_seconds integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from (
    select id,user_id,merchant_id,plan_id,whop_user_id,checkout_id,payment_id,payment_scan_cursor
    from makeborne_private.topup_orders
    where (checkout_id is not null or checkout_started_at is not null)
      and (last_checked_at is null or last_checked_at<now()-make_interval(secs=>greatest(60,least(p_stale_seconds,86400))))
    order by last_checked_at nulls first,created_at,id limit greatest(1,least(p_limit,101))
  ) o;
$$;
create function makeborne_private.topup_record_check(p_order uuid,p_cursor text,p_error text,p_run bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from makeborne_private.billing_job_runs where id=p_run and job='credit_topups' and status='running' and lease_until>clock_timestamp()) then
    raise exception 'Credit-pack job lease lost' using errcode='PT409'; end if;
  if length(p_cursor)>2000 or (p_error is not null and p_error !~ '^[A-Z0-9_]{1,100}$') then
    raise exception 'Invalid check result' using errcode='22023'; end if;
  update makeborne_private.topup_orders set last_checked_at=clock_timestamp(),payment_scan_cursor=p_cursor,reconcile_error=p_error where id=p_order;
  return found;
end $$;
create function public.makeborne_topup_due_orders(p_limit integer,p_stale_seconds integer)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.topup_due_orders(p_limit,p_stale_seconds) $$;
create function public.makeborne_topup_record_check(p_order uuid,p_cursor text,p_error text,p_run bigint)
returns boolean language sql security invoker set search_path='' as $$ select makeborne_private.topup_record_check(p_order,p_cursor,p_error,p_run) $$;
create function makeborne_private.topup_job_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('lastRun',(select to_jsonb(r) from makeborne_private.billing_job_runs r where job='credit_topups' order by started_at desc,id desc limit 1),
    'openIssues',(select count(*) from makeborne_private.topup_orders where reconcile_error is not null),
    'unchecked',(select count(*) from makeborne_private.topup_orders where checkout_id is not null and last_checked_at is null),
    'consumedRefundExposure',(select coalesce(sum(consumed_exposure_credits),0) from makeborne_private.topup_orders where state in ('held','reversed')),
    'overdue',coalesce((select max(finished_at) from makeborne_private.billing_job_runs where job='credit_topups' and status='succeeded')<now()-interval '36 hours',true));
$$;
create function public.makeborne_topup_job_health()
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.topup_job_health() $$;

-- Trusted provider retrieval supplies these identifiers. Lookup itself cannot
-- grant credits; reconciliation rechecks every frozen identity and amount.
create function makeborne_private.find_topup_payment(p_payment text,p_checkout text,p_plan text,p_merchant text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o makeborne_private.topup_orders%rowtype; matches_ integer;
begin
  if p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]+$'
    or p_checkout is null or p_checkout !~ '^ch_[A-Za-z0-9]+$'
    or p_plan is null or p_plan !~ '^plan_[A-Za-z0-9]+$'
    or p_merchant is null or p_merchant !~ '^biz_[A-Za-z0-9]+$' then
    raise exception 'Invalid provider identifiers' using errcode='22023'; end if;
  select count(*) into matches_ from makeborne_private.topup_orders where payment_id=p_payment or checkout_id=p_checkout;
  if matches_>1 then raise exception 'Payment binding conflicts' using errcode='PT409'; end if;
  select * into o from makeborne_private.topup_orders where payment_id=p_payment or checkout_id=p_checkout;
  return jsonb_build_object('purchase',case when found then to_jsonb(o) else null end,
    'knownPack',exists(select 1 from makeborne_private.topup_catalog where merchant_id=p_merchant and plan_id=p_plan));
end $$;
create function public.makeborne_find_topup_payment(p_payment text,p_checkout text,p_plan text,p_merchant text)
returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.find_topup_payment(p_payment,p_checkout,p_plan,p_merchant) $$;
do $$ declare f text; begin
  foreach f in array array['makeborne_private.prepare_topup(uuid,uuid,text,text,text)','makeborne_private.bind_topup_checkout(uuid,uuid,text)',
    'makeborne_private.reconcile_topup(uuid,uuid,jsonb)','public.makeborne_prepare_topup(uuid,uuid,text,text,text)',
    'public.makeborne_bind_topup_checkout(uuid,uuid,text)','public.makeborne_reconcile_topup(uuid,uuid,jsonb)',
    'makeborne_private.find_topup_payment(text,text,text,text)','public.makeborne_find_topup_payment(text,text,text,text)',
    'makeborne_private.claim_topup_checkout(uuid,uuid,jsonb)','public.makeborne_claim_topup_checkout(uuid,uuid,jsonb)',
    'makeborne_private.save_topup_checkout(uuid,uuid,text,text)','public.makeborne_save_topup_checkout(uuid,uuid,text,text)',
    'makeborne_private.topup_catalog_available(text,text)','public.makeborne_topup_catalog_available(text,text)',
    'makeborne_private.topup_due_orders(integer,integer)','public.makeborne_topup_due_orders(integer,integer)',
    'makeborne_private.topup_record_check(uuid,text,text,bigint)','public.makeborne_topup_record_check(uuid,text,text,bigint)',
    'makeborne_private.topup_job_health()','public.makeborne_topup_job_health()'] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
