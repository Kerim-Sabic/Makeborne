begin;

-- Add a source representation to existing immutable snapshots, not a second
-- revision store. Application schemas validate portable paths/files; database
-- guards independently enforce format/asset authority and prevent old clients
-- from silently downgrading a source project into an outline.
create function makeborne_private.validate_website_source_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_value jsonb; descriptor jsonb; project_uuid uuid; artifact_kind text;
begin
  if not (new.content ? 'websiteSource') then
    if new.parent_version_id is not null and exists(
      select 1 from public.artifact_versions v where v.id=new.parent_version_id
        and v.artifact_id=new.artifact_id and v.workspace_id=new.workspace_id and v.content ? 'websiteSource'
    ) then raise exception 'Full-source projects cannot be replaced by an outline' using errcode='22023'; end if;
    return new;
  end if;
  source_value:=new.content->'websiteSource';
  select a.project_id,a.kind into project_uuid,artifact_kind from public.artifacts a
    where a.id=new.artifact_id and a.workspace_id=new.workspace_id;
  if artifact_kind is distinct from 'website' or new.content->>'kind' is distinct from 'website'
    or new.content ? 'website' or new.content->'sections' is distinct from '[]'::jsonb
    or jsonb_typeof(source_value) is distinct from 'object'
    or source_value->'schemaVersion' is distinct from '1'::jsonb
    or source_value->>'toolchainId' is distinct from 'react-vite-v1'
    or source_value->>'entrypoint' is distinct from 'src/main.tsx'
    or jsonb_typeof(source_value->'files') is distinct from 'array'
    or jsonb_typeof(source_value->'assets') is distinct from 'array'
    or jsonb_typeof(source_value->'routes') is distinct from 'array' then
    raise exception 'Invalid full-source website representation' using errcode='22023';
  end if;
  if jsonb_array_length(source_value->'files') not between 4 and 200
    or jsonb_array_length(source_value->'assets')>100
    or jsonb_array_length(source_value->'routes') not between 1 and 100 then
    raise exception 'Source manifest exceeds supported limits' using errcode='22023';
  end if;
  for descriptor in select jsonb_array_elements(source_value->'assets') loop
    if jsonb_typeof(descriptor) is distinct from 'object'
      or coalesce(descriptor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(descriptor->>'sha256','') !~ '^[0-9a-f]{64}$'
      or not new.asset_manifest @> jsonb_build_array(descriptor->>'id') then
      raise exception 'Invalid or unlisted source asset' using errcode='23514';
    end if;
    perform 1 from public.assets a where a.id=(descriptor->>'id')::uuid
      and a.workspace_id=new.workspace_id and a.project_id=project_uuid
      and a.sha256=descriptor->>'sha256' and a.content_type=descriptor->>'mediaType'
      for share;
    if not found then raise exception 'Source artwork must match this project' using errcode='23514'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function makeborne_private.validate_website_source_revision() from public,anon,authenticated;
create trigger website_source_revision_guard before insert on public.artifact_versions
for each row execute function makeborne_private.validate_website_source_revision();

-- Storage already denies browser update/delete. Preserve registered identity
-- once referenced by an immutable snapshot, so future builds can reverify it.
create function makeborne_private.protect_referenced_asset_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.artifact_versions v where v.workspace_id=old.workspace_id
      and v.asset_manifest @> jsonb_build_array(old.id::text)) then
    if tg_op='DELETE' then
      raise exception 'Referenced asset cannot be deleted' using errcode='23514';
    end if;
    if (new.id,new.workspace_id,new.project_id,new.object_path,new.content_type,new.sha256)
        is distinct from (old.id,old.workspace_id,old.project_id,old.object_path,old.content_type,old.sha256) then
      raise exception 'Referenced asset identity is immutable; register a new asset' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function makeborne_private.protect_referenced_asset_identity() from public,anon,authenticated;
create trigger referenced_asset_identity_guard before update or delete on public.assets
for each row execute function makeborne_private.protect_referenced_asset_identity();

commit;
