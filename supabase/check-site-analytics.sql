-- Site visitor analytics: signed view recording, visitor dedupe, caps, rejections,
-- retention, RLS and grants. One rolled-back transaction; commits nothing.
-- Needs migrations through 20261014170000. A throwaway signing secret is inserted
-- inside the transaction and rolled back with it.
\set ON_ERROR_STOP on
begin;

-- Test helpers (temporary schema; dropped with the session, rolled back with the transaction).
create function pg_temp.mb_sig(p_secret text, p_stamp bigint, p_slug text, p_path text, p_referrer text, p_country text, p_device text, p_visitor text)
returns text language sql immutable as $$
 select encode(extensions.hmac(p_stamp::text || '.' || p_slug || '|' || p_path || '|' || p_referrer || '|' || p_country || '|' || p_device || '|' || p_visitor, p_secret, 'sha256'), 'hex');
$$;
create function pg_temp.mb_now() returns bigint language sql volatile as $$ select floor(extract(epoch from clock_timestamp()) * 1000)::bigint; $$;
create function pg_temp.mb_visitor(p_seed text) returns text language sql immutable as $$ select encode(extensions.digest(p_seed, 'sha256'), 'hex'); $$;
-- Signs with the configured secret (read as the table owner) and records one view.
create function pg_temp.mb_view(p_slug text, p_path text, p_referrer text, p_country text, p_device text, p_visitor text)
returns jsonb language plpgsql as $$
declare k text; t bigint := pg_temp.mb_now();
begin
 select secret into k from makeborne_private.site_analytics_key;
 return public.makeborne_record_site_view(p_slug, p_path, p_referrer, p_country, p_device, p_visitor, t, pg_temp.mb_sig(k, t, p_slug, p_path, p_referrer, p_country, p_device, p_visitor));
end $$;

do $$
declare
  u uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  k text := encode(extensions.gen_random_bytes(32), 'hex');
  v1 text := pg_temp.mb_visitor('visitor-1'); v2 text := pg_temp.mb_visitor('visitor-2'); v3 text := pg_temp.mb_visitor('visitor-3');
  today date; t bigint; s text; r jsonb; i integer; n integer; role_name text; priv text;
  bad record;
