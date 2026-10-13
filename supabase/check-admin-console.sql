-- Administrator console RPCs: access control, counts, search, filters, bounds, privileges.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261013100000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  admin uuid := gen_random_uuid(); member uuid := gen_random_uuid(); plain uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  tag text := replace(gen_random_uuid()::text,'-',''); r jsonb; o jsonb; before_users bigint;
begin
  select count(*) into before_users from auth.users;
  insert into auth.users(id,email,email_confirmed_at,created_at) values
    (admin, 'admin-'||tag||'@console.example.invalid', now(), now()-interval '40 days'),
    (member, 'member_'||tag||'@console.example.invalid', now(), now()-interval '2 days'),
    (plain, 'plain%'||tag||'@console.example.invalid', null, now()-interval '1 day');
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(admin,true,false,'Transaction fixture');
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),member,'plan_Console1','ch_Console'||left(tag,8),'/studio','ready');
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until,checked_at)
    values('mem_Console'||left(tag,8),member,'ch_Console'||left(tag,8),'user_Console1','plan_Console1','active',now()+interval '20 days',now(),now());
  insert into public.workspaces(id,name,owner_id) values(w,'Console fixture',member);

  -- Refusals: nobody but an administrator, and no NULL actor.
  begin perform public.makeborne_admin_overview(member); raise exception 'Non-admin read the overview';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_admin_users(null); raise exception 'NULL actor read customers';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_admin_user(plain, member); raise exception 'Non-admin read a customer';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS admin console: non-administrators and NULL actors are refused';

  o := public.makeborne_admin_overview(admin);
  assert (o->'users'->>'total')::bigint = before_users + 3, 'user total: '||(o->'users')::text;
  assert (o->'users'->>'admins')::bigint >= 1;
  assert exists(select 1 from jsonb_array_elements(o->'subscriptions') s where s->>'status'='active' and (s->>'current')::boolean and (s->>'count')::int >= 1), 'active subscription missing: '||(o->'subscriptions')::text;
  assert o ? 'credits' and o ? 'ai' and o ? 'billingJobs' and o ? 'hosting' and o ? 'content';
  raise notice 'PASS admin console: overview counts users and current subscriptions';

  -- Search is a literal substring: % and _ in the query are not wildcards.
  r := public.makeborne_admin_users(admin, 'plain%'||tag);
  assert (r->>'total')::int = 1 and r->'rows'->0->>'email' = 'plain%'||tag||'@console.example.invalid', 'literal % search: '||r::text;
  r := public.makeborne_admin_users(admin, 'member_'||tag);
  assert (r->>'total')::int = 1, 'literal _ search: '||r::text;
  r := public.makeborne_admin_users(admin, '%'||left(tag,4)||'%console');
  assert (r->>'total')::int = 0, 'wildcards must not match: '||r::text;
  r := public.makeborne_admin_users(admin, member::text);
  assert (r->>'total')::int = 1, 'search by id';
  raise notice 'PASS admin console: search is literal and finds by email or id';

  r := public.makeborne_admin_users(admin, tag, 'subscribed');
  assert (r->>'total')::int = 1 and r->'rows'->0->'membership'->>'status' = 'active' and (r->'rows'->0->'membership'->>'current')::boolean;
  assert (r->'rows'->0->>'workspaces')::int = 1;
  assert (public.makeborne_admin_users(admin, tag, 'unconfirmed')->>'total')::int = 1;
  assert (public.makeborne_admin_users(admin, tag, 'admin')->>'total')::int = 1;
  r := public.makeborne_admin_users(admin, tag, 'all', 2, 0);
  assert (r->>'total')::int = 3 and jsonb_array_length(r->'rows') = 2, 'pagination';
  assert jsonb_array_length(public.makeborne_admin_users(admin, tag, 'all', 2, 2)->'rows') = 1;
  begin perform public.makeborne_admin_users(admin, null, 'all', 101); raise exception 'Unbounded page accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_admin_users(admin, null, 'everyone'); raise exception 'Unknown filter accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS admin console: filters, pagination and bounds';

  r := public.makeborne_admin_user(admin, member);
  assert r->'profile'->>'email' = 'member_'||tag||'@console.example.invalid';
  assert jsonb_array_length(r->'memberships') = 1 and jsonb_array_length(r->'workspaces') = 1;
  assert r->'credits' ? 'available' and r->'credits' ? 'ledger';
  assert public.makeborne_admin_user(admin, gen_random_uuid()) is null, 'unknown customer must be null';
  assert not (r::text ~* '(password|encrypted|token|secret)'), 'customer detail must not expose credentials';
  raise notice 'PASS admin console: customer detail, unknown customer, no credentials';

  -- Only the server role can call these; browsers (anon, authenticated) cannot.
  assert not has_function_privilege('anon','public.makeborne_admin_overview(uuid)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_admin_overview(uuid)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_admin_users(uuid,text,text,integer,integer)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_admin_user(uuid,uuid)','execute');
  assert has_function_privilege('service_role','public.makeborne_admin_users(uuid,text,text,integer,integer)','execute');
  assert not has_function_privilege('service_role','makeborne_private.require_admin(uuid)','execute');
  raise notice 'PASS admin console: server role only';
end $$;
select 'PASS: admin console' as result;
rollback;
