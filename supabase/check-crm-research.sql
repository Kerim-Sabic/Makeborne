-- CRM research tables (20261025300000). Disposable local stack only; every fixture rolls back.
-- Run: docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-crm-research.sql
-- Sections run as the authenticated role with a signed-in subject (RLS applies), like the browser's server calls.
\set ON_ERROR_STOP on
begin;

create function pg_temp.as_user(id uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', jsonb_build_object('sub', id, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', id::text, true); end $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

do $$
declare o uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); rv uuid:=gen_random_uuid(); st uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); c3 uuid:=gen_random_uuid();
 chk uuid; chk2 uuid; x jsonb; n integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(o,o||'@crm.invalid',now()),(ed,ed||'@crm.invalid',now()),(rv,rv||'@crm.invalid',now()),(st,st||'@crm.invalid',now());
 insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(o,true,'crm fixture'),(ed,true,'crm fixture'),(rv,true,'crm fixture'),(st,true,'crm fixture');
 insert into public.workspaces(id,name,owner_id) values(w,'CRM fixture',o),(w2,'Foreign fixture',st);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,ed,'editor'),(w,rv,'reviewer');
 insert into public.clients(id,workspace_id,name,website) values(c1,w,'Lana','https://lana.test/'),(c2,w,'Lana Studio','https://www.lana.test/'),(c3,w2,'Foreign','https://foreign.test/');
 perform set_config('crm.ids', jsonb_build_object('o',o,'ed',ed,'rv',rv,'st',st,'w',w,'w2',w2,'c1',c1,'c2',c2,'c3',c3)::text, true);
end $$;

-- A. Website checks: editors store prospect checks (they expire), reviewers read only, other workspaces see nothing; no spoofed author.
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; w uuid:=(ids->>'w')::uuid; w2 uuid:=(ids->>'w2')::uuid; ed uuid:=(ids->>'ed')::uuid; rv uuid:=(ids->>'rv')::uuid; st uuid:=(ids->>'st')::uuid;
 c1 uuid:=(ids->>'c1')::uuid; chk uuid; n integer;
begin
 perform pg_temp.as_user(ed); set local role authenticated;
 insert into public.crm_site_checks(workspace_id,url,status,score,result,checker_version,checked_at,expires_at,created_by)
  values(w,'https://prospect.test/','checked',62,'{"findings":[]}','crm-site-check-2026-10-25.1',now(),now()+interval '30 days',ed) returning id into chk;
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://x.test/','checked','{}','v1',now(),now()+interval '1 day',(ids->>'o')::uuid); raise exception 'spoofed author'; exception when insufficient_privilege then null; end;
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,created_by) values(w,'https://x.test/','checked','{}','v1',now(),ed); raise exception 'prospect check without expiry'; exception when check_violation then null; end;
 begin insert into public.crm_site_checks(workspace_id,client_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,c1,'https://x.test/','checked','{}','v1',now(),now()+interval '1 day',ed); raise exception 'client check with expiry'; exception when check_violation then null; end;
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://x.test/','checked','{}','v1',now(),now()+interval '90 days',ed); raise exception 'long expiry'; exception when check_violation then null; end;
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://x.test/','guessed','{}','v1',now(),now()+interval '1 day',ed); raise exception 'unknown status'; exception when check_violation then null; end;
 reset role;
 perform pg_temp.as_user(rv); set local role authenticated;
 assert (select count(*) from public.crm_site_checks where id=chk)=1,'reviewer reads';
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://r.test/','checked','{}','v1',now(),now()+interval '1 day',rv); raise exception 'reviewer inserted'; exception when insufficient_privilege then null; end;
 update public.crm_site_checks set client_id=c1, expires_at=null where id=chk; get diagnostics n=row_count; assert n=0,'reviewer cannot attach';
 delete from public.crm_site_checks where id=chk; get diagnostics n=row_count; assert n=0,'reviewer cannot delete';
 reset role;
 perform pg_temp.as_user(st); set local role authenticated;
 assert (select count(*) from public.crm_site_checks where workspace_id=w)=0,'another workspace sees nothing';
 begin insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://s.test/','checked','{}','v1',now(),now()+interval '1 day',st); raise exception 'stranger inserted'; exception when insufficient_privilege then null; end;
 reset role;
 set local role anon;
 begin perform count(*) from public.crm_site_checks; raise exception 'anon read'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('crm.chk', chk::text, true);
 raise notice 'PASS crm A: editors store prospect checks that expire (bounded), authors cannot be spoofed, reviewers read only, other workspaces and anon see nothing';
