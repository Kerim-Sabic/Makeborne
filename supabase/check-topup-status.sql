-- Dedicated disposable database only; every fixture is rolled back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'makeborne_topup_status_20261013' then
    raise exception 'Refusing status fixtures outside the named disposable database';
  end if;
end $$;

do $$
declare
  u uuid := gen_random_uuid(); other_ uuid := gen_random_uuid(); oid uuid := gen_random_uuid();
  lot_ bigint; state_ text; granted_ boolean; expected_ text; result_ jsonb; before_ jsonb; after_ jsonb;
  f regprocedure;
begin
  foreach f in array array['makeborne_private.topup_order_status(uuid,uuid)'::regprocedure,
    'public.makeborne_topup_order_status(uuid,uuid)'::regprocedure] loop
    assert not has_function_privilege('anon', f, 'execute');
    assert not has_function_privilege('authenticated', f, 'execute');
    assert has_function_privilege('service_role', f, 'execute');
    assert (select pg_get_userbyid(proowner) = 'postgres' and provolatile = 's'
      and proconfig @> array['search_path=""'] from pg_proc where pg_proc.oid = f);
  end loop;
  assert (select prosecdef from pg_proc where pg_proc.oid = 'makeborne_private.topup_order_status(uuid,uuid)'::regprocedure);
  assert not (select prosecdef from pg_proc where pg_proc.oid = 'public.makeborne_topup_order_status(uuid,uuid)'::regprocedure);
  assert not has_table_privilege('service_role', 'makeborne_private.topup_orders', 'select');
  assert not has_table_privilege('authenticated', 'makeborne_private.topup_orders', 'select');
  assert (select relrowsecurity from pg_class where pg_class.oid = 'makeborne_private.topup_orders'::regclass);
  raise notice 'PASS status SQL: restricted execute, explicit owner, stable private definer/public invoker, no table grants';

  insert into auth.users(id,email,email_confirmed_at,created_at)
    values (u,'topup-status@example.invalid',now(),now()),(other_,'topup-status-other@example.invalid',now(),now());
  insert into makeborne_private.topup_catalog(version,pack_id,credits,price_cents)
    values ('status-historical-fixture','boost_100',117,1375);
  insert into makeborne_private.topup_orders(id,user_id,request_id,pack_id,catalog_version,credits,price_cents,merchant_id,plan_id,whop_user_id)
    values (oid,u,gen_random_uuid(),'boost_100','status-historical-fixture',117,1375,'biz_Status','plan_Status','user_Status');
  insert into makeborne_private.credit_lots(user_id,source,reference,amount)
    values (u,'topup','status-read-only-fixture',117) returning id into lot_;
  assert not exists(select 1 from public.billing_memberships where user_id = u);

  foreach state_ in array array['awaiting_payment','funded','held','reversed'] loop
    foreach granted_ in array array[false,true] loop
      update makeborne_private.topup_orders set state=state_,granted=granted_,lot_id=case when granted_ then lot_ else null end where id=oid;
      expected_ := case when state_='reversed' then 'refunded'
        when state_='funded' and granted_ then 'delivered'
        when state_='awaiting_payment' and not granted_ then 'pending' else 'under_review' end;
      select jsonb_build_object('order',(select to_jsonb(o) from makeborne_private.topup_orders o where id=oid),
        'lot',(select to_jsonb(l) from makeborne_private.credit_lots l where id=lot_),
        'ledger',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.credit_ledger e where user_id=u)) into before_;
      set local role service_role;
      result_ := public.makeborne_topup_order_status(u,oid);
      assert result_ = jsonb_build_object('orderId',oid,'packId','boost_100','credits',117,'priceCents',1375,'currency','usd','state',expected_);
      assert public.makeborne_topup_order_status(u,oid) = result_;
      assert public.makeborne_topup_order_status(other_,oid) is null;
      assert public.makeborne_topup_order_status(u,gen_random_uuid()) is null;
      assert public.makeborne_topup_order_status(null,oid) is null;
      assert public.makeborne_topup_order_status(u,null) is null;
      reset role;
      select jsonb_build_object('order',(select to_jsonb(o) from makeborne_private.topup_orders o where id=oid),
        'lot',(select to_jsonb(l) from makeborne_private.credit_lots l where id=lot_),
        'ledger',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.credit_ledger e where user_id=u)) into after_;
      assert before_ = after_, 'Status changed purchase or credit accounting';
    end loop;
  end loop;
  raise notice 'PASS status SQL: all eight state/grant combinations, no-plan owner, exact projection, frozen historic amounts, missing/wrong owner/null, repeated reads unchanged';
end $$;

set local role anon;
do $$ begin
  begin
    perform public.makeborne_topup_order_status(gen_random_uuid(),gen_random_uuid());
    raise exception 'Anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.makeborne_topup_order_status(gen_random_uuid(),gen_random_uuid());
    raise exception 'Browser RPC accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin
    perform 1 from makeborne_private.topup_orders;
    raise exception 'Direct service table read accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin raise notice 'PASS status SQL: anonymous/authenticated RPC denial and direct service table denial'; end $$;
rollback;
