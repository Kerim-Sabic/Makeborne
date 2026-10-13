-- "Made with Makeborne" badge on published websites: shown by default, and the
-- workspace owner can turn it off in Settings. Hosting already requires a paid
-- plan or an administrator grant (owner_can_host), so every site that is served
-- belongs to an owner allowed to remove it.
begin;
alter table public.workspaces add column if not exists site_badge boolean not null default true;
-- Owners only: the existing workspace_change policy limits updates to the owner.
grant update(site_badge) on public.workspaces to authenticated;

-- Enforce the same paid/admin serving eligibility for direct Data API writes.
-- Re-enabling the badge remains available after a subscription ends.
create or replace function makeborne_private.guard_site_badge() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not new.site_badge and (tg_op='INSERT' or old.site_badge is distinct from new.site_badge)
    and not makeborne_hosting.owner_can_host(new.owner_id) then
    raise exception 'Paid hosting access required to remove the badge' using errcode='MB402';
  end if;
  return new;
end $$;
revoke all on function makeborne_private.guard_site_badge() from public,anon,authenticated,service_role;
drop trigger if exists workspace_site_badge_guard on public.workspaces;
create trigger workspace_site_badge_guard before insert or update of site_badge on public.workspaces
for each row execute function makeborne_private.guard_site_badge();

create or replace function makeborne_hosting.read_hosted_site_v2(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('html',coalesce(s.isolated_html,s.html),'interactive',s.interactive and s.entry_script is not null and s.isolated_html is not null,
    'script',case when s.isolated_html is not null then s.entry_script end,'revision',s.revision,'branding',w.site_badge)
  from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
  where s.slug=p_slug and s.live and makeborne_hosting.owner_can_host(s.owner_id);
$$;

commit;
