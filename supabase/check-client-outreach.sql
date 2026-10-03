-- Transaction-scoped fixtures: no accounts, contacts or messages survive this check.
do $$
declare owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); reviewer_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); previous timestamptz; affected integer;
  value jsonb:='{"stage":"Contacted","channel":"Instagram","profileUrl":"https://example.com/profile","lastContact":"2026-10-01","nextFollowUp":"2026-10-05","notes":"Fixture","activity":[]}'::jsonb;
begin
  begin
  insert into auth.users(id) values(owner_id),(editor_id),(reviewer_id),(outsider_id);
  insert into public.workspaces(id,name,owner_id) values(workspace,'Outreach transaction fixture',owner_id);
  insert into public.workspace_members(workspace_id,user_id,role) values(workspace,editor_id,'editor'),(workspace,reviewer_id,'reviewer');
  insert into public.clients(id,workspace_id,name) values(contact,workspace,'Outreach fixture');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  select updated_at into previous from public.clients where id=contact;
  update public.clients set outreach=value where id=contact and updated_at=previous;
  get diagnostics affected=row_count;
  assert affected=1, 'owner save failed';
  assert (select outreach=value from public.clients where id=contact), 'roundtrip failed';
  update public.clients set outreach=value where id=contact and updated_at=previous;
  get diagnostics affected=row_count;
  assert affected=0, 'stale save accepted';
  perform set_config('request.jwt.claim.sub',editor_id::text,true);
  update public.clients set outreach=jsonb_set(value,'{stage}','"Replied"') where id=contact;
  get diagnostics affected=row_count;
  assert affected=1, 'editor save failed';
  perform set_config('request.jwt.claim.sub',reviewer_id::text,true);
  assert (select count(*)=1 from public.clients where id=contact), 'reviewer read failed';
  update public.clients set outreach=value where id=contact;
  get diagnostics affected=row_count;
  assert affected=0, 'reviewer wrote outreach';
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  assert (select count(*)=0 from public.clients where id=contact), 'cross tenant read';
  update public.clients set outreach=value where id=contact;
  get diagnostics affected=row_count;
  assert affected=0, 'cross tenant write';
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    update public.clients set outreach=jsonb_set(value,'{stage}','"Invalid"') where id=contact;
    raise exception 'invalid stage accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.clients set outreach=jsonb_set(value,'{nextFollowUp}','"2026-02-30"') where id=contact;
    raise exception 'invalid date accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.clients set outreach=jsonb_set(value,'{profileUrl}','"https://secret@example.com/"') where id=contact;
    raise exception 'credential URL accepted';
  exception when sqlstate '22023' then null; end;
  value:=jsonb_set(value,'{activity}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at','2026-10-03T12:00:00Z','text','Manual fixture note','type','note')));
  update public.clients set outreach=value where id=contact;
  assert (select jsonb_array_length(outreach->'activity')=1 from public.clients where id=contact), 'history append failed';
  begin
    update public.clients set outreach=jsonb_set(value,'{activity}','[]') where id=contact;
    raise exception 'history deletion accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.clients set outreach=null where id=contact;
    raise exception 'history reset accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.clients set outreach=jsonb_set(value,'{activity,0,text}','"Edited history"') where id=contact;
    raise exception 'history rewrite accepted';
  exception when sqlstate '22023' then null; end;
  reset role;
  raise exception 'rollback successful fixtures' using errcode='MBT01';
  exception when sqlstate 'MBT01' then
    raise notice 'PASS: 15 outreach checks (roles, tenant isolation, revisions, validation, history); fixtures rolled back';
  end;
end;
$$;
