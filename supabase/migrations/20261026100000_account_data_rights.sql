-- Account data rights: data export (GDPR Art. 15/20) and account deletion (Art. 17).
-- Off by default in the app (MAKEBORNE_ACCOUNT_EXPORT / MAKEBORNE_ACCOUNT_DELETION
-- must be exactly "on"). Every entry point is a service-role-only function; the
-- signed-in user is always taken from the verified session by the app server, never
-- from the browser. See docs/release-review/account-data-rights-20261026.md for the
-- table-by-table data map this file implements.
begin;

-- ---------------------------------------------------------------------------
-- 1. Request, event and retention tables (private, no client access)
-- ---------------------------------------------------------------------------
create table makeborne_private.account_export_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  state text not null default 'queued' check (state in ('queued','building','ready','failed','expired')),
  attempts integer not null default 0 check (attempts >= 0),
  lease uuid,
  lease_until timestamptz,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  -- [{part, path, bytes, sha256}] in the private account-exports bucket.
  parts jsonb not null default '[]'::jsonb check (jsonb_typeof(parts) = 'array'),
  -- Row counts per source only; never row content.
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{2,40}$'),
  unique (user_id, request_key),
  check ((state = 'building') = (lease is not null)),
  check (state <> 'ready' or (expires_at is not null and completed_at is not null))
);
create index account_export_requests_user on makeborne_private.account_export_requests(user_id, requested_at desc);

create table makeborne_private.account_deletion_requests(
  id uuid primary key default gen_random_uuid(),
  -- Nulled when the deletion completes; the subject reference stays as the only key.
  user_id uuid,
  subject_ref uuid not null unique default gen_random_uuid(),
  request_key uuid not null,
  state text not null default 'scheduled' check (state in ('scheduled','cancelled','processing','blocked','completed')),
  grace_days integer not null check (grace_days between 1 and 30),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  -- {step: completed_at}; steps are idempotent and the job resumes at the first missing one.
  steps jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  -- Owned workspaces captured when processing starts (needed after their rows are gone).
  workspace_ids uuid[],
  blocked_codes text[] not null default '{}',
  last_code text check (last_code is null or last_code ~ '^[A-Z0-9_]{2,40}$'),
  check ((state = 'completed') = (completed_at is not null)),
  check (state = 'completed' or user_id is not null),
  check ((state = 'processing') or lease is null)
);
create unique index account_deletion_one_open on makeborne_private.account_deletion_requests(user_id)
  where state in ('scheduled','processing','blocked');
create unique index account_deletion_request_key on makeborne_private.account_deletion_requests(user_id, request_key) where user_id is not null;
create index account_deletion_due on makeborne_private.account_deletion_requests(scheduled_for) where state in ('scheduled','processing');

-- Operational log without personal data: request ids, event names and codes only.
create table makeborne_private.account_rights_events(
  id bigint generated always as identity primary key,
  request_id uuid not null,
  kind text not null check (kind in ('export','deletion')),
  event text not null check (event ~ '^[a-z_]{2,40}$'),
  code text check (code is null or code ~ '^[A-Z0-9_]{2,40}$'),
  created_at timestamptz not null default now()
);
create index account_rights_events_request on makeborne_private.account_rights_events(request_id, created_at);

-- Records kept after deletion for legal reasons (financial/tax, refunds, disputes,
-- consent evidence, cost accounting). The account id is replaced by subject_ref.
create table makeborne_private.retained_account_records(
  id bigint generated always as identity primary key,
  subject_ref uuid not null,
  source_table text not null,
  source_key text not null,
  record jsonb not null,
  reason text not null check (reason in ('financial','accounting','consent','legal_hold')),
  retained_at timestamptz not null default now(),
  retain_until timestamptz not null,
  unique (subject_ref, source_table, source_key)
);
create index retained_account_records_until on makeborne_private.retained_account_records(retain_until);

