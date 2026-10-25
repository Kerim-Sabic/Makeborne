-- Agency execution contract on the EXISTING durable operation system.
-- Additive only: no new ledger, router, recovery or publishing path.
-- * Widens operation/run/pending kinds for agency tasks (ingest, research,
--   image_edit, independent_review, data_report). Builder kinds keep their
--   exact behaviour; agency runs must match their operation's kind.
-- * Agency operations bind a server-verified task scope: workspace, project,
--   client and every input (source/asset/artifact version + sha256) are checked
--   in the same transaction that records the operation, and re-checked before
--   each new run. A cross-workspace or changed input never gets a credit hold.
-- * Finish outcome 'result' persists a typed data result (no artifact write,
--   same fingerprint replay, same settlement); changes still use 'saved' with
--   the expected-version CAS. Agency kinds cannot write plans.
-- * Heartbeat: fenced progress record and lease renewal. Renewal never passes
--   the operation's expiry, 60 minutes from the run's start, or (for credit
--   holds) the hold's fixed 15-minute lifetime, which is billing policy and is
--   unchanged here. Paid agency work longer than a hold uses sequential steps.
-- * Progress read: customer-safe counts of provider calls in flight; provider
--   and model names stay in the operator ledger (live_provider_calls).
-- Lock order unchanged: operation -> run -> wallet -> artifact. Heartbeat and
-- progress take operation -> run only and never lock the wallet.
begin;

alter table makeborne_private.ai_operations drop constraint ai_operations_kind_check;
alter table makeborne_private.ai_operations add constraint ai_operations_kind_check
 check(kind in ('build','review','plan','ingest','research','image_edit','independent_review','data_report'));
alter table makeborne_private.ai_operations drop constraint ai_operations_pending_kind_check;
alter table makeborne_private.ai_operations add constraint ai_operations_pending_kind_check
 check(pending_kind in ('continuation','review','plan','ingest','research','image_edit','independent_review','data_report'));
alter table makeborne_private.ai_operation_runs drop constraint ai_operation_runs_kind_check;
alter table makeborne_private.ai_operation_runs add constraint ai_operation_runs_kind_check
 check(kind in ('build','continuation','review','plan','ingest','research','image_edit','independent_review','data_report'));
alter table makeborne_private.ai_operation_runs add column heartbeat_at timestamptz,
 add column progress jsonb check(progress is null or (jsonb_typeof(progress)='object' and octet_length(progress::text)<=4096)),
 add column lease_renewals integer not null default 0 check(lease_renewals>=0);

create function makeborne_private.ai_operation_agency_kind(p_kind text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_kind in ('ingest','research','image_edit','independent_review','data_report'),false);
$$;

