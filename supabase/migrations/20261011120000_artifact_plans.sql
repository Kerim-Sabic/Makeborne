-- Plan mode: the latest editable website plan for an artifact, so a reload
-- keeps it. One row per artifact; tenants read with can_read and write with
-- can_edit. Plans are advisory input to the builder, never published content.
create table public.artifact_plans (
  artifact_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 65536),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key (artifact_id, workspace_id) references public.artifacts(id, workspace_id) on delete cascade
);
create index artifact_plans_workspace on public.artifact_plans(workspace_id);
alter table public.artifact_plans enable row level security;
revoke all on public.artifact_plans from public, anon, authenticated;
grant select, insert, update, delete on public.artifact_plans to authenticated;
grant select, insert, update, delete on public.artifact_plans to service_role;
create policy artifact_plans_read on public.artifact_plans for select to authenticated
  using (makeborne_private.can_read(workspace_id));
create policy artifact_plans_insert on public.artifact_plans for insert to authenticated
  with check (makeborne_private.can_edit(workspace_id) and updated_by = auth.uid());
create policy artifact_plans_update on public.artifact_plans for update to authenticated
  using (makeborne_private.can_edit(workspace_id))
  with check (makeborne_private.can_edit(workspace_id) and updated_by = auth.uid());
create policy artifact_plans_delete on public.artifact_plans for delete to authenticated
  using (makeborne_private.can_edit(workspace_id));
