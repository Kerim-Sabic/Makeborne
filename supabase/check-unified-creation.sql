-- Isolated transaction fixtures roll back on success and failure.
do $$
declare actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); result jsonb; replay jsonb;
  project jsonb:='{"title":"Unified fixture","kind":"website","style_id":"electric-mint","effort":"ultra"}';
  content jsonb:='{"schemaVersion":1,"title":"Unified fixture","kind":"website","sections":[]}';
  style jsonb:='{"id":"electric-mint","name":"Electric Mint","version":1,"typography":{"headingFont":"Inter","bodyFont":"Inter"},"colors":{"accent":"#8FEBC8","ink":"#F0FAF4","canvas":"#142824"},"description":"Fixture","referenceAssetIds":[]}';
begin
  begin
    insert into auth.users(id) values(actor),(reviewer),(outsider);
    insert into public.workspaces(id,name,owner_id) values(workspace,'Atomic creation fixture',actor);
    insert into public.workspace_members(workspace_id,user_id,role) values(workspace,reviewer,'reviewer');
    perform set_config('request.jwt.claim.sub',actor::text,true);
    set local role authenticated;
    result:=public.makeborne_create_studio_project(workspace,request_id,project,content,style);
    assert result->'project'->>'effort'='ultra', 'effort lost';
    assert result->'version'->'style_snapshot'->'colors'->>'canvas'='#142824', 'palette lost';
    assert result->'artifact'->>'current_version'='1', 'initial version missing';
    replay:=public.makeborne_create_studio_project(workspace,request_id,project,content,style);
    assert (replay->>'replayed')::boolean, 'retry not replayed';
    assert replay->'project'->>'id'=result->'project'->>'id', 'duplicate project';
    assert replay->'version'->>'id'=result->'version'->>'id', 'duplicate version';
    begin
      perform public.makeborne_create_studio_project(workspace,request_id,project,content,jsonb_set(style,'{description}','"Different"'));
      raise exception 'changed request accepted';
    exception when sqlstate 'MB409' then null; end;
    begin
      perform public.makeborne_create_studio_project(workspace,gen_random_uuid(),project,content,jsonb_set(style,'{typography}','{}'));
      raise exception 'invalid version accepted';
    exception when sqlstate '22023' then null; end;
    assert (select count(*)=1 from public.projects where workspace_id=workspace), 'failed operation left project';
    assert (select count(*)=1 from public.artifacts where workspace_id=workspace), 'failed operation left artifact';
    begin
      perform public.makeborne_create_studio_project(workspace,gen_random_uuid(),project,jsonb_set(content,'{kind}','"book"'),style);
      raise exception 'mismatched content accepted';
    exception when sqlstate '22023' then null; end;
    begin
      perform public.makeborne_create_studio_project(workspace,gen_random_uuid(),jsonb_set(project,'{effort}','"unbounded"'),content,style);
      raise exception 'invalid effort accepted';
    exception when sqlstate '22023' then null; end;
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    begin
      perform public.makeborne_create_studio_project(workspace,request_id,project,content,style);
      raise exception 'outsider replayed owner request';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub',reviewer::text,true);
    begin
      perform public.makeborne_create_studio_project(workspace,gen_random_uuid(),project,content,style);
      raise exception 'reviewer created project';
    exception when insufficient_privilege then null; end;
    reset role;
    raise exception 'rollback fixtures' using errcode='MBT01';
  exception when sqlstate 'MBT01' then raise notice 'PASS: 14 atomic creation checks; fixtures rolled back'; end;
end;
$$;
