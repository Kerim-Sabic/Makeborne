-- Credit wallet and free-tier checks. LOCAL DATABASE ONLY.
-- Part 1 runs in a rolled-back transaction. Part 2 commits short-lived fixtures
-- through dblink to exercise real concurrent sessions, then deletes them.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-credit-wallets.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid();
  anonymous uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
  s jsonb; n bigint; message text;
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    (a,'wallet-a-'||a||'@example.invalid',t,false),(b,'wallet-b-'||b||'@example.invalid',t,false),
    (unconfirmed,'wallet-u-'||unconfirmed||'@example.invalid',null,false),(anonymous,null,null,true),
    (admin_id,'wallet-admin-'||admin_id||'@example.invalid',t,false);
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(admin_id,true,true,'Transaction fixture');
  update makeborne_private.billing_settings set free_tier_enabled=true,trial_credits=50 where singleton;

  -- Free tier creation access.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  assert public.makeborne_creation_access(), 'Confirmed free-tier account denied';
  assert makeborne_private.has_creation_membership(), 'Free tier missing from RLS gate';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',unconfirmed,'role','authenticated')::text,true);
  set local role authenticated;
  assert not public.makeborne_creation_access(), 'Unconfirmed account got free tier';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',anonymous,'role','authenticated','is_anonymous',true)::text,true);
  set local role authenticated;
  assert not public.makeborne_creation_access(), 'Anonymous account got free tier';
  reset role;
  update makeborne_private.billing_settings set free_tier_enabled=false where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  assert not public.makeborne_creation_access(), 'Disabled free tier still grants access';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  set local role authenticated;
  assert public.makeborne_creation_access(), 'Admin lost creation access';
  reset role;
  assert not makeborne_private.has_creation_membership_for_actor(a), 'Worker predicate widened to free tier';
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin perform public.makeborne_creation_access(); raise exception 'Anon called creation access';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS free-tier access gate';

  -- Trial credits: once per account, only while the free tier is on.
  s:=public.makeborne_credit_ensure_trial(a);
  assert (s->>'granted')::boolean is false and s->>'reason'='not_eligible', 'Trial granted while free tier disabled';
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  s:=public.makeborne_credit_ensure_trial(a);
  assert (s->>'granted')::boolean and (s->>'available')::bigint=50, 'Trial not granted: '||s;
  s:=public.makeborne_credit_ensure_trial(a);
  assert not (s->>'granted')::boolean, 'Trial granted twice';
  assert (select count(*) from public.credit_ledger where user_id=a and kind='trial')=1, 'Duplicate trial row';
  assert not (public.makeborne_credit_ensure_trial(unconfirmed)->>'granted')::boolean, 'Unconfirmed trial';
  assert not (public.makeborne_credit_ensure_trial(anonymous)->>'granted')::boolean, 'Anonymous trial';
  assert not exists(select 1 from makeborne_private.credit_wallets where user_id in (unconfirmed,anonymous)), 'Ineligible wallet created';
  raise notice 'PASS trial idempotency and eligibility';

  -- Grant idempotency and validation.
  s:=public.makeborne_credit_grant(a,100,'plan_grant','plan:mem_fixture:2026-11-01T00:00:00.000Z','{"plan":"create"}');
  assert (s->>'granted')::boolean and (s->>'balance')::bigint=150, 'Plan grant failed: '||s;
  s:=public.makeborne_credit_grant(a,100,'plan_grant','plan:mem_fixture:2026-11-01T00:00:00.000Z','{"plan":"create"}');
  assert not (s->>'granted')::boolean and (s->>'balance')::bigint=150, 'Plan grant repeated';
  begin perform public.makeborne_credit_grant(a,10,'reserve','x','{}'); raise exception 'Grant accepted reserve kind';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_credit_grant(a,-5,'adjust','x','{}'); raise exception 'Negative grant accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_credit_grant(gen_random_uuid(),5,'adjust','x','{}'); raise exception 'Grant to missing account';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PASS grant idempotency and validation';

  -- Reserve: atomic availability check, idempotent on reference.
  s:=public.makeborne_credit_reserve(a,120,'job-1');
  assert (s->>'reserved')::bigint=120 and (s->>'available')::bigint=30 and s->>'status'='reserved', 'Reserve failed: '||s;
  s:=public.makeborne_credit_reserve(a,120,'job-1');
  assert (s->>'replayed')::boolean and (s->>'reserved')::bigint=120, 'Reserve replay changed wallet: '||s;
  begin
    perform public.makeborne_credit_reserve(a,31,'job-2');
    raise exception 'Overdraft reserve accepted';
  exception when sqlstate 'MB402' then get stacked diagnostics message=message_text;
    assert message='Insufficient credits', 'Wrong insufficient message: '||message;
  end;
  assert not exists(select 1 from makeborne_private.credit_reservations where user_id=a and reference='job-2'), 'Failed reserve left a hold';
  s:=public.makeborne_credit_reserve(a,30,'job-2b');
  assert (s->>'available')::bigint=0, 'Exact reserve failed';
  perform public.makeborne_credit_release(a,'job-2b');
  raise notice 'PASS reserve, insufficient credits (MB402) and replay';

  -- Settle partial: charge actual, return the rest of the hold.
  s:=public.makeborne_credit_settle(a,'job-1',80);
  assert (s->>'charged')::bigint=80 and (s->>'balance')::bigint=70 and (s->>'reserved')::bigint=0 and (s->>'available')::bigint=70, 'Partial settle wrong: '||s;
  s:=public.makeborne_credit_settle(a,'job-1',80);
  assert (s->>'replayed')::boolean and (s->>'charged')::bigint=80 and (s->>'balance')::bigint=70, 'Settle replay charged again: '||s;
  -- Settle over the hold: capped at hold + available, never negative.
  perform public.makeborne_credit_reserve(a,20,'job-3');
  s:=public.makeborne_credit_settle(a,'job-3',500);
  assert (s->>'charged')::bigint=70 and (s->>'balance')::bigint=0 and (s->>'reserved')::bigint=0, 'Over settle wrong: '||s;
  assert (select (metadata->>'shortfall')::bigint from public.credit_ledger where user_id=a and kind='settle' and reference='job-3')=430, 'Shortfall not recorded';
  -- Over-settle that fits within available credits.
  perform public.makeborne_credit_grant(a,100,'adjust','fixture-adjust-1','{}');
  perform public.makeborne_credit_reserve(a,10,'job-3b');
  s:=public.makeborne_credit_settle(a,'job-3b',25);
  assert (s->>'charged')::bigint=25 and (s->>'balance')::bigint=75 and (s->>'reserved')::bigint=0, 'Over settle within available wrong: '||s;
  -- Settle without a reservation charges available credits only.
  s:=public.makeborne_credit_settle(a,'direct-1',5);
  assert (s->>'charged')::bigint=5 and (s->>'balance')::bigint=70, 'Direct settle wrong: '||s;
  raise notice 'PASS settle partial, over-hold and replay';

  -- Release returns the hold; replays and late settles are safe.
  perform public.makeborne_credit_reserve(a,25,'job-4');
  assert (public.makeborne_credit_wallet(a)->>'available')::bigint=45, 'Hold not applied';
  s:=public.makeborne_credit_release(a,'job-4');
  assert (s->>'released')::bigint=25 and (s->>'available')::bigint=70, 'Release wrong: '||s;
  s:=public.makeborne_credit_release(a,'job-4');
  assert (s->>'released')::bigint=0 and (s->>'available')::bigint=70, 'Release replay changed wallet';
  assert (public.makeborne_credit_release(a,'never-reserved')->>'released')::bigint=0, 'Unknown release changed wallet';
  begin perform public.makeborne_credit_settle(a,'job-4',5); raise exception 'Settle after release accepted';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_credit_reserve(a,0,'job-zero'); raise exception 'Zero reserve accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS release and replay';

  -- Ledger invariant: deltas sum to available, last balance_after matches.
  select coalesce(sum(delta),0) into n from public.credit_ledger where user_id=a;
  assert n=(public.makeborne_credit_wallet(a)->>'available')::bigint, 'Ledger sum mismatch';
  assert (select balance_after from public.credit_ledger where user_id=a and kind='release' and reference='job-4')=70, 'Release balance_after mismatch';
  assert (select balance_after from public.credit_ledger where user_id=a and kind='settle' and reference='job-3')=0, 'Settle balance_after mismatch';
  begin update makeborne_private.credit_wallets set reserved=balance+1 where user_id=a; raise exception 'Wallet allowed reserved > balance';
  exception when check_violation then null; end;
  raise notice 'PASS ledger invariants';

  -- Unlimited (admin) accounts bypass holds and charges.
  s:=public.makeborne_credit_reserve(admin_id,100000,'admin-job');
  assert (s->>'unlimited')::boolean and s->>'status'='waived', 'Admin reserve not waived';
  s:=public.makeborne_credit_settle(admin_id,'admin-job',100000);
  assert (s->>'charged')::bigint=0, 'Admin charged';
  assert (public.makeborne_credit_wallet(admin_id)->>'unlimited')::boolean, 'Admin wallet not unlimited';
  assert not exists(select 1 from public.credit_ledger where user_id=admin_id and kind in ('reserve','settle')), 'Admin ledger entries';
  raise notice 'PASS admin bypass';

  -- RLS and privileges: own ledger only, no browser writes or wallet RPCs.
  perform public.makeborne_credit_ensure_trial(b);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*) from public.credit_ledger where user_id=a)=0, 'User read another ledger';
  assert (select count(*) from public.credit_ledger)=(select count(*) from public.credit_ledger where user_id=b), 'Ledger leaked rows';
  assert (select count(*) from public.credit_ledger where user_id=b)=1, 'Own ledger unavailable';
  s:=public.makeborne_credit_balance();
  assert (s->>'balance')::bigint=50 and (s->>'available')::bigint=50 and (s->>'reserved')::bigint=0, 'Own balance wrong: '||s;
  begin insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values(b,1000,'adjust','spoof',1000); raise exception 'Browser ledger insert';
  exception when insufficient_privilege then null; end;
  begin update public.credit_ledger set delta=1000 where user_id=b; raise exception 'Browser ledger update';
  exception when insufficient_privilege then null; end;
  begin perform 1 from makeborne_private.credit_wallets; raise exception 'Browser wallet read';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_grant(b,1000,'adjust','spoof','{}'); raise exception 'Browser grant';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_reserve(b,1,'spoof'); raise exception 'Browser reserve';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_wallet(a); raise exception 'Browser read another wallet';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_ensure_trial(b); raise exception 'Browser trial';
  exception when insufficient_privilege then null; end;
  begin perform makeborne_private.credit_grant(b,1000,'adjust','spoof','{}'); raise exception 'Browser private grant';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin perform 1 from public.credit_ledger; raise exception 'Anon ledger read';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_balance(); raise exception 'Anon balance';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  assert (public.makeborne_credit_wallet(b)->>'available')::bigint=50, 'Service wallet read failed';
  begin insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values(b,1,'adjust','direct',1); raise exception 'Service bypassed ledger functions';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS RLS and privileges';
