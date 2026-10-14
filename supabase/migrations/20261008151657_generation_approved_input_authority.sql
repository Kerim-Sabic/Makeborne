begin;

-- Keep one reservation/job authority. Legacy reservations deliberately have no
-- authorisation and cannot use the runtime dispatch entrypoint until replaced.
alter table makeborne_private.generation_reservations add column authorization_snapshot jsonb;
alter table makeborne_private.generation_reservations add constraint generation_authorization_object
 check(authorization_snapshot is null or (jsonb_typeof(authorization_snapshot)='object' and octet_length(authorization_snapshot::text)<=262144));
create function makeborne_private.protect_generation_authorization() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.authorization_snapshot is not null and new.authorization_snapshot is distinct from old.authorization_snapshot then
   raise exception 'Generation authorization is immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function makeborne_private.protect_generation_authorization() from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;
create trigger generation_authorization_immutable before update on makeborne_private.generation_reservations
 for each row execute function makeborne_private.protect_generation_authorization();

-- Reuse one creation-access predicate for browser and trusted actor checks.
create function makeborne_private.has_creation_membership_for_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor is not null and (makeborne_private.has_account_privilege(p_actor,'admin')
 or (coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
   and exists(select 1 from public.billing_memberships m
     join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
     where m.user_id=p_actor and m.status in ('active','canceling')
       and m.period_end>now() and m.verified_until>now())));
$$;
revoke all on function makeborne_private.has_creation_membership_for_actor(uuid) from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;
create or replace function makeborne_private.has_creation_membership() returns boolean
language sql stable security definer set search_path='' as $$
 select makeborne_private.has_creation_membership_for_actor((select auth.uid()));
$$;

-- Internal check, always called under the existing workspace/budget/job locks.
-- Source fingerprints use Postgres JSON identity only, never pretend to be the
-- JavaScript approval digest. The worker separately verifies that original digest.
create function makeborne_private.check_generation_authority(p_job public.generation_jobs) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r makeborne_private.generation_reservations%rowtype; q makeborne_private.generation_proposals%rowtype;
 binding jsonb; approved_source jsonb; source_row public.sources%rowtype; sources jsonb:='[]'::jsonb;
 latest uuid; artifact_kind text; owner_uuid uuid; member_role text; input_bytes bigint;
