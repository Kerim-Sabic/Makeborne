-- CRM transition control: an enforceable write freeze, a compatibility cutoff
-- for out-of-date app versions, and provenance-preserving stage storage.
--
-- State (makeborne_private.crm_transition):
--   mode 'expand'      both app versions may run. Client stages are STORED in
--                      the previous app's vocabulary: a new-app "Conversation"
--                      keeps a stored Replied/Meeting, otherwise becomes
--                      Replied. Every such translation is audited.
--   mode 'contracted'  only current stages are accepted; writes through the API
--                      must come from an app that sends
--                      x-makeborne-crm-protocol >= min_client_protocol (2).
--   frozen             every client write is rejected (MB423), except by the
--                      transition functions themselves. Freezing waits for
--                      in-flight client writes: each write holds a share lock on
--                      the state row until it commits.
-- Procedures (freeze -> contract/rollback -> switch versions -> verify ->
-- resume) are in docs/CRM_STAGE_TRANSITION.md. Applies forward on top of
-- 20261011190000; idempotent.
begin;

-- ---------------------------------------------------------------------------
-- 1. State and audit.
-- ---------------------------------------------------------------------------
alter table makeborne_private.crm_transition
  add column if not exists mode text not null default 'expand' check (mode in ('expand','contracted')),
  add column if not exists min_client_protocol integer not null default 0 check (min_client_protocol between 0 and 1000),
  add column if not exists frozen boolean not null default false,
  add column if not exists frozen_reason text not null default '' check (length(frozen_reason) <= 200);
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='makeborne_private' and table_name='crm_transition' and column_name='legacy_client_stages') then
    execute $q$update makeborne_private.crm_transition set mode = case when legacy_client_stages then 'expand' else 'contracted' end,
      min_client_protocol = case when legacy_client_stages then 0 else 2 end$q$;
  end if;
end $$;

alter table makeborne_private.crm_migration_audit drop constraint if exists crm_migration_audit_action_check;
alter table makeborne_private.crm_migration_audit add constraint crm_migration_audit_action_check check (action in (
  'project_delivery_backfill','client_stage_contract','client_stage_rollback',
  -- expand mode stored a new-app stage in the previous app's vocabulary
  'client_stage_compat',
  -- an ordinary app/user stage change (rollback never overwrites these)
  'client_stage_change'));

-- The app protocol of the current API request; NULL outside PostgREST (operator SQL).
create or replace function makeborne_private.crm_request_protocol() returns integer
language plpgsql stable set search_path='' as $$
declare headers text := nullif(current_setting('request.headers', true), ''); raw text;
begin
  if headers is null then return null; end if;
  raw := substring(coalesce(headers::json->>'x-makeborne-crm-protocol','') from '^[0-9]{1,4}$');
  return coalesce(raw::integer, 0);
exception when others then
  return 0;
end $$;
revoke all on function makeborne_private.crm_request_protocol() from public,anon,authenticated,service_role;

-- Stages a client may hold in the current mode.
create or replace function makeborne_private.crm_client_stage_allowed(p_stage text) returns boolean
language sql stable security definer set search_path='' as $$
  select case (select mode from makeborne_private.crm_transition where singleton)
    when 'contracted' then p_stage in ('Lead','Contacted','Conversation','Proposal','Won','Lost')
    else p_stage in ('Lead','Contacted','Replied','Meeting','Proposal','Won','Lost') end;
$$;
revoke all on function makeborne_private.crm_client_stage_allowed(text) from public,anon;
grant execute on function makeborne_private.crm_client_stage_allowed(text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Client write guard (runs before validation; trigger order is by name).
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.crm_client_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s makeborne_private.crm_transition%rowtype; protocol integer; requested text; stored text;
begin
  -- Share lock until this write commits: a freeze waits for it, and a write
  -- that starts during a freeze waits for the freeze and then sees it.
  select * into s from makeborne_private.crm_transition where singleton for share;
  if current_setting('makeborne.crm_transition_writer', true) = 'on' then
    return coalesce(NEW, OLD);
  end if;
  if s.frozen then
    raise exception 'Client records are briefly read-only while Makeborne finishes an update. Try again in a minute.' using errcode='MB423';
  end if;
  protocol := makeborne_private.crm_request_protocol();
  if protocol is not null and protocol < s.min_client_protocol then
    raise exception 'This version of Makeborne is out of date. Reload the page to keep working with clients.' using errcode='MB426';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  requested := NEW.outreach->>'stage';
  if s.mode = 'expand' and requested = 'Conversation' then
    stored := case when TG_OP = 'UPDATE' and OLD.outreach->>'stage' in ('Replied','Meeting') then OLD.outreach->>'stage' else 'Replied' end;
    NEW.outreach := jsonb_set(NEW.outreach,'{stage}',to_jsonb(stored));
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_compat',NEW.workspace_id,NEW.id,requested,stored,false);
  end if;
  return NEW;
end $$;
revoke all on function makeborne_private.crm_client_write_guard() from public,anon,authenticated;
drop trigger if exists client_crm_guard on public.clients;
create trigger client_crm_guard before insert or update or delete on public.clients
  for each row execute function makeborne_private.crm_client_write_guard();

-- Records ordinary stage changes so a rollback never overwrites them.
create or replace function makeborne_private.crm_client_stage_events() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('makeborne.crm_transition_writer', true) = 'on' then return null; end if;
  if (OLD.outreach->>'stage') is distinct from (NEW.outreach->>'stage') then
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_change',NEW.workspace_id,NEW.id,coalesce(OLD.outreach->>'stage',''),coalesce(NEW.outreach->>'stage',''),
      coalesce(jsonb_array_length(NEW.outreach->'activity'),0) > coalesce(jsonb_array_length(OLD.outreach->'activity'),0));
  end if;
  return null;
