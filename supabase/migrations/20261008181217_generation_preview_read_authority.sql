begin;

-- Internal read authority. These verified viewer fields come from Auth on the
-- server, never from a browser-supplied actor or an object-storage URL.
create function makeborne_private.read_project_preview(p_job uuid,p_version uuid,p_build_hash text,
 p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; build makeborne_private.project_builds%rowtype;
 version public.artifact_versions%rowtype; workspace uuid; is_owner boolean;
begin
 select workspace_id into workspace from public.generation_jobs where id=p_job;
 perform 1 from public.workspaces where id=workspace for share;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 perform 1 from public.workspaces where id=workspace and owner_id=p_actor for share;
 is_owner:=found;
 if not is_owner then
   perform 1 from public.workspace_members where workspace_id=workspace and user_id=p_actor
     and role in ('editor','reviewer') for share;
   if not found then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 end if;
 select * into job from public.generation_jobs where id=p_job and workspace_id=workspace for share;
 if job.id is null or job.status not in ('running','succeeded') or job.cancel_requested_at is not null then
   raise exception 'Preview unavailable' using errcode='P0002'; end if;
 select * into build from makeborne_private.project_builds where job_id=job.id and workspace_id=workspace
   and artifact_id=job.artifact_id and version_id=p_version and status='compiled' for share;
 if build.job_id is null or p_build_hash is null or p_build_hash !~ '^[a-f0-9]{64}$'
   or build.receipt->>'buildHash' is distinct from p_build_hash then
   raise exception 'Preview unavailable' using errcode='P0002'; end if;
 perform 1 from public.artifacts where id=job.artifact_id and project_id=job.project_id
   and workspace_id=workspace and kind='website' for share;
 if not found then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 select * into version from public.artifact_versions where id=p_version and artifact_id=job.artifact_id
   and workspace_id=workspace for share;
 if version.id is null or jsonb_typeof(version.content->'websiteSource') is distinct from 'object'
   or encode(extensions.digest(convert_to(jsonb_build_object('content',version.content,'style',version.style_snapshot,'assets',version.asset_manifest)::text,'UTF8'),'sha256'),'hex') is distinct from build.result_hash
   or build.receipt->>'revisionId' is distinct from version.id::text
   or build.receipt->>'artifactId' is distinct from job.artifact_id::text
   or build.receipt->'version' is distinct from to_jsonb(version.version_number)
   or not exists(select 1 from makeborne_private.generation_provider_outcomes o where o.id=build.outcome_id
     and o.job_id=job.id and o.workspace_id=workspace and o.succeeded and o.result_version_id=version.id
     and o.result_hash=build.result_hash and o.artifact_id=job.artifact_id) then
   raise exception 'Preview unavailable' using errcode='P0002'; end if;
 -- Reading an existing saved build does not require a new paid membership or
 -- the original generating actor's still-active session. No credit authority.
 return jsonb_build_object('jobId',job.id,'scope',jsonb_build_object('workspaceId',workspace,
   'projectId',job.project_id,'artifactId',job.artifact_id),'versionId',version.id,'receipt',build.receipt);
end $$;
revoke all on function makeborne_private.read_project_preview(uuid,uuid,text,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.read_project_preview(uuid,uuid,text,uuid,uuid,timestamptz) to service_role;

create function public.makeborne_project_preview(p_job uuid,p_version uuid,p_build_hash text,
 p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.read_project_preview(p_job,p_version,p_build_hash,p_actor,p_session,p_expires);
$$;
revoke all on function public.makeborne_project_preview(uuid,uuid,text,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function public.makeborne_project_preview(uuid,uuid,text,uuid,uuid,timestamptz) to service_role;
commit;
