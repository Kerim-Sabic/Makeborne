begin;

-- Grants bind to an immutable Auth user ID. No email allowlist, editable user
-- metadata, client-supplied role or synthetic credit balance can authorize one.
create table makeborne_private.account_privileges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  unlimited_credits boolean not null default false,
  reason text not null check(length(reason) between 1 and 500),
  updated_at timestamptz not null default now()
);
create table makeborne_private.account_privilege_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null check(action in ('INSERT','UPDATE','DELETE')),
  old_grant jsonb,
  new_grant jsonb,
  database_actor text not null,
  created_at timestamptz not null default now()
);
create index account_privilege_events_user on makeborne_private.account_privilege_events(user_id,created_at desc);
alter table makeborne_private.account_privileges enable row level security;
alter table makeborne_private.account_privilege_events enable row level security;
revoke all on makeborne_private.account_privileges,makeborne_private.account_privilege_events from public,anon,authenticated,service_role;
grant select on makeborne_private.account_privileges,makeborne_private.account_privilege_events to service_role;

create function makeborne_private.audit_account_privilege_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP <> 'DELETE' then NEW.updated_at=clock_timestamp(); end if;
  insert into makeborne_private.account_privilege_events(user_id,action,old_grant,new_grant,database_actor)
  values(coalesce(NEW.user_id,OLD.user_id),TG_OP,
    case when TG_OP <> 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP <> 'DELETE' then to_jsonb(NEW) end,session_user);
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
revoke all on function makeborne_private.audit_account_privilege_change() from public,anon,authenticated,service_role;
create trigger audit_account_privilege_change before insert or update or delete
on makeborne_private.account_privileges for each row execute function makeborne_private.audit_account_privilege_change();

create function makeborne_private.has_account_privilege(p_user_id uuid,p_privilege text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from makeborne_private.account_privileges p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and case p_privilege when 'admin' then p.is_admin when 'unlimited_credits' then p.unlimited_credits else false end
  );
$$;
revoke all on function makeborne_private.has_account_privilege(uuid,text) from public,anon,authenticated;
grant execute on function makeborne_private.has_account_privilege(uuid,text) to service_role;

-- The exposed invoker wrapper accepts no user ID. Only the current account's
-- non-secret flags can be read; grants remain inaccessible through the Data API.
create function makeborne_private.my_account_privileges() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('userId',(select auth.uid()),
    'isAdmin',(select auth.role())='authenticated' and makeborne_private.has_account_privilege((select auth.uid()),'admin'),
    'unlimitedCredits',(select auth.role())='authenticated' and makeborne_private.has_account_privilege((select auth.uid()),'unlimited_credits'));
$$;
revoke all on function makeborne_private.my_account_privileges() from public,anon;
grant execute on function makeborne_private.my_account_privileges() to authenticated;
create function public.makeborne_my_account_privileges() returns jsonb
language sql stable security invoker set search_path='' as $$
  select makeborne_private.my_account_privileges();
$$;
revoke all on function public.makeborne_my_account_privileges() from public,anon;
grant execute on function public.makeborne_my_account_privileges() to authenticated;

-- This bypasses payment for an administrator's own authorized workspaces.
-- can_edit/is_owner/membership policies still enforce tenant boundaries.
create or replace function makeborne_private.has_creation_membership() returns boolean
language sql stable security definer set search_path='' as $$
  select makeborne_private.has_account_privilege((select auth.uid()),'admin')
  or (coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
    and exists(
      select 1 from public.billing_memberships m
      join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
      where m.user_id=(select auth.uid()) and m.status in ('active','canceling')
        and m.period_end>now() and m.verified_until>now()
    ));
$$;

-- Preserve nominal proposal costs, with a separate audited zero-credit charge
-- for eligible actors. Vendor reservations and all spend kill switches remain.
alter table makeborne_private.generation_reservations add column credits_waived boolean not null default false;
alter table makeborne_private.generation_reservations add constraint waived_credits_are_zero check(not credits_waived or credit_amount=0);