end $$;
select 'PASS: free tier gate, trial/grant idempotency, reserve MB402, settle partial/over, release, ledger invariants, admin bypass, RLS' as result;
rollback;

-- Part 2: concurrency sanity across real sessions (dblink, local credentials).
begin;
create extension if not exists dblink with schema extensions;
do $$
declare
  c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); i int; ok int:=0; insufficient int:=0;
  -- Loopback is trust-authenticated; dblink needs a password-authenticated path.
  conn text:='host=supabase_db_makeborne-local port=5432 dbname=postgres user=postgres password=postgres';
  w record; err text;
begin
  perform extensions.dblink_connect('holder',conn);
  perform extensions.dblink_exec('holder',format(
    'insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(%L,%L,now(),false),(%L,%L,now(),false)',
    c,'wallet-conc-'||c||'@example.invalid',d,'wallet-conc-'||d||'@example.invalid'));
  begin
    perform * from extensions.dblink('holder',format('select public.makeborne_credit_grant(%L,100,%L,%L,%L)::text',c,'adjust','conc-seed','{}')) as r(v text);
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
  exception when others then
    begin perform extensions.dblink_exec('holder','rollback'); exception when others then null; end;
    perform extensions.dblink_disconnect(x) from unnest(extensions.dblink_get_connections()) x where x<>'holder';
    perform extensions.dblink_exec('holder',format('delete from auth.users where id in (%L,%L)',c,d));
    perform extensions.dblink_disconnect('holder');
    raise;
  end;
  perform extensions.dblink_exec('holder',format('delete from auth.users where id in (%L,%L)',c,d));
  perform extensions.dblink_disconnect('holder');
  raise notice 'PASS concurrency: 6 racing reserves of 30 on 100 credits -> 3 ok, 3 MB402; 4 racing trials -> 1 grant';
end $$;
select 'PASS: concurrent reserve and trial serialization' as result;
rollback;