begin
 select * into r from makeborne_private.generation_reservations where id=p_job.reservation_id;
 binding:=r.authorization_snapshot;
 if binding is null or binding->>'version' is distinct from 'generation-authorization-v1'
   or binding->'processingConsent' is distinct from 'true'::jsonb
   or binding->'sourceRightsConfirmed' is distinct from 'true'::jsonb
   or (binding->>'expiresAt')::timestamptz<=clock_timestamp() then
   raise exception 'Current generation authorization required' using errcode='42501';
 end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=(binding->>'sessionId')::uuid and s.user_id=r.approved_by
     and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=clock_timestamp()) and not coalesce(u.is_anonymous,false)
   for share of s,u;
 if not found or not makeborne_private.has_creation_membership_for_actor(r.approved_by) then
   raise exception 'Current authenticated creation access required' using errcode='42501';
 end if;
 select owner_id into owner_uuid from public.workspaces where id=p_job.workspace_id;
 if owner_uuid is distinct from r.approved_by then
   select role into member_role from public.workspace_members where workspace_id=p_job.workspace_id and user_id=r.approved_by for share;
   if member_role is distinct from 'editor' then raise exception 'Current editor access required' using errcode='42501'; end if;
 end if;
 select * into q from makeborne_private.generation_proposals where id=r.proposal_id for share;
 if q.workspace_id is distinct from p_job.workspace_id or q.project_id is distinct from p_job.project_id
   or q.artifact_id is distinct from p_job.artifact_id or q.expires_at<=clock_timestamp()
   or encode(extensions.digest(convert_to(q.snapshot::text,'UTF8'),'sha256'),'hex') is distinct from binding->>'proposalFingerprint' then
   raise exception 'Approved proposal changed' using errcode='PT409';
 end if;
 if q.artifact_id is null then raise exception 'Saved artifact scope required' using errcode='PT409'; end if;
 select kind into artifact_kind from public.artifacts where id=q.artifact_id and workspace_id=q.workspace_id and project_id=q.project_id for share;
 select id into latest from public.artifact_versions where artifact_id=q.artifact_id and workspace_id=q.workspace_id order by version_number desc limit 1;
 if artifact_kind is distinct from q.snapshot#>>'{workflow,output}' or latest is distinct from q.base_version_id then
   raise exception 'Approved project revision changed' using errcode='PT409';
 end if;
 if exists(select 1 from jsonb_array_elements(q.snapshot#>'{workflow,stages}') s
   where s#>>'{route,dataBoundary}' is distinct from 'workspace_private')
   and binding->'externalProcessingConsent' is distinct from 'true'::jsonb then
   raise exception 'External processing consent required' using errcode='42501';
 end if;
 input_bytes:=octet_length(q.snapshot::text);
 for approved_source in select jsonb_array_elements(binding->'sources') loop
   select * into source_row from public.sources where id=(approved_source->>'id')::uuid
     and workspace_id=p_job.workspace_id and project_id=p_job.project_id and approved for share;
   if not found then raise exception 'Approved source changed or unavailable' using errcode='PT409'; end if;
   input_bytes:=input_bytes+octet_length(source_row.content)+octet_length(source_row.title)+512;
   if input_bytes>6291456 then raise exception 'Approved material needs bounded ingestion' using errcode='22023'; end if;
   if encode(extensions.digest(convert_to((to_jsonb(source_row)-'created_at')::text,'UTF8'),'sha256'),'hex') is distinct from approved_source->>'fingerprint' then
     raise exception 'Approved source changed or unavailable' using errcode='PT409';
   end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('id',source_row.id,'title',source_row.title,'text',source_row.content));
   if octet_length(sources::text)>6291456 then raise exception 'Approved material needs bounded ingestion' using errcode='22023'; end if;
 end loop;
 return jsonb_build_object('proposal',q.snapshot,'sourceMaterial',sources,'actorId',r.approved_by,
   'authorizationExpiresAt',binding->>'expiresAt');
end $$;
revoke all on function makeborne_private.check_generation_authority(public.generation_jobs) from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;

-- The trusted HTTP layer supplies only a server-verified session/token expiry.
-- Reservation, source consent and enqueue commit together; no client proposal
-- or client source text is accepted here. Replay cannot renew the authorisation.
create function makeborne_private.authorize_and_enqueue_generation_job(
 p_proposal uuid,p_request_key uuid,p_actor uuid,p_approval_hash text,p_input_hash text,p_deadline timestamptz,
 p_session uuid,p_token_expires_at timestamptz,p_processing_consent boolean,p_external_consent boolean,p_source_rights_confirmed boolean
) returns public.generation_jobs language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; r makeborne_private.generation_reservations%rowtype;
 q makeborne_private.generation_proposals%rowtype; source_id text; source_row public.sources%rowtype;
 fingerprints jsonb:='[]'::jsonb; expiry timestamptz; binding jsonb; input_bytes bigint;
begin
 if p_session is null or p_token_expires_at is null or p_token_expires_at<=clock_timestamp()
   or p_token_expires_at>clock_timestamp()+interval '1 hour' or p_processing_consent is distinct from true
   or p_external_consent is null or p_source_rights_confirmed is distinct from true then
   raise exception 'Verified session and explicit processing consent required' using errcode='42501';
 end if;
 job:=makeborne_private.reserve_and_enqueue_generation_job(p_proposal,p_request_key,p_actor,p_approval_hash,p_input_hash,p_deadline);
 select * into r from makeborne_private.generation_reservations where id=job.reservation_id;
 select * into q from makeborne_private.generation_proposals where id=r.proposal_id;
 expiry:=least(p_token_expires_at,job.deadline_at,q.expires_at);
 if r.authorization_snapshot is not null then
   if r.authorization_snapshot->>'sessionId' is distinct from p_session::text
     or r.authorization_snapshot->'externalProcessingConsent' is distinct from to_jsonb(p_external_consent)
     or (r.authorization_snapshot->>'expiresAt')::timestamptz is distinct from expiry then
     raise exception 'Authorization replay changed' using errcode='PT409';
   end if;
   perform makeborne_private.check_generation_authority(job);
   return job;
 end if;
 if r.status<>'reserved' or r.dispatch_started_at is not null or job.status<>'queued' or job.lease_owner is not null then
   raise exception 'Only unused queued work can receive authorization' using errcode='PT409';
 end if;
 if jsonb_typeof(q.snapshot#>'{input,sourceIds}') is distinct from 'array'
   or jsonb_array_length(q.snapshot#>'{input,sourceIds}')>1000
   or (select count(*) from jsonb_array_elements_text(q.snapshot#>'{input,sourceIds}'))
      <>(select count(distinct value) from jsonb_array_elements_text(q.snapshot#>'{input,sourceIds}')) then
   raise exception 'Exact approved source identities required' using errcode='22023';
 end if;
 input_bytes:=octet_length(q.snapshot::text);
 for source_id in select jsonb_array_elements_text(q.snapshot#>'{input,sourceIds}') loop
   select * into source_row from public.sources where id=source_id::uuid and workspace_id=job.workspace_id and project_id=job.project_id and approved for share;
   if not found then raise exception 'Approved project source required' using errcode='42501'; end if;
   input_bytes:=input_bytes+octet_length(source_row.content)+octet_length(source_row.title)+512;
   if input_bytes>6291456 then raise exception 'Approved material needs bounded ingestion' using errcode='22023'; end if;
   fingerprints:=fingerprints||jsonb_build_array(jsonb_build_object('id',source_row.id,
     'fingerprint',encode(extensions.digest(convert_to((to_jsonb(source_row)-'created_at')::text,'UTF8'),'sha256'),'hex')));
 end loop;
 binding:=jsonb_build_object('version','generation-authorization-v1','sessionId',p_session,'expiresAt',expiry,
   'processingConsent',true,'externalProcessingConsent',p_external_consent,'sourceRightsConfirmed',true,'authorizedAt',clock_timestamp(),
   'proposalFingerprint',encode(extensions.digest(convert_to(q.snapshot::text,'UTF8'),'sha256'),'hex'),'sources',fingerprints);
 update makeborne_private.generation_reservations set authorization_snapshot=binding where id=r.id;
 perform makeborne_private.check_generation_authority(job);
 return job;
end $$;
revoke all on function makeborne_private.authorize_and_enqueue_generation_job(uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz,boolean,boolean,boolean) from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher;
grant execute on function makeborne_private.authorize_and_enqueue_generation_job(uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz,boolean,boolean,boolean) to service_role;

create function makeborne_private.load_generation_worker_input(p_job uuid,p_worker uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if p_worker is null or p_fence is null or job.lease_owner is null or job.lease_expires_at is null
   or job.status not in ('queued','running') or job.cancel_requested_at is not null or job.deadline_at<=clock_timestamp()
   or job.lease_owner is distinct from p_worker or job.fence is distinct from p_fence or job.lease_expires_at<=clock_timestamp() then
   raise exception 'Live job lease required' using errcode='PT409';
 end if;
 return makeborne_private.check_generation_authority(job);
end $$;
revoke all on function makeborne_private.load_generation_worker_input(uuid,uuid,bigint) from public,anon,authenticated,service_role,makeborne_generation_publisher;
grant execute on function makeborne_private.load_generation_worker_input(uuid,uuid,bigint) to makeborne_generation_worker;

-- Preserve the cap implementation as owner-only, with no runtime bypass. Both
-- service and restricted worker dispatch now check current authority in the
-- same transaction before taking the existing cap/dispatch path.
alter function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) rename to claim_capped_generation_dispatch_unchecked;
revoke all on function makeborne_private.claim_capped_generation_dispatch_unchecked(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;
create function makeborne_private.claim_capped_generation_dispatch(p_job uuid,p_worker uuid,p_fence bigint,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 if p_worker is null or p_fence is null or job.lease_owner is null or job.lease_expires_at is null
   or job.lease_owner is distinct from p_worker or job.fence is distinct from p_fence or job.lease_expires_at<=clock_timestamp()
   or job.status not in ('queued','running') or job.cancel_requested_at is not null or job.deadline_at<=clock_timestamp() then
   raise exception 'Live job lease required' using errcode='PT409';
 end if;
 perform makeborne_private.check_generation_authority(job);
 return makeborne_private.claim_capped_generation_dispatch_unchecked(p_job,p_worker,p_fence,p_request);
end $$;
revoke all on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) from public,anon,authenticated,makeborne_generation_publisher;
grant execute on function makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid) to service_role,makeborne_generation_worker;
commit;
