-- Local-only postcondition: schema repair must not create a fresh paid allowance.
begin;
set local statement_timeout='10s';
do $$
declare actor uuid; claimed boolean; before_runs bigint;
begin
  if not exists(select 1 from makeborne_private.claude_pilot_budget where id and limit_cents=0 and reserved_cents=0) then
    raise exception 'Local pilot budget is not locked';
  end if;
  if has_table_privilege('anon','public.claude_pilot_runs','select')
     or has_table_privilege('authenticated','public.claude_pilot_runs','select')
     or has_function_privilege('anon','public.makeborne_claim_claude_pilot(uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.makeborne_claim_claude_pilot(uuid,uuid,text)','execute') then
    raise exception 'Browser role has pilot administration access';
  end if;
  if has_table_privilege('anon','public.github_connections','select')
     or has_table_privilege('authenticated','public.github_connections','select')
     or has_table_privilege('authenticated','public.github_website_links','select') then
    raise exception 'Browser role can read private GitHub connections';
  end if;
  select id into actor from auth.users where email like 'makeborne-source-%@example.com' order by created_at desc limit 1;
  if actor is null then raise exception 'Dedicated local source fixture is required'; end if;
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason)
    values(actor,true,false,'Rolled-back local budget assertion');
  select count(*) into before_runs from public.claude_pilot_runs;
  claimed := makeborne_private.claim_claude_pilot(gen_random_uuid(),actor,repeat('a',64));
  if claimed or (select count(*) from public.claude_pilot_runs)<>before_runs
      or (select reserved_cents from makeborne_private.claude_pilot_budget where id)<>0 then
    raise exception 'Locked pilot accepted an administrator dispatch';
  end if;
  raise notice 'PASS locked budget denies administrator claim without creating a run or reservation';
  raise notice 'PASS browser roles cannot administer pilot or read GitHub credentials';
end $$;
rollback;
