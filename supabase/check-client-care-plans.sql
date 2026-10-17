\set ON_ERROR_STOP on
-- Client care plans (20261018090000). Runs inside a transaction that is rolled back.
begin;
do $$
declare
  u uuid := gen_random_uuid(); cu uuid := gen_random_uuid(); su uuid := gen_random_uuid(); ru uuid := gen_random_uuid();
  s_u uuid := gen_random_uuid(); s_cu uuid := gen_random_uuid(); s_su uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); cl2 uuid := gen_random_uuid(); clx uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  ex timestamptz := clock_timestamp() + interval '30 minutes';
  today date := (now() at time zone 'utc')::date;
  svc constant text := '{"role":"service_role"}';
  style constant jsonb := '{"id":"editorial","name":"Editorial","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{"ink":"#111111"},"description":"","referenceAssetIds":[]}';
  manifest constant text := '{"version":1,"collections":{"menu":{"label":"Menu","kind":"list","fields":{"name":{"type":"text","required":true}}}}}';
  menu1 constant text := E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Margherita"\n    }\n  ]\n}\n';
  menu2 constant text := E'{\n  "items": [\n    {\n      "id": "m1",\n      "name": "Marinara"\n    }\n  ]\n}\n';
  token text := rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
  files jsonb; content jsonb; r jsonb; k1 text; v_pay uuid; v_pay2 uuid; v_req uuid := gen_random_uuid(); acc uuid; v_change uuid;
  fns constant text[] := array['makeborne_care_plan(uuid,uuid)','makeborne_set_care_plan(uuid,uuid,text,integer,text,text,text,date,boolean)',
    'makeborne_record_care_payment(uuid,uuid,uuid,text)','makeborne_undo_care_payment(uuid,uuid,uuid)','makeborne_care_plans(uuid)'];
