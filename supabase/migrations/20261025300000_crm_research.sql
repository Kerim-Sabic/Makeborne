-- CRM research (feature/crm-research, flag MAKEBORNE_CRM_RESEARCH, off by default).
-- Additive only: four new tables and one function; no existing table, trigger,
-- policy, grant or function changes. The CRM write protocol on public.clients
-- is untouched (the next-step text lives beside it, not inside outreach).
--
-- * crm_site_checks: the result of a deterministic website check of a prospect's
--   or client's PUBLIC site (robots.txt honoured, no sign-in pages, bounded),
--   with the score, every finding's evidence (url + checked_at + quote/measured
--   value) and what wasn't checked. A check made before the business is a
--   client has client_id null and expires after 30 days; attaching it to a
--   client keeps it until the client (or the check) is deleted.
-- * crm_duplicate_dismissals: "these two clients are not the same business".
-- * crm_next_steps: the next action's text for a client (its due date stays in
--   outreach.nextFollowUp), with an integer revision for compare-and-set.
-- * crm_suppressions: the workspace's do-not-contact list (email address or
--   whole domain). Kept, not deleted, when someone objects (ICO B2B guidance).
--
-- Access: members read their workspace's rows; owners and editors (verified
-- creation membership, makeborne_private.can_edit) write them under RLS;
-- reviewers and other workspaces see or change nothing. Client deletion
-- cascades to every row about that client.
begin;

