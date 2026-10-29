-- Per-person daily limits for website checks and client research (launch security review 26 Oct, S12).
-- Forward-only. The routes had only per-instance busy counters, so one person could run checks and
-- research without limit across server instances. This is the repo's usual rolling-window limit
-- (as for publication preparations and review links): a count over the last 24 hours, taken in SQL
-- under a per-person lock, so it holds across every instance.
--
-- * makeborne_private.research_daily_uses: one row per started use (append-only; rows older than two
--   days are removed as uses are taken). Not exposed to the Data API.
-- * makeborne_research_daily_take(actor, workspace, kind): service role only. Takes one use, or
--   answers allowed=false with when the oldest use in the window ages out. The server calls it with
--   the verified session's user after its own editor check, before any page is fetched.
--   Limits: 'site_check' 100 (CRM website checks, prospect checks from the Lead finder included),
--   'client_research' 30 ("Understand this client"; a replay of the same request is not a new use).
begin;

create table makeborne_private.research_daily_uses (
 id bigint generated always as identity primary key,
 actor_id uuid not null,
 workspace_id uuid not null,
 kind text not null check (kind in ('site_check','client_research')),
 used_at timestamptz not null default now()
);
create index research_daily_uses_window on makeborne_private.research_daily_uses(actor_id, kind, used_at);
alter table makeborne_private.research_daily_uses enable row level security;
revoke all on makeborne_private.research_daily_uses from public, anon, authenticated, service_role;

create function public.makeborne_research_daily_take(p_actor uuid, p_workspace uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_limit integer := case p_kind when 'site_check' then 100 when 'client_research' then 30 end; v_used integer; v_oldest timestamptz;
begin
 if v_limit is null then raise exception 'Unknown limit' using errcode='22023'; end if;
 if p_actor is null or p_workspace is null then raise exception 'Actor required' using errcode='42501'; end if;
 -- One person's uses are counted and taken one at a time, so parallel requests cannot all fit under the limit.
 perform pg_advisory_xact_lock(hashtextextended('makeborne_research_daily:' || p_actor::text, 0));
 delete from makeborne_private.research_daily_uses where actor_id = p_actor and used_at < now() - interval '2 days';
 select count(*), min(used_at) into v_used, v_oldest from makeborne_private.research_daily_uses
  where actor_id = p_actor and kind = p_kind and used_at > now() - interval '1 day';
 if v_used >= v_limit then
  return jsonb_build_object('allowed', false, 'limit', v_limit, 'used', v_used, 'retryAt', v_oldest + interval '1 day');
 end if;
 insert into makeborne_private.research_daily_uses(actor_id, workspace_id, kind) values (p_actor, p_workspace, p_kind);
 return jsonb_build_object('allowed', true, 'limit', v_limit, 'used', v_used + 1);
end $$;
revoke all on function public.makeborne_research_daily_take(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.makeborne_research_daily_take(uuid, uuid, text) to service_role;

commit;
