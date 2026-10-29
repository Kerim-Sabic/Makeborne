-- Approved client knowledge (agency workflow stage 3). Additive only: no
-- existing table, policy, grant or function changes; two AFTER triggers are
-- added on public.sources / public.assets / public.projects to keep evidence
-- honest when a source changes, is revoked or is deleted.
--
-- * client_facts: one fact per row, scoped to a workspace AND a client, with a
--   kind that keeps observed facts, model inferences, user decisions and brand
--   preferences distinct; status proposed | approved | rejected | superseded;
--   validity window, observation time, conflict group, uncertainty note,
--   approval/rejection actor and time, and a revision for compare-and-swap.
-- * client_fact_evidence: where a fact came from: a project source (sha256 of
--   its content), an uploaded asset (sha256 of its bytes; ingestion records),
--   a public page (url + fetched_at + sha256), a project brief, an explicit
--   user statement, or a generated artifact version. Locators point at a page,
--   slide, sheet!cell, paragraph or character range plus an extraction version.
--   A generated artifact may only support an INFERENCE: it can never be the
--   evidence for an observed fact (no output becomes proof of its own claims).
-- * client_fact_revisions: append-only value history, so a snapshot made for a
--   task can be explained later even after the fact changed.
-- * knowledge_snapshots: immutable per task/operation record of the exact fact
--   ids, revisions, evidence ids and source versions that were used.
-- * client_knowledge_state: a per-client epoch, bumped by every change that can
--   affect retrieval. Derived caches key on it and are invalid when it moves.
--
-- Writes happen ONLY through service-role entry points that take the acting
-- account and re-check its CURRENT role on every call (owner/editor write,
-- reviewer read-only, removed member nothing), so a permission change during a
-- run takes effect on the next write. System (task) proposals are bound to an
-- agency operation of that actor and can only ever be 'proposed'; nothing here
-- approves automatically, and nothing reads chat history.
--
-- Source lifecycle (audit retention decision, documented in docs/AGENT_HANDOFF.md):
-- * content changed -> evidence 'stale' (fact leaves retrieval until reviewed;
--   the old quote is kept so a reviewer can compare);
-- * approval withdrawn (sources.approved true -> false) or knowledge_revoke_source
--   -> evidence 'revoked', quote removed;
-- * source/asset deleted -> evidence 'revoked', quote removed, and a fact left
--   with no supporting evidence and no user statement has its value removed from
--   the fact and from its revision history ('[removed with its source]').
-- What is retained for audit: ids, kinds, keys, statuses, actors, timestamps,
-- sha256 digests, extraction versions and locators; never revoked content.
-- Retrieval is plain Postgres full-text search ('simple' config, no extension);
-- embeddings are intentionally not added (no retrieval evaluation yet). The
-- retrieval entry point returns candidates; ranking can be fused later.
begin;

create table public.client_facts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid not null,
 kind text not null check(kind in ('observed_fact','inference','user_decision','brand_preference')),
 key text not null check(length(key) between 1 and 120 and key ~ '^[a-z0-9]+([._][a-z0-9]+)*$'),
 label text not null default '' check(length(label)<=200),
 value jsonb check(value is null or octet_length(value::text)<=4000),
 value_text text not null check(length(value_text) between 1 and 2000),
 unit text check(unit is null or length(unit) between 1 and 16),
 currency text check(currency is null or currency ~ '^[A-Z]{3}$'),
 value_identity text generated always as (
  coalesce('json:'||(nullif(value,'null'::jsonb))::text,'text:'||lower(regexp_replace(btrim(value_text),'\s+',' ','g')))||'|'||coalesce(currency,'')||'|'||coalesce(unit,'')) stored,
 valid_from date, valid_to date,
 observed_at timestamptz,
 status text not null default 'proposed' check(status in ('proposed','approved','rejected','superseded')),
 supersedes_id uuid, superseded_by uuid,
 conflict_group uuid,
 uncertainty text check(uncertainty is null or length(uncertainty)<=1000),
 evidence_state text not null default 'live' check(evidence_state in ('live','stale','revoked')),
 created_by uuid not null,
 created_via text not null check(created_via in ('user','system')),
 operation_id uuid,
 approved_by uuid, approved_at timestamptz,
 rejected_by uuid, rejected_at timestamptz, review_note text check(review_note is null or length(review_note)<=1000),
 redacted_at timestamptz,
 revision integer not null default 1 check(revision>=1),
 search tsvector generated always as (to_tsvector('simple'::regconfig, replace(replace(key,'.',' '),'_',' ')||' '||label||' '||value_text)) stored,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,workspace_id),
 foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade,
 check(valid_to is null or valid_from is null or valid_to>=valid_from),
 check((created_via='system')=(operation_id is not null)),
 check(created_via='user' or kind in ('observed_fact','inference','brand_preference')),
 check(status<>'approved' or (approved_by is not null and approved_at is not null)),
 check(status<>'rejected' or (rejected_by is not null and rejected_at is not null)),
 check(supersedes_id is null or supersedes_id<>id)
);
create index client_facts_client_key on public.client_facts(workspace_id,client_id,key);
create index client_facts_client_status on public.client_facts(workspace_id,client_id,status);
create index client_facts_conflict on public.client_facts(conflict_group) where conflict_group is not null;
create index client_facts_search on public.client_facts using gin(search);

create table public.client_fact_evidence (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 client_id uuid not null,
 fact_id uuid not null,
 kind text not null check(kind in ('source','asset','url','brief','user','artifact_version')),
 -- source/asset/artifact_version id, or the project id for a brief. No FK: the
 -- id is retained as audit after the referenced row is deleted.
 ref_id uuid,
 project_id uuid,
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 extraction_version text check(extraction_version is null or extraction_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
 locator jsonb not null default '{}' check(jsonb_typeof(locator)='object' and octet_length(locator::text)<=2000),
 quote text check(quote is null or length(quote)<=600),
 url text check(url is null or (length(url)<=2048 and url ~ '^https?://')),
 fetched_at timestamptz,
 stated_by uuid,
 supports boolean not null default true,
 state text not null default 'live' check(state in ('live','stale','revoked')),
 revoked_at timestamptz,
 revoked_reason text check(revoked_reason is null or revoked_reason in ('source_deleted','source_revoked','manual')),
 created_at timestamptz not null default now(),
 foreign key(fact_id,workspace_id) references public.client_facts(id,workspace_id) on delete cascade,
 check(kind not in ('source','asset','artifact_version','brief') or (ref_id is not null and project_id is not null and sha256 is not null)),
 check(kind<>'url' or (url is not null and fetched_at is not null and sha256 is not null)),
 check(kind<>'user' or (stated_by is not null and quote is not null)),
 check(state<>'revoked' or (revoked_at is not null and revoked_reason is not null))
);
create index client_fact_evidence_fact on public.client_fact_evidence(fact_id);
create index client_fact_evidence_ref on public.client_fact_evidence(kind,ref_id) where ref_id is not null;
create index client_fact_evidence_url on public.client_fact_evidence(workspace_id,url) where url is not null;

create table public.client_fact_revisions (
 fact_id uuid not null,
 workspace_id uuid not null,
 revision integer not null check(revision>=1),
 action text not null check(action in ('proposed','approved','rejected','corrected','superseded','redacted')),
 kind text not null, key text not null, status text not null,
 value jsonb, value_text text not null, unit text, currency text, valid_from date, valid_to date,
 actor uuid not null,
 note text check(note is null or length(note)<=1000),
 redacted_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(fact_id,revision),
 foreign key(fact_id,workspace_id) references public.client_facts(id,workspace_id) on delete cascade
);

create table public.knowledge_snapshots (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid not null,
 operation_id uuid,
 artifact_id uuid,
 purpose text not null check(purpose ~ '^[a-z][a-z0-9_]{1,39}$'),
 query text not null default '' check(length(query)<=1000),
 as_of date not null,
 epoch bigint not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=100 and octet_length(items::text)<=200000),
 context_sha256 text not null check(context_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade
);
create index knowledge_snapshots_client on public.knowledge_snapshots(workspace_id,client_id,created_at desc);
create index knowledge_snapshots_operation on public.knowledge_snapshots(operation_id) where operation_id is not null;

create table public.client_knowledge_state (
 workspace_id uuid not null,
 client_id uuid not null,
 epoch bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,client_id),
 foreign key(client_id,workspace_id) references public.clients(id,workspace_id) on delete cascade
);

