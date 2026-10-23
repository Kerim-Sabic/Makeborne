-- Agency operation races under real concurrent sessions (dblink). LOCAL ISOLATED STACK ONLY.
-- It commits short-lived fixtures through dblink and deletes exactly those
-- fixtures afterwards; it never changes provider limits or billing settings and
-- opens no provider call (admin fixture: exempt, so no wallet hold).
-- Refuses to run unless -v allow_fixture_commit=on is given explicitly.
-- Run: docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v allow_fixture_commit=on < supabase/check-agency-operations-concurrency.sql
\set ON_ERROR_STOP on
select set_config('makeborne.allow_fixture_commit', :'allow_fixture_commit', false);
begin;
create extension if not exists dblink with schema extensions;
do $$
declare conn text:=format('host=supabase_db_makeborne-release-auth port=5432 dbname=%s user=postgres password=postgres',current_database());
 u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
 op uuid; step uuid:=gen_random_uuid(); hash text:=repeat('f',64); ctx jsonb; i integer; v text; wins integer; busy integer; runs text[]; started integer; replayed integer; err text;
 cleanup text;
begin
 if current_setting('makeborne.allow_fixture_commit',true) is distinct from 'on' then raise exception 'Refusing to commit fixtures without -v allow_fixture_commit=on (isolated local stack only).'; end if;
 cleanup:=format('delete from public.workspaces where id=%L; delete from makeborne_private.account_privileges where user_id=%L; delete from auth.users where id=%L;',w,u,u);
 perform extensions.dblink_connect('admin',conn);
 begin
  perform extensions.dblink_exec('admin',format($f$
   insert into auth.users(id,email,email_confirmed_at) values(%1$L,%1$L||'@agency-race.invalid',now());
   insert into public.workspaces(id,name,owner_id) values(%2$L,'Agency race fixture',%1$L);
   insert into public.projects(id,workspace_id,title,kind) values(%3$L,%2$L,'Race','website');
   insert into public.artifacts(id,workspace_id,project_id,title,kind) values(%4$L,%2$L,%3$L,'Race','website');
   insert into public.sources(id,workspace_id,project_id,title,kind,content) values(%5$L,%2$L,%3$L,'Race source','text','Race source text');
   insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(%1$L,true,true,'Agency race fixture');
  $f$,u,w,p,a,s));
  ctx:=jsonb_build_object('task',jsonb_build_object('inputs',jsonb_build_array(jsonb_build_object('kind','source','id',s,'sha256',encode(sha256(convert_to('Race source text','UTF8')),'hex'),'version',null,'projectId',p)),'projectId',p,'clientId',null));
  select x into v from extensions.dblink('admin',format('select (public.makeborne_ai_operation_create(%L,%L,%L,gen_random_uuid(),''research'',''medium'',%L,0,40,30000,%L)->>''id'')',u,w,a,hash,ctx)) as t(x text);
  op:=v::uuid;

  -- 1. Eight workers race to begin DIFFERENT steps of one operation: exactly one run.
  perform extensions.dblink_exec('admin','begin');
  perform * from extensions.dblink('admin',format('select id::text from makeborne_private.ai_operations where id=%L for update',op)) as t(x text);
  for i in 1..8 loop
   perform extensions.dblink_connect('racer'||i,conn);
   perform extensions.dblink_send_query('racer'||i,format('select public.makeborne_ai_operation_begin(%L,%L,gen_random_uuid(),''research'',%L,0,40)::text',u,op,hash));
  end loop;
  perform pg_sleep(0.5);
  perform extensions.dblink_exec('admin','commit');
  wins:=0; busy:=0;
  for i in 1..8 loop
   select x into v from extensions.dblink_get_result('racer'||i,false) as t(x text);
   if v is null then err:=extensions.dblink_error_message('racer'||i); raise exception 'racer % failed: %',i,err; end if;
   if (v::jsonb)->'error'->>'code'='OPERATION_BUSY' then busy:=busy+1; elsif (v::jsonb)->'run' ? 'id' then wins:=wins+1; end if;
   perform * from extensions.dblink_get_result('racer'||i,false) as t(x text);
  end loop;
  assert wins=1 and busy=7,format('one run wins (wins=%s busy=%s)',wins,busy);
  select x into v from extensions.dblink('admin',format('select count(*)::text from makeborne_private.ai_operation_runs where operation_id=%L',op)) as t(x text);
  assert v='1','exactly one run row';
  raise notice 'PASS agency race 1: 8 concurrent begins on different steps -> 1 run, 7 OPERATION_BUSY';

  -- 2. Eight duplicate requests for the SAME new step after the first run finishes: one run, seven replays.
  select x into v from extensions.dblink('admin',format($q$select public.makeborne_ai_operation_finish(%1$L,r.id,r.fence,0,'incomplete','{}',null)->>'outcome' from makeborne_private.ai_operation_runs r where r.operation_id=%2$L and r.status='active'$q$,u,op)) as t(x text);
  assert v='incomplete','first run finished';
  perform extensions.dblink_exec('admin','begin');
  perform * from extensions.dblink('admin',format('select id::text from makeborne_private.ai_operations where id=%L for update',op)) as t(x text);
  for i in 1..8 loop
   perform extensions.dblink_send_query('racer'||i,format('select public.makeborne_ai_operation_begin(%L,%L,%L,''research'',%L,0,40)::text',u,op,step,hash));
  end loop;
  perform pg_sleep(0.5);
  perform extensions.dblink_exec('admin','commit');
  runs:='{}'; replayed:=0;
  for i in 1..8 loop
   select x into v from extensions.dblink_get_result('racer'||i,false) as t(x text);
   if v is null then err:=extensions.dblink_error_message('racer'||i); raise exception 'duplicate % failed: %',i,err; end if;
   runs:=runs||((v::jsonb)->'run'->>'id'); if ((v::jsonb)->>'replayed')::boolean then replayed:=replayed+1; end if;
   perform * from extensions.dblink_get_result('racer'||i,false) as t(x text);
  end loop;
  assert (select count(distinct x) from unnest(runs) x)=1 and replayed=7,format('duplicate step -> one run (distinct=%s replayed=%s)',(select count(distinct x) from unnest(runs) x),replayed);
  select x into v from extensions.dblink('admin',format('select count(*)::text from makeborne_private.ai_operation_runs where operation_id=%L',op)) as t(x text);
  assert v='2','two runs in total';
  raise notice 'PASS agency race 2: 8 concurrent duplicate requests for one step -> 1 run, 7 replays';

  -- 3. Stop races eight new-step begins on another operation: no run starts after Stop.
  select x into v from extensions.dblink('admin',format('select (public.makeborne_ai_operation_create(%L,%L,%L,gen_random_uuid(),''research'',''medium'',%L,0,40,30000,%L)->>''id'')',u,w,a,hash,ctx)) as t(x text);
  op:=v::uuid;
  perform extensions.dblink_exec('admin','begin');
  perform * from extensions.dblink('admin',format('select id::text from makeborne_private.ai_operations where id=%L for update',op)) as t(x text);
  perform extensions.dblink_send_query('racer1',format('select public.makeborne_ai_operation_cancel(%L,%L,1)::text',u,op));
  for i in 2..8 loop
   perform extensions.dblink_send_query('racer'||i,format('select public.makeborne_ai_operation_begin(%L,%L,gen_random_uuid(),''research'',%L,0,40)::text',u,op,hash));
  end loop;
  perform pg_sleep(0.5);
  perform extensions.dblink_exec('admin','commit');
  started:=0; busy:=0;
  for i in 1..8 loop
   select x into v from extensions.dblink_get_result('racer'||i,false) as t(x text);
   if i>1 and v is not null and (v::jsonb)->'run' ? 'id' then started:=started+1; end if;
   if i>1 and (v is null or (v::jsonb) ? 'error') then busy:=busy+1; end if;
   perform * from extensions.dblink_get_result('racer'||i,false) as t(x text);
  end loop;
  -- Stop marks every run active at that moment; a run begun after Stop would carry no marker.
  select x into v from extensions.dblink('admin',format('select count(*)::text from makeborne_private.ai_operation_runs where operation_id=%L and cancel_requested_at is null',op)) as t(x text);
  assert v='0',format('no run created after Stop (late runs=%s)',v);
  select x into v from extensions.dblink('admin',format('select (status=''cancelled'' and cancel_requested_at is not null)::text from makeborne_private.ai_operations where id=%L',op)) as t(x text);
  assert v='true' and started<=1,format('Stop recorded; at most one run began before it (started=%s refused=%s)',started,busy);
  raise notice 'PASS agency race 3: Stop and 7 concurrent new-step begins serialize; % began before Stop, % refused after',started,busy;

  for i in 1..8 loop perform extensions.dblink_disconnect('racer'||i); end loop;
 exception when others or assert_failure then
  begin perform extensions.dblink_exec('admin','rollback'); exception when others then null; end;
  perform extensions.dblink_exec('admin',cleanup); perform extensions.dblink_disconnect('admin');
  raise;
 end;
 perform extensions.dblink_exec('admin',cleanup);
 select x into v from extensions.dblink('admin',format('select (select count(*) from auth.users where id=%L)+(select count(*) from makeborne_private.ai_operations where actor=%L)+(select count(*) from makeborne_private.account_privileges where user_id=%L)',u,u,u)) as t(x text);
 assert v='0','fixtures removed';
 perform extensions.dblink_disconnect('admin');
 raise notice 'PASS agency race cleanup: committed fixtures removed';
end $$;
rollback;
