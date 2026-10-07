begin;
create table makeborne_private.claude_pilot_budget (
 id boolean primary key default true check(id),
 limit_cents integer not null default 450 check(limit_cents between 0 and 450),
 reserved_cents integer not null default 0 check(reserved_cents between 0 and 450)
);
insert into makeborne_private.claude_pilot_budget(id) values(true);
create table public.claude_pilot_runs (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'reserved' check(status in ('reserved','completed','uncertain','rejected')),
 result jsonb,
 usage jsonb,
 created_at timestamptz not null default now()
);
alter table public.claude_pilot_runs enable row level security;
alter table makeborne_private.claude_pilot_budget enable row level security;
revoke all on public.claude_pilot_runs, makeborne_private.claude_pilot_budget from public,anon,authenticated;
grant select,insert,update on public.claude_pilot_runs to service_role;
create function makeborne_private.claim_claude_pilot(p_id uuid,p_user uuid,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare budget makeborne_private.claude_pilot_budget%rowtype;
begin
 if p_id is null or p_user is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or not makeborne_private.has_account_privilege(p_user,'admin') then return false; end if;
 select * into budget from makeborne_private.claude_pilot_budget where id=true for update;
 if not found or budget.reserved_cents+25 > budget.limit_cents then return false; end if;
 if exists(select 1 from public.claude_pilot_runs where id=p_id) then return false; end if;
 if exists(select 1 from public.claude_pilot_runs where user_id=p_user and created_at>now()-interval '15 seconds') then return false; end if;
 insert into public.claude_pilot_runs(id,user_id,request_hash) values(p_id,p_user,p_hash);
 update makeborne_private.claude_pilot_budget set reserved_cents=reserved_cents+25 where id=true;
 return true;
end $$;
revoke all on function makeborne_private.claim_claude_pilot(uuid,uuid,text) from public,anon,authenticated;
grant execute on function makeborne_private.claim_claude_pilot(uuid,uuid,text) to service_role;
create function public.makeborne_claim_claude_pilot(p_id uuid,p_user uuid,p_hash text) returns boolean
language sql security invoker set search_path='' as $$ select makeborne_private.claim_claude_pilot(p_id,p_user,p_hash); $$;
revoke all on function public.makeborne_claim_claude_pilot(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.makeborne_claim_claude_pilot(uuid,uuid,text) to service_role;
comment on table makeborne_private.claude_pilot_budget is 'Admin-only Claude test budget: at most 18 dispatches with conservative 25-cent reservations; 50 cents withheld for setup verification. Never replenish automatically. Holds remain on uncertain calls.';
commit;
