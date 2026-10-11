begin;

-- Preserve prior customer/operator branches; add only saved native composition.
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
        snapshot->>'purpose' = 'presentation_composition'
        and snapshot#>>'{workflow,output}' = 'presentation'
        and snapshot#>>'{workflow,presentationMode}' = 'editable'
        and snapshot#>'{workflow,includeImages}' = 'false'::jsonb
        and artifact_id is not null and base_version_id is not null
        and jsonb_array_length(snapshot#>'{workflow,stages}') = 1
        and snapshot#>>'{workflow,stages,0,stage}' = 'draft'
        and snapshot#>>'{workflow,stages,0,route,provider}' = 'anthropic'
        and jsonb_typeof(snapshot#>'{workflow,stages,0,route,evaluation}') = 'object'
        and snapshot#>>'{workflow,maximumExecutions}' = '1'
        and snapshot#>>'{workflow,stages,0,maximumExecutions}' = '1'
        and snapshot#>>'{workflow,stages,0,request,maximumAttempts}' = '1'
      )
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

-- Extend the original preparation authority; no new tables, bridges or grants.
-- Existing service-only invoker bridges and private function ACLs are preserved.
create or replace function makeborne_private.read_generation_preparation(p_request jsonb,p_request_key uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare workspace uuid; project uuid; artifact uuid; base uuid; ids jsonb; source_id text;
 project_row public.projects%rowtype; artifact_row public.artifacts%rowtype; version_row public.artifact_versions%rowtype;
 source_row public.sources%rowtype; sources jsonb:='[]'::jsonb; records jsonb; receipt makeborne_private.cloud_mutation_receipts%rowtype;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384 or p_request_key is null then
   raise exception 'Bounded preparation request required' using errcode='22023'; end if;
 workspace:=(p_request#>>'{scope,workspaceId}')::uuid; project:=(p_request#>>'{scope,projectId}')::uuid;
 artifact:=(p_request#>>'{scope,artifactId}')::uuid; base:=(p_request->>'baseVersionId')::uuid; ids:=p_request->'sourceIds';
 if workspace is null or project is null or artifact is null or base is null
   or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>100
   or p_request->'processingConsent' is distinct from 'true'::jsonb or p_request->'sourceRightsConfirmed' is distinct from 'true'::jsonb
   or jsonb_typeof(p_request->'externalProcessingConsent') is distinct from 'boolean'
   or p_request is distinct from jsonb_build_object('scope',jsonb_build_object('workspaceId',workspace,'projectId',project,'artifactId',artifact),
      'baseVersionId',base,'sourceIds',ids,'processingConsent',true,'externalProcessingConsent',p_request->'externalProcessingConsent','sourceRightsConfirmed',true) then
   raise exception 'Exact saved input and consent references required' using errcode='22023'; end if;
 if (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct value) from jsonb_array_elements_text(ids)) then
   raise exception 'Unique approved sources required' using errcode='22023'; end if;
 perform 1 from public.workspaces where id=workspace for update;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 if not exists(select 1 from public.workspaces where id=workspace and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=workspace and user_id=p_actor and role='editor' for share) then
   raise exception 'Project unavailable' using errcode='P0002'; end if;
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation access required' using errcode='42501'; end if;
 select * into receipt from makeborne_private.cloud_mutation_receipts
   where workspace_id=workspace and actor_id=p_actor and operation='prepare_generation' and request_key=p_request_key;
 if found then
   if receipt.payload_sha256<>encode(sha256(convert_to(p_request::text,'UTF8')),'hex') then raise exception 'Preparation replay changed' using errcode='MB409'; end if;
   if receipt.result is null or receipt.replay_until<=now() then raise exception 'Preparation replay expired' using errcode='MB410'; end if;
   return jsonb_build_object('prepared',receipt.result);
 end if;
 select * into project_row from public.projects where id=project and workspace_id=workspace for share;
 select * into artifact_row from public.artifacts where id=artifact and project_id=project and workspace_id=workspace for share;
 if project_row.id is null or artifact_row.id is null then raise exception 'Project unavailable' using errcode='P0002'; end if;
 if project_row.kind::text not in ('website','presentation') or artifact_row.kind is distinct from project_row.kind then
   raise exception 'Supported matching project format required' using errcode='22023'; end if;
 select * into version_row from public.artifact_versions where id=base and artifact_id=artifact and workspace_id=workspace
   and version_number=artifact_row.current_version for share;
 if not found then raise exception 'Saved revision changed' using errcode='PT409'; end if;
 if version_row.content->>'kind' is distinct from artifact_row.kind::text then
   raise exception 'Saved content format must match artifact' using errcode='22023'; end if;
 for source_id in select jsonb_array_elements_text(ids) loop
   select * into source_row from public.sources where id=source_id::uuid and workspace_id=workspace and project_id=project and approved for share;
   if not found then raise exception 'Approved source unavailable' using errcode='P0002'; end if;
   sources:=sources||jsonb_build_array(to_jsonb(source_row));
 end loop;
 records:=jsonb_build_object('scope',p_request->'scope','project',to_jsonb(project_row),'artifact',to_jsonb(artifact_row),
   'version',to_jsonb(version_row),'sources',sources);
 if octet_length(records::text)>6291456 then raise exception 'Bounded ingestion required' using errcode='22023'; end if;
 return jsonb_build_object('records',records,'stateHash',encode(sha256(convert_to(records::text,'UTF8')),'hex'));
end $$;

create or replace function makeborne_private.store_generation_preparation(p_request jsonb,p_request_key uuid,p_actor uuid,p_session uuid,p_expires timestamptz,p_state_hash text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare current_state jsonb; records jsonb; expected_input jsonb; proposal uuid; prepared_result jsonb; receipt jsonb;
 old_sub text:=current_setting('request.jwt.claim.sub',true); old_claims text:=current_setting('request.jwt.claims',true); old_role text:=current_setting('request.jwt.claim.role',true);
begin
 current_state:=makeborne_private.read_generation_preparation(p_request,p_request_key,p_actor,p_session,p_expires);
 if current_state ? 'prepared' then return current_state->'prepared'; end if;
 if p_state_hash is distinct from current_state->>'stateHash' then raise exception 'Saved input changed during preparation' using errcode='PT409'; end if;
 records:=current_state->'records';
 expected_input:=jsonb_build_object('scope',p_request->'scope','baseVersionId',p_request->'baseVersionId',
   'brief',records#>'{project,brief}','audience',records#>'{project,audience}','purpose',records#>'{project,purpose}',
   'wording',records#>'{project,wording}','content',records#>'{version,content}','style',records#>'{version,style_snapshot}','sourceIds',p_request->'sourceIds');
 if p_snapshot is null or p_snapshot->'input' is distinct from expected_input
   or p_snapshot#>>'{workflow,output}' is distinct from records#>>'{artifact,kind}'
   or p_snapshot#>>'{workflow,effort,level}' is distinct from records#>>'{project,effort}'
   or p_snapshot#>'{workflow,includeImages}' is distinct from 'false'::jsonb
   or (p_snapshot#>>'{workflow,expiresAt}')::timestamptz<=clock_timestamp()
   or abs(extract(epoch from ((p_snapshot#>>'{workflow,preparedAt}')::timestamptz-clock_timestamp())))>60 then
   raise exception 'Proposal must bind exact saved input' using errcode='22023'; end if;
 -- Native composition has a separate explicit purpose from narrative/image
 -- creation. SQL binds its shape independently of the trusted app validator.
 if records#>>'{artifact,kind}'='presentation' and (
   p_snapshot->>'purpose' is distinct from 'presentation_composition'
   or p_snapshot#>>'{workflow,presentationMode}' is distinct from 'editable'
   or p_snapshot#>'{workflow,maximumExecutions}' is distinct from '1'::jsonb
   or jsonb_typeof(p_snapshot#>'{workflow,stages}') is distinct from 'array'
   or jsonb_array_length(p_snapshot#>'{workflow,stages}') is distinct from 1
   or p_snapshot#>>'{workflow,stages,0,stage}' is distinct from 'draft'
   or p_snapshot#>'{workflow,stages,0,maximumExecutions}' is distinct from '1'::jsonb
   or p_snapshot#>>'{workflow,stages,0,route,provider}' is distinct from 'anthropic'
 ) then raise exception 'Explicit bounded native composition required' using errcode='22023'; end if;
 -- Reuse the original mutation limiter/receipt under a verified trusted actor.
 -- Restore all transaction-local JWT settings before returning or raising.
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 receipt:=makeborne_private.begin_cloud_mutation((p_request#>>'{scope,workspaceId}')::uuid,p_request_key,'prepare_generation',p_request);
 if (receipt->>'replayed')::boolean then prepared_result:=receipt->'result';
 else
   insert into makeborne_private.generation_proposals(workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,
     maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
   values((p_request#>>'{scope,workspaceId}')::uuid,(p_request#>>'{scope,projectId}')::uuid,(p_request#>>'{scope,artifactId}')::uuid,
     (p_request->>'baseVersionId')::uuid,p_snapshot->>'inputHash',p_snapshot->>'approvalHash',p_snapshot,
     (p_snapshot#>>'{workflow,maximumVendorMicrousd}')::bigint,(p_snapshot#>>'{workflow,maximumCustomerCredits}')::bigint,
     (p_snapshot#>>'{workflow,preparedAt}')::timestamptz,(p_snapshot#>>'{workflow,expiresAt}')::timestamptz)
     on conflict(workspace_id,approval_hash) do nothing returning id into proposal;
   if proposal is null then
     select id into proposal from makeborne_private.generation_proposals
       where workspace_id=(p_request#>>'{scope,workspaceId}')::uuid and approval_hash=p_snapshot->>'approvalHash' and snapshot=p_snapshot;
     if not found then raise exception 'Proposal identity conflict' using errcode='PT409'; end if;
   end if;
   prepared_result:=jsonb_build_object('proposalId',proposal,'approvalHash',p_snapshot->>'approvalHash','inputHash',p_snapshot->>'inputHash',
     'maximumCredits',p_snapshot#>>'{workflow,maximumCustomerCredits}','expiresAt',p_snapshot#>'{workflow,expiresAt}');
   update makeborne_private.cloud_mutation_receipts set resource_id=proposal,result=prepared_result
     where workspace_id=(p_request#>>'{scope,workspaceId}')::uuid and actor_id=p_actor and operation='prepare_generation' and request_key=p_request_key;
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true); perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 return prepared_result;
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true); perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 raise;
end $$;

commit;
