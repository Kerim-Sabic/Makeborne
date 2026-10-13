-- Token-scoped canonical document artwork. The locator never reaches anonymous
-- clients: only the server's rasterizing route may call this resolver.
begin;
create or replace function makeborne_private.client_review_asset(p_token text,p_version integer,p_asset uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; t record; v public.artifact_versions%rowtype; a public.assets%rowtype;
begin
  select * into r from makeborne_private.client_review_live_link(p_token,false);
  select * into t from makeborne_private.client_review_target(r);
  if p_version is null or p_version < 1 or p_version is distinct from t.version_number then
    raise exception 'This review changed; refresh before loading artwork' using errcode='PT409';
  end if;
  select * into v from public.artifact_versions where workspace_id=r.workspace_id and artifact_id=r.artifact_id and version_number=p_version;
  if not found or coalesce(v.content->'document'->>'kind','') not in ('book','deck')
    or not (v.asset_manifest @> jsonb_build_array(p_asset::text))
    or not exists(select 1 from jsonb_array_elements(v.content->'document'->'assets') item where item->>'id'=p_asset::text) then
    raise exception 'Review artwork unavailable' using errcode='P0002';
  end if;
  select * into a from public.assets where id=p_asset and workspace_id=r.workspace_id and project_id=r.project_id;
  if not found or a.content_type not in ('image/png','image/jpeg','image/webp')
    or a.object_path not like r.workspace_id::text || '/' || r.project_id::text || '/%'
    or a.sha256 is null then
    raise exception 'Review artwork unavailable' using errcode='P0002';
  end if;
  return jsonb_build_object('assetId',a.id,'version',p_version,'workspaceId',r.workspace_id,'projectId',r.project_id,
    'objectPath',a.object_path,'contentType',a.content_type,'sha256',a.sha256);
end $$;
revoke all on function makeborne_private.client_review_asset(text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.client_review_asset(text,integer,uuid) to service_role;
create or replace function public.makeborne_client_review_asset(p_token text,p_version integer,p_asset uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.client_review_asset(p_token,p_version,p_asset);
$$;
revoke all on function public.makeborne_client_review_asset(text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_client_review_asset(text,integer,uuid) to service_role;
commit;
