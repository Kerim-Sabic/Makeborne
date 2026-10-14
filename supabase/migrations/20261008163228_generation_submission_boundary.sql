begin;

-- Private authorities only. Public PostgREST bridges below are invoker functions
-- granted exclusively to service_role; browsers cannot supply trusted identities.
create function makeborne_private.check_submission_session(p_actor uuid,p_session uuid,p_expires timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or p_session is null or p_expires is null or p_expires<=clock_timestamp()
   or p_expires>clock_timestamp()+interval '1 hour' then raise exception 'Verified bounded session required' using errcode='42501'; end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=p_session and s.user_id=p_actor and (s.not_after is null or s.not_after>clock_timestamp())
     and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
     and not coalesce(u.is_anonymous,false) and u.email_confirmed_at is not null for share of s,u;
 if not found then raise exception 'Current confirmed session required' using errcode='42501'; end if;
end $$;
revoke all on function makeborne_private.check_submission_session(uuid,uuid,timestamptz)
 from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;

create function makeborne_private.read_submission_proposal(p_proposal uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare proposal makeborne_private.generation_proposals%rowtype; workspace uuid;
begin
 select workspace_id into workspace from makeborne_private.generation_proposals where id=p_proposal;
 perform 1 from public.workspaces where id=workspace for share;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 if not exists(select 1 from public.workspaces where id=workspace and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=workspace and user_id=p_actor and role='editor' for share) then
   raise exception 'Proposal unavailable' using errcode='P0002'; end if;
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation access required' using errcode='42501'; end if;
 select * into proposal from makeborne_private.generation_proposals where id=p_proposal for share;
 if not found then raise exception 'Proposal unavailable' using errcode='P0002'; end if;
 return jsonb_build_object('snapshot',proposal.snapshot,'expiresAt',proposal.expires_at);
end $$;
revoke all on function makeborne_private.read_submission_proposal(uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.read_submission_proposal(uuid,uuid,uuid,timestamptz) to service_role;

create function makeborne_private.submission_progress(p_job uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
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
   when job.status='queued' then 'queued' else 'working' end;
 return jsonb_build_object('id',job.id,'scope',jsonb_build_object('workspaceId',job.workspace_id,'projectId',job.project_id,'artifactId',job.artifact_id),
   'state',state,'revision',job.run_revision::text||':'||coalesce(build.fence::text,'0')||':'||coalesce(build.status,'none'),
   'outputVersionId',outcome.result_version_id,'credits',case when can_edit then jsonb_build_object('maximum',reservation.credit_amount::text,
     'reserved',case when reservation.status in ('reserved','uncertain') then reservation.credit_amount::text else '0' end,
     'charged',coalesce(settlement.customer_credits,0)::text) else null end,
   'createdAt',job.created_at,'updatedAt',greatest(job.updated_at,coalesce(build.updated_at,job.updated_at)),
   'canCancel',job.status in ('queued','running') and job.cancel_requested_at is null and can_edit);
end $$;
revoke all on function makeborne_private.submission_progress(uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.submission_progress(uuid,uuid,uuid,timestamptz) to service_role;

create function makeborne_private.cancel_submission(p_job uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 job:=makeborne_private.cancel_generation_job(p_job,p_actor,'Cancelled by the authenticated editor');
 -- Confirmed cost remains recorded; rejecting cancelled output releases the
 -- customer hold through the original settlement authority. Unknown calls must
 -- retain all holds for reconciliation and cannot be invented as zero cost.
 if job.status in ('running','awaiting_reconciliation') and job.cancel_requested_at is not null
   and exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id)
   and not exists(select 1 from makeborne_private.generation_job_settlements where job_id=job.id) then
   job:=makeborne_private.settle_generation_job(job.id,p_actor,job.run_revision,false,
     encode(extensions.digest(convert_to('cancelled:'||job.id::text,'UTF8'),'sha256'),'hex'));
 end if;
 return makeborne_private.submission_progress(job.id,p_actor,p_session,p_expires);
end $$;
revoke all on function makeborne_private.cancel_submission(uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.cancel_submission(uuid,uuid,uuid,timestamptz) to service_role;

create function public.makeborne_submission_proposal(p_proposal uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.read_submission_proposal(p_proposal,p_actor,p_session,p_expires);
$$;
create function public.makeborne_generation_progress(p_job uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.submission_progress(p_job,p_actor,p_session,p_expires);
$$;
create function public.makeborne_cancel_generation(p_job uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.cancel_submission(p_job,p_actor,p_session,p_expires);
$$;
create function public.makeborne_submit_generation(p_proposal uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_input_hash text,
 p_deadline timestamptz,p_session uuid,p_expires timestamptz,p_processing_consent boolean,p_external_consent boolean,p_source_rights_confirmed boolean)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype;
begin
 perform makeborne_private.read_submission_proposal(p_proposal,p_actor,p_session,p_expires);
 job:=makeborne_private.authorize_and_enqueue_generation_job(p_proposal,p_request_key,p_actor,p_approval_hash,p_input_hash,p_deadline,
   p_session,p_expires,p_processing_consent,p_external_consent,p_source_rights_confirmed);
 return makeborne_private.submission_progress(job.id,p_actor,p_session,p_expires);
end $$;
revoke all on function public.makeborne_submission_proposal(uuid,uuid,uuid,timestamptz),public.makeborne_generation_progress(uuid,uuid,uuid,timestamptz),
 public.makeborne_cancel_generation(uuid,uuid,uuid,timestamptz),public.makeborne_submit_generation(uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz,boolean,boolean,boolean)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function public.makeborne_submission_proposal(uuid,uuid,uuid,timestamptz),public.makeborne_generation_progress(uuid,uuid,uuid,timestamptz),
 public.makeborne_cancel_generation(uuid,uuid,uuid,timestamptz),public.makeborne_submit_generation(uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz,boolean,boolean,boolean)
 to service_role;
commit;
