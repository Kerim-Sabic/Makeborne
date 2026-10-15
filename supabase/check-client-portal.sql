-- Client portal (Phase 1, review mode): exposure, invites, isolation, content
-- boundary, conflicts, revocation, re-checked grants, rate limits, audit rows
-- and cascades. One rolled-back transaction; commits nothing.
-- Needs migrations through 20261016090000; works with or without public.brand_kits.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); e uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  cu uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); su uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  s_u uuid := gen_random_uuid(); s_e uuid := gen_random_uuid(); s_r uuid := gen_random_uuid(); s_cu uuid := gen_random_uuid();
  s_ou uuid := gen_random_uuid(); s_su uuid := gen_random_uuid(); s_o2 uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid();
  cl1 uuid := gen_random_uuid(); cl2 uuid := gen_random_uuid(); cl3 uuid := gen_random_uuid(); cl4 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); a4 uuid := gen_random_uuid();
  ast uuid := gen_random_uuid();
  ex timestamptz := clock_timestamp() + interval '30 minutes';
  svc constant text := '{"role":"service_role"}';
  style constant jsonb := '{"id":"editorial","name":"Editorial","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{"ink":"#111111"},"description":"","referenceAssetIds":[]}';
  manifest constant text := '{"version":1,"collections":{"menu":{"label":"Menu","kind":"list","fields":{"name":{"type":"text","required":true},"price":{"type":"price"}}},"hours":{"label":"Opening hours","kind":"single","fields":{"note":{"type":"text"}}},"team":{"label":"Team","kind":"list","fields":{"name":{"type":"text"}}}}}';
  menu1 constant text := E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Margherita",\n      "price": "9.50"\n    }\n  ]\n}\n';
  menu2 constant text := E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Margherita",\n      "price": "10.50"\n    },\n    {\n      "id": "m2",\n      "name": "Marinara",\n      "price": "8.00"\n    }\n  ]\n}\n';
  hours1 constant text := E'{\n  "note": "Closed Mondays"\n}\n';
  hours2 constant text := E'{\n  "note": "Open every day"\n}\n';
  app constant text := 'export default function App(){return null}';
  files jsonb; content jsonb; t1 text; t2 text; t3 text; t4 text; t5 text; t6 text; x jsonb; y jsonb; n integer;
  acc1 uuid; acc2 uuid; acc_late uuid; acc_x uuid; ch uuid; ch2 uuid; k uuid; v_name text; v_brand text; v2files jsonb;
