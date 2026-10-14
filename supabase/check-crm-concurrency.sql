-- CRM transition concurrency across real sessions (dblink). ISOLATED DATABASE ONLY.
-- It commits fixtures and runs freeze/contract/rollback, which act on EVERY
-- client, so it refuses to run in the main database or any database holding
-- clients or CRM audit rows. Create a disposable database first; see
-- docs/CRM_STAGE_TRANSITION.md, "Concurrency check". Cleanup removes its own
-- fixtures and restores the transition flags; the database is meant to be
-- dropped afterwards.
\set ON_ERROR_STOP on
-- ---- G. Real concurrent sessions: freeze drains in-flight writes, blocks new ones, late writes rejected.
begin;
create extension if not exists dblink with schema extensions;
do $$
declare
  conn text:=format('host=supabase_db_makeborne-local port=5432 dbname=%s user=postgres password=postgres', current_database());
  u uuid:=gen_random_uuid(); ws uuid:=gen_random_uuid(); cl uuid:=gen_random_uuid();
  saved record; outcome text;
  base text := '{"stage":"Contacted","channel":"Email","profileUrl":"","lastContact":null,"nextFollowUp":null,"notes":"","activity":[]}';
  new_app text := 'select set_config(''request.headers'',''{"x-makeborne-crm-protocol":"2"}'',false)';
  old_server text := 'select set_config(''request.headers'',''{"accept":"application/json"}'',false)';
