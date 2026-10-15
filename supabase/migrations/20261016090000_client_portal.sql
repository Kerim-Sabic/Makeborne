-- Client portal, Phase 1 (review mode). An agency invites a client's contact to
-- edit a website's content collections (src/content/<name>.json). Every client
-- change goes to the agency for approval; nothing here publishes.
--
-- Additive only. Portal users are never workspace members: they fail every
-- existing RLS policy, and every portal read or write is a SECURITY DEFINER
-- function that re-checks the grant (accepted, not revoked, paid_through, the
-- project still belongs to the client, the site is enabled and a website, the
-- workspace owner can host). Client functions run as service_role with the
-- verified actor and session (the submission/publication pattern); invite
-- tokens are stored as SHA-256 only and never selectable by browsers.
begin;

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table public.client_portal_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null,
  email text not null check(email = lower(email) and length(email) between 3 and 254
    and email ~ '^[^@[:space:]<>]{1,64}@[^@[:space:]<>]{1,190}\.[a-z]{2,24}$'),
  display_name text not null default '' check(length(display_name) <= 120 and display_name !~ '[<>]'),
  -- Set when the invite is accepted by the account whose email matches.
  user_id uuid references auth.users(id) on delete cascade,
  -- SHA-256 of a 256-bit token (rotated on resend). The token is never stored.
  token_hash bytea not null unique check(octet_length(token_hash) = 32),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  invite_expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_seen_at timestamptz,
  plan_label text not null default '' check(length(plan_label) <= 80 and plan_label !~ '[<>]'),
  paid_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, workspace_id),
  foreign key(client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade,
  check((accepted_at is null) = (user_id is null)),
  check(invite_expires_at > invited_at and invite_expires_at <= invited_at + interval '14 days')
);
-- One live grant per (workspace, client, email) and per (workspace, client, account).
create unique index client_portal_access_live_email on public.client_portal_access(workspace_id, client_id, email) where revoked_at is null;
create unique index client_portal_access_live_user on public.client_portal_access(workspace_id, client_id, user_id) where revoked_at is null and user_id is not null;
create index client_portal_access_user on public.client_portal_access(user_id) where user_id is not null;
create index client_portal_access_client on public.client_portal_access(client_id);

create table public.client_portal_sites (
  artifact_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default false,
  -- NULL: every collection the site declares. Otherwise an allow-list of names.
  collections text[] check(collections is null or (cardinality(collections) <= 30
    and (cardinality(collections) = 0 or array_to_string(collections, ',') ~ '^[a-z][a-z0-9-]{0,39}(,[a-z][a-z0-9-]{0,39})*$'))),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(artifact_id, workspace_id) references public.artifacts(id, workspace_id) on delete cascade
);
create index client_portal_sites_workspace on public.client_portal_sites(workspace_id);

create table public.client_portal_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  access_id uuid not null,
  artifact_id uuid not null,
  status text not null default 'draft' check(status in ('draft','pending','approved','rejected','withdrawn')),
  base_version integer not null check(base_version > 0),
  -- path -> proposed (normalised) file text; only src/content/<name>.json paths.
  files jsonb not null check(jsonb_typeof(files) = 'object' and octet_length(files::text) <= 700000),
  -- path -> sha256 of the file text the client started from.
  base_hashes jsonb not null check(jsonb_typeof(base_hashes) = 'object' and octet_length(base_hashes::text) <= 10000),
  summary text not null default '' check(length(summary) <= 2000),
  decision_note text check(decision_note is null or length(decision_note) <= 2000),
  decided_by uuid references auth.users(id) on delete set null,
  result_version integer check(result_version is null or result_version > 0),
  request_key uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  decided_at timestamptz,
  foreign key(access_id, workspace_id) references public.client_portal_access(id, workspace_id) on delete cascade,
  foreign key(artifact_id, workspace_id) references public.artifacts(id, workspace_id) on delete cascade,
  check((status = 'approved') = (result_version is not null)),
  check((status in ('approved','rejected')) = (decided_at is not null)),
  check(status = 'draft' or status = 'withdrawn' or submitted_at is not null)
);
-- A single open change (draft or pending) per grant and site.
create unique index client_portal_changes_open on public.client_portal_changes(access_id, artifact_id) where status in ('draft','pending');
create index client_portal_changes_artifact on public.client_portal_changes(artifact_id, status, updated_at desc);
create index client_portal_changes_workspace on public.client_portal_changes(workspace_id);
-- Rate limits count portal audit rows per grant or workspace.
create index audit_events_portal_rate on public.audit_events(target_id, action, created_at) where action like 'portal.%';
create index audit_events_portal_workspace on public.audit_events(workspace_id, action, created_at) where action like 'portal.%';

alter table public.client_portal_access enable row level security;
alter table public.client_portal_sites enable row level security;
alter table public.client_portal_changes enable row level security;
revoke all on public.client_portal_access, public.client_portal_sites, public.client_portal_changes from public, anon, authenticated, service_role;
-- Workspace members may read (never the token hash); nobody writes directly.
grant select(id, workspace_id, client_id, email, display_name, user_id, invited_by, invited_at, invite_expires_at, accepted_at,
  revoked_at, revoked_by, last_seen_at, plan_label, paid_through, created_at, updated_at) on public.client_portal_access to authenticated;
grant select on public.client_portal_sites, public.client_portal_changes to authenticated;
create policy client_portal_access_read on public.client_portal_access for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy client_portal_sites_read on public.client_portal_sites for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy client_portal_changes_read on public.client_portal_changes for select to authenticated using(makeborne_private.can_read(workspace_id));

-- ---------------------------------------------------------------------------
-- 2. Private helpers.
-- ---------------------------------------------------------------------------
-- Text of one websiteSource file in a version's content.
create function makeborne_private.portal_file(p_content jsonb, p_path text) returns text
language sql immutable set search_path='' as $$
  select f->>'content' from jsonb_array_elements(case when jsonb_typeof(p_content->'websiteSource'->'files') = 'array'
    then p_content->'websiteSource'->'files' else '[]'::jsonb end) f
  where f->>'path' = p_path limit 1;
