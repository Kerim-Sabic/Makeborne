-- Plan credit rollover: included credits stay spendable two months after their month ends,
-- older credits are spent first, and long-expired months stay lapsed.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261013130000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); r jsonb; lot_old bigint; lot_new bigint; held_from bigint;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@rollover.example.invalid',now());
  -- Month that ended 3 months ago: past even the rollover, so it lapses at once.
  perform makeborne_private.credit_grant_plan_allocation(u,'mem_roll',now()-interval '4 months',now()-interval '3 months','create',300,null,'{}');
  -- Month that ended 1 month ago: still inside its two-month rollover.
  perform makeborne_private.credit_grant_plan_allocation(u,'mem_roll',now()-interval '2 months',now()-interval '1 month','create',300,null,'{}');
  -- Current month, ending in 10 days.
  r := makeborne_private.credit_grant_plan_allocation(u,'mem_roll',now()-interval '20 days',now()+interval '10 days','create',300,null,'{}');
  assert abs(extract(epoch from ((r->>'expiresAt')::timestamptz - (now()+interval '10 days'+interval '2 months')))) < 1, 'current month expires two months after its end: '||r::text;
  assert makeborne_private.credit_available(u) = 600, 'one rolled-over month plus the current month are spendable, the 3-month-old one is not';
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='plan' and lapsed=amount) = 1, 'the 3-month-old month lapsed';
  assert (select metadata->>'allocationEnd' from makeborne_private.credit_lots where user_id=u and source='plan' order by expires_at desc limit 1) is not null, 'allocation end kept for audit';
  raise notice 'PASS rollover: credits stay spendable for two months after their month ends; older months lapse';

  -- Spending order: the rolled-over (older, sooner-expiring) month is used first.
  select id into lot_old from makeborne_private.credit_lots where user_id=u and source='plan' and lapsed=0 order by expires_at limit 1;
  select id into lot_new from makeborne_private.credit_lots where user_id=u and source='plan' and lapsed=0 order by expires_at desc limit 1;
  perform public.makeborne_credit_reserve(u,50,'rollover-order');
  select hl.lot_id into held_from from makeborne_private.credit_hold_lots hl
    where hl.user_id=u and hl.reference='rollover-order' order by hl.lot_id limit 1;
  assert held_from = lot_old and held_from <> lot_new, 'older credits must be spent first';
  raise notice 'PASS rollover: soonest-expiring (older) credits are spent first';

  -- The one-time extension in the migration never applies twice to a lot.
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and source='plan' and not (metadata ? 'rolloverExtendedAt')) = 0, 'every new plan lot is marked as already extended';
  raise notice 'PASS rollover: new lots are marked extended, so the one-time migration extension cannot re-run on them';
end $$;
do $$
declare u uuid:=gen_random_uuid(); old_end timestamptz:=now()+interval '10 days'; l bigint; r jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@historical-rollover.example.invalid',now());
  -- These are the original grant path/metadata, before the rollover migration.
  r:=public.makeborne_credit_grant(u,300,'plan_grant','historical-live',jsonb_build_object('expiresAt',old_end,'allocationEnd',old_end));
  l:=(r->>'lot')::bigint;
  perform public.makeborne_credit_reserve(u,50,'historical-spend');
  perform public.makeborne_credit_settle(u,'historical-spend',20);
  perform public.makeborne_credit_reserve(u,40,'historical-hold');
  assert makeborne_private.extend_plan_credit_rollover(u)=1;
  assert makeborne_private.extend_plan_credit_rollover(u)=0, 'migration replay must not extend again';
  assert (select spent=20 and held=40 and lapsed=0 and expires_at=old_end+interval '2 months'
    and (metadata->>'expiresAt')::timestamptz=expires_at and (metadata->>'originalExpiresAt')::timestamptz=old_end
    and (metadata->>'allocationEnd')::timestamptz=old_end from makeborne_private.credit_lots where id=l);
  assert makeborne_private.credit_available(u)=240, 'extension must not change available or held quantities';
  r:=public.makeborne_credit_release(u,'historical-hold');
  assert (r->>'released')::integer=40 and makeborne_private.credit_available(u)=280;
  raise notice 'PASS historical rollover: spent/held quantities preserved, release returns to original lot, expiry audit coherent, replay idempotent';

  perform public.makeborne_credit_grant(u,100,'plan_grant','historical-expired',jsonb_build_object('expiresAt',now()-interval '1 second'));
  perform public.makeborne_credit_grant(u,100,'plan_grant','historical-boundary',jsonb_build_object('expiresAt',now()));
  assert makeborne_private.extend_plan_credit_rollover(u)=0, 'expired/boundary credits must not resurrect';
  assert (select count(*) from makeborne_private.credit_lots where user_id=u and lapsed=amount)=2;
  assert (select sum(delta) from public.credit_ledger where user_id=u)=makeborne_private.credit_available(u);
  raise notice 'PASS historical rollover: expired and exact-boundary lots stay lapsed, ledger reconciles';

  perform public.makeborne_credit_reserve(u,40,'rollover-expiry-hold');
  update makeborne_private.credit_lots set expires_at=now()-interval '1 second' where id=l;
  r:=public.makeborne_credit_settle(u,'rollover-expiry-hold',10);
  assert (r->>'charged')::integer=10 and (r->>'returned')::integer=0 and (r->>'lapsed')::integer=30;
  assert makeborne_private.credit_available(u)=0;
  assert (select sum(delta) from public.credit_ledger where user_id=u)=0;
  raise notice 'PASS rolled-over hold: expiry charges only actual usage and lapses the unused hold without resurrection';
end $$;
select 'PASS: plan credit rollover' as result;
rollback;
