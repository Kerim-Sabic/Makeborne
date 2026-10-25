-- "Understand this client" (agency workflow stage 4). Additive only: two new
-- tables and their service-role entry points; no existing table, policy, grant
-- or function changes.
--
-- * client_research_pages: a tenant-scoped cache of public pages read for one
--   client (workspace + client + requested URL). It holds what was extracted
--   from the page (bounded JSON: title, description, headings, text, signals),
--   never the raw HTML, plus the sha256 of the bytes that were read, when they
--   were read and until when the copy may be reused. A failed read is cached
--   for a short time with its reason (blocked, private, robots, timeout,
--   too_large, login, not_found, not_html, redirects, invalid, error) so
--   repeated requests do not hammer a site. Rows of one client are never
--   visible to, or reused by, another client or another workspace.
-- * client_research_briefs: the cited research brief a user action produced,
--   keyed by that action's key (one action = one brief; a repeated request
--   returns the stored brief and makes no new fetch or charge). The brief is
--   data for the person to review: nothing here writes client knowledge,
--   plans, projects or outreach.
--
-- Writes happen ONLY through the service entry points below, which take the
-- acting account and re-check its CURRENT role (owner/editor write; any member
-- reads) using the stage 3 knowledge_require rule. Members read their
-- workspace's rows under RLS; nobody writes the tables directly.
begin;

create table public.client_research_pages (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid not null,
 url text not null check(length(url) between 8 and 2048 and url ~ '^https?://'),
 final_url text check(final_url is null or (length(final_url) between 8 and 2048 and final_url ~ '^https?://')),
 status text not null check(status in ('ok','inaccessible')),
 reason text check(reason is null or reason in ('blocked','private','robots','timeout','too_large','login','not_found','not_html','redirects','invalid','error')),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer not null default 0 check(bytes between 0 and 2000000),
 page jsonb not null default '{}' check(jsonb_typeof(page)='object' and octet_length(page::text)<=65536),
 extractor_version text not null check(extractor_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
 fetched_at timestamptz not null,
 expires_at timestamptz not null,
 fetched_by uuid not null,
 check(expires_at>fetched_at and expires_at<=fetched_at+interval '30 days'),
 check((status='ok' and sha256 is not null and reason is null) or (status='inaccessible' and reason is not null)),
 unique(workspace_id,client_id,url),
 foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade
);
create index client_research_pages_expiry on public.client_research_pages(workspace_id,client_id,expires_at);
comment on table public.client_research_pages is 'Tenant-scoped cache of public pages read for one client (extracted text and signals, sha256, fetched_at, expires_at; failed reads with their reason). Never shared across clients or workspaces.';

create table public.client_research_briefs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid not null,
 -- The client project the brief is kept with (required for assisted research, which runs on that artifact's operation).
 artifact_id uuid,
 action_key uuid not null,
 operation_id uuid,
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 method text not null check(method in ('deterministic','assisted')),
 brief jsonb not null check(jsonb_typeof(brief)='object' and octet_length(brief::text)<=262144),
 brief_sha256 text not null check(brief_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,action_key),
 check((method='assisted')=(operation_id is not null)),
 check(operation_id is null or artifact_id is not null),
 foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade,
 foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade
);
create index client_research_briefs_client on public.client_research_briefs(workspace_id,client_id,created_at desc);
comment on table public.client_research_briefs is 'Cited research briefs, one per user action key. Data for review only: nothing here writes knowledge, plans or outreach.';

-- ---------- entry points ----------
create function makeborne_private.research_pages_read(p_actor uuid,p_workspace uuid,p_client uuid,p_urls text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,false);
 if p_urls is null or cardinality(p_urls)>40 then raise exception 'Invalid page list' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('url',r.url,'finalUrl',r.final_url,'status',r.status,'reason',r.reason,'sha256',r.sha256,'bytes',r.bytes,
   'page',r.page,'extractorVersion',r.extractor_version,'fetchedAt',r.fetched_at,'expiresAt',r.expires_at,'expired',r.expires_at<=now()) order by r.url)
  from public.client_research_pages r where r.workspace_id=p_workspace and r.client_id=p_client and r.url=any(p_urls)),'[]'::jsonb);
