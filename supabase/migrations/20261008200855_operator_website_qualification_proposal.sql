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
        and artifact_id is not null and base_version_id is null
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
