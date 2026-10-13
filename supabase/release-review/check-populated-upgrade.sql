\set ON_ERROR_STOP on
begin;
do $$ begin
 assert current_database()='makeborne_populated','Wrong rehearsal database';
 assert (select count(*) from public.clients)=1;
 assert (select outreach->>'stage' from public.clients)='Meeting','Expand lost stage provenance';
 assert (select outreach->>'notes' from public.clients)='Keep my notes','Notes lost';
 assert (select count(*) from public.artifact_versions)=1;
 assert (select content->>'title' from public.artifact_versions)='Preserve content';
 assert public.makeborne_read_hosted_site('preserve-site')='<!doctype html><html><body><h1>Preserve published site</h1></body></html>','Legacy publication changed';
 assert (select reserved_cents=75 and limit_cents=0 from makeborne_private.claude_pilot_budget where id),'Pilot pause or accounting lost';
 assert (select count(*) from public.claude_pilot_runs where usage->>'fixtureCost'='75')=1,'Cost evidence lost';
 assert not exists(select 1 from makeborne_private.live_provider_limits where enabled),'Spending unexpectedly on';
 assert not (select free_tier_enabled from makeborne_private.billing_settings where singleton),'Trial unexpectedly on';
 assert not has_function_privilege('service_role','public.makeborne_claim_claude_pilot(uuid,uuid,text)','execute'),'Old pilot dispatch reopened';
 perform makeborne_private.crm_freeze_writes('populated rehearsal');
 perform makeborne_private.crm_contract_client_stages();
 assert (select outreach->>'stage' from public.clients)='Conversation';
 perform makeborne_private.crm_resume_writes();
 perform makeborne_private.crm_freeze_writes('populated recovery');
 perform makeborne_private.crm_rollback_client_stages();
 perform makeborne_private.crm_resume_writes();
 assert (select outreach->>'stage' from public.clients)='Meeting','Rollback lost exact original stage';
 assert (select reserved_cents from makeborne_private.claude_pilot_budget where id)=75;
 raise notice 'PASS populated production-schema upgrade: client/history/content/site preserved, trial and spend off, pilot cost retained, contract and recovery preserve provenance';
end $$;
rollback;
