-- Billing foundation. Apply and verify before setting the billing migration flag.
-- All creation remains disabled until the operator explicitly activates the
-- database switch, allowlisted creation plans, and the server feature flag.
begin;

create table public.billing_checkouts (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check(plan_id ~ '^plan_[A-Za-z0-9]+$' and plan_id <> 'plan_B7Dgm9ZqM3V0M'),
  checkout_id text unique check(checkout_id ~ '^ch_[A-Za-z0-9]+$'),
  return_path text not null check(length(return_path) <= 2000 and (return_path like '/studio%' or return_path = '/chat')),
  purchase_url text,
  status text not null default 'pending' check(status in ('pending','ready')),
  created_at timestamptz not null default now(),
  unique(checkout_id,user_id,plan_id)
);
create index billing_checkouts_user on public.billing_checkouts(user_id,created_at desc);
alter table public.billing_checkouts enable row level security;
revoke all on public.billing_checkouts from public,anon,authenticated;
grant select,insert,update on public.billing_checkouts to service_role;

create table public.billing_memberships (
  membership_id text primary key check(membership_id ~ '^mem_[A-Za-z0-9]+$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_id text not null,
  whop_user_id text not null check(whop_user_id ~ '^user_[A-Za-z0-9]+$'),
  plan_id text not null check(plan_id <> 'plan_B7Dgm9ZqM3V0M'),
  status text not null,
  period_end timestamptz,
  verified_until timestamptz not null default '1970-01-01',
  checked_at timestamptz not null default now(),
  foreign key(checkout_id,user_id,plan_id) references public.billing_checkouts(checkout_id,user_id,plan_id),
  check(verified_until <= checked_at + interval '5 minutes'),
  check(verified_until <= coalesce(period_end,'1970-01-01'::timestamptz))
);
create index billing_memberships_user on public.billing_memberships(user_id);
alter table public.billing_memberships enable row level security;
revoke all on public.billing_memberships from public,anon,authenticated;
grant select,insert,update on public.billing_memberships to service_role;

create table public.billing_webhook_events (
  id text primary key check(length(id) between 1 and 200),
  membership_id text not null,
  processed_at timestamptz not null default now()
);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from public,anon,authenticated;
grant select,insert on public.billing_webhook_events to service_role;

create table makeborne_private.billing_settings (
  singleton boolean primary key default true check(singleton),
  creation_enabled boolean not null default false
);
insert into makeborne_private.billing_settings(singleton,creation_enabled) values(true,false);
create table makeborne_private.billing_access_plans (
  plan_id text primary key check(plan_id ~ '^plan_[A-Za-z0-9]+$' and plan_id <> 'plan_B7Dgm9ZqM3V0M'),
  enabled boolean not null default false
);
alter table makeborne_private.billing_settings enable row level security;
alter table makeborne_private.billing_access_plans enable row level security;
revoke all on makeborne_private.billing_settings,makeborne_private.billing_access_plans from public,anon,authenticated;
grant select,insert,update on makeborne_private.billing_settings,makeborne_private.billing_access_plans to service_role;

create function public.makeborne_billing_creation_enabled(p_plan_id text default null) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
    and (p_plan_id is null or exists(select 1 from makeborne_private.billing_access_plans where plan_id=p_plan_id and enabled));
$$;
revoke all on function public.makeborne_billing_creation_enabled(text) from public,anon,authenticated;
grant execute on function public.makeborne_billing_creation_enabled(text) to service_role;

create function makeborne_private.has_creation_membership() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
  and exists(
    select 1 from public.billing_memberships m
    join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
    where m.user_id=(select auth.uid()) and m.status in ('active','canceling')
      and m.period_end>now() and m.verified_until>now()
  );
$$;
revoke all on function makeborne_private.has_creation_membership() from public,anon;
grant execute on function makeborne_private.has_creation_membership() to authenticated,service_role;

-- Storage and existing mutation policies use this same helper. Keep reads
-- available to the authorized account while requiring paid access for writes.
create or replace function makeborne_private.can_edit(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select makeborne_private.has_creation_membership() and (makeborne_private.is_owner(target) or exists(
    select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=(select auth.uid()) and m.role='editor'));
$$;

-- A trigger also covers writes inside security-definer RPCs and direct Data API
-- calls. No browser role can refresh membership verification or billing flags.
create function makeborne_private.require_creation_membership_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role())='authenticated' and not makeborne_private.has_creation_membership() then
    raise exception 'Verified creation membership required' using errcode='MB402';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function makeborne_private.require_creation_membership_write() from public,anon,authenticated;
do $$ declare item text; begin
  foreach item in array array['workspaces','workspace_members','clients','contacts','projects','style_profiles','sources','assets','artifacts','artifact_versions','tasks','reviews','generation_jobs','budget_reservations','usage_ledger','published_releases','audit_events'] loop
    execute format('create trigger require_creation_membership before insert or update or delete on public.%I for each row execute function makeborne_private.require_creation_membership_write()',item);
  end loop;
end $$;

create function public.makeborne_record_whop_membership(
  p_event_id text,p_user_id uuid,p_membership_id text,p_checkout_id text,p_whop_user_id text,
  p_plan_id text,p_status text,p_period_end timestamptz,p_verified_until timestamptz
) returns void language plpgsql security invoker set search_path='' as $$
declare original public.billing_memberships;
begin
  -- Serialize duplicate deliveries and concurrent updates for one membership.
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id,0));
  if exists(select 1 from public.billing_webhook_events where id=p_event_id) then return; end if;
  if not exists(select 1 from public.billing_checkouts where checkout_id=p_checkout_id and user_id=p_user_id and plan_id=p_plan_id and status='ready') then
    raise exception 'Checkout binding missing' using errcode='42501';
  end if;
  select * into original from public.billing_memberships where membership_id=p_membership_id;
  if found and (original.user_id<>p_user_id or original.checkout_id<>p_checkout_id or original.whop_user_id<>p_whop_user_id or original.plan_id<>p_plan_id) then
    raise exception 'Membership binding cannot change' using errcode='42501';
  end if;
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until,checked_at)
  values(p_membership_id,p_user_id,p_checkout_id,p_whop_user_id,p_plan_id,p_status,p_period_end,least(p_verified_until,now()+interval '5 minutes',coalesce(p_period_end,'1970-01-01'::timestamptz)),now())
  on conflict(membership_id) do update set status=excluded.status,period_end=excluded.period_end,verified_until=excluded.verified_until,checked_at=excluded.checked_at;
  insert into public.billing_webhook_events(id,membership_id) values(p_event_id,p_membership_id);
end;
$$;
revoke all on function public.makeborne_record_whop_membership(text,uuid,text,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.makeborne_record_whop_membership(text,uuid,text,text,text,text,text,timestamptz,timestamptz) to service_role;

commit;
