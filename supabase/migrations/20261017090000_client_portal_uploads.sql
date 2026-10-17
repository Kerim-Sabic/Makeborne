-- Client portal Phase 2: clients upload their own photos.
-- The server re-encodes each upload (EXIF stripped, ≤2400 px WebP), stores it at
-- <workspace>/<project>/portal/<asset id>.webp and registers it here as a project
-- asset. The photo is visible in that site's portal image picker straight away, but
-- reaches the website only when the agency approves a change that uses it: approval
-- then adds it to the new version's source assets and asset manifest.
-- Additive plus three `create or replace` bodies of portal functions from
-- 20261016090000 (same signatures and grants): portal_read_site and portal_image
-- also list/serve this site's uploads; makeborne_decide_portal_change attaches the
-- uploads an approved change references. Rehearse with supabase/check-client-portal-uploads.sql.
begin;

create table public.client_portal_uploads (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  access_id uuid not null references public.client_portal_access(id) on delete cascade,
  actor_id uuid not null,
  -- The site path is derived: public/images/client-<key>.webp
  path_key text not null check(path_key ~ '^[0-9a-f]{12}$'),
  object_path text not null check(char_length(object_path) <= 300),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check(bytes between 1 and 4000000),
  width integer not null check(width between 1 and 4000),
  height integer not null check(height between 1 and 4000),
  created_at timestamptz not null default now(),
  unique(artifact_id, path_key)
);
create index client_portal_uploads_access on public.client_portal_uploads(access_id, created_at desc);
create index client_portal_uploads_workspace on public.client_portal_uploads(workspace_id);
comment on table public.client_portal_uploads is 'Photos clients uploaded in the portal for one site. Registered as project assets; attached to the website only when the agency approves a change that uses them.';

alter table public.client_portal_uploads enable row level security;
revoke all on public.client_portal_uploads from public, anon, authenticated, service_role;
grant select on public.client_portal_uploads to authenticated;
grant all on public.client_portal_uploads to service_role;
create policy client_portal_uploads_read on public.client_portal_uploads for select to authenticated using(makeborne_private.can_read(workspace_id));

-- Where an upload goes, after the grant and quota checks (40 per grant per day, 60 not-yet-used per site).
create function makeborne_private.portal_upload_scope(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, false);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  if (select count(*) from public.client_portal_uploads where access_id = g.id and created_at > now() - interval '1 day') >= 40 then
    raise exception 'Photo upload limit reached for today' using errcode='MB429';
  end if;
  if (select count(*) from public.client_portal_uploads where artifact_id = a.id) >= 60 then
    raise exception 'This site has reached its photo limit' using errcode='MB429';
  end if;
  return jsonb_build_object('workspaceId', a.workspace_id, 'projectId', a.project_id);
end $$;

-- Registers a stored upload as a project asset and as this site's portal photo.
create function makeborne_private.portal_register_upload(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid,
  p_asset uuid, p_sha256 text, p_bytes integer, p_width integer, p_height integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; v_key text; v_path text; existing public.client_portal_uploads%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, true);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  if p_asset is null or coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes not between 1 and 4000000
    or p_width is null or p_width not between 1 and 4000 or p_height is null or p_height not between 1 and 4000 then
    raise exception 'Invalid photo' using errcode='22023';
  end if;
  select * into existing from public.client_portal_uploads where id = p_asset;
  if found then
    if existing.artifact_id <> a.id or existing.sha256 <> p_sha256 then raise exception 'Invalid photo' using errcode='22023'; end if;
    return jsonb_build_object('assetId', existing.id, 'path', '/images/client-' || existing.path_key || '.webp');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne_portal_uploads:' || a.id::text, 0));
  if (select count(*) from public.client_portal_uploads where access_id = g.id and created_at > now() - interval '1 day') >= 40 then
    raise exception 'Photo upload limit reached for today' using errcode='MB429';
  end if;
  if (select count(*) from public.client_portal_uploads where artifact_id = a.id) >= 60 then
    raise exception 'This site has reached its photo limit' using errcode='MB429';
  end if;
  v_key := left(replace(p_asset::text, '-', ''), 12);
  v_path := a.workspace_id::text || '/' || a.project_id::text || '/portal/' || p_asset::text || '.webp';
  insert into public.assets(id, workspace_id, project_id, object_path, content_type, sha256, provenance)
    values(p_asset, a.workspace_id, a.project_id, v_path, 'image/webp', p_sha256,
      jsonb_build_object('kind', 'portal_upload', 'accessId', g.id, 'byteLength', p_bytes, 'width', p_width, 'height', p_height))
    on conflict (id) do nothing;
  if not exists(select 1 from public.assets where id = p_asset and workspace_id = a.workspace_id and project_id = a.project_id and sha256 = p_sha256 and object_path = v_path) then
    raise exception 'Invalid photo' using errcode='22023';
  end if;
  insert into public.client_portal_uploads(id, workspace_id, project_id, artifact_id, access_id, actor_id, path_key, object_path, sha256, bytes, width, height)
    values(p_asset, a.workspace_id, a.project_id, a.id, g.id, p_actor, v_key, v_path, p_sha256, p_bytes, p_width, p_height);
  perform makeborne_private.portal_audit(a.workspace_id, p_actor, 'portal.image_uploaded', g.id, jsonb_build_object('artifactId', a.id, 'bytes', p_bytes));
  return jsonb_build_object('assetId', p_asset, 'path', '/images/client-' || v_key || '.webp');