-- Support/legal holds set by operators only (SQL editor); an open hold blocks deletion.
create table makeborne_private.account_legal_holds(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

do $$ declare t text; begin
  foreach t in array array['makeborne_private.account_export_requests','makeborne_private.account_deletion_requests',
    'makeborne_private.account_rights_events','makeborne_private.retained_account_records','makeborne_private.account_legal_holds'] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- Private bucket for prepared export parts. Objects: <user_id>/<request_id>/part-<n>.zip.
-- No storage policies: only the server key reads or writes it.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('account-exports','account-exports',false,52428800,array['application/zip'])
on conflict(id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create function makeborne_private.account_rights_log(p_request uuid, p_kind text, p_event text, p_code text default null) returns void
language sql security definer set search_path = '' as $$
  insert into makeborne_private.account_rights_events(request_id,kind,event,code) values(p_request,p_kind,p_event,p_code);
$$;

-- Replace every top-level value equal to the account id with the subject reference.
create function makeborne_private.account_pseudonymize(p_row jsonb, p_user uuid, p_subject uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, case when value = to_jsonb(p_user::text) then to_jsonb(p_subject::text) else value end), '{}'::jsonb)
  from jsonb_each(p_row);
$$;

-- True only inside an account-erasure transaction (makeborne.account_erasure set to a
-- processing request) for a workspace that request captured. Read by the append-only
-- guards below; when the setting is absent they behave exactly as before.
create function makeborne_private.account_erasure_allows(p_workspace uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text := current_setting('makeborne.account_erasure', true);
begin
  if v is null or v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_workspace is null then return false; end if;
  return exists(select 1 from makeborne_private.account_deletion_requests r
    where r.id = v::uuid and r.state = 'processing' and p_workspace = any(r.workspace_ids));
end $$;
revoke all on function makeborne_private.account_erasure_allows(uuid) from public, anon, authenticated, service_role;

-- Append-only guards: identical behaviour unless an erasure is in progress for the
-- row's workspace (the evidence is archived to retained_account_records first).
create or replace function makeborne_private.prevent_accounting_rewrite() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('makeborne.account_erasure', true) is not null
    and makeborne_private.account_erasure_allows(old.workspace_id) then return old; end if;
  raise exception 'Accounting evidence is append-only' using errcode='23514';
end $$;

create or replace function makeborne_private.protect_project_build() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='DELETE' then
   if current_setting('makeborne.account_erasure', true) is not null and makeborne_private.account_erasure_allows(old.workspace_id) then return old; end if;
   raise exception 'Build evidence cannot be deleted' using errcode='23514';
 end if;
 if old.status in ('compiled','failed','cancelled') or
   row(new.job_id,new.workspace_id,new.artifact_id,new.outcome_id,new.version_id,new.result_hash,new.created_at)
   is distinct from row(old.job_id,old.workspace_id,old.artifact_id,old.outcome_id,old.version_id,old.result_hash,old.created_at) then
   raise exception 'Build identity and terminal evidence are immutable' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function makeborne_private.protect_referenced_asset_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' and current_setting('makeborne.account_erasure', true) is not null
    and makeborne_private.account_erasure_allows(old.workspace_id) then return old; end if;
  if exists(select 1 from public.artifact_versions v where v.workspace_id=old.workspace_id
      and v.asset_manifest @> jsonb_build_array(old.id::text)) then
    if tg_op='DELETE' then
      raise exception 'Referenced asset cannot be deleted' using errcode='23514';
    end if;
    if (new.id,new.workspace_id,new.project_id,new.object_path,new.content_type,new.sha256)
        is distinct from (old.id,old.workspace_id,old.project_id,old.object_path,old.content_type,old.sha256) then
      raise exception 'Referenced asset identity is immutable; register a new asset' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- What stops a deletion now, and what the person should know before asking.
create function makeborne_private.account_deletion_blockers(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'blockers', to_jsonb(array_remove(array[
      case when exists(select 1 from public.billing_memberships m where m.user_id = p_user
        and m.status in ('trialing','active','past_due','unresolved')) then 'ACTIVE_SUBSCRIPTION' end,
      case when exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
        where w.owner_id = p_user and m.user_id <> p_user) then 'SHARED_WORKSPACE' end,
      case when exists(select 1 from makeborne_private.autotopup_authorizations a where a.user_id = p_user and a.revoked_at is null) then 'AUTO_TOPUP_ON' end,
      case when exists(select 1 from makeborne_private.refund_cases r where r.user_id = p_user and r.state = 'pending') then 'REFUND_IN_PROGRESS' end,
      case when exists(select 1 from makeborne_private.account_legal_holds h where h.user_id = p_user and h.released_at is null) then 'ACCOUNT_HOLD' end,
      -- Saved versions are immutable snapshots: work authored in someone else's
      -- workspace needs that owner (via support) before the account can go.
      case when exists(select 1 from public.artifact_versions v join public.workspaces w on w.id = v.workspace_id
        where v.created_by = p_user and w.owner_id <> p_user) then 'SHARED_CONTRIBUTIONS' end
    ], null)),
    'warnings', jsonb_build_object(
      'liveSites', (select count(*) from public.hosted_sites s join public.workspaces w on w.id = s.workspace_id where w.owner_id = p_user and s.live),
      'customDomains', (select count(*) from public.custom_domains d join public.workspaces w on w.id = d.workspace_id where w.owner_id = p_user),
      'credits', coalesce((select greatest(c.balance - c.reserved, 0) from makeborne_private.credit_wallets c where c.user_id = p_user), 0),
      'portalClients', (select count(*) from public.client_portal_access a join public.workspaces w on w.id = a.workspace_id
        where w.owner_id = p_user and a.revoked_at is null and a.accepted_at is not null),
      'otherWorkspaces', (select count(*) from public.workspace_members m where m.user_id = p_user),
      'mailboxes', (select count(*) from public.mail_accounts a where a.user_id = p_user and a.status <> 'disconnected'),
      'github', exists(select 1 from public.github_connections g where g.user_id = p_user)
    ));
$$;

-- Generation or publication work still running for the account: the job waits.
create function makeborne_private.account_deletion_busy(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.generation_jobs j join public.workspaces w on w.id = j.workspace_id
      where w.owner_id = p_user and j.status in ('queued','running','awaiting_reconciliation'))
    or exists(select 1 from makeborne_private.ai_operations o where o.actor = p_user and o.status = 'active' and o.expires_at > now())
    or exists(select 1 from makeborne_private.publication_preparations p where p.actor_id = p_user and p.state in ('queued','running'));
$$;

-- Remaining rows that would stop the sign-in record from being removed (references
-- without ON DELETE behaviour). Table names and counts only.
create function makeborne_private.account_deletion_residuals(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record; n bigint; result jsonb := '[]'::jsonb;
begin
  for c in select con.conrelid::regclass::text as rel, a.attname as col
    from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f' and con.confrelid = 'auth.users'::regclass and con.confdeltype in ('a','r')
      and array_length(con.conkey, 1) = 1
      and (select n2.nspname from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = con.conrelid) <> 'auth'
  loop
    execute format('select count(*) from %s where %I = $1', c.rel, c.col) into n using p_user;
    if n > 0 then result := result || jsonb_build_array(jsonb_build_object('table', c.rel, 'column', c.col, 'rows', n)); end if;
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Status, deletion request and cancellation (called with the session's user)
-- ---------------------------------------------------------------------------
create function public.makeborne_account_rights_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'deletion', (select jsonb_build_object('id', r.id, 'state', r.state, 'requestedAt', r.requested_at, 'scheduledFor', r.scheduled_for,
        'blockedCodes', to_jsonb(r.blocked_codes), 'started', r.steps ?| array['unpublish','lock'],
        'cancellable', r.state = 'scheduled' or (r.state = 'blocked' and not (r.steps ?| array['lock','unpublish'])))
      from makeborne_private.account_deletion_requests r where r.user_id = p_user and r.state in ('scheduled','processing','blocked')),
    'exports', coalesce((select jsonb_agg(e order by (e->>'requestedAt') desc) from (
        select jsonb_build_object('id', x.id, 'state', case when x.state = 'ready' and x.expires_at <= now() then 'expired' else x.state end,
          'requestedAt', x.requested_at, 'completedAt', x.completed_at, 'expiresAt', x.expires_at, 'failureCode', x.failure_code,
          'parts', (select coalesce(jsonb_agg(jsonb_build_object('part', p->'part', 'bytes', p->'bytes') order by (p->>'part')::int), '[]'::jsonb)
            from jsonb_array_elements(x.parts) p)) e
        from makeborne_private.account_export_requests x where x.user_id = p_user order by x.requested_at desc limit 5) q), '[]'::jsonb),
    'nextExportAt', (select max(x.requested_at) + interval '24 hours' from makeborne_private.account_export_requests x
      where x.user_id = p_user and x.state <> 'failed' and x.requested_at > now() - interval '24 hours'),
    'checks', makeborne_private.account_deletion_blockers(p_user));
$$;

create function public.makeborne_account_deletion_request(p_user uuid, p_key uuid, p_grace_days integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests; checks jsonb; v_days integer;
begin
  if p_user is null or p_key is null or p_grace_days is null then raise exception 'Invalid deletion request' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u where u.id = p_user) then raise exception 'Account not found' using errcode='P0002'; end if;
  v_days := least(greatest(p_grace_days, 1), 30);
  perform pg_advisory_xact_lock(hashtextextended('makeborne.account_deletion:' || p_user::text, 0));
  select * into r from makeborne_private.account_deletion_requests where user_id = p_user and state in ('scheduled','processing') limit 1;
  if found then return jsonb_build_object('status', r.state, 'id', r.id, 'scheduledFor', r.scheduled_for); end if;
  checks := makeborne_private.account_deletion_blockers(p_user);
  if jsonb_array_length(checks->'blockers') > 0 then
    return jsonb_build_object('status', 'refused', 'blockers', checks->'blockers');
  end if;
  select * into r from makeborne_private.account_deletion_requests where user_id = p_user and state = 'blocked' limit 1;
  if found then
    if r.steps ?| array['lock','unpublish'] then return jsonb_build_object('status', 'blocked', 'id', r.id); end if;
    update makeborne_private.account_deletion_requests set state = 'scheduled', blocked_codes = '{}', last_code = null,
      scheduled_for = greatest(scheduled_for, now()) where id = r.id returning * into r;
    perform makeborne_private.account_rights_log(r.id, 'deletion', 'rescheduled');
    return jsonb_build_object('status', 'scheduled', 'id', r.id, 'scheduledFor', r.scheduled_for);
  end if;
  insert into makeborne_private.account_deletion_requests(user_id, request_key, grace_days, scheduled_for)
  values(p_user, p_key, v_days, now() + make_interval(days => v_days))
  on conflict (user_id, request_key) where user_id is not null do nothing returning * into r;
  if not found then
    -- Same request key replayed after a cancellation: never resurrect it silently.
    return jsonb_build_object('status', 'replayed');
  end if;
  perform makeborne_private.account_rights_log(r.id, 'deletion', 'scheduled');
  return jsonb_build_object('status', 'scheduled', 'id', r.id, 'scheduledFor', r.scheduled_for);
end $$;

create function public.makeborne_account_deletion_cancel(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended('makeborne.account_deletion:' || p_user::text, 0));
  update makeborne_private.account_deletion_requests set state = 'cancelled', cancelled_at = now(), lease = null, lease_until = null
   where user_id = p_user and (state = 'scheduled' or (state = 'blocked' and not (steps ?| array['lock','unpublish'])))
   returning * into r;
  if found then
    perform makeborne_private.account_rights_log(r.id, 'deletion', 'cancelled');
    return jsonb_build_object('status', 'cancelled', 'id', r.id);
  end if;
  if exists(select 1 from makeborne_private.account_deletion_requests where user_id = p_user and state in ('processing','blocked')) then
    return jsonb_build_object('status', 'started');
  end if;
  return jsonb_build_object('status', 'none');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Deletion job (cron / operator). Lease-protected, idempotent, resumable.
-- Order: recheck -> lock (app: block sign-in) -> unpublish -> domains (app) ->
-- disconnect -> retain -> erase -> storage (app) -> auth (app) -> finish.
-- ---------------------------------------------------------------------------
create function makeborne_private.account_deletion_leased(p_request uuid, p_lease uuid) returns makeborne_private.account_deletion_requests
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests;
begin
  select * into r from makeborne_private.account_deletion_requests where id = p_request for update;
  if not found or r.state <> 'processing' or r.lease is distinct from p_lease or r.lease_until < now() then
    raise exception 'Deletion lease lost' using errcode='MBD10';
  end if;
  return r;
end $$;

create function public.makeborne_account_deletion_claim(p_lease uuid, p_request uuid default null, p_seconds integer default 240) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests;
begin
  if p_lease is null then raise exception 'Lease required' using errcode='22023'; end if;
  select * into r from makeborne_private.account_deletion_requests
   where (p_request is null or id = p_request)
     and ((state = 'scheduled' and scheduled_for <= now()) or (state = 'processing' and lease_until < now()))
   order by scheduled_for limit 1 for update skip locked;
  if not found then return null; end if;
  update makeborne_private.account_deletion_requests set state = 'processing', lease = p_lease,
    lease_until = now() + make_interval(secs => least(greatest(p_seconds, 30), 900)), attempts = attempts + 1,
    started_at = coalesce(started_at, now())
   where id = r.id returning * into r;
  perform makeborne_private.account_rights_log(r.id, 'deletion', 'claimed');
  return jsonb_build_object('id', r.id, 'userId', r.user_id, 'subjectRef', r.subject_ref, 'steps', r.steps, 'attempts', r.attempts,
    'workspaceIds', to_jsonb(coalesce(r.workspace_ids, '{}')));
end $$;

create function public.makeborne_account_deletion_mark(p_request uuid, p_lease uuid, p_step text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests;
begin
  if p_step not in ('lock','domains','storage','auth') then raise exception 'Unknown step' using errcode='22023'; end if;
  r := makeborne_private.account_deletion_leased(p_request, p_lease);
  if not r.steps ? p_step then
    update makeborne_private.account_deletion_requests set steps = steps || jsonb_build_object(p_step, now()) where id = r.id;
    perform makeborne_private.account_rights_log(r.id, 'deletion', 'step_' || p_step);
  end if;
  return jsonb_build_object('step', p_step, 'outcome', 'done');
end $$;

create function public.makeborne_account_deletion_release(p_request uuid, p_lease uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update makeborne_private.account_deletion_requests set lease_until = now() - interval '1 second', last_code = p_code
   where id = p_request and state = 'processing' and lease = p_lease;
  if found then perform makeborne_private.account_rights_log(p_request, 'deletion', 'released', p_code); end if;
end $$;

create function public.makeborne_account_deletion_step(p_request uuid, p_lease uuid, p_step text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests; u uuid; s uuid; ws uuid[]; checks jsonb; residual jsonb;
  v_until timestamptz := now() + interval '10 years'; n bigint;
begin
  r := makeborne_private.account_deletion_leased(p_request, p_lease);
  u := r.user_id; s := r.subject_ref;
  if r.steps ? p_step then return jsonb_build_object('step', p_step, 'outcome', 'done'); end if;
  if p_step <> 'recheck' and not r.steps ? 'recheck' then raise exception 'Recheck first' using errcode='MBD11'; end if;
  ws := coalesce(r.workspace_ids, '{}');

  if p_step = 'recheck' then
    checks := makeborne_private.account_deletion_blockers(u);
    if jsonb_array_length(checks->'blockers') > 0 then
      update makeborne_private.account_deletion_requests set state = 'blocked', lease = null, lease_until = null,
        blocked_codes = array(select jsonb_array_elements_text(checks->'blockers')), last_code = 'BLOCKED' where id = r.id;
      perform makeborne_private.account_rights_log(r.id, 'deletion', 'blocked', 'BLOCKED');
      return jsonb_build_object('step', p_step, 'outcome', 'blocked', 'blockers', checks->'blockers');
    end if;
    if makeborne_private.account_deletion_busy(u) then
      return jsonb_build_object('step', p_step, 'outcome', 'busy');
    end if;
    update makeborne_private.account_deletion_requests set workspace_ids = array(select id from public.workspaces where owner_id = u order by id)
     where id = r.id returning workspace_ids into ws;

  elsif p_step = 'unpublish' then
    -- Everything public goes first: live sites, extra routes, review links, portal logins.
    ws := ws || array(select id from public.workspaces where owner_id = u and not (id = any(ws)));
    update makeborne_private.account_deletion_requests set workspace_ids = ws where id = r.id;
    update public.hosted_sites set live = false, updated_at = now() where workspace_id = any(ws) and live;
    delete from makeborne_hosting.site_routes t using public.hosted_sites h where h.artifact_id = t.artifact_id and h.workspace_id = any(ws);
    update public.client_review_links set revoked_at = now() where workspace_id = any(ws) and revoked_at is null;
    update public.client_portal_access set revoked_at = now(), updated_at = now() where workspace_id = any(ws) and revoked_at is null;

  elsif p_step = 'disconnect' then
    -- Same effect as the existing disconnect actions: tokens gone, sequences paused.
    delete from makeborne_private.mail_tokens t using public.mail_accounts a where a.id = t.account_id and a.user_id = u;
    update public.mail_enrollments e set status = 'paused', last_error = 'Mailbox disconnected.', updated_at = now()
      from public.mail_accounts a where a.id = e.account_id and a.user_id = u and e.status = 'active';
    update public.mail_accounts set status = 'disconnected', last_error = null, updated_at = now() where user_id = u and status <> 'disconnected';
    delete from public.github_website_links where user_id = u;
    delete from public.github_connections where user_id = u;

  elsif p_step = 'retain' then
    insert into makeborne_private.retained_account_records(subject_ref, source_table, source_key, record, reason, retain_until)
    select s, src, key, makeborne_private.account_pseudonymize(rec, u, s), reason, v_until from (
      select 'billing_memberships' src, x.membership_id key, to_jsonb(x) rec, 'financial' reason from public.billing_memberships x where x.user_id = u
      union all select 'billing_checkouts', x.request_id::text, to_jsonb(x) - 'purchase_url', 'financial' from public.billing_checkouts x where x.user_id = u
      union all select 'plan_payments', x.payment_id, to_jsonb(x), 'financial' from makeborne_private.plan_payments x where x.user_id = u
      union all select 'plan_periods', x.membership_id || '@' || x.period_start::text, to_jsonb(x), 'financial' from makeborne_private.plan_periods x where x.user_id = u
      union all select 'plan_observations', x.id::text, to_jsonb(x), 'financial' from makeborne_private.plan_observations x where x.user_id = u
      union all select 'plan_credit_issues', x.id::text, to_jsonb(x), 'financial' from makeborne_private.plan_credit_issues x where x.user_id = u
      union all select 'membership_revocations', x.payment_id || '@' || x.membership_id, to_jsonb(x), 'financial' from makeborne_private.membership_revocations x where x.user_id = u
      union all select 'refund_cases', x.id::text, to_jsonb(x), 'financial' from makeborne_private.refund_cases x where x.user_id = u
      union all select 'topup_orders', x.id::text, to_jsonb(x) - array['checkout_url','checkout_request'], 'financial' from makeborne_private.topup_orders x where x.user_id = u
      union all select 'credit_ledger', x.id::text, to_jsonb(x), 'financial' from public.credit_ledger x where x.user_id = u
      union all select 'credit_lots', x.id::text, to_jsonb(x), 'financial' from makeborne_private.credit_lots x where x.user_id = u
      union all select 'credit_lot_withholds', x.id::text, to_jsonb(x), 'financial' from makeborne_private.credit_lot_withholds x where x.user_id = u
      union all select 'credit_lot_migration', 'migration', to_jsonb(x), 'financial' from makeborne_private.credit_lot_migration x where x.user_id = u
      union all select 'credit_wallets', 'wallet', to_jsonb(x), 'financial' from makeborne_private.credit_wallets x where x.user_id = u
      union all select 'credit_reservations', x.reference, to_jsonb(x), 'financial' from makeborne_private.credit_reservations x where x.user_id = u
      union all select 'autotopup_authorizations', x.id::text, to_jsonb(x), 'consent' from makeborne_private.autotopup_authorizations x where x.user_id = u
      union all select 'autotopup_attempts', x.id::text, to_jsonb(x), 'financial' from makeborne_private.autotopup_attempts x where x.user_id = u
      union all select 'claude_pilot_runs', x.id::text, to_jsonb(x) - array['result'], 'accounting' from public.claude_pilot_runs x where x.user_id = u
      -- Cost-accounting evidence of the owned workspaces (amounts and hashes, no content).
      union all select 'usage_ledger', x.id::text, to_jsonb(x), 'accounting' from public.usage_ledger x where x.workspace_id = any(ws)
      union all select 'budget_reservations', x.id::text, to_jsonb(x), 'accounting' from public.budget_reservations x where x.workspace_id = any(ws)
      union all select 'generation_reservations', x.id::text, to_jsonb(x) - 'authorization_snapshot', 'accounting' from makeborne_private.generation_reservations x where x.workspace_id = any(ws)
      union all select 'generation_provider_outcomes', x.id::text, to_jsonb(x), 'accounting' from makeborne_private.generation_provider_outcomes x where x.workspace_id = any(ws)
      union all select 'generation_job_settlements', x.job_id::text, to_jsonb(x), 'accounting' from makeborne_private.generation_job_settlements x where x.workspace_id = any(ws)
      union all select 'generation_execution_holds', x.job_id::text || '@' || x.dispatch_id::text, to_jsonb(x), 'accounting' from makeborne_private.generation_execution_holds x where x.workspace_id = any(ws)
      union all select 'project_builds', x.job_id::text, to_jsonb(x) - 'receipt', 'accounting' from makeborne_private.project_builds x where x.workspace_id = any(ws)
    ) q
    on conflict (subject_ref, source_table, source_key) do nothing;

  elsif p_step = 'erase' then
    ws := ws || array(select id from public.workspaces where owner_id = u and not (id = any(ws)));
    update makeborne_private.account_deletion_requests set workspace_ids = ws where id = r.id;
    perform set_config('makeborne.account_erasure', r.id::text, true);
    -- Owned workspaces: dependants without ON DELETE behaviour first, then the workspaces.
    delete from makeborne_private.site_view_visitors v using public.hosted_sites h where h.artifact_id = v.artifact_id and h.workspace_id = any(ws);
    delete from makeborne_private.generation_job_outbox where workspace_id = any(ws);
    delete from makeborne_private.generation_execution_holds where workspace_id = any(ws);
    delete from makeborne_private.project_builds where workspace_id = any(ws);
    delete from makeborne_private.preview_sessions where workspace_id = any(ws);
    delete from makeborne_private.generation_job_settlements where workspace_id = any(ws);
    delete from public.usage_ledger where workspace_id = any(ws);
    delete from public.budget_reservations where workspace_id = any(ws);
    delete from makeborne_private.generation_provider_outcomes where workspace_id = any(ws);
    delete from public.generation_jobs where workspace_id = any(ws);
    delete from makeborne_private.generation_dispatches d using makeborne_private.generation_reservations g where g.id = d.reservation_id and g.workspace_id = any(ws);
    delete from makeborne_private.generation_reservations where workspace_id = any(ws);
    delete from makeborne_private.generation_proposals where workspace_id = any(ws);
    delete from makeborne_private.generation_budgets where workspace_id = any(ws);
    delete from makeborne_private.crm_migration_audit where workspace_id = any(ws);
    delete from makeborne_private.workspace_creation_receipts where actor_id = u or workspace_id = any(ws);
    delete from public.workspaces where id = any(ws);
    -- Other people's workspaces: leave them, keep their content with its owner.
    delete from public.workspace_members where user_id = u;
    update public.reviews v set reviewer_id = w.owner_id from public.workspaces w where w.id = v.workspace_id and v.reviewer_id = u;
    update public.artifact_plans v set updated_by = w.owner_id from public.workspaces w where w.id = v.workspace_id and v.updated_by = u;
    update public.hosted_sites v set owner_id = w.owner_id from public.workspaces w where w.id = v.workspace_id and v.owner_id = u;
    update public.audit_events set actor_id = null where actor_id = u;
    delete from makeborne_private.cloud_mutation_receipts where actor_id = u;
    update makeborne_private.generation_reservations v set approved_by = w.owner_id from public.workspaces w where w.id = v.workspace_id and v.approved_by = u;
    update makeborne_private.generation_reservations set released_by = null where released_by = u;
    update makeborne_private.generation_dispatches d set actor_id = w.owner_id from makeborne_private.generation_reservations g, public.workspaces w
      where g.id = d.reservation_id and w.id = g.workspace_id and d.actor_id = u;
    delete from makeborne_private.ai_operations where actor = u;
    delete from public.claude_pilot_runs where user_id = u;
    delete from public.artifact_chat_messages where account_id = u;
    delete from makeborne_private.account_export_requests where user_id = u;
    -- Account-level rows without a reference to the sign-in record: pseudonymize in place.
    delete from makeborne_private.account_privileges where user_id = u;
    update makeborne_private.account_privilege_events set user_id = s where user_id = u;
    update makeborne_private.ai_run_outcomes set user_id = s where user_id = u;
    update makeborne_private.live_provider_calls set user_id = s where user_id = u;
    update makeborne_private.credit_hold_lots set user_id = s where user_id = u;
    update makeborne_private.refund_cases set opened_by = s where opened_by = u;
    update makeborne_private.refund_cases set closed_by = s where closed_by = u;
    perform set_config('makeborne.account_erasure', '', true);
    residual := makeborne_private.account_deletion_residuals(u);
    if jsonb_array_length(residual) > 0 then
      update makeborne_private.account_deletion_requests set steps = steps || jsonb_build_object('erase', now()), state = 'blocked',
        lease = null, lease_until = null, blocked_codes = array['MANUAL_REVIEW'], last_code = 'MANUAL_REVIEW' where id = r.id;
      perform makeborne_private.account_rights_log(r.id, 'deletion', 'blocked', 'MANUAL_REVIEW');
      return jsonb_build_object('step', p_step, 'outcome', 'blocked', 'residual', residual);
    end if;

  elsif p_step = 'finish' then
    if not (r.steps ?& array['recheck','lock','unpublish','domains','disconnect','retain','erase','storage','auth']) then
      raise exception 'Steps incomplete' using errcode='MBD11';
    end if;
    if exists(select 1 from auth.users where id = u) then raise exception 'Sign-in record still present' using errcode='MBD11'; end if;
    update makeborne_private.account_deletion_requests set state = 'completed', completed_at = now(), user_id = null, workspace_ids = null,
      lease = null, lease_until = null, last_code = null, steps = steps || jsonb_build_object('finish', now()) where id = r.id;
    perform makeborne_private.account_rights_log(r.id, 'deletion', 'completed');
    return jsonb_build_object('step', p_step, 'outcome', 'done');
  else
    raise exception 'Unknown step' using errcode='22023';
  end if;

  update makeborne_private.account_deletion_requests set steps = steps || jsonb_build_object(p_step, now()) where id = r.id;
  perform makeborne_private.account_rights_log(r.id, 'deletion', 'step_' || p_step);
  return jsonb_build_object('step', p_step, 'outcome', 'done', 'workspaceIds', to_jsonb(ws));
end $$;

-- Custom domains to detach from the edge provider (ids only), read before erase.
create function public.makeborne_account_deletion_domains(p_request uuid, p_lease uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_deletion_requests;
begin
  r := makeborne_private.account_deletion_leased(p_request, p_lease);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'providerId', d.cloudflare_id))
    from public.custom_domains d where d.workspace_id = any(coalesce(r.workspace_ids, '{}')) and d.cloudflare_id is not null), '[]'::jsonb);
end $$;

-- Retained records past their period (daily cron). Returns how many were removed.
create function public.makeborne_account_retained_purge(p_now timestamptz default now()) returns bigint
language sql security definer set search_path = '' as $$
  with d as (delete from makeborne_private.retained_account_records r where r.retain_until < p_now
    and not exists(select 1 from makeborne_private.retained_account_records h where h.subject_ref = r.subject_ref and h.reason = 'legal_hold')
    returning 1) select count(*) from d;
$$;

-- ---------------------------------------------------------------------------
-- 5. Data export
-- ---------------------------------------------------------------------------
create function public.makeborne_account_export_request(p_user uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_export_requests; v_next timestamptz;
begin
  if p_user is null or p_key is null then raise exception 'Invalid export request' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u where u.id = p_user) then raise exception 'Account not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne.account_export:' || p_user::text, 0));
  select * into r from makeborne_private.account_export_requests where user_id = p_user and request_key = p_key;
  if found then return jsonb_build_object('status', 'existing', 'id', r.id, 'state', r.state); end if;
  select * into r from makeborne_private.account_export_requests where user_id = p_user and state in ('queued','building') limit 1;
  if found then return jsonb_build_object('status', 'in_progress', 'id', r.id, 'state', r.state); end if;
  -- One export a day; a failed export does not count.
  select max(requested_at) + interval '24 hours' into v_next from makeborne_private.account_export_requests
   where user_id = p_user and state <> 'failed' and requested_at > now() - interval '24 hours';
  if v_next is not null then return jsonb_build_object('status', 'limited', 'nextAt', v_next); end if;
  insert into makeborne_private.account_export_requests(user_id, request_key) values(p_user, p_key) returning * into r;
  perform makeborne_private.account_rights_log(r.id, 'export', 'requested');
  return jsonb_build_object('status', 'queued', 'id', r.id, 'state', r.state);