comment on table public.client_facts is 'Client knowledge: one fact per row (observed fact, inference, user decision or brand preference) with status, validity, conflict group and approval. Written only through makeborne_knowledge_* service entry points.';
comment on table public.client_fact_evidence is 'Where a client fact came from (source/asset sha256 + extraction version + locator, url, brief, user statement, or a generated artifact for inferences only). Quotes are removed when a source is revoked or deleted; ids, digests and locators are retained for audit.';
comment on table public.client_fact_revisions is 'Append-only value history of client facts; values are removed only when the fact''s only source was deleted.';
comment on table public.knowledge_snapshots is 'Immutable record of the exact facts, revisions and source versions given to one task.';
comment on table public.client_knowledge_state is 'Per-client knowledge epoch; any change that can affect retrieval increments it. Derived caches must compare it at read.';

-- ---------- helpers ----------
create function makeborne_private.knowledge_role(p_actor uuid,p_workspace uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when p_actor is null or p_workspace is null then null
  when exists(select 1 from public.workspaces w where w.id=p_workspace and w.owner_id=p_actor) then 'owner'
  else (select m.role from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=p_actor) end;
$$;

-- Current role, checked on every call. Missing client and missing membership
-- look the same to a non-member.
create function makeborne_private.knowledge_require(p_actor uuid,p_workspace uuid,p_client uuid,p_write boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare r text:=makeborne_private.knowledge_role(p_actor,p_workspace);
begin
 if r is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_write and r not in ('owner','editor') then raise exception 'Editor permission required' using errcode='42501'; end if;
 if p_client is null or not exists(select 1 from public.clients c where c.id=p_client and c.workspace_id=p_workspace) then
  raise exception 'Client unavailable' using errcode='P0002'; end if;
 return r;
end $$;

create function makeborne_private.knowledge_overlaps(a_from date,a_to date,b_from date,b_to date) returns boolean
language sql immutable set search_path='' as $$ select daterange(a_from,a_to,'[]') && daterange(b_from,b_to,'[]'); $$;

-- Business truth that must be approved before any task may use it.
create function makeborne_private.knowledge_sensitive_key(p_key text) returns boolean
language sql immutable set search_path='' as $$
 select p_key ~ '^(price|pricing|fee|opening_hours|hours|contact|phone|email|address|legal|licen[cs]e|certification|award|guarantee|warranty|offer|discount|claim|stat)s?([._]|$)';
$$;

create function makeborne_private.knowledge_bump(p_workspace uuid,p_client uuid) returns void
language sql security definer set search_path='' as $$
 -- During a cascaded client/workspace delete the client is already gone: skip.
 insert into public.client_knowledge_state(workspace_id,client_id,epoch)
 select p_workspace,p_client,1 where exists(select 1 from public.clients c where c.id=p_client and c.workspace_id=p_workspace)
 on conflict(workspace_id,client_id) do update set epoch=public.client_knowledge_state.epoch+1,updated_at=now();
$$;

create function makeborne_private.knowledge_touch() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform makeborne_private.knowledge_bump(old.workspace_id,old.client_id); return old; end if;
 perform makeborne_private.knowledge_bump(new.workspace_id,new.client_id);
 if tg_op='UPDATE' and (new.workspace_id,new.client_id) is distinct from (old.workspace_id,old.client_id) then
  raise exception 'Knowledge scope is immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger client_facts_epoch after insert or update or delete on public.client_facts for each row execute function makeborne_private.knowledge_touch();
create trigger client_fact_evidence_epoch after insert or update or delete on public.client_fact_evidence for each row execute function makeborne_private.knowledge_touch();

-- Revisions and snapshots are immutable; only the source-deletion redaction may
-- clear a revision's value (and nothing else).
create function makeborne_private.knowledge_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='client_fact_revisions' and coalesce(current_setting('makeborne.knowledge_redact',true),'')='on' then
  if new.value is null and new.redacted_at is not null
   and (new.fact_id,new.revision,new.action,new.kind,new.key,new.status,new.actor,new.created_at)=(old.fact_id,old.revision,old.action,old.kind,old.key,old.status,old.actor,old.created_at) then
   return new; end if;
 end if;
 raise exception 'Knowledge history is immutable' using errcode='23514';
end $$;
create trigger client_fact_revisions_immutable before update on public.client_fact_revisions for each row execute function makeborne_private.knowledge_immutable();
create trigger knowledge_snapshots_immutable before update on public.knowledge_snapshots for each row execute function makeborne_private.knowledge_immutable();

create function makeborne_private.knowledge_record(f public.client_facts,p_action text,p_actor uuid,p_note text) returns void
language sql security definer set search_path='' as $$
 insert into public.client_fact_revisions(fact_id,workspace_id,revision,action,kind,key,status,value,value_text,unit,currency,valid_from,valid_to,actor,note)
 values(f.id,f.workspace_id,f.revision,p_action,f.kind,f.key,f.status,f.value,f.value_text,f.unit,f.currency,f.valid_from,f.valid_to,p_actor,left(p_note,1000));
 insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome,metadata)
 values(f.workspace_id,p_actor,'knowledge.'||p_action,f.id,f.status,jsonb_build_object('clientId',f.client_id,'revision',f.revision,'kind',f.kind,'key',f.key,'via',f.created_via));
$$;

create function makeborne_private.knowledge_refresh(p_fact uuid) returns text
language sql security definer set search_path='' as $$
 update public.client_facts f set evidence_state=case
  when exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='live') then 'live'
  when exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='stale') then 'stale'
  else 'revoked' end
 where f.id=p_fact and f.evidence_state is distinct from case
  when exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='live') then 'live'
  when exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='stale') then 'stale'
  else 'revoked' end
 returning evidence_state;
