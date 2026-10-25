-- Durable brief-enhancement actions (20261022100000_brief_enhancement_actions.sql).
-- Disposable local candidate only: every fixture, limit and grant change rolls back. No provider calls.
-- Run: docker exec -i <local db container> psql -U postgres -X -q < supabase/check-brief-enhancements.sql
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); editor_ uuid:=gen_random_uuid(); reviewer_ uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); poor uuid:=gen_random_uuid();
  rich uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); deck uuid:=gen_random_uuid(); key uuid; key2 uuid; x jsonb; y jsonb; run jsonb; before_ jsonb; after_ jsonb;
  h text:=repeat('a',64); h2 text:=repeat('b',64); n int; brief jsonb:='{"mode":"enhance","text":"Business: Ovenbird","enhanced":{"business":"Ovenbird"}}';
begin
  insert into auth.users(id,email,email_confirmed_at) select id, id||'@brief-enhance.invalid', now() from unnest(array[u,editor_,reviewer_,stranger,poor,rich]) id;
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(rich,false,true,'Transaction fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Enhance fixture',u),(w2,'Other fixture',stranger);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,editor_,'editor'),(w,reviewer_,'reviewer'),(w,poor,'editor'),(w,rich,'editor'),(w2,u,'editor');
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website'),(p2,w2,'Other','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website'),(a2,w2,p2,'Other','website'),(deck,w,p,'Deck','presentation');
  perform public.makeborne_credit_grant(u,10,'topup','brief-enhance-fixture','{}');
  perform public.makeborne_credit_grant(editor_,10,'topup','brief-enhance-fixture','{}');
  perform set_config('fx.u',u::text,true); perform set_config('fx.w',w2::text,true); perform set_config('fx.a',a2::text,true);

  -- A. One claim per action: a replay (sequential or after a restart) finds the same row, with no second hold.
  key:=gen_random_uuid(); before_:=public.makeborne_credit_wallet(u);
  x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  assert not (x->>'replayed')::boolean and x->'action'->>'status'='running' and (run->>'amount')::int=1 and not (run->>'exempt')::boolean,'first claim holds one credit';
  assert x->'action'->>'chargedCredits' is null and x->'action'->'result'='null'::jsonb and not (x->'action' ? 'fence') and not (x->'action' ? 'reference'),'snapshot hides fence, reference and digest';
  assert (public.makeborne_credit_wallet(u)->>'available')::int=(before_->>'available')::int-1,'hold set aside';
  y:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000);
  assert (y->>'replayed')::boolean and y->'action'->>'id'=x->'action'->>'id' and not (y ? 'run'),'replay returns the action and no worker run';
  select count(*) into n from makeborne_private.credit_reservations where user_id=u and reference like 'brief_enhance:%'; assert n=1,'one hold per action';
  select count(*) into n from public.credit_ledger where user_id=u and kind='reserve' and reference like 'brief_enhance:%'; assert n=1,'one reserve entry';
  begin perform public.makeborne_brief_enhance_claim(u,w,a,key,h2,'enhance',1,30000); raise exception 'changed input accepted'; exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_brief_enhance_claim(u,w2,a2,key,h,'enhance',1,30000); raise exception 'other project accepted'; exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_brief_enhance_claim(stranger,w,a,gen_random_uuid(),h,'enhance',1,30000); raise exception 'stranger claimed'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_brief_enhance_claim(reviewer_,w,a,gen_random_uuid(),h,'enhance',1,30000); raise exception 'reviewer claimed'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_brief_enhance_claim(u,w,deck,gen_random_uuid(),h,'enhance',1,30000); raise exception 'deck claimed'; exception when sqlstate 'P0002' then null; end;
  key2:=gen_random_uuid();
  begin perform public.makeborne_brief_enhance_claim(poor,w,a,key2,h,'enhance',1,30000); raise exception 'claim without credits'; exception when sqlstate 'MB402' then null; end;
  assert not exists(select 1 from makeborne_private.brief_enhancements where actor=poor),'a refused hold leaves no action behind';
  raise notice 'PASS brief enhance A: one claim and one hold per action; replay; changed input/project conflict; stranger, reviewer, deck and no-credit refusals';

  -- B. Result recorded before the release; the release is verified and happens exactly once.
  y:=public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  assert y->'action'->>'status'='releasing' and y->'action'->'result'='null'::jsonb and y->'action'->>'chargedCredits' is null,'recorded, not yet usable';
  begin perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,gen_random_uuid(),'completed',brief,null,1,900); raise exception 'stale fence recorded'; exception when sqlstate 'PT409' then null; end;
  assert (public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900)->>'replayed')::boolean,'exact record repeat replays';
  begin perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'failed',null,'{"code":"X"}',1,900); raise exception 'contradictory record'; exception when sqlstate 'PT409' then null; end;
  y:=public.makeborne_brief_enhance_read(u,w,a,key);
  assert y->'action'->>'status'='releasing','a read after a lost release shows the unresolved billing state';
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert not (y->>'replayed')::boolean and y->'action'->>'status'='completed' and y->'action'->>'billing'='released' and (y->'action'->>'chargedCredits')::int=0
    and y->'action'->'result'->>'text'='Business: Ovenbird','verified release makes the result usable at zero charge';
  assert (public.makeborne_credit_wallet(u)->>'available')=(before_->>'available') and (public.makeborne_credit_wallet(u)->>'balance')=(before_->>'balance'),'hold returned, nothing charged';
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert (y->>'replayed')::boolean and y->'action'->>'status'='completed','repeat release is a replay';
  select count(*) into n from public.credit_ledger where user_id=u and kind='release' and reference=run->>'reference'; assert n=1,'exactly one release entry';
  select count(*) into n from makeborne_private.ai_run_outcomes where user_id=u and reference=run->>'reference' and outcome='released' and charged_credits=0; assert n=1,'one absorbed-cost record';
  assert (public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000)->'action'->'result'->>'text')='Business: Ovenbird','a replay after completion returns the stored result';
  raise notice 'PASS brief enhance B: result durable before release; fence; record replay/conflict; verified release exactly once; replay returns the stored result';

  -- C. Anomalous holds: missing, already released, lapsed. Never usable, never re-charged.
  key:=gen_random_uuid(); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  perform makeborne_private.credit_release(u,run->>'reference');
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert y->'action'->>'status'='needs_review' and y->'action'->>'billing'='released_hold' and (y->'action'->>'chargedCredits')::int=0 and y->'action'->'result'='null'::jsonb,'already-released hold: withheld, zero charge';
  assert exists(select 1 from makeborne_private.brief_enhancements where id=(run->>'id')::uuid and result is not null),'result kept for review, not regenerated';
  select count(*) into n from public.credit_ledger where user_id=u and kind in ('settle','charge') and reference=run->>'reference'; assert n=0,'released hold not re-charged';
  key:=gen_random_uuid(); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  perform makeborne_private.credit_release(u,run->>'reference');
  update makeborne_private.brief_enhancements set reference='brief_enhance:missing:'||id where id=(run->>'id')::uuid;
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert y->'action'->>'status'='needs_review' and y->'action'->>'billing'='missing_hold' and (y->'action'->>'chargedCredits')::int=0,'missing hold: anomaly';
  assert exists(select 1 from makeborne_private.ai_run_outcomes where user_id=u and reference='brief_enhance:missing:'||(run->>'id') and outcome='missing_hold'),'missing hold audited';
  key:=gen_random_uuid(); before_:=public.makeborne_credit_wallet(u); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  update makeborne_private.credit_reservations set created_at=now()-interval '20 minutes' where user_id=u and reference=run->>'reference';
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert y->'action'->>'status'='needs_review' and y->'action'->>'billing'='expired_hold' and (y->'action'->>'chargedCredits')::int=0,'lapsed hold: anomaly';
  assert (public.makeborne_credit_wallet(u)->>'balance')=(before_->>'balance'),'lapsed hold charged nothing';
  y:=public.makeborne_brief_enhance_release(u,w,a,key); assert (y->>'replayed')::boolean and y->'action'->>'status'='needs_review','review state is stable';
  raise notice 'PASS brief enhance C: released, missing and lapsed holds are withheld for review at zero charge and never re-charged';

  -- D. Stop: before the claim, during the work, after completion.
  key:=gen_random_uuid(); y:=public.makeborne_brief_enhance_cancel(u,w,a,key);
  assert y->'action'->>'status'='cancelled' and (y->'action'->>'chargedCredits')::int=0 and y->'action'->>'billing'='none','stop before claim recorded';
  y:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000);
  assert (y->>'replayed')::boolean and y->'action'->>'status'='cancelled' and not (y ? 'run'),'a late claim after Stop never starts';
  select count(*) into n from makeborne_private.credit_reservations where user_id=u and reference=(select reference from makeborne_private.brief_enhancements where actor=u and action_key=key); assert n=0,'no hold after Stop';
  perform makeborne_private.set_live_provider_limit('global',true,10000000,false,'Brief enhance fixture');
  perform makeborne_private.set_live_provider_limit('anthropic',true,10000000,false,'Brief enhance fixture');
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  key:=gen_random_uuid(); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  y:=public.makeborne_brief_enhance_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',20000);
  assert (y->>'started')::boolean,'the worker may call the provider while running';
  assert (public.makeborne_brief_enhance_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',20000)->'error'->>'code')='RUN_BUDGET','action cap enforced';
  begin perform public.makeborne_brief_enhance_provider_begin(u,(run->>'id')::uuid,gen_random_uuid(),gen_random_uuid(),'anthropic','fixture',1000); raise exception 'stale worker called'; exception when sqlstate 'PT409' then null; end;
  begin perform public.makeborne_brief_enhance_provider_begin(stranger,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1000); raise exception 'stranger called'; exception when sqlstate 'P0002' then null; end;
  y:=public.makeborne_brief_enhance_cancel(u,w,a,key);
  assert y->'action'->>'status'='running' and (y->'action'->>'cancelRequested')::boolean,'stop during work is durable';
  assert public.makeborne_brief_enhance_cancel(u,w,a,key)->'action'=y->'action','double Stop is idempotent';
  begin perform public.makeborne_brief_enhance_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1000); raise exception 'call after Stop'; exception when sqlstate 'MB499' then null; end;
  perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  y:=public.makeborne_brief_enhance_release(u,w,a,key);
  assert y->'action'->>'status'='cancelled' and y->'action'->'result'='null'::jsonb and (y->'action'->>'chargedCredits')::int=0,'Stop wins over a racing result; zero charge';
  key:=gen_random_uuid(); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'enhance',1,30000); run:=x->'run';
  perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900);
  perform public.makeborne_brief_enhance_release(u,w,a,key);
  y:=public.makeborne_brief_enhance_cancel(u,w,a,key);
  assert y->'action'->>'status'='completed' and y->'action'->'result'->>'text'='Business: Ovenbird' and not (y->'action'->>'cancelRequested')::boolean,'Stop after completion keeps the result and receipt';
  raise notice 'PASS brief enhance D: Stop before claim (no hold), during work (no new provider call, result not used), after completion (receipt kept); provider gate fence, actor and cap';

  -- E. A vanished worker: the lease ends, the hold is returned once, its late result is refused.
  key:=gen_random_uuid(); before_:=public.makeborne_credit_wallet(u); x:=public.makeborne_brief_enhance_claim(u,w,a,key,h,'analyze',1,30000); run:=x->'run';
  update makeborne_private.brief_enhancements set lease_expires_at=clock_timestamp()-interval '1 second' where id=(run->>'id')::uuid;
  begin perform public.makeborne_brief_enhance_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture',1000); raise exception 'call after lease'; exception when sqlstate 'PT409' then null; end;
  y:=public.makeborne_brief_enhance_read(u,w,a,key);
  assert y->'action'->>'status'='expired' and (y->'action'->>'chargedCredits')::int=0 and y->'action'->>'billing'='released','lease end returns the hold';
  assert (public.makeborne_credit_wallet(u)->>'available')=(before_->>'available'),'hold returned';
  begin perform public.makeborne_brief_enhance_record(u,(run->>'id')::uuid,(run->>'fence')::uuid,'completed',brief,null,1,900); raise exception 'late result accepted'; exception when sqlstate 'PT409' then null; end;
  select count(*) into n from public.credit_ledger where user_id=u and kind='release' and reference=run->>'reference'; assert n=1,'released once';
  raise notice 'PASS brief enhance E: lease expiry returns the hold once and refuses a late worker';

  -- F. Isolation: another member, another project, an exempt account, deletion.
  begin perform public.makeborne_brief_enhance_read(editor_,w,a,key); raise exception 'other member read'; exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_brief_enhance_read(u,w2,a2,key); raise exception 'other project read'; exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_brief_enhance_read(reviewer_,w,a,key); raise exception 'reviewer read'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_brief_enhance_cancel(editor_,w,a,key); exception when others then raise exception 'other member stop should create their own action, got %',sqlerrm; end;
  assert (select status from makeborne_private.brief_enhancements where actor=u and action_key=key)='expired','another member cannot touch this action';
  x:=public.makeborne_brief_enhance_claim(rich,w,a,gen_random_uuid(),h,'enhance',1,30000); run:=x->'run';
  assert (run->>'exempt')::boolean and (run->>'amount')::int=0 and x->'action'->>'billing'='exempt','unlimited account holds nothing';
  perform public.makeborne_brief_enhance_record(rich,(run->>'id')::uuid,(run->>'fence')::uuid,'failed',null,'{"code":"ENHANCE_UNAVAILABLE"}',0,0);
  y:=public.makeborne_brief_enhance_release(rich,w,a,(x->'action'->>'key')::uuid);
  assert y->'action'->>'status'='failed' and y->'action'->>'billing'='exempt' and (y->'action'->>'chargedCredits')::int=0,'exempt failure resolves';
  key:=gen_random_uuid(); x:=public.makeborne_brief_enhance_claim(editor_,w,a,key,h,'enhance',1,30000); run:=x->'run';
  delete from public.artifacts where id=a;
  assert (select status from makeborne_private.credit_reservations where user_id=editor_ and reference=run->>'reference')='released','deleting the project returns a running hold';
  assert not exists(select 1 from makeborne_private.brief_enhancements where artifact_id=a),'actions removed with the project';
  raise notice 'PASS brief enhance F: member, project and reviewer isolation; exempt accounts; deletion returns the hold';
