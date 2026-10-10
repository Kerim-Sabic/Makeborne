-- Transactional local authority qualification only; all synthetic rows roll back.
begin;
do $$
declare actor uuid:=gen_random_uuid(); owner_uuid uuid:=gen_random_uuid(); session_uuid uuid:=gen_random_uuid();
 workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); artifact uuid:=gen_random_uuid(); source_uuid uuid:=gen_random_uuid();
 proposal uuid:=gen_random_uuid(); request_uuid uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 t timestamptz:=clock_timestamp(); deadline timestamptz; snapshot jsonb; route jsonb; result jsonb;
 job public.generation_jobs%rowtype; replay public.generation_jobs%rowtype; binding jsonb; extra_source uuid; version_uuid uuid:=gen_random_uuid();
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
 for i in 1..4 loop
   begin
     perform makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,
       case when i=1 then gen_random_uuid() else session_uuid end,t+interval '30 minutes',i<>2,i<>3,i<>4);
     raise exception 'Missing consent/session accepted';
   exception when insufficient_privilege then null; end;
 end loop;
 if exists(select 1 from makeborne_private.generation_reservations where proposal_id=proposal) then raise exception 'Failed authorization left a reservation'; end if;
 begin
   for n in 1..7 loop
     extra_source:=gen_random_uuid();
     insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values(extra_source,workspace,project,'Large approved source','text',repeat('x',900000),true);
     update makeborne_private.generation_proposals g set snapshot=jsonb_set(g.snapshot,'{input,sourceIds}',(g.snapshot#>'{input,sourceIds}')||jsonb_build_array(extra_source)) where g.id=proposal;
   end loop;
   perform makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,session_uuid,t+interval '30 minutes',true,true,true);
   raise exception 'Unbounded source accepted';
 exception when invalid_parameter_value then null; end;
 if exists(select 1 from makeborne_private.generation_reservations where proposal_id=proposal) then raise exception 'Oversized source left a reservation'; end if;
 raise notice 'PASS invalid session and missing processing/external/rights confirmations roll back reservation, job and outbox';
 job:=makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,session_uuid,t+interval '30 minutes',true,true,true);
 replay:=makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,session_uuid,t+interval '30 minutes',true,true,true);
 if job.id<>replay.id then raise exception 'Replay duplicated job'; end if;
 select authorization_snapshot into binding from makeborne_private.generation_reservations where id=job.reservation_id;
 begin update makeborne_private.generation_reservations set authorization_snapshot=null where id=job.reservation_id; raise exception 'Binding rewritten'; exception when check_violation then null; end;
 set local role makeborne_generation_worker;
 begin perform makeborne_private.load_generation_worker_input(job.id,null,0); raise exception 'Unleased input exposed'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.claim_capped_generation_dispatch(job.id,null,0,gen_random_uuid()); raise exception 'Unleased dispatch accepted'; exception when sqlstate 'PT409' then null; end;
 reset role;
 job:=makeborne_private.acquire_generation_job_lease(job.id,worker,120);
 set local role makeborne_generation_worker;
 result:=makeborne_private.load_generation_worker_input(job.id,worker,job.fence);
 if result#>>'{sourceMaterial,0,text}'<>'Approved exact material.' then raise exception 'Source material changed'; end if;
 begin perform makeborne_private.load_generation_worker_input(job.id,worker,job.fence-1); raise exception 'Stale reader accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.authorize_and_enqueue_generation_job(proposal,request_uuid,actor,repeat('b',64),repeat('a',64),deadline,session_uuid,t+interval '30 minutes',true,true,true); raise exception 'Worker rebound authority'; exception when insufficient_privilege then null; end;
 begin perform makeborne_private.claim_capped_generation_dispatch_unchecked(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Worker bypassed authority'; exception when insufficient_privilege then null; end;
 reset role;
 raise notice 'PASS immutable replay, scoped fenced source load and denied worker bind/dispatch bypass';
 update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=100,concurrency_limit=10 where scope in ('global','anthropic');
 -- Each exception block rolls its revocation back. Caps are enabled so a denial
 -- proves current authority, rather than being masked by an inactive budget.
 begin
   delete from auth.sessions where id=session_uuid;
   set local role makeborne_generation_worker;
   perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Signed out session spent';
 exception when insufficient_privilege then reset role; end;
 begin
   update auth.sessions set not_after=t-interval '1 second' where id=session_uuid;
   perform makeborne_private.load_generation_worker_input(job.id,worker,job.fence); raise exception 'Expired session read';
 exception when insufficient_privilege then null; end;
 begin
   delete from makeborne_private.account_privileges where user_id=actor;
   perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Lost creation access spent';
 exception when insufficient_privilege then null; end;
 begin
   update public.workspace_members set role='reviewer' where workspace_id=workspace and user_id=actor;
   perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Reviewer spent';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS signed-out/expired session, revoked creation access and reviewer dispatch denied with caps enabled';
 for i in 1..3 loop
   begin
     if i=1 then update public.sources set content='Changed material' where id=source_uuid;
     elsif i=2 then update public.sources set approved=false where id=source_uuid;
     else update public.sources set permission='public' where id=source_uuid; end if;
     perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Changed source spent';
   exception when sqlstate 'PT409' then null; end;
 end loop;
 begin
   update makeborne_private.generation_proposals g set snapshot=jsonb_set(g.snapshot,'{input,brief}','"Tampered"') where g.id=proposal;
   perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Changed proposal spent';
 exception when sqlstate 'PT409' then null; end;
 begin
   insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(version_uuid,workspace,artifact,1,'{}','{}',actor);
   perform makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Changed revision spent';
 exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from makeborne_private.generation_execution_holds where job_id=job.id) then raise exception 'Denied work allocated cap hold'; end if;
 raise notice 'PASS source content/approval/permission, proposal fingerprint and stale revision deny before dispatch/holds';
 set local role makeborne_generation_worker;
 result:=makeborne_private.claim_capped_generation_dispatch(job.id,worker,job.fence,gen_random_uuid());
 if result->'claimed' is distinct from 'true'::jsonb then raise exception 'Authorized dispatch failed'; end if;
 reset role;
 if (select count(*) from makeborne_private.generation_execution_holds where job_id=job.id)<>1 then raise exception 'Expected one cap hold'; end if;
 raise notice 'PASS unchanged authorized job can dispatch through original exact cap/reservation authority';
end $$;
rollback;
