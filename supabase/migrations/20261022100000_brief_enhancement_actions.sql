-- Durable brief-enhancement actions: the optional, free prompt help before a
-- first website build (POST /api/build/enhance).
--
-- One row per (actor, action key): the client's Idempotency-Key, bound to the
-- workspace, the website artifact and the canonical request digest. The claim
-- inserts the row and takes its one-credit hold in ONE transaction, so a
-- concurrent or repeated claim (another instance, a retry after a lost
-- response, a restart) finds the row and replays it: no second hold and no
-- second provider call. The same key with a different input is a conflict.
--
-- States:
--   running      claimed; hold reserved (or exempt); a worker may call the provider
--   releasing    outcome recorded durably (result, failure or stop); the hold's
--                release is not yet confirmed. Recovery retries the release.
--   completed    result usable; hold released and verified (charge 0)
--   failed       no usable result; hold released and verified (charge 0)
--   cancelled    stopped before a result; hold released and verified (charge 0)
--   expired      the worker vanished before recording; hold released (charge 0)
--   needs_review the hold was missing, already released, lapsed or settled when
--                the release ran: the result is kept but never delivered as
--                usable; nothing is re-charged to hide the fault.
-- The step stays free: the hold is only ever released, never settled.
--
-- Lock order: enhancement row -> wallet (credit_release/credit_reserve), or
-- enhancement row -> shared provider gate. Nothing locks in the reverse order.
-- Access: service role only, through the public security-invoker wrappers,
-- which check owner/editor permission for the actor on the artifact.
begin;

create table makeborne_private.brief_enhancements (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null,
 artifact_id uuid not null,
 action_key uuid not null,
 input_hash text check (input_hash ~ '^[a-f0-9]{64}$'),
 mode text check (mode in ('enhance','analyze')),
 status text not null check (status in ('running','releasing','completed','failed','cancelled','expired','needs_review')),
 outcome text check (outcome in ('completed','failed','cancelled','expired')),
 reference text unique check (length(reference) between 1 and 200),
 hold_credits bigint not null default 0 check (hold_credits between 0 and 10),
 exempt boolean not null default false,
 provider_cap_microusd bigint not null default 0 check (provider_cap_microusd between 0 and 1000000),
 fence uuid not null default gen_random_uuid(),
 cancel_requested_at timestamptz,
 result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 32768)),
 failure jsonb check (failure is null or (jsonb_typeof(failure) = 'object' and octet_length(failure::text) <= 2048)),
 measured_credits bigint not null default 0 check (measured_credits between 0 and 1000000),
 provider_microusd bigint not null default 0 check (provider_microusd >= 0),
 billing text not null check (billing in ('none','held','exempt','released','missing_hold','released_hold','expired_hold','settled_hold')),
 charged_credits bigint check (charged_credits >= 0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 lease_expires_at timestamptz not null,
 resolved_at timestamptz,
 unique (actor, action_key),
 foreign key (artifact_id, workspace_id) references public.artifacts(id, workspace_id) on delete cascade,
 -- A claimed action always names its hold; only a Stop recorded before any claim has none.
 check ((reference is null) = (billing = 'none')),
 check (billing <> 'none' or (status = 'cancelled' and hold_credits = 0)),
 check ((status = 'running') = (outcome is null)),
 check (status not in ('running','releasing') or billing in ('held','exempt')),
 -- The charge is known (and recorded) exactly when the hold was resolved.
 check ((status in ('running','releasing')) = (charged_credits is null)),
 check ((status in ('running','releasing')) = (resolved_at is null)),
 check (status <> 'completed' or (result is not null and outcome = 'completed' and billing in ('released','exempt'))),
 check (status not in ('failed','cancelled','expired') or billing in ('released','exempt','none','expired_hold')),
 check (status <> 'needs_review' or billing in ('missing_hold','released_hold','expired_hold','settled_hold')),
 check (outcome is distinct from 'failed' or failure is not null)
);
create index brief_enhancements_artifact on makeborne_private.brief_enhancements(artifact_id, workspace_id);
create index brief_enhancements_open on makeborne_private.brief_enhancements(lease_expires_at) where status in ('running','releasing');
alter table makeborne_private.brief_enhancements enable row level security;
revoke all on makeborne_private.brief_enhancements from public, anon, authenticated, service_role;