end $$;

-- G. No browser role reaches the table or the functions; the service role only reaches the entry points.
-- (The functions' own permission check also uses SQLSTATE 42501, so the grant refusal is told apart by its message.)
create function pg_temp.denied(p_sql text) returns boolean language plpgsql as $f$
begin execute p_sql; return false;
exception when insufficient_privilege then
  if sqlerrm like 'permission denied for %' then return true; end if;
  raise exception 'expected a grant refusal, got: %', sqlerrm;
end $f$;
grant execute on function pg_temp.denied(text) to authenticated, anon, service_role;
set local role authenticated;
do $$ begin
  assert pg_temp.denied('select 1 from makeborne_private.brief_enhancements'),'authenticated read the table';
  assert pg_temp.denied(format('select public.makeborne_brief_enhance_read(%L,%L,%L,%L)',current_setting('fx.u'),current_setting('fx.w'),current_setting('fx.a'),gen_random_uuid())),'authenticated called read';
  assert pg_temp.denied(format('select public.makeborne_brief_enhance_claim(%L,%L,%L,%L,%L,''enhance'',1,30000)',current_setting('fx.u'),current_setting('fx.w'),current_setting('fx.a'),gen_random_uuid(),repeat('a',64))),'authenticated claimed';
  assert pg_temp.denied(format('select makeborne_private.brief_enhance_release(%L,%L,%L,%L)',current_setting('fx.u'),current_setting('fx.w'),current_setting('fx.a'),gen_random_uuid())),'authenticated reached the core';
end $$;
reset role;
set local role anon;
do $$ begin
  assert pg_temp.denied(format('select public.makeborne_brief_enhance_cancel(%L,%L,%L,%L)',current_setting('fx.u'),current_setting('fx.w'),current_setting('fx.a'),gen_random_uuid())),'anon cancelled';
end $$;
reset role;
set local role service_role;
do $$ begin
  assert pg_temp.denied('select 1 from makeborne_private.brief_enhancements'),'service role read the table directly';
  assert pg_temp.denied(format('select makeborne_private.brief_enhancement_return_hold(%L,''x'')',gen_random_uuid())),'service role reached an internal helper';
  -- The entry point itself is reachable: an unknown action in a real project is simply not found.
  begin perform public.makeborne_brief_enhance_read(current_setting('fx.u')::uuid,current_setting('fx.w')::uuid,current_setting('fx.a')::uuid,gen_random_uuid()); raise exception 'unexpected read'; exception when sqlstate 'P0002' then null; end;
end $$;
reset role;
do $$ begin raise notice 'PASS brief enhance G: RLS and grants: no authenticated/anon access; service role only through the entry points'; end $$;
rollback;