begin
  -- ---------------------------------------------------------------- exposure
  foreach k1 in array array['public.client_care_plans','public.client_care_payments'] loop
    assert (select relrowsecurity from pg_class where oid = k1::regclass), k1||' RLS disabled';
    assert not has_table_privilege('authenticated',k1,'insert') and not has_table_privilege('authenticated',k1,'update') and not has_table_privilege('authenticated',k1,'delete'), 'browser writes '||k1;
    assert not has_table_privilege('anon',k1,'select'), 'anon reads '||k1;
  end loop;
  foreach k1 in array fns loop
    assert has_function_privilege('authenticated','public.'||k1,'execute') and not has_function_privilege('anon','public.'||k1,'execute'), 'wrapper grants '||k1;
    assert not (select prosecdef from pg_proc where oid = ('public.'||k1)::regprocedure), 'public '||k1||' must be invoker';
    assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = ('makeborne_rpc.'||k1)::regprocedure), 'core '||k1;
    assert not has_function_privilege('anon','makeborne_rpc.'||k1,'execute'), 'anon runs core '||k1;
  end loop;
  foreach k1 in array array['makeborne_portal_billing_home(uuid,uuid,timestamptz)','makeborne_portal_billing_site(uuid,uuid,timestamptz,uuid)'] loop
    assert has_function_privilege('service_role','public.'||k1,'execute'), 'service_role cannot run '||k1;
    assert not has_function_privilege('authenticated','public.'||k1,'execute') and not has_function_privilege('anon','public.'||k1,'execute'), 'browser runs '||k1;
  end loop;
  foreach k1 in array array['anon','authenticated','service_role'] loop
    assert not has_function_privilege(k1,'makeborne_private.care_paused(uuid,uuid)','execute'), k1||' runs care_paused';
  end loop;
  assert not exists(select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname in ('public','graphql_public') and pr.prosecdef
    and pr.proname like '%care%'), 'no definer care function in an exposed schema';
  raise notice 'PASS care plans: RLS on, no browser writes, agency cores in makeborne_rpc behind invoker wrappers (authenticated only), client bridges service-role only, helpers private';

  -- ---------------------------------------------------------------- fixtures
  insert into auth.users(id,email,email_confirmed_at) values(u,'owner@care.example.invalid',now()),(cu,'client@care.example.invalid',now()),
    (su,'stranger@care.example.invalid',now()),(ru,'reviewer@care.example.invalid',now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(s_u,u,now(),now()),(s_cu,cu,now(),now()),(s_su,su,now(),now());
  insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(u,true,'care fixture'),(su,true,'care fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Care Studio',u),(w2,'Other Studio',su);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ru,'reviewer');
  insert into public.clients(id,workspace_id,name,company) values(cl,w,'Ana Reed','Saffron Table'),(cl2,w,'Bo Lee',''),(clx,w2,'Foreign','');
  insert into public.projects(id,workspace_id,client_id,title,kind) values(p,w,cl,'Saffron','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Saffron site','website');
  files := jsonb_build_array(
    jsonb_build_object('path','index.html','content','<!doctype html><div id="root"></div>'),
    jsonb_build_object('path','package-lock.json','content','{}'), jsonb_build_object('path','package.json','content','{}'),
    jsonb_build_object('path','src/App.tsx','content','export default function App(){return null}'),
    jsonb_build_object('path','src/content/collections.json','content',manifest), jsonb_build_object('path','src/content/menu.json','content',menu1),
    jsonb_build_object('path','src/main.tsx','content','import "./App";'));
  content := jsonb_build_object('schemaVersion',1,'kind','website','title','Saffron site','sections','[]'::jsonb,'websiteSource',jsonb_build_object(
    'schemaVersion',1,'toolchainId','react-vite-v1','entrypoint','src/main.tsx','files',files,'assets','[]'::jsonb,
    'routes',jsonb_build_array(jsonb_build_object('path','/','title','Home'))));
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,1,content,style,u);
  update public.artifacts set current_version = 1 where id = a;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  perform public.makeborne_create_portal_invite(u,s_u,ex,w,cl,'client@care.example.invalid','Ana',sha256(convert_to(token,'UTF8')),14);
  perform public.makeborne_accept_portal_invite(token,cu,s_cu,ex);
  reset role;
  select id into acc from public.client_portal_access where user_id = cu;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_set_portal_site(w,a,true,null);

  -- ---------------------------------------------------------------- agency: set a plan
  assert (public.makeborne_care_plan(w,cl))->'plan' = 'null'::jsonb, 'no plan yet';
  foreach k1 in array array['javascript:alert(1)','http://pay.example.com/x','https://user:pw@pay.example.com/x','https://pay.example.com/a b','https://pay.example.com/"><script>',
      '//pay.example.com','https://','ftp://pay.example.com'] loop
    begin perform public.makeborne_set_care_plan(w,cl,'Care',4900,'EUR','month',k1,null,true); raise exception 'bad link accepted: %', k1;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.makeborne_set_care_plan(w,cl,'',4900,'EUR','month',null,null,true); raise exception 'empty label'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_care_plan(w,cl,'<b>Gold</b>',4900,'EUR','month',null,null,true); raise exception 'tags'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_care_plan(w,cl,'Care',4900,null,'month',null,null,true); raise exception 'amount without currency'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_care_plan(w,cl,'Care',4900,'EURO','month',null,null,true); raise exception 'bad currency'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_care_plan(w,cl,'Care',null,null,'weekly',null,null,true); raise exception 'bad interval'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_set_care_plan(w,clx,'Care',null,null,'month',null,null,true); raise exception 'foreign client'; exception when sqlstate 'P0002' then null; end;
  r := public.makeborne_set_care_plan(w,cl,'Monthly care',4900,'eur','month','https://buy.stripe.com/test_abc123?prefilled_email=x',null,true);
  assert r->'plan'->>'label' = 'Monthly care' and r->'plan'->>'currency' = 'EUR' and (r->'plan'->>'amountCents')::int = 4900
    and r->'plan'->>'status' = 'none' and r->'plan'->>'paymentUrl' = 'https://buy.stripe.com/test_abc123?prefilled_email=x', 'plan saved: '||r::text;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',ru,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.makeborne_set_care_plan(w,cl,'Hack',null,null,'month',null,null,true); raise exception 'reviewer set a plan'; exception when sqlstate '42501' then null; end;
  begin perform public.makeborne_care_plans(w); raise exception 'reviewer listed plans'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',cu,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_care_plans) = 0, 'portal user reads plans';
  begin perform public.makeborne_record_care_payment(w,cl,gen_random_uuid(),''); raise exception 'client recorded a payment'; exception when sqlstate '42501' then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',su,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.client_care_plans) = 0, 'stranger reads plans';
  begin perform public.makeborne_care_plan(w,cl); raise exception 'stranger read a plan'; exception when sqlstate '42501' then null; end;
  reset role;
  assert (select count(*) from public.audit_events where action = 'portal.care_plan_updated' and workspace_id = w) = 1, 'plan audited';
  raise notice 'PASS care plans: agency sets a plan (https payment links only: no javascript:, http:, credentials, spaces, quotes, protocol-relative), label/price/interval validated; reviewers, clients and strangers refused and read nothing';

  -- ---------------------------------------------------------------- status and payments
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  r := public.makeborne_record_care_payment(w,cl,v_req,'Bank transfer Oct');
  assert r->'plan'->>'paidThrough' = ((today + interval '1 month')::date - 1)::text and r->'plan'->>'status' = 'paid', 'first payment covers a month from today: '||r::text;
  assert jsonb_array_length(r->'payments') = 1 and r->'payments'->0->>'coversFrom' = today::text and r->'payments'->0->>'note' = 'Bank transfer Oct', 'payment listed';
  assert (public.makeborne_record_care_payment(w,cl,v_req,'again'))->'plan'->>'paidThrough' = r->'plan'->>'paidThrough', 'same request is idempotent';
  -- Month ends do not drift: through Jan 31 -> Feb 28 -> Mar 31.
  perform public.makeborne_set_care_plan(w,cl,'Monthly care',4900,'EUR','month',null,date '2027-01-31',true);
  r := public.makeborne_record_care_payment(w,cl,gen_random_uuid(),'');
  assert r->'plan'->>'paidThrough' = '2027-02-28', 'Feb: '||r::text;
  r := public.makeborne_record_care_payment(w,cl,gen_random_uuid(),'');
  assert r->'plan'->>'paidThrough' = '2027-03-31', 'Mar: '||r::text;
  v_pay := (r->'payments'->0->>'id')::uuid; v_pay2 := (r->'payments'->1->>'id')::uuid;
  begin perform public.makeborne_undo_care_payment(w,cl,v_pay2); raise exception 'older payment undone'; exception when sqlstate 'PT409' then null; end;
  r := public.makeborne_undo_care_payment(w,cl,v_pay);
  assert r->'plan'->>'paidThrough' = '2027-02-28' and r->'payments'->0->>'undoneAt' is not null, 'undo restores';
  assert (public.makeborne_undo_care_payment(w,cl,v_pay))->'plan'->>'paidThrough' = '2027-02-28', 'undo is idempotent';
  perform public.makeborne_set_care_plan(w,cl,'Quarterly',null,null,'quarter',null,date '2027-03-31',true);
  assert (public.makeborne_record_care_payment(w,cl,gen_random_uuid(),''))->'plan'->>'paidThrough' = '2027-06-30', 'quarter';
  perform public.makeborne_set_care_plan(w,cl,'Yearly',null,null,'year',null,date '2027-05-31',true);
  assert (public.makeborne_record_care_payment(w,cl,gen_random_uuid(),''))->'plan'->>'paidThrough' = '2028-05-31', 'year';
  -- A late payment covers the period it was due for.
  perform public.makeborne_set_care_plan(w,cl,'Monthly care',4900,'EUR','month','https://pay.example.com/monee',today - 20,true);
  assert (public.makeborne_record_care_payment(w,cl,gen_random_uuid(),''))->'plan'->>'paidThrough' = ((today - 19 + interval '1 month')::date - 1)::text, 'late payment counted from the due date';
  foreach k1 in array array['0:paid','-1:due','-7:due','-8:paused'] loop
    perform public.makeborne_set_care_plan(w,cl,'Monthly care',4900,'EUR','month','https://pay.example.com/monee',today + split_part(k1,':',1)::int,true);
    r := (public.makeborne_care_plan(w,cl))->'plan';
    assert r->>'status' = split_part(k1,':',2), k1||' -> '||r::text;
    assert r->>'pausesOn' = (today + split_part(k1,':',1)::int + 8)::text, 'pausesOn';
  end loop;
  perform public.makeborne_set_care_plan(w,cl,'Monthly care',4900,'EUR','month','https://pay.example.com/monee',today - 30,false);
  assert (public.makeborne_care_plan(w,cl))->'plan'->>'status' = 'none', 'switched-off plan enforces nothing';
  begin perform public.makeborne_record_care_payment(w,cl,gen_random_uuid(),''); raise exception 'payment on an inactive plan'; exception when sqlstate '22023' then null; end;
  begin perform public.makeborne_record_care_payment(w,cl2,gen_random_uuid(),''); raise exception 'payment without a plan'; exception when sqlstate 'P0002' then null; end;
  perform public.makeborne_set_care_plan(w,cl2,'Basic',null,null,'month',null,today + 3,true);
  assert jsonb_array_length(public.makeborne_care_plans(w)) = 2 and (public.makeborne_care_plans(w))->0->>'clientName' = 'Bo Lee', 'overview lists active-first with names';
  reset role;
  assert (select count(*) from public.audit_events where action = 'portal.care_payment_recorded' and workspace_id = w) >= 6
    and (select count(*) from public.audit_events where action = 'portal.care_payment_undone' and workspace_id = w) = 1, 'payments audited';
  raise notice 'PASS care plans: payments extend paid-through by a month/quarter/year without month-end drift, late payments count from the due date, idempotent per request, only the latest can be undone; status paid -> due for 7 days -> paused on day 8; switched-off plans enforce nothing';

  -- ---------------------------------------------------------------- the portal: reminder, then read-only
  update public.client_care_plans set active = true, paid_through = today - 3 where client_id = cl;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  r := public.makeborne_portal_billing_site(cu,s_cu,ex,a);
  assert r->'billing'->>'status' = 'due' and r->'billing'->>'paymentUrl' = 'https://pay.example.com/monee' and r->'billing'->>'label' = 'Monthly care', 'due shown: '||r::text;
  assert (public.makeborne_portal_billing_home(cu,s_cu,ex))->acc::text->>'status' = 'due', 'home keyed by access';
  r := public.makeborne_portal_save_draft(cu,s_cu,ex,a,1,jsonb_build_object('src/content/menu.json',menu2),'Menu: 1 changed',gen_random_uuid());
  assert r->>'status' = 'draft', 'editing allowed while due';
  v_change := (r->>'id')::uuid;
  reset role;
  update public.client_care_plans set paid_through = today - 8 where client_id = cl;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  assert (public.makeborne_portal_billing_site(cu,s_cu,ex,a))->'billing'->>'status' = 'paused', 'paused shown';
  r := public.makeborne_portal_read_site(cu,s_cu,ex,a);
  assert r->'site'->>'artifactId' = a::text, 'paused client still reads the site';
  assert jsonb_array_length((public.makeborne_portal_home(cu,s_cu,ex))->'grants') = 1, 'paused client still sees the site at home';
  begin perform public.makeborne_portal_save_draft(cu,s_cu,ex,a,1,jsonb_build_object('src/content/menu.json',menu1),'Menu',gen_random_uuid()); raise exception 'paused save';
  exception when sqlstate 'PB402' then null; end;
  begin perform public.makeborne_portal_change_action(cu,s_cu,ex,a,v_change,'submit'); raise exception 'paused submit';
  exception when sqlstate 'PB402' then null; end;
  begin perform public.makeborne_portal_upload_scope(cu,s_cu,ex,a); raise exception 'paused upload';
  exception when sqlstate 'PB402' then null; end;
  begin perform public.makeborne_portal_billing_site(su,s_su,ex,a); raise exception 'stranger read billing';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  -- Paying resumes editing straight away; switching the plan off also does.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.makeborne_record_care_payment(w,cl,gen_random_uuid(),'');
  reset role;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  assert (public.makeborne_portal_billing_site(cu,s_cu,ex,a))->'billing'->>'status' = 'paid', 'paying resumes editing';
  perform public.makeborne_portal_save_draft(cu,s_cu,ex,a,1,jsonb_build_object('src/content/menu.json',menu1),'Menu',gen_random_uuid());
  reset role;
  update public.client_care_plans set active = false, paid_through = today - 60 where client_id = cl;
  perform set_config('request.jwt.claims', svc, true);
  set local role service_role;
  assert (public.makeborne_portal_billing_site(cu,s_cu,ex,a))->'billing' = 'null'::jsonb, 'switched-off plan is not shown';
  perform public.makeborne_portal_save_draft(cu,s_cu,ex,a,1,jsonb_build_object('src/content/menu.json',menu2),'Menu',gen_random_uuid());
  reset role;
  -- The agency can still approve a change sent before the pause.
  update public.client_care_plans set active = true where client_id = cl;
  raise notice 'PASS care plans: the client sees the plan, link and status; while due they edit normally; once paused they still sign in and read but cannot save, send or upload (PB402); paying or switching the plan off resumes editing; strangers see nothing';

  -- ---------------------------------------------------------------- cascades
  insert into public.client_care_payments(workspace_id,client_id,request_id,covers_from,covers_to,recorded_by) values(w,cl2,gen_random_uuid(),today,today+30,u);
  delete from public.clients where id = cl2;
  assert not exists(select 1 from public.client_care_plans where client_id = cl2) and not exists(select 1 from public.client_care_payments where client_id = cl2), 'client removal cascades';
  delete from public.workspaces where id = w;
  assert not exists(select 1 from public.client_care_plans where workspace_id = w), 'workspace removal cascades';
  raise notice 'PASS care plans: cascades (client and workspace removal remove plans and payments)';
end $$;
select 'PASS: client care plans' as result;
rollback;
