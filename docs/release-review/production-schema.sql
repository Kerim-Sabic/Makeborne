


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "makeborne_hosting";


ALTER SCHEMA "makeborne_hosting" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "makeborne_private";


ALTER SCHEMA "makeborne_private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.html from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  where s.slug=p_slug and s.live
  and exists(select 1 from auth.users u where u.id=s.owner_id and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) and (
    makeborne_private.has_account_privilege(s.owner_id,'admin') or exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=s.owner_id and m.status in ('active','canceling') and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    )
  );
$$;


ALTER FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_hosting"."save_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare w public.workspaces%rowtype; a public.artifacts%rowtype; s public.hosted_sites%rowtype;
begin
  select * into w from public.workspaces where id=p_workspace for update;
  if not found or w.owner_id is distinct from p_actor then raise exception 'Owner required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verified account required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found or a.kind<>'website' then raise exception 'Website not found' using errcode='P0002'; end if;
  select * into s from public.hosted_sites where artifact_id=p_artifact for update;
  if p_request is null then raise exception 'Request key required' using errcode='22023'; end if;
  if s.request_id=p_request then
    if s.live is distinct from p_live or s.slug is distinct from p_slug or (p_live and (s.version_number is distinct from p_version or s.html is distinct from p_html)) then raise exception 'Request changed' using errcode='MB409'; end if;
    return to_jsonb(s)-'html'-'owner_id'-'request_id';
  end if;
  if coalesce(s.revision,0)<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
  if p_live then
    if not makeborne_private.has_account_privilege(p_actor,'admin') and not exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=p_actor and m.status in ('active','canceling') and m.verified_until>now() and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    ) then raise exception 'Creation membership required' using errcode='MB402'; end if;
    if a.current_version<>p_version or not exists(select 1 from public.artifact_versions where artifact_id=p_artifact and version_number=p_version and workspace_id=p_workspace) then raise exception 'Save latest website first' using errcode='PT409'; end if;
    if p_html is null or octet_length(p_html) not between 100 and 4000000 then raise exception 'Website exceeds size limit' using errcode='22023'; end if;
    if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' or p_slug=any(array['admin','api','auth','billing','login','studio','support','www','makeborne','robots-txt','sitemap-xml']) then raise exception 'Invalid address' using errcode='22023'; end if;
    if s.artifact_id is not null and s.slug<>p_slug then raise exception 'Address is reserved for this website' using errcode='22023'; end if;
    if not coalesce(s.live,false) and (select count(*) from public.hosted_sites where workspace_id=p_workspace and live)>=5 then raise exception 'Five live sites per workspace' using errcode='MB429'; end if;
    if s.artifact_id is null and (select count(*) from public.hosted_sites where workspace_id=p_workspace)>=20 then raise exception 'Reserved address limit reached' using errcode='MB429'; end if;
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id)
    values(p_artifact,p_workspace,p_actor,p_slug,p_version,p_html,true,1,p_request)
    on conflict(artifact_id) do update set version_number=excluded.version_number,html=excluded.html,live=true,revision=hosted_sites.revision+1,request_id=p_request,updated_at=now()
    returning * into s;
  else
    if s.artifact_id is null then raise exception 'Website not published' using errcode='P0002'; end if;
    update public.hosted_sites set live=false,revision=revision+1,request_id=p_request,updated_at=now() where artifact_id=p_artifact returning * into s;
  end if;
  return to_jsonb(s)-'html'-'owner_id'-'request_id';
end $_$;


ALTER FUNCTION "makeborne_hosting"."save_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."audit_account_privilege_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if TG_OP <> 'DELETE' then NEW.updated_at=clock_timestamp(); end if;
  insert into makeborne_private.account_privilege_events(user_id,action,old_grant,new_grant,database_actor)
  values(coalesce(NEW.user_id,OLD.user_id),TG_OP,
    case when TG_OP <> 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP <> 'DELETE' then to_jsonb(NEW) end,session_user);
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;


ALTER FUNCTION "makeborne_private"."audit_account_privilege_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."begin_cloud_mutation"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $$
declare workspace_row public.workspaces; receipt makeborne_private.cloud_mutation_receipts; payload_hash text;
begin
  if (select auth.uid()) is null or p_request_key is null or not makeborne_private.can_edit(p_workspace_id) then
    raise exception 'Current editor permission required' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>2300000 then
    raise exception 'Invalid mutation payload' using errcode='22023';
  end if;
  select * into workspace_row from public.workspaces where id=p_workspace_id for update;
  if not found then raise exception 'Workspace unavailable' using errcode='P0002'; end if;
  -- Recheck authoritative membership after waiting for the workspace lock.
  if not makeborne_private.can_edit(p_workspace_id) then raise exception 'Current editor permission required' using errcode='42501'; end if;
  payload_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into receipt from makeborne_private.cloud_mutation_receipts
    where workspace_id=p_workspace_id and actor_id=(select auth.uid()) and operation=p_operation and request_key=p_request_key;
  if found then
    if receipt.payload_sha256<>payload_hash then raise exception 'Idempotency key payload mismatch' using errcode='MB409'; end if;
    if receipt.result is null or receipt.replay_until<=now() then
      raise exception 'Committed request replay expired; key remains reserved' using errcode='MB410';
    end if;
    return jsonb_build_object('replayed',true,'result',receipt.result);
  end if;
  if (select count(*) from makeborne_private.cloud_mutation_receipts where workspace_id=p_workspace_id)>=workspace_row.mutation_ledger_limit
    or (select count(*) from makeborne_private.cloud_mutation_receipts where workspace_id=p_workspace_id and created_at>now()-interval '24 hours')>=workspace_row.mutation_daily_limit then
    raise exception 'Workspace mutation receipt limit reached' using errcode='MB429';
  end if;
  insert into makeborne_private.cloud_mutation_receipts(workspace_id,actor_id,operation,request_key,payload_sha256)
    values(p_workspace_id,(select auth.uid()),p_operation,p_request_key,payload_hash);
  return jsonb_build_object('replayed',false);
end;
$$;


ALTER FUNCTION "makeborne_private"."begin_cloud_mutation"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."can_edit"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select makeborne_private.has_creation_membership() and (makeborne_private.is_owner(target) or exists(
    select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=(select auth.uid()) and m.role='editor'));
$$;


ALTER FUNCTION "makeborne_private"."can_edit"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."can_read"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select makeborne_private.is_owner(target) or exists(
    select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=(select auth.uid()));
$$;


ALTER FUNCTION "makeborne_private"."can_read"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;


ALTER FUNCTION "makeborne_private"."claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."claim_generation_dispatch"("p_reservation_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
 reservation makeborne_private.generation_reservations%rowtype;
 proposal makeborne_private.generation_proposals%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 prior makeborne_private.generation_dispatches%rowtype;
 target_workspace uuid; owner_id uuid; member_role text; latest_id uuid; artifact_kind text;
begin
 if p_actor is null or p_request_key is null then raise exception 'Actor and dispatch request key required' using errcode='22023'; end if;
 select workspace_id into target_workspace from makeborne_private.generation_reservations where id=p_reservation_id;
 if not found then raise exception 'Reservation unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=target_workspace for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 -- Shared lock order with reservation and cancellation; no provider call in SQL.
 select * into budget from makeborne_private.generation_budgets where workspace_id=target_workspace for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if reservation.approved_by is distinct from p_actor then raise exception 'Original approving actor required' using errcode='42501'; end if;
 select * into proposal from makeborne_private.generation_proposals where id=reservation.proposal_id;
 if p_approval_hash is distinct from proposal.approval_hash or p_approval_hash is distinct from reservation.approval_hash or p_current_input_hash is distinct from proposal.input_hash then raise exception 'Proposal approval changed' using errcode='PT409'; end if;
 select * into prior from makeborne_private.generation_dispatches where reservation_id=reservation.id;
 if found then
   return jsonb_build_object('dispatchId',prior.id,'claimed',false,'startedAt',prior.started_at);
 end if;
 if reservation.status<>'reserved' or reservation.dispatch_started_at is not null then raise exception 'Reservation is not available for dispatch' using errcode='PT409'; end if;
 if reservation.credits_waived and not makeborne_private.has_account_privilege(p_actor,'unlimited_credits') then raise exception 'Credit allowance changed; prepare a new reservation' using errcode='PT409'; end if;
 if not budget.spending_enabled or budget.emergency_stop then raise exception 'Generation spending disabled' using errcode='42501'; end if;
 if clock_timestamp()<proposal.prepared_at or clock_timestamp()>=proposal.expires_at then raise exception 'Proposal expired' using errcode='PT409'; end if;
 if budget.vendor_reserved<reservation.vendor_amount or budget.credit_reserved<reservation.credit_amount or budget.active_reservations<1 then raise exception 'Reservation counters require reconciliation' using errcode='PT409'; end if;
 if proposal.artifact_id is not null then
   select a.kind into artifact_kind from public.artifacts a where a.id=proposal.artifact_id and a.project_id=proposal.project_id and a.workspace_id=proposal.workspace_id for share;
   select v.id into latest_id from public.artifact_versions v where v.artifact_id=proposal.artifact_id and v.workspace_id=proposal.workspace_id order by v.version_number desc limit 1;
   if latest_id is distinct from proposal.base_version_id then raise exception 'Project version changed' using errcode='PT409'; end if;
 else
   select p.kind into artifact_kind from public.projects p where p.id=proposal.project_id and p.workspace_id=proposal.workspace_id for share;
 end if;
 if artifact_kind is distinct from proposal.snapshot#>>'{workflow,output}' then raise exception 'Project format changed' using errcode='PT409'; end if;
 if exists(select 1 from makeborne_private.generation_dispatches where request_key=p_request_key) then raise exception 'Dispatch request key reused' using errcode='PT409'; end if;
 insert into makeborne_private.generation_dispatches(reservation_id,request_key,actor_id)
 values(reservation.id,p_request_key,p_actor) returning * into prior;
 -- Until usage/result evidence resolves the job, its budgets must remain held.
 update makeborne_private.generation_reservations set dispatch_started_at=prior.started_at,status='uncertain' where id=reservation.id;
 return jsonb_build_object('dispatchId',prior.id,'claimed',true,'startedAt',prior.started_at);
end $$;


