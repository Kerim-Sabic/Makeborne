-- Credit wallet and free-tier checks. LOCAL DATABASE ONLY.
-- Runs in a rolled-back transaction and commits nothing. Concurrency across real
-- sessions (which commits fixtures) is in check-credit-wallets-concurrency.sql,
-- which runs only in an isolated database.
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
  -- Plan credits always carry their allocation end (credit expiry).
  begin perform public.makeborne_credit_grant(a,100,'plan_grant','plan:mem_fixture:undated','{"plan":"create"}'); raise exception 'Undated plan grant accepted';
  exception when sqlstate '22023' then null; end;
  s:=public.makeborne_credit_grant(a,100,'plan_grant','plan:mem_fixture:2026-11-01T00:00:00.000Z','{"plan":"create","expiresAt":"2099-01-01T00:00:00Z"}');
  assert (s->>'granted')::boolean and (s->>'balance')::bigint=150, 'Plan grant failed: '||s;
  s:=public.makeborne_credit_grant(a,100,'plan_grant','plan:mem_fixture:2026-11-01T00:00:00.000Z','{"plan":"create","expiresAt":"2099-01-01T00:00:00Z"}');
  assert not (s->>'granted')::boolean and (s->>'balance')::bigint=150, 'Plan grant repeated';
  begin perform public.makeborne_credit_grant(a,5,'adjust','fixture-no-reason','{}'); raise exception 'Adjustment without a reason accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_credit_grant(a,10,'reserve','x','{}'); raise exception 'Grant accepted reserve kind';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_credit_grant(a,-5,'adjust','x','{}'); raise exception 'Negative grant accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_credit_grant(gen_random_uuid(),5,'topup','x','{}'); raise exception 'Grant to missing account';
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
  -- Settle over the hold: never above the authorised reservation; the excess is recorded, not charged.
  perform public.makeborne_credit_reserve(a,20,'job-3');
  s:=public.makeborne_credit_settle(a,'job-3',500);
  assert (s->>'charged')::bigint=20 and (s->>'balance')::bigint=50 and (s->>'reserved')::bigint=0, 'Over settle wrong: '||s;
  assert (select (metadata->>'shortfall')::bigint from public.credit_ledger where user_id=a and kind='settle' and reference='job-3')=480, 'Shortfall not recorded';
  -- Even with spare available credits, the charge stays within the hold.
  perform public.makeborne_credit_grant(a,100,'adjust','fixture-adjust-1','{"reason":"Transaction fixture goodwill"}');
  perform public.makeborne_credit_reserve(a,10,'job-3b');
  s:=public.makeborne_credit_settle(a,'job-3b',25);
  assert (s->>'charged')::bigint=10 and (s->>'balance')::bigint=140 and (s->>'reserved')::bigint=0, 'Over settle within available wrong: '||s;
  -- Settle without a reservation: nothing was authorised, nothing is charged.
  s:=public.makeborne_credit_settle(a,'direct-1',5);
  assert (s->>'charged')::bigint=0 and (s->>'balance')::bigint=140, 'Direct settle wrong: '||s;
  raise notice 'PASS settle partial, over-hold and replay';

  -- Release returns the hold; replays and late settles are safe.
  perform public.makeborne_credit_reserve(a,25,'job-4');
  assert (public.makeborne_credit_wallet(a)->>'available')::bigint=115, 'Hold not applied';
  s:=public.makeborne_credit_release(a,'job-4');
  assert (s->>'released')::bigint=25 and (s->>'available')::bigint=140, 'Release wrong: '||s;
  s:=public.makeborne_credit_release(a,'job-4');
  assert (s->>'released')::bigint=0 and (s->>'available')::bigint=140, 'Release replay changed wallet';
  assert (public.makeborne_credit_release(a,'never-reserved')->>'released')::bigint=0, 'Unknown release changed wallet';
  begin perform public.makeborne_credit_settle(a,'job-4',5); raise exception 'Settle after release accepted';
  exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_credit_reserve(a,0,'job-zero'); raise exception 'Zero reserve accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS release and replay';

  -- Ledger invariant: deltas sum to available, last balance_after matches.
  select coalesce(sum(delta),0) into n from public.credit_ledger where user_id=a;
  assert n=(public.makeborne_credit_wallet(a)->>'available')::bigint, 'Ledger sum mismatch';
  assert (select balance_after from public.credit_ledger where user_id=a and kind='release' and reference='job-4')=140, 'Release balance_after mismatch';
  assert (select balance_after from public.credit_ledger where user_id=a and kind='settle' and reference='job-3')=50, 'Settle balance_after mismatch';
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

  -- Holds from killed runs expire after 15 minutes.
  perform public.makeborne_credit_grant(b,40,'topup','expiry-fixture','{}'::jsonb);
  perform public.makeborne_credit_reserve(b,60,'dead-run');
  assert (public.makeborne_credit_wallet(b)->>'available')::bigint=30, 'Fresh hold not counted';
  update makeborne_private.credit_reservations set created_at=now()-interval '16 minutes' where user_id=b and reference='dead-run';
  assert (public.makeborne_credit_wallet(b)->>'available')::bigint=90, 'Stale hold still blocks reads';
  s:=public.makeborne_credit_reserve(b,20,'next-run');
  assert (s->>'available')::bigint=70 and (s->>'reserved')::bigint=20, 'Stale hold not released on mutation: '||s;
  assert (select status from makeborne_private.credit_reservations where user_id=b and reference='dead-run')='released', 'Stale reservation not marked released';
  assert exists(select 1 from public.credit_ledger where user_id=b and reference='dead-run' and kind='release' and delta=60 and metadata->>'reason'='hold timeout'), 'Expiry not in ledger';
  begin perform public.makeborne_credit_settle(b,'dead-run',10); raise exception 'Expired hold was settled';
  exception when sqlstate 'PT409' then null; end;
  raise notice 'PASS stale hold expiry';
end $$;
select 'PASS: free tier gate, trial/grant idempotency, reserve MB402, settle partial/capped at hold, release, ledger invariants, admin bypass, RLS' as result;
rollback;