-- Resolves an agency task's scope from the artifact (never from client-sent
-- workspace or actor values) and verifies each input's workspace, project
-- (the artifact's project, or another project of the same client) and current
-- digest. A claimed digest or version that no longer matches is PT409.
create function makeborne_private.agency_task_scope(p_actor uuid,p_artifact uuid,p_inputs jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.artifacts; pr public.projects; i jsonb; resolved jsonb:='[]'; v_kind text; v_id uuid;
 row_ws uuid; row_project uuid; row_sha text; row_version integer; seen uuid[]:='{}';
begin
 if p_actor is null or p_artifact is null then raise exception 'Invalid agency scope' using errcode='22023'; end if;
 select * into a from public.artifacts where id=p_artifact;
 if not found then raise exception 'Editor permission required' using errcode='42501'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,a.workspace_id,a.id);
 select * into pr from public.projects where id=a.project_id and workspace_id=a.workspace_id;
 if p_inputs is null or jsonb_typeof(p_inputs)<>'array' or jsonb_array_length(p_inputs)>50 then raise exception 'Invalid agency inputs' using errcode='22023'; end if;
 for i in select value from jsonb_array_elements(p_inputs) loop
  if jsonb_typeof(i)<>'object' or coalesce(i->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (i ? 'sha256' and jsonb_typeof(i->'sha256')<>'null' and coalesce(i->>'sha256','') !~ '^[a-f0-9]{64}$') then
   raise exception 'Invalid agency input' using errcode='22023'; end if;
  v_kind:=i->>'kind'; v_id:=(i->>'id')::uuid;
  if v_id=any(seen) then raise exception 'Duplicate agency input' using errcode='22023'; end if;
  seen:=seen||v_id; row_ws:=null; row_project:=null; row_sha:=null; row_version:=null;
  if v_kind='source' then
   select s.workspace_id,s.project_id,encode(sha256(convert_to(s.content,'UTF8')),'hex') into row_ws,row_project,row_sha from public.sources s where s.id=v_id;
  elsif v_kind='asset' then
   select s.workspace_id,s.project_id,s.sha256 into row_ws,row_project,row_sha from public.assets s where s.id=v_id;
  elsif v_kind='artifact_version' then
   select v.workspace_id,art.project_id,encode(sha256(convert_to(v.content::text,'UTF8')),'hex'),v.version_number into row_ws,row_project,row_sha,row_version
    from public.artifact_versions v join public.artifacts art on art.id=v.artifact_id and art.workspace_id=v.workspace_id where v.id=v_id;
  else raise exception 'Invalid agency input kind' using errcode='22023'; end if;
  -- Missing and foreign rows are indistinguishable to the caller.
  if row_ws is distinct from a.workspace_id then raise exception 'Input outside workspace' using errcode='42501'; end if;
  if row_project is distinct from a.project_id and not (pr.client_id is not null and exists(select 1 from public.projects q
    where q.id=row_project and q.workspace_id=a.workspace_id and q.client_id=pr.client_id)) then
   raise exception 'Input outside project scope' using errcode='42501'; end if;
  if row_sha is null or row_sha !~ '^[a-f0-9]{64}$' then raise exception 'Input has no verifiable digest' using errcode='22023'; end if;
  if v_kind in ('source','asset') and not (i ? 'sha256') then raise exception 'Input digest required' using errcode='22023'; end if;
  if v_kind='artifact_version' and not (i ? 'version') then raise exception 'Input version required' using errcode='22023'; end if;
  if (i ? 'sha256' and jsonb_typeof(i->'sha256')<>'null' and i->>'sha256' is distinct from row_sha)
   or (v_kind='artifact_version' and (i->>'version')::integer is distinct from row_version) then
   raise exception 'Input changed' using errcode='PT409'; end if;
  resolved:=resolved||jsonb_build_array(jsonb_build_object('kind',v_kind,'id',v_id,'sha256',row_sha,'version',row_version,'projectId',row_project));
 end loop;
 return jsonb_build_object('workspaceId',a.workspace_id,'projectId',a.project_id,'clientId',pr.client_id,'artifactId',a.id,
  'currentVersion',a.current_version,'inputs',resolved);
end $$;

create or replace function makeborne_private.ai_operation_create(p_actor uuid,p_workspace uuid,p_artifact uuid,p_action uuid,p_kind text,p_effort text,p_input_hash text,p_initial_version integer,p_credit_cap bigint,p_rate_microusd bigint,p_context jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; v integer; scope jsonb;
begin
 perform makeborne_private.ai_operation_permission(p_actor,p_workspace,p_artifact);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 if p_action is null or p_kind is null or p_kind not in ('build','review','plan','ingest','research','image_edit','independent_review','data_report') or p_effort is null or p_effort not in ('light','medium','high','super_high','ultra')
  or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_credit_cap is null or p_credit_cap not between 1 and 240
  or p_rate_microusd is null or p_rate_microusd not between 1 and 1000000000 then raise exception 'Invalid operation' using errcode='22023'; end if;
 if p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>100000 or p_initial_version is null or p_initial_version<0 then raise exception 'Invalid request context' using errcode='22023'; end if;
 select current_version into v from public.artifacts where id=p_artifact;
 if v<>p_initial_version and not exists(select 1 from makeborne_private.ai_operations where actor=p_actor and action_key=p_action) then raise exception 'Revision conflict' using errcode='PT409'; end if;
 -- A new agency operation records only a scope verified now. Replays compare
 -- against the stored context below, exactly as for builder operations.
 if makeborne_private.ai_operation_agency_kind(p_kind) and not exists(select 1 from makeborne_private.ai_operations where actor=p_actor and action_key=p_action) then
  if jsonb_typeof(p_context->'task') is distinct from 'object' then raise exception 'Agency task scope required' using errcode='22023'; end if;
  scope:=makeborne_private.agency_task_scope(p_actor,p_artifact,p_context->'task'->'inputs');
  if (scope->>'workspaceId')::uuid is distinct from p_workspace or scope->'inputs' is distinct from p_context->'task'->'inputs'
   or scope->'projectId' is distinct from p_context->'task'->'projectId' or scope->'clientId' is distinct from p_context->'task'->'clientId' then
   raise exception 'Agency task scope conflict' using errcode='PT409'; end if;
 end if;
 insert into makeborne_private.ai_operations(actor,workspace_id,artifact_id,action_key,kind,effort,input_hash,initial_version,last_version,initial_cap,authorized_credits,rate_microusd,request_context)
 values(p_actor,p_workspace,p_artifact,p_action,p_kind,p_effort,p_input_hash,p_initial_version,p_initial_version,p_credit_cap,p_credit_cap,p_rate_microusd,p_context)
 on conflict(actor,action_key) do nothing;
 select * into o from makeborne_private.ai_operations where actor=p_actor and action_key=p_action for update;
 if (o.workspace_id,o.artifact_id,o.kind,o.effort,o.input_hash,o.initial_version,o.initial_cap,o.rate_microusd,o.request_context)
   is distinct from (p_workspace,p_artifact,p_kind,p_effort,p_input_hash,p_initial_version,p_credit_cap,p_rate_microusd,p_context) then
  raise exception 'Operation key reused with different input' using errcode='PT409'; end if;
 perform makeborne_private.ai_operation_expire(o.id);
 return makeborne_private.ai_operation_snapshot(o.id);
end $$;

create or replace function makeborne_private.ai_operation_begin(p_actor uuid,p_operation uuid,p_step uuid,p_kind text,p_input_hash text,p_expected_version integer,p_stage_cap bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; n bigint; hold jsonb; run_id uuid:=gen_random_uuid(); replay boolean:=false;
begin
 select * into o from makeborne_private.ai_operations where id=p_operation and actor=p_actor for update;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 if p_step is null or p_kind is null or p_kind not in ('build','continuation','review','plan','ingest','research','image_edit','independent_review','data_report') or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
  or p_stage_cap is null or p_stage_cap not between 1 and 1000000 then raise exception 'Invalid child run' using errcode='22023'; end if;
 perform makeborne_private.ai_operation_expire(o.id);
 select * into o from makeborne_private.ai_operations where id=o.id;
 select * into r from makeborne_private.ai_operation_runs where operation_id=o.id and step_key=p_step;
 if found then
  if (r.kind,r.input_hash,r.expected_version,r.stage_cap) is distinct from (p_kind,p_input_hash,p_expected_version,p_stage_cap) then raise exception 'Step key conflict' using errcode='PT409'; end if;
  replay:=true;
 else
  if o.status not in ('active','paused') then raise exception 'Operation expired or completed' using errcode='PT409'; end if;
  if exists(select 1 from makeborne_private.ai_operation_runs where operation_id=o.id and status='active') then return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'error',jsonb_build_object('code','OPERATION_BUSY')); end if;
  if p_expected_version is distinct from o.last_version or not exists(select 1 from public.artifacts where id=o.artifact_id and current_version=p_expected_version) then raise exception 'Revision conflict' using errcode='PT409'; end if;
  if (o.kind='plan') is distinct from (p_kind='plan') or (o.kind='review' and p_kind<>'review') then raise exception 'Operation kind conflict' using errcode='PT409'; end if;
  if (makeborne_private.ai_operation_agency_kind(o.kind) or makeborne_private.ai_operation_agency_kind(p_kind)) and p_kind is distinct from o.kind then raise exception 'Operation kind conflict' using errcode='PT409'; end if;
  -- Every new agency step runs against the exact inputs the operation recorded.
  if makeborne_private.ai_operation_agency_kind(o.kind) then perform makeborne_private.agency_task_scope(p_actor,o.artifact_id,o.request_context->'task'->'inputs'); end if;
  n:=least(p_stage_cap,o.authorized_credits-o.charged_credits-o.reserved_credits);
  if n<=0 or (makeborne_private.ai_operation_snapshot(o.id)->>'providerRemainingMicrousd')::numeric<=0 then
   update makeborne_private.ai_operations set status='paused',pending_kind=case when p_kind='build' then 'continuation' else p_kind end where id=o.id;
   return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'error',jsonb_build_object('code','OPERATION_BUDGET_REACHED'));
  end if;
  if not makeborne_private.has_unlimited_credits(p_actor) then
   perform makeborne_private.lock_credit_wallet(p_actor);
   n:=least(n,makeborne_private.credit_available(p_actor));
   if n<=0 then raise exception 'Insufficient credits' using errcode='MB402'; end if;
  end if;
  hold:=makeborne_private.credit_reserve(p_actor,n,'operation:'||run_id::text);
  insert into makeborne_private.ai_operation_runs(id,operation_id,step_key,input_hash,kind,expected_version,stage_cap,allocated_credits,reference,exempt,expires_at)
  values(run_id,o.id,p_step,p_input_hash,p_kind,p_expected_version,p_stage_cap,n,'operation:'||run_id::text,coalesce((hold->>'unlimited')::boolean,false),least(clock_timestamp()+interval '15 minutes',o.expires_at)) returning * into r;
  update makeborne_private.ai_operations set reserved_credits=reserved_credits+n,status='active',pending_kind=null where id=o.id;
 end if;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'requestContext',o.request_context,'replayed',replay,'result',r.result,'recovery',case when r.recovery is null then null else jsonb_build_object('runId',r.id,'candidate',r.recovery) end,
  'run',jsonb_build_object('id',r.id,'reference',r.reference,'fence',r.fence,'amount',r.allocated_credits,'exempt',r.exempt,'reservedAt',r.created_at,'expiresAt',r.expires_at,'status',r.status));
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
  or p_outcome not in ('saved','review_no_change','incomplete','failed','plan','result') or p_detail is null or jsonb_typeof(p_detail)<>'object' or octet_length(p_detail::text)>4096
  or (p_candidate is not null and (jsonb_typeof(p_candidate)<>'object' or octet_length(p_candidate::text)>6000000)) then raise exception 'Invalid finalization' using errcode='22023'; end if;
 -- Agency tasks return data or a version-checked change; builder kinds never return 'result'.
 if (makeborne_private.ai_operation_agency_kind(o.kind) and p_outcome not in ('saved','incomplete','failed','result'))
  or (not makeborne_private.ai_operation_agency_kind(o.kind) and p_outcome='result')
  or (p_outcome='result' and (p_candidate is null or jsonb_typeof(p_candidate->'data') is distinct from 'object' or octet_length(p_candidate::text)>262144)) then
  raise exception 'Invalid finalization' using errcode='22023'; end if;
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
   elsif p_outcome='result' then
    -- Data only: nothing is applied to the project, so no version CAS applies.
    -- The revision the data was produced against is recorded with it.
    res:=p_detail||jsonb_build_object('data',p_candidate->'data','basedOnVersion',r.expected_version,'persisted',true,'finished',true);
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
  pending_kind=case when o.cancel_requested_at is not null then null when (v_outcome in ('plan','result') or coalesce((p_detail->>'finished')::boolean,false)) and v_recovery is null and v_outcome not in ('failed','expired','conflict','save_failed') then null
   else case when r.kind='build' then 'continuation' else r.kind end end,
  last_version=case when v_outcome='saved' then (saved->'version'->>'version_number')::integer else last_version end where id=o.id;
 if v_outcome='expired' then res:=jsonb_build_object('code','OPERATION_EXPIRED','message','The step expired. Your result is preserved for recovery.'); end if;
 if v_outcome='failed' then res:=p_detail; end if;
 update makeborne_private.ai_operation_runs set status='finished',charged_credits=charge,measured_microusd=p_measured_microusd,
  outcome=v_outcome,result=coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),recovery=v_recovery,finish_hash=fingerprint,detail=p_detail where id=r.id;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'charged',charge,'outcome',v_outcome,'result',coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),'recovery',case when v_recovery is null then null else jsonb_build_object('runId',r.id,'candidate',v_recovery) end,'replayed',false);
