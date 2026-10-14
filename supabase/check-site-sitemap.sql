-- Run inside a transaction that is rolled back (see docs/SITE_ANALYTICS.md for the pattern).
-- Expects 20261014180000_site_sitemap.sql to be applied in the same transaction.
do $$
declare v_owner uuid := gen_random_uuid(); v_ws uuid := gen_random_uuid(); v_project uuid := gen_random_uuid();
  v_live uuid := gen_random_uuid(); v_hidden uuid := gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at) values (v_owner, 'sitemap-check@example.invalid', now());
  insert into public.workspaces(id, owner_id, name) values (v_ws, v_owner, 'Sitemap check');
  -- Hosting eligibility, inside this rolled-back transaction only.
  insert into makeborne_private.account_privileges(user_id, is_admin, reason) values (v_owner, true, 'sitemap check fixture');
  insert into public.projects(id, workspace_id, title, kind) values (v_project, v_ws, 'Sitemap check', 'website');
  insert into public.artifacts(id, workspace_id, project_id, kind, title) values (v_live, v_ws, v_project, 'website', 'Live'), (v_hidden, v_ws, v_project, 'website', 'Hidden');
  insert into public.artifact_versions(id, workspace_id, artifact_id, version_number, content, style_snapshot, created_by, created_at)
    values (gen_random_uuid(), v_ws, v_live, 1, '{}', '{}', v_owner, now()), (gen_random_uuid(), v_ws, v_hidden, 1, '{}', '{}', v_owner, now());
  insert into public.hosted_sites(artifact_id, workspace_id, owner_id, slug, version_number, html, live, request_id)
    values (v_live, v_ws, v_owner, 'sitemap-live-check', 1, '<!doctype html><html></html>', true, gen_random_uuid()),
           (v_hidden, v_ws, v_owner, 'sitemap-hidden-check', 1, '<!doctype html><html></html>', false, gen_random_uuid());

  if not makeborne_hosting.owner_can_host(v_owner) then raise exception 'FAIL fixture owner should be able to host'; end if;
  result := public.makeborne_read_site_paths('sitemap-live-check');
  if result->'paths' <> '["/"]'::jsonb or result->>'updated_at' is null then raise exception 'FAIL legacy site lists only /: %', result; end if;
  insert into makeborne_hosting.site_routes(artifact_id, path, html, isolated_html) values (v_live, '/menu', 'x', 'x'), (v_live, '/', 'x', 'x'), (v_live, '/visit', 'x', 'x');
  result := public.makeborne_read_site_paths('sitemap-live-check');
  if result->'paths' <> '["/", "/menu", "/visit"]'::jsonb then raise exception 'FAIL routes listed in order: %', result; end if;
  if public.makeborne_read_site_paths('sitemap-hidden-check') is not null then raise exception 'FAIL offline site has no sitemap'; end if;
  if public.makeborne_read_site_paths('no-such-site') is not null then raise exception 'FAIL unknown site has no sitemap'; end if;
  if not has_function_privilege('anon', 'public.makeborne_read_site_paths(text)', 'execute') then raise exception 'FAIL the Worker (anon) can read paths'; end if;
  if has_table_privilege('anon', 'makeborne_hosting.site_routes', 'select') then raise exception 'FAIL page content stays private'; end if;
  delete from makeborne_private.account_privileges where user_id = v_owner;
  if public.makeborne_read_site_paths('sitemap-live-check') is not null then raise exception 'FAIL an owner who can no longer host gets no sitemap'; end if;
  raise notice 'PASS: site sitemap';
end $$;
