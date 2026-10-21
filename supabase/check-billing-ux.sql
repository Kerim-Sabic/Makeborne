-- Local, disposable database only (chain including 20261020110000). Every fixture rolls back.
-- Usage history (audit F08): caller scope, mapping, reversals, unknown charges,
-- period totals and keyset pagination, reconciled against the wallet tables.
-- Payment withhold/restore ledger rows are inserted directly in their production
-- reference format, so this check does not depend on 20261020090000.
\set ON_ERROR_STOP on
begin;
do $$begin if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal required';end if;end$$;
set local timezone = 'UTC';
do $$ begin
  if to_regprocedure('public.makeborne_usage_history(timestamptz,timestamptz,timestamptz,text,integer)') is null then
    raise exception 'Refusing: migration 20261020110000 is not applied to this database';
  end if;
end $$;

create temporary table usage_fixture(key text primary key, value text) on commit drop;
grant all on usage_fixture to authenticated;

do $$
declare u uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  hash text := repeat('b', 64); op uuid; run uuid; ref text; x record;
begin
  insert into auth.users(id, email, email_confirmed_at) values (u, u || '@usage.example.invalid', now()), (other, other || '@usage.example.invalid', now());
  insert into usage_fixture values ('u', u::text), ('other', other::text), ('w2', w2::text);
  insert into public.workspaces(id, name, owner_id) values (w, 'Usage fixture', u), (w2, 'Shared fixture', other);
  insert into public.workspace_members(workspace_id, user_id, role) values (w2, u, 'editor');
  insert into public.projects(id, workspace_id, title, kind) values (p, w, 'Field guide', 'website'), (p3, w, 'Old draft', 'book'), (p2, w2, 'Shared brochure', 'presentation');
  insert into public.artifacts(id, workspace_id, project_id, title, kind) values (a, w, p, 'Field guide', 'website'), (a3, w, p3, 'Old draft', 'book'), (a2, w2, p2, 'Shared brochure', 'presentation');
  -- Funding (a grant: not usage, never listed).
  perform makeborne_private.credit_grant(u, 500, 'adjust', 'usage-fixture', jsonb_build_object('reason', 'disposable fixture credits'));
  perform makeborne_private.credit_grant(other, 100, 'adjust', 'usage-fixture', jsonb_build_object('reason', 'disposable fixture credits'));
  -- Three project builds: owned (stays visible), shared (access later removed), deleted with its project.
  for x in select * from (values (a, w, 'build', 50, 12, 'own'), (a2, w2, 'review', 30, 30, 'shared'), (a3, w, 'build', 20, 7, 'deleted')) v(artifact, workspace, kind, held, charge, label) loop
    op := gen_random_uuid(); run := gen_random_uuid(); ref := 'operation:' || run;
    insert into makeborne_private.ai_operations(id, actor, workspace_id, artifact_id, action_key, kind, effort, input_hash, initial_version, last_version, initial_cap, authorized_credits, rate_microusd)
    values (op, u, x.workspace, x.artifact, gen_random_uuid(), case when x.kind = 'review' then 'review' else 'build' end, 'medium', hash, 0, 0, x.held, x.held, 30000);
    perform makeborne_private.credit_reserve(u, x.held, ref);
    insert into makeborne_private.ai_operation_runs(id, operation_id, step_key, input_hash, kind, expected_version, stage_cap, allocated_credits, reference, exempt, expires_at, status)
    values (run, op, gen_random_uuid(), hash, x.kind, 0, x.held, x.held, ref, false, now() + interval '15 minutes', 'finished');
    perform makeborne_private.credit_settle(u, ref, x.charge);
    insert into usage_fixture values ('hold:' || x.label, 'hold:' || md5(ref));
  end loop;
  -- Released without a charge, an unmapped charge, a live hold, a credit refund.
  perform makeborne_private.credit_reserve(u, 10, 'brief_questions:' || gen_random_uuid());
  select reference into ref from makeborne_private.credit_reservations where user_id = u and reference like 'brief_questions:%';
  perform makeborne_private.credit_release(u, ref);
  perform makeborne_private.credit_reserve(u, 5, 'mystery:fixture'); perform makeborne_private.credit_settle(u, 'mystery:fixture', 5);
  insert into usage_fixture values ('hold:unknown', 'hold:' || md5('mystery:fixture'));
  perform makeborne_private.credit_grant(u, 6, 'refund', 'refund:fixture', '{}'::jsonb);
  perform makeborne_private.credit_reserve(u, 8, 'chat:rex:' || gen_random_uuid());
  -- Payment-review reversals in their production reference formats (20261020090000 / 20261013110000).
  insert into public.credit_ledger(user_id, delta, kind, reference, balance_after, metadata) values
    (u, -40, 'adjust', 'payment:pay_usageOne:withhold:1', 0, jsonb_build_object('payment', 'pay_usageOne', 'reason', 'disputed')),
    (u, 40, 'adjust', 'payment:pay_usageOne:restore:1', 0, jsonb_build_object('payment', 'pay_usageOne', 'reason', 'Dispute resolved in the merchant''s favour')),
    (u, -15, 'adjust', 'credit_topup:pay_usageTwo:withhold:2', 0, jsonb_build_object('reason', 'reversed'));
  -- Another account's activity must never appear.
  perform makeborne_private.credit_reserve(other, 9, 'mystery:other'); perform makeborne_private.credit_settle(other, 'mystery:other', 9);
  -- Last: a dead run's hold (older than 15 minutes, not yet reclaimed by a wallet write).
  perform makeborne_private.credit_reserve(u, 4, 'lead_find:' || gen_random_uuid());
  update makeborne_private.credit_reservations set created_at = now() - interval '20 minutes' where user_id = u and reference like 'lead_find:%';
  -- The shared workspace no longer includes the caller; the old draft project is deleted (its operation and run cascade).
  delete from public.workspace_members where workspace_id = w2 and user_id = u;
  delete from public.projects where id = p3;
