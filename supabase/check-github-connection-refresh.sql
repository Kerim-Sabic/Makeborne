-- GitHub connection renewal columns: nullable, paired, server-only, and usable as a
-- compare-and-swap key so only one concurrent renewal stores its tokens.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261014150000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); legacy uuid := gen_random_uuid(); changed integer;
begin
  -- Shape: both columns exist and are nullable.
  assert (select count(*) from information_schema.columns where table_schema='public' and table_name='github_connections'
    and ((column_name='refresh_ciphertext' and data_type='text') or (column_name='refresh_expires_at' and data_type='timestamp with time zone'))
    and is_nullable='YES') = 2, 'refresh columns missing or not nullable';
  raise notice 'PASS github refresh: nullable refresh_ciphertext text and refresh_expires_at timestamptz';

  -- Boundary: browser roles still cannot reach the table or the new columns; RLS stays on.
  assert (select relrowsecurity from pg_class where oid='public.github_connections'::regclass), 'RLS must stay enabled';
  assert not has_table_privilege('anon','public.github_connections','select,insert,update,delete')
     and not has_table_privilege('authenticated','public.github_connections','select,insert,update,delete')
     and not has_column_privilege('anon','public.github_connections','refresh_ciphertext','select,update')
     and not has_column_privilege('authenticated','public.github_connections','refresh_ciphertext','select,update')
     and not has_column_privilege('authenticated','public.github_connections','refresh_expires_at','select,update'),
    'a browser role can reach private GitHub credentials';
  assert has_table_privilege('service_role','public.github_connections','select') and has_table_privilege('service_role','public.github_connections','insert')
     and has_table_privilege('service_role','public.github_connections','update') and has_table_privilege('service_role','public.github_connections','delete'), 'service_role lost access';
  raise notice 'PASS github refresh: only service_role can read or write the refresh columns';

  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@github-refresh.example.invalid',now()),(legacy,legacy||'@github-refresh.example.invalid',now());

  -- Existing behaviour: a connection without a refresh token is still valid.
  insert into public.github_connections(user_id,github_user_id,login,token_ciphertext,expires_at) values(legacy,1,'legacy','sealed-access',now()+interval '8 hours');
  assert (select refresh_ciphertext is null and refresh_expires_at is null from public.github_connections where user_id=legacy), 'legacy row gained refresh data';
  raise notice 'PASS github refresh: connections without a refresh token remain valid (no backfill)';

  -- A refresh token must carry its expiry, and the reverse.
  begin
    insert into public.github_connections(user_id,github_user_id,login,token_ciphertext,expires_at,refresh_ciphertext)
      values(u,2,'octo','sealed-access',now(),'sealed-refresh-a');
    raise exception 'refresh token without expiry accepted';
  exception when check_violation then null; end;
  begin
    update public.github_connections set refresh_expires_at=now()+interval '180 days' where user_id=legacy;
    raise exception 'refresh expiry without token accepted';
  exception when check_violation then null; end;
  raise notice 'PASS github refresh: refresh token and expiry are stored together';

  -- Compare-and-swap as the service role: exactly one renewal of the same spent token wins.
  insert into public.github_connections(user_id,github_user_id,login,token_ciphertext,expires_at,refresh_ciphertext,refresh_expires_at)
    values(u,2,'octo','sealed-access-0',now()-interval '1 minute','sealed-refresh-a',now()+interval '180 days');
  set local role service_role;
  update public.github_connections set token_ciphertext='sealed-access-1',expires_at=now()+interval '8 hours',refresh_ciphertext='sealed-refresh-b',refresh_expires_at=now()+interval '180 days',updated_at=now()
    where user_id=u and refresh_ciphertext='sealed-refresh-a';
  get diagnostics changed = row_count;
  assert changed = 1, 'first renewal must win';
  update public.github_connections set token_ciphertext='sealed-access-2',expires_at=now()+interval '8 hours',refresh_ciphertext='sealed-refresh-c',refresh_expires_at=now()+interval '180 days',updated_at=now()
    where user_id=u and refresh_ciphertext='sealed-refresh-a';
  get diagnostics changed = row_count;
  assert changed = 0, 'a second renewal of the spent refresh token must lose';
  assert (select token_ciphertext='sealed-access-1' and refresh_ciphertext='sealed-refresh-b' from public.github_connections where user_id=u), 'winner tokens overwritten';
  -- Clearing a revoked refresh token is conditional too and leaves the access token for identity checks.
  update public.github_connections set refresh_ciphertext=null,refresh_expires_at=null where user_id=u and refresh_ciphertext='sealed-refresh-a';
  get diagnostics changed = row_count;
  assert changed = 0, 'a stale clear must not remove the winner refresh token';
  update public.github_connections set refresh_ciphertext=null,refresh_expires_at=null where user_id=u and refresh_ciphertext='sealed-refresh-b';
  get diagnostics changed = row_count;
  assert changed = 1, 'a revoked refresh token is cleared';
  reset role;
  raise notice 'PASS github refresh: compare-and-swap lets exactly one renewal win and stale clears do nothing';
end $$;
select 'PASS: github connection refresh' as result;
rollback;
