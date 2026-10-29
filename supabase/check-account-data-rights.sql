-- Account data rights (migration 20261026100000). Disposable fictional fixtures in one
-- transaction that is rolled back. Run on an isolated local stack only:
--   psql -v ON_ERROR_STOP=1 -f supabase/check-account-data-rights.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  a uuid := gen_random_uuid();  -- exporter: owns wa, reviewer in wb
  b uuid := gen_random_uuid();  -- other owner: wb (shared with a and c)
  c uuid := gen_random_uuid();  -- deleted account: owns wc, editor in wb
  d uuid := gen_random_uuid();  -- active subscription
  e uuid := gen_random_uuid();  -- editor with saved work in wb
  wa uuid := gen_random_uuid(); wb uuid := gen_random_uuid(); wc uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pc uuid := gen_random_uuid();
  aa uuid := gen_random_uuid(); ab uuid := gen_random_uuid(); ac uuid := gen_random_uuid();
  ma uuid := gen_random_uuid(); mc uuid := gen_random_uuid(); asset_c uuid := gen_random_uuid(); job_c uuid := gen_random_uuid();
  src text; srcs text[] := array['account','account_privileges','workspaces','workspace_members','clients','contacts','crm_next_steps','crm_suppressions',
    'crm_site_checks','crm_duplicate_dismissals','client_portal_access','client_portal_sites','client_portal_changes','projects','tasks','sources',
    'style_profiles','brand_kits','artifacts','artifact_versions','artifact_plans','assets','reviews','published_releases','client_review_links',
    'client_review_comments','client_review_views','hosted_sites','custom_domains','site_enquiries','site_view_days','generation_jobs','mail_accounts',
    'mail_templates','mail_sequences','mail_enrollments','mail_messages','chat_messages','audit_events','github_connection','github_website_links',
    'billing_memberships','billing_checkouts','plan_payments','plan_periods','membership_revocations','refund_cases','topup_orders','credit_wallet',
    'credit_preferences','credit_ledger','credit_lots','credit_lot_withholds','autotopup_authorizations','autotopup_attempts','ai_operations',
    'export_requests','deletion_requests'];
  everything text := ''; j jsonb; r jsonb; e1 uuid; lease uuid := gen_random_uuid(); lease2 uuid := gen_random_uuid(); del uuid; path text; n bigint; subj uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values(a,a||'@rights.invalid',now()),(b,b||'@rights.invalid',now()),(c,c||'@rights.invalid',now()),(d,d||'@rights.invalid',now()),(e,e||'@rights.invalid',now());
  insert into public.workspaces(id,name,owner_id) values(wa,'A studio',a),(wb,'B studio',b),(wc,'C studio',c);
  insert into public.workspace_members(workspace_id,user_id,role) values(wb,a,'reviewer'),(wb,c,'editor'),(wb,e,'editor');
  insert into public.clients(workspace_id,name,email,notes) values(wa,'A client','client-a@rights.invalid','A notes'),(wb,'B private client','client-b@rights.invalid','B-ONLY-NOTE'),(wc,'C client','client-c@rights.invalid','C notes');
  insert into public.projects(id,workspace_id,title,kind) values(pa,wa,'A project','website'),(pb,wb,'B project','website'),(pc,wc,'C project','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(aa,wa,pa,'A site','website'),(ab,wb,pb,'B site','website'),(ac,wc,pc,'C site','website');
  insert into public.assets(id,workspace_id,project_id,object_path,content_type) values(asset_c,wc,pc,wc||'/'||pc||'/artwork/hero.png','image/png');
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by,asset_manifest) values
    (wa,aa,1,'{"v":"a"}','{}',a,'[]'),(wb,ab,1,'{"v":"b"}','{}',b,'[]'),(wb,ab,2,'{"v":"b by e"}','{}',e,'[]'),(wc,ac,1,'{"v":"c"}','{}',c,jsonb_build_array(asset_c::text));
  insert into public.reviews(workspace_id,version_id,reviewer_id,decision,body) select wb,id,c,'approved','C review in B' from public.artifact_versions where artifact_id=ab and version_number=1;
  insert into public.artifact_chat_messages(id,account_id,workspace_id,artifact_id,role,body) values(gen_random_uuid(),a,wa,aa,'user','A own chat'),(gen_random_uuid(),b,wb,ab,'user','B-PRIVATE-CHAT'),(gen_random_uuid(),c,wb,ab,'user','C chat in B');
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,expires_at,created_by) values(wa,pa,aa,sha256('SECRET-REVIEW'::bytea),now()+interval '30 days',a);
  insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at,accepted_at,user_id) select wc,id,'portal@rights.invalid',sha256('SECRET-PORTAL'::bytea),now()+interval '7 days',now(),d from public.clients where workspace_id=wc;
  insert into public.mail_accounts(id,workspace_id,user_id,provider,email) values(ma,wa,a,'google','a-mail@rights.invalid'),(mc,wc,c,'google','c-mail@rights.invalid');
  insert into makeborne_private.mail_tokens(account_id,refresh_token,access_token) values(ma,'SECRET-REFRESH-A','SECRET-ACCESS-A'),(mc,'SECRET-REFRESH-C','SECRET-ACCESS-C');
  insert into public.github_connections(user_id,github_user_id,login,token_ciphertext,refresh_ciphertext,refresh_expires_at,expires_at) values(a,1,'a-login','SECRET-CIPHER-A','SECRET-RCIPHER-A',now()+interval '30 days',now()+interval '1 hour'),(c,2,'c-login','SECRET-CIPHER-C',null,null,now()+interval '1 hour');
  insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status,purchase_url) values(gen_random_uuid(),a,'plan_rights','ch_rightsA','/studio','ready','https://example.invalid/SECRET-CHECKOUT-URL'),
    (gen_random_uuid(),c,'plan_rights','ch_rightsC','/studio','ready',null),(gen_random_uuid(),d,'plan_rights','ch_rightsD','/studio','ready',null);
  insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until) values
    ('mem_rightsA',a,'ch_rightsA','user_a','plan_rights','canceled',now()-interval '1 day','1970-01-01'),('mem_rightsC',c,'ch_rightsC','user_c','plan_rights','canceled',now()-interval '1 day','1970-01-01'),
    ('mem_rightsD',d,'ch_rightsD','user_d','plan_rights','active',now()+interval '20 days',now());
  insert into makeborne_private.plan_payments(payment_id,user_id,membership_id,plan_id,billing_reason,currency,principal_cents,refunded_cents,dispute,paid_at,state,evidence,observed_at)
    values('pay_rightsC',c,'mem_rightsC','plan_rights','subscription_create','usd',2000,0,'none',now()-interval '20 days','funded','{"note":"SECRET-EVIDENCE"}',now()),
          ('pay_rightsA',a,'mem_rightsA','plan_rights','subscription_create','usd',2000,0,'none',now()-interval '20 days','funded','{"note":"SECRET-EVIDENCE"}',now());
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values(c,300,'trial','rights-c',300),(a,300,'trial','rights-a',300);
  insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id) values(ac,wc,c,'rights-check-c-site',1,'<!doctype html><html><body>c</body></html>',true,gen_random_uuid());
  insert into makeborne_hosting.site_routes(artifact_id,path,html,isolated_html) values(ac,'/about','<p>c</p>','<!doctype html>c');
  insert into public.custom_domains(workspace_id,artifact_id,hostname,status,cloudflare_id,created_by) values(wc,ac,'www.rights-c.invalid','active','cf_rights_c',c);
  insert into public.generation_jobs(id,workspace_id,project_id,kind,status,idempotency_key) values(job_c,wc,pc,'website','succeeded','rights-'||gen_random_uuid());
  insert into public.usage_ledger(workspace_id,job_id,event_key,amount_microusd,provider,model,reason) values(wc,job_c,'rights-event',1200,'vendor','model','legacy_usage');
  insert into makeborne_private.live_provider_calls(id,run_reference,user_id,provider,model,day,bound_microusd) values(gen_random_uuid(),'rights-run',c,'anthropic','fixture-model',current_date,10);

  -- ===== Export: complete, scoped, no secrets =====
  foreach src in array srcs loop
    j := public.makeborne_account_export_rows(a, src, 0, 1000);
    assert jsonb_typeof(j) = 'array', 'source not an array: '||src;
    everything := everything || j::text;
  end loop;
  assert everything like '%A client%' and everything like '%A own chat%' and everything like '%a-login%', 'owned data missing';
  assert everything not like '%B private client%' and everything not like '%B-ONLY-NOTE%' and everything not like '%B-PRIVATE-CHAT%' and everything not like '%"b"%', 'cross-workspace leak (reviewer saw owner data)';
  assert everything not like '%SECRET-%' and everything not like '%'||encode(sha256('SECRET-REVIEW'::bytea),'hex')||'%' and everything not like '%token_hash%', 'secret leaked into export';
  assert everything not like '%'||c||'%', 'another account id leaked';
  j := public.makeborne_account_export_rows(a, 'workspaces');
  assert jsonb_array_length(j) = 2 and j::text like '%reviewer%', 'membership not listed';
  assert jsonb_array_length(public.makeborne_account_export_rows(a, 'mail_accounts')) = 1;
  assert jsonb_array_length(public.makeborne_account_export_rows(a, 'plan_payments')) = 1 and public.makeborne_account_export_rows(a, 'plan_payments')::text not like '%evidence%';
  assert jsonb_array_length(public.makeborne_account_export_rows(b, 'chat_messages')) = 1, 'B sees only own chat';
  assert jsonb_array_length(public.makeborne_account_export_rows(a, 'clients', 1, 10)) = 0, 'paging';
  begin perform public.makeborne_account_export_rows(a, 'mail_tokens'); raise exception 'unknown source accepted';
  exception when invalid_parameter_value then null; end;
  raise notice 'PASS export complete and scoped: owned rows present, reviewer/other-workspace/other-account data and secrets absent';

  -- ===== Export lifecycle: rate limit, lease, link expiry, cross-account refusal =====
  j := public.makeborne_account_export_request(a, '00000000-0000-4000-8000-000000000001'); assert j->>'status' = 'queued'; e1 := (j->>'id')::uuid;
  assert public.makeborne_account_export_request(a, '00000000-0000-4000-8000-000000000001')->>'status' = 'existing';
  assert public.makeborne_account_export_request(a, '00000000-0000-4000-8000-000000000002')->>'status' = 'in_progress';
  j := public.makeborne_account_export_claim(lease, e1); assert (j->>'userId')::uuid = a;
  assert public.makeborne_account_export_claim(gen_random_uuid(), e1) is null, 'double claim';
  begin perform public.makeborne_account_export_complete(e1, gen_random_uuid(), '[{"part":1,"path":"x","bytes":1}]', '{}'); raise exception 'foreign lease completed';
  exception when sqlstate 'MBD10' then null; end;
  perform public.makeborne_account_export_complete(e1, lease, jsonb_build_array(jsonb_build_object('part',1,'path',a||'/'||e1||'/part-1.zip','bytes',10)), '{"clients":1}', 72);
  assert public.makeborne_account_export_part(a, e1, 1) = a||'/'||e1||'/part-1.zip';
  assert public.makeborne_account_export_part(b, e1, 1) is null, 'cross-account download';
  assert public.makeborne_account_export_part(a, e1, 2) is null;
  assert public.makeborne_account_export_request(a, '00000000-0000-4000-8000-000000000003')->>'status' = 'limited', 'rate limit';
  update makeborne_private.account_export_requests set expires_at = now() - interval '1 minute' where id = e1;
  assert public.makeborne_account_export_part(a, e1, 1) is null, 'expired link still served';
  assert public.makeborne_account_rights_status(a)->'exports'->0->>'state' = 'expired';
  assert public.makeborne_account_export_due_expiry(10)::text like '%'||e1||'%';
  perform public.makeborne_account_export_mark_expired(e1);
  assert (select state from makeborne_private.account_export_requests where id = e1) = 'expired';
  update makeborne_private.account_export_requests set requested_at = now() - interval '2 days' where id = e1;
  j := public.makeborne_account_export_request(a, '00000000-0000-4000-8000-000000000004'); assert j->>'status' = 'queued', 'next day allowed';
  update makeborne_private.account_export_requests set state='building', lease=gen_random_uuid(), lease_until=now()-interval '1 minute', attempts=3 where id=(j->>'id')::uuid;
  perform public.makeborne_account_export_claim(gen_random_uuid());
  assert (select failure_code from makeborne_private.account_export_requests where id=(j->>'id')::uuid) = 'ATTEMPTS_EXHAUSTED';
  raise notice 'PASS export idempotency, one-a-day limit, lease, cross-account refusal, link expiry and bounded retries';

  -- ===== Deletion blockers =====
  j := public.makeborne_account_deletion_request(d, gen_random_uuid(), 7);
  assert j->>'status' = 'refused' and j->'blockers' ? 'ACTIVE_SUBSCRIPTION', 'active subscription not blocking';
  j := public.makeborne_account_deletion_request(b, gen_random_uuid(), 7);
  assert j->>'status' = 'refused' and j->'blockers' ? 'SHARED_WORKSPACE', 'shared workspace not blocking';
  insert into makeborne_private.account_legal_holds(user_id, reason) values(a, 'fixture hold');
  assert public.makeborne_account_deletion_request(a, gen_random_uuid(), 7)->'blockers' ? 'ACCOUNT_HOLD';
  assert public.makeborne_account_deletion_request(e, gen_random_uuid(), 7)->'blockers' ? 'SHARED_CONTRIBUTIONS', 'saved work in another workspace not blocking';
  assert not exists(select 1 from makeborne_private.account_deletion_requests where user_id in (b, d, a, e)), 'refused request recorded';
  raise notice 'PASS deletion blocked by active subscription, shared workspace and hold';

  -- ===== Grace period and cancellation =====
  j := public.makeborne_account_deletion_request(c, '00000000-0000-4000-8000-0000000000c1', 7);
  assert j->>'status' = 'scheduled'; del := (j->>'id')::uuid;
  assert (j->>'scheduledFor')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour', 'grace period';
  assert public.makeborne_account_deletion_request(c, gen_random_uuid(), 7)->>'status' = 'scheduled', 'idempotent while scheduled';
  assert public.makeborne_account_deletion_claim(lease, del) is null, 'claimed before grace ended';
  assert public.makeborne_account_deletion_cancel(b)->>'status' = 'none', 'cross-account cancel';
  assert public.makeborne_account_deletion_cancel(c)->>'status' = 'cancelled';
  assert public.makeborne_account_deletion_request(c, '00000000-0000-4000-8000-0000000000c1', 7)->>'status' = 'replayed', 'cancelled key resurrected';
  j := public.makeborne_account_deletion_request(c, gen_random_uuid(), 7); del := (j->>'id')::uuid;
  assert public.makeborne_account_rights_status(c)->'deletion'->>'cancellable' = 'true';
  raise notice 'PASS seven-day grace, idempotent schedule, cancellation and cross-account refusal';

  -- ===== Deletion job =====
  update makeborne_private.account_deletion_requests set scheduled_for = now() - interval '1 minute' where id = del;
  j := public.makeborne_account_deletion_claim(lease, del); assert (j->>'userId')::uuid = c; subj := (j->>'subjectRef')::uuid;
  begin perform public.makeborne_account_deletion_step(del, lease, 'erase'); raise exception 'erase before recheck';
  exception when sqlstate 'MBD11' then null; end;
  assert public.makeborne_account_deletion_step(del, lease, 'recheck')->>'outcome' = 'done';
  perform public.makeborne_account_deletion_mark(del, lease, 'lock');
  assert public.makeborne_account_deletion_cancel(c)->>'status' = 'started', 'cancel after start';
  perform public.makeborne_account_deletion_step(del, lease, 'unpublish');
  assert not (select live from public.hosted_sites where artifact_id = ac), 'site still live';
  assert not exists(select 1 from makeborne_hosting.site_routes where artifact_id = ac), 'routes still served';
  assert (select revoked_at is not null from public.client_portal_access where workspace_id = wc), 'portal login still open';
  assert public.makeborne_account_deletion_step(del, lease, 'unpublish')->>'outcome' = 'done', 'step not idempotent';
  assert public.makeborne_account_deletion_domains(del, lease)::text like '%cf_rights_c%';
  -- Resume with a new lease after the first worker stops.
  perform public.makeborne_account_deletion_release(del, lease, 'WORKER_STOPPED');
  j := public.makeborne_account_deletion_claim(lease2, del); assert j->'steps' ?& array['recheck','lock','unpublish'], 'progress lost on resume';
  begin perform public.makeborne_account_deletion_step(del, lease, 'disconnect'); raise exception 'stale lease accepted';
  exception when sqlstate 'MBD10' then null; end;
  perform public.makeborne_account_deletion_mark(del, lease2, 'domains');
  perform public.makeborne_account_deletion_step(del, lease2, 'disconnect');
  assert not exists(select 1 from makeborne_private.mail_tokens where account_id = mc), 'mail token kept';
  assert exists(select 1 from makeborne_private.mail_tokens where account_id = ma), 'another account mailbox touched';
  assert not exists(select 1 from public.github_connections where user_id = c) and exists(select 1 from public.github_connections where user_id = a);
  perform public.makeborne_account_deletion_step(del, lease2, 'retain');
  perform public.makeborne_account_deletion_step(del, lease2, 'retain');
  select count(*) into n from makeborne_private.retained_account_records where subject_ref = subj and source_table in ('plan_payments','credit_ledger','billing_memberships','usage_ledger');
  assert n = 4, 'financial/accounting records not retained: '||n;
  assert not exists(select 1 from makeborne_private.retained_account_records where subject_ref = subj and record::text like '%'||c||'%'), 'retained record not pseudonymized';
  -- Research counters (20261026120100) carry the actor id without a foreign key: the erase removes the account's own only.
  if to_regclass('makeborne_private.research_daily_uses') is not null then
    execute 'insert into makeborne_private.research_daily_uses(actor_id, workspace_id, kind) values ($1, $2, ''site_check''), ($3, $4, ''client_research'')' using c, wc, a, wb;
  end if;
  perform public.makeborne_account_deletion_step(del, lease2, 'erase');
  if to_regclass('makeborne_private.research_daily_uses') is not null then
    execute 'select count(*) from makeborne_private.research_daily_uses where actor_id = $1' into n using c; assert n = 0, 'research counter kept for the deleted account';
    execute 'select count(*) from makeborne_private.research_daily_uses where actor_id = $1' into n using a; assert n = 1, 'another account research counter touched';
  end if;
  assert not exists(select 1 from public.workspaces where id = wc) and not exists(select 1 from public.clients where workspace_id = wc), 'owned workspace kept';
  assert not exists(select 1 from public.usage_ledger where workspace_id = wc);
  assert (select reviewer_id from public.reviews where body = 'C review in B') = b, 'shared review not handed to owner';
  assert exists(select 1 from public.workspaces where id = wb) and exists(select 1 from public.clients where workspace_id = wb), 'other workspace damaged';
  assert not exists(select 1 from public.workspace_members where user_id = c);
  assert (select user_id from makeborne_private.live_provider_calls where run_reference = 'rights-run') = subj, 'non-reference row not pseudonymized';
  perform public.makeborne_account_deletion_mark(del, lease2, 'storage');
  begin perform public.makeborne_account_deletion_step(del, lease2, 'finish'); raise exception 'finished before auth step';
  exception when sqlstate 'MBD11' then null; end;
  delete from auth.users where id = c;  -- stands in for the admin API call in the app's auth step
  perform public.makeborne_account_deletion_mark(del, lease2, 'auth');
  perform public.makeborne_account_deletion_step(del, lease2, 'finish');
  assert (select state = 'completed' and user_id is null and workspace_ids is null from makeborne_private.account_deletion_requests where id = del);
  assert exists(select 1 from makeborne_private.retained_account_records where subject_ref = subj and source_table = 'plan_payments'), 'retention lost on account removal';
  assert not exists(select 1 from makeborne_private.plan_payments where payment_id = 'pay_rightsC'), 'original payment row kept with account id';
  assert exists(select 1 from makeborne_private.plan_payments where payment_id = 'pay_rightsA'), 'another account payment touched';
  assert not exists(select 1 from makeborne_private.account_rights_events e where e.code like '%@%'), 'personal data in log';
  raise notice 'PASS deletion job: unpublish, resume with new lease, stale lease refused, disconnect, pseudonymized retention, erase, finish';

  -- ===== Append-only guards unchanged outside an erasure =====
  insert into public.generation_jobs(id,workspace_id,project_id,kind,status,idempotency_key) values(job_c,wa,pa,'website','succeeded','rights-'||gen_random_uuid());
  insert into public.usage_ledger(workspace_id,job_id,event_key,amount_microusd,provider,model,reason) values(wa,job_c,'rights-a',1,'vendor','model','legacy_usage');
  begin delete from public.usage_ledger where workspace_id = wa; raise exception 'accounting row deleted';
  exception when check_violation then null; end;
  perform set_config('makeborne.account_erasure', gen_random_uuid()::text, true);
  begin delete from public.usage_ledger where workspace_id = wa; raise exception 'spoofed erasure deleted accounting row';
  exception when check_violation then null; end;
  perform set_config('makeborne.account_erasure', del::text, true);
  begin delete from public.usage_ledger where workspace_id = wa; raise exception 'completed erasure reused';
  exception when check_violation then null; end;
  perform set_config('makeborne.account_erasure', '', true);
  raise notice 'PASS append-only accounting guard unchanged without an active erasure for that workspace';

  -- ===== Grants =====
  foreach src in array array['public.makeborne_account_export_rows(uuid,text,integer,integer)','public.makeborne_account_deletion_request(uuid,uuid,integer)',
    'public.makeborne_account_deletion_step(uuid,uuid,text)','public.makeborne_account_export_part(uuid,uuid,integer)','public.makeborne_account_rights_status(uuid)'] loop
    assert not has_function_privilege('authenticated', src, 'EXECUTE') and not has_function_privilege('anon', src, 'EXECUTE'), 'browser can call '||src;
    assert has_function_privilege('service_role', src, 'EXECUTE');
  end loop;
  assert not has_table_privilege('service_role', 'makeborne_private.retained_account_records', 'SELECT');
  assert not has_table_privilege('authenticated', 'makeborne_private.account_deletion_requests', 'SELECT');
  assert (select not public from storage.buckets where id = 'account-exports');
  raise notice 'PASS server-key-only entry points, private tables and private bucket';
end $$;
rollback;
