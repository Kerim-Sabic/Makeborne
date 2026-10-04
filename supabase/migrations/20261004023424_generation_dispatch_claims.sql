begin;
create table makeborne_private.generation_dispatches (
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null unique references makeborne_private.generation_reservations(id),
 request_key uuid not null unique,
 actor_id uuid not null references auth.users(id),
 started_at timestamptz not null default clock_timestamp()
);
alter table makeborne_private.generation_dispatches enable row level security;
revoke all on makeborne_private.generation_dispatches from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_dispatches to service_role;
create index generation_dispatches_actor on makeborne_private.generation_dispatches(actor_id);

-- Exactly one transaction gets a new claim. A repeated request NEVER grants
-- permission to repeat an external call, even if its original response was lost.
create function makeborne_private.claim_generation_dispatch(
 p_reservation_id uuid,p_request_key uuid,p_actor uuid,
 p_approval_hash text,p_current_input_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 reservation makeborne_private.generation_reservations%rowtype;
 proposal makeborne_private.generation_proposals%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 prior makeborne_private.generation_dispatches%rowtype;
 target_workspace uuid; owner_id uuid; member_role text; latest_id uuid; artifact_kind text;
begin
 if p_actor is null or p_request_key is null then raise exception 'Actor and dispatch request key required' using errcode='22023'; end if;
 select workspace_id into target_workspace from makeborne_private.generation_reservations where id=p_reservation_id;
 if not found then raise exception 'Reservation unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=target_workspace for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 -- Shared lock order with reservation and cancellation; no provider call in SQL.
 select * into budget from makeborne_private.generation_budgets where workspace_id=target_workspace for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if reservation.approved_by is distinct from p_actor then raise exception 'Original approving actor required' using errcode='42501'; end if;
 select * into proposal from makeborne_private.generation_proposals where id=reservation.proposal_id;
 if p_approval_hash is distinct from proposal.approval_hash or p_approval_hash is distinct from reservation.approval_hash or p_current_input_hash is distinct from proposal.input_hash then raise exception 'Proposal approval changed' using errcode='PT409'; end if;
 select * into prior from makeborne_private.generation_dispatches where reservation_id=reservation.id;
 if found then
   return jsonb_build_object('dispatchId',prior.id,'claimed',false,'startedAt',prior.started_at);
 end if;
 if reservation.status<>'reserved' or reservation.dispatch_started_at is not null then raise exception 'Reservation is not available for dispatch' using errcode='PT409'; end if;
 if not budget.spending_enabled or budget.emergency_stop then raise exception 'Generation spending disabled' using errcode='42501'; end if;
 if clock_timestamp()<proposal.prepared_at or clock_timestamp()>=proposal.expires_at then raise exception 'Proposal expired' using errcode='PT409'; end if;
 if budget.vendor_reserved<reservation.vendor_amount or budget.credit_reserved<reservation.credit_amount or budget.active_reservations<1 then raise exception 'Reservation counters require reconciliation' using errcode='PT409'; end if;
 if proposal.artifact_id is not null then
   select a.kind into artifact_kind from public.artifacts a where a.id=proposal.artifact_id and a.project_id=proposal.project_id and a.workspace_id=proposal.workspace_id for share;
   select v.id into latest_id from public.artifact_versions v where v.artifact_id=proposal.artifact_id and v.workspace_id=proposal.workspace_id order by v.version_number desc limit 1;
   if latest_id is distinct from proposal.base_version_id then raise exception 'Project version changed' using errcode='PT409'; end if;
 else
   select p.kind into artifact_kind from public.projects p where p.id=proposal.project_id and p.workspace_id=proposal.workspace_id for share;
 end if;
 if artifact_kind is distinct from proposal.snapshot#>>'{workflow,output}' then raise exception 'Project format changed' using errcode='PT409'; end if;
 if exists(select 1 from makeborne_private.generation_dispatches where request_key=p_request_key) then raise exception 'Dispatch request key reused' using errcode='PT409'; end if;
 insert into makeborne_private.generation_dispatches(reservation_id,request_key,actor_id)
 values(reservation.id,p_request_key,p_actor) returning * into prior;
 -- Until usage/result evidence resolves the job, its budgets must remain held.
 update makeborne_private.generation_reservations set dispatch_started_at=prior.started_at,status='uncertain' where id=reservation.id;
 return jsonb_build_object('dispatchId',prior.id,'claimed',true,'startedAt',prior.started_at);
end $$;
revoke all on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) to service_role;
comment on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) is 'Trusted worker only. Authenticate approving actor, verify canonical snapshot and current rights/route policy before calling. Commit and receive claimed=true before any external call. False, timeout or unknown commit outcome requires reconciliation, never blind redispatch. Claim is not proof of provider execution or a charge.';
commit;
