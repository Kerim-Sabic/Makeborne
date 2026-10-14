-- Synthetic fixtures for the isolated staging database ONLY; commits intentionally.
\set ON_ERROR_STOP on
do $$ begin
 if current_database()<>'makeborne_populated' then raise exception 'Disposable populated rehearsal database required'; end if;
 if exists(select 1 from auth.users) then raise exception 'Expected an empty fixture database'; end if;
end $$;
insert into makeborne_private.billing_settings(singleton,creation_enabled) values(true,false);
insert into makeborne_private.claude_pilot_budget(id,limit_cents,reserved_cents) values(true,400,75);
insert into auth.users(id,email,email_confirmed_at) values('10000000-0000-4000-8000-000000000001','stage@example.invalid',now());
insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason)
values('10000000-0000-4000-8000-000000000001',true,false,'Synthetic migration fixture');
insert into public.workspaces(id,name,owner_id) values('20000000-0000-4000-8000-000000000001','Preserve workspace','10000000-0000-4000-8000-000000000001');
insert into public.clients(id,workspace_id,name,outreach) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Preserve client','{"stage":"Meeting","channel":"Email","profileUrl":"","lastContact":null,"nextFollowUp":null,"notes":"Keep my notes","activity":[]}');
insert into public.projects(id,workspace_id,client_id,title,kind,status) values
('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Preserve project','website','published');
insert into public.artifacts(id,workspace_id,project_id,title,kind) values
('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Preserve site','website');
insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'{"title":"Preserve content"}','{}','10000000-0000-4000-8000-000000000001');
update public.artifacts set current_version=1;
insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id)
values('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','preserve-site',1,'<!doctype html><html><body><h1>Preserve published site</h1></body></html>',true,gen_random_uuid());
insert into public.claude_pilot_runs(id,user_id,request_hash,status,usage)
values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',repeat('a',64),'completed','{"fixtureCost":75}');
