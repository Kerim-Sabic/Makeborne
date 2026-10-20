-- Studio library: stored home-page previews for website-source projects (audit M06).
--
-- Decks, books, outlines and structured designs render on the card from the
-- saved version itself. A website-source project has no script-free render
-- until it is compiled, so the first editor who sees its card compiles it once
-- in the existing opaque sandbox and stores the sanitized, script-free capture
-- here. Each row is bound to one artifact, one immutable version id and the
-- server-computed fingerprint of that version's content and style, and records
-- its rendering outcome. Rows are only written for the artifact's current
-- version (a late capture of an older version is refused) and replacing the
-- current row removes every older one. Deleting the artifact, the version or
-- the workspace deletes the row (foreign keys). Members never read rows
-- through the Data API; the authorized card-preview route reads them with the
-- caller's workspace access already verified, and serves them private, no-store.
begin;

create table public.artifact_card_previews (
  artifact_id uuid not null,
  version_id uuid not null,
  workspace_id uuid not null,
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('ready', 'too_large')),
  html text check ((outcome = 'ready') = (html is not null) and (html is null or octet_length(html) between 100 and 2000000)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (artifact_id, version_id),
  foreign key (artifact_id, workspace_id) references public.artifacts(id, workspace_id) on delete cascade,
  foreign key (version_id, artifact_id, workspace_id) references public.artifact_versions(id, artifact_id, workspace_id) on delete cascade
);
create index artifact_card_previews_workspace on public.artifact_card_previews(workspace_id);
comment on table public.artifact_card_previews is
  'Sanitized script-free home-page capture of a website-source artifact version for library cards. Bound to (artifact, version id, content hash); service role only.';

alter table public.artifact_card_previews enable row level security;
revoke all on public.artifact_card_previews from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.artifact_card_previews to service_role;

-- p_actor is the verified signed-in user (owner or editor of p_workspace).
create function public.makeborne_save_artifact_card_preview(
  p_actor uuid, p_workspace uuid, p_artifact uuid, p_version uuid, p_content_hash text, p_outcome text, p_html text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.artifacts%rowtype; v_number integer; r public.artifact_card_previews%rowtype;
begin
  if p_actor is null or not makeborne_private.client_review_can_edit_as(p_actor, p_workspace) then
    raise exception 'Editor access required' using errcode = '42501';
  end if;
  select * into a from public.artifacts where id = p_artifact and workspace_id = p_workspace for update;
  if not found or a.kind <> 'website' then raise exception 'Website not found' using errcode = 'P0002'; end if;
  select v.version_number into v_number from public.artifact_versions v
    where v.id = p_version and v.artifact_id = p_artifact and v.workspace_id = p_workspace;
  if not found then raise exception 'Version not found' using errcode = 'P0002'; end if;
  -- A capture that finishes after a newer save never becomes the card's preview.
  if v_number is distinct from a.current_version then raise exception 'A newer version was saved' using errcode = 'PT409'; end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' or p_outcome is null or p_outcome not in ('ready', 'too_large')
    or ((p_outcome = 'ready') <> (p_html is not null)) or (p_html is not null and octet_length(p_html) not between 100 and 2000000) then
    raise exception 'Invalid card preview' using errcode = '22023';
  end if;
  insert into public.artifact_card_previews(artifact_id, version_id, workspace_id, version_number, content_hash, outcome, html, created_by)
  values (p_artifact, p_version, p_workspace, v_number, p_content_hash, p_outcome, p_html, p_actor)
  on conflict (artifact_id, version_id) do update
    set content_hash = excluded.content_hash, outcome = excluded.outcome, html = excluded.html, created_by = excluded.created_by, created_at = now()
  returning * into r;
  delete from public.artifact_card_previews where artifact_id = p_artifact and version_id <> p_version;
  return jsonb_build_object('artifactId', r.artifact_id, 'versionId', r.version_id, 'versionNumber', r.version_number, 'outcome', r.outcome);
end $$;
comment on function public.makeborne_save_artifact_card_preview(uuid,uuid,uuid,uuid,text,text,text) is
  'Stores the library card capture for the current version of a website artifact; refuses older versions; removes older rows. Service role only.';
revoke all on function public.makeborne_save_artifact_card_preview(uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.makeborne_save_artifact_card_preview(uuid,uuid,uuid,uuid,text,text,text) to service_role;

commit;
