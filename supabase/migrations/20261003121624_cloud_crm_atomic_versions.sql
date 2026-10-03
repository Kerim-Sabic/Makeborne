-- Unapplied: enable cloud only after both migrations and the isolation matrix pass.
begin;
alter table public.clients add column updated_at timestamptz(3) not null default now();
alter table public.projects alter column updated_at type timestamptz(3);
alter table public.artifacts alter column updated_at type timestamptz(3);
alter table public.projects add column audience text not null default '' check(length(audience)<=1000);
alter table public.projects add column purpose text not null default '' check(length(purpose)<=2000);
alter table public.projects add column wording text not null default 'preserve' check(wording in ('preserve','improve','summarise'));

create function makeborne_private.touch_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at := greatest(clock_timestamp()::timestamptz(3),old.updated_at+interval '1 millisecond');
  return new;
end;
$$;
revoke all on function makeborne_private.touch_updated_at() from public,anon,authenticated;
create trigger clients_updated_at before update on public.clients for each row execute function makeborne_private.touch_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function makeborne_private.touch_updated_at();
create trigger artifacts_updated_at before update on public.artifacts for each row execute function makeborne_private.touch_updated_at();

-- Cloud callers cannot bypass revision ownership by changing primary/tenant IDs,
-- timestamps, format, current revision pointers, or direct snapshot insertion.
revoke update on public.clients,public.projects,public.artifacts from authenticated;
grant update(name,company,email,website,notes) on public.clients to authenticated;
grant update(client_id,title,status,style_id,brief,audience,purpose,wording) on public.projects to authenticated;
grant update(title) on public.artifacts to authenticated;
revoke insert on public.artifacts,public.artifact_versions from authenticated;
grant insert(workspace_id,project_id,kind,title) on public.artifacts to authenticated;

create function public.makeborne_cloud_schema_version() returns text
language sql stable security invoker set search_path='' as $$ select '20261003_cloud_v1'::text; $$;
revoke all on function public.makeborne_cloud_schema_version() from public,anon;
grant execute on function public.makeborne_cloud_schema_version() to authenticated;

-- Privileged implementation lives outside exposed schemas. It checks current DB
-- membership and scopes every row explicitly before any privileged write.
create function makeborne_private.save_artifact_version(
  p_workspace_id uuid,p_artifact_id uuid,p_expected_version integer,p_content jsonb,
  p_style jsonb,p_asset_ids jsonb,p_change_summary text
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  artifact_row public.artifacts;
  version_row public.artifact_versions;
  previous_id uuid;
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
    raise exception 'Revision conflict' using errcode='40001';
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
    select v.id into previous_id from public.artifact_versions v where v.artifact_id=p_artifact_id and v.workspace_id=p_workspace_id and v.version_number=artifact_row.current_version;
    if previous_id is null then raise exception 'Missing current snapshot' using errcode='23514'; end if;
  end if;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,asset_manifest,change_summary,created_by)
  values(p_workspace_id,p_artifact_id,p_expected_version+1,previous_id,p_content,p_style,p_asset_ids,p_change_summary,(select auth.uid())) returning * into version_row;
  update public.artifacts set current_version=p_expected_version+1,title=p_content->>'title' where id=p_artifact_id and workspace_id=p_workspace_id returning * into artifact_row;
  return jsonb_build_object('artifact',to_jsonb(artifact_row),'version',to_jsonb(version_row));
end;
$$;
revoke all on function makeborne_private.save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function makeborne_private.save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text) to authenticated;

-- Exposed wrapper is invoker, not definer; authenticated clients only.
create function public.makeborne_save_artifact_version(
  p_workspace_id uuid,p_artifact_id uuid,p_expected_version integer,p_content jsonb,p_style jsonb,p_asset_ids jsonb,p_change_summary text
) returns jsonb
language sql security invoker set search_path='' as $$
  select makeborne_private.save_artifact_version(p_workspace_id,p_artifact_id,p_expected_version,p_content,p_style,p_asset_ids,p_change_summary);
$$;
revoke all on function public.makeborne_save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.makeborne_save_artifact_version(uuid,uuid,integer,jsonb,jsonb,jsonb,text) to authenticated;
commit;
