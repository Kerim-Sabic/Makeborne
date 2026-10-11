begin;

-- Reuse existing job/reservation authorities; outbox rows contain no prompts or
-- provider configuration. Legacy rows remain readable but are not leaseable.
alter table makeborne_private.generation_reservations add constraint generation_reservation_scope unique(id,workspace_id);
alter table public.generation_jobs
  add column reservation_id uuid unique,
  add column deadline_at timestamptz,
  add column lease_owner uuid,
  add column lease_expires_at timestamptz,
  add column fence bigint not null default 0 check(fence between 0 and 9007199254740991),
  add column run_revision bigint not null default 0 check(run_revision>=0),
  add column cancel_requested_at timestamptz,
  add constraint job_reservation_scope foreign key(reservation_id,workspace_id) references makeborne_private.generation_reservations(id,workspace_id),
  add constraint job_lease_pair check((lease_owner is null)=(lease_expires_at is null)),
  add constraint job_durable_deadline check(reservation_id is null or deadline_at is not null);
create index generation_jobs_recovery on public.generation_jobs(lease_expires_at,created_at)
  where reservation_id is not null and status in ('queued','running');
revoke insert,update,delete,truncate,references,trigger on public.generation_jobs from anon,authenticated,service_role;

create table makeborne_private.generation_job_outbox (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null,
 workspace_id uuid not null,
 event_key text not null unique,
 kind text not null check(kind in ('queued','leased','dispatch_intent','cancelled','reconciliation_required')),
 run_revision bigint not null check(run_revision>=0),
 created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
 queue_job_id uuid,
 check((published_at is null)=(queue_job_id is null)),
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id)
);
alter table makeborne_private.generation_job_outbox enable row level security;
revoke all on makeborne_private.generation_job_outbox from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_job_outbox to service_role;
create index generation_job_outbox_pending on makeborne_private.generation_job_outbox(created_at,id) where kind='queued' and published_at is null;
create index generation_job_outbox_scope on makeborne_private.generation_job_outbox(job_id,workspace_id,run_revision);

create function makeborne_private.append_generation_job_event(p_job public.generation_jobs,p_kind text) returns void
language sql security definer set search_path='' as $$
 insert into makeborne_private.generation_job_outbox(job_id,workspace_id,event_key,kind,run_revision)
 values(p_job.id,p_job.workspace_id,p_job.id::text||':'||p_kind||':'||p_job.run_revision::text,p_kind,p_job.run_revision)
 on conflict(event_key) do nothing;
$$;
revoke all on function makeborne_private.append_generation_job_event(public.generation_jobs,text) from public,anon,authenticated,service_role;

-- Every lifecycle mutation takes locks in the existing reservation order.
create function makeborne_private.lock_generation_job(p_job uuid) returns public.generation_jobs
language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype;
begin
 select * into job from public.generation_jobs where id=p_job;
 if not found or job.reservation_id is null then raise exception 'Durable job unavailable' using errcode='P0002'; end if;
 perform 1 from public.workspaces where id=job.workspace_id for share;
 perform 1 from makeborne_private.generation_budgets where workspace_id=job.workspace_id for update;
 perform 1 from makeborne_private.generation_reservations where id=job.reservation_id for update;
 select * into job from public.generation_jobs where id=p_job for update;
 return job;
end $$;
revoke all on function makeborne_private.lock_generation_job(uuid) from public,anon,authenticated,service_role;

create function makeborne_private.reserve_and_enqueue_generation_job(
 p_proposal uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_input_hash text,p_deadline timestamptz
) returns public.generation_jobs language plpgsql security definer set search_path='' as $$
declare rid uuid; reservation makeborne_private.generation_reservations%rowtype;
 proposal makeborne_private.generation_proposals%rowtype; job public.generation_jobs%rowtype;