end $$;

-- A: grants and scope.
do $$
declare f constant text := 'public.makeborne_usage_history(timestamptz,timestamptz,timestamptz,text,integer)';
  core constant text := 'makeborne_rpc.makeborne_usage_history(timestamptz,timestamptz,timestamptz,text,integer)';
begin
  assert has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute'), 'wrapper grants';
  assert has_function_privilege('authenticated', core, 'execute') and not has_function_privilege('anon', core, 'execute') and not has_function_privilege('service_role', core, 'execute'), 'core grants';
  assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = core::regprocedure), 'core is security definer with an empty search_path';
  assert (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = f::regprocedure), 'wrapper is security invoker with an empty search_path';
  assert (select pronargs = 5 and not ('p_user' = any(proargnames)) from pg_proc where oid = f::regprocedure), 'no caller-supplied account id';
  raise notice 'PASS usage A: authenticated only; definer core with fixed search_path; no account parameter';
end $$;

-- B: the account's own complete period reconciles with the wallet tables.
do $$
declare u uuid := (select value::uuid from usage_fixture where key = 'u'); r jsonb; e jsonb; v_charged numeric := 0; wallet jsonb;
  s timestamptz := date_trunc('month', now()); n timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  wallet := makeborne_private.credit_wallet(u);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_usage_history(s, n, null, null, 100);
  reset role;
  assert (r->'period'->>'total')::int = 11 and jsonb_array_length(r->'entries') = 11, 'all 11 usage events, no grants: ' || (r->'period'->>'total');
  assert not (r->'period'->>'hasMore')::boolean and (r->'period'->>'newer')::int = 0, 'complete single page';
  for e in select * from jsonb_array_elements(r->'entries') loop
    if e->>'status' = 'Charged' then v_charged := v_charged + (e->>'credits')::numeric; end if;
  end loop;
  assert (r->'period'->>'used')::numeric = 54 and v_charged = 54, 'used = settled charges (12+30+7+5): ' || (r->'period'->>'used');
  assert (select sum(charged) from makeborne_private.credit_reservations where user_id = u and status = 'settled') = 54, 'reservation ledger';
  assert (select sum(spent) from makeborne_private.credit_lots where user_id = u) = 54, 'lot spend';
  assert r->'wallet'->>'available' = (wallet->>'available') and r->'wallet'->>'reserved' = (wallet->>'reserved') and r->'wallet'->>'reserved' = '8', 'wallet from the authoritative totals: ' || (r->'wallet');
  assert r::text !~ '(operation|mystery|brief_questions|lead_find|chat):', 'raw references are not returned';
  assert r::text !~ 'pay_usage' , 'payment ids are not returned';
  raise notice 'PASS usage B: 11 events; Charged rows sum to used = 54 = settled reservations = lot spend; wallet matches';
