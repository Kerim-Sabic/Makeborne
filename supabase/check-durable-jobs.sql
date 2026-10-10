begin;
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 qs uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; k uuid:=gen_random_uuid();
 worker1 uuid:=gen_random_uuid(); worker2 uuid:=gen_random_uuid(); job public.generation_jobs%rowtype; other public.generation_jobs%rowtype;
 leased public.generation_jobs%rowtype; result jsonb; s jsonb; t timestamptz:=clock_timestamp(); i integer; rid uuid; prior_events integer;
begin
 insert into auth.users(id,email) values(u,'job-'||u||'@example.invalid'),(stranger,'job-'||stranger||'@example.invalid');
 insert into public.workspaces(id,name,owner_id) values(w,'Durable fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
 for i in 1..4 loop
   s:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat(chr(97+i),64),
     'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',w,'projectId',p,'artifactId',a),'baseVersionId',null),
     'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3',
     'preparedAt',t,'expiresAt',t+interval '1 hour','stages',jsonb_build_array('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)));
   insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
   values(qs[i],w,p,a,repeat('a',64),repeat(chr(97+i),64),s,12,3,t,t+interval '1 hour');
 end loop;
 insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values(w,true,100,30,10);
 begin perform makeborne_private.reserve_and_enqueue_generation_job(qs[1],k,u,repeat('b',64),repeat('a',64),t+interval '2 hours');
   raise exception 'Unexpected deadline'; exception when invalid_parameter_value then null; end;
 if exists(select 1 from makeborne_private.generation_reservations where workspace_id=w) then raise exception 'Failed enqueue retained reservation'; end if;
 raise notice 'PASS rejected enqueue rolls back budget and reservation together';
 job:=makeborne_private.reserve_and_enqueue_generation_job(qs[1],k,u,repeat('b',64),repeat('a',64),t+interval '10 minutes');
 other:=makeborne_private.reserve_and_enqueue_generation_job(qs[1],k,u,repeat('b',64),repeat('a',64),t+interval '10 minutes');
 if other.id<>job.id or (select count(*) from makeborne_private.generation_job_outbox where job_id=job.id)<>1 then raise exception 'Enqueue replay duplicated'; end if;
 if not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and vendor_reserved=12 and credit_reserved=3 and active_reservations=1) then raise exception 'Reservation counters differ'; end if;
 begin perform makeborne_private.reserve_and_enqueue_generation_job(qs[1],k,u,repeat('b',64),repeat('a',64),t+interval '11 minutes');
   raise exception 'Unexpected changed replay'; exception when sqlstate 'PT409' then null; end;
 raise notice 'PASS job, existing reservation and outbox enqueue are atomic and idempotent';
 set local role authenticated;
 begin perform makeborne_private.acquire_generation_job_lease(job.id,worker1,30); raise exception 'Browser lease'; exception when insufficient_privilege then null; end;
 reset role;
 set local role service_role;
 begin update public.generation_jobs set stage='forged' where id=job.id; raise exception 'Worker direct mutation'; exception when insufficient_privilege then null; end;
 begin insert into makeborne_private.generation_job_outbox(job_id,workspace_id,event_key,kind,run_revision) values(job.id,w,'forged','queued',0); raise exception 'Worker event forgery'; exception when insufficient_privilege then null; end;
 begin perform makeborne_private.claim_generation_dispatch_unfenced(job.reservation_id,k,u,repeat('b',64),repeat('a',64)); raise exception 'Unfenced core exposed'; exception when insufficient_privilege then null; end;
 begin perform makeborne_private.release_generation_reservation_unlinked(job.reservation_id,u,'bypass'); raise exception 'Release core exposed'; exception when insufficient_privilege then null; end;
 reset role;
 raise notice 'PASS browser dispatch and direct worker state/audit/core mutation denied';
 leased:=makeborne_private.acquire_generation_job_lease(job.id,worker1,30);
 if leased.fence<>1 or leased.lease_owner<>worker1 then raise exception 'First lease incorrect'; end if;
 other:=makeborne_private.acquire_generation_job_lease(job.id,worker2,30); if other.id is not null then raise exception 'Competing live lease'; end if;
 if makeborne_private.renew_generation_job_lease(job.id,worker2,1,30) then raise exception 'Stranger heartbeat'; end if;
 if not makeborne_private.renew_generation_job_lease(job.id,worker1,1,30) then raise exception 'Valid heartbeat failed'; end if;
 update public.generation_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=job.id;
 leased:=makeborne_private.acquire_generation_job_lease(job.id,worker2,30);
 if leased.fence<>2 then raise exception 'Recovery did not fence old worker'; end if;
 if makeborne_private.renew_generation_job_lease(job.id,worker1,1,30) then raise exception 'Stale heartbeat'; end if;
 begin perform makeborne_private.claim_generation_job_dispatch(job.id,worker1,1,gen_random_uuid()); raise exception 'Stale dispatch'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.claim_generation_dispatch(job.reservation_id,gen_random_uuid(),u,repeat('b',64),repeat('a',64)); raise exception 'Legacy bypass'; exception when sqlstate 'PT409' then null; end;
 begin perform makeborne_private.release_generation_reservation(job.reservation_id,u,'Legacy bypass'); raise exception 'Legacy release bypass'; exception when sqlstate 'PT409' then null; end;
 raise notice 'PASS lease recovery increments fence; stale workers and legacy paths cannot bypass it';
 result:=makeborne_private.claim_generation_job_dispatch(job.id,worker2,2,k); if result->>'claimed'<>'true' then raise exception 'First dispatch failed'; end if;
 result:=makeborne_private.claim_generation_job_dispatch(job.id,worker2,2,k); if result->>'claimed'<>'false' then raise exception 'Dispatch repeated'; end if;
 if (select count(*) from makeborne_private.generation_dispatches where reservation_id=job.reservation_id)<>1
   or (select count(*) from makeborne_private.generation_job_outbox where job_id=job.id and kind='dispatch_intent')<>1 then raise exception 'Duplicate dispatch intent'; end if;
 update public.generation_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=job.id;
 leased:=makeborne_private.acquire_generation_job_lease(job.id,worker1,30);
 if leased.status<>'awaiting_reconciliation' or leased.lease_owner is not null then raise exception 'Unknown outcome redispatched'; end if;
 other:=makeborne_private.cancel_generation_job(job.id,u,'Cancel after unknown provider outcome');
 if other.status<>'awaiting_reconciliation' or not exists(select 1 from makeborne_private.generation_reservations where id=job.reservation_id and status='uncertain') then raise exception 'Unknown hold released'; end if;
 raise notice 'PASS one dispatch intent; lost worker and cancellation retain uncertain holds without redispatch';
 other:=makeborne_private.reserve_and_enqueue_generation_job(qs[2],gen_random_uuid(),u,repeat('c',64),repeat('a',64),t+interval '10 minutes');
 begin perform makeborne_private.cancel_generation_job(other.id,stranger,'Not permitted'); raise exception 'Foreign cancel'; exception when insufficient_privilege then null; end;
 leased:=makeborne_private.acquire_generation_job_lease(other.id,worker1,30);
 other:=makeborne_private.cancel_generation_job(other.id,u,'Before dispatch');
 prior_events:=(select count(*) from makeborne_private.generation_job_outbox where job_id=other.id);
 other:=makeborne_private.cancel_generation_job(other.id,u,'Replay cancellation');
 if other.status<>'cancelled' or (select count(*) from makeborne_private.generation_job_outbox where job_id=other.id)<>prior_events then raise exception 'Cancellation replay changed state'; end if;
 begin perform makeborne_private.claim_generation_job_dispatch(other.id,worker1,leased.fence,gen_random_uuid()); raise exception 'Cancelled dispatch'; exception when sqlstate 'PT409' then null; end;
 if not exists(select 1 from makeborne_private.generation_reservations where id=other.reservation_id and status='released') then raise exception 'Unused reservation not released'; end if;
 raise notice 'PASS pre-dispatch cancellation releases once and invalidates active workers';
 other:=makeborne_private.reserve_and_enqueue_generation_job(qs[3],gen_random_uuid(),u,repeat('d',64),repeat('a',64),t+interval '10 minutes');
 update public.generation_jobs set deadline_at=clock_timestamp()-interval '1 second' where id=other.id;
 other:=makeborne_private.acquire_generation_job_lease(other.id,worker1,30);
 if other.status<>'cancelled' then raise exception 'Deadline did not cancel unused job'; end if;
 if not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and vendor_reserved=12 and credit_reserved=3 and active_reservations=1 and vendor_spent=0 and credit_spent=0) then raise exception 'Accounting did not reconcile'; end if;
 raise notice 'PASS deadline releases unused work; unresolved provider hold remains exact and uncharged';
end $$;
rollback;