$$;

-- Another fact the given one contradicts: same client and key, overlapping
-- validity, a different value, still proposed or approved.
create function makeborne_private.knowledge_conflicts(f public.client_facts,p_statuses text[]) returns setof public.client_facts
language sql stable security definer set search_path='' as $$
 select g.* from public.client_facts g where g.workspace_id=f.workspace_id and g.client_id=f.client_id and g.key=f.key and g.id<>f.id
  and g.status=any(p_statuses) and g.value_identity<>f.value_identity and g.redacted_at is null
  and makeborne_private.knowledge_overlaps(f.valid_from,f.valid_to,g.valid_from,g.valid_to);
$$;

-- ---------- evidence ----------
create function makeborne_private.knowledge_add_evidence(f public.client_facts,e jsonb,p_actor uuid,p_system boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_kind text; v_ref uuid; v_project uuid; v_client uuid; v_ws uuid; v_sha text; v_given text; v_quote text; v_loc jsonb; v_id uuid; k text;
begin
 if jsonb_typeof(e)<>'object' then raise exception 'Invalid evidence' using errcode='22023'; end if;
 v_kind:=e->>'kind'; v_given:=e->>'sha256'; v_loc:=coalesce(e->'locator','{}'::jsonb); v_quote:=nullif(btrim(e->>'quote'),'');
 if v_kind is null or v_kind not in ('source','asset','url','brief','user','artifact_version') then raise exception 'Invalid evidence kind' using errcode='22023'; end if;
 if jsonb_typeof(v_loc)<>'object' or octet_length(v_loc::text)>2000 then raise exception 'Invalid locator' using errcode='22023'; end if;
 for k in select jsonb_object_keys(v_loc) loop
  if k not in ('page','slide','sheet','cell','range','paragraph','line','charStart','charEnd','section','label') then raise exception 'Invalid locator field' using errcode='22023'; end if;
 end loop;
 if v_quote is not null and length(v_quote)>600 then raise exception 'Quote too long' using errcode='22023'; end if;
 if e ? 'refId' and coalesce(e->>'refId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid evidence reference' using errcode='22023'; end if;
 v_ref:=(e->>'refId')::uuid;
 -- A generated artifact is never evidence for anything but an inference.
 if v_kind='artifact_version' and f.kind<>'inference' then
  raise exception 'A generated artifact can only support an inference' using errcode='22023'; end if;
 -- The system may not speak for a person: user statements come only from that person.
 if v_kind='user' and p_system then raise exception 'A task cannot record a user statement' using errcode='42501'; end if;
 if v_kind='source' then
  select s.workspace_id,s.project_id,p.client_id,encode(sha256(convert_to(s.content,'UTF8')),'hex') into v_ws,v_project,v_client,v_sha
   from public.sources s join public.projects p on p.id=s.project_id and p.workspace_id=s.workspace_id where s.id=v_ref;
 elsif v_kind='asset' then
  select s.workspace_id,s.project_id,p.client_id,s.sha256 into v_ws,v_project,v_client,v_sha
   from public.assets s join public.projects p on p.id=s.project_id and p.workspace_id=s.workspace_id where s.id=v_ref;
 elsif v_kind='brief' then
  select p.workspace_id,p.id,p.client_id,encode(sha256(convert_to(p.brief,'UTF8')),'hex') into v_ws,v_project,v_client,v_sha from public.projects p where p.id=v_ref;
 elsif v_kind='artifact_version' then
  select v.workspace_id,a.project_id,p.client_id,encode(sha256(convert_to(v.content::text,'UTF8')),'hex') into v_ws,v_project,v_client,v_sha
   from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.workspace_id=v.workspace_id
   join public.projects p on p.id=a.project_id and p.workspace_id=a.workspace_id where v.id=v_ref;
 end if;
 if v_kind in ('source','asset','brief','artifact_version') then
  -- Missing, foreign-workspace and other-client rows are indistinguishable.
  if v_ws is distinct from f.workspace_id or v_client is distinct from f.client_id then raise exception 'Evidence outside this client' using errcode='42501'; end if;
  if v_sha is null then raise exception 'Evidence has no verifiable digest' using errcode='22023'; end if;
  if v_given is distinct from v_sha then raise exception 'Source changed' using errcode='PT409'; end if;
 elsif v_kind='url' then
  if coalesce(e->>'url','') !~ '^https?://' or length(e->>'url')>2048 or coalesce(v_given,'') !~ '^[a-f0-9]{64}$' or nullif(e->>'fetchedAt','') is null then
   raise exception 'Invalid page evidence' using errcode='22023'; end if;
 elsif v_kind='user' then
  if v_quote is null then raise exception 'A user statement needs its words' using errcode='22023'; end if;
 end if;
 -- The same reference at the same version and place is recorded once per fact.
 select x.id into v_id from public.client_fact_evidence x where x.fact_id=f.id and x.kind=v_kind and x.ref_id is not distinct from v_ref
  and x.url is not distinct from (case when v_kind='url' then e->>'url' end) and x.sha256 is not distinct from (case when v_kind='user' then null else coalesce(v_sha,v_given) end)
  and x.locator=v_loc and x.state<>'revoked' and (v_kind<>'user' or x.quote=v_quote);
 if v_id is not null then return v_id; end if;
 insert into public.client_fact_evidence(workspace_id,client_id,fact_id,kind,ref_id,project_id,sha256,extraction_version,locator,quote,url,fetched_at,stated_by)
 values(f.workspace_id,f.client_id,f.id,v_kind,v_ref,v_project,case when v_kind='user' then null else coalesce(v_sha,v_given) end,
  nullif(e->>'extractionVersion',''),v_loc,v_quote,case when v_kind='url' then e->>'url' end,
  case when v_kind='url' then (e->>'fetchedAt')::timestamptz end,case when v_kind='user' then p_actor end)
 returning id into v_id;
 return v_id;
end $$;

create function makeborne_private.knowledge_fact_view(p_fact uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',f.id,'clientId',f.client_id,'kind',f.kind,'key',f.key,'label',f.label,'value',f.value,'valueText',f.value_text,
  'unit',f.unit,'currency',f.currency,'validFrom',f.valid_from,'validTo',f.valid_to,'observedAt',f.observed_at,'status',f.status,
  'supersedesId',f.supersedes_id,'supersededBy',f.superseded_by,'conflictGroup',f.conflict_group,'uncertainty',f.uncertainty,
  'evidenceState',f.evidence_state,'createdVia',f.created_via,'createdBy',f.created_by,'operationId',f.operation_id,
  'approvedBy',f.approved_by,'approvedAt',f.approved_at,'rejectedBy',f.rejected_by,'rejectedAt',f.rejected_at,'reviewNote',f.review_note,
  'redacted',f.redacted_at is not null,'revision',f.revision,'createdAt',f.created_at,'updatedAt',f.updated_at,
  'openConflicts',(select count(*) from makeborne_private.knowledge_conflicts(f,array['proposed','approved'])))
 from public.client_facts f where f.id=p_fact;
$$;

-- ---------- propose ----------
-- p_operation null: a person proposes (any kind). p_operation set: a task
-- proposes on behalf of that operation's actor (never a user decision, never a
-- user statement). Either way the result is 'proposed'; the actor's role is
-- checked now. A newer observation that contradicts an approved fact is
-- proposed as its replacement (supersedes_id), never applied.
create function makeborne_private.knowledge_propose(p_actor uuid,p_workspace uuid,p_client uuid,p_fact jsonb,p_evidence jsonb,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.client_facts; dup public.client_facts; target public.client_facts; o makeborne_private.ai_operations; e jsonb; g uuid;
 v_kind text; v_key text; v_from date; v_to date; v_observed timestamptz; n_support integer:=0; v_system boolean:=p_operation is not null; deduplicated boolean:=false;
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,true);
 if v_system then
  select * into o from makeborne_private.ai_operations where id=p_operation;
  if not found or o.actor is distinct from p_actor or o.workspace_id is distinct from p_workspace then raise exception 'Operation unavailable' using errcode='42501'; end if;
  if not makeborne_private.ai_operation_agency_kind(o.kind) or o.cancel_requested_at is not null then raise exception 'Operation cannot propose knowledge' using errcode='42501'; end if;
  if not exists(select 1 from public.artifacts a join public.projects p on p.id=a.project_id and p.workspace_id=a.workspace_id
    where a.id=o.artifact_id and a.workspace_id=p_workspace and p.client_id=p_client) then raise exception 'Operation outside this client' using errcode='42501'; end if;
 end if;
 if p_fact is null or jsonb_typeof(p_fact)<>'object' or p_evidence is null or jsonb_typeof(p_evidence)<>'array' or jsonb_array_length(p_evidence) not between 1 and 10 then
  raise exception 'Invalid knowledge proposal' using errcode='22023'; end if;
 v_kind:=p_fact->>'kind'; v_key:=p_fact->>'key';
 if v_kind is null or v_kind not in ('observed_fact','inference','user_decision','brand_preference') then raise exception 'Invalid fact kind' using errcode='22023'; end if;
 if v_system and v_kind='user_decision' then raise exception 'A task cannot record a user decision' using errcode='42501'; end if;
 if v_key is null or length(v_key)>120 or v_key !~ '^[a-z0-9]+([._][a-z0-9]+)*$' then raise exception 'Invalid fact key' using errcode='22023'; end if;
 -- One writer per client and key: duplicate and conflict checks see each other.
 perform pg_advisory_xact_lock(hashtextextended(p_client::text||'/'||v_key,0));
 begin
  v_from:=nullif(p_fact->>'validFrom','')::date; v_to:=nullif(p_fact->>'validTo','')::date; v_observed:=nullif(p_fact->>'observedAt','')::timestamptz;
 exception when others then raise exception 'Invalid fact dates' using errcode='22023'; end;
 -- Evidence a kind needs. Generated artifacts support inferences only; an
 -- observed fact needs a real source; a decision needs the person's words.
 for e in select value from jsonb_array_elements(p_evidence) loop
  if jsonb_typeof(e)<>'object' then raise exception 'Invalid evidence' using errcode='22023'; end if;
  if e->>'kind' in ('source','asset','url','brief') then n_support:=n_support+1; end if;
  if e->>'kind'='artifact_version' and v_kind<>'inference' then raise exception 'A generated artifact can only support an inference' using errcode='22023'; end if;
 end loop;
 if v_kind='observed_fact' and n_support=0 then raise exception 'An observed fact needs a source' using errcode='22023'; end if;
 if v_kind='user_decision' and not exists(select 1 from jsonb_array_elements(p_evidence) x where x.value->>'kind'='user') then
  raise exception 'A decision needs the person''s statement' using errcode='22023'; end if;
 if v_kind='brand_preference' and n_support=0 and not exists(select 1 from jsonb_array_elements(p_evidence) x where x.value->>'kind'='user') then
  raise exception 'A brand preference needs a source or a statement' using errcode='22023'; end if;

 begin
  insert into public.client_facts(workspace_id,client_id,kind,key,label,value,value_text,unit,currency,valid_from,valid_to,observed_at,uncertainty,created_by,created_via,operation_id)
  values(p_workspace,p_client,v_kind,v_key,coalesce(p_fact->>'label',''),case when jsonb_typeof(p_fact->'value') in ('object','array','number','string','boolean') then p_fact->'value' end,
   btrim(coalesce(p_fact->>'valueText','')),nullif(p_fact->>'unit',''),nullif(p_fact->>'currency',''),v_from,v_to,v_observed,nullif(btrim(p_fact->>'uncertainty'),''),
   p_actor,case when v_system then 'system' else 'user' end,p_operation)
  returning * into f;
 exception when check_violation then raise exception 'Invalid fact' using errcode='22023'; end;

 -- Same claim already known (same key, value, overlapping validity): add the
 -- evidence there instead of a duplicate row.
 select * into dup from public.client_facts d where d.workspace_id=f.workspace_id and d.client_id=f.client_id and d.key=f.key and d.id<>f.id
  and d.kind=f.kind and d.status in ('proposed','approved') and d.value_identity=f.value_identity and d.redacted_at is null
  and makeborne_private.knowledge_overlaps(f.valid_from,f.valid_to,d.valid_from,d.valid_to)
  order by (d.status='approved') desc,d.created_at limit 1 for update;
 if found then
  delete from public.client_facts where id=f.id;
  f:=dup; deduplicated:=true;
 end if;
 for e in select value from jsonb_array_elements(p_evidence) loop
  perform makeborne_private.knowledge_add_evidence(f,e,p_actor,v_system);
 end loop;
 perform makeborne_private.knowledge_refresh(f.id);
 if deduplicated then
  insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome,metadata)
  values(f.workspace_id,p_actor,'knowledge.evidence_added',f.id,f.status,jsonb_build_object('clientId',f.client_id,'revision',f.revision,'via',case when v_system then 'system' else 'user' end));
  return makeborne_private.knowledge_fact_view(f.id)||jsonb_build_object('deduplicated',true);
 end if;

 -- Explicit replacement (a person names the fact this replaces) or a newer
 -- observation contradicting exactly one approved fact.
 if p_fact ? 'supersedesId' and jsonb_typeof(p_fact->'supersedesId')='string' then
  select * into target from public.client_facts t where t.id=(p_fact->>'supersedesId')::uuid and t.workspace_id=f.workspace_id and t.client_id=f.client_id
   and t.key=f.key and t.status='approved';
  if not found then raise exception 'Only an approved fact with the same key can be replaced' using errcode='22023'; end if;
  update public.client_facts set supersedes_id=target.id where id=f.id returning * into f;
 elsif (select count(*) from makeborne_private.knowledge_conflicts(f,array['approved']))=1 then
  select * into target from makeborne_private.knowledge_conflicts(f,array['approved']);
  if f.observed_at is not null and (target.observed_at is null or f.observed_at>target.observed_at) then
   update public.client_facts set supersedes_id=target.id where id=f.id returning * into f;
  end if;
 end if;

 -- Contradictions are grouped, never resolved silently.
 if exists(select 1 from makeborne_private.knowledge_conflicts(f,array['proposed','approved'])) then
  select coalesce((select c.conflict_group from makeborne_private.knowledge_conflicts(f,array['proposed','approved']) c where c.conflict_group is not null limit 1),gen_random_uuid()) into g;
  update public.client_facts c set conflict_group=g where c.id in (select x.id from makeborne_private.knowledge_conflicts(f,array['proposed','approved']) x)
   or c.conflict_group in (select x.conflict_group from makeborne_private.knowledge_conflicts(f,array['proposed','approved']) x where x.conflict_group is not null);
  update public.client_facts set conflict_group=g,
   uncertainty=coalesce(uncertainty,case when supersedes_id is not null then 'A newer source gives a different value than the approved one.' else 'Sources disagree about this value.' end)
   where id=f.id returning * into f;
 end if;
 perform makeborne_private.knowledge_record(f,'proposed',p_actor,null);
 return makeborne_private.knowledge_fact_view(f.id)||jsonb_build_object('deduplicated',false);
