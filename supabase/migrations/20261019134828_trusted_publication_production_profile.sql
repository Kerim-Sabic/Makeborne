-- Forward-only production rollout boundary. No login, password, activation or allowlist entries.
begin;
create table makeborne_private.trusted_publication_workspaces (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 enabled boolean not null default false,
 created_at timestamptz not null default now()
);
alter table makeborne_private.trusted_publication_workspaces enable row level security;
revoke all on makeborne_private.trusted_publication_workspaces from public,anon,authenticated,service_role,makeborne_publication_worker;

-- Database-owner changes only. Shared row locks serialize revocation against
-- authority checks and promotion; request inputs cannot change rollout scope.
create function makeborne_private.publication_workspace_allowed(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype;
begin
 if p_workspace is null then return false; end if;
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then return false; end if;
 if policy.mode='staging' then return p_workspace=policy.qa_workspace_id; end if;
 if policy.mode<>'production' then return false; end if;
 perform 1 from makeborne_private.trusted_publication_workspaces where workspace_id=p_workspace and enabled for share;
 return found;
end $$;
revoke all on function makeborne_private.publication_workspace_allowed(uuid) from public,anon,authenticated,service_role,makeborne_publication_worker;

create or replace function makeborne_private.publication_authority(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid)
returns public.artifacts language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype;
begin
 perform 1 from public.workspaces where id=p_workspace and owner_id=p_actor for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace and kind='website' for update;
 if not found then raise exception 'Website not found' using errcode='P0002'; end if;
 if not makeborne_private.publication_workspace_allowed(p_workspace) then raise exception 'Trusted publication workspace not enabled' using errcode='42501'; end if;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 perform 1 from makeborne_private.account_privileges where user_id=p_actor for share;
 perform 1 from makeborne_private.billing_settings where singleton for share;
 perform 1 from public.billing_memberships m join makeborne_private.billing_access_plans b on b.plan_id=m.plan_id
  where m.user_id=p_actor for share of m,b;
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 return a;
end $$;

create or replace function makeborne_private.publication_worker_candidates(p_limit integer default 10) returns jsonb
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
   and expires_at>at_time and attempts<3 and makeborne_private.publication_workspace_allowed(workspace_id)
  order by updated_at,id limit p_limit) q;
 return result;
end $$;

create or replace function makeborne_private.publication_worker_attest() returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype; signature text; private_oid oid; public_oid oid; f record;
 allowed_oids oid[]:='{}';
begin
 perform makeborne_private.assert_publication_worker();
 -- Check actual contracts and privileges, never infer runtime health from a
 -- migration-history count. This reveals no data or new execution authority.
 foreach signature in array array['publication_worker_candidates(integer)','publication_worker_claim(uuid,uuid)',
  'publication_worker_load(uuid,uuid,bigint)','publication_worker_asset_locator(uuid,uuid,bigint,uuid)',
  'publication_worker_complete(uuid,uuid,bigint,jsonb,text)','publication_worker_fail(uuid,uuid,bigint,text)',
  'publication_worker_sandbox_event(jsonb)','publication_worker_sandbox_cleanup_claim(uuid,integer)',
  'publication_worker_sandbox_cleanup_finish(text,uuid,bigint,text)','publication_worker_attest()'] loop
  private_oid:=to_regprocedure('makeborne_private.'||signature); public_oid:=to_regprocedure('public.makeborne_'||signature);
  if private_oid is null or public_oid is null then raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
  allowed_oids:=allowed_oids||array[private_oid,public_oid];
  for f in select p.oid,p.prosecdef,p.proconfig,p.prorettype,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in(private_oid,public_oid) loop
   if f.prosecdef is distinct from (f.nspname='makeborne_private') or not coalesce('search_path=""'=any(f.proconfig),false)
    or f.prorettype<>'jsonb'::regtype or not has_function_privilege('makeborne_publication_worker',f.oid,'EXECUTE')
    or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
    or has_function_privilege('service_role',f.oid,'EXECUTE') then
    raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
  end loop;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','makeborne_private','makeborne_hosting') and p.prokind='f'
   and has_function_privilege('makeborne_publication_worker',p.oid,'EXECUTE')
   and not p.oid=any(allowed_oids))
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','makeborne_private','makeborne_hosting','auth','storage') and c.relkind in('r','v','m','p')
   and has_table_privilege('makeborne_publication_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  or exists(select 1 from pg_class where oid in('makeborne_private.site_address_namespace_policy'::regclass,'makeborne_private.publication_sandboxes'::regclass,'makeborne_private.trusted_publication_workspaces'::regclass) and not relrowsecurity) then
  raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then raise exception 'Publication controller namespace unavailable' using errcode='PT409'; end if;
 if policy.mode='production' then
  perform 1 from makeborne_private.trusted_publication_workspaces where enabled order by workspace_id for share;
  return jsonb_build_object('contractVersion','publication-controller-v2','namespace','production','workspaceAllowlist',
   (select coalesce(jsonb_agg(workspace_id::text order by workspace_id),'[]'::jsonb) from makeborne_private.trusted_publication_workspaces where enabled));
 end if;
 return jsonb_build_object('contractVersion','publication-controller-v1','namespace',policy.mode,'qaWorkspaceId',policy.qa_workspace_id);
end $$;
commit;
