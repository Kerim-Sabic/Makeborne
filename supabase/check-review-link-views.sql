-- Review link view tracking: shape, grants/RLS, monotonic bounded heartbeats,
-- page limits, member exclusion, link liveness, daily limits and cascades.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261015100000.
-- Time is simulated by moving last_seen_at back: now() is fixed inside one transaction.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); ed uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  w uuid; p uuid; art uuid; link uuid; dead uuid; old uuid;
  tok text := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok_dead text := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok_old text := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  priv text; r jsonb; v public.client_review_views%rowtype; n integer; i integer; bad jsonb; big jsonb;
  t timestamptz := clock_timestamp();
begin
  -- Shape.
  assert (select relrowsecurity from pg_class where oid = 'public.client_review_views'::regclass), 'RLS disabled';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'client_review_views')
    = array['id','workspace_id','link_id','session_id','started_at','last_seen_at','active_seconds','opens','device','pages'], 'Unexpected columns (no IP, user agent or cookie columns allowed)';
  assert (select count(*) from pg_constraint where conrelid = 'public.client_review_views'::regclass and contype = 'f' and confdeltype = 'c'
    and confrelid = 'public.client_review_links'::regclass) = 1, 'Views must cascade with their link';
  assert (select count(*) from pg_constraint where conrelid = 'public.client_review_views'::regclass and contype = 'u') = 1, 'One session row per link';
  assert (select prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'public.makeborne_record_client_review_view(text,uuid,text,boolean,jsonb)'::regprocedure), 'Heartbeat must be security definer with empty search_path';
  raise notice 'PASS review views: columns, cascade, unique session, heartbeat definition';

  -- Grants: browsers can call the heartbeat, read through RLS, never write.
  assert not has_function_privilege('public','public.makeborne_record_client_review_view(text,uuid,text,boolean,jsonb)','execute'), 'PUBLIC can execute heartbeat';
  assert has_function_privilege('anon','public.makeborne_record_client_review_view(text,uuid,text,boolean,jsonb)','execute'), 'anon cannot execute heartbeat';
  assert has_function_privilege('authenticated','public.makeborne_record_client_review_view(text,uuid,text,boolean,jsonb)','execute'), 'authenticated cannot execute heartbeat';
  foreach priv in array array['select','insert','update','delete','truncate','references','trigger'] loop
    assert not has_table_privilege('anon','public.client_review_views',priv), 'anon has '||priv;
    assert not has_table_privilege('authenticated','public.client_review_views',priv), 'authenticated has table-wide '||priv;
  end loop;
  assert not has_column_privilege('authenticated','public.client_review_views','session_id','select'), 'Members can read browser session ids';
  assert has_column_privilege('authenticated','public.client_review_views','pages','select'), 'Members cannot read pages';
  raise notice 'PASS review views: anon/authenticated execute only; members read every column except the session id; no browser writes';

  -- Fixtures: an owner, an editor member and an outsider; one deck with three links.
  perform set_config('request.jwt.claims','{}',true);
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    (u,'views-o-'||u||'@example.invalid',t,false),(ed,'views-e-'||ed||'@example.invalid',t,false),(other,'views-x-'||other||'@example.invalid',t,false);
  insert into public.workspaces(name,owner_id) values('Views fixture',u) returning id into w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ed,'editor');
  insert into public.projects(workspace_id,title,kind) values(w,'Pitch','presentation') returning id into p;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,p,'presentation','Pitch',0) returning id into art;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(w,art,1,'{"schemaVersion":1,"title":"Pitch","kind":"presentation","sections":[]}','{}',u);
  update public.artifacts set current_version=1 where id=art;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,recipient_name,expires_at,created_by)
    values(w,p,art,sha256(convert_to(tok,'UTF8')),'Sarah',now()+interval '7 days',u) returning id into link;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,expires_at,revoked_at,created_by)
    values(w,p,art,sha256(convert_to(tok_dead,'UTF8')),now()+interval '7 days',now(),u) returning id into dead;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,expires_at,created_by,created_at)
    values(w,p,art,sha256(convert_to(tok_old,'UTF8')),now()-interval '1 minute',u,now()-interval '2 days') returning id into old;

  -- First heartbeat from an anonymous client opens a session.
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,s1,'phone',true,'[{"ref":"slide:0","label":"Slide 1 · Welcome","seconds":0}]');
  reset role;
  assert (r->>'recorded')::boolean, 'Anonymous open not recorded: '||r;
  select * into v from public.client_review_views where link_id=link and session_id=s1;
  assert v.workspace_id = w and v.device = 'phone' and v.opens = 1 and v.active_seconds = 0, 'Unexpected new session';
  assert v.pages = '{"slide:0":{"s":0,"l":"Slide 1 · Welcome"}}'::jsonb, 'First page not recorded: '||v.pages;

  -- An immediate repeat is throttled and changes nothing.
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,s1,'phone',false,'[{"ref":"slide:0","seconds":30}]');
  reset role;
  assert r->>'reason' = 'throttled' and (select active_seconds from public.client_review_views where session_id=s1) = 0, 'Rapid heartbeat counted';

  -- Increments never exceed the time that passed (+5 s slack).
  update public.client_review_views set last_seen_at = now()-interval '10 seconds', started_at = now()-interval '2 hours' where session_id=s1;
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,s1,'desktop',false,'[{"ref":"slide:0","seconds":30}]');
  reset role;
  select * into v from public.client_review_views where session_id=s1;
  assert v.active_seconds = 15 and (v.pages->'slide:0'->>'s')::integer = 15, 'Wall-clock cap ignored: '||v.active_seconds;
  assert v.device = 'phone', 'Device changed after the first heartbeat';
  assert v.pages->'slide:0'->>'l' = 'Slide 1 · Welcome', 'Missing label erased the stored one';
  assert v.last_seen_at = now(), 'last_seen_at not advanced';

  -- Each heartbeat adds at most 60 s, split across slides in order.
  update public.client_review_views set last_seen_at = now()-interval '1 hour' where session_id=s1;
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,s1,'phone',true,
    jsonb_build_array(jsonb_build_object('ref','slide:5','label',E'  Slide 6 ‮· Pricing\u0007 ','seconds',40),jsonb_build_object('ref','slide:6','label',repeat('x',300),'seconds',40)));
  reset role;
  select * into v from public.client_review_views where session_id=s1;
  assert v.active_seconds = 75, 'Per-heartbeat cap ignored: '||v.active_seconds;
  assert (v.pages->'slide:5'->>'s')::integer = 40 and (v.pages->'slide:6'->>'s')::integer = 20, 'Budget not split in order: '||v.pages;
  assert v.pages->'slide:5'->>'l' = 'Slide 6 · Pricing', 'Label not cleaned: '||(v.pages->'slide:5'->>'l');
  assert length(v.pages->'slide:6'->>'l') = 80, 'Label not truncated to 80';
  assert v.opens = 2, 'Reload in the same tab not counted as an open';
  raise notice 'PASS review views: anonymous open, 1 s throttle, wall-clock cap, 60 s per heartbeat split in order, labels cleaned, opens counted';

  -- Sessions stop at 4 hours; seconds never decrease.
  update public.client_review_views set active_seconds = 14390, last_seen_at = now()-interval '1 hour' where session_id=s1;
  set local role anon;
  perform public.makeborne_record_client_review_view(tok,s1,'phone',false,'[{"ref":"slide:5","seconds":60}]');
  reset role;
  update public.client_review_views set last_seen_at = now()-interval '1 hour' where session_id=s1;
  set local role anon;
  perform public.makeborne_record_client_review_view(tok,s1,'phone',false,'[{"ref":"slide:5","seconds":60}]');
  perform public.makeborne_record_client_review_view(tok,s1,'phone',false,'[]');
  reset role;
  select * into v from public.client_review_views where session_id=s1;
  assert v.active_seconds = 14400 and (v.pages->'slide:5'->>'s')::integer = 50, 'Session cap: '||v.active_seconds||' '||v.pages;
  begin update public.client_review_views set active_seconds = 14401 where session_id=s1; raise exception 'Over-cap seconds stored';
  exception when check_violation then null; end;

  -- At most 200 distinct pages; time on further pages still counts toward the session.
  select jsonb_object_agg('slide:'||g, jsonb_build_object('s',1,'l','')) into big from generate_series(1,200) g;
  set local role anon;
  perform public.makeborne_record_client_review_view(tok,s2,'desktop',true,'[]');
  reset role;
  update public.client_review_views set pages = big, last_seen_at = now()-interval '1 minute', started_at = now()-interval '2 hours' where session_id=s2;
  set local role anon;
  perform public.makeborne_record_client_review_view(tok,s2,'desktop',false,'[{"ref":"slide:999","seconds":20},{"ref":"slide:3","seconds":10}]');
  reset role;
  select * into v from public.client_review_views where session_id=s2;
  assert (select count(*) from jsonb_object_keys(v.pages)) = 200 and not v.pages ? 'slide:999', 'Page limit exceeded';
  assert v.active_seconds = 30 and (v.pages->'slide:3'->>'s')::integer = 11, 'Existing page not updated at the limit';
  raise notice 'PASS review views: 4 h session cap, monotonic seconds, at most 200 pages per session';

  -- Malformed heartbeats are refused before any write.
  foreach bad in array array[
    '{}'::jsonb, '[1]', '[{"ref":"bad ref","seconds":1}]', '[{"ref":"slide:1","seconds":61}]', '[{"ref":"slide:1","seconds":-1}]',
    '[{"ref":"slide:1","seconds":1.5}]', '[{"ref":"slide:1","seconds":"5"}]', '[{"ref":"slide:1"}]', '[{"ref":"slide:1","seconds":1,"ip":"1.2.3.4"}]',
    '[{"ref":"slide:1","seconds":1,"label":7}]', jsonb_build_array(jsonb_build_object('ref','slide:1','seconds',1,'label',repeat('x',401))),
    (select jsonb_agg(jsonb_build_object('ref','slide:'||g,'seconds',0)) from generate_series(1,21) g)] loop
    begin
      set local role anon;
      perform public.makeborne_record_client_review_view(tok,s3,'desktop',true,bad);
      raise exception 'Malformed heartbeat accepted: %', bad;
    exception when sqlstate '22023' then reset role;
    end;
  end loop;
  for i in 1..3 loop
    begin
      set local role anon;
      if i = 1 then perform public.makeborne_record_client_review_view(tok,null,'desktop',true,'[]');
      elsif i = 2 then perform public.makeborne_record_client_review_view(tok,s3,'watch',true,'[]');
      else perform public.makeborne_record_client_review_view(tok,s3,'desktop',null,'[]'); end if;
      raise exception 'Malformed heartbeat accepted (%)', i;
    exception when sqlstate '22023' then reset role;
    end;
  end loop;
  assert not exists(select 1 from public.client_review_views where session_id=s3), 'Refused heartbeat wrote a row';
  raise notice 'PASS review views: 15 malformed heartbeats refused with 22023 and nothing written';

  -- Only live links: unknown, malformed, revoked and expired tokens are refused.
  foreach bad in array array[to_jsonb(left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43)), to_jsonb('short'::text), to_jsonb(tok_dead), to_jsonb(tok_old)] loop
    begin
      set local role anon;
      perform public.makeborne_record_client_review_view(bad#>>'{}',gen_random_uuid(),'desktop',true,'[]');
      raise exception 'Heartbeat accepted for an unavailable link';
    exception when sqlstate 'P0002' then reset role;
    end;
  end loop;
  assert not exists(select 1 from public.client_review_views where link_id in (dead,old)), 'View stored for an unavailable link';
  raise notice 'PASS review views: unknown, malformed, revoked and expired links refused with P0002';

  -- The owner and members previewing their link are not counted; outsiders are.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  r := public.makeborne_record_client_review_view(tok,s3,'desktop',true,'[]');
  reset role;
  assert r->>'reason' = 'member', 'Owner view counted';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ed,'role','authenticated')::text,true);
  set local role authenticated;
  r := public.makeborne_record_client_review_view(tok,s3,'desktop',true,'[]');
  reset role;
  assert r->>'reason' = 'member' and not exists(select 1 from public.client_review_views where session_id=s3), 'Member view counted';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
  set local role authenticated;
  r := public.makeborne_record_client_review_view(tok,s3,'tablet',true,'[]');
  reset role;
  assert (r->>'recorded')::boolean and exists(select 1 from public.client_review_views where session_id=s3 and device='tablet'), 'Signed-in outsider not counted';

  -- RLS: owner and member read; the outsider and anon read nothing; nobody writes.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ed,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into n from public.client_review_views where link_id = link;
  assert n = 3, 'Member cannot read the link''s views ('||n||')';
  begin insert into public.client_review_views(workspace_id,link_id,session_id,device) values(w,link,gen_random_uuid(),'desktop'); raise exception 'Browser inserted a view';
  exception when insufficient_privilege then null; end;
  begin update public.client_review_views set active_seconds = 0; raise exception 'Browser changed a view';
  exception when insufficient_privilege then null; end;
  begin delete from public.client_review_views; raise exception 'Browser deleted a view';
  exception when insufficient_privilege then null; end;
  begin perform session_id from public.client_review_views; raise exception 'Member read session ids';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*) from public.client_review_views) = 0, 'Outsider read views';
  reset role;
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin perform 1 from public.client_review_views; raise exception 'anon read views';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS review views: owner/member previews not counted, signed-in outsiders counted, RLS reads, no browser writes';

  -- At most 200 new sessions per link per day.
  insert into public.client_review_views(workspace_id,link_id,session_id,device)
    select w,link,gen_random_uuid(),'desktop' from generate_series(1,196);
  assert (select count(*) from public.client_review_views where link_id=link) = 199, 'Fixture count';
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,gen_random_uuid(),'desktop',true,'[]');
  reset role;
  assert (r->>'recorded')::boolean, '200th session refused';
  begin
    set local role anon;
    perform public.makeborne_record_client_review_view(tok,gen_random_uuid(),'desktop',true,'[]');
    raise exception '201st session accepted';
  exception when sqlstate 'MB429' then reset role;
  end;
  update public.client_review_views set last_seen_at = now()-interval '1 minute' where session_id=s2;
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,s2,'desktop',false,'[{"ref":"slide:3","seconds":5}]');
  reset role;
  assert (r->>'recorded')::boolean, 'Existing session blocked by the new-session limit';
  update public.client_review_views set started_at = now()-interval '25 hours', last_seen_at = now()-interval '25 hours' where link_id=link;
  set local role anon;
  r := public.makeborne_record_client_review_view(tok,gen_random_uuid(),'desktop',true,'[]');
  reset role;
  assert (r->>'recorded')::boolean, 'Limit did not reset after a day';
  raise notice 'PASS review views: 200 new sessions per link per day (MB429), existing sessions continue, window rolls';

  -- Views go with their link.
  delete from public.client_review_links where id = link;
  assert not exists(select 1 from public.client_review_views where link_id = link), 'Views survived link removal';
  raise notice 'PASS review views: cascade on link removal';
end $$;
select 'PASS: review link views' as result;
rollback;
