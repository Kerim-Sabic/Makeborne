begin;
do $$
declare
 u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 s jsonb; n integer; row_id uuid;
begin
 insert into auth.users(id,email) values(u,'proposal-fixture-'||u||'@example.invalid');
 insert into public.workspaces(id,name,owner_id) values(w,'Proposal fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
 s:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat('b',64),'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',w,'projectId',p,'artifactId',a),'baseVersionId',null),'workflow',jsonb_build_object('version','workflow-v1','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3','preparedAt','2026-10-04T12:00:00Z','expiresAt','2026-10-04T13:00:00Z','stages',jsonb_build_array('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)));
 set local role service_role;
 insert into makeborne_private.generation_proposals(workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
 values(w,p,a,repeat('a',64),repeat('b',64),s,12,3,'2026-10-04T12:00:00Z','2026-10-04T13:00:00Z') returning id into row_id;
 select count(*) into n from makeborne_private.generation_proposals where id=row_id;
 if n<>1 then raise exception 'service read failed'; end if;
 raise notice 'PASS service insert and read';
 begin
 update makeborne_private.generation_proposals set maximum_customer_credits=0 where id=row_id;
 raise exception 'unexpected service update';
 exception when insufficient_privilege then raise notice 'PASS service update denied'; end;
 begin
 delete from makeborne_private.generation_proposals where id=row_id;
 raise exception 'unexpected service delete';
 exception when insufficient_privilege then raise notice 'PASS service delete denied'; end;
 reset role;
 set local role authenticated;
 begin perform 1 from makeborne_private.generation_proposals; raise exception 'unexpected browser read';
 exception when insufficient_privilege then raise notice 'PASS authenticated read denied'; end;
 reset role;
 set local role anon;
 begin perform 1 from makeborne_private.generation_proposals; raise exception 'unexpected anonymous read';
 exception when insufficient_privilege then raise notice 'PASS anonymous read denied'; end;
 reset role;
 begin
 insert into makeborne_private.generation_proposals(workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
 values(w,p,a,repeat('a',64),repeat('b',64),s,12,3,'2026-10-04T12:00:00Z','2026-10-04T13:00:00Z');
 raise exception 'unexpected duplicate';
 exception when unique_violation then raise notice 'PASS duplicate proposal rejected'; end;
 begin
 update makeborne_private.generation_proposals set maximum_customer_credits=1 where id=row_id;
 raise exception 'unexpected changed price';
 exception when check_violation then raise notice 'PASS snapshot price mismatch rejected'; end;
 begin
 update makeborne_private.generation_proposals set snapshot='{}'::jsonb where id=row_id;
 raise exception 'unexpected missing snapshot';
 exception when check_violation then raise notice 'PASS missing snapshot fields rejected'; end;
 begin
 update makeborne_private.generation_proposals set snapshot=jsonb_set(s,'{workflow,approved}','true') where id=row_id;
 raise exception 'unexpected preapproval';
 exception when check_violation then raise notice 'PASS preapproved snapshot rejected'; end;
 begin
 update makeborne_private.generation_proposals set project_id=gen_random_uuid() where id=row_id;
 raise exception 'unexpected scope';
 exception when check_violation or foreign_key_violation then raise notice 'PASS changed scope rejected'; end;
 if not (select relrowsecurity from pg_class where oid='makeborne_private.generation_proposals'::regclass) then raise exception 'RLS disabled'; end if;
 raise notice 'PASS RLS enabled';
end $$;
rollback;