begin
  -- Isolation guard: this check COMMITS, and contract/rollback act on every client.
  if current_database() = 'postgres' or exists(select 1 from public.clients)
    or exists(select 1 from makeborne_private.crm_migration_audit)
    or (select mode<>'expand' or frozen from makeborne_private.crm_transition where singleton) then
    raise exception 'Refusing to run: use a disposable database with no clients, no CRM audit rows and an unfrozen expand state (see docs/CRM_STAGE_TRANSITION.md, "Concurrency check").';
  end if;
  perform extensions.dblink_connect('admin',conn);
  select * into saved from extensions.dblink('admin','select mode,min_client_protocol,frozen,frozen_reason from makeborne_private.crm_transition where singleton')
    as s(mode text,min_client_protocol int,frozen boolean,frozen_reason text);
  assert saved.mode='expand' and not saved.frozen, 'Run G from an unfrozen expand state, not '||row_to_json(saved);
  begin
    perform extensions.dblink_exec('admin',format('insert into auth.users(id,email,email_confirmed_at) values(%L,%L,now())',u,u||'@crm-g.example.invalid'));
    perform extensions.dblink_exec('admin',format('insert into public.workspaces(id,name,owner_id) values(%L,%L,%L)',ws,'CRM concurrency',u));
    perform extensions.dblink_exec('admin',format('insert into public.clients(id,workspace_id,name,outreach) values(%L,%L,%L,%L::jsonb)',cl,ws,'Concurrent',base));

    -- 1. An in-flight write holds the gate; the freeze waits for it to commit (drain).
    perform extensions.dblink_connect('inflight',conn);
    perform * from extensions.dblink('inflight',new_app) as s(v text);
    perform extensions.dblink_exec('inflight','begin');
    perform extensions.dblink_exec('inflight',format('update public.clients set outreach=jsonb_set(outreach,''{notes}'',''"in flight"'') where id=%L',cl));
    perform extensions.dblink_connect('freezer',conn);
    perform extensions.dblink_send_query('freezer','select makeborne_private.crm_freeze_writes(''drain test'')::text');
    perform pg_sleep(0.6);
    assert extensions.dblink_is_busy('freezer')=1, 'Freeze did not wait for the in-flight write';
    perform extensions.dblink_exec('inflight','commit');
    perform * from extensions.dblink_get_result('freezer') as r(v text);
    perform * from extensions.dblink_get_result('freezer') as r(v text);
    assert (select v2 from extensions.dblink('admin',format('select outreach->>''notes'' from public.clients where id=%L',cl)) as s(v2 text))='in flight', 'In-flight write lost';
    outcome := extensions.dblink_exec('inflight',format('update public.clients set outreach=jsonb_set(outreach,''{notes}'',''"late"'') where id=%L',cl),false);
    assert outcome='ERROR' and extensions.dblink_error_message('inflight') like '%read-only%', 'Late write not frozen: '||coalesce(extensions.dblink_error_message('inflight'),'');

    -- 2. A write that starts while the freeze is still committing waits, then is rejected.
    perform * from extensions.dblink('admin','select makeborne_private.crm_resume_writes()::text') as r(v text);
    perform extensions.dblink_exec('freezer','begin');
    perform * from extensions.dblink('freezer','select makeborne_private.crm_freeze_writes(''race'')::text') as r(v text);
    perform extensions.dblink_send_query('inflight',format('update public.clients set outreach=jsonb_set(outreach,''{notes}'',''"racing"'') where id=%L returning id::text',cl));
    perform pg_sleep(0.6);
    assert extensions.dblink_is_busy('inflight')=1, 'A write slipped past an uncommitted freeze';
    perform extensions.dblink_exec('freezer','commit');
    begin
      perform * from extensions.dblink_get_result('inflight') as r(v text);
      raise exception 'Racing write succeeded during the freeze';
    exception when others then
      if sqlerrm not like '%read-only%' then raise; end if;
    end;
    perform * from extensions.dblink_get_result('inflight',false) as r(v text);

    -- 3. Contract; then late writes from an out-of-date server are rejected, current app works.
    perform * from extensions.dblink('admin','select makeborne_private.crm_contract_client_stages()::text') as r(v text);
    perform * from extensions.dblink('admin','select makeborne_private.crm_resume_writes()::text') as r(v text);
    perform extensions.dblink_connect('oldserver',conn);
    perform * from extensions.dblink('oldserver',old_server) as s(v text);
    outcome := extensions.dblink_exec('oldserver',format('update public.clients set outreach=jsonb_set(outreach,''{notes}'',''"old"'') where id=%L',cl),false);
    assert outcome='ERROR' and extensions.dblink_error_message('oldserver') like '%out of date%', 'Out-of-date server accepted after contract';
    outcome := extensions.dblink_exec('inflight',format('update public.clients set outreach=jsonb_set(outreach,''{stage}'',''"Conversation"'') where id=%L',cl),false);
    assert outcome<>'ERROR', 'Current app write failed after contract: '||coalesce(extensions.dblink_error_message('inflight'),'');

    -- 4. Rollback; restore and verify; previous app writes again.
    perform * from extensions.dblink('admin','select makeborne_private.crm_freeze_writes(''rollback'')::text') as r(v text);
    perform * from extensions.dblink('admin','select makeborne_private.crm_rollback_client_stages()::text') as r(v text);
    perform * from extensions.dblink('admin','select makeborne_private.crm_resume_writes()::text') as r(v text);
    outcome := extensions.dblink_exec('oldserver',format('update public.clients set outreach=jsonb_set(outreach,''{notes}'',''"old app again"'') where id=%L',cl),false);
    assert outcome<>'ERROR', 'Previous app blocked after rollback: '||coalesce(extensions.dblink_error_message('oldserver'),'');
    assert (select v2 from extensions.dblink('admin',format('select outreach->>''stage'' from public.clients where id=%L',cl)) as s(v2 text))='Replied', 'Rollback state wrong';
  exception when others or assert_failure then   -- assert failures are not caught by OTHERS
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x<>'admin';
    perform extensions.dblink_exec('admin',format('update makeborne_private.crm_transition set mode=%L,min_client_protocol=%s,frozen=%L,frozen_reason=%L where singleton',
      saved.mode,saved.min_client_protocol,saved.frozen,saved.frozen_reason));
    perform extensions.dblink_exec('admin',format('delete from makeborne_private.crm_migration_audit where entity_id=%L',cl));
    perform extensions.dblink_exec('admin',format('delete from public.workspaces where id=%L',ws));
    perform extensions.dblink_exec('admin',format('delete from auth.users where id=%L',u));
    perform extensions.dblink_disconnect('admin');
    raise;
  end;
  perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x<>'admin';
  perform extensions.dblink_exec('admin',format('update makeborne_private.crm_transition set mode=%L,min_client_protocol=%s,frozen=%L,frozen_reason=%L where singleton',
    saved.mode,saved.min_client_protocol,saved.frozen,saved.frozen_reason));
  perform extensions.dblink_exec('admin',format('delete from makeborne_private.crm_migration_audit where entity_id=%L',cl));
  perform extensions.dblink_exec('admin',format('delete from public.workspaces where id=%L',ws));
  perform extensions.dblink_exec('admin',format('delete from auth.users where id=%L',u));
  perform extensions.dblink_disconnect('admin');
  raise notice 'PASS G concurrency: freeze drained an in-flight write, blocked a racing write, out-of-date server rejected after contract, previous app restored after rollback';
end $$;
rollback;
