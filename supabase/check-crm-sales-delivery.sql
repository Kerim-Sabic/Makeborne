-- Sales/delivery split and CRM transition checks. LOCAL DATABASE ONLY.
-- Every part runs in a rolled-back transaction and leaves no data behind.
-- Real-session concurrency is in check-crm-concurrency.sql, which runs only in
-- an isolated database (it commits and contracts/rolls back all clients).
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-crm-sales-delivery.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); reviewer_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  ws uuid; art uuid; art2 uuid; n integer; r jsonb; t timestamptz:=clock_timestamp();
  p_review uuid; p_approved uuid; p_changes uuid; p_changes_then_ok uuid; p_draft uuid; p_published uuid;
begin
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into auth.users(id,email,email_confirmed_at)
  select id,id::text||'@crm.example.invalid',t from unnest(array[owner_id,editor_id,reviewer_id,outsider_id]) id;
  insert into public.workspaces(name,owner_id) values('CRM split',owner_id) returning id into ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,editor_id,'editor'),(ws,reviewer_id,'reviewer');

  -- ---- A. Project delivery backfill: audited, idempotent, status preserved.
  insert into public.projects(workspace_id,title,kind,status) values(ws,'In review','website','review') returning id into p_review;
  insert into public.projects(workspace_id,title,kind,status) values(ws,'Approved','book','approved') returning id into p_approved;
  insert into public.projects(workspace_id,title,kind,status) values(ws,'Changes','website','in_progress') returning id into p_changes;
  insert into public.projects(workspace_id,title,kind,status) values(ws,'Changes then fine','website','in_progress') returning id into p_changes_then_ok;
  insert into public.projects(workspace_id,title,kind,status) values(ws,'Draft','website','draft') returning id into p_draft;
  insert into public.projects(workspace_id,title,kind,status) values(ws,'Published','website','published') returning id into p_published;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(ws,p_changes,'website','Changes',0) returning id into art;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(ws,p_changes_then_ok,'website','Changes then fine',0) returning id into art2;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,expires_at,created_by,decision,decision_name,decided_at,created_at) values
    (ws,p_changes,art,sha256('a'),t+interval '7 days',owner_id,'changes_requested','Jane',t,t),
    (ws,p_changes_then_ok,art2,sha256('b'),t+interval '7 days',owner_id,'changes_requested','Jane',t-interval '2 days',t-interval '3 days'),
    (ws,p_changes_then_ok,art2,sha256('c'),t+interval '7 days',owner_id,'approved','Jane',t-interval '1 day',t-interval '3 days');
  r := makeborne_private.crm_backfill_project_delivery();
  assert (select count(*) from makeborne_private.crm_migration_audit where action='project_delivery_backfill' and workspace_id=ws)=3, 'Backfill audit rows';
  assert (select delivery_stage from public.projects where id=p_review)='in_review', 'review -> in_review';
  assert (select delivery_stage from public.projects where id=p_approved)='delivered', 'approved -> delivered';
  assert (select delivery_stage from public.projects where id=p_changes)='changes_requested', 'latest change request -> changes_requested';
  assert (select delivery_stage from public.projects where id=p_changes_then_ok)='active', 'An older change request must not beat a later approval';
  assert (select delivery_stage from public.projects where id=p_draft)='active' and (select delivery_stage from public.projects where id=p_published)='active', 'Lifecycle-only statuses stay active';
  assert (select count(*) from public.projects where workspace_id=ws and status in ('review','approved'))=2, 'projects.status must be preserved';
  assert (select old_value||'>'||new_value from makeborne_private.crm_migration_audit where entity_id=p_approved)='status:approved>delivered', 'Audit content';
  assert (makeborne_private.crm_backfill_project_delivery()->>'projects')::int=0, 'Project backfill not idempotent';
  raise notice 'PASS A project delivery backfill: mapped, audited, idempotent, status preserved';

  -- ---- E. Delivery stage edits: editors only, values checked.
  perform set_config('request.jwt.claims',json_build_object('sub',editor_id,'role','authenticated')::text,true);
  set local role authenticated;
  update public.projects set delivery_stage='in_review' where id=p_draft;
  get diagnostics n=row_count; assert n=1, 'Editor could not set delivery stage';
  begin update public.projects set delivery_stage='shipped' where id=p_draft; raise exception 'Invalid delivery stage accepted';
  exception when check_violation then null; end;
  reset role;
  foreach r in array array[json_build_object('sub',reviewer_id,'role','authenticated'),json_build_object('sub',outsider_id,'role','authenticated')]::jsonb[] loop
    perform set_config('request.jwt.claims',r::text,true);
    set local role authenticated;
    update public.projects set delivery_stage='delivered' where id=p_draft;
    get diagnostics n=row_count; assert n=0, 'Non-editor changed a delivery stage';
    reset role;
  end loop;
  raise notice 'PASS E delivery stage permissions';
