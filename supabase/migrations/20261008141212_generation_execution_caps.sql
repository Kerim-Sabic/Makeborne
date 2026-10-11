begin;
create table makeborne_private.generation_execution_caps (
 scope text primary key check(scope in ('global','openai','anthropic','deepseek','qwen_hosted','self_hosted','media_worker')),
 enabled boolean not null default false,
 emergency_stop boolean not null default false,
 vendor_limit bigint not null default 0 check(vendor_limit>=0),
 vendor_reserved bigint not null default 0 check(vendor_reserved>=0),
 vendor_spent bigint not null default 0 check(vendor_spent>=0),
 active_dispatches integer not null default 0 check(active_dispatches>=0),
 concurrency_limit integer not null default 1 check(concurrency_limit between 1 and 1000),
 revision bigint not null default 0 check(revision>=0),
 check(vendor_spent::numeric+vendor_reserved<=vendor_limit or emergency_stop)
);
alter table makeborne_private.generation_execution_caps enable row level security;
revoke all on makeborne_private.generation_execution_caps from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_execution_caps to service_role;
insert into makeborne_private.generation_execution_caps(scope)
 values('global'),('openai'),('anthropic'),('deepseek'),('qwen_hosted'),('self_hosted'),('media_worker');

create table makeborne_private.generation_execution_holds (
 job_id uuid primary key,
 workspace_id uuid not null,
 dispatch_id uuid not null unique references makeborne_private.generation_dispatches(id),
 provider text not null references makeborne_private.generation_execution_caps(scope) check(provider<>'global'),
 model text not null check(length(model) between 1 and 160),
 tariff_version text not null check(length(tariff_version) between 1 and 160),
 amount bigint not null check(amount>=0),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id)
);
alter table makeborne_private.generation_execution_holds enable row level security;
revoke all on makeborne_private.generation_execution_holds from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_execution_holds to service_role;
create index generation_execution_holds_workspace on makeborne_private.generation_execution_holds(workspace_id);
create index generation_execution_holds_provider on makeborne_private.generation_execution_holds(provider);
create trigger generation_execution_holds_immutable before update or delete on makeborne_private.generation_execution_holds
 for each row execute function makeborne_private.prevent_accounting_rewrite();

-- The trusted runtime has one dispatch entrypoint. Existing implementation
-- functions remain available to their owner for local regression/reconciliation.
revoke all on function makeborne_private.claim_generation_dispatch(uuid,uuid,uuid,text,text) from service_role;
revoke all on function makeborne_private.claim_generation_job_dispatch(uuid,uuid,bigint,uuid) from service_role;
revoke all on function makeborne_private.record_generation_job_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) from service_role;
-- The earlier direct pilot must migrate to durable caps before runtime access.
revoke all on function makeborne_private.claim_claude_pilot(uuid,uuid,text) from service_role;
revoke all on function public.makeborne_claim_claude_pilot(uuid,uuid,text) from service_role;

