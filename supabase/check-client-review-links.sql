-- Client review link checks. LOCAL DATABASE ONLY. Everything rolls back.
-- Run: docker exec -i supabase_db_makeborne-local psql -U postgres -v ON_ERROR_STOP=1 < supabase/check-client-review-links.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); rv uuid:=gen_random_uuid();
  wa uuid; wb uuid; ca uuid; pa uuid; art uuid; site uuid; pb uuid; artb uuid;
  tok text:=translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'); tok2 text; tok3 text; tok4 text; tok5 text;
  link jsonb; r jsonb; c jsonb; n integer; t timestamptz:=clock_timestamp(); v text;
begin
  tok:=left(tok,43);
  tok2:=left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok3:=left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok4:=left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok5:=left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  perform set_config('request.jwt.claims','{}',true);
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    (a,'review-a-'||a||'@example.invalid',t,false),(b,'review-b-'||b||'@example.invalid',t,false),
    (ed,'review-e-'||ed||'@example.invalid',t,false),(rv,'review-r-'||rv||'@example.invalid',t,false);
  insert into public.workspaces(name,owner_id) values('Review A',a) returning id into wa;
  insert into public.workspaces(name,owner_id) values('Review B',b) returning id into wb;
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,ed,'editor'),(wa,rv,'reviewer');
  insert into public.clients(workspace_id,name,email,outreach) values(wa,'Jane Client','jane@example.invalid',
    '{"stage":"Proposal","channel":"Email","profileUrl":"","lastContact":null,"nextFollowUp":null,"notes":"","activity":[]}') returning id into ca;
  insert into public.projects(workspace_id,client_id,title,kind,status) values(wa,ca,'Field guide','book','in_progress') returning id into pa;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(wa,pa,'book','Field guide',0) returning id into art;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(wa,art,1,'{"schemaVersion":1,"title":"Field guide","kind":"book","sections":[],"reviewQuestions":["internal"]}','{"id":"editorial","referenceAssetIds":[]}',a);
  update public.artifacts set current_version=1 where id=art;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(wa,pa,'website','Site',0) returning id into site;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(wa,site,1,'{"schemaVersion":1,"title":"Site","kind":"website","sections":[],"website":{"html":"<main></main>","css":""}}','{}',a);
  update public.artifacts set current_version=1 where id=site;
  insert into public.projects(workspace_id,title,kind) values(wb,'Other','book') returning id into pb;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(wb,pb,'book','Other',0) returning id into artb;

  -- Creation is service-role only and stores only the token hash.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  begin perform public.makeborne_create_client_review_link(a,wa,art,1,false,sha256(convert_to(tok,'UTF8')),7,'Jane','Hello',null);
    raise exception 'Authenticated caller created a link directly';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  link:=public.makeborne_create_client_review_link(a,wa,art,1,false,sha256(convert_to(tok,'UTF8')),7,'Jane',E'Hello‮ there',null);
  assert not link ? 'token_hash', 'Creation returned the token hash';
  begin perform public.makeborne_create_client_review_link(rv,wa,art,1,false,sha256(convert_to(tok2,'UTF8')),7,'',''::text,null);
    raise exception 'Reviewer created a link';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_create_client_review_link(b,wa,art,1,false,sha256(convert_to(tok2,'UTF8')),7,'',''::text,null);
    raise exception 'Other workspace owner created a link';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_create_client_review_link(a,wa,art,1,false,sha256(convert_to(tok2,'UTF8')),91,'',''::text,null);
    raise exception 'Link longer than 90 days';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_create_client_review_link(a,wa,site,1,false,sha256(convert_to(tok2,'UTF8')),7,'',''::text,null);
    raise exception 'Website link created without a review copy';
  exception when sqlstate '22023' then null; end;
  reset role;
  assert (select token_hash=sha256(convert_to(tok,'UTF8')) and octet_length(token_hash)=32 from public.client_review_links where id=(link->>'id')::uuid), 'Token hash not stored';
  assert not exists(select 1 from public.client_review_links l where position(convert_to(tok,'UTF8') in l.token_hash)>0 or l.message like '%'||tok||'%'), 'Raw token stored';
  assert (select message from public.client_review_links where id=(link->>'id')::uuid)='Hello there', 'Bidi override kept in message';
  assert (select status from public.projects where id=pa)='review', 'Project not moved to review';
  assert (select outreach->>'stage' from public.clients where id=ca)='Review', 'Client stage not moved to Review';
  assert (select outreach->'activity'->-1->>'text' from public.clients where id=ca) like 'Stage: Proposal → Review%', 'Stage change not recorded';
  raise notice 'PASS creation, hashing, roles and stage move';

  -- Anonymous client access goes only through the token functions.
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin perform count(*) from public.client_review_links; raise exception 'Anon read links table';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.client_review_comments; raise exception 'Anon read comments table';
  exception when insufficient_privilege then null; end;
  begin perform makeborne_private.client_review_token_hash(tok); raise exception 'Anon called a private helper';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_revoke_client_review_link(wa,(link->>'id')::uuid); raise exception 'Anon revoked';
  exception when insufficient_privilege then null; end;
  assert public.makeborne_read_client_review(tok2) is null, 'Unknown token returned data';
  assert public.makeborne_read_client_review('short') is null, 'Malformed token returned data';
  assert public.makeborne_read_client_review(upper(tok)) is null or upper(tok)=tok, 'Token comparison not exact';
  r:=public.makeborne_read_client_review(tok);
  assert r->>'status'='active' and r->>'kind'='book' and (r->>'version')::int=1 and r->>'mode'='content', 'Active payload wrong: '||r;
  assert not (r->'content') ? 'reviewQuestions' and not (r->'style') ? 'referenceAssetIds', 'Internal fields leaked';
  assert position('token' in r::text)=0 and position(a::text in r::text)=0 and position(wa::text in r::text)=0, 'Payload leaks identifiers';
  c:=public.makeborne_add_client_review_comment(tok,'  Jane  ','JANE@Example.invalid',E'Make the <b>cover</b> warmer\x07​','{"kind":"point","ref":"page:0","label":"Cover","x":0.25,"y":0.5}');
  assert c->>'body'='Make the <b>cover</b> warmer' and c->>'authorName'='Jane' and not c ? 'authorEmail', 'Comment not cleaned: '||c;
  assert (c->'anchor'->>'x')::numeric=0.25 and c->'anchor'->>'kind'='point', 'Anchor lost';
  for v in select unnest(array['{"kind":"point","ref":"x","x":2,"y":0}','{"kind":"point","ref":"x"}','{"kind":"section","ref":"bad ref!"}','{"kind":"general","extra":1}','{"kind":"script"}']) loop
    begin perform public.makeborne_add_client_review_comment(tok,'Jane','','ok',v::jsonb); raise exception 'Invalid anchor accepted: %',v;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.makeborne_add_client_review_comment(tok,'','','ok',null); raise exception 'Empty name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_add_client_review_comment(tok,'Jane','not-an-email','ok',null); raise exception 'Invalid email accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_add_client_review_comment(tok,'Jane','',repeat('x',2001),null); raise exception 'Long comment accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_add_client_review_comment(tok,'Jane','',E'\x07 ',null); raise exception 'Blank comment accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_add_client_review_comment(tok2,'Jane','','ok',null); raise exception 'Unknown token commented';
  exception when sqlstate 'P0002' then null; end;
  n:=1;
  loop
    begin perform public.makeborne_add_client_review_comment(tok,'Jane','','Note '||n,null);
    exception when sqlstate 'MB429' then exit; end;
    n:=n+1;
    if n>30 then raise exception 'Comment rate limit not enforced'; end if;
  end loop;
  assert n=20, 'Rate limit allowed '||n||' comments in ten minutes';
  r:=public.makeborne_read_client_review(tok);
  assert jsonb_array_length(r->'comments')=20 and position('example.invalid' in r::text)=0, 'Comments missing or emails exposed: '||jsonb_array_length(r->'comments')||left(r::text,300);
  reset role;
  raise notice 'PASS anonymous read, comment validation, sanitising and rate limits';

  -- Tenant isolation: other workspaces see nothing and cannot change anything.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*) from public.client_review_links where workspace_id=wa)=0, 'Other workspace read links';
  assert (select count(*) from public.client_review_comments where workspace_id=wa)=0, 'Other workspace read comments';
  begin perform public.makeborne_revoke_client_review_link(wa,(link->>'id')::uuid); raise exception 'Other workspace revoked';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_resolve_client_review_comment(wa,(c->>'id')::uuid,true); raise exception 'Other workspace resolved';
  exception when insufficient_privilege then null; end;
  begin perform public.makeborne_revoke_client_review_link(wb,(link->>'id')::uuid); raise exception 'Cross-workspace id revoked';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',rv,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*) from public.client_review_comments where workspace_id=wa)=20, 'Reviewer member cannot read comments';
  begin perform public.makeborne_resolve_client_review_comment(wa,(c->>'id')::uuid,true); raise exception 'Reviewer resolved';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  begin perform token_hash from public.client_review_links limit 1; raise exception 'Member read token hashes';
  exception when insufficient_privilege then null; end;
  begin perform html from public.client_review_snapshots limit 1; raise exception 'Member read snapshot html through the API';
  exception when insufficient_privilege then null; end;
  begin insert into public.client_review_comments(workspace_id,link_id,version_number,author_name,body) values(wa,(link->>'id')::uuid,1,'x','y');
    raise exception 'Member inserted a comment directly';
  exception when insufficient_privilege then null; end;
  assert (public.makeborne_resolve_client_review_comment(wa,(c->>'id')::uuid,true)->>'resolved_at') is not null, 'Owner could not resolve';
  assert (select count(*) from public.client_review_links where workspace_id=wa)=1, 'Owner cannot read links';
  reset role;
  raise notice 'PASS tenant isolation and column privileges';

  -- Decisions move the pipeline; approval lands on Delivered.
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  r:=public.makeborne_decide_client_review(tok,'Jane','','changes_requested','Warmer cover please');
  assert r->'decision'->>'value'='changes_requested', 'Change request not recorded';
  reset role;
  assert (select status from public.projects where id=pa)='in_progress', 'Project not back in progress';
  assert (select outreach->>'stage' from public.clients where id=ca)='Review', 'Change request moved the stage';
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin perform public.makeborne_decide_client_review(tok,'Jane','','maybe',''); raise exception 'Unknown decision accepted';
  exception when sqlstate '22023' then null; end;
  r:=public.makeborne_decide_client_review(tok,'Jane','','approved','');
  assert (public.makeborne_read_client_review(tok)->'decision'->>'value')='approved', 'Approval not visible';
  reset role;
  assert (select status from public.projects where id=pa)='approved', 'Project not approved';
  assert (select outreach->>'stage' from public.clients where id=ca)='Delivered', 'Client not Delivered';
  assert (select count(*) from public.client_review_comments where link_id=(link->>'id')::uuid and kind<>'comment')=2, 'Decision history missing';
  raise notice 'PASS decisions and CRM stage changes';

  -- Revocation, expiry and creator access loss all close the link.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.makeborne_revoke_client_review_link(wa,(link->>'id')::uuid);
  reset role;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  assert public.makeborne_read_client_review(tok)->>'status'='revoked', 'Revoked link still active';
  assert not public.makeborne_read_client_review(tok) ? 'comments', 'Revoked link exposed comments';
  begin perform public.makeborne_add_client_review_comment(tok,'Jane','','late',null); raise exception 'Revoked link accepted a comment';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.makeborne_decide_client_review(tok,'Jane','','approved',''); raise exception 'Revoked link accepted a decision';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  link:=public.makeborne_create_client_review_link(a,wa,art,1,true,sha256(convert_to(tok3,'UTF8')),1,'','',null);
  perform public.makeborne_create_client_review_link(ed,wa,art,1,false,sha256(convert_to(tok4,'UTF8')),1,'','',null);
  perform public.makeborne_create_client_review_link(a,wa,site,1,false,sha256(convert_to(tok5,'UTF8')),1,'','','<!doctype html><html><head></head><body><main><h1>Static review copy</h1><p>Hello there</p></main></body></html>');
  reset role;
  -- "Latest" follows new saves; pinned links stay on their version.
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(wa,art,2,'{"schemaVersion":1,"title":"Field guide","kind":"book","sections":[]}','{}',a);
  update public.artifacts set current_version=2 where id=art;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  assert (public.makeborne_read_client_review(tok3)->>'version')::int=2, 'Latest link did not follow the new version';
  assert (public.makeborne_read_client_review(tok4)->>'version')::int=1, 'Pinned link moved';
  r:=public.makeborne_read_client_review(tok5);
  assert r->>'mode'='html' and r->>'html' like '%Static review copy%' and jsonb_typeof(r->'content')='null', 'Website snapshot not served: '||left(r::text,300);
  reset role;
  update public.client_review_links set created_at=now()-interval '3 days',expires_at=now()-interval '1 second' where token_hash=sha256(convert_to(tok3,'UTF8'));
  delete from public.workspace_members where workspace_id=wa and user_id=ed;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  assert public.makeborne_read_client_review(tok3)->>'status'='expired', 'Expired link still active';
  begin perform public.makeborne_add_client_review_comment(tok3,'Jane','','late',null); raise exception 'Expired link accepted a comment';
  exception when sqlstate 'P0002' then null; end;
  assert public.makeborne_read_client_review(tok4)->>'status'='revoked', 'Link survived its creator losing access';
  reset role;
  raise notice 'PASS revocation, expiry, latest vs pinned, website snapshots';
end $$;
rollback;
