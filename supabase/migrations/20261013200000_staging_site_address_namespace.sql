-- Created with Supabase CLI, ordered after publication worker authority v55.
-- Default production reservation; staging opt-in is database-owner-only.
begin;

-- Freeze only address-bearing relations for the collision check and trigger
-- installation; a concurrent old writer cannot slip a QA allocation between.
lock table public.hosted_sites, makeborne_hosting.site_address_reservations,
 makeborne_private.publication_preparations in share row exclusive mode;

-- Do not silently take an address from any existing owner, including a retired
-- address or an already requested preparation. Resolve conflicts explicitly.
do $$ begin
 if exists(select 1 from public.hosted_sites where slug in ('release-check','release-check-renamed'))
  or exists(select 1 from makeborne_hosting.site_address_reservations where slug in ('release-check','release-check-renamed'))
  or exists(select 1 from makeborne_private.publication_preparations where slug in ('release-check','release-check-renamed')) then
  raise exception 'QA address namespace already occupied; migration refused without changing ownership' using errcode='MB409';
 end if;
end $$;

create table makeborne_private.site_address_namespace_policy (
 singleton boolean primary key default true check(singleton),
 mode text not null check(mode in ('production','staging')),
 qa_workspace_id uuid,
 check((mode='production' and qa_workspace_id is null) or (mode='staging' and qa_workspace_id is not null))
);
alter table makeborne_private.site_address_namespace_policy enable row level security;
revoke all on makeborne_private.site_address_namespace_policy from public,anon,authenticated,service_role,makeborne_publication_worker;
insert into makeborne_private.site_address_namespace_policy(singleton,mode) values(true,'production');

create function makeborne_private.check_site_address_namespace(p_slug text,p_workspace uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype;
begin
 -- The share lock keeps a concurrent owner configuration change from racing a
 -- checked publication write. No user-controlled GUC selects the namespace.
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then raise exception 'SITE_ADDRESS_NAMESPACE_POLICY_REQUIRED' using errcode='42501'; end if;
 if p_slug is null or p_workspace is null
  or (policy.mode='production' and p_slug in ('release-check','release-check-renamed'))
  or (policy.mode='staging' and (p_slug not in ('release-check','release-check-renamed') or p_workspace<>policy.qa_workspace_id)) then
  raise exception 'SITE_ADDRESS_NAMESPACE_DENIED' using errcode='42501';
 end if;
end $$;
revoke all on function makeborne_private.check_site_address_namespace(text,uuid) from public,anon,authenticated,service_role,makeborne_publication_worker;

create function makeborne_private.guard_site_address_namespace() returns trigger
language plpgsql security definer set search_path='' as $$
declare workspace uuid;
begin
 if TG_OP='UPDATE' and TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='hosted_sites' then
  -- Keep ordinary pre-existing staging sites administrable. Metadata changes
  -- and taking an unchanged bundle offline cannot allocate or publish a host.
  if (to_jsonb(new)-array['updated_at','enquiries_enabled','needs_portable_republish'])
    = (to_jsonb(old)-array['updated_at','enquiries_enabled','needs_portable_republish'])
   or ((new.live=false or (new.live=old.live and old.interactive and not new.interactive))
    and not (new.interactive and not old.interactive)
    and (to_jsonb(new)-array['live','interactive','revision','request_id','updated_at','enquiries_enabled','needs_portable_republish'])
    = (to_jsonb(old)-array['live','interactive','revision','request_id','updated_at','enquiries_enabled','needs_portable_republish'])) then return new; end if;
 end if;
 if TG_TABLE_SCHEMA='makeborne_hosting' and TG_TABLE_NAME='site_address_reservations' then
  select workspace_id into workspace from public.hosted_sites where artifact_id=new.artifact_id;
 else workspace:=new.workspace_id;
 end if;
 perform makeborne_private.check_site_address_namespace(new.slug,workspace);
 return new;
end $$;
revoke all on function makeborne_private.guard_site_address_namespace() from public,anon,authenticated,service_role,makeborne_publication_worker;

-- Guard every persisted publication/address claim, including old service RPCs,
-- trusted request/completion/promotion, raw saves and rename/alias reservations.
-- Existing rows and serving reads are not rewritten by this migration.
create trigger site_address_namespace_guard before insert or update on public.hosted_sites
 for each row execute function makeborne_private.guard_site_address_namespace();
create trigger site_address_namespace_guard before insert or update on makeborne_hosting.site_address_reservations
 for each row execute function makeborne_private.guard_site_address_namespace();
create trigger site_address_namespace_guard before insert or update on makeborne_private.publication_preparations
 for each row execute function makeborne_private.guard_site_address_namespace();

create function makeborne_private.validate_site_address_namespace_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'Namespace policy cannot be deleted' using errcode='42501'; end if;
 if new.mode is null or new.mode not in ('production','staging') or new.singleton is distinct from true
  or (new.mode='production' and new.qa_workspace_id is not null)
  or (new.mode='staging' and (new.qa_workspace_id is null or not exists(select 1 from public.workspaces where id=new.qa_workspace_id))) then
  raise exception 'Invalid namespace configuration or QA workspace' using errcode='22023';
 end if;
 if exists(select 1 from public.hosted_sites where slug in ('release-check','release-check-renamed')
    and (new.mode='production' or workspace_id<>new.qa_workspace_id))
  or exists(select 1 from makeborne_hosting.site_address_reservations r join public.hosted_sites s on s.artifact_id=r.artifact_id
    where r.slug in ('release-check','release-check-renamed') and (new.mode='production' or s.workspace_id<>new.qa_workspace_id))
  or exists(select 1 from makeborne_private.publication_preparations where slug in ('release-check','release-check-renamed')
    and (new.mode='production' or workspace_id<>new.qa_workspace_id)) then
  raise exception 'QA address namespace belongs to existing work; configuration refused' using errcode='MB409';
 end if;
 if new.mode='staging' and exists(select 1 from makeborne_private.publication_preparations
  where state in ('queued','running','ready') and (slug not in ('release-check','release-check-renamed') or workspace_id<>new.qa_workspace_id)) then
  raise exception 'Drain incompatible publication preparations before enabling staging namespace' using errcode='MB409';
 end if;
 return new;
end $$;
revoke all on function makeborne_private.validate_site_address_namespace_policy() from public,anon,authenticated,service_role,makeborne_publication_worker;
create trigger site_address_namespace_policy_guard before insert or update or delete on makeborne_private.site_address_namespace_policy
 for each row execute function makeborne_private.validate_site_address_namespace_policy();

-- No public bridge and no role grants. Invoker rights require the actual database
-- owner and its table privileges; service/worker identities cannot opt in.
create function makeborne_private.configure_site_address_namespace(p_mode text,p_workspace uuid default null) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype;
begin
 if current_user::regrole::oid is distinct from (select datdba from pg_database where datname=current_database()) then
  raise exception 'Database owner required' using errcode='42501';
 end if;
 update makeborne_private.site_address_namespace_policy set mode=p_mode,qa_workspace_id=p_workspace where singleton returning * into policy;
 if not found then raise exception 'Namespace policy unavailable' using errcode='P0002'; end if;
 return jsonb_build_object('mode',policy.mode,'qaWorkspaceId',policy.qa_workspace_id);
end $$;
revoke all on function makeborne_private.configure_site_address_namespace(text,uuid) from public,anon,authenticated,service_role,makeborne_publication_worker;
commit;
