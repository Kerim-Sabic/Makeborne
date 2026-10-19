\set ON_ERROR_STOP on
-- First-party error tracking and funnel analytics (20261019090000). Runs inside a rolled-back transaction.
begin;
do $$
declare
  admin uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); fp text := repeat('a', 64); r jsonb; k text; n integer;
  svc constant text := '{"role":"service_role"}';
  errors_before bigint; groups_before bigint;
begin
  -- ---------------------------------------------------------------- exposure
  foreach k in array array['makeborne_record_app_error(text,text,text,text,text,text)','makeborne_record_studio_visit(text,text,text)','makeborne_admin_health(uuid,integer)'] loop
    assert has_function_privilege('service_role','public.'||k,'execute'), 'service_role cannot run '||k;
    assert not has_function_privilege('anon','public.'||k,'execute') and not has_function_privilege('authenticated','public.'||k,'execute'), 'browser runs '||k;
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid = ('public.'||k)::regprocedure), 'search_path '||k;
  end loop;
  foreach k in array array['app_error_groups','app_error_days','telemetry_salts','studio_visits'] loop
    assert (select relnamespace = 'makeborne_private'::regnamespace from pg_class where relname = k), k||' must be private';
    assert not has_table_privilege('service_role','makeborne_private.'||k,'select') and not has_table_privilege('authenticated','makeborne_private.'||k,'select'), 'direct read of '||k;
  end loop;
  raise notice 'PASS observability: private tables, three service-role-only functions with pinned search_path';

  -- ---------------------------------------------------------------- errors
  select count(*), coalesce(sum(total), 0) into groups_before, errors_before from makeborne_private.app_error_groups;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  perform public.makeborne_record_app_error(fp, 'server', 'TypeError', 'Cannot read properties of undefined', '/api/build', 'abc1234');
  perform public.makeborne_record_app_error(fp, 'server', 'TypeError', 'Cannot read properties of undefined', '/api/build', 'abc1235');
  perform public.makeborne_record_app_error(repeat('b', 64), 'client', '', repeat('x', 900), repeat('/r', 300), repeat('v', 80));
  foreach k in array array['not-a-hash', repeat('g', 64), ''] loop
    begin perform public.makeborne_record_app_error(k, 'server', 'E', 'm', '/', ''); raise exception 'bad fingerprint % accepted', k; exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.makeborne_record_app_error(fp, 'browser', 'E', 'm', '/', ''); raise exception 'bad source accepted'; exception when sqlstate '22023' then null; end;
  reset role;
  assert (select total = 2 and last_release = 'abc1235' and kind = 'TypeError' from makeborne_private.app_error_groups where fingerprint = fp), 'grouped';
  assert (select count from makeborne_private.app_error_days where fingerprint = fp) = 2, 'daily count';
  assert (select kind = 'Error' and char_length(message) = 300 and char_length(route) = 200 and char_length(last_release) = 40 from makeborne_private.app_error_groups where fingerprint = repeat('b', 64)), 'fields capped';
  -- 300 new kinds a day, then one overflow group.
  insert into makeborne_private.app_error_groups(fingerprint, source, kind, message, route)
    select encode(extensions.digest('flood' || i, 'sha256'), 'hex'), 'client', 'E', 'm', '/' from generate_series(1, 300 - (select count(*)::int from makeborne_private.app_error_groups where first_seen >= (now() at time zone 'utc')::date)) i;
  set local role service_role;
  perform public.makeborne_record_app_error(repeat('c', 64), 'client', 'E', 'new kind past the cap', '/', '');
  perform public.makeborne_record_app_error(repeat('d', 64), 'client', 'E', 'another', '/', '');
  perform public.makeborne_record_app_error(fp, 'server', 'TypeError', 'still counted', '/api/build', '');
  reset role;
  assert not exists(select 1 from makeborne_private.app_error_groups where fingerprint in (repeat('c', 64), repeat('d', 64))), 'cap holds';
  assert (select total from makeborne_private.app_error_groups where kind = 'Overflow' and source = 'client') = 2, 'overflow counts';
  assert (select total from makeborne_private.app_error_groups where fingerprint = fp) = 3, 'known kinds still count past the cap';
  raise notice 'PASS observability: errors grouped by fingerprint with daily counts, fields capped, bad input refused, 300 new kinds a day then one overflow group';

  -- ---------------------------------------------------------------- visits
  set local role service_role;
  perform public.makeborne_record_studio_visit('home', '203.0.113.7', 'Mozilla/5.0 A');
  perform public.makeborne_record_studio_visit('home', '203.0.113.7', 'Mozilla/5.0 A');
  perform public.makeborne_record_studio_visit('home', '203.0.113.7', 'Mozilla/5.0 B');
  perform public.makeborne_record_studio_visit('studio', '203.0.113.7', 'Mozilla/5.0 A');
  begin perform public.makeborne_record_studio_visit('admin', '1.1.1.1', 'x'); raise exception 'unlisted page counted'; exception when sqlstate '22023' then null; end;
  reset role;
  assert (select count(*) from makeborne_private.studio_visits where day = (now() at time zone 'utc')::date and page = 'home') >= 2, 'one per visitor';
  assert not exists(select 1 from makeborne_private.studio_visits v where octet_length(v.visitor) <> 32), 'only hashes stored';
  insert into makeborne_private.telemetry_salts(day, salt) values((now() at time zone 'utc')::date - 5, extensions.gen_random_bytes(32)) on conflict do nothing;
  set local role service_role;
  perform public.makeborne_record_studio_visit('help', '198.51.100.1', 'x');
  reset role;
  assert not exists(select 1 from makeborne_private.telemetry_salts where day < (now() at time zone 'utc')::date - 1), 'old salts deleted';
  raise notice 'PASS observability: visits count once per visitor per page per day, only salted hashes stored, salts kept two days, unlisted pages refused';

  -- ---------------------------------------------------------------- admin health and funnel
  insert into auth.users(id, email, email_confirmed_at, created_at) values(admin, 'admin@obs.example.invalid', now(), now() - interval '400 days'),
    (u1, 'one@obs.example.invalid', now(), now() - interval '2 days'), (u2, 'two@obs.example.invalid', null, now() - interval '1 day');
  insert into makeborne_private.account_privileges(user_id, is_admin, reason) values(admin, true, 'observability fixture');
  insert into public.workspaces(id, name, owner_id) values(w, 'Obs', u1);
  insert into public.projects(id, workspace_id, title, kind) values(p, w, 'Site', 'website');
  insert into public.artifacts(id, workspace_id, project_id, title, kind) values(a, w, p, 'Site', 'website');
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_admin_health(u1, 7); raise exception 'non-admin read health'; exception when sqlstate '42501' then null; end;
  r := public.makeborne_admin_health(admin, 7);
  reset role;
  assert (r->'funnel'->>'signedUp')::int >= 2 and (r->'funnel'->>'createdProject')::int >= 1 and (r->'funnel'->>'confirmed')::int >= 1, 'funnel: '||(r->'funnel')::text;
  assert (r->'funnel'->>'createdProject')::int <= (r->'funnel'->>'signedUp')::int, 'funnel narrows';
  assert (r->'errors'->>'last24h')::int >= 5 and jsonb_array_length(r->'errors'->'top') >= 2, 'errors summary: '||(r->'errors')::text;
  assert (r->'visits'->>'home')::int >= 2, 'visits summary';
  assert r->>'days' = '7' and (public.makeborne_admin_health(admin, 900))->>'days' = '90', 'window bounded';
  raise notice 'PASS observability: admin-only health (errors by day and top kinds, visits, sign-up funnel from existing records), window bounded to 90 days';
end $$;
select 'PASS: app observability' as result;
rollback;
