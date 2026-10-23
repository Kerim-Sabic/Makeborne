begin;
-- Private per-account project transcript; display only, never an AI authorization.
create table public.artifact_chat_messages (
  sequence bigint generated always as identity primary key,
  id uuid not null,
  account_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_id uuid not null,
  role text not null check (role in ('user','assistant')),
  body text not null check (length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  unique(account_id,workspace_id,artifact_id,id),
  foreign key (artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade
);
create index artifact_chat_messages_page on public.artifact_chat_messages(account_id,workspace_id,artifact_id,sequence desc);
alter table public.artifact_chat_messages enable row level security;
revoke all on public.artifact_chat_messages from public,anon,authenticated,service_role;
grant select,insert on public.artifact_chat_messages to authenticated;
grant usage on sequence public.artifact_chat_messages_sequence_seq to authenticated;
grant all on public.artifact_chat_messages to service_role;
create policy chat_read_own on public.artifact_chat_messages for select to authenticated
 using (account_id=(select auth.uid()) and makeborne_private.can_read(workspace_id));
create policy chat_append_own on public.artifact_chat_messages for insert to authenticated
 with check (account_id=(select auth.uid()) and makeborne_private.can_edit(workspace_id));
comment on table public.artifact_chat_messages is 'Untrusted read-only UI transcript, not model context, billing evidence or executable approvals. Immutable to authenticated clients.';
commit;
