-- Credit wallet concurrency across real sessions (dblink). ISOLATED DATABASE ONLY.
-- It commits short-lived fixtures, so it refuses to run in the main database or
-- any database holding wallets or ledger rows. Cleanup removes its fixtures.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -d makeborne_crm_isolated -v ON_ERROR_STOP=1 < supabase/check-credit-wallets-concurrency.sql
\set ON_ERROR_STOP on
-- Part 2: concurrency sanity across real sessions (dblink, local credentials).
begin;
create extension if not exists dblink with schema extensions;
do $$
declare
  c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); i int; ok int:=0; insufficient int:=0;
  -- Loopback is trust-authenticated; dblink needs a password-authenticated path.
  conn text:=format('host=supabase_db_makeborne-local port=5432 dbname=%s user=postgres password=postgres', current_database());
  w record; err text; saved_trial record;
begin
  if current_database() = 'postgres' or exists(select 1 from makeborne_private.credit_wallets) or exists(select 1 from public.credit_ledger) then
    raise exception 'Refusing to run: use a disposable database with no credit wallets and no credit ledger rows.';
  end if;
  perform extensions.dblink_connect('holder',conn);
  select * into saved_trial from extensions.dblink('holder',
    'select free_tier_enabled,trial_credits from makeborne_private.billing_settings where singleton')
    as r(enabled boolean, credits integer);
  perform extensions.dblink_exec('holder',format(
    'insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(%L,%L,now(),false),(%L,%L,now(),false)',
    c,'wallet-conc-'||c||'@example.invalid',d,'wallet-conc-'||d||'@example.invalid'));
  begin
    -- Committed fixture so the racing sessions see it; restore on success or failure.
    perform extensions.dblink_exec('holder','update makeborne_private.billing_settings set free_tier_enabled=true,trial_credits=50 where singleton');
    perform * from extensions.dblink('holder',format('select public.makeborne_credit_grant(%L,100,%L,%L,%L)::text',c,'adjust','conc-seed','{"reason":"Concurrency fixture"}')) as r(v text);
    -- Hold the wallet lock so every racer queues behind it.
    perform extensions.dblink_exec('holder','begin');
    perform * from extensions.dblink('holder',format('select user_id::text from makeborne_private.credit_wallets where user_id=%L for update',c)) as r(v text);
    for i in 1..6 loop
      perform extensions.dblink_connect('racer'||i,conn);
      perform extensions.dblink_send_query('racer'||i,format('select public.makeborne_credit_reserve(%L,30,%L)::text',c,'conc-'||i));
    end loop;
    for i in 1..4 loop
      perform extensions.dblink_connect('trial'||i,conn);
      perform extensions.dblink_send_query('trial'||i,format('select public.makeborne_credit_ensure_trial(%L)::text',d));
    end loop;
    perform pg_sleep(0.5);
    perform extensions.dblink_exec('holder','commit');
    for i in 1..6 loop
      if exists(select 1 from extensions.dblink_get_result('racer'||i,false) as r(v text)) then ok:=ok+1;
      else
        err:=extensions.dblink_error_message('racer'||i);
        if err like '%Insufficient credits%' then insufficient:=insufficient+1; else raise exception 'Unexpected racer error: %',err; end if;
      end if;
      perform extensions.dblink_disconnect('racer'||i);
    end loop;
    for i in 1..4 loop
      perform * from extensions.dblink_get_result('trial'||i) as r(v text);
      perform extensions.dblink_disconnect('trial'||i);
    end loop;
    assert ok=3 and insufficient=3, format('Concurrent reserves: %s ok, %s insufficient',ok,insufficient);
    select * into w from extensions.dblink('holder',format(
      'select balance,reserved,(select count(*) from public.credit_ledger where user_id=%L and kind=''reserve''),(select sum(delta) from public.credit_ledger where user_id=%L),(select count(*) from public.credit_ledger where user_id=%L and kind=''trial''),(select balance from makeborne_private.credit_wallets where user_id=%L) from makeborne_private.credit_wallets where user_id=%L',
      c,c,d,d,c)) as r(balance bigint,reserved bigint,reserves bigint,ledger_sum bigint,trials bigint,trial_balance bigint);
    assert w.balance=100 and w.reserved=90 and w.reserves=3 and w.ledger_sum=10, format('Concurrent wallet wrong: %s',row_to_json(w));
    assert w.trials=1 and w.trial_balance=50, format('Concurrent trial wrong: %s',row_to_json(w));
  exception when others or assert_failure then   -- assert failures are not caught by OTHERS
    begin perform extensions.dblink_exec('holder','rollback'); exception when others then null; end;
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x<>'holder';
    perform extensions.dblink_exec('holder',format('delete from auth.users where id in (%L,%L)',c,d));
    perform extensions.dblink_exec('holder',format('update makeborne_private.billing_settings set free_tier_enabled=%L,trial_credits=%L where singleton',saved_trial.enabled,saved_trial.credits));
    perform extensions.dblink_disconnect('holder');
    raise;
  end;
  perform extensions.dblink_exec('holder',format('delete from auth.users where id in (%L,%L)',c,d));
  perform extensions.dblink_exec('holder',format('update makeborne_private.billing_settings set free_tier_enabled=%L,trial_credits=%L where singleton',saved_trial.enabled,saved_trial.credits));
  perform extensions.dblink_disconnect('holder');
  raise notice 'PASS concurrency: 6 racing reserves of 30 on 100 credits -> 3 ok, 3 MB402; 4 racing trials -> 1 grant';
end $$;
select 'PASS: concurrent reserve and trial serialization' as result;
rollback;
