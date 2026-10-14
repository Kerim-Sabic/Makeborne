-- POST-DEPLOY CONTRACT STEP for the CRM sales/delivery split.
-- Run only after the new app (CRM protocol 2) serves all traffic; see
-- docs/CRM_STAGE_TRANSITION.md. Run with: psql -v ON_ERROR_STOP=1 -f this file
-- as the database owner. Each step commits on its own.
\set ON_ERROR_STOP on
set lock_timeout = '30s';

-- 1. Freeze client writes; waits for in-flight writes to commit (drain).
begin;
select makeborne_private.crm_freeze_writes('contract');
commit;

-- 2. Contract: rewrite legacy stages (audited), close the previous app's
--    vocabulary, require protocol 2 for API writes.
begin;
select makeborne_private.crm_contract_client_stages();
commit;

-- 3. Verify: must report mode=contracted, consistent=true, clientsLegacyStages=0.
select makeborne_private.crm_transition_report();

-- 4. Resume (refuses unless consistent).
begin;
select makeborne_private.crm_resume_writes();
commit;

-- This is an operator script (psql \set, separately committed freeze). Do not
-- move it into supabase/migrations/. For fresh environments, author and verify a
-- separate SQL-only follow-up migration as described in
-- docs/CRM_STAGE_TRANSITION.md ("Roll forward", step 5), applied only after
-- production has been contracted with this script.
