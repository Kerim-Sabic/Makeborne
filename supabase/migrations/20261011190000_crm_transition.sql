-- CRM sales/delivery split: compatible transition, audited data changes and
-- atomic review decisions. Safe to apply while the previous app version is
-- still serving traffic (see docs/CRM_STAGE_TRANSITION.md for the exact order):
--   * client stages: the validator accepts the previous app's Replied/Meeting
--     until the transition is contracted; the directory accepts old and new
--     filter names and returns stored stages unchanged. No client row is
--     rewritten here. makeborne_private.crm_contract_client_stages() does that
--     after the new app is live; crm_rollback_client_stages() reverses it.
--   * every data change made by these functions is recorded in
--     makeborne_private.crm_migration_audit, including clients whose
--     append-only history is full (300 entries).
--   * a client review decision and the linked project's delivery stage commit
--     together, whoever the reviewer is (anonymous, signed in without a plan,
--     or a paying member). General membership checks are unchanged.
-- Idempotent: also brings databases that ran an earlier pre-release version of
-- 20261011180000 to the same schema.
begin;

alter table public.projects add column if not exists delivery_stage text not null default 'active'
  check (delivery_stage in ('active','in_review','changes_requested','delivered'));
grant update(delivery_stage) on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Transition state and audit.
-- ---------------------------------------------------------------------------
create table if not exists makeborne_private.crm_transition (
  singleton boolean primary key default true check (singleton),
  legacy_client_stages boolean not null default true,
  changed_at timestamptz not null default now()
);
insert into makeborne_private.crm_transition(singleton) values(true) on conflict do nothing;
alter table makeborne_private.crm_transition enable row level security;
revoke all on makeborne_private.crm_transition from public,anon,authenticated,service_role;

-- One row per data change made by the transition (never by normal app use).
create table if not exists makeborne_private.crm_migration_audit (
  id bigint generated always as identity primary key,
  action text not null check (action in ('project_delivery_backfill','client_stage_contract','client_stage_rollback')),
  workspace_id uuid not null,
  entity_id uuid not null,
  old_value text not null,
  new_value text not null,
  -- false when the client's history was full, so this row is the only record.
  history_logged boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_migration_audit_entity on makeborne_private.crm_migration_audit(entity_id, id);
alter table makeborne_private.crm_migration_audit enable row level security;
revoke all on makeborne_private.crm_migration_audit from public,anon,authenticated,service_role;

-- Whether the previous app's client stages are still accepted on write.
create or replace function makeborne_private.crm_legacy_client_stages_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select legacy_client_stages from makeborne_private.crm_transition where singleton),true);
$$;
revoke all on function makeborne_private.crm_legacy_client_stages_allowed() from public,anon;
grant execute on function makeborne_private.crm_legacy_client_stages_allowed() to authenticated,service_role;

-- The current sales stage a stored (possibly legacy) stage means.
create or replace function makeborne_private.crm_sales_stage(p_stage text) returns text
language sql immutable set search_path='' as $$
  select case p_stage when 'Replied' then 'Conversation' when 'Meeting' then 'Conversation'
    when 'Review' then 'Won' when 'Delivered' then 'Won' else p_stage end;