ALTER FUNCTION "makeborne_private"."claim_generation_dispatch"("p_reservation_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "makeborne_private"."claim_generation_dispatch"("p_reservation_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") IS 'Trusted worker only. Authenticate approving actor, verify canonical snapshot and current rights/route policy before calling. Commit and receive claimed=true before any external call. False, timeout or unknown commit outcome requires reconciliation, never blind redispatch. Claim is not proof of provider execution or a charge.';



CREATE OR REPLACE FUNCTION "makeborne_private"."create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $$
declare receipt jsonb; result_row jsonb; resource_uuid uuid; project_row public.projects;
begin
  if p_operation not in ('create_client','create_project','create_artifact') or p_operation is null then
    raise exception 'Unsupported operation' using errcode='22023';
  end if;
  receipt:=makeborne_private.begin_cloud_mutation(p_workspace_id,p_request_key,p_operation,p_payload);
  if (receipt->>'replayed')::boolean then
    return jsonb_build_object('record',receipt->'result'->'record','replayed',true);
  end if;
  if p_operation='create_client' then
    insert into public.clients as inserted(workspace_id,name,company,email,website,notes)
      values(p_workspace_id,p_payload->>'name',coalesce(p_payload->>'company',''),coalesce(p_payload->>'email',''),coalesce(p_payload->>'website',''),coalesce(p_payload->>'notes',''))
      returning to_jsonb(inserted),inserted.id into result_row,resource_uuid;
  elsif p_operation='create_project' then
    insert into public.projects as inserted(workspace_id,client_id,title,kind,status,style_id,brief,audience,purpose,wording)
      values(p_workspace_id,(p_payload->>'client_id')::uuid,p_payload->>'title',p_payload->>'kind',coalesce(p_payload->>'status','draft'),coalesce(p_payload->>'style_id','editorial'),coalesce(p_payload->>'brief',''),coalesce(p_payload->>'audience',''),coalesce(p_payload->>'purpose',''),coalesce(p_payload->>'wording','preserve'))
      returning to_jsonb(inserted),inserted.id into result_row,resource_uuid;
  else
    select * into project_row from public.projects where id=(p_payload->>'project_id')::uuid and workspace_id=p_workspace_id;
    if not found then raise exception 'Project unavailable' using errcode='P0002'; end if;
    if project_row.kind is distinct from p_payload->>'kind' then raise exception 'Artifact format mismatch' using errcode='22023'; end if;
    insert into public.artifacts as inserted(workspace_id,project_id,title,kind)
      values(p_workspace_id,project_row.id,p_payload->>'title',project_row.kind)
      returning to_jsonb(inserted),inserted.id into result_row,resource_uuid;
  end if;
  update makeborne_private.cloud_mutation_receipts set resource_id=resource_uuid,result=jsonb_build_object('record',result_row)
    where workspace_id=p_workspace_id and actor_id=(select auth.uid()) and operation=p_operation and request_key=p_request_key;
  return jsonb_build_object('record',result_row,'replayed',false);
end;
$$;


ALTER FUNCTION "makeborne_private"."create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $$
declare project_result jsonb; artifact_result jsonb; saved jsonb; project_row public.projects;
begin
  if p_content->>'kind' is distinct from p_project->>'kind' or p_content->>'title' is distinct from p_project->>'title'
    or p_style->>'id' is distinct from p_project->>'style_id' then
    raise exception 'Project content and style must match' using errcode='22023';
  end if;
  if coalesce(p_project->>'effort','medium') not in ('light','medium','high','super_high','ultra') then
    raise exception 'Invalid effort' using errcode='22023';
  end if;
  project_result:=makeborne_private.create_record(p_workspace_id,p_request_key,'create_project',p_project);
  if not (project_result->>'replayed')::boolean then
    update public.projects set effort=coalesce(p_project->>'effort','medium')
      where workspace_id=p_workspace_id and id=(project_result->'record'->>'id')::uuid;
  end if;
  select * into project_row from public.projects where workspace_id=p_workspace_id and id=(project_result->'record'->>'id')::uuid;
  if not found then raise exception 'Project unavailable' using errcode='P0002'; end if;
  artifact_result:=makeborne_private.create_record(p_workspace_id,p_request_key,'create_artifact',jsonb_build_object(
    'project_id',project_row.id,'title',p_project->>'title','kind',p_project->>'kind'));
  saved:=makeborne_private.save_idempotent_version(p_workspace_id,(artifact_result->'record'->>'id')::uuid,0,
    p_content,p_style,'[]'::jsonb,'Initial approved project',p_request_key);
  return saved || jsonb_build_object('project',to_jsonb(project_row));
end;
$$;


ALTER FUNCTION "makeborne_private"."create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."create_workspace"("p_request_key" "uuid", "p_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $$
declare actor uuid; receipt makeborne_private.workspace_creation_receipts; payload_hash text; saved public.workspaces;
begin
  actor:=(select auth.uid());
  if actor is null or p_request_key is null then raise exception 'Verified account required' using errcode='42501'; end if;
  if p_name is null or length(p_name) not between 1 and 160 then raise exception 'Invalid workspace name' using errcode='22023'; end if;
  -- Locks the authoritative account row before a workspace exists.
  perform 1 from auth.users where id=actor for update;
  if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
  payload_hash:=encode(sha256(convert_to(jsonb_build_object('name',p_name)::text,'UTF8')),'hex');
  select * into receipt from makeborne_private.workspace_creation_receipts where actor_id=actor and request_key=p_request_key;
  if found then
    if not makeborne_private.is_owner(receipt.workspace_id) then raise exception 'Current workspace ownership required' using errcode='42501'; end if;
    if receipt.payload_sha256<>payload_hash then raise exception 'Idempotency key payload mismatch' using errcode='MB409'; end if;
    if receipt.result is null or receipt.replay_until<=now() then raise exception 'Committed request replay expired; key remains reserved' using errcode='MB410'; end if;
    return jsonb_build_object('workspace',receipt.result,'replayed',true);
  end if;
  if exists(select 1 from public.workspaces where owner_id=actor) then raise exception 'Private workspace already exists' using errcode='MB412'; end if;
  if (select count(*) from makeborne_private.workspace_creation_receipts where actor_id=actor)>=1000 then raise exception 'Account receipt limit reached' using errcode='MB429'; end if;
  insert into public.workspaces as inserted(name,owner_id) values(p_name,actor) returning inserted.* into saved;
  insert into makeborne_private.workspace_creation_receipts(actor_id,request_key,payload_sha256,workspace_id,result)
    values(actor,p_request_key,payload_hash,saved.id,to_jsonb(saved));
  return jsonb_build_object('workspace',to_jsonb(saved),'replayed',false);
end;
$$;


ALTER FUNCTION "makeborne_private"."create_workspace"("p_request_key" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."has_account_privilege"("p_user_id" "uuid", "p_privilege" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists(
    select 1 from makeborne_private.account_privileges p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and case p_privilege when 'admin' then p.is_admin when 'unlimited_credits' then p.unlimited_credits else false end
  );
$$;


ALTER FUNCTION "makeborne_private"."has_account_privilege"("p_user_id" "uuid", "p_privilege" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."has_creation_membership"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select makeborne_private.has_account_privilege((select auth.uid()),'admin')
  or (coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
    and exists(
      select 1 from public.billing_memberships m
      join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=(select auth.uid()) and m.status in ('active','canceling')
        and m.period_end>now() and m.verified_until>now()
    ));
$$;


ALTER FUNCTION "makeborne_private"."has_creation_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."is_owner"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists(select 1 from public.workspaces w where w.id=target and w.owner_id=(select auth.uid()));
$$;


ALTER FUNCTION "makeborne_private"."is_owner"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."my_account_privileges"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object('userId',(select auth.uid()),
    'isAdmin',(select auth.role())='authenticated' and makeborne_private.has_account_privilege((select auth.uid()),'admin'),
    'unlimitedCredits',(select auth.role())='authenticated' and makeborne_private.has_account_privilege((select auth.uid()),'unlimited_credits'));
$$;


ALTER FUNCTION "makeborne_private"."my_account_privileges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."prune_cloud_mutation_results"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare affected integer; workspace_affected integer;
begin
  update makeborne_private.cloud_mutation_receipts set result=null where replay_until<=now() and result is not null;
  get diagnostics affected=row_count;
  update makeborne_private.workspace_creation_receipts set result=null where replay_until<=now() and result is not null;
  get diagnostics workspace_affected=row_count;
  return affected+workspace_affected;
end;
$$;


ALTER FUNCTION "makeborne_private"."prune_cloud_mutation_results"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."release_generation_reservation"("p_reservation_id" "uuid", "p_actor" "uuid", "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
 reservation makeborne_private.generation_reservations%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 target_workspace uuid; owner_id uuid; member_role text;
begin
 if p_actor is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'Actor and cancellation reason required' using errcode='22023'; end if;
 select workspace_id into target_workspace from makeborne_private.generation_reservations where id=p_reservation_id;
 if not found then raise exception 'Reservation unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=target_workspace for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 -- Same lock order as reservation/ future dispatch: workspace, budget, reservation.
 select * into budget from makeborne_private.generation_budgets where workspace_id=target_workspace for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if reservation.status='released' then return reservation.id; end if;
 if reservation.status<>'reserved' or reservation.dispatch_started_at is not null then raise exception 'Dispatched or unresolved work requires reconciliation' using errcode='PT409'; end if;
 if budget.vendor_reserved<reservation.vendor_amount or budget.credit_reserved<reservation.credit_amount or budget.active_reservations<1 then raise exception 'Reservation counters require reconciliation' using errcode='PT409'; end if;
 update makeborne_private.generation_budgets set vendor_reserved=vendor_reserved-reservation.vendor_amount,credit_reserved=credit_reserved-reservation.credit_amount,active_reservations=active_reservations-1,revision=revision+1 where workspace_id=target_workspace;
 update makeborne_private.generation_reservations set status='released',released_at=clock_timestamp(),released_by=p_actor,release_reason=btrim(p_reason) where id=reservation.id;
 return reservation.id;
end $$;


ALTER FUNCTION "makeborne_private"."release_generation_reservation"("p_reservation_id" "uuid", "p_actor" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "makeborne_private"."release_generation_reservation"("p_reservation_id" "uuid", "p_actor" "uuid", "p_reason" "text") IS 'Private trusted worker cancellation before dispatch only. Caller authenticates actor. Atomic and idempotent; does not refund actual charges. Dispatch must set dispatch_started_at transactionally before any external call.';



CREATE OR REPLACE FUNCTION "makeborne_private"."require_creation_membership_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.role())='authenticated' and not makeborne_private.has_creation_membership() then
    raise exception 'Verified creation membership required' using errcode='MB402';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$$;


ALTER FUNCTION "makeborne_private"."require_creation_membership_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."reserve_generation_proposal"("p_proposal_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
 proposal makeborne_private.generation_proposals%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 prior makeborne_private.generation_reservations%rowtype;
 owner_id uuid; member_role text; latest_id uuid; result_id uuid; artifact_kind text; waived boolean; customer_amount bigint;
begin
 if p_actor is null or p_request_key is null then raise exception 'Authenticated actor and request key required' using errcode='22023'; end if;
 select * into proposal from makeborne_private.generation_proposals where id=p_proposal_id;
 if not found then raise exception 'Proposal unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=proposal.workspace_id for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=proposal.workspace_id and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 if p_approval_hash is distinct from proposal.approval_hash or p_current_input_hash is distinct from proposal.input_hash then raise exception 'Proposal approval changed' using errcode='PT409'; end if;
 select * into budget from makeborne_private.generation_budgets where workspace_id=proposal.workspace_id for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into prior from makeborne_private.generation_reservations where workspace_id=proposal.workspace_id and request_key=p_request_key;
 if found then
   if prior.proposal_id<>proposal.id or prior.approved_by<>p_actor or prior.approval_hash<>p_approval_hash then raise exception 'Request key reused' using errcode='PT409'; end if;
   return prior.id;
 end if;
 if exists(select 1 from makeborne_private.generation_reservations where proposal_id=proposal.id) then raise exception 'Proposal already reserved' using errcode='PT409'; end if;
 if not budget.spending_enabled or budget.emergency_stop then raise exception 'Generation spending disabled' using errcode='42501'; end if;
 if clock_timestamp()<proposal.prepared_at or clock_timestamp()>=proposal.expires_at then raise exception 'Proposal expired' using errcode='PT409'; end if;
 if proposal.artifact_id is not null then
   select a.kind into artifact_kind from public.artifacts a where a.id=proposal.artifact_id and a.project_id=proposal.project_id and a.workspace_id=proposal.workspace_id for share;
   select v.id into latest_id from public.artifact_versions v where v.artifact_id=proposal.artifact_id and v.workspace_id=proposal.workspace_id order by v.version_number desc limit 1;
   if latest_id is distinct from proposal.base_version_id then raise exception 'Project version changed' using errcode='PT409'; end if;
 else
   select p.kind into artifact_kind from public.projects p where p.id=proposal.project_id and p.workspace_id=proposal.workspace_id for share;
 end if;
 if artifact_kind is distinct from proposal.snapshot#>>'{workflow,output}' then raise exception 'Project format changed' using errcode='PT409'; end if;
 if budget.active_reservations>=budget.concurrency_limit then raise exception 'Concurrency limit reached' using errcode='MB429'; end if;
 waived=makeborne_private.has_account_privilege(p_actor,'unlimited_credits');
 customer_amount=case when waived then 0 else proposal.maximum_customer_credits end;
 if budget.vendor_spent::numeric+budget.vendor_reserved+proposal.maximum_vendor_microusd>budget.vendor_limit
 or budget.credit_spent::numeric+budget.credit_reserved+customer_amount>budget.credit_limit then raise exception 'Insufficient generation budget' using errcode='MB402'; end if;
 insert into makeborne_private.generation_reservations(workspace_id,proposal_id,request_key,approved_by,approval_hash,vendor_amount,credit_amount,credits_waived)
 values(proposal.workspace_id,proposal.id,p_request_key,p_actor,p_approval_hash,proposal.maximum_vendor_microusd,customer_amount,waived) returning id into result_id;
 update makeborne_private.generation_budgets set vendor_reserved=vendor_reserved+proposal.maximum_vendor_microusd,credit_reserved=credit_reserved+customer_amount,active_reservations=active_reservations+1,revision=revision+1 where workspace_id=proposal.workspace_id;
 return result_id;
end $$;


ALTER FUNCTION "makeborne_private"."reserve_generation_proposal"("p_proposal_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "makeborne_private"."reserve_generation_proposal"("p_proposal_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") IS 'Trusted worker only. Caller authenticates actor and verifies canonical input/proposal hashes and current routing/rights policy. Transaction reserves two budgets; does not enqueue or dispatch. Spending defaults off.';



CREATE OR REPLACE FUNCTION "makeborne_private"."save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $_$
declare
  artifact_row public.artifacts;
  version_row public.artifact_versions;
  previous_id uuid;
  previous_content jsonb;
  protected record;
  replacement jsonb;
  section_value jsonb;
  block_value jsonb;
  reference_value text;
  element_ids text[] := array[]::text[];
  total_blocks integer := 0;
  total_references integer := 0;
begin
  if (select auth.uid()) is null or not makeborne_private.can_edit(p_workspace_id) then
    raise exception 'Editor permission required' using errcode='42501';
  end if;
  select * into artifact_row from public.artifacts a where a.id=p_artifact_id and a.workspace_id=p_workspace_id for update;
  if not found then raise exception 'Artifact unavailable' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<0 or artifact_row.current_version<>p_expected_version then
    raise exception 'Revision conflict' using errcode='PT409';
  end if;
  if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>2000000
    or p_content->'schemaVersion' is distinct from '1'::jsonb or p_content->>'kind' is distinct from artifact_row.kind
    or jsonb_typeof(p_content->'title') is distinct from 'string'
    or coalesce(length(p_content->>'title'),0) not between 1 and 200
    or jsonb_typeof(p_content->'sections') is distinct from 'array' then
    raise exception 'Invalid artifact content' using errcode='22023';
  end if;
  if jsonb_array_length(p_content->'sections')>1000 then raise exception 'Too many sections' using errcode='22023'; end if;
  if p_style is null or jsonb_typeof(p_style)<>'object' or octet_length(p_style::text)>262144
    or jsonb_typeof(p_style->'id') is distinct from 'string'
    or coalesce(length(p_style->>'id'),0) not between 1 and 120
    or jsonb_typeof(p_style->'name') is distinct from 'string'
    or coalesce(length(p_style->>'name'),0) not between 1 and 120
    or jsonb_typeof(p_style->'version') is distinct from 'number' or coalesce(p_style->>'version','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_style->'typography'->'headingFont') is distinct from 'string'
    or jsonb_typeof(p_style->'typography'->'bodyFont') is distinct from 'string'
    or coalesce(length(p_style->'typography'->>'headingFont'),0) not between 1 and 120
    or coalesce(length(p_style->'typography'->>'bodyFont'),0) not between 1 and 120
    or jsonb_typeof(p_style->'colors') is distinct from 'object'
    or jsonb_typeof(p_style->'description') is distinct from 'string' or coalesce(length(p_style->>'description'),0)>5000
    or jsonb_typeof(p_style->'referenceAssetIds') is distinct from 'array' then
    raise exception 'Invalid style snapshot' using errcode='22023';
  end if;
  if (select count(*) from jsonb_each(p_style->'colors'))>50 or exists(
    select 1 from jsonb_each(p_style->'colors') c where length(c.key)>120 or jsonb_typeof(c.value)<>'string'
      or (c.value #>> '{}') !~ '^#[0-9a-fA-F]{6}$') then
    raise exception 'Invalid colour tokens' using errcode='22023';
  end if;
  if jsonb_array_length(p_style->'referenceAssetIds')>1000 then raise exception 'Too many style references' using errcode='22023'; end if;
  if p_asset_ids is null or jsonb_typeof(p_asset_ids)<>'array' or jsonb_array_length(p_asset_ids)>1000
    or p_change_summary is null or length(p_change_summary)>2000 then
    raise exception 'Invalid version metadata' using errcode='22023';
  end if;
  for section_value in select jsonb_array_elements(p_content->'sections') loop
    if jsonb_typeof(section_value)<>'object' or coalesce(section_value->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or section_value->>'id'=any(element_ids) or jsonb_typeof(section_value->'title') is distinct from 'string' or coalesce(length(section_value->>'title'),0)>200
      or jsonb_typeof(section_value->'blocks') is distinct from 'array' then
      raise exception 'Invalid section' using errcode='22023';
    end if;
    element_ids:=array_append(element_ids,section_value->>'id');
    for block_value in select jsonb_array_elements(section_value->'blocks') loop
      total_blocks:=total_blocks+1;
      if total_blocks>5000 or jsonb_typeof(block_value)<>'object'
        or coalesce(block_value->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or block_value->>'id'=any(element_ids)
        or block_value->>'type' is null or block_value->>'type' not in ('heading','paragraph','image','quote','list','table','chart','callout')
        or jsonb_typeof(block_value->'text') is distinct from 'string' or length(block_value->>'text')>50000
        or jsonb_typeof(block_value->'locked') is distinct from 'boolean'
        or jsonb_typeof(block_value->'sourceIds') is distinct from 'array' then
        raise exception 'Invalid content block' using errcode='22023';
      end if;
      element_ids:=array_append(element_ids,block_value->>'id');
      if block_value->>'assetId' is not null and not p_asset_ids @> jsonb_build_array(block_value->>'assetId') then
        raise exception 'Unlisted content asset' using errcode='23514';
      end if;
      for reference_value in select jsonb_array_elements_text(block_value->'sourceIds') loop
        total_references:=total_references+1;
        if total_references>5000 then raise exception 'Too many source references' using errcode='22023'; end if;
        if reference_value is null or reference_value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          raise exception 'Invalid source reference' using errcode='23514';
        end if;
        if not exists(select 1 from public.sources s where s.id=reference_value::uuid and s.project_id=artifact_row.project_id and s.workspace_id=p_workspace_id) then
          raise exception 'Source must belong to the artifact project' using errcode='23514';
        end if;
      end loop;
    end loop;
  end loop;
  for reference_value in select jsonb_array_elements_text(p_style->'referenceAssetIds') loop
    if not p_asset_ids @> jsonb_build_array(reference_value) then raise exception 'Unlisted style asset' using errcode='23514'; end if;
  end loop;
  if artifact_row.current_version>0 then
    select v.id,v.content into previous_id,previous_content from public.artifact_versions v where v.artifact_id=p_artifact_id and v.workspace_id=p_workspace_id and v.version_number=artifact_row.current_version;
    if previous_id is null then raise exception 'Missing current snapshot' using errcode='23514'; end if;
  end if;
  -- Unlocking is a separate version: no edits can be bundled with an unlock.
  if previous_content is not null then
    for protected in
      select s.value->>'id' as section_id,b.value as block
      from jsonb_array_elements(previous_content->'sections') s
      cross join lateral jsonb_array_elements(s.value->'blocks') b
      where b.value->'locked'='true'::jsonb
    loop
      select b.value into replacement from jsonb_array_elements(p_content->'sections') s
        cross join lateral jsonb_array_elements(s.value->'blocks') b
        where s.value->>'id'=protected.section_id and b.value->>'id'=protected.block->>'id';
      if replacement is null or (replacement-'locked') is distinct from (protected.block-'locked') then
        raise exception 'Locked content must be preserved. Save an unlock before editing or removing it.' using errcode='22023';
      end if;
    end loop;
  end if;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,asset_manifest,change_summary,created_by)
  values(p_workspace_id,p_artifact_id,p_expected_version+1,previous_id,p_content,p_style,p_asset_ids,p_change_summary,(select auth.uid())) returning * into version_row;
  update public.artifacts set current_version=p_expected_version+1,title=p_content->>'title' where id=p_artifact_id and workspace_id=p_workspace_id returning * into artifact_row;
  return jsonb_build_object('artifact',to_jsonb(artifact_row),'version',to_jsonb(version_row));
end;
$_$;


ALTER FUNCTION "makeborne_private"."save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."save_idempotent_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    AS $$
declare receipt jsonb; saved jsonb; replay_version public.artifact_versions;
begin
  receipt:=makeborne_private.begin_cloud_mutation(p_workspace_id,p_request_key,'save_version',jsonb_build_object(
    'artifact_id',p_artifact_id,'expected_version',p_expected_version,'content',p_content,'style',p_style,'asset_ids',p_asset_ids,'change_summary',p_change_summary));
  if (receipt->>'replayed')::boolean then
    select * into replay_version from public.artifact_versions where id=(receipt->'result'->>'version_id')::uuid and workspace_id=p_workspace_id and artifact_id=p_artifact_id;
    if not found then raise exception 'Committed snapshot no longer available' using errcode='MB410'; end if;
    return jsonb_build_object('artifact',receipt->'result'->'artifact','version',to_jsonb(replay_version),'replayed',true);
  end if;
  saved:=makeborne_private.save_artifact_version(p_workspace_id,p_artifact_id,p_expected_version,p_content,p_style,p_asset_ids,p_change_summary);
  update makeborne_private.cloud_mutation_receipts set resource_id=(saved->'version'->>'id')::uuid,
    result=jsonb_build_object('artifact',saved->'artifact','version_id',saved->'version'->>'id')
    where workspace_id=p_workspace_id and actor_id=(select auth.uid()) and operation='save_version' and request_key=p_request_key;
  return saved || jsonb_build_object('replayed',false);
end;
$$;


ALTER FUNCTION "makeborne_private"."save_idempotent_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := greatest(clock_timestamp()::timestamptz(3),old.updated_at+interval '1 millisecond');
  return new;
end;
$$;


ALTER FUNCTION "makeborne_private"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."validate_client_outreach"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
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
    or coalesce(v->>'stage','') not in ('Lead','Contacted','Replied','Meeting','Proposal','Won','Lost')
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
$_$;


ALTER FUNCTION "makeborne_private"."validate_client_outreach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "makeborne_private"."validate_version_manifest"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare asset_text text; project_uuid uuid;
begin
  if tg_op='UPDATE' then
    raise exception 'Artifact snapshots are immutable; create a new version' using errcode='23514';
  end if;
  select a.project_id into project_uuid from public.artifacts a where a.id=new.artifact_id and a.workspace_id=new.workspace_id;
  if new.parent_version_id is not null and not exists(
    select 1 from public.artifact_versions v where v.id=new.parent_version_id and v.artifact_id=new.artifact_id
      and v.workspace_id=new.workspace_id and v.version_number<new.version_number) then
    raise exception 'Parent version must precede this snapshot in the same artifact' using errcode='23514';
  end if;
  for asset_text in select jsonb_array_elements_text(new.asset_manifest) loop
    if asset_text is null or asset_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Invalid asset manifest identifier' using errcode='23514';
    end if;
    if not exists(select 1 from public.assets a where a.id=asset_text::uuid and a.workspace_id=new.workspace_id and a.project_id=project_uuid) then
      raise exception 'Asset manifest must belong to the artifact project' using errcode='23514';
    end if;
  end loop;
  return new;
end;
$_$;


ALTER FUNCTION "makeborne_private"."validate_version_manifest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_billing_creation_enabled"("p_plan_id" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
    and (p_plan_id is null or exists(select 1 from makeborne_private.billing_access_plans where plan_id=p_plan_id and enabled));
$$;


ALTER FUNCTION "public"."makeborne_billing_creation_enabled"("p_plan_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select makeborne_private.claim_claude_pilot(p_id,p_user,p_hash); $$;


ALTER FUNCTION "public"."makeborne_claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_client_directory"("p_workspace_id" "uuid", "p_search" "text", "p_stage" "text", "p_follow_up" "text", "p_day" "date", "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_day is null or p_offset is null or p_offset not between 0 and 100000
 or p_stage is null or p_stage not in ('All stages','Lead','Contacted','Replied','Meeting','Proposal','Won','Lost')
 or p_follow_up is null or p_follow_up not in ('all','overdue','today','upcoming','unscheduled') then raise exception 'Invalid directory filters' using errcode='22023'; end if;
 with base as materialized (
   select c.id,c.name,c.company,c.email,c.website,c.created_at,c.updated_at,
     coalesce(c.outreach->>'stage','Lead') as outreach_stage,c.outreach->>'nextFollowUp' as outreach_follow_up,
     case when c.outreach->>'stage' in ('Won','Lost') then 'closed'
       when c.outreach->>'nextFollowUp' is null then 'unscheduled'
       when c.outreach->>'nextFollowUp'<to_char(p_day,'YYYY-MM-DD') then 'overdue'
       when c.outreach->>'nextFollowUp'=to_char(p_day,'YYYY-MM-DD') then 'today'
       else 'upcoming' end as follow_up_bucket
   from public.clients c where c.workspace_id=p_workspace_id
 ), filtered as materialized (
   select * from base where (p_stage='All stages' or outreach_stage=p_stage)
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


ALTER FUNCTION "public"."makeborne_client_directory"("p_workspace_id" "uuid", "p_search" "text", "p_stage" "text", "p_follow_up" "text", "p_day" "date", "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_client_projects"("p_workspace_id" "uuid", "p_client_id" "uuid", "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 if not exists(select 1 from public.clients c where c.id=p_client_id and c.workspace_id=p_workspace_id) then raise exception 'Client unavailable' using errcode='P0002'; end if;
 with items as materialized (
   select p.id as "projectId",p.title as "projectTitle",p.status as "projectStatus",coalesce(a.kind,p.kind) as kind,
     a.id as "artifactId",coalesce(a.title,p.title) as title,a.current_version as version,greatest(a.updated_at,p.updated_at) as "updatedAt"
   from public.projects p left join public.artifacts a on a.project_id=p.id and a.workspace_id=p.workspace_id
   where p.workspace_id=p_workspace_id and p.client_id=p_client_id
 ), page as (
   select * from items order by "updatedAt" desc,"projectId","artifactId" nulls first limit 50 offset p_offset
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'pagination',jsonb_build_object('total',(select count(*) from items),'nextOffset',case when p_offset+50<(select count(*) from items) then p_offset+50 else null end)) into result;
 return result;
end $$;


ALTER FUNCTION "public"."makeborne_client_projects"("p_workspace_id" "uuid", "p_client_id" "uuid", "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_cloud_schema_version"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select '20261003_cloud_v2'::text; $$;


ALTER FUNCTION "public"."makeborne_cloud_schema_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select makeborne_private.create_record(p_workspace_id,p_request_key,p_operation,p_payload);
$$;


ALTER FUNCTION "public"."makeborne_create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select makeborne_private.create_studio_project(p_workspace_id,p_request_key,p_project,p_content,p_style);
$$;


ALTER FUNCTION "public"."makeborne_create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_create_workspace"("p_request_key" "uuid", "p_name" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select makeborne_private.create_workspace(p_request_key,p_name); $$;


ALTER FUNCTION "public"."makeborne_create_workspace"("p_request_key" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_my_account_privileges"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select makeborne_private.my_account_privileges();
$$;


ALTER FUNCTION "public"."makeborne_my_account_privileges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select makeborne_hosting.read_hosted_site(p_slug);
$$;


ALTER FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_record_whop_membership"("p_event_id" "text", "p_user_id" "uuid", "p_membership_id" "text", "p_checkout_id" "text", "p_whop_user_id" "text", "p_plan_id" "text", "p_status" "text", "p_period_end" timestamp with time zone, "p_verified_until" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."makeborne_record_whop_membership"("p_event_id" "text", "p_user_id" "uuid", "p_membership_id" "text", "p_checkout_id" "text", "p_whop_user_id" "text", "p_plan_id" "text", "p_status" "text", "p_period_end" timestamp with time zone, "p_verified_until" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select makeborne_private.save_idempotent_version(p_workspace_id,p_artifact_id,p_expected_version,p_content,p_style,p_asset_ids,p_change_summary,p_request_key);
$$;


ALTER FUNCTION "public"."makeborne_save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."makeborne_save_hosted_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select makeborne_hosting.save_site(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request);
$$;


ALTER FUNCTION "public"."makeborne_save_hosted_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "makeborne_private"."account_privilege_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_grant" "jsonb",
    "new_grant" "jsonb",
    "database_actor" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_privilege_events_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "makeborne_private"."account_privilege_events" OWNER TO "postgres";


ALTER TABLE "makeborne_private"."account_privilege_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "makeborne_private"."account_privilege_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "makeborne_private"."account_privileges" (
    "user_id" "uuid" NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "unlimited_credits" boolean DEFAULT false NOT NULL,
    "reason" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_privileges_reason_check" CHECK ((("length"("reason") >= 1) AND ("length"("reason") <= 500)))
);


ALTER TABLE "makeborne_private"."account_privileges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."billing_access_plans" (
    "plan_id" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "billing_access_plans_plan_id_check" CHECK ((("plan_id" ~ '^plan_[A-Za-z0-9]+$'::"text") AND ("plan_id" <> 'plan_B7Dgm9ZqM3V0M'::"text")))
);


ALTER TABLE "makeborne_private"."billing_access_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."billing_settings" (
    "singleton" boolean DEFAULT true NOT NULL,
    "creation_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "billing_settings_singleton_check" CHECK ("singleton")
);


ALTER TABLE "makeborne_private"."billing_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."claude_pilot_budget" (
    "id" boolean DEFAULT true NOT NULL,
    "limit_cents" integer DEFAULT 450 NOT NULL,
    "reserved_cents" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "claude_pilot_budget_id_check" CHECK ("id"),
    CONSTRAINT "claude_pilot_budget_limit_cents_check" CHECK ((("limit_cents" >= 0) AND ("limit_cents" <= 450))),
    CONSTRAINT "claude_pilot_budget_reserved_cents_check" CHECK ((("reserved_cents" >= 0) AND ("reserved_cents" <= 450)))
);


ALTER TABLE "makeborne_private"."claude_pilot_budget" OWNER TO "postgres";


COMMENT ON TABLE "makeborne_private"."claude_pilot_budget" IS 'Admin-only Claude test budget: at most 18 dispatches with conservative 25-cent reservations; 50 cents withheld for setup verification. Never replenish automatically. Holds remain on uncertain calls.';



CREATE TABLE IF NOT EXISTS "makeborne_private"."cloud_mutation_receipts" (
    "workspace_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "operation" "text" NOT NULL,
    "request_key" "uuid" NOT NULL,
    "payload_sha256" "text" NOT NULL,
    "resource_id" "uuid",
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "replay_until" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    CONSTRAINT "cloud_mutation_receipts_operation_check" CHECK (("operation" = ANY (ARRAY['create_client'::"text", 'create_project'::"text", 'create_artifact'::"text", 'save_version'::"text"]))),
    CONSTRAINT "cloud_mutation_receipts_payload_sha256_check" CHECK (("payload_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "cloud_mutation_receipts_result_check" CHECK ((("result" IS NULL) OR ("octet_length"(("result")::"text") <= 262144)))
);


ALTER TABLE "makeborne_private"."cloud_mutation_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."generation_budgets" (
    "workspace_id" "uuid" NOT NULL,
    "spending_enabled" boolean DEFAULT false NOT NULL,
    "emergency_stop" boolean DEFAULT false NOT NULL,
    "vendor_limit" bigint DEFAULT 0 NOT NULL,
    "vendor_spent" bigint DEFAULT 0 NOT NULL,
    "vendor_reserved" bigint DEFAULT 0 NOT NULL,
    "credit_limit" bigint DEFAULT 0 NOT NULL,
    "credit_spent" bigint DEFAULT 0 NOT NULL,
    "credit_reserved" bigint DEFAULT 0 NOT NULL,
    "active_reservations" integer DEFAULT 0 NOT NULL,
    "concurrency_limit" integer DEFAULT 1 NOT NULL,
    "revision" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "generation_budgets_active_reservations_check" CHECK (("active_reservations" >= 0)),
    CONSTRAINT "generation_budgets_check" CHECK (((("vendor_spent")::numeric + ("vendor_reserved")::numeric) <= ("vendor_limit")::numeric)),
    CONSTRAINT "generation_budgets_check1" CHECK (((("credit_spent")::numeric + ("credit_reserved")::numeric) <= ("credit_limit")::numeric)),
    CONSTRAINT "generation_budgets_concurrency_limit_check" CHECK ((("concurrency_limit" >= 1) AND ("concurrency_limit" <= 100))),
    CONSTRAINT "generation_budgets_credit_limit_check" CHECK (("credit_limit" >= 0)),
    CONSTRAINT "generation_budgets_credit_reserved_check" CHECK (("credit_reserved" >= 0)),
    CONSTRAINT "generation_budgets_credit_spent_check" CHECK (("credit_spent" >= 0)),
    CONSTRAINT "generation_budgets_revision_check" CHECK (("revision" >= 0)),
    CONSTRAINT "generation_budgets_vendor_limit_check" CHECK (("vendor_limit" >= 0)),
    CONSTRAINT "generation_budgets_vendor_reserved_check" CHECK (("vendor_reserved" >= 0)),
    CONSTRAINT "generation_budgets_vendor_spent_check" CHECK (("vendor_spent" >= 0))
);


ALTER TABLE "makeborne_private"."generation_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."generation_dispatches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "request_key" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "makeborne_private"."generation_dispatches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."generation_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "artifact_id" "uuid",
    "base_version_id" "uuid",
    "input_hash" "text" NOT NULL,
    "approval_hash" "text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "maximum_vendor_microusd" bigint NOT NULL,
    "maximum_customer_credits" bigint NOT NULL,
    "prepared_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "generation_proposal_snapshot_binding" CHECK ((((("snapshot" ->> 'version'::"text") = 'generation-proposal-v1'::"text") AND (("snapshot" ->> 'inputHash'::"text") = "input_hash") AND (("snapshot" ->> 'approvalHash'::"text") = "approval_hash") AND (("snapshot" #>> '{input,scope,workspaceId}'::"text"[]) = ("workspace_id")::"text") AND (("snapshot" #>> '{input,scope,projectId}'::"text"[]) = ("project_id")::"text") AND (("snapshot" #> '{input,scope,artifactId}'::"text"[]) = COALESCE("to_jsonb"(("artifact_id")::"text"), 'null'::"jsonb")) AND (("snapshot" #> '{input,baseVersionId}'::"text"[]) = COALESCE("to_jsonb"(("base_version_id")::"text"), 'null'::"jsonb")) AND (("snapshot" #>> '{workflow,version}'::"text"[]) = 'workflow-v1'::"text") AND (("snapshot" #> '{workflow,approved}'::"text"[]) = 'false'::"jsonb") AND (("snapshot" #>> '{workflow,maximumVendorMicrousd}'::"text"[]) = ("maximum_vendor_microusd")::"text") AND (("snapshot" #>> '{workflow,maximumCustomerCredits}'::"text"[]) = ("maximum_customer_credits")::"text") AND ((("snapshot" #>> '{workflow,preparedAt}'::"text"[]))::timestamp with time zone = "prepared_at") AND ((("snapshot" #>> '{workflow,expiresAt}'::"text"[]))::timestamp with time zone = "expires_at") AND ("jsonb_typeof"(("snapshot" #> '{workflow,stages}'::"text"[])) = 'array'::"text") AND (("jsonb_array_length"(("snapshot" #> '{workflow,stages}'::"text"[])) >= 3) AND ("jsonb_array_length"(("snapshot" #> '{workflow,stages}'::"text"[])) <= 4))) IS TRUE)),
    CONSTRAINT "generation_proposals_approval_hash_check" CHECK (("approval_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "generation_proposals_check" CHECK (("expires_at" > "prepared_at")),
    CONSTRAINT "generation_proposals_check1" CHECK ((("base_version_id" IS NULL) OR ("artifact_id" IS NOT NULL))),
    CONSTRAINT "generation_proposals_input_hash_check" CHECK (("input_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "generation_proposals_maximum_customer_credits_check" CHECK (("maximum_customer_credits" >= 0)),
    CONSTRAINT "generation_proposals_maximum_vendor_microusd_check" CHECK (("maximum_vendor_microusd" >= 0)),
    CONSTRAINT "generation_proposals_snapshot_check" CHECK ((("jsonb_typeof"("snapshot") = 'object'::"text") AND ("octet_length"(("snapshot")::"text") <= 6291456)))
);


ALTER TABLE "makeborne_private"."generation_proposals" OWNER TO "postgres";


COMMENT ON TABLE "makeborne_private"."generation_proposals" IS 'Server-owned immutable proposal snapshots. Hash bindings are not authorization. Worker must verify canonical hashes, scope, current policy and budgets before dispatch. No client API or spending enabled.';



CREATE TABLE IF NOT EXISTS "makeborne_private"."generation_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "request_key" "uuid" NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "approval_hash" "text" NOT NULL,
    "vendor_amount" bigint NOT NULL,
    "credit_amount" bigint NOT NULL,
    "status" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dispatch_started_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "released_by" "uuid",
    "release_reason" "text",
    "credits_waived" boolean DEFAULT false NOT NULL,
    CONSTRAINT "generation_release_metadata" CHECK (((("status" = 'released'::"text") = ("released_at" IS NOT NULL)) AND (("released_at" IS NULL) = ("released_by" IS NULL)) AND (("released_at" IS NULL) = ("release_reason" IS NULL)) AND (("released_at" IS NULL) OR ("dispatch_started_at" IS NULL)))),
    CONSTRAINT "generation_reservations_approval_hash_check" CHECK (("approval_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "generation_reservations_credit_amount_check" CHECK (("credit_amount" >= 0)),
    CONSTRAINT "generation_reservations_release_reason_check" CHECK ((("length"("release_reason") >= 1) AND ("length"("release_reason") <= 500))),
    CONSTRAINT "generation_reservations_status_check" CHECK (("status" = ANY (ARRAY['reserved'::"text", 'uncertain'::"text", 'settled'::"text", 'released'::"text"]))),
    CONSTRAINT "generation_reservations_vendor_amount_check" CHECK (("vendor_amount" >= 0)),
    CONSTRAINT "waived_credits_are_zero" CHECK (((NOT "credits_waived") OR ("credit_amount" = 0)))
);


ALTER TABLE "makeborne_private"."generation_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "makeborne_private"."workspace_creation_receipts" (
    "actor_id" "uuid" NOT NULL,
    "request_key" "uuid" NOT NULL,
    "payload_sha256" "text" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "replay_until" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    CONSTRAINT "workspace_creation_receipts_payload_sha256_check" CHECK (("payload_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "workspace_creation_receipts_result_check" CHECK ((("result" IS NULL) OR ("octet_length"(("result")::"text") <= 4096)))
);


ALTER TABLE "makeborne_private"."workspace_creation_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artifact_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "artifact_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "parent_version_id" "uuid",
    "content" "jsonb" NOT NULL,
    "style_snapshot" "jsonb" NOT NULL,
    "asset_manifest" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "change_summary" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "artifact_versions_asset_manifest_check" CHECK ((("jsonb_typeof"("asset_manifest") = 'array'::"text") AND ("jsonb_array_length"("asset_manifest") <= 1000))),
    CONSTRAINT "artifact_versions_check" CHECK ((("parent_version_id" IS NULL) OR ("parent_version_id" <> "id"))),
    CONSTRAINT "artifact_versions_content_check" CHECK ((("jsonb_typeof"("content") = 'object'::"text") AND ("octet_length"(("content")::"text") <= 5242880))),
    CONSTRAINT "artifact_versions_style_snapshot_check" CHECK ((("jsonb_typeof"("style_snapshot") = 'object'::"text") AND ("octet_length"(("style_snapshot")::"text") <= 262144))),
    CONSTRAINT "artifact_versions_version_number_check" CHECK (("version_number" > 0)),
    CONSTRAINT "versions_summary_bounds" CHECK (("length"("change_summary") <= 2000))
);


ALTER TABLE "public"."artifact_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "current_version" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "artifacts_current_version_check" CHECK (("current_version" >= 0)),
    CONSTRAINT "artifacts_kind_check" CHECK (("kind" = ANY (ARRAY['website'::"text", 'book'::"text", 'presentation'::"text"]))),
    CONSTRAINT "artifacts_title_bounds" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 200)))
);


ALTER TABLE "public"."artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "sha256" "text",
    "provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assets_bounds" CHECK (((("length"("object_path") >= 1) AND ("length"("object_path") <= 1024)) AND ("object_path" ~~ (("workspace_id")::"text" || '/%'::"text")) AND (("length"("content_type") >= 1) AND ("length"("content_type") <= 200)) AND (("sha256" IS NULL) OR ("sha256" ~ '^[0-9a-f]{64}$'::"text")) AND ("jsonb_typeof"("provenance") = 'object'::"text") AND ("octet_length"(("provenance")::"text") <= 262144)))
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target_id" "uuid",
    "outcome" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_bounds" CHECK (((("length"("action") >= 1) AND ("length"("action") <= 120)) AND (("length"("outcome") >= 1) AND ("length"("outcome") <= 80)) AND ("jsonb_typeof"("metadata") = 'object'::"text") AND ("octet_length"(("metadata")::"text") <= 65536)))
);


ALTER TABLE "public"."audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_checkouts" (
    "request_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "text" NOT NULL,
    "checkout_id" "text",
    "return_path" "text" NOT NULL,
    "purchase_url" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_checkouts_checkout_id_check" CHECK (("checkout_id" ~ '^ch_[A-Za-z0-9]+$'::"text")),
    CONSTRAINT "billing_checkouts_plan_id_check" CHECK ((("plan_id" ~ '^plan_[A-Za-z0-9]+$'::"text") AND ("plan_id" <> 'plan_B7Dgm9ZqM3V0M'::"text"))),
    CONSTRAINT "billing_checkouts_return_path_check" CHECK ((("length"("return_path") <= 2000) AND (("return_path" ~~ '/studio%'::"text") OR ("return_path" = '/chat'::"text")))),
    CONSTRAINT "billing_checkouts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'ready'::"text"])))
);


ALTER TABLE "public"."billing_checkouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_memberships" (
    "membership_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "checkout_id" "text" NOT NULL,
    "whop_user_id" "text" NOT NULL,
    "plan_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "period_end" timestamp with time zone,
    "verified_until" timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_memberships_check" CHECK (("verified_until" <= ("checked_at" + '00:05:00'::interval))),
    CONSTRAINT "billing_memberships_check1" CHECK (("verified_until" <= COALESCE("period_end", '1970-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT "billing_memberships_membership_id_check" CHECK (("membership_id" ~ '^mem_[A-Za-z0-9]+$'::"text")),
    CONSTRAINT "billing_memberships_plan_id_check" CHECK (("plan_id" <> 'plan_B7Dgm9ZqM3V0M'::"text")),
    CONSTRAINT "billing_memberships_whop_user_id_check" CHECK (("whop_user_id" ~ '^user_[A-Za-z0-9]+$'::"text"))
);


ALTER TABLE "public"."billing_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_webhook_events" (
    "id" "text" NOT NULL,
    "membership_id" "text" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_webhook_events_id_check" CHECK ((("length"("id") >= 1) AND ("length"("id") <= 200)))
);


ALTER TABLE "public"."billing_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "amount_microusd" bigint NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "budget_reservations_amount_microusd_check" CHECK (("amount_microusd" >= 0)),
    CONSTRAINT "budget_reservations_status_check" CHECK (("status" = ANY (ARRAY['reserved'::"text", 'settled'::"text", 'released'::"text", 'uncertain'::"text"])))
);


ALTER TABLE "public"."budget_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claude_pilot_runs" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "result" "jsonb",
    "usage" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claude_pilot_runs_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "claude_pilot_runs_status_check" CHECK (("status" = ANY (ARRAY['reserved'::"text", 'completed'::"text", 'uncertain'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."claude_pilot_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "company" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "website" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT "now"() NOT NULL,
    "outreach" "jsonb",
    CONSTRAINT "clients_name_check" CHECK ((("length"("name") >= 1) AND ("length"("name") <= 120))),
    CONSTRAINT "clients_text_bounds" CHECK ((("length"("company") <= 160) AND ("length"("email") <= 254) AND ("length"("website") <= 2048) AND ("length"("notes") <= 10000)))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contacts_text_bounds" CHECK (((("length"("name") >= 1) AND ("length"("name") <= 120)) AND ("length"("email") <= 254) AND ("length"("phone") <= 80)))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."generation_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "artifact_id" "uuid",
    "kind" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "stage" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempt" integer DEFAULT 0 NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "provider" "text",
    "provider_request_id" "text",
    "error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "generation_jobs_attempt_check" CHECK (("attempt" >= 0)),
    CONSTRAINT "generation_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['website'::"text", 'book'::"text", 'presentation'::"text"]))),
    CONSTRAINT "generation_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'awaiting_reconciliation'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "jobs_text_bounds" CHECK ((("length"("stage") <= 120) AND (("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 200)) AND (("provider" IS NULL) OR ("length"("provider") <= 80)) AND (("provider_request_id" IS NULL) OR ("length"("provider_request_id") <= 200)) AND (("error_code" IS NULL) OR ("length"("error_code") <= 100))))
);


ALTER TABLE "public"."generation_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_connections" (
    "user_id" "uuid" NOT NULL,
    "github_user_id" bigint NOT NULL,
    "login" "text" NOT NULL,
    "token_ciphertext" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."github_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_website_links" (
    "artifact_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repository_id" bigint NOT NULL,
    "repository_name" "text" NOT NULL,
    "branch" "text" NOT NULL,
    "commit_sha" "text",
    "version_number" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."github_website_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hosted_sites" (
    "artifact_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "version_number" integer NOT NULL,
    "html" "text" NOT NULL,
    "live" boolean DEFAULT false NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "request_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hosted_sites_html_check" CHECK (("octet_length"("html") <= 4000000)),
    CONSTRAINT "hosted_sites_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'::"text")),
    CONSTRAINT "hosted_sites_version_number_check" CHECK (("version_number" > 0))
);


ALTER TABLE "public"."hosted_sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "title" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "style_id" "text" DEFAULT 'editorial'::"text" NOT NULL,
    "brief" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT "now"() NOT NULL,
    "audience" "text" DEFAULT ''::"text" NOT NULL,
    "purpose" "text" DEFAULT ''::"text" NOT NULL,
    "wording" "text" DEFAULT 'preserve'::"text" NOT NULL,
    "effort" "text" DEFAULT 'medium'::"text" NOT NULL,
    CONSTRAINT "projects_audience_check" CHECK (("length"("audience") <= 1000)),
    CONSTRAINT "projects_effort_check" CHECK (("effort" = ANY (ARRAY['light'::"text", 'medium'::"text", 'high'::"text", 'super_high'::"text", 'ultra'::"text"]))),
    CONSTRAINT "projects_kind_check" CHECK (("kind" = ANY (ARRAY['website'::"text", 'book'::"text", 'presentation'::"text"]))),
    CONSTRAINT "projects_purpose_check" CHECK (("length"("purpose") <= 2000)),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'in_progress'::"text", 'review'::"text", 'approved'::"text", 'published'::"text", 'archived'::"text"]))),
    CONSTRAINT "projects_text_bounds" CHECK (((("length"("style_id") >= 1) AND ("length"("style_id") <= 120)) AND ("length"("brief") <= 30000))),
    CONSTRAINT "projects_title_check" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 160))),
    CONSTRAINT "projects_wording_check" CHECK (("wording" = ANY (ARRAY['preserve'::"text", 'improve'::"text", 'summarise'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."published_releases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "version_id" "uuid" NOT NULL,
    "renderer_version" "text" NOT NULL,
    "status" "text" NOT NULL,
    "public_slug" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "published_releases_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'published'::"text", 'failed'::"text", 'retired'::"text"]))),
    CONSTRAINT "releases_text_bounds" CHECK (((("length"("renderer_version") >= 1) AND ("length"("renderer_version") <= 100)) AND (("public_slug" IS NULL) OR ("public_slug" ~ '^[a-z0-9][a-z0-9-]{0,119}$'::"text"))))
);


ALTER TABLE "public"."published_releases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "version_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "decision" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_body_bounds" CHECK (("length"("body") <= 10000)),
    CONSTRAINT "reviews_decision_check" CHECK (("decision" = ANY (ARRAY['comment'::"text", 'changes_requested'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "source_url" "text",
    "permission" "text" DEFAULT 'private'::"text" NOT NULL,
    "approved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sources_bounds" CHECK (((("length"("title") >= 1) AND ("length"("title") <= 200)) AND ("length"("content") <= 1000000) AND (("source_url" IS NULL) OR ("length"("source_url") <= 2048)))),
    CONSTRAINT "sources_kind_check" CHECK (("kind" = ANY (ARRAY['text'::"text", 'url'::"text", 'document'::"text", 'image'::"text", 'recording'::"text"]))),
    CONSTRAINT "sources_permission_check" CHECK (("permission" = ANY (ARRAY['private'::"text", 'project'::"text", 'public'::"text"])))
);


ALTER TABLE "public"."sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."style_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "version" integer NOT NULL,
    "specification" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "style_profiles_version_check" CHECK (("version" > 0)),
    CONSTRAINT "styles_bounds" CHECK (((("length"("name") >= 1) AND ("length"("name") <= 120)) AND ("jsonb_typeof"("specification") = 'object'::"text") AND ("octet_length"(("specification")::"text") <= 262144)))
);


ALTER TABLE "public"."style_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "due_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'doing'::"text", 'done'::"text"]))),
    CONSTRAINT "tasks_title_bounds" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 200)))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usage_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "amount_microusd" bigint NOT NULL,
    "estimated" boolean DEFAULT true NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "usage_ledger_amount_microusd_check" CHECK (("amount_microusd" >= 0)),
    CONSTRAINT "usage_text_bounds" CHECK (((("length"("event_key") >= 1) AND ("length"("event_key") <= 200)) AND (("length"("provider") >= 1) AND ("length"("provider") <= 80)) AND (("length"("model") >= 1) AND ("length"("model") <= 160))))
);


ALTER TABLE "public"."usage_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_members" (
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspace_members_role_check" CHECK (("role" = ANY (ARRAY['editor'::"text", 'reviewer'::"text"])))
);


ALTER TABLE "public"."workspace_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mutation_daily_limit" integer DEFAULT 2000 NOT NULL,
    "mutation_ledger_limit" integer DEFAULT 100000 NOT NULL,
    CONSTRAINT "workspaces_mutation_daily_limit_check" CHECK ((("mutation_daily_limit" >= 1) AND ("mutation_daily_limit" <= 10000))),
    CONSTRAINT "workspaces_mutation_ledger_limit_check" CHECK ((("mutation_ledger_limit" >= 1) AND ("mutation_ledger_limit" <= 1000000))),
    CONSTRAINT "workspaces_name_check" CHECK ((("length"("name") >= 1) AND ("length"("name") <= 160)))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "makeborne_private"."account_privilege_events"
    ADD CONSTRAINT "account_privilege_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "makeborne_private"."account_privileges"
    ADD CONSTRAINT "account_privileges_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "makeborne_private"."billing_access_plans"
    ADD CONSTRAINT "billing_access_plans_pkey" PRIMARY KEY ("plan_id");



ALTER TABLE ONLY "makeborne_private"."billing_settings"
    ADD CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("singleton");



ALTER TABLE ONLY "makeborne_private"."claude_pilot_budget"
    ADD CONSTRAINT "claude_pilot_budget_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "makeborne_private"."cloud_mutation_receipts"
    ADD CONSTRAINT "cloud_mutation_receipts_pkey" PRIMARY KEY ("workspace_id", "actor_id", "operation", "request_key");



ALTER TABLE ONLY "makeborne_private"."generation_budgets"
    ADD CONSTRAINT "generation_budgets_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_dispatches"
    ADD CONSTRAINT "generation_dispatches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "makeborne_private"."generation_dispatches"
    ADD CONSTRAINT "generation_dispatches_request_key_key" UNIQUE ("request_key");



ALTER TABLE ONLY "makeborne_private"."generation_dispatches"
    ADD CONSTRAINT "generation_dispatches_reservation_id_key" UNIQUE ("reservation_id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_id_workspace" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_workspace_id_approval_hash_key" UNIQUE ("workspace_id", "approval_hash");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_proposal_id_key" UNIQUE ("proposal_id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_workspace_id_request_key_key" UNIQUE ("workspace_id", "request_key");



ALTER TABLE ONLY "makeborne_private"."workspace_creation_receipts"
    ADD CONSTRAINT "workspace_creation_receipts_pkey" PRIMARY KEY ("actor_id", "request_key");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_artifact_id_version_number_key" UNIQUE ("artifact_id", "version_number");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_id_artifact_id_workspace_id_key" UNIQUE ("id", "artifact_id", "workspace_id");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_id_project_id_workspace_id_key" UNIQUE ("id", "project_id", "workspace_id");



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_checkouts"
    ADD CONSTRAINT "billing_checkouts_checkout_id_key" UNIQUE ("checkout_id");



ALTER TABLE ONLY "public"."billing_checkouts"
    ADD CONSTRAINT "billing_checkouts_checkout_id_user_id_plan_id_key" UNIQUE ("checkout_id", "user_id", "plan_id");



ALTER TABLE ONLY "public"."billing_checkouts"
    ADD CONSTRAINT "billing_checkouts_pkey" PRIMARY KEY ("request_id");



ALTER TABLE ONLY "public"."billing_memberships"
    ADD CONSTRAINT "billing_memberships_pkey" PRIMARY KEY ("membership_id");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_reservations"
    ADD CONSTRAINT "budget_reservations_job_id_key" UNIQUE ("job_id");



ALTER TABLE ONLY "public"."budget_reservations"
    ADD CONSTRAINT "budget_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claude_pilot_runs"
    ADD CONSTRAINT "claude_pilot_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_workspace_id_idempotency_key_key" UNIQUE ("workspace_id", "idempotency_key");



ALTER TABLE ONLY "public"."github_connections"
    ADD CONSTRAINT "github_connections_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."github_website_links"
    ADD CONSTRAINT "github_website_links_pkey" PRIMARY KEY ("artifact_id");



ALTER TABLE ONLY "public"."hosted_sites"
    ADD CONSTRAINT "hosted_sites_pkey" PRIMARY KEY ("artifact_id");



ALTER TABLE ONLY "public"."hosted_sites"
    ADD CONSTRAINT "hosted_sites_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."published_releases"
    ADD CONSTRAINT "published_releases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."published_releases"
    ADD CONSTRAINT "published_releases_public_slug_key" UNIQUE ("public_slug");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."style_profiles"
    ADD CONSTRAINT "style_profiles_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."style_profiles"
    ADD CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usage_ledger"
    ADD CONSTRAINT "usage_ledger_event_key_key" UNIQUE ("event_key");



ALTER TABLE ONLY "public"."usage_ledger"
    ADD CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_privilege_events_user" ON "makeborne_private"."account_privilege_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "generation_dispatches_actor" ON "makeborne_private"."generation_dispatches" USING "btree" ("actor_id");



CREATE INDEX "generation_proposals_base_version" ON "makeborne_private"."generation_proposals" USING "btree" ("base_version_id", "artifact_id", "workspace_id");



CREATE INDEX "generation_proposals_project_created" ON "makeborne_private"."generation_proposals" USING "btree" ("workspace_id", "project_id", "created_at" DESC);



CREATE INDEX "generation_reservations_actor" ON "makeborne_private"."generation_reservations" USING "btree" ("approved_by");



CREATE INDEX "generation_reservations_released_by" ON "makeborne_private"."generation_reservations" USING "btree" ("released_by") WHERE ("released_by" IS NOT NULL);



CREATE INDEX "mutation_receipts_created" ON "makeborne_private"."cloud_mutation_receipts" USING "btree" ("workspace_id", "created_at");



CREATE INDEX "mutation_receipts_expiration" ON "makeborne_private"."cloud_mutation_receipts" USING "btree" ("replay_until") WHERE ("result" IS NOT NULL);



CREATE INDEX "artifact_versions_workspace_id_idx" ON "public"."artifact_versions" USING "btree" ("workspace_id");



CREATE INDEX "artifacts_workspace_id_idx" ON "public"."artifacts" USING "btree" ("workspace_id");



CREATE INDEX "assets_workspace_id_idx" ON "public"."assets" USING "btree" ("workspace_id");



CREATE INDEX "audit_events_workspace_id_idx" ON "public"."audit_events" USING "btree" ("workspace_id");



CREATE INDEX "billing_checkouts_user" ON "public"."billing_checkouts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "billing_memberships_user" ON "public"."billing_memberships" USING "btree" ("user_id");



CREATE INDEX "budget_reservations_workspace_id_idx" ON "public"."budget_reservations" USING "btree" ("workspace_id");



CREATE INDEX "clients_workspace_id_idx" ON "public"."clients" USING "btree" ("workspace_id");



CREATE INDEX "contacts_workspace_id_idx" ON "public"."contacts" USING "btree" ("workspace_id");



CREATE INDEX "generation_jobs_workspace_id_idx" ON "public"."generation_jobs" USING "btree" ("workspace_id");



CREATE INDEX "hosted_sites_workspace" ON "public"."hosted_sites" USING "btree" ("workspace_id");



CREATE UNIQUE INDEX "one_owned_workspace_per_user" ON "public"."workspaces" USING "btree" ("owner_id");



CREATE INDEX "projects_workspace_id_idx" ON "public"."projects" USING "btree" ("workspace_id");



CREATE INDEX "published_releases_workspace_id_idx" ON "public"."published_releases" USING "btree" ("workspace_id");



CREATE INDEX "reviews_workspace_id_idx" ON "public"."reviews" USING "btree" ("workspace_id");



CREATE INDEX "sources_workspace_id_idx" ON "public"."sources" USING "btree" ("workspace_id");



CREATE INDEX "style_profiles_workspace_id_idx" ON "public"."style_profiles" USING "btree" ("workspace_id");



CREATE INDEX "tasks_workspace_id_idx" ON "public"."tasks" USING "btree" ("workspace_id");



CREATE INDEX "usage_ledger_workspace_id_idx" ON "public"."usage_ledger" USING "btree" ("workspace_id");



CREATE INDEX "workspace_members_user" ON "public"."workspace_members" USING "btree" ("user_id", "workspace_id");



CREATE OR REPLACE TRIGGER "audit_account_privilege_change" BEFORE INSERT OR DELETE OR UPDATE ON "makeborne_private"."account_privileges" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."audit_account_privilege_change"();



CREATE OR REPLACE TRIGGER "artifact_manifest_guard" BEFORE INSERT OR UPDATE ON "public"."artifact_versions" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."validate_version_manifest"();



CREATE OR REPLACE TRIGGER "artifacts_updated_at" BEFORE UPDATE ON "public"."artifacts" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "client_outreach_validation" BEFORE INSERT OR UPDATE OF "outreach" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."validate_client_outreach"();



CREATE OR REPLACE TRIGGER "clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."artifact_versions" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."artifacts" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."audit_events" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."budget_reservations" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."generation_jobs" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."published_releases" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."sources" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."style_profiles" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."usage_ledger" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."workspace_members" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



CREATE OR REPLACE TRIGGER "require_creation_membership" BEFORE INSERT OR DELETE OR UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "makeborne_private"."require_creation_membership_write"();



ALTER TABLE ONLY "makeborne_private"."account_privileges"
    ADD CONSTRAINT "account_privileges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "makeborne_private"."cloud_mutation_receipts"
    ADD CONSTRAINT "cloud_mutation_receipts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "makeborne_private"."cloud_mutation_receipts"
    ADD CONSTRAINT "cloud_mutation_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "makeborne_private"."generation_budgets"
    ADD CONSTRAINT "generation_budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id");



ALTER TABLE ONLY "makeborne_private"."generation_dispatches"
    ADD CONSTRAINT "generation_dispatches_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "makeborne_private"."generation_dispatches"
    ADD CONSTRAINT "generation_dispatches_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "makeborne_private"."generation_reservations"("id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_artifact_id_project_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "project_id", "workspace_id") REFERENCES "public"."artifacts"("id", "project_id", "workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_base_version_id_artifact_id_workspace_fkey" FOREIGN KEY ("base_version_id", "artifact_id", "workspace_id") REFERENCES "public"."artifact_versions"("id", "artifact_id", "workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_proposals"
    ADD CONSTRAINT "generation_proposals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_proposal_id_workspace_id_fkey" FOREIGN KEY ("proposal_id", "workspace_id") REFERENCES "makeborne_private"."generation_proposals"("id", "workspace_id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "makeborne_private"."generation_reservations"
    ADD CONSTRAINT "generation_reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "makeborne_private"."generation_budgets"("workspace_id");



ALTER TABLE ONLY "makeborne_private"."workspace_creation_receipts"
    ADD CONSTRAINT "workspace_creation_receipts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_artifact_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "workspace_id") REFERENCES "public"."artifacts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_parent_version_id_artifact_id_workspace__fkey" FOREIGN KEY ("parent_version_id", "artifact_id", "workspace_id") REFERENCES "public"."artifact_versions"("id", "artifact_id", "workspace_id");



ALTER TABLE ONLY "public"."artifact_versions"
    ADD CONSTRAINT "artifact_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."artifacts"
    ADD CONSTRAINT "artifacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_checkouts"
    ADD CONSTRAINT "billing_checkouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_memberships"
    ADD CONSTRAINT "billing_memberships_checkout_id_user_id_plan_id_fkey" FOREIGN KEY ("checkout_id", "user_id", "plan_id") REFERENCES "public"."billing_checkouts"("checkout_id", "user_id", "plan_id");



ALTER TABLE ONLY "public"."billing_memberships"
    ADD CONSTRAINT "billing_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_reservations"
    ADD CONSTRAINT "budget_reservations_job_id_workspace_id_fkey" FOREIGN KEY ("job_id", "workspace_id") REFERENCES "public"."generation_jobs"("id", "workspace_id");



ALTER TABLE ONLY "public"."budget_reservations"
    ADD CONSTRAINT "budget_reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claude_pilot_runs"
    ADD CONSTRAINT "claude_pilot_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "public"."clients"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_artifact_id_project_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "project_id", "workspace_id") REFERENCES "public"."artifacts"("id", "project_id", "workspace_id");



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generation_jobs"
    ADD CONSTRAINT "generation_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_connections"
    ADD CONSTRAINT "github_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_website_links"
    ADD CONSTRAINT "github_website_links_artifact_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "workspace_id") REFERENCES "public"."artifacts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_website_links"
    ADD CONSTRAINT "github_website_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hosted_sites"
    ADD CONSTRAINT "hosted_sites_artifact_id_version_number_fkey" FOREIGN KEY ("artifact_id", "version_number") REFERENCES "public"."artifact_versions"("artifact_id", "version_number");



ALTER TABLE ONLY "public"."hosted_sites"
    ADD CONSTRAINT "hosted_sites_artifact_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "workspace_id") REFERENCES "public"."artifacts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hosted_sites"
    ADD CONSTRAINT "hosted_sites_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_client_id_workspace_id_fkey" FOREIGN KEY ("client_id", "workspace_id") REFERENCES "public"."clients"("id", "workspace_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."published_releases"
    ADD CONSTRAINT "published_releases_version_id_workspace_id_fkey" FOREIGN KEY ("version_id", "workspace_id") REFERENCES "public"."artifact_versions"("id", "workspace_id");



ALTER TABLE ONLY "public"."published_releases"
    ADD CONSTRAINT "published_releases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_version_id_workspace_id_fkey" FOREIGN KEY ("version_id", "workspace_id") REFERENCES "public"."artifact_versions"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."style_profiles"
    ADD CONSTRAINT "style_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "public"."projects"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_ledger"
    ADD CONSTRAINT "usage_ledger_job_id_workspace_id_fkey" FOREIGN KEY ("job_id", "workspace_id") REFERENCES "public"."generation_jobs"("id", "workspace_id");



ALTER TABLE ONLY "public"."usage_ledger"
    ADD CONSTRAINT "usage_ledger_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE "makeborne_private"."account_privilege_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."account_privileges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."billing_access_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."billing_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."claude_pilot_budget" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."cloud_mutation_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."generation_budgets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."generation_dispatches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."generation_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."generation_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "makeborne_private"."workspace_creation_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artifact_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_checkouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claude_pilot_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generation_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_website_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hosted_site_tenant_read" ON "public"."hosted_sites" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



ALTER TABLE "public"."hosted_sites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "membership_manage" ON "public"."workspace_members" TO "authenticated" USING ("makeborne_private"."is_owner"("workspace_id")) WITH CHECK ("makeborne_private"."is_owner"("workspace_id"));



CREATE POLICY "membership_read" ON "public"."workspace_members" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."published_releases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "review_insert" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK (("makeborne_private"."can_read"("workspace_id") AND ("reviewer_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."style_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_delete" ON "public"."artifacts" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."assets" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."clients" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."contacts" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."projects" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."sources" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."style_profiles" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_delete" ON "public"."tasks" FOR DELETE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."artifacts" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."contacts" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."sources" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."style_profiles" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_insert" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."artifact_versions" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."artifacts" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."assets" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."audit_events" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."budget_reservations" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."clients" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."contacts" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."generation_jobs" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."projects" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."published_releases" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."reviews" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."sources" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."style_profiles" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."tasks" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_read" ON "public"."usage_ledger" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."artifacts" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."assets" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."clients" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."contacts" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."sources" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."style_profiles" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



CREATE POLICY "tenant_update" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ("makeborne_private"."can_edit"("workspace_id")) WITH CHECK ("makeborne_private"."can_edit"("workspace_id"));



ALTER TABLE "public"."usage_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "version_insert" ON "public"."artifact_versions" FOR INSERT TO "authenticated" WITH CHECK (("makeborne_private"."can_edit"("workspace_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "workspace_change" ON "public"."workspaces" FOR UPDATE TO "authenticated" USING ("makeborne_private"."is_owner"("id")) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "workspace_create" ON "public"."workspaces" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_read" ON "public"."workspaces" FOR SELECT TO "authenticated" USING ("makeborne_private"."can_read"("id"));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "makeborne_hosting" TO "anon";
GRANT USAGE ON SCHEMA "makeborne_hosting" TO "authenticated";
GRANT USAGE ON SCHEMA "makeborne_hosting" TO "service_role";



GRANT USAGE ON SCHEMA "makeborne_private" TO "authenticated";
GRANT USAGE ON SCHEMA "makeborne_private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "makeborne_hosting"."read_hosted_site"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_hosting"."save_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_hosting"."save_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."audit_account_privilege_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."begin_cloud_mutation"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."can_edit"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."can_edit"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "makeborne_private"."can_edit"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."can_read"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."can_read"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "makeborne_private"."can_read"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."claim_generation_dispatch"("p_reservation_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."claim_generation_dispatch"("p_reservation_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "makeborne_private"."create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "makeborne_private"."create_workspace"("p_request_key" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."create_workspace"("p_request_key" "uuid", "p_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "makeborne_private"."has_account_privilege"("p_user_id" "uuid", "p_privilege" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."has_account_privilege"("p_user_id" "uuid", "p_privilege" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."has_creation_membership"() FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."has_creation_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "makeborne_private"."has_creation_membership"() TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."is_owner"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."is_owner"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "makeborne_private"."is_owner"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."my_account_privileges"() FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."my_account_privileges"() TO "authenticated";



REVOKE ALL ON FUNCTION "makeborne_private"."prune_cloud_mutation_results"() FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."prune_cloud_mutation_results"() TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."release_generation_reservation"("p_reservation_id" "uuid", "p_actor" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."release_generation_reservation"("p_reservation_id" "uuid", "p_actor" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."require_creation_membership_write"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."reserve_generation_proposal"("p_proposal_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."reserve_generation_proposal"("p_proposal_id" "uuid", "p_request_key" "uuid", "p_actor" "uuid", "p_approval_hash" "text", "p_current_input_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "makeborne_private"."save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."save_idempotent_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "makeborne_private"."save_idempotent_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "makeborne_private"."touch_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."validate_client_outreach"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "makeborne_private"."validate_version_manifest"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."makeborne_billing_creation_enabled"("p_plan_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_billing_creation_enabled"("p_plan_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."makeborne_claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_claim_claude_pilot"("p_id" "uuid", "p_user" "uuid", "p_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."makeborne_client_directory"("p_workspace_id" "uuid", "p_search" "text", "p_stage" "text", "p_follow_up" "text", "p_day" "date", "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_client_directory"("p_workspace_id" "uuid", "p_search" "text", "p_stage" "text", "p_follow_up" "text", "p_day" "date", "p_offset" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_client_projects"("p_workspace_id" "uuid", "p_client_id" "uuid", "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_client_projects"("p_workspace_id" "uuid", "p_client_id" "uuid", "p_offset" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_cloud_schema_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_cloud_schema_version"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_create_record"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_operation" "text", "p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_create_studio_project"("p_workspace_id" "uuid", "p_request_key" "uuid", "p_project" "jsonb", "p_content" "jsonb", "p_style" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_create_workspace"("p_request_key" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_create_workspace"("p_request_key" "uuid", "p_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_my_account_privileges"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_my_account_privileges"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."makeborne_read_hosted_site"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."makeborne_record_whop_membership"("p_event_id" "text", "p_user_id" "uuid", "p_membership_id" "text", "p_checkout_id" "text", "p_whop_user_id" "text", "p_plan_id" "text", "p_status" "text", "p_period_end" timestamp with time zone, "p_verified_until" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_record_whop_membership"("p_event_id" "text", "p_user_id" "uuid", "p_membership_id" "text", "p_checkout_id" "text", "p_whop_user_id" "text", "p_plan_id" "text", "p_status" "text", "p_period_end" timestamp with time zone, "p_verified_until" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."makeborne_save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_save_artifact_version"("p_workspace_id" "uuid", "p_artifact_id" "uuid", "p_expected_version" integer, "p_content" "jsonb", "p_style" "jsonb", "p_asset_ids" "jsonb", "p_change_summary" "text", "p_request_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."makeborne_save_hosted_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."makeborne_save_hosted_site"("p_actor" "uuid", "p_workspace" "uuid", "p_artifact" "uuid", "p_version" integer, "p_slug" "text", "p_html" "text", "p_live" boolean, "p_revision" integer, "p_request" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;



GRANT SELECT ON TABLE "makeborne_private"."account_privilege_events" TO "service_role";



GRANT SELECT ON TABLE "makeborne_private"."account_privileges" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "makeborne_private"."billing_access_plans" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "makeborne_private"."billing_settings" TO "service_role";



GRANT SELECT ON TABLE "makeborne_private"."cloud_mutation_receipts" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "makeborne_private"."generation_budgets" TO "service_role";



GRANT SELECT ON TABLE "makeborne_private"."generation_dispatches" TO "service_role";



GRANT SELECT,INSERT ON TABLE "makeborne_private"."generation_proposals" TO "service_role";



GRANT SELECT ON TABLE "makeborne_private"."generation_reservations" TO "service_role";



GRANT SELECT ON TABLE "makeborne_private"."workspace_creation_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."artifact_versions" TO "service_role";
GRANT SELECT ON TABLE "public"."artifact_versions" TO "authenticated";



GRANT ALL ON TABLE "public"."artifacts" TO "service_role";
GRANT SELECT ON TABLE "public"."artifacts" TO "authenticated";



GRANT UPDATE("title") ON TABLE "public"."artifacts" TO "authenticated";



GRANT ALL ON TABLE "public"."assets" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."assets" TO "authenticated";



GRANT ALL ON TABLE "public"."audit_events" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_events" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."billing_checkouts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."billing_memberships" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."billing_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."budget_reservations" TO "service_role";
GRANT SELECT ON TABLE "public"."budget_reservations" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."claude_pilot_runs" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("company") ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("email") ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("website") ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("notes") ON TABLE "public"."clients" TO "authenticated";



GRANT UPDATE("outreach") ON TABLE "public"."clients" TO "authenticated";



GRANT ALL ON TABLE "public"."contacts" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."contacts" TO "authenticated";



GRANT ALL ON TABLE "public"."generation_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."generation_jobs" TO "authenticated";



GRANT ALL ON TABLE "public"."github_connections" TO "service_role";



GRANT ALL ON TABLE "public"."github_website_links" TO "service_role";



GRANT ALL ON TABLE "public"."hosted_sites" TO "service_role";
GRANT SELECT ON TABLE "public"."hosted_sites" TO "authenticated";



GRANT ALL ON TABLE "public"."projects" TO "service_role";
GRANT SELECT ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("client_id") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("title") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("status") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("style_id") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("brief") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("audience") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("purpose") ON TABLE "public"."projects" TO "authenticated";



GRANT UPDATE("wording") ON TABLE "public"."projects" TO "authenticated";



GRANT ALL ON TABLE "public"."published_releases" TO "service_role";
GRANT SELECT ON TABLE "public"."published_releases" TO "authenticated";



GRANT ALL ON TABLE "public"."reviews" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."sources" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sources" TO "authenticated";



GRANT ALL ON TABLE "public"."style_profiles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."style_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."tasks" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tasks" TO "authenticated";



GRANT ALL ON TABLE "public"."usage_ledger" TO "service_role";
GRANT SELECT ON TABLE "public"."usage_ledger" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."workspace_members" TO "authenticated";



GRANT ALL ON TABLE "public"."workspaces" TO "service_role";
GRANT SELECT ON TABLE "public"."workspaces" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."workspaces" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