begin
  -- Shape and definitions.
  assert (select relrowsecurity from pg_class where oid = 'public.site_view_days'::regclass), 'RLS disabled on site_view_days';
  assert (select relrowsecurity from pg_class where oid = 'public.site_view_breakdowns'::regclass), 'RLS disabled on site_view_breakdowns';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'site_view_days')
    = array['artifact_id','workspace_id','day','views','visitors'], 'Unexpected site_view_days columns';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'site_view_breakdowns')
    = array['artifact_id','workspace_id','day','dimension','value','views'], 'Unexpected site_view_breakdowns columns';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'makeborne_private' and table_name = 'site_view_visitors')
    = array['artifact_id','day','visitor','views'], 'Unexpected site_view_visitors columns';
  assert (select prosecdef and provolatile = 'v' and proconfig = array['search_path=""'] from pg_proc where oid = coalesce(to_regprocedure('makeborne_rpc.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)'), 'public.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)'::regprocedure)), 'Recorder must be volatile security definer with empty search_path';
  assert to_regprocedure('makeborne_rpc.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)') is null or (select not prosecdef from pg_proc where oid = 'public.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)'::regprocedure), 'Public makeborne_record_site_view must be a security-invoker wrapper';
  assert exists(select 1 from pg_indexes where schemaname = 'public' and tablename = 'site_view_days' and indexdef like '%(workspace_id, day)%'), 'Missing site_view_days (workspace_id, day) index';
  assert exists(select 1 from pg_indexes where schemaname = 'public' and tablename = 'site_view_breakdowns' and indexdef like '%(workspace_id, day)%'), 'Missing site_view_breakdowns (workspace_id, day) index';
  assert obj_description('public.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)'::regprocedure, 'pg_proc') is not null, 'Recorder comment missing';
  raise notice 'PASS site analytics: columns, RLS enabled, recorder definition, indexes, comments';

  -- Fixtures: owner with a live site a, an offline site b and a live site c; another account.
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@analytics.example.invalid',now()),(other,other||'@analytics.example.invalid',now());
  insert into public.workspaces(id,name,owner_id) values(w,'Analytics fixture',u),(w2,'Other fixture',other);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture A','website'),(b,w,p,'Fixture B','website'),(c,w,p,'Fixture C','website');
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at)
    values(gen_random_uuid(),w,a,1,'{}','{}',u,now()),(gen_random_uuid(),w,b,1,'{}','{}',u,now()),(gen_random_uuid(),w,c,1,'{}','{}',u,now());
  insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,request_id) values
    (a,w,u,'analytics-site-a',1,'<!doctype html><html><body>fixture</body></html>',true,gen_random_uuid()),
    (b,w,u,'analytics-site-b',1,'<!doctype html><html><body>fixture</body></html>',false,gen_random_uuid()),
    (c,w,u,'analytics-site-c',1,'<!doctype html><html><body>fixture</body></html>',true,gen_random_uuid());

  -- Not configured: every view is refused until the operator inserts the secret.
  delete from makeborne_private.site_analytics_key;
  t := pg_temp.mb_now();
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v1,t,repeat('0',64)); raise exception 'Recorded without a secret';
  exception when sqlstate 'MB503' then null; end;
  begin insert into makeborne_private.site_analytics_key(secret) values(repeat('x',31)); raise exception 'Short secret accepted';
  exception when check_violation then null; end;
  begin insert into makeborne_private.site_analytics_key(singleton,secret) values(false,k); raise exception 'Second key row accepted';
  exception when check_violation then null; end;
  insert into makeborne_private.site_analytics_key(secret) values(k);
  begin insert into makeborne_private.site_analytics_key(secret) values(k); raise exception 'Duplicate key row accepted';
  exception when unique_violation then null; end;
  raise notice 'PASS site analytics: unconfigured refused (MB503); secret is a single row of at least 32 characters';

  -- Valid signed views; visitor dedupe.
  t := pg_temp.mb_now();
  today := (to_timestamp(t / 1000.0) at time zone 'utc')::date;
  r := public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v1,t,pg_temp.mb_sig(k,t,'analytics-site-a','/','','','desktop',v1));
  assert r = '{"recorded": true}'::jsonb, 'Valid view refused: '||r;
  assert (select views = 1 and visitors = 1 and workspace_id = w from public.site_view_days where artifact_id = a and day = today), 'First view totals';
  assert (select array_agg(dimension||'='||value||':'||views order by dimension) from public.site_view_breakdowns where artifact_id = a and day = today)
    = array['country=(unknown):1','device=desktop:1','path=/:1','referrer=(direct):1'], 'First view breakdowns';
  assert (select views = 1 from makeborne_private.site_view_visitors where artifact_id = a and day = today and visitor = v1), 'Visitor row';
  assert pg_temp.mb_view('analytics-site-a','/about','www.google.com','DE','mobile',v1) = '{"recorded": true}'::jsonb, 'Repeat visitor refused';
  assert (select views = 2 and visitors = 1 from public.site_view_days where artifact_id = a and day = today), 'Repeat visitor counted twice as visitor';
  assert pg_temp.mb_view('analytics-site-a','/about','www.google.com','DE','tablet',v2) = '{"recorded": true}'::jsonb, 'Second visitor refused';
  assert (select views = 3 and visitors = 2 from public.site_view_days where artifact_id = a and day = today), 'Second visitor totals';
  assert (select array_agg(dimension||'='||value||':'||views order by dimension, value) from public.site_view_breakdowns where artifact_id = a and day = today)
    = array['country=(unknown):1','country=DE:2','device=desktop:1','device=mobile:1','device=tablet:1','path=/:1','path=/about:2','referrer=(direct):1','referrer=www.google.com:2'], 'Breakdowns after three views';
  raise notice 'PASS site analytics: signed views recorded; visitors deduplicated per day; (direct)/(unknown) defaults; breakdowns per dimension';

  -- Rejections raise distinct errors and change nothing.
  t := pg_temp.mb_now();
  s := pg_temp.mb_sig(k,t,'analytics-site-a','/','','','desktop',v3);
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t,repeat('0',64)); raise exception 'Bad signature accepted';
  exception when sqlstate 'MB401' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-a','/admin','','','desktop',v3,t,s); raise exception 'Tampered path accepted';
  exception when sqlstate 'MB401' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-c','/','','','desktop',v3,t,s); raise exception 'Signature replayed on another site';
  exception when sqlstate 'MB401' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t+1,s); raise exception 'Tampered stamp accepted';
  exception when sqlstate 'MB401' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t,upper(s)); raise exception 'Uppercase signature accepted';
  exception when sqlstate 'MB401' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t,pg_temp.mb_sig(repeat('y',64),t,'analytics-site-a','/','','','desktop',v3)); raise exception 'Foreign secret accepted';
  exception when sqlstate 'MB401' then null; end;
  t := pg_temp.mb_now() - 121000;
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t,pg_temp.mb_sig(k,t,'analytics-site-a','/','','','desktop',v3)); raise exception 'Stale stamp accepted';
  exception when sqlstate 'MB408' then null; end;
  t := pg_temp.mb_now() + 121000;
  begin perform public.makeborne_record_site_view('analytics-site-a','/','','','desktop',v3,t,pg_temp.mb_sig(k,t,'analytics-site-a','/','','','desktop',v3)); raise exception 'Future stamp accepted';
  exception when sqlstate 'MB408' then null; end;
  begin perform public.makeborne_record_site_view('analytics-site-a',null,'','','desktop',v3,pg_temp.mb_now(),s); raise exception 'Null path accepted';
  exception when sqlstate '22023' then null; end;
  -- Correctly signed but malformed inputs.
  for bad in select * from (values
    ('analytics-site-a','about','','','desktop',v3), ('analytics-site-a','/'||repeat('a',200),'','','desktop',v3), ('analytics-site-a',E'/a\nb','','','desktop',v3),
    ('analytics-site-a','/','WWW.Google.com','','desktop',v3), ('analytics-site-a','/','https://google.com','','desktop',v3), ('analytics-site-a','/','google.com.','','desktop',v3),
    ('analytics-site-a','/',repeat('a',190)||'.example.com','','desktop',v3),
    ('analytics-site-a','/','','de','desktop',v3), ('analytics-site-a','/','','DEU','desktop',v3), ('analytics-site-a','/','','','tv',v3),
    ('analytics-site-a','/','','','desktop',upper(v3)), ('analytics-site-a','/','','','desktop',left(v3,63)), ('analytics-site-a','/','','','desktop','203.0.113.7')
  ) as x(slug,path,referrer,country,device,visitor) loop
    begin perform pg_temp.mb_view(bad.slug,bad.path,bad.referrer,bad.country,bad.device,bad.visitor); raise exception 'Malformed view accepted: %', bad;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform pg_temp.mb_view('analytics-site-b','/','','','desktop',v3); raise exception 'Offline site recorded';
  exception when sqlstate 'MB404' then null; end;
  begin perform pg_temp.mb_view('no-such-analytics-site','/','','','desktop',v3); raise exception 'Unknown site recorded';
  exception when sqlstate 'MB404' then null; end;
  assert (select views = 3 and visitors = 2 from public.site_view_days where artifact_id = a and day = today), 'A rejected view changed totals';
  assert not exists(select 1 from public.site_view_days where artifact_id = b), 'Offline site has totals';
  assert not exists(select 1 from makeborne_private.site_view_visitors where visitor = v3), 'Rejected visitor stored';
  raise notice 'PASS site analytics: bad/tampered/foreign signatures (MB401), stale and future stamps (MB408), 14 malformed inputs (22023), offline and unknown sites (MB404) rejected without effect';

  -- Per-visitor cap: 200 counted views per site per day.
  for i in 1..200 loop
    assert (pg_temp.mb_view('analytics-site-a','/cap','','','desktop',v3)->>'recorded')::boolean, 'Under-cap view refused at '||i;
  end loop;
  r := pg_temp.mb_view('analytics-site-a','/cap','','','desktop',v3);
  assert r = '{"recorded": false, "reason": "visitor_cap"}'::jsonb, 'Visitor cap not applied: '||r;
  assert (select views = 203 and visitors = 3 from public.site_view_days where artifact_id = a and day = today), 'Capped view counted';
  assert (select views = 200 from makeborne_private.site_view_visitors where artifact_id = a and day = today and visitor = v3), 'Visitor row exceeded the cap';
  assert (pg_temp.mb_view('analytics-site-a','/cap','','','desktop',v1)->>'recorded')::boolean, 'Cap leaked to another visitor';
  assert (pg_temp.mb_view('analytics-site-c','/','','','desktop',v3)->>'recorded')::boolean, 'Cap leaked to another site';
  raise notice 'PASS site analytics: one visitor counts at most 200 views per site per day, then visitor_cap';

  -- Distinct-value cap: 300 values per site, day and dimension; later new values become (other).
  n := (select count(*) from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'path');
  for i in 1..(305 - n) loop
    assert (pg_temp.mb_view('analytics-site-a','/p'||i,'ref'||i||'.example.com','','desktop',pg_temp.mb_visitor('cap-'||i))->>'recorded')::boolean, 'Distinct path refused';
  end loop;
  assert (select count(*) from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'path' and value <> '(other)') = 300, 'Path values not capped at 300';
  assert (select views from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'path' and value = '(other)') = 5, 'Overflow paths not counted as (other)';
  assert (select count(*) from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'referrer' and value <> '(other)') = 300, 'Referrer values not capped at 300';
  assert pg_temp.mb_view('analytics-site-a','/about','','','desktop',v2) = '{"recorded": true}'::jsonb, 'Known path refused after cap';
  assert (select views = 3 from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'path' and value = '/about'), 'Known path not incremented after cap';
  assert (select views = 5 from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'path' and value = '(other)'), 'Known path went to (other)';
  assert (select views = (select sum(views) from public.site_view_breakdowns x where x.artifact_id = a and x.day = today and x.dimension = 'path')
    from public.site_view_days where artifact_id = a and day = today), 'Path breakdown does not sum to daily views';
  raise notice 'PASS site analytics: 300 distinct values per dimension per day, overflow counted as (other), known values still increment';

  -- Retention: visitor hashes older than two days; totals and breakdowns older than 400 days.
  insert into makeborne_private.site_view_visitors(artifact_id,day,visitor,views) values
    (a,today-3,v1,1),(c,today-3,v2,1),(a,today-2,v1,1),(a,today-1,v1,1);
  insert into public.site_view_days(artifact_id,workspace_id,day,views,visitors) values (a,w,today-401,1,1),(a,w,today-400,1,1),(c,w,today-401,1,1);
  insert into public.site_view_breakdowns(artifact_id,workspace_id,day,dimension,value,views) values (a,w,today-401,'path','/',1),(c,w,today-401,'path','/',1);
  n := makeborne_private.purge_site_view_visitors(a);
  assert n = 4, 'Unexpected purge count '||n;
  assert not exists(select 1 from makeborne_private.site_view_visitors where day < today - 2), 'Old visitor hashes kept';
  assert (select count(*) from makeborne_private.site_view_visitors where day in (today-2, today-1)) = 2, 'Recent visitor hashes purged';
  assert not exists(select 1 from public.site_view_days where artifact_id = a and day < today - 400), 'Old site a totals kept';
  assert exists(select 1 from public.site_view_days where artifact_id = a and day = today - 400), 'Day 400 purged';
  assert exists(select 1 from public.site_view_days where artifact_id = c and day < today - 400), 'Per-site purge touched another site';
  assert makeborne_private.purge_site_view_visitors() = 2, 'Global purge count';
  assert not exists(select 1 from public.site_view_days where day < today - 400) and not exists(select 1 from public.site_view_breakdowns where day < today - 400), 'Global purge kept old rows';
  -- Opportunistic: a site's first counted view of a day purges, later views do not.
  delete from public.site_view_days where artifact_id = c and day = today;
  insert into public.site_view_days(artifact_id,workspace_id,day,views,visitors) values (c,w,today-401,1,1);
  insert into makeborne_private.site_view_visitors(artifact_id,day,visitor,views) values (a,today-5,v1,1);
  assert (pg_temp.mb_view('analytics-site-c','/','','','desktop',v1)->>'recorded')::boolean, 'First view of day refused';
  assert not exists(select 1 from public.site_view_days where artifact_id = c and day < today - 400), 'First view of the day did not purge';
  assert not exists(select 1 from makeborne_private.site_view_visitors where day < today - 2), 'First view of the day kept old hashes';
  insert into makeborne_private.site_view_visitors(artifact_id,day,visitor,views) values (a,today-5,v1,1);
  assert (pg_temp.mb_view('analytics-site-c','/','','','desktop',v2)->>'recorded')::boolean, 'Second view of day refused';
  assert exists(select 1 from makeborne_private.site_view_visitors where day = today - 5), 'Purge ran more than once per site per day';
  delete from makeborne_private.site_view_visitors where day = today - 5;
  raise notice 'PASS site analytics: retention 2 days (hashes) / 400 days (totals), per site and global, opportunistic once per site per day';

  -- Grants: browser roles read only the two public tables (RLS-scoped) and execute only the recorder.
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach priv in array array['select','insert','update','delete'] loop
      assert not has_table_privilege(role_name,'makeborne_private.site_analytics_key',priv), role_name||' has '||priv||' on the key';
      assert not has_table_privilege(role_name,'makeborne_private.site_view_visitors',priv), role_name||' has '||priv||' on visitor hashes';
    end loop;
    assert not has_function_privilege(role_name,'makeborne_private.purge_site_view_visitors(uuid)','execute'), role_name||' can purge';
    assert has_function_privilege(role_name,'public.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)','execute'), role_name||' cannot record';
  end loop;
  assert not has_function_privilege('public','public.makeborne_record_site_view(text,text,text,text,text,text,bigint,text)','execute'), 'PUBLIC can record';
  foreach priv in array array['select','insert','update','delete','truncate','references','trigger'] loop
    assert not has_table_privilege('anon','public.site_view_days',priv), 'anon has '||priv||' on days';
    assert not has_table_privilege('anon','public.site_view_breakdowns',priv), 'anon has '||priv||' on breakdowns';
    assert has_table_privilege('authenticated','public.site_view_days',priv) = (priv = 'select'), 'authenticated privilege '||priv||' on days';
    assert has_table_privilege('authenticated','public.site_view_breakdowns',priv) = (priv = 'select'), 'authenticated privilege '||priv||' on breakdowns';
    assert has_table_privilege('service_role','public.site_view_days',priv), 'service_role lacks '||priv||' on days';
  end loop;

  -- anon (the Worker's publishable key) can record only with a valid signature.
  t := pg_temp.mb_now();
  s := pg_temp.mb_sig(k,t,'analytics-site-a','/anon','partner.example','US','desktop',v1);
  set local role anon;
  begin perform public.makeborne_record_site_view('analytics-site-a','/anon','partner.example','US','desktop',v1,t,repeat('a',64)); raise exception 'anon recorded with a bad signature';
  exception when sqlstate 'MB401' then null; end;
  r := public.makeborne_record_site_view('analytics-site-a','/anon','partner.example','US','desktop',v1,t,s);
  assert r = '{"recorded": true}'::jsonb, 'anon valid view refused: '||r;
  begin perform 1 from public.site_view_days; raise exception 'anon read totals';
  exception when insufficient_privilege then null; end;
  begin perform 1 from makeborne_private.site_view_visitors; raise exception 'anon read visitor hashes';
  exception when insufficient_privilege then null; end;
  begin perform 1 from makeborne_private.site_analytics_key; raise exception 'anon read the secret';
  exception when insufficient_privilege then null; end;
  begin perform makeborne_private.purge_site_view_visitors(); raise exception 'anon purged';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select views = 1 from public.site_view_breakdowns where artifact_id = a and day = today and dimension = 'country' and value = 'US'), 'anon view not counted';

  -- RLS: the owner reads own rows; another account reads none; browsers cannot write.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  -- Site a today and 400 days ago (kept by retention), site c today.
  assert (select count(*) from public.site_view_days) = 3, 'Owner cannot read own totals';
  assert (select count(*) from public.site_view_breakdowns where artifact_id = a) > 0, 'Owner cannot read own breakdowns';
  begin insert into public.site_view_days(artifact_id,workspace_id,day,views,visitors) values(a,w,today-10,999,999); raise exception 'Browser inserted totals';
  exception when insufficient_privilege then null; end;
  begin update public.site_view_days set views = 999999; raise exception 'Browser inflated totals';
  exception when insufficient_privilege then null; end;
  begin delete from public.site_view_breakdowns; raise exception 'Browser deleted breakdowns';
  exception when insufficient_privilege then null; end;
  begin perform 1 from makeborne_private.site_view_visitors; raise exception 'Owner read visitor hashes';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',other,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.site_view_days) = 0, 'Another account read totals';
  assert (select count(*) from public.site_view_breakdowns) = 0, 'Another account read breakdowns';
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  raise notice 'PASS site analytics: owner-only reads, browser roles cannot write, private tables and purge unreachable, anon records only with a valid signature';

  -- Removing a site removes its analytics.
  delete from public.hosted_sites where artifact_id = a;
  assert not exists(select 1 from public.site_view_days where artifact_id = a), 'Totals survived site removal';
  assert not exists(select 1 from public.site_view_breakdowns where artifact_id = a), 'Breakdowns survived site removal';
  raise notice 'PASS site analytics: cascade on site removal';
end $$;
select 'PASS: site analytics' as result;
rollback;
