begin;
create schema makeborne_hosting;
revoke all on schema makeborne_hosting from public;
grant usage on schema makeborne_hosting to anon,authenticated,service_role;
create table public.hosted_sites (
  artifact_id uuid primary key,
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id),
  slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  version_number integer not null check(version_number>0),
  html text not null check(octet_length(html)<=4000000),
  live boolean not null default false,
  revision integer not null default 1,
  request_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade,
  foreign key(artifact_id,version_number) references public.artifact_versions(artifact_id,version_number)
);
create index hosted_sites_workspace on public.hosted_sites(workspace_id);
alter table public.hosted_sites enable row level security;
revoke all on public.hosted_sites from public,anon,authenticated;
grant select on public.hosted_sites to authenticated;
create policy hosted_site_tenant_read on public.hosted_sites for select to authenticated using(makeborne_private.can_read(workspace_id));
grant select,insert,update,delete on public.hosted_sites to service_role;

create function makeborne_hosting.save_site(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.workspaces%rowtype; a public.artifacts%rowtype; s public.hosted_sites%rowtype;
begin
  select * into w from public.workspaces where id=p_workspace for update;
  if not found or w.owner_id is distinct from p_actor then raise exception 'Owner required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verified account required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found or a.kind<>'website' then raise exception 'Website not found' using errcode='P0002'; end if;
  select * into s from public.hosted_sites where artifact_id=p_artifact for update;
  if p_request is null then raise exception 'Request key required' using errcode='22023'; end if;
  if s.request_id=p_request then
    if s.live is distinct from p_live or s.slug is distinct from p_slug or (p_live and (s.version_number is distinct from p_version or s.html is distinct from p_html)) then raise exception 'Request changed' using errcode='MB409'; end if;
    return to_jsonb(s)-'html'-'owner_id'-'request_id';
  end if;
  if coalesce(s.revision,0)<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
  if p_live then
    if not makeborne_private.has_account_privilege(p_actor,'admin') and not exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=p_actor and m.status in ('active','canceling') and m.verified_until>now() and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    ) then raise exception 'Creation membership required' using errcode='MB402'; end if;
    if a.current_version<>p_version or not exists(select 1 from public.artifact_versions where artifact_id=p_artifact and version_number=p_version and workspace_id=p_workspace) then raise exception 'Save latest website first' using errcode='PT409'; end if;
    if p_html is null or octet_length(p_html) not between 100 and 4000000 then raise exception 'Website exceeds size limit' using errcode='22023'; end if;
    if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' or p_slug=any(array['admin','api','auth','billing','login','studio','support','www','makeborne','robots-txt','sitemap-xml']) then raise exception 'Invalid address' using errcode='22023'; end if;
    if s.artifact_id is not null and s.slug<>p_slug then raise exception 'Address is reserved for this website' using errcode='22023'; end if;
    if not coalesce(s.live,false) and (select count(*) from public.hosted_sites where workspace_id=p_workspace and live)>=5 then raise exception 'Five live sites per workspace' using errcode='MB429'; end if;
    if s.artifact_id is null and (select count(*) from public.hosted_sites where workspace_id=p_workspace)>=20 then raise exception 'Reserved address limit reached' using errcode='MB429'; end if;
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id)
    values(p_artifact,p_workspace,p_actor,p_slug,p_version,p_html,true,1,p_request)
    on conflict(artifact_id) do update set version_number=excluded.version_number,html=excluded.html,live=true,revision=hosted_sites.revision+1,request_id=p_request,updated_at=now()
    returning * into s;
  else
    if s.artifact_id is null then raise exception 'Website not published' using errcode='P0002'; end if;
    update public.hosted_sites set live=false,revision=revision+1,request_id=p_request,updated_at=now() where artifact_id=p_artifact returning * into s;
  end if;
  return to_jsonb(s)-'html'-'owner_id'-'request_id';
end $$;
revoke all on function makeborne_hosting.save_site(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function makeborne_hosting.save_site(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid) to service_role;
create function public.makeborne_save_hosted_site(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_hosting.save_site(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request);
$$;
revoke all on function public.makeborne_save_hosted_site(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.makeborne_save_hosted_site(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid) to service_role;

-- Public readers receive only the deliberately published HTML projection. Tenant records remain private.
create function makeborne_hosting.read_hosted_site(p_slug text) returns text
language sql stable security definer set search_path='' as $$
  select s.html from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  where s.slug=p_slug and s.live
  and exists(select 1 from auth.users u where u.id=s.owner_id and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) and (
    makeborne_private.has_account_privilege(s.owner_id,'admin') or exists(
      select 1 from public.billing_memberships m join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=s.owner_id and m.status in ('active','canceling') and m.period_end>now()
      and exists(select 1 from makeborne_private.billing_settings where singleton and creation_enabled)
    )
  );
$$;
revoke all on function makeborne_hosting.read_hosted_site(text) from public,anon,authenticated;
grant execute on function makeborne_hosting.read_hosted_site(text) to anon,authenticated,service_role;
create function public.makeborne_read_hosted_site(p_slug text) returns text
language sql stable security invoker set search_path='' as $$
  select makeborne_hosting.read_hosted_site(p_slug);
$$;
revoke all on function public.makeborne_read_hosted_site(text) from public;
grant execute on function public.makeborne_read_hosted_site(text) to anon,authenticated,service_role;
commit;
