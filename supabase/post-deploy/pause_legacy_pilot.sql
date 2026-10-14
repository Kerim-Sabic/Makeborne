-- OPERATOR STEP, not a migration. Prepared for deployed commit 307881c2 only.
-- Never run on production without the separately approved maintenance window.
-- Capture the receipt below before proceeding. Do not reset reserved_cents.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='10s';
select limit_cents as previous_limit_cents, reserved_cents as retained_reserved_cents
from makeborne_private.claude_pilot_budget where id for update;
update makeborne_private.claude_pilot_budget set limit_cents=0 where id;
commit;
-- The row lock serializes with the exact deployed claim function. All later
-- claims return false, including administrators. Earlier claims can still run.
-- Do not turn their reservations into free capacity or erase usage evidence.
select count(*) filter(where status='reserved') as unresolved_runs,
       count(*) filter(where status='uncertain') as uncertain_runs
from public.claude_pilot_runs;
-- This gate deliberately leaves the pause committed if draining is incomplete.
do $$ begin
  if exists(select 1 from public.claude_pilot_runs where status='reserved') then
    raise exception 'Legacy pilot paused, but reserved runs remain. Drain or reconcile each run before migrating; do not clear reservations blindly.';
  end if;
end $$;
-- After migration, NEVER restore legacy RPC permissions to recover generation.
-- Before any migration only: abort recovery may restore the recorded limit after
-- reconciliation; keep reserved_cents unchanged and verify the same deployed SHA.