end $$;

-- B. Attaching a check to a client: only client_id/expires_at change, once, within the workspace.
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; w uuid:=(ids->>'w')::uuid; ed uuid:=(ids->>'ed')::uuid; o uuid:=(ids->>'o')::uuid; c1 uuid:=(ids->>'c1')::uuid; c2 uuid:=(ids->>'c2')::uuid; c3 uuid:=(ids->>'c3')::uuid;
 chk uuid:=current_setting('crm.chk')::uuid; n integer;
begin
 perform pg_temp.as_user(o); set local role authenticated;
 begin update public.crm_site_checks set score=5 where id=chk; raise exception 'score rewritten'; exception when insufficient_privilege then null; end;
 begin update public.crm_site_checks set client_id=c3, expires_at=null where id=chk; raise exception 'attached to a foreign client'; exception when foreign_key_violation then null; end;
 update public.crm_site_checks set client_id=c1, expires_at=null where id=chk and client_id is null; get diagnostics n=row_count; assert n=1,'owner attaches';
 update public.crm_site_checks set client_id=c2, expires_at=null where id=chk; get diagnostics n=row_count; assert n=0,'an attached check is not moved';
 assert (select client_id from public.crm_site_checks where id=chk)=c1;
 reset role;
 raise notice 'PASS crm B: attach changes only the client link, once, never to another workspace''s client; results cannot be rewritten';
end $$;

-- C. Next step: compare-and-set through the RPC, as the caller (RLS applies).
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; w uuid:=(ids->>'w')::uuid; w2 uuid:=(ids->>'w2')::uuid; ed uuid:=(ids->>'ed')::uuid; o uuid:=(ids->>'o')::uuid; rv uuid:=(ids->>'rv')::uuid;
 c1 uuid:=(ids->>'c1')::uuid; c3 uuid:=(ids->>'c3')::uuid; x jsonb; n integer;
begin
 perform pg_temp.as_user(ed); set local role authenticated;
 x:=public.makeborne_crm_next_step_set(w,c1,'Send the quote',0); assert (x->>'revision')::int=1 and x->>'text'='Send the quote','first next step';
 begin perform public.makeborne_crm_next_step_set(w,c1,'Other',0); raise exception 'stale create'; exception when sqlstate 'PT409' then null; end;
 x:=public.makeborne_crm_next_step_set(w,c1,'Call about the quote',1); assert (x->>'revision')::int=2,'cas update';
 reset role;
 perform pg_temp.as_user(o); set local role authenticated;
 begin perform public.makeborne_crm_next_step_set(w,c1,'Owner overwrite with stale view',1); raise exception 'stale update'; exception when sqlstate 'PT409' then null; end;
 assert (select text from public.crm_next_steps where client_id=c1)='Call about the quote','the stale write changed nothing';
 begin perform public.makeborne_crm_next_step_set(w,c1,'<script>',2); raise exception 'markup stored'; exception when check_violation then null; end;
 begin perform public.makeborne_crm_next_step_set(w,c1,'x',null); raise exception 'no revision'; exception when sqlstate '22023' then null; end;
 begin perform public.makeborne_crm_next_step_set(w,c3,'Foreign',0); raise exception 'foreign client'; exception when sqlstate 'P0002' then null; end;
 reset role;
 perform pg_temp.as_user(rv); set local role authenticated;
 begin perform public.makeborne_crm_next_step_set(w,c1,'Reviewer',2); raise exception 'reviewer wrote'; exception when insufficient_privilege then null; end;
 update public.crm_next_steps set text='direct' where client_id=c1; get diagnostics n=row_count; assert n=0,'reviewer cannot update directly (RLS)';
 assert (select count(*) from public.crm_next_steps where client_id=c1)=1,'reviewer reads';
 reset role;
 perform pg_temp.as_user((ids->>'st')::uuid); set local role authenticated;
 begin perform public.makeborne_crm_next_step_set(w,c1,'Stranger',2); raise exception 'stranger wrote'; exception when insufficient_privilege then null; end;
 assert (select count(*) from public.crm_next_steps where workspace_id=w)=0,'stranger reads nothing';
 reset role;
 raise notice 'PASS crm C: next step compare-and-set (stale create and stale update refused with PT409, nothing changed), no markup, editors only, other workspaces refused';
end $$;

