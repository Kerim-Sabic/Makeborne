-- Ordinary paying-workspace publishing (migration 20261025200000).
-- Isolated local stack or disposable database only. One transaction; everything
-- rolls back. Runs as the database owner (configure_* functions require it).
-- Needs migrations through 20261025200000 and the production namespace policy.
\set ON_ERROR_STOP on
begin;
-- The attestation RPC is reachable only as the worker role; borrow it for this
-- transaction only (rolled back with everything else).
grant makeborne_publication_worker to current_user with inherit false, set true;

create function pg_temp.receipt(preparation uuid) returns jsonb language sql as $$
 select jsonb_build_object('preparationId',id,'actorId',actor_id,'workspaceId',workspace_id,'projectId',project_id,'artifactId',artifact_id,
  'versionId',version_id,'versionNumber',version_number,'publicationRevision',publication_revision,'versionContentHash',version_content_hash,
  'slug',slug,'interactive',interactive,'buildReceipt',jsonb_build_object('sourceHash',repeat('a',64)))
 from makeborne_private.publication_preparations where id=preparation
$$;
create function pg_temp.output(label text) returns jsonb language sql as $$
 select jsonb_build_object('html',h,'isolatedHtml',h,'script',null,'files','[]'::jsonb,'interactive',false,
  'routes',jsonb_build_array(jsonb_build_object('path','/','html',h,'isolatedHtml',h),jsonb_build_object('path','/about','html',h||'about','isolatedHtml',h||'about')))
 from (select '<!doctype html><html><body><h1>'||label||'</h1></body></html>'||repeat(' ',120) h) x
$$;
create function pg_temp.html(label text) returns text language sql as $$ select pg_temp.output(label)->>'html' $$;
create function pg_temp.token() returns text language sql as $$ select replace(gen_random_uuid()::text,'-','') $$;
create function pg_temp.account(u uuid,admin boolean) returns uuid language plpgsql as $$
declare s uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@paying-publication.test',now());
 insert into auth.sessions(id,user_id) values(s,u);
 if admin then insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Paying publication fixture'); end if;
 return s;
end $$;
-- A provider-verified membership exactly as the access check records it.
create function pg_temp.member(u uuid,plan text,status text,period_end timestamptz,checked timestamptz,positive boolean) returns text language plpgsql as $$
declare ch text:='ch_'||pg_temp.token(); mem text:='mem_'||pg_temp.token();
begin
 insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),u,plan,ch,'/studio','ready');
 insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until,checked_at)
 values(mem,u,ch,'user_'||pg_temp.token(),plan,status,period_end,
  case when positive then least(checked+interval '5 minutes',period_end) else '1970-01-01'::timestamptz end,checked);
 return mem;
end $$;
create function pg_temp.verify(mem text,checked timestamptz) returns void language sql as $$
 update public.billing_memberships set checked_at=checked,verified_until=least(checked+interval '5 minutes',period_end) where membership_id=mem
$$;
create function pg_temp.workspace(u uuid,name text) returns uuid language plpgsql as $$
declare w uuid:=gen_random_uuid();
begin insert into public.workspaces(id,name,owner_id) values(w,name,u); return w; end $$;
create function pg_temp.website(w uuid,u uuid) returns uuid language plpgsql as $$
declare p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
begin
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Paying publication fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Paying publication fixture','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values(gen_random_uuid(),w,a,1,'{"kind":"website","websiteSource":{"schemaVersion":1,"toolchainId":"react-vite-v1","entrypoint":"src/main.tsx","files":[{},{},{},{}],"assets":[],"routes":[{"path":"/","title":"Home"},{"path":"/about","title":"About"}]},"sections":[]}','{}',u);
 update public.artifacts set current_version=1 where id=a;
 return a;