create or replace function makeborne_private.reserve_generation_proposal(p_proposal_id uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_current_input_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 proposal makeborne_private.generation_proposals%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 prior makeborne_private.generation_reservations%rowtype;
 owner_id uuid; member_role text; latest_id uuid; result_id uuid; artifact_kind text; waived boolean; customer_amount bigint;
begin
 if p_actor is null or p_request_key is null then raise exception 'Authenticated actor and request key required' using errcode='22023'; end if;
 select * into proposal from makeborne_private.generation_proposals where id=p_proposal_id;
 if not found then raise exception 'Proposal unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=proposal.workspace_id for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=proposal.workspace_id and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 if p_approval_hash is distinct from proposal.approval_hash or p_current_input_hash is distinct from proposal.input_hash then raise exception 'Proposal approval changed' using errcode='PT409'; end if;
 select * into budget from makeborne_private.generation_budgets where workspace_id=proposal.workspace_id for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into prior from makeborne_private.generation_reservations where workspace_id=proposal.workspace_id and request_key=p_request_key;
 if found then
   if prior.proposal_id<>proposal.id or prior.approved_by<>p_actor or prior.approval_hash<>p_approval_hash then raise exception 'Request key reused' using errcode='PT409'; end if;
   return prior.id;
 end if;
 if exists(select 1 from makeborne_private.generation_reservations where proposal_id=proposal.id) then raise exception 'Proposal already reserved' using errcode='PT409'; end if;
 if not budget.spending_enabled or budget.emergency_stop then raise exception 'Generation spending disabled' using errcode='42501'; end if;
 if clock_timestamp()<proposal.prepared_at or clock_timestamp()>=proposal.expires_at then raise exception 'Proposal expired' using errcode='PT409'; end if;
 if proposal.artifact_id is not null then
   select a.kind into artifact_kind from public.artifacts a where a.id=proposal.artifact_id and a.project_id=proposal.project_id and a.workspace_id=proposal.workspace_id for share;
   select v.id into latest_id from public.artifact_versions v where v.artifact_id=proposal.artifact_id and v.workspace_id=proposal.workspace_id order by v.version_number desc limit 1;
   if latest_id is distinct from proposal.base_version_id then raise exception 'Project version changed' using errcode='PT409'; end if;
 else
   select p.kind into artifact_kind from public.projects p where p.id=proposal.project_id and p.workspace_id=proposal.workspace_id for share;
 end if;
 if artifact_kind is distinct from proposal.snapshot#>>'{workflow,output}' then raise exception 'Project format changed' using errcode='PT409'; end if;
 if budget.active_reservations>=budget.concurrency_limit then raise exception 'Concurrency limit reached' using errcode='MB429'; end if;
 waived=makeborne_private.has_account_privilege(p_actor,'unlimited_credits');
 customer_amount=case when waived then 0 else proposal.maximum_customer_credits end;
 if budget.vendor_spent::numeric+budget.vendor_reserved+proposal.maximum_vendor_microusd>budget.vendor_limit
 or budget.credit_spent::numeric+budget.credit_reserved+customer_amount>budget.credit_limit then raise exception 'Insufficient generation budget' using errcode='MB402'; end if;
 insert into makeborne_private.generation_reservations(workspace_id,proposal_id,request_key,approved_by,approval_hash,vendor_amount,credit_amount,credits_waived)
 values(proposal.workspace_id,proposal.id,p_request_key,p_actor,p_approval_hash,proposal.maximum_vendor_microusd,customer_amount,waived) returning id into result_id;
 update makeborne_private.generation_budgets set vendor_reserved=vendor_reserved+proposal.maximum_vendor_microusd,credit_reserved=credit_reserved+customer_amount,active_reservations=active_reservations+1,revision=revision+1 where workspace_id=proposal.workspace_id;
 return result_id;
end $$;
revoke all on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) to service_role;
comment on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) is 'Trusted worker only. Caller authenticates actor and verifies canonical input/proposal hashes and current routing/rights policy. Transaction reserves two budgets; does not enqueue or dispatch. Spending defaults off.';


create or replace function makeborne_private.claim_generation_dispatch(
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
 if reservation.credits_waived and not makeborne_private.has_account_privilege(p_actor,'unlimited_credits') then raise exception 'Credit allowance changed; prepare a new reservation' using errcode='PT409'; end if;
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