begin
  -- ---------------------------------------------------------------- shape and exposure
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.client_portal_access'::regclass,'public.client_portal_sites'::regclass,'public.client_portal_changes'::regclass)), 'RLS disabled';
  assert not has_column_privilege('authenticated','public.client_portal_access','token_hash','select'), 'authenticated can select token hashes';
  assert has_column_privilege('authenticated','public.client_portal_access','email','select'), 'members cannot read grants';
  foreach v_name in array array['select','insert','update','delete'] loop
    assert not has_table_privilege('anon','public.client_portal_access',v_name), 'anon has '||v_name;
    assert not has_table_privilege('anon','public.client_portal_changes',v_name), 'anon has '||v_name||' on changes';
    assert v_name = 'select' or not has_table_privilege('authenticated','public.client_portal_access',v_name), 'authenticated can '||v_name||' grants';
    assert v_name = 'select' or not has_table_privilege('authenticated','public.client_portal_changes',v_name), 'authenticated can '||v_name||' changes';
    assert v_name = 'select' or not has_table_privilege('authenticated','public.client_portal_sites',v_name), 'authenticated can '||v_name||' sites';
    assert not has_table_privilege('service_role','public.client_portal_access',v_name), 'service_role has direct table access';
  end loop;
  foreach v_name in array array['makeborne_portal_home(uuid,uuid,timestamptz)','makeborne_portal_read_site(uuid,uuid,timestamptz,uuid)',
      'makeborne_portal_save_draft(uuid,uuid,timestamptz,uuid,integer,jsonb,text,uuid)','makeborne_portal_change_action(uuid,uuid,timestamptz,uuid,uuid,text)',
      'makeborne_portal_image(uuid,uuid,timestamptz,uuid,uuid)','makeborne_accept_portal_invite(text,uuid,uuid,timestamptz)',
      'makeborne_create_portal_invite(uuid,uuid,timestamptz,uuid,uuid,text,text,bytea,integer)','makeborne_resend_portal_invite(uuid,uuid,timestamptz,uuid,uuid,bytea,integer)',
      'makeborne_revoke_portal_access(uuid,uuid,timestamptz,uuid,uuid)'] loop
    assert has_function_privilege('service_role','public.'||v_name,'execute'), 'service_role cannot execute '||v_name;
    assert not has_function_privilege('authenticated','public.'||v_name,'execute'), 'authenticated can execute '||v_name;
    assert not has_function_privilege('anon','public.'||v_name,'execute'), 'anon can execute '||v_name;
  end loop;
  assert has_function_privilege('anon','public.makeborne_read_portal_invite(text)','execute'), 'anon cannot read invites';
  foreach v_name in array array['makeborne_portal_client_overview(uuid,uuid)','makeborne_portal_site_settings(uuid,uuid)','makeborne_update_portal_access(uuid,uuid,text,date)',
      'makeborne_set_portal_site(uuid,uuid,boolean,text[])','makeborne_decide_portal_change(uuid,uuid,uuid,text,text,boolean,text)'] loop
    assert has_function_privilege('authenticated','public.'||v_name,'execute') and not has_function_privilege('anon','public.'||v_name,'execute'), 'agency grant '||v_name;
  end loop;
  assert not has_function_privilege('authenticated','makeborne_private.portal_grant(uuid,uuid,boolean)','execute')
    and not has_function_privilege('service_role','makeborne_private.portal_grant(uuid,uuid,boolean)','execute'), 'portal_grant exposed';
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'makeborne_private' and (p.proname like 'portal%' or p.proname like '%portal_invite' or p.proname = 'revoke_portal_access')
       or n.nspname = 'public' and p.proname like 'makeborne%portal%')
      and p.prosecdef and not coalesce(p.proconfig, '{}') @> array['search_path=""']), 'definers must pin search_path';
  raise notice 'PASS client portal: RLS on, token hashes unselectable, client and invite functions service-role only, agency functions authenticated only, definers pin search_path';

  -- ---------------------------------------------------------------- fixtures
  insert into auth.users(id,email,email_confirmed_at) values
    (u,'owner@portal.example.invalid',now()),(e,'editor@portal.example.invalid',now()),(r,'reviewer@portal.example.invalid',now()),
    (cu,'client@portal.example.invalid',now()),(ou,'other@portal.example.invalid',now()),(su,'stranger@portal.example.invalid',now()),
    (o2,'owner2@portal.example.invalid',now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values
    (s_u,u,now(),now()),(s_e,e,now(),now()),(s_r,r,now(),now()),(s_cu,cu,now(),now()),(s_ou,ou,now(),now()),(s_su,su,now(),now()),(s_o2,o2,now(),now());
  -- Owner, editor and reviewer have creation access (administrator allowance); o2 has none.
  insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(u,true,'portal fixture'),(e,true,'portal fixture'),(r,true,'portal fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Studio Fixture',u),(w2,'Lapsed Fixture',o2);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,e,'editor'),(w,r,'reviewer');
  insert into public.clients(id,workspace_id,name) values(cl1,w,'Saffron Table'),(cl2,w,'Other Bistro'),(cl3,w,'No Projects Ltd'),(cl4,w2,'Lapsed Client');
  insert into public.projects(id,workspace_id,client_id,title,kind) values(p1,w,cl1,'Saffron','website'),(p2,w,cl2,'Other','website'),(p3,w,null,'Unlinked','website'),(p4,w2,cl4,'Lapsed','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a1,w,p1,'Saffron site','website'),(a2,w,p2,'Other site','website'),(a3,w,p3,'Unlinked site','website'),(a4,w2,p4,'Lapsed site','website');
  insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values(ast,w,p1,w||'/'||p1||'/artwork/'||ast||'.webp','image/webp',repeat('a',64));
  files := jsonb_build_array(
    jsonb_build_object('path','index.html','content','<!doctype html><div id="root"></div>'),
    jsonb_build_object('path','package-lock.json','content','{}'), jsonb_build_object('path','package.json','content','{}'),
    jsonb_build_object('path','src/App.tsx','content',app), jsonb_build_object('path','src/content/collections.json','content',manifest),
    jsonb_build_object('path','src/content/hours.json','content',hours1), jsonb_build_object('path','src/content/menu.json','content',menu1),
    jsonb_build_object('path','src/content/team.json','content',E'{\n  "items": []\n}\n'), jsonb_build_object('path','src/main.tsx','content','import "./App";'));
  content := jsonb_build_object('schemaVersion',1,'kind','website','title','Saffron site','sections','[]'::jsonb,'websiteSource',jsonb_build_object(
    'schemaVersion',1,'toolchainId','react-vite-v1','entrypoint','src/main.tsx','files',files,
    'assets',jsonb_build_array(jsonb_build_object('id',ast,'path','public/images/dish.webp','sha256',repeat('a',64),'bytes',1000,'mediaType','image/webp')),
    'routes',jsonb_build_array(jsonb_build_object('path','/','title','Home'),jsonb_build_object('path','/menu','title','Menu'))));
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by)
    values(w,a1,1,content,style,jsonb_build_array(ast),u);
  -- a2 (other client) starts without content files; a3 has no client; a4 belongs to w2.
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(w,a2,1,jsonb_build_object('schemaVersion',1,'kind','website','title','Other site','sections','[]'::jsonb,'websiteSource',jsonb_build_object(
      'schemaVersion',1,'toolchainId','react-vite-v1','entrypoint','src/main.tsx','assets','[]'::jsonb,'routes',jsonb_build_array(jsonb_build_object('path','/','title','Home')),
      'files',jsonb_build_array(jsonb_build_object('path','index.html','content','x'),jsonb_build_object('path','package.json','content','{}'),
        jsonb_build_object('path','package-lock.json','content','{}'),jsonb_build_object('path','src/main.tsx','content','x')))),style,u),
    (w,a3,1,jsonb_set(content,'{websiteSource,assets}','[]'::jsonb),style,u),
    (w2,a4,1,jsonb_set(content,'{websiteSource,assets}','[]'::jsonb),style,o2);
  update public.artifacts set current_version = 1 where id in (a1,a2,a3,a4);
  insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id)
    values(a1,w,u,'saffron-portal-fixture',1,'<!doctype html><html><body>fixture</body></html>',true,gen_random_uuid());
  if to_regclass('public.brand_kits') is not null then
    execute 'insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values($1,null,$2,$3)'
      using w, '{"name":"Northwind Studio","colors":{"primary":"#aa3300","background":"#fafafa"},"logo":"data:image/svg+xml;base64,PHN2Zz4="}'::jsonb, u;
    v_brand := 'Northwind Studio';
  else v_brand := 'Studio Fixture'; end if;
  t1 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  t2 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  t3 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  t4 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  t5 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  t6 := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  assert length(t1) = 43, 'token fixture';

  -- ---------------------------------------------------------------- invites (service role, trusted actor)
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'client@portal.example.invalid','Ana <b>',sha256(convert_to(t1,'UTF8')),14); raise exception 'Angle brackets accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'not-an-email','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Bad email accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),15); raise exception '15-day invite accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'client@portal.example.invalid','','\x00'::bytea,14); raise exception 'Short hash accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_create_portal_invite(r,s_r,ex,w,cl1,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Reviewer invited';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_create_portal_invite(su,s_su,ex,w,cl1,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Stranger invited';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_cu,ex,w,cl1,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Foreign session accepted';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_e,clock_timestamp()+interval '2 hours',w,cl1,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Unbounded session expiry accepted';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl4,'client@portal.example.invalid','',sha256(convert_to(t1,'UTF8')),14); raise exception 'Other workspace client invited';
  exception when sqlstate 'P0002' then null; end;
  x := public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,' Client@Portal.Example.Invalid ','Ana',sha256(convert_to(t1,'UTF8')),14);
  acc1 := (x->>'id')::uuid;
  assert x->>'status' = 'invited' and x->>'email' = 'client@portal.example.invalid' and x->>'displayName' = 'Ana'
    and not (x::text like '%'||encode(sha256(convert_to(t1,'UTF8')),'hex')||'%') and not (x ? 'tokenHash'), 'invite shape '||x::text;
  begin perform public.makeborne_create_portal_invite(u,s_u,ex,w,cl1,'client@portal.example.invalid','',sha256(convert_to(t2,'UTF8')),7); raise exception 'Duplicate live grant accepted';
  exception when sqlstate 'PP409' then null; end;
  acc2 := (public.makeborne_create_portal_invite(e,s_e,ex,w,cl2,'other@portal.example.invalid','Otto',sha256(convert_to(t2,'UTF8')),14)->>'id')::uuid;
  acc_late := (public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'late@portal.example.invalid','',sha256(convert_to(t3,'UTF8')),1)->>'id')::uuid;
  reset role;
  assert (select invite_expires_at - invited_at from public.client_portal_access where id = acc1) = interval '14 days', 'invite lifetime';
  set local role anon;
  x := public.makeborne_read_portal_invite(t1);
  assert x->>'status' = 'open' and x->>'maskedEmail' = 'c***@portal.example.invalid' and x->'client'->>'name' = 'Saffron Table'
    and x->'agency'->>'name' = v_brand and not (x::text like '%client@%'), 'anonymous invite read '||x::text;
  if v_brand = 'Northwind Studio' then
    assert x->'agency'->'colors' = '{"primary":"#aa3300","background":"#fafafa","text":"#1a1a1a"}'::jsonb and x->'agency'->'logo' = 'null'::jsonb, 'brand kit display fields '||x::text;
  end if;
  assert public.makeborne_read_portal_invite('short') is null and public.makeborne_read_portal_invite(t5) is null, 'unknown token resolved';
  begin perform 1 from public.client_portal_access; raise exception 'anon read grants'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_accept_portal_invite(t1,ou,s_ou,ex); raise exception 'Email mismatch accepted';
  exception when sqlstate 'PP403' then null; end;
  begin perform public.makeborne_accept_portal_invite(t1,cu,s_ou,ex); raise exception 'Foreign session accepted';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_accept_portal_invite('bad-token',cu,s_cu,ex); raise exception 'Malformed token accepted';
  exception when sqlstate 'PP404' then null; end;
  x := public.makeborne_accept_portal_invite(t1,cu,s_cu,ex);
  assert (x->>'accessId')::uuid = acc1 and x->>'replayed' = 'false', 'accept '||x::text;
  assert public.makeborne_accept_portal_invite(t1,cu,s_cu,ex)->>'replayed' = 'true', 'accept replay';
  begin perform public.makeborne_accept_portal_invite(t1,ou,s_ou,ex); raise exception 'Used invite accepted by another account';
  exception when sqlstate 'PP409' then null; end;
  perform public.makeborne_accept_portal_invite(t2,ou,s_ou,ex);
  assert public.makeborne_read_portal_invite(t1)->>'status' = 'accepted', 'accepted status';
  reset role;
  update public.client_portal_access set invited_at = now() - interval '3 days', invite_expires_at = now() - interval '1 day' where id = acc_late;
  set local role service_role;
  begin perform public.makeborne_accept_portal_invite(t3,su,s_su,ex); raise exception 'Expired invite accepted';
  exception when sqlstate 'PP410' then null; end;
  assert public.makeborne_read_portal_invite(t3)->>'status' = 'expired', 'expired status';
  x := public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'late@portal.example.invalid','',sha256(convert_to(t4,'UTF8')),3);
  assert (x->>'id')::uuid <> acc_late and public.makeborne_read_portal_invite(t3)->>'status' = 'revoked', 'expired invite not replaced';
  y := public.makeborne_resend_portal_invite(e,s_e,ex,w,(x->>'id')::uuid,sha256(convert_to(t5,'UTF8')),5);
  assert public.makeborne_read_portal_invite(t4) is null and public.makeborne_read_portal_invite(t5)->>'status' = 'open' and y->>'status' = 'invited', 'resend did not rotate';
  begin perform public.makeborne_resend_portal_invite(e,s_e,ex,w,acc1,sha256(convert_to('x'||t1,'UTF8')),5); raise exception 'Resent an accepted invite';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_resend_portal_invite(r,s_r,ex,w,(x->>'id')::uuid,sha256(convert_to('y'||t1,'UTF8')),5); raise exception 'Reviewer resent';
  exception when sqlstate '42501' then null; end;
  reset role;
  assert not exists(select 1 from public.workspace_members where user_id in (cu,ou)), 'portal users became members';
  assert (select user_id = cu and accepted_at is not null from public.client_portal_access where id = acc1), 'grant not bound to the account';
  raise notice 'PASS client portal: invites (bad name/email/lifetime/hash, reviewer, stranger, foreign or unbounded session refused; duplicate refused), anonymous read (masked email, agency brand), strict email match, single use, expiry, re-invite after expiry, resend rotates the token, no workspace membership';

  -- ---------------------------------------------------------------- agency site settings (authenticated)
  perform set_config('request.jwt.claims', jsonb_build_object('sub',r,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_set_portal_site(w,a1,true,null); raise exception 'Reviewer managed the portal';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_portal_client_overview(w,cl1); raise exception 'Reviewer read the portal overview';
  exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_set_portal_site(w,a3,true,null); raise exception 'Site without a client enabled';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_portal_site(w,a2,true,null); raise exception 'Site without content enabled';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_portal_site(w,a1,true,array['nope']); raise exception 'Undeclared collection allowed';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_portal_site(w,a4,true,null); raise exception 'Other workspace site managed';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_set_portal_site(w2,a4,true,null); raise exception 'Non-member managed a workspace';
  exception when sqlstate '42501' then null; end;
  x := public.makeborne_set_portal_site(w,a1,true,array['menu','menu','hours','team']);
  assert x->'collections' = '["hours","menu","team"]'::jsonb, 'collections not deduplicated '||x::text;
  x := public.makeborne_set_portal_site(w,a1,true,null);
  assert x->>'enabled' = 'true' and x->'collections' = 'null'::jsonb and (x->>'clientId')::uuid = cl1 and x->>'manifest' = manifest
    and x->'pending' = '[]'::jsonb and x->'images' = '["/images/dish.webp"]'::jsonb and x->'routes' = '["/","/menu"]'::jsonb, 'site settings '||x::text;
  x := public.makeborne_portal_client_overview(w,cl1);
  assert jsonb_array_length(x->'access') = 3 and jsonb_array_length(x->'sites') = 1 and x->'sites'->0->>'hasContent' = 'true'
    and x->'sites'->0->>'enabled' = 'true' and (x->'sites'->0->>'pending')::int = 0 and not (x::text like '%token%'), 'overview '||x::text;
  reset role;
  raise notice 'PASS client portal: site settings (reviewer refused; no client, no content, undeclared collection, other workspace refused), client overview without token data';

  -- ---------------------------------------------------------------- portal reads (service role, trusted actor)
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  x := public.makeborne_portal_home(cu,s_cu,ex);
  assert x->>'email' = 'client@portal.example.invalid' and jsonb_array_length(x->'grants') = 1 and x->'grants'->0->>'accessId' = acc1::text
    and x->'grants'->0->'client'->>'name' = 'Saffron Table' and x->'grants'->0->'agency'->>'name' = v_brand
    and jsonb_array_length(x->'grants'->0->'sites') = 1 and x->'grants'->0->'sites'->0->>'artifactId' = a1::text
    and x->'grants'->0->'sites'->0->>'slug' = 'saffron-portal-fixture' and x->'grants'->0->'sites'->0->'change' = 'null'::jsonb, 'home '||x::text;
  assert jsonb_array_length(public.makeborne_portal_home(su,s_su,ex)->'grants') = 0, 'stranger has grants';
  y := public.makeborne_portal_read_site(cu,s_cu,ex,a1);
  assert (y->>'baseVersion')::int = 1 and y->>'manifest' = manifest and jsonb_array_length(y->'collections') = 3
    and (select c->>'sha256' from jsonb_array_elements(y->'collections') c where c->>'key' = 'menu') = encode(sha256(convert_to(menu1,'UTF8')),'hex')
    and (select c->>'text' = menu1 and c->>'path' = 'src/content/menu.json' from jsonb_array_elements(y->'collections') c where c->>'key' = 'menu')
    and y->'images' = jsonb_build_array(jsonb_build_object('path','/images/dish.webp','assetId',ast::text))
    and y->'routes' = '["/","/menu"]'::jsonb and y->'change' = 'null'::jsonb and y->'site'->>'slug' = 'saffron-portal-fixture', 'read site '||y::text;
  assert not (y::text like '%App.tsx%') and not (y::text like '%export default%') and not (y::text like '%sha256": "aaaa%'), 'source or asset hashes leaked to the portal';
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a2); raise exception 'Other client''s site read';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_read_site(ou,s_ou,ex,a1); raise exception 'Other client read this site';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_read_site(su,s_su,ex,a1); raise exception 'Stranger read the site';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_read_site(cu,s_su,ex,a1); raise exception 'Foreign session read the site';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_portal_home(cu,s_cu,clock_timestamp() - interval '1 second'); raise exception 'Expired session bound accepted';
  exception when sqlstate '42501' then null; end;
  x := public.makeborne_portal_image(cu,s_cu,ex,a1,ast);
  assert x->>'objectPath' = w||'/'||p1||'/artwork/'||ast||'.webp' and x->>'contentType' = 'image/webp', 'image '||x::text;
  begin perform public.makeborne_portal_image(cu,s_cu,ex,a1,gen_random_uuid()); raise exception 'Unknown image served';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_image(ou,s_ou,ex,a1,ast); raise exception 'Image served to another client';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  raise notice 'PASS client portal: home and site read (allowed collections with sha256, images, routes; no source), other client, stranger and foreign session refused, images only from the site''s current version';

  -- ---------------------------------------------------------------- isolation (portal user as a browser)
  perform set_config('request.jwt.claims', jsonb_build_object('sub',cu,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.clients) + (select count(*) from public.projects) + (select count(*) from public.artifacts)
    + (select count(*) from public.artifact_versions) + (select count(*) from public.audit_events) + (select count(*) from public.assets)
    + (select count(*) from public.workspaces) + (select count(*) from public.workspace_members) + (select count(*) from public.hosted_sites)
    + (select count(*) from public.client_portal_access) + (select count(*) from public.client_portal_sites) + (select count(*) from public.client_portal_changes) = 0,
    'portal user read tenant or portal rows';
  begin
    insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a1,2,content,style,cu);
    raise exception 'Portal user inserted a version';
  exception when insufficient_privilege or sqlstate 'MB402' then null; end;
  begin perform public.makeborne_portal_client_overview(w,cl1); raise exception 'Portal user read the overview'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_portal_site_settings(w,a1); raise exception 'Portal user read site settings'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_set_portal_site(w,a1,true,null); raise exception 'Portal user managed the site'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_update_portal_access(w,acc1,'Gold',null); raise exception 'Portal user changed their plan'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_decide_portal_change(w,a1,gen_random_uuid(),'approve','',false,''); raise exception 'Portal user approved'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_portal_home(cu,s_cu,ex); raise exception 'Browser called a service bridge'; exception when insufficient_privilege then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,'{}'::jsonb,'',gen_random_uuid()); raise exception 'Browser saved a draft'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_portal_access) = 4, 'editor cannot read grants';
  begin perform token_hash from public.client_portal_access limit 1; raise exception 'Token hash readable';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',o2,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_portal_access) = 0 and (select count(*) from public.client_portal_sites) = 0, 'other workspace read grants';
  reset role;
  raise notice 'PASS client portal: isolation (portal user reads 0 rows from 12 tenant and portal tables, cannot insert versions or call agency or service functions; members never read token hashes; other workspaces see nothing)';

  -- ---------------------------------------------------------------- content boundary and draft lifecycle
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  foreach v_name in array array['src/App.tsx','src/content/collections.json','src/content/undeclared.json','src/content/Menu.json',
      'src/content/../App.tsx','index.html','src/content/menu.ts','src/content/sub/menu.json','src/content/__proto__.json'] loop
    begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object(v_name,'{}'),'',gen_random_uuid()); raise exception 'Path accepted: %', v_name;
    exception when sqlstate 'PP422' then null; end;
  end loop;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a2,1,jsonb_build_object('src/content/menu.json','{}'),'',gen_random_uuid()); raise exception 'Other client''s site saved';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json','{bad'),'',gen_random_uuid()); raise exception 'Invalid JSON saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,'{"src/content/menu.json":5}'::jsonb,'',gen_random_uuid()); raise exception 'Non-text file saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,(select jsonb_object_agg('src/content/c'||i||'.json','{}') from generate_series(1,31) i),'',gen_random_uuid()); raise exception '31 files saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,'{}'::jsonb,'',gen_random_uuid()); raise exception 'Empty draft saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,2,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid()); raise exception 'Future base accepted';
  exception when sqlstate 'PT409' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_set_portal_site(w,a1,true,array['menu','hours']);
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/team.json','{"items":[]}'),'',gen_random_uuid()); raise exception 'Disallowed collection saved';
  exception when sqlstate 'PP422' then null; end;
  assert jsonb_array_length(public.makeborne_portal_read_site(cu,s_cu,ex,a1)->'collections') = 2, 'disallowed collection readable';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_set_portal_site(w,a1,true,null);
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  k := gen_random_uuid();
  x := public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'Spring prices',k);
  ch := (x->>'id')::uuid;
  assert x->>'status' = 'draft' and (x->>'baseVersion')::int = 1 and x->'files'->>'src/content/menu.json' = menu2 and x->>'summary' = 'Spring prices', 'draft '||x::text;
  assert (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'Spring prices',k)->>'id')::uuid = ch, 'replay created another draft';
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/hours.json',hours2),'',k); raise exception 'Request key reused for other content';
  exception when sqlstate 'MB409' then null; end;
  assert (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid())->>'id')::uuid = ch, 'second save opened another draft';
  reset role;
  assert (select current_version from public.artifacts where id = a1) = 1 and (select count(*) from public.artifact_versions where artifact_id = a1) = 1, 'a draft created a version';
  assert (select base_hashes->>'src/content/menu.json' from public.client_portal_changes where id = ch) = encode(sha256(convert_to(menu1,'UTF8')),'hex'), 'base hash';
  set local role service_role;
  begin perform public.makeborne_portal_change_action(ou,s_ou,ex,a1,ch,'submit'); raise exception 'Another account submitted the change';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'publish'); raise exception 'Unknown action accepted';
  exception when sqlstate '22023' then null; end;
  x := public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit');
  assert x->>'status' = 'pending' and x->>'submittedAt' is not null, 'submit '||x::text;
  assert public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit')->>'status' = 'pending', 'submit replay';
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid()); raise exception 'Pending change edited';
  exception when sqlstate 'PT409' then null; end;
  assert public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'withdraw')->>'status' = 'withdrawn', 'withdraw';
  begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit'); raise exception 'Withdrawn change submitted';
  exception when sqlstate 'PT409' then null; end;
  ch2 := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu1),'',gen_random_uuid())->>'id')::uuid;
  assert ch2 <> ch, 'withdrawn change reopened';
  begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch2,'submit'); raise exception 'Change without differences submitted';
  exception when sqlstate '22023' then null; end;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch2,'withdraw');
  reset role;
  raise notice 'PASS client portal: content boundary (src/App.tsx, collections.json, undeclared, mis-cased, traversal, nested, non-JSON, __proto__ paths refused; other client''s site, invalid JSON, non-text, 31 files, empty, future base refused; disallowed collections refused), drafts never create versions, idempotent saves, submit and withdraw lifecycle';

  -- ---------------------------------------------------------------- conflicts and approval
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  ch := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid())->>'id')::uuid;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit');
  reset role;
  -- Meanwhile the agency edits the menu (normal version authority, as the editor): version 2.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  select v.content into content from public.artifact_versions v where v.artifact_id = a1 and v.version_number = 1;
  content := jsonb_set(content,'{websiteSource,files}',(select jsonb_agg(case when f->>'path' = 'src/content/menu.json'
    then jsonb_set(f,'{content}',to_jsonb(replace(menu1,'9.50','9.75'))) else f end order by i) from jsonb_array_elements(content->'websiteSource'->'files') with ordinality t(f,i)));
  perform makeborne_private.save_artifact_version(w,a1,1,content,style,jsonb_build_array(ast),'Agency price update');
  select v.content->'websiteSource'->'files' into v2files from public.artifact_versions v where v.artifact_id = a1 and v.version_number = 2;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',r,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_decide_portal_change(w,a1,ch,'approve','',false,''); raise exception 'Reviewer approved a change';
  exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  x := public.makeborne_portal_site_settings(w,a1);
  assert jsonb_array_length(x->'pending') = 1 and x->'pending'->0->>'id' = ch::text and x->'pending'->0->>'authorName' = 'Ana'
    and x->'pending'->0->>'authorEmail' = 'client@portal.example.invalid' and x->'pending'->0->'currentFiles'->>'src/content/menu.json' = replace(menu1,'9.50','9.75'), 'pending '||x::text;
  begin perform public.makeborne_decide_portal_change(w,a1,ch,'approve','',false,'Client edit by Ana: Menu (1 changed, 1 added)'); raise exception 'Conflict ignored';
  exception when sqlstate 'PT409' then null; end;
  x := public.makeborne_decide_portal_change(w,a1,ch,'approve','Looks good',true,'Client edit by Ana: Menu (1 changed, 1 added)');
  assert x->>'status' = 'approved' and (x->>'resultVersion')::int = 3 and x->>'decisionNote' = 'Looks good' and x->>'decidedAt' is not null, 'approve '||x::text;
  assert (public.makeborne_decide_portal_change(w,a1,ch,'approve','',false,'')->>'resultVersion')::int = 3, 'approve replay';
  begin perform public.makeborne_decide_portal_change(w,a1,ch,'reject','',false,''); raise exception 'Decided change rejected';
  exception when sqlstate 'PT409' then null; end;
  reset role;
  select v.content into y from public.artifact_versions v where v.artifact_id = a1 and v.version_number = 3;
  assert makeborne_private.portal_file(y,'src/content/menu.json') = menu2 and makeborne_private.portal_file(y,'src/App.tsx') = app
    and makeborne_private.portal_file(y,'src/content/collections.json') = manifest and jsonb_array_length(y->'websiteSource'->'files') = 9
    and y->'websiteSource'->'assets' = content->'websiteSource'->'assets' and y->'websiteSource'->'routes' = content->'websiteSource'->'routes', 'approved version content';
  assert (select jsonb_agg(f order by f->>'path') from jsonb_array_elements(y->'websiteSource'->'files') f where f->>'path' <> 'src/content/menu.json')
    = (select jsonb_agg(f order by f->>'path') from jsonb_array_elements(v2files) f where f->>'path' <> 'src/content/menu.json'), 'files other than the change were modified';
  assert (select created_by = e and change_summary = 'Client edit by Ana: Menu (1 changed, 1 added)' from public.artifact_versions where artifact_id = a1 and version_number = 3)
    and (select current_version from public.artifacts where id = a1) = 3, 'approved version authorship';
  -- Non-conflicting: the client edits hours (base 3) while the agency edits the menu (version 4).
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  ch2 := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,3,jsonb_build_object('src/content/hours.json',hours2),'',gen_random_uuid())->>'id')::uuid;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch2,'submit');
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  content := jsonb_set(y,'{websiteSource,files}',(select jsonb_agg(case when f->>'path' = 'src/content/menu.json'
    then jsonb_set(f,'{content}',to_jsonb(replace(menu2,'8.00','8.25'))) else f end order by i) from jsonb_array_elements(y->'websiteSource'->'files') with ordinality t(f,i)));
  perform makeborne_private.save_artifact_version(w,a1,3,content,style,jsonb_build_array(ast),'Agency tweak');
  set local role authenticated;
  x := public.makeborne_decide_portal_change(w,a1,ch2,'approve','',false,'');
  assert (x->>'resultVersion')::int = 5, 'non-conflicting approval '||x::text;
  reset role;
  select v.content into y from public.artifact_versions v where v.artifact_id = a1 and v.version_number = 5;
  assert makeborne_private.portal_file(y,'src/content/menu.json') = replace(menu2,'8.00','8.25') and makeborne_private.portal_file(y,'src/content/hours.json') = hours2
    and (select change_summary from public.artifact_versions where artifact_id = a1 and version_number = 5) = 'Client edit by Ana', 'merged version';
  -- Reject keeps the version; a stale base is refused at save; the client sees the decision.
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  ch := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,5,jsonb_build_object('src/content/menu.json',menu1),'',gen_random_uuid())->>'id')::uuid;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit');
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  x := public.makeborne_decide_portal_change(w,a1,ch,'reject','Please keep the new prices',false,'');
  assert x->>'status' = 'rejected' and x->>'decisionNote' = 'Please keep the new prices' and x->'resultVersion' = 'null'::jsonb, 'reject '||x::text;
  reset role;
  assert (select current_version from public.artifacts where id = a1) = 5, 'reject created a version';
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,1,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid()); raise exception 'Stale base saved';
  exception when sqlstate 'PT409' then null; end;
  y := public.makeborne_portal_read_site(cu,s_cu,ex,a1);
  assert y->'change'->>'status' = 'rejected' and y->'change'->>'decisionNote' = 'Please keep the new prices' and (y->>'baseVersion')::int = 5, 'decision not visible '||y::text;
  -- Leave one pending change for the revocation step.
  ch := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,5,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid())->>'id')::uuid;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit');
  reset role;
  raise notice 'PASS client portal: approval refused when the agency changed a file after the client''s base (unless overwrite), approve splices only the changed collection files into a new version by the approving editor (other files byte-identical), non-conflicting edits merge, reviewer refused, reject keeps the version, stale bases refused at save, decision visible to the client';

  -- ---------------------------------------------------------------- grants re-checked on every call; revocation
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  x := public.makeborne_update_portal_access(w,acc1,'Care plan',((now() at time zone 'utc')::date - 1));
  assert x->>'planLabel' = 'Care plan' and x->>'paidThrough' = to_char((now() at time zone 'utc')::date - 1,'YYYY-MM-DD'), 'plan update '||x::text;
  begin perform public.makeborne_update_portal_access(w,acc1,'<b>Gold</b>',null); raise exception 'Plan label with tags accepted';
  exception when sqlstate '22023' then null; end;
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a1); raise exception 'Unpaid grant read the site';
  exception when sqlstate 'P0002' then null; end;
  assert jsonb_array_length(public.makeborne_portal_home(cu,s_cu,ex)->'grants') = 0, 'unpaid grant listed';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_update_portal_access(w,acc1,'Care plan',(now() at time zone 'utc')::date);
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  perform public.makeborne_portal_read_site(cu,s_cu,ex,a1);
  reset role;
  update public.projects set client_id = cl2 where id = p1;
  set local role service_role;
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a1); raise exception 'Reassigned project still readable';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'withdraw'); raise exception 'Reassigned project still writable';
  exception when sqlstate 'P0002' then null; end;
  perform public.makeborne_portal_read_site(ou,s_ou,ex,a1);
  reset role;
  update public.projects set client_id = cl1 where id = p1;
  update public.client_portal_sites set enabled = false where artifact_id = a1;
  set local role service_role;
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a1); raise exception 'Disabled site readable';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  update public.client_portal_sites set enabled = true where artifact_id = a1;
  update makeborne_private.account_privileges set is_admin = false where user_id = u;
  set local role service_role;
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a1); raise exception 'Site readable while the owner cannot host';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  update makeborne_private.account_privileges set is_admin = true where user_id = u;
  set local role service_role;
  begin perform public.makeborne_revoke_portal_access(r,s_r,ex,w,acc1); raise exception 'Reviewer revoked';
  exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_revoke_portal_access(su,s_su,ex,w,acc1); raise exception 'Stranger revoked';
  exception when sqlstate '42501' then null; end;
  x := public.makeborne_revoke_portal_access(e,s_e,ex,w,acc1);
  assert x->>'status' = 'revoked' and public.makeborne_revoke_portal_access(e,s_e,ex,w,acc1)->>'status' = 'revoked', 'revoke '||x::text;
  begin perform public.makeborne_portal_read_site(cu,s_cu,ex,a1); raise exception 'Revoked grant read the site';
  exception when sqlstate 'P0002' then null; end;
  assert jsonb_array_length(public.makeborne_portal_home(cu,s_cu,ex)->'grants') = 0, 'revoked grant listed';
  begin perform public.makeborne_accept_portal_invite(t1,cu,s_cu,ex); raise exception 'Revoked invite accepted';
  exception when sqlstate 'PP404' then null; end;
  assert public.makeborne_read_portal_invite(t1)->>'status' = 'revoked', 'revoked invite status';
  reset role;
  assert (select status from public.client_portal_changes where id = ch) = 'withdrawn', 'pending change survived revocation';
  -- An owner without a creation membership can still revoke (but not invite or edit plans).
  insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at)
    values(w2,cl4,'lapsed@portal.example.invalid',sha256(convert_to('lapsed'||t1,'UTF8')),now()+interval '1 day') returning id into acc_x;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',o2,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_update_portal_access(w2,acc_x,'Plan',null); raise exception 'Owner without membership edited a plan';
  exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_create_portal_invite(o2,s_o2,ex,w2,cl4,'new@portal.example.invalid','',sha256(convert_to('new'||t1,'UTF8')),3); raise exception 'Owner without membership invited';
  exception when sqlstate 'MB402' then null; end;
  begin perform public.makeborne_revoke_portal_access(e,s_e,ex,w2,acc_x); raise exception 'Editor of another workspace revoked';
  exception when sqlstate '42501' then null; end;
  assert public.makeborne_revoke_portal_access(o2,s_o2,ex,w2,acc_x)->>'status' = 'revoked', 'owner without membership could not revoke';
  reset role;
  raise notice 'PASS client portal: grants re-checked on every call (paid_through, project reassignment, site disabled, owner hosting), revocation (reviewer and stranger refused, idempotent, open changes withdrawn, invite unusable) works for an owner without a creation membership';

  -- ---------------------------------------------------------------- rate limits (each in a rolled-back sub-block)
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  acc1 := (public.makeborne_create_portal_invite(e,s_e,ex,w,cl1,'client@portal.example.invalid','Ana',sha256(convert_to(t6,'UTF8')),14)->>'id')::uuid;
  perform public.makeborne_accept_portal_invite(t6,cu,s_cu,ex);
  reset role;
  begin
    insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome) select w,cu,'portal.draft_saved',acc1,'succeeded' from generate_series(1,120);
    set local role service_role;
    begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a1,5,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid()); raise exception 'Draft limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    raise exception using errcode = 'PPTST';
  exception when sqlstate 'PPTST' then null; end;
  begin
    insert into public.client_portal_changes(workspace_id,access_id,artifact_id,status,base_version,files,base_hashes,submitted_at)
      select w,acc1,a1,'withdrawn',1,'{}','{}',now() from generate_series(1,30);
    set local role service_role;
    ch := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,5,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid())->>'id')::uuid;
    begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit'); raise exception 'Submission limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    raise exception using errcode = 'PPTST';
  exception when sqlstate 'PPTST' then null; end;
  begin
    insert into public.client_portal_changes(workspace_id,access_id,artifact_id,status,base_version,files,base_hashes,result_version,submitted_at,decided_at)
      select w,acc1,a1,'approved',1,'{}','{}',1,now(),now() from generate_series(1,20);
    set local role service_role;
    ch := (public.makeborne_portal_save_draft(cu,s_cu,ex,a1,5,jsonb_build_object('src/content/menu.json',menu2),'',gen_random_uuid())->>'id')::uuid;
    perform public.makeborne_portal_change_action(cu,s_cu,ex,a1,ch,'submit');
    reset role;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',e,'role','authenticated')::text, true);
    set local role authenticated;
    begin perform public.makeborne_decide_portal_change(w,a1,ch,'approve','',false,''); raise exception 'Version limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    perform set_config('request.jwt.claims', svc, true);
    raise exception using errcode = 'PPTST';
  exception when sqlstate 'PPTST' then null; end;
  begin
    insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome) select w,e,'portal.invite_created',gen_random_uuid(),'succeeded' from generate_series(1,30);
    set local role service_role;
    begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl2,'third@portal.example.invalid','',sha256(convert_to('third'||t1,'UTF8')),3); raise exception 'Invite limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    raise exception using errcode = 'PPTST';
  exception when sqlstate 'PPTST' then null; end;
  begin
    insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at)
      select w,cl3,'g'||i||'@portal.example.invalid',sha256(convert_to('g'||i||t1,'UTF8')),now()+interval '1 day' from generate_series(1,10) i;
    set local role service_role;
    begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl3,'eleventh@portal.example.invalid','',sha256(convert_to('eleventh'||t1,'UTF8')),3); raise exception 'Per-client grant limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at)
      select w,cl3,'h'||i||'@portal.example.invalid',sha256(convert_to('h'||i||t1,'UTF8')),now()+interval '1 day' from generate_series(1,90) i;
    set local role service_role;
    begin perform public.makeborne_create_portal_invite(e,s_e,ex,w,cl2,'hundred@portal.example.invalid','',sha256(convert_to('hundred'||t1,'UTF8')),3); raise exception 'Workspace grant limit ignored';
    exception when sqlstate 'MB429' then null; end;
    reset role;
    raise exception using errcode = 'PPTST';
  exception when sqlstate 'PPTST' then null; end;
  raise notice 'PASS client portal: rate limits refuse with MB429 (120 draft saves/hour/grant, 30 submissions/day/grant, 20 client versions/day/site, 30 invites/day/workspace, 10 grants/client, 100 grants/workspace)';

  -- ---------------------------------------------------------------- audit rows: names and counts only
  select count(distinct action) into n from public.audit_events where workspace_id in (w,w2) and action in ('portal.invite_created','portal.invite_resent',
    'portal.invite_accepted','portal.site_updated','portal.draft_saved','portal.change_submitted','portal.change_withdrawn','portal.change_approved',
    'portal.change_rejected','portal.access_updated','portal.access_revoked');
  assert n = 11, 'portal audit actions recorded: '||n;
  assert not exists(select 1 from public.audit_events where action like 'portal.%' and (actor_id is null or metadata::text like '%Margherita%'
    or metadata::text like '%@portal.example%' or metadata::text like '%Closed Mondays%' or metadata::text like '%Looks good%' or metadata::text like '%Please keep%')),
    'audit rows carry content, emails or notes';
  assert (select metadata->>'files' from public.audit_events where action = 'portal.change_approved' and workspace_id = w order by created_at limit 1) = '1', 'approval audit counts';
  raise notice 'PASS client portal: % portal audit actions recorded with actor, names and counts only (no content, emails or notes)', n;

  -- ---------------------------------------------------------------- cascades
  insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at)
    values(w,cl3,'cascade@portal.example.invalid',sha256(convert_to('cascade'||t1,'UTF8')),now()+interval '1 day') returning id into acc_x;
  insert into public.client_portal_changes(workspace_id,access_id,artifact_id,base_version,files,base_hashes) values(w,acc_x,a1,1,'{}','{}');
  delete from public.clients where id = cl3;
  assert not exists(select 1 from public.client_portal_access where id = acc_x) and not exists(select 1 from public.client_portal_changes where access_id = acc_x), 'client removal left grants';
  insert into public.client_portal_sites(artifact_id,workspace_id,enabled) values(a3,w,false);
  insert into public.client_portal_changes(workspace_id,access_id,artifact_id,base_version,files,base_hashes) values(w,acc1,a3,1,'{}','{}');
  delete from public.artifacts where id = a3;
  assert not exists(select 1 from public.client_portal_sites where artifact_id = a3) and not exists(select 1 from public.client_portal_changes where artifact_id = a3), 'artifact removal left portal rows';
  delete from public.workspaces where id = w2;
  assert not exists(select 1 from public.client_portal_access where workspace_id = w2), 'workspace removal left grants';
  raise notice 'PASS client portal: cascades (client, artifact and workspace removal remove grants, site settings and changes)';
end $$;
select 'PASS: client portal' as result;
rollback;
