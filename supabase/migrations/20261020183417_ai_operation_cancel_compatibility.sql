-- Forward-only rollback compatibility. Legacy clients know completed, not
-- cancelled. The durable row remains cancelled and the provider gate remains
-- closed. New servers normalize the explicit marker to their Stopped state.
begin;
create or replace function makeborne_private.ai_operation_snapshot(p_operation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'revision',o.revision,'authorizedCredits',o.authorized_credits,
 'chargedCredits',o.charged_credits,'reservedCredits',o.reserved_credits,
 'remainingCredits',greatest(o.authorized_credits-o.charged_credits-o.reserved_credits,0),
 'cancelRequested',o.cancel_requested_at is not null,
 'status',case when o.cancel_requested_at is not null and o.reserved_credits=0 then 'completed' when o.status='expired' then 'expired' when o.reserved_credits>0 then 'running' else o.status end,
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
commit;
