-- Studio library: full-scope project title search (audit M05).
--
-- Searches artifact titles in one workspace the caller can read (owner or
-- member, checked here and again by the artifacts RLS policy because the
-- function is SECURITY INVOKER). It never reads briefs, notes, client records,
-- version content, assets or another workspace, and it returns only the
-- columns the library card already shows. Matching is a case-insensitive
-- substring (strpos), so % and _ in a query are literal characters.
--
-- Pages are keyset-paginated on the immutable (created_at, id), newest first:
-- a project edited, renamed or created while the user pages through results
-- can neither repeat nor push another result out of the sequence. The cursor
-- is the last row's own (created_at, id), returned at full precision.
begin;

create function public.makeborne_artifact_title_search(
  p_workspace_id uuid,
  p_query text,
  p_kind text default 'all',
  p_after_created_at timestamptz default null,
  p_after_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare needle text; result jsonb;
begin
  if p_workspace_id is null or not makeborne_private.can_read(p_workspace_id) then
    raise exception 'Workspace access required' using errcode='42501';
  end if;
  needle := lower(btrim(coalesce(p_query, '')));
  if length(needle) not between 1 and 200 or p_kind is null or p_kind not in ('all','website','book','presentation')
    or (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'Invalid title search' using errcode='22023';
  end if;
  with matches as materialized (
    select a.id, a.project_id, a.kind, a.title, a.current_version, a.created_at, a.updated_at
    from public.artifacts a
    where a.workspace_id = p_workspace_id
      and (p_kind = 'all' or a.kind = p_kind)
      and strpos(lower(a.title), needle) > 0
  ), page as materialized (
    select m.* from matches m
    where p_after_created_at is null or (m.created_at, m.id) < (p_after_created_at, p_after_id)
    order by m.created_at desc, m.id desc
    limit 51
  ), shown as materialized (
    select p.* from page p order by p.created_at desc, p.id desc limit 50
  )
  select jsonb_build_object(
    'artifacts', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc, s.id desc) from shown s), '[]'::jsonb),
    'total', (select count(*) from matches),
    'nextCursor', case when (select count(*) from page) > 50 then
      (select jsonb_build_object('createdAt', s.created_at, 'id', s.id) from shown s order by s.created_at asc, s.id asc limit 1) end
  ) into result;
  return result;
end $$;

comment on function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid) is
  'Studio library title search in one readable workspace. Titles only; keyset pages of 50 on (created_at, id) desc.';
revoke all on function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid) from public, anon;
grant execute on function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid) to authenticated;

commit;
