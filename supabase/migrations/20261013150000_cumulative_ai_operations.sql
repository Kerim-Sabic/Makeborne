-- One durable authorization for a user action and its sequential child runs.
-- Lock order: operation -> run -> wallet -> artifact, or operation -> run ->
-- shared provider gate. Provider close/expiry NEVER acquires an operation lock.
-- Exposure is derived from the existing provider ledger; unknown costs retain
-- their bound, and absorbed customer failures do not erase provider exposure.
begin;
create table makeborne_private.ai_operations (
 id uuid primary key default gen_random_uuid(), actor uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, artifact_id uuid not null, action_key uuid not null,
 kind text not null check(kind in ('build','review','plan')), effort text not null,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 request_context jsonb not null default '{}',
 initial_version integer not null, last_version integer not null,
 initial_cap bigint not null check(initial_cap between 1 and 240),
 authorized_credits bigint not null check(authorized_credits between 1 and 1000000),
 charged_credits bigint not null default 0 check(charged_credits>=0),
 reserved_credits bigint not null default 0 check(reserved_credits>=0),
 billable_microusd bigint not null default 0 check(billable_microusd>=0),
 rate_microusd bigint not null check(rate_microusd between 1 and 1000000000),
 policy_version text not null default 'cumulative-v1', revision integer not null default 1,
 pending_kind text check(pending_kind in ('continuation','review','plan')),
 status text not null default 'active' check(status in ('active','paused','completed','expired')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 unique(actor,action_key), foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade,
 check(charged_credits+reserved_credits<=authorized_credits)
);
create table makeborne_private.ai_operation_runs (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null references makeborne_private.ai_operations(id) on delete cascade,
 step_key uuid not null, input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('build','continuation','review','plan')), expected_version integer not null,
 stage_cap bigint not null, allocated_credits bigint not null check(allocated_credits>0),
 reference text not null unique, fence uuid not null default gen_random_uuid(), exempt boolean not null,
 status text not null default 'active' check(status in ('active','finished','expired')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 charged_credits bigint not null default 0, measured_microusd bigint not null default 0,
 outcome text, result jsonb, recovery jsonb, finish_hash text, detail jsonb not null default '{}',
 unique(operation_id,step_key)
);
create unique index ai_operation_one_active on makeborne_private.ai_operation_runs(operation_id) where status='active';
create index ai_operation_artifact on makeborne_private.ai_operations(artifact_id,workspace_id);
create table makeborne_private.ai_operation_authorizations (
 operation_id uuid not null references makeborne_private.ai_operations(id) on delete cascade, request_key uuid not null,
 expected_revision integer not null, additional_credits bigint not null,
 resulting_revision integer not null, created_at timestamptz not null default clock_timestamp(),
 primary key(operation_id,request_key)
);
alter table makeborne_private.ai_operations enable row level security;
alter table makeborne_private.ai_operation_runs enable row level security;
alter table makeborne_private.ai_operation_authorizations enable row level security;
revoke all on makeborne_private.ai_operations,makeborne_private.ai_operation_runs,makeborne_private.ai_operation_authorizations from public,anon,authenticated,service_role;

-- Deleting an artifact/workspace must not strand its actor's wallet hold.
-- Account deletion follows the existing wallet/ledger ON DELETE CASCADE policy;
-- when the actor row is already gone, those wallet rows are being removed too.
-- Provider calls and ai_run_outcomes retain their existing independent audit
-- lifetime. No new call can begin once its operation/run has been deleted.
create function makeborne_private.ai_operation_delete_release() returns trigger
language plpgsql security definer set search_path='' as $$
declare r makeborne_private.ai_operation_runs;
begin
 if exists(select 1 from auth.users where id=old.actor) then
  for r in select * from makeborne_private.ai_operation_runs where operation_id=old.id and status='active' for update loop
   perform public.makeborne_credit_release_run(old.actor,r.reference,0,r.exempt,'operation_deleted','{}');
  end loop;
 end if;
 return old;
end $$;
create trigger ai_operation_delete_release before delete on makeborne_private.ai_operations
 for each row execute function makeborne_private.ai_operation_delete_release();

-- Every plan writer supplies its expected OLD revision. The trigger compares
-- while PostgreSQL holds this plan row lock. It deliberately takes no artifact
-- lock: generated finalization already locks artifact -> plan, while manual
-- edits need only the plan row. New plans must use INSERT, never UPSERT, because
-- BEFORE INSERT rewrites revision 0 to 1 before ON CONFLICT is evaluated.
create function makeborne_private.ai_operation_plan_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare expected integer; prior integer;
begin
 expected:=(new.plan->>'revision')::integer;
 if tg_op='INSERT' then
  if expected is distinct from 0 then raise exception 'Plan revision conflict' using errcode='PT409'; end if;
  new.plan:=new.plan||jsonb_build_object('revision',1);
 else
  if (new.artifact_id,new.workspace_id) is distinct from (old.artifact_id,old.workspace_id) then raise exception 'Plan identity cannot change' using errcode='PT409'; end if;
  prior:=coalesce((old.plan->>'revision')::integer,0);
  if expected is distinct from prior then raise exception 'Plan revision conflict' using errcode='PT409'; end if;
  -- Persisting the authoritative charge is part of the same generated-plan
  -- transaction and does not constitute another content revision.
  new.plan:=new.plan||jsonb_build_object('revision',prior+case when (new.plan-'revision'-'charged') is distinct from (old.plan-'revision'-'charged') then 1 else 0 end);
 end if;
 return new;
end $$;
create trigger ai_operation_plan_revision before insert or update on public.artifact_plans
 for each row execute function makeborne_private.ai_operation_plan_revision();

create function makeborne_private.ai_operation_permission(p_actor uuid,p_workspace uuid,p_artifact uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if p_actor is null or not exists(select 1 from public.artifacts a join public.workspaces w on w.id=a.workspace_id
   where a.id=p_artifact and a.workspace_id=p_workspace and (w.owner_id=p_actor or exists(
    select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=p_actor and m.role='editor'))) then
  raise exception 'Editor permission required' using errcode='42501';
 end if;
end $$;

create function makeborne_private.ai_operation_snapshot(p_operation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'revision',o.revision,'authorizedCredits',o.authorized_credits,
 'chargedCredits',o.charged_credits,'reservedCredits',o.reserved_credits,
 'remainingCredits',greatest(o.authorized_credits-o.charged_credits-o.reserved_credits,0),
 'status',case when o.status='expired' then 'expired' when o.reserved_credits>0 then 'running' else o.status end,
 'maximumAdditionalCredits',o.initial_cap,'pendingKind',o.pending_kind,
 'canContinue',o.status in ('active','paused') and o.reserved_credits=0 and o.expires_at>clock_timestamp()
  and (o.pending_kind is not null or o.status='paused' or exists(select 1 from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.recovery is not null)),
 'recoverable',exists(select 1 from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.recovery is not null),
 'lastVersion',o.last_version,'initialVersion',o.initial_version,'rateMicrousd',o.rate_microusd,
 'effort',o.effort,'kind',o.kind,'expiresAt',o.expires_at,
 'providerRemainingMicrousd',greatest(o.authorized_credits*o.rate_microusd-coalesce((select sum(coalesce(c.charged_microusd,c.bound_microusd))
  from makeborne_private.ai_operation_runs r join makeborne_private.live_provider_calls c on c.run_reference=r.reference where r.operation_id=o.id),0),0))
 from makeborne_private.ai_operations o where o.id=p_operation;
$$;

create function makeborne_private.ai_operation_expire(p_operation uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs;
begin
 select * into o from makeborne_private.ai_operations where id=p_operation for update;
 for r in select * from makeborne_private.ai_operation_runs where operation_id=o.id and status='active'
   and (expires_at<=clock_timestamp() or o.expires_at<=clock_timestamp()) for update loop
  perform public.makeborne_credit_release_run(o.actor,r.reference,0,r.exempt,'operation_run_expired','{}');
  update makeborne_private.ai_operation_runs set status='expired',outcome='expired',result=jsonb_build_object('runId',r.id,'code','OPERATION_EXPIRED','message','The step expired. Check saved progress before continuing.','expired',true,'charged',0) where id=r.id;
  update makeborne_private.ai_operations set reserved_credits=reserved_credits-r.allocated_credits,
   pending_kind=case when r.kind='build' then 'continuation' else r.kind end where id=o.id;
 end loop;
 if o.expires_at<=clock_timestamp() then update makeborne_private.ai_operations set status='expired' where id=o.id; end if;
end $$;

create function makeborne_private.ai_operation_create(p_actor uuid,p_workspace uuid,p_artifact uuid,p_action uuid,p_kind text,p_effort text,p_input_hash text,p_initial_version integer,p_credit_cap bigint,p_rate_microusd bigint,p_context jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; v integer;
begin
 perform makeborne_private.ai_operation_permission(p_actor,p_workspace,p_artifact);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 if p_action is null or p_kind is null or p_kind not in ('build','review','plan') or p_effort is null or p_effort not in ('light','medium','high','super_high','ultra')
  or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_credit_cap is null or p_credit_cap not between 1 and 240
  or p_rate_microusd is null or p_rate_microusd not between 1 and 1000000000 then raise exception 'Invalid operation' using errcode='22023'; end if;
 if p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>100000 or p_initial_version is null or p_initial_version<0 then raise exception 'Invalid request context' using errcode='22023'; end if;
 select current_version into v from public.artifacts where id=p_artifact;
 if v<>p_initial_version and not exists(select 1 from makeborne_private.ai_operations where actor=p_actor and action_key=p_action) then raise exception 'Revision conflict' using errcode='PT409'; end if;
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

create function makeborne_private.ai_operation_read(p_actor uuid,p_workspace uuid,p_artifact uuid,p_operation uuid,p_action uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations;
begin
 perform makeborne_private.ai_operation_permission(p_actor,p_workspace,p_artifact);
 select * into o from makeborne_private.ai_operations where actor=p_actor and workspace_id=p_workspace and artifact_id=p_artifact
 and ((p_operation is not null and id=p_operation) or (p_operation is null and action_key=p_action));
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_expire(o.id);
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),
 'result',(select rr.result from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.result is not null order by rr.created_at desc limit 1),
 'recovery',(select jsonb_build_object('runId',rr.id,'candidate',rr.recovery) from makeborne_private.ai_operation_runs rr where rr.operation_id=o.id and rr.recovery is not null order by rr.created_at desc limit 1),
 'requestContext',o.request_context,'runs',coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'step',r.step_key,'kind',r.kind,'status',r.status,'outcome',r.outcome,'charged',r.charged_credits,'result',r.result,'recovery',r.recovery) order by r.created_at)
  from makeborne_private.ai_operation_runs r where r.operation_id=o.id),'[]'::jsonb));