create table public.crm_site_checks (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid,
 url text not null check(length(url) between 1 and 2048),
 final_url text check(final_url is null or (length(final_url) between 8 and 2048 and final_url ~ '^https?://')),
 status text not null check(status in ('checked','inaccessible','no_website')),
 reason text check(reason is null or length(reason) <= 40),
 score integer check(score is null or score between 0 and 100),
 result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text) <= 65536),
 checker_version text not null check(checker_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
 checked_at timestamptz not null,
 expires_at timestamptz,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 foreign key(client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade,
 -- Prospect checks (no client yet) always expire; client checks never do.
 check((client_id is null) = (expires_at is not null)),
 check(expires_at is null or expires_at <= checked_at + interval '31 days')
);
create index crm_site_checks_client on public.crm_site_checks(workspace_id, client_id, checked_at desc);
create index crm_site_checks_expiry on public.crm_site_checks(expires_at) where expires_at is not null;

create table public.crm_duplicate_dismissals (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_a uuid not null,
 client_b uuid not null,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 primary key(workspace_id, client_a, client_b),
 check(client_a < client_b),
 foreign key(client_a, workspace_id) references public.clients(id, workspace_id) on delete cascade,
 foreign key(client_b, workspace_id) references public.clients(id, workspace_id) on delete cascade
);

create table public.crm_next_steps (
 client_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 text text not null default '' check(length(text) <= 200 and text !~ '[<>]'),
 revision integer not null default 1 check(revision >= 1),
 updated_by uuid not null default auth.uid(),
 updated_at timestamptz not null default now(),
 foreign key(client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade
);
create index crm_next_steps_workspace on public.crm_next_steps(workspace_id);

create table public.crm_suppressions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 kind text not null check(kind in ('email','domain')),
 value text not null check(length(value) between 3 and 320 and value = lower(value) and value !~ '\s'
  and ((kind='email' and value ~ '^[^@]+@[^@]+\.[^@]+$') or (kind='domain' and value ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'))),
 reason text not null default '' check(length(reason) <= 200 and reason !~ '[<>]'),
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 unique(workspace_id, kind, value)
);

-- ---------- access ----------
alter table public.crm_site_checks enable row level security;
alter table public.crm_duplicate_dismissals enable row level security;
alter table public.crm_next_steps enable row level security;
alter table public.crm_suppressions enable row level security;
revoke all on public.crm_site_checks, public.crm_duplicate_dismissals, public.crm_next_steps, public.crm_suppressions from public, anon, authenticated;
grant select, insert, delete on public.crm_site_checks, public.crm_duplicate_dismissals, public.crm_suppressions to authenticated;
-- A check can only be attached to a client (client_id + expires_at), nothing else about it changes.
grant update(client_id, expires_at) on public.crm_site_checks to authenticated;
grant select, insert, update, delete on public.crm_next_steps to authenticated;
grant all on public.crm_site_checks, public.crm_duplicate_dismissals, public.crm_next_steps, public.crm_suppressions to service_role;

do $$ declare item text; begin
 foreach item in array array['crm_site_checks','crm_duplicate_dismissals','crm_next_steps','crm_suppressions'] loop
  execute format('create policy crm_member_read on public.%I for select to authenticated using (makeborne_private.can_read(workspace_id))', item);
  execute format('create policy crm_editor_insert on public.%I for insert to authenticated with check (makeborne_private.can_edit(workspace_id))', item);
  execute format('create policy crm_editor_delete on public.%I for delete to authenticated using (makeborne_private.can_edit(workspace_id))', item);
 end loop;
end $$;
-- Rows are written as the acting person, never on someone else's behalf.
alter policy crm_editor_insert on public.crm_site_checks with check (makeborne_private.can_edit(workspace_id) and created_by = (select auth.uid()));
alter policy crm_editor_insert on public.crm_duplicate_dismissals with check (makeborne_private.can_edit(workspace_id) and created_by = (select auth.uid()));
alter policy crm_editor_insert on public.crm_suppressions with check (makeborne_private.can_edit(workspace_id) and created_by = (select auth.uid()));
alter policy crm_editor_insert on public.crm_next_steps with check (makeborne_private.can_edit(workspace_id) and updated_by = (select auth.uid()));
create policy crm_editor_attach on public.crm_site_checks for update to authenticated
 using (makeborne_private.can_edit(workspace_id) and client_id is null)
 with check (makeborne_private.can_edit(workspace_id) and client_id is not null and expires_at is null);
create policy crm_editor_update on public.crm_next_steps for update to authenticated
 using (makeborne_private.can_edit(workspace_id))
 with check (makeborne_private.can_edit(workspace_id) and updated_by = (select auth.uid()));

-- ---------- next step: compare-and-set ----------
-- p_expected_revision is the revision the person saw (0 = there was none).
-- A stale revision raises PT409 and changes nothing. Runs as the caller (RLS applies).
create function public.makeborne_crm_next_step_set(p_workspace uuid, p_client uuid, p_text text, p_expected_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_row public.crm_next_steps; v_text text := btrim(coalesce(p_text, ''));
begin
 if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Expected revision required' using errcode='22023'; end if;
 if not makeborne_private.can_edit(p_workspace) then raise exception 'Editors only' using errcode='42501'; end if;
 if not exists(select 1 from public.clients c where c.id = p_client and c.workspace_id = p_workspace) then raise exception 'Client unavailable' using errcode='P0002'; end if;
 if p_expected_revision = 0 then
  insert into public.crm_next_steps(client_id, workspace_id, text, revision, updated_by, updated_at)
  values (p_client, p_workspace, v_text, 1, auth.uid(), now())
  on conflict (client_id) do nothing
  returning * into v_row;
 else
  update public.crm_next_steps s set text = v_text, revision = s.revision + 1, updated_by = auth.uid(), updated_at = now()
  where s.client_id = p_client and s.workspace_id = p_workspace and s.revision = p_expected_revision
  returning * into v_row;
 end if;
 if v_row.client_id is null then raise exception 'Next step changed' using errcode='PT409'; end if;
 return jsonb_build_object('text', v_row.text, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
end $$;
revoke all on function public.makeborne_crm_next_step_set(uuid, uuid, text, integer) from public, anon;
grant execute on function public.makeborne_crm_next_step_set(uuid, uuid, text, integer) to authenticated, service_role;

-- ---------- retention ----------
-- Expired prospect checks (never attached to a client). Service role only; the
-- app also ignores expired rows when reading. Scheduling is an ops decision.
create function public.makeborne_crm_purge_expired_checks() returns integer
language sql security definer set search_path='' as $$
 with gone as (delete from public.crm_site_checks where expires_at is not null and expires_at < now() returning 1) select count(*)::integer from gone;
$$;
revoke all on function public.makeborne_crm_purge_expired_checks() from public, anon, authenticated;
grant execute on function public.makeborne_crm_purge_expired_checks() to service_role;

commit;
