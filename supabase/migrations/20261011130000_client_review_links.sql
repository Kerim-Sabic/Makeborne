-- Client review links: a freelancer shares ONE artifact (a pinned version or
-- "latest") with a client who has no account. The client reads, comments and
-- approves through narrowly scoped SECURITY DEFINER functions keyed by an
-- unguessable token. Only the SHA-256 of the token is stored; tenant tables
-- stay closed to anon. CRM stages gain "Review" and "Delivered".
begin;

-- ---------------------------------------------------------------------------
-- 1. CRM stages: ... Proposal → Won (active) → Review → Delivered, plus Lost.
-- ---------------------------------------------------------------------------
create or replace function makeborne_private.validate_client_outreach() returns trigger
language plpgsql set search_path='' as $$
declare v jsonb := new.outreach; item jsonb; k text; seen text[] := '{}'; previous jsonb;
begin
  if v is null then
    if tg_op='UPDATE' and old.outreach is not null then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    return new;
  end if;
  if jsonb_typeof(v)<>'object' or octet_length(v::text)>1000000
    or not (v ?& array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])
    or (v - array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])<>'{}'::jsonb
    or coalesce(v->>'stage','') not in ('Lead','Contacted','Replied','Meeting','Proposal','Won','Review','Delivered','Lost')
    or coalesce(v->>'channel','') not in ('Not set','Email','Instagram','LinkedIn','Phone','Other')
    or jsonb_typeof(v->'profileUrl') is distinct from 'string' or length(v->>'profileUrl')>2000
    or ((v->>'profileUrl')<>'' and (v->>'profileUrl') !~ '^https?://[^/@[:space:]]+([/?#]|$)')
    or jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>5000
    or jsonb_typeof(v->'activity') is distinct from 'array' then
    raise exception 'Invalid outreach fields' using errcode='22023';
  end if;
  foreach k in array array['lastContact','nextFollowUp'] loop
    if v->k <> 'null'::jsonb then
      if jsonb_typeof(v->k)<>'string' or (v->>k) !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char((v->>k)::date,'YYYY-MM-DD')<>v->>k then
        raise exception 'Invalid outreach date' using errcode='22023';
      end if;
    end if;
  end loop;
  if jsonb_array_length(v->'activity')>300 then raise exception 'Outreach history limit reached' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(v->'activity') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['id','at','text','type'])
      or (item-array['id','at','text','type'])<>'{}'::jsonb
      or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'id')=any(seen)
      or jsonb_typeof(item->'at') is distinct from 'string'
      or (item->>'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
      or jsonb_typeof(item->'text') is distinct from 'string' or length(trim(item->>'text')) not between 1 and 2000
      or coalesce(item->>'type','') not in ('update','contact','note') then
      raise exception 'Invalid outreach history' using errcode='22023';
    end if;
    perform (item->>'at')::timestamptz;
    seen := array_append(seen,item->>'id');
  end loop;
  if tg_op='UPDATE' and old.outreach is not null then
    previous := old.outreach->'activity';
    if jsonb_array_length(v->'activity')<jsonb_array_length(previous) then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    for i in 0..jsonb_array_length(previous)-1 loop
      if previous->i is distinct from v->'activity'->i then
        raise exception 'Outreach history must be preserved' using errcode='22023';
      end if;
    end loop;
  end if;
  return new;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Invalid outreach date' using errcode='22023';
end;
$$;
revoke all on function makeborne_private.validate_client_outreach() from public,anon,authenticated;

create or replace function public.makeborne_client_directory(p_workspace_id uuid,p_search text,p_stage text,p_follow_up text,p_day date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_day is null or p_offset is null or p_offset not between 0 and 100000
 or p_stage is null or p_stage not in ('All stages','Lead','Contacted','Replied','Meeting','Proposal','Won','Review','Delivered','Lost')
 or p_follow_up is null or p_follow_up not in ('all','overdue','today','upcoming','unscheduled') then raise exception 'Invalid directory filters' using errcode='22023'; end if;
 with base as materialized (
   select c.id,c.name,c.company,c.email,c.website,c.created_at,c.updated_at,
     coalesce(c.outreach->>'stage','Lead') as outreach_stage,c.outreach->>'nextFollowUp' as outreach_follow_up,
     case when c.outreach->>'stage' in ('Won','Delivered','Lost') then 'closed'
       when c.outreach->>'nextFollowUp' is null then 'unscheduled'
       when c.outreach->>'nextFollowUp'<to_char(p_day,'YYYY-MM-DD') then 'overdue'
       when c.outreach->>'nextFollowUp'=to_char(p_day,'YYYY-MM-DD') then 'today'
       else 'upcoming' end as follow_up_bucket
   from public.clients c where c.workspace_id=p_workspace_id
 ), filtered as materialized (
   select * from base where (p_stage='All stages' or outreach_stage=p_stage)
     and (p_follow_up='all' or follow_up_bucket=p_follow_up)
     and (p_search='' or strpos(lower(name||' '||company||' '||email),lower(p_search))>0)
 ), page as (
   select * from filtered order by
     case when p_follow_up<>'all' then outreach_follow_up end asc nulls last,
     case when p_follow_up='all' then created_at end desc,
     id asc limit 50 offset p_offset
 )
 select jsonb_build_object(
   'clients',coalesce((select jsonb_agg(to_jsonb(page)-'follow_up_bucket') from page),'[]'::jsonb),
   'pagination',jsonb_build_object('total',(select count(*) from filtered),'nextOffset',case when p_offset+50<(select count(*) from filtered) then p_offset+50 else null end),
   'counts',(select jsonb_build_object('all',count(*),'overdue',count(*) filter(where follow_up_bucket='overdue'),'today',count(*) filter(where follow_up_bucket='today'),'upcoming',count(*) filter(where follow_up_bucket='upcoming'),'unscheduled',count(*) filter(where follow_up_bucket='unscheduled')) from base)
 ) into result;
 return result;
end $$;
revoke all on function public.makeborne_client_directory(uuid,text,text,text,date,integer) from public,anon;
grant execute on function public.makeborne_client_directory(uuid,text,text,text,date,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables. Tenant members read through RLS; nobody writes directly.
-- ---------------------------------------------------------------------------
create table public.client_review_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  artifact_id uuid not null,
  -- SHA-256 of a 256-bit random token. The token itself is never stored.
  token_hash bytea not null unique check(octet_length(token_hash)=32),
  -- NULL means "always the latest saved version".
  version_number integer check(version_number>0),
  recipient_name text not null default '' check(length(recipient_name)<=120),
  message text not null default '' check(length(message)<=2000),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  decision text check(decision in ('approved','changes_requested')),
  decision_name text check(decision_name is null or length(decision_name) between 1 and 80),
  decided_at timestamptz,
  decided_version integer check(decided_version is null or decided_version>0),
  view_count integer not null default 0 check(view_count>=0),
  last_viewed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(artifact_id,project_id,workspace_id) references public.artifacts(id,project_id,workspace_id) on delete cascade,
  foreign key(artifact_id,version_number) references public.artifact_versions(artifact_id,version_number) on delete cascade,
  check(expires_at>created_at and expires_at<=created_at+interval '90 days'),
  check((decision is null)=(decided_at is null) and (decision is null)=(decision_name is null))
);
create index client_review_links_artifact on public.client_review_links(artifact_id,created_at desc);
create index client_review_links_project on public.client_review_links(project_id);
create index client_review_links_workspace on public.client_review_links(workspace_id);

-- Script-free static HTML of a website version, sanitised by the server
-- before it is stored (the same renderer as publishing).
create table public.client_review_snapshots (
  artifact_id uuid not null,
  version_number integer not null check(version_number>0),
  workspace_id uuid not null,
  html text not null check(octet_length(html) between 100 and 4000000),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(artifact_id,version_number),
  foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade,
  foreign key(artifact_id,version_number) references public.artifact_versions(artifact_id,version_number) on delete cascade
);
create index client_review_snapshots_workspace on public.client_review_snapshots(workspace_id);

create table public.client_review_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  link_id uuid not null,
  version_number integer not null check(version_number>0),
  kind text not null default 'comment' check(kind in ('comment','approved','changes_requested')),
  author_name text not null check(length(author_name) between 1 and 80),
  author_email text not null default '' check(length(author_email)<=254),
  body text not null check(length(body)<=2000 and (kind<>'comment' or length(body)>=1)),
  anchor jsonb not null default '{"kind":"general"}'::jsonb check(jsonb_typeof(anchor)='object' and octet_length(anchor::text)<=1000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(link_id,workspace_id) references public.client_review_links(id,workspace_id) on delete cascade
);
create index client_review_comments_link on public.client_review_comments(link_id,created_at);
create index client_review_comments_workspace on public.client_review_comments(workspace_id,created_at desc);

alter table public.client_review_links enable row level security;
alter table public.client_review_snapshots enable row level security;
alter table public.client_review_comments enable row level security;
revoke all on public.client_review_links,public.client_review_snapshots,public.client_review_comments from public,anon,authenticated;
-- Members never read token hashes or snapshot bodies through the Data API.
grant select(id,workspace_id,project_id,artifact_id,version_number,recipient_name,message,expires_at,revoked_at,decision,decision_name,decided_at,decided_version,view_count,last_viewed_at,created_by,created_at)
  on public.client_review_links to authenticated;
grant select(artifact_id,version_number,workspace_id,created_at) on public.client_review_snapshots to authenticated;
grant select on public.client_review_comments to authenticated;
create policy client_review_links_read on public.client_review_links for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy client_review_snapshots_read on public.client_review_snapshots for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy client_review_comments_read on public.client_review_comments for select to authenticated using(makeborne_private.can_read(workspace_id));
grant select,insert,update,delete on public.client_review_links,public.client_review_snapshots,public.client_review_comments to service_role;

-- ---------------------------------------------------------------------------
-- 3. Private helpers.
-- ---------------------------------------------------------------------------
create function makeborne_private.client_review_token_hash(p_token text) returns bytea
language sql immutable set search_path='' as $$
  select case when p_token ~ '^[A-Za-z0-9_-]{43}$' then pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')) end;
$$;

-- Plain text only: strip control and bidi-override characters, normalise newlines.
create function makeborne_private.client_review_text(p_value text) returns text
language sql immutable set search_path='' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.regexp_replace(coalesce(p_value,''),E'\r\n?',E'\n','g'),
    E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]','','g'),E' \t\n');
$$;

create function makeborne_private.client_review_anchor(p_anchor jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; result jsonb; x numeric; y numeric; label text;
begin
  if p_anchor is null then return '{"kind":"general"}'::jsonb; end if;
  if jsonb_typeof(p_anchor)<>'object' or (p_anchor-array['kind','ref','label','x','y'])<>'{}'::jsonb then
    raise exception 'Invalid comment position' using errcode='22023';
  end if;
  k := p_anchor->>'kind';
  if k='general' then return '{"kind":"general"}'::jsonb; end if;
  if k is null or k not in ('section','point') or jsonb_typeof(p_anchor->'ref') is distinct from 'string'
    or (p_anchor->>'ref') !~ '^[A-Za-z0-9:_.-]{1,100}$'
    or (p_anchor ? 'label' and jsonb_typeof(p_anchor->'label') is distinct from 'string') then
    raise exception 'Invalid comment position' using errcode='22023';
  end if;
  label := pg_catalog.left(makeborne_private.client_review_text(p_anchor->>'label'),160);
  result := jsonb_build_object('kind',k,'ref',p_anchor->>'ref','label',label);
  if k='point' then
    if jsonb_typeof(p_anchor->'x') is distinct from 'number' or jsonb_typeof(p_anchor->'y') is distinct from 'number' then
      raise exception 'Invalid comment position' using errcode='22023';
    end if;
    x := (p_anchor->>'x')::numeric; y := (p_anchor->>'y')::numeric;
    if x<0 or x>1 or y<0 or y>1 then raise exception 'Invalid comment position' using errcode='22023'; end if;
    result := result||jsonb_build_object('x',round(x,4),'y',round(y,4));
  end if;
  return result;
end $$;

-- Explicit actor variant of can_edit for service-role calls and link liveness.
create function makeborne_private.client_review_can_edit_as(p_actor uuid,p_workspace uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspaces w where w.id=p_workspace and w.owner_id=p_actor)
    or exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=p_actor and m.role='editor');
$$;

-- Moves the project's client along the CRM pipeline and records why.
-- Manual stages that are further along (Delivered) or closed (Lost) are kept.
create function makeborne_private.client_review_advance(p_workspace uuid,p_project uuid,p_stage text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_outreach jsonb; v_previous text; v_moved boolean;
begin
  select client_id into v_client from public.projects where id=p_project and workspace_id=p_workspace;
  if v_client is null then return; end if;
  select outreach into v_outreach from public.clients where id=v_client and workspace_id=p_workspace for update;
  if not found then return; end if;
  v_outreach := coalesce(v_outreach,jsonb_build_object('stage','Lead','channel','Not set','profileUrl','','lastContact',null,'nextFollowUp',null,'notes','','activity','[]'::jsonb));
  v_previous := v_outreach->>'stage';
  v_moved := case p_stage
    when 'Review' then v_previous in ('Lead','Contacted','Replied','Meeting','Proposal','Won')
    when 'Delivered' then v_previous in ('Lead','Contacted','Replied','Meeting','Proposal','Won','Review')
    else false end;
  if v_moved then v_outreach := jsonb_set(v_outreach,'{stage}',to_jsonb(p_stage)); end if;
  if jsonb_array_length(v_outreach->'activity')<300 then
    v_outreach := jsonb_set(v_outreach,'{activity}',(v_outreach->'activity')||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'type','update',
      'text',pg_catalog.left(case when v_moved then format('Stage: %s → %s · %s',v_previous,p_stage,p_note) else p_note end,2000))));
  end if;
  update public.clients set outreach=v_outreach where id=v_client and workspace_id=p_workspace;
