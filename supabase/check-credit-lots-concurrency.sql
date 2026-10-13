-- Credit lots under real concurrent sessions (dblink). ISOLATED DATABASE ONLY.
-- It commits fixtures, so it refuses to run in the main database or any database
-- holding wallets, lots or ledger rows. Cleanup removes its fixtures; the database
-- is meant to be dropped afterwards.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -d makeborne_crm_isolated -v ON_ERROR_STOP=1 < supabase/check-credit-lots-concurrency.sql
\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema extensions;

-- Result of one racer: 'ok:<value>' or 'err:<message>'.
create function pg_temp.collect(c text) returns text
language plpgsql as $$
declare v text;
begin
  select r.v into v from extensions.dblink_get_result(c,false) as r(v text);
  v := case when v is null then 'err:'||coalesce(extensions.dblink_error_message(c),'') else 'ok:'||v end;
  perform extensions.dblink_disconnect(c);
  return v;
end $$;
create function pg_temp.race(c text, conn text, sql text) returns void
language plpgsql as $$
begin
  perform extensions.dblink_connect(c,conn);
  perform extensions.dblink_send_query(c,sql);
end $$;

do $$
declare
  conn text := format('host=supabase_db_makeborne-local port=5432 dbname=%s user=postgres password=postgres', current_database());
  a uuid := gen_random_uuid(); e uuid := gen_random_uuid(); h uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  i integer; ok integer := 0; insufficient integer := 0; res text; res2 text; res3 text; ends timestamptz; w record;
