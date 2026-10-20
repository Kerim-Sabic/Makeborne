-- Durable user cancellation. Lock order remains operation -> run -> wallet.
-- All existing migrations remain unchanged. Roll back the app with this schema
-- retained: removing cancellation gates while stopped workers exist is unsafe.
begin;
alter table makeborne_private.ai_operations add column cancel_requested_at timestamptz;
alter table makeborne_private.ai_operation_runs add column cancel_requested_at timestamptz;
alter table makeborne_private.ai_operations drop constraint ai_operations_status_check;
alter table makeborne_private.ai_operations add constraint ai_operations_status_check check(status in ('active','paused','completed','expired','cancelled'));

create or replace function makeborne_private.ai_operation_snapshot(p_operation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'revision',o.revision,'authorizedCredits',o.authorized_credits,
 'chargedCredits',o.charged_credits,'reservedCredits',o.reserved_credits,
 'remainingCredits',greatest(o.authorized_credits-o.charged_credits-o.reserved_credits,0),
 'cancelRequested',o.cancel_requested_at is not null,
 'status',case when o.cancel_requested_at is not null and o.reserved_credits=0 then 'cancelled' when o.status='expired' then 'expired' when o.reserved_credits>0 then 'running' else o.status end,
 'maximumAdditionalCredits',case when o.cancel_requested_at is null then o.initial_cap else 0 end,'pendingKind',o.pending_kind,
 'canContinue',o.cancel_requested_at is null and o.status in ('active','paused') and o.reserved_credits=0 and o.expires_at>clock_timestamp()
  and (o.pending_kind is not null or o.status='paused' or exists(select 1 from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.recovery is not null)),
 'recoverable',exists(select 1 from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.recovery is not null),
 'lastVersion',o.last_version,'initialVersion',o.initial_version,'rateMicrousd',o.rate_microusd,
 'effort',o.effort,'kind',o.kind,'expiresAt',o.expires_at,
 'providerRemainingMicrousd',greatest(o.authorized_credits*o.rate_microusd-coalesce((select sum(coalesce(c.charged_microusd,c.bound_microusd))
  from makeborne_private.ai_operation_runs r join makeborne_private.live_provider_calls c on c.run_reference=r.reference where r.operation_id=o.id),0),0))
 from makeborne_private.ai_operations o where o.id=p_operation;
$$;

