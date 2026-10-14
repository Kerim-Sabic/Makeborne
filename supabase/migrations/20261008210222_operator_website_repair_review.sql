begin;
-- Extend the existing immutable proposal store, not a second ledger or dispatch path.
-- Customer workflows still require 3-4 stages and no operator purpose. The one-
-- draft exception is for unmeasured operator evaluation only; exact model/tariff/
-- consent/hash validation remains in the server-only qualification executor.
-- No new role grant, public API or spending enablement is introduced here.
alter table makeborne_private.generation_proposals drop constraint generation_proposal_snapshot_binding;
alter table makeborne_private.generation_proposals add constraint generation_proposal_snapshot_binding check (
    (snapshot->>'version' = 'generation-proposal-v1'
    and snapshot->>'inputHash' = input_hash
    and snapshot->>'approvalHash' = approval_hash
    and snapshot#>>'{input,scope,workspaceId}' = workspace_id::text
    and snapshot#>>'{input,scope,projectId}' = project_id::text
    and snapshot#>'{input,scope,artifactId}' = coalesce(to_jsonb(artifact_id::text),'null'::jsonb)
    and snapshot#>'{input,baseVersionId}' = coalesce(to_jsonb(base_version_id::text),'null'::jsonb)
    and snapshot#>>'{workflow,version}' = 'workflow-v1'
    and snapshot#>'{workflow,approved}' = 'false'::jsonb
    and snapshot#>>'{workflow,maximumVendorMicrousd}' = maximum_vendor_microusd::text
    and snapshot#>>'{workflow,maximumCustomerCredits}' = maximum_customer_credits::text
    and (snapshot#>>'{workflow,preparedAt}')::timestamptz = prepared_at
    and (snapshot#>>'{workflow,expiresAt}')::timestamptz = expires_at
    and jsonb_typeof(snapshot#>'{workflow,stages}')='array'
    and (
      (not (snapshot ? 'purpose') and jsonb_array_length(snapshot#>'{workflow,stages}') between 3 and 4)
      or (
        snapshot->>'purpose' = 'operator_qualification'
        and snapshot->>'qualificationRound' = 'claude-design-round-1'
        and snapshot#>>'{workflow,output}' = 'website'
        and artifact_id is not null
        and ((base_version_id is null and not (snapshot ? 'repairReview')) or
          (base_version_id is not null and jsonb_typeof(snapshot->'repairReview')='object'
            and snapshot#>>'{repairReview,reviewId}' ~ '^[a-f0-9-]{36}$'
            and snapshot#>>'{repairReview,reportHash}' ~ '^[a-f0-9]{64}$'
            and snapshot#>>'{repairReview,report,versionId}' = base_version_id::text
            and snapshot#>>'{repairReview,report,purpose}' = 'website_repair_review'
            and snapshot#>>'{repairReview,report,decision}' = 'changes_requested'))
        and maximum_customer_credits = 0
        and maximum_vendor_microusd between 1 and 25000000
        and jsonb_array_length(snapshot#>'{workflow,stages}') = 1
        and snapshot#>>'{workflow,stages,0,stage}' = 'draft'
        and snapshot#>'{workflow,stages,0,route,evaluation}' = 'null'::jsonb
        and snapshot#>>'{workflow,maximumExecutions}' = '1'
        and snapshot#>>'{workflow,stages,0,maximumExecutions}' = '1'
        and snapshot#>>'{workflow,stages,0,request,maximumAttempts}' = '1'
      )
    )) is true
);

-- Preserve original runtime authority and grants.
create or replace function makeborne_private.check_generation_authority(p_job public.generation_jobs) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r makeborne_private.generation_reservations%rowtype; q makeborne_private.generation_proposals%rowtype;
 binding jsonb; approved_source jsonb; source_row public.sources%rowtype; sources jsonb:='[]'::jsonb;
 review_row public.reviews%rowtype; repair jsonb; original_version public.artifact_versions%rowtype; original_build makeborne_private.project_builds%rowtype;
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
 -- Applies at enqueue, load, capped dispatch, canonical result and build replay.
 -- A review is repair input only; it never grants quality acceptance or spending.
 if q.snapshot ? 'repairReview' then
   repair:=q.snapshot->'repairReview';
   select * into review_row from public.reviews where id=(repair->>'reviewId')::uuid for share;
   select * into original_version from public.artifact_versions where id=q.base_version_id
     and artifact_id=q.artifact_id and workspace_id=q.workspace_id for share;
   select * into original_build from makeborne_private.project_builds where job_id=(repair#>>'{report,jobId}')::uuid
     and version_id=q.base_version_id and artifact_id=q.artifact_id and workspace_id=q.workspace_id for share;
   if review_row.id is null or original_version.id is null or original_build.status is distinct from 'compiled'
     or review_row.workspace_id is distinct from q.workspace_id or review_row.version_id is distinct from q.base_version_id
     or review_row.reviewer_id is distinct from r.approved_by or review_row.decision is distinct from 'changes_requested'
     or encode(extensions.digest(convert_to(review_row.body,'UTF8'),'sha256'),'hex') is distinct from repair->>'reportHash'
     or review_row.body::jsonb is distinct from repair->'report'
     or repair#>>'{report,reviewerId}' is distinct from r.approved_by::text
     or repair#>'{report,scope}' is distinct from q.snapshot#>'{input,scope}'
     or repair#>>'{report,sourceHash}' is distinct from original_build.receipt->>'sourceHash'
     or repair#>>'{report,buildHash}' is distinct from original_build.receipt->>'buildHash'
     or original_version.content is distinct from q.snapshot#>'{input,content}'
     or original_version.style_snapshot is distinct from q.snapshot#>'{input,style}' then
     raise exception 'Repair review changed or unavailable' using errcode='PT409';
   end if;
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


commit;
