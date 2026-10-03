-- CLI-created foundation migration. NOT APPLIED OR VERIFIED ON A DATABASE.
-- Cloud data access is deliberately disabled until a project is configured.
begin;
create schema if not exists makeborne_private;
revoke all on schema makeborne_private from public, anon;
grant usage on schema makeborne_private to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','reviewer')),
  created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index workspace_members_user on public.workspace_members(user_id,workspace_id);

-- Fixed search path, qualified objects and authoritative DB membership; no user metadata.
create function makeborne_private.is_owner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspaces w where w.id=target and w.owner_id=(select auth.uid()));
$$;
create function makeborne_private.can_read(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select makeborne_private.is_owner(target) or exists(
    select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=(select auth.uid()));
$$;
create function makeborne_private.can_edit(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select makeborne_private.is_owner(target) or exists(
    select 1 from public.workspace_members m where m.workspace_id=target and m.user_id=(select auth.uid()) and m.role='editor');
$$;
revoke all on all functions in schema makeborne_private from public, anon;
grant execute on all functions in schema makeborne_private to authenticated, service_role;

create table public.clients (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 120), company text not null default '', email text not null default '',
  website text not null default '', notes text not null default '', created_at timestamptz not null default now(),
  unique(id,workspace_id)
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null, name text not null, email text not null default '', phone text not null default '',
  created_at timestamptz not null default now(), foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid, title text not null check (length(title) between 1 and 160),
  kind text not null check (kind in ('website','book','presentation')),
  status text not null default 'draft' check(status in ('draft','in_progress','review','approved','published','archived')),
  style_id text not null default 'editorial', brief text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(client_id,workspace_id) references public.clients(id,workspace_id)
);
create table public.style_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, version integer not null check(version>0), specification jsonb not null,
  created_at timestamptz not null default now(), unique(id,workspace_id)
);
create table public.sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null, title text not null, kind text not null check(kind in ('text','url','document','image','recording')),
  content text not null default '', source_url text, permission text not null default 'private' check(permission in ('private','project','public')),
  approved boolean not null default false, created_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade
);
create table public.assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null, object_path text not null, content_type text not null, sha256 text,
  provenance jsonb not null default '{}', created_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade
);
create table public.artifacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null, kind text not null check(kind in ('website','book','presentation')), title text not null,
  current_version integer not null default 0 check(current_version>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,workspace_id), unique(id,project_id,workspace_id),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade
);
create table public.artifact_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_id uuid not null, version_number integer not null check(version_number>0), parent_version_id uuid,
  content jsonb not null check(jsonb_typeof(content)='object' and octet_length(content::text)<=5242880),
  style_snapshot jsonb not null check(jsonb_typeof(style_snapshot)='object' and octet_length(style_snapshot::text)<=262144),
  asset_manifest jsonb not null default '[]' check(jsonb_typeof(asset_manifest)='array' and jsonb_array_length(asset_manifest)<=1000),
  change_summary text not null default '', created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(), unique(id,workspace_id), unique(id,artifact_id,workspace_id), unique(artifact_id,version_number),
  foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade,
  foreign key(parent_version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id),
  check(parent_version_id is null or parent_version_id<>id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null, title text not null, status text not null default 'todo' check(status in ('todo','doing','done')),
  due_at timestamptz, created_at timestamptz not null default now(),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version_id uuid not null, reviewer_id uuid not null default auth.uid() references auth.users(id),
  decision text not null check(decision in ('comment','changes_requested','approved')), body text not null default '',
  created_at timestamptz not null default now(),
  foreign key(version_id,workspace_id) references public.artifact_versions(id,workspace_id) on delete cascade
);
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null, artifact_id uuid, kind text not null check(kind in ('website','book','presentation')),
  status text not null default 'queued' check(status in ('queued','running','awaiting_reconciliation','succeeded','failed','cancelled')),
  stage text not null default 'queued', attempt integer not null default 0 check(attempt>=0),
  idempotency_key text not null, provider text, provider_request_id text, error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,idempotency_key), unique(id,workspace_id),
  foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade,
  foreign key(artifact_id,project_id,workspace_id) references public.artifacts(id,project_id,workspace_id)
);
create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null unique, amount_microusd bigint not null check(amount_microusd>=0),
  status text not null check(status in ('reserved','settled','released','uncertain')), created_at timestamptz not null default now(),
  foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id)
);
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null, event_key text not null unique, amount_microusd bigint not null check(amount_microusd>=0),
  estimated boolean not null default true, provider text not null, model text not null,
  created_at timestamptz not null default now(), foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id)
);
create table public.published_releases (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version_id uuid not null, renderer_version text not null, status text not null check(status in ('pending','published','failed','retired')),
  public_slug text unique, created_at timestamptz not null default now(),
  foreign key(version_id,workspace_id) references public.artifact_versions(id,workspace_id)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id), action text not null, target_id uuid, outcome text not null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.workspaces,public.workspace_members from anon, authenticated;
