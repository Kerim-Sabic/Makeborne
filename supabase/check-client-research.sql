-- Client research cache and briefs (20261024010000). Disposable local stack only; every fixture rolls back.
-- Run: docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-client-research.sql
-- Calls run as the database owner, standing in for the server's service role;
-- RLS sections switch to the authenticated role with a signed-in subject.
\set ON_ERROR_STOP on
begin;

create function pg_temp.page(url text, fetched timestamptz, ttl interval, status text default 'ok', reason text default null, body text default 'Fresh sourdough every morning') returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('url',url,'finalUrl',url,'status',status,'reason',reason,
  'sha256',case when status='ok' then encode(sha256(convert_to(body,'UTF8')),'hex') end,'bytes',length(body),
  'page',jsonb_build_object('title','Harbour Bakery','text',body),'extractorVersion','research-page-2026-10-24.1','fetchedAt',fetched,'expiresAt',fetched+ttl)) $$;
create function pg_temp.brief(label text) returns jsonb language sql as $$
 select jsonb_build_object('version','research-2026-10-24.1','label',label,'sections',jsonb_build_object('offering','[]'::jsonb)) $$;

do $$
declare u uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); rv uuid:=gen_random_uuid(); st uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); c3 uuid:=gen_random_uuid(); c4 uuid:=gen_random_uuid();
 p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid();
 op uuid:=gen_random_uuid(); op_ingest uuid:=gen_random_uuid(); op_other uuid:=gen_random_uuid();
 k1 uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); k3 uuid:=gen_random_uuid();
 x jsonb; y jsonb; r jsonb; n integer; t0 timestamptz:=now()-interval '1 hour';
 home text:='https://harbour-bakery.test/';
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@research.invalid',now()),(ed,ed||'@research.invalid',now()),(rv,rv||'@research.invalid',now()),(st,st||'@research.invalid',now());
 insert into public.workspaces(id,name,owner_id) values(w,'Research fixture',u),(w2,'Foreign fixture',st);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,ed,'editor'),(w,rv,'reviewer');
 insert into public.clients(id,workspace_id,name,company,website) values(c1,w,'Ana','Harbour Bakery',home),(c2,w,'Ben','Rival Bakery','https://rival.test/'),(c3,w2,'Foreign','Foreign','https://foreign.test/');
 insert into public.projects(id,workspace_id,client_id,title,kind,brief) values(p1,w,c1,'Bakery site','website',''),(p2,w,c2,'Rival site','website','');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a1,w,p1,'Bakery site','website'),(a2,w,p2,'Rival site','website');
 insert into makeborne_private.ai_operations(id,actor,workspace_id,artifact_id,action_key,kind,effort,input_hash,initial_version,last_version,initial_cap,authorized_credits,rate_microusd,request_context)
  values(op,ed,w,a1,gen_random_uuid(),'research','medium',repeat('d',64),0,0,20,20,30000,'{}'),(op_ingest,ed,w,a1,gen_random_uuid(),'ingest','medium',repeat('d',64),0,0,20,20,30000,'{}'),
   (op_other,u,w,a1,gen_random_uuid(),'research','medium',repeat('d',64),0,0,20,20,30000,'{}');

 -- A. Cache entry points: editor writes and reads; reviewer reads only; strangers and other workspaces nothing.
 x:=public.makeborne_research_page_put(ed,w,c1,pg_temp.page(home,t0,interval '72 hours'));
 assert x->>'status'='ok','editor caches a page';
 r:=public.makeborne_research_pages_read(rv,w,c1,array[home]);
 assert jsonb_array_length(r)=1 and r->0->>'sha256'=encode(sha256(convert_to('Fresh sourdough every morning','UTF8')),'hex') and not (r->0->>'expired')::boolean,'reviewer reads a valid copy';
 begin perform public.makeborne_research_page_put(rv,w,c1,pg_temp.page(home,now(),interval '1 hour')); raise exception 'reviewer wrote'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_pages_read(st,w,c1,array[home]); raise exception 'stranger read'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_pages_read(u,w,c3,array[home]); raise exception 'client from another workspace'; exception when sqlstate 'P0002' then null; end;
 begin perform public.makeborne_research_pages_read(u,w,c1,(select array_agg('https://x.test/'||g) from generate_series(1,41) g)); raise exception 'unbounded list'; exception when sqlstate '22023' then null; end;
 raise notice 'PASS research A: editors cache pages, reviewers read only, strangers and other workspaces refused, lists bounded';

 -- B. Tenant isolation: the same URL for another client or workspace is a different row, never shared.
 assert jsonb_array_length(public.makeborne_research_pages_read(u,w,c2,array[home]))=0,'client 2 does not see client 1''s page';
 perform public.makeborne_research_page_put(u,w,c2,pg_temp.page(home,t0,interval '72 hours','ok',null,'Client two copy'));
 perform public.makeborne_research_page_put(st,w2,c3,pg_temp.page(home,t0,interval '72 hours','ok',null,'Foreign copy'));
 assert (select count(*) from public.client_research_pages where url=home and workspace_id in (w,w2))=3,'three tenant rows for one URL';
 assert public.makeborne_research_pages_read(u,w,c1,array[home])->0->'page'->>'text'='Fresh sourdough every morning','client 1 keeps its own copy';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',rv,'role','authenticated')::text,true);
 set local role authenticated;
 assert (select count(*) from public.client_research_pages where url=home)=2,'members read their workspace''s rows only';
 begin insert into public.client_research_pages(workspace_id,client_id,url,status,sha256,extractor_version,fetched_at,expires_at,fetched_by) values(w,c1,'https://evil.test/','ok',repeat('a',64),'x',now(),now()+interval '1 hour',rv); raise exception 'browser insert'; exception when insufficient_privilege then null; end;
 begin update public.client_research_pages set page='{}'; raise exception 'browser update'; exception when insufficient_privilege then null; end;
 begin delete from public.client_research_briefs; raise exception 'browser delete'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_page_put(rv,w,c1,pg_temp.page(home,now(),interval '1 hour')); raise exception 'browser executes entry point'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',st,'role','authenticated')::text,true);
 set local role authenticated;
 assert (select count(*) from public.client_research_pages where workspace_id=w)=0 and (select count(*) from public.client_research_briefs where workspace_id=w)=0,'stranger reads nothing';
 reset role;
 perform set_config('request.jwt.claims','{}',true);
 set local role anon;
 begin perform 1 from public.client_research_pages; raise exception 'anon read'; exception when insufficient_privilege then null; end;
 reset role;
 raise notice 'PASS research B: cache rows are per workspace and client; RLS lets members read their own workspace only; browsers and anon cannot write or execute';

 -- C. Freshness: expired copies are flagged; an older read never replaces a newer one; bounds enforced.
 perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://harbour-bakery.test/menu',now()-interval '80 hours',interval '72 hours'));
 assert (public.makeborne_research_pages_read(u,w,c1,array['https://harbour-bakery.test/menu'])->0->>'expired')::boolean,'expired copy flagged';
 perform public.makeborne_research_page_put(u,w,c1,pg_temp.page(home,t0-interval '2 hours',interval '72 hours','ok',null,'Older copy'));
 assert public.makeborne_research_pages_read(u,w,c1,array[home])->0->'page'->>'text'='Fresh sourdough every morning','an older read does not replace a newer one';
 perform public.makeborne_research_page_put(u,w,c1,pg_temp.page(home,now(),interval '72 hours','ok',null,'Newest copy'));
 assert public.makeborne_research_pages_read(u,w,c1,array[home])->0->'page'->>'text'='Newest copy','a newer read replaces it';
 perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://forbidden.test/',now(),interval '1 hour','inaccessible','blocked'));
 assert public.makeborne_research_pages_read(u,w,c1,array['https://forbidden.test/'])->0->>'reason'='blocked','failed reads cached with their reason';
 begin perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://x.test/',now(),interval '31 days')); raise exception 'ttl unbounded'; exception when check_violation then null; end;
 begin perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://x.test/',now(),interval '1 hour','inaccessible','hacked')); raise exception 'unknown reason'; exception when check_violation then null; end;
 begin perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://x.test/',now(),interval '1 hour','ok','blocked')); raise exception 'ok with a reason'; exception when check_violation then null; end;
 begin perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('file:///etc/passwd',now(),interval '1 hour')); raise exception 'non-web url'; exception when check_violation then null; end;
 begin perform public.makeborne_research_page_put(u,w,c1,jsonb_set(pg_temp.page('https://x.test/',now(),interval '1 hour'),'{page}',jsonb_build_object('text',repeat('x',70000)))); raise exception 'page unbounded'; exception when check_violation then null; end;
 begin perform public.makeborne_research_page_put(u,w,c1,pg_temp.page('https://x.test/',now()+interval '1 day',interval '1 hour')); raise exception 'future read'; exception when sqlstate '22023' then null; end;
 raise notice 'PASS research C: expiry flagged, newer reads win, failures cached with a known reason, ttl/url/size bounds enforced';

 -- D. Briefs: one action key, one brief; replays are exact; scope and operation checked.
 x:=public.makeborne_research_brief_save(ed,w,c1,a1,k1,null,repeat('1',64),'deterministic',pg_temp.brief('first'));
 assert not (x->>'replayed')::boolean and x->>'briefSha256'=encode(sha256(convert_to((pg_temp.brief('first'))::text,'UTF8')),'hex'),'brief saved with its digest';
 y:=public.makeborne_research_brief_save(ed,w,c1,a1,k1,null,repeat('1',64),'deterministic',pg_temp.brief('second attempt'));
 assert (y->>'replayed')::boolean and y->>'id'=x->>'id' and y->'brief'->>'label'='first','a repeat returns the stored brief unchanged';
 begin perform public.makeborne_research_brief_save(ed,w,c1,a1,k1,null,repeat('2',64),'deterministic',pg_temp.brief('other')); raise exception 'key reused for other request'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_research_brief_save(u,w,c1,a1,k1,null,repeat('1',64),'deterministic',pg_temp.brief('other actor')); raise exception 'key reused by another actor'; exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_research_brief_save(ed,w,c1,a2,k2,null,repeat('1',64),'deterministic',pg_temp.brief('x')); raise exception 'another client''s project'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_brief_save(ed,w,c1,a1,k2,op_ingest,repeat('1',64),'assisted',pg_temp.brief('x')); raise exception 'wrong operation kind'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_brief_save(ed,w,c1,a1,k2,op_other,repeat('1',64),'assisted',pg_temp.brief('x')); raise exception 'another actor''s operation'; exception when insufficient_privilege then null; end;
 begin perform public.makeborne_research_brief_save(ed,w,c1,a1,k2,null,repeat('1',64),'assisted',pg_temp.brief('x')); raise exception 'assisted without operation'; exception when check_violation then null; end;
 begin perform public.makeborne_research_brief_save(rv,w,c1,a1,k2,null,repeat('1',64),'deterministic',pg_temp.brief('x')); raise exception 'reviewer saved'; exception when insufficient_privilege then null; end;
 y:=public.makeborne_research_brief_save(ed,w,c1,a1,k2,op,repeat('3',64),'assisted',pg_temp.brief('assisted'));
 assert y->>'operationId'=op::text and y->>'method'='assisted','assisted brief bound to its research operation';
 r:=public.makeborne_research_brief_save(ed,w,c1,null,k3,null,repeat('4',64),'deterministic',pg_temp.brief('no project'));
 assert r->>'artifactId' is null,'a brief without a project is allowed when written without AI';
 assert public.makeborne_research_brief_read(rv,w,c1,(x->>'id')::uuid,null)->>'id'=x->>'id','reviewer reads by id';
 assert public.makeborne_research_brief_read(rv,w,c1,null,k1)->>'id'=x->>'id','and by action key';
 assert public.makeborne_research_brief_read(u,w,c2,(x->>'id')::uuid,null) is null,'another client cannot read it';
 begin perform public.makeborne_research_brief_read(st,w,c1,(x->>'id')::uuid,null); raise exception 'stranger read brief'; exception when insufficient_privilege then null; end;
 assert exists(select 1 from public.audit_events where workspace_id=w and action='research.brief_saved' and target_id=(x->>'id')::uuid),'brief saves are audited';
 raise notice 'PASS research D: one brief per action key, exact replays, key reuse refused, anchor and operation scoped to this client and actor, reviewers read only';

 -- E. Permission change mid-run and client deletion.
 update public.workspace_members set role='reviewer' where workspace_id=w and user_id=ed;
 begin perform public.makeborne_research_page_put(ed,w,c1,pg_temp.page(home,now(),interval '1 hour')); raise exception 'demoted editor wrote'; exception when insufficient_privilege then null; end;
 delete from public.workspace_members where workspace_id=w and user_id=ed;
 begin perform public.makeborne_research_pages_read(ed,w,c1,array[home]); raise exception 'removed member read'; exception when insufficient_privilege then null; end;
 insert into public.clients(id,workspace_id,name,website) values(c4,w,'Lead without projects','https://lead.test/');
 perform public.makeborne_research_page_put(u,w,c4,pg_temp.page('https://lead.test/',now(),interval '1 hour'));
 perform public.makeborne_research_brief_save(u,w,c4,null,gen_random_uuid(),null,repeat('5',64),'deterministic',pg_temp.brief('lead'));
 delete from public.clients where id=c4;
 assert not exists(select 1 from public.client_research_pages where client_id=c4) and not exists(select 1 from public.client_research_briefs where client_id=c4),'deleting a client removes its cache and briefs';
 assert exists(select 1 from public.client_research_pages where client_id=c2) and exists(select 1 from public.client_research_briefs where client_id=c1),'other clients untouched';
 raise notice 'PASS research E: a demoted or removed member stops at the next call; deleting a client removes its research';
end $$;

-- F. Catalog: entry points are service-only; tables have RLS.
do $$ begin
 assert (select bool_and(relrowsecurity) from pg_class where relname in ('client_research_pages','client_research_briefs')),'RLS on';
 assert not has_function_privilege('authenticated','public.makeborne_research_page_put(uuid,uuid,uuid,jsonb)','execute')
   and not has_function_privilege('anon','public.makeborne_research_brief_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','execute')
   and has_function_privilege('service_role','public.makeborne_research_brief_read(uuid,uuid,uuid,uuid,uuid)','execute'),'service-only entry points';
 assert not has_table_privilege('authenticated','public.client_research_pages','insert') and has_table_privilege('authenticated','public.client_research_pages','select'),'members read, never write';
 raise notice 'PASS research F: RLS on both tables; entry points service-only; browsers read only';
end $$;

rollback;