end $$;

-- C: mapping, reversals and unknown charges are explicit rows.
do $$
declare u uuid := (select value::uuid from usage_fixture where key = 'u'); r jsonb;
  s timestamptz := date_trunc('month', now()); n timestamptz := date_trunc('month', now()) + interval '1 month';
  function_row jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_usage_history(s, n, null, null, 100);
  reset role;
  select e into function_row from jsonb_array_elements(r->'entries') e where e->>'id' = (select value from usage_fixture where key = 'hold:own');
  assert function_row->>'status' = 'Charged' and function_row->>'credits' = '12' and function_row->>'held' = '50' and function_row->>'projectTitle' = 'Field guide'
    and function_row->>'projectState' = 'visible' and function_row->>'format' = 'website' and function_row->>'runKind' = 'build', 'own build ' || function_row;
  select e into function_row from jsonb_array_elements(r->'entries') e where e->>'id' = (select value from usage_fixture where key = 'hold:shared');
  assert function_row->>'projectState' = 'hidden' and not function_row ? 'projectTitle' and function_row->>'credits' = '30', 'revoked workspace hides its title ' || function_row;
  select e into function_row from jsonb_array_elements(r->'entries') e where e->>'id' = (select value from usage_fixture where key = 'hold:deleted');
  assert function_row->>'projectState' = 'deleted' and function_row->>'source' = 'operation' and function_row->>'credits' = '7', 'deleted project kept ' || function_row;
  select e into function_row from jsonb_array_elements(r->'entries') e where e->>'id' = (select value from usage_fixture where key = 'hold:unknown');
  assert function_row->>'source' = 'unknown' and function_row->>'status' = 'Charged' and function_row->>'credits' = '5', 'unknown charge kept ' || function_row;
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'brief_questions' and e->>'status' = 'Released' and e->>'credits' = '10'), 'released hold';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'chat' and e->>'expert' = 'rex' and e->>'status' = 'Reserved' and e->>'credits' = '8'), 'live hold';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'lead_find' and e->>'status' = 'Released' and e->>'reason' = 'hold timeout' and e->>'credits' = '4'), 'timed-out hold';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'refund' and e->>'status' = 'Refunded' and e->>'credits' = '6'), 'credit refund';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'payment' and e->>'status' = 'Withheld' and e->>'reason' = 'disputed' and e->>'credits' = '40'), 'withheld';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'source' = 'payment' and e->>'status' = 'Restored' and e->>'credits' = '40'), 'restored';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'paymentKind' = 'credit_pack' and e->>'status' = 'Withheld' and e->>'reason' = 'reversed' and e->>'credits' = '15'), 'pack withhold';
  raise notice 'PASS usage C: projects visible/hidden/deleted, unknown charge, release, timeout, refund and payment reversals are separate rows';
end $$;