end $$;

create or replace function makeborne_private.ai_operation_recover(p_actor uuid,p_run uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; saved jsonb; saved_plan jsonb; prior_plan_revision integer; res jsonb; old_sub text; old_claims text;
begin
 select op.* into o from makeborne_private.ai_operations op join makeborne_private.ai_operation_runs rr on rr.operation_id=op.id where rr.id=p_run and op.actor=p_actor for update of op;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 select * into r from makeborne_private.ai_operation_runs where id=p_run for update;
 if r.recovery is null then
  if r.result->>'recoveredFromVersion'=p_expected_version::text then
   return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'result',r.result,'recovery',null);
  end if;
  raise exception 'No recoverable candidate' using errcode='PT409';
 end if;
 if exists(select 1 from makeborne_private.ai_operation_runs where operation_id=o.id and status='active') then raise exception 'Operation still running' using errcode='PT409'; end if;
 if makeborne_private.ai_operation_agency_kind(o.kind) and r.recovery ? 'data' then
  -- An agency data result is recorded, never applied: no artifact or plan write.
  if jsonb_typeof(r.recovery->'data') is distinct from 'object' then raise exception 'No recoverable candidate' using errcode='PT409'; end if;
  res:=jsonb_build_object('runId',r.id,'data',r.recovery->'data','basedOnVersion',r.expected_version,'persisted',true,'finished',true,'charged',r.charged_credits,'recoveredFromVersion',p_expected_version);
  update makeborne_private.ai_operation_runs set result=res,recovery=null where id=r.id;
  update makeborne_private.ai_operations set pending_kind=null where id=o.id;
  return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'result',res,'recovery',null);
 end if;
 old_sub:=current_setting('request.jwt.claim.sub',true); old_claims:=current_setting('request.jwt.claims',true);
 begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
  if r.recovery ? 'stored' then
   if not makeborne_private.can_edit(o.workspace_id) then raise exception 'Editor permission required' using errcode='42501'; end if;
   perform 1 from public.artifacts where id=o.artifact_id and current_version=p_expected_version for update;
   if not found then raise exception 'Revision conflict' using errcode='PT409'; end if;
   select plan into saved_plan from public.artifact_plans where artifact_id=o.artifact_id for update;
   prior_plan_revision:=coalesce((saved_plan->>'revision')::integer,0);
   saved:=(r.recovery->'stored')||jsonb_build_object('charged',r.charged_credits,'basedOnVersion',p_expected_version,'revision',prior_plan_revision);
   if saved_plan is null then
    insert into public.artifact_plans(artifact_id,workspace_id,plan,updated_by) values(o.artifact_id,o.workspace_id,saved,p_actor)
     on conflict(artifact_id) do nothing returning plan into saved;
    if not found then raise exception 'Plan revision conflict' using errcode='PT409'; end if;
   else
    update public.artifact_plans set plan=saved,updated_by=p_actor,updated_at=clock_timestamp() where artifact_id=o.artifact_id returning plan into saved;
   end if;
  else
   saved:=makeborne_private.save_artifact_version(o.workspace_id,o.artifact_id,p_expected_version,r.recovery->'content',r.recovery->'style',r.recovery->'assetIds',r.recovery->>'summary');
  end if;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  raise;
 end;
 res:=case when r.recovery ? 'stored' then jsonb_build_object('runId',r.id,'stored',saved,'persisted',true,'charged',r.charged_credits,'recoveredFromVersion',p_expected_version)
 else jsonb_build_object('runId',r.id,'version',(saved->'version'->>'version_number')::integer,'summary',r.recovery->>'summary','changed',true,'finished',coalesce((r.detail->>'finished')::boolean,false),'charged',r.charged_credits,'recoveredFromVersion',p_expected_version) end;
 update makeborne_private.ai_operation_runs set result=res,recovery=null where id=r.id;
 update makeborne_private.ai_operations set last_version=coalesce((saved->'version'->>'version_number')::integer,p_expected_version),
  pending_kind=case when r.recovery ? 'stored' or coalesce((r.detail->>'finished')::boolean,false) then null else case when r.kind='build' then 'continuation' else r.kind end end where id=o.id;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'result',res,'recovery',null);