end $$;

create function public.makeborne_account_export_claim(p_lease uuid, p_request uuid default null, p_seconds integer default 280) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_export_requests;
begin
  if p_lease is null then raise exception 'Lease required' using errcode='22023'; end if;
  -- Three attempts at most; a stuck build after that is failed, never retried forever.
  update makeborne_private.account_export_requests set state = 'failed', lease = null, lease_until = null, failure_code = 'ATTEMPTS_EXHAUSTED'
   where state = 'building' and lease_until < now() and attempts >= 3;
  select * into r from makeborne_private.account_export_requests
   where (p_request is null or id = p_request) and (state = 'queued' or (state = 'building' and lease_until < now()))
   order by requested_at limit 1 for update skip locked;
  if not found then return null; end if;
  update makeborne_private.account_export_requests set state = 'building', lease = p_lease, attempts = attempts + 1,
    lease_until = now() + make_interval(secs => least(greatest(p_seconds, 30), 900)), started_at = coalesce(started_at, now())
   where id = r.id returning * into r;
  perform makeborne_private.account_rights_log(r.id, 'export', 'claimed');
  return jsonb_build_object('id', r.id, 'userId', r.user_id, 'attempts', r.attempts, 'requestedAt', r.requested_at);
end $$;

create function public.makeborne_account_export_complete(p_request uuid, p_lease uuid, p_parts jsonb, p_summary jsonb, p_hours integer default 72) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r makeborne_private.account_export_requests;
begin
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Invalid export result' using errcode='22023'; end if;
  update makeborne_private.account_export_requests set state = 'ready', lease = null, lease_until = null, parts = p_parts, summary = p_summary,
    completed_at = now(), expires_at = now() + make_interval(hours => least(greatest(p_hours, 1), 168)), failure_code = null
   where id = p_request and state = 'building' and lease = p_lease and lease_until >= now() returning * into r;
  if not found then raise exception 'Export lease lost' using errcode='MBD10'; end if;
  perform makeborne_private.account_rights_log(r.id, 'export', 'ready');
  return jsonb_build_object('id', r.id, 'expiresAt', r.expires_at);
