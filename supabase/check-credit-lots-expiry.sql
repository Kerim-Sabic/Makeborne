-- Credit lots and expiry: the real SQL lifecycle. LOCAL DATABASE; one rolled-back
-- transaction, commits nothing. now() is fixed inside a transaction, so time passing
-- is simulated by moving a lot's expires_at or a hold's created_at.
-- Concurrency across real sessions is in check-credit-lots-concurrency.sql (isolated database only).
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-credit-lots-expiry.sql
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';

create function pg_temp.lot(u uuid, ref text) returns makeborne_private.credit_lots
language sql as $$ select * from makeborne_private.credit_lots where user_id = u and reference = ref $$;
create function pg_temp.wallet(u uuid) returns jsonb
language sql as $$ select makeborne_private.credit_wallet(u) $$;
create function pg_temp.avail(u uuid) returns bigint
language sql as $$ select (makeborne_private.credit_wallet(u)->>'available')::bigint $$;
-- Ledger invariant: the sum of deltas equals available credits (holds in effect).
create function pg_temp.ledger_ok(u uuid) returns boolean
language sql as $$ select coalesce((select sum(delta) from public.credit_ledger where user_id = u),0) = (makeborne_private.credit_wallet(u)->>'available')::bigint $$;
create function pg_temp.plan(u uuid, ref text, amount bigint, ends timestamptz) returns jsonb
language sql as $$ select public.makeborne_credit_grant(u, amount, 'plan_grant', ref, jsonb_build_object('expiresAt', ends)) $$;
create function pg_temp.user_() returns uuid
language plpgsql as $$ declare u uuid := gen_random_uuid(); begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@lots.example.invalid',now()); return u; end $$;

do $$
declare
  t timestamptz := now(); u uuid; s jsonb; n bigint; msg text;
