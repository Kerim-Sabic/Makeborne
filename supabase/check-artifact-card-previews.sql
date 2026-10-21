-- Local disposable database only (audit M06). Everything rolls back. No provider calls.
-- Stored website card previews: service-role only, editor-only writes, current version only,
-- one row per artifact, and nothing survives deletion of the version, project or workspace.
\set ON_ERROR_STOP on
begin;
do $$
declare owner_ uuid:=gen_random_uuid(); editor_ uuid:=gen_random_uuid(); reviewer_ uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
  w uuid; other_w uuid; p uuid; a uuid; book_a uuid; v1 uuid; v2 uuid; v3 uuid; result jsonb;
  doc text:='<!doctype html><html><head><title>x</title></head><body>'||repeat('<p>card</p>',20)||'</body></html>';
  h1 text:=repeat('a',64); h2 text:=repeat('b',64); h3 text:=repeat('c',64);
  f text:='public.makeborne_save_artifact_card_preview(uuid,uuid,uuid,uuid,text,text,text)';
begin
  assert not has_table_privilege('authenticated','public.artifact_card_previews','select') and not has_table_privilege('anon','public.artifact_card_previews','select'),'members never read stored previews through the Data API';
  assert not has_table_privilege('authenticated','public.artifact_card_previews','insert'),'members never write them directly';
  assert not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and has_function_privilege('service_role',f,'execute'),'service-role only entry';
  assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f::regprocedure),'definer with empty search_path';

  insert into auth.users(id,email) values(owner_,owner_||'@card.invalid'),(editor_,editor_||'@card.invalid'),(reviewer_,reviewer_||'@card.invalid'),(stranger,stranger||'@card.invalid');
  insert into public.workspaces(name,owner_id) values('Card fixture',owner_) returning id into w;
  insert into public.workspaces(name,owner_id) values('Other',stranger) returning id into other_w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,editor_,'editor'),(w,reviewer_,'reviewer');
  insert into public.projects(workspace_id,title,kind) values(w,'Site','website') returning id into p;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,p,'website','Site',0) returning id into a;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,p,'book','Book',0) returning id into book_a;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,1,'{"v":1}','{}',owner_) returning id into v1;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,2,'{"v":2}','{}',owner_) returning id into v2;
  update public.artifacts set current_version=2 where id=a;

  -- Only the current version can be stored: a capture that finishes after a newer save is refused.
  begin perform public.makeborne_save_artifact_card_preview(editor_,w,a,v1,h1,'ready',doc);raise exception 'Older version stored';exception when sqlstate 'PT409' then null;end;
  result:=public.makeborne_save_artifact_card_preview(editor_,w,a,v2,h2,'ready',doc);
  assert result->>'versionId'=v2::text and (result->>'versionNumber')::int=2 and result->>'outcome'='ready','editor stores the current version';
  -- Reviewers, strangers and other workspaces cannot write.
  begin perform public.makeborne_save_artifact_card_preview(reviewer_,w,a,v2,h2,'ready',doc);raise exception 'Reviewer stored a preview';exception when sqlstate '42501' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(stranger,w,a,v2,h2,'ready',doc);raise exception 'Stranger stored a preview';exception when sqlstate '42501' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(stranger,other_w,a,v2,h2,'ready',doc);raise exception 'Cross-workspace write';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(owner_,w,book_a,v2,h2,'ready',doc);raise exception 'Non-website stored';exception when sqlstate 'P0002' then null;end;
  -- Shape: ready needs bounded HTML, too_large stores none; fingerprints are sha256 hex.
  begin perform public.makeborne_save_artifact_card_preview(owner_,w,a,v2,h2,'ready',null);raise exception 'Ready without HTML';exception when sqlstate '22023' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(owner_,w,a,v2,h2,'too_large',doc);raise exception 'Too large with HTML';exception when sqlstate '22023' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(owner_,w,a,v2,'not-a-hash','ready',doc);raise exception 'Bad fingerprint';exception when sqlstate '22023' then null;end;
  begin perform public.makeborne_save_artifact_card_preview(owner_,w,a,v2,h2,'ready',repeat('x',2000001));raise exception 'Oversized HTML';exception when sqlstate '22023' then null;end;

  -- A newer save: the older row stays only until the new version is captured, then it is removed.
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,3,'{"v":3}','{}',owner_) returning id into v3;
  update public.artifacts set current_version=3 where id=a;
  begin perform public.makeborne_save_artifact_card_preview(editor_,w,a,v2,h2,'ready',doc);raise exception 'Late capture of version 2 overwrote version 3';exception when sqlstate 'PT409' then null;end;
  perform public.makeborne_save_artifact_card_preview(owner_,w,a,v3,h3,'too_large',null);
  assert (select count(*) from public.artifact_card_previews where artifact_id=a)=1,'one row per artifact';
  assert (select version_id=v3 and outcome='too_large' and html is null and content_hash=h3 from public.artifact_card_previews where artifact_id=a),'bound to the version id, fingerprint and outcome';

  -- RLS: even a signed-in owner cannot read rows directly.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_,'role','authenticated')::text,true);
  set local role authenticated;
  begin perform 1 from public.artifact_card_previews limit 1;raise exception 'Direct read allowed';exception when insufficient_privilege then null;end;
  reset role;
  perform set_config('request.jwt.claims','',true);

  -- Deletion: version, project and workspace deletes remove stored previews (no orphan to retrieve).
  perform public.makeborne_save_artifact_card_preview(owner_,w,a,v3,h3,'ready',doc);
  delete from public.artifact_versions where id=v3;
  assert not exists(select 1 from public.artifact_card_previews where version_id=v3),'version delete removes its preview';
  update public.artifacts set current_version=2 where id=a;
  perform public.makeborne_save_artifact_card_preview(owner_,w,a,v2,h2,'ready',doc);
  delete from public.projects where id=p;
  assert not exists(select 1 from public.artifact_card_previews where artifact_id=a),'project delete removes its previews';
  insert into public.projects(workspace_id,title,kind) values(w,'Site 2','website') returning id into p;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,p,'website','Site 2',0) returning id into a;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values(w,a,1,'{"v":1}','{}',owner_) returning id into v1;
  update public.artifacts set current_version=1 where id=a;
  perform public.makeborne_save_artifact_card_preview(editor_,w,a,v1,h1,'ready',doc);
  delete from public.workspaces where id=w;
  assert not exists(select 1 from public.artifact_card_previews where workspace_id=w),'workspace delete removes its previews';
  raise notice 'PASS M06 card previews: service-role only, editor writes, current version only, one row per artifact, deletion cascades';
end $$;
rollback;
