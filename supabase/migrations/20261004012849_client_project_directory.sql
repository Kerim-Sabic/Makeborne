begin;
create function public.makeborne_client_projects(p_workspace_id uuid,p_client_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
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
revoke all on function public.makeborne_client_projects(uuid,uuid,integer) from public,anon;
grant execute on function public.makeborne_client_projects(uuid,uuid,integer) to authenticated;
commit;
