-- Interactive hosting: published React websites keep their sanitised static
-- snapshot (first paint, SEO and no-JS fallback) and add a content-addressed
-- module bundle, stylesheet and project images, served from each site's own
-- origin on the isolated site domain. Owners can switch JavaScript off per site.
begin;

alter table public.hosted_sites
  add column interactive boolean not null default true,
  add column entry_script text check (entry_script ~ '^/_mb/app-[0-9a-f]{16}\.js$'),
  add column bundle_sha256 text check (bundle_sha256 ~ '^[0-9a-f]{64}$');

create table public.hosted_site_files (
  artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
  path text not null check (
    char_length(path) <= 240 and position('..' in path) = 0 and position('//' in path) = 0 and (
      path ~ '^/_mb/app-[0-9a-f]{16}\.(js|css)$'
      or (path ~* '^/[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(webp|png|jpe?g)$' and path !~ '^/_mb/')
    )
  ),
  content_type text not null check (content_type in ('text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'image/webp')),
  body bytea not null check (octet_length(body) between 1 and 2000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (artifact_id, path)
);
alter table public.hosted_site_files enable row level security;
revoke all on public.hosted_site_files from public, anon, authenticated;
grant select, insert, update, delete on public.hosted_site_files to service_role;

-- Same eligibility as the original public reader: verified, unbanned owner with
-- an active creation entitlement or an administrator grant.
create function makeborne_hosting.owner_can_host(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u where u.id=p_owner and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
  and (
    makeborne_private.has_account_privilege(p_owner,'admin') or exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=p_owner and m.status in ('active','canceling') and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    )
  );
$$;
revoke all on function makeborne_hosting.owner_can_host(uuid) from public, anon, authenticated;

create function makeborne_hosting.public_site(s public.hosted_sites) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('slug',s.slug,'live',s.live,'version_number',s.version_number,'revision',s.revision,'updated_at',s.updated_at,
    'interactive',s.interactive,'scripted',s.entry_script is not null);
$$;
revoke all on function makeborne_hosting.public_site(public.hosted_sites) from public, anon, authenticated;

create function makeborne_hosting.save_site_v2(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,p_interactive boolean,p_script text,p_files jsonb)
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
    if not coalesce(s.live,false) and (select count(*) from public.hosted_sites where workspace_id=p_workspace and live)>=5 then raise exception 'Five live sites per workspace' using errcode='MB429'; end if;
    if s.artifact_id is null and (select count(*) from public.hosted_sites where workspace_id=p_workspace)>=20 then raise exception 'Reserved address limit reached' using errcode='MB429'; end if;
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive,entry_script,bundle_sha256)
    values(p_artifact,p_workspace,p_actor,p_slug,p_version,p_html,true,1,p_request,p_interactive,p_script,v_digest)
    on conflict(artifact_id) do update set version_number=excluded.version_number,html=excluded.html,live=true,revision=hosted_sites.revision+1,request_id=p_request,
      interactive=excluded.interactive,entry_script=excluded.entry_script,bundle_sha256=excluded.bundle_sha256,updated_at=now()
    returning * into s;
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
revoke all on function makeborne_hosting.save_site_v2(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function makeborne_hosting.save_site_v2(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb) to service_role;
create function public.makeborne_save_hosted_site_v2(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,p_interactive boolean,p_script text,p_files jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_hosting.save_site_v2(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files);
$$;
revoke all on function public.makeborne_save_hosted_site_v2(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.makeborne_save_hosted_site_v2(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb) to service_role;

-- Switching JavaScript on/off applies immediately and never needs a paid plan to
-- turn scripts off. Turning them on requires a published bundle.
create function makeborne_hosting.set_site_interactive(p_actor uuid,p_workspace uuid,p_artifact uuid,p_interactive boolean,p_revision integer,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.workspaces%rowtype; s public.hosted_sites%rowtype;
begin
  select * into w from public.workspaces where id=p_workspace for update;
  if not found or w.owner_id is distinct from p_actor then raise exception 'Owner required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verified account required' using errcode='42501'; end if;
  select * into s from public.hosted_sites where artifact_id=p_artifact and workspace_id=p_workspace for update;
  if not found then raise exception 'Website not published' using errcode='P0002'; end if;
  if p_request is null or p_interactive is null then raise exception 'Request key required' using errcode='22023'; end if;
  if s.request_id=p_request then
    if s.interactive is distinct from p_interactive then raise exception 'Request changed' using errcode='MB409'; end if;
    return makeborne_hosting.public_site(s);
  end if;
  if s.revision<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
  if p_interactive and s.entry_script is null then raise exception 'Publish again to enable JavaScript' using errcode='22023'; end if;
  update public.hosted_sites set interactive=p_interactive,revision=revision+1,request_id=p_request,updated_at=now() where artifact_id=p_artifact returning * into s;
  return makeborne_hosting.public_site(s);
end $$;
revoke all on function makeborne_hosting.set_site_interactive(uuid,uuid,uuid,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function makeborne_hosting.set_site_interactive(uuid,uuid,uuid,boolean,integer,uuid) to service_role;
create function public.makeborne_set_hosted_site_interactive(p_actor uuid,p_workspace uuid,p_artifact uuid,p_interactive boolean,p_revision integer,p_request uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_hosting.set_site_interactive(p_actor,p_workspace,p_artifact,p_interactive,p_revision,p_request);
$$;
revoke all on function public.makeborne_set_hosted_site_interactive(uuid,uuid,uuid,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.makeborne_set_hosted_site_interactive(uuid,uuid,uuid,boolean,integer,uuid) to service_role;

-- Public readers receive only deliberately published projections.
create function makeborne_hosting.read_hosted_site_v2(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('html',s.html,'interactive',s.interactive and s.entry_script is not null,'script',s.entry_script,'revision',s.revision)
  from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  where s.slug=p_slug and s.live and makeborne_hosting.owner_can_host(s.owner_id);
$$;
revoke all on function makeborne_hosting.read_hosted_site_v2(text) from public,anon,authenticated;
grant execute on function makeborne_hosting.read_hosted_site_v2(text) to anon,authenticated,service_role;
create function public.makeborne_read_hosted_site_v2(p_slug text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select makeborne_hosting.read_hosted_site_v2(p_slug);
$$;
revoke all on function public.makeborne_read_hosted_site_v2(text) from public;
grant execute on function public.makeborne_read_hosted_site_v2(text) to anon,authenticated,service_role;

-- Scripts are withheld while JavaScript is off; images and styles stay available.
create function makeborne_hosting.read_hosted_site_file(p_slug text,p_path text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('content_type',f.content_type,'sha256',f.sha256,'body',translate(encode(f.body,'base64'),E'\n',''))
  from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  join public.hosted_site_files f on f.artifact_id=s.artifact_id and f.path=p_path
  where s.slug=p_slug and s.live and (s.interactive or f.content_type<>'text/javascript; charset=utf-8') and makeborne_hosting.owner_can_host(s.owner_id);
$$;
revoke all on function makeborne_hosting.read_hosted_site_file(text,text) from public,anon,authenticated;
grant execute on function makeborne_hosting.read_hosted_site_file(text,text) to anon,authenticated,service_role;
create function public.makeborne_read_hosted_site_file(p_slug text,p_path text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select makeborne_hosting.read_hosted_site_file(p_slug,p_path);
$$;
revoke all on function public.makeborne_read_hosted_site_file(text,text) from public;
grant execute on function public.makeborne_read_hosted_site_file(text,text) to anon,authenticated,service_role;
commit;