end $$;

-- Same as 20261016090000, plus this site's uploads in 'images'.
create or replace function makeborne_private.portal_read_site(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid) returns jsonb
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
    'images', coalesce((select jsonb_agg(i order by i->>'path') from (
        select jsonb_build_object('path', '/' || substr(x->>'path', 8), 'assetId', x->>'id') i
        from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets', '[]'::jsonb)) x
        where x->>'path' like 'public/%' and x->>'mediaType' in ('image/png','image/jpeg','image/webp')
        union all
        select jsonb_build_object('path', '/images/client-' || u.path_key || '.webp', 'assetId', u.id::text)
        from public.client_portal_uploads u where u.artifact_id = a.id
          and not exists(select 1 from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets', '[]'::jsonb)) y where y->>'id' = u.id::text)
      ) images), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(r->>'path' order by r->>'path')
      from jsonb_array_elements(coalesce(v.content->'websiteSource'->'routes', '[]'::jsonb)) r), '[]'::jsonb),
    'change', v_change);
end $$;

-- Same as 20261016090000, plus this site's uploads.
create or replace function makeborne_private.portal_image(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid, p_asset uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype; v public.artifact_versions%rowtype; d jsonb; r record; u public.client_portal_uploads%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, false);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  select * into u from public.client_portal_uploads where id = p_asset and artifact_id = a.id and workspace_id = a.workspace_id;
  if found then return jsonb_build_object('objectPath', u.object_path, 'contentType', 'image/webp'); end if;
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

-- Same as 20261016090000, plus: uploads referenced by the approved files are added to
-- the new version's source assets and asset manifest (at most 100 source assets).
create or replace function public.makeborne_decide_portal_change(p_workspace uuid, p_artifact uuid, p_change uuid, p_decision text,
  p_note text, p_overwrite boolean, p_summary text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; c public.client_portal_changes%rowtype; g public.client_portal_access%rowtype;
  cur public.artifact_versions%rowtype; v_declared text[]; k text; v_current text; v_files jsonb; v_content jsonb; v_saved jsonb;
  v_note text := left(makeborne_private.client_review_text(p_note), 2000); v_summary text; v_actor uuid := (select auth.uid());
  v_assets jsonb; v_manifest jsonb; v_text text; u public.client_portal_uploads%rowtype; v_added integer := 0;
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
  -- Client photos the approved files use join the website's assets.
  v_assets := coalesce(cur.content->'websiteSource'->'assets', '[]'::jsonb);
  v_manifest := coalesce(cur.asset_manifest, '[]'::jsonb);
  select string_agg(value, ' ') into v_text from jsonb_each_text(c.files);
  for u in select * from public.client_portal_uploads where artifact_id = a.id and workspace_id = p_workspace order by created_at loop
    if position(('/images/client-' || u.path_key || '.webp') in coalesce(v_text, '')) > 0
      and not exists(select 1 from jsonb_array_elements(v_assets) x where x->>'id' = u.id::text) then
      v_assets := v_assets || jsonb_build_array(jsonb_build_object('id', u.id::text, 'path', 'public/images/client-' || u.path_key || '.webp',
        'sha256', u.sha256, 'bytes', u.bytes, 'mediaType', 'image/webp'));
      if not v_manifest @> jsonb_build_array(u.id::text) then v_manifest := v_manifest || jsonb_build_array(u.id::text); end if;
      v_added := v_added + 1;
    end if;
  end loop;
  if jsonb_array_length(v_assets) > 100 then raise exception 'This website has too many images to add these photos' using errcode='22023'; end if;
  v_content := jsonb_set(v_content, '{websiteSource,assets}', v_assets);
  v_summary := coalesce(nullif(left(makeborne_private.client_review_text(p_summary), 2000), ''),
    format('Client edit by %s', coalesce(nullif(g.display_name, ''), makeborne_private.portal_mask_email(g.email))));
  v_saved := makeborne_private.save_artifact_version(p_workspace, p_artifact, a.current_version, v_content, cur.style_snapshot, v_manifest, v_summary);
  update public.client_portal_changes set status = 'approved', result_version = (v_saved->'version'->>'version_number')::integer,
    decision_note = nullif(v_note, ''), decided_by = v_actor, decided_at = now(), updated_at = clock_timestamp() where id = c.id returning * into c;
  perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.change_approved', c.access_id,
    jsonb_build_object('artifactId', p_artifact, 'changeId', c.id, 'files', (select count(*) from jsonb_object_keys(c.files)),
      'version', c.result_version, 'overwrite', p_overwrite, 'photos', v_added));
  return makeborne_private.portal_change_json(c);
end $$;

-- Service-role bridges for the two new client functions (same pattern as 20261016090000).
do $$ declare f record; args text; names text; begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'makeborne_private'
    and p.proname in ('portal_upload_scope','portal_register_upload') loop
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
commit;
