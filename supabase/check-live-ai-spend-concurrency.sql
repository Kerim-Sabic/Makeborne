-- Live AI spend gate under real concurrent sessions (dblink). ISOLATED DATABASE ONLY.
-- It commits fixtures and temporarily enables limits, so it refuses to run in the
-- main database or any database that already has live provider calls or enabled
-- limits. Cleanup restores the limits to disabled and removes its fixtures.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -d makeborne_crm_isolated -v ON_ERROR_STOP=1 < supabase/check-live-ai-spend-concurrency.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema extensions;
do $$
declare
  conn text := format('host=supabase_db_makeborne-local port=5432 dbname=%s user=postgres password=postgres', current_database());
  u uuid := gen_random_uuid(); users uuid[] := array(select gen_random_uuid() from generate_series(1,8)); i integer; ok integer := 0; limited integer := 0; err text; w record; call uuid := gen_random_uuid();
  cleanup text := $c$
    delete from makeborne_private.live_provider_calls; delete from makeborne_private.live_provider_days;
    update makeborne_private.live_provider_limits set enabled = false, emergency_stop = false, daily_limit_microusd = 0, note = null;
  $c$;
begin
  if current_database() = 'postgres' or exists(select 1 from makeborne_private.live_provider_calls)
     or exists(select 1 from makeborne_private.live_provider_limits where enabled or daily_limit_microusd > 0) then
    raise exception 'Refusing to run: use a disposable database with no live provider calls and disabled limits.';
  end if;
  perform extensions.dblink_connect('admin', conn);
  perform extensions.dblink_exec('admin', format('insert into auth.users(id,email,email_confirmed_at) select x, x||''@live-conc.example.invalid'', now() from unnest(%L::uuid[]) x',
    array_append(users, u)));
  begin
    perform * from extensions.dblink('admin', $q$select makeborne_private.set_live_provider_limit(s, true, 300000, false, 'Concurrency fixture')::text from unnest(array['global','anthropic','openai']) s$q$) as r(v text);
    -- Eight users on eight sessions (as separate app instances would be): hold the global
    -- limit row so all eight begins queue, then release them together.
    perform extensions.dblink_exec('admin', 'begin');
    perform * from extensions.dblink('admin', $q$select scope from makeborne_private.live_provider_limits where scope = 'global' for update$q$) as r(v text);
    for i in 1..8 loop
      perform extensions.dblink_connect('racer'||i, conn);
      perform extensions.dblink_send_query('racer'||i, format('select public.makeborne_provider_call_begin(%L,%L,%L,''anthropic'',''claude-opus-5-5'',100000)::text', gen_random_uuid(), users[i], 'run-'||i));
    end loop;
    perform pg_sleep(0.5);
    perform extensions.dblink_exec('admin', 'commit');
    for i in 1..8 loop
      if exists(select 1 from extensions.dblink_get_result('racer'||i, false) as r(v text)) then ok := ok + 1;
      else
        err := extensions.dblink_error_message('racer'||i);
        if err like '%spending limit reached%' then limited := limited + 1; else raise exception 'Unexpected racer error: %', err; end if;
      end if;
      perform extensions.dblink_disconnect('racer'||i);
    end loop;
    assert ok = 3 and limited = 5, format('Concurrent begins: %s admitted, %s limited', ok, limited);
    select * into w from extensions.dblink('admin', $q$select (select reserved_microusd from makeborne_private.live_provider_days where scope='global'),
      (select count(*) from makeborne_private.live_provider_calls where status='open')$q$) as r(reserved bigint, open bigint);
    assert w.reserved = 300000 and w.open = 3, format('Reservations wrong: %s', row_to_json(w));
    raise notice 'PASS 8 users on 8 concurrent sessions against a limit for 3: exactly 3 admitted, reservations exact';

    -- Finish racing the stale-call sweeper on the same call: closed exactly once.
    perform * from extensions.dblink('admin', $q$select makeborne_private.set_live_provider_limit('global', true, 1000000, false, 'Concurrency fixture: room for the race')::text$q$) as r(v text);
    perform * from extensions.dblink('admin', format($q$select public.makeborne_provider_call_begin(%L,%L,'run-race','openai','gpt-image-1',1)::text$q$, call, u)) as r(v text);
    perform extensions.dblink_exec('admin', 'begin');
    perform * from extensions.dblink('admin', $q$select scope from makeborne_private.live_provider_limits where scope = 'global' for update$q$) as r(v text);
    perform extensions.dblink_exec('admin', format($q$update makeborne_private.live_provider_calls set created_at = clock_timestamp() - interval '21 minutes' where id = %L$q$, call));
    perform extensions.dblink_connect('finisher', conn);
    perform extensions.dblink_send_query('finisher', format('select public.makeborne_provider_call_finish(%L, 1, 1, ''{}'')::text', call));
    perform extensions.dblink_connect('sweeper', conn);
    perform extensions.dblink_send_query('sweeper', 'select public.makeborne_provider_calls_expire(100)::text');
    perform pg_sleep(0.3);
    perform extensions.dblink_exec('admin', 'commit');
    perform * from extensions.dblink_get_result('finisher') as r(v text); perform extensions.dblink_disconnect('finisher');
    perform * from extensions.dblink_get_result('sweeper') as r(v text); perform extensions.dblink_disconnect('sweeper');
    select * into w from extensions.dblink('admin', format($q$select status, charged_microusd, (select spent_microusd from makeborne_private.live_provider_days where scope='openai')
      from makeborne_private.live_provider_calls where id = %L$q$, call)) as r(status text, charged bigint, openai_spent bigint);
    assert w.status in ('settled','expired') and w.charged = 1 and w.openai_spent = 1, format('Finish/expire race wrong: %s', row_to_json(w));
    raise notice 'PASS finish racing the sweeper: the call is closed exactly once (%)', w.status;
  exception when others or assert_failure then   -- assert failures are not caught by OTHERS
    begin perform extensions.dblink_exec('admin', 'rollback'); exception when others then null; end;
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x <> 'admin';
    perform extensions.dblink_exec('admin', cleanup);
    perform extensions.dblink_exec('admin', format('delete from auth.users where id = any(%L::uuid[])', array_append(users, u)));
    perform extensions.dblink_disconnect('admin');
    raise;
  end;
  perform extensions.dblink_exec('admin', cleanup);
  perform extensions.dblink_exec('admin', format('delete from auth.users where id = any(%L::uuid[])', array_append(users, u)));
  perform extensions.dblink_disconnect('admin');
end $$;
rollback;