-- D: keyset pagination is complete, stable and non-overlapping; a timed-out hold keeps its place after reclaim.
do $$
declare u uuid := (select value::uuid from usage_fixture where key = 'u'); r jsonb; last jsonb; seen text[] := '{}'; pages int := 0; at_ timestamptz; id_ text; before_reclaim text; after_reclaim text;
  s timestamptz := date_trunc('month', now()); n timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  loop
    r := public.makeborne_usage_history(s, n, at_, id_, 4);
    assert (r->'period'->>'newer')::int = cardinality(seen), 'newer counts the rows already shown';
    assert (r->'period'->>'total')::int = 11 and (r->'period'->>'used') = '54', 'period totals do not depend on the page';
    seen := seen || array(select e->>'id' from jsonb_array_elements(r->'entries') e);
    pages := pages + 1;
    exit when not (r->'period'->>'hasMore')::boolean;
    last := r->'entries'->-1; at_ := (last->>'occurredAt')::timestamptz; id_ := last->>'id';
  end loop;
  assert pages = 3 and cardinality(seen) = 11 and (select count(distinct x) from unnest(seen) x) = 11, 'three pages, every row exactly once';
  before_reclaim := (select e->>'occurredAt' from jsonb_array_elements(public.makeborne_usage_history(s, n, null, null, 100)->'entries') e where e->>'source' = 'lead_find');
  reset role;
  perform makeborne_private.lock_credit_wallet(u);   -- reclaims the dead hold, as the next wallet write does
  assert (select status from makeborne_private.credit_reservations where user_id = u and reference like 'lead_find:%') = 'released', 'reclaimed';
  set local role authenticated;
  after_reclaim := (select e->>'occurredAt' from jsonb_array_elements(public.makeborne_usage_history(s, n, null, null, 100)->'entries') e where e->>'source' = 'lead_find');
  reset role;
  assert before_reclaim = after_reclaim, 'occurrence time stable across reclaim: ' || before_reclaim || ' / ' || after_reclaim;
  raise notice 'PASS usage D: 3 pages of 4/4/3, no duplicates or gaps; totals constant; timed-out hold stable across reclaim';
end $$;

-- E: other accounts, signed-out callers, service role, bad input, other periods.
do $$
declare u uuid := (select value::uuid from usage_fixture where key = 'u'); other uuid := (select value::uuid from usage_fixture where key = 'other'); r jsonb;
  s timestamptz := date_trunc('month', now()); n timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_usage_history(s, n, null, null, 100);
  assert (r->'period'->>'total')::int = 1 and r->'period'->>'used' = '9', 'the other account sees only its own charge';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_usage_history(s - interval '1 month', s, null, null, 100);
  assert (r->'period'->>'total')::int = 0 and r->'period'->>'used' = '0' and r->'wallet'->>'reserved' = '8', 'an empty earlier period still carries the wallet';
  begin perform public.makeborne_usage_history(n, s, null, null, 100); raise exception 'reversed period accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_usage_history(s, s + interval '400 days', null, null, 100); raise exception 'oversized period accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_usage_history(s, n, now(), null, 100); raise exception 'half cursor accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_usage_history(s, n, now(), 'operation:x', 100); raise exception 'raw reference cursor accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_usage_history(s, n, null, null, 501); raise exception 'oversized page accepted'; exception when sqlstate '22023' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_usage_history(s, n, null, null, 100); raise exception 'no subject accepted'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform public.makeborne_usage_history(s, n, null, null, 100); raise exception 'anon executed'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'service_role')::text, true);
  set local role service_role;
  begin perform public.makeborne_usage_history(s, n, null, null, 100); raise exception 'service role executed'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS usage E: per-account isolation; anon, service role and subject-less sessions refused; invalid period/cursor/page refused';
end $$;


reset role;
do $$
declare u uuid:=(select value::uuid from usage_fixture where key='u'); r jsonb; e jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 r:=public.makeborne_usage_history_v2(date_trunc('month',now()),date_trunc('month',now())+interval '1 month',null,null,100);
 reset role;
 assert (r->'period'->>'used')::bigint=54;
 select x into e from jsonb_array_elements(r->'entries') x where x->>'id'=(select value from usage_fixture where key='hold:own');
 assert e?'workspaceId' and e?'artifactId' and e?'operationId' and e?'operationCharged' and e?'funding';
 assert (e->'funding'->>'other')::bigint=12 and (e->>'operationCharged')::bigint=12;
 assert not exists(select 1 from jsonb_array_elements(r->'entries') x where x->>'projectState' in('hidden','deleted') and (x?'artifactId' or x?'workspaceId'));
 raise notice 'PASS billing UX: v2 preserves totals; visible project links/request totals/funding; revoked project IDs excluded';
