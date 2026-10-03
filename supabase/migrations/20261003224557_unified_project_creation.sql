begin;
alter table public.projects add column effort text not null default 'medium'
  check(effort in ('light','medium','high','super_high','ultra'));
create function makeborne_private.create_studio_project(p_workspace_id uuid,p_request_key uuid,p_project jsonb,p_content jsonb,p_style jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
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
revoke all on function makeborne_private.create_studio_project(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function makeborne_private.create_studio_project(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
create function public.makeborne_create_studio_project(p_workspace_id uuid,p_request_key uuid,p_project jsonb,p_content jsonb,p_style jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_private.create_studio_project(p_workspace_id,p_request_key,p_project,p_content,p_style);
$$;
revoke all on function public.makeborne_create_studio_project(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.makeborne_create_studio_project(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
commit;