end $$;
-- Full trusted cycle: request, worker claim/load/complete, then promotion.
create function pg_temp.prepare(u uuid,s uuid,w uuid,a uuid,slug text,revision integer,label text) returns uuid language plpgsql as $$
declare prep uuid; worker uuid:=gen_random_uuid(); state jsonb;
begin
 prep:=(public.makeborne_request_publication_preparation(u,s,now()+interval '20 minutes',w,a,1,revision,slug,false,gen_random_uuid())->>'id')::uuid;
 state:=public.makeborne_claim_publication_preparation(prep,worker);
 perform public.makeborne_load_publication_preparation(prep,worker,(state->>'fence')::bigint);
 state:=public.makeborne_complete_publication_preparation(prep,worker,(state->>'fence')::bigint,pg_temp.receipt(prep),pg_temp.output(label)::text);
 if state->>'state'<>'ready' then raise exception 'Fixture preparation not ready'; end if;
 return prep;
end $$;
create function pg_temp.attest() returns jsonb language plpgsql as $$
declare r jsonb;
begin
 set local role makeborne_publication_worker;
 r:=public.makeborne_publication_worker_attest();
 reset role;
 return r;
end $$;

do $$
declare
 plan text:='plan_PayPublish'||left(pg_temp.token(),10);
 adm uuid:=gen_random_uuid(); adm2 uuid:=gen_random_uuid(); pay uuid:=gen_random_uuid(); non uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid();
 lap uuid:=gen_random_uuid(); oth uuid:=gen_random_uuid(); fair uuid:=gen_random_uuid();
 s_adm uuid; s_adm2 uuid; s_pay uuid; s_non uuid; s_ref uuid; s_lap uuid; s_oth uuid; s_fair uuid;
 w_adm uuid; w_adm2 uuid; w_pay uuid; w_non uuid; w_ref uuid; w_lap uuid; w_oth uuid; w_fair uuid;
 a_adm uuid; a_adm2 uuid; a_pay uuid; a_pay2 uuid; a_non uuid; a_ref uuid; a_ref_legacy uuid; a_lap uuid; a_oth uuid; a_fair uuid;
 m_pay text; m_ref text; m_lap text; m_fair text; pay_id text;
 prep uuid; prep2 uuid; replay_key uuid; rate_actor uuid:=gen_random_uuid(); rate_session uuid; w_rate uuid; a_rate uuid; worker uuid; state jsonb; result jsonb; i integer; tag text:=left(pg_temp.token(),8);