-- D. Do-not-contact list and duplicate dismissals.
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; w uuid:=(ids->>'w')::uuid; ed uuid:=(ids->>'ed')::uuid; rv uuid:=(ids->>'rv')::uuid; st uuid:=(ids->>'st')::uuid;
 c1 uuid:=(ids->>'c1')::uuid; c2 uuid:=(ids->>'c2')::uuid; c3 uuid:=(ids->>'c3')::uuid; n integer;
begin
 perform pg_temp.as_user(ed); set local role authenticated;
 insert into public.crm_suppressions(workspace_id,kind,value,reason,created_by) values(w,'email','owner@lana.test','Asked not to be contacted',ed),(w,'domain','mlin.test','',ed);
 begin insert into public.crm_suppressions(workspace_id,kind,value,created_by) values(w,'email','Owner@Lana.test',ed); raise exception 'not normalised'; exception when check_violation then null; end;
 begin insert into public.crm_suppressions(workspace_id,kind,value,created_by) values(w,'domain','not a domain',ed); raise exception 'bad domain'; exception when check_violation then null; end;
 begin insert into public.crm_suppressions(workspace_id,kind,value,created_by) values(w,'email','owner@lana.test',ed); raise exception 'duplicate entry'; exception when unique_violation then null; end;
 if c1 < c2 then insert into public.crm_duplicate_dismissals(workspace_id,client_a,client_b,created_by) values(w,c1,c2,ed);
 else insert into public.crm_duplicate_dismissals(workspace_id,client_a,client_b,created_by) values(w,c2,c1,ed); end if;
 begin insert into public.crm_duplicate_dismissals(workspace_id,client_a,client_b,created_by) values(w,greatest(c1,c2),least(c1,c2),ed); raise exception 'unordered pair'; exception when check_violation then null; end;
 begin insert into public.crm_duplicate_dismissals(workspace_id,client_a,client_b,created_by) values(w,least(c1,c3),greatest(c1,c3),ed); raise exception 'cross-workspace pair'; exception when foreign_key_violation then null; end;
 reset role;
 perform pg_temp.as_user(rv); set local role authenticated;
 assert (select count(*) from public.crm_suppressions where workspace_id=w)=2,'reviewer reads the list';
 begin insert into public.crm_suppressions(workspace_id,kind,value,created_by) values(w,'email','x@y.test',rv); raise exception 'reviewer added'; exception when insufficient_privilege then null; end;
 delete from public.crm_suppressions where workspace_id=w; get diagnostics n=row_count; assert n=0,'reviewer cannot remove';
 reset role;
 perform pg_temp.as_user(st); set local role authenticated;
 assert (select count(*) from public.crm_suppressions where workspace_id=w)=0 and (select count(*) from public.crm_duplicate_dismissals where workspace_id=w)=0,'stranger sees nothing';
 reset role;
 perform pg_temp.as_user(ed); set local role authenticated;
 delete from public.crm_suppressions where workspace_id=w and value='mlin.test'; get diagnostics n=row_count; assert n=1,'editor removes an entry';
 reset role;
 raise notice 'PASS crm D: do-not-contact entries normalised and unique, reviewers read only, strangers nothing; dismissals ordered and workspace-bound';
end $$;

-- E. Client deletion removes everything about that client; retention purge is service-only.
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; w uuid:=(ids->>'w')::uuid; ed uuid:=(ids->>'ed')::uuid; c1 uuid:=(ids->>'c1')::uuid; n integer;
begin
 insert into public.crm_site_checks(workspace_id,url,status,result,checker_version,checked_at,expires_at,created_by) values(w,'https://old.test/','checked','{}','v1',now()-interval '40 days',now()-interval '10 days',ed);
 assert not has_function_privilege('authenticated','public.makeborne_crm_purge_expired_checks()','execute'),'browsers cannot purge';
 assert not has_function_privilege('anon','public.makeborne_crm_next_step_set(uuid,uuid,text,integer)','execute'),'anon cannot set next steps';
 n:=public.makeborne_crm_purge_expired_checks(); assert n=1,'expired prospect check purged';
 delete from public.projects where client_id=c1;
 delete from public.clients where id=c1;
 assert (select count(*) from public.crm_site_checks where client_id=c1)=0 and (select count(*) from public.crm_next_steps where client_id=c1)=0
  and (select count(*) from public.crm_duplicate_dismissals where client_a=c1 or client_b=c1)=0,'client deletion cascades';
 raise notice 'PASS crm E: client deletion removes its checks, next step and dismissals; expired prospect checks purge (service only)';
end $$;