end $$;

create function makeborne_private.research_page_put(p_actor uuid,p_workspace uuid,p_client uuid,p_page jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.client_research_pages; v_fetched timestamptz; v_expires timestamptz;
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,true);
 if p_page is null or jsonb_typeof(p_page)<>'object' then raise exception 'Invalid page' using errcode='22023'; end if;
 begin v_fetched:=(p_page->>'fetchedAt')::timestamptz; v_expires:=(p_page->>'expiresAt')::timestamptz;
 exception when others then raise exception 'Invalid page dates' using errcode='22023'; end;
 if v_fetched is null or v_fetched>now()+interval '5 minutes' then raise exception 'Invalid page dates' using errcode='22023'; end if;
 insert into public.client_research_pages(workspace_id,client_id,url,final_url,status,reason,sha256,bytes,page,extractor_version,fetched_at,expires_at,fetched_by)
 values(p_workspace,p_client,p_page->>'url',nullif(p_page->>'finalUrl',''),p_page->>'status',nullif(p_page->>'reason',''),nullif(p_page->>'sha256',''),
  coalesce((p_page->>'bytes')::integer,0),coalesce(p_page->'page','{}'::jsonb),p_page->>'extractorVersion',v_fetched,v_expires,p_actor)
 on conflict(workspace_id,client_id,url) do update set final_url=excluded.final_url,status=excluded.status,reason=excluded.reason,sha256=excluded.sha256,
  bytes=excluded.bytes,page=excluded.page,extractor_version=excluded.extractor_version,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,fetched_by=excluded.fetched_by
  -- An older read never replaces a newer one.
  where public.client_research_pages.fetched_at<=excluded.fetched_at
 returning * into r;
 if r.id is null then select * into r from public.client_research_pages where workspace_id=p_workspace and client_id=p_client and url=p_page->>'url'; end if;
 return jsonb_build_object('url',r.url,'fetchedAt',r.fetched_at,'expiresAt',r.expires_at,'status',r.status);
end $$;

create function makeborne_private.research_brief_json(b public.client_research_briefs,p_replayed boolean) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'clientId',b.client_id,'artifactId',b.artifact_id,'actionKey',b.action_key,'operationId',b.operation_id,'method',b.method,
  'brief',b.brief,'briefSha256',b.brief_sha256,'createdAt',b.created_at,'replayed',p_replayed);
$$;

create function makeborne_private.research_brief_save(p_actor uuid,p_workspace uuid,p_client uuid,p_artifact uuid,p_action uuid,p_operation uuid,
 p_request_sha256 text,p_method text,p_brief jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.client_research_briefs; o makeborne_private.ai_operations;
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,true);
 if p_action is null then raise exception 'Invalid action' using errcode='22023'; end if;
 -- One action, one brief: a repeat with the same request returns the stored brief.
 perform pg_advisory_xact_lock(hashtextextended('research:'||p_workspace::text||'/'||p_action::text,0));
 select * into b from public.client_research_briefs where workspace_id=p_workspace and action_key=p_action;
 if found then
  if b.client_id is distinct from p_client or b.request_sha256 is distinct from p_request_sha256 or b.created_by is distinct from p_actor then
   raise exception 'This action key was used for a different request' using errcode='PT409'; end if;
  return makeborne_private.research_brief_json(b,true);
 end if;
 -- The anchor artifact, when given, must belong to a project of this client.
 if p_artifact is not null and not exists(select 1 from public.artifacts a join public.projects p on p.id=a.project_id and p.workspace_id=a.workspace_id
   where a.id=p_artifact and a.workspace_id=p_workspace and p.client_id=p_client) then raise exception 'Project outside this client' using errcode='42501'; end if;
 if p_operation is not null then
  select * into o from makeborne_private.ai_operations where id=p_operation;
  if not found or o.actor is distinct from p_actor or o.workspace_id is distinct from p_workspace or o.artifact_id is distinct from p_artifact or o.kind<>'research' then
   raise exception 'Operation unavailable' using errcode='42501'; end if;
 end if;
 if p_brief is null or jsonb_typeof(p_brief)<>'object' or p_method is null or p_method not in ('deterministic','assisted') then raise exception 'Invalid brief' using errcode='22023'; end if;
 insert into public.client_research_briefs(workspace_id,client_id,artifact_id,action_key,operation_id,request_sha256,method,brief,brief_sha256,created_by)
 values(p_workspace,p_client,p_artifact,p_action,p_operation,p_request_sha256,p_method,p_brief,encode(sha256(convert_to(p_brief::text,'UTF8')),'hex'),p_actor) returning * into b;
 insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome,metadata)
 values(p_workspace,p_actor,'research.brief_saved',b.id,'saved',jsonb_build_object('client',p_client,'method',p_method));
 return makeborne_private.research_brief_json(b,false);
