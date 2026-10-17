-- Forward repair for the 2026-10-17 staging security gate: nine SECURITY DEFINER
-- functions added by this release were defined in the API-exposed `public` schema
-- and executable by anon and/or authenticated (Supabase advisor
-- anon_/authenticated_security_definer_function_executable). Already-applied
-- migrations stay untouched.
--
-- Each function moves, unchanged (body, owner, settings and grants), into the
-- non-exposed schema makeborne_rpc. A thin `security invoker` wrapper with the
-- same name, arguments, defaults, result, volatility and grants takes its place
-- in `public`, so every caller (site Worker with the publishable key, app routes,
-- signed-in agency users) keeps working and auth.uid() / request claims are
-- unchanged. No grant is widened: roles reach the privileged core only through a
-- wrapper they could already execute.
begin;

create schema if not exists makeborne_rpc;
comment on schema makeborne_rpc is 'Privileged implementations behind public security-invoker wrappers. Not exposed through the API; each function keeps the exact grants of its public wrapper.';
revoke all on schema makeborne_rpc from public;
grant usage on schema makeborne_rpc to anon, authenticated, service_role;

do $$
declare
  f record; v_identity text; v_args text; v_result text; v_names text; v_volatility text; v_role text; v_moved integer := 0;
  v_targets constant text[] := array[
    'makeborne_resolve_site_host', 'makeborne_record_site_view', 'makeborne_record_client_review_view', 'makeborne_read_portal_invite',
    'makeborne_decide_portal_change', 'makeborne_portal_client_overview', 'makeborne_portal_site_settings', 'makeborne_set_portal_site',
    'makeborne_update_portal_access'];
begin
  for f in select p.oid, p.proname, p.provolatile, p.proargnames, obj_description(p.oid, 'pg_proc') as note
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname = any(v_targets) loop
    v_identity := pg_get_function_identity_arguments(f.oid);
    v_args := pg_get_function_arguments(f.oid);
    v_result := pg_get_function_result(f.oid);
    v_volatility := case f.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end;
    select string_agg(format('%I', x), ', ' order by ord) into v_names from unnest(f.proargnames) with ordinality a(x, ord);
    execute format('alter function public.%I(%s) set schema makeborne_rpc', f.proname, v_identity);
    execute format('create function public.%I(%s) returns %s language sql %s security invoker set search_path = '''' as $wrapper$ select makeborne_rpc.%I(%s) $wrapper$',
      f.proname, v_args, v_result, v_volatility, f.proname, coalesce(v_names, ''));
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', f.proname, v_identity);
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      -- The moved function keeps its oid and ACL; the wrapper gets exactly the same executors.
      if has_function_privilege(v_role, f.oid, 'execute') then
        execute format('grant execute on function public.%I(%s) to %I', f.proname, v_identity, v_role);
      end if;
    end loop;
    execute format('comment on function public.%I(%s) is %L', f.proname, v_identity,
      coalesce(f.note || ' ', '') || 'Security-invoker wrapper; the privileged implementation is makeborne_rpc.' || f.proname || '.');
    v_moved := v_moved + 1;
  end loop;
  if v_moved <> 9 then raise exception 'Expected to move 9 functions, moved %', v_moved; end if;
end $$;
commit;
