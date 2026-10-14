-- Read-only catalog checks for the inspected disposable qualification database.
\set ON_ERROR_STOP on
begin;
do $$ declare r text; f record; begin
 assert (select relrowsecurity from pg_class where oid='makeborne_private.publication_sandboxes'::regclass);
 assert not exists(select 1 from pg_constraint where conrelid='makeborne_private.publication_sandboxes'::regclass and contype='f');
 assert (select count(*)=3 from pg_indexes where schemaname='makeborne_private' and indexname in
  ('publication_sandboxes_attempt','publication_sandboxes_cleanup','publication_sandboxes_retention'));
 assert (select count(*)=6 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','makeborne_private') and p.proname in
  ('publication_worker_sandbox_event','publication_worker_sandbox_cleanup_claim','publication_worker_sandbox_cleanup_finish',
   'makeborne_publication_worker_sandbox_event','makeborne_publication_worker_sandbox_cleanup_claim','makeborne_publication_worker_sandbox_cleanup_finish'));
 foreach r in array array['anon','authenticated','service_role','makeborne_publication_worker'] loop
  assert not has_table_privilege(r,'makeborne_private.publication_sandboxes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),r;
  assert not has_function_privilege(r,'makeborne_private.publication_sandbox_snapshot(makeborne_private.publication_sandboxes)','EXECUTE'),r;
 end loop;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','makeborne_private') and p.proname in
  ('publication_worker_sandbox_event','publication_worker_sandbox_cleanup_claim','publication_worker_sandbox_cleanup_finish',
   'makeborne_publication_worker_sandbox_event','makeborne_publication_worker_sandbox_cleanup_claim','makeborne_publication_worker_sandbox_cleanup_finish') loop
  assert f.prosecdef=(f.nspname='makeborne_private'),f.proname;
  assert 'search_path=""'=any(f.proconfig),f.proname;
  assert has_function_privilege('makeborne_publication_worker',f.oid,'EXECUTE'),f.proname;
  foreach r in array array['anon','authenticated','service_role'] loop
   assert not has_function_privilege(r,f.oid,'EXECUTE'),r||':'||f.proname;
  end loop;
 end loop;
 raise notice 'PASS journal RLS, no caller table/snapshot grants, no cascade FK, indexed bounded discovery/retention, three restricted fixed-path private/public bridges';
end $$;
rollback;