exception when sqlstate 'MB402' then
  -- A signed-in visitor without a membership cannot trigger CRM writes. The
  -- review record itself is still kept; the freelancer sees it in the studio.
  return;
end $$;

-- Resolves which version a live link shows, and whether it is static HTML.
create function makeborne_private.client_review_target(p_link public.client_review_links,out version_number integer,out html text)
language plpgsql stable security definer set search_path='' as $$
declare v_current integer; v_kind text;
begin
  select a.current_version,a.kind into v_current,v_kind from public.artifacts a where a.id=p_link.artifact_id and a.workspace_id=p_link.workspace_id;
  version_number := coalesce(p_link.version_number,v_current);
  if v_kind='website' then
    select s.version_number,s.html into version_number,html from public.client_review_snapshots s
      where s.artifact_id=p_link.artifact_id and s.workspace_id=p_link.workspace_id
        and (case when p_link.version_number is null then s.version_number<=v_current else s.version_number=p_link.version_number end)
      order by s.version_number desc limit 1;
    if not found then version_number := coalesce(p_link.version_number,v_current); html := null; end if;
  end if;
end $$;

-- Finds a live link by token. Returns the row (locked when p_lock) or raises.
create function makeborne_private.client_review_live_link(p_token text,p_lock boolean) returns public.client_review_links
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype; h bytea := makeborne_private.client_review_token_hash(p_token);
begin
  if h is null then raise exception 'Review link unavailable' using errcode='P0002'; end if;
  if p_lock then select * into r from public.client_review_links where token_hash=h for update;
  else select * into r from public.client_review_links where token_hash=h; end if;
  if not found or r.revoked_at is not null or r.expires_at<=now()
    or not makeborne_private.client_review_can_edit_as(r.created_by,r.workspace_id) then
    raise exception 'Review link unavailable' using errcode='P0002';
  end if;
  return r;
