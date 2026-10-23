\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); rev uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); n integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@chat.invalid',now()),(other_u,other_u||'@chat.invalid',now()),(ed,ed||'@chat.invalid',now()),(rev,rev||'@chat.invalid',now());
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u,now(),now());
 insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(u,true,'chat fixture'),(ed,true,'chat fixture'),(rev,true,'chat fixture');
 insert into public.workspaces(id,name,owner_id) values(w,'Chat fixture',u),(w2,'Other fixture',other_u);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,ed,'editor'),(w,rev,'reviewer');
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Chat project','website'),(p2,w2,'Other project','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Chat artifact','website'),(a2,w2,p2,'Other artifact','website');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated';
 insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(m,u,w,a,'user','Original prompt');
 insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(m,u,w,a,'user','Original prompt') on conflict(account_id,workspace_id,artifact_id,id) do nothing;
 select count(*) into n from public.artifact_chat_messages where artifact_id=a; assert n=1,'Retry duplicated message';
 begin
  insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(gen_random_uuid(),other_u,w,a,'user','Spoof');
  raise exception 'Spoof accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(gen_random_uuid(),u,w2,a2,'user','Other workspace');
  raise exception 'Other workspace accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.artifact_chat_messages set body='Overwrite' where id=m;
  raise exception 'Update accepted';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.artifact_chat_messages where id=m;
  raise exception 'Delete accepted';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 raise notice 'PASS owner append, idempotent retry, spoof/workspace rejection and immutability';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ed,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select count(*) into n from public.artifact_chat_messages where artifact_id=a; assert n=0,'Editor saw another account chat';
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',rev,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 begin
  insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(gen_random_uuid(),rev,w,a,'user','Reviewer');
  raise exception 'Reviewer write accepted';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 execute 'set local role anon';
 begin perform 1 from public.artifact_chat_messages; raise exception 'Anonymous read accepted'; exception when insufficient_privilege then null; end;
 execute 'reset role';
 assert not has_table_privilege('authenticated','public.artifact_chat_messages','UPDATE');
 assert not has_table_privilege('authenticated','public.artifact_chat_messages','DELETE');
 assert (select relrowsecurity from pg_class where oid='public.artifact_chat_messages'::regclass);
 raise notice 'PASS account-private history, reviewer/anonymous denial and RLS/grants';
 insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(gen_random_uuid(),ed,w,a,'user','Editor own transcript');
 delete from auth.users where id=ed;
 assert not exists(select 1 from public.artifact_chat_messages where account_id=ed),'Account deletion did not erase chat';
 delete from public.workspaces where id=w;
 assert not exists(select 1 from public.artifact_chat_messages where id=m),'Workspace deletion did not erase chat';
 raise notice 'PASS account and workspace deletion cascades';
end $$;
rollback;