end $$;

create or replace function makeborne_private.ai_operation_cancel(p_actor uuid,p_operation uuid,p_expected_revision integer) returns jsonb
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
    (not active_run and o.pending_kind is null and exists(select 1 from makeborne_private.ai_operation_runs where operation_id=o.id and status='finished' and outcome in ('saved','review_no_change','plan','result'))) then
  return makeborne_private.ai_operation_read(p_actor,o.workspace_id,o.artifact_id,o.id,null);
 end if;
 if p_expected_revision is distinct from o.revision then raise exception 'Operation revision changed' using errcode='PT409'; end if;
 update makeborne_private.ai_operations set cancel_requested_at=at_,status='cancelled',pending_kind=null,revision=revision+1 where id=o.id;
 update makeborne_private.ai_operation_runs set cancel_requested_at=at_ where operation_id=o.id and status='active';
 return makeborne_private.ai_operation_read(p_actor,o.workspace_id,o.artifact_id,o.id,null);
end $$;

-- Fenced liveness, progress and bounded lease renewal for one active run.
-- Returns active=false (no write) once the run cannot make further calls.
create function makeborne_private.ai_operation_heartbeat(p_actor uuid,p_run uuid,p_fence uuid,p_progress jsonb,p_renew boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; hold jsonb; lease timestamptz;
begin
 select op.* into o from makeborne_private.ai_operations op join makeborne_private.ai_operation_runs rr on rr.operation_id=op.id where rr.id=p_run and op.actor=p_actor for update of op;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 select * into r from makeborne_private.ai_operation_runs where id=p_run for update;
 if p_fence is distinct from r.fence then raise exception 'Worker fence conflict' using errcode='PT409'; end if;
 if p_progress is not null and (jsonb_typeof(p_progress)<>'object' or octet_length(p_progress::text)>4096) then raise exception 'Invalid progress' using errcode='22023'; end if;
 if not r.exempt then hold:=public.makeborne_credit_hold_status(p_actor,r.reference); end if;
 if r.status<>'active' or r.expires_at<=clock_timestamp() or o.expires_at<=clock_timestamp() or o.cancel_requested_at is not null
  or (not r.exempt and not coalesce((hold->>'active')::boolean,false)) then
  return jsonb_build_object('active',false,'cancelRequested',o.cancel_requested_at is not null,'status',r.status,'expiresAt',r.expires_at,'renewed',false);
 end if;
 lease:=r.expires_at;
 if coalesce(p_renew,false) then
  lease:=least(clock_timestamp()+interval '15 minutes',o.expires_at,r.created_at+interval '60 minutes');
  if not r.exempt then lease:=least(lease,(hold->>'expiresAt')::timestamptz); end if;
  lease:=greatest(lease,r.expires_at);
 end if;
 update makeborne_private.ai_operation_runs set heartbeat_at=clock_timestamp(),progress=coalesce(p_progress,progress),expires_at=lease,
  lease_renewals=lease_renewals+case when lease>r.expires_at then 1 else 0 end where id=r.id;
 return jsonb_build_object('active',true,'cancelRequested',false,'status',r.status,'expiresAt',lease,'renewed',lease>r.expires_at);
end $$;

-- Reconnect/refresh view: recorded state only, never a relaunch. Call counts
-- are customer-safe; exact provider/model rows stay in the operator ledger.
create function makeborne_private.ai_operation_progress(p_actor uuid,p_workspace uuid,p_artifact uuid,p_operation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o makeborne_private.ai_operations;
begin
 perform makeborne_private.ai_operation_permission(p_actor,p_workspace,p_artifact);
 select * into o from makeborne_private.ai_operations where id=p_operation and actor=p_actor and workspace_id=p_workspace and artifact_id=p_artifact;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),
  'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'outcome',r.outcome,'heartbeatAt',r.heartbeat_at,
    'progress',r.progress,'expiresAt',r.expires_at,'cancelRequested',r.cancel_requested_at is not null) order by r.created_at)
   from makeborne_private.ai_operation_runs r where r.operation_id=o.id),'[]'::jsonb),
  'calls',(select jsonb_build_object('inProgress',count(*) filter (where c.status='open'),'uncertain',count(*) filter (where c.status in ('uncertain','expired')),
    'settled',count(*) filter (where c.status='settled'))
   from makeborne_private.ai_operation_runs r join makeborne_private.live_provider_calls c on c.run_reference=r.reference where r.operation_id=o.id));
