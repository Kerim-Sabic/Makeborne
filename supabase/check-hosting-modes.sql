-- Hosting modes: existing links, republishing, isolated copies, rollback and guards.
-- LOCAL DATABASE; one rolled-back transaction, commits nothing.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-hosting-modes.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); w uuid := gen_random_uuid(); p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  pad text := repeat(' ', 120);
  old_html text; portable text; isolated text; js text := 'console.log(1)'; files jsonb; s jsonb; r jsonb; req uuid; rev integer;
begin
  old_html := '<!doctype html><html><body><h1>Published by the previous app</h1></body></html>' || pad;
  portable := '<!doctype html><html><head><link rel="canonical" href="https://sites.makeborne.com/old-site"></head><body><img src="data:image/webp;base64,UklGRg=="></body></html>' || pad;
  isolated := '<!doctype html><html><head><link rel="canonical" href="https://old-site.example-sites.test/"><link rel="stylesheet" href="/_mb/app-1111111111111111.css"></head><body><img src="/images/hero.webp"></body></html>' || pad;
  files := jsonb_build_array(jsonb_build_object('path','/_mb/app-2222222222222222.js','content_type','text/javascript; charset=utf-8',
    'body',encode(convert_to(js,'UTF8'),'base64'),'sha256',encode(sha256(convert_to(js,'UTF8')),'hex')));
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@hosting.example.invalid',now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Transaction fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Hosting fixture',u);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website'),(a2,w,p,'New project','website');
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at)
  values(gen_random_uuid(),w,a,1,'{}','{}',u,now()),(gen_random_uuid(),w,a2,1,'{}','{}',u,now());
  update public.artifacts set current_version = 1 where id in (a, a2);

  -- 1. A site published by the previous app keeps its address and document.
  s := public.makeborne_save_hosted_site(u,w,a,1,'old-site',old_html,true,0,gen_random_uuid());
  assert public.makeborne_read_hosted_site('old-site') = old_html, 'Existing link not served';
  r := public.makeborne_read_hosted_site_v2('old-site');
  assert r->>'html' = old_html and not (r->>'interactive')::boolean and r->'script' = 'null'::jsonb, 'Isolated reader changed an existing site';
  raise notice 'PASS existing published link is served unchanged by both readers';

  -- 2. Republishing in the default (legacy) mode: same address, portable document, no script anywhere.
  rev := (s->>'revision')::int;
  s := public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,rev,gen_random_uuid(),false,null,'[]',null);
  assert s->>'slug' = 'old-site', 'Republishing changed the address';
  assert public.makeborne_read_hosted_site('old-site') = portable, 'Existing host does not serve the portable copy';
  r := public.makeborne_read_hosted_site_v2('old-site');
  assert r->>'html' = portable and not (r->>'interactive')::boolean and r->'script' = 'null'::jsonb, 'Legacy republish exposed a script';
  begin perform public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int,gen_random_uuid(),false,'/_mb/app-2222222222222222.js',files,null);
    raise exception 'A script was stored without an isolated copy';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int,gen_random_uuid(),true,null,'[]',null);
    raise exception 'JavaScript was enabled without an isolated copy';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_hosted_site_interactive(u,w,a,true,(s->>'revision')::int,gen_random_uuid());
    raise exception 'JavaScript was switched on for a legacy-hosted site';
  exception when others then null; end;
  assert not (select interactive from public.hosted_sites where artifact_id = a), 'Legacy site became interactive';
  raise notice 'PASS legacy republish: same address, portable document on the existing host, no script stored or enabled';

  -- 3. Isolated mode: the existing host keeps the portable copy; the isolated host gets its own copy and script.
  req := gen_random_uuid();
  s := public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int,req,true,'/_mb/app-2222222222222222.js',files,isolated);
  assert public.makeborne_read_hosted_site('old-site') = portable and position('<script' in public.makeborne_read_hosted_site('old-site')) = 0, 'Existing host served the isolated copy or a script';
  r := public.makeborne_read_hosted_site_v2('old-site');
  assert r->>'html' = isolated and (r->>'interactive')::boolean and r->>'script' = '/_mb/app-2222222222222222.js', 'Isolated host did not get its copy';
  assert (public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int - 1,req,true,'/_mb/app-2222222222222222.js',files,isolated)->>'revision')::int = (s->>'revision')::int, 'Replay not idempotent';
  begin perform public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int - 1,req,true,'/_mb/app-2222222222222222.js',files,isolated || ' ');
    raise exception 'Replay with a different isolated copy accepted';
  exception when sqlstate 'MB409' then null; end;
  raise notice 'PASS isolated publish: existing host keeps the portable copy; isolated host serves its copy and script; replays are exact';

  -- 4. Rollback to the default mode: republishing clears the isolated copy, the script and its files.
  update public.hosted_sites set needs_portable_republish = true where artifact_id = a;   -- as for a pre-portable interactive site
  s := public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,(s->>'revision')::int,gen_random_uuid(),false,null,'[]',null);
  assert (select row(isolated_html is null, interactive, entry_script is null)::text from public.hosted_sites where artifact_id = a) = '(t,f,t)', 'Rollback left isolated state';
  assert not exists(select 1 from public.hosted_site_files where artifact_id = a), 'Rollback left script files';
  assert not (select needs_portable_republish from public.hosted_sites where artifact_id = a), 'A portable publish did not clear the republish flag';
  r := public.makeborne_read_hosted_site_v2('old-site');
  assert r->>'html' = portable and not (r->>'interactive')::boolean and r->'script' = 'null'::jsonb, 'Isolated host still runs a script after rollback';
  assert public.makeborne_read_hosted_site('old-site') = portable, 'Existing link broken after rollback';
  raise notice 'PASS rollback: republishing in the default mode removes the isolated copy and script; both hosts serve the portable copy';

  -- 5. A new project publishes portable by default; taking it offline hides it from both readers.
  s := public.makeborne_save_hosted_site_v3(u,w,a2,1,'new-site',portable,true,0,gen_random_uuid(),false,null,'[]',null);
  assert public.makeborne_read_hosted_site('new-site') = portable, 'New project not served on the existing host';
  s := public.makeborne_save_hosted_site_v3(u,w,a2,1,'new-site','',false,(s->>'revision')::int,gen_random_uuid(),false,null,'[]',null);
  assert public.makeborne_read_hosted_site('new-site') is null and public.makeborne_read_hosted_site_v2('new-site') is null, 'Offline site still served';
  raise notice 'PASS new project publishes portable by default; offline hides it everywhere';

  -- 6. Privileges.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_save_hosted_site_v3(u,w,a,1,'old-site',portable,true,1,gen_random_uuid(),false,null,'[]',null); raise exception 'Browser published directly';
  exception when insufficient_privilege then null; end;
  begin update public.hosted_sites set isolated_html = null, interactive = true where artifact_id = a; raise exception 'Browser changed a hosted site';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  assert public.makeborne_read_hosted_site('old-site') = portable, 'Anonymous visitors cannot read the published site';
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  raise notice 'PASS privileges: only the service role publishes; visitors read only published documents';
end $$;
select 'PASS: hosting modes (existing links, republish, isolated copy, rollback, new projects, guards, privileges)' as result;
rollback;
