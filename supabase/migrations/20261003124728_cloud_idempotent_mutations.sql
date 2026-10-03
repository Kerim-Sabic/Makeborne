-- Unapplied. Idempotent writes commit the record and replay receipt together.
begin;
alter table public.workspaces add column mutation_daily_limit integer not null default 2000 check(mutation_daily_limit between 1 and 10000);
alter table public.workspaces add column mutation_ledger_limit integer not null default 100000 check(mutation_ledger_limit between 1 and 1000000);
create table makeborne_private.cloud_mutation_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id), operation text not null check(operation in ('create_client','create_project','create_artifact','save_version')),
  request_key uuid not null, payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  resource_id uuid, result jsonb check(result is null or octet_length(result::text)<=262144),
  created_at timestamptz not null default now(), replay_until timestamptz not null default (now()+interval '30 days'),
  primary key(workspace_id,actor_id,operation,request_key)
);
alter table makeborne_private.cloud_mutation_receipts enable row level security;
revoke all on makeborne_private.cloud_mutation_receipts from public,anon,authenticated;
grant select on makeborne_private.cloud_mutation_receipts to service_role;
create index mutation_receipts_created on makeborne_private.cloud_mutation_receipts(workspace_id,created_at);
create index mutation_receipts_expiration on makeborne_private.cloud_mutation_receipts(replay_until) where result is not null;

-- Called only by private implementations. Row lock bounds concurrent new receipts.
create function makeborne_private.begin_cloud_mutation(p_workspace_id uuid,p_request_key uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
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
revoke all on function makeborne_private.begin_cloud_mutation(uuid,uuid,text,jsonb) from public,anon,authenticated;

create function makeborne_private.create_record(p_workspace_id uuid,p_request_key uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
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
revoke all on function makeborne_private.create_record(uuid,uuid,text,jsonb) from public,anon;
grant execute on function makeborne_private.create_record(uuid,uuid,text,jsonb) to authenticated;
create function public.makeborne_create_record(p_workspace_id uuid,p_request_key uuid,p_operation text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_private.create_record(p_workspace_id,p_request_key,p_operation,p_payload);
$$;
revoke all on function public.makeborne_create_record(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.makeborne_create_record(uuid,uuid,text,jsonb) to authenticated;
-- Force API and direct Data API clients through the same receipt transaction.
revoke insert on public.clients,public.projects,public.artifacts from authenticated;
revoke insert(workspace_id,project_id,kind,title) on public.artifacts from authenticated;

create function makeborne_private.save_idempotent_version(
  p_workspace_id uuid,p_artifact_id uuid,p_expected_version integer,p_content jsonb,p_style jsonb,p_asset_ids jsonb,p_change_summary text,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
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
revoke all on function makeborne_private.save_idempotent_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text,uuid) from public,anon;
grant execute on function makeborne_private.save_idempotent_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text,uuid) to authenticated;
revoke execute on function makeborne_private.save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text) from authenticated;
drop function public.makeborne_save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text);
create function public.makeborne_save_artifact_version(
  p_workspace_id uuid,p_artifact_id uuid,p_expected_version integer,p_content jsonb,p_style jsonb,p_asset_ids jsonb,p_change_summary text,p_request_key uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_private.save_idempotent_version(p_workspace_id,p_artifact_id,p_expected_version,p_content,p_style,p_asset_ids,p_change_summary,p_request_key);
$$;
revoke all on function public.makeborne_save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text,uuid) from public,anon;
grant execute on function public.makeborne_save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text,uuid) to authenticated;

-- First account setup creates exactly one private workspace, even after an
-- uncertain HTTP result or concurrent attempts with different request keys.
create unique index one_owned_workspace_per_user on public.workspaces(owner_id);
create table makeborne_private.workspace_creation_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade, request_key uuid not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'), workspace_id uuid not null,
  result jsonb check(result is null or octet_length(result::text)<=4096),
  created_at timestamptz not null default now(), replay_until timestamptz not null default (now()+interval '30 days'),
  primary key(actor_id,request_key)
);
alter table makeborne_private.workspace_creation_receipts enable row level security;
revoke all on makeborne_private.workspace_creation_receipts from public,anon,authenticated;
grant select on makeborne_private.workspace_creation_receipts to service_role;
create function makeborne_private.create_workspace(p_request_key uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
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
revoke all on function makeborne_private.create_workspace(uuid,text) from public,anon;
grant execute on function makeborne_private.create_workspace(uuid,text) to authenticated;
create function public.makeborne_create_workspace(p_request_key uuid,p_name text) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.create_workspace(p_request_key,p_name); $$;
revoke all on function public.makeborne_create_workspace(uuid,text) from public,anon;
grant execute on function public.makeborne_create_workspace(uuid,text) to authenticated;
revoke insert on public.workspaces from authenticated;

-- Privileged retention removes bounded replay payloads, NEVER the durable key/hash.
-- Expired requests return MB410 rather than creating a duplicate record.
create function makeborne_private.prune_cloud_mutation_results() returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer; workspace_affected integer;
begin
  update makeborne_private.cloud_mutation_receipts set result=null where replay_until<=now() and result is not null;
  get diagnostics affected=row_count;
  update makeborne_private.workspace_creation_receipts set result=null where replay_until<=now() and result is not null;
  get diagnostics workspace_affected=row_count;
  return affected+workspace_affected;
end;
$$;
revoke all on function makeborne_private.prune_cloud_mutation_results() from public,anon,authenticated;
grant execute on function makeborne_private.prune_cloud_mutation_results() to service_role;
create or replace function public.makeborne_cloud_schema_version() returns text
language sql stable security invoker set search_path='' as $$ select '20261003_cloud_v2'::text; $$;
commit;
