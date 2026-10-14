-- LOCAL ISOLATED DATABASE ONLY; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); w uuid; p uuid; other_p uuid; other_w uuid; other_u uuid:=gen_random_uuid();
  a uuid; art uuid; unrelated uuid; cross_project uuid; cross_workspace uuid; absent_manifest uuid;
  token text:=repeat('d',43); pinned text:=repeat('p',43); link uuid; pinned_link uuid; result jsonb; content jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(u,u||'@review.invalid',now(),false),(other_u,other_u||'@review.invalid',now(),false);
  insert into public.workspaces(name,owner_id) values('Document review',u) returning id into w;
  insert into public.workspaces(name,owner_id) values('Foreign review',other_u) returning id into other_w;
  insert into public.projects(workspace_id,title,kind) values(w,'Review deck','presentation') returning id into p;
  insert into public.projects(workspace_id,title,kind) values(w,'Other project','presentation') returning id into other_p;
  a:=gen_random_uuid();unrelated:=gen_random_uuid();cross_project:=gen_random_uuid();cross_workspace:=gen_random_uuid();absent_manifest:=gen_random_uuid();
  insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values
    (a,w,p,w||'/'||p||'/artwork/'||a||'.webp','image/webp',repeat('a',64)),
    (unrelated,w,p,w||'/'||p||'/artwork/'||unrelated||'.webp','image/webp',repeat('b',64)),
    (absent_manifest,w,p,w||'/'||p||'/artwork/'||absent_manifest||'.webp','image/webp',repeat('b',64)),
    (cross_project,w,other_p,w||'/'||other_p||'/artwork/'||cross_project||'.webp','image/webp',repeat('c',64));
  insert into public.projects(workspace_id,title,kind) values(other_w,'Foreign','book') returning id into other_p;
  insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256)
    values(cross_workspace,other_w,other_p,other_w||'/'||other_p||'/artwork/'||cross_workspace||'.webp','image/webp',repeat('f',64));
  insert into public.artifacts(workspace_id,project_id,kind,title) values(w,p,'presentation','Review deck') returning id into art;
  content:=jsonb_build_object('schemaVersion',1,'kind','presentation','title','Review deck','sections','[]'::jsonb,
    'document',jsonb_build_object('kind','deck','assets',jsonb_build_array(jsonb_build_object('id',a),jsonb_build_object('id',cross_project),jsonb_build_object('id',cross_workspace),jsonb_build_object('id',absent_manifest))));
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by,asset_manifest)
    values(w,art,1,content,'{}',u,jsonb_build_array(a,unrelated));
  update public.artifacts set current_version=1 where id=art;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,version_number,token_hash,expires_at,created_by)
    values(w,p,art,null,sha256(convert_to(token,'UTF8')),now()+interval '1 day',u) returning id into link;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,version_number,token_hash,expires_at,created_by)
    values(w,p,art,1,sha256(convert_to(pinned,'UTF8')),now()+interval '1 day',u) returning id into pinned_link;
  set local role anon;
  begin perform public.makeborne_client_review_asset(token,1,a);raise exception 'Anon read locator';exception when insufficient_privilege then null;end;
  begin perform makeborne_private.client_review_asset(token,1,a);raise exception 'Anon read private locator';exception when insufficient_privilege then null;end;
  reset role;
  set local role authenticated;
  begin perform public.makeborne_client_review_asset(token,1,a);raise exception 'Authenticated read locator';exception when insufficient_privilege then null;end;
  reset role;
  set local role service_role;
  result:=public.makeborne_client_review_asset(token,1,a);
  assert result->>'assetId'=a::text and result->>'workspaceId'=w::text and result->>'projectId'=p::text, 'Wrong locator scope';
  begin perform public.makeborne_client_review_asset(repeat('x',43),1,a);raise exception 'Unknown token accepted';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_client_review_asset(token,2,a);raise exception 'Wrong version accepted';exception when sqlstate 'PT409' then null;end;
  begin perform public.makeborne_client_review_asset(token,1,unrelated);raise exception 'Unlisted document asset accepted';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_client_review_asset(token,1,absent_manifest);raise exception 'Asset outside manifest accepted';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_client_review_asset(token,1,cross_project);raise exception 'Foreign project asset accepted';exception when sqlstate 'P0002' then null;end;
  begin perform public.makeborne_client_review_asset(token,1,cross_workspace);raise exception 'Foreign workspace asset accepted';exception when sqlstate 'P0002' then null;end;
  reset role;
  raise notice 'PASS locator server-only; token/version/document/manifest/project/workspace allowlists enforced';
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by,asset_manifest)
    values(w,art,2,content,'{}',u,jsonb_build_array(a));
  update public.artifacts set current_version=2 where id=art;
  set local role service_role;
  begin perform public.makeborne_client_review_asset(token,1,a);raise exception 'Latest old-view asset accepted';exception when sqlstate 'PT409' then null;end;
  assert (public.makeborne_client_review_asset(token,2,a)->>'version')::int=2;
  assert (public.makeborne_client_review_asset(pinned,1,a)->>'version')::int=1;
  reset role;
  update public.client_review_links set created_by=other_u where id=link;
  set local role service_role;
  begin perform public.makeborne_client_review_asset(token,2,a);raise exception 'Creator access loss still exposed image';exception when sqlstate 'P0002' then null;end;
  reset role;
  update public.client_review_links set created_by=u where id=link;
  update public.client_review_links set revoked_at=now() where id=link;
  set local role service_role;
  begin perform public.makeborne_client_review_asset(token,2,a);raise exception 'Revoked token asset accepted';exception when sqlstate 'P0002' then null;end;
  reset role;
  update public.client_review_links set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=pinned_link;
  set local role service_role;
  begin perform public.makeborne_client_review_asset(pinned,1,a);raise exception 'Expired token asset accepted';exception when sqlstate 'P0002' then null;end;
  reset role;
  raise notice 'PASS latest/pinned semantics, creator access loss, revoked and expired links denied';
end $$;
rollback;
