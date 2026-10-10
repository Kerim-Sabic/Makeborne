begin;
create table makeborne_private.preview_sessions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id uuid not null references auth.sessions(id) on delete cascade,
 job_id uuid not null,
 artifact_id uuid not null,
 version_id uuid not null,
 build_hash text not null check(build_hash ~ '^[a-f0-9]{64}$'),
 handoff_hash text not null unique check(handoff_hash ~ '^[a-f0-9]{64}$'),
 cookie_hash text unique check(cookie_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null,
 handoff_until timestamptz not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 foreign key(job_id,workspace_id) references public.generation_jobs(id,workspace_id),
 foreign key(version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id),
 check(handoff_until>created_at and handoff_until<=created_at+interval '60 seconds'),
 check(expires_at>=handoff_until and expires_at<=created_at+interval '20 minutes'),
 check((cookie_hash is null)=(consumed_at is null)),
 check(consumed_at is null or consumed_at between created_at and handoff_until)
);
alter table makeborne_private.preview_sessions enable row level security;
revoke all on makeborne_private.preview_sessions from public,anon,authenticated,service_role,
 makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
create index preview_sessions_workspace_expiry on makeborne_private.preview_sessions(workspace_id,expires_at);

create function makeborne_private.issue_preview_session(p_job uuid,p_handoff_hash text,
 p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare build makeborne_private.project_builds%rowtype; authorized jsonb; stamp timestamptz;
 expires timestamptz; handoff timestamptz; workspace uuid;
begin
 select workspace_id into workspace from public.generation_jobs where id=p_job;
 perform 1 from public.workspaces where id=workspace for update;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 select * into build from makeborne_private.project_builds where job_id=p_job and workspace_id=workspace and status='compiled';
 if build.job_id is null then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 authorized:=makeborne_private.read_project_preview(p_job,build.version_id,build.receipt->>'buildHash',p_actor,p_session,p_expires);
 if p_handoff_hash is null or p_handoff_hash !~ '^[a-f0-9]{64}$' then raise exception 'Opaque preview handoff required' using errcode='22023'; end if;
 stamp:=clock_timestamp(); expires:=least(p_expires,stamp+interval '20 minutes'); handoff:=least(expires,stamp+interval '60 seconds');
 if handoff<=stamp then raise exception 'Current session required' using errcode='42501'; end if;
 delete from makeborne_private.preview_sessions where workspace_id=workspace
   and (expires_at<=stamp or consumed_at is null and handoff_until<=stamp);
 if (select count(*) from makeborne_private.preview_sessions where workspace_id=workspace and actor_id=p_actor)>=20
   or (select count(*) from makeborne_private.preview_sessions where workspace_id=workspace)>=100 then
   raise exception 'Too many active previews' using errcode='MB429'; end if;
 insert into makeborne_private.preview_sessions(workspace_id,actor_id,auth_session_id,job_id,artifact_id,version_id,build_hash,
   handoff_hash,created_at,handoff_until,expires_at)
 values(workspace,p_actor,p_session,p_job,build.artifact_id,build.version_id,build.receipt->>'buildHash',p_handoff_hash,stamp,handoff,expires);
 return jsonb_build_object('identity',jsonb_build_object('jobId',p_job,'versionId',build.version_id,'buildHash',build.receipt->>'buildHash'),
   'scope',authorized->'scope','handoffUntil',handoff,'expiresAt',expires);
end $$;

create function makeborne_private.consume_preview_handoff(p_handoff_hash text,p_cookie_hash text,p_build_hash text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare grant_row makeborne_private.preview_sessions%rowtype; workspace uuid; stamp timestamptz;
begin
 select * into grant_row from makeborne_private.preview_sessions where handoff_hash=p_handoff_hash;
 if grant_row.id is null or grant_row.handoff_until<=clock_timestamp() or grant_row.expires_at<=clock_timestamp() then
   raise exception 'Preview unavailable' using errcode='P0002'; end if;
 workspace:=grant_row.workspace_id;
 perform 1 from public.workspaces where id=workspace for share;
 -- Auth rows precede grant locks: session deletion cascades into this table.
 perform makeborne_private.check_submission_session(grant_row.actor_id,grant_row.auth_session_id,grant_row.expires_at);
 select * into grant_row from makeborne_private.preview_sessions where handoff_hash=p_handoff_hash for update;
 stamp:=clock_timestamp();
 if grant_row.id is null or grant_row.consumed_at is not null or grant_row.handoff_until<=stamp or grant_row.expires_at<=stamp
   or grant_row.build_hash is distinct from p_build_hash then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 if p_cookie_hash is null or p_cookie_hash !~ '^[a-f0-9]{64}$' then raise exception 'Opaque preview cookie required' using errcode='22023'; end if;
 perform makeborne_private.read_project_preview(grant_row.job_id,grant_row.version_id,grant_row.build_hash,
   grant_row.actor_id,grant_row.auth_session_id,grant_row.expires_at);
 stamp:=clock_timestamp();
 if grant_row.handoff_until<=stamp or grant_row.expires_at<=stamp then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 update makeborne_private.preview_sessions set cookie_hash=p_cookie_hash,consumed_at=stamp where id=grant_row.id;
 return jsonb_build_object('identity',jsonb_build_object('jobId',grant_row.job_id,'versionId',grant_row.version_id,'buildHash',grant_row.build_hash),
   'expiresAt',grant_row.expires_at);
end $$;

create function makeborne_private.read_preview_session(p_cookie_hash text,p_build_hash text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare grant_row makeborne_private.preview_sessions%rowtype; workspace uuid; authorized jsonb;
begin
 select * into grant_row from makeborne_private.preview_sessions where cookie_hash=p_cookie_hash;
 if grant_row.id is null or grant_row.expires_at<=clock_timestamp() then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 workspace:=grant_row.workspace_id;
 perform 1 from public.workspaces where id=workspace for share;
 perform makeborne_private.check_submission_session(grant_row.actor_id,grant_row.auth_session_id,grant_row.expires_at);
 select * into grant_row from makeborne_private.preview_sessions where cookie_hash=p_cookie_hash for share;
 if grant_row.id is null or grant_row.consumed_at is null or grant_row.expires_at<=clock_timestamp()
   or grant_row.build_hash is distinct from p_build_hash then raise exception 'Preview unavailable' using errcode='P0002'; end if;
 authorized:=makeborne_private.read_project_preview(grant_row.job_id,grant_row.version_id,grant_row.build_hash,
   grant_row.actor_id,grant_row.auth_session_id,grant_row.expires_at);
 return jsonb_build_object('identity',jsonb_build_object('jobId',grant_row.job_id,'versionId',grant_row.version_id,'buildHash',grant_row.build_hash),
   'viewer',jsonb_build_object('p_actor',grant_row.actor_id,'p_session',grant_row.auth_session_id,'p_expires',grant_row.expires_at),
   'authorized',authorized);
end $$;

revoke all on function makeborne_private.issue_preview_session(uuid,text,uuid,uuid,timestamptz),
 makeborne_private.consume_preview_handoff(text,text,text),makeborne_private.read_preview_session(text,text)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function makeborne_private.issue_preview_session(uuid,text,uuid,uuid,timestamptz),
 makeborne_private.consume_preview_handoff(text,text,text),makeborne_private.read_preview_session(text,text) to service_role;

create function public.makeborne_issue_preview_session(p_job uuid,p_handoff_hash text,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.issue_preview_session(p_job,p_handoff_hash,p_actor,p_session,p_expires);
$$;
create function public.makeborne_consume_preview_handoff(p_handoff_hash text,p_cookie_hash text,p_build_hash text) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.consume_preview_handoff(p_handoff_hash,p_cookie_hash,p_build_hash);
$$;
create function public.makeborne_read_preview_session(p_cookie_hash text,p_build_hash text) returns jsonb
language sql security invoker set search_path='' as $$
 select makeborne_private.read_preview_session(p_cookie_hash,p_build_hash);
$$;
revoke all on function public.makeborne_issue_preview_session(uuid,text,uuid,uuid,timestamptz),
 public.makeborne_consume_preview_handoff(text,text,text),public.makeborne_read_preview_session(text,text)
 from public,anon,authenticated,makeborne_generation_worker,makeborne_generation_publisher,makeborne_project_builder;
grant execute on function public.makeborne_issue_preview_session(uuid,text,uuid,uuid,timestamptz),
 public.makeborne_consume_preview_handoff(text,text,text),public.makeborne_read_preview_session(text,text) to service_role;
commit;
