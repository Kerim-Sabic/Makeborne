begin;
create function pg_temp.reject_fixture_charge() returns trigger language plpgsql as $$
begin
 if new.reason='accepted_work' then raise exception 'Injected ledger failure' using errcode='PT503'; end if;
 return new;
end $$;
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 qs uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 jobs uuid[]:='{}'; worker uuid:=gen_random_uuid(); job public.generation_jobs%rowtype; dispatch uuid; outcome uuid; replay uuid;
 version_id uuid:=gen_random_uuid(); foreign_a uuid:=gen_random_uuid(); unrelated_a uuid:=gen_random_uuid(); foreign_v uuid:=gen_random_uuid(); target_a uuid; i integer;
 s jsonb; t timestamptz:=clock_timestamp(); initial_revision bigint;
begin
 insert into auth.users(id,email) values(u,'settlement-'||u||'@example.invalid'),(stranger,'settlement-'||stranger||'@example.invalid');
 insert into public.workspaces(id,name,owner_id) values(w,'Rolled back accounting fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website'),(foreign_a,w,p,'Other','website'),(unrelated_a,w,p,'Unrelated','website');
 insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values(w,true,60,15,10);
 for i in 1..5 loop
   target_a:=case when i=1 then a else foreign_a end;
   s:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat(chr(97+i),64),
     'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',w,'projectId',p,'artifactId',target_a),'baseVersionId',null),
     'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3',
     'preparedAt',t,'expiresAt',t+interval '1 hour','stages',jsonb_build_array('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)));
   insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
   values(qs[i],w,p,target_a,repeat('a',64),repeat(chr(97+i),64),s,12,3,t,t+interval '1 hour');
   job:=makeborne_private.reserve_and_enqueue_generation_job(qs[i],gen_random_uuid(),u,repeat(chr(97+i),64),repeat('a',64),t+interval '10 minutes');
   jobs:=array_append(jobs,job.id);
 end loop;
 begin perform makeborne_private.settle_generation_job(jobs[1],u,0,false,repeat('f',64)); raise exception 'Unknown charged'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.record_generation_outcome_core(jobs[1],gen_random_uuid(),false,0,'offline','offline','test-v1','never-dispatched',repeat('e',64),null);
   raise exception 'No-dispatch outcome'; exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from public.usage_ledger where workspace_id=w) then raise exception 'Invalid outcome wrote ledger'; end if;
 raise notice 'PASS unknown and undispatched outcomes cannot settle or create cost evidence';

 job:=makeborne_private.acquire_generation_job_lease(jobs[1],worker,120);
 dispatch:=(makeborne_private.claim_generation_job_dispatch(job.id,worker,job.fence,gen_random_uuid())->>'dispatchId')::uuid;
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at)
 values(version_id,w,a,1,'{"title":"Saved generated result"}','{}',u,clock_timestamp()),(foreign_v,w,unrelated_a,1,'{}','{}',u,clock_timestamp());
 begin perform makeborne_private.record_generation_job_outcome(job.id,worker,job.fence-1,dispatch,true,8,'offline','offline','test-v1','success',repeat('e',64),version_id);
   raise exception 'Stale outcome accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,true,8,'offline','offline','test-v1','success',repeat('e',64),foreign_v);
   raise exception 'Foreign result accepted'; exception when sqlstate 'PT409' then null; end;
 outcome:=makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,true,8,'offline','offline','test-v1','success',repeat('e',64),version_id);
 replay:=makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,true,8,'offline','offline','test-v1','success',repeat('e',64),version_id);
 if replay<>outcome or (select count(*) from public.usage_ledger where job_id=job.id)<>1 then raise exception 'Outcome replay duplicated'; end if;
 begin perform makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,true,9,'offline','offline','test-v1','success',repeat('e',64),version_id);
   raise exception 'Conflicting outcome replay'; exception when sqlstate 'PT409' then null; end;
 if not exists(select 1 from makeborne_private.generation_provider_outcomes where id=outcome and result_version_id=version_id and result_hash=encode(extensions.digest(convert_to(jsonb_build_object('content','{"title":"Saved generated result"}'::jsonb,'style','{}'::jsonb,'assets','[]'::jsonb)::text,'UTF8'),'sha256'),'hex')) then raise exception 'Wrong result digest'; end if;
 raise notice 'PASS live fenced outcome binds exact saved result; stale, foreign and conflicting replays denied';
 select * into job from public.generation_jobs where id=jobs[1]; initial_revision:=job.run_revision;
 begin perform makeborne_private.settle_generation_job(job.id,stranger,job.run_revision,true,repeat('f',64)); raise exception 'Foreign settlement'; exception when insufficient_privilege then null; end;
 begin perform makeborne_private.settle_generation_job(job.id,u,job.run_revision-1,true,repeat('f',64)); raise exception 'Stale settlement'; exception when sqlstate 'PT409' then null; end;
 create trigger fixture_charge_failure before insert on public.usage_ledger for each row execute function pg_temp.reject_fixture_charge();
 begin perform makeborne_private.settle_generation_job(job.id,u,job.run_revision,true,repeat('f',64)); raise exception 'Injected failure ignored'; exception when sqlstate 'PT503' then null; end;
 drop trigger fixture_charge_failure on public.usage_ledger;
 if exists(select 1 from makeborne_private.generation_job_settlements where job_id=job.id)
   or exists(select 1 from public.usage_ledger where job_id=job.id and account='customer_credits')
   or not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and credit_spent=0 and credit_reserved=15 and vendor_reserved=60) then raise exception 'Partial settlement survived failed charge'; end if;
 raise notice 'PASS injected debit failure rolls back settlement and all reservation counters together';
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,true,repeat('f',64));
 job:=makeborne_private.settle_generation_job(job.id,u,initial_revision,true,repeat('f',64));
 if job.status<>'succeeded' or (select count(*) from public.usage_ledger where job_id=job.id)<>2
   or not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and vendor_spent=8 and credit_spent=3 and vendor_reserved=48 and credit_reserved=12 and active_reservations=4) then raise exception 'Accepted accounting mismatch'; end if;
 begin perform makeborne_private.settle_generation_job(job.id,u,initial_revision,false,repeat('f',64)); raise exception 'Changed review replay'; exception when sqlstate 'PT409' then null; end;
 raise notice 'PASS accepted settlement atomically charges exact quoted credits once and releases unused vendor hold';

 -- Remaining jobs target their originally approved, still-empty artifact.
 job:=makeborne_private.acquire_generation_job_lease(jobs[2],worker,120);
 dispatch:=(makeborne_private.claim_generation_job_dispatch(job.id,worker,job.fence,gen_random_uuid())->>'dispatchId')::uuid;
 begin perform makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,false,5,'offline','offline','test-v1','success',repeat('e',64),null);
   raise exception 'Provider response charged twice'; exception when unique_violation then null; end;
 if exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) or exists(select 1 from public.usage_ledger where job_id=job.id) then raise exception 'Duplicate response left partial evidence'; end if;
 outcome:=makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,false,5,'offline','offline','test-v1','failure',repeat('e',64),null);
 select * into job from public.generation_jobs where id=jobs[2];
 begin perform makeborne_private.settle_generation_job(job.id,u,job.run_revision,true,repeat('f',64)); raise exception 'Failed accepted'; exception when sqlstate 'PT409' then null; end;
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,false,repeat('f',64));
 if job.status<>'failed' or exists(select 1 from public.usage_ledger where job_id=job.id and account='customer_credits') then raise exception 'Failure charged customer'; end if;
 raise notice 'PASS failed output records actual provider expense and charges no customer credits';

 job:=makeborne_private.acquire_generation_job_lease(jobs[3],worker,120);
 dispatch:=(makeborne_private.claim_generation_job_dispatch(job.id,worker,job.fence,gen_random_uuid())->>'dispatchId')::uuid;
 job:=makeborne_private.cancel_generation_job(job.id,u,'Cancelled while response unknown');
 begin perform makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,false,4,'offline','offline','test-v1','cancelled',repeat('e',64),null);
   raise exception 'Cancelled worker attested'; exception when sqlstate 'PT409' then null; end;
 begin execute 'set local role service_role'; perform makeborne_private.record_generation_outcome_core(job.id,dispatch,false,4,'offline','offline','test-v1','cancelled',repeat('e',64),null);
   raise exception 'Worker reconciled'; exception when insufficient_privilege then execute 'reset role'; end;
 outcome:=makeborne_private.record_generation_outcome_core(job.id,dispatch,false,4,'offline','offline','test-v1','cancelled',repeat('e',64),null);
 select * into job from public.generation_jobs where id=jobs[3];
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,false,repeat('f',64));
 if job.status<>'cancelled' then raise exception 'Reconciled cancellation incorrect'; end if;
 raise notice 'PASS cancelled workers cannot attest; explicit operator reconciliation resolves actual cost without a refund';

 job:=makeborne_private.acquire_generation_job_lease(jobs[4],worker,120);
 dispatch:=(makeborne_private.claim_generation_job_dispatch(job.id,worker,job.fence,gen_random_uuid())->>'dispatchId')::uuid;
 outcome:=makeborne_private.record_generation_job_outcome(job.id,worker,job.fence,dispatch,false,9007199254740993,'offline','offline','test-v1','overrun',repeat('e',64),null);
 if not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and emergency_stop) then raise exception 'Overrun did not stop spending'; end if;
 job:=makeborne_private.acquire_generation_job_lease(jobs[5],worker,120);
 begin perform makeborne_private.claim_generation_job_dispatch(job.id,worker,job.fence,gen_random_uuid()); raise exception 'Overrun allowed next dispatch'; exception when insufficient_privilege then null; end;
 select * into job from public.generation_jobs where id=jobs[4];
 job:=makeborne_private.settle_generation_job(job.id,u,job.run_revision,false,repeat('f',64));
 if job.error_code<>'vendor_cost_overrun' then raise exception 'Overrun hidden'; end if;
 job:=makeborne_private.cancel_generation_job(jobs[5],u,'Stopped after vendor overrun');
 if not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and vendor_spent=9007199254741010 and credit_spent=3 and vendor_reserved=0 and credit_reserved=0 and active_reservations=0 and vendor_limit=60 and emergency_stop)
   or (select sum(amount_microusd) from public.usage_ledger where workspace_id=w and reason='provider_cost')<>9007199254741010
   or (select sum(customer_credits) from public.usage_ledger where workspace_id=w and reason='accepted_work')<>3 then raise exception 'Final ledger does not reconcile'; end if;
 raise notice 'PASS exact integer cost above JavaScript safe range is preserved, stops dispatch and never expands customer charge';

 begin update public.usage_ledger set amount_microusd=0 where workspace_id=w; raise exception 'Ledger rewritten'; exception when check_violation then null; end;
 begin delete from makeborne_private.generation_provider_outcomes where workspace_id=w; raise exception 'Outcome erased'; exception when check_violation then null; end;
 begin update makeborne_private.generation_job_settlements set customer_credits=0 where workspace_id=w; raise exception 'Settlement rewritten'; exception when check_violation then null; end;
 if has_table_privilege('authenticated','public.usage_ledger','select') or has_table_privilege('service_role','public.usage_ledger','insert')
   or has_function_privilege('authenticated','makeborne_private.settle_generation_job(uuid,uuid,bigint,boolean,text)','execute') then raise exception 'Accounting grants too broad'; end if;
 raise notice 'PASS accounting evidence is append-only; browser model details and direct worker ledger writes denied';
end $$;
rollback;
