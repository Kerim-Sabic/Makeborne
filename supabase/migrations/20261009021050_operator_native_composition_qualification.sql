begin;

-- Extend only the existing fixed operator round for saved native composition.
-- Customer composition still requires evaluated routes. No grants or new stores.
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
        and artifact_id is not null
        and (
          (snapshot#>>'{workflow,output}' = 'website'
            and ((base_version_id is null and not (snapshot ? 'repairReview')) or
              (base_version_id is not null and jsonb_typeof(snapshot->'repairReview')='object'
                and snapshot#>>'{repairReview,reviewId}' ~ '^[a-f0-9-]{36}$'
                and snapshot#>>'{repairReview,reportHash}' ~ '^[a-f0-9]{64}$'
                and snapshot#>>'{repairReview,report,versionId}' = base_version_id::text
                and snapshot#>>'{repairReview,report,purpose}' = 'website_repair_review'
                and snapshot#>>'{repairReview,report,decision}' = 'changes_requested')))
          or (snapshot#>>'{workflow,output}' = 'presentation'
            and base_version_id is not null and not (snapshot ? 'repairReview')
            and snapshot#>>'{workflow,presentationMode}' = 'editable'
            and snapshot#>'{workflow,includeImages}' = 'false'::jsonb
            and snapshot#>>'{input,content,kind}' = 'presentation'
            and snapshot#>>'{workflow,stages,0,route,provider}' = 'anthropic')
        )
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

commit;
