begin;
-- Internal routing snapshots contain provider details and must never be client-readable.
create table makeborne_private.generation_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  project_id uuid not null,
  artifact_id uuid,
  base_version_id uuid,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=6291456),
  maximum_vendor_microusd bigint not null check(maximum_vendor_microusd>=0),
  maximum_customer_credits bigint not null check(maximum_customer_credits>=0),
  prepared_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>prepared_at),
  created_at timestamptz not null default now(),
  unique(workspace_id,approval_hash),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id),
  foreign key(artifact_id,project_id,workspace_id) references public.artifacts(id,project_id,workspace_id),
  foreign key(base_version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id),
  check(base_version_id is null or artifact_id is not null),
  constraint generation_proposal_snapshot_binding check (
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
    and jsonb_array_length(snapshot#>'{workflow,stages}') between 3 and 4) is true
  )
);
alter table makeborne_private.generation_proposals enable row level security;
revoke all on makeborne_private.generation_proposals from public,anon,authenticated,service_role;
grant usage on schema makeborne_private to service_role;
grant select,insert on makeborne_private.generation_proposals to service_role;
create index generation_proposals_project_created on makeborne_private.generation_proposals(workspace_id,project_id,created_at desc);
create index generation_proposals_base_version on makeborne_private.generation_proposals(base_version_id,artifact_id,workspace_id);
comment on table makeborne_private.generation_proposals is 'Server-owned immutable proposal snapshots. Hash bindings are not authorization. Worker must verify canonical hashes, scope, current policy and budgets before dispatch. No client API or spending enabled.';
commit;
