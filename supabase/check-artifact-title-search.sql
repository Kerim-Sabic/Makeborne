-- Local disposable full-chain database only. RLS, pagination and a 5,000-row workspace.
\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
do $$
declare actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid();
  project uuid:=gen_random_uuid(); other_project uuid:=gen_random_uuid(); result jsonb; last_ jsonb; seen uuid[]:='{}';
  at_ timestamptz; id_ uuid; started timestamptz; elapsed numeric;
  f text:='public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid)';
begin
  assert has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'),'authenticated-only public entry';
  assert not has_function_privilege('service_role',f,'execute'),'no implicit service-role grant';
  assert (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f::regprocedure),'invoker with empty search_path';
  insert into auth.users(id,email) values(actor,actor||'@search.example.invalid'),(stranger,stranger||'@search.example.invalid');
  insert into public.workspaces(id,name,owner_id) values(workspace,'Search fixture',actor),(other_workspace,'Private workspace',stranger);
  insert into public.projects(id,workspace_id,title,kind) values(project,workspace,'Fixture','website'),(other_project,other_workspace,'Private','website');
  insert into public.artifacts(workspace_id,project_id,title,kind,created_at)
    select workspace,project,case when i<=151 then 'Needle '||i else 'Different '||i end,'website',now()-i*interval '1 second' from generate_series(1,5000) i;
  insert into public.artifacts(workspace_id,project_id,title,kind) values(other_workspace,other_project,'Needle secret','website');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  started:=clock_timestamp();
  loop
    result:=public.makeborne_artifact_title_search(workspace,'needle','all',at_,id_);
    assert (result->>'total')::int=151,'search covers the workspace, not only loaded cards';
    seen:=seen||array(select (x->>'id')::uuid from jsonb_array_elements(result->'artifacts') x);
    last_:=result->'nextCursor';exit when last_='null'::jsonb;
    at_:=(last_->>'createdAt')::timestamptz;id_:=(last_->>'id')::uuid;
  end loop;
  elapsed:=1000*extract(epoch from clock_timestamp()-started);
  assert cardinality(seen)=151 and (select count(distinct x) from unnest(seen) x)=151,'all four pages once, no gaps';
  assert (public.makeborne_artifact_title_search(workspace,'%')->>'total')::int=0,'wildcard input remains literal';
  begin perform public.makeborne_artifact_title_search(other_workspace,'needle');raise exception 'Other workspace exposed';exception when sqlstate '42501' then null;end;
  reset role;
  set local role anon;
  begin perform public.makeborne_artifact_title_search(workspace,'needle');raise exception 'Anonymous caller executed';exception when insufficient_privilege then null;end;
  reset role;
  raise notice 'PASS M05 RLS, scope, full-library search, literal input and 151 unique results; four pages over 5,000 artifacts took % ms',round(elapsed,2);
end $$;
rollback;
