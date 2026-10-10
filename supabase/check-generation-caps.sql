begin;
create function pg_temp.reject_capped_fixture_charge() returns trigger language plpgsql as $$
begin if new.reason='accepted_work' then raise exception 'Injected debit failure' using errcode='PT503'; end if; return new; end $$;
do $$
declare u uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); w1 uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
 a uuid; q uuid; j uuid; jobs uuid[]:='{}'; i integer; t timestamptz:=clock_timestamp(); provider_name text; session_uuid uuid:=gen_random_uuid();
 s jsonb; route jsonb; worker uuid:=gen_random_uuid(); job public.generation_jobs%rowtype; d1 uuid; d3 uuid; oid uuid; result jsonb; v uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'cap-'||u||'@example.invalid',now()),(u2,'cap-'||u2||'@example.invalid',now());
 insert into auth.sessions(id,user_id,created_at,updated_at) values(session_uuid,u,now(),now());
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,true,'Disposable cap fixture');
 insert into public.workspaces(id,name,owner_id) values(w1,'Rolled back cap fixture',u),(w2,'Rolled back second cap fixture',u2);
 insert into public.workspace_members(workspace_id,user_id,role) values(w2,u,'editor');
 insert into public.projects(id,workspace_id,title,kind) values(p1,w1,'Fixture','website'),(p2,w2,'Fixture','website');
 insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values(w1,true,100,30,10),(w2,true,100,30,10);
 for i in 1..3 loop
   a:=gen_random_uuid(); q:=gen_random_uuid(); provider_name:=case when i=3 then 'openai' else 'anthropic' end;
   insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,case when i=3 then w2 else w1 end,case when i=3 then p2 else p1 end,'Fixture','website');
   route:=jsonb_build_object('provider',provider_name,'model','offline','status','ready','adapterVerified',true,'policyApproved',true,'licenseApproved',true,
     'price',jsonb_build_object('version','fixture-v1','expiresAt',t+interval '1 hour'));
   s:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat(chr(97+i),64),
     'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',case when i=3 then w2 else w1 end,'projectId',case when i=3 then p2 else p1 end,'artifactId',a),'baseVersionId',null,'sourceIds','[]'::jsonb),
     'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3',
     'preparedAt',t,'expiresAt',t+interval '1 hour','stages',jsonb_build_array(jsonb_build_object('stage','planning','route',route),jsonb_build_object('stage','draft','route',route),jsonb_build_object('stage','review','route',route))));
   insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
   values(q,case when i=3 then w2 else w1 end,case when i=3 then p2 else p1 end,a,repeat('a',64),repeat(chr(97+i),64),s,12,3,t,t+interval '1 hour');
   job:=makeborne_private.authorize_and_enqueue_generation_job(q,gen_random_uuid(),u,repeat(chr(97+i),64),repeat('a',64),t+interval '10 minutes',session_uuid,t+interval '30 minutes',true,true,true);
   jobs:=array_append(jobs,job.id);
   job:=makeborne_private.acquire_generation_job_lease(job.id,worker,120);
 end loop;
 if has_function_privilege('service_role','makeborne_private.claim_generation_job_dispatch(uuid,uuid,bigint,uuid)','execute')
   or has_function_privilege('service_role','makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text)','execute')
   or has_function_privilege('service_role','makeborne_private.claim_claude_pilot(uuid,uuid,text)','execute')
   or has_function_privilege('service_role','public.makeborne_claim_claude_pilot(uuid,uuid,text)','execute')
   or has_function_privilege('service_role','makeborne_private.record_generation_job_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid)','execute') then raise exception 'Old runtime bypass exposed'; end if;
 set local role service_role;
 begin update makeborne_private.generation_execution_caps set enabled=true; raise exception 'Worker changed cap'; exception when insufficient_privilege then null; end;
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[1],worker,1,gen_random_uuid()); raise exception 'Admin bypassed default caps'; exception when insufficient_privilege then null; end;
 reset role;
 if exists(select 1 from makeborne_private.generation_execution_holds where workspace_id in (w1,w2)) then raise exception 'Denied dispatch allocated caps'; end if;
 raise notice 'PASS disabled caps block even unlimited administrator; worker cannot mutate policy or call legacy dispatch/outcome';

 update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=24,concurrency_limit=1 where scope in ('global','anthropic','openai');
 begin
   update makeborne_private.generation_proposals set snapshot=jsonb_set(snapshot,'{workflow,stages,1,stage}','"unknown"')
     where id=(select proposal_id from makeborne_private.generation_reservations where id=(select reservation_id from public.generation_jobs where id=jobs[2]));
   -- Owner-only narrow cap regression; runtime authority rejects the mutation earlier.
   perform makeborne_private.claim_capped_generation_dispatch_unchecked(jobs[2],worker,1,gen_random_uuid()); raise exception 'Missing draft accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   update makeborne_private.generation_proposals set snapshot=jsonb_set(snapshot,'{workflow,stages,1,route,price,expiresAt}',to_jsonb((t-interval '1 hour')::text))
     where id=(select proposal_id from makeborne_private.generation_reservations where id=(select reservation_id from public.generation_jobs where id=jobs[2]));
   perform makeborne_private.claim_capped_generation_dispatch_unchecked(jobs[2],worker,1,gen_random_uuid()); raise exception 'Expired price accepted';
 exception when sqlstate 'PT409' then null; end;
 update makeborne_private.generation_execution_caps set emergency_stop=true where scope='global';
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[1],worker,1,gen_random_uuid()); raise exception 'Global stop ignored'; exception when insufficient_privilege then null; end;
 update makeborne_private.generation_execution_caps set emergency_stop=false where scope='global';
 update makeborne_private.generation_execution_caps set enabled=false where scope='openai';
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[3],worker,1,gen_random_uuid()); raise exception 'Provider disabled ignored'; exception when insufficient_privilege then null; end;
 update makeborne_private.generation_execution_caps set enabled=true where scope='openai';
 raise notice 'PASS missing draft, expired price, global stop and independently disabled provider deny before allocation';
 set local role service_role;
 result:=makeborne_private.claim_capped_generation_dispatch(jobs[1],worker,1,gen_random_uuid());
 if result->>'claimed'<>'true' then raise exception 'First capped dispatch missing'; end if;
 d1:=(result->>'dispatchId')::uuid;
 result:=makeborne_private.claim_capped_generation_dispatch(jobs[1],worker,1,gen_random_uuid());
 if result->>'claimed'<>'false' then raise exception 'Capped replay dispatched twice'; end if;
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[3],worker,1,gen_random_uuid()); raise exception 'Global concurrency ignored'; exception when sqlstate 'MB429' then null; end;
 reset role;
 update makeborne_private.generation_execution_caps set concurrency_limit=10 where scope='global';
 set local role service_role;
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[2],worker,1,gen_random_uuid()); raise exception 'Provider concurrency ignored'; exception when sqlstate 'MB429' then null; end;
 reset role;
 if (select count(*) from makeborne_private.generation_execution_holds where workspace_id in (w1,w2))<>1 then raise exception 'Concurrency denial allocated hold'; end if;
 raise notice 'PASS global and independent provider concurrency are atomic; dispatch replay does not allocate twice';

 update makeborne_private.generation_execution_caps set vendor_limit=12,concurrency_limit=10 where scope in ('global','anthropic');
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[3],worker,1,gen_random_uuid()); raise exception 'Global budget ignored'; exception when sqlstate 'MB402' then null; end;
 update makeborne_private.generation_execution_caps set vendor_limit=24 where scope='global';
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[2],worker,1,gen_random_uuid()); raise exception 'Provider budget ignored'; exception when sqlstate 'MB402' then null; end;
 begin perform makeborne_private.claim_capped_generation_dispatch(jobs[3],worker,0,gen_random_uuid()); raise exception 'Stale fence accepted'; exception when sqlstate 'PT409' then null; end;
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_reserved=12 and active_dispatches=1) then raise exception 'Failed dispatch left partial allocation'; end if;
 set local role service_role;
 result:=makeborne_private.claim_capped_generation_dispatch(jobs[3],worker,1,gen_random_uuid()); d3:=(result->>'dispatchId')::uuid;
 reset role;
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_reserved=24 and active_dispatches=2) then raise exception 'Cross-provider global hold wrong'; end if;
 raise notice 'PASS shared global cap and per-provider cap deny independently; invalid fence rolls back allocations';

 job:=makeborne_private.cancel_generation_job(jobs[1],u,'Unknown external outcome');
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_reserved=24 and active_dispatches=2) then raise exception 'Unknown cancellation released global hold'; end if;
 begin perform makeborne_private.record_generation_outcome_core(jobs[1],d1,false,5,'openai','offline','fixture-v1','wrong-route',repeat('e',64),null); raise exception 'Operator route mismatch'; exception when sqlstate 'PT409' then null; end;
 oid:=makeborne_private.record_generation_outcome_core(jobs[1],d1,false,5,'anthropic','offline','fixture-v1','cancelled',repeat('e',64),null);
 select * into job from public.generation_jobs where id=jobs[1];
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,false,repeat('f',64));
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_spent=5 and vendor_reserved=12 and active_dispatches=1)
   or not exists(select 1 from makeborne_private.generation_execution_caps where scope='anthropic' and vendor_spent=5 and vendor_reserved=0 and active_dispatches=0) then raise exception 'Resolved cap release incorrect'; end if;
 raise notice 'PASS unknown outcomes retain both caps; operator reconciliation must match route and settles actual cost once';

 select * into job from public.generation_jobs where id=jobs[3];
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values(v,w2,job.artifact_id,1,'{}','{}',u,clock_timestamp());
 set local role service_role;
 begin perform makeborne_private.record_capped_generation_outcome(job.id,worker,1,d3,true,0,'anthropic','offline','fixture-v1','wrong',repeat('e',64),v); raise exception 'Worker switched provider'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.record_capped_generation_outcome(job.id,worker,1,d3,true,0,'openai','wrong-model','fixture-v1','wrong',repeat('e',64),v); raise exception 'Worker switched model'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.record_capped_generation_outcome(job.id,worker,1,d3,true,0,'openai','offline','wrong-tariff','wrong',repeat('e',64),v); raise exception 'Worker switched tariff'; exception when sqlstate 'PT409' then null; end;
 oid:=makeborne_private.record_capped_generation_outcome(job.id,worker,1,d3,true,0,'openai','offline','fixture-v1','success',repeat('e',64),v);
 reset role;
 select * into job from public.generation_jobs where id=jobs[3];
 create trigger capped_fixture_failure before insert on public.usage_ledger for each row execute function pg_temp.reject_capped_fixture_charge();
 begin perform makeborne_private.settle_generation_job(job.id,u,job.run_revision,true,repeat('f',64)); raise exception 'Injected failure ignored'; exception when sqlstate 'PT503' then null; end;
 drop trigger capped_fixture_failure on public.usage_ledger;
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_spent=5 and vendor_reserved=12 and active_dispatches=1)
   or exists(select 1 from makeborne_private.generation_job_settlements where job_id=job.id) then raise exception 'Cap settlement partially committed'; end if;
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,true,repeat('f',64));
 job:=makeborne_private.settle_generation_job(job.id,u,0,true,repeat('f',64));
 if not exists(select 1 from makeborne_private.generation_execution_caps where scope='global' and vendor_spent=5 and vendor_reserved=0 and active_dispatches=0)
   or not exists(select 1 from makeborne_private.generation_execution_caps where scope='openai' and vendor_spent=0 and vendor_reserved=0 and active_dispatches=0) then raise exception 'Zero-cost replay cap mismatch'; end if;
 raise notice 'PASS outcome cannot change approved provider; debit failure rolls back all cap counters; zero-cost settlement and replay are exact';

 update makeborne_private.generation_execution_caps set vendor_limit=24 where scope='anthropic';
 result:=makeborne_private.claim_capped_generation_dispatch(jobs[2],worker,1,gen_random_uuid());
 oid:=makeborne_private.record_capped_generation_outcome(jobs[2],worker,1,(result->>'dispatchId')::uuid,false,30,'anthropic','offline','fixture-v1','overrun',repeat('e',64),null);
 if (select count(*) from makeborne_private.generation_execution_caps where scope in ('global','anthropic') and emergency_stop)<>2 then raise exception 'Overrun did not stop global and provider'; end if;
 select * into job from public.generation_jobs where id=jobs[2];
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,false,repeat('f',64));
 if (select count(*) from makeborne_private.generation_execution_caps where scope in ('global','anthropic') and vendor_spent=35 and vendor_reserved=0 and active_dispatches=0 and vendor_limit=24 and emergency_stop)<>2 then raise exception 'Overrun cap costs hidden'; end if;
 begin update makeborne_private.generation_execution_holds set amount=0 where job_id=job.id; raise exception 'Cap audit rewritten'; exception when check_violation then null; end;
 raise notice 'PASS incurred overrun stops both authorities and retains full cost; immutable cap holds prevent audit rewrite';
end $$;
rollback;
