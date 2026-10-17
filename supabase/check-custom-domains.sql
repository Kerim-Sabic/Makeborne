-- Custom domains: shape, hostname rules, limits, RLS/grants, Worker host resolution.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261014160000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; sites uuid[] := '{}'; i integer; j integer; h text; d uuid; n integer;
  invalid text[] := array[
    'Shop.example.com','example','shop.example.com.','1.2.3.4','10.0.0.1','a..example.com','.example.com',
    '-a.example.com','a-.example.com','a.-example.com','exa mple.com','_dmarc.example.com','shop.example.123',
    'makeborne.com','www.makeborne.com','makeborne.site','good-dog.makeborne.site','localhost','shop.localhost',
    repeat('a',64)||'.example.com', repeat('abcdefghi.',25)||'example.com', ''];
  valid text[] := array['shop.example.com','example.co.uk','notmakeborne.com','makeborne.site.example.org','xn--bcher-kva.example','a.b','shop.example.test'];
begin
  -- Shape.
  assert (select relrowsecurity from pg_class where oid = 'public.custom_domains'::regclass), 'RLS disabled';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'custom_domains')
    = array['id','workspace_id','artifact_id','hostname','status','cloudflare_id','verification','ssl_status','error','created_by','created_at','updated_at','last_checked_at'], 'Unexpected columns';
  assert (select count(*) from pg_constraint where conrelid = 'public.custom_domains'::regclass and contype = 'f' and confdeltype = 'c') = 2, 'Foreign keys must cascade';
  assert (select count(*) from pg_constraint where conrelid = 'public.custom_domains'::regclass and contype = 'u') = 1, 'hostname must be unique';
  assert (select prosecdef and provolatile = 's' and proconfig = array['search_path=""'] from pg_proc where oid = coalesce(to_regprocedure('makeborne_rpc.makeborne_resolve_site_host(text)'), 'public.makeborne_resolve_site_host(text)'::regprocedure)), 'Resolver must be stable security definer with empty search_path';
  assert to_regprocedure('makeborne_rpc.makeborne_resolve_site_host(text)') is null or (select not prosecdef from pg_proc where oid = 'public.makeborne_resolve_site_host(text)'::regprocedure), 'Public makeborne_resolve_site_host must be a security-invoker wrapper';
  raise notice 'PASS custom domains: columns, cascades, unique hostname, resolver definition';

  -- Fixtures: owner workspace with 11 sites, plus another account's workspace.
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@domains.example.invalid',now()),(other,other||'@domains.example.invalid',now());
  insert into public.workspaces(id,name,owner_id) values(w,'Domains fixture',u),(w2,'Other fixture',other);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  for i in 1..11 loop
    d := gen_random_uuid(); sites := sites || d;
    insert into public.artifacts(id,workspace_id,project_id,title,kind) values(d,w,p,'Fixture '||i,'website');
    insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values(gen_random_uuid(),w,d,1,'{}','{}',u,now());
    insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id)
      values(d,w,u,'domain-site-'||i,1,'<!doctype html><html><body>fixture</body></html>',true,gen_random_uuid());
  end loop;
  a := sites[1]; b := sites[2];

  -- Hostname rules.
  foreach h in array invalid loop
    begin
      insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,h,u);
      raise exception 'Invalid hostname accepted: %', h;
    exception when check_violation then null;
    end;
  end loop;
  for i in 1..cardinality(valid) loop
    insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,case when i = 1 then b else sites[2 + i] end,valid[i],u);
  end loop;
  delete from public.custom_domains where hostname <> 'shop.example.com';
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,'shop.example.com',u); raise exception 'Duplicate hostname accepted';
  exception when unique_violation then null; end;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,status,created_by) values(w,a,'status.example.com','verified',u); raise exception 'Unknown status accepted';
  exception when check_violation then null; end;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,error,created_by) values(w,a,'error.example.com',repeat('x',501),u); raise exception 'Long error accepted';
  exception when check_violation then null; end;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,verification,created_by) values(w,a,'object.example.com','{}',u); raise exception 'Non-array verification accepted';
  exception when check_violation then null; end;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w2,a,'mismatch.example.com',other); raise exception 'Workspace mismatch accepted';
  exception when check_violation then null; end;
  assert (select status = 'pending' and verification = '[]'::jsonb from public.custom_domains where hostname = 'shop.example.com'), 'Unexpected defaults';
  raise notice 'PASS custom domains: % invalid hostnames refused, % valid accepted, unique, status/error/verification/workspace checks', cardinality(invalid), cardinality(valid);

  -- Limits: 5 per site, 50 per workspace, also on moves between sites.
  for i in 1..4 loop insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,b,'site'||i||'.example.com',u); end loop;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,b,'sixth.example.com',u); raise exception 'Per-site limit ignored';
  exception when sqlstate 'MB429' then null; end;
  insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,'moved.example.com',u);
  begin update public.custom_domains set artifact_id = b where hostname = 'moved.example.com'; raise exception 'Per-site limit ignored on move';
  exception when sqlstate 'MB429' then null; end;
  update public.custom_domains set status = 'active' where hostname = 'site1.example.com';
  delete from public.custom_domains where hostname = 'moved.example.com';
  -- Sites 3..11 take 45 more domains (b already has 5): 50 total.
  for i in 3..11 loop for j in 1..5 loop
    insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,sites[i],'w'||i||'-'||j||'.example.net',u);
  end loop; end loop;
  assert (select count(*) from public.custom_domains where workspace_id = w) = 50, 'Fixture count';
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,'fifty-one.example.com',u); raise exception 'Workspace limit ignored';
  exception when sqlstate 'MB429' then null; end;
  raise notice 'PASS custom domains: 5 per site and 50 per workspace enforced with MB429 (insert and move)';

  -- updated_at is maintained by the trigger.
  update public.custom_domains set updated_at = now() - interval '1 day' where hostname = 'site2.example.com';
  assert (select updated_at = now() from public.custom_domains where hostname = 'site2.example.com'), 'updated_at not maintained';

  -- Resolver: active + live only.
  delete from public.custom_domains where workspace_id = w and hostname like 'w%.example.net';
  update public.custom_domains set status = 'active' where hostname in ('shop.example.com','site3.example.com');
  update public.custom_domains set status = 'failed' where hostname = 'site4.example.com';
  assert public.makeborne_resolve_site_host('shop.example.com') = 'domain-site-2', 'Active live host not resolved';
  assert public.makeborne_resolve_site_host('SHOP.Example.COM') = 'domain-site-2', 'Resolver must lowercase';
  assert public.makeborne_resolve_site_host('site2.example.com') is null, 'Pending host resolved';
  assert public.makeborne_resolve_site_host('site4.example.com') is null, 'Failed host resolved';
  assert public.makeborne_resolve_site_host('unknown.example.com') is null, 'Unknown host resolved';
  assert public.makeborne_resolve_site_host('shop.example.com.') is null, 'Trailing-dot alias resolved';
  assert public.makeborne_resolve_site_host(null) is null, 'Null resolved';
  assert public.makeborne_resolve_site_host(repeat('a',300)) is null, 'Oversized input resolved';
  assert public.makeborne_resolve_site_host('domain-site-2.makeborne.site') is null, 'Platform host resolved';
  update public.hosted_sites set live = false where artifact_id = b;
  assert public.makeborne_resolve_site_host('shop.example.com') is null, 'Offline site resolved';
  update public.hosted_sites set live = true where artifact_id = b;
  raise notice 'PASS custom domains: resolver returns the slug only for active hostnames of live sites';

  -- Grants: the Worker's publishable (anon) role can only call the resolver.
  assert not has_function_privilege('public','public.makeborne_resolve_site_host(text)','execute'), 'PUBLIC can execute resolver';
  assert has_function_privilege('anon','public.makeborne_resolve_site_host(text)','execute'), 'anon cannot execute resolver';
  assert not has_function_privilege('anon','makeborne_hosting.custom_domain_guard()','execute'), 'anon can execute guard';
  assert not has_function_privilege('authenticated','makeborne_hosting.custom_domain_guard()','execute'), 'authenticated can execute guard';
  for h in select unnest(array['select','insert','update','delete','truncate','references','trigger']) loop
    assert not has_table_privilege('anon','public.custom_domains',h), 'anon has '||h;
    assert has_table_privilege('authenticated','public.custom_domains',h) = (h = 'select'), 'authenticated privilege '||h;
  end loop;
  set local role anon;
  assert public.makeborne_resolve_site_host('shop.example.com') = 'domain-site-2', 'anon resolver call failed';
  begin perform 1 from public.custom_domains; raise exception 'anon read custom domains';
  exception when insufficient_privilege then null; end;
  reset role;

  -- RLS: owner reads own rows; another account sees none; browser roles cannot write.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.custom_domains;
  assert n = 5, 'Owner cannot read own domains ('||n||')';
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,'forged.example.com',u); raise exception 'Browser inserted a domain';
  exception when insufficient_privilege then null; end;
  begin update public.custom_domains set status = 'active'; raise exception 'Browser activated a domain';
  exception when insufficient_privilege then null; end;
  begin delete from public.custom_domains; raise exception 'Browser deleted a domain';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',other,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.custom_domains) = 0, 'Another account read the domains';
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  -- The server (service_role) writes, through the same guard.
  set local role service_role;
  insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,a,'server.example.com',u);
  update public.custom_domains set status = 'active', ssl_status = 'active', verification = '[{"type":"TXT","name":"_cf-custom-hostname.server.example.com","value":"x"}]' where hostname = 'server.example.com';
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,b,'over.example.com',u); raise exception 'service_role bypassed per-site limit';
  exception when sqlstate 'MB429' then null; end;
  reset role;
  assert public.makeborne_resolve_site_host('server.example.com') = 'domain-site-1', 'Server-activated host not resolved';
  raise notice 'PASS custom domains: owner-only reads, browser roles cannot write, service_role writes through limits';

  -- Removing the site removes its domains.
  delete from public.hosted_sites where artifact_id = a;
  assert not exists(select 1 from public.custom_domains where artifact_id = a), 'Domains survived site removal';
  assert public.makeborne_resolve_site_host('server.example.com') is null, 'Removed site resolved';
  raise notice 'PASS custom domains: cascade on site removal';
end $$;
select 'PASS: custom domains' as result;
rollback;