end $$;

-- ---------- approve / reject ----------
create function makeborne_private.knowledge_review(p_actor uuid,p_workspace uuid,p_fact uuid,p_expected_revision integer,p_action text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.client_facts; target public.client_facts; v_old public.client_facts;
begin
 if makeborne_private.knowledge_role(p_actor,p_workspace) is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 select * into f from public.client_facts where id=p_fact and workspace_id=p_workspace;
 if not found then raise exception 'Fact unavailable' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(f.client_id::text||'/'||f.key,0));
 select * into f from public.client_facts where id=p_fact for update;
 perform makeborne_private.knowledge_require(p_actor,p_workspace,f.client_id,true);
 if p_action is null or p_action not in ('approve','reject') or p_expected_revision is null then raise exception 'Invalid review' using errcode='22023'; end if;
 if f.revision<>p_expected_revision then raise exception 'Fact changed' using errcode='PT409'; end if;
 if f.redacted_at is not null then raise exception 'This fact''s source was deleted' using errcode='22023'; end if;
 if p_action='reject' then
  if f.status not in ('proposed','approved') then raise exception 'Only a proposed or approved fact can be rejected' using errcode='PT409'; end if;
  update public.client_facts set status='rejected',rejected_by=p_actor,rejected_at=now(),review_note=left(nullif(btrim(p_note),''),1000),
   revision=revision+1,updated_at=now() where id=f.id returning * into f;
  perform makeborne_private.knowledge_record(f,'rejected',p_actor,p_note);
  return makeborne_private.knowledge_fact_view(f.id);
 end if;
 if f.status<>'proposed' then raise exception 'Only a proposed fact can be approved' using errcode='PT409'; end if;
 if f.evidence_state<>'live' then raise exception 'This fact''s source changed or was removed; review the source first' using errcode='22023'; end if;
 if f.kind='observed_fact' and not exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='live' and e.kind in ('source','asset','url','brief')) then
  raise exception 'An observed fact needs a live source' using errcode='22023'; end if;
 if f.supersedes_id is not null then
  select * into target from public.client_facts where id=f.supersedes_id for update;
  if not found or target.status<>'approved' or target.key<>f.key or target.client_id<>f.client_id then raise exception 'The fact this replaces changed' using errcode='PT409'; end if;
 end if;
 if exists(select 1 from makeborne_private.knowledge_conflicts(f,array['approved']) c where c.id is distinct from f.supersedes_id) then
  raise exception 'Another approved fact says something different; replace or reject it first' using errcode='KN409'; end if;
 if f.supersedes_id is not null then
  update public.client_facts set status='superseded',superseded_by=f.id,revision=revision+1,updated_at=now() where id=target.id returning * into v_old;
  perform makeborne_private.knowledge_record(v_old,'superseded',p_actor,null);
 end if;
 update public.client_facts set status='approved',approved_by=p_actor,approved_at=now(),review_note=left(nullif(btrim(p_note),''),1000),
  revision=revision+1,updated_at=now() where id=f.id returning * into f;
 perform makeborne_private.knowledge_record(f,'approved',p_actor,p_note);
 return makeborne_private.knowledge_fact_view(f.id);
