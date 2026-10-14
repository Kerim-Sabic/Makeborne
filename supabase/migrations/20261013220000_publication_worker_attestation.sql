-- Created by Supabase CLI; additive read-only controller startup contract.
begin;
create function makeborne_private.publication_worker_attest() returns jsonb
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
  or exists(select 1 from pg_class where oid in('makeborne_private.site_address_namespace_policy'::regclass,'makeborne_private.publication_sandboxes'::regclass) and not relrowsecurity) then
  raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then raise exception 'Publication controller namespace unavailable' using errcode='PT409'; end if;
 return jsonb_build_object('contractVersion','publication-controller-v1','namespace',policy.mode,'qaWorkspaceId',policy.qa_workspace_id);
end $$;
create function public.makeborne_publication_worker_attest() returns jsonb
language sql security invoker set search_path='' as $$ select makeborne_private.publication_worker_attest(); $$;
revoke all on function makeborne_private.publication_worker_attest() from public,anon,authenticated,service_role;
revoke all on function public.makeborne_publication_worker_attest() from public,anon,authenticated,service_role;
grant execute on function makeborne_private.publication_worker_attest() to makeborne_publication_worker;
grant execute on function public.makeborne_publication_worker_attest() to makeborne_publication_worker;
commit;