create or replace function makeborne_private.ai_operation_provider_begin(p_actor uuid,p_run uuid,p_fence uuid,p_call uuid,p_provider text,p_model text,p_bound bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; c makeborne_private.live_provider_calls; used numeric; run_used numeric;
begin
 select op.* into o from makeborne_private.ai_operations op join makeborne_private.ai_operation_runs rr on rr.operation_id=op.id where rr.id=p_run and op.actor=p_actor for update of op;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 if o.cancel_requested_at is not null then raise exception 'Operation cancelled' using errcode='MB499'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 select * into r from makeborne_private.ai_operation_runs where id=p_run for update;
 if p_fence is distinct from r.fence then raise exception 'Worker fence conflict' using errcode='PT409'; end if;
 select * into c from makeborne_private.live_provider_calls where id=p_call;
 if found then
  if (c.run_reference,c.user_id,c.provider,c.model,c.bound_microusd) is distinct from (r.reference,p_actor,p_provider,p_model,p_bound) then raise exception 'Provider call key conflict' using errcode='PT409'; end if;
  return jsonb_build_object('started',false,'replayed',true,'status',c.status);
 end if;
 if r.status<>'active' or r.expires_at<=clock_timestamp() or o.status<>'active' or o.expires_at<=clock_timestamp() then raise exception 'Worker lease expired' using errcode='PT409'; end if;
 if not r.exempt and not coalesce((public.makeborne_credit_hold_status(p_actor,r.reference)->>'active')::boolean,false) then raise exception 'Credit hold expired' using errcode='PT409'; end if;
 select coalesce(sum(coalesce(cc.charged_microusd,cc.bound_microusd)),0),coalesce(sum(case when rr.id=r.id then coalesce(cc.charged_microusd,cc.bound_microusd) else 0 end),0)
 into used,run_used from makeborne_private.ai_operation_runs rr join makeborne_private.live_provider_calls cc on cc.run_reference=rr.reference where rr.operation_id=o.id;
 if p_bound is null or p_bound<=0 then raise exception 'Invalid provider bound' using errcode='22023'; end if;
 if used+p_bound>o.authorized_credits*o.rate_microusd or run_used+p_bound>r.allocated_credits*o.rate_microusd then return jsonb_build_object('error',jsonb_build_object('code','OPERATION_BUDGET_REACHED')); end if;
 return makeborne_private.open_provider_call(p_call,p_actor,r.reference,p_provider,p_model,p_bound,'live');
end $$;

create or replace function makeborne_private.ai_operation_finish(p_actor uuid,p_run uuid,p_fence uuid,p_measured_microusd bigint,p_outcome text,p_detail jsonb,p_candidate jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; charge bigint:=0; target bigint:=0; billable bigint:=0;
 saved jsonb; saved_plan jsonb; prior_plan_revision integer; settlement jsonb; res jsonb; v_recovery jsonb; v_outcome text:=p_outcome; old_sub text; old_claims text; fingerprint text;
begin
 select op.* into o from makeborne_private.ai_operations op join makeborne_private.ai_operation_runs rr on rr.operation_id=op.id where rr.id=p_run and op.actor=p_actor for update of op;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 select * into r from makeborne_private.ai_operation_runs where id=p_run for update;
 if p_fence is distinct from r.fence then raise exception 'Worker fence conflict' using errcode='PT409'; end if;
 if p_measured_microusd is null or p_measured_microusd not between 0 and 1000000000000000 or p_outcome is null
  or p_outcome not in ('saved','review_no_change','incomplete','failed','plan') or p_detail is null or jsonb_typeof(p_detail)<>'object' or octet_length(p_detail::text)>4096
  or (p_candidate is not null and (jsonb_typeof(p_candidate)<>'object' or octet_length(p_candidate::text)>6000000)) then raise exception 'Invalid finalization' using errcode='22023'; end if;
 fingerprint:=md5(jsonb_build_array(p_measured_microusd,p_outcome,p_detail,p_candidate)::text);
 if r.status='finished' then
  if r.finish_hash is distinct from fingerprint then raise exception 'Finalization conflict' using errcode='PT409'; end if;
  return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'charged',r.charged_credits,'outcome',r.outcome,'result',r.result,'recovery',case when r.recovery is null then null else jsonb_build_object('runId',r.id,'candidate',r.recovery) end,'replayed',true);
 end if;
 -- Locking the wallet first expires lots/holds before deciding whether to save.
 if not r.exempt then perform makeborne_private.lock_credit_wallet(p_actor); end if;
 if r.status='expired' or r.expires_at<=clock_timestamp() or o.expires_at<=clock_timestamp() or (not r.exempt and not coalesce((public.makeborne_credit_hold_status(p_actor,r.reference)->>'active')::boolean,false)) then
  v_outcome:='expired'; v_recovery:=p_candidate;
 elsif o.cancel_requested_at is not null then
  -- Cancellation and finalization serialize on the operation row. No candidate
  -- is automatically saved after Stop wins; valid work is retained for explicit
  -- recovery. Unknown provider exposure remains in the provider ledger, while
  -- the customer pays only confirmed usage supplied by the worker.
  v_outcome:='cancelled'; v_recovery:=p_candidate;
  billable:=least(p_measured_microusd,r.allocated_credits*o.rate_microusd);
  target:=least(ceil((o.billable_microusd+billable)::numeric/o.rate_microusd)::bigint-o.charged_credits,r.allocated_credits);
  settlement:=public.makeborne_credit_settle_run(p_actor,r.reference,target,r.exempt,p_detail||jsonb_build_object('cancelled',true));
  if settlement->>'outcome' not in ('settled','exempt') then raise exception 'Cancellation settlement unavailable' using errcode='PT409'; end if;
  charge:=coalesce((settlement->>'charged')::bigint,0);
  if not r.exempt and charge<>target then raise exception 'Cancellation settlement mismatch' using errcode='PT409'; end if;
  res:=jsonb_build_object('version',o.last_version,'summary','Stopped. Check the recorded charge and any recoverable work below.','changed',false,'finished',true,'cancelled',true);
 elsif p_outcome='failed' then v_recovery:=p_candidate;
 else
  billable:=least(p_measured_microusd,r.allocated_credits*o.rate_microusd);
  target:=least(ceil((o.billable_microusd+billable)::numeric/o.rate_microusd)::bigint-o.charged_credits,r.allocated_credits);
  old_sub:=current_setting('request.jwt.claim.sub',true); old_claims:=current_setting('request.jwt.claims',true);
  -- The actor is service-authenticated and bound to this operation. Reuse ALL
  -- existing save authorization and content/locked-block validation. Restore
  -- the request context both normally and when the save subtransaction aborts.
  begin
   perform set_config('request.jwt.claim.sub',p_actor::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
   if p_outcome='saved' then
    if p_candidate is null or (p_candidate->>'expectedVersion')::integer is distinct from r.expected_version then raise exception 'Candidate version conflict' using errcode='PT409'; end if;
    saved:=makeborne_private.save_artifact_version(o.workspace_id,o.artifact_id,r.expected_version,p_candidate->'content',p_candidate->'style',p_candidate->'assetIds',p_candidate->>'summary');
    res:=p_detail||jsonb_build_object('version',(saved->'version'->>'version_number')::integer,'summary',p_candidate->>'summary','changed',true);
   elsif p_outcome='plan' then
    if p_candidate is null or jsonb_typeof(p_candidate->'stored'->'plan') is distinct from 'object' or octet_length(p_candidate::text)>65536 then raise exception 'Invalid plan' using errcode='22023'; end if;
    perform 1 from public.artifacts where id=o.artifact_id and current_version=r.expected_version for update;
    if not found then raise exception 'Revision conflict' using errcode='PT409'; end if;
    select plan into saved_plan from public.artifact_plans where artifact_id=o.artifact_id for update;
    prior_plan_revision:=coalesce((saved_plan->>'revision')::integer,0);
    if (p_candidate->'stored'->>'basedOnVersion')::integer is distinct from r.expected_version or
       (p_candidate->'stored'->>'revision')::integer is distinct from prior_plan_revision+1 then
     raise exception 'Plan revision conflict' using errcode='PT409'; end if;
    if saved_plan is null then
     insert into public.artifact_plans(artifact_id,workspace_id,plan,updated_by)
      values(o.artifact_id,o.workspace_id,(p_candidate->'stored')||jsonb_build_object('revision',0),p_actor)
      on conflict(artifact_id) do nothing returning plan into saved_plan;
     if not found then raise exception 'Plan revision conflict' using errcode='PT409'; end if;
    else
     update public.artifact_plans set plan=(p_candidate->'stored')||jsonb_build_object('revision',prior_plan_revision),updated_by=p_actor,updated_at=clock_timestamp()
      where artifact_id=o.artifact_id returning plan into saved_plan;
    end if;
    res:=jsonb_build_object('stored',saved_plan,'persisted',true);
   else res:=p_detail; end if;
   settlement:=public.makeborne_credit_settle_run(p_actor,r.reference,target,r.exempt,p_detail);
   if settlement->>'outcome' not in ('settled','exempt') then raise exception 'Credit settlement unavailable' using errcode='PT409'; end if;
   charge:=coalesce((settlement->>'charged')::bigint,0);
   if not r.exempt and charge<>target then raise exception 'Credit settlement mismatch' using errcode='PT409'; end if;
   if p_outcome='plan' then
    update public.artifact_plans set plan=plan||jsonb_build_object('charged',charge) where artifact_id=o.artifact_id returning plan into saved_plan;
    res:=jsonb_build_object('stored',saved_plan,'persisted',true);
   end if;
   perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  exception when others then
   perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
   v_outcome:=case when sqlstate='PT409' then 'conflict' else 'save_failed' end; v_recovery:=p_candidate; res:=jsonb_build_object('code',case when sqlstate='PT409' then 'REVISION_CONFLICT' else 'SAVE_FAILED' end,'message','Your result is preserved for recovery. No credits were charged.','saved',false); charge:=0; billable:=0;
  end;
 end if;
 if v_outcome in ('expired','failed','conflict','save_failed') then
  perform public.makeborne_credit_release_run(p_actor,r.reference,ceil(p_measured_microusd::numeric/o.rate_microusd)::bigint,r.exempt,v_outcome,p_detail);
  charge:=0; billable:=0;
 end if;
 update makeborne_private.ai_operations set charged_credits=charged_credits+charge,
  reserved_credits=reserved_credits-case when r.status='active' then r.allocated_credits else 0 end,
  billable_microusd=billable_microusd+case when r.exempt then 0 else billable end,
  pending_kind=case when o.cancel_requested_at is not null then null when (v_outcome='plan' or coalesce((p_detail->>'finished')::boolean,false)) and v_recovery is null and v_outcome not in ('failed','expired','conflict','save_failed') then null
   else case when r.kind='build' then 'continuation' else r.kind end end,
  last_version=case when v_outcome='saved' then (saved->'version'->>'version_number')::integer else last_version end where id=o.id;
 if v_outcome='expired' then res:=jsonb_build_object('code','OPERATION_EXPIRED','message','The step expired. Your result is preserved for recovery.'); end if;
 if v_outcome='failed' then res:=p_detail; end if;
 update makeborne_private.ai_operation_runs set status='finished',charged_credits=charge,measured_microusd=p_measured_microusd,
  outcome=v_outcome,result=coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),recovery=v_recovery,finish_hash=fingerprint,detail=p_detail where id=r.id;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'charged',charge,'outcome',v_outcome,'result',coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),'recovery',case when v_recovery is null then null else jsonb_build_object('runId',r.id,'candidate',v_recovery) end,'replayed',false);
