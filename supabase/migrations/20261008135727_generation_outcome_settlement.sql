begin;

-- Actual incurred costs can exceed a quote. Preserve that fact and stop future
-- spending instead of rejecting the evidence or raising the customer's quote.
alter table makeborne_private.generation_budgets drop constraint generation_budgets_check;
alter table makeborne_private.generation_budgets add constraint vendor_overrun_stops_spending
 check(vendor_spent::numeric+vendor_reserved<=vendor_limit or emergency_stop);

create table makeborne_private.generation_provider_outcomes (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null unique,
 workspace_id uuid not null,
 artifact_id uuid,
 dispatch_id uuid not null unique references makeborne_private.generation_dispatches(id),
 succeeded boolean not null,
 actual_vendor_microusd bigint not null check(actual_vendor_microusd>=0),
 provider text not null check(length(provider) between 1 and 80),
 model text not null check(length(model) between 1 and 160),
 tariff_version text not null check(length(tariff_version) between 1 and 160),
 provider_request_id text not null check(length(provider_request_id) between 1 and 200),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 result_version_id uuid,
 result_hash text check(result_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id),
 foreign key(result_version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id),
 check(succeeded=(result_version_id is not null) and succeeded=(result_hash is not null)),
 check(result_version_id is null or artifact_id is not null),
 constraint generation_outcome_scope unique(id,job_id,workspace_id),
 constraint outcome_result_unique unique(result_version_id),
 constraint outcome_provider_request_unique unique(provider,provider_request_id)
);
alter table makeborne_private.generation_provider_outcomes enable row level security;
revoke all on makeborne_private.generation_provider_outcomes from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_provider_outcomes to service_role;
create index generation_outcomes_workspace on makeborne_private.generation_provider_outcomes(workspace_id);
create index generation_outcomes_result on makeborne_private.generation_provider_outcomes(result_version_id,artifact_id,workspace_id) where result_version_id is not null;

-- Extend the existing ledger. Vendor amounts remain micro-USD; credits never go
-- through that column. Legacy entries are kept with their original meaning.
alter table public.usage_ledger
 add column account text not null default 'vendor_microusd' check(account in ('vendor_microusd','customer_credits')),
 add column customer_credits bigint check(customer_credits>=0),
 add column reason text not null default 'legacy_usage' check(reason in ('legacy_usage','provider_cost','accepted_work')),
 add column outcome_id uuid,
 add column evidence_hash text check(evidence_hash ~ '^[a-f0-9]{64}$'),
 add column tariff_version text,
 add constraint usage_account_units check(
   (account='vendor_microusd' and customer_credits is null)
   or (account='customer_credits' and customer_credits is not null and amount_microusd=0)),
 add constraint usage_outcome_scope foreign key(outcome_id,job_id,workspace_id) references makeborne_private.generation_provider_outcomes(id,job_id,workspace_id),
 add constraint usage_reason_account check(reason='legacy_usage' or (reason='provider_cost' and account='vendor_microusd') or (reason='accepted_work' and account='customer_credits')),
 add constraint usage_confirmed_evidence check(reason='legacy_usage' or
   (not estimated and outcome_id is not null and evidence_hash is not null and tariff_version is not null and length(tariff_version) between 1 and 160));
create unique index usage_outcome_account on public.usage_ledger(outcome_id,account) where outcome_id is not null;
-- Model/provider detail is private. A future usage endpoint must return a
-- customer-safe projection after its own access check, not this raw table.
revoke all on public.usage_ledger from public,anon,authenticated,service_role;
grant select on public.usage_ledger to service_role;