end $$;

create function makeborne_private.ai_operation_authorize(p_actor uuid,p_operation uuid,p_expected_revision integer,p_request uuid,p_additional_credits bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; a makeborne_private.ai_operation_authorizations;
begin
 select * into o from makeborne_private.ai_operations where id=p_operation and actor=p_actor for update;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 if p_request is null or p_additional_credits is null or p_additional_credits not between 1 and o.initial_cap then raise exception 'Invalid authorization' using errcode='22023'; end if;
 select * into a from makeborne_private.ai_operation_authorizations where operation_id=o.id and request_key=p_request;
 if found then
  if (a.expected_revision,a.additional_credits) is distinct from (p_expected_revision,p_additional_credits) then raise exception 'Authorization key conflict' using errcode='PT409'; end if;
  return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'result',null,'recovery',null);
 end if;
 if p_expected_revision is distinct from o.revision or o.status not in ('active','paused') or o.expires_at<=clock_timestamp()
  or o.authorized_credits+p_additional_credits>1000000 then raise exception 'Authorization conflict or expired operation' using errcode='PT409'; end if;
 insert into makeborne_private.ai_operation_authorizations values(o.id,p_request,p_expected_revision,p_additional_credits,o.revision+1,clock_timestamp());
 update makeborne_private.ai_operations set authorized_credits=authorized_credits+p_additional_credits,revision=revision+1,status='active' where id=o.id;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'result',null,'recovery',null);
