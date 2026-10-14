begin;

-- A separate operation on the existing job and immutable source version. This
-- table is also its durable work queue: no second queue/outbox authority needed.
create role makeborne_project_builder nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
grant makeborne_project_builder to postgres with set true;
grant makeborne_project_builder to postgres with inherit false;
grant usage on schema makeborne_private to makeborne_project_builder;
create table makeborne_private.project_builds (
 job_id uuid primary key,
 workspace_id uuid not null,
 artifact_id uuid not null,
 outcome_id uuid not null unique,
 version_id uuid not null unique,
 result_hash text not null check(result_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'queued' check(status in ('queued','running','compiled','failed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 fence bigint not null default 0 check(fence between 0 and 9007199254740991),
 lease_owner uuid,
 lease_expires_at timestamptz,
 receipt jsonb,
 completed_by uuid,
 failure_code text check(failure_code in ('authority_changed','job_closed','attempts_exhausted','compilation_failed')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id),
 foreign key(outcome_id,job_id,workspace_id) references makeborne_private.generation_provider_outcomes(id,job_id,workspace_id),
 foreign key(version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id),
 check((lease_owner is null)=(lease_expires_at is null)),
 check((status='running')=(lease_owner is not null)),
 check((status='compiled')=(receipt is not null)),
 check((status='compiled')=(completed_by is not null)),
 check((status in ('failed','cancelled'))=(failure_code is not null)),
 check(receipt is null or (jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=262144))
);
alter table makeborne_private.project_builds enable row level security;
revoke all on makeborne_private.project_builds from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant select on makeborne_private.project_builds to service_role;
create index project_builds_pending on makeborne_private.project_builds(created_at,job_id) where status in ('queued','running');
create index project_builds_workspace on makeborne_private.project_builds(workspace_id);

create function makeborne_private.protect_project_build() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Build evidence cannot be deleted' using errcode='23514'; end if;
 if old.status in ('compiled','failed','cancelled') or
   row(new.job_id,new.workspace_id,new.artifact_id,new.outcome_id,new.version_id,new.result_hash,new.created_at)
   is distinct from row(old.job_id,old.workspace_id,old.artifact_id,old.outcome_id,old.version_id,old.result_hash,old.created_at) then
   raise exception 'Build identity and terminal evidence are immutable' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function makeborne_private.protect_project_build() from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
create trigger project_build_immutable before update or delete on makeborne_private.project_builds
 for each row execute function makeborne_private.protect_project_build();

-- Runs inside the canonical result/outcome transaction. A crash after commit
-- leaves a queued build; a rollback leaves neither source nor build authority.
create function makeborne_private.enqueue_project_build() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.succeeded and exists(select 1 from public.artifact_versions v where v.id=new.result_version_id
   and v.workspace_id=new.workspace_id and v.artifact_id=new.artifact_id
   and v.content->>'kind'='website' and jsonb_typeof(v.content->'websiteSource')='object') then
   insert into makeborne_private.project_builds(job_id,workspace_id,artifact_id,outcome_id,version_id,result_hash)
   values(new.job_id,new.workspace_id,new.artifact_id,new.id,new.result_version_id,new.result_hash);
 end if;
 return new;
end $$;
revoke all on function makeborne_private.enqueue_project_build() from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
create trigger generation_outcome_build_handoff after insert on makeborne_private.generation_provider_outcomes
 for each row execute function makeborne_private.enqueue_project_build();

-- Recover only outstanding live results created before this migration. Never
-- manufacture a build receipt or re-open a settled historical generation.
insert into makeborne_private.project_builds(job_id,workspace_id,artifact_id,outcome_id,version_id,result_hash)
 select o.job_id,o.workspace_id,o.artifact_id,o.id,o.result_version_id,o.result_hash
 from makeborne_private.generation_provider_outcomes o join public.generation_jobs j on j.id=o.job_id
 join public.artifact_versions v on v.id=o.result_version_id
 where o.succeeded and j.status='running' and j.cancel_requested_at is null and j.deadline_at>clock_timestamp()
   and v.content->>'kind'='website' and jsonb_typeof(v.content->'websiteSource')='object'
   and not exists(select 1 from makeborne_private.generation_job_settlements s where s.job_id=j.id);

create function makeborne_private.next_project_build() returns uuid
language sql security definer set search_path='' as $$
 select job_id from makeborne_private.project_builds
 where status='queued' or (status='running' and lease_expires_at<=clock_timestamp())
 order by created_at,job_id limit 1;
$$;

create function makeborne_private.lease_project_build(p_job uuid,p_worker uuid,p_seconds integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; build makeborne_private.project_builds%rowtype;
begin
 if p_worker is null or p_seconds is null or p_seconds not between 1 and 120 then
   raise exception 'Bounded builder lease required' using errcode='22023'; end if;
 job:=makeborne_private.lock_generation_job(p_job);
 select * into build from makeborne_private.project_builds where job_id=job.id for update;
 if not found then raise exception 'Scoped build unavailable' using errcode='P0002'; end if;
 if build.status in ('compiled','failed','cancelled') then return jsonb_build_object('state','terminal','status',build.status); end if;
 if job.status<>'running' or job.cancel_requested_at is not null or job.deadline_at<=clock_timestamp() then
   update makeborne_private.project_builds set status='cancelled',failure_code='job_closed',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where job_id=job.id;
   return jsonb_build_object('state','terminal','status','cancelled');
 end if;
 begin
   perform makeborne_private.check_generation_authority(job);
 exception when insufficient_privilege or sqlstate 'PT409' then
   update makeborne_private.project_builds set status='cancelled',failure_code='authority_changed',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where job_id=job.id;
   return jsonb_build_object('state','terminal','status','cancelled');
 end;
 if build.status='running' and build.lease_expires_at>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
 if build.attempts>=3 then
   update makeborne_private.project_builds set status='failed',failure_code='attempts_exhausted',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where job_id=job.id;
   return jsonb_build_object('state','terminal','status','failed');
 end if;
 update makeborne_private.project_builds set status='running',attempts=attempts+1,fence=fence+1,lease_owner=p_worker,
   lease_expires_at=least(job.deadline_at,clock_timestamp()+make_interval(secs=>p_seconds)),updated_at=clock_timestamp()
   where job_id=job.id returning * into build;
 return jsonb_build_object('state','leased','jobId',job.id,'workspaceId',build.workspace_id,'versionId',build.version_id,
   'workerId',p_worker,'fence',build.fence::text,'deadlineAt',job.deadline_at);
end $$;

-- Shared live check acquires the original job locks first, then this build.
-- Current session, membership, proposal, source and revision are rechecked.
create function makeborne_private.load_project_build(p_job uuid,p_worker uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; build makeborne_private.project_builds%rowtype; version public.artifact_versions%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 select * into build from makeborne_private.project_builds where job_id=job.id for update;
 if not found or p_worker is null or p_fence is null or build.status<>'running'
   or build.lease_owner is distinct from p_worker or build.fence is distinct from p_fence
   or build.lease_expires_at<=clock_timestamp() or job.status<>'running'
   or job.cancel_requested_at is not null or job.deadline_at<=clock_timestamp() then
   raise exception 'Live builder authority required' using errcode='PT409';
 end if;
 perform makeborne_private.check_generation_authority(job);
 select * into version from public.artifact_versions where id=build.version_id
   and artifact_id=build.artifact_id and workspace_id=build.workspace_id for share;
 if not found or encode(extensions.digest(convert_to(jsonb_build_object('content',version.content,'style',version.style_snapshot,'assets',version.asset_manifest)::text,'UTF8'),'sha256'),'hex') is distinct from build.result_hash then
   raise exception 'Exact confirmed source required' using errcode='PT409';
 end if;
 return jsonb_build_object('version',to_jsonb(version),'resultFingerprint',build.result_hash);
end $$;

create function makeborne_private.renew_project_build(p_job uuid,p_worker uuid,p_fence bigint,p_seconds integer) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 if p_seconds is null or p_seconds not between 1 and 120 then raise exception 'Bounded renewal required' using errcode='22023'; end if;
 perform makeborne_private.load_project_build(p_job,p_worker,p_fence);
 update makeborne_private.project_builds b set lease_expires_at=least(j.deadline_at,clock_timestamp()+make_interval(secs=>p_seconds)),updated_at=clock_timestamp()
   from public.generation_jobs j where b.job_id=p_job and j.id=b.job_id;
 return true;
end $$;

-- Trusted builder attestation, not customer JSON. The executor independently
-- validates canonical source/toolchain/output byte hashes before invocation.
-- Compilation is not a published preview, persisted output or visual approval.
create function makeborne_private.complete_project_build(p_job uuid,p_worker uuid,p_fence bigint,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare job public.generation_jobs%rowtype; build makeborne_private.project_builds%rowtype; version public.artifact_versions%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 select * into build from makeborne_private.project_builds where job_id=job.id for update;
 if not found then raise exception 'Scoped build unavailable' using errcode='P0002'; end if;
 if build.status='compiled' then
   if build.completed_by is distinct from p_worker or build.fence is distinct from p_fence or build.receipt is distinct from p_receipt then
     raise exception 'Build replay changed evidence' using errcode='PT409'; end if;
   return jsonb_build_object('state','compiled','versionId',build.version_id,'replayed',true,'readyForPublication',false);
 end if;
 perform makeborne_private.load_project_build(p_job,p_worker,p_fence);
 select * into version from public.artifact_versions where id=build.version_id;
 if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' or octet_length(p_receipt::text)>262144
   or p_receipt->'schemaVersion' is distinct from '1'::jsonb
   or p_receipt->>'artifactId' is distinct from build.artifact_id::text or p_receipt->>'revisionId' is distinct from build.version_id::text
   or p_receipt->'version' is distinct from to_jsonb(version.version_number)
   or p_receipt->>'toolchainId' is distinct from 'react-vite-v1'
   or p_receipt->>'runtimeImageId' is null or p_receipt->>'runtimeImageId' !~ '^sha256:[a-f0-9]{64}$'
   or exists(select 1 from unnest(array['sourceHash','toolchainHash','buildHash']) k where p_receipt->>k is null or p_receipt->>k !~ '^[a-f0-9]{64}$')
   or p_receipt->'routes' is distinct from version.content#>'{websiteSource,routes}'
   or jsonb_typeof(p_receipt->'files') is distinct from 'array' then
   raise exception 'Exact bounded compilation receipt required' using errcode='22023';
 end if;
 if jsonb_array_length(p_receipt->'files') not between 1 and 1000 or exists(
   select 1 from jsonb_array_elements(p_receipt->'files') f where jsonb_typeof(f) is distinct from 'object'
   or f->>'path' is null or length(f->>'path') not between 1 and 240
   or f->>'sha256' is null or f->>'sha256' !~ '^[a-f0-9]{64}$'
   or f->>'bytes' is null or f->>'bytes' !~ '^[0-9]{1,8}$'
 ) then raise exception 'Bounded output manifest required' using errcode='22023'; end if;
 update makeborne_private.project_builds set status='compiled',receipt=p_receipt,completed_by=p_worker,
   lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where job_id=job.id;
 return jsonb_build_object('state','compiled','versionId',build.version_id,'replayed',false,'readyForPublication',false);
end $$;

create function makeborne_private.fail_project_build(p_job uuid,p_worker uuid,p_fence bigint) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 perform makeborne_private.load_project_build(p_job,p_worker,p_fence);
 update makeborne_private.project_builds set status='failed',failure_code='compilation_failed',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where job_id=p_job;
end $$;

-- Defence in depth on the original settlement transaction, not a parallel
-- credit ledger. Legacy copy drafts retain their existing review behaviour.
create function makeborne_private.require_compiled_website_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype;
begin
 if new.accepted and exists(select 1 from makeborne_private.generation_provider_outcomes o
   join public.artifact_versions v on v.id=o.result_version_id where o.id=new.outcome_id
     and v.content->>'kind'='website' and jsonb_typeof(v.content->'websiteSource')='object') then
   if not exists(select 1 from makeborne_private.project_builds b where b.job_id=new.job_id
     and b.workspace_id=new.workspace_id and b.outcome_id=new.outcome_id and b.status='compiled') then
     raise exception 'Confirmed compilation required before accepting website source' using errcode='PT409';
   end if;
   job:=makeborne_private.lock_generation_job(new.job_id);
   perform makeborne_private.check_generation_authority(job);
 end if;
 return new;
end $$;
revoke all on function makeborne_private.require_compiled_website_settlement() from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
create trigger generation_settlement_compilation_guard before insert on makeborne_private.generation_job_settlements
 for each row execute function makeborne_private.require_compiled_website_settlement();

revoke all on function makeborne_private.next_project_build(),makeborne_private.lease_project_build(uuid,uuid,integer),
 makeborne_private.load_project_build(uuid,uuid,bigint),makeborne_private.renew_project_build(uuid,uuid,bigint,integer),
 makeborne_private.complete_project_build(uuid,uuid,bigint,jsonb),makeborne_private.fail_project_build(uuid,uuid,bigint)
 from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;
grant execute on function makeborne_private.next_project_build(),makeborne_private.lease_project_build(uuid,uuid,integer),
 makeborne_private.load_project_build(uuid,uuid,bigint),makeborne_private.renew_project_build(uuid,uuid,bigint,integer),
 makeborne_private.complete_project_build(uuid,uuid,bigint,jsonb),makeborne_private.fail_project_build(uuid,uuid,bigint)
 to makeborne_project_builder;
-- Source readback now belongs exclusively to the live builder. Retire the
-- immediate-callback loader rather than retaining an unused runtime grant.
drop function makeborne_private.load_generation_worker_result(uuid,uuid,bigint,uuid);
commit;
