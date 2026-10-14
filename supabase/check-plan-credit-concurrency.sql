-- Plan credit grants under real concurrent sessions (dblink). ISOLATED DATABASE ONLY.
-- It commits fixtures, so it refuses to run in the main database or any database
-- that already holds plan periods or credit ledger rows. Cleanup removes its own
-- fixtures; the database is meant to be dropped afterwards.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -d makeborne_crm_isolated -v ON_ERROR_STOP=1 < supabase/check-plan-credit-concurrency.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema extensions;
do $$
declare
  conn text:=format('host=supabase_db_makeborne-local port=5432 dbname=%s user=postgres password=postgres', current_database());
  u uuid:=gen_random_uuid(); i integer; ps timestamptz; pe timestamptz; call text; w record;
begin
  if current_database() = 'postgres' or exists(select 1 from makeborne_private.plan_periods) or exists(select 1 from public.credit_ledger) then
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
    -- Month 1 has passed its two-month rollover; months 2-3 plus current month 4 remain spendable.
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