$$;

create function makeborne_private.portal_sha(p_text text) returns text
language sql immutable set search_path='' as $$
  select case when p_text is not null then encode(sha256(convert_to(p_text, 'UTF8')), 'hex') end;
$$;

-- Collection names declared by src/content/collections.json (NULL: no valid manifest).
create function makeborne_private.portal_declared(p_content jsonb) returns text[]
language plpgsql immutable set search_path='' as $$
declare t text; m jsonb;
begin
  t := makeborne_private.portal_file(p_content, 'src/content/collections.json');
  if t is null or length(t) > 200000 then return null; end if;
  begin m := t::jsonb; exception when invalid_text_representation then return null; end;
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'collections') is distinct from 'object' then return null; end if;
  return coalesce((select array_agg(k order by k) from jsonb_object_keys(m->'collections') k
    where k ~ '^[a-z][a-z0-9-]{0,39}$' and k <> 'collections'), '{}');
end $$;

-- Declared collections the agency allows (settings NULL: all declared).
create function makeborne_private.portal_allowed(p_declared text[], p_settings text[]) returns text[]
language sql immutable set search_path='' as $$
  select case when p_declared is null then '{}'::text[] when p_settings is null then p_declared
    else coalesce((select array_agg(d order by d) from unnest(p_declared) d where d = any(p_settings)), '{}') end;
$$;

-- Collection name of a content path, or NULL when the path is not a collection file.
create function makeborne_private.portal_collection_of(p_path text) returns text
language sql immutable set search_path='' as $$
  select case when p_path ~ '^src/content/[a-z][a-z0-9-]{0,39}\.json$' and p_path <> 'src/content/collections.json'
    then (regexp_match(p_path, '^src/content/([a-z][a-z0-9-]{0,39})\.json$'))[1] end;
$$;

create function makeborne_private.portal_mask_email(p_email text) returns text
language sql immutable set search_path='' as $$
  select left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2);
$$;

-- Agency display fields only: the workspace brand kit when that table exists
-- (guarded so this migration does not depend on it), else the workspace name.
create function makeborne_private.portal_brand(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_name text; k jsonb; hex constant text := '^#[0-9a-fA-F]{6}$';
begin
  select name into v_name from public.workspaces where id = p_workspace;
  if to_regclass('public.brand_kits') is not null then
    execute 'select kit from public.brand_kits where workspace_id = $1 and client_id is null' into k using p_workspace;
  end if;
  return jsonb_build_object(
    'name', coalesce(nullif(left(makeborne_private.client_review_text(case when jsonb_typeof(k->'name') = 'string' then k->>'name' end), 120), ''), v_name, 'Your agency'),
    'logo', case when jsonb_typeof(k->'logo') = 'string' and length(k->>'logo') <= 420000
      and (k->>'logo') ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' then k->>'logo' end,
    'colors', jsonb_build_object(
      'primary', case when coalesce(k->'colors'->>'primary', '') ~ hex then lower(k->'colors'->>'primary') else '#1f6f5b' end,
      'background', case when coalesce(k->'colors'->>'background', '') ~ hex then lower(k->'colors'->>'background') else '#ffffff' end,
      'text', case when coalesce(k->'colors'->>'text', '') ~ hex then lower(k->'colors'->>'text') else '#1a1a1a' end));
end $$;

create function makeborne_private.portal_access_json(g public.client_portal_access) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id', g.id, 'clientId', g.client_id, 'email', g.email, 'displayName', g.display_name,
    'status', case when g.revoked_at is not null then 'revoked' when g.accepted_at is not null then 'active'
      when g.invite_expires_at <= now() then 'expired' else 'invited' end,
    'invitedAt', g.invited_at, 'inviteExpiresAt', g.invite_expires_at, 'acceptedAt', g.accepted_at, 'lastSeenAt', g.last_seen_at,
    'planLabel', g.plan_label, 'paidThrough', to_char(g.paid_through, 'YYYY-MM-DD'));
$$;

create function makeborne_private.portal_change_json(c public.client_portal_changes) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id', c.id, 'status', c.status, 'baseVersion', c.base_version, 'files', c.files, 'summary', c.summary,
    'decisionNote', c.decision_note, 'resultVersion', c.result_version, 'updatedAt', c.updated_at,
    'submittedAt', c.submitted_at, 'decidedAt', c.decided_at);
$$;

-- The caller's live grant for a site, or P0002. With p_lock the grant row is
-- locked (revocation waits) and the project/site rows are share-locked, so a
-- concurrent revoke or project reassignment cannot interleave with a write.
create function makeborne_private.portal_grant(p_actor uuid, p_artifact uuid, p_lock boolean) returns public.client_portal_access
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype;
begin
  if p_actor is null or p_artifact is null then raise exception 'This site is not available to you' using errcode='P0002'; end if;
  if p_lock then
    select g.* into r from public.client_portal_access g
      join public.artifacts a on a.id = p_artifact and a.workspace_id = g.workspace_id and a.kind = 'website'
      join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = g.client_id
      join public.client_portal_sites s on s.artifact_id = a.id and s.workspace_id = a.workspace_id and s.enabled
      join public.workspaces w on w.id = g.workspace_id
    where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null
      and (g.paid_through is null or g.paid_through >= (now() at time zone 'utc')::date)
      and makeborne_hosting.owner_can_host(w.owner_id)
    limit 1 for update of g for share of p, s;
  else
    select g.* into r from public.client_portal_access g
      join public.artifacts a on a.id = p_artifact and a.workspace_id = g.workspace_id and a.kind = 'website'
      join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = g.client_id
      join public.client_portal_sites s on s.artifact_id = a.id and s.workspace_id = a.workspace_id and s.enabled
      join public.workspaces w on w.id = g.workspace_id
    where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null
      and (g.paid_through is null or g.paid_through >= (now() at time zone 'utc')::date)
      and makeborne_hosting.owner_can_host(w.owner_id)
    limit 1;
  end if;
  if not found then raise exception 'This site is not available to you' using errcode='P0002'; end if;
  return r;
