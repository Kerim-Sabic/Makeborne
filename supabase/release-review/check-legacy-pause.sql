\set ON_ERROR_STOP on
begin;
do $$ begin
 assert current_database()='makeborne_populated';
 assert not makeborne_private.claim_claude_pilot(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',repeat('b',64)), 'Paused legacy claim admitted an admin';
 assert (select reserved_cents=75 and limit_cents=0 from makeborne_private.claude_pilot_budget where id);
 assert (select count(*) from public.claude_pilot_runs)=1,'Denied claim changed the ledger';
 raise notice 'PASS old pilot pause: admin denied, no new dispatch, existing reserved cost unchanged';
end $$;
rollback;