create table makeborne_private.generation_job_settlements (
 job_id uuid primary key,
 workspace_id uuid not null,
 outcome_id uuid not null unique,
 accepted boolean not null,
 reviewed_by uuid not null references auth.users(id),
 review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
 customer_credits bigint not null check(customer_credits>=0),
 settled_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id),
 foreign key(outcome_id,job_id,workspace_id) references makeborne_private.generation_provider_outcomes(id,job_id,workspace_id),
 check(accepted or customer_credits=0)
);
alter table makeborne_private.generation_job_settlements enable row level security;
revoke all on makeborne_private.generation_job_settlements from public,anon,authenticated,service_role;
grant select on makeborne_private.generation_job_settlements to service_role;
create index generation_settlements_workspace on makeborne_private.generation_job_settlements(workspace_id);
create index generation_settlements_actor on makeborne_private.generation_job_settlements(reviewed_by);

alter table makeborne_private.generation_job_outbox drop constraint generation_job_outbox_kind_check;
alter table makeborne_private.generation_job_outbox add constraint generation_job_outbox_kind_check
 check(kind in ('queued','leased','dispatch_intent','cancelled','reconciliation_required','outcome_confirmed','settled'));

create function makeborne_private.prevent_accounting_rewrite() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Accounting evidence is append-only' using errcode='23514'; end $$;
revoke all on function makeborne_private.prevent_accounting_rewrite() from public,anon,authenticated,service_role;
create trigger usage_ledger_immutable before update or delete on public.usage_ledger
 for each row execute function makeborne_private.prevent_accounting_rewrite();
create trigger generation_outcome_immutable before update or delete on makeborne_private.generation_provider_outcomes
 for each row execute function makeborne_private.prevent_accounting_rewrite();
create trigger generation_settlement_immutable before update or delete on makeborne_private.generation_job_settlements
 for each row execute function makeborne_private.prevent_accounting_rewrite();

