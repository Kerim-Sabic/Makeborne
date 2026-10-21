-- Disposable database only. Everything below rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.receipt(preparation uuid) returns jsonb language sql as $$
 select jsonb_build_object('preparationId',id,'actorId',actor_id,'workspaceId',workspace_id,'projectId',project_id,'artifactId',artifact_id,
  'versionId',version_id,'versionNumber',version_number,'publicationRevision',publication_revision,'versionContentHash',version_content_hash,
  'slug',slug,'interactive',interactive,'buildReceipt',jsonb_build_object('sourceHash',repeat('a',64)))
 from makeborne_private.publication_preparations where id=preparation
$$;
do $$
declare u uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid(); w uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 prep uuid; prep2 uuid; state jsonb; result jsonb; replay jsonb; output jsonb; files jsonb; body text; html text; old_html text; s uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@publication.test',now()),(other_actor,other_actor||'@publication.test',now());
 insert into auth.sessions(id,user_id) values(sess,u);
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Publication fixture');
 insert into public.workspaces(id,name,owner_id) values(w,'Publication fixture',u);
 insert into makeborne_private.trusted_publication_workspaces(workspace_id,enabled) values(w,true);
 insert into public.projects(id,workspace_id,title,kind) values(project,w,'Publication fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,project,'Publication fixture','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values(v,w,a,1,'{"kind":"website","websiteSource":{"schemaVersion":1,"toolchainId":"react-vite-v1","entrypoint":"src/main.tsx","files":[{},{},{},{}],"assets":[],"routes":[{"path":"/","title":"Home"},{"path":"/about","title":"About"}]},"sections":[]}','{}',u);
 update public.artifacts set current_version=1 where id=a;
 html:='<!doctype html><html><body><h1>Trusted retained output</h1></body></html>'||repeat(' ',120);
 old_html:='<!doctype html><html><body>Existing live output</body></html>'||repeat(' ',120);
 -- Existing legacy site predates the trusted cutover; preserve it until promotion.
 insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive)
 values(a,w,u,'publication-fixture',1,old_html,true,1,gen_random_uuid(),false);
 body:='console.log("trusted")';
 files:=jsonb_build_array(jsonb_build_object('path','/assets/main-abc.js','content_type','text/javascript; charset=utf-8','body',encode(convert_to(body,'UTF8'),'base64'),'sha256',encode(sha256(convert_to(body,'UTF8')),'hex')),
  jsonb_build_object('path','/assets/font-abc.woff2','content_type','font/woff2','body',encode(convert_to('fake-local-font','UTF8'),'base64'),'sha256',encode(sha256(convert_to('fake-local-font','UTF8')),'hex')));
 output:=jsonb_build_object('html',html,'isolatedHtml',html,'script','/assets/main-abc.js','files',files,'interactive',true,
  'routes',jsonb_build_array(jsonb_build_object('path','/','html',html,'isolatedHtml',html),jsonb_build_object('path','/about','html',html||'about','isolatedHtml',html||'about')));
 begin perform public.makeborne_save_hosted_site_v4(u,w,a,1,'publication-fixture',html,true,1,gen_random_uuid(),true,'/assets/main-abc.js',files,html);
  raise exception 'Raw source publication accepted'; exception when insufficient_privilege then null; end;
 assert (select hosted_sites.html from public.hosted_sites where artifact_id=a)=old_html;
 raise notice 'PASS raw source v4 denied and previous live bytes preserved';

 state:=public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,1,'publication-fixture',true,req);
 prep:=(state->>'id')::uuid;
 assert state->>'state'='queued';
 assert public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,1,'publication-fixture',true,req)->>'id'=prep::text;
 assert public.makeborne_latest_publication_preparation(u,sess,now()+interval '20 minutes',w,a)->>'id'=prep::text;
 begin perform public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,1,'changed-address',true,req);
  raise exception 'Changed request accepted'; exception when sqlstate 'MB409' then null; end;
 begin perform public.makeborne_publication_preparation_status(prep,other_actor,sess,now()+interval '20 minutes');
  raise exception 'Wrong actor accepted'; exception when no_data_found then null; end;
 begin perform public.makeborne_request_publication_preparation(u,gen_random_uuid(),now()+interval '20 minutes',w,a,1,1,'publication-fixture',true,gen_random_uuid());
  raise exception 'Invalid session accepted'; exception when insufficient_privilege then null; end;
 raise notice 'PASS actor/session/scope, request replay, conflicting input and latest recovery';

 state:=public.makeborne_claim_publication_preparation(prep,worker);
 assert state->>'fence'='1' and state->'version'->>'id'=v::text;
 assert public.makeborne_load_publication_preparation(prep,worker,1)->'assetRecords'='[]'::jsonb;
 assert public.makeborne_claim_publication_preparation(prep,gen_random_uuid()) is null;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,0,pg_temp.receipt(prep),output::text);
  raise exception 'Stale fence accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,1,pg_temp.receipt(prep)||jsonb_build_object('versionId',gen_random_uuid()),output::text);
  raise exception 'Wrong receipt version accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,1,pg_temp.receipt(prep)||jsonb_build_object('actorId',other_actor),output::text);
  raise exception 'Wrong receipt actor accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,1,pg_temp.receipt(prep)||jsonb_build_object('outputHash',repeat('0',64)),output::text);
  raise exception 'Forged output digest accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,1,pg_temp.receipt(prep),jsonb_set(output,'{files,0,body}',to_jsonb('ZXZpbA=='::text))::text);
  raise exception 'Tampered file bytes accepted'; exception when invalid_parameter_value then null; end;
 update makeborne_private.publication_preparations set lease_until=clock_timestamp()-interval '1 second' where id=prep;
 begin perform public.makeborne_complete_publication_preparation(prep,worker,1,pg_temp.receipt(prep),output::text);
  raise exception 'Expired lease accepted'; exception when sqlstate 'PT409' then null; end;
 state:=public.makeborne_claim_publication_preparation(prep,worker);
 assert state->>'fence'='2';
 state:=public.makeborne_complete_publication_preparation(prep,worker,2,pg_temp.receipt(prep),output::text);
 assert state->>'state'='ready' and state->'output'=output;
 assert state->>'outputHash'=encode(sha256(convert_to(output::text,'UTF8')),'hex');
 assert public.makeborne_complete_publication_preparation(prep,worker,2,pg_temp.receipt(prep),output::text)->>'state'='ready';
 assert (select hosted_sites.html from public.hosted_sites where artifact_id=a)=old_html;
 raise notice 'PASS exclusive claim, expiry/reclaim fence, immutable receipt, exact output/file hashes and old-live preservation';

 -- Current authority is rechecked at promotion, including session revocation.
 update auth.sessions set not_after=now()-interval '1 second' where id=sess;
 begin perform public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes');
  raise exception 'Revoked session promoted'; exception when insufficient_privilege then null; end;
 update auth.sessions set not_after=null where id=sess;
 update makeborne_private.account_privileges set is_admin=false where user_id=u;
 begin perform public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes');
  raise exception 'Revoked entitlement promoted'; exception when sqlstate 'MB402' then null; end;
 update makeborne_private.account_privileges set is_admin=true where user_id=u;
 update public.workspaces set owner_id=other_actor where id=w;
 begin perform public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes');
  raise exception 'Revoked ownership promoted'; exception when insufficient_privilege then null; end;
 update public.workspaces set owner_id=u where id=w;
 assert (select hosted_sites.html from public.hosted_sites where artifact_id=a)=old_html;
 result:=public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes');
 assert result->>'revision'='2';
 assert (select hosted_sites.html from public.hosted_sites where artifact_id=a)=html;
 assert (select count(*) from public.hosted_site_files where artifact_id=a)=2;
 assert public.makeborne_read_hosted_site_v3('publication-fixture','/about')->>'html'=html||'about';
 assert public.makeborne_read_hosted_site_v3('publication-fixture','/undeclared') is null;
 assert public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes')=result;
 perform public.makeborne_set_hosted_site_interactive(u,w,a,false,2,gen_random_uuid());
 assert public.makeborne_promote_publication_preparation(prep,u,sess,now()+interval '20 minutes')=result;
 assert (select revision from public.hosted_sites where artifact_id=a)=3;
 raise notice 'PASS revoked current authority blocks, atomic promotion exact bytes, lost-response replay after newer publication';

 -- Prepare from revision3, then an independent site toggle makes it stale.
 state:=public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,3,'publication-fixture',true,gen_random_uuid());
 prep2:=(state->>'id')::uuid;
 perform public.makeborne_claim_publication_preparation(prep2,worker);
 perform public.makeborne_complete_publication_preparation(prep2,worker,1,pg_temp.receipt(prep2),output::text);
 perform public.makeborne_set_hosted_site_interactive(u,w,a,true,3,gen_random_uuid());
 begin perform public.makeborne_promote_publication_preparation(prep2,u,sess,now()+interval '20 minutes');
  raise exception 'Stale publication revision promoted'; exception when sqlstate 'PT409' then null; end;
 -- Version advancement similarly conflicts, exact request remains recoverable.
 state:=public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,4,'publication-fixture',true,gen_random_uuid());
 prep2:=(state->>'id')::uuid;
 perform public.makeborne_claim_publication_preparation(prep2,worker);
 perform public.makeborne_complete_publication_preparation(prep2,worker,1,pg_temp.receipt(prep2),output::text);
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values(gen_random_uuid(),w,a,2,'{"kind":"website","websiteSource":{"schemaVersion":1,"toolchainId":"react-vite-v1","entrypoint":"src/main.tsx","files":[{},{},{},{}],"assets":[],"routes":[{"path":"/","title":"Home"},{"path":"/about","title":"About"}]},"sections":[]}','{}',u);
 update public.artifacts set current_version=2 where id=a;
 begin perform public.makeborne_promote_publication_preparation(prep2,u,sess,now()+interval '20 minutes');
  raise exception 'Stale saved version promoted'; exception when sqlstate 'PT409' then null; end;
 assert public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,1,1,'publication-fixture',true,req)->>'id'=prep::text;
 assert (select revision from public.hosted_sites where artifact_id=a)=4;
 raise notice 'PASS saved-version and publication CAS; exact old request recovery';

 state:=public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,2,4,'publication-fixture',true,gen_random_uuid());
 prep2:=(state->>'id')::uuid;
 for i in 1..3 loop
  state:=public.makeborne_claim_publication_preparation(prep2,worker);
  assert (state->>'fence')::int=i;
  state:=public.makeborne_fail_publication_preparation(prep2,worker,i,'Fixture failure');
 end loop;
 assert state->>'state'='failed';
 assert public.makeborne_claim_publication_preparation(prep2,worker) is null;
 begin perform public.makeborne_promote_publication_preparation(prep2,u,sess,now()+interval '20 minutes');
  raise exception 'Failed preparation promoted'; exception when sqlstate 'PT409' then null; end;
 state:=public.makeborne_request_publication_preparation(u,sess,now()+interval '20 minutes',w,a,2,4,'publication-fixture',true,gen_random_uuid());
 prep2:=(state->>'id')::uuid;
 update makeborne_private.publication_preparations set expires_at=clock_timestamp()-interval '1 second' where id=prep2;
 state:=public.makeborne_publication_preparation_status(prep2,u,sess,now()+interval '20 minutes');
 assert state->>'state'='expired';
 assert public.makeborne_claim_publication_preparation(prep2,worker) is null;
 assert (select revision from public.hosted_sites where artifact_id=a)=4;
 raise notice 'PASS bounded retry, expired/failed preparations never change live';

 -- Offline action remains available for source sites through the existing v4.
 replay:=public.makeborne_save_hosted_site_v4(u,w,a,2,'publication-fixture','',false,4,gen_random_uuid(),false,null,'[]',null);
 assert not (replay->>'live')::boolean;
 raise notice 'PASS source website offline path preserved';
end $$;

do $$ declare f record; role_name text; begin
 assert (select relrowsecurity from pg_class where oid='makeborne_private.publication_preparations'::regclass);
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(role_name,'makeborne_private.publication_preparations','SELECT,INSERT,UPDATE,DELETE'), 'Preparation table is exposed';
 end loop;
 for f in select p.oid,p.proname,n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.proname like '%publication_preparation%' loop
  assert not has_function_privilege('anon',f.oid,'EXECUTE') and not has_function_privilege('authenticated',f.oid,'EXECUTE'), 'Browser preparation RPC';
  assert has_function_privilege('service_role',f.oid,'EXECUTE'), 'Missing service preparation RPC';
  assert f.prosecdef=(f.nspname='makeborne_private');
  assert 'search_path=""'=any(f.proconfig);
 end loop;
 assert not has_function_privilege('service_role','makeborne_hosting.promote_retained_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('service_role','public.makeborne_save_hosted_site_v3(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 assert has_function_privilege('service_role','public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 raise notice 'PASS RLS and exact service/browser grants, internal promotion/retired bypasses inaccessible';
end $$;
rollback;