grant select,insert on public.workspaces to authenticated;
grant update(name) on public.workspaces to authenticated;
grant select,insert,update,delete on public.workspace_members to authenticated;
create policy workspace_read on public.workspaces for select to authenticated using(makeborne_private.can_read(id));
create policy workspace_create on public.workspaces for insert to authenticated with check(owner_id=(select auth.uid()));
create policy workspace_change on public.workspaces for update to authenticated using(makeborne_private.is_owner(id)) with check(owner_id=(select auth.uid()));
create policy membership_read on public.workspace_members for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy membership_manage on public.workspace_members for all to authenticated using(makeborne_private.is_owner(workspace_id)) with check(makeborne_private.is_owner(workspace_id));

do $$ declare item text; begin
  foreach item in array array['clients','contacts','projects','style_profiles','sources','assets','artifacts','tasks'] loop
    execute format('alter table public.%I enable row level security',item);
    execute format('revoke all on public.%I from anon,authenticated',item);
    execute format('grant select,insert,update,delete on public.%I to authenticated',item);
    execute format('create policy tenant_read on public.%I for select to authenticated using(makeborne_private.can_read(workspace_id))',item);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check(makeborne_private.can_edit(workspace_id))',item);
    execute format('create policy tenant_update on public.%I for update to authenticated using(makeborne_private.can_edit(workspace_id)) with check(makeborne_private.can_edit(workspace_id))',item);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using(makeborne_private.can_edit(workspace_id))',item);
    execute format('create index on public.%I(workspace_id)',item);
  end loop;
  foreach item in array array['artifact_versions','reviews','generation_jobs','budget_reservations','usage_ledger','published_releases','audit_events'] loop
    execute format('alter table public.%I enable row level security',item);
    execute format('revoke all on public.%I from anon,authenticated',item);
    execute format('grant select on public.%I to authenticated',item);
    execute format('create policy tenant_read on public.%I for select to authenticated using(makeborne_private.can_read(workspace_id))',item);
    execute format('create index on public.%I(workspace_id)',item);
  end loop;
end $$;
-- Prevent deleting snapshots indirectly through cascading parent deletes.
-- Use project status='archived'; privileged lifecycle deletion requires a dedicated workflow.
revoke delete on public.projects,public.artifacts,public.sources,public.style_profiles from authenticated;
-- Asset identity/path/provenance is append-only for app callers.
revoke update,delete on public.assets from authenticated;

-- Application validation is not enough: bound exposed text and object sizes in SQL.
alter table public.clients add constraint clients_text_bounds check(
  length(company)<=160 and length(email)<=254 and length(website)<=2048 and length(notes)<=10000);
alter table public.contacts add constraint contacts_text_bounds check(
  length(name) between 1 and 120 and length(email)<=254 and length(phone)<=80);
alter table public.projects add constraint projects_text_bounds check(length(style_id) between 1 and 120 and length(brief)<=30000);
alter table public.style_profiles add constraint styles_bounds check(
  length(name) between 1 and 120 and jsonb_typeof(specification)='object' and octet_length(specification::text)<=262144);
alter table public.sources add constraint sources_bounds check(
  length(title) between 1 and 200 and length(content)<=1000000 and (source_url is null or length(source_url)<=2048));
alter table public.assets add constraint assets_bounds check(
  length(object_path) between 1 and 1024 and object_path like (workspace_id::text || '/%') and
  length(content_type) between 1 and 200 and (sha256 is null or sha256 ~ '^[0-9a-f]{64}$') and
  jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=262144);
