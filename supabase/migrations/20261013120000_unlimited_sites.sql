-- Unlimited websites (owner decision 2026-10-13). Replaces the five-live-site and
-- twenty-address workspace caps in save_site_v2 with fair-use abuse limits. Every
-- other publishing rule is unchanged; v3/v4 call this function, so they inherit it.
begin;

-- Keep first-publication events independently of the mutable site revision and
-- of artifact deletion. Browser roles cannot rewrite or erase this accounting.
create table if not exists makeborne_hosting.site_publication_events (
  artifact_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  first_published_at timestamptz not null default clock_timestamp()
);
create index if not exists site_publication_events_daily
  on makeborne_hosting.site_publication_events(workspace_id,first_published_at);
alter table makeborne_hosting.site_publication_events enable row level security;
revoke all on makeborne_hosting.site_publication_events from public,anon,authenticated,service_role;
-- Historical first-publication time was not stored. Last update is a conservative
-- bound for the first 24 hours after upgrading; replay never moves that bound.
insert into makeborne_hosting.site_publication_events(artifact_id,workspace_id,first_published_at)
select artifact_id,workspace_id,updated_at from public.hosted_sites
on conflict(artifact_id) do nothing;

create or replace function makeborne_hosting.save_site_v2(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,p_interactive boolean,p_script text,p_files jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.workspaces%rowtype; a public.artifacts%rowtype; s public.hosted_sites%rowtype; v_files jsonb := coalesce(p_files,'[]'::jsonb); v_digest text;
begin
  select * into w from public.workspaces where id=p_workspace for update;
  if not found or w.owner_id is distinct from p_actor then raise exception 'Owner required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verified account required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found or a.kind<>'website' then raise exception 'Website not found' using errcode='P0002'; end if;
  select * into s from public.hosted_sites where artifact_id=p_artifact for update;
  if p_request is null or p_interactive is null then raise exception 'Request key required' using errcode='22023'; end if;
  if jsonb_typeof(v_files)<>'array' or jsonb_array_length(v_files)>42 then raise exception 'Too many website files' using errcode='22023'; end if;
  v_digest := encode(sha256(convert_to(coalesce(p_html,'') || '|' || coalesce(p_script,'') || '|' || coalesce((select string_agg((f->>'path') || ':' || (f->>'sha256'), ',' order by f->>'path') from jsonb_array_elements(v_files) f),''),'UTF8')),'hex');
  if s.request_id=p_request then
    if s.live is distinct from p_live or s.slug is distinct from p_slug or (p_live and (s.version_number is distinct from p_version or s.bundle_sha256 is distinct from v_digest or s.interactive is distinct from p_interactive)) then raise exception 'Request changed' using errcode='MB409'; end if;
    return makeborne_hosting.public_site(s);
  end if;
  if coalesce(s.revision,0)<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
  if p_live then
    if not makeborne_private.has_account_privilege(p_actor,'admin') and not exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=p_actor and m.status in ('active','canceling') and m.verified_until>now() and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    ) then raise exception 'Creation membership required' using errcode='MB402'; end if;
    if a.current_version<>p_version or not exists(select 1 from public.artifact_versions where artifact_id=p_artifact and version_number=p_version and workspace_id=p_workspace) then raise exception 'Save latest website first' using errcode='PT409'; end if;
    if p_html is null or octet_length(p_html) not between 100 and 4000000 or left(p_html,15)<>'<!doctype html>' then raise exception 'Website exceeds size limit' using errcode='22023'; end if;
    if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' or p_slug like 'xn--%' or p_slug=any(array['admin','api','auth','billing','login','studio','support','www','makeborne','robots-txt','sitemap-xml']) then raise exception 'Invalid address' using errcode='22023'; end if;
    if s.artifact_id is not null and s.slug<>p_slug then raise exception 'Address is reserved for this website' using errcode='22023'; end if;
    -- Unlimited websites on every plan. Fair use only stops automated abuse: at most 50 new
    -- websites going live per workspace per day, and a 1,000 live-site ceiling per workspace.
    if s.artifact_id is null and (select count(*) from makeborne_hosting.site_publication_events where workspace_id=p_workspace and first_published_at>clock_timestamp()-interval '1 day')>=50
      then raise exception 'Daily publishing limit reached; try again tomorrow' using errcode='MB429'; end if;
    if not coalesce(s.live,false) and (select count(*) from public.hosted_sites where workspace_id=p_workspace and live)>=1000
      then raise exception 'Fair-use limit of 1,000 live websites reached; contact support' using errcode='MB429'; end if;
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive,entry_script,bundle_sha256)
    values(p_artifact,p_workspace,p_actor,p_slug,p_version,p_html,true,1,p_request,p_interactive,p_script,v_digest)
    on conflict(artifact_id) do update set version_number=excluded.version_number,html=excluded.html,live=true,revision=hosted_sites.revision+1,request_id=p_request,
      interactive=excluded.interactive,entry_script=excluded.entry_script,bundle_sha256=excluded.bundle_sha256,updated_at=now()
    returning * into s;
    insert into makeborne_hosting.site_publication_events(artifact_id,workspace_id)
    values(p_artifact,p_workspace) on conflict(artifact_id) do nothing;
    delete from public.hosted_site_files where artifact_id=p_artifact;
    insert into public.hosted_site_files(artifact_id,path,content_type,body,sha256)
    select p_artifact,f->>'path',f->>'content_type',decode(f->>'body','base64'),f->>'sha256' from jsonb_array_elements(v_files) f;
    if exists(select 1 from public.hosted_site_files where artifact_id=p_artifact and encode(sha256(body),'hex')<>sha256) then raise exception 'Website file digest mismatch' using errcode='22023'; end if;
    if (select coalesce(sum(octet_length(body)),0) from public.hosted_site_files where artifact_id=p_artifact)>6000000 then raise exception 'Website files exceed size limit' using errcode='22023'; end if;
    if p_script is not null and not exists(select 1 from public.hosted_site_files where artifact_id=p_artifact and path=p_script and content_type='text/javascript; charset=utf-8') then raise exception 'Website script missing' using errcode='22023'; end if;
  else
    if s.artifact_id is null then raise exception 'Website not published' using errcode='P0002'; end if;
    update public.hosted_sites set live=false,revision=revision+1,request_id=p_request,updated_at=now() where artifact_id=p_artifact returning * into s;
  end if;
  return makeborne_hosting.public_site(s);
end $$;

commit;