end $$;

create function makeborne_private.research_brief_read(p_actor uuid,p_workspace uuid,p_client uuid,p_brief uuid,p_action uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.client_research_briefs;
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,false);
 if (p_brief is null)=(p_action is null) then raise exception 'Choose one brief' using errcode='22023'; end if;
 select * into b from public.client_research_briefs where workspace_id=p_workspace and client_id=p_client
  and ((p_brief is not null and id=p_brief) or (p_action is not null and action_key=p_action));
 if not found then return null; end if;
 return makeborne_private.research_brief_json(b,true);
end $$;

-- ---------- access ----------
alter table public.client_research_pages enable row level security;
alter table public.client_research_briefs enable row level security;
revoke all on public.client_research_pages,public.client_research_briefs from public,anon,authenticated,service_role;
grant select on public.client_research_pages,public.client_research_briefs to authenticated,service_role;
create policy research_member_read on public.client_research_pages for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy research_member_read on public.client_research_briefs for select to authenticated using(makeborne_private.can_read(workspace_id));

create function public.makeborne_research_pages_read(p_actor uuid,p_workspace uuid,p_client uuid,p_urls text[]) returns jsonb
 language sql stable security invoker set search_path='' as $$ select makeborne_private.research_pages_read(p_actor,p_workspace,p_client,p_urls); $$;
create function public.makeborne_research_page_put(p_actor uuid,p_workspace uuid,p_client uuid,p_page jsonb) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.research_page_put(p_actor,p_workspace,p_client,p_page); $$;
create function public.makeborne_research_brief_save(p_actor uuid,p_workspace uuid,p_client uuid,p_artifact uuid,p_action uuid,p_operation uuid,
 p_request_sha256 text,p_method text,p_brief jsonb) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.research_brief_save(p_actor,p_workspace,p_client,p_artifact,p_action,p_operation,p_request_sha256,p_method,p_brief); $$;
create function public.makeborne_research_brief_read(p_actor uuid,p_workspace uuid,p_client uuid,p_brief uuid default null,p_action uuid default null) returns jsonb
 language sql stable security invoker set search_path='' as $$ select makeborne_private.research_brief_read(p_actor,p_workspace,p_client,p_brief,p_action); $$;

-- New functions default to PUBLIC execute: close every one, then open only the
-- service entry points and the private bodies they call.
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='makeborne_private' and p.proname like 'research\_%') or (n.nspname='public' and p.proname like 'makeborne\_research\_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
 end loop;
end $$;
grant execute on function
 makeborne_private.research_pages_read(uuid,uuid,uuid,text[]), makeborne_private.research_page_put(uuid,uuid,uuid,jsonb),
 makeborne_private.research_brief_json(public.client_research_briefs,boolean),
 makeborne_private.research_brief_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb), makeborne_private.research_brief_read(uuid,uuid,uuid,uuid,uuid),
 public.makeborne_research_pages_read(uuid,uuid,uuid,text[]), public.makeborne_research_page_put(uuid,uuid,uuid,jsonb),
 public.makeborne_research_brief_save(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb), public.makeborne_research_brief_read(uuid,uuid,uuid,uuid,uuid)
 to service_role;

commit;