create function makeborne_private.claim_capped_generation_dispatch(p_job uuid,p_worker uuid,p_fence bigint,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; reservation makeborne_private.generation_reservations%rowtype;
 proposal makeborne_private.generation_proposals%rowtype;
 route jsonb; global_cap makeborne_private.generation_execution_caps%rowtype;
 provider_cap makeborne_private.generation_execution_caps%rowtype; result jsonb; provider_name text;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 perform 1 from makeborne_private.generation_execution_holds where job_id=job.id;
 if found then return makeborne_private.claim_generation_job_dispatch(p_job,p_worker,p_fence,p_request); end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 select * into proposal from makeborne_private.generation_proposals where id=reservation.proposal_id;
 if (select count(*) from jsonb_array_elements(proposal.snapshot#>'{workflow,stages}') s where s->>'stage'='draft')<>1
   then raise exception 'Exactly one approved draft route required' using errcode='PT409'; end if;
 select s->'route' into route from jsonb_array_elements(proposal.snapshot#>'{workflow,stages}') s where s->>'stage'='draft';
 provider_name:=route->>'provider';
 if provider_name is null or provider_name='global' or route->>'model' is null or route#>>'{price,version}' is null
   or route->>'status' is distinct from 'ready' or route->'adapterVerified' is distinct from 'true'::jsonb
   or route->'policyApproved' is distinct from 'true'::jsonb or route->'licenseApproved' is distinct from 'true'::jsonb
   or route#>>'{price,expiresAt}' is null or (route#>>'{price,expiresAt}')::timestamptz<=clock_timestamp()
   then raise exception 'Approved executable draft route unavailable' using errcode='PT409'; end if;
 -- Existing workspace/budget/reservation/job locks precede cap locks. Every
 -- cap path then locks global followed by its provider; no reverse path exists.
 select * into global_cap from makeborne_private.generation_execution_caps where scope='global' for update;
 select * into provider_cap from makeborne_private.generation_execution_caps where scope=provider_name for update;
 if not found or not global_cap.enabled or global_cap.emergency_stop or not provider_cap.enabled or provider_cap.emergency_stop
   then raise exception 'Global or provider spending disabled' using errcode='42501'; end if;
 if global_cap.active_dispatches>=global_cap.concurrency_limit or provider_cap.active_dispatches>=provider_cap.concurrency_limit
   then raise exception 'Global or provider concurrency limit reached' using errcode='MB429'; end if;
 if global_cap.vendor_spent::numeric+global_cap.vendor_reserved+reservation.vendor_amount>global_cap.vendor_limit
   or provider_cap.vendor_spent::numeric+provider_cap.vendor_reserved+reservation.vendor_amount>provider_cap.vendor_limit
   then raise exception 'Global or provider generation budget exhausted' using errcode='MB402'; end if;
 result:=makeborne_private.claim_generation_job_dispatch(p_job,p_worker,p_fence,p_request);
 if result->>'claimed' is distinct from 'true' then raise exception 'Historical dispatch needs explicit cap reconciliation' using errcode='PT409'; end if;
 insert into makeborne_private.generation_execution_holds(job_id,workspace_id,dispatch_id,provider,model,tariff_version,amount)
 values(job.id,job.workspace_id,(result->>'dispatchId')::uuid,provider_name,route->>'model',route#>>'{price,version}',reservation.vendor_amount);
 update makeborne_private.generation_execution_caps set vendor_reserved=vendor_reserved+reservation.vendor_amount,
   active_dispatches=active_dispatches+1,revision=revision+1 where scope in ('global',provider_name);
 return result;
end $$;
revoke all on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) to service_role;

create function makeborne_private.record_capped_generation_outcome(
 p_job uuid,p_worker uuid,p_fence bigint,p_dispatch uuid,p_succeeded boolean,p_cost bigint,
 p_provider text,p_model text,p_tariff text,p_request text,p_evidence text,p_result uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; hold makeborne_private.generation_execution_holds%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 select * into hold from makeborne_private.generation_execution_holds where job_id=job.id;
 if not found or row(hold.dispatch_id,hold.provider,hold.model,hold.tariff_version) is distinct from row(p_dispatch,p_provider,p_model,p_tariff)
   then raise exception 'Outcome must match capped dispatch route' using errcode='PT409'; end if;
 return makeborne_private.record_generation_job_outcome(p_job,p_worker,p_fence,p_dispatch,p_succeeded,p_cost,p_provider,p_model,p_tariff,p_request,p_evidence,p_result);
end $$;
revoke all on function makeborne_private.record_capped_generation_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function makeborne_private.record_capped_generation_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) to service_role;

-- These triggers also protect explicit operator reconciliation through the
-- existing outcome/settlement authorities, without adding another ledger.
create function makeborne_private.reconcile_execution_cap_outcome() returns trigger
language plpgsql security definer set search_path='' as $$
declare hold makeborne_private.generation_execution_holds%rowtype;
begin
 select * into hold from makeborne_private.generation_execution_holds where job_id=new.job_id;
 if not found then return new; end if; -- Historical operator-only evidence.
 if row(hold.dispatch_id,hold.provider,hold.model,hold.tariff_version) is distinct from row(new.dispatch_id,new.provider,new.model,new.tariff_version)
   then raise exception 'Confirmed evidence changed capped route' using errcode='PT409'; end if;
 perform 1 from makeborne_private.generation_execution_caps where scope='global' for update;
 perform 1 from makeborne_private.generation_execution_caps where scope=hold.provider for update;
 if new.actual_vendor_microusd>hold.amount then
   update makeborne_private.generation_execution_caps set emergency_stop=true,revision=revision+1 where scope in ('global',hold.provider);
 end if;
 return new;
end $$;
revoke all on function makeborne_private.reconcile_execution_cap_outcome() from public,anon,authenticated,service_role;
create trigger generation_outcome_cap_guard before insert on makeborne_private.generation_provider_outcomes
 for each row execute function makeborne_private.reconcile_execution_cap_outcome();

create function makeborne_private.settle_execution_caps() returns trigger
language plpgsql security definer set search_path='' as $$
declare hold makeborne_private.generation_execution_holds%rowtype; actual bigint;
 cap makeborne_private.generation_execution_caps%rowtype; total numeric;
begin
 select * into hold from makeborne_private.generation_execution_holds where job_id=new.job_id;
 if not found then return new; end if; -- Retain historical settlement behaviour.
 select actual_vendor_microusd into actual from makeborne_private.generation_provider_outcomes where id=new.outcome_id;
 perform 1 from makeborne_private.generation_execution_caps where scope='global' for update;
 perform 1 from makeborne_private.generation_execution_caps where scope=hold.provider for update;
 for cap in select * from makeborne_private.generation_execution_caps where scope in ('global',hold.provider) loop
   if cap.vendor_reserved<hold.amount or cap.active_dispatches<1 then raise exception 'Execution cap counters require reconciliation' using errcode='PT409'; end if;
   total:=cap.vendor_spent::numeric+actual;
   if total>9223372036854775807 then raise exception 'Execution cap exceeds supported range; evidence retained' using errcode='22003'; end if;
   update makeborne_private.generation_execution_caps set vendor_spent=total::bigint,vendor_reserved=vendor_reserved-hold.amount,
     active_dispatches=active_dispatches-1,emergency_stop=emergency_stop or total+vendor_reserved-hold.amount>vendor_limit,
     revision=revision+1 where scope=cap.scope;
 end loop;
 return new;
end $$;
revoke all on function makeborne_private.settle_execution_caps() from public,anon,authenticated,service_role;
create trigger generation_settlement_caps after insert on makeborne_private.generation_job_settlements
 for each row execute function makeborne_private.settle_execution_caps();
comment on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) is 'Only runtime dispatch entrypoint. One approved draft call currently reserves the entire operation vendor bound globally and for its provider. Defaults disabled. Commit claimed=true before external call; unknown outcome retains all holds. Caller still verifies actor/session, rights and current route policy. Multi-stage/resource-unit enforcement remains separate work.';
commit;