end $$;

-- ---------- correct ----------
-- A person changes the value. What the source said is kept as context, but the
-- corrected value is that person's decision (kind user_decision, with their
-- statement as evidence) unless it is a brand preference. The fact returns to
-- 'proposed' unless p_approve, which runs the same checks as approval.
create function makeborne_private.knowledge_correct(p_actor uuid,p_workspace uuid,p_fact uuid,p_expected_revision integer,p_patch jsonb,p_note text,p_approve boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.client_facts; v_from date; v_to date; v_kind text;
begin
 if makeborne_private.knowledge_role(p_actor,p_workspace) is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 select * into f from public.client_facts where id=p_fact and workspace_id=p_workspace;
 if not found then raise exception 'Fact unavailable' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(f.client_id::text||'/'||f.key,0));
 select * into f from public.client_facts where id=p_fact for update;
 perform makeborne_private.knowledge_require(p_actor,p_workspace,f.client_id,true);
 if p_expected_revision is null or f.revision<>p_expected_revision then raise exception 'Fact changed' using errcode='PT409'; end if;
 if f.status not in ('proposed','approved') or f.redacted_at is not null then raise exception 'Only a current fact can be corrected' using errcode='PT409'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or nullif(btrim(p_note),'') is null or length(p_note)>600 then raise exception 'Invalid correction' using errcode='22023'; end if;
 begin
  v_from:=case when p_patch ? 'validFrom' then nullif(p_patch->>'validFrom','')::date else f.valid_from end;
  v_to:=case when p_patch ? 'validTo' then nullif(p_patch->>'validTo','')::date else f.valid_to end;
 exception when others then raise exception 'Invalid fact dates' using errcode='22023'; end;
 v_kind:=case when f.kind='brand_preference' then 'brand_preference' else 'user_decision' end;
 begin
  update public.client_facts set kind=v_kind,
   value=case when p_patch ? 'value' then case when jsonb_typeof(p_patch->'value') in ('object','array','number','string','boolean') then p_patch->'value' end else value end,
   value_text=case when p_patch ? 'valueText' then btrim(p_patch->>'valueText') else value_text end,
   unit=case when p_patch ? 'unit' then nullif(p_patch->>'unit','') else unit end,
   currency=case when p_patch ? 'currency' then nullif(p_patch->>'currency','') else currency end,
   label=case when p_patch ? 'label' then coalesce(p_patch->>'label','') else label end,
   valid_from=v_from,valid_to=v_to,status='proposed',approved_by=null,approved_at=null,uncertainty=null,
   -- A replacement that already happened is history, not a pending replacement.
   supersedes_id=case when (select t.status from public.client_facts t where t.id=f.supersedes_id)='approved' then supersedes_id end,
   created_via='user',operation_id=null,revision=revision+1,updated_at=now()
  where id=f.id returning * into f;
 exception when check_violation then raise exception 'Invalid correction' using errcode='22023'; end;
 -- Source evidence stays for provenance but no longer supports the new value.
 update public.client_fact_evidence set supports=false where fact_id=f.id and kind<>'user';
 perform makeborne_private.knowledge_add_evidence(f,jsonb_build_object('kind','user','quote',left(btrim(p_note),600)),p_actor,false);
 perform makeborne_private.knowledge_refresh(f.id);
 select * into f from public.client_facts where id=f.id;
 perform makeborne_private.knowledge_record(f,'corrected',p_actor,p_note);
 if p_approve then return makeborne_private.knowledge_review(p_actor,p_workspace,f.id,f.revision,'approve',p_note); end if;
 return makeborne_private.knowledge_fact_view(f.id);