end $$;

create function public.makeborne_account_export_fail(p_request uuid, p_lease uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update makeborne_private.account_export_requests set state = 'failed', lease = null, lease_until = null, failure_code = p_code
   where id = p_request and state = 'building' and lease = p_lease;
  if found then perform makeborne_private.account_rights_log(p_request, 'export', 'failed', p_code); end if;
end $$;

-- One prepared part for its owner, only while it is ready and unexpired.
create function public.makeborne_account_export_part(p_user uuid, p_request uuid, p_part integer) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  select p->>'path' into v_path from makeborne_private.account_export_requests x, jsonb_array_elements(x.parts) p
   where x.id = p_request and x.user_id = p_user and x.state = 'ready' and x.expires_at > now() and (p->>'part')::int = p_part;
  if v_path is null then return null; end if;
  perform makeborne_private.account_rights_log(p_request, 'export', 'downloaded');
  return v_path;
end $$;

-- Ready exports past expiry (cron removes the files, then marks them expired).
create function public.makeborne_account_export_due_expiry(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'paths', (select jsonb_agg(p->>'path') from jsonb_array_elements(x.parts) p))), '[]'::jsonb)
  from (select * from makeborne_private.account_export_requests where state = 'ready' and expires_at <= now() order by expires_at limit p_limit) x;