$$;
revoke all on function makeborne_private.crm_sales_stage(text) from public,anon;
grant execute on function makeborne_private.crm_sales_stage(text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Review decisions move the linked project, atomically.
-- ---------------------------------------------------------------------------
-- The membership trigger keeps blocking plan-less signed-in writes, with one
-- narrow exception: inside project_delivery_advance, which sets a
-- transaction-local marker naming one project, an UPDATE of that project that
-- changes nothing but delivery_stage (and the trigger-maintained updated_at)
-- is allowed. API callers cannot reach this path: the marker is set only by
-- that SECURITY DEFINER function, and table access stays behind RLS.
create or replace function makeborne_private.require_creation_membership_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Nested: NEW.id is only resolved for projects (other tables may lack it).
  if TG_TABLE_NAME = 'projects' and TG_OP = 'UPDATE' then
    if current_setting('makeborne.review_delivery_project', true) = (to_jsonb(NEW)->>'id')
      and (to_jsonb(NEW) - array['delivery_stage','updated_at']) = (to_jsonb(OLD) - array['delivery_stage','updated_at']) then
      return NEW;
    end if;
  end if;
  if (select auth.role())='authenticated' and not makeborne_private.has_creation_membership() then
    raise exception 'Verified creation membership required' using errcode='MB402';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function makeborne_private.require_creation_membership_write() from public,anon,authenticated;

-- Moves exactly one project's delivery stage. Raises (rolling back the caller,
-- e.g. the review decision) if the project is not in that workspace.
create or replace function makeborne_private.project_delivery_advance(p_workspace uuid,p_project uuid,p_stage text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_stage is null or p_stage not in ('in_review','changes_requested','delivered') then
    raise exception 'Invalid delivery stage' using errcode='22023';
  end if;
  if not exists(select 1 from public.projects where id = p_project and workspace_id = p_workspace) then
    raise exception 'Review project unavailable' using errcode='P0002';
  end if;
  perform set_config('makeborne.review_delivery_project', p_project::text, true);
  update public.projects set delivery_stage = p_stage
  where id = p_project and workspace_id = p_workspace and delivery_stage is distinct from p_stage;
  perform set_config('makeborne.review_delivery_project', '', true);
end $$;
revoke all on function makeborne_private.project_delivery_advance(uuid,uuid,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Audited data transitions.
-- ---------------------------------------------------------------------------
-- Projects: the earlier review flow wrote delivery into projects.status. Maps
--   review -> in_review, approved -> delivered, in_progress -> changes_requested
--   when the project's latest review decision asked for changes. Everything
--   else stays active. projects.status is left as stored. Safe with the
--   previous app (it never reads delivery_stage); runs at the end of this file.
create or replace function makeborne_private.crm_backfill_project_delivery() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; total integer := 0;
begin
  for item in
    select p.id, p.workspace_id, p.status, case
        when p.status = 'review' then 'in_review'
        when p.status = 'approved' then 'delivered'
        when p.status = 'in_progress' and (select l.decision from public.client_review_links l
          where l.project_id = p.id and l.workspace_id = p.workspace_id and l.decided_at is not null
          order by l.decided_at desc limit 1) = 'changes_requested' then 'changes_requested'
      end as stage
    from public.projects p
    where p.delivery_stage = 'active' and p.status in ('review','approved','in_progress')
      and not exists(select 1 from makeborne_private.crm_migration_audit a where a.entity_id = p.id and a.action = 'project_delivery_backfill')
    for update of p
  loop
    continue when item.stage is null;
    update public.projects set delivery_stage = item.stage where id = item.id;
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('project_delivery_backfill',item.workspace_id,item.id,'status:'||item.status,item.stage,false);
    total := total + 1;
  end loop;
  return jsonb_build_object('projects',total);
end $$;
revoke all on function makeborne_private.crm_backfill_project_delivery() from public,anon,authenticated,service_role;

-- Appends one entry to a client's append-only history if there is room.
create or replace function makeborne_private.crm_log_stage_change(p_outreach jsonb,p_text text) returns jsonb
language sql volatile set search_path='' as $$
  select case when jsonb_array_length(p_outreach->'activity') < 300 then jsonb_set(p_outreach,'{activity}',(p_outreach->'activity')||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'type','update','text',pg_catalog.left(p_text,2000))))
  else p_outreach end;
$$;
revoke all on function makeborne_private.crm_log_stage_change(jsonb,text) from public,anon,authenticated,service_role;

