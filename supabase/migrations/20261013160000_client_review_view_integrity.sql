-- Client reviews bind writes to the version actually displayed and expose only
-- client-facing content. Roll out this migration with the matching app routes.
-- Older clients omit p_version and are deliberately refused, never inferred.
-- ROLLOUT: pause public review writes and drain in-flight review transactions,
-- then apply this migration with matching version-aware app handlers. An already
-- executing old PL/pgSQL body may otherwise finish a blind approval. Stage45
-- already has review functions; never assume an app-only switch is sufficient.
-- Existing readers stay compatible; old write clients must reload/fail closed.
-- RECOVERY: keep version-aware handlers and client-safe redaction even if other
-- app features roll back. No destructive down migration may restore blind writes
-- or the previous private-note disclosure; do not reopen revoked review links.
begin;

create or replace function makeborne_private.client_review_content(p_content jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb := p_content-'websiteSource'-'website'-'reviewQuestions'; doc jsonb;
begin
  -- Keep authored visuals/text and asset identities; omit provenance and private
  -- presenter notes. Never alter the persisted owner/export source.
  result := jsonb_set(result,'{sections}',coalesce((select jsonb_agg(
    section || jsonb_build_object('blocks',coalesce((select jsonb_agg(block || '{"sourceIds":[]}'::jsonb order by block_order)
      from jsonb_array_elements(section->'blocks') with ordinality as blocks(block,block_order)
      where not (block->>'type'='callout' and coalesce(block->>'text','') ~ '^Speaker notes:')),'[]'::jsonb)) order by section_order)
    from jsonb_array_elements(result->'sections') with ordinality as sections(section,section_order)),'[]'::jsonb));
  doc := result->'document';
  if doc is not null then
    -- A nonempty redaction marker preserves DocumentSourceSchema compatibility.
    if doc->>'kind'='deck' then
      doc := jsonb_set(doc,'{slides}',coalesce((select jsonb_agg(slide || '{"notes":"Presenter notes are private."}'::jsonb order by ord)
        from jsonb_array_elements(doc->'slides') with ordinality as slides(slide,ord)),'[]'::jsonb));
    end if;
    doc := jsonb_set(doc,'{assets}',coalesce((select jsonb_agg(asset || '{"prompt":""}'::jsonb order by ord)
      from jsonb_array_elements(doc->'assets') with ordinality as assets(asset,ord)),'[]'::jsonb));
    doc := jsonb_set(doc,'{theme}',(doc->'theme') || '{"imageStyle":"","mood":""}'::jsonb);
    result := jsonb_set(result,'{document}',doc);
  end if;
  return result;
end $$;
revoke all on function makeborne_private.client_review_content(jsonb) from public,anon,authenticated,service_role;

-- Remove the unversioned public entry points, including inherited grants.
drop function if exists public.makeborne_add_client_review_comment(text,text,text,text,jsonb);
drop function if exists public.makeborne_decide_client_review(text,text,text,text,text);

create or replace function public.makeborne_read_client_review(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; h bytea := makeborne_private.client_review_token_hash(p_token);
  a public.artifacts%rowtype; t record; v public.artifact_versions%rowtype; v_content jsonb; v_style jsonb;
begin
  if h is null then return null; end if;
  select * into r from public.client_review_links where token_hash=h;
  if not found then return null; end if;
  if r.revoked_at is not null or not makeborne_private.client_review_can_edit_as(r.created_by,r.workspace_id) then
    return jsonb_build_object('status','revoked');
  end if;
  if r.expires_at<=now() then return jsonb_build_object('status','expired'); end if;
  select * into a from public.artifacts where id=r.artifact_id and workspace_id=r.workspace_id;
  select * into t from makeborne_private.client_review_target(r);
  if t.html is null then
    select * into v from public.artifact_versions where artifact_id=r.artifact_id and workspace_id=r.workspace_id and version_number=t.version_number;
    if not found or v.content ? 'websiteSource' or v.content ? 'website' then
      return jsonb_build_object('status','preparing','title',a.title,'kind',a.kind);
    end if;
    v_content := makeborne_private.client_review_content(v.content);
    v_style := v.style_snapshot-'referenceAssetIds';
  end if;
  update public.client_review_links set view_count=least(view_count+1,2000000000),last_viewed_at=now() where id=r.id;
  return jsonb_build_object(
    'status','active','kind',a.kind,'title',a.title,'version',t.version_number,'pinned',r.version_number is not null,
    'mode',case when t.html is null then 'content' else 'html' end,'html',t.html,'content',v_content,'style',v_style,
    'recipientName',r.recipient_name,'message',r.message,'expiresAt',r.expires_at,
    'decision',case when r.decision is null then null else jsonb_build_object('value',r.decision,'name',r.decision_name,'at',r.decided_at,'version',r.decided_version) end,
    'comments',coalesce((select jsonb_agg(makeborne_private.client_review_comment_json(c) order by c.created_at)
      from (select * from public.client_review_comments where link_id=r.id order by created_at desc limit 300) c),'[]'::jsonb));
end $$;

create or replace function public.makeborne_add_client_review_comment(p_token text,p_version integer,p_name text,p_email text,p_body text,p_anchor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; c public.client_review_comments%rowtype; t record;
  v_name text := makeborne_private.client_review_text(p_name);
  v_email text := lower(makeborne_private.client_review_text(p_email));
  v_body text := makeborne_private.client_review_text(p_body);
  v_anchor jsonb;
begin
  select * into r from makeborne_private.client_review_live_link(p_token,true);
  if length(v_name) not between 1 and 80 or position(E'\n' in v_name)>0 then raise exception 'Add your name (up to 80 characters)' using errcode='22023'; end if;
  if v_email<>'' and (length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Use a valid email or leave it empty' using errcode='22023'; end if;
  if length(v_body) not between 1 and 2000 then raise exception 'Comments are 1 to 2000 characters' using errcode='22023'; end if;
  v_anchor := makeborne_private.client_review_anchor(p_anchor);
  if (select count(*) from public.client_review_comments where link_id=r.id and created_at>now()-interval '10 minutes')>=20
    or (select count(*) from public.client_review_comments where link_id=r.id)>=300
    or (select count(*) from public.client_review_comments where workspace_id=r.workspace_id and created_at>now()-interval '1 hour')>=600 then
    raise exception 'Too many comments. Please wait a few minutes.' using errcode='MB429';
  end if;
  -- Coordinate with version saves and website snapshot refreshes. Resolve again
  -- after a competing save commits; never approve a version the client did not see.
  perform 1 from public.artifacts where id=r.artifact_id and workspace_id=r.workspace_id for share;
  select * into t from makeborne_private.client_review_target(r);
  if p_version is null or p_version < 1 or p_version is distinct from t.version_number then
    raise exception 'This review changed; refresh before sending' using errcode='PT409';
  end if;
  insert into public.client_review_comments(workspace_id,link_id,version_number,kind,author_name,author_email,body,anchor)
  values(r.workspace_id,r.id,t.version_number,'comment',v_name,v_email,v_body,v_anchor) returning * into c;
  return makeborne_private.client_review_comment_json(c);
end $$;

create or replace function public.makeborne_decide_client_review(p_token text,p_version integer,p_name text,p_email text,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; c public.client_review_comments%rowtype; t record; v_title text;
  v_name text := makeborne_private.client_review_text(p_name);
  v_email text := lower(makeborne_private.client_review_text(p_email));
  v_note text := makeborne_private.client_review_text(p_note);
begin
  select * into r from makeborne_private.client_review_live_link(p_token,true);
  if p_decision is null or p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes' using errcode='22023'; end if;
  if length(v_name) not between 1 and 80 or position(E'\n' in v_name)>0 then raise exception 'Add your name (up to 80 characters)' using errcode='22023'; end if;
  if v_email<>'' and (length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Use a valid email or leave it empty' using errcode='22023'; end if;
  if length(v_note)>2000 then raise exception 'Notes are up to 2000 characters' using errcode='22023'; end if;
  if (select count(*) from public.client_review_comments where link_id=r.id and kind<>'comment')>=10 then
    raise exception 'This review already has its decision. Ask for a new link to review again.' using errcode='MB429';
  end if;
  -- Coordinate with version saves and website snapshot refreshes. Resolve again
  -- after a competing save commits; never approve a version the client did not see.
  perform 1 from public.artifacts where id=r.artifact_id and workspace_id=r.workspace_id for share;
  select * into t from makeborne_private.client_review_target(r);
  if p_version is null or p_version < 1 or p_version is distinct from t.version_number then
    raise exception 'This review changed; refresh before sending' using errcode='PT409';
  end if;
  update public.client_review_links set decision=p_decision,decision_name=v_name,decided_at=now(),decided_version=t.version_number where id=r.id;
  insert into public.client_review_comments(workspace_id,link_id,version_number,kind,author_name,author_email,body,anchor)
  values(r.workspace_id,r.id,t.version_number,p_decision,v_name,v_email,v_note,'{"kind":"general"}') returning * into c;
  -- The decision and the linked project's delivery stage commit together. The
  -- client's sales stage and the client's other projects are never touched.
  perform makeborne_private.project_delivery_advance(r.workspace_id,r.project_id,
    case when p_decision='approved' then 'delivered' else 'changes_requested' end);
  return jsonb_build_object('decision',jsonb_build_object('value',p_decision,'name',v_name,'at',now(),'version',t.version_number),
    'comment',makeborne_private.client_review_comment_json(c));
end $$;
revoke all on function public.makeborne_add_client_review_comment(text,integer,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.makeborne_decide_client_review(text,integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_add_client_review_comment(text,integer,text,text,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.makeborne_decide_client_review(text,integer,text,text,text,text) to anon,authenticated,service_role;
commit;
