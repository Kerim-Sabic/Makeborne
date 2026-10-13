-- Hosted website enquiries: eligibility, idempotency, limits, privileges.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261013090000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); w uuid := gen_random_uuid(); p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  pad text := repeat(' ', 120); portable text; isolated text; js text := 'console.log(1)'; files jsonb; s jsonb; r jsonb;
  src text := repeat('a', 64); req uuid := gen_random_uuid(); i integer;
begin
  portable := '<!doctype html><html><body><form><input name="email"></form></body></html>' || pad;
  isolated := '<!doctype html><html><head><link rel="stylesheet" href="/_mb/app-1111111111111111.css"></head><body><div id="root"></div></body></html>' || pad;
  files := jsonb_build_array(jsonb_build_object('path','/_mb/app-2222222222222222.js','content_type','text/javascript; charset=utf-8',
    'body',encode(convert_to(js,'UTF8'),'base64'),'sha256',encode(sha256(convert_to(js,'UTF8')),'hex')));
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@enquiry.example.invalid',now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Transaction fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Enquiry fixture',u);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values(gen_random_uuid(),w,a,1,'{}','{}',u,now());
  update public.artifacts set current_version = 1 where id = a;
  s := public.makeborne_save_hosted_site_v4(u,w,a,1,'enquiry-site',portable,true,0,gen_random_uuid(),true,'/_mb/app-2222222222222222.js',files,isolated);

  -- Disabled until the owner turns enquiries on.
  begin perform public.makeborne_accept_site_enquiry('enquiry-site',req,'Ana','ana@example.invalid','Hello',src); raise exception 'Accepted while disabled';
  exception when sqlstate 'P0002' then null; end;
  update public.hosted_sites set enquiries_enabled = true where artifact_id = a;
  r := public.makeborne_accept_site_enquiry('enquiry-site',req,'Ana','ana@example.invalid','Hello',src);
  assert (r->>'accepted')::boolean, 'Valid enquiry refused';
  assert public.makeborne_accept_site_enquiry('enquiry-site',req,'Ana','ana@example.invalid','Hello',src)->>'id' = r->>'id', 'Retry not idempotent';
  begin perform public.makeborne_accept_site_enquiry('enquiry-site',req,'Ana','ana@example.invalid','Changed',src); raise exception 'Changed retry accepted';
  exception when sqlstate 'MB409' then null; end;
  raise notice 'PASS enquiries: off by default, accepted once, identical retry idempotent, changed retry refused';

  -- Per-visitor limit: 5 per 10 minutes.
  for i in 1..4 loop perform public.makeborne_accept_site_enquiry('enquiry-site',gen_random_uuid(),'Ana','ana@example.invalid','Hello '||i,src); end loop;
  begin perform public.makeborne_accept_site_enquiry('enquiry-site',gen_random_uuid(),'Ana','ana@example.invalid','Sixth',src); raise exception 'Visitor limit ignored';
  exception when sqlstate 'MB429' then null; end;
  assert (public.makeborne_accept_site_enquiry('enquiry-site',gen_random_uuid(),'Bo','bo@example.invalid','Other visitor',repeat('b',64))->>'accepted')::boolean, 'Other visitor blocked';
  raise notice 'PASS enquiries: per-visitor limit enforced without blocking other visitors';

  -- Review fix: a site whose owner can no longer host is not served, so it collects nothing either.
  delete from makeborne_private.account_privileges where user_id = u;
  assert public.makeborne_read_hosted_site_v2('enquiry-site') is null, 'Ineligible site still served';
  begin perform public.makeborne_accept_site_enquiry('enquiry-site',gen_random_uuid(),'Cy','cy@example.invalid','After lapse',repeat('c',64)); raise exception 'Ineligible owner still collects enquiries';
  exception when sqlstate 'P0002' then null; end;
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Transaction fixture');
  -- Offline or JavaScript off: no collection.
  update public.hosted_sites set interactive = false where artifact_id = a;
  begin perform public.makeborne_accept_site_enquiry('enquiry-site',gen_random_uuid(),'Cy','cy@example.invalid','Static',repeat('c',64)); raise exception 'Static site collected';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PASS enquiries: refused for ineligible owners and static sites';

  -- Privileges: only the service role calls the gateway function; owners read their own inbox.
  assert not has_function_privilege('anon','public.makeborne_accept_site_enquiry(text,uuid,text,text,text,text)','execute');
  assert not has_function_privilege('authenticated','public.makeborne_accept_site_enquiry(text,uuid,text,text,text,text)','execute');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.site_enquiries) = 6, 'Owner cannot read own enquiries';
  begin insert into public.site_enquiries(artifact_id,workspace_id,request_id,name,email,message,source_hash) values(a,w,gen_random_uuid(),'X','x@example.invalid','Forged',src); raise exception 'Browser inserted an enquiry';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.site_enquiries) = 0, 'Another account read the inbox';
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  raise notice 'PASS enquiries: gateway-only writes, owner-only reads';
end $$;
select 'PASS: site enquiries' as result;
rollback;