end $$;

create function makeborne_private.client_review_comment_json(c public.client_review_comments) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',c.id,'kind',c.kind,'authorName',c.author_name,'body',c.body,'anchor',c.anchor,
    'version',c.version_number,'createdAt',c.created_at,'resolved',c.resolved_at is not null);
$$;

-- ---------------------------------------------------------------------------
-- 4. Public (anon) functions: read, comment, decide. Token in, hash compared.
-- ---------------------------------------------------------------------------
create function public.makeborne_read_client_review(p_token text) returns jsonb
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
    v_content := v.content-'websiteSource'-'website'-'reviewQuestions';
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

create function public.makeborne_add_client_review_comment(p_token text,p_name text,p_email text,p_body text,p_anchor jsonb) returns jsonb
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
  select * into t from makeborne_private.client_review_target(r);
  insert into public.client_review_comments(workspace_id,link_id,version_number,kind,author_name,author_email,body,anchor)
  values(r.workspace_id,r.id,t.version_number,'comment',v_name,v_email,v_body,v_anchor) returning * into c;
  return makeborne_private.client_review_comment_json(c);
end $$;

create function public.makeborne_decide_client_review(p_token text,p_name text,p_email text,p_decision text,p_note text) returns jsonb
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
  select * into t from makeborne_private.client_review_target(r);
  update public.client_review_links set decision=p_decision,decision_name=v_name,decided_at=now(),decided_version=t.version_number where id=r.id;
  insert into public.client_review_comments(workspace_id,link_id,version_number,kind,author_name,author_email,body,anchor)
  values(r.workspace_id,r.id,t.version_number,p_decision,v_name,v_email,v_note,'{"kind":"general"}') returning * into c;
  select title into v_title from public.artifacts where id=r.artifact_id;
  -- CRM side effects are best effort: the decision itself is the record.
  begin
    if p_decision='approved' then
      update public.projects set status='approved' where id=r.project_id and workspace_id=r.workspace_id and status in ('draft','in_progress','review');
    else
      update public.projects set status='in_progress' where id=r.project_id and workspace_id=r.workspace_id and status in ('draft','review','approved');
    end if;
  exception when sqlstate 'MB402' then null;
  end;
  perform makeborne_private.client_review_advance(r.workspace_id,r.project_id,case when p_decision='approved' then 'Delivered' end,
    format('%s %s “%s” (version %s) via review link',v_name,case when p_decision='approved' then 'approved' else 'requested changes to' end,v_title,t.version_number));
  return jsonb_build_object('decision',jsonb_build_object('value',p_decision,'name',v_name,'at',now(),'version',t.version_number),
    'comment',makeborne_private.client_review_comment_json(c));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Freelancer functions.
