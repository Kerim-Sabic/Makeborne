begin;
create table makeborne_private.generation_budgets (
 workspace_id uuid primary key references public.workspaces(id),
 spending_enabled boolean not null default false,
 emergency_stop boolean not null default false,
 vendor_limit bigint not null default 0 check(vendor_limit>=0),
 vendor_spent bigint not null default 0 check(vendor_spent>=0),
 vendor_reserved bigint not null default 0 check(vendor_reserved>=0),
 credit_limit bigint not null default 0 check(credit_limit>=0),
 credit_spent bigint not null default 0 check(credit_spent>=0),
 credit_reserved bigint not null default 0 check(credit_reserved>=0),
 active_reservations integer not null default 0 check(active_reservations>=0),
 concurrency_limit integer not null default 1 check(concurrency_limit between 1 and 100),
 revision bigint not null default 0 check(revision>=0),
 check(vendor_spent::numeric+vendor_reserved<=vendor_limit),
 check(credit_spent::numeric+credit_reserved<=credit_limit)
);
alter table makeborne_private.generation_proposals add constraint generation_proposals_id_workspace unique(id,workspace_id);
create table makeborne_private.generation_reservations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references makeborne_private.generation_budgets(workspace_id),
 proposal_id uuid not null unique,
 request_key uuid not null,
 approved_by uuid not null references auth.users(id),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 vendor_amount bigint not null check(vendor_amount>=0),
 credit_amount bigint not null check(credit_amount>=0),
 status text not null default 'reserved' check(status in ('reserved','uncertain','settled','released')),
 created_at timestamptz not null default now(),
 unique(workspace_id,request_key),
 foreign key(proposal_id,workspace_id) references makeborne_private.generation_proposals(id,workspace_id)
);
alter table makeborne_private.generation_budgets enable row level security;
alter table makeborne_private.generation_reservations enable row level security;
revoke all on makeborne_private.generation_budgets,makeborne_private.generation_reservations from public,anon,authenticated,service_role;
grant select,insert,update on makeborne_private.generation_budgets to service_role;
grant select on makeborne_private.generation_reservations to service_role;
create index generation_reservations_actor on makeborne_private.generation_reservations(approved_by);

-- Private worker entry point; never an authenticated browser RPC.
create function makeborne_private.reserve_generation_proposal(p_proposal_id uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_current_input_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 proposal makeborne_private.generation_proposals%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 prior makeborne_private.generation_reservations%rowtype;
 owner_id uuid; member_role text; latest_id uuid; result_id uuid; artifact_kind text;
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
 if budget.vendor_spent::numeric+budget.vendor_reserved+proposal.maximum_vendor_microusd>budget.vendor_limit
 or budget.credit_spent::numeric+budget.credit_reserved+proposal.maximum_customer_credits>budget.credit_limit then raise exception 'Insufficient generation budget' using errcode='MB402'; end if;
 insert into makeborne_private.generation_reservations(workspace_id,proposal_id,request_key,approved_by,approval_hash,vendor_amount,credit_amount)
 values(proposal.workspace_id,proposal.id,p_request_key,p_actor,p_approval_hash,proposal.maximum_vendor_microusd,proposal.maximum_customer_credits) returning id into result_id;
 update makeborne_private.generation_budgets set vendor_reserved=vendor_reserved+proposal.maximum_vendor_microusd,credit_reserved=credit_reserved+proposal.maximum_customer_credits,active_reservations=active_reservations+1,revision=revision+1 where workspace_id=proposal.workspace_id;
 return result_id;
end $$;
revoke all on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) to service_role;
comment on function makeborne_private.reserve_generation_proposal(uuid,uuid,uuid,text,text) is 'Trusted worker only. Caller authenticates actor and verifies canonical input/proposal hashes and current routing/rights policy. Transaction reserves two budgets; does not enqueue or dispatch. Spending defaults off.';
commit;