end $$;
do $$
declare u uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); r jsonb; before_count integer; v1 jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@ux.example.invalid',now()),(other,other||'@ux.example.invalid',now());
 perform makeborne_private.lock_credit_wallet(u);
 insert into makeborne_private.credit_lots(user_id,source,reference,amount,expires_at) values(u,'plan','plan-ux',60,now()+interval '60 days');
 perform makeborne_private.credit_grant(u,60,'topup','paid-ux','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 r:=public.makeborne_credit_preferences(true,50,100);
 reset role;
 assert (r->>'monthlyLimit')::bigint=100 and (r->>'alertBelow')::int=50;
 perform makeborne_private.credit_reserve(u,80,'ux:one');
 -- Same reservation joins even at the limit. A new request cannot cross it.
 assert (makeborne_private.credit_reserve(u,80,'ux:one')->>'replayed')::boolean;
 begin perform makeborne_private.credit_reserve(u,30,'ux:over');raise exception 'Limit bypassed';exception when sqlstate 'MB403' then null;end;
 perform makeborne_private.credit_settle(u,'ux:one',30);
 perform makeborne_private.credit_reserve(u,60,'ux:two');perform makeborne_private.credit_settle(u,'ux:two',60);
 begin perform makeborne_private.credit_reserve(u,11,'ux:over2');raise exception 'Charge limit bypassed';exception when sqlstate 'MB403' then null;end;
 begin perform public.makeborne_credit_preferences(true,50,80);raise exception 'Limit lower than committed accepted';exception when sqlstate 'PT409' then null;end;
 r:=public.makeborne_usage_history_v2(date_trunc('month',now()),date_trunc('month',now())+interval '1 month',null,null,100);
 assert exists(select 1 from jsonb_array_elements(r->'entries') x where x->>'id'='hold:'||md5('ux:two') and x->'funding'->>'plan'='30' and x->'funding'->>'paid'='30');
 update makeborne_private.autotopup_settings set charging_enabled=true,price_cents=1200 where singleton;
 update makeborne_private.billing_settings set creation_enabled=true where singleton;
 insert into makeborne_private.billing_access_plans(plan_id,enabled) values('plan_uxLimit',true);
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),u,'plan_uxLimit','ch_uxLimit','/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until) values('mem_uxLimit',u,'ch_uxLimit','user_uxLimit','plan_uxLimit','active',now()+interval '10 days',now()+interval '4 minutes');
 perform public.makeborne_autotopup_authorize(u,'autotopup-2026-10-20-v1',1200,50,2,repeat('a',64));
 select count(*) into before_count from makeborne_private.autotopup_attempts where user_id=u;
 assert public.makeborne_autotopup_plan_charge(u)->>'decision'='usage_limit';
 assert (select count(*) from makeborne_private.autotopup_attempts where user_id=u)=before_count;
 perform makeborne_private.credit_grant(u,1000,'topup','more-paid-ux','{}');
 begin perform makeborne_private.credit_reserve(u,11,'ux:after-pack');raise exception 'Top-up reset usage limit';exception when sqlstate 'MB403' then null;end;
 raise notice 'PASS billing UX: reservations/replay/settlement enforce cap; mixed plan/paid lots exact; auto-top-up cannot cross usage limit';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
 r:=public.makeborne_credit_preferences();assert r->>'monthlyLimit' is null and (r->>'used')::int=0;
 assert not has_table_privilege('authenticated','makeborne_private.credit_preferences','SELECT,UPDATE,INSERT,DELETE');
 assert not has_function_privilege('anon','public.makeborne_credit_preferences(boolean,integer,bigint)','EXECUTE');
 assert not has_function_privilege('service_role','public.makeborne_credit_preferences(boolean,integer,bigint)','EXECUTE');
 assert not (select prosecdef from pg_proc where oid='public.makeborne_credit_preferences(boolean,integer,bigint)'::regprocedure);
 assert not (select prosecdef from pg_proc where oid='public.makeborne_usage_history_v2(timestamptz,timestamptz,timestamptz,text,integer)'::regprocedure);
 raise notice 'PASS billing UX: caller isolation, invoker wrappers, no anon/service role exposure; automatic charging remains fixture-only';
end $$;
rollback;