end $$;

-- This service-only entry binds the actor to an existing operation. No creation
-- membership is needed to stop an already authorized action; editing permission
-- and the authenticated actor binding are still checked by the route and here.
create function makeborne_private.ai_operation_cancel(p_actor uuid,p_operation uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; active_run boolean; at_ timestamptz:=clock_timestamp();
begin
 select * into o from makeborne_private.ai_operations where id=p_operation and actor=p_actor for update;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 select exists(select 1 from makeborne_private.ai_operation_runs where operation_id=o.id and status='active') into active_run;
 -- Idempotent and harmless after successful completion, even if the caller's
 -- revision is older. Never rewrite a completed receipt or charge.
 if o.cancel_requested_at is not null or o.status in ('completed','expired') or
    (not active_run and o.pending_kind is null and exists(select 1 from makeborne_private.ai_operation_runs where operation_id=o.id and status='finished' and outcome in ('saved','review_no_change','plan'))) then
  return makeborne_private.ai_operation_read(p_actor,o.workspace_id,o.artifact_id,o.id,null);
 end if;
 if p_expected_revision is distinct from o.revision then raise exception 'Operation revision changed' using errcode='PT409'; end if;
 update makeborne_private.ai_operations set cancel_requested_at=at_,status='cancelled',pending_kind=null,revision=revision+1 where id=o.id;
 update makeborne_private.ai_operation_runs set cancel_requested_at=at_ where operation_id=o.id and status='active';
 return makeborne_private.ai_operation_read(p_actor,o.workspace_id,o.artifact_id,o.id,null);
end $$;
create function public.makeborne_ai_operation_cancel(p_actor uuid,p_operation uuid,p_expected_revision integer) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_cancel(p_actor,p_operation,p_expected_revision); $$;
revoke all on function makeborne_private.ai_operation_cancel(uuid,uuid,integer), public.makeborne_ai_operation_cancel(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.ai_operation_cancel(uuid,uuid,integer), public.makeborne_ai_operation_cancel(uuid,uuid,integer) to service_role;

commit;
