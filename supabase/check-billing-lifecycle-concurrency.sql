-- Commits synthetic fixtures via dblink, then deletes only those fixtures.
-- Invoke as supabase_admin ONLY inside the named network-none disposable rehearsal container.
-- dblink sessions execute as postgres; the superuser harness may use local trust sockets.
\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema extensions;
do $$
declare u uuid:=gen_random_uuid(); suffix text:=replace(gen_random_uuid()::text,'-',''); conn text:=format('dbname=%s user=postgres',current_database());
 i int; n int; r record; s timestamptz:=now()-interval '1 day'; e timestamptz:=now()+interval '1 month';
begin
 if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal database only'; end if;
 perform extensions.dblink_connect('billingadmin',conn);
 perform extensions.dblink_exec('billingadmin',format('insert into auth.users(id,email,email_confirmed_at) values(%L,%L,now())',u,u||'@billing-race.example.invalid'));
 begin
  for i in 1..8 loop
   perform extensions.dblink_connect('billingracer'||i,conn);
   perform extensions.dblink_send_query('billingracer'||i,format('select makeborne_private.credit_grant_plan_allocation(%L,%L,%L,%L,''create'',300,null,''{}'')::text',u,'mem_race'||suffix||i,s,e));
  end loop;
  for i in 1..8 loop
   perform * from extensions.dblink_get_result('billingracer'||i) as t(v text);
   perform extensions.dblink_disconnect('billingracer'||i);
  end loop;
  select * into r from extensions.dblink('billingadmin',format('select (select count(*) from public.credit_ledger where user_id=%L and kind=''plan_grant''), (select balance from makeborne_private.credit_wallets where user_id=%L), (select count(*) from makeborne_private.plan_credit_issues where user_id=%L and kind=''account_overlap'' and resolved_at is null)',u,u,u)) as t(grants bigint,balance bigint,issues bigint);
  assert r.grants=1 and r.balance=300 and r.issues=7,'Concurrent replacement grants not serialized: '||row_to_json(r);
  raise notice 'PASS lifecycle race: eight different memberships on one account mint one allowance and seven durable review issues';
  -- Each racer traps the expected account-level reservation conflict in its own DO block.
  for i in 1..8 loop
   perform extensions.dblink_connect('billingracer'||i,conn);
   perform extensions.dblink_send_query('billingracer'||i,format($q$do $race$ begin
    insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(gen_random_uuid(),%L,'plan_race','/studio','pending');
    exception when sqlstate 'PBC02' then null; end $race$;$q$,u));
  end loop;
  for i in 1..8 loop
   perform * from extensions.dblink_get_result('billingracer'||i) as t(v text);
   perform extensions.dblink_disconnect('billingracer'||i);
  end loop;
  select value into n from extensions.dblink('billingadmin',format('select count(*) from public.billing_checkouts where user_id=%L',u)) as t(value int);
  assert n=1,'Concurrent checkout reservations created duplicates';
  raise notice 'PASS lifecycle race: eight account checkout requests reserve exactly one provider attempt';
 exception when others or assert_failure then
  perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x like 'billingracer%';
  perform extensions.dblink_exec('billingadmin',format('delete from auth.users where id=%L',u));
  perform extensions.dblink_disconnect('billingadmin'); raise;
 end;
 perform extensions.dblink_exec('billingadmin',format('delete from auth.users where id=%L',u));
 perform extensions.dblink_disconnect('billingadmin');
end $$;
do $$
declare
  conn text:=format('dbname=%s user=postgres', current_database());
  u uuid:=gen_random_uuid(); i integer; ps timestamptz; pe timestamptz; call text; w record;
begin
  if current_database() <> 'rehearsal' then
    raise exception 'Refusing to run: use a disposable database with no plan periods and no credit ledger rows.';
  end if;
  ps := date_trunc('second', now()) - interval '100 days'; pe := ps + interval '1 year';   -- yearly: 4 allocations started
  perform extensions.dblink_connect('admin',conn);
  begin
    perform extensions.dblink_exec('admin',format('insert into auth.users(id,email,email_confirmed_at) values(%L,%L,now())',u,u||'@plan-conc.example.invalid'));
    -- Eight sessions at once: duplicate observations (webhooks/access checks) and duplicate deliveries of
    -- the initial payment, which is the evidence for the months before the first observation.
    for i in 1..8 loop
      call := case when i % 2 = 0
        then format('select public.makeborne_record_plan_observation(%L,''mem_conc'',''plan_conc'',''studio'',''yearly'',850,''active'',true,%L,%L,''webhook'')::text',u,ps,pe)
        else format('select public.makeborne_record_plan_payment(%L,''mem_conc'',''pay_conc1'',''plan_conc'',''studio'',''yearly'',850,''subscription_create'',%L,false)::text',u,ps + interval '30 seconds') end;
      perform extensions.dblink_connect('racer'||i,conn);
      perform extensions.dblink_send_query('racer'||i,call);
    end loop;
    -- Plus a scheduled reconcile racing them.
    perform extensions.dblink_connect('cron',conn);
    perform extensions.dblink_send_query('cron','select public.makeborne_reconcile_plan_credits(50)::text');
    for i in 1..8 loop
      perform * from extensions.dblink_get_result('racer'||i) as r(v text);
      perform extensions.dblink_disconnect('racer'||i);
    end loop;
    perform * from extensions.dblink_get_result('cron') as r(v text);
    perform extensions.dblink_disconnect('cron');
    select * into w from extensions.dblink('admin',format(
      'select (select count(*) from public.credit_ledger where user_id=%L and kind=''plan_grant''),
              (select sum(delta) from public.credit_ledger where user_id=%L and kind=''plan_grant''),
              (select balance from makeborne_private.credit_wallets where user_id=%L),
              (select count(*) from makeborne_private.plan_periods where membership_id=''mem_conc''),
              (select count(*) from makeborne_private.plan_observations where membership_id=''mem_conc''),
              (select sum(lapsed) from makeborne_private.credit_lots where user_id=%L and source=''plan'')',u,u,u,u))
      as r(grants bigint, total bigint, balance bigint, periods bigint, observations bigint, lapsed bigint);
    -- The first month has passed its two-month rollover; the next two and current month remain spendable.
    assert w.grants=4 and w.total=4*850 and w.balance=3*850 and w.lapsed=850 and w.periods=1 and w.observations=5,
      format('Concurrent grants wrong: %s', row_to_json(w));
  exception when others or assert_failure then   -- assert failures are not caught by OTHERS
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x<>'admin';
    perform extensions.dblink_exec('admin',format('delete from auth.users where id=%L',u));
    perform extensions.dblink_disconnect('admin');
    raise;
  end;
  perform extensions.dblink_exec('admin',format('delete from auth.users where id=%L',u));
  perform extensions.dblink_disconnect('admin');
  raise notice 'PASS concurrency: 4 duplicate observations + 4 duplicate payment deliveries + a racing reconcile -> 4 started allocations granted exactly once (4 x 850; 1 expired, 2 rolled over and 1 current), 1 period, 4 observations + 1 payment kept';
end $$;
rollback;