begin
 assert (select mode='production' from makeborne_private.site_address_namespace_policy where singleton), 'production namespace expected';
 assert (select mode='allowlist' from makeborne_private.trusted_publication_scope where singleton), 'migration must start in allowlist scope';
 update makeborne_private.billing_settings set creation_enabled=true where singleton;
 insert into makeborne_private.billing_access_plans(plan_id,enabled) values(plan,true);

 s_adm:=pg_temp.account(adm,true); s_adm2:=pg_temp.account(adm2,true); s_pay:=pg_temp.account(pay,false); s_non:=pg_temp.account(non,false); s_ref:=pg_temp.account(ref,false);
 s_lap:=pg_temp.account(lap,false); s_oth:=pg_temp.account(oth,false); s_fair:=pg_temp.account(fair,false);
 w_adm:=pg_temp.workspace(adm,'Owner rollout'); w_adm2:=pg_temp.workspace(adm2,'Admin unlisted'); w_pay:=pg_temp.workspace(pay,'Paying');
 w_non:=pg_temp.workspace(non,'Not paying'); w_ref:=pg_temp.workspace(ref,'Refunded'); w_lap:=pg_temp.workspace(lap,'Lapsed');
 w_oth:=pg_temp.workspace(oth,'Other paying'); w_fair:=pg_temp.workspace(fair,'Fair use');
 insert into makeborne_private.trusted_publication_workspaces(workspace_id,enabled) values(w_adm,true);
 a_adm:=pg_temp.website(w_adm,adm); a_adm2:=pg_temp.website(w_adm2,adm2); a_pay:=pg_temp.website(w_pay,pay); a_pay2:=pg_temp.website(w_pay,pay);
 a_non:=pg_temp.website(w_non,non); a_ref:=pg_temp.website(w_ref,ref); a_lap:=pg_temp.website(w_lap,lap); a_oth:=pg_temp.website(w_oth,oth); a_fair:=pg_temp.website(w_fair,fair);
 m_pay:=pg_temp.member(pay,plan,'active',now()+interval '20 days',now(),true);
 perform pg_temp.member(oth,plan,'active',now()+interval '20 days',now(),true);
 m_fair:=pg_temp.member(fair,plan,'active',now()+interval '20 days',now(),true);
 -- Refunded: provider still reports active (Whop keeps refunded memberships active), period revoked.
 m_ref:=pg_temp.member(ref,plan,'active',now()+interval '20 days',now(),true);
 pay_id:='pay_'||pg_temp.token();
 insert into makeborne_private.plan_payments(payment_id,user_id,membership_id,plan_id,billing_reason,currency,principal_cents,refunded_cents,dispute,paid_at,state,evidence,observed_at)
 values(pay_id,ref,m_ref,plan,'subscription_create','usd',2000,2000,'none',now()-interval '1 day','reversed','{}',now());
 insert into makeborne_private.membership_revocations(payment_id,membership_id,user_id,period_start,period_end,reason)
 values(pay_id,m_ref,ref,now()-interval '1 day',now()+interval '20 days','refunded');
 -- Cancelled at period end, and that period has now ended.
 m_lap:=pg_temp.member(lap,plan,'canceling',now()-interval '1 hour',now()-interval '2 hours',false);
 insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive)
 values(a_lap,w_lap,lap,'lapsed-'||tag,1,pg_temp.html('Lapsed last good'),true,1,gen_random_uuid(),false);

 -- 0. Namespace guards are unchanged: staging stays one QA workspace whatever the scope.
 perform makeborne_private.configure_trusted_publication_scope('entitled');
 perform makeborne_private.configure_site_address_namespace('staging',w_pay);
 assert makeborne_private.publication_workspace_allowed(w_pay) and not makeborne_private.publication_workspace_allowed(w_oth)
  and not makeborne_private.publication_workspace_allowed(w_adm), 'staging must admit only its QA workspace';
 assert pg_temp.attest()=jsonb_build_object('contractVersion','publication-controller-v1','namespace','staging','qaWorkspaceId',w_pay), 'staging attestation changed';
 begin perform makeborne_private.configure_trusted_publication_scope('entitled');
  raise exception 'Entitled scope accepted in staging'; exception when insufficient_privilege then null; end;
 perform makeborne_private.configure_site_address_namespace('production',null);
 perform makeborne_private.configure_trusted_publication_scope('allowlist');
 raise notice 'PASS staging namespace keeps one QA workspace in any scope; entitled scope refused while staging';

 -- 1. Allowlist scope (state immediately after the migration): owner rollout unchanged.
 assert pg_temp.attest()=jsonb_build_object('contractVersion','publication-controller-v2','namespace','production','workspaceAllowlist',
  (select jsonb_agg(workspace_id::text order by workspace_id) from makeborne_private.trusted_publication_workspaces where enabled)), 'allowlist attestation changed';
 prep:=pg_temp.prepare(adm,s_adm,w_adm,a_adm,'owner-'||tag,0,'Owner site');
 result:=public.makeborne_promote_publication_preparation(prep,adm,s_adm,now()+interval '20 minutes');
 assert public.makeborne_read_hosted_site_v3('owner-'||tag,'/')->>'html'=pg_temp.html('Owner site');
 begin perform public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,0,'paying-'||tag,false,gen_random_uuid());
  raise exception 'Unlisted paying workspace admitted in allowlist scope';
 exception when insufficient_privilege then assert sqlerrm='Trusted publication workspace not enabled', sqlerrm; end;
 begin perform public.makeborne_request_publication_preparation(adm2,s_adm2,now()+interval '20 minutes',w_adm2,a_adm2,1,0,'owner2-'||tag,false,gen_random_uuid());
  raise exception 'Unlisted admin workspace admitted in allowlist scope'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_request_publication_preparation(non,s_non,now()+interval '20 minutes',w_non,a_non,1,0,'nonpay-'||tag,false,gen_random_uuid());
  raise exception 'Non-paying workspace admitted'; exception when sqlstate 'MB402' then null; end;
 raise notice 'PASS allowlist scope: listed owner workspace publishes; unlisted paying and admin workspaces refused as before';

 -- 2. Entitled scope: a verified paying workspace publishes end to end.
 perform makeborne_private.configure_trusted_publication_scope('entitled');
 assert pg_temp.attest()=jsonb_build_object('contractVersion','publication-controller-v3','namespace','production','workspaceScope','entitled'), 'entitled attestation';
 assert makeborne_private.publication_workspace_allowed(w_pay) and makeborne_private.publication_workspace_allowed(w_adm) and makeborne_private.publication_workspace_allowed(w_adm2);
 prep:=pg_temp.prepare(pay,s_pay,w_pay,a_pay,'paying-'||tag,0,'Paying v1');
 result:=public.makeborne_promote_publication_preparation(prep,pay,s_pay,now()+interval '20 minutes');
 assert (result->>'live')::boolean and result->>'revision'='1';
 assert public.makeborne_read_hosted_site_v3('paying-'||tag,'/')->>'html'=pg_temp.html('Paying v1');
 assert public.makeborne_read_hosted_site_v3('paying-'||tag,'/about')->>'html'=pg_temp.html('Paying v1')||'about';
 assert public.makeborne_promote_publication_preparation(prep,pay,s_pay,now()+interval '20 minutes')=result, 'promotion replay';
 raise notice 'PASS entitled scope: verified paying workspace prepares, compiles, promotes and is served (both routes); replay idempotent';
 prep:=pg_temp.prepare(adm,s_adm,w_adm,a_adm,'owner-'||tag,1,'Owner site v2');
 perform public.makeborne_promote_publication_preparation(prep,adm,s_adm,now()+interval '20 minutes');
 prep:=pg_temp.prepare(adm2,s_adm2,w_adm2,a_adm2,'owner2-'||tag,0,'Owner unlisted');
 perform public.makeborne_promote_publication_preparation(prep,adm2,s_adm2,now()+interval '20 minutes');
 raise notice 'PASS owner/admin workspaces keep publishing in entitled scope';

 -- 3. Refusals: not paying, refunded, cancelled after the period, other workspace.
 assert not makeborne_private.publication_workspace_allowed(w_non) and not makeborne_private.publication_workspace_allowed(w_ref)
  and not makeborne_private.publication_workspace_allowed(w_lap);
 begin perform public.makeborne_request_publication_preparation(non,s_non,now()+interval '20 minutes',w_non,a_non,1,0,'nonpay-'||tag,false,gen_random_uuid());
  raise exception 'Non-paying workspace admitted'; exception when sqlstate 'MB402' then null; end;
 begin perform public.makeborne_request_publication_preparation(ref,s_ref,now()+interval '20 minutes',w_ref,a_ref,1,0,'refund-'||tag,false,gen_random_uuid());
  raise exception 'Refunded workspace admitted'; exception when sqlstate 'MB402' then null; end;
 begin perform public.makeborne_request_publication_preparation(lap,s_lap,now()+interval '20 minutes',w_lap,a_lap,1,1,'lapsed-'||tag,false,gen_random_uuid());
  raise exception 'Lapsed workspace admitted'; exception when sqlstate 'MB402' then null; end;
 -- Legacy outline publisher: provider-active but refunded is refused before any write.
 a_ref_legacy:=gen_random_uuid();
 insert into public.artifacts(id,workspace_id,project_id,title,kind,current_version) values(a_ref_legacy,w_ref,(select project_id from public.artifacts where id=a_ref),'Legacy','website',1);
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(gen_random_uuid(),w_ref,a_ref_legacy,1,'{}','{}',ref);
 begin perform public.makeborne_save_hosted_site_v4(ref,w_ref,a_ref_legacy,1,'refund-legacy-'||tag,pg_temp.html('x'),true,0,gen_random_uuid(),false,null,'[]',null);
  raise exception 'Refunded legacy publication admitted'; exception when sqlstate 'MB402' then null; end;
 raise notice 'PASS non-paying, refunded (provider still active) and cancelled-after-period accounts cannot publish';
 begin perform public.makeborne_request_publication_preparation(oth,s_oth,now()+interval '20 minutes',w_pay,a_pay,1,1,'paying-'||tag,false,gen_random_uuid());
  raise exception 'Cross-workspace request admitted'; exception when insufficient_privilege then assert sqlerrm='Owner required'; end;
 begin perform public.makeborne_publication_preparation_status(prep,oth,s_oth,now()+interval '20 minutes');
  raise exception 'Cross-account status admitted'; exception when no_data_found then null; end;
 begin perform public.makeborne_promote_publication_preparation(prep,oth,s_oth,now()+interval '20 minutes');
  raise exception 'Cross-account promotion admitted'; exception when no_data_found then null; end;
 begin perform public.makeborne_request_publication_preparation(pay,s_oth,now()+interval '20 minutes',w_pay,a_pay,1,1,'paying-'||tag,false,gen_random_uuid());
  raise exception 'Another account session admitted'; exception when insufficient_privilege then null; end;
 raise notice 'PASS another paying account cannot request, read, promote or borrow a session for this workspace';

 -- 4. Already-live sites after access ends: retained, never deleted or unpublished;
 -- served only while owner_can_host holds (unchanged serving rule).
 assert (select live and html=pg_temp.html('Lapsed last good') from public.hosted_sites where artifact_id=a_lap);
 assert public.makeborne_read_hosted_site_v3('lapsed-'||tag,'/') is null, 'lapsed site still served';
 -- Refunded period, provider still active: serving is unchanged (owner_can_host does
 -- not consult revocations), so it stays served until cancellation or period end.
 insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive)
 values(a_ref,w_ref,ref,'refund-'||tag,1,pg_temp.html('Refunded last good'),true,1,gen_random_uuid(),false);
 assert public.makeborne_read_hosted_site_v3('refund-'||tag,'/')->>'html'=pg_temp.html('Refunded last good'), 'refunded serving rule changed';
 result:=public.makeborne_save_hosted_site_v4(lap,w_lap,a_lap,1,'lapsed-'||tag,'',false,1,gen_random_uuid(),false,null,'[]',null);
 assert not (result->>'live')::boolean and (select html from public.hosted_sites where artifact_id=a_lap)=pg_temp.html('Lapsed last good');
 raise notice 'PASS lapsed site kept (not served, not deleted); owner can still take it offline; bytes retained';

 -- 5. Verification freshness: background paths survive the five-minute window,
 -- mutations do not; stale beyond 24 hours stops background work too.
 perform pg_temp.verify(m_pay,now());
 prep2:=(public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,1,'paying-'||tag,false,gen_random_uuid())->>'id')::uuid;
 perform pg_temp.verify(m_pay,now()-interval '1 hour');
 assert not makeborne_private.has_creation_membership_for_actor(pay) and makeborne_private.publication_entitled_for_actor(pay);
 assert public.makeborne_publication_preparation_status(prep2,pay,s_pay,now()+interval '20 minutes')->>'state'='queued';
 assert public.makeborne_latest_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay)->>'id'=prep2::text;
 worker:=gen_random_uuid(); state:=public.makeborne_claim_publication_preparation(prep2,worker);
 perform public.makeborne_load_publication_preparation(prep2,worker,(state->>'fence')::bigint);
 state:=public.makeborne_complete_publication_preparation(prep2,worker,(state->>'fence')::bigint,pg_temp.receipt(prep2),pg_temp.output('Paying v2')::text);
 assert state->>'state'='ready';
 begin perform public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,1,'paying-'||tag,false,gen_random_uuid());
  raise exception 'Stale verification requested'; exception when sqlstate 'MB402' then null; end;
 begin perform public.makeborne_promote_publication_preparation(prep2,pay,s_pay,now()+interval '20 minutes');
  raise exception 'Stale verification promoted'; exception when sqlstate 'MB402' then null; end;
 assert public.makeborne_read_hosted_site_v3('paying-'||tag,'/')->>'html'=pg_temp.html('Paying v1'), 'last good changed';
 perform pg_temp.verify(m_pay,now());
 result:=public.makeborne_promote_publication_preparation(prep2,pay,s_pay,now()+interval '20 minutes');
 assert result->>'revision'='2' and public.makeborne_read_hosted_site_v3('paying-'||tag,'/')->>'html'=pg_temp.html('Paying v2');
 raise notice 'PASS compile claimed/loaded an hour after the request; going live still needs a fresh check (republish works)';
 prep2:=(public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,2,'paying-'||tag,false,gen_random_uuid())->>'id')::uuid;
 perform pg_temp.verify(m_pay,now()-interval '25 hours');
 assert not makeborne_private.publication_entitled_for_actor(pay) and not makeborne_private.publication_workspace_allowed(w_pay);
 begin perform public.makeborne_claim_publication_preparation(prep2,gen_random_uuid());
  raise exception 'Day-old verification claimed'; exception when sqlstate 'MB402' then null; end;
 update public.billing_memberships set status='canceled',checked_at=now(),verified_until='1970-01-01' where membership_id=m_pay;
 assert not makeborne_private.publication_entitled_for_actor(pay);
 begin perform public.makeborne_publication_preparation_status(prep2,pay,s_pay,now()+interval '20 minutes');
  raise exception 'Cancelled account read preparation'; exception when sqlstate 'MB402' then null; end;
 raise notice 'PASS verification older than 24 hours, or a recorded cancellation, stops background work';

 -- 6. Last good output survives failed and blocked publishes.
 perform pg_temp.verify(m_pay,now());
 update public.billing_memberships set status='active' where membership_id=m_pay;
 perform pg_temp.verify(m_pay,now());
 prep2:=(public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,2,'paying-'||tag,false,gen_random_uuid())->>'id')::uuid;
 for i in 1..3 loop
  worker:=gen_random_uuid(); state:=public.makeborne_claim_publication_preparation(prep2,worker);
  state:=public.makeborne_fail_publication_preparation(prep2,worker,(state->>'fence')::bigint,'Fixture compiler failure');
 end loop;
 assert state->>'state'='failed';
 begin perform public.makeborne_promote_publication_preparation(prep2,pay,s_pay,now()+interval '20 minutes');
  raise exception 'Failed preparation promoted'; exception when sqlstate 'PT409' then null; end;
 worker:=gen_random_uuid();
 prep2:=(public.makeborne_request_publication_preparation(pay,s_pay,now()+interval '20 minutes',w_pay,a_pay,1,2,'paying-'||tag,false,gen_random_uuid())->>'id')::uuid;
 state:=public.makeborne_claim_publication_preparation(prep2,worker);
 begin perform public.makeborne_complete_publication_preparation(prep2,worker,(state->>'fence')::bigint,pg_temp.receipt(prep2),
   jsonb_set(pg_temp.output('Oversized'),'{html}',to_jsonb('<!doctype html>'||repeat('x',4000001)))::text);
  raise exception 'Oversized output accepted'; exception when invalid_parameter_value then null; end;
 assert public.makeborne_read_hosted_site_v3('paying-'||tag,'/')->>'html'=pg_temp.html('Paying v2')
  and (select revision from public.hosted_sites where artifact_id=a_pay)=2, 'last good output not retained';
 raise notice 'PASS failed compile, refused oversize output and failed promotion leave the last good site live and served';

 -- 7. Fair-use limits apply unchanged to paying workspaces.
 insert into makeborne_hosting.site_publication_events(artifact_id,workspace_id) select gen_random_uuid(),w_fair from generate_series(1,50);
 prep:=pg_temp.prepare(fair,s_fair,w_fair,a_fair,'fair-'||tag,0,'Fair');
 begin perform public.makeborne_promote_publication_preparation(prep,fair,s_fair,now()+interval '20 minutes');
  raise exception '51st new site in a day accepted'; exception when sqlstate 'MB429' then assert sqlerrm like 'Daily publishing limit%', sqlerrm; end;
 assert not exists(select 1 from public.hosted_sites where artifact_id=a_fair);
 update makeborne_hosting.site_publication_events set first_published_at=clock_timestamp()-interval '2 days' where workspace_id=w_fair;
 insert into public.artifacts(id,workspace_id,project_id,title,kind,current_version)
 select gen_random_uuid(),w_fair,(select project_id from public.artifacts where id=a_fair),'Ceiling fixture','website',1 from generate_series(1,1000);
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 select gen_random_uuid(),w_fair,id,1,'{}','{}',fair from public.artifacts where workspace_id=w_fair and title='Ceiling fixture';
 insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id)
 select id,w_fair,fair,'cap-'||replace(id::text,'-',''),1,pg_temp.html('cap'),true,1,gen_random_uuid() from public.artifacts where workspace_id=w_fair and title='Ceiling fixture';
 begin perform public.makeborne_promote_publication_preparation(prep,fair,s_fair,now()+interval '20 minutes');
  raise exception 'Live site 1,001 accepted'; exception when sqlstate 'MB429' then assert sqlerrm like 'Fair-use limit of 1,000%', sqlerrm; end;
 assert (select pp.state from makeborne_private.publication_preparations pp where pp.id=prep)='ready';
 raise notice 'PASS 50 new sites a day and 1,000 live sites per workspace still refuse a paying workspace (MB429)';
 i:=(select count(*) from makeborne_private.publication_preparations where workspace_id=w_fair and created_at>clock_timestamp()-interval '1 hour');
 loop
  begin perform public.makeborne_request_publication_preparation(fair,s_fair,now()+interval '20 minutes',w_fair,a_fair,1,0,'fair-'||tag,false,gen_random_uuid());
  exception when sqlstate 'MB429' then assert sqlerrm='Workspace preparation limit reached', sqlerrm; exit; end;
  i:=i+1; if i>10 then raise exception 'Workspace preparation rate limit bypassed'; end if;
 end loop;
 assert i=10, 'workspace preparation limit was '||i;
 -- Idempotent replay remains usable at the cap and consumes no new slot.
 select request_id into replay_key from makeborne_private.publication_preparations where id=prep;
 result:=public.makeborne_request_publication_preparation(fair,s_fair,now()+interval '20 minutes',w_fair,a_fair,1,0,'fair-'||tag,false,replay_key);
 assert (result->>'id')::uuid=prep, 'capped preparation replay changed';
 assert (select count(*) from makeborne_private.publication_preparations where workspace_id=w_fair)=10;
 -- A different artifact in the same workspace cannot bypass the shared cap.
 a_rate:=pg_temp.website(w_fair,fair);
 begin perform public.makeborne_request_publication_preparation(fair,s_fair,now()+interval '20 minutes',w_fair,a_rate,1,0,'fair-other-'||tag,false,gen_random_uuid());
  raise exception 'Workspace limit bypassed using another artifact';
 exception when sqlstate 'MB429' then assert sqlerrm='Workspace preparation limit reached', sqlerrm; end;
 raise notice 'PASS 10 preparations per workspace per rolling hour; replay and other-artifact boundaries preserved';
 -- A second workspace has its own ten slots. The schema permits one owned
 -- workspace per account, so retain the independent actor-wide defense by
 -- checking its deployed definition instead of inventing an invalid fixture.
 rate_session:=pg_temp.account(rate_actor,false);
 perform pg_temp.member(rate_actor,plan,'active',now()+interval '20 days',now(),true);
 w_rate:=pg_temp.workspace(rate_actor,'Independent preparation limit fixture');
 a_rate:=pg_temp.website(w_rate,rate_actor);
 for i in 1..10 loop
  perform public.makeborne_request_publication_preparation(rate_actor,rate_session,now()+interval '20 minutes',w_rate,a_rate,1,0,'rate-'||tag,false,gen_random_uuid());
 end loop;
 assert (select count(*) from makeborne_private.publication_preparations where workspace_id=w_rate)=10;
 assert pg_get_functiondef('makeborne_private.request_publication_preparation(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)'::regprocedure)
  like '%where actor_id=p_actor and created_at>clock_timestamp()-interval ''1 hour'')>=30%', 'actor-wide 30/hour defense missing';
 -- Failed attempts count toward the rolling cap; old attempts age out.
 update makeborne_private.publication_preparations pp set state='failed',worker_id=null,lease_until=null where pp.workspace_id=w_fair and pp.state='queued';
 begin perform public.makeborne_request_publication_preparation(fair,s_fair,now()+interval '20 minutes',w_fair,a_fair,1,0,'fair-'||tag,false,gen_random_uuid());
  raise exception 'Failed preparations did not count toward workspace limit';
 exception when sqlstate 'MB429' then assert sqlerrm='Workspace preparation limit reached', sqlerrm; end;
 update makeborne_private.publication_preparations set created_at=clock_timestamp()-interval '61 minutes' where workspace_id=w_fair;
 perform public.makeborne_request_publication_preparation(fair,s_fair,now()+interval '20 minutes',w_fair,a_fair,1,0,'fair-'||tag,false,gen_random_uuid());
 assert (select count(*) from makeborne_private.publication_preparations where workspace_id=w_fair and created_at>clock_timestamp()-interval '1 hour')=1;
 raise notice 'PASS account ceiling remains in deployed definition; separate workspaces, failed attempts and rolling-hour expiry checked';

 -- 8. Address namespace in production still refuses the staging QA labels.
 begin perform public.makeborne_request_publication_preparation(oth,s_oth,now()+interval '20 minutes',w_oth,a_oth,1,0,'release-check',false,gen_random_uuid());
  raise exception 'Staging label admitted in production'; exception when insufficient_privilege then assert sqlerrm='SITE_ADDRESS_NAMESPACE_DENIED', sqlerrm; end;
 raise notice 'PASS production namespace guard unchanged for paying workspaces';