end $$;

-- Names and counts only, never content or email addresses.
create function makeborne_private.portal_audit(p_workspace uuid, p_actor uuid, p_action text, p_target uuid, p_metadata jsonb) returns void
language sql security definer set search_path='' as $$
  insert into public.audit_events(workspace_id, actor_id, action, target_id, outcome, metadata)
  values(p_workspace, p_actor, p_action, p_target, 'succeeded', coalesce(p_metadata, '{}'::jsonb));
$$;

-- Owner or editor of the workspace with a creation entitlement (trusted actor).
create function makeborne_private.portal_agency_writer(p_actor uuid, p_workspace uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not makeborne_private.client_review_can_edit_as(p_actor, p_workspace) then
    raise exception 'Editor access required' using errcode='42501';
  end if;
  if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then
    raise exception 'Creation membership required' using errcode='MB402';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Client functions (service_role bridges; actor + session verified).
-- ---------------------------------------------------------------------------
create function makeborne_private.portal_home(p_actor uuid, p_session uuid, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_email text; v_grants jsonb;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  select lower(email) into v_email from auth.users where id = p_actor;
  update public.client_portal_access set last_seen_at = now()
    where user_id = p_actor and accepted_at is not null and revoked_at is null
      and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  select coalesce(jsonb_agg(jsonb_build_object(
      'accessId', g.id, 'agency', makeborne_private.portal_brand(g.workspace_id), 'client', jsonb_build_object('name', coalesce(nullif(cl.company, ''), cl.name)),
      'sites', coalesce((select jsonb_agg(jsonb_build_object('artifactId', a.id, 'title', a.title,
          'slug', case when h.live then h.slug end,
          'change', (select jsonb_build_object('id', c.id, 'status', c.status, 'updatedAt', c.updated_at)
            from public.client_portal_changes c where c.access_id = g.id and c.artifact_id = a.id
            order by (c.status in ('draft','pending')) desc, c.updated_at desc limit 1)) order by a.title, a.id)
        from public.artifacts a
        join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = g.client_id
        join public.client_portal_sites s on s.artifact_id = a.id and s.enabled
        left join public.hosted_sites h on h.artifact_id = a.id
        where a.workspace_id = g.workspace_id and a.kind = 'website'), '[]'::jsonb)
    ) order by g.accepted_at, g.id), '[]'::jsonb)
  into v_grants
  from public.client_portal_access g
  join public.workspaces w on w.id = g.workspace_id
  join public.clients cl on cl.id = g.client_id and cl.workspace_id = g.workspace_id
  where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null
    and (g.paid_through is null or g.paid_through >= (now() at time zone 'utc')::date)
    and makeborne_hosting.owner_can_host(w.owner_id);
  return jsonb_build_object('email', v_email, 'grants', v_grants);
end $$;

create function makeborne_private.portal_read_site(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; s public.client_portal_sites%rowtype;
  v public.artifact_versions%rowtype; v_allowed text[]; v_slug text; v_client text; c public.client_portal_changes%rowtype; v_change jsonb;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, false);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  select * into s from public.client_portal_sites where artifact_id = p_artifact;
  select * into v from public.artifact_versions where artifact_id = a.id and workspace_id = a.workspace_id and version_number = a.current_version;
  if not found then raise exception 'This site is not available to you' using errcode='P0002'; end if;
  v_allowed := makeborne_private.portal_allowed(makeborne_private.portal_declared(v.content), s.collections);
  select slug into v_slug from public.hosted_sites where artifact_id = a.id and live;
  select coalesce(nullif(company, ''), name) into v_client from public.clients where id = g.client_id and workspace_id = g.workspace_id;
  select * into c from public.client_portal_changes where access_id = g.id and artifact_id = a.id
    order by (status in ('draft','pending')) desc, updated_at desc limit 1;
  if found then v_change := makeborne_private.portal_change_json(c); end if;
  return jsonb_build_object(
    'site', jsonb_build_object('artifactId', a.id, 'title', a.title, 'slug', v_slug),
    'agency', makeborne_private.portal_brand(g.workspace_id),
    'client', jsonb_build_object('name', v_client),
    'baseVersion', a.current_version,
    'manifest', makeborne_private.portal_file(v.content, 'src/content/collections.json'),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'path', 'src/content/' || k || '.json',
        'sha256', makeborne_private.portal_sha(t), 'text', t) order by k)
      from unnest(v_allowed) k, lateral (select makeborne_private.portal_file(v.content, 'src/content/' || k || '.json') t) f
      where f.t is not null), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object('path', '/' || substr(x->>'path', 8), 'assetId', x->>'id') order by x->>'path')
      from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets', '[]'::jsonb)) x
      where x->>'path' like 'public/%' and x->>'mediaType' in ('image/png','image/jpeg','image/webp')), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(r->>'path' order by r->>'path')
      from jsonb_array_elements(coalesce(v.content->'websiteSource'->'routes', '[]'::jsonb)) r), '[]'::jsonb),
    'change', v_change);
end $$;