begin
  -- 1. Spending order and traceability -----------------------------------------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:late',40,t + interval '20 days');
  perform pg_temp.plan(u,'plan:soon',30,t + interval '10 days');
  perform public.makeborne_credit_grant(u,25,'adjust','goodwill-1','{"reason":"Support goodwill after an outage"}');
  perform public.makeborne_credit_grant(u,20,'topup','topup-1','{}');
  perform public.makeborne_credit_grant(u,10,'trial','trial','{}');
  perform public.makeborne_credit_grant(u,5,'refund','refund-1','{}');
  s := pg_temp.wallet(u);
  assert (s->>'available')::bigint = 130 and (s->'nextExpiry'->>'credits')::bigint = 30
    and (s->'nextExpiry'->>'at')::timestamptz = t + interval '10 days', 'Totals/next expiry wrong: '||s::text;
  assert (pg_temp.lot(u,'goodwill-1')).expires_at is null and (pg_temp.lot(u,'goodwill-1')).metadata->>'reason' = 'Support goodwill after an outage'
    and exists(select 1 from public.credit_ledger where user_id = u and kind = 'adjust' and metadata->>'reason' is not null), 'Adjustment not audited';
  s := public.makeborne_credit_reserve(u,100,'run-1');
  assert (select string_agg(x->>'source'||':'||(x->>'credits'), ',' order by o) from public.credit_ledger,
      jsonb_array_elements(metadata->'lots') with ordinality as e(x,o) where user_id = u and kind = 'reserve' and reference = 'run-1')
    = 'plan:30,plan:40,trial:10,topup:20', 'Hold not funded soonest-expiring first, then trial, top-up';
  assert (select count(*) from makeborne_private.credit_hold_lots where user_id = u and reference = 'run-1') = 4, 'Hold allocations not recorded';
  s := public.makeborne_credit_settle(u,'run-1',70);
  assert (s->>'charged')::bigint = 70 and (s->>'returned')::bigint = 30 and (s->>'available')::bigint = 60, 'Settle wrong: '||s::text;
  assert (pg_temp.lot(u,'plan:soon')).spent = 30 and (pg_temp.lot(u,'plan:late')).spent = 40
    and (pg_temp.lot(u,'trial')).spent = 0 and (pg_temp.lot(u,'trial')).held = 0 and (pg_temp.lot(u,'topup-1')).spent = 0,
    'Usage not charged soonest-expiring first, or unspent credit not returned to its own lot';
  assert pg_temp.wallet(u)->'nextExpiry' = 'null'::jsonb, 'Spent plan credits still reported as expiring';
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (order)';
  raise notice 'PASS spend order: soonest-expiring plan credits, then trial, top-up, adjustment, refund; every hold records its lots';

  -- 2. Expiry boundary: expired AT the timestamp -------------------------------
  u := pg_temp.user_();
  s := pg_temp.plan(u,'plan:at-now',40,t);
  assert (s->>'granted')::boolean and (s->>'available')::bigint = 0, 'Allocation ending now was spendable: '||s::text;
  assert (pg_temp.lot(u,'plan:at-now')).lapsed = 40
    and exists(select 1 from public.credit_ledger where user_id = u and kind = 'expire' and delta = -40), 'Expired allocation not lapsed in the same transaction';
  perform pg_temp.plan(u,'plan:just-after',50,clock_timestamp() + interval '1 hour');
  assert pg_temp.avail(u) = 50, 'Allocation ending later not spendable';
  begin perform public.makeborne_credit_reserve(u,51,'too-much'); raise exception 'Reserved expired credits';
  exception when sqlstate 'MB402' then null; end;
  -- The end instant arrives: exactly at it, the allocation is expired.
  update makeborne_private.credit_lots set expires_at = makeborne_private.credit_clock() where user_id = u and reference = 'plan:just-after';
  assert pg_temp.avail(u) = 0 and (pg_temp.wallet(u)->>'balance')::bigint = 0, 'Reads count credits at their expiry instant';
  update makeborne_private.credit_lots set expires_at = makeborne_private.credit_clock() + interval '1 microsecond' where user_id = u and reference = 'plan:just-after';
  assert pg_temp.avail(u) = 50, 'Credits expired before their end instant';
  update makeborne_private.credit_lots set expires_at = makeborne_private.credit_clock() where user_id = u and reference = 'plan:just-after';
  s := public.makeborne_credit_expire_due(5000);
  assert (pg_temp.lot(u,'plan:just-after')).lapsed = 50 and pg_temp.ledger_ok(u), 'Due expiry not recorded';
  n := (select count(*) from public.credit_ledger where user_id = u and kind = 'expire');
  perform public.makeborne_credit_expire_due(5000);
  assert (select count(*) from public.credit_ledger where user_id = u and kind = 'expire') = n, 'Expiry recorded twice';
  raise notice 'PASS expiry boundary: expired at the end instant, exact on reads, recorded once';

  -- 3. Allocation expires while held; partial settlement (late settle) ---------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:h',60,t + interval '1 day');
  perform public.makeborne_credit_grant(u,20,'topup','topup-h','{}');
  perform public.makeborne_credit_reserve(u,70,'run-h');                       -- plan 60 + top-up 10
  update makeborne_private.credit_lots set expires_at = t - interval '1 second' where user_id = u and reference = 'plan:h';
  s := pg_temp.wallet(u);
  assert (s->>'available')::bigint = 10 and (s->>'reserved')::bigint = 70, 'Hold on an expired lot not kept for its run: '||s::text;
  s := public.makeborne_credit_settle(u,'run-h',50);
  assert (s->>'charged')::bigint = 50 and (s->>'returned')::bigint = 10 and (s->>'lapsed')::bigint = 10 and (s->>'available')::bigint = 20,
    'Late settle wrong: '||s::text;
  assert (pg_temp.lot(u,'plan:h')).spent = 50 and (pg_temp.lot(u,'plan:h')).lapsed = 10 and (pg_temp.lot(u,'plan:h')).held = 0
    and (pg_temp.lot(u,'topup-h')).spent = 0, 'Late settle did not charge the expiring lot first or did not lapse its remainder';
  assert exists(select 1 from public.credit_ledger where user_id = u and kind = 'expire' and reference = 'hold:run-h' and delta = 0
    and (metadata->>'lapsedFromHold')::bigint = 10), 'Lapse from hold not audited';
  s := public.makeborne_credit_settle(u,'run-h',500);
  assert (s->>'replayed')::boolean and (s->>'charged')::bigint = 50, 'Settle retry charged again';
  perform public.makeborne_credit_reserve(u,5,'run-h2');
  s := public.makeborne_credit_settle(u,'run-h2',999);
  assert (s->>'charged')::bigint = 5 and (select (metadata->>'shortfall')::bigint from public.credit_ledger where user_id = u and kind = 'settle' and reference = 'run-h2') = 994,
    'Charged above the reservation';
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (late settle)';
  raise notice 'PASS held allocation expiring mid-run: usage charged within the hold, unspent expired credits lapse, retries idempotent, never above the hold';

  -- 4. Returns after cancelled generation keep source and expiry ---------------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:r',40,t + interval '1 day');
  perform public.makeborne_credit_grant(u,15,'trial','trial','{}');
  perform public.makeborne_credit_reserve(u,50,'run-r1');
  s := public.makeborne_credit_release(u,'run-r1');
  assert (s->>'released')::bigint = 50 and (pg_temp.lot(u,'plan:r')).held = 0 and (pg_temp.lot(u,'plan:r')).expires_at = t + interval '1 day'
    and (select count(*) from makeborne_private.credit_lots where user_id = u) = 2
    and (select sum(returned) from makeborne_private.credit_hold_lots where user_id = u and reference = 'run-r1') = 50,
    'Release did not return credits to their original lots';
  perform public.makeborne_credit_reserve(u,50,'run-r2');
  update makeborne_private.credit_lots set expires_at = t - interval '1 second' where user_id = u and reference = 'plan:r';
  s := public.makeborne_credit_release(u,'run-r2');
  assert (s->>'released')::bigint = 10 and (s->>'lapsed')::bigint = 40 and (s->>'available')::bigint = 15, 'Expired release wrong: '||s::text;
  assert (select count(*) from makeborne_private.credit_lots where user_id = u) = 2 and (pg_temp.lot(u,'trial')).amount = 15
    and (pg_temp.lot(u,'plan:r')).lapsed = 40, 'Expired credits became non-expiring through a release';
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (release)';
  raise notice 'PASS returns: valid credits go back to their own lot and expiry; expired credits lapse, never re-issued';

  -- 5. Hold timeout (interrupted build) and late settlement --------------------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:t',30,t + interval '1 day');
  perform public.makeborne_credit_grant(u,30,'topup','topup-t','{}');
  perform public.makeborne_credit_reserve(u,40,'run-dead');                   -- plan 30 + top-up 10
  update makeborne_private.credit_reservations set created_at = t - interval '16 minutes' where user_id = u and reference = 'run-dead';
  assert pg_temp.avail(u) = 60, 'Timed-out hold still blocks valid credits on reads';
  s := public.makeborne_credit_reserve(u,50,'run-next');
  assert (s->>'available')::bigint = 10 and (s->>'reserved')::bigint = 50, 'Timed-out hold not reclaimed: '||s::text;
  assert (select status from makeborne_private.credit_reservations where user_id = u and reference = 'run-dead') = 'released'
    and exists(select 1 from public.credit_ledger where user_id = u and kind = 'release' and reference = 'run-dead' and metadata->>'reason' = 'hold timeout'),
    'Timeout not recorded';
  begin perform public.makeborne_credit_settle(u,'run-dead',10); raise exception 'Reclaimed hold was spent';
  exception when sqlstate 'PT409' then null; end;
  assert (public.makeborne_credit_release(u,'run-dead')->>'released')::bigint = 0, 'Late release returned credits twice';
  -- A timed-out hold whose allocation has also ended: nothing comes back.
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:x',25,t + interval '1 day');
  perform public.makeborne_credit_reserve(u,25,'run-x');
  update makeborne_private.credit_reservations set created_at = t - interval '16 minutes' where user_id = u and reference = 'run-x';
  update makeborne_private.credit_lots set expires_at = t - interval '1 second' where user_id = u and reference = 'plan:x';
  s := pg_temp.wallet(u);
  assert (s->>'available')::bigint = 0 and (s->>'reserved')::bigint = 0 and (s->>'balance')::bigint = 0, 'Expired timed-out hold readable: '||s::text;
  perform public.makeborne_credit_expire_due(5000);
  assert (pg_temp.lot(u,'plan:x')).lapsed = 25 and (pg_temp.lot(u,'plan:x')).held = 0
    and (select status from makeborne_private.credit_reservations where user_id = u and reference = 'run-x') = 'released', 'Expired timed-out hold not lapsed';
  begin perform public.makeborne_credit_settle(u,'run-x',10); raise exception 'Reclaimed expired hold was spent';
  exception when sqlstate 'PT409' then null; end;
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (timeout)';
  raise notice 'PASS hold timeout: reclaimed after 15 minutes (valid parts back, expired parts lapse); a reclaimed hold can never be settled';

  -- 6. Insufficient funds: expired credits never count -------------------------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:gone',100,t - interval '1 day');
  perform public.makeborne_credit_grant(u,10,'trial','trial','{}');
  begin perform public.makeborne_credit_reserve(u,11,'run-big'); raise exception 'Reserved beyond valid credits';
  exception when sqlstate 'MB402' then get stacked diagnostics msg = pg_exception_detail;
    assert msg = 'available=10 required=11', 'Wrong MB402 detail: '||msg;
  end;
  assert not exists(select 1 from makeborne_private.credit_reservations where user_id = u), 'Failed reserve left a hold';
  assert (public.makeborne_credit_reserve(u,10,'run-ok')->>'status') = 'reserved', 'Exact reserve refused';
  raise notice 'PASS insufficient funds (MB402) counts only valid credits';

  -- 7. Plan allocations: upgrade top-up and late catch-up ----------------------
  u := pg_temp.user_();
  declare ps timestamptz := date_trunc('second', t) - interval '100 days'; pe timestamptz; a4 timestamptz; begin
    pe := ps + interval '1 year'; a4 := ps + interval '4 months';
    insert into makeborne_private.plan_periods(membership_id,period_start,period_end,user_id,billing_interval) values('mem_lots',ps,pe,u,'yearly');
    insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome)
    values('mem_lots',u,ps + interval '5 seconds','fixture','active',true,'plan_fixture','create','yearly',300,'recorded');
    perform makeborne_private.reconcile_plan_membership('mem_lots', t);
    -- Two-month rollover (20261013130000): month 1 ended ~70 days ago and is past its rollover, so it lapses
    -- in the same transaction; months 2-3 are still inside their rollover; month 4 is current. The soonest
    -- expiry is month 2's end plus two months, which is ps + 4 months.
    assert (select count(*) from makeborne_private.credit_lots where user_id = u and source = 'plan') = 4
      and (select count(*) from makeborne_private.credit_lots where user_id = u and source = 'plan' and lapsed = amount) = 1
      and pg_temp.avail(u) = 900 and (pg_temp.wallet(u)->'nextExpiry'->>'at')::timestamptz = a4, 'Late catch-up wrong: '||pg_temp.wallet(u)::text;
    assert (select balance_after from public.credit_ledger where user_id = u and kind = 'plan_grant'
      and reference like 'plan:mem_lots:'||to_char(ps,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':%') = 0, 'An already-expired allocation was briefly spendable';
    assert (select count(*) from public.credit_ledger where user_id = u and kind = 'expire' and delta = -300) = 1, 'Lapses not in the ledger';
    assert not exists(select 1 from makeborne_private.credit_lots l where l.user_id = u and l.source = 'plan'
      and l.expires_at <> (l.metadata->>'allocationEnd')::timestamptz + interval '2 months'), 'Lot expiry is not its allocation end plus the two-month rollover';
    -- Upgrade evidenced late inside month 2 (past) and an upgrade inside month 4 (current).
    insert into makeborne_private.plan_observations(membership_id,user_id,observed_at,source,status,paid,whop_plan_id,tier,billing_interval,monthly_credits,outcome)
    values('mem_lots',u,ps + interval '1 month 10 days','fixture','active',true,'plan_fixture','studio','yearly',850,'recorded'),
          ('mem_lots',u,t - interval '1 hour','fixture','active',true,'plan_fixture','scale','yearly',2200,'recorded');
    perform makeborne_private.reconcile_plan_membership('mem_lots', t);
    assert (select array_agg(l.amount order by l.expires_at, l.id) from makeborne_private.credit_lots l where l.user_id = u and l.source = 'plan')
      = array[300,300,550,300,550,300,1900]::bigint[], 'Top-ups wrong: '||(select array_agg(l.amount order by l.expires_at, l.id) from makeborne_private.credit_lots l where l.user_id = u and l.source = 'plan')::text;
    assert (select count(distinct expires_at) from makeborne_private.credit_lots where user_id = u and source = 'plan') = 4
      and (select expires_at from makeborne_private.credit_lots where user_id = u and source = 'plan' and amount = 1900) = a4 + interval '2 months',
      'Top-up does not expire with its allocation month';
    -- With the two-month rollover: month 1 lapsed; months 2-3 (850 each) and month 4 (2,200) are spendable.
    assert pg_temp.avail(u) = 3900 and (select count(*) from makeborne_private.credit_lots where user_id = u and source = 'plan' and lapsed = amount) = 1,
      'Rolled-over top-ups wrong: '||pg_temp.wallet(u)::text;
    perform makeborne_private.reconcile_plan_membership('mem_lots', t);
    assert (select count(*) from makeborne_private.credit_lots where user_id = u) = 7, 'Reconcile retry granted again';
  end;
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (plan)';
  raise notice 'PASS plan allocations: late catch-up honours the two-month rollover, top-ups expire with their month, retries idempotent';

  -- 8. Legacy migration of existing balances and holds -------------------------
  u := pg_temp.user_();
  insert into makeborne_private.credit_wallets(user_id,balance,reserved) values(u,120,40);
  insert into makeborne_private.credit_reservations(user_id,reference,amount,created_at) values(u,'old-live',30,t - interval '1 minute'),(u,'old-stale',10,t - interval '20 minutes');
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values(u,120,'adjust','old-grant',120),(u,-30,'reserve','old-live',90),(u,-10,'reserve','old-stale',80);
  s := makeborne_private.migrate_wallet_to_lots(u);
  assert (select row(balance_before,reserved_before,available_before,balance_after,reserved_after,available_after,holds_migrated)::text
    from makeborne_private.credit_lot_migration where user_id = u) = '(120,30,90,120,30,90,2)', 'Migration audit wrong';
  assert (pg_temp.lot(u,'legacy:pre-lots')).amount = 120 and (pg_temp.lot(u,'legacy:pre-lots')).held = 40
    and (pg_temp.lot(u,'legacy:pre-lots')).expires_at is null, 'Legacy lot wrong';
  begin perform makeborne_private.migrate_wallet_to_lots(u); raise exception 'Migrated twice';
  exception when sqlstate 'MB409' then null; end;
  perform public.makeborne_credit_grant(u,10,'topup','topup-after','{}');
  s := public.makeborne_credit_settle(u,'old-live',20);                    -- the top-up grant above reclaimed the stale hold
  assert (s->>'charged')::bigint = 20 and (s->>'available')::bigint = 110, 'Legacy hold settle wrong: '||s::text;
  perform public.makeborne_credit_reserve(u,15,'after-migration');
  assert (select string_agg(x->>'source'||':'||(x->>'credits'), ',' order by o) from public.credit_ledger,
      jsonb_array_elements(metadata->'lots') with ordinality as e(x,o) where user_id = u and kind = 'reserve' and reference = 'after-migration')
    = 'topup:10,legacy:5', 'Legacy credits not spent last';
  assert pg_temp.ledger_ok(u), 'Ledger out of balance (legacy)';
  u := pg_temp.user_();
  insert into makeborne_private.credit_wallets(user_id,balance,reserved) values(u,50,5);
  begin perform makeborne_private.migrate_wallet_to_lots(u); raise exception 'Inconsistent wallet migrated';
  exception when sqlstate 'MB409' then null; end;
  delete from makeborne_private.credit_wallets where user_id = u;
  -- The real migration: every wallet that existed reconciled exactly.
  assert not exists(select 1 from makeborne_private.credit_lot_migration
    where balance_before <> balance_after or reserved_before <> reserved_after or available_before <> available_after), 'A migrated wallet changed';
  assert not exists(select 1 from makeborne_private.credit_wallets w where not exists(select 1 from makeborne_private.credit_lot_migration m where m.user_id = w.user_id)
    and not exists(select 1 from makeborne_private.credit_lots l where l.user_id = w.user_id) and w.balance > 0), 'A wallet balance has no lot';
  raise notice 'PASS legacy migration: audited non-expiring lot funds existing holds, reconciles exactly, refuses mismatches and repeats, spent last';

  -- 9. Reads and privileges ----------------------------------------------------
  u := pg_temp.user_();
  perform pg_temp.plan(u,'plan:read',70,t + interval '3 days');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  s := public.makeborne_credit_balance();
  assert (s->>'available')::bigint = 70 and (s->'nextExpiry'->>'credits')::bigint = 70, 'Own balance/expiry wrong: '||s::text;
  begin perform 1 from makeborne_private.credit_lots; raise exception 'Browser read lots';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_credit_expire_due(10); raise exception 'Browser ran expiry';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  begin perform 1 from makeborne_private.credit_lots; raise exception 'Service read lots directly';
  exception when insufficient_privilege then null; end;
  perform public.makeborne_credit_expire_due(10);
  reset role;
  perform set_config('request.jwt.claims','{}',true);
  raise notice 'PASS reads and privileges: own balance with next expiry; lots private; expiry job service-only';
end $$;
select 'PASS: credit lots lifecycle (order, boundary, held expiry, returns, timeout, MB402, plan top-ups/catch-up, legacy migration, privileges)' as result;
rollback;
