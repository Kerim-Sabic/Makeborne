-- Read-only release inventory. Run as database owner in the intended project.
-- Outputs only schema metadata, fingerprints and aggregate counts, not customer content.
-- Safe when pre-release tables/columns do not exist. No fixtures, RPC mutations or secrets.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

select current_setting('server_version') as postgres_version;
do $$ declare v jsonb; begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'migration_history=MISSING';
  else
    execute 'select jsonb_agg(version order by version) from supabase_migrations.schema_migrations' into v;
    raise notice 'migration_versions=%', v;
  end if;
end $$;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema in ('public','makeborne_private','makeborne_hosting')
order by table_schema,table_name,ordinal_position;

select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  md5(pg_get_functiondef(p.oid)) as definition_md5, p.prosecdef as security_definer, p.proacl::text as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','makeborne_private','makeborne_hosting') and p.prokind in ('f','p')
order by 1,2,3;

select n.nspname as schema, c.relname as relation, c.relrowsecurity as rls,
  t.tgname, md5(pg_get_triggerdef(t.oid)) as trigger_md5
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','makeborne_private','makeborne_hosting') order by 1,2,4;

select schemaname,tablename,policyname,roles,cmd,md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) as policy_md5
from pg_policies where schemaname in ('public','makeborne_private','makeborne_hosting') order by 1,2,3;

select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text as grants
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','makeborne_private','makeborne_hosting') and c.relkind in ('r','p','v','m','S') order by 1,2;
select n.nspname,c.relname,k.conname,md5(pg_get_constraintdef(k.oid)) as constraint_md5
from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','makeborne_private','makeborne_hosting') order by 1,2,3;
select schemaname,tablename,indexname,md5(indexdef) as index_md5 from pg_indexes
where schemaname in ('public','makeborne_private','makeborne_hosting') order by 1,2,3;

do $$ declare spec record; v jsonb; begin
  for spec in select * from (values
    ('makeborne_private.credit_wallets','select jsonb_build_object(''wallets'',count(*),''balance'',coalesce(sum(balance),0),''reserved'',coalesce(sum(reserved),0)) from makeborne_private.credit_wallets'),
    ('makeborne_private.credit_reservations','select jsonb_build_object(''open_holds'',count(*),''held_credits'',coalesce(sum(amount),0)) from makeborne_private.credit_reservations where status=''reserved'''),
    ('public.credit_ledger','select jsonb_build_object(''ledger_rows'',count(*)) from public.credit_ledger'),
    ('public.hosted_sites','select jsonb_build_object(''hosted_sites'',count(*)) from public.hosted_sites'),
    ('makeborne_private.generation_execution_caps','select jsonb_agg(jsonb_build_object(''scope'',scope,''enabled'',enabled,''limit'',vendor_limit,''spent'',vendor_spent,''reserved'',vendor_reserved) order by scope) from makeborne_private.generation_execution_caps'),
    ('makeborne_private.live_provider_limits','select jsonb_agg(jsonb_build_object(''scope'',scope,''enabled'',enabled,''limit'',daily_limit_microusd,''stopped'',emergency_stop) order by scope) from makeborne_private.live_provider_limits')
  ) as s(relation,query) loop
    if to_regclass(spec.relation) is null then raise notice '%=MISSING',spec.relation;
    else
      begin execute spec.query into v; raise notice '%=%',spec.relation,v;
      exception when undefined_column then raise notice '%=SCHEMA_DIFF_REQUIRES_REVIEW',spec.relation; end;
    end if;
  end loop;
  if to_regclass('public.hosted_sites') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='hosted_sites' and column_name='needs_portable_republish') then
      execute 'select jsonb_build_object(''needs_portable_republish'',count(*)) from public.hosted_sites where needs_portable_republish' into v;
      raise notice 'portable_flags=%',v;
    else raise notice 'portable_flags=UNAVAILABLE_BEFORE_MIGRATION'; end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='hosted_sites' and column_name='entry_script') then
      execute 'select jsonb_build_object(''entry_script_present'',count(*)) from public.hosted_sites where entry_script is not null' into v;
      raise notice 'interactive_candidates=%',v;
    end if;
    if to_regclass('public.hosted_site_files') is not null then
      execute 'select jsonb_build_object(''sites_with_file_rows'',count(distinct artifact_id)) from public.hosted_site_files' into v;
      raise notice 'file_candidates=%',v;
    end if;
  end if;
end $$;
rollback;
