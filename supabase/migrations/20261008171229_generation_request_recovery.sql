begin;
-- Recovery reads the existing job. It never renews approval, entitlement,
-- deadline or credit limits and is available after creation access expires.
create function makeborne_private.recover_generation_request(p_proposal uuid,p_request_key uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare workspace uuid; job uuid;
begin
 select workspace_id into workspace from makeborne_private.generation_proposals where id=p_proposal;
 perform 1 from public.workspaces where id=workspace for share;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 if workspace is null or p_request_key is null or not exists(select 1 from public.workspaces where id=workspace and owner_id=p_actor)
   and not exists(select 1 from public.workspace_members where workspace_id=workspace and user_id=p_actor and role='editor' for share) then
   raise exception 'Original request unavailable' using errcode='P0002'; end if;
 select j.id into job from makeborne_private.generation_reservations r join public.generation_jobs j on j.reservation_id=r.id
   where r.proposal_id=p_proposal and r.workspace_id=workspace and r.request_key=p_request_key and r.approved_by=p_actor;
 if job is null then return null; end if;
 return makeborne_private.submission_progress(job,p_actor,p_session,p_expires);
end $$;
create function public.makeborne_recover_generation_request(p_proposal uuid,p_request_key uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.recover_generation_request(p_proposal,p_request_key,p_actor,p_session,p_expires);
$$;
revoke all on function makeborne_private.recover_generation_request(uuid,uuid,uuid,uuid,timestamptz),
 public.makeborne_recover_generation_request(uuid,uuid,uuid,uuid,timestamptz)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.recover_generation_request(uuid,uuid,uuid,uuid,timestamptz),
 public.makeborne_recover_generation_request(uuid,uuid,uuid,uuid,timestamptz) to service_role;
commit;
