begin;
-- Current authority remains mandatory on replay. Only this job's exact confirmed
-- result may replace its original base; an intervening customer revision cannot.
create or replace function makeborne_private.check_generation_authority(p_job public.generation_jobs) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r makeborne_private.generation_reservations%rowtype; q makeborne_private.generation_proposals%rowtype;
 binding jsonb; approved_source jsonb; source_row public.sources%rowtype; sources jsonb:='[]'::jsonb;
 latest uuid; artifact_kind text; owner_uuid uuid; member_role text; input_bytes bigint;
begin
 select * into r from makeborne_private.generation_reservations where id=p_job.reservation_id;
 binding:=r.authorization_snapshot;
 if binding is null or binding->>'version' is distinct from 'generation-authorization-v1'
   or binding->'processingConsent' is distinct from 'true'::jsonb
   or binding->'sourceRightsConfirmed' is distinct from 'true'::jsonb
   or (binding->>'expiresAt')::timestamptz<=clock_timestamp() then
   raise exception 'Current generation authorization required' using errcode='42501';
 end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=(binding->>'sessionId')::uuid and s.user_id=r.approved_by
     and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=clock_timestamp()) and not coalesce(u.is_anonymous,false)
   for share of s,u;
 if not found or not makeborne_private.has_creation_membership_for_actor(r.approved_by) then
   raise exception 'Current authenticated creation access required' using errcode='42501';
 end if;
 select owner_id into owner_uuid from public.workspaces where id=p_job.workspace_id;
 if owner_uuid is distinct from r.approved_by then
   select role into member_role from public.workspace_members where workspace_id=p_job.workspace_id and user_id=r.approved_by for share;
   if member_role is distinct from 'editor' then raise exception 'Current editor access required' using errcode='42501'; end if;
 end if;
 select * into q from makeborne_private.generation_proposals where id=r.proposal_id for share;
 if q.workspace_id is distinct from p_job.workspace_id or q.project_id is distinct from p_job.project_id
   or q.artifact_id is distinct from p_job.artifact_id or q.expires_at<=clock_timestamp()
   or encode(extensions.digest(convert_to(q.snapshot::text,'UTF8'),'sha256'),'hex') is distinct from binding->>'proposalFingerprint' then
   raise exception 'Approved proposal changed' using errcode='PT409';
 end if;
 if q.artifact_id is null then raise exception 'Saved artifact scope required' using errcode='PT409'; end if;
 select kind into artifact_kind from public.artifacts where id=q.artifact_id and workspace_id=q.workspace_id and project_id=q.project_id for share;
 select id into latest from public.artifact_versions where artifact_id=q.artifact_id and workspace_id=q.workspace_id order by version_number desc limit 1;
 if artifact_kind is distinct from q.snapshot#>>'{workflow,output}' or (latest is distinct from q.base_version_id and not exists(
     select 1 from makeborne_private.generation_provider_outcomes o
     join public.artifact_versions v on v.id=o.result_version_id and v.workspace_id=o.workspace_id and v.artifact_id=o.artifact_id
     where o.job_id=p_job.id and o.workspace_id=p_job.workspace_id and o.artifact_id=p_job.artifact_id
       and o.succeeded and o.result_version_id=latest and v.parent_version_id is not distinct from q.base_version_id
   )) then
   raise exception 'Approved project revision changed' using errcode='PT409';
 end if;
 if exists(select 1 from jsonb_array_elements(q.snapshot#>'{workflow,stages}') s
   where s#>>'{route,dataBoundary}' is distinct from 'workspace_private')
   and binding->'externalProcessingConsent' is distinct from 'true'::jsonb then
   raise exception 'External processing consent required' using errcode='42501';
 end if;
 input_bytes:=octet_length(q.snapshot::text);
 for approved_source in select jsonb_array_elements(binding->'sources') loop
   select * into source_row from public.sources where id=(approved_source->>'id')::uuid
     and workspace_id=p_job.workspace_id and project_id=p_job.project_id and approved for share;
   if not found then raise exception 'Approved source changed or unavailable' using errcode='PT409'; end if;
   input_bytes:=input_bytes+octet_length(source_row.content)+octet_length(source_row.title)+512;
   if input_bytes>6291456 then raise exception 'Approved material needs bounded ingestion' using errcode='22023'; end if;
   if encode(extensions.digest(convert_to((to_jsonb(source_row)-'created_at')::text,'UTF8'),'sha256'),'hex') is distinct from approved_source->>'fingerprint' then
     raise exception 'Approved source changed or unavailable' using errcode='PT409';
   end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('id',source_row.id,'title',source_row.title,'text',source_row.content));
   if octet_length(sources::text)>6291456 then raise exception 'Approved material needs bounded ingestion' using errcode='22023'; end if;
 end loop;
 return jsonb_build_object('proposal',q.snapshot,'sourceMaterial',sources,'actorId',r.approved_by,
   'authorizationExpiresAt',binding->>'expiresAt');
end $$;
revoke all on function makeborne_private.check_generation_authority(public.generation_jobs) from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;

-- Reuse the canonical version writer and accounting authority in one transaction.
-- The executor validates the full application schema before calling this function;
-- database guards still independently enforce scope, representation and assets.
create function makeborne_private.commit_generation_worker_result(
 p_job uuid,p_worker uuid,p_fence bigint,p_dispatch uuid,p_cost bigint,
 p_provider text,p_model text,p_tariff text,p_request text,p_evidence text,
 p_content jsonb,p_style jsonb,p_asset_ids jsonb,p_summary text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; authorized jsonb; expected integer; saved jsonb; outcome uuid;
 previous_claims text; previous_sub text; previous_role text; actor uuid;
begin
 -- The canonical mutation writer takes an exclusive workspace lock. Take it
 -- before the job's usual SHARE lock, never upgrade after acquiring job locks.
 perform 1 from public.workspaces w join public.generation_jobs j on j.workspace_id=w.id where j.id=p_job for update of w;
 job:=makeborne_private.lock_generation_job(p_job);
 if p_worker is null or p_fence is null or p_dispatch is null or job.status<>'running'
   or job.cancel_requested_at is not null or job.lease_owner is distinct from p_worker
   or job.fence is distinct from p_fence or job.lease_expires_at is null
   or job.lease_expires_at<=clock_timestamp() or job.deadline_at<=clock_timestamp() then
   raise exception 'Live worker fence required for result commit' using errcode='PT409';
 end if;
 authorized:=makeborne_private.check_generation_authority(job);
 actor:=(authorized->>'actorId')::uuid;
 if p_content->>'kind' is distinct from authorized#>>'{proposal,workflow,output}'
   or (p_content->>'kind'='website' and (not p_content ? 'websiteSource' or p_content ? 'website')) then
   raise exception 'Generated result must match approved output representation' using errcode='22023';
 end if;
 select coalesce(v.version_number,0) into expected
   from (select (authorized#>>'{proposal,input,baseVersionId}')::uuid as id) b
   left join public.artifact_versions v on v.id=b.id and v.workspace_id=job.workspace_id and v.artifact_id=job.artifact_id;
 -- The approved actor is server-derived, never supplied by the worker. Restore
 -- every auth setting before returning, including failure paths in pooled SQL.
 previous_claims:=current_setting('request.jwt.claims',true);
 previous_sub:=current_setting('request.jwt.claim.sub',true);
 previous_role:=current_setting('request.jwt.claim.role',true);
 begin
   perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated',
     'session_id',(select authorization_snapshot->>'sessionId' from makeborne_private.generation_reservations where id=job.reservation_id))::text,true);
   perform set_config('request.jwt.claim.sub',actor::text,true);
   perform set_config('request.jwt.claim.role','authenticated',true);
   saved:=makeborne_private.save_idempotent_version(job.workspace_id,job.artifact_id,expected,p_content,p_style,p_asset_ids,p_summary,p_dispatch);
   outcome:=makeborne_private.record_capped_generation_outcome(job.id,p_worker,p_fence,p_dispatch,true,p_cost,p_provider,p_model,p_tariff,p_request,p_evidence,(saved->'version'->>'id')::uuid);
   perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
   perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
   perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
 exception when others then
   perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
   perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
   perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
   raise;
 end;
 return jsonb_build_object('outcomeId',outcome,'versionId',saved->'version'->>'id','replayed',saved->'replayed',
   'stage','output_review','readyForPublication',false);
end $$;
revoke all on function makeborne_private.commit_generation_worker_result(uuid,uuid,bigint,uuid,bigint,text,text,text,text,text,jsonb,jsonb,jsonb,text)
 from public,anon,authenticated,service_role,makeborne_generation_publisher;
grant execute on function makeborne_private.commit_generation_worker_result(uuid,uuid,bigint,uuid,bigint,text,text,text,text,text,jsonb,jsonb,jsonb,text)
 to makeborne_generation_worker;
commit;

