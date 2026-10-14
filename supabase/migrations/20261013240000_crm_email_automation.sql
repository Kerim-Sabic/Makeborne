-- CRM email automation: connected Gmail/Outlook mailboxes, templates, multi-step
-- sequences, and a record of every message sent or received for a client.
-- Additive only. Browsers read through RLS; templates and sequences are edited
-- by workspace editors; mailboxes, tokens, enrollments and messages are written
-- only by the server (service role) after it has checked edit rights.
begin;

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- The person who connected the mailbox; only they may send from it.
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  email text not null check (length(email) between 3 and 320),
  display_name text not null default '' check (length(display_name) <= 160),
  status text not null default 'active' check (status in ('active','error','disconnected')),
  last_error text check (length(last_error) <= 500),
  daily_limit integer not null default 50 check (daily_limit between 1 and 200),
  warmup_started_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, email)
);

-- Encrypted OAuth tokens (AES-256-GCM, bound to the account id). Never readable by browsers.
create table makeborne_private.mail_tokens (
  account_id uuid primary key references public.mail_accounts(id) on delete cascade,
  refresh_token text not null check (length(refresh_token) <= 8000),
  access_token text check (length(access_token) <= 8000),
  access_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on makeborne_private.mail_tokens from public, anon, authenticated;
grant select, insert, update, delete on makeborne_private.mail_tokens to service_role;

create table public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  subject text not null default '' check (length(subject) <= 300),
  body text not null check (length(body) between 1 and 20000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mail_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  -- [{ "delayDays": 0..60, "subject": "...", "body": "..." }], 1 to 8 steps; validated again by the server.
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 8 and octet_length(steps::text) <= 120000),
  stop_on_reply boolean not null default true,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mail_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid not null references public.mail_sequences(id) on delete cascade,
  client_id uuid not null,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','completed','replied','stopped','failed')),
  next_step integer not null default 0 check (next_step between 0 and 8),
  next_send_at timestamptz,
  last_error text check (length(last_error) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade
);
-- One running sequence per client at a time.
create unique index mail_enrollments_one_active on public.mail_enrollments(client_id) where status in ('active','paused');
create index mail_enrollments_due on public.mail_enrollments(next_send_at) where status = 'active';

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  enrollment_id uuid references public.mail_enrollments(id) on delete set null,
  step integer check (step between 0 and 8),
  direction text not null check (direction in ('out','in')),
  -- sending: claimed before the provider call; unknown: the provider outcome could not be confirmed (never re-sent automatically).
  status text not null check (status in ('sending','sent','failed','unknown','received')),
  provider_message_id text check (length(provider_message_id) <= 300),
  rfc_message_id text check (length(rfc_message_id) <= 1000),
  thread_id text check (length(thread_id) <= 300),
  subject text not null default '' check (length(subject) <= 300),
  body text not null default '' check (length(body) <= 20000),
  from_address text not null default '' check (length(from_address) <= 320),
  to_address text not null default '' check (length(to_address) <= 320),
  error text check (length(error) <= 500),
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade
);
-- A sequence step is claimed exactly once, so a retry or a second worker can never send it twice.
create unique index mail_messages_step_once on public.mail_messages(enrollment_id, step) where enrollment_id is not null and direction = 'out';
create unique index mail_messages_provider_once on public.mail_messages(account_id, provider_message_id) where provider_message_id is not null;
create index mail_messages_client on public.mail_messages(client_id, created_at desc);
create index mail_messages_account_day on public.mail_messages(account_id, created_at) where direction = 'out';
create index mail_messages_threads on public.mail_messages(account_id, thread_id) where thread_id is not null;

do $$ declare item text; begin
  foreach item in array array['mail_templates','mail_sequences'] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('revoke all on public.%I from anon, authenticated', item);
    execute format('grant select, insert, update, delete on public.%I to authenticated', item);
    execute format('create policy tenant_read on public.%I for select to authenticated using (makeborne_private.can_read(workspace_id))', item);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (makeborne_private.can_edit(workspace_id))', item);
    execute format('create policy tenant_update on public.%I for update to authenticated using (makeborne_private.can_edit(workspace_id)) with check (makeborne_private.can_edit(workspace_id))', item);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using (makeborne_private.can_edit(workspace_id))', item);
    execute format('create index on public.%I(workspace_id)', item);
  end loop;
  -- Server-written records: members can read them, nobody but the server writes them.
  foreach item in array array['mail_accounts','mail_enrollments','mail_messages'] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('revoke all on public.%I from anon, authenticated', item);
    execute format('grant select on public.%I to authenticated', item);
    execute format('create policy tenant_read on public.%I for select to authenticated using (makeborne_private.can_read(workspace_id))', item);
    execute format('create index on public.%I(workspace_id)', item);
  end loop;
end $$;
grant all on public.mail_accounts, public.mail_templates, public.mail_sequences, public.mail_enrollments, public.mail_messages to service_role;

-- The private schema is not exposed to the Data API; the server reaches sealed tokens only through these.
create function public.makeborne_mail_token_read(p_account uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('refresh_token', t.refresh_token, 'access_token', t.access_token, 'access_expires_at', t.access_expires_at)
  from makeborne_private.mail_tokens t where t.account_id = p_account;
$$;
-- A null refresh token keeps the stored one (providers often omit it when refreshing).
create function public.makeborne_mail_token_write(p_account uuid, p_refresh text, p_access text, p_expires timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_refresh is null then
    update makeborne_private.mail_tokens set access_token = p_access, access_expires_at = p_expires, updated_at = now() where account_id = p_account;
    if not found then raise exception 'Mailbox tokens missing' using errcode = 'P0002'; end if;
  else
    insert into makeborne_private.mail_tokens(account_id, refresh_token, access_token, access_expires_at, updated_at)
    values (p_account, p_refresh, p_access, p_expires, now())
    on conflict (account_id) do update set refresh_token = excluded.refresh_token, access_token = excluded.access_token,
      access_expires_at = excluded.access_expires_at, updated_at = now();
  end if;
end $$;
revoke all on function public.makeborne_mail_token_read(uuid) from public, anon, authenticated;
revoke all on function public.makeborne_mail_token_write(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.makeborne_mail_token_read(uuid) to service_role;
grant execute on function public.makeborne_mail_token_write(uuid, text, text, timestamptz) to service_role;

commit;