end $$;

-- ---------- source lifecycle ----------
create function makeborne_private.knowledge_source_gone(p_kind text,p_ref uuid,p_url text,p_workspace uuid,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare fid uuid; n integer:=0; f public.client_facts;
begin
 for fid in
  update public.client_fact_evidence e set state='revoked',revoked_at=now(),revoked_reason=p_reason,quote=null
  where e.kind=p_kind and e.state<>'revoked' and ((p_ref is not null and e.ref_id=p_ref) or (p_url is not null and e.url=p_url and e.workspace_id=p_workspace))
  returning e.fact_id
 loop
  n:=n+1;
  perform makeborne_private.knowledge_refresh(fid);
 end loop;
 if p_reason='source_deleted' then
  -- A fact whose only support was this deleted source loses its value too.
  perform set_config('makeborne.knowledge_redact','on',true);
  for f in select x.* from public.client_facts x where x.redacted_at is null and x.evidence_state='revoked'
    and exists(select 1 from public.client_fact_evidence e where e.fact_id=x.id and e.kind=p_kind and e.ref_id=p_ref)
    and not exists(select 1 from public.client_fact_evidence e where e.fact_id=x.id and e.kind='user' and e.state<>'revoked') for update
  loop
   update public.client_facts set value=null,value_text='[removed with its source]',label='',uncertainty=null,redacted_at=now(),
    revision=revision+1,updated_at=now() where id=f.id returning * into f;
   update public.client_fact_revisions set value=null,value_text='[removed with its source]',redacted_at=now() where fact_id=f.id and redacted_at is null;
   insert into public.client_fact_revisions(fact_id,workspace_id,revision,action,kind,key,status,value,value_text,actor,note,redacted_at)
   values(f.id,f.workspace_id,f.revision,'redacted',f.kind,f.key,f.status,null,'[removed with its source]',coalesce((select auth.uid()),f.created_by),'Source deleted',now());
  end loop;
  perform set_config('makeborne.knowledge_redact','',true);
 end if;
 return n;
end $$;

create function makeborne_private.knowledge_source_versioned(p_kind text,p_ref uuid,p_sha text) returns void
language plpgsql security definer set search_path='' as $$
declare fid uuid;
begin
 for fid in update public.client_fact_evidence e set state=case when e.sha256=p_sha then 'live' else 'stale' end
  where e.kind=p_kind and e.ref_id=p_ref and e.state<>'revoked' and e.state is distinct from (case when e.sha256=p_sha then 'live' else 'stale' end)
  returning e.fact_id
 loop perform makeborne_private.knowledge_refresh(fid); end loop;
end $$;

create function makeborne_private.knowledge_source_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='sources' then
  if tg_op='DELETE' then perform makeborne_private.knowledge_source_gone('source',old.id,null,old.workspace_id,'source_deleted'); return old; end if;
  if old.approved and not new.approved then perform makeborne_private.knowledge_source_gone('source',new.id,null,new.workspace_id,'source_revoked');
  elsif new.content is distinct from old.content then perform makeborne_private.knowledge_source_versioned('source',new.id,encode(sha256(convert_to(new.content,'UTF8')),'hex')); end if;
  return new;
 elsif tg_table_name='assets' then
  perform makeborne_private.knowledge_source_gone('asset',old.id,null,old.workspace_id,'source_deleted'); return old;
 elsif tg_table_name='projects' then
  if tg_op='DELETE' then perform makeborne_private.knowledge_source_gone('brief',old.id,null,old.workspace_id,'source_deleted'); return old; end if;
  if new.brief is distinct from old.brief then perform makeborne_private.knowledge_source_versioned('brief',new.id,encode(sha256(convert_to(new.brief,'UTF8')),'hex')); end if;
  return new;
 end if;
 return null;
end $$;
create trigger knowledge_source_lifecycle after update of content,approved or delete on public.sources for each row execute function makeborne_private.knowledge_source_lifecycle();
create trigger knowledge_asset_lifecycle after delete on public.assets for each row execute function makeborne_private.knowledge_source_lifecycle();
create trigger knowledge_brief_lifecycle after update of brief or delete on public.projects for each row execute function makeborne_private.knowledge_source_lifecycle();

-- A person withdraws a source (or a public page) from this workspace's knowledge.
create function makeborne_private.knowledge_revoke_source(p_actor uuid,p_workspace uuid,p_kind text,p_ref uuid,p_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r text:=makeborne_private.knowledge_role(p_actor,p_workspace); n integer;
begin
 if r is null or r not in ('owner','editor') then raise exception 'Editor permission required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('source','asset','url') or (p_kind='url')=(p_url is null) or (p_kind<>'url')=(p_ref is null) then raise exception 'Invalid revocation' using errcode='22023'; end if;
 if p_kind<>'url' and not exists(select 1 from public.client_fact_evidence e where e.kind=p_kind and e.ref_id=p_ref and e.workspace_id=p_workspace) then
  raise exception 'Source unavailable' using errcode='P0002'; end if;
 n:=makeborne_private.knowledge_source_gone(p_kind,case when p_kind='url' then null else p_ref end,p_url,p_workspace,'manual');
 insert into public.audit_events(workspace_id,actor_id,action,target_id,outcome,metadata)
 values(p_workspace,p_actor,'knowledge.source_revoked',p_ref,'revoked',jsonb_build_object('kind',p_kind,'evidence',n));
 return jsonb_build_object('revokedEvidence',n);
end $$;

-- ---------- retrieval ----------
-- Bounded candidates for one task: approved facts valid on p_as_of whose
-- evidence is live; optionally proposed OBSERVED facts that are not business
-- truth (no prices, hours, contact, legal, claims), have no open conflict and
-- come with a live source quote, labelled 'unapproved'. Ranked by full-text
-- match on key, label and value; no terms means every eligible fact by kind.
create function makeborne_private.knowledge_retrieve(p_actor uuid,p_workspace uuid,p_client uuid,p_terms text[],p_as_of date,p_limit integer,p_include_proposed boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q tsquery; t text; terms text[]:='{}'; v_epoch bigint;
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,false);
 if p_as_of is null or p_limit is null or p_limit not between 1 and 100 or coalesce(cardinality(p_terms),0)>24 then raise exception 'Invalid retrieval' using errcode='22023'; end if;
 foreach t in array coalesce(p_terms,'{}') loop
  if t !~ '^[a-z0-9]{2,32}$' then raise exception 'Invalid retrieval term' using errcode='22023'; end if;
  terms:=terms||(t||':*');
 end loop;
 if cardinality(terms)>0 then q:=to_tsquery('simple'::regconfig,array_to_string(terms,' | ')); end if;
 select s.epoch into v_epoch from public.client_knowledge_state s where s.workspace_id=p_workspace and s.client_id=p_client;
 return jsonb_build_object('epoch',coalesce(v_epoch,0),'asOf',p_as_of,'items',coalesce((
  select jsonb_agg(x.item order by x.rank desc,x.priority,x.key,x.id) from (
   select f.id,f.key,
    case when q is null then 0 else ts_rank_cd(f.search,q) end as rank,
    case f.kind when 'brand_preference' then 0 when 'user_decision' then 1 when 'observed_fact' then 2 else 3 end as priority,
    makeborne_private.knowledge_fact_view(f.id)-'createdBy'-'approvedBy'-'rejectedBy'-'reviewNote'||jsonb_build_object(
     'trust',case when f.status='approved' then 'approved' else 'unapproved' end,
     'rank',case when q is null then 0 else ts_rank_cd(f.search,q) end,
     'pending',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'valueText',c.value_text,'observedAt',c.observed_at,'replaces',c.supersedes_id=f.id)),'[]'::jsonb)
       from makeborne_private.knowledge_conflicts(f,array['proposed']) c),
     'evidence',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'refId',e.ref_id,'projectId',e.project_id,'sha256',e.sha256,
       'extractionVersion',e.extraction_version,'locator',e.locator,'quote',e.quote,'url',e.url,'fetchedAt',e.fetched_at,
       'title',case e.kind when 'source' then (select s.title from public.sources s where s.id=e.ref_id) when 'brief' then (select p.title from public.projects p where p.id=e.ref_id) else null end)
       order by e.created_at,e.id),'[]'::jsonb)
       from (select * from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='live' order by e.created_at,e.id limit 3) e)
    ) as item
   from public.client_facts f
   where f.workspace_id=p_workspace and f.client_id=p_client and f.redacted_at is null and f.evidence_state='live'
    and (f.valid_from is null or f.valid_from<=p_as_of) and (f.valid_to is null or f.valid_to>=p_as_of)
    and (q is null or f.search @@ q)
    and (f.status='approved' or (p_include_proposed and f.status='proposed' and f.kind='observed_fact' and not makeborne_private.knowledge_sensitive_key(f.key)
     and not exists(select 1 from makeborne_private.knowledge_conflicts(f,array['proposed','approved']))
     and exists(select 1 from public.client_fact_evidence e where e.fact_id=f.id and e.supports and e.state='live' and e.kind in ('source','asset','url','brief') and e.quote is not null)))
   order by rank desc,priority,f.key,f.id limit p_limit) x),'[]'::jsonb));
