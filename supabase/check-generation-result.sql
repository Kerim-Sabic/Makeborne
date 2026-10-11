-- Transactional local authority qualification only; all synthetic rows roll back.
begin;
do $$
declare actor uuid:=gen_random_uuid(); owner_uuid uuid:=gen_random_uuid(); session_uuid uuid:=gen_random_uuid();
 workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); artifact uuid:=gen_random_uuid(); source_uuid uuid:=gen_random_uuid();
 proposal uuid:=gen_random_uuid(); request_uuid uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 t timestamptz:=clock_timestamp(); deadline timestamptz; snapshot jsonb; route jsonb; result jsonb;
 job public.generation_jobs%rowtype; replay public.generation_jobs%rowtype; binding jsonb; extra_source uuid; version_uuid uuid:=gen_random_uuid(); dispatch uuid; saved jsonb; again jsonb; content jsonb; style jsonb; original_claims text; original_sub text; original_role text;
begin
 deadline:=t+interval '10 minutes';
 insert into auth.users(id,email,email_confirmed_at) values(actor,'authority-'||actor||'@example.invalid',now()),(owner_uuid,'owner-'||owner_uuid||'@example.invalid',now());
 insert into auth.sessions(id,user_id,created_at,updated_at) values(session_uuid,actor,now(),now());
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(actor,true,false,'Rolled back input authority fixture');
 insert into public.workspaces(id,name,owner_id) values(workspace,'Rolled back authority fixture',owner_uuid);
 insert into public.workspace_members(workspace_id,user_id,role) values(workspace,actor,'editor');
 insert into public.projects(id,workspace_id,title,kind) values(project,workspace,'Authority fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(artifact,workspace,project,'Authority fixture','website');
 insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values(source_uuid,workspace,project,'Approved source','text','Approved exact material.',true);
 insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values(workspace,true,100,100,10);
 route:=jsonb_build_object('provider','anthropic','model','offline','status','ready','adapterVerified',true,'policyApproved',true,'licenseApproved',true,'dataBoundary','external',
   'price',jsonb_build_object('version','fixture-v1','expiresAt',t+interval '1 hour'));
 snapshot:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat('b',64),
   'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',workspace,'projectId',project,'artifactId',artifact),'baseVersionId',null,'sourceIds',jsonb_build_array(source_uuid)),
   'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3','preparedAt',t,'expiresAt',t+interval '1 hour',
     'stages',jsonb_build_array(jsonb_build_object('stage','planning','route',route),jsonb_build_object('stage','draft','route',route),jsonb_build_object('stage','review','route',route))));
 insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
 values(proposal,workspace,project,artifact,repeat('a',64),repeat('b',64),snapshot,12,3,t,t+interval '1 hour');
 job:=makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,session_uuid,t+interval '30 minutes',true,true,true);
 job:=makeborne_private.acquire_generation_job_lease(job.id,worker,120);
 update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=100,concurrency_limit=10 where scope in ('global','anthropic');
 dispatch:=(makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid())->>'dispatchId')::uuid;
 -- This single rolled-back transaction cannot simulate a network call between
 -- transactions. Align only the synthetic fixture's start with the canonical
 -- writer's transaction timestamp; the separate-connection harness tests real time.
 update makeborne_private.generation_reservations set dispatch_started_at=transaction_timestamp() where id=job.reservation_id;
 content:='{"schemaVersion":1,"kind":"website","title":"Generated source fixture","sections":[],"websiteSource":{"schemaVersion":1,"toolchainId":"react-vite-v1","entrypoint":"src/main.tsx","files":[{"path":"package.json","content":"{}"},{"path":"package-lock.json","content":"{}"},{"path":"index.html","content":"<div id=\"root\"></div>"},{"path":"src/main.tsx","content":"export {};"}],"assets":[],"routes":[{"path":"/","title":"Home"}]}}'::jsonb;
 style:='{"id":"fixture","name":"Fixture","version":1,"typography":{"headingFont":"Arial","bodyFont":"Arial"},"colors":{"ink":"#202126"},"description":"Local fixture","referenceAssetIds":[]}'::jsonb;
 perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"service_role"}',true);
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 perform set_config('request.jwt.claim.role','service_role',true);
 original_claims:=current_setting('request.jwt.claims'); original_sub:=current_setting('request.jwt.claim.sub'); original_role:=current_setting('request.jwt.claim.role');
 set local role makeborne_generation_worker;
 for i in 1..4 loop
   begin
     perform makeborne_private.commit_generation_worker_result(job.id,case when i=1 then null else worker end,case when i=2 then job.fence-1 else job.fence end,
       dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),
       case when i=3 then content-'websiteSource' when i=4 then jsonb_set(content,'{kind}','"book"') else content end,style,'[]','Generated source');
     raise exception 'Invalid worker/output accepted';
   exception when sqlstate 'PT409' or invalid_parameter_value then null; end;
 end loop;
 reset role;
 if exists(select 1 from public.artifact_versions where artifact_id=artifact) or exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) then raise exception 'Invalid result left state'; end if;
 raise notice 'PASS null/stale worker, outline and wrong output rejected without a saved revision or outcome';
 -- Bad accounting evidence fails after the writer; the same exception must undo
 -- version, artifact pointer and idempotency receipt, not merely the outcome.
 set local role makeborne_generation_worker;
 begin
   perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,-1,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
   raise exception 'Negative cost accepted';
 exception when invalid_parameter_value then null; end;
 reset role;
 if exists(select 1 from public.artifact_versions where artifact_id=artifact)
   or exists(select 1 from makeborne_private.project_builds where job_id=job.id)
   or exists(select 1 from makeborne_private.cloud_mutation_receipts where workspace_id=workspace)
   or exists(select 1 from public.usage_ledger where job_id=job.id)
   or (select current_version from public.artifacts where id=artifact)<>0 then raise exception 'Partial result survived accounting failure'; end if;
 if row(current_setting('request.jwt.claims'),current_setting('request.jwt.claim.sub'),current_setting('request.jwt.claim.role'))
   is distinct from row(original_claims,original_sub,original_role) then raise exception 'Failure leaked actor context'; end if;
 raise notice 'PASS failed evidence atomically rolls back canonical revision, pointer, receipt and usage; auth context restored';
 for i in 1..3 loop
   begin
     if i=1 then delete from auth.sessions where id=session_uuid;
     elsif i=2 then update public.workspace_members set role='reviewer' where workspace_id=workspace and user_id=actor;
     else update public.sources set content='Changed after dispatch' where id=source_uuid; end if;
     perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
     raise exception 'Revoked authority saved a result';
   exception when insufficient_privilege or sqlstate 'PT409' then null; end;
 end loop;
 raise notice 'PASS signout, editor revocation and changed source after dispatch block result save';
 begin
   saved:=makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
   if not exists(select 1 from makeborne_private.project_builds where job_id=job.id and version_id=(saved->>'versionId')::uuid) then
     raise exception 'Build missing inside canonical outcome transaction'; end if;
   raise exception 'Synthetic failure after build handoff insertion' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
 if exists(select 1 from makeborne_private.project_builds where job_id=job.id)
   or exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id)
   or exists(select 1 from public.artifact_versions where artifact_id=artifact)
   or exists(select 1 from public.usage_ledger where job_id=job.id)
   or exists(select 1 from makeborne_private.cloud_mutation_receipts where workspace_id=workspace) then
   raise exception 'Build handoff survived rolled-back canonical outcome'; end if;
 raise notice 'PASS rollback after build insertion leaves no source, build, outcome, ledger or replay receipt';
 set local role makeborne_generation_worker;
 saved:=makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
 again:=makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
 reset role;
 if saved->>'versionId' is distinct from again->>'versionId' or saved->>'outcomeId' is distinct from again->>'outcomeId' or again->'replayed' is distinct from 'true'::jsonb
   or (select count(*) from public.artifact_versions where artifact_id=artifact)<>1
   or (select count(*) from makeborne_private.cloud_mutation_receipts where workspace_id=workspace)<>1
   or (select count(*) from public.usage_ledger where job_id=job.id)<>1
   or (select count(*) from makeborne_private.project_builds where job_id=job.id and version_id=(saved->>'versionId')::uuid and status='queued')<>1
   or exists(select 1 from public.usage_ledger where job_id=job.id and account='customer_credits')
   or not exists(select 1 from public.artifact_versions where id=(saved->>'versionId')::uuid and created_by=actor) then raise exception 'Result replay or attribution mismatch'; end if;
 if row(current_setting('request.jwt.claims'),current_setting('request.jwt.claim.sub'),current_setting('request.jwt.claim.role'))
   is distinct from row(original_claims,original_sub,original_role) then raise exception 'Success leaked actor context'; end if;
 raise notice 'PASS exact replay creates one canonical version, receipt, outcome and provider ledger entry; actor restored and no customer charge';
 set local role makeborne_generation_worker;
 begin
   perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,1,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
   raise exception 'Changed cost replay accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),jsonb_set(content,'{title}','"Changed"'),style,'[]','Generated source');
   raise exception 'Changed source replay accepted';
 exception when sqlstate 'MB409' then null; end;
 reset role;
 begin
   insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,created_by)
   values(gen_random_uuid(),workspace,artifact,2,(saved->>'versionId')::uuid,content,style,actor);
   perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','result-fixture',repeat('e',64),content,style,'[]','Generated source');
   raise exception 'Later customer revision overwritten';
 exception when sqlstate 'PT409' then null; end;
 raise notice 'PASS changed evidence/content replay and subsequent customer revision rejected';
end $$;
rollback;
