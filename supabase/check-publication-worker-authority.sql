-- Read-only catalog assertions. Run only against the inspected disposable DB.
\set ON_ERROR_STOP on
begin;
do $$ declare r record; f record; allowed text[]:=array['publication_worker_candidates','publication_worker_claim','publication_worker_load','publication_worker_asset_locator','publication_worker_complete','publication_worker_fail','publication_worker_sandbox_event','publication_worker_sandbox_cleanup_claim','publication_worker_sandbox_cleanup_finish','publication_worker_attest']; begin
 select * into r from pg_roles where rolname='makeborne_publication_worker';
 assert found and not r.rolcanlogin and not r.rolinherit and not r.rolsuper and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication and not r.rolbypassrls;
 assert not pg_has_role('anon','makeborne_publication_worker','MEMBER');
 assert not pg_has_role('authenticated','makeborne_publication_worker','MEMBER');
 assert not pg_has_role('service_role','makeborne_publication_worker','MEMBER');
 assert not pg_has_role('authenticator','makeborne_publication_worker','MEMBER');
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','makeborne_private','makeborne_hosting') and p.prokind='f' loop
  if (f.nspname='makeborne_private' and f.proname=any(allowed)) or (f.nspname='public' and replace(f.proname,'makeborne_','')=any(allowed)) then
   assert has_function_privilege('makeborne_publication_worker',f.oid,'EXECUTE'),f.proname;
   assert not has_function_privilege('anon',f.oid,'EXECUTE'),f.proname;
   assert not has_function_privilege('authenticated',f.oid,'EXECUTE'),f.proname;
   assert not has_function_privilege('service_role',f.oid,'EXECUTE'),f.proname;
   assert f.prosecdef=(f.nspname='makeborne_private'),f.proname;
   assert 'search_path=""'=any(f.proconfig),f.proname;
  else
   assert not has_function_privilege('makeborne_publication_worker',f.oid,'EXECUTE'),f.nspname||'.'||f.proname;
  end if;
 end loop;
 for f in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','makeborne_private','makeborne_hosting','auth','storage') and c.relkind in ('r','v','m','p') loop
  assert not has_table_privilege('makeborne_publication_worker',f.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),f.nspname||'.'||f.relname;
 end loop;
 assert has_function_privilege('service_role','public.makeborne_claim_publication_preparation(uuid,uuid)','EXECUTE');
 assert has_function_privilege('service_role','public.makeborne_promote_publication_preparation(uuid,uuid,uuid,timestamptz)','EXECUTE');
 assert not has_function_privilege('anon','public.makeborne_promote_publication_preparation(uuid,uuid,uuid,timestamptz)','EXECUTE');
 raise notice 'PASS restricted role attributes, membership, explicit preparation/journal RPC grants, fixed search paths, no table or unrelated RPC access, legacy service grants';
 begin
  perform public.makeborne_publication_worker_candidates(10);
  raise exception 'Owner without SET ROLE passed guard';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS SECURITY DEFINER rejects owner session without explicit SQL worker role';
end $$;
rollback;