-- Upserts the single open draft for this grant and site. Only declared, allowed
-- src/content/<name>.json files that exist in the current version; the client
-- must start from the current text of each file. Never creates a version.
create function makeborne_private.portal_save_draft(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid,
  p_base_version integer, p_files jsonb, p_summary text, p_request uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; s public.client_portal_sites%rowtype;
  cur public.artifact_versions%rowtype; base public.artifact_versions%rowtype; c public.client_portal_changes%rowtype;
  v_open boolean; v_allowed text[]; k text; val jsonb; v_text text; v_current text; v_name text;
  v_total integer := 0; v_count integer; v_hashes jsonb := '{}'::jsonb; v_names text[] := '{}'; v_summary text;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, true);
  if p_request is null or p_base_version is null or p_base_version < 1 or p_files is null or jsonb_typeof(p_files) <> 'object'
    or p_summary is null or length(p_summary) > 4000 then
    raise exception 'Invalid draft' using errcode='22023';
  end if;
  select count(*) into v_count from jsonb_object_keys(p_files);
  if v_count not between 1 and 30 then raise exception 'Save between 1 and 30 collections at a time' using errcode='22023'; end if;
  v_summary := left(makeborne_private.client_review_text(p_summary), 2000);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  select * into s from public.client_portal_sites where artifact_id = p_artifact;
  if p_base_version > a.current_version then raise exception 'Reload the latest content before saving' using errcode='PT409'; end if;
  select * into cur from public.artifact_versions where artifact_id = a.id and workspace_id = a.workspace_id and version_number = a.current_version;
  select * into base from public.artifact_versions where artifact_id = a.id and workspace_id = a.workspace_id and version_number = p_base_version;
  if cur.id is null or base.id is null then raise exception 'Reload the latest content before saving' using errcode='PT409'; end if;
  v_allowed := makeborne_private.portal_allowed(makeborne_private.portal_declared(cur.content), s.collections);

  select * into c from public.client_portal_changes where access_id = g.id and artifact_id = a.id and status in ('draft','pending') for update;
  v_open := found;
  if v_open and c.status = 'pending' then
    raise exception 'Your changes are waiting for review. Withdraw them before editing again.' using errcode='PT409';
  end if;
  if v_open and c.request_key = p_request then
    if c.files = p_files and c.base_version = p_base_version then return makeborne_private.portal_change_json(c); end if;
    raise exception 'Request changed' using errcode='MB409';
  end if;
  if (select count(*) from public.audit_events where target_id = g.id and action = 'portal.draft_saved' and action like 'portal.%' and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many saves. Please wait a few minutes.' using errcode='MB429';
  end if;

  for k, val in select key, value from jsonb_each(p_files) loop
    v_name := makeborne_private.portal_collection_of(k);
    if v_name is null or not (v_name = any(v_allowed)) then
      raise exception 'That part of the site cannot be edited here' using errcode='PP422';
    end if;
    if jsonb_typeof(val) is distinct from 'string' then raise exception 'Invalid draft' using errcode='22023'; end if;
    v_text := val #>> '{}';
    if length(v_text) > 200000 then raise exception 'A collection is larger than 200 KB' using errcode='22023'; end if;
    begin perform v_text::jsonb; exception when invalid_text_representation then raise exception 'A collection is not valid JSON' using errcode='22023'; end;
    v_total := v_total + length(v_text);
    v_current := makeborne_private.portal_file(cur.content, k);
    if v_current is null then raise exception 'That part of the site cannot be edited here' using errcode='PP422'; end if;
    if makeborne_private.portal_file(base.content, k) is distinct from v_current then
      raise exception 'Your agency updated this content. Reload to see the latest version.' using errcode='PT409';
    end if;
    v_hashes := v_hashes || jsonb_build_object(k, makeborne_private.portal_sha(v_current));
    v_names := array_append(v_names, v_name);
  end loop;
  if v_total > 600000 then raise exception 'Content is larger than 600 KB in total' using errcode='22023'; end if;

  if v_open then
    update public.client_portal_changes set files = p_files, base_version = p_base_version, base_hashes = v_hashes, summary = v_summary,
      request_key = p_request, updated_at = clock_timestamp() where id = c.id returning * into c;
  else
    insert into public.client_portal_changes(workspace_id, access_id, artifact_id, status, base_version, files, base_hashes, summary, request_key)
    values(g.workspace_id, g.id, a.id, 'draft', p_base_version, p_files, v_hashes, v_summary, p_request) returning * into c;
  end if;
  perform makeborne_private.portal_audit(g.workspace_id, p_actor, 'portal.draft_saved', g.id,
    jsonb_build_object('artifactId', a.id, 'changeId', c.id, 'files', v_count, 'collections', to_jsonb(v_names)));
  return makeborne_private.portal_change_json(c);
end $$;

create function makeborne_private.portal_change_action(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid,
  p_change uuid, p_action text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; s public.client_portal_sites%rowtype;
  cur public.artifact_versions%rowtype; c public.client_portal_changes%rowtype; v_allowed text[]; k text; v_current text; v_changed boolean := false;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, true);
  if p_action is null or p_action not in ('submit','withdraw') or p_change is null then raise exception 'Choose submit or withdraw' using errcode='22023'; end if;
  select * into c from public.client_portal_changes where id = p_change and access_id = g.id and artifact_id = p_artifact for update;
  if not found then raise exception 'This change is not available' using errcode='P0002'; end if;
  if p_action = 'withdraw' then
    if c.status = 'withdrawn' then return makeborne_private.portal_change_json(c); end if;
    if c.status not in ('draft','pending') then raise exception 'Your agency already decided on this change' using errcode='PT409'; end if;
    update public.client_portal_changes set status = 'withdrawn', updated_at = clock_timestamp() where id = c.id returning * into c;
    perform makeborne_private.portal_audit(g.workspace_id, p_actor, 'portal.change_withdrawn', g.id, jsonb_build_object('artifactId', p_artifact, 'changeId', c.id));
    return makeborne_private.portal_change_json(c);
  end if;
  if c.status = 'pending' then return makeborne_private.portal_change_json(c); end if;
  if c.status <> 'draft' then raise exception 'This change was already closed' using errcode='PT409'; end if;
  if (select count(*) from public.client_portal_changes where access_id = g.id and submitted_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many submissions today. Please try again tomorrow.' using errcode='MB429';
  end if;
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  select * into s from public.client_portal_sites where artifact_id = p_artifact;
  select * into cur from public.artifact_versions where artifact_id = a.id and workspace_id = a.workspace_id and version_number = a.current_version;
  v_allowed := makeborne_private.portal_allowed(makeborne_private.portal_declared(cur.content), s.collections);
  for k in select jsonb_object_keys(c.files) loop
    if not (coalesce(makeborne_private.portal_collection_of(k), '') = any(v_allowed)) then
      raise exception 'That part of the site cannot be edited here' using errcode='PP422';
    end if;
    v_current := makeborne_private.portal_file(cur.content, k);
    if makeborne_private.portal_sha(v_current) is distinct from c.base_hashes->>k then
      raise exception 'Your agency updated this content. Reload to see the latest version.' using errcode='PT409';
    end if;
    if v_current is distinct from c.files->>k then v_changed := true; end if;
  end loop;
  if not v_changed then raise exception 'There are no changes to send' using errcode='22023'; end if;
  update public.client_portal_changes set status = 'pending', submitted_at = now(), updated_at = clock_timestamp() where id = c.id returning * into c;
  perform makeborne_private.portal_audit(g.workspace_id, p_actor, 'portal.change_submitted', g.id,
    jsonb_build_object('artifactId', p_artifact, 'changeId', c.id, 'files', (select count(*) from jsonb_object_keys(c.files))));
  return makeborne_private.portal_change_json(c);
end $$;

-- Storage location of one image of the site's current version (never another project's).
create function makeborne_private.portal_image(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid, p_asset uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; v public.artifact_versions%rowtype; d jsonb; r record;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, false);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  select * into v from public.artifact_versions where artifact_id = a.id and workspace_id = a.workspace_id and version_number = a.current_version;
  select x into d from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets', '[]'::jsonb)) x
    where x->>'id' = p_asset::text and x->>'path' like 'public/%' and x->>'mediaType' in ('image/png','image/jpeg','image/webp') limit 1;
  if d is null then raise exception 'Image not found' using errcode='P0002'; end if;
  select object_path, content_type into r from public.assets
    where id = p_asset and workspace_id = a.workspace_id and project_id = a.project_id and sha256 = d->>'sha256'
      and object_path like a.workspace_id::text || '/' || a.project_id::text || '/%';
  if not found then raise exception 'Image not found' using errcode='P0002'; end if;
  return jsonb_build_object('objectPath', r.object_path, 'contentType', r.content_type);
end $$;

-- Anonymous: what an invite link shows before sign-in. No grant details.
create function public.makeborne_read_portal_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.client_portal_access%rowtype; h bytea := makeborne_private.client_review_token_hash(p_token); v_client text;
begin
  if h is null then return null; end if;
  select * into g from public.client_portal_access where token_hash = h;
  if not found then return null; end if;
  select coalesce(nullif(company, ''), name) into v_client from public.clients where id = g.client_id and workspace_id = g.workspace_id;
  return jsonb_build_object(
    'status', case when g.revoked_at is not null then 'revoked' when g.accepted_at is not null then 'accepted'
      when g.invite_expires_at <= now() then 'expired' else 'open' end,
    'agency', makeborne_private.portal_brand(g.workspace_id),
    'client', jsonb_build_object('name', coalesce(v_client, '')),
    'maskedEmail', makeborne_private.portal_mask_email(g.email));
end $$;

-- Strict email match, single use, expiry. Never creates a workspace membership.
create function makeborne_private.accept_portal_invite(p_token text, p_actor uuid, p_session uuid, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; h bytea := makeborne_private.client_review_token_hash(p_token); v_email text;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  if h is null then raise exception 'This invite link is not valid' using errcode='PP404'; end if;
  select * into g from public.client_portal_access where token_hash = h for update;
  if not found or g.revoked_at is not null then raise exception 'This invite is no longer available. Ask your agency for a new one.' using errcode='PP404'; end if;
  if g.accepted_at is not null then
    if g.user_id = p_actor then return jsonb_build_object('accessId', g.id, 'replayed', true); end if;
    raise exception 'This invite has already been used' using errcode='PP409';
  end if;
  if g.invite_expires_at <= now() then raise exception 'This invite has expired. Ask your agency to send it again.' using errcode='PP410'; end if;
  select lower(email) into v_email from auth.users where id = p_actor;
  if v_email is distinct from g.email then
    raise exception 'This invite is for %. Sign in with that email address to accept it.', makeborne_private.portal_mask_email(g.email) using errcode='PP403';
  end if;
  update public.client_portal_access set user_id = p_actor, accepted_at = now(), last_seen_at = now(), updated_at = clock_timestamp()
    where id = g.id returning * into g;
  perform makeborne_private.portal_audit(g.workspace_id, p_actor, 'portal.invite_accepted', g.id, jsonb_build_object('clientId', g.client_id));
  return jsonb_build_object('accessId', g.id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Agency functions.
-- ---------------------------------------------------------------------------
-- Service role: the server generates the token and passes only its hash.
create function makeborne_private.create_portal_invite(p_actor uuid, p_session uuid, p_expires timestamptz, p_workspace uuid, p_client uuid,
  p_email text, p_display_name text, p_token_hash bytea, p_days integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype; old public.client_portal_access%rowtype;
  v_email text := lower(btrim(coalesce(p_email, ''))); v_name text := left(makeborne_private.client_review_text(p_display_name), 120);
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  perform makeborne_private.portal_agency_writer(p_actor, p_workspace);
  perform pg_advisory_xact_lock(hashtextextended('makeborne.portal:' || p_workspace::text, 0));
  if not exists(select 1 from public.clients where id = p_client and workspace_id = p_workspace) then
    raise exception 'Client not found' using errcode='P0002';
  end if;
  if length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]<>]{1,64}@[^@[:space:]<>]{1,190}\.[a-z]{2,24}$'
    or v_name ~ '[<>]' or p_token_hash is null or octet_length(p_token_hash) <> 32 or p_days is null or p_days not between 1 and 14 then
    raise exception 'Invalid invite' using errcode='22023';
  end if;
  if (select count(*) from public.audit_events where workspace_id = p_workspace and action in ('portal.invite_created','portal.invite_resent')
      and action like 'portal.%' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Invite limit reached for today' using errcode='MB429';
  end if;
  select * into old from public.client_portal_access where workspace_id = p_workspace and client_id = p_client and email = v_email
    and revoked_at is null for update;
  if found then
    if old.accepted_at is null and old.invite_expires_at <= now() then
      update public.client_portal_access set revoked_at = now(), revoked_by = p_actor, updated_at = clock_timestamp() where id = old.id;
    else
      raise exception 'This email already has portal access for this client. Resend the invite instead.' using errcode='PP409';
    end if;
  end if;
  if (select count(*) from public.client_portal_access where workspace_id = p_workspace and revoked_at is null) >= 100
    or (select count(*) from public.client_portal_access where client_id = p_client and revoked_at is null) >= 10 then
    raise exception 'Portal access limit reached. Revoke unused access first.' using errcode='MB429';
  end if;
  insert into public.client_portal_access(workspace_id, client_id, email, display_name, token_hash, invited_by, invited_at, invite_expires_at)
  values(p_workspace, p_client, v_email, v_name, p_token_hash, p_actor, now(), now() + make_interval(days => p_days)) returning * into r;
  perform makeborne_private.portal_audit(p_workspace, p_actor, 'portal.invite_created', r.id, jsonb_build_object('clientId', p_client, 'days', p_days));
  return makeborne_private.portal_access_json(r);
end $$;

create function makeborne_private.resend_portal_invite(p_actor uuid, p_session uuid, p_expires timestamptz, p_workspace uuid, p_access uuid,
  p_token_hash bytea, p_days integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  perform makeborne_private.portal_agency_writer(p_actor, p_workspace);
  perform pg_advisory_xact_lock(hashtextextended('makeborne.portal:' || p_workspace::text, 0));
  select * into r from public.client_portal_access where id = p_access and workspace_id = p_workspace for update;
  if not found then raise exception 'Portal access not found' using errcode='P0002'; end if;
  if r.revoked_at is not null then raise exception 'This access was revoked. Send a new invite instead.' using errcode='PT409'; end if;
  if r.accepted_at is not null then raise exception 'This person has already joined' using errcode='PT409'; end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 or p_days is null or p_days not between 1 and 14 then
    raise exception 'Invalid invite' using errcode='22023';
  end if;
  if (select count(*) from public.audit_events where workspace_id = p_workspace and action in ('portal.invite_created','portal.invite_resent')
      and action like 'portal.%' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Invite limit reached for today' using errcode='MB429';
  end if;
  update public.client_portal_access set token_hash = p_token_hash, invited_by = p_actor, invited_at = now(),
    invite_expires_at = now() + make_interval(days => p_days), updated_at = clock_timestamp() where id = r.id returning * into r;
  perform makeborne_private.portal_audit(p_workspace, p_actor, 'portal.invite_resent', r.id, jsonb_build_object('clientId', r.client_id, 'days', p_days));
  return makeborne_private.portal_access_json(r);
end $$;

-- Service role so revocation works for owners and editors without a creation
-- membership (the membership write trigger only applies to browser writes).
-- Open drafts and pending changes of the grant are withdrawn with it.
create function makeborne_private.revoke_portal_access(p_actor uuid, p_session uuid, p_expires timestamptz, p_workspace uuid, p_access uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype; v_was timestamptz; v_closed integer;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  if not makeborne_private.client_review_can_edit_as(p_actor, p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select revoked_at into v_was from public.client_portal_access where id = p_access and workspace_id = p_workspace for update;
  if not found then raise exception 'Portal access not found' using errcode='P0002'; end if;
  update public.client_portal_access set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, p_actor), updated_at = clock_timestamp()
    where id = p_access and workspace_id = p_workspace returning * into r;
  update public.client_portal_changes set status = 'withdrawn', updated_at = clock_timestamp() where access_id = r.id and status in ('draft','pending');
  get diagnostics v_closed = row_count;
  if v_was is null then
    perform makeborne_private.portal_audit(p_workspace, p_actor, 'portal.access_revoked', r.id, jsonb_build_object('clientId', r.client_id, 'closedChanges', v_closed));
  end if;
  return makeborne_private.portal_access_json(r);
end $$;

-- Authenticated owner/editor (reviewers refused): read the client's portal.
create function public.makeborne_portal_client_overview(p_workspace uuid, p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not makeborne_private.client_review_can_edit_as((select auth.uid()), p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id = p_client and workspace_id = p_workspace) then raise exception 'Client not found' using errcode='P0002'; end if;
  return jsonb_build_object(
    'access', coalesce((select jsonb_agg(makeborne_private.portal_access_json(g) order by g.revoked_at is not null, g.created_at desc)
      from (select * from public.client_portal_access where workspace_id = p_workspace and client_id = p_client order by created_at desc limit 50) g), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('artifactId', a.id, 'title', a.title, 'enabled', coalesce(s.enabled, false),
        'collections', to_jsonb(s.collections), 'hasContent', makeborne_private.portal_declared(v.content) is not null,
        'pending', (select count(*) from public.client_portal_changes c where c.artifact_id = a.id and c.status = 'pending')) order by a.title, a.id)
      from public.artifacts a
      join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = p_client
      left join public.client_portal_sites s on s.artifact_id = a.id
      left join public.artifact_versions v on v.artifact_id = a.id and v.version_number = a.current_version
      where a.workspace_id = p_workspace and a.kind = 'website'), '[]'::jsonb));
end $$;

-- Site settings plus pending changes with the current text of each touched file.
create function public.makeborne_portal_site_settings(p_workspace uuid, p_artifact uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.artifacts%rowtype; s public.client_portal_sites%rowtype; v public.artifact_versions%rowtype; v_client uuid;
begin
  if not makeborne_private.client_review_can_edit_as((select auth.uid()), p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into a from public.artifacts where id = p_artifact and workspace_id = p_workspace and kind = 'website';
  if not found then raise exception 'Website not found' using errcode='P0002'; end if;
  select client_id into v_client from public.projects where id = a.project_id and workspace_id = p_workspace;
  select * into s from public.client_portal_sites where artifact_id = a.id;
  select * into v from public.artifact_versions where artifact_id = a.id and workspace_id = p_workspace and version_number = a.current_version;
  return jsonb_build_object('clientId', v_client, 'enabled', coalesce(s.enabled, false), 'collections', to_jsonb(s.collections),
    'version', a.current_version,
    'manifest', makeborne_private.portal_file(v.content, 'src/content/collections.json'),
    'images', coalesce((select jsonb_agg('/' || substr(x->>'path', 8) order by x->>'path')
      from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets', '[]'::jsonb)) x
      where x->>'path' like 'public/%' and x->>'mediaType' in ('image/png','image/jpeg','image/webp')), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(r->>'path' order by r->>'path') from jsonb_array_elements(coalesce(v.content->'websiteSource'->'routes', '[]'::jsonb)) r), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(makeborne_private.portal_change_json(c) || jsonb_build_object(
        'authorName', g.display_name, 'authorEmail', g.email,
        'currentFiles', coalesce((select jsonb_object_agg(k, makeborne_private.portal_file(v.content, k)) from jsonb_object_keys(c.files) k), '{}'::jsonb))
        order by c.submitted_at, c.id)
      from public.client_portal_changes c join public.client_portal_access g on g.id = c.access_id
      where c.artifact_id = a.id and c.workspace_id = p_workspace and c.status = 'pending'), '[]'::jsonb));
end $$;

create function public.makeborne_update_portal_access(p_workspace uuid, p_access uuid, p_plan_label text, p_paid_through date) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype; v_label text := btrim(makeborne_private.client_review_text(p_plan_label));
begin
  if (select auth.uid()) is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if length(v_label) > 80 or v_label ~ '[<>]' or position(E'\n' in v_label) > 0
    or (p_paid_through is not null and p_paid_through not between date '2000-01-01' and date '2200-12-31') then
    raise exception 'Invalid plan details' using errcode='22023';
  end if;
  update public.client_portal_access set plan_label = v_label, paid_through = p_paid_through, updated_at = clock_timestamp()
    where id = p_access and workspace_id = p_workspace returning * into r;
  if not found then raise exception 'Portal access not found' using errcode='P0002'; end if;
  perform makeborne_private.portal_audit(p_workspace, (select auth.uid()), 'portal.access_updated', r.id,
    jsonb_build_object('clientId', r.client_id, 'paidThrough', p_paid_through is not null));
  return makeborne_private.portal_access_json(r);
end $$;

create function public.makeborne_set_portal_site(p_workspace uuid, p_artifact uuid, p_enabled boolean, p_collections text[]) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; v public.artifact_versions%rowtype; v_client uuid; v_declared text[]; v_list text[];
begin
  if (select auth.uid()) is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Choose on or off' using errcode='22023'; end if;
  select * into a from public.artifacts where id = p_artifact and workspace_id = p_workspace and kind = 'website' for update;
  if not found then raise exception 'Website not found' using errcode='P0002'; end if;
  select client_id into v_client from public.projects where id = a.project_id and workspace_id = p_workspace;
  if v_client is null then raise exception 'Link this website to a client before turning on client editing' using errcode='22023'; end if;
  select * into v from public.artifact_versions where artifact_id = a.id and workspace_id = p_workspace and version_number = a.current_version;
  v_declared := makeborne_private.portal_declared(v.content);
  if p_enabled and v_declared is null then
    raise exception 'This website has no client-editable content yet' using errcode='22023';
  end if;
  if p_collections is not null then
    if cardinality(p_collections) > 30 then raise exception 'Too many collections' using errcode='22023'; end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_list from unnest(p_collections) x;
    if exists(select 1 from unnest(v_list) x where x is null or x !~ '^[a-z][a-z0-9-]{0,39}$' or x = 'collections'
        or (v_declared is not null and not (x = any(v_declared)))) then
      raise exception 'Choose collections this website declares' using errcode='22023';
    end if;
  end if;
  insert into public.client_portal_sites(artifact_id, workspace_id, enabled, collections, updated_by)
  values(a.id, p_workspace, p_enabled, v_list, (select auth.uid()))
  on conflict(artifact_id) do update set enabled = excluded.enabled, collections = excluded.collections,
    updated_by = excluded.updated_by, updated_at = clock_timestamp();
  perform makeborne_private.portal_audit(p_workspace, (select auth.uid()), 'portal.site_updated', a.id,
    jsonb_build_object('enabled', p_enabled, 'collections', to_jsonb(v_list)));
  return public.makeborne_portal_site_settings(p_workspace, p_artifact);
end $$;

-- Approve: lock the artifact, re-check each changed file against the CURRENT
-- version (conflict unless p_overwrite), splice only those files into the
-- current websiteSource and save the next version as the approving user
-- through the normal version authority (membership trigger applies).
create function public.makeborne_decide_portal_change(p_workspace uuid, p_artifact uuid, p_change uuid, p_decision text,
  p_note text, p_overwrite boolean, p_summary text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; c public.client_portal_changes%rowtype; g public.client_portal_access%rowtype;
  cur public.artifact_versions%rowtype; v_declared text[]; k text; v_current text; v_files jsonb; v_content jsonb; v_saved jsonb;
  v_note text := left(makeborne_private.client_review_text(p_note), 2000); v_summary text; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approve','reject') or p_overwrite is null then raise exception 'Choose approve or reject' using errcode='22023'; end if;
  select * into a from public.artifacts where id = p_artifact and workspace_id = p_workspace and kind = 'website' for update;
  if not found then raise exception 'Website not found' using errcode='P0002'; end if;
  select * into c from public.client_portal_changes where id = p_change and artifact_id = p_artifact and workspace_id = p_workspace for update;
  if not found then raise exception 'Change not found' using errcode='P0002'; end if;
  if c.status = (case p_decision when 'approve' then 'approved' else 'rejected' end) then return makeborne_private.portal_change_json(c); end if;
  if c.status <> 'pending' then raise exception 'This change is no longer waiting for review' using errcode='PT409'; end if;
  if p_decision = 'reject' then
    update public.client_portal_changes set status = 'rejected', decision_note = nullif(v_note, ''), decided_by = v_actor,
      decided_at = now(), updated_at = clock_timestamp() where id = c.id returning * into c;
    perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.change_rejected', c.access_id, jsonb_build_object('artifactId', p_artifact, 'changeId', c.id));
    return makeborne_private.portal_change_json(c);
  end if;
  if (select count(*) from public.client_portal_changes where artifact_id = p_artifact and status = 'approved' and decided_at > now() - interval '1 day') >= 20 then
    raise exception 'Client edit limit reached for this site today' using errcode='MB429';
  end if;
  select * into g from public.client_portal_access where id = c.access_id;
  select * into cur from public.artifact_versions where artifact_id = a.id and workspace_id = p_workspace and version_number = a.current_version;
  if not found or jsonb_typeof(cur.content->'websiteSource'->'files') is distinct from 'array' then
    raise exception 'Source website required' using errcode='22023';
  end if;
  v_declared := makeborne_private.portal_declared(cur.content);
  for k in select jsonb_object_keys(c.files) loop
    if v_declared is null or not (coalesce(makeborne_private.portal_collection_of(k), '') = any(v_declared))
      or jsonb_typeof(c.files->k) is distinct from 'string' then
      raise exception 'This change no longer matches the website content' using errcode='22023';
    end if;
    v_current := makeborne_private.portal_file(cur.content, k);
    if v_current is null then raise exception 'This change no longer matches the website content' using errcode='22023'; end if;
    if not p_overwrite and makeborne_private.portal_sha(v_current) is distinct from c.base_hashes->>k then
      raise exception 'The site changed since the client started editing' using errcode='PT409';
    end if;
  end loop;
  select jsonb_agg(case when c.files ? (f->>'path') then jsonb_set(f, '{content}', c.files->(f->>'path')) else f end order by n)
    into v_files from jsonb_array_elements(cur.content->'websiteSource'->'files') with ordinality t(f, n);
  v_content := jsonb_set(cur.content, '{websiteSource,files}', v_files);
  v_summary := coalesce(nullif(left(makeborne_private.client_review_text(p_summary), 2000), ''),
    format('Client edit by %s', coalesce(nullif(g.display_name, ''), makeborne_private.portal_mask_email(g.email))));
  v_saved := makeborne_private.save_artifact_version(p_workspace, p_artifact, a.current_version, v_content, cur.style_snapshot, cur.asset_manifest, v_summary);
  update public.client_portal_changes set status = 'approved', result_version = (v_saved->'version'->>'version_number')::integer,
    decision_note = nullif(v_note, ''), decided_by = v_actor, decided_at = now(), updated_at = clock_timestamp() where id = c.id returning * into c;
  perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.change_approved', c.access_id,
    jsonb_build_object('artifactId', p_artifact, 'changeId', c.id, 'files', (select count(*) from jsonb_object_keys(c.files)),
      'version', c.result_version, 'overwrite', p_overwrite));
  return makeborne_private.portal_change_json(c);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Exposure. Private helpers have no browser or service grants; service-role
-- functions are reached only through public invoker bridges.
-- ---------------------------------------------------------------------------
revoke all on function makeborne_private.portal_file(jsonb, text), makeborne_private.portal_sha(text), makeborne_private.portal_declared(jsonb),
  makeborne_private.portal_allowed(text[], text[]), makeborne_private.portal_collection_of(text), makeborne_private.portal_mask_email(text),
  makeborne_private.portal_brand(uuid), makeborne_private.portal_access_json(public.client_portal_access),
  makeborne_private.portal_change_json(public.client_portal_changes), makeborne_private.portal_grant(uuid, uuid, boolean),
  makeborne_private.portal_audit(uuid, uuid, text, uuid, jsonb), makeborne_private.portal_agency_writer(uuid, uuid)
  from public, anon, authenticated, service_role;

do $$ declare f record; args text; names text; begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'makeborne_private'
    and p.proname in ('portal_home','portal_read_site','portal_save_draft','portal_change_action','portal_image',
      'accept_portal_invite','create_portal_invite','resend_portal_invite','revoke_portal_access') loop
    args := pg_get_function_arguments(f.oid);
    select string_agg(x, ',' order by ord) into names from unnest((select proargnames from pg_proc where oid = f.oid)) with ordinality a(x, ord);
    execute format('create function public.makeborne_%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$ select makeborne_private.%I(%s); $fn$',
      f.proname, args, f.proname, names);
    execute format('revoke all on function makeborne_private.%I(%s) from public,anon,authenticated,service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function makeborne_private.%I(%s) to service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('revoke all on function public.makeborne_%I(%s) from public,anon,authenticated,service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function public.makeborne_%I(%s) to service_role', f.proname, pg_get_function_identity_arguments(f.oid));
  end loop;
end $$;

revoke all on function public.makeborne_read_portal_invite(text) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_read_portal_invite(text) to anon, authenticated, service_role;
revoke all on function public.makeborne_portal_client_overview(uuid, uuid), public.makeborne_portal_site_settings(uuid, uuid),
  public.makeborne_update_portal_access(uuid, uuid, text, date), public.makeborne_set_portal_site(uuid, uuid, boolean, text[]),
  public.makeborne_decide_portal_change(uuid, uuid, uuid, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_portal_client_overview(uuid, uuid), public.makeborne_portal_site_settings(uuid, uuid),
  public.makeborne_update_portal_access(uuid, uuid, text, date), public.makeborne_set_portal_site(uuid, uuid, boolean, text[]),
  public.makeborne_decide_portal_change(uuid, uuid, uuid, text, text, boolean, text) to authenticated;

commit;