end $$;

create function makeborne_private.ai_operation_begin(p_actor uuid,p_operation uuid,p_step uuid,p_kind text,p_input_hash text,p_expected_version integer,p_stage_cap bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; n bigint; hold jsonb; run_id uuid:=gen_random_uuid(); replay boolean:=false;
begin
 select * into o from makeborne_private.ai_operations where id=p_operation and actor=p_actor for update;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.ai_operation_permission(p_actor,o.workspace_id,o.artifact_id);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then raise exception 'Creation access required' using errcode='42501'; end if;
 if p_step is null or p_kind is null or p_kind not in ('build','continuation','review','plan') or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
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

create function makeborne_private.ai_operation_provider_begin(p_actor uuid,p_run uuid,p_fence uuid,p_call uuid,p_provider text,p_model text,p_bound bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; c makeborne_private.live_provider_calls; used numeric; run_used numeric;
begin
 select op.* into o from makeborne_private.ai_operations op join makeborne_private.ai_operation_runs rr on rr.operation_id=op.id where rr.id=p_run and op.actor=p_actor for update of op;
 if not found then raise exception 'Operation unavailable' using errcode='P0002'; end if;
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

create function makeborne_private.ai_operation_finish(p_actor uuid,p_run uuid,p_fence uuid,p_measured_microusd bigint,p_outcome text,p_detail jsonb,p_candidate jsonb) returns jsonb
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
  pending_kind=case when (v_outcome='plan' or coalesce((p_detail->>'finished')::boolean,false)) and v_recovery is null and v_outcome not in ('failed','expired','conflict','save_failed') then null
   else case when r.kind='build' then 'continuation' else r.kind end end,
  last_version=case when v_outcome='saved' then (saved->'version'->>'version_number')::integer else last_version end where id=o.id;
 if v_outcome='expired' then res:=jsonb_build_object('code','OPERATION_EXPIRED','message','The step expired. Your result is preserved for recovery.'); end if;
 if v_outcome='failed' then res:=p_detail; end if;
 update makeborne_private.ai_operation_runs set status='finished',charged_credits=charge,measured_microusd=p_measured_microusd,
  outcome=v_outcome,result=coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),recovery=v_recovery,finish_hash=fingerprint,detail=p_detail where id=r.id;
 return jsonb_build_object('operation',makeborne_private.ai_operation_snapshot(o.id),'charged',charge,'outcome',v_outcome,'result',coalesce(res,'{}')||jsonb_build_object('charged',charge,'runId',r.id),'recovery',case when v_recovery is null then null else jsonb_build_object('runId',r.id,'candidate',v_recovery) end,'replayed',false);
end $$;

create function makeborne_private.ai_operation_recover(p_actor uuid,p_run uuid,p_expected_version integer) returns jsonb
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

-- Explicit public INVOKER wrappers; no table access or definer entry point is
-- granted to a browser role. The service route supplies its authenticated actor.
create function public.makeborne_ai_operation_create(p_actor uuid,p_workspace uuid,p_artifact uuid,p_action uuid,p_kind text,p_effort text,p_input_hash text,p_initial_version integer,p_credit_cap bigint,p_rate_microusd bigint,p_context jsonb) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_create(p_actor,p_workspace,p_artifact,p_action,p_kind,p_effort,p_input_hash,p_initial_version,p_credit_cap,p_rate_microusd,p_context); $$;
create function public.makeborne_ai_operation_read(p_actor uuid,p_workspace uuid,p_artifact uuid,p_operation uuid,p_action uuid) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_read(p_actor,p_workspace,p_artifact,p_operation,p_action); $$;
create function public.makeborne_ai_operation_authorize(p_actor uuid,p_operation uuid,p_expected_revision integer,p_request uuid,p_additional_credits bigint) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_authorize(p_actor,p_operation,p_expected_revision,p_request,p_additional_credits); $$;
create function public.makeborne_ai_operation_begin(p_actor uuid,p_operation uuid,p_step uuid,p_kind text,p_input_hash text,p_expected_version integer,p_stage_cap bigint) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_begin(p_actor,p_operation,p_step,p_kind,p_input_hash,p_expected_version,p_stage_cap); $$;
create function public.makeborne_ai_operation_provider_begin(p_actor uuid,p_run uuid,p_fence uuid,p_call uuid,p_provider text,p_model text,p_bound bigint) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_provider_begin(p_actor,p_run,p_fence,p_call,p_provider,p_model,p_bound); $$;
create function public.makeborne_ai_operation_finish(p_actor uuid,p_run uuid,p_fence uuid,p_measured_microusd bigint,p_outcome text,p_detail jsonb,p_candidate jsonb) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_finish(p_actor,p_run,p_fence,p_measured_microusd,p_outcome,p_detail,p_candidate); $$;
create function public.makeborne_ai_operation_recover(p_actor uuid,p_run uuid,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select makeborne_private.ai_operation_recover(p_actor,p_run,p_expected_version); $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='makeborne_private' and p.proname like 'ai_operation_%') or (n.nspname='public' and p.proname like 'makeborne_ai_operation_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
  if f.proname in ('ai_operation_create','ai_operation_read','ai_operation_authorize','ai_operation_begin','ai_operation_provider_begin','ai_operation_finish','ai_operation_recover') or f.nspname='public' then
   execute format('grant execute on function %s to service_role',f.sig);
  end if;
 end loop;
end $$;
commit;
