-- Agency execution contract (20261023200000). Disposable local stack only.
-- All fixtures and limits roll back. No provider is ever called: provider
-- "calls" are ledger rows opened and closed by the existing SQL gate.
-- Run: docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-agency-operations.sql
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); boss uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); cl uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); p_client uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); p_foreign uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); a_foreign uuid:=gen_random_uuid(); wb uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); ab uuid:=gen_random_uuid();
 s uuid:=gen_random_uuid(); s_client uuid:=gen_random_uuid(); s_other uuid:=gen_random_uuid(); s_foreign uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid();
 hash text:=repeat('d',64); rate bigint:=30000; text_sha text:=encode(sha256(convert_to('Approved brochure text','UTF8')),'hex');
 scope jsonb; ctx jsonb; op jsonb; x jsonb; run jsonb; run2 jsonb; replay jsonb; cand jsonb; call_id uuid; call2 uuid; step uuid; action uuid; before_ bigint; holds bigint; n integer;
 website jsonb:=jsonb_build_object('schemaVersion',1,'kind','website','title','Agency fixture','sections','[]'::jsonb);
 style jsonb:='{"id":"test","name":"Test","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{},"description":"","referenceAssetIds":[]}'::jsonb;
 task_ctx jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@agency.invalid',now()),(stranger,stranger||'@agency.invalid',now()),(boss,boss||'@agency.invalid',now());
 update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
 insert into public.workspaces(id,name,owner_id) values(w,'Agency fixture',u),(w2,'Foreign fixture',stranger),(wb,'Exempt fixture',boss);
 insert into public.clients(id,workspace_id,name) values(cl,w,'Fixture client');
 insert into public.projects(id,workspace_id,client_id,title,kind) values(p,w,cl,'Main','website'),(p_client,w,cl,'Same client','website'),(p_other,w,null,'Unrelated','website'),(p_foreign,w2,null,'Foreign','website'),(pb,wb,null,'Exempt','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Main','website'),(a_foreign,w2,p_foreign,'Foreign','website'),(ab,wb,pb,'Exempt','website');
 insert into public.sources(id,workspace_id,project_id,title,kind,content) values(s,w,p,'Brochure','text','Approved brochure text'),
  (s_client,w,p_client,'Client notes','text','Client notes'),(s_other,w,p_other,'Other','text','Unrelated notes'),(s_foreign,w2,p_foreign,'Foreign','text','Foreign notes');
 insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values(asset,w,p,w||'/'||p||'/fixture.png','image/png',repeat('a',64));
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(boss,false,true,'Agency exempt fixture');
 perform public.makeborne_credit_grant(u,500,'topup','agency-fixture','{}');
 perform makeborne_private.set_live_provider_limit('global',true,1000000000000,false,'Agency fixture');
 perform makeborne_private.set_live_provider_limit('anthropic',true,1000000000000,false,'Agency fixture');

 -- A. Scope comes from the artifact; every input is checked against it.
 scope:=public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s,'sha256',text_sha),
  jsonb_build_object('kind','asset','id',asset,'sha256',repeat('a',64)),jsonb_build_object('kind','source','id',s_client,'sha256',encode(sha256(convert_to('Client notes','UTF8')),'hex'))));
 assert scope->>'workspaceId'=w::text and scope->>'projectId'=p::text and scope->>'clientId'=cl::text and (scope->>'currentVersion')::int=0,'scope derived from artifact';
 assert jsonb_array_length(scope->'inputs')=3 and scope->'inputs'->0->>'sha256'=text_sha and scope->'inputs'->2->>'projectId'=p_client::text,'inputs resolved with server digests';
 begin perform public.makeborne_agency_task_scope(stranger,a,'[]'); raise exception 'stranger resolved scope'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,a_foreign,'[]'); raise exception 'foreign artifact resolved'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,gen_random_uuid(),'[]'); raise exception 'missing artifact resolved'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s_foreign,'sha256',repeat('b',64)))); raise exception 'cross-workspace input'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s_other,'sha256',repeat('b',64)))); raise exception 'other-client input'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',gen_random_uuid(),'sha256',repeat('b',64)))); raise exception 'missing input'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s,'sha256',repeat('b',64)))); raise exception 'changed input'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s))); raise exception 'digest optional'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','source','id',s,'sha256',text_sha),jsonb_build_object('kind','source','id',s,'sha256',text_sha))); raise exception 'duplicate input'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','url','id',s,'sha256',text_sha))); raise exception 'unknown input kind'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_agency_task_scope(u,a,(select jsonb_agg(jsonb_build_object('kind','source','id',gen_random_uuid(),'sha256',text_sha)) from generate_series(1,51))); raise exception 'too many inputs'; exception when sqlstate '22023' then null; end;
 raise notice 'PASS agency A: workspace/project/client derived server-side; cross-workspace, other-client, missing, changed, duplicate and malformed inputs refused';

 -- B. A new agency operation records only a scope verified in the same transaction.
 task_ctx:=jsonb_build_object('task',jsonb_build_object('objective','Summarise the brochure','inputs',jsonb_build_array(scope->'inputs'->0),'projectId',scope->'projectId','clientId',scope->'clientId'));
 action:=gen_random_uuid();
 op:=public.makeborne_ai_operation_create(u,w,a,action,'research','medium',hash,0,40,rate,task_ctx);
 assert op->>'kind'='research' and (op->>'authorizedCredits')::int=40,'agency operation created';
 assert (public.makeborne_ai_operation_create(u,w,a,action,'research','medium',hash,0,40,rate,task_ctx))->>'id'=op->>'id','duplicate create returns the same operation';
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,0,40,rate,jsonb_build_object('task',jsonb_build_object('inputs',jsonb_build_array(jsonb_set(scope->'inputs'->0,'{sha256}',to_jsonb(repeat('e',64)))),'projectId',scope->'projectId','clientId',scope->'clientId'))); raise exception 'tampered digest admitted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,0,40,rate,jsonb_build_object('task',jsonb_build_object('inputs',jsonb_build_array(scope->'inputs'->0),'projectId',to_jsonb(p_other::text),'clientId',scope->'clientId'))); raise exception 'client-sent project admitted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,0,40,rate,'{}'); raise exception 'agency op without scope'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_ai_operation_create(u,w2,a,gen_random_uuid(),'research','medium',hash,0,40,rate,task_ctx); raise exception 'client-sent workspace admitted'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_ai_operation_create(stranger,w,a,gen_random_uuid(),'research','medium',hash,0,40,rate,task_ctx); raise exception 'stranger created'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,3,40,rate,task_ctx); raise exception 'stale initial version'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'publish','medium',hash,0,40,rate,task_ctx); raise exception 'unknown kind'; exception when sqlstate '22023' then null; end;
 assert (public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',hash,0,40,rate,'{}'))->>'kind'='build','builder kinds unchanged';
 raise notice 'PASS agency B: scope bound at creation; tampered digest/project/workspace, stranger, stale version and unknown kind refused; builder create unchanged';

 -- C. Runs: kind must match; duplicate step replays; a second step is busy.
 step:=gen_random_uuid();
 begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'build',hash,0,40); raise exception 'builder run on agency op'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',hash,0,40); raise exception 'continuation run on agency op'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'research',hash,0,40); run:=x->'run';
 assert not (x->>'replayed')::boolean and (run->>'amount')::int=40 and not (run->>'exempt')::boolean,'agency run reserved through the existing hold';
 replay:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'research',hash,0,40);
 assert (replay->>'replayed')::boolean and replay->'run'->>'id'=run->>'id' and replay->'run'->>'fence'=run->>'fence','duplicate step returns the same run';
 assert (select count(*) from makeborne_private.credit_reservations where user_id=u and reference like 'operation:%')=1,'one hold for the duplicate';
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'research',hash,0,40);
 assert x->'error'->>'code'='OPERATION_BUSY','second step while active is busy';
 raise notice 'PASS agency C: run kind bound to operation kind; duplicate step replays one hold; concurrent step busy';

 -- D. Outcomes: agency kinds return data or a checked change; never a plan.
 begin perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'plan','{}',jsonb_build_object('stored',jsonb_build_object('plan','{}'::jsonb))); raise exception 'agency plan write'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'result','{}',null); raise exception 'result without data'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'result','{}',jsonb_build_object('data',jsonb_build_object('blob',repeat('x',270000)))); raise exception 'oversized result'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,gen_random_uuid(),0,'result','{}',jsonb_build_object('data','{}'::jsonb)); raise exception 'wrong fence finished'; exception when sqlstate 'PT409' then null; end;

 -- E. Uncertain usage: the bound stays provider exposure; only confirmed cost is charged.
 call_id:=gen_random_uuid();
 x:=public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture-model',200000);
 assert (x->>'started')::boolean,'paid attempt recorded before the call';
 x:=public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture-model',200000);
 assert not (x->>'started')::boolean and (x->>'replayed')::boolean,'same attempt id is never sent twice';
 x:=public.makeborne_ai_operation_progress(u,w,a,(op->>'id')::uuid);
 assert (x->'calls'->>'inProgress')::int=1 and x::text not like '%fixture-model%' and x::text not like '%anthropic%','customer progress counts the in-flight call without provider or model names';
 perform public.makeborne_provider_call_finish(call_id,null,45000,'{"reason":"timeout"}');
 assert (select status from makeborne_private.live_provider_calls where id=call_id)='uncertain','timed-out call is uncertain';
 assert (public.makeborne_ai_operation_progress(u,w,a,(op->>'id')::uuid)->'operation'->>'providerRemainingMicrousd')::bigint=40*rate-200000,'uncertain bound still counts against the provider allowance';
 cand:=jsonb_build_object('data',jsonb_build_object('summary','Brochure summary','findings',jsonb_build_array('Opening hours confirmed')));
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,45000,'result','{"uncertainMicrousd":155000}',cand);
 select count(*) into before_ from public.credit_ledger where user_id=u;
 assert x->>'outcome'='result' and (x->>'charged')::int=2 and x->'result'->'data'->>'summary'='Brochure summary' and (x->'result'->>'basedOnVersion')::int=0,'data persisted; charged confirmed cost only (45,000 -> 2 credits)';
 assert (x->'operation'->>'reservedCredits')::int=0 and x->'operation'->>'pendingKind' is null and not (x->'operation'->>'canContinue')::boolean,'terminal: hold released, nothing pending';
 assert (select current_version from public.artifacts where id=a)=0,'a data result never writes the project';
 replay:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,45000,'result','{"uncertainMicrousd":155000}',cand);
 assert (replay->>'replayed')::boolean and replay->'result'=x->'result' and (select count(*) from public.credit_ledger where user_id=u)=before_,'duplicate finish replays the stored result with one charge';
 begin perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,45000,'result','{}',cand); raise exception 'divergent finish replay'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,999);
 assert not (x->'operation'->>'cancelRequested')::boolean and x->'result'->'data'->>'summary'='Brochure summary','Stop after a stored result is a no-op';
 x:=public.makeborne_ai_operation_read(u,w,a,(op->>'id')::uuid,null);
 assert x->'result'->'data'->>'summary'='Brochure summary','reconnect reads the recorded result';
 begin perform public.makeborne_ai_operation_progress(stranger,w,a,(op->>'id')::uuid); raise exception 'stranger read progress'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_ai_operation_progress(u,w,a,gen_random_uuid()); raise exception 'missing op progress'; exception when sqlstate 'P0002' then null; end;
 raise notice 'PASS agency D/E: outcome policy, fence, attempt idempotency, uncertain exposure kept, confirmed-only charge, idempotent result, late Stop no-op, reconnect';

 -- F. Stale versions: a change is applied only at the expected revision.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'image_edit','medium',hash,0,20,rate,jsonb_build_object('task',jsonb_build_object('inputs',jsonb_build_array(scope->'inputs'->1),'projectId',scope->'projectId','clientId',scope->'clientId')));
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'image_edit',hash,0,20); run:=x->'run';
 cand:=jsonb_build_object('expectedVersion',0,'summary','Swapped hero image','content',website,'style',style,'assetIds','[]'::jsonb);
 update public.artifacts set current_version=7 where id=a; -- another writer moved the project
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,30000,'saved','{"finished":true}',cand);
 assert x->>'outcome'='conflict' and (x->>'charged')::int=0 and x->'recovery'->'candidate'=cand,'stale revision: no write, no charge, candidate kept';
 assert (select current_version from public.artifacts where id=a)=7,'project untouched by the stale change';
 begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'image_edit',hash,0,20); raise exception 'stale step began'; exception when sqlstate 'PT409' then null; end;
 update public.artifacts set current_version=0 where id=a;
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'image_edit','medium',hash,0,20,rate,jsonb_build_object('task',jsonb_build_object('inputs','[]'::jsonb,'projectId',scope->'projectId','clientId',scope->'clientId')));
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'image_edit',hash,0,20); run:=x->'run';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,30000,'saved','{"finished":true}',cand);
 assert x->>'outcome'='saved' and (x->'result'->>'version')::int=1 and (x->>'charged')::int=1,'current revision: change applied once';
 raise notice 'PASS agency F: stale expected revision refuses the write and the next step; current revision applies';

 -- G. An artifact version is an input by id + version; a moved version is stale.
 x:=public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','artifact_version','id',(select id from public.artifact_versions where artifact_id=a and version_number=1),'version',1)));
 assert x->'inputs'->0->>'sha256' ~ '^[a-f0-9]{64}$','artifact version digest computed server-side';
 begin perform public.makeborne_agency_task_scope(u,a,jsonb_build_array(jsonb_build_object('kind','artifact_version','id',(select id from public.artifact_versions where artifact_id=a and version_number=1),'version',2))); raise exception 'wrong version'; exception when sqlstate 'PT409' then null; end;

 -- H. A source changed between steps: the next step is refused before any hold.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,1,40,rate,task_ctx);
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'research',hash,1,40); run:=x->'run';
 perform public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'incomplete','{}',null);
 update public.sources set content='Edited brochure text' where id=s;
 select count(*) into holds from makeborne_private.credit_reservations where user_id=u;
 begin perform public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'research',hash,1,40); raise exception 'changed source admitted'; exception when sqlstate 'PT409' then null; end;
 assert (select count(*) from makeborne_private.credit_reservations where user_id=u)=holds,'no hold for a stale input';
 update public.sources set content='Approved brochure text' where id=s;
 raise notice 'PASS agency G/H: artifact-version inputs pinned; changed source refuses the next step with no hold';

 -- I. Crash/retry boundary and expired holds: no fresh allowance for the same step.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,1,40,rate,task_ctx);
 step:=gen_random_uuid();
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'research',hash,1,40); run:=x->'run';
 call_id:=gen_random_uuid();
 perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture-model',300000);
 -- The worker dies mid-call; its lease passes.
 update makeborne_private.ai_operation_runs set expires_at=clock_timestamp()-interval '1 second' where id=(run->>'id')::uuid;
 begin perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture-model',1000); raise exception 'expired lease called'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_ai_operation_heartbeat(u,(run->>'id')::uuid,(run->>'fence')::uuid,'{"stage":"late"}',true);
 assert not (x->>'active')::boolean and not (x->>'renewed')::boolean,'an expired lease cannot be renewed';
 replay:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'research',hash,1,40);
 assert (replay->>'replayed')::boolean and replay->'result'->>'code'='OPERATION_EXPIRED' and (replay->'result'->>'charged')::int=0,'retrying the same step returns the recorded expiry, not a new run';
 assert (select status from makeborne_private.live_provider_calls where id=call_id)='open','the in-flight attempt stays recorded for the operator sweep';
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'research',hash,1,40); run2:=x->'run';
 assert (x->'operation'->>'providerRemainingMicrousd')::bigint=40*rate-300000,'a new step inherits the reduced allowance: the unknown attempt keeps its bound';
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,0,'result','{}',jsonb_build_object('data',jsonb_build_object('summary','late')));
 assert x->>'outcome'='expired' and (x->>'charged')::int=0 and x->'recovery'->'candidate'->'data'->>'summary'='late','late worker result is kept for recovery and never charged';
 -- A credit hold past its fixed lifetime stops the second run too.
 update makeborne_private.credit_reservations set created_at=created_at-interval '16 minutes' where user_id=u and reference=run2->>'reference';
 begin perform public.makeborne_ai_operation_provider_begin(u,(run2->>'id')::uuid,(run2->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture-model',1000); raise exception 'expired hold called'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_ai_operation_heartbeat(u,(run2->>'id')::uuid,(run2->>'fence')::uuid,null,true);
 assert not (x->>'active')::boolean,'heartbeat reports the expired hold';
 x:=public.makeborne_ai_operation_finish(u,(run2->>'id')::uuid,(run2->>'fence')::uuid,0,'incomplete','{}',null);
 assert x->>'outcome'='expired' and (x->>'charged')::int=0,'expired hold settles as expired with no charge';
 x:=public.makeborne_ai_operation_recover(u,(run->>'id')::uuid,1);
 assert x->'result'->'data'->>'summary'='late' and (x->'result'->>'charged')::int=0 and (select current_version from public.artifacts where id=a)=1,'data recovery records without writing or charging';
 raise notice 'PASS agency I: expired lease/hold refuse calls and renewal; same-step retry replays expiry; uncertain bound carried; late result recoverable uncharged';

 -- J. Stop: no new paid call or renewal; in-flight call reported; confirmed cost only.
 op:=public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'research','medium',hash,1,40,rate,task_ctx);
 x:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'research',hash,1,40); run:=x->'run';
 call_id:=gen_random_uuid();
 perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,call_id,'anthropic','fixture-model',200000);
 x:=public.makeborne_ai_operation_heartbeat(u,(run->>'id')::uuid,(run->>'fence')::uuid,'{"stage":"reading","done":1,"of":3}',true);
 assert (x->>'active')::boolean and not (x->>'renewed')::boolean,'a paying run cannot outlive its credit hold';
 assert (select progress->>'stage' from makeborne_private.ai_operation_runs where id=(run->>'id')::uuid)='reading','durable progress recorded';
 begin perform public.makeborne_ai_operation_heartbeat(u,(run->>'id')::uuid,gen_random_uuid(),null,false); raise exception 'heartbeat without fence'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_heartbeat(stranger,(run->>'id')::uuid,(run->>'fence')::uuid,null,false); raise exception 'stranger heartbeat'; exception when sqlstate 'P0002' then null; end;
 begin perform public.makeborne_ai_operation_heartbeat(u,(run->>'id')::uuid,(run->>'fence')::uuid,jsonb_build_object('x',repeat('y',5000)),false); raise exception 'oversized progress'; exception when sqlstate '22023' then null; end;
 x:=public.makeborne_ai_operation_cancel(u,(op->>'id')::uuid,(op->>'revision')::int);
 assert (x->'operation'->>'cancelRequested')::boolean,'Stop recorded';
 begin perform public.makeborne_ai_operation_provider_begin(u,(run->>'id')::uuid,(run->>'fence')::uuid,gen_random_uuid(),'anthropic','fixture-model',1000); raise exception 'paid call after Stop'; exception when sqlstate 'MB499' then null; end;
 x:=public.makeborne_ai_operation_heartbeat(u,(run->>'id')::uuid,(run->>'fence')::uuid,null,true);
 assert not (x->>'active')::boolean and (x->>'cancelRequested')::boolean,'heartbeat tells the worker to stop tool actions';
 x:=public.makeborne_ai_operation_progress(u,w,a,(op->>'id')::uuid);
 assert (x->'calls'->>'inProgress')::int=1 and (x->'operation'->>'cancelRequested')::boolean,'reload shows the call still finishing after Stop';
 perform public.makeborne_provider_call_finish(call_id,60000,60000,'{}');
 x:=public.makeborne_ai_operation_finish(u,(run->>'id')::uuid,(run->>'fence')::uuid,60000,'result','{}',jsonb_build_object('data',jsonb_build_object('summary','after stop')));
 assert x->>'outcome'='cancelled' and (x->>'charged')::int=2 and x->'recovery'->'candidate'->'data'->>'summary'='after stop','charged its confirmed cost only; result kept, not auto-applied';
 assert (public.makeborne_ai_operation_progress(u,w,a,(op->>'id')::uuid)->'calls'->>'inProgress')::int=0,'nothing in flight afterwards';
 raise notice 'PASS agency J: Stop blocks paid calls and renewal, reports the in-flight call truthfully, charges confirmed cost only';

 -- K. Lease renewal for an exempt account stays within the operation and 60 minutes.
 op:=public.makeborne_ai_operation_create(boss,wb,ab,gen_random_uuid(),'data_report','medium',hash,0,20,rate,jsonb_build_object('task',jsonb_build_object('inputs','[]'::jsonb,'projectId',to_jsonb(pb::text),'clientId','null'::jsonb)));
 x:=public.makeborne_ai_operation_begin(boss,(op->>'id')::uuid,gen_random_uuid(),'data_report',hash,0,20); run:=x->'run';
 assert (run->>'exempt')::boolean,'exempt run';
 update makeborne_private.ai_operation_runs set expires_at=clock_timestamp()+interval '1 minute' where id=(run->>'id')::uuid;
 x:=public.makeborne_ai_operation_heartbeat(boss,(run->>'id')::uuid,(run->>'fence')::uuid,null,true);
 assert (x->>'renewed')::boolean and (x->>'expiresAt')::timestamptz>clock_timestamp()+interval '14 minutes','exempt lease renewed';
 update makeborne_private.ai_operations set expires_at=clock_timestamp()+interval '5 minutes' where id=(op->>'id')::uuid;
 update makeborne_private.ai_operation_runs set expires_at=clock_timestamp()+interval '1 minute' where id=(run->>'id')::uuid;
 x:=public.makeborne_ai_operation_heartbeat(boss,(run->>'id')::uuid,(run->>'fence')::uuid,null,true);
 assert (x->>'expiresAt')::timestamptz<=(select expires_at from makeborne_private.ai_operations where id=(op->>'id')::uuid),'renewal never passes the operation expiry';
 update makeborne_private.ai_operations set expires_at=clock_timestamp()+interval '20 hours' where id=(op->>'id')::uuid;
 update makeborne_private.ai_operation_runs set created_at=clock_timestamp()-interval '59 minutes',expires_at=clock_timestamp()+interval '30 seconds' where id=(run->>'id')::uuid;
 x:=public.makeborne_ai_operation_heartbeat(boss,(run->>'id')::uuid,(run->>'fence')::uuid,null,true);
 assert (x->>'expiresAt')::timestamptz<=clock_timestamp()+interval '61 seconds','renewal never passes 60 minutes from the run start';
 raise notice 'PASS agency K: exempt renewal bounded by operation expiry and the 60-minute ceiling';

 -- L. Service-only entry points.
 assert not has_function_privilege('authenticated','public.makeborne_agency_task_scope(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.makeborne_ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean)','execute')
  and not has_function_privilege('authenticated','makeborne_private.ai_operation_progress(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','makeborne_private.ai_operation_agency_kind(text)','execute')
  and has_function_privilege('service_role','public.makeborne_ai_operation_heartbeat(uuid,uuid,uuid,jsonb,boolean)','execute')
  and has_function_privilege('service_role','public.makeborne_ai_operation_progress(uuid,uuid,uuid,uuid)','execute'),'service-only grants';
 raise notice 'PASS agency L: new entry points are service-only';
end $$;
rollback;