alter table public.artifacts add constraint artifacts_title_bounds check(length(title) between 1 and 200);
alter table public.artifact_versions add constraint versions_summary_bounds check(length(change_summary)<=2000);
alter table public.tasks add constraint tasks_title_bounds check(length(title) between 1 and 200);
alter table public.reviews add constraint reviews_body_bounds check(length(body)<=10000);
alter table public.generation_jobs add constraint jobs_text_bounds check(
  length(stage)<=120 and length(idempotency_key) between 1 and 200 and
  (provider is null or length(provider)<=80) and (provider_request_id is null or length(provider_request_id)<=200) and
  (error_code is null or length(error_code)<=100));
alter table public.usage_ledger add constraint usage_text_bounds check(
  length(event_key) between 1 and 200 and length(provider) between 1 and 80 and length(model) between 1 and 160);
alter table public.published_releases add constraint releases_text_bounds check(
  length(renderer_version) between 1 and 100 and (public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'));
alter table public.audit_events add constraint audit_bounds check(
  length(action) between 1 and 120 and length(outcome) between 1 and 80 and
  jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=65536);

-- Snapshot manifest is an array of asset UUIDs, all belonging to this project.
create function makeborne_private.validate_version_manifest() returns trigger
language plpgsql security definer set search_path = '' as $$
declare asset_text text; project_uuid uuid;
begin
  if tg_op='UPDATE' then
    raise exception 'Artifact snapshots are immutable; create a new version' using errcode='23514';
  end if;
  select a.project_id into project_uuid from public.artifacts a where a.id=new.artifact_id and a.workspace_id=new.workspace_id;
  if new.parent_version_id is not null and not exists(
    select 1 from public.artifact_versions v where v.id=new.parent_version_id and v.artifact_id=new.artifact_id
      and v.workspace_id=new.workspace_id and v.version_number<new.version_number) then
    raise exception 'Parent version must precede this snapshot in the same artifact' using errcode='23514';
  end if;
  for asset_text in select jsonb_array_elements_text(new.asset_manifest) loop
    if asset_text is null or asset_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Invalid asset manifest identifier' using errcode='23514';
    end if;
    if not exists(select 1 from public.assets a where a.id=asset_text::uuid and a.workspace_id=new.workspace_id and a.project_id=project_uuid) then
      raise exception 'Asset manifest must belong to the artifact project' using errcode='23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function makeborne_private.validate_version_manifest() from public,anon,authenticated;
create trigger artifact_manifest_guard before insert or update on public.artifact_versions
for each row execute function makeborne_private.validate_version_manifest();
-- Immutable snapshot inserts; modifications/deletions are intentionally unavailable.
grant insert on public.artifact_versions, public.reviews to authenticated;
create policy version_insert on public.artifact_versions for insert to authenticated with check(makeborne_private.can_edit(workspace_id) and created_by=(select auth.uid()));
create policy review_insert on public.reviews for insert to authenticated with check(makeborne_private.can_read(workspace_id) and reviewer_id=(select auth.uid()));
-- Worker-only mutations for production, financial and audit records.
grant all on public.workspaces,public.workspace_members,public.clients,public.contacts,public.projects,public.style_profiles,public.sources,public.assets,public.artifacts,public.artifact_versions,public.tasks,public.reviews,public.generation_jobs,public.budget_reservations,public.usage_ledger,public.published_releases,public.audit_events to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-assets','project-assets',false,52428800,array['image/png','image/jpeg','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/epub+zip'])
on conflict(id) do nothing;
-- Object names start with workspace UUID; invalid prefixes compare as text, never cast.
create policy project_assets_read on storage.objects for select to authenticated using(
  bucket_id='project-assets' and exists(select 1 from public.workspaces w where w.id::text=(storage.foldername(name))[1] and makeborne_private.can_read(w.id)));
create policy project_assets_insert on storage.objects for insert to authenticated with check(
  bucket_id='project-assets' and exists(select 1 from public.workspaces w where w.id::text=(storage.foldername(name))[1] and makeborne_private.can_edit(w.id)));
-- No authenticated update/delete policy: revisions create new objects. Asset cleanup
-- is a privileged, reference-aware retention operation, not a client upload feature.
commit;