end $$;

-- 9. Privileges: no application, browser or worker authority over the new scope.
do $$ declare r text; f text; begin
 assert (select relrowsecurity from pg_class where oid='makeborne_private.trusted_publication_scope'::regclass);
 foreach r in array array['anon','authenticated','service_role','makeborne_publication_worker'] loop
  assert not has_table_privilege(r,'makeborne_private.trusted_publication_scope','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), r;
  foreach f in array array['makeborne_private.configure_trusted_publication_scope(text)','makeborne_private.publication_entitled_for_actor(uuid)',
   'makeborne_private.guard_trusted_publication_scope()','makeborne_private.publication_workspace_allowed(uuid)','makeborne_private.publication_authority(uuid,uuid,timestamptz,uuid,uuid)'] loop
   assert not has_function_privilege(r,f,'EXECUTE'), r||' '||f;
  end loop;
 end loop;
 foreach r in array array['anon','authenticated'] loop
  assert not has_function_privilege(r,'makeborne_private.request_publication_preparation(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)','EXECUTE');
  assert not has_function_privilege(r,'makeborne_private.promote_publication_preparation(uuid,uuid,uuid,timestamptz)','EXECUTE');
  assert not has_function_privilege(r,'makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 end loop;
 assert has_function_privilege('service_role','makeborne_private.request_publication_preparation(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)','EXECUTE');
 assert has_function_privilege('service_role','makeborne_private.promote_publication_preparation(uuid,uuid,uuid,timestamptz)','EXECUTE');
 assert has_function_privilege('service_role','makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text)','EXECUTE');
 assert has_function_privilege('makeborne_publication_worker','makeborne_private.publication_worker_attest()','EXECUTE');
 raise notice 'PASS scope table/functions have no app, browser or worker grants; existing service grants preserved';
end $$;
set local role service_role;
do $$ begin
 perform makeborne_private.configure_trusted_publication_scope('entitled');
 raise exception 'Service role changed publication scope';
exception when insufficient_privilege then raise notice 'PASS service role cannot change publication scope'; end $$;
reset role;
select 'PASS: paying workspace publication' as result;
rollback;
