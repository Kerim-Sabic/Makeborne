begin;
do $$
declare
  u uuid := gen_random_uuid(); w uuid := gen_random_uuid(); p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  pad text := repeat(' ', 120);
  old_html text; portable text; isolated text; js text := 'console.log(1)'; files jsonb; s jsonb; r jsonb; req uuid; rev integer; i integer;
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


 s := public.makeborne_save_hosted_site_v4(u,w,a,1,'before-rename',portable,true,0,gen_random_uuid(),false,null,'[]',null);
 rev := (s->>'revision')::int; req := gen_random_uuid();
 s := public.makeborne_save_hosted_site_v4(u,w,a,1,'after-rename',replace(portable,'old-site','after-rename'),true,rev,req,false,null,'[]',null);
 assert s->>'slug'='after-rename';
 assert public.makeborne_read_hosted_site('before-rename') is null;
 assert public.makeborne_read_hosted_site('after-rename')=replace(portable,'old-site','after-rename');
 r := public.makeborne_save_hosted_site_v4(u,w,a,1,'after-rename',replace(portable,'old-site','after-rename'),true,rev,req,false,null,'[]',null);
 assert r=s, 'Idempotent retry must not create another revision';
 raise notice 'PASS rename, refreshed document, old URL unavailable, idempotent retry';
 begin
  perform public.makeborne_save_hosted_site_v4(u,w,a,1,'bad-version',portable,true,rev,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Stale revision accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.makeborne_save_hosted_site_v4(u,w,a,1,'bad-document','invalid',true,(s->>'revision')::int,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Invalid document accepted';
 exception when sqlstate '22023' then null; end;
 assert (select slug from public.hosted_sites where artifact_id=a)='after-rename';
 assert not exists(select 1 from makeborne_hosting.site_address_reservations where slug='bad-document');
 raise notice 'PASS stale request and invalid document leave original address untouched';
 begin
  perform public.makeborne_save_hosted_site_v3(u,w,a2,1,'before-rename',portable,true,0,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Old writer reclaimed a retired address';
 exception when unique_violation then null; end;
 assert not exists(select 1 from public.hosted_sites where artifact_id=a2);
 begin
  perform public.makeborne_save_hosted_site_v4(gen_random_uuid(),w,a,1,'stolen-site',portable,true,(s->>'revision')::int,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Unrelated owner renamed website';
 exception when insufficient_privilege then null; end;
 assert not has_function_privilege('anon','public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','execute');
 assert not has_function_privilege('authenticated','public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','execute');
 assert not has_table_privilege('service_role','makeborne_hosting.site_address_reservations','insert');
 raise notice 'PASS retired reservation, unrelated owner denial and role permissions';
 -- Review fix: at most 10 addresses per website, so renames cannot squat unlimited addresses.
 rev := (select revision from public.hosted_sites where artifact_id=a);
 for i in 1..8 loop
  s := public.makeborne_save_hosted_site_v4(u,w,a,1,'squat-'||i,portable,true,rev,gen_random_uuid(),false,null,'[]',null);
  rev := (s->>'revision')::int;
 end loop;
 assert (select count(*) from makeborne_hosting.site_address_reservations where artifact_id=a)=10;
 begin
  perform public.makeborne_save_hosted_site_v4(u,w,a,1,'squat-11',portable,true,rev,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Eleventh address accepted';
 exception when sqlstate 'MB429' then null; end;
 assert (select slug from public.hosted_sites where artifact_id=a)='squat-8', 'Refused rename changed the address';
 s := public.makeborne_save_hosted_site_v4(u,w,a,1,'before-rename',portable,true,rev,gen_random_uuid(),false,null,'[]',null);
 assert s->>'slug'='before-rename', 'Returning to an earlier address must stay possible';
 raise notice 'PASS at most 10 addresses per website; earlier addresses stay reusable';
end $$;
rollback;