begin
 rid:=makeborne_private.reserve_generation_proposal(p_proposal,p_request_key,p_actor,p_approval_hash,p_input_hash);
 select * into reservation from makeborne_private.generation_reservations where id=rid for update;
 select * into proposal from makeborne_private.generation_proposals where id=p_proposal;
 select * into job from public.generation_jobs where reservation_id=rid;
 if found then
   if job.deadline_at is distinct from p_deadline then raise exception 'Job replay changed deadline' using errcode='PT409'; end if;
   return job;
 end if;
 if reservation.status<>'reserved' or reservation.dispatch_started_at is not null then raise exception 'Reservation unavailable for queue' using errcode='PT409'; end if;
 if p_deadline is null or p_deadline<=clock_timestamp() or p_deadline>proposal.expires_at
   or p_deadline>clock_timestamp()+interval '30 minutes' then raise exception 'Job deadline outside approved window' using errcode='22023'; end if;
 insert into public.generation_jobs(workspace_id,project_id,artifact_id,kind,idempotency_key,reservation_id,deadline_at)
 values(proposal.workspace_id,proposal.project_id,proposal.artifact_id,proposal.snapshot#>>'{workflow,output}',p_request_key::text,rid,p_deadline)
 returning * into job;
 perform makeborne_private.append_generation_job_event(job,'queued');
 return job;
end $$;
revoke all on function makeborne_private.reserve_and_enqueue_generation_job(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function makeborne_private.reserve_and_enqueue_generation_job(uuid,uuid,uuid,text,text,timestamptz) to service_role;

-- Coordinate older cancellation callers with the job lifecycle as well.
alter function makeborne_private.release_generation_reservation(uuid,uuid,text) rename to release_generation_reservation_unlinked;
revoke all on function makeborne_private.release_generation_reservation_unlinked(uuid,uuid,text) from public,anon,authenticated,service_role;
create function makeborne_private.release_generation_reservation(p_reservation_id uuid,p_actor uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select workspace_id into target from makeborne_private.generation_reservations where id=p_reservation_id;
 perform 1 from public.workspaces where id=target for share;
 perform 1 from makeborne_private.generation_budgets where workspace_id=target for update;
 perform 1 from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if exists(select 1 from public.generation_jobs where reservation_id=p_reservation_id) then
   raise exception 'Cancel the durable job to release its reservation' using errcode='PT409';
 end if;
 return makeborne_private.release_generation_reservation_unlinked(p_reservation_id,p_actor,p_reason);
end $$;
revoke all on function makeborne_private.release_generation_reservation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function makeborne_private.release_generation_reservation(uuid,uuid,text) to service_role;

create function makeborne_private.cancel_generation_job(p_job uuid,p_actor uuid,p_reason text) returns public.generation_jobs
language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; reservation makeborne_private.generation_reservations%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if p_actor is null or not exists(select 1 from public.workspaces w where w.id=job.workspace_id and w.owner_id=p_actor)
   and not exists(select 1 from public.workspace_members m where m.workspace_id=job.workspace_id and m.user_id=p_actor and m.role='editor')
   then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'Cancellation reason required' using errcode='22023'; end if;
 if job.status in ('succeeded','failed','cancelled') then return job; end if;
 if job.cancel_requested_at is not null then return job; end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 if reservation.dispatch_started_at is null and reservation.status='reserved' then
   perform makeborne_private.release_generation_reservation_unlinked(reservation.id,p_actor,p_reason);
   update public.generation_jobs set status='cancelled',stage='cancelled',cancel_requested_at=clock_timestamp(),
     lease_owner=null,lease_expires_at=null,fence=fence+1,run_revision=run_revision+1,updated_at=clock_timestamp()
     where id=job.id returning * into job;
   perform makeborne_private.append_generation_job_event(job,'cancelled');
 else
   update public.generation_jobs set status='awaiting_reconciliation',stage='provider_outcome_unknown',cancel_requested_at=clock_timestamp(),
     lease_owner=null,lease_expires_at=null,fence=fence+1,run_revision=run_revision+1,updated_at=clock_timestamp()
     where id=job.id returning * into job;
   perform makeborne_private.append_generation_job_event(job,'reconciliation_required');
 end if;
 return job;
end $$;
revoke all on function makeborne_private.cancel_generation_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function makeborne_private.cancel_generation_job(uuid,uuid,text) to service_role;

create function makeborne_private.acquire_generation_job_lease(p_job uuid,p_worker uuid,p_seconds integer)
returns public.generation_jobs language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; reservation makeborne_private.generation_reservations%rowtype; moment timestamptz:=clock_timestamp();
begin
 if p_worker is null or p_seconds is null or p_seconds not between 1 and 120 then raise exception 'Bounded worker lease required' using errcode='22023'; end if;
 job:=makeborne_private.lock_generation_job(p_job); moment:=clock_timestamp();
 if job.status not in ('queued','running') or job.cancel_requested_at is not null then return null; end if;
 if job.lease_expires_at>moment then
   if job.lease_owner=p_worker then return job; else return null; end if;
 end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 if reservation.dispatch_started_at is not null or reservation.status='uncertain' then
   update public.generation_jobs set status='awaiting_reconciliation',stage='provider_outcome_unknown',
     lease_owner=null,lease_expires_at=null,fence=fence+1,run_revision=run_revision+1,updated_at=moment where id=job.id returning * into job;
   perform makeborne_private.append_generation_job_event(job,'reconciliation_required'); return job;
 end if;
 if job.deadline_at<=moment then
   return makeborne_private.cancel_generation_job(job.id,reservation.approved_by,'Job deadline expired before dispatch');
 end if;
 if reservation.status<>'reserved' then raise exception 'Job reservation requires reconciliation' using errcode='PT409'; end if;
 update public.generation_jobs set status='running',stage='preparing',lease_owner=p_worker,
   lease_expires_at=least(moment+make_interval(secs=>p_seconds),deadline_at),fence=fence+1,
   run_revision=run_revision+1,updated_at=moment where id=job.id returning * into job;
 perform makeborne_private.append_generation_job_event(job,'leased'); return job;
end $$;
revoke all on function makeborne_private.acquire_generation_job_lease(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function makeborne_private.acquire_generation_job_lease(uuid,uuid,integer) to service_role;

create function makeborne_private.renew_generation_job_lease(p_job uuid,p_worker uuid,p_fence bigint,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; moment timestamptz;
begin
 if p_seconds is null or p_seconds not between 1 and 120 then raise exception 'Bounded worker lease required' using errcode='22023'; end if;
 job:=makeborne_private.lock_generation_job(p_job); moment:=clock_timestamp();
 if job.status<>'running' or job.cancel_requested_at is not null or job.lease_owner is distinct from p_worker
   or job.fence is distinct from p_fence or job.lease_expires_at is null or job.lease_expires_at<=moment or job.deadline_at<=moment then return false; end if;
 update public.generation_jobs set lease_expires_at=least(moment+make_interval(secs=>p_seconds),deadline_at),
   run_revision=run_revision+1,updated_at=moment where id=job.id;
 return true;
end $$;
revoke all on function makeborne_private.renew_generation_job_lease(uuid,uuid,bigint,integer) from public,anon,authenticated;
grant execute on function makeborne_private.renew_generation_job_lease(uuid,uuid,bigint,integer) to service_role;

-- Preserve the tested legacy guard behind a non-callable implementation. Durable
-- reservations cannot bypass fencing through the old worker entry point.
alter function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) rename to claim_generation_dispatch_unfenced;
revoke all on function makeborne_private.claim_generation_dispatch_unfenced(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function makeborne_private.claim_generation_dispatch(p_reservation_id uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_current_input_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 -- Serialize against enqueue before checking linkage; an unlocked EXISTS could
 -- miss an uncommitted job and later bypass its fencing after waiting on budget.
 select workspace_id into target from makeborne_private.generation_reservations where id=p_reservation_id;
 perform 1 from public.workspaces where id=target for share;
 perform 1 from makeborne_private.generation_budgets where workspace_id=target for update;
 perform 1 from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if exists(select 1 from public.generation_jobs where reservation_id=p_reservation_id) then
   raise exception 'Durable dispatch requires current worker fencing' using errcode='PT409';
 end if;
 return makeborne_private.claim_generation_dispatch_unfenced(p_reservation_id,p_request_key,p_actor,p_approval_hash,p_current_input_hash);
end $$;
revoke all on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) to service_role;

create function makeborne_private.claim_generation_job_dispatch(p_job uuid,p_worker uuid,p_fence bigint,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; reservation makeborne_private.generation_reservations%rowtype;
 proposal makeborne_private.generation_proposals%rowtype; result jsonb;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if job.status<>'running' or job.cancel_requested_at is not null or job.lease_owner is distinct from p_worker
   or job.fence is distinct from p_fence or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
   or job.deadline_at<=clock_timestamp() then raise exception 'Worker lease is stale or job is not dispatchable' using errcode='PT409'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 select * into proposal from makeborne_private.generation_proposals where id=reservation.proposal_id;
 result:=makeborne_private.claim_generation_dispatch_unfenced(reservation.id,p_request_key,reservation.approved_by,proposal.approval_hash,proposal.input_hash);
 if result->>'claimed'='true' then
   update public.generation_jobs set stage='provider_dispatch',attempt=attempt+1,run_revision=run_revision+1,
     updated_at=clock_timestamp() where id=job.id returning * into job;
   perform makeborne_private.append_generation_job_event(job,'dispatch_intent');
 end if;
 return result;
end $$;
revoke all on function makeborne_private.claim_generation_job_dispatch(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function makeborne_private.claim_generation_job_dispatch(uuid,uuid,bigint,uuid) to service_role;

create function makeborne_private.ack_generation_job_outbox(p_event uuid,p_queue_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare event makeborne_private.generation_job_outbox%rowtype;
begin
 if p_queue_job is null or p_queue_job is distinct from p_event then raise exception 'Queue identity must match outbox event' using errcode='22023'; end if;
 select * into event from makeborne_private.generation_job_outbox where id=p_event and kind='queued' for update;
 if not found then raise exception 'Queued outbox event unavailable' using errcode='P0002'; end if;
 if event.published_at is not null then return false; end if;
 update makeborne_private.generation_job_outbox set queue_job_id=p_queue_job,published_at=clock_timestamp() where id=p_event;
 return true;
end $$;
revoke all on function makeborne_private.ack_generation_job_outbox(uuid,uuid) from public,anon,authenticated;
grant execute on function makeborne_private.ack_generation_job_outbox(uuid,uuid) to service_role;
comment on table makeborne_private.generation_job_outbox is 'Atomic job wake-up/progress events. Trusted publisher sends to pg-boss and acknowledges on the same database connection/transaction. No paid dispatch is enabled by this migration.';
comment on function makeborne_private.claim_generation_job_dispatch(uuid,uuid,bigint,uuid) is 'Trusted worker only. Recheck actor/session, current rights and routing, global/provider budgets before invocation. Commit and receive claimed=true before external work. Lost commit response requires reconciliation, never blind redispatch. Settlement and multi-stage attempts remain separate work.';
commit;
