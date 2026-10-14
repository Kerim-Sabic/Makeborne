-- Read-only namespace catalog check; run on the inspected disposable only.
\set ON_ERROR_STOP on
begin;
do $$ declare f record; r text; begin
 assert (select relrowsecurity from pg_class where oid='makeborne_private.site_address_namespace_policy'::regclass);
 assert (select count(*)=1 from makeborne_private.site_address_namespace_policy);
 foreach r in array array['anon','authenticated','service_role','makeborne_publication_worker'] loop
  assert not has_table_privilege(r,'makeborne_private.site_address_namespace_policy','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),r;
  for f in select oid,proname,prosecdef,proconfig from pg_proc where pronamespace='makeborne_private'::regnamespace
   and proname in ('check_site_address_namespace','guard_site_address_namespace','validate_site_address_namespace_policy','configure_site_address_namespace') loop
   assert not has_function_privilege(r,f.oid,'EXECUTE'),r||':'||f.proname;
   assert 'search_path=""'=any(f.proconfig),f.proname;
   assert f.prosecdef=(f.proname<>'configure_site_address_namespace'),f.proname;
  end loop;
 end loop;
 assert (select count(*)=3 from pg_trigger where tgname='site_address_namespace_guard' and tgenabled='O' and tgrelid in
  ('public.hosted_sites'::regclass,'makeborne_hosting.site_address_reservations'::regclass,'makeborne_private.publication_preparations'::regclass));
 assert has_function_privilege('service_role','public.makeborne_request_publication_preparation(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)','EXECUTE');
 assert has_function_privilege('service_role','public.makeborne_promote_publication_preparation(uuid,uuid,uuid,timestamptz)','EXECUTE');
 assert has_function_privilege('service_role','public.makeborne_save_hosted_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('makeborne_publication_worker','public.makeborne_request_publication_preparation(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)','EXECUTE');
 raise notice 'PASS namespace policy RLS, zero caller table/helper grants, owner-invoker configuration, private fixed paths, three write guards, unchanged service and worker scope';
end $$;
rollback;