end $$;
revoke all on function makeborne_private.crm_client_stage_events() from public,anon,authenticated;
drop trigger if exists client_crm_stage_events on public.clients;
create trigger client_crm_stage_events after update on public.clients
  for each row execute function makeborne_private.crm_client_stage_events();

-- ---------------------------------------------------------------------------
-- 3. Operator procedures. Run as the database owner only (execute is revoked
--    from public, anon, authenticated and service_role).
-- ---------------------------------------------------------------------------
-- Freezes client writes. Blocks until in-flight client writes commit (set
-- lock_timeout to bound the wait). Commit before contracting or rolling back.
create or replace function makeborne_private.crm_freeze_writes(p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update makeborne_private.crm_transition set frozen = true, frozen_reason = left(coalesce(p_reason,''),200), changed_at = now() where singleton;
  return makeborne_private.crm_transition_report();
end $$;

create or replace function makeborne_private.crm_transition_report() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('mode',s.mode,'frozen',s.frozen,'frozenReason',s.frozen_reason,'minClientProtocol',s.min_client_protocol,
    'clientsLegacyStages',(select count(*) from public.clients where outreach->>'stage' in ('Replied','Meeting','Review','Delivered')),
    'clientsCurrentOnlyStages',(select count(*) from public.clients where outreach->>'stage' = 'Conversation'),
    'consistent',case s.mode
      when 'contracted' then not exists(select 1 from public.clients where outreach->>'stage' in ('Replied','Meeting','Review','Delivered')) and s.min_client_protocol >= 2
      else not exists(select 1 from public.clients where outreach->>'stage' in ('Conversation','Review','Delivered')) and s.min_client_protocol = 0 end)
  from makeborne_private.crm_transition s where s.singleton;
$$;

-- Resumes writes only when the stored stages match the mode.
create or replace function makeborne_private.crm_resume_writes() returns jsonb
language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
  perform 1 from makeborne_private.crm_transition where singleton for update;
  report := makeborne_private.crm_transition_report();
  if not (report->>'consistent')::boolean then
    raise exception 'CRM stages do not match the transition mode; not resuming: %', report using errcode='MB409';
  end if;
  update makeborne_private.crm_transition set frozen = false, frozen_reason = '', changed_at = now() where singleton;
  return makeborne_private.crm_transition_report();
end $$;

-- CONTRACT (writes must be frozen): rewrites legacy stages, closes the previous
-- app's vocabulary and requires protocol 2 for API writes.
create or replace function makeborne_private.crm_contract_client_stages() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; total integer := 0; unlogged integer := 0; logged boolean;
begin
  if not (select frozen from makeborne_private.crm_transition where singleton for update) then
    raise exception 'Freeze CRM writes first: select makeborne_private.crm_freeze_writes(''contract'');' using errcode='MB409';
  end if;
  perform set_config('makeborne.crm_transition_writer','on',true);
  update makeborne_private.crm_transition set mode = 'contracted', min_client_protocol = 2, changed_at = now() where singleton;
  for item in
    select c.id, c.workspace_id, c.outreach, c.outreach->>'stage' as old_stage, makeborne_private.crm_sales_stage(c.outreach->>'stage') as new_stage
    from public.clients c where c.outreach->>'stage' in ('Replied','Meeting','Review','Delivered') for update of c
  loop
    logged := jsonb_array_length(item.outreach->'activity') < 300;
    update public.clients set outreach = makeborne_private.crm_log_stage_change(jsonb_set(item.outreach,'{stage}',to_jsonb(item.new_stage)),
      format('Stage: %s → %s. Sales and delivery stages are now separate; delivery is tracked on each project.',item.old_stage,item.new_stage))
    where id = item.id;
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_contract',item.workspace_id,item.id,item.old_stage,item.new_stage,logged);
    total := total + 1; if not logged then unlogged := unlogged + 1; end if;
  end loop;
  perform set_config('makeborne.crm_transition_writer','',true);
  return jsonb_build_object('clients',total,'historyFull',unlogged) || makeborne_private.crm_transition_report();
end $$;

-- ROLLBACK (writes must be frozen): returns every client to the previous app's
-- vocabulary and reopens it to the previous app. A client the contract moved
-- to Conversation, with no stage change since, gets its exact original stage
-- (Replied or Meeting) back; any other Conversation (chosen in the new app)
-- becomes Replied. Stages users changed after the contract are kept.
create or replace function makeborne_private.crm_rollback_client_stages() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; target text; total integer := 0; logged boolean;
begin
  if not (select frozen from makeborne_private.crm_transition where singleton for update) then
    raise exception 'Freeze CRM writes first: select makeborne_private.crm_freeze_writes(''rollback'');' using errcode='MB409';
  end if;
  perform set_config('makeborne.crm_transition_writer','on',true);
  update makeborne_private.crm_transition set mode = 'expand', min_client_protocol = 0, changed_at = now() where singleton;
  for item in
    select c.id, c.workspace_id, c.outreach, contract.old_value as original,
      exists(select 1 from makeborne_private.crm_migration_audit e
        where e.entity_id = c.id and e.action = 'client_stage_change' and e.id > contract.id) as changed_since
    from public.clients c
    left join lateral (select a.id, a.old_value, a.new_value from makeborne_private.crm_migration_audit a
      where a.entity_id = c.id and a.action = 'client_stage_contract' order by a.id desc limit 1) contract on true
    where c.outreach->>'stage' = 'Conversation'
    for update of c
  loop
    target := case when item.original in ('Replied','Meeting') and not item.changed_since then item.original else 'Replied' end;
    logged := jsonb_array_length(item.outreach->'activity') < 300;
    update public.clients set outreach = makeborne_private.crm_log_stage_change(jsonb_set(item.outreach,'{stage}',to_jsonb(target)),
      format('Stage: Conversation → %s (restored for the previous app version).',target))
    where id = item.id;
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_rollback',item.workspace_id,item.id,'Conversation',target,logged);
    total := total + 1;
  end loop;
  perform set_config('makeborne.crm_transition_writer','',true);
  return jsonb_build_object('clients',total) || makeborne_private.crm_transition_report();
end $$;

do $$ declare f text; begin
  foreach f in array array['makeborne_private.crm_freeze_writes(text)','makeborne_private.crm_transition_report()','makeborne_private.crm_resume_writes()',
    'makeborne_private.crm_contract_client_stages()','makeborne_private.crm_rollback_client_stages()'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Validation by mode (replaces the boolean switch of 20261011190000).
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.validate_client_outreach() returns trigger
language plpgsql set search_path='' as $$
declare v jsonb := new.outreach; item jsonb; k text; seen text[] := '{}'; previous jsonb;
begin
  if v is null then
    if tg_op='UPDATE' and old.outreach is not null then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    return new;
  end if;
  if jsonb_typeof(v)<>'object' or octet_length(v::text)>1000000
    or not (v ?& array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])
    or (v - array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])<>'{}'::jsonb
    or not makeborne_private.crm_client_stage_allowed(coalesce(v->>'stage',''))
    or coalesce(v->>'channel','') not in ('Not set','Email','Instagram','LinkedIn','Phone','Other')
    or jsonb_typeof(v->'profileUrl') is distinct from 'string' or length(v->>'profileUrl')>2000
    or ((v->>'profileUrl')<>'' and (v->>'profileUrl') !~ '^https?://[^/@[:space:]]+([/?#]|$)')
    or jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>5000
    or jsonb_typeof(v->'activity') is distinct from 'array' then
    raise exception 'Invalid outreach fields' using errcode='22023';
  end if;
  foreach k in array array['lastContact','nextFollowUp'] loop
    if v->k <> 'null'::jsonb then
      if jsonb_typeof(v->k)<>'string' or (v->>k) !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char((v->>k)::date,'YYYY-MM-DD')<>v->>k then
        raise exception 'Invalid outreach date' using errcode='22023';
      end if;
    end if;
  end loop;
  if jsonb_array_length(v->'activity')>300 then raise exception 'Outreach history limit reached' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(v->'activity') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['id','at','text','type'])
      or (item-array['id','at','text','type'])<>'{}'::jsonb
      or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'id')=any(seen)
      or jsonb_typeof(item->'at') is distinct from 'string'
      or (item->>'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
      or jsonb_typeof(item->'text') is distinct from 'string' or length(trim(item->>'text')) not between 1 and 2000
      or coalesce(item->>'type','') not in ('update','contact','note') then
      raise exception 'Invalid outreach history' using errcode='22023';
    end if;
    perform (item->>'at')::timestamptz;
    seen := array_append(seen,item->>'id');
  end loop;
  if tg_op='UPDATE' and old.outreach is not null then
    previous := old.outreach->'activity';
    if jsonb_array_length(v->'activity')<jsonb_array_length(previous) then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    for i in 0..jsonb_array_length(previous)-1 loop
      if previous->i is distinct from v->'activity'->i then
        raise exception 'Outreach history must be preserved' using errcode='22023';
      end if;
    end loop;
  end if;
  return new;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Invalid outreach date' using errcode='22023';
end;
$$;
revoke all on function makeborne_private.validate_client_outreach() from public,anon,authenticated;

drop function if exists makeborne_private.crm_legacy_client_stages_allowed();
alter table makeborne_private.crm_transition drop column if exists legacy_client_stages;

commit;
