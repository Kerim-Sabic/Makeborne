-- Created with Supabase CLI migration new, then ordered after preparation v54.
-- No login, password, authenticator membership, storage or provider credential.
begin;

create role makeborne_publication_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema public, makeborne_private to makeborne_publication_worker;

create index publication_preparations_dispatch on makeborne_private.publication_preparations(updated_at,id)
 where state in ('queued','running');
create index publication_preparations_expiry on makeborne_private.publication_preparations(expires_at,id)
 where state in ('queued','running');

-- SECURITY DEFINER changes current_user. The SQL role setting survives it and
-- SET ROLE is checked by PostgreSQL itself. Never trust request JWT/custom GUCs.
-- Eventual dedicated login must explicitly SET ROLE; it receives no raw grants.
create function makeborne_private.assert_publication_worker() returns void
language plpgsql set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'makeborne_publication_worker' then
  raise exception 'Publication worker role required' using errcode='42501';
 end if;
end $$;
revoke all on function makeborne_private.assert_publication_worker() from public,anon,authenticated,service_role,makeborne_publication_worker;

create function makeborne_private.publication_worker_candidates(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare at_time timestamptz:=clock_timestamp(); result jsonb;
begin
 perform makeborne_private.assert_publication_worker();
 if p_limit is null or p_limit not between 1 and 25 then raise exception 'Candidate limit must be 1 through 25' using errcode='22023'; end if;
 -- Bound maintenance separately from usable work. Unusable rows never consume
 -- the candidate limit, even when more than 100 await cleanup. Never touch ready
 -- or promoted immutable outputs. SKIP LOCKED avoids holding up active control.
 with dead as (
  select id from makeborne_private.publication_preparations
  where state in ('queued','running') and (state='queued' or lease_until<=at_time)
   and (expires_at<=at_time or attempts>=3)
  order by expires_at,id limit 100 for update skip locked
 ) update makeborne_private.publication_preparations p
 set state=case when p.expires_at<=at_time then 'expired' else 'failed' end,
  worker_id=null,lease_until=null,error='Preparation retry limit or expiry reached',updated_at=at_time
 from dead where p.id=dead.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id) order by q.updated_at,q.id),'[]'::jsonb) into result
 from (select id,updated_at from makeborne_private.publication_preparations
  where state in ('queued','running') and (state='queued' or lease_until<=at_time)
   and expires_at>at_time and attempts<3
  order by updated_at,id limit p_limit) q;
 return result;
end $$;

create function makeborne_private.publication_worker_claim(p_preparation uuid,p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 perform makeborne_private.assert_publication_worker();
 if p_preparation is null or p_worker is null then raise exception 'Preparation and worker required' using errcode='22023'; end if;
 begin
  return makeborne_private.claim_publication_preparation(p_preparation,p_worker);
 exception when sqlstate '42501' or sqlstate 'MB402' or sqlstate 'P0002' then
  -- The failed subtransaction released authority locks. Terminalize only work
  -- that is still eligible; never overwrite another worker's newly active lease.
  update makeborne_private.publication_preparations
  set state=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,
   worker_id=null,lease_until=null,error='PUBLICATION_AUTHORITY_UNAVAILABLE',updated_at=clock_timestamp()
  where id=p_preparation and (state='queued' or (state='running' and lease_until<=clock_timestamp()));
  return null;
 end;
end $$;

create function makeborne_private.publication_worker_load(p_preparation uuid,p_worker uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 perform makeborne_private.assert_publication_worker();
 return makeborne_private.load_publication_preparation(p_preparation,p_worker,p_fence);
end $$;

create function makeborne_private.publication_worker_asset_locator(p_preparation uuid,p_worker uuid,p_fence bigint,p_asset uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare loaded jsonb; result jsonb;
begin
 perform makeborne_private.assert_publication_worker();
 loaded:=makeborne_private.load_publication_preparation(p_preparation,p_worker,p_fence);
 select asset into result from jsonb_array_elements(loaded->'assetRecords') asset where asset->>'id'=p_asset::text;
 if result is null then raise exception 'Preparation asset unavailable' using errcode='42501'; end if;
 return result;
end $$;

create function makeborne_private.publication_worker_complete(p_preparation uuid,p_worker uuid,p_fence bigint,p_receipt jsonb,p_output text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 perform makeborne_private.assert_publication_worker();
 return makeborne_private.complete_publication_preparation(p_preparation,p_worker,p_fence,p_receipt,p_output);
end $$;

create function makeborne_private.publication_worker_fail(p_preparation uuid,p_worker uuid,p_fence bigint,p_error text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 perform makeborne_private.assert_publication_worker();
 return makeborne_private.fail_publication_preparation(p_preparation,p_worker,p_fence,p_error);
end $$;

-- Six explicit public invoker bridges only; existing service/browser behavior
-- and preparation v54 RPC privileges are deliberately preserved.
do $$ declare f record; args text; names text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='makeborne_private' and p.proname in ('publication_worker_candidates','publication_worker_claim','publication_worker_load',
   'publication_worker_asset_locator','publication_worker_complete','publication_worker_fail') loop
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