-- Core has no worker grant. Only a live fenced worker wrapper, or an explicit
-- database operator reconciliation, may attest a confirmed provider outcome.
create function makeborne_private.record_generation_outcome_core(
 p_job uuid,p_dispatch uuid,p_succeeded boolean,p_cost bigint,p_provider text,p_model text,
 p_tariff text,p_request text,p_evidence text,p_result uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; prior makeborne_private.generation_provider_outcomes%rowtype;
 reservation makeborne_private.generation_reservations%rowtype; version public.artifact_versions%rowtype;
 proposal makeborne_private.generation_proposals%rowtype; digest text; oid uuid;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if p_succeeded is null or p_cost is null or p_cost<0 or p_provider is null or p_model is null or p_tariff is null
   or p_request is null or p_evidence is null or p_evidence !~ '^[a-f0-9]{64}$'
   or p_succeeded is distinct from (p_result is not null) then raise exception 'Confirmed outcome evidence required' using errcode='22023'; end if;
 select * into prior from makeborne_private.generation_provider_outcomes where job_id=job.id;
 if found then
   if row(prior.dispatch_id,prior.succeeded,prior.actual_vendor_microusd,prior.provider,prior.model,prior.tariff_version,prior.provider_request_id,prior.evidence_hash,prior.result_version_id)
      is distinct from row(p_dispatch,p_succeeded,p_cost,p_provider,p_model,p_tariff,p_request,p_evidence,p_result)
      then raise exception 'Outcome replay changed evidence' using errcode='PT409'; end if;
   return prior.id;
 end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 if reservation.status<>'uncertain' or not exists(select 1 from makeborne_private.generation_dispatches d where d.id=p_dispatch and d.reservation_id=reservation.id)
   then raise exception 'Matching unresolved dispatch required' using errcode='PT409'; end if;
 if p_succeeded then
   select * into proposal from makeborne_private.generation_proposals where id=reservation.proposal_id;
   select * into version from public.artifact_versions where id=p_result and workspace_id=job.workspace_id and artifact_id=job.artifact_id for share;
   if not found or version.id is not distinct from proposal.base_version_id or version.parent_version_id is distinct from proposal.base_version_id
     or version.created_at<reservation.dispatch_started_at then raise exception 'New result revision must match dispatched scope and base' using errcode='PT409'; end if;
   digest:=encode(extensions.digest(convert_to(jsonb_build_object('content',version.content,'style',version.style_snapshot,'assets',version.asset_manifest)::text,'UTF8'),'sha256'),'hex');
 end if;
 insert into makeborne_private.generation_provider_outcomes(job_id,workspace_id,artifact_id,dispatch_id,succeeded,actual_vendor_microusd,provider,model,tariff_version,provider_request_id,evidence_hash,result_version_id,result_hash)
 values(job.id,job.workspace_id,job.artifact_id,p_dispatch,p_succeeded,p_cost,p_provider,p_model,p_tariff,p_request,p_evidence,p_result,digest) returning id into oid;
 insert into public.usage_ledger(workspace_id,job_id,event_key,amount_microusd,estimated,provider,model,reason,outcome_id,evidence_hash,tariff_version)
 values(job.workspace_id,job.id,'provider-cost:'||p_dispatch::text,p_cost,false,p_provider,p_model,'provider_cost',oid,p_evidence,p_tariff);
 if p_cost>reservation.vendor_amount then
   update makeborne_private.generation_budgets set emergency_stop=true,revision=revision+1 where workspace_id=job.workspace_id;
 end if;
 update public.generation_jobs set stage=case when p_succeeded then 'output_review' else 'attempt_failed' end,
   run_revision=run_revision+1,updated_at=clock_timestamp() where id=job.id returning * into job;
 perform makeborne_private.append_generation_job_event(job,'outcome_confirmed');
 return oid;
end $$;
revoke all on function makeborne_private.record_generation_outcome_core(uuid,uuid,boolean,bigint,text,text,text,text,text,uuid) from public,anon,authenticated,service_role;

create function makeborne_private.record_generation_job_outcome(
 p_job uuid,p_worker uuid,p_fence bigint,p_dispatch uuid,p_succeeded boolean,p_cost bigint,
 p_provider text,p_model text,p_tariff text,p_request text,p_evidence text,p_result uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if job.status<>'running' or job.cancel_requested_at is not null or job.lease_owner is distinct from p_worker
   or job.fence is distinct from p_fence or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
   or job.deadline_at<=clock_timestamp() then raise exception 'Live worker fence required; operator reconciliation otherwise' using errcode='PT409'; end if;
 return makeborne_private.record_generation_outcome_core(p_job,p_dispatch,p_succeeded,p_cost,p_provider,p_model,p_tariff,p_request,p_evidence,p_result);
end $$;
revoke all on function makeborne_private.record_generation_job_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function makeborne_private.record_generation_job_outcome(uuid,uuid,bigint,uuid,boolean,bigint,text,text,text,text,text,uuid) to service_role;

create function makeborne_private.settle_generation_job(p_job uuid,p_actor uuid,p_revision bigint,p_accepted boolean,p_review_hash text)
returns public.generation_jobs language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; outcome makeborne_private.generation_provider_outcomes%rowtype;
 prior makeborne_private.generation_job_settlements%rowtype; reservation makeborne_private.generation_reservations%rowtype;
 budget makeborne_private.generation_budgets%rowtype; charge bigint; total numeric;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if p_actor is null or not exists(select 1 from public.workspaces where id=job.workspace_id and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=job.workspace_id and user_id=p_actor and role='editor' for share)
   then raise exception 'Current editor required for settlement' using errcode='42501'; end if;
 if p_accepted is null or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' then raise exception 'Review decision and evidence required' using errcode='22023'; end if;
 select * into prior from makeborne_private.generation_job_settlements where job_id=job.id;
 if found then
   if row(prior.accepted,prior.reviewed_by,prior.review_hash) is distinct from row(p_accepted,p_actor,p_review_hash)
     then raise exception 'Settlement replay changed decision' using errcode='PT409'; end if;
   return job;
 end if;
 if job.run_revision is distinct from p_revision then raise exception 'Job revision changed' using errcode='PT409'; end if;
 select * into outcome from makeborne_private.generation_provider_outcomes where job_id=job.id;
 if not found then raise exception 'Unknown provider outcome retains reservation' using errcode='PT409'; end if;
 if p_accepted and (not outcome.succeeded or job.cancel_requested_at is not null)
   then raise exception 'Only successful uncancelled output can be accepted' using errcode='PT409'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 select * into budget from makeborne_private.generation_budgets where workspace_id=job.workspace_id;
 if reservation.status<>'uncertain' or budget.active_reservations<1 or budget.vendor_reserved<reservation.vendor_amount or budget.credit_reserved<reservation.credit_amount
   then raise exception 'Reservation counters require reconciliation' using errcode='PT409'; end if;
 charge:=case when p_accepted then reservation.credit_amount else 0 end;
 total:=budget.vendor_spent::numeric+outcome.actual_vendor_microusd;
 if total>9223372036854775807 then raise exception 'Vendor counter exceeds supported range; evidence retained for reconciliation' using errcode='22003'; end if;
 insert into makeborne_private.generation_job_settlements(job_id,workspace_id,outcome_id,accepted,reviewed_by,review_hash,customer_credits)
 values(job.id,job.workspace_id,outcome.id,p_accepted,p_actor,p_review_hash,charge);
 if p_accepted then
   insert into public.usage_ledger(workspace_id,job_id,event_key,amount_microusd,estimated,provider,model,account,customer_credits,reason,outcome_id,evidence_hash,tariff_version)
   values(job.workspace_id,job.id,'accepted-work:'||job.id::text,0,false,outcome.provider,outcome.model,'customer_credits',charge,'accepted_work',outcome.id,p_review_hash,outcome.tariff_version);
 end if;
 update makeborne_private.generation_budgets set vendor_spent=total::bigint,vendor_reserved=vendor_reserved-reservation.vendor_amount,
   credit_spent=credit_spent+charge,credit_reserved=credit_reserved-reservation.credit_amount,active_reservations=active_reservations-1,
   emergency_stop=emergency_stop or total+vendor_reserved-reservation.vendor_amount>vendor_limit,revision=revision+1 where workspace_id=job.workspace_id;
 -- A resolved dispatched reservation is settled even at zero cost; release is
 -- reserved for never-dispatched work and never implies a refund.
 update makeborne_private.generation_reservations set status='settled' where id=reservation.id;
 update public.generation_jobs set status=case when p_accepted then 'succeeded' when cancel_requested_at is not null then 'cancelled' else 'failed' end,
   stage=case when p_accepted then 'ready' when cancel_requested_at is not null then 'cancelled' else 'failed' end,
   error_code=case when total+budget.vendor_reserved-reservation.vendor_amount>budget.vendor_limit then 'vendor_cost_overrun' else error_code end,
   lease_owner=null,lease_expires_at=null,fence=fence+1,run_revision=run_revision+1,updated_at=clock_timestamp() where id=job.id returning * into job;
 perform makeborne_private.append_generation_job_event(job,'settled');
 return job;
end $$;
revoke all on function makeborne_private.settle_generation_job(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function makeborne_private.settle_generation_job(uuid,uuid,bigint,boolean,text) to service_role;
comment on function makeborne_private.record_generation_outcome_core(uuid,uuid,boolean,bigint,text,text,text,text,text,uuid) is 'Operator-only reconciliation core. Independently verify provider response/usage and exact result before attestation. Never infer zero cost from a timeout. Runtime workers use the live-fenced wrapper only.';
comment on function makeborne_private.settle_generation_job(uuid,uuid,bigint,boolean,text) is 'Trusted server only; authenticate actor/session and run output review before invocation. Evidence digest is an audit binding, not proof of review quality. Atomically settle existing reservation and append accepted-work credits once. No payment grants, refunds or global/provider budget readiness implied.';
commit;
