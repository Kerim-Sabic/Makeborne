begin;
-- Preserve progress access/finance projection. Native results need visual review,
-- without a website compilation operation. This never accepts or settles work.
create or replace function makeborne_private.submission_progress(p_job uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; build makeborne_private.project_builds%rowtype;
 outcome makeborne_private.generation_provider_outcomes%rowtype; reservation makeborne_private.generation_reservations%rowtype;
 settlement makeborne_private.generation_job_settlements%rowtype; state text; can_edit boolean;
begin
 select * into job from public.generation_jobs where id=p_job;
 perform 1 from public.workspaces where id=job.workspace_id for share;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 if job.id is null or job.reservation_id is null or not exists(select 1 from public.workspaces where id=job.workspace_id and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=job.workspace_id and user_id=p_actor and role in ('editor','reviewer') for share) then
   raise exception 'Job unavailable' using errcode='P0002'; end if;
 select * into job from public.generation_jobs where id=p_job for share;
 select * into build from makeborne_private.project_builds where job_id=job.id;
 select * into outcome from makeborne_private.generation_provider_outcomes where job_id=job.id;
 select * into reservation from makeborne_private.generation_reservations where id=job.reservation_id;
 select * into settlement from makeborne_private.generation_job_settlements where job_id=job.id;
 can_edit:=exists(select 1 from public.workspaces where id=job.workspace_id and owner_id=p_actor)
   or exists(select 1 from public.workspace_members where workspace_id=job.workspace_id and user_id=p_actor and role='editor');
 state:=case when job.status='succeeded' then 'ready' when job.status='cancelled' then 'cancelled'
   when job.status='failed' then 'failed' when job.cancel_requested_at is not null then 'cancelling'
   when build.status in ('failed','cancelled') or outcome.succeeded=false or job.status='awaiting_reconciliation' then 'needs_attention'
   when build.status='compiled' then 'awaiting_review' when build.status in ('queued','running') then 'building'
   when outcome.succeeded and outcome.result_version_id is not null
     and exists(select 1 from public.artifacts a where a.id=job.artifact_id and a.workspace_id=job.workspace_id and a.kind='presentation') then 'awaiting_review'
   when job.status='queued' then 'queued' else 'working' end;
 return jsonb_build_object('id',job.id,'scope',jsonb_build_object('workspaceId',job.workspace_id,'projectId',job.project_id,'artifactId',job.artifact_id),
   'state',state,'revision',job.run_revision::text||':'||coalesce(build.fence::text,'0')||':'||coalesce(build.status,'none'),
   'outputVersionId',outcome.result_version_id,'credits',case when can_edit then jsonb_build_object('maximum',reservation.credit_amount::text,
     'reserved',case when reservation.status in ('reserved','uncertain') then reservation.credit_amount::text else '0' end,
     'charged',coalesce(settlement.customer_credits,0)::text) else null end,
   'createdAt',job.created_at,'updatedAt',greatest(job.updated_at,coalesce(build.updated_at,job.updated_at)),
   'canCancel',job.status in ('queued','running') and job.cancel_requested_at is null and can_edit);
end $$;
commit;
