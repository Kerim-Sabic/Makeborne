-- Missing-first-webhook recovery. Additive; production activation remains separate.
begin;
create table makeborne_private.checkout_recoveries (
  request_id uuid primary key references public.billing_checkouts(request_id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','recovered','review')),
  lease uuid, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  membership_id text, payment_id text,
  last_code text not null default 'unverified' check(length(last_code)<=60),
  updated_at timestamptz not null default now()
);
alter table makeborne_private.checkout_recoveries enable row level security;
revoke all on makeborne_private.checkout_recoveries from public,anon,authenticated,service_role;
create index checkout_recovery_due on makeborne_private.checkout_recoveries(next_attempt_at) where state='pending';

create function makeborne_private.claim_checkout_recovery(p_user uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.billing_checkouts; r makeborne_private.checkout_recoveries; token uuid;
begin
  select * into c from public.billing_checkouts where request_id=p_request and user_id=p_user and status='ready' and checkout_id is not null;
  if not found then return null; end if;
  insert into makeborne_private.checkout_recoveries(request_id) values(p_request) on conflict do nothing;
  select * into r from makeborne_private.checkout_recoveries where request_id=p_request for update;
  if r.state<>'pending' or r.next_attempt_at>now() or r.lease_until>now() then return null; end if;
  -- An established webhook binding needs no discovery. An interrupted recovery
  -- with its own receipt must still finish payment settlement after a restart.
  if r.membership_id is null and exists(select 1 from public.billing_memberships where checkout_id=c.checkout_id) then return null; end if;
  token:=gen_random_uuid();
  update makeborne_private.checkout_recoveries set lease=token,lease_until=now()+interval '120 seconds',next_attempt_at=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() where request_id=p_request;
  return jsonb_build_object('request_id',c.request_id,'user_id',c.user_id,'checkout_id',c.checkout_id,'plan_id',c.plan_id,'lease',token);
end $$;

create function makeborne_private.bind_checkout_recovery(p_request uuid,p_lease uuid,p_membership text,p_whop_user text,p_payment text,p_status text,p_period_end timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.billing_checkouts; r makeborne_private.checkout_recoveries; original public.billing_memberships;
begin
  select * into r from makeborne_private.checkout_recoveries where request_id=p_request for update;
  if not found or r.state<>'pending' or r.lease is distinct from p_lease or r.lease_until<=now() then return false; end if;
  select * into strict c from public.billing_checkouts where request_id=p_request and status='ready' and checkout_id is not null;
  if p_membership !~ '^mem_[A-Za-z0-9]+$' or p_whop_user !~ '^user_[A-Za-z0-9]+$' or p_payment !~ '^pay_[A-Za-z0-9]+$'
    or p_membership is null or p_whop_user is null or p_payment is null or p_status not in ('active','canceling') or p_status is null
    or p_period_end is null or p_period_end<=now() then raise exception 'Invalid recovery evidence' using errcode='22023'; end if;
  if (r.membership_id is not null and r.membership_id<>p_membership) or (r.payment_id is not null and r.payment_id<>p_payment) then
    raise exception 'Recovery binding cannot change' using errcode='42501'; end if;
  -- Match webhook's membership lock order, then let the existing creation and
  -- replacement triggers serialize the account. No fake webhook row is written.
  perform pg_advisory_xact_lock(hashtextextended(p_membership,0));
  select * into original from public.billing_memberships where membership_id=p_membership;
  if found and (original.user_id<>c.user_id or original.checkout_id<>c.checkout_id or original.plan_id<>c.plan_id or original.whop_user_id<>p_whop_user) then
    raise exception 'Membership binding cannot change' using errcode='42501'; end if;
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until,checked_at)
    values(p_membership,c.user_id,c.checkout_id,p_whop_user,c.plan_id,p_status,p_period_end,'1970-01-01',now()) on conflict(membership_id) do nothing;
  update makeborne_private.checkout_recoveries set membership_id=p_membership,payment_id=p_payment,updated_at=now() where request_id=p_request;
  return true;
end $$;

create function makeborne_private.finish_checkout_recovery(p_request uuid,p_lease uuid,p_state text,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_state is null or p_state not in ('pending','recovered','review') or p_code is null or p_code !~ '^[a-z_]{1,60}$' then raise exception 'Invalid recovery outcome' using errcode='22023'; end if;
  update makeborne_private.checkout_recoveries set state=p_state,last_code=p_code,lease=null,lease_until=null,next_attempt_at=now()+interval '60 seconds',updated_at=now()
    where request_id=p_request and lease=p_lease and lease_until>now() and (p_state<>'recovered' or exists(
      select 1 from makeborne_private.plan_payments p join public.billing_checkouts c on c.request_id=p_request
      where p.payment_id=checkout_recoveries.payment_id and p.membership_id=checkout_recoveries.membership_id
        and p.user_id=c.user_id and p.plan_id=c.plan_id and p.state='funded'));
  return found;
end $$;

create function makeborne_private.due_checkout_recoveries(p_limit integer default 11) returns table(user_id uuid,request_id uuid)
language sql stable security definer set search_path='' as $$
  select c.user_id,c.request_id from public.billing_checkouts c left join makeborne_private.checkout_recoveries r on r.request_id=c.request_id
  where c.status='ready' and c.checkout_id is not null and (r.request_id is null or (r.state='pending' and r.next_attempt_at<=now() and coalesce(r.lease_until,'1970-01-01')<=now()))
    and (r.membership_id is not null or not exists(select 1 from public.billing_memberships m where m.checkout_id=c.checkout_id))
  order by coalesce(r.updated_at,'1970-01-01'),c.created_at,c.request_id limit least(greatest(coalesce(p_limit,11),1),50);
$$;

revoke all on function makeborne_private.claim_checkout_recovery(uuid,uuid),makeborne_private.bind_checkout_recovery(uuid,uuid,text,text,text,text,timestamptz),makeborne_private.finish_checkout_recovery(uuid,uuid,text,text),makeborne_private.due_checkout_recoveries(integer) from public,anon,authenticated;
grant execute on function makeborne_private.claim_checkout_recovery(uuid,uuid),makeborne_private.bind_checkout_recovery(uuid,uuid,text,text,text,text,timestamptz),makeborne_private.finish_checkout_recovery(uuid,uuid,text,text),makeborne_private.due_checkout_recoveries(integer) to service_role;
create function public.makeborne_claim_checkout_recovery(p_user uuid,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select makeborne_private.claim_checkout_recovery(p_user,p_request)$$;
create function public.makeborne_bind_checkout_recovery(p_request uuid,p_lease uuid,p_membership text,p_whop_user text,p_payment text,p_status text,p_period_end timestamptz) returns boolean language sql security invoker set search_path='' as $$select makeborne_private.bind_checkout_recovery(p_request,p_lease,p_membership,p_whop_user,p_payment,p_status,p_period_end)$$;
create function public.makeborne_finish_checkout_recovery(p_request uuid,p_lease uuid,p_state text,p_code text) returns boolean language sql security invoker set search_path='' as $$select makeborne_private.finish_checkout_recovery(p_request,p_lease,p_state,p_code)$$;
create function public.makeborne_due_checkout_recoveries(p_limit integer default 11) returns table(user_id uuid,request_id uuid) language sql stable security invoker set search_path='' as $$select * from makeborne_private.due_checkout_recoveries(p_limit)$$;
revoke all on function public.makeborne_claim_checkout_recovery(uuid,uuid),public.makeborne_bind_checkout_recovery(uuid,uuid,text,text,text,text,timestamptz),public.makeborne_finish_checkout_recovery(uuid,uuid,text,text),public.makeborne_due_checkout_recoveries(integer) from public,anon,authenticated;
grant execute on function public.makeborne_claim_checkout_recovery(uuid,uuid),public.makeborne_bind_checkout_recovery(uuid,uuid,text,text,text,text,timestamptz),public.makeborne_finish_checkout_recovery(uuid,uuid,text,text),public.makeborne_due_checkout_recoveries(integer) to service_role;
create function makeborne_private.checkout_recovery_health() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('needsReview',count(*) filter(where state='review'),'pending',count(*) filter(where state='pending'),
    'due',count(*) filter(where state='pending' and next_attempt_at<=now() and coalesce(lease_until,'1970-01-01')<=now())) from makeborne_private.checkout_recoveries;
$$;
revoke all on function makeborne_private.checkout_recovery_health() from public,anon,authenticated;
grant execute on function makeborne_private.checkout_recovery_health() to service_role;
create function public.makeborne_checkout_recovery_health() returns jsonb language sql stable security invoker set search_path='' as $$select makeborne_private.checkout_recovery_health()$$;
revoke all on function public.makeborne_checkout_recovery_health() from public,anon,authenticated;
grant execute on function public.makeborne_checkout_recovery_health() to service_role;
commit;