$$;

create function public.makeborne_account_export_mark_expired(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update makeborne_private.account_export_requests set state = 'expired', parts = '[]'::jsonb where id = p_request and state = 'ready' and expires_at <= now();
  if found then perform makeborne_private.account_rights_log(p_request, 'export', 'expired'); end if;
end $$;

-- Rows for one export source, scoped to what this account owns. Secrets (token
-- hashes, ciphertexts, provider checkout links, internal cost/vendor fields) and
-- other accounts' private data are never selected.
create function public.makeborne_account_export_rows(p_user uuid, p_source text, p_offset integer default 0, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare owned uuid[]; lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000); off integer := greatest(coalesce(p_offset, 0), 0); result jsonb;
begin
  if p_user is null then raise exception 'Account required' using errcode='22023'; end if;
  owned := array(select id from public.workspaces where owner_id = p_user order by id);
  case p_source
  when 'account' then
    select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'phone', nullif(u.phone, ''), 'createdAt', u.created_at,
      'updatedAt', u.updated_at, 'emailConfirmedAt', u.email_confirmed_at, 'lastSignInAt', u.last_sign_in_at,
      'profile', coalesce(u.raw_user_meta_data, '{}'::jsonb) - array['provider_token','provider_refresh_token'],
      'signInMethods', coalesce((select jsonb_agg(jsonb_build_object('provider', i.provider, 'email', i.email, 'createdAt', i.created_at, 'lastSignInAt', i.last_sign_in_at) order by i.created_at)
        from auth.identities i where i.user_id = u.id), '[]'::jsonb)))
    into result from auth.users u where u.id = p_user and off = 0;
  when 'account_privileges' then
    select jsonb_agg(to_jsonb(x)) into result from makeborne_private.account_privileges x where x.user_id = p_user and off = 0;
  when 'workspaces' then
    select jsonb_agg(q.j order by q.j->>'createdAt') into result from (
      select jsonb_build_object('id', w.id, 'name', w.name, 'relationship', 'owner', 'createdAt', w.created_at, 'siteBadge', w.site_badge) j
        from public.workspaces w where w.owner_id = p_user
      union all select jsonb_build_object('id', w.id, 'name', w.name, 'relationship', m.role, 'createdAt', m.created_at)
        from public.workspace_members m join public.workspaces w on w.id = m.workspace_id where m.user_id = p_user and w.owner_id <> p_user
    ) q where off = 0;
  when 'workspace_members' then
    select jsonb_agg(jsonb_build_object('workspaceId', m.workspace_id, 'role', m.role, 'createdAt', m.created_at,
      'account', case when m.user_id = p_user then 'you' else 'another account' end) order by m.created_at) into result
    from public.workspace_members m where m.workspace_id = any(owned) and off = 0;
  when 'clients' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.clients where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'contacts' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.contacts where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  -- CRM and client-knowledge tables from feature branches: exported when present.
  when 'crm_next_steps','crm_suppressions','crm_site_checks','crm_duplicate_dismissals','client_facts','client_fact_revisions',
       'client_fact_evidence','knowledge_snapshots','client_research_pages','client_research_briefs' then
    if to_regclass('public.' || p_source) is null then return '[]'::jsonb; end if;
    execute format('select jsonb_agg(to_jsonb(x) - ''search'') from (select * from public.%I where workspace_id = any($1) order by 1, 2 offset $2 limit $3) x', p_source)
      into result using owned, off, lim;
  when 'client_portal_access' then select jsonb_agg(to_jsonb(x) - 'token_hash') into result from (select * from public.client_portal_access where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'client_portal_sites' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.client_portal_sites where workspace_id = any(owned) order by created_at, artifact_id offset off limit lim) x;
  when 'client_portal_changes' then select jsonb_agg(to_jsonb(x) - 'request_key') into result from (select * from public.client_portal_changes where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'projects' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.projects where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'tasks' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.tasks where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'sources' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.sources where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'style_profiles' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.style_profiles where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'brand_kits' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.brand_kits where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'artifacts' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.artifacts where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'artifact_versions' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.artifact_versions where workspace_id = any(owned) order by artifact_id, version_number offset off limit lim) x;
  when 'artifact_plans' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.artifact_plans where workspace_id = any(owned) order by updated_at, artifact_id offset off limit lim) x;
  when 'assets' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.assets where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'reviews' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.reviews where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'published_releases' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.published_releases where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'client_review_links' then select jsonb_agg(to_jsonb(x) - 'token_hash') into result from (select * from public.client_review_links where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'client_review_comments' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.client_review_comments where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'client_review_views' then select jsonb_agg(to_jsonb(x) - 'session_id') into result from (select * from public.client_review_views where workspace_id = any(owned) order by started_at, id offset off limit lim) x;
  when 'hosted_sites' then select jsonb_agg(to_jsonb(x) - array['html','isolated_html','request_id']) into result from (select * from public.hosted_sites where workspace_id = any(owned) order by updated_at, artifact_id offset off limit lim) x;
  when 'custom_domains' then select jsonb_agg(to_jsonb(x) - 'cloudflare_id') into result from (select * from public.custom_domains where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'site_enquiries' then select jsonb_agg(to_jsonb(x) - array['source_hash','request_id']) into result from (select * from public.site_enquiries where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'site_view_days' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.site_view_days where workspace_id = any(owned) order by day, artifact_id offset off limit lim) x;
  when 'generation_jobs' then select jsonb_agg(jsonb_build_object('id', x.id, 'workspaceId', x.workspace_id, 'projectId', x.project_id, 'artifactId', x.artifact_id,
      'kind', x.kind, 'status', x.status, 'stage', x.stage, 'createdAt', x.created_at, 'updatedAt', x.updated_at)) into result
    from (select * from public.generation_jobs where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'mail_accounts' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.mail_accounts where user_id = p_user order by created_at, id offset off limit lim) x;
  when 'mail_templates' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.mail_templates where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'mail_sequences' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.mail_sequences where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'mail_enrollments' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.mail_enrollments where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'mail_messages' then select jsonb_agg(to_jsonb(x) - array['provider_message_id']) into result from (select * from public.mail_messages where workspace_id = any(owned) order by created_at, id offset off limit lim) x;
  when 'chat_messages' then select jsonb_agg(jsonb_build_object('id', x.id, 'workspaceId', x.workspace_id, 'artifactId', x.artifact_id, 'role', x.role, 'body', x.body, 'createdAt', x.created_at)) into result
    from (select * from public.artifact_chat_messages where account_id = p_user order by sequence offset off limit lim) x;
  when 'audit_events' then select jsonb_agg(q.j) into result from (
      select case when x.workspace_id = any(owned) then to_jsonb(x) else jsonb_build_object('workspaceId', x.workspace_id, 'action', x.action, 'outcome', x.outcome, 'createdAt', x.created_at) end j
      from public.audit_events x where x.workspace_id = any(owned) or x.actor_id = p_user order by x.created_at, x.id offset off limit lim) q;
  when 'github_connection' then select jsonb_agg(jsonb_build_object('login', x.login, 'githubUserId', x.github_user_id, 'updatedAt', x.updated_at)) into result
    from public.github_connections x where x.user_id = p_user and off = 0;
  when 'github_website_links' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.github_website_links where user_id = p_user order by updated_at offset off limit lim) x;
  when 'billing_memberships' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.billing_memberships where user_id = p_user order by checked_at offset off limit lim) x;
  when 'billing_checkouts' then select jsonb_agg(to_jsonb(x) - 'purchase_url') into result from (select * from public.billing_checkouts where user_id = p_user order by created_at offset off limit lim) x;
  when 'plan_payments' then select jsonb_agg(to_jsonb(x) - array['evidence','consumed_exposure_credits','attribution']) into result from (select * from makeborne_private.plan_payments where user_id = p_user order by paid_at, payment_id offset off limit lim) x;
  when 'plan_periods' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.plan_periods where user_id = p_user order by period_start offset off limit lim) x;
  when 'membership_revocations' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.membership_revocations where user_id = p_user order by revoked_at offset off limit lim) x;
  when 'refund_cases' then select jsonb_agg(to_jsonb(x) - array['opened_by','closed_by']) into result from (select * from makeborne_private.refund_cases where user_id = p_user order by opened_at offset off limit lim) x;
  when 'topup_orders' then select jsonb_agg(jsonb_build_object('id', x.id, 'packId', x.pack_id, 'credits', x.credits, 'priceCents', x.price_cents, 'state', x.state,
      'granted', x.granted, 'paymentId', x.payment_id, 'createdAt', x.created_at)) into result
    from (select * from makeborne_private.topup_orders where user_id = p_user order by created_at offset off limit lim) x;
  when 'credit_wallet' then select jsonb_agg(to_jsonb(x)) into result from makeborne_private.credit_wallets x where x.user_id = p_user and off = 0;
  when 'credit_preferences' then select jsonb_agg(to_jsonb(x)) into result from makeborne_private.credit_preferences x where x.user_id = p_user and off = 0;
  when 'credit_ledger' then select jsonb_agg(to_jsonb(x)) into result from (select * from public.credit_ledger where user_id = p_user order by created_at, id offset off limit lim) x;
  when 'credit_lots' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.credit_lots where user_id = p_user order by created_at, id offset off limit lim) x;
  when 'credit_lot_withholds' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.credit_lot_withholds where user_id = p_user order by created_at, id offset off limit lim) x;
  when 'autotopup_authorizations' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.autotopup_authorizations where user_id = p_user order by authorized_at offset off limit lim) x;
  when 'autotopup_attempts' then select jsonb_agg(to_jsonb(x)) into result from (select * from makeborne_private.autotopup_attempts where user_id = p_user order by created_at offset off limit lim) x;
  when 'ai_operations' then select jsonb_agg(jsonb_build_object('id', x.id, 'workspaceId', x.workspace_id, 'artifactId', x.artifact_id, 'kind', x.kind, 'effort', x.effort,
      'status', x.status, 'authorizedCredits', x.authorized_credits, 'chargedCredits', x.charged_credits, 'createdAt', x.created_at, 'request', x.request_context)) into result
    from (select * from makeborne_private.ai_operations where actor = p_user order by created_at, id offset off limit lim) x;
  when 'export_requests' then select jsonb_agg(jsonb_build_object('id', x.id, 'state', x.state, 'requestedAt', x.requested_at, 'completedAt', x.completed_at)) into result
    from (select * from makeborne_private.account_export_requests where user_id = p_user order by requested_at offset off limit lim) x;
  when 'deletion_requests' then select jsonb_agg(jsonb_build_object('id', x.id, 'state', x.state, 'requestedAt', x.requested_at, 'scheduledFor', x.scheduled_for, 'cancelledAt', x.cancelled_at)) into result
    from (select * from makeborne_private.account_deletion_requests where user_id = p_user order by requested_at offset off limit lim) x;
  else
    raise exception 'Unknown export source' using errcode='22023';
  end case;
  return coalesce(result, '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants: server key only
-- ---------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'makeborne_private.account_rights_log(uuid,text,text,text)', 'makeborne_private.account_pseudonymize(jsonb,uuid,uuid)',
    'makeborne_private.account_deletion_blockers(uuid)', 'makeborne_private.account_deletion_busy(uuid)', 'makeborne_private.account_deletion_residuals(uuid)',
    'makeborne_private.account_deletion_leased(uuid,uuid)'] loop
    execute format('alter function %s owner to postgres', f);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public.makeborne_account_rights_status(uuid)', 'public.makeborne_account_deletion_request(uuid,uuid,integer)',
    'public.makeborne_account_deletion_cancel(uuid)', 'public.makeborne_account_deletion_claim(uuid,uuid,integer)',
    'public.makeborne_account_deletion_mark(uuid,uuid,text)', 'public.makeborne_account_deletion_release(uuid,uuid,text)',
    'public.makeborne_account_deletion_step(uuid,uuid,text)', 'public.makeborne_account_deletion_domains(uuid,uuid)',
    'public.makeborne_account_retained_purge(timestamptz)',
    'public.makeborne_account_export_request(uuid,uuid)', 'public.makeborne_account_export_claim(uuid,uuid,integer)',
    'public.makeborne_account_export_complete(uuid,uuid,jsonb,jsonb,integer)', 'public.makeborne_account_export_fail(uuid,uuid,text)',
    'public.makeborne_account_export_part(uuid,uuid,integer)', 'public.makeborne_account_export_due_expiry(integer)',
    'public.makeborne_account_export_mark_expired(uuid)', 'public.makeborne_account_export_rows(uuid,text,integer,integer)'] loop
    execute format('alter function %s owner to postgres', f);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