begin
  if current_database() = 'postgres' or exists(select 1 from makeborne_private.credit_wallets) or exists(select 1 from makeborne_private.credit_lots)
     or exists(select 1 from public.credit_ledger) then
    raise exception 'Refusing to run: use a disposable database with no wallets, lots or ledger rows.';
  end if;
  perform extensions.dblink_connect('admin',conn);
  perform extensions.dblink_exec('admin',format('insert into auth.users(id,email,email_confirmed_at) values(%L,%L,now()),(%L,%L,now()),(%L,%L,now()),(%L,%L,now())',
    a,a||'@lots-conc.example.invalid',e,e||'@lots-conc.example.invalid',h,h||'@lots-conc.example.invalid',f,f||'@lots-conc.example.invalid'));
  begin
    -- A. Concurrent reservations across several lots ------------------------
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,50,''plan_grant'',''plan:conc'',%L)::text',a,jsonb_build_object('expiresAt',now() + interval '1 day'))) as r(v text);
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,30,''trial'',''trial'',''{}'')::text',a)) as r(v text);
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,20,''topup'',''topup-conc'',''{}'')::text',a)) as r(v text);
    perform extensions.dblink_connect('holder',conn);
    perform extensions.dblink_exec('holder','begin');
    perform * from extensions.dblink('holder',format('select user_id::text from makeborne_private.credit_wallets where user_id=%L for update',a)) as r(v text);
    for i in 1..6 loop
      perform pg_temp.race('racer'||i,conn,format('select public.makeborne_credit_reserve(%L,30,%L)::text',a,'conc-'||i));
    end loop;
    perform pg_sleep(0.5);
    perform extensions.dblink_exec('holder','commit');
    perform extensions.dblink_disconnect('holder');
    for i in 1..6 loop
      res := pg_temp.collect('racer'||i);
      if res like 'ok:%' then ok := ok + 1;
      elsif res like '%Insufficient credits%' then insufficient := insufficient + 1;
      else raise exception 'Unexpected racer result: %', res; end if;
    end loop;
    assert ok = 3 and insufficient = 3, format('Concurrent reserves: %s ok, %s insufficient', ok, insufficient);
    select * into w from extensions.dblink('admin',format(
      'select (select sum(held) from makeborne_private.credit_lots where user_id=%1$L),
              (select count(*) from (select reference from makeborne_private.credit_hold_lots where user_id=%1$L group by reference having sum(amount)<>30) x),
              (select sum(delta) from public.credit_ledger where user_id=%1$L),
              (public.makeborne_credit_wallet(%1$L)->>''available'')::bigint,
              (select held from makeborne_private.credit_lots where user_id=%1$L and source=''plan'')',a))
      as r(held bigint, bad_holds bigint, ledger bigint, available bigint, plan_held bigint);
    assert w.held = 90 and w.bad_holds = 0 and w.ledger = 10 and w.available = 10 and w.plan_held = 50, format('Concurrent lots wrong: %s', row_to_json(w));
    raise notice 'PASS concurrent reservations: 3 of 6 fit, each hold funded exactly (expiring plan credits first), ledger = available';

    -- B. Spend racing an allocation's end -----------------------------------
    -- Every racer starts before the end; the wallet lock is released after it.
    ends := clock_timestamp() + interval '2 seconds';
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,40,''plan_grant'',''plan:ending'',%L)::text',e,jsonb_build_object('expiresAt',ends))) as r(v text);
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,10,''topup'',''topup-e'',''{}'')::text',e)) as r(v text);
    perform extensions.dblink_connect('holder',conn);
    perform extensions.dblink_exec('holder','begin');
    perform * from extensions.dblink('holder',format('select user_id::text from makeborne_private.credit_wallets where user_id=%L for update',e)) as r(v text);
    perform pg_temp.race('spend40',conn,format('select public.makeborne_credit_reserve(%L,40,''spend-40'')::text',e));
    perform pg_temp.race('spend10',conn,format('select public.makeborne_credit_reserve(%L,10,''spend-10'')::text',e));
    perform pg_sleep(greatest(extract(epoch from ends - clock_timestamp()),0) + 0.3);
    perform pg_temp.race('expirer',conn,'select public.makeborne_credit_expire_due(100)::text');
    perform pg_sleep(0.3);
    perform extensions.dblink_exec('holder','commit');
    perform extensions.dblink_disconnect('holder');
    res := pg_temp.collect('spend40'); res2 := pg_temp.collect('spend10'); res3 := pg_temp.collect('expirer');
    assert res like '%Insufficient credits%' and res2 like 'ok:%' and res3 like 'ok:%', format('End race: spend40=%s spend10=%s expirer=%s', res, res2, res3);
    select * into w from extensions.dblink('admin',format(
      'select (select lapsed from makeborne_private.credit_lots where user_id=%1$L and reference=''plan:ending''),
              (select held from makeborne_private.credit_lots where user_id=%1$L and reference=''plan:ending''),
              (select count(*) from public.credit_ledger where user_id=%1$L and kind=''expire''),
              (select sum(delta) from public.credit_ledger where user_id=%1$L),
              (public.makeborne_credit_wallet(%1$L)->>''available'')::bigint',e))
      as r(lapsed bigint, held bigint, expiries bigint, ledger bigint, available bigint);
    assert w.lapsed = 40 and w.held = 0 and w.expiries = 1 and w.ledger = 0 and w.available = 0, format('End race wrong: %s', row_to_json(w));
    raise notice 'PASS spend vs expiry: requests started before the end but locked after it cannot spend the allocation; lapse recorded once';

    -- C. Hold timeout racing a late settle and release ----------------------
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,50,''topup'',''topup-h'',''{}'')::text',h)) as r(v text);
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_reserve(%L,30,''run-stale'')::text',h)) as r(v text);
    perform extensions.dblink_exec('admin',format('update makeborne_private.credit_reservations set created_at=now()-interval ''16 minutes'' where user_id=%L and reference=''run-stale''',h));
    perform extensions.dblink_connect('holder',conn);
    perform extensions.dblink_exec('holder','begin');
    perform * from extensions.dblink('holder',format('select user_id::text from makeborne_private.credit_wallets where user_id=%L for update',h)) as r(v text);
    perform pg_temp.race('late-settle',conn,format('select public.makeborne_credit_settle(%L,''run-stale'',20)::text',h));
    perform pg_temp.race('late-release',conn,format('select public.makeborne_credit_release(%L,''run-stale'')::text',h));
    perform pg_temp.race('next-run',conn,format('select public.makeborne_credit_reserve(%L,5,''run-next'')::text',h));
    perform pg_temp.race('sweeper',conn,'select public.makeborne_credit_expire_due(100)::text');
    perform pg_sleep(0.5);
    perform extensions.dblink_exec('holder','commit');
    perform extensions.dblink_disconnect('holder');
    res := pg_temp.collect('late-settle'); res2 := pg_temp.collect('late-release');
    assert res like '%Reservation already released%', 'Timed-out hold was settled: '||res;
    assert res2 like 'ok:%' and (substr(res2,4)::jsonb->>'released')::bigint = 0, 'Late release returned credits: '||res2;
    assert pg_temp.collect('next-run') like 'ok:%' and pg_temp.collect('sweeper') like 'ok:%', 'Next run or sweeper failed';
    select * into w from extensions.dblink('admin',format(
      'select (select status from makeborne_private.credit_reservations where user_id=%1$L and reference=''run-stale''),
              (select count(*) from public.credit_ledger where user_id=%1$L and reference=''run-stale'' and kind in (''settle'',''release'')),
              (select coalesce(sum(charged),0) from makeborne_private.credit_hold_lots where user_id=%1$L and reference=''run-stale''),
              (select sum(delta) from public.credit_ledger where user_id=%1$L),
              (public.makeborne_credit_wallet(%1$L)->>''available'')::bigint',h))
      as r(status text, resolutions bigint, charged bigint, ledger bigint, available bigint);
    assert w.status = 'released' and w.resolutions = 1 and w.charged = 0 and w.ledger = 45 and w.available = 45, format('Timeout race wrong: %s', row_to_json(w));
    raise notice 'PASS timeout vs late settle: the hold is reclaimed exactly once and can never also be spent';

    -- D. Settle racing release on a live hold -------------------------------
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_grant(%L,50,''topup'',''topup-f'',''{}'')::text',f)) as r(v text);
    perform * from extensions.dblink('admin',format('select public.makeborne_credit_reserve(%L,30,''run-f'')::text',f)) as r(v text);
    perform pg_temp.race('settler',conn,format('select public.makeborne_credit_settle(%L,''run-f'',20)::text',f));
    perform pg_temp.race('releaser',conn,format('select public.makeborne_credit_release(%L,''run-f'')::text',f));
    res := pg_temp.collect('settler'); res2 := pg_temp.collect('releaser');
    select * into w from extensions.dblink('admin',format(
      'select (select status from makeborne_private.credit_reservations where user_id=%1$L and reference=''run-f''),
              (select count(*) from public.credit_ledger where user_id=%1$L and reference=''run-f'' and kind in (''settle'',''release'')),
              (select sum(delta) from public.credit_ledger where user_id=%1$L),
              (public.makeborne_credit_wallet(%1$L)->>''available'')::bigint',f))
      as r(status text, resolutions bigint, ledger bigint, available bigint);
    assert w.resolutions = 1 and w.ledger = w.available and (
        (w.status = 'settled' and w.available = 30 and res like 'ok:%' and (substr(res2,4)::jsonb->>'released')::bigint = 0)
     or (w.status = 'released' and w.available = 50 and res like '%Reservation already released%')),
      format('Settle/release race wrong: settle=%s release=%s state=%s', res, res2, row_to_json(w));
    raise notice 'PASS settle vs release: exactly one resolution (%), ledger = available', w.status;
  exception when others or assert_failure then   -- assert failures are not caught by OTHERS
    begin perform extensions.dblink_exec('holder','rollback'); exception when others then null; end;
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x <> 'admin';
    perform extensions.dblink_exec('admin',format('delete from auth.users where id in (%L,%L,%L,%L)',a,e,h,f));
    perform extensions.dblink_disconnect('admin');
    raise;
  end;
  perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x <> 'admin';
  perform extensions.dblink_exec('admin',format('delete from auth.users where id in (%L,%L,%L,%L)',a,e,h,f));
  perform extensions.dblink_disconnect('admin');
end $$;
rollback;
