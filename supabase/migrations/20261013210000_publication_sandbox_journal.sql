-- Created with Supabase CLI migration new; ordered after frozen namespace v56.
-- Control-plane metadata only. No provider call or new login/credential.
begin;

create table makeborne_private.publication_sandboxes (
 name text primary key,
 preparation_id uuid not null,
 worker_id uuid not null,
 fence bigint not null check(fence>0),
 lease_until timestamptz not null,
 kind text not null check(kind in ('compiler','renderer')),
 image text not null,
 evidence_sha256 text not null,
 runtime_identity text not null,
 latest_expected_expiry timestamptz not null,
 session_id text,
 provider_expires_at timestamptz,
 state text not null check(state in ('creating','running','cleanup_unconfirmed','stopped')),
 cleanup_worker_id uuid,
 cleanup_fence bigint not null default 0 check(cleanup_fence>=0),
 cleanup_lease_until timestamptz,
 cleanup_attempts integer not null default 0 check(cleanup_attempts between 0 and 1000000),
 cleanup_finished boolean not null default false,
 next_cleanup_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 stopped_at timestamptz,
 check((session_id is null)=(provider_expires_at is null)),
 check((cleanup_worker_id is null)=(cleanup_lease_until is null)),
 check((state='stopped')=(stopped_at is not null))
);
-- Deliberately no preparation/account FK: deleting source must not erase an
-- unresolved remote-resource obligation. Only confirmed stopped rows age out.
alter table makeborne_private.publication_sandboxes enable row level security;
revoke all on makeborne_private.publication_sandboxes from public,anon,authenticated,service_role,makeborne_publication_worker;
create index publication_sandboxes_attempt on makeborne_private.publication_sandboxes(preparation_id,fence);
create index publication_sandboxes_cleanup on makeborne_private.publication_sandboxes(next_cleanup_at,name) where state<>'stopped';
create index publication_sandboxes_retention on makeborne_private.publication_sandboxes(stopped_at,name) where state='stopped';

create function makeborne_private.publication_sandbox_snapshot(s makeborne_private.publication_sandboxes) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('preparationId',s.preparation_id,'workerId',s.worker_id,'fence',s.fence::text,
 'leaseUntil',s.lease_until,'name',s.name,'kind',s.kind,'image',s.image,'evidenceSha256',s.evidence_sha256,
 'runtimeIdentity',s.runtime_identity,'latestExpectedExpiry',s.latest_expected_expiry,'state',s.state,
 'sessionId',s.session_id,'providerExpiresAt',s.provider_expires_at));
$$;
revoke all on function makeborne_private.publication_sandbox_snapshot(makeborne_private.publication_sandboxes) from public,anon,authenticated,service_role,makeborne_publication_worker;

