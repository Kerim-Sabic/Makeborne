-- Owners may republish under a new address; retired addresses remain reserved.
begin;
create table makeborne_hosting.site_address_reservations(
 slug text primary key, artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade
);
alter table makeborne_hosting.site_address_reservations enable row level security;
revoke all on makeborne_hosting.site_address_reservations from public,anon,authenticated,service_role;
insert into makeborne_hosting.site_address_reservations select slug,artifact_id from public.hosted_sites;
create function makeborne_hosting.reserve_site_address() returns trigger
language plpgsql security definer set search_path='' as $$
declare reserved uuid;
begin
 insert into makeborne_hosting.site_address_reservations(slug,artifact_id) values(new.slug,new.artifact_id) on conflict(slug) do nothing;
 select artifact_id into reserved from makeborne_hosting.site_address_reservations where slug=new.slug;
 if reserved is distinct from new.artifact_id then raise exception 'Address already reserved' using errcode='23505'; end if;
 return new;
end $$;
revoke all on function makeborne_hosting.reserve_site_address() from public,anon,authenticated,service_role;
-- AFTER INSERT avoids a foreign-key reference before the hosted row exists.
create trigger hosted_site_address_reservation after insert or update of slug on public.hosted_sites
for each row execute function makeborne_hosting.reserve_site_address();
create function makeborne_hosting.save_site_v4(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
 p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.workspaces%rowtype; a public.artifacts%rowtype; s public.hosted_sites%rowtype;
begin
 select * into w from public.workspaces where id=p_workspace for update;
 if not found or w.owner_id is distinct from p_actor then raise exception 'Owner required' using errcode='42501'; end if;
 select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
 if not found or a.kind<>'website' then raise exception 'Website not found' using errcode='P0002'; end if;
 select * into s from public.hosted_sites where artifact_id=p_artifact for update;
 if found and s.slug is distinct from p_slug then
  if not p_live then raise exception 'Republish to change address' using errcode='22023'; end if;
  if p_request is null or s.request_id=p_request then raise exception 'Request changed' using errcode='MB409'; end if;
  if s.revision<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
  -- All downstream validation runs in this same transaction. Any refusal
  -- restores the old address and leaves both documents and files untouched.
  update public.hosted_sites set slug=p_slug where artifact_id=p_artifact;
 end if;
 return makeborne_hosting.save_site_v3(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files,p_isolated_html);
end $$;
revoke all on function makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated;
grant execute on function makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) to service_role;
create function public.makeborne_save_hosted_site_v4(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
 p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_hosting.save_site_v4(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files,p_isolated_html);
$$;
revoke all on function public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) to service_role;
commit;