end $$;
rollback;

-- ---- B/C/D/H. Expand storage, contract, rollback, provenance and repeated cycles.
begin;
do $$
declare
  -- Clients already in the database (for example a populated rehearsal) are counted on top of this check's own.
  pre_legacy integer := (select count(*) from public.clients where outreach->>'stage' in ('Replied','Meeting','Review','Delivered'));
  owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); ws uuid; r jsonb; n integer; t timestamptz:=clock_timestamp(); i integer;
  c_old_replied uuid; c_old_meeting uuid; c_new_conv uuid; c_full uuid; c_review uuid; c_changed uuid; c_reconv uuid; c_lead uuid;
  history jsonb := '[{"id":"6f1c2b7e-1d1a-4c55-9a3b-0c9c6d1e2f30","at":"2026-10-01T09:00:00.000Z","text":"Intro call","type":"contact"}]';
  base jsonb := '{"stage":"Lead","channel":"Email","profileUrl":"","lastContact":null,"nextFollowUp":"2020-01-01","notes":"","activity":[]}';
  full_history jsonb; new_app text := '{"x-makeborne-crm-protocol":"2"}'; old_server text := '{"accept":"application/json"}';
begin
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  update makeborne_private.crm_transition set mode='expand', min_client_protocol=0, frozen=false where singleton;
  insert into auth.users(id,email,email_confirmed_at) select id,id::text||'@crm2.example.invalid',t from unnest(array[owner_id,editor_id]) id;
  insert into public.workspaces(name,owner_id) values('CRM transition',owner_id) returning id into ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,editor_id,'editor');
  select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'at','2026-10-01T09:00:00.000Z','text','Note '||g,'type','note')) into full_history from generate_series(1,300) g;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Old Replied',jsonb_set(jsonb_set(base,'{stage}','"Replied"'),'{activity}',history)) returning id into c_old_replied;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Old Meeting',jsonb_set(base,'{stage}','"Meeting"')) returning id into c_old_meeting;
  insert into public.clients(workspace_id,name,outreach) values(ws,'New Conversation',jsonb_set(base,'{stage}','"Contacted"')) returning id into c_new_conv;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Full Meeting',jsonb_set(jsonb_set(base,'{stage}','"Meeting"'),'{activity}',full_history)) returning id into c_full;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Changed after contract',jsonb_set(base,'{stage}','"Meeting"')) returning id into c_changed;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Reconversation',jsonb_set(base,'{stage}','"Meeting"')) returning id into c_reconv;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Lead co',base) returning id into c_lead;
  set local session_replication_role = replica; -- written only by the pre-release review flow
  insert into public.clients(workspace_id,name,outreach) values(ws,'Old Review',jsonb_set(base,'{stage}','"Review"')) returning id into c_review;
  set local session_replication_role = origin;

  -- B. Expand: both app versions write safely; storage stays in the previous app's vocabulary.
  perform set_config('request.jwt.claims',json_build_object('sub',editor_id,'role','authenticated')::text,true);
  perform set_config('request.headers',old_server,true);
  set local role authenticated;
  update public.clients set outreach=jsonb_set(outreach,'{notes}','"old app edit"') where id=c_old_meeting;   -- previous app keeps Meeting
  get diagnostics n=row_count; assert n=1, 'Previous app write rejected in expand mode';
  perform set_config('request.headers',new_app,true);
  -- New app re-saves a Meeting client (stage normalised to Conversation in the UI, notes edited).
  update public.clients set outreach=jsonb_set(jsonb_set(outreach,'{stage}','"Conversation"'),'{notes}','"new app edit"') where id=c_old_meeting;
  -- New app moves a Contacted client to Conversation.
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Conversation"') where id=c_new_conv;
  -- New app saves the full-history client: history must stay intact.
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Conversation"') where id=c_full;
  begin update public.clients set outreach=jsonb_set(outreach,'{stage}','"Review"') where id=c_lead; raise exception 'Review accepted';
  exception when sqlstate '22023' then null; end;
  reset role;
  assert (select outreach->>'stage'='Meeting' and outreach->>'notes'='new app edit' from public.clients where id=c_old_meeting), 'Meeting provenance lost on an ordinary save';
  assert (select outreach->>'stage' from public.clients where id=c_new_conv)='Replied', 'New-app Conversation must be stored as Replied in expand mode';
  assert (select outreach->>'stage'='Meeting' and outreach->'activity'=full_history from public.clients where id=c_full), 'Full-history client changed';
  assert (select count(*) from makeborne_private.crm_migration_audit where action='client_stage_compat' and workspace_id=ws)=3, 'Every compat translation audited';
  assert (select count(*) from makeborne_private.crm_migration_audit where action='client_stage_change' and entity_id=c_old_meeting)=0, 'A no-op stage save recorded as a change';
  assert (select old_value||'>'||new_value from makeborne_private.crm_migration_audit where action='client_stage_change' and entity_id=c_new_conv)='Contacted>Replied', 'Intentional change not recorded';
  assert not exists(select 1 from public.clients where workspace_id=ws and outreach->>'stage'='Conversation'), 'Expand mode stored Conversation';
  r := public.makeborne_client_directory(ws,'','Conversation','all',current_date,0);
  assert (r->'pagination'->>'total')::int=6, 'Conversation filter in expand: '||(r->'pagination');
  raise notice 'PASS B expand: previous-app writes accepted, new-app Conversation stored compatibly with provenance, audited, history intact';

  -- C. Contract only while frozen; legacy closed; cutoff on.
  begin perform makeborne_private.crm_contract_client_stages(); raise exception 'Contract ran unfrozen';
  exception when sqlstate 'MB409' then null; end;
  perform makeborne_private.crm_freeze_writes('contract');
  perform set_config('request.jwt.claims',json_build_object('sub',editor_id,'role','authenticated')::text,true);
  perform set_config('request.headers',new_app,true);
  set local role authenticated;
  begin update public.clients set outreach=jsonb_set(outreach,'{notes}','"during freeze"') where id=c_lead; raise exception 'Write accepted while frozen';
  exception when sqlstate 'MB423' then null; end;
  reset role;
  r := makeborne_private.crm_contract_client_stages();
  assert (r->>'clients')::int=7+pre_legacy and (r->>'historyFull')::int=1 and (r->>'consistent')::boolean and r->>'mode'='contracted', 'Contract: '||r::text;
  assert (select outreach->>'stage'='Conversation' and outreach->'activity'=full_history from public.clients where id=c_full), 'Contract altered a full history';
  assert (select history_logged=false from makeborne_private.crm_migration_audit where entity_id=c_full and action='client_stage_contract'), 'Full-history contract not audit-only';
  r := makeborne_private.crm_resume_writes();
  assert not (r->>'frozen')::boolean, 'Resume failed';
  perform set_config('request.jwt.claims',json_build_object('sub',editor_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform set_config('request.headers',old_server,true);
  begin update public.clients set outreach=jsonb_set(outreach,'{notes}','"old server"') where id=c_lead; raise exception 'Out-of-date server write accepted after contract';
  exception when sqlstate 'MB426' then null; end;
  perform set_config('request.headers',new_app,true);
  begin update public.clients set outreach=jsonb_set(outreach,'{stage}','"Meeting"') where id=c_lead; raise exception 'Legacy stage accepted after contract';
  exception when sqlstate '22023' then null; end;
  -- Ordinary new-app saves after the contract.
  update public.clients set outreach=jsonb_set(outreach,'{notes}','"plain save"') where id=c_old_meeting;      -- no stage change
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Proposal"') where id=c_changed;            -- intentional change
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Proposal"') where id=c_reconv;
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Conversation"') where id=c_reconv;        -- chosen again in the new app
  reset role;
  raise notice 'PASS C contract: requires freeze, freeze blocks writes, cutoff rejects out-of-date servers and legacy stages';

  -- D. Rollback only while frozen; exact provenance; later intentional changes kept.
  begin perform makeborne_private.crm_rollback_client_stages(); raise exception 'Rollback ran unfrozen';
  exception when sqlstate 'MB409' then null; end;
  perform makeborne_private.crm_freeze_writes('rollback');
  r := makeborne_private.crm_rollback_client_stages();
  assert r->>'mode'='expand' and (r->>'minClientProtocol')::int=0 and (r->>'consistent')::boolean, 'Rollback state: '||r::text;
  assert (select outreach->>'stage' from public.clients where id=c_old_meeting)='Meeting', 'Meeting restored exactly (not Replied)';
  assert (select outreach->>'stage' from public.clients where id=c_old_replied)='Replied', 'Replied restored';
  assert (select outreach->>'stage'='Meeting' and outreach->'activity'=full_history from public.clients where id=c_full), 'Full-history Meeting restored, history intact';
  assert (select outreach->>'stage' from public.clients where id=c_new_conv)='Replied', 'Compat-stored Replied restored';
  assert (select outreach->>'stage' from public.clients where id=c_changed)='Proposal', 'Rollback overwrote a later intentional change';
  assert (select outreach->>'stage' from public.clients where id=c_reconv)='Replied', 'A Conversation chosen after the contract maps to Replied';
  assert (select outreach->>'stage' from public.clients where id=c_review)='Won', 'Won kept';
  r := makeborne_private.crm_resume_writes();
  perform set_config('request.headers',old_server,true);
  perform set_config('request.jwt.claims',json_build_object('sub',editor_id,'role','authenticated')::text,true);
  set local role authenticated;
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Meeting"') where id=c_lead;               -- previous app works again
  get diagnostics n=row_count; assert n=1, 'Previous app blocked after rollback';
  reset role;
  raise notice 'PASS D rollback: requires freeze, exact provenance restored, later user changes kept, previous app writes again';

  -- H. Repeated rollforward/rollback cycles keep exact provenance and never drift.
  for i in 1..3 loop
    perform makeborne_private.crm_freeze_writes('contract '||i);
    perform makeborne_private.crm_contract_client_stages();
    perform makeborne_private.crm_resume_writes();
    assert (select outreach->>'stage' from public.clients where id=c_old_meeting)='Conversation', 'cycle contract';
    perform makeborne_private.crm_freeze_writes('rollback '||i);
    perform makeborne_private.crm_rollback_client_stages();
    perform makeborne_private.crm_resume_writes();
    assert (select outreach->>'stage' from public.clients where id=c_old_meeting)='Meeting' and (select outreach->>'stage' from public.clients where id=c_full)='Meeting'
      and (select outreach->>'stage' from public.clients where id=c_changed)='Proposal', 'Provenance drifted in cycle '||i;
  end loop;
  assert (select outreach->'activity'=full_history from public.clients where id=c_full), 'Full history changed over cycles';
  assert (select count(*) from makeborne_private.crm_migration_audit where entity_id=c_full and action in ('client_stage_contract','client_stage_rollback') and not history_logged)=8, 'Every full-history transition audited';
  -- Resume refuses an inconsistent state.
  perform makeborne_private.crm_freeze_writes('inconsistent');
  set local session_replication_role = replica;
  update public.clients set outreach=jsonb_set(outreach,'{stage}','"Conversation"') where id=c_lead;
  set local session_replication_role = origin;
  begin perform makeborne_private.crm_resume_writes(); raise exception 'Resumed an inconsistent state';
  exception when sqlstate 'MB409' then null; end;
  raise notice 'PASS H repeated cycles: exact provenance, history intact, audit complete, inconsistent resume refused';
end $$;
rollback;

-- ---- F. Review decisions move exactly the linked project, atomically, for any reviewer, even during a CRM freeze.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); noplan_id uuid:=gen_random_uuid(); paid_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  ws uuid; foreign_ws uuid; cl uuid; p1 uuid; p2 uuid; pf uuid; art uuid; t timestamptz:=clock_timestamp(); n integer; claims jsonb;
  tok text[]; i integer; link_ids uuid[] := '{}'; link jsonb; client_before jsonb;
begin
  update makeborne_private.billing_settings set free_tier_enabled=false, creation_enabled=true where singleton;
  update makeborne_private.crm_transition set mode='expand', min_client_protocol=0, frozen=false where singleton;
  insert into makeborne_private.billing_access_plans(plan_id,enabled) values('plan_crmcheck1',true) on conflict(plan_id) do update set enabled=true;
  insert into auth.users(id,email,email_confirmed_at)
  select id,id::text||'@crm-review.example.invalid',t from unnest(array[owner_id,noplan_id,paid_id,outsider_id]) id;
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(owner_id,true,false,'Rolled-back check fixture');
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),paid_id,'plan_crmcheck1','ch_crmcheck1','/studio','ready');
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until)
  values('mem_crmcheck1',paid_id,'ch_crmcheck1','user_crmcheck1','plan_crmcheck1','active',t+interval '30 days',now()+interval '4 minutes');
  insert into public.workspaces(name,owner_id) values('Review owner',owner_id) returning id into ws;
  insert into public.workspaces(name,owner_id) values('Foreign',outsider_id) returning id into foreign_ws;
  insert into public.clients(workspace_id,name,outreach) values(ws,'Jane Client',
    '{"stage":"Proposal","channel":"Email","profileUrl":"","lastContact":null,"nextFollowUp":null,"notes":"","activity":[]}') returning id into cl;
  insert into public.projects(workspace_id,client_id,title,kind,status) values(ws,cl,'Field guide','book','in_progress') returning id into p1;
  insert into public.projects(workspace_id,client_id,title,kind,status) values(ws,cl,'Launch site','website','in_progress') returning id into p2;
  insert into public.projects(workspace_id,title,kind,status) values(foreign_ws,'Foreign','book','draft') returning id into pf;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(ws,p1,'book','Field guide',0) returning id into art;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(ws,art,1,'{"schemaVersion":1,"title":"Field guide","kind":"book","sections":[]}','{"id":"editorial","referenceAssetIds":[]}',owner_id);
  update public.artifacts set current_version=1 where id=art;
  select array_agg(left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43)) into tok from generate_series(1,6);
  -- Deliberate: review links keep working during a CRM freeze (they never write clients).
  perform makeborne_private.crm_freeze_writes('review test');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  for i in 1..6 loop
    link := public.makeborne_create_client_review_link(owner_id,ws,art,1,true,sha256(convert_to(tok[i],'UTF8')),7,'Jane','',null);
    link_ids := link_ids || (link->>'id')::uuid;
  end loop;
  reset role;
  client_before := (select outreach from public.clients where id=cl);
  assert (select delivery_stage from public.projects where id=p1)='in_review', 'Sending a link must mark the project in_review';
  assert (select delivery_stage from public.projects where id=p2)='active', 'Sending a link moved another project';

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  perform public.makeborne_decide_client_review(tok[1],1,'Jane','','changes_requested','Warmer cover');
  reset role;
  assert (select delivery_stage from public.projects where id=p1)='changes_requested', 'Anonymous decision did not move the project';

  perform set_config('request.jwt.claims',json_build_object('sub',noplan_id,'role','authenticated')::text,true);
  set local role authenticated;
  assert not makeborne_private.has_creation_membership(), 'Fixture: reviewer must have no plan';
  perform public.makeborne_decide_client_review(tok[2],1,'Jane','','approved','');
  reset role;
  assert (select delivery_stage from public.projects where id=p1)='delivered', 'Plan-less signed-in approval left the project unchanged';

  perform set_config('request.jwt.claims',json_build_object('sub',paid_id,'role','authenticated')::text,true);
  set local role authenticated;
  assert makeborne_private.has_creation_membership(), 'Fixture: reviewer must have a plan';
  perform public.makeborne_decide_client_review(tok[3],1,'Jane','','changes_requested','');
  reset role;
  assert (select delivery_stage from public.projects where id=p1)='changes_requested', 'Paid reviewer decision did not move the project';

  update public.client_review_links set revoked_at=now() where id=link_ids[4];
  update public.client_review_links set created_at=t-interval '10 days', expires_at=t-interval '1 day' where id=link_ids[5];
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  for i in 4..5 loop
    begin perform public.makeborne_decide_client_review(tok[i],1,'Jane','','approved',''); raise exception 'Dead link % decided', i;
    exception when sqlstate 'P0002' then null; end;
  end loop;
  reset role;
  assert (select delivery_stage from public.projects where id=p1)='changes_requested', 'A dead link moved the project';
  assert (select count(*) from public.client_review_links where id = any(link_ids[4:5]) and decision is not null)=0, 'A dead link recorded a decision';

  assert (select outreach from public.clients where id=cl)=client_before and client_before->>'stage'='Proposal', 'A review changed the client';
  assert (select delivery_stage from public.projects where id=p2)='active', 'A review moved the client''s other project';
  assert (select delivery_stage from public.projects where id=pf)='active', 'A review moved a foreign project';
  assert (select count(*) from public.projects where id in (p1,p2) and status='in_progress')=2, 'A review changed projects.status';

  begin perform makeborne_private.project_delivery_advance(ws,pf,'delivered'); raise exception 'Foreign project moved';
  exception when sqlstate 'P0002' then null; end;
  assert (select delivery_stage from public.projects where id=pf)='active', 'Foreign project changed';
  foreach claims in array array['{"role":"anon"}'::jsonb, json_build_object('sub',noplan_id,'role','authenticated')::jsonb] loop
    perform set_config('request.jwt.claims',claims::text,true);
    execute format('set local role %I', claims->>'role');
    begin perform makeborne_private.project_delivery_advance(ws,p1,'delivered'); raise exception 'API role called project_delivery_advance';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;

  perform set_config('request.jwt.claims','{}',true);
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,noplan_id,'editor');
  perform set_config('request.jwt.claims',json_build_object('sub',noplan_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform set_config('makeborne.review_delivery_project',p1::text,true);
  update public.projects set delivery_stage='delivered' where id=p1;
  get diagnostics n=row_count; assert n=0, 'Plan-less editor used the marker to move a project';
  begin
    update public.projects set title='Hijacked', delivery_stage='delivered' where id=p1;
    get diagnostics n=row_count; assert n=0, 'Marker allowed other columns';
  exception when sqlstate 'MB402' then null; end;
  perform set_config('makeborne.review_delivery_project','',true);
  reset role;
  assert (select title='Field guide' and delivery_stage='changes_requested' from public.projects where id=p1), 'Marker abuse changed the project';

  alter table public.projects add constraint crm_check_block_delivered check (delivery_stage <> 'delivered') not valid;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin perform public.makeborne_decide_client_review(tok[6],1,'Jane','','approved',''); raise exception 'Blocked delivery still decided';
  exception when check_violation then null; end;
  reset role;
  alter table public.projects drop constraint crm_check_block_delivered;
  assert (select decision is null from public.client_review_links where id=link_ids[6]), 'Decision recorded although the project did not move';
  assert (select count(*) from public.client_review_comments where link_id=link_ids[6])=0, 'Decision comment recorded although the project did not move';
  assert (select frozen from makeborne_private.crm_transition where singleton), 'Fixture: CRM stayed frozen throughout';
  raise notice 'PASS F decisions (during a CRM freeze): anonymous, plan-less and paid reviewers move only the linked project, atomically; dead links, foreign projects and marker abuse rejected';
end $$;
rollback;