end $$;

-- ---------- snapshot ----------
-- Records exactly what a task was given. Every item is re-verified now: the
-- fact is this client's, still eligible, at the stated revision, with live
-- evidence; otherwise the caller retrieved stale knowledge and must retry.
-- Digests, versions and locators are copied from the database, not the caller.
create function makeborne_private.knowledge_snapshot(p_actor uuid,p_workspace uuid,p_client uuid,p_operation uuid,p_artifact uuid,p_purpose text,p_query text,
 p_as_of date,p_items jsonb,p_context_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i jsonb; f public.client_facts; ev jsonb; out jsonb:='[]'; v_epoch bigint; v_id uuid; o makeborne_private.ai_operations; eid text; seen uuid[]:='{}';
begin
 perform makeborne_private.knowledge_require(p_actor,p_workspace,p_client,false);
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 or p_as_of is null or coalesce(p_context_sha256,'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid snapshot' using errcode='22023'; end if;
 if p_operation is not null then
  select * into o from makeborne_private.ai_operations where id=p_operation;
  if not found or o.actor is distinct from p_actor or o.workspace_id is distinct from p_workspace then raise exception 'Operation unavailable' using errcode='42501'; end if;
 end if;
 if p_artifact is not null and not exists(select 1 from public.artifacts a join public.projects p on p.id=a.project_id and p.workspace_id=a.workspace_id
   where a.id=p_artifact and a.workspace_id=p_workspace and p.client_id=p_client) then raise exception 'Artifact outside this client' using errcode='42501'; end if;
 for i in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(i)<>'object' or coalesce(i->>'factId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(i->'revision')<>'number' or jsonb_typeof(coalesce(i->'evidenceIds','[]'))<>'array' then raise exception 'Invalid snapshot item' using errcode='22023'; end if;
  if (i->>'factId')::uuid=any(seen) then raise exception 'Duplicate snapshot item' using errcode='22023'; end if;
  seen:=seen||(i->>'factId')::uuid;
  select * into f from public.client_facts where id=(i->>'factId')::uuid and workspace_id=p_workspace and client_id=p_client for share;
  if not found then raise exception 'Fact outside this client' using errcode='42501'; end if;
  if f.revision<>(i->>'revision')::integer or f.redacted_at is not null or f.evidence_state<>'live' or f.status not in ('approved','proposed')
   or (f.status='proposed' and coalesce(i->>'trust','')<>'unapproved') then raise exception 'Knowledge changed' using errcode='PT409'; end if;
  ev:='[]';
  for eid in select jsonb_array_elements_text(coalesce(i->'evidenceIds','[]')) loop
   select ev||jsonb_build_array(jsonb_build_object('id',e.id,'kind',e.kind,'refId',e.ref_id,'sha256',e.sha256,'extractionVersion',e.extraction_version,'locator',e.locator,'url',e.url,'fetchedAt',e.fetched_at))
    into ev from public.client_fact_evidence e where e.id=eid::uuid and e.fact_id=f.id and e.state='live' and e.supports;
   if ev is null then raise exception 'Knowledge changed' using errcode='PT409'; end if;
  end loop;
  out:=out||jsonb_build_array(jsonb_build_object('factId',f.id,'revision',f.revision,'kind',f.kind,'key',f.key,'status',f.status,
   'trust',case when f.status='approved' then 'approved' else 'unapproved' end,'evidence',ev));
 end loop;
 select s.epoch into v_epoch from public.client_knowledge_state s where s.workspace_id=p_workspace and s.client_id=p_client;
 insert into public.knowledge_snapshots(workspace_id,client_id,operation_id,artifact_id,purpose,query,as_of,epoch,items,context_sha256,created_by)
 values(p_workspace,p_client,p_operation,p_artifact,coalesce(p_purpose,''),left(coalesce(p_query,''),1000),p_as_of,coalesce(v_epoch,0),out,p_context_sha256,p_actor)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'epoch',coalesce(v_epoch,0),'items',out);
end $$;

-- Explain a snapshot later: the values exactly as they were at that revision
-- (or marked removed when the source was deleted since).
create function makeborne_private.knowledge_snapshot_view(p_actor uuid,p_workspace uuid,p_snapshot uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.knowledge_snapshots;
begin
 if makeborne_private.knowledge_role(p_actor,p_workspace) is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 select * into s from public.knowledge_snapshots where id=p_snapshot and workspace_id=p_workspace;
 if not found then raise exception 'Snapshot unavailable' using errcode='P0002'; end if;
 perform makeborne_private.knowledge_require(p_actor,p_workspace,s.client_id,false);
 return jsonb_build_object('id',s.id,'clientId',s.client_id,'operationId',s.operation_id,'artifactId',s.artifact_id,'purpose',s.purpose,'asOf',s.as_of,'epoch',s.epoch,
  'createdAt',s.created_at,'contextSha256',s.context_sha256,'items',coalesce((select jsonb_agg(i.value||jsonb_build_object(
   'valueText',r.value_text,'value',r.value,'unit',r.unit,'currency',r.currency,'removed',r.redacted_at is not null,
   'currentRevision',(select f.revision from public.client_facts f where f.id=(i.value->>'factId')::uuid),
   'currentStatus',(select f.status from public.client_facts f where f.id=(i.value->>'factId')::uuid)) order by i.ordinality)
  from jsonb_array_elements(s.items) with ordinality i left join public.client_fact_revisions r on r.fact_id=(i.value->>'factId')::uuid and r.revision=(i.value->>'revision')::integer),'[]'::jsonb));
end $$;

-- ---------- access ----------
alter table public.client_facts enable row level security;
alter table public.client_fact_evidence enable row level security;
alter table public.client_fact_revisions enable row level security;
alter table public.knowledge_snapshots enable row level security;
alter table public.client_knowledge_state enable row level security;
revoke all on public.client_facts,public.client_fact_evidence,public.client_fact_revisions,public.knowledge_snapshots,public.client_knowledge_state from public,anon,authenticated,service_role;
-- Members (owner, editor, reviewer) read their workspace's knowledge. Nobody
-- writes the tables directly: every write is an entry point below that checks
-- the actor's current role.
grant select on public.client_facts,public.client_fact_evidence,public.client_fact_revisions,public.knowledge_snapshots,public.client_knowledge_state to authenticated,service_role;
create policy knowledge_member_read on public.client_facts for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy knowledge_member_read on public.client_fact_evidence for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy knowledge_member_read on public.client_fact_revisions for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy knowledge_member_read on public.knowledge_snapshots for select to authenticated using(makeborne_private.can_read(workspace_id));
create policy knowledge_member_read on public.client_knowledge_state for select to authenticated using(makeborne_private.can_read(workspace_id));

create function public.makeborne_knowledge_propose(p_actor uuid,p_workspace uuid,p_client uuid,p_fact jsonb,p_evidence jsonb,p_operation uuid default null) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.knowledge_propose(p_actor,p_workspace,p_client,p_fact,p_evidence,p_operation); $$;
create function public.makeborne_knowledge_review(p_actor uuid,p_workspace uuid,p_fact uuid,p_expected_revision integer,p_action text,p_note text default null) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.knowledge_review(p_actor,p_workspace,p_fact,p_expected_revision,p_action,p_note); $$;
create function public.makeborne_knowledge_correct(p_actor uuid,p_workspace uuid,p_fact uuid,p_expected_revision integer,p_patch jsonb,p_note text,p_approve boolean default false) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.knowledge_correct(p_actor,p_workspace,p_fact,p_expected_revision,p_patch,p_note,p_approve); $$;
create function public.makeborne_knowledge_revoke_source(p_actor uuid,p_workspace uuid,p_kind text,p_ref uuid default null,p_url text default null) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.knowledge_revoke_source(p_actor,p_workspace,p_kind,p_ref,p_url); $$;
create function public.makeborne_knowledge_retrieve(p_actor uuid,p_workspace uuid,p_client uuid,p_terms text[],p_as_of date,p_limit integer,p_include_proposed boolean default false) returns jsonb
 language sql stable security invoker set search_path='' as $$ select makeborne_private.knowledge_retrieve(p_actor,p_workspace,p_client,p_terms,p_as_of,p_limit,p_include_proposed); $$;
create function public.makeborne_knowledge_snapshot(p_actor uuid,p_workspace uuid,p_client uuid,p_operation uuid,p_artifact uuid,p_purpose text,p_query text,p_as_of date,p_items jsonb,p_context_sha256 text) returns jsonb
 language sql security invoker set search_path='' as $$ select makeborne_private.knowledge_snapshot(p_actor,p_workspace,p_client,p_operation,p_artifact,p_purpose,p_query,p_as_of,p_items,p_context_sha256); $$;
create function public.makeborne_knowledge_snapshot_view(p_actor uuid,p_workspace uuid,p_snapshot uuid) returns jsonb
 language sql stable security invoker set search_path='' as $$ select makeborne_private.knowledge_snapshot_view(p_actor,p_workspace,p_snapshot); $$;

-- New functions default to PUBLIC execute: close every one, then open only the
-- service entry points and the private bodies they call.
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='makeborne_private' and p.proname like 'knowledge\_%') or (n.nspname='public' and p.proname like 'makeborne\_knowledge\_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
 end loop;
end $$;
grant execute on function
 makeborne_private.knowledge_propose(uuid,uuid,uuid,jsonb,jsonb,uuid), makeborne_private.knowledge_review(uuid,uuid,uuid,integer,text,text),
 makeborne_private.knowledge_correct(uuid,uuid,uuid,integer,jsonb,text,boolean), makeborne_private.knowledge_revoke_source(uuid,uuid,text,uuid,text),
 makeborne_private.knowledge_retrieve(uuid,uuid,uuid,text[],date,integer,boolean), makeborne_private.knowledge_snapshot(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text),
 makeborne_private.knowledge_snapshot_view(uuid,uuid,uuid),
 public.makeborne_knowledge_propose(uuid,uuid,uuid,jsonb,jsonb,uuid), public.makeborne_knowledge_review(uuid,uuid,uuid,integer,text,text),
 public.makeborne_knowledge_correct(uuid,uuid,uuid,integer,jsonb,text,boolean), public.makeborne_knowledge_revoke_source(uuid,uuid,text,uuid,text),
 public.makeborne_knowledge_retrieve(uuid,uuid,uuid,text[],date,integer,boolean), public.makeborne_knowledge_snapshot(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text),
 public.makeborne_knowledge_snapshot_view(uuid,uuid,uuid)
 to service_role;

commit;