-- ---------------------------------------------------------------------------
-- Service role only: the server generates the token, sanitises any website
-- snapshot, and passes the verified actor (same pattern as hosted sites).
create function public.makeborne_create_client_review_link(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_latest boolean,
  p_token_hash bytea,p_days integer,p_recipient text,p_message text,p_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.artifacts%rowtype; r public.client_review_links%rowtype; v_content jsonb;
  v_recipient text := pg_catalog.left(makeborne_private.client_review_text(p_recipient),120);
  v_message text := makeborne_private.client_review_text(p_message);
begin
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null and deleted_at is null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if not makeborne_private.client_review_can_edit_as(p_actor,p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found then raise exception 'Artifact not found' using errcode='P0002'; end if;
  if p_version is null or p_version<1 or p_version>a.current_version or (p_latest and p_version<>a.current_version) then
    raise exception 'Save the latest version before sharing' using errcode='PT409';
  end if;
  select content into v_content from public.artifact_versions where artifact_id=p_artifact and workspace_id=p_workspace and version_number=p_version;
  if not found then raise exception 'Version not found' using errcode='P0002'; end if;
  if p_token_hash is null or octet_length(p_token_hash)<>32 or p_days is null or p_days not between 1 and 90
    or p_latest is null or length(v_message)>2000 then
    raise exception 'Invalid review link' using errcode='22023';
  end if;
  if (v_content ? 'websiteSource' or v_content ? 'website') and p_html is null
    and not exists(select 1 from public.client_review_snapshots where artifact_id=p_artifact and version_number=p_version) then
    raise exception 'Website review copy required' using errcode='22023';
  end if;
  if (select count(*) from public.client_review_links where artifact_id=p_artifact and revoked_at is null and expires_at>now())>=20
    or (select count(*) from public.client_review_links where workspace_id=p_workspace and revoked_at is null and expires_at>now())>=200
    or (select count(*) from public.client_review_links where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=60 then
    raise exception 'Review link limit reached. Revoke older links first.' using errcode='MB429';
  end if;
  if p_html is not null then
    if a.kind<>'website' or octet_length(p_html) not between 100 and 4000000 then raise exception 'Invalid review copy' using errcode='22023'; end if;
    insert into public.client_review_snapshots(artifact_id,version_number,workspace_id,html,created_by)
    values(p_artifact,p_version,p_workspace,p_html,p_actor)
    on conflict(artifact_id,version_number) do update set html=excluded.html,created_by=excluded.created_by,created_at=now();
  end if;
  insert into public.client_review_links(workspace_id,project_id,artifact_id,token_hash,version_number,recipient_name,message,expires_at,created_by)
  values(p_workspace,a.project_id,p_artifact,p_token_hash,case when p_latest then null else p_version end,v_recipient,v_message,now()+make_interval(days=>p_days),p_actor)
  returning * into r;
  update public.projects set status='review' where id=a.project_id and workspace_id=p_workspace and status in ('draft','in_progress','approved');
  perform makeborne_private.client_review_advance(p_workspace,a.project_id,'Review',format('Review link sent for “%s” (%s)',a.title,
    case when p_latest then 'latest version' else 'version '||p_version end));
  return to_jsonb(r)-'token_hash';
end $$;

create function public.makeborne_save_client_review_snapshot(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.artifacts%rowtype;
begin
  if p_actor is null or not makeborne_private.client_review_can_edit_as(p_actor,p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
  if not found or a.kind<>'website' then raise exception 'Website not found' using errcode='P0002'; end if;
  if p_version is distinct from a.current_version then raise exception 'Save the latest version first' using errcode='PT409'; end if;
  if p_html is null or octet_length(p_html) not between 100 and 4000000 then raise exception 'Invalid review copy' using errcode='22023'; end if;
  insert into public.client_review_snapshots(artifact_id,version_number,workspace_id,html,created_by)
  values(p_artifact,p_version,p_workspace,p_html,p_actor)
  on conflict(artifact_id,version_number) do update set html=excluded.html,created_by=excluded.created_by,created_at=now();
  return jsonb_build_object('artifactId',p_artifact,'version',p_version);
end $$;

-- Authenticated editors: revoke a link, mark a comment resolved.
create function public.makeborne_revoke_client_review_link(p_workspace uuid,p_link uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_review_links%rowtype;
begin
  if not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  update public.client_review_links set revoked_at=coalesce(revoked_at,now()) where id=p_link and workspace_id=p_workspace returning * into r;
  if not found then raise exception 'Review link not found' using errcode='P0002'; end if;
  return to_jsonb(r)-'token_hash';
end $$;

create function public.makeborne_resolve_client_review_comment(p_workspace uuid,p_comment uuid,p_resolved boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.client_review_comments%rowtype;
begin
  if not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if p_resolved is null then raise exception 'Choose resolved or open' using errcode='22023'; end if;
  update public.client_review_comments set resolved_at=case when p_resolved then coalesce(resolved_at,now()) end,
    resolved_by=case when p_resolved then coalesce(resolved_by,(select auth.uid())) end
  where id=p_comment and workspace_id=p_workspace returning * into c;
  if not found then raise exception 'Comment not found' using errcode='P0002'; end if;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Exposure. Helpers stay private; the public functions above are the surface.
-- ---------------------------------------------------------------------------
revoke all on function makeborne_private.client_review_token_hash(text) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_text(text) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_anchor(jsonb) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_can_edit_as(uuid,uuid) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_advance(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_target(public.client_review_links) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_live_link(text,boolean) from public,anon,authenticated;
revoke all on function makeborne_private.client_review_comment_json(public.client_review_comments) from public,anon,authenticated;
revoke all on function public.makeborne_read_client_review(text) from public,anon,authenticated;
revoke all on function public.makeborne_add_client_review_comment(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.makeborne_decide_client_review(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.makeborne_create_client_review_link(uuid,uuid,uuid,integer,boolean,bytea,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.makeborne_save_client_review_snapshot(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.makeborne_revoke_client_review_link(uuid,uuid) from public,anon,authenticated;
revoke all on function public.makeborne_resolve_client_review_comment(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.makeborne_read_client_review(text) to anon,authenticated,service_role;
grant execute on function public.makeborne_add_client_review_comment(text,text,text,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.makeborne_decide_client_review(text,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.makeborne_create_client_review_link(uuid,uuid,uuid,integer,boolean,bytea,integer,text,text,text) to service_role;
grant execute on function public.makeborne_save_client_review_snapshot(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.makeborne_revoke_client_review_link(uuid,uuid) to authenticated,service_role;
grant execute on function public.makeborne_resolve_client_review_comment(uuid,uuid,boolean) to authenticated,service_role;
commit;
