-- Sites published by the interactive release before portable copies existed
-- (makeborne_save_hosted_site_v2 with a bundle) stored their isolated-domain
-- document in hosted_sites.html. Record it as their isolated copy so the
-- isolated host keeps serving them exactly as before. Their `html` is not
-- portable (it links /_mb/ and /images/ files), so the existing static host
-- needs one republish to get a self-contained copy; the release runbook lists
-- these sites (`needs_portable_republish`). Sites without a bundle are untouched.
-- Only the unreleased interactive app wrote such rows; the released static app
-- stored self-contained documents.
begin;

alter table public.hosted_sites add column needs_portable_republish boolean not null default false;

update public.hosted_sites s set isolated_html = s.html, needs_portable_republish = true
where s.isolated_html is null
  and (s.entry_script is not null or exists(select 1 from public.hosted_site_files f where f.artifact_id = s.artifact_id));

-- A publish through the portable path (save_site_v3) clears the flag.
create or replace function makeborne_hosting.save_site_v3(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
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
    -- This publish stored a portable copy.
    update public.hosted_sites set needs_portable_republish = false where artifact_id = p_artifact and request_id = p_request and needs_portable_republish;
  end if;
  return result;
end $$;

commit;