-- F. What "Add as client" proposes (generated by src/lib/crm-research/facts.ts + knowledge factPayload from a fixture check) is accepted
--    by the real knowledge entry point as PROPOSED facts with url evidence; nothing is approved.
do $$
declare ids jsonb:=current_setting('crm.ids')::jsonb; o uuid:=(ids->>'o')::uuid; w uuid:=(ids->>'w')::uuid; c uuid:=(ids->>'c2')::uuid; item jsonb; r jsonb; n int:=0;
begin
 for item in select * from jsonb_array_elements($json$[{"fact":{"kind":"observed_fact","key":"contact.phone","label":"Phone (from their website)","valueText":"+387 33 123 456","observedAt":"2026-10-25T09:00:00.000Z"},"evidence":[{"kind":"url","url":"https://lana.test/","fetchedAt":"2026-10-25T09:00:00.000Z","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":{},"quote":"Phone: +387 33 123 456"}]},{"fact":{"kind":"observed_fact","key":"opening_hours.listed","label":"Opening hours (from their website)","valueText":"Mo-Su 10:00-22:00","observedAt":"2026-10-25T09:00:00.000Z","value":{"opens":"10:00","closes":"22:00"}},"evidence":[{"kind":"url","url":"https://lana.test/","fetchedAt":"2026-10-25T09:00:00.000Z","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":{},"quote":"Hours: Mo-Su 10:00-22:00"}]},{"fact":{"kind":"observed_fact","key":"website.issue.mobile","label":"Website: Not built for phones","valueText":"Not built for phones: The page has no mobile viewport setting. Checked 2026-10-25.","observedAt":"2026-10-25T09:00:00.000Z"},"evidence":[{"kind":"url","url":"https://lana.test/","fetchedAt":"2026-10-25T09:00:00.000Z","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":{},"quote":"Phone layout: no"}]},{"fact":{"kind":"observed_fact","key":"website.issue.slow","label":"Website: Slow to load","valueText":"Slow to load: took 4.1 s (Download time 4100 ms) Checked 2026-10-25.","observedAt":"2026-10-25T09:00:00.000Z"},"evidence":[{"kind":"url","url":"https://lana.test/","fetchedAt":"2026-10-25T09:00:00.000Z","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":{}}]}]$json$::jsonb) loop
  r:=public.makeborne_knowledge_propose(o,w,c,item->'fact',item->'evidence',null);
  assert r->>'status'='proposed','proposed: '||r::text; n:=n+1;
 end loop;
 assert n=4 and (select count(*) from public.client_facts where client_id=c and status='proposed')=4 and (select count(*) from public.client_facts where client_id=c and status='approved')=0,'four proposals, none approved';
 assert (select count(*) from public.client_fact_evidence e join public.client_facts f on f.id=e.fact_id where f.client_id=c and e.kind='url')=4,'url evidence stored';
 raise notice 'PASS crm F: website-check proposals land as PROPOSED client facts with url evidence; nothing approved';
end $$;


-- G. The add-as-client writes (create_record, outreach with a note, lead source, tag) pass the CRM write protocol and validators.
do $$
declare o uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); r jsonb; c uuid; upd timestamptz; n int;
begin
 insert into auth.users(id,email,email_confirmed_at) values(o,o||'@crm.invalid',now());
 insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(o,true,'crm fixture');
 insert into public.workspaces(id,name,owner_id) values(w,'CRM outreach fixture',o);
 perform pg_temp.as_user(o);
 perform set_config('request.headers', '{"x-makeborne-crm-protocol":"2"}', true);
 set local role authenticated;
 r:=public.makeborne_create_record(w, gen_random_uuid(), 'create_client', jsonb_build_object('name','Dental Studio Lana','company','','email','','website','https://lana.test/','notes','Added from a website check on 2026-10-25.'));
 c:=(r->'record'->>'id')::uuid; upd:=(r->'record'->>'updated_at')::timestamptz;
 update public.clients set outreach=jsonb_build_object('stage','Lead','channel','Phone','profileUrl','','lastContact',null,'nextFollowUp','2026-10-25','notes','',
   'activity',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'text','Added from a website check (website 62/100 room to improve).','type','note'))),
   lead_source='Website', tags=array['dentists tuzla'] where id=c and workspace_id=w and updated_at=upd;
 get diagnostics n=row_count; assert n=1,'outreach + lead fields saved through the CRM triggers';
 assert (select outreach->>'stage' from public.clients where id=c)='Lead';
 reset role;
 raise notice 'PASS crm G: add-as-client writes (create_record, outreach with a note, lead source, tag) pass the CRM write protocol and validators';
end $$;

rollback;