create function makeborne_private.publication_worker_sandbox_event(p_record jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s makeborne_private.publication_sandboxes%rowtype; p makeborne_private.publication_preparations%rowtype;
 pid uuid; wid uuid; f bigint; deadline timestamptz; expected timestamptz; observed timestamptz;
 k text; next_state text; at_time timestamptz; field text;
begin
 perform makeborne_private.assert_publication_worker();
 if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>4096 then
  raise exception 'Sandbox event invalid' using errcode='22023'; end if;
 if not p_record ?& array['preparationId','workerId','fence','leaseUntil','name','kind','image','evidenceSha256','runtimeIdentity','latestExpectedExpiry','state']
  or (p_record-array['preparationId','workerId','fence','leaseUntil','name','kind','image','evidenceSha256','runtimeIdentity','latestExpectedExpiry','state','sessionId','providerExpiresAt'])<>'{}'::jsonb then
  raise exception 'Sandbox event fields invalid' using errcode='22023'; end if;
 for field in select jsonb_object_keys(p_record) loop
  if jsonb_typeof(p_record->field)<>'string' then raise exception 'Sandbox event field type invalid' using errcode='22023'; end if;
 end loop;
 k:=p_record->>'kind'; next_state:=p_record->>'state';
 if k not in ('compiler','renderer') or next_state not in ('creating','running','stopped','cleanup_unconfirmed')
  or p_record->>'name' !~ ('^mbpub-'||k||'-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
  or p_record->>'preparationId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_record->>'workerId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_record->>'fence' !~ '^[1-9][0-9]{0,18}$'
  or length(p_record->>'image')>512 or p_record->>'image' !~ '^(vcr\.vercel\.com/)?[a-z0-9][a-z0-9_/-]*@sha256:[a-f0-9]{64}$'
  or p_record->>'evidenceSha256' !~ '^[a-f0-9]{64}$'
  or length(p_record->>'runtimeIdentity')>180
  or (k='compiler' and p_record->>'runtimeIdentity' !~ '^sha256:[a-f0-9]{64}$')
  or (k='renderer' and p_record->>'runtimeIdentity' !~ '^chromium-[0-9.]+-controller-[a-f0-9]{64}$')
  or ((p_record ? 'sessionId')<>(p_record ? 'providerExpiresAt'))
  or (p_record ? 'sessionId' and length(p_record->>'sessionId') not between 1 and 128)
  or (next_state in ('creating') and p_record ? 'sessionId')
  or (next_state='running' and not p_record ? 'sessionId') then
  raise exception 'Sandbox event identity invalid' using errcode='22023'; end if;
 begin
  pid:=(p_record->>'preparationId')::uuid; wid:=(p_record->>'workerId')::uuid; f:=(p_record->>'fence')::bigint;
  deadline:=(p_record->>'leaseUntil')::timestamptz; expected:=(p_record->>'latestExpectedExpiry')::timestamptz;
  observed:=(p_record->>'providerExpiresAt')::timestamptz;
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'Sandbox event value invalid' using errcode='22023';
 end;
 if not isfinite(deadline) or not isfinite(expected) or expected>deadline-interval '5 seconds'
  or (observed is not null and (not isfinite(observed) or observed>expected)) then
  raise exception 'Sandbox event deadline invalid' using errcode='22023'; end if;
 -- Lock preparation before journal, matching existing control lock direction.
 -- This also serializes per-attempt admission/counting without broad locks.
 if next_state in ('creating','running') then
  select * into p from makeborne_private.publication_preparations where id=pid for update;
  at_time:=clock_timestamp();
  if not found or p.state<>'running' or p.worker_id is distinct from wid or p.fence is distinct from f
   or p.lease_until is distinct from deadline or p.lease_until<=at_time or p.expires_at<=at_time or expected<=at_time
   or (next_state='running' and observed<=at_time) then
   raise exception 'Sandbox preparation lease changed' using errcode='PT409'; end if;
 end if;
 select * into s from makeborne_private.publication_sandboxes where name=p_record->>'name' for update;
 if not found then
  if next_state<>'creating' then raise exception 'Sandbox journal unavailable' using errcode='P0002'; end if;
  if exists(select 1 from makeborne_private.publication_sandboxes where preparation_id=pid and state<>'stopped')
   or (select count(*) from makeborne_private.publication_sandboxes where preparation_id=pid and fence=f and kind=k)>=(case when k='compiler' then 1 else 20 end) then
   raise exception 'Sandbox attempt limit or unresolved resource' using errcode='PT409'; end if;
  insert into makeborne_private.publication_sandboxes(name,preparation_id,worker_id,fence,lease_until,kind,image,evidence_sha256,runtime_identity,latest_expected_expiry,state,next_cleanup_at)
   values(p_record->>'name',pid,wid,f,deadline,k,p_record->>'image',p_record->>'evidenceSha256',p_record->>'runtimeIdentity',expected,'creating',deadline)
   on conflict(name) do nothing returning * into s;
  if found then return makeborne_private.publication_sandbox_snapshot(s); end if;
  select * into s from makeborne_private.publication_sandboxes where name=p_record->>'name' for update;
 end if;
 if s.preparation_id is distinct from pid or s.worker_id is distinct from wid or s.fence is distinct from f
  or s.lease_until is distinct from deadline or s.kind is distinct from k or s.image is distinct from p_record->>'image'
  or s.evidence_sha256 is distinct from p_record->>'evidenceSha256' or s.runtime_identity is distinct from p_record->>'runtimeIdentity'
  or s.latest_expected_expiry is distinct from expected
  or (s.session_id is not null and (s.session_id is distinct from p_record->>'sessionId' or s.provider_expires_at is distinct from observed))
  or (observed is not null and observed<=s.created_at) then
  raise exception 'Sandbox journal identity changed' using errcode='PT409'; end if;
 -- Exact terminal replay is safe even after cleanup ownership has moved.
 if s.state='stopped' then
  if next_state<>'stopped' or s.session_id is distinct from p_record->>'sessionId' or s.provider_expires_at is distinct from observed then
   raise exception 'Sandbox journal already stopped' using errcode='PT409'; end if;
  return makeborne_private.publication_sandbox_snapshot(s);
 end if;
 if s.cleanup_fence>0 or (next_state='creating' and s.state<>'creating')
  or (next_state='running' and s.state not in ('creating','running')) then
  raise exception 'Sandbox journal transition fenced' using errcode='PT409'; end if;
 update makeborne_private.publication_sandboxes set state=next_state,session_id=coalesce(session_id,p_record->>'sessionId'),
  provider_expires_at=coalesce(provider_expires_at,observed),updated_at=clock_timestamp(),
  next_cleanup_at=case when next_state='cleanup_unconfirmed' then clock_timestamp() else next_cleanup_at end,
  stopped_at=case when next_state='stopped' then clock_timestamp() else null end
  where name=s.name returning * into s;
 return makeborne_private.publication_sandbox_snapshot(s);
end $$;

create function makeborne_private.publication_worker_sandbox_cleanup_claim(p_worker uuid,p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare at_time timestamptz:=clock_timestamp(); result jsonb; pending bigint;
begin
 perform makeborne_private.assert_publication_worker();
 if p_worker is null or p_limit is null or p_limit not between 1 and 25 then raise exception 'Sandbox cleanup claim invalid' using errcode='22023'; end if;
 -- Bounded retention for confirmed terminal rows only; never infer absence from
 -- expected TTL, provider 404, age, exhausted retries, or preparation deletion.
 with old as (select name from makeborne_private.publication_sandboxes where state='stopped' and stopped_at<at_time-interval '30 days'
  order by stopped_at,name limit 100 for update skip locked)
 delete from makeborne_private.publication_sandboxes s using old where s.name=old.name;
 with candidates as (
  select s.name from makeborne_private.publication_sandboxes s where s.state<>'stopped'
   and (s.cleanup_lease_until is null or s.cleanup_lease_until<=at_time)
   and ((s.state='cleanup_unconfirmed' and s.next_cleanup_at<=at_time)
    or (s.state in ('creating','running') and not exists (
     select 1 from makeborne_private.publication_preparations p where p.id=s.preparation_id and p.state='running'
      and p.worker_id=s.worker_id and p.fence=s.fence and p.lease_until=s.lease_until
      and p.lease_until>at_time and p.expires_at>at_time)))
  order by s.next_cleanup_at,s.name limit p_limit for update of s skip locked
 ), claimed as (
  update makeborne_private.publication_sandboxes s set state='cleanup_unconfirmed',cleanup_worker_id=p_worker,
   cleanup_fence=cleanup_fence+1,cleanup_lease_until=at_time+interval '30 seconds',
   cleanup_attempts=least(cleanup_attempts+1,1000000),cleanup_finished=false,updated_at=at_time,
   next_cleanup_at=at_time+make_interval(secs=>least(300,5*(1<<least(cleanup_attempts,6))))
  from candidates c where s.name=c.name returning s.*
 ) select coalesce(jsonb_agg(jsonb_build_object('record',makeborne_private.publication_sandbox_snapshot(claimed),
  'cleanupFence',cleanup_fence::text,'cleanupLeaseUntil',cleanup_lease_until) order by next_cleanup_at,name),'[]'::jsonb) into result from claimed;
 -- Plain authority lookup never takes a reverse preparation lock. A matching
 -- valid peer remains untouched; a missing/failed/reclaimed attempt is cleanup
 -- work even before its former deadline. Backoff/held cleanup stays visible.
 select count(*) into pending from makeborne_private.publication_sandboxes s where s.state<>'stopped'
  and (s.state='cleanup_unconfirmed' or not exists (
   select 1 from makeborne_private.publication_preparations p where p.id=s.preparation_id and p.state='running'
    and p.worker_id=s.worker_id and p.fence=s.fence and p.lease_until=s.lease_until
    and p.lease_until>at_time and p.expires_at>at_time));
 return jsonb_build_object('records',result,'pending',pending);
end $$;

create function makeborne_private.publication_worker_sandbox_cleanup_finish(p_name text,p_worker uuid,p_cleanup_fence bigint,p_state text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare s makeborne_private.publication_sandboxes%rowtype;
begin
 perform makeborne_private.assert_publication_worker();
 if p_name is null or length(p_name)>64 or p_worker is null or p_cleanup_fence is null or p_cleanup_fence<1
  or p_state is null or p_state not in ('stopped','cleanup_unconfirmed') then raise exception 'Sandbox cleanup result invalid' using errcode='22023'; end if;
 select * into s from makeborne_private.publication_sandboxes where name=p_name for update;
 if not found then raise exception 'Sandbox journal unavailable' using errcode='P0002'; end if;
 if s.cleanup_worker_id is distinct from p_worker or s.cleanup_fence is distinct from p_cleanup_fence then
  raise exception 'Sandbox cleanup lease changed' using errcode='PT409'; end if;
 if s.cleanup_finished then
  if s.state<>p_state then raise exception 'Sandbox cleanup result changed' using errcode='PT409'; end if;
  return makeborne_private.publication_sandbox_snapshot(s);
 end if;
 if s.state='stopped' or s.cleanup_lease_until is null or s.cleanup_lease_until<=clock_timestamp() then
  raise exception 'Sandbox cleanup lease changed' using errcode='PT409'; end if;
 update makeborne_private.publication_sandboxes set state=p_state,cleanup_finished=true,updated_at=clock_timestamp(),
  stopped_at=case when p_state='stopped' then clock_timestamp() else null end,
  next_cleanup_at=greatest(next_cleanup_at,clock_timestamp()+interval '5 seconds')
  where name=s.name returning * into s;
 -- Keep lease identity until the next claim so a lost finish response can be
 -- retried exactly; no new execution authority is created by either result.
 return makeborne_private.publication_sandbox_snapshot(s);
end $$;

do $$ declare f record; args text; names text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='makeborne_private' and p.proname in ('publication_worker_sandbox_event','publication_worker_sandbox_cleanup_claim','publication_worker_sandbox_cleanup_finish') loop
  args:=pg_get_function_arguments(f.oid);
  select string_agg(x,',' order by ord) into names from unnest((select proargnames from pg_proc where oid=f.oid)) with ordinality a(x,ord);
  execute format('create function public.makeborne_%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$ select makeborne_private.%I(%s); $fn$',f.proname,args,f.proname,names);
  execute format('revoke all on function makeborne_private.%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function makeborne_private.%I(%s) to makeborne_publication_worker',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('revoke all on function public.makeborne_%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.makeborne_%I(%s) to makeborne_publication_worker',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end $$;
commit;
