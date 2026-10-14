-- Page list for a published site's sitemap.xml, read by the site Worker with
-- the publishable key. Same eligibility as makeborne_read_hosted_site_v3: a live
-- site whose owner can host. Sites published before per-route output serve "/".
begin;
create function makeborne_hosting.read_site_paths(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'paths', coalesce((select jsonb_agg(r.path order by r.path) from makeborne_hosting.site_routes r where r.artifact_id = s.artifact_id), '["/"]'::jsonb),
   'updated_at', s.updated_at)
 from public.hosted_sites s join public.workspaces w on w.id = s.workspace_id and w.owner_id = s.owner_id
 where s.slug = p_slug and s.live and makeborne_hosting.owner_can_host(s.owner_id);
$$;
create function public.makeborne_read_site_paths(p_slug text) returns jsonb
language sql stable security invoker set search_path='' as $$ select makeborne_hosting.read_site_paths(p_slug); $$;
revoke all on function makeborne_hosting.read_site_paths(text), public.makeborne_read_site_paths(text) from public, anon, authenticated, service_role;
grant execute on function makeborne_hosting.read_site_paths(text), public.makeborne_read_site_paths(text) to anon, authenticated, service_role;
comment on function public.makeborne_read_site_paths(text) is 'Paths of a live published site for its sitemap.xml (no page content). Null when the site is not live or its owner cannot host.';
commit;