-- What the app may show: never the input digest, fence or hold reference.
-- The result is returned only once the action completed with a verified release.
create function makeborne_private.brief_enhancement_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id', e.id, 'key', e.action_key, 'status', e.status, 'mode', e.mode, 'outcome', e.outcome,
  'cancelRequested', e.cancel_requested_at is not null, 'billing', e.billing, 'holdCredits', e.hold_credits,
  'chargedCredits', e.charged_credits, 'createdAt', e.created_at, 'updatedAt', e.updated_at, 'resolvedAt', e.resolved_at,
  'failure', e.failure, 'result', case when e.status = 'completed' then e.result else null end)
 from makeborne_private.brief_enhancements e where e.id = p_id;
$$;

-- Returns the hold exactly once and verifies how it ended. Called with the
-- enhancement row locked. A hold that was not reserved when we came to return
-- it (missing, already released, lapsed after 15 minutes, or settled) is an
-- anomaly: it is recorded as such and never re-charged.
create function makeborne_private.brief_enhancement_return_hold(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; res jsonb; r makeborne_private.credit_reservations; v_billing text; v_charged bigint := 0;
  v_detail jsonb;
begin
 select * into e from makeborne_private.brief_enhancements where id = p_id;
 v_detail := jsonb_build_object('kind', 'brief_enhance', 'reason', p_reason, 'providerMicrousd', e.provider_microusd);
 if e.billing = 'exempt' then
  -- Unlimited accounts hold nothing; the measured cost is still recorded as absorbed.
  perform makeborne_private.record_ai_run(e.actor, e.reference, 'exempt', e.measured_credits, 0, v_detail);
  return jsonb_build_object('billing', 'exempt', 'charged', 0, 'anomaly', false);
 end if;
 res := makeborne_private.credit_release(e.actor, e.reference);
 if coalesce((res->>'replayed')::boolean, false) then
  select * into r from makeborne_private.credit_reservations where user_id = e.actor and reference = e.reference;
  if not found then v_billing := 'missing_hold';
  elsif r.status = 'settled' then v_billing := 'settled_hold'; v_charged := coalesce(r.charged, 0);
  elsif r.resolved_at >= r.created_at + interval '15 minutes' then v_billing := 'expired_hold';
  else v_billing := 'released_hold';
  end if;
  perform makeborne_private.record_ai_run(e.actor, e.reference, case when v_billing = 'missing_hold' then 'missing_hold' else 'released_hold' end,
   e.measured_credits, 0, v_detail || jsonb_build_object('anomaly', v_billing));
  return jsonb_build_object('billing', v_billing, 'charged', v_charged, 'anomaly', true);
 end if;
 if coalesce((res->>'released')::bigint, 0) + coalesce((res->>'lapsed')::bigint, 0) <> e.hold_credits then
  raise exception 'Brief enhancement hold out of balance' using errcode = 'XX000';
 end if;
 perform makeborne_private.record_ai_run(e.actor, e.reference, 'released', e.measured_credits, 0, v_detail);
 return jsonb_build_object('billing', 'released', 'charged', 0, 'anomaly', false);
end $$;

-- A running action whose worker vanished (lease over) is closed: its hold is
-- returned and the action is expired. Called with the row locked.
create function makeborne_private.brief_enhancement_expire(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; hold jsonb;
begin
 select * into e from makeborne_private.brief_enhancements where id = p_id for update;
 if not found or e.status <> 'running' or e.lease_expires_at > clock_timestamp() then return; end if;
 hold := makeborne_private.brief_enhancement_return_hold(e.id, 'brief_enhance_expired');
 update makeborne_private.brief_enhancements set
  status = case when hold->>'billing' in ('released','exempt','expired_hold') then 'expired' else 'needs_review' end,
  outcome = 'expired', billing = hold->>'billing', charged_credits = (hold->>'charged')::bigint,
  updated_at = clock_timestamp(), resolved_at = clock_timestamp()
 where id = e.id;
end $$;

-- Locks the actor's action for this workspace and artifact (or raises P0002).
create function makeborne_private.brief_enhancement_lock(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns makeborne_private.brief_enhancements
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements;
begin
 select * into e from makeborne_private.brief_enhancements where actor = p_actor and action_key = p_action for update;
 -- Another project's action is never revealed through this one.
 if not found or (e.workspace_id, e.artifact_id) is distinct from (p_workspace, p_artifact) then
  raise exception 'Brief enhancement not found' using errcode = 'P0002';
 end if;
 return e;
end $$;

create function makeborne_private.brief_enhance_claim(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid, p_input_hash text,
 p_mode text, p_hold_credits bigint, p_provider_cap_microusd bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; res jsonb; v_id uuid := gen_random_uuid();
begin
 if p_actor is null or p_action is null or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_mode not in ('enhance','analyze')
    or p_hold_credits is null or p_hold_credits not between 1 and 10 or p_provider_cap_microusd is null or p_provider_cap_microusd not between 1 and 1000000 then
  raise exception 'Invalid brief enhancement' using errcode = '22023';
 end if;
 perform makeborne_private.ai_operation_permission(p_actor, p_workspace, p_artifact);
 if not exists (select 1 from public.artifacts where id = p_artifact and workspace_id = p_workspace and kind = 'website') then
  raise exception 'Website unavailable' using errcode = 'P0002';
 end if;
 insert into makeborne_private.brief_enhancements(id, actor, workspace_id, artifact_id, action_key, input_hash, mode, status, billing,
  provider_cap_microusd, reference, lease_expires_at)
 values (v_id, p_actor, p_workspace, p_artifact, p_action, p_input_hash, p_mode, 'running', 'held', p_provider_cap_microusd,
  'brief_enhance:' || v_id::text, clock_timestamp() + interval '3 minutes')
 on conflict (actor, action_key) do nothing
 returning * into e;
 if not found then
  -- Another request (concurrent, retried, or from before a restart) holds this action: replay it.
  -- The same key for another project or another input is a conflict, never a second action.
  select * into e from makeborne_private.brief_enhancements where actor = p_actor and action_key = p_action for update;
  if (e.workspace_id, e.artifact_id) is distinct from (p_workspace, p_artifact) or (e.input_hash is not null and e.input_hash <> p_input_hash) then
   raise exception 'Brief enhancement input conflict' using errcode = 'PT409';
  end if;
  perform makeborne_private.brief_enhancement_expire(e.id);
  return jsonb_build_object('replayed', true, 'action', makeborne_private.brief_enhancement_snapshot(e.id));
 end if;
 -- In the same transaction: no room (no credits, monthly limit) aborts the claim too.
 res := makeborne_private.credit_reserve(p_actor, p_hold_credits, e.reference);
 if coalesce((res->>'unlimited')::boolean, false) then
  update makeborne_private.brief_enhancements set exempt = true, billing = 'exempt', hold_credits = 0 where id = e.id returning * into e;
 elsif res->>'status' = 'reserved' and not coalesce((res->>'replayed')::boolean, true) and (res->>'amount')::bigint = p_hold_credits then
  update makeborne_private.brief_enhancements set hold_credits = p_hold_credits where id = e.id returning * into e;
 else
  raise exception 'Brief enhancement hold conflict' using errcode = 'PT409';
 end if;
 return jsonb_build_object('replayed', false, 'action', makeborne_private.brief_enhancement_snapshot(e.id),
  'run', jsonb_build_object('id', e.id, 'fence', e.fence, 'reference', e.reference, 'amount', e.hold_credits, 'exempt', e.exempt,
   'reservedAt', e.created_at, 'leaseExpiresAt', e.lease_expires_at));
end $$;

create function makeborne_private.brief_enhance_read(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements;
begin
 perform makeborne_private.ai_operation_permission(p_actor, p_workspace, p_artifact);
 e := makeborne_private.brief_enhancement_lock(p_actor, p_workspace, p_artifact, p_action);
 perform makeborne_private.brief_enhancement_expire(e.id);
 return jsonb_build_object('action', makeborne_private.brief_enhancement_snapshot(e.id));
end $$;

-- Stop. Before any claim it records a stopped action, so a late request with
-- the same key never starts; while running it marks the request so no new
-- provider call is admitted; after an outcome it changes nothing (a completed
-- enhancement keeps its result and receipt).
create function makeborne_private.brief_enhance_cancel(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements;
begin
 if p_actor is null or p_action is null then raise exception 'Invalid brief enhancement' using errcode = '22023'; end if;
 perform makeborne_private.ai_operation_permission(p_actor, p_workspace, p_artifact);
 insert into makeborne_private.brief_enhancements(actor, workspace_id, artifact_id, action_key, status, outcome, billing, charged_credits,
  lease_expires_at, resolved_at)
 values (p_actor, p_workspace, p_artifact, p_action, 'cancelled', 'cancelled', 'none', 0, clock_timestamp(), clock_timestamp())
 on conflict (actor, action_key) do nothing
 returning * into e;
 if found then return jsonb_build_object('action', makeborne_private.brief_enhancement_snapshot(e.id)); end if;
 e := makeborne_private.brief_enhancement_lock(p_actor, p_workspace, p_artifact, p_action);
 if e.status = 'running' and e.cancel_requested_at is null then
  update makeborne_private.brief_enhancements set cancel_requested_at = clock_timestamp(), updated_at = clock_timestamp() where id = e.id;
 end if;
 perform makeborne_private.brief_enhancement_expire(e.id);
 return jsonb_build_object('action', makeborne_private.brief_enhancement_snapshot(e.id));
end $$;

-- The provider gate for this action's worker: refuses after Stop, after the
-- lease or the hold ended, for a stale worker, or beyond the action's cap.
create function makeborne_private.brief_enhance_provider_begin(p_actor uuid, p_id uuid, p_fence uuid, p_call uuid, p_provider text, p_model text, p_bound bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; c makeborne_private.live_provider_calls; used numeric;
begin
 select * into e from makeborne_private.brief_enhancements where id = p_id and actor = p_actor for update;
 if not found then raise exception 'Brief enhancement not found' using errcode = 'P0002'; end if;
 if e.cancel_requested_at is not null then raise exception 'Brief enhancement stopped' using errcode = 'MB499'; end if;
 perform makeborne_private.ai_operation_permission(p_actor, e.workspace_id, e.artifact_id);
 if not (makeborne_private.has_creation_membership_for_actor(p_actor) or makeborne_private.has_free_tier_access(p_actor)) then
  raise exception 'Creation access required' using errcode = '42501';
 end if;
 if p_fence is distinct from e.fence then raise exception 'Worker fence conflict' using errcode = 'PT409'; end if;
 select * into c from makeborne_private.live_provider_calls where id = p_call;
 if found then
  if (c.run_reference, c.user_id, c.provider, c.model, c.bound_microusd) is distinct from (e.reference, p_actor, p_provider, p_model, p_bound) then
   raise exception 'Provider call key conflict' using errcode = 'PT409';
  end if;
  return jsonb_build_object('started', false, 'replayed', true, 'status', c.status);
 end if;
 if e.status <> 'running' or e.lease_expires_at <= clock_timestamp() then raise exception 'Worker lease expired' using errcode = 'PT409'; end if;
 if not e.exempt and not coalesce((public.makeborne_credit_hold_status(p_actor, e.reference)->>'active')::boolean, false) then
  raise exception 'Credit hold expired' using errcode = 'PT409';
 end if;
 if p_bound is null or p_bound <= 0 then raise exception 'Invalid provider bound' using errcode = '22023'; end if;
 select coalesce(sum(coalesce(cc.charged_microusd, cc.bound_microusd)), 0) into used from makeborne_private.live_provider_calls cc where cc.run_reference = e.reference;
 if used + p_bound > e.provider_cap_microusd then return jsonb_build_object('error', jsonb_build_object('code', 'RUN_BUDGET')); end if;
 return makeborne_private.open_provider_call(p_call, p_actor, e.reference, p_provider, p_model, p_bound, 'live');
end $$;

-- Records the worker's outcome durably before any release is attempted, so a
-- failed or lost release never loses (or regenerates) the result. A Stop that
-- arrived first wins: the result is not kept as usable.
create function makeborne_private.brief_enhance_record(p_actor uuid, p_id uuid, p_fence uuid, p_outcome text, p_result jsonb, p_failure jsonb,
 p_measured bigint, p_provider_microusd bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; v_outcome text := p_outcome;
begin
 if p_outcome not in ('completed','failed','cancelled') or (p_outcome = 'completed' and (p_result is null or jsonb_typeof(p_result) <> 'object'))
    or (p_outcome = 'failed' and (p_failure is null or jsonb_typeof(p_failure) <> 'object'))
    or p_measured is null or p_measured < 0 or p_provider_microusd is null or p_provider_microusd < 0 then
  raise exception 'Invalid brief enhancement outcome' using errcode = '22023';
 end if;
 select * into e from makeborne_private.brief_enhancements where id = p_id and actor = p_actor for update;
 if not found then raise exception 'Brief enhancement not found' using errcode = 'P0002'; end if;
 if p_fence is distinct from e.fence then raise exception 'Worker fence conflict' using errcode = 'PT409'; end if;
 if e.status <> 'running' then
  -- An exact repeat after a lost response is a replay; anything else conflicts.
  if e.outcome = p_outcome or (e.outcome = 'cancelled' and e.cancel_requested_at is not null and p_outcome = 'completed') then
   return jsonb_build_object('replayed', true, 'action', makeborne_private.brief_enhancement_snapshot(e.id));
  end if;
  raise exception 'Brief enhancement already resolved' using errcode = 'PT409';
 end if;
 if e.cancel_requested_at is not null and v_outcome = 'completed' then v_outcome := 'cancelled'; end if;
 update makeborne_private.brief_enhancements set status = 'releasing', outcome = v_outcome,
  result = case when v_outcome = 'completed' then p_result else null end,
  failure = case when v_outcome = 'failed' then p_failure else null end,
  measured_credits = p_measured, provider_microusd = p_provider_microusd, updated_at = clock_timestamp()
 where id = e.id;
 return jsonb_build_object('replayed', false, 'action', makeborne_private.brief_enhancement_snapshot(e.id));
end $$;

-- Returns the hold of a recorded action exactly once (idempotent; also the
-- recovery for a release that failed or whose response was lost).
create function makeborne_private.brief_enhance_release(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e makeborne_private.brief_enhancements; hold jsonb;
begin
 perform makeborne_private.ai_operation_permission(p_actor, p_workspace, p_artifact);
 e := makeborne_private.brief_enhancement_lock(p_actor, p_workspace, p_artifact, p_action);
 perform makeborne_private.brief_enhancement_expire(e.id);
 select * into e from makeborne_private.brief_enhancements where id = e.id;
 if e.status <> 'releasing' then
  return jsonb_build_object('replayed', true, 'action', makeborne_private.brief_enhancement_snapshot(e.id));
 end if;
 hold := makeborne_private.brief_enhancement_return_hold(e.id,
  case e.outcome when 'completed' then case e.mode when 'analyze' then 'brief_analysis' else 'brief_enhance' end
   when 'cancelled' then 'brief_enhance_cancelled' else 'brief_enhance_unusable' end);
 update makeborne_private.brief_enhancements set
  status = case when (hold->>'anomaly')::boolean then 'needs_review' else e.outcome end,
  billing = hold->>'billing', charged_credits = (hold->>'charged')::bigint, updated_at = clock_timestamp(), resolved_at = clock_timestamp()
 where id = e.id;
 return jsonb_build_object('replayed', false, 'action', makeborne_private.brief_enhancement_snapshot(e.id));
end $$;

-- Deleting the artifact, workspace or account never strands a held credit.
create function makeborne_private.brief_enhancement_delete_release() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.status in ('running','releasing') and old.billing = 'held' and exists (select 1 from auth.users where id = old.actor) then
  perform public.makeborne_credit_release_run(old.actor, old.reference, 0, false, 'brief_enhance_deleted', '{}');
 end if;
 return old;
end $$;
create trigger brief_enhancement_delete_release before delete on makeborne_private.brief_enhancements
 for each row execute function makeborne_private.brief_enhancement_delete_release();

create function public.makeborne_brief_enhance_claim(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid, p_input_hash text, p_mode text, p_hold_credits bigint, p_provider_cap_microusd bigint) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_claim(p_actor, p_workspace, p_artifact, p_action, p_input_hash, p_mode, p_hold_credits, p_provider_cap_microusd); $$;
create function public.makeborne_brief_enhance_read(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_read(p_actor, p_workspace, p_artifact, p_action); $$;
create function public.makeborne_brief_enhance_cancel(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_cancel(p_actor, p_workspace, p_artifact, p_action); $$;
create function public.makeborne_brief_enhance_provider_begin(p_actor uuid, p_id uuid, p_fence uuid, p_call uuid, p_provider text, p_model text, p_bound bigint) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_provider_begin(p_actor, p_id, p_fence, p_call, p_provider, p_model, p_bound); $$;
create function public.makeborne_brief_enhance_record(p_actor uuid, p_id uuid, p_fence uuid, p_outcome text, p_result jsonb, p_failure jsonb, p_measured bigint, p_provider_microusd bigint) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_record(p_actor, p_id, p_fence, p_outcome, p_result, p_failure, p_measured, p_provider_microusd); $$;
create function public.makeborne_brief_enhance_release(p_actor uuid, p_workspace uuid, p_artifact uuid, p_action uuid) returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.brief_enhance_release(p_actor, p_workspace, p_artifact, p_action); $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'makeborne_private' and (p.proname like 'brief_enhance%')) or (n.nspname = 'public' and p.proname like 'makeborne_brief_enhance_%') loop
  execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  -- The service role reaches the six entry points (wrapper plus its definer core); helpers stay internal.
  if f.nspname = 'public' or f.proname in ('brief_enhance_claim','brief_enhance_read','brief_enhance_cancel','brief_enhance_provider_begin','brief_enhance_record','brief_enhance_release') then
   execute format('grant execute on function %s to service_role', f.sig);
  end if;
 end loop;
end $$;

commit;
