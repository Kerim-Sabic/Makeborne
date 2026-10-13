-- Published websites always keep a portable copy.
--
-- hosted_sites.html is the portable, self-contained document: inline styles,
-- images embedded as data URLs, no scripts. The existing static host
-- (sites.makeborne.com, makeborne_read_hosted_site) serves it unchanged, so
-- existing links keep working and switching hosting modes back never breaks a
-- published site.
-- hosted_sites.isolated_html is the optional copy for the isolated site domain
-- (linked /_mb/ stylesheet and /images/ files, enhanced by the site's bundle).
-- It is written only when the app runs with an explicitly configured isolated
-- domain, and cleared by any publish without it. The isolated reader prefers it.
begin;

alter table public.hosted_sites add column isolated_html text
  check (isolated_html is null or (octet_length(isolated_html) between 100 and 4000000 and left(isolated_html, 15) = '<!doctype html>'));

create function makeborne_hosting.save_site_v3(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
  p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hosted_sites%rowtype; result jsonb;
begin
  -- Customer JavaScript requires the isolated copy; the portable copy never carries a script.
  if p_live and p_script is not null and p_isolated_html is null then raise exception 'A script needs the isolated-domain document' using errcode='22023'; end if;
  if p_live and p_interactive and p_isolated_html is null then raise exception 'JavaScript runs only on the isolated domain' using errcode='22023'; end if;
  select * into s from public.hosted_sites where artifact_id = p_artifact;
  if found and s.request_id = p_request and p_live and s.isolated_html is distinct from p_isolated_html then raise exception 'Request changed' using errcode='MB409'; end if;
  -- Existing rows get their isolated copy first, so the interactive guard sees it
  -- during the upsert below (all one transaction; any refusal undoes it).
  if found and p_live then update public.hosted_sites set isolated_html = p_isolated_html where artifact_id = p_artifact; end if;
  result := makeborne_hosting.save_site_v2(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files);
  if p_live then
    update public.hosted_sites set isolated_html = p_isolated_html where artifact_id = p_artifact and request_id = p_request and isolated_html is distinct from p_isolated_html;
  end if;
  return result;
end $$;
revoke all on function makeborne_hosting.save_site_v3(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated;
grant execute on function makeborne_hosting.save_site_v3(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) to service_role;
create function public.makeborne_save_hosted_site_v3(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
  p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_hosting.save_site_v3(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files,p_isolated_html);
$$;
revoke all on function public.makeborne_save_hosted_site_v3(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.makeborne_save_hosted_site_v3(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) to service_role;

-- The isolated host serves its own copy when one exists, otherwise the portable one.
create or replace function makeborne_hosting.read_hosted_site_v2(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('html',coalesce(s.isolated_html,s.html),'interactive',s.interactive and s.entry_script is not null and s.isolated_html is not null,
    'script',case when s.isolated_html is not null then s.entry_script end,'revision',s.revision)
  from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  where s.slug=p_slug and s.live and makeborne_hosting.owner_can_host(s.owner_id);
$$;

-- Turning JavaScript on needs a published isolated copy with its bundle.
create or replace function makeborne_hosting.set_site_interactive_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.interactive and not old.interactive and (new.isolated_html is null or new.entry_script is null) then
    raise exception 'JavaScript runs only on the isolated domain; publish there first' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function makeborne_hosting.set_site_interactive_guard() from public,anon,authenticated,service_role;
create trigger hosted_sites_interactive_guard before update of interactive on public.hosted_sites
  for each row execute function makeborne_hosting.set_site_interactive_guard();

commit;
