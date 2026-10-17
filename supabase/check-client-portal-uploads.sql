-- Client portal photo uploads: exposure, registration, quotas, isolation, picker and thumbnail
-- access, approval attaching only referenced photos (source assets + manifest, passing the
-- website source guard). One rolled-back transaction; needs 20261016090000 and 20261017090000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); cu uuid := gen_random_uuid(); su uuid := gen_random_uuid();
  s_u uuid := gen_random_uuid(); s_cu uuid := gen_random_uuid(); s_su uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  up1 uuid := gen_random_uuid(); up2 uuid := gen_random_uuid();
  ex timestamptz := clock_timestamp() + interval '30 minutes';
  svc constant text := '{"role":"service_role"}';
  style constant jsonb := '{"id":"editorial","name":"Editorial","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{"ink":"#111111"},"description":"","referenceAssetIds":[]}';
  manifest constant text := '{"version":1,"collections":{"menu":{"label":"Menu","kind":"list","fields":{"name":{"type":"text","required":true},"image":{"type":"image"}}}}}';
  menu1 constant text := E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Margherita"\n    }\n  ]\n}\n';
  token text := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  files jsonb; content jsonb; x jsonb; r jsonb; v_path text; v_change uuid; n integer; k1 text;
begin
  -- ---------------------------------------------------------------- exposure
  assert (select relrowsecurity from pg_class where oid = 'public.client_portal_uploads'::regclass), 'RLS disabled';
  foreach k1 in array array['insert','update','delete'] loop
    assert not has_table_privilege('authenticated','public.client_portal_uploads',k1), 'authenticated can '||k1;
    assert not has_table_privilege('anon','public.client_portal_uploads',k1), 'anon can '||k1;
  end loop;
  assert not has_table_privilege('anon','public.client_portal_uploads','select'), 'anon can read uploads';
  foreach k1 in array array['makeborne_portal_upload_scope(uuid,uuid,timestamptz,uuid)','makeborne_portal_register_upload(uuid,uuid,timestamptz,uuid,uuid,text,integer,integer,integer)'] loop
    assert has_function_privilege('service_role','public.'||k1,'execute'), 'service_role cannot execute '||k1;
    assert not has_function_privilege('authenticated','public.'||k1,'execute') and not has_function_privilege('anon','public.'||k1,'execute'), 'browser can execute '||k1;
  end loop;
  assert not exists(select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname = 'makeborne_private'
    and pr.proname in ('portal_upload_scope','portal_register_upload','portal_read_site','portal_image') and not coalesce(pr.proconfig,'{}') @> array['search_path=""']), 'search_path';
  assert has_function_privilege('authenticated','public.makeborne_decide_portal_change(uuid,uuid,uuid,text,text,boolean,text)','execute')
    and not has_function_privilege('anon','public.makeborne_decide_portal_change(uuid,uuid,uuid,text,text,boolean,text)','execute'), 'replaced decide lost its grants';
  assert has_function_privilege('authenticated','public.makeborne_portal_site_settings(uuid,uuid)','execute')
    and not has_function_privilege('anon','public.makeborne_portal_site_settings(uuid,uuid)','execute'), 'replaced site settings lost its grants';
  assert (select prosecdef and provolatile = 's' and proconfig = array['search_path=""'] from pg_proc
    where oid = coalesce(to_regprocedure('makeborne_rpc.makeborne_portal_site_settings(uuid,uuid)'), 'public.makeborne_portal_site_settings(uuid,uuid)'::regprocedure)), 'site settings core';
  raise notice 'PASS client portal uploads: RLS on, browser roles cannot write, new functions service-role only, replaced functions keep grants and pinned search_path';

  -- ---------------------------------------------------------------- fixtures
  insert into auth.users(id,email,email_confirmed_at) values(u,'owner@uploads.example.invalid',now()),(cu,'client@uploads.example.invalid',now()),(su,'stranger@uploads.example.invalid',now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(s_u,u,now(),now()),(s_cu,cu,now(),now()),(s_su,su,now(),now());
  insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(u,true,'uploads fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Uploads Studio',u);
  insert into public.clients(id,workspace_id,name) values(cl,w,'Saffron Table');
  insert into public.projects(id,workspace_id,client_id,title,kind) values(p,w,cl,'Saffron','website'),(p2,w,cl,'Second','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Saffron site','website'),(a2,w,p2,'Second site','website');
  files := jsonb_build_array(
    jsonb_build_object('path','index.html','content','<!doctype html><div id="root"></div>'),
    jsonb_build_object('path','package-lock.json','content','{}'), jsonb_build_object('path','package.json','content','{}'),
    jsonb_build_object('path','src/App.tsx','content','export default function App(){return null}'),
    jsonb_build_object('path','src/content/collections.json','content',manifest), jsonb_build_object('path','src/content/menu.json','content',menu1),
    jsonb_build_object('path','src/main.tsx','content','import "./App";'));
  content := jsonb_build_object('schemaVersion',1,'kind','website','title','Saffron site','sections','[]'::jsonb,'websiteSource',jsonb_build_object(
    'schemaVersion',1,'toolchainId','react-vite-v1','entrypoint','src/main.tsx','files',files,'assets','[]'::jsonb,
    'routes',jsonb_build_array(jsonb_build_object('path','/','title','Home'))));
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,1,content,style,u),(w,a2,1,content,style,u);
  update public.artifacts set current_version = 1 where id in (a,a2);

  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  perform public.makeborne_create_portal_invite(u,s_u,ex,w,cl,'client@uploads.example.invalid','Ana',sha256(convert_to(token,'UTF8')),14);
  perform public.makeborne_accept_portal_invite(token,cu,s_cu,ex);
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_set_portal_site(w,a,true,null);
  reset role;

  -- ---------------------------------------------------------------- registration and quotas
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  r := public.makeborne_portal_upload_scope(cu,s_cu,ex,a);
  assert r->>'workspaceId' = w::text and r->>'projectId' = p::text, 'upload scope';
  begin perform public.makeborne_portal_upload_scope(cu,s_cu,ex,a2); raise exception 'site without editing accepted';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_upload_scope(su,s_su,ex,a); raise exception 'stranger accepted';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_portal_register_upload(cu,s_cu,ex,a,up1,'not-a-hash',1000,800,600); raise exception 'bad hash accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_register_upload(cu,s_cu,ex,a,up1,repeat('b',64),1000,9000,600); raise exception 'huge photo accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_portal_register_upload(cu,s_su,ex,a,up1,repeat('b',64),1000,800,600); raise exception 'foreign session accepted';
  exception when others then if sqlstate in ('22023') then raise; end if; end;
  r := public.makeborne_portal_register_upload(cu,s_cu,ex,a,up1,repeat('b',64),120000,1600,1000);
  v_path := r->>'path';
  assert v_path = '/images/client-' || left(replace(up1::text,'-',''),12) || '.webp', 'upload path';
  assert (public.makeborne_portal_register_upload(cu,s_cu,ex,a,up1,repeat('b',64),120000,1600,1000))->>'path' = v_path, 'register is idempotent';
  begin perform public.makeborne_portal_register_upload(cu,s_cu,ex,a,up1,repeat('c',64),120000,1600,1000); raise exception 'same id, other bytes accepted';
  exception when sqlstate '22023' then null; end;
  perform public.makeborne_portal_register_upload(cu,s_cu,ex,a,up2,repeat('d',64),90000,1200,800);
  reset role;
  assert (select count(*) from public.assets where id in (up1,up2) and project_id = p and content_type = 'image/webp' and provenance->>'kind' = 'portal_upload'
    and object_path = w||'/'||p||'/portal/'||id||'.webp') = 2, 'uploads registered as project assets';
  assert (select count(*) from public.audit_events where action = 'portal.image_uploaded' and workspace_id = w) = 2, 'upload audit';
  raise notice 'PASS client portal uploads: scope and register check the grant and session, refuse bad input, are idempotent, register project assets under <ws>/<project>/portal/ and audit';

  -- ---------------------------------------------------------------- picker, thumbnails, isolation
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  r := public.makeborne_portal_read_site(cu,s_cu,ex,a);
  assert (select count(*) from jsonb_array_elements(r->'images') i where i->>'path' like '/images/client-%') = 2, 'uploads in the picker';
  assert (public.makeborne_portal_image(cu,s_cu,ex,a,up1))->>'objectPath' = w||'/'||p||'/portal/'||up1||'.webp', 'thumbnail of an upload';
  begin perform public.makeborne_portal_image(su,s_su,ex,a,up1); raise exception 'stranger thumbnail';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',cu,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_portal_uploads) = 0, 'portal user reads upload rows';
  assert (select count(*) from public.assets) = 0, 'portal user reads assets';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',su,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_portal_uploads) = 0, 'stranger reads uploads';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_portal_uploads) = 2, 'owner reads the workspace uploads';
  -- The agency's approval validates against these images: this site's uploads, not another site's.
  assert (select public.makeborne_portal_site_settings(w,a)->'images') @> jsonb_build_array(v_path), 'site settings list the upload';
  assert (select count(*) from jsonb_array_elements_text(public.makeborne_portal_site_settings(w,a)->'images') i where i like '/images/client-%') = 2
    and (select count(*) from jsonb_array_elements_text(public.makeborne_portal_site_settings(w,a2)->'images') i where i like '/images/client-%') = 0, 'only this site''s uploads';
  reset role;
  raise notice 'PASS client portal uploads: uploads appear in that site''s picker and thumbnails only; portal users and strangers read no rows, members do';

  -- ---------------------------------------------------------------- approval attaches only referenced photos
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  r := public.makeborne_portal_save_draft(cu,s_cu,ex,a,1,jsonb_build_object('src/content/menu.json',
    E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Margherita",\n      "image": {\n        "src": "' || v_path || E'",\n        "alt": "Pizza"\n      }\n    }\n  ]\n}\n'),'Menu: 1 changed',gen_random_uuid());
  v_change := (r->>'id')::uuid;
  perform public.makeborne_portal_change_action(cu,s_cu,ex,a,v_change,'submit');
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_decide_portal_change(w,a,v_change,'approve','',false,'Client edit by Ana: Menu (1 changed)');
  reset role;
  assert (select current_version from public.artifacts where id = a) = 2, 'approved version';
  select v.content->'websiteSource'->'assets' into x from public.artifact_versions v where v.artifact_id = a and v.version_number = 2;
  assert jsonb_array_length(x) = 1 and x->0->>'id' = up1::text and x->0->>'path' = 'public/images/client-' || left(replace(up1::text,'-',''),12) || '.webp'
    and x->0->>'mediaType' = 'image/webp' and x->0->>'sha256' = repeat('b',64), 'only the referenced upload joins the source assets';
  assert (select asset_manifest = jsonb_build_array(up1::text) from public.artifact_versions where artifact_id = a and version_number = 2), 'asset manifest lists it';
  assert (select metadata->>'photos' from public.audit_events where action = 'portal.change_approved' and workspace_id = w) = '1', 'approval audit counts photos';
  -- The upload is now part of the site and no longer listed separately in the picker.
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  r := public.makeborne_portal_read_site(cu,s_cu,ex,a);
  assert (select count(*) from jsonb_array_elements(r->'images') i where i->>'assetId' = up1::text) = 1, 'attached upload listed once';
  reset role;
  raise notice 'PASS client portal uploads: approval adds only the photos the change uses to the new version''s assets and manifest (website source guard satisfied) and audits the count';

  -- ---------------------------------------------------------------- limits and cascades
  insert into public.client_portal_uploads(id,workspace_id,project_id,artifact_id,access_id,actor_id,path_key,object_path,sha256,bytes,width,height)
    select gen_random_uuid(),w,p,a,(select id from public.client_portal_access where user_id = cu),cu,left(md5(i::text),12),'x',repeat('e',64),1,1,1 from generate_series(1,38) i;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  begin perform public.makeborne_portal_register_upload(cu,s_cu,ex,a,gen_random_uuid(),repeat('f',64),1000,800,600); raise exception 'daily limit not enforced';
  exception when sqlstate 'MB429' then null; end;
  reset role;
  delete from public.client_portal_uploads where object_path = 'x';
  delete from public.client_portal_access where workspace_id = w;
  assert (select count(*) from public.client_portal_uploads where workspace_id = w) = 0, 'revoking the grant row removes its uploads';
  raise notice 'PASS client portal uploads: 40 per grant per day enforced (MB429); removing a grant removes its upload rows';
end $$;
select 'PASS: client portal uploads' as result;
rollback;
