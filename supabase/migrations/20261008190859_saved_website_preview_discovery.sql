begin;

-- Saved revision is the lookup identity. Browser-local request references are
-- never needed to recover an existing build, and this function cannot enqueue,
-- approve, settle, extend a grant or authorize a paid operation.
create function makeborne_private.saved_website_generation(p_workspace uuid,p_artifact uuid,p_version uuid,
 p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare artifact public.artifacts%rowtype; version public.artifact_versions%rowtype;
 build makeborne_private.project_builds%rowtype; progress jsonb;
begin
 perform 1 from public.workspaces where id=p_workspace for share;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 if not exists(select 1 from public.workspaces where id=p_workspace and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor
     and role in ('editor','reviewer') for share) then
   raise exception 'Saved website unavailable' using errcode='P0002'; end if;
 select * into artifact from public.artifacts where id=p_artifact and workspace_id=p_workspace and kind='website';
 if artifact.id is null then raise exception 'Saved website unavailable' using errcode='P0002'; end if;
 select * into version from public.artifact_versions where id=p_version and artifact_id=artifact.id and workspace_id=p_workspace;
 if version.id is null then raise exception 'Saved website unavailable' using errcode='P0002'; end if;
 if jsonb_typeof(version.content->'websiteSource') is distinct from 'object' then return null; end if;
 -- version_id is unique. Original job/build readers acquire their existing
 -- row locks in their established order; do not lock build before job here.
 select * into build from makeborne_private.project_builds where version_id=version.id
   and artifact_id=artifact.id and workspace_id=p_workspace;
 if build.job_id is null then return null; end if;
 progress:=makeborne_private.submission_progress(build.job_id,p_actor,p_session,p_expires);
 if progress->>'outputVersionId' is distinct from version.id::text
   or progress->'scope'->>'workspaceId' is distinct from p_workspace::text
   or progress->'scope'->>'projectId' is distinct from artifact.project_id::text
   or progress->'scope'->>'artifactId' is distinct from artifact.id::text then
   raise exception 'Saved website unavailable' using errcode='P0002'; end if;
 if progress->>'state' in ('awaiting_review','ready') then
   perform makeborne_private.read_project_preview(build.job_id,version.id,build.receipt->>'buildHash',p_actor,p_session,p_expires);
 end if;
 return progress;
end $$;
revoke all on function makeborne_private.saved_website_generation(uuid,uuid,uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.saved_website_generation(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;

create function public.makeborne_saved_website_generation(p_workspace uuid,p_artifact uuid,p_version uuid,
 p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.saved_website_generation(p_workspace,p_artifact,p_version,p_actor,p_session,p_expires);
$$;
revoke all on function public.makeborne_saved_website_generation(uuid,uuid,uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function public.makeborne_saved_website_generation(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;
commit;
