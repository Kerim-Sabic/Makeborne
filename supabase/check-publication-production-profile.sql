\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); other_w uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); r text;
begin
 if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal required'; end if;
 assert (select relrowsecurity from pg_class where oid='makeborne_private.trusted_publication_workspaces'::regclass);
 foreach r in array array['anon','authenticated','service_role','makeborne_publication_worker'] loop
  assert not has_table_privilege(r,'makeborne_private.trusted_publication_workspaces','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  assert not has_function_privilege(r,'makeborne_private.publication_workspace_allowed(uuid)','EXECUTE');
 end loop;
 raise notice 'PASS rollout table and helper have no application or worker write/read authority';
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@publication.test',now());
 insert into auth.sessions(id,user_id) values(s,u);
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Rollout fixture');
 insert into public.workspaces(id,name,owner_id) values(w,'Rollout fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Rollout fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Rollout fixture','website');
 assert (select mode='production' from makeborne_private.site_address_namespace_policy where singleton);
 assert not makeborne_private.publication_workspace_allowed(w);
 begin
  perform makeborne_private.publication_authority(u,s,now()+interval '1 hour',w,a);
  raise exception 'Unlisted workspace admitted';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS unlisted production workspace refused even for its authenticated admin owner';
 insert into makeborne_private.trusted_publication_workspaces(workspace_id,enabled) values(w,true);
 assert makeborne_private.publication_workspace_allowed(w);
 perform makeborne_private.publication_authority(u,s,now()+interval '1 hour',w,a);
 update makeborne_private.trusted_publication_workspaces set enabled=false where workspace_id=w;
 begin
  perform makeborne_private.publication_authority(u,s,now()+interval '1 hour',w,a);
  raise exception 'Revoked workspace admitted';
 exception when insufficient_privilege then null; end;
 assert not makeborne_private.publication_workspace_allowed(other_w);
 raise notice 'PASS explicit enablement and later revocation are enforced by real authority, not UI state';
 -- Namespace owner is postgres; tests run as it here. Staging keeps its one-QA-workspace guard.
 perform makeborne_private.configure_site_address_namespace('staging',w);
 assert makeborne_private.publication_workspace_allowed(w);
 assert not makeborne_private.publication_workspace_allowed(other_w);
 perform makeborne_private.publication_authority(u,s,now()+interval '1 hour',w,a);
 perform makeborne_private.configure_site_address_namespace('production',null);
 assert not makeborne_private.publication_workspace_allowed(w);
 raise notice 'PASS staging QA scope unchanged and does not become a production rollout entry';
end $$;
rollback;
