-- Disposable database only. Synthetic historical rows exercise query scaling;
-- actual credit settlement/withhold/restore is covered by separate suites.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '12s';
set local timezone = 'UTC';
create temporary table usage_scale_ids(actor uuid, other uuid);
grant select on usage_scale_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
begin
  if current_database() not in ('launch_suite','usage_scale_20261020') then
    raise exception 'DISPOSABLE_DATABASE_REQUIRED';
  end if;
  insert into auth.users(id,email,email_confirmed_at) values
    (u,u||'@scale.example.invalid',now()),(v,v||'@scale.example.invalid',now());
  insert into usage_scale_ids values(u,v);
  perform makeborne_private.credit_grant(u,100000,'adjust','scale-fixture','{"reason":"Disposable usage fixture"}');
  -- 10,000 owned rows over adjacent months, plus 90,000 another actor's rows.
  -- Deliberate equal timestamps test the ID component of keyset pagination.
  insert into makeborne_private.credit_reservations(user_id,reference,amount,status,charged,created_at,resolved_at)
    select case when n<=10000 then u else v end,'mystery:scale:'||n,3,'settled',2,
      case when n%2=0 then '2026-10-31 23:59:00Z'::timestamptz else '2026-11-01 00:00:00Z'::timestamptz end,
      case when n%2=0 then '2026-10-31 23:59:59.999999Z'::timestamptz else '2026-11-01 00:00:00Z'::timestamptz end
    from generate_series(1,100000) n;
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after,created_at)
    select user_id,-2,'settle',reference,0,resolved_at from makeborne_private.credit_reservations
    where reference like 'mystery:scale:%';
end $$;
analyze makeborne_private.credit_reservations;
analyze public.credit_ledger;
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from usage_scale_ids;
set local role authenticated;
do $$
declare start_at timestamptz; stop_at timestamptz; r jsonb; row jsonb;
  cursor_at timestamptz; cursor_id text; ids text[]; charged bigint; pages int; elapsed numeric;
begin
  foreach start_at in array array['2026-10-01Z'::timestamptz,'2026-11-01Z'::timestamptz] loop
    cursor_at:=null;cursor_id:=null;ids:='{}';charged:=0;pages:=0;stop_at:=clock_timestamp();
    loop
      r:=public.makeborne_usage_history(start_at,start_at+interval '1 month',cursor_at,cursor_id,500);
      assert (r#>>'{period,total}')::int=5000,'actor and month scoped count';
      assert (r#>>'{period,used}')::bigint=10000,'complete-month charged total';
      for row in select value from jsonb_array_elements(r->'entries') loop
        assert row->>'status'='Charged','settled usage status';
        assert not(row->>'id'=any(ids)),'duplicate keyset row';
        ids:=array_append(ids,row->>'id'); charged:=charged+(row->>'credits')::bigint;
        cursor_at:=(row->>'occurredAt')::timestamptz;cursor_id:=row->>'id';
      end loop;
      pages:=pages+1;
      exit when not (r#>>'{period,hasMore}')::boolean;
      assert pages<12,'pagination must terminate';
    end loop;
    elapsed:=extract(epoch from clock_timestamp()-stop_at)*1000;
    assert cardinality(ids)=5000 and charged=10000 and pages=10,'all rows and full-month sum';
    raise notice 'PASS usage scale month %: 5000 unique rows / 10 pages / used 10000; elapsed_ms=%',start_at,round(elapsed,2);
  end loop;
  r:=public.makeborne_usage_history('2026-12-01Z','2027-01-01Z',null,null,100);
  assert (r#>>'{period,total}')::int=0 and (r#>>'{period,used}')::int=0,'empty month zero';
  raise notice 'PASS empty month, UTC boundary, 90000 foreign reservations and ledger rows excluded';
end $$;
reset role;
rollback;