-- CONTRACT, after the new app is live: rewrites legacy client stages
--   Replied, Meeting -> Conversation; Review, Delivered -> Won
-- then stops accepting legacy stages. Every change is audited; the history
-- entry is added when the client's history has room.
create or replace function makeborne_private.crm_contract_client_stages() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; next_outreach jsonb; total integer := 0; unlogged integer := 0; logged boolean;
begin
  perform 1 from makeborne_private.crm_transition where singleton for update;
  for item in
    select c.id, c.workspace_id, c.outreach, c.outreach->>'stage' as old_stage, makeborne_private.crm_sales_stage(c.outreach->>'stage') as new_stage
    from public.clients c where c.outreach->>'stage' in ('Replied','Meeting','Review','Delivered') for update of c
  loop
    logged := jsonb_array_length(item.outreach->'activity') < 300;
    next_outreach := makeborne_private.crm_log_stage_change(jsonb_set(item.outreach,'{stage}',to_jsonb(item.new_stage)),
      format('Stage: %s → %s. Sales and delivery stages are now separate; delivery is tracked on each project.',item.old_stage,item.new_stage));
    update public.clients set outreach = next_outreach where id = item.id;
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_contract',item.workspace_id,item.id,item.old_stage,item.new_stage,logged);
    total := total + 1; if not logged then unlogged := unlogged + 1; end if;
  end loop;
  update makeborne_private.crm_transition set legacy_client_stages = false, changed_at = now() where singleton;
  return jsonb_build_object('clients',total,'historyFull',unlogged,'legacyStagesAccepted',false);
end $$;
revoke all on function makeborne_private.crm_contract_client_stages() from public,anon,authenticated,service_role;

-- ROLLBACK, before reverting to the previous app: accepts legacy stages again
-- and gives every client a stage the previous app can read. Clients the
-- contract rewrote get their exact original stage back (from the audit) when
-- their stage is still the migrated one; any remaining Conversation becomes
-- Replied. Audited like the contract.
create or replace function makeborne_private.crm_rollback_client_stages() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; target text; next_outreach jsonb; total integer := 0; logged boolean;
begin
  perform 1 from makeborne_private.crm_transition where singleton for update;
  update makeborne_private.crm_transition set legacy_client_stages = true, changed_at = now() where singleton;
  for item in
    select c.id, c.workspace_id, c.outreach, c.outreach->>'stage' as stage,
      (select a.old_value from makeborne_private.crm_migration_audit a
        where a.entity_id = c.id and a.action in ('client_stage_contract','client_stage_rollback') order by a.id desc limit 1) as last_old,
      (select a.action from makeborne_private.crm_migration_audit a
        where a.entity_id = c.id and a.action in ('client_stage_contract','client_stage_rollback') order by a.id desc limit 1) as last_action,
      (select a.new_value from makeborne_private.crm_migration_audit a
        where a.entity_id = c.id and a.action in ('client_stage_contract','client_stage_rollback') order by a.id desc limit 1) as last_new
    from public.clients c where c.outreach->>'stage' in ('Conversation','Won') for update of c
  loop
    target := case
      when item.last_action = 'client_stage_contract' and item.last_new = item.stage and item.last_old in ('Replied','Meeting') then item.last_old
      when item.stage = 'Conversation' then 'Replied'
    end;
    continue when target is null;
    logged := jsonb_array_length(item.outreach->'activity') < 300;
    next_outreach := makeborne_private.crm_log_stage_change(jsonb_set(item.outreach,'{stage}',to_jsonb(target)),
      format('Stage: %s → %s (restored for the previous app version).',item.stage,target));
    update public.clients set outreach = next_outreach where id = item.id;
    insert into makeborne_private.crm_migration_audit(action,workspace_id,entity_id,old_value,new_value,history_logged)
    values('client_stage_rollback',item.workspace_id,item.id,item.stage,target,logged);
    total := total + 1;
  end loop;
  return jsonb_build_object('clients',total,'legacyStagesAccepted',true);
end $$;
revoke all on function makeborne_private.crm_rollback_client_stages() from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3b. Client stage validation and directory accept both stage sets.
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
    or not (coalesce(v->>'stage','') in ('Lead','Contacted','Conversation','Proposal','Won','Lost')
      or (coalesce(v->>'stage','') in ('Replied','Meeting') and makeborne_private.crm_legacy_client_stages_allowed()))
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

