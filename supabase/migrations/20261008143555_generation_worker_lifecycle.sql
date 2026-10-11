begin;

-- Group roles only: provisioning a dedicated login/credential is a separate
-- deployment step. Neither role inherits service_role or bypasses RLS.
create role makeborne_generation_publisher nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
create role makeborne_generation_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
-- Supabase's postgres operator is not a superuser; PG17 role creation grants
-- administration but not SET by default. Permit explicit operator qualification
-- without implicit privilege inheritance. No application role gets membership.
grant makeborne_generation_publisher,makeborne_generation_worker to postgres with set true;
grant makeborne_generation_publisher,makeborne_generation_worker to postgres with inherit false;
grant usage on schema makeborne_private to makeborne_generation_publisher,makeborne_generation_worker;

-- Selection must retain its row lock in the publisher's explicit transaction.
-- The publisher receives only routing IDs, never general table UPDATE access.
create function makeborne_private.lock_next_generation_outbox()
returns table(id uuid,job_id uuid,workspace_id uuid)
language sql security definer set search_path='' as $$
 select e.id,e.job_id,e.workspace_id from makeborne_private.generation_job_outbox e
 join public.generation_jobs j on j.id=e.job_id and j.workspace_id=e.workspace_id
 where e.kind='queued' and e.published_at is null and j.status in ('queued','running') and j.cancel_requested_at is null
   and not exists(select 1 from makeborne_private.generation_provider_outcomes o where o.job_id=j.id)
 order by e.created_at,e.id limit 1 for update of e skip locked
$$;
revoke all on function makeborne_private.lock_next_generation_outbox() from public,anon,authenticated,service_role;
grant execute on function makeborne_private.lock_next_generation_outbox() to makeborne_generation_publisher;
grant execute on function makeborne_private.ack_generation_job_outbox(uuid,uuid) to makeborne_generation_publisher;

create function makeborne_private.lease_queued_generation_job(
 p_event uuid,p_queue_job uuid,p_job uuid,p_workspace uuid,p_worker uuid,p_seconds integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; leased public.generation_jobs%rowtype;
begin
 if p_event is null or p_queue_job is distinct from p_event or not exists(
   select 1 from makeborne_private.generation_job_outbox e where e.id=p_event and e.job_id=p_job
     and e.workspace_id=p_workspace and e.kind='queued' and e.published_at is not null and e.queue_job_id=p_queue_job
 ) then raise exception 'Published queue identity required' using errcode='42501'; end if;
 job:=makeborne_private.lock_generation_job(p_job);
 if job.workspace_id is distinct from p_workspace then raise exception 'Queue scope changed' using errcode='42501'; end if;
 if job.status not in ('queued','running') or job.cancel_requested_at is not null then
   return jsonb_build_object('state','terminal');
 end if;
 -- Confirmation can survive a consumer crash before queue completion. Never
 -- turn that known outcome into another call or an unknown-outcome receipt.
 if exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) then
   return jsonb_build_object('state','review');
 end if;
 leased:=makeborne_private.acquire_generation_job_lease(job.id,p_worker,p_seconds);
 if leased.id is null then return jsonb_build_object('state','busy'); end if;
 if leased.status<>'running' then return jsonb_build_object('state','terminal'); end if;
 return jsonb_build_object('state','leased','jobId',leased.id,'workspaceId',leased.workspace_id,
   'workerId',leased.lease_owner,'fence',leased.fence::text,'deadlineAt',leased.deadline_at,'leaseExpiresAt',leased.lease_expires_at);
end $$;
revoke all on function makeborne_private.lease_queued_generation_job(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.lease_queued_generation_job(uuid,uuid,uuid,uuid,uuid,integer) to makeborne_generation_worker;
grant execute on function makeborne_private.renew_generation_job_lease(uuid,uuid,bigint,integer) to makeborne_generation_worker;
grant execute on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) to makeborne_generation_worker;
grant execute on function makeborne_private.record_capped_generation_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) to makeborne_generation_worker;

alter table makeborne_private.generation_job_outbox drop constraint generation_job_outbox_kind_check;
alter table makeborne_private.generation_job_outbox add constraint generation_job_outbox_kind_check
 check(kind in ('queued','leased','dispatch_intent','cancelled','reconciliation_required','outcome_confirmed','settled','worker_released'));

-- End a worker turn without inventing provider evidence or releasing money.
-- Unused work gets a durable wake-up; dispatched work retains every hold.
create function makeborne_private.yield_generation_job_lease(p_job uuid,p_worker uuid,p_fence bigint)
returns text language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; reservation makeborne_private.generation_reservations%rowtype; next_state text;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if job.status not in ('queued','running') or job.cancel_requested_at is not null then return 'terminal'; end if;
 if job.lease_owner is distinct from p_worker or job.fence is distinct from p_fence then return 'stale'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 if exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) then next_state:='review';
 elsif reservation.dispatch_started_at is not null or reservation.status='uncertain' then next_state:='reconciliation';
 else next_state:='queued'; end if;
 update public.generation_jobs set
   status=case next_state when 'queued' then 'queued' when 'reconciliation' then 'awaiting_reconciliation' else status end,
   stage=case next_state when 'queued' then 'queued' when 'reconciliation' then 'provider_outcome_unknown' else stage end,
   lease_owner=null,lease_expires_at=null,fence=fence+1,run_revision=run_revision+1,updated_at=clock_timestamp()
 where id=job.id returning * into job;
 perform makeborne_private.append_generation_job_event(job,
   case next_state when 'queued' then 'queued' when 'reconciliation' then 'reconciliation_required' else 'worker_released' end);
 return next_state;
end $$;
revoke all on function makeborne_private.yield_generation_job_lease(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.yield_generation_job_lease(uuid,uuid,bigint) to makeborne_generation_worker;

comment on role makeborne_generation_worker is 'Restricted generation lifecycle group. No login, table writes, settlement, account privileges or uncapped dispatch. Queue runtime DML grants are installed separately after operator pg-boss schema provisioning.';
comment on role makeborne_generation_publisher is 'Restricted transactional outbox publisher group. No login or application table writes. Use a dedicated checked-out client and commit queue insert/ack together.';
commit;
