-- M17 browser-role ACL baseline. Read-only catalogue assertions; the transaction rolls back.
-- Detects privilege drift: a database restored without ACLs (or created outside the
-- migrations) inherits Supabase's default "grant all to anon, authenticated" on public
-- tables, which silently bypasses every column-level guard below. Run against any
-- environment before trusting RLS results there:
--   docker exec -i <db-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-browser-acl.sql
\set ON_ERROR_STOP on
begin;
do $$
declare bad text[];
  anon_rpcs constant text[] := array['makeborne_add_client_review_comment','makeborne_decide_client_review','makeborne_read_client_review',
    'makeborne_read_hosted_site','makeborne_read_hosted_site_file','makeborne_read_hosted_site_v2','makeborne_read_hosted_site_v3',
    'makeborne_read_portal_invite','makeborne_read_site_paths','makeborne_record_client_review_view','makeborne_record_site_view','makeborne_resolve_site_host',
    'read_hosted_site','read_hosted_site_file','read_hosted_site_v2','read_hosted_site_v3','read_site_paths'];
begin
  select array_agg(c.relname order by c.relname) into bad from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity;
  assert bad is null, 'RLS disabled on public tables: '||array_to_string(bad,', ');

  select array_agg(distinct table_name||':'||privilege_type order by table_name||':'||privilege_type) into bad
    from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','PUBLIC');
  assert bad is null, 'anon/PUBLIC hold table privileges (ACL drift): '||array_to_string(bad,', ');
  select array_agg(distinct table_name||':'||privilege_type) into bad
    from information_schema.column_privileges where table_schema='public' and grantee in ('anon','PUBLIC');
  assert bad is null, 'anon/PUBLIC hold column privileges: '||array_to_string(bad,', ');
  raise notice 'PASS browser ACL: RLS on every public table; anon and PUBLIC hold no table or column privilege';

  select array_agg(distinct table_name||':'||privilege_type) into bad from information_schema.role_table_grants
    where table_schema='public' and grantee='authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  assert bad is null, 'authenticated holds TRUNCATE/REFERENCES/TRIGGER: '||array_to_string(bad,', ');
  -- Version history, asset identity and counters are server/SQL-function owned.
  assert not has_column_privilege('authenticated','public.artifacts','current_version','UPDATE'), 'browser can move artifacts.current_version';
  assert not has_column_privilege('authenticated','public.artifacts','workspace_id','UPDATE') and not has_column_privilege('authenticated','public.artifacts','project_id','UPDATE'), 'browser can move an artifact between tenants/projects';
  assert not has_table_privilege('authenticated','public.artifact_versions','UPDATE') and not has_table_privilege('authenticated','public.artifact_versions','DELETE'), 'browser can rewrite saved versions';
  assert not has_table_privilege('authenticated','public.assets','UPDATE') and not has_table_privilege('authenticated','public.assets','DELETE'), 'browser can rewrite asset identity';
  assert not has_table_privilege('authenticated','public.projects','DELETE') and not has_table_privilege('authenticated','public.artifacts','DELETE'), 'browser can hard-delete projects';
  assert not has_column_privilege('authenticated','public.workspaces','owner_id','UPDATE'), 'browser can transfer workspace ownership';
  assert not has_column_privilege('authenticated','public.client_review_links','token_hash','SELECT')
    and not has_column_privilege('authenticated','public.client_portal_access','token_hash','SELECT'), 'browser can read bearer-token hashes';
  select array_agg(t order by t) into bad from unnest(array['github_connections','github_website_links','billing_checkouts','billing_memberships',
    'billing_webhook_events','claude_pilot_runs','usage_ledger','hosted_site_files','client_review_snapshots','client_review_views']) t
    where has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE');
  assert bad is null, 'browser can write server-owned tables: '||array_to_string(bad,', ');
  select array_agg(t order by t) into bad from unnest(array['brand_kits','custom_domains','hosted_sites','mail_accounts','mail_enrollments','mail_messages',
    'client_portal_access','client_portal_sites','client_portal_changes','client_review_links','client_review_comments','credit_ledger','site_enquiries']) t
    where has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE');
  assert bad is null, 'browser can write identity, publication, mail, portal or review tables directly: '||array_to_string(bad,', ');
  raise notice 'PASS browser ACL: version history, asset identity, ownership, tokens, publication, mail, portal, review and billing rows are not browser-writable';

  select array_agg(n.nspname||'.'||p.proname order by 1) into bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','makeborne_private','makeborne_hosting','makeborne_rpc') and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='],false);
  assert bad is null, 'SECURITY DEFINER without an empty search_path: '||array_to_string(bad,', ');
  select array_agg(distinct n.nspname||'.'||p.proname) into bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','makeborne_private','makeborne_hosting','makeborne_rpc') and has_function_privilege('anon',p.oid,'execute')
      and not p.proname = any(anon_rpcs);
  assert bad is null, 'anon executes functions outside the reviewed public surface: '||array_to_string(bad,', ');
  raise notice 'PASS browser ACL: definers pin search_path; anon executes only % reviewed hosting/review/portal-invite entry points', cardinality(anon_rpcs);

  assert (select not public from storage.buckets where id='project-assets'), 'project-assets bucket is public';
  select array_agg(policyname) into bad from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('SELECT','ALL')
    and ('authenticated'=any(roles) or 'anon'=any(roles) or 'public'=any(roles));
  assert bad is null, 'browser roles can read storage.objects rows (and so sign download URLs): '||array_to_string(bad,', ');
  raise notice 'PASS browser ACL: project-assets is private and no browser role can select object rows';
end $$;
rollback;