create or replace function public.makeborne_client_directory(p_workspace_id uuid,p_search text,p_stage text,p_follow_up text,p_day date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_day is null or p_offset is null or p_offset not between 0 and 100000
 or p_stage is null or p_stage not in ('All stages','Lead','Contacted','Conversation','Replied','Meeting','Proposal','Won','Lost')
 or p_follow_up is null or p_follow_up not in ('all','overdue','today','upcoming','unscheduled') then raise exception 'Invalid directory filters' using errcode='22023'; end if;
 with base as materialized (
   select c.id,c.name,c.company,c.email,c.website,c.created_at,c.updated_at,
     coalesce(c.outreach->>'stage','Lead') as outreach_stage,c.outreach->>'nextFollowUp' as outreach_follow_up,
     case when makeborne_private.crm_sales_stage(c.outreach->>'stage') in ('Won','Lost') then 'closed'
       when c.outreach->>'nextFollowUp' is null then 'unscheduled'
       when c.outreach->>'nextFollowUp'<to_char(p_day,'YYYY-MM-DD') then 'overdue'
       when c.outreach->>'nextFollowUp'=to_char(p_day,'YYYY-MM-DD') then 'today'
       else 'upcoming' end as follow_up_bucket
   from public.clients c where c.workspace_id=p_workspace_id
 ), filtered as materialized (
   select * from base where (p_stage='All stages' or makeborne_private.crm_sales_stage(outreach_stage)=makeborne_private.crm_sales_stage(p_stage))
     and (p_follow_up='all' or follow_up_bucket=p_follow_up)
     and (p_search='' or strpos(lower(name||' '||company||' '||email),lower(p_search))>0)
 ), page as (
   select * from filtered order by
     case when p_follow_up<>'all' then outreach_follow_up end asc nulls last,
     case when p_follow_up='all' then created_at end desc,
     id asc limit 50 offset p_offset
 )
 select jsonb_build_object(
   'clients',coalesce((select jsonb_agg(to_jsonb(page)-'follow_up_bucket') from page),'[]'::jsonb),
   'pagination',jsonb_build_object('total',(select count(*) from filtered),'nextOffset',case when p_offset+50<(select count(*) from filtered) then p_offset+50 else null end),
   'counts',(select jsonb_build_object('all',count(*),'overdue',count(*) filter(where follow_up_bucket='overdue'),'today',count(*) filter(where follow_up_bucket='today'),'upcoming',count(*) filter(where follow_up_bucket='upcoming'),'unscheduled',count(*) filter(where follow_up_bucket='unscheduled')) from base)
 ) into result;
 return result;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Client reviews move only the linked project, atomically.
-- ---------------------------------------------------------------------------
create or replace function public.makeborne_decide_client_review(p_token text,p_name text,p_email text,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; c public.client_review_comments%rowtype; t record; v_title text;
  v_name text := makeborne_private.client_review_text(p_name);
  v_email text := lower(makeborne_private.client_review_text(p_email));
  v_note text := makeborne_private.client_review_text(p_note);
begin
  select * into r from makeborne_private.client_review_live_link(p_token,true);
  if p_decision is null or p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes' using errcode='22023'; end if;
  if length(v_name) not between 1 and 80 or position(E'\n' in v_name)>0 then raise exception 'Add your name (up to 80 characters)' using errcode='22023'; end if;
  if v_email<>'' and (length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Use a valid email or leave it empty' using errcode='22023'; end if;
  if length(v_note)>2000 then raise exception 'Notes are up to 2000 characters' using errcode='22023'; end if;
  if (select count(*) from public.client_review_comments where link_id=r.id and kind<>'comment')>=10 then
    raise exception 'This review already has its decision. Ask for a new link to review again.' using errcode='MB429';
  end if;
  select * into t from makeborne_private.client_review_target(r);
  update public.client_review_links set decision=p_decision,decision_name=v_name,decided_at=now(),decided_version=t.version_number where id=r.id;
  insert into public.client_review_comments(workspace_id,link_id,version_number,kind,author_name,author_email,body,anchor)
  values(r.workspace_id,r.id,t.version_number,p_decision,v_name,v_email,v_note,'{"kind":"general"}') returning * into c;
  -- The decision and the linked project's delivery stage commit together. The
  -- client's sales stage and the client's other projects are never touched.
  perform makeborne_private.project_delivery_advance(r.workspace_id,r.project_id,
    case when p_decision='approved' then 'delivered' else 'changes_requested' end);
  return jsonb_build_object('decision',jsonb_build_object('value',p_decision,'name',v_name,'at',now(),'version',t.version_number),
    'comment',makeborne_private.client_review_comment_json(c));
end $$;

create or replace function public.makeborne_create_client_review_link(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_latest boolean,
  p_token_hash bytea,p_days integer,p_recipient text,p_message text,p_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.artifacts%rowtype; r public.client_review_links%rowtype; v_content jsonb;
  v_recipient text := pg_catalog.left(makeborne_private.client_review_text(p_recipient),120);
  v_message text := makeborne_private.client_review_text(p_message);
begin
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if not makeborne_private.client_review_can_edit_as(p_actor,p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found then raise exception 'Artifact not found' using errcode='P0002'; end if;
  if p_version is null or p_version<1 or p_version>a.current_version or (p_latest and p_version<>a.current_version) then
    raise exception 'Save the latest version before sharing' using errcode='PT409';
  end if;
  select content into v_content from public.artifact_versions where artifact_id=p_artifact and workspace_id=p_workspace and version_number=p_version;
  if not found then raise exception 'Version not found' using errcode='P0002'; end if;
  if p_token_hash is null or octet_length(p_token_hash)<>32 or p_days is null or p_days not between 1 and 90
    or p_latest is null or length(v_message)>2000 then
    raise exception 'Invalid review link' using errcode='22023';
  end if;
  if (v_content ? 'websiteSource' or v_content ? 'website') and p_html is null
    and not exists(select 1 from public.client_review_snapshots where artifact_id=p_artifact and version_number=p_version) then
    raise exception 'Website review copy required' using errcode='22023';
  end if;
  if (select count(*) from public.client_review_links where artifact_id=p_artifact and revoked_at is null and expires_at>now())>=20
    or (select count(*) from public.client_review_links where workspace_id=p_workspace and revoked_at is null and expires_at>now())>=200
    or (select count(*) from public.client_review_links where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=60 then
    raise exception 'Review link limit reached. Revoke older links first.' using errcode='MB429';
  end if;
  if p_html is not null then
    if a.kind<>'website' or octet_length(p_html) not between 100 and 4000000 then raise exception 'Invalid review copy' using errcode='22023'; end if;
    insert into public.client_review_snapshots(artifact_id,version_number,workspace_id,html,created_by)
    values(p_artifact,p_version,p_workspace,p_html,p_actor)
    on conflict(artifact_id,version_number) do update set html=excluded.html,created_by=excluded.created_by,created_at=now();
  end if;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,version_number,recipient_name,message,expires_at,created_by)
  values(p_workspace,a.project_id,p_artifact,p_token_hash,case when p_latest then null else p_version end,v_recipient,v_message,now()+make_interval(days=>p_days),p_actor)
  returning * into r;
  perform makeborne_private.project_delivery_advance(p_workspace,a.project_id,'in_review');
  return to_jsonb(r)-'token_hash';
end $$;

drop function if exists makeborne_private.client_review_advance(uuid,uuid,text,text);
-- Superseded by the audited functions above (existed only in pre-release databases).
drop function if exists makeborne_private.crm_legacy_backfill();

-- A client's project list shows each project's delivery stage.
create or replace function public.makeborne_client_projects(p_workspace_id uuid,p_client_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 if not exists(select 1 from public.clients c where c.id=p_client_id and c.workspace_id=p_workspace_id) then raise exception 'Client unavailable' using errcode='P0002'; end if;
 with items as materialized (
   select p.id as "projectId",p.title as "projectTitle",p.status as "projectStatus",p.delivery_stage as "deliveryStage",p.updated_at as "projectUpdatedAt",coalesce(a.kind,p.kind) as kind,
     a.id as "artifactId",coalesce(a.title,p.title) as title,a.current_version as version,greatest(a.updated_at,p.updated_at) as "updatedAt"
   from public.projects p left join public.artifacts a on a.project_id=p.id and a.workspace_id=p.workspace_id
   where p.workspace_id=p_workspace_id and p.client_id=p_client_id
 ), page as (
   select * from items order by "updatedAt" desc,"projectId","artifactId" nulls first limit 50 offset p_offset
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'pagination',jsonb_build_object('total',(select count(*) from items),'nextOffset',case when p_offset+50<(select count(*) from items) then p_offset+50 else null end)) into result;
 return result;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Project delivery backfill (audited, idempotent).
-- ---------------------------------------------------------------------------
select makeborne_private.crm_backfill_project_delivery();

commit;
