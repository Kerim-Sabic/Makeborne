-- Per-person daily limits (20261026120100). Disposable local stack only; everything rolls back.
-- Run: docker exec -i supabase_db_makeborne-journey-audit psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-research-daily-limits.sql
\set ON_ERROR_STOP on
begin;

-- A. Service role only: browsers and anon can neither take uses nor read the table.
do $$
begin
 assert has_function_privilege('service_role','public.makeborne_research_daily_take(uuid,uuid,text)','execute'),'the server takes uses';
 assert not has_function_privilege('authenticated','public.makeborne_research_daily_take(uuid,uuid,text)','execute'),'browsers cannot take or skip uses';
 assert not has_function_privilege('anon','public.makeborne_research_daily_take(uuid,uuid,text)','execute'),'anon cannot';
 assert not has_table_privilege('authenticated','makeborne_private.research_daily_uses','select') and not has_table_privilege('authenticated','makeborne_private.research_daily_uses','delete')
  and not has_table_privilege('service_role','makeborne_private.research_daily_uses','delete'),'nobody resets a count directly';
 raise notice 'PASS limits A: service role only; the usage table is not readable or writable by any API role';
end $$;

-- B. 100 website checks per person in 24 hours, then a refusal with when to retry; kinds and people are counted apart.
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); r jsonb; i integer;
begin
 set local role service_role;
 for i in 1..100 loop r:=public.makeborne_research_daily_take(a,w,'site_check'); assert (r->>'allowed')::boolean and (r->>'used')::int=i,'use '||i; end loop;
 r:=public.makeborne_research_daily_take(a,w,'site_check');
 assert not (r->>'allowed')::boolean and (r->>'limit')::int=100 and (r->>'retryAt')::timestamptz>now()+interval '23 hours','101st refused with a retry time: '||r::text;
 r:=public.makeborne_research_daily_take(a,gen_random_uuid(),'site_check'); assert not (r->>'allowed')::boolean,'another workspace does not reset a person''s limit';
 r:=public.makeborne_research_daily_take(a,w,'client_research'); assert (r->>'allowed')::boolean and (r->>'limit')::int=30,'research is counted apart';
 r:=public.makeborne_research_daily_take(b,w,'site_check'); assert (r->>'allowed')::boolean and (r->>'used')::int=1,'another person is counted apart';
 begin perform public.makeborne_research_daily_take(a,w,'crawl'); raise exception 'unknown kind'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_research_daily_take(null,w,'site_check'); raise exception 'no actor'; exception when insufficient_privilege then null; end;
 reset role;
 -- The window rolls: uses older than 24 hours no longer count, and ones older than two days are removed.
 update makeborne_private.research_daily_uses set used_at=now()-interval '25 hours' where actor_id=a and kind='site_check';
 insert into makeborne_private.research_daily_uses(actor_id,workspace_id,kind,used_at) values(a,w,'site_check',now()-interval '3 days');
 set local role service_role;
 r:=public.makeborne_research_daily_take(a,w,'site_check'); assert (r->>'allowed')::boolean and (r->>'used')::int=1,'after 24 hours the person can check again';
 reset role;
 assert (select count(*) from makeborne_private.research_daily_uses where actor_id=a and used_at<now()-interval '2 days')=0,'old uses removed';
 raise notice 'PASS limits B: 100 checks per person per 24 hours then refused with a retry time; research (30) and other people counted apart; the window rolls';
end $$;

-- C. 30 research runs per person in 24 hours.
do $$
declare a uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); r jsonb; i integer;
begin
 set local role service_role;
 for i in 1..30 loop r:=public.makeborne_research_daily_take(a,w,'client_research'); assert (r->>'allowed')::boolean,'run '||i; end loop;
 r:=public.makeborne_research_daily_take(a,w,'client_research'); assert not (r->>'allowed')::boolean and (r->>'limit')::int=30,'31st refused';
 reset role;
 raise notice 'PASS limits C: 30 research runs per person per 24 hours';
end $$;

rollback;