end $$;

create function public.makeborne_agency_task_scope(p_actor uuid,p_artifact uuid,p_inputs jsonb) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.agency_task_scope(p_actor,p_artifact,p_inputs); $$;
create function public.makeborne_ai_operation_heartbeat(p_actor uuid,p_run uuid,p_fence uuid,p_progress jsonb,p_renew boolean) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_heartbeat(p_actor,p_run,p_fence,p_progress,p_renew); $$;
create function public.makeborne_ai_operation_progress(p_actor uuid,p_workspace uuid,p_artifact uuid,p_operation uuid) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_progress(p_actor,p_workspace,p_artifact,p_operation); $$;

-- New functions default to PUBLIC execute: close every one, then open only the
-- service entry points (private definer bodies the invoker wrappers call).
revoke all on function makeborne_private.ai_operation_agency_kind(text), makeborne_private.agency_task_scope(uuid,uuid,jsonb),
 makeborne_private.ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean), makeborne_private.ai_operation_progress(uuid,uuid,uuid,uuid),
 public.makeborne_agency_task_scope(uuid,uuid,jsonb), public.makeborne_ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean),
 public.makeborne_ai_operation_progress(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.agency_task_scope(uuid,uuid,jsonb), makeborne_private.ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean),
 makeborne_private.ai_operation_progress(uuid,uuid,uuid,uuid), public.makeborne_agency_task_scope(uuid,uuid,jsonb),
 public.makeborne_ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean), public.makeborne_ai_operation_progress(uuid,uuid,uuid,uuid) to service_role;

commit;
