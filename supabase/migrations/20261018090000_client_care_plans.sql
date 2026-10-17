-- Client care plans: an agency charges its own client a recurring fee for website care.
-- Money never passes through Makeborne: the agency adds its own payment link (Stripe, PayPal,
-- Whop, an invoice page...) and records payments it received. Each recorded payment extends
-- "paid through" by one billing period. One plan per client.
--
-- Status (UTC dates): paid while today <= paid_through; due for 7 days after that (the client
-- sees a reminder and the payment link); paused from paid_through + 8: the client can still sign
-- in and read their content, but cannot save, send, upload or delete (PB402). The website itself
-- is never affected. A plan without a paid-through date, or switched off, enforces nothing.
--
-- The per-person "access until" date on client_portal_access (paid_through) is unchanged: it ends
-- one person's access entirely. Agency functions live in makeborne_rpc behind public security-invoker
-- wrappers (as since 20261017080000); client reads go through service-role bridges.
-- Additive plus two `create or replace` bodies: makeborne_private.portal_grant (same as
-- 20261016090000, plus the pause check for writes) and portal_upload_scope (same as
-- 20261017090000, but takes the write path so a paused client cannot upload).
-- Rehearse with supabase/check-client-care-plans.sql.
begin;

create table public.client_care_plans (
  client_id uuid primary key references public.clients(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  amount_cents integer check (amount_cents between 0 and 100000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'quarter', 'year')),
  payment_url text check (payment_url is null or (char_length(payment_url) <= 500 and payment_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"''`\\]*)?$')),
  paid_through date check (paid_through between date '2000-01-01' and date '2200-12-31'),
  active boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((amount_cents is null) = (currency is null))
);
create index client_care_plans_workspace on public.client_care_plans(workspace_id);
comment on table public.client_care_plans is 'One recurring care plan per client: the agency''s own payment link and how far the client has paid. Drives the portal''s payment reminder and editing pause.';

create table public.client_care_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.client_care_plans(client_id) on delete cascade,
  request_id uuid not null,
  amount_cents integer check (amount_cents between 0 and 100000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  covers_from date not null,
  covers_to date not null check (covers_to >= covers_from),
  previous_paid_through date,
  note text not null default '' check (char_length(note) <= 300),
  recorded_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz,
  undone_by uuid,
  unique (client_id, request_id)
);
create index client_care_payments_client on public.client_care_payments(client_id, created_at desc);
create index client_care_payments_workspace on public.client_care_payments(workspace_id);
comment on table public.client_care_payments is 'Payments the agency recorded for a client care plan (money is collected by the agency, not Makeborne). The latest one can be undone.';

alter table public.client_care_plans enable row level security;
alter table public.client_care_payments enable row level security;
revoke all on public.client_care_plans, public.client_care_payments from public, anon, authenticated, service_role;
grant select on public.client_care_plans, public.client_care_payments to authenticated;
grant all on public.client_care_plans, public.client_care_payments to service_role;
create policy client_care_plans_read on public.client_care_plans for select to authenticated using (makeborne_private.can_read(workspace_id));
create policy client_care_payments_read on public.client_care_payments for select to authenticated using (makeborne_private.can_read(workspace_id));

-- ---------------------------------------------------------------- status
create function makeborne_private.care_status(p public.client_care_plans) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p.client_id is null or not p.active or p.paid_through is null then jsonb_build_object('status', 'none')
  else jsonb_build_object(
    'status', case when (now() at time zone 'utc')::date <= p.paid_through then 'paid'
                   when (now() at time zone 'utc')::date <= p.paid_through + 7 then 'due' else 'paused' end,
    'paidThrough', p.paid_through, 'dueOn', p.paid_through + 1, 'pausesOn', p.paid_through + 8) end
$$;

-- What a client may see about their plan (null when there is no active plan).
create function makeborne_private.care_client_json(p public.client_care_plans) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p.client_id is null or not p.active then null else jsonb_build_object(
    'label', p.label, 'amountCents', p.amount_cents, 'currency', p.currency, 'interval', p.billing_interval,
    'paymentUrl', p.payment_url) || makeborne_private.care_status(p) end
$$;

create function makeborne_private.care_paused(p_workspace uuid, p_client uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select makeborne_private.care_status(p)->>'status' = 'paused' from public.client_care_plans p
    where p.client_id = p_client and p.workspace_id = p_workspace), false)
$$;

-- What the agency sees.
create function makeborne_private.care_plan_json(p public.client_care_plans) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('clientId', p.client_id, 'label', p.label, 'amountCents', p.amount_cents, 'currency', p.currency,
    'interval', p.billing_interval, 'paymentUrl', p.payment_url, 'active', p.active, 'updatedAt', p.updated_at)
    || makeborne_private.care_status(p)
$$;

create function makeborne_private.care_payment_json(r public.client_care_payments) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id', r.id, 'amountCents', r.amount_cents, 'currency', r.currency, 'coversFrom', r.covers_from,
    'coversTo', r.covers_to, 'note', r.note, 'recordedAt', r.created_at, 'undoneAt', r.undone_at)
$$;

-- ---------------------------------------------------------------- the portal pauses writes
-- Same as 20261016090000, plus: a write (p_lock) is refused while the client's care plan is paused.
create or replace function makeborne_private.portal_grant(p_actor uuid, p_artifact uuid, p_lock boolean) returns public.client_portal_access
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.client_portal_access%rowtype;
begin
  if p_actor is null or p_artifact is null then raise exception 'This site is not available to you' using errcode='P0002'; end if;
  if p_lock then
    select g.* into r from public.client_portal_access g
      join public.artifacts a on a.id = p_artifact and a.workspace_id = g.workspace_id and a.kind = 'website'
      join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = g.client_id
      join public.client_portal_sites s on s.artifact_id = a.id and s.workspace_id = a.workspace_id and s.enabled
      join public.workspaces w on w.id = g.workspace_id
    where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null
      and (g.paid_through is null or g.paid_through >= (now() at time zone 'utc')::date)
      and makeborne_hosting.owner_can_host(w.owner_id)
    limit 1 for update of g for share of p, s;
  else
    select g.* into r from public.client_portal_access g
      join public.artifacts a on a.id = p_artifact and a.workspace_id = g.workspace_id and a.kind = 'website'
      join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id and p.client_id = g.client_id
      join public.client_portal_sites s on s.artifact_id = a.id and s.workspace_id = a.workspace_id and s.enabled
      join public.workspaces w on w.id = g.workspace_id
    where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null
      and (g.paid_through is null or g.paid_through >= (now() at time zone 'utc')::date)
      and makeborne_hosting.owner_can_host(w.owner_id)
    limit 1;
  end if;
  if not found then raise exception 'This site is not available to you' using errcode='P0002'; end if;
  if p_lock and makeborne_private.care_paused(r.workspace_id, r.client_id) then
    raise exception 'Editing is paused until your agency receives your payment' using errcode='PB402';
  end if;
  return r;
end $$;

-- Same as 20261017090000, but on the write path (a paused client cannot upload).
create or replace function makeborne_private.portal_upload_scope(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; a public.artifacts%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, true);
  select * into a from public.artifacts where id = p_artifact and workspace_id = g.workspace_id;
  if (select count(*) from public.client_portal_uploads where access_id = g.id and created_at > now() - interval '1 day') >= 40 then
    raise exception 'Photo upload limit reached for today' using errcode='MB429';
  end if;
  if (select count(*) from public.client_portal_uploads u where u.artifact_id = a.id and not makeborne_private.portal_upload_in_website(u)) >= 60 then
    raise exception 'This site already has 60 photos waiting to be used. Delete some you no longer need.' using errcode='MB429';
  end if;
  return jsonb_build_object('workspaceId', a.workspace_id, 'projectId', a.project_id);
end $$;

-- ---------------------------------------------------------------- client reads (service-role bridges)
-- The signed-in client's plan for each of their grants (keyed by access id), for the portal home.
create function makeborne_private.portal_billing_home(p_actor uuid, p_session uuid, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  return coalesce((select jsonb_object_agg(g.id::text, makeborne_private.care_client_json(p))
    from public.client_portal_access g
    join public.client_care_plans p on p.client_id = g.client_id and p.workspace_id = g.workspace_id and p.active
    where g.user_id = p_actor and g.accepted_at is not null and g.revoked_at is null), '{}'::jsonb);
end $$;

-- The plan behind one site the client can open (null when none).
create function makeborne_private.portal_billing_site(p_actor uuid, p_session uuid, p_expires timestamptz, p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare g public.client_portal_access%rowtype; p public.client_care_plans%rowtype;
begin
  perform makeborne_private.check_submission_session(p_actor, p_session, p_expires);
  g := makeborne_private.portal_grant(p_actor, p_artifact, false);
  select * into p from public.client_care_plans where client_id = g.client_id and workspace_id = g.workspace_id;
  return jsonb_build_object('billing', case when found then makeborne_private.care_client_json(p) end);
end $$;

-- ---------------------------------------------------------------- agency functions
create function makeborne_rpc.makeborne_care_plan(p_workspace uuid, p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.client_care_plans%rowtype;
begin
  if (select auth.uid()) is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id = p_client and workspace_id = p_workspace) then raise exception 'Client not found' using errcode='P0002'; end if;
  select * into p from public.client_care_plans where client_id = p_client and workspace_id = p_workspace;
  return jsonb_build_object('plan', case when found then makeborne_private.care_plan_json(p) end,
    'payments', coalesce((select jsonb_agg(makeborne_private.care_payment_json(r) order by r.created_at desc)
      from public.client_care_payments r where r.id in (select id from public.client_care_payments
        where client_id = p_client and workspace_id = p_workspace order by created_at desc limit 24)), '[]'::jsonb));
end $$;

create function makeborne_rpc.makeborne_set_care_plan(p_workspace uuid, p_client uuid, p_label text, p_amount_cents integer, p_currency text,
  p_interval text, p_payment_url text, p_paid_through date, p_active boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_label text := btrim(makeborne_private.client_review_text(p_label)); v_url text := nullif(btrim(coalesce(p_payment_url, '')), '');
  v_currency text := nullif(upper(btrim(coalesce(p_currency, ''))), ''); p public.client_care_plans%rowtype; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id = p_client and workspace_id = p_workspace) then raise exception 'Client not found' using errcode='P0002'; end if;
  if v_label = '' or length(v_label) > 80 or v_label ~ '[<>]' or position(E'\n' in v_label) > 0 then raise exception 'Give the plan a short name' using errcode='22023'; end if;
  if (p_amount_cents is null) <> (v_currency is null) or (p_amount_cents is not null and p_amount_cents not between 0 and 100000000)
    or (v_currency is not null and v_currency !~ '^[A-Z]{3}$') then raise exception 'Enter the price with its currency, or leave both empty' using errcode='22023'; end if;
  if p_interval is null or p_interval not in ('month', 'quarter', 'year') then raise exception 'Choose monthly, quarterly or yearly' using errcode='22023'; end if;
  if v_url is not null and (length(v_url) > 500 or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"''`\\]*)?$') then
    raise exception 'The payment link must be a full https:// address' using errcode='22023';
  end if;
  if p_paid_through is not null and p_paid_through not between date '2000-01-01' and date '2200-12-31' then raise exception 'Choose a valid paid-until date' using errcode='22023'; end if;
  if p_active is null then raise exception 'Choose on or off' using errcode='22023'; end if;
  insert into public.client_care_plans(client_id, workspace_id, label, amount_cents, currency, billing_interval, payment_url, paid_through, active, updated_by)
  values(p_client, p_workspace, v_label, p_amount_cents, v_currency, p_interval, v_url, p_paid_through, p_active, v_actor)
  on conflict (client_id) do update set label = excluded.label, amount_cents = excluded.amount_cents, currency = excluded.currency,
    billing_interval = excluded.billing_interval, payment_url = excluded.payment_url, paid_through = excluded.paid_through,
    active = excluded.active, updated_by = excluded.updated_by, updated_at = clock_timestamp()
  where public.client_care_plans.workspace_id = p_workspace
  returning * into p;
  if not found then raise exception 'Client not found' using errcode='P0002'; end if;
  perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.care_plan_updated', p_client,
    jsonb_build_object('active', p_active, 'interval', p_interval, 'hasLink', v_url is not null, 'paidThrough', p_paid_through is not null));
  return makeborne_rpc.makeborne_care_plan(p_workspace, p_client);
end $$;

-- Records one payment the agency received: extends paid-through by one billing period, counted
-- from the old paid-through date (so a late payment still covers the period it was due for).
-- Idempotent per request id.
create function makeborne_rpc.makeborne_record_care_payment(p_workspace uuid, p_client uuid, p_request uuid, p_note text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.client_care_plans%rowtype; v_from date; v_to date; v_note text := btrim(makeborne_private.client_review_text(coalesce(p_note, '')));
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  if p_request is null then raise exception 'Missing request id' using errcode='22023'; end if;
  if length(v_note) > 300 or v_note ~ '[<>]' then raise exception 'Keep the note under 300 characters' using errcode='22023'; end if;
  select * into p from public.client_care_plans where client_id = p_client and workspace_id = p_workspace for update;
  if not found then raise exception 'Set up a care plan for this client first' using errcode='P0002'; end if;
  if exists(select 1 from public.client_care_payments where client_id = p_client and request_id = p_request) then
    return makeborne_rpc.makeborne_care_plan(p_workspace, p_client);
  end if;
  if not p.active then raise exception 'Turn the care plan on before recording payments' using errcode='22023'; end if;
  if (select count(*) from public.client_care_payments where client_id = p_client and created_at > now() - interval '1 day') >= 12 then
    raise exception 'Too many payments recorded for this client today' using errcode='MB429';
  end if;
  v_from := coalesce(p.paid_through, (now() at time zone 'utc')::date - 1) + 1;
  v_to := (v_from + case p.billing_interval when 'year' then interval '1 year' when 'quarter' then interval '3 months' else interval '1 month' end)::date - 1;
  if v_to > date '2200-12-31' then raise exception 'Choose a valid paid-until date' using errcode='22023'; end if;
  insert into public.client_care_payments(workspace_id, client_id, request_id, amount_cents, currency, covers_from, covers_to, previous_paid_through, note, recorded_by)
  values(p_workspace, p_client, p_request, p.amount_cents, p.currency, v_from, v_to, p.paid_through, v_note, v_actor);
  update public.client_care_plans set paid_through = v_to, updated_by = v_actor, updated_at = clock_timestamp() where client_id = p_client;
  perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.care_payment_recorded', p_client, jsonb_build_object('coversTo', v_to));
  return makeborne_rpc.makeborne_care_plan(p_workspace, p_client);
end $$;

-- Undoes the latest payment (a mistake), restoring the paid-through date it replaced.
create function makeborne_rpc.makeborne_undo_care_payment(p_workspace uuid, p_client uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.client_care_plans%rowtype; r public.client_care_payments%rowtype; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into p from public.client_care_plans where client_id = p_client and workspace_id = p_workspace for update;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  select * into r from public.client_care_payments where id = p_payment and client_id = p_client and workspace_id = p_workspace;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  if r.undone_at is not null then return makeborne_rpc.makeborne_care_plan(p_workspace, p_client); end if;
  if exists(select 1 from public.client_care_payments where client_id = p_client and undone_at is null and created_at > r.created_at)
    or p.paid_through is distinct from r.covers_to then
    raise exception 'Only the latest payment can be undone. Change the paid-until date instead.' using errcode='PT409';
  end if;
  update public.client_care_payments set undone_at = now(), undone_by = v_actor where id = r.id;
  update public.client_care_plans set paid_through = r.previous_paid_through, updated_by = v_actor, updated_at = clock_timestamp() where client_id = p_client;
  perform makeborne_private.portal_audit(p_workspace, v_actor, 'portal.care_payment_undone', p_client, jsonb_build_object('restored', r.previous_paid_through is not null));
  return makeborne_rpc.makeborne_care_plan(p_workspace, p_client);
end $$;

-- The agency's billing overview: every plan with its status and last payment (paused and due first),
-- plus what was recorded this calendar month (UTC), per currency.
create function makeborne_rpc.makeborne_care_plans(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if (select auth.uid()) is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editor access required' using errcode='42501'; end if;
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(makeborne_private.care_plan_json(p) || jsonb_build_object('clientName', coalesce(nullif(c.company, ''), c.name),
        'lastPaymentAt', (select max(r.created_at) from public.client_care_payments r where r.client_id = p.client_id and r.undone_at is null))
      order by case when not p.active then 4 else case makeborne_private.care_status(p)->>'status' when 'paused' then 0 when 'due' then 1 when 'paid' then 2 else 3 end end,
        p.paid_through nulls last, c.name)
      from public.client_care_plans p join public.clients c on c.id = p.client_id and c.workspace_id = p.workspace_id
      where p.workspace_id = p_workspace), '[]'::jsonb),
    'month', v_month,
    'collected', coalesce((select jsonb_agg(jsonb_build_object('currency', x.currency, 'amountCents', x.total, 'payments', x.n) order by x.currency)
      from (select r.currency, sum(r.amount_cents) as total, count(*) as n from public.client_care_payments r
        where r.workspace_id = p_workspace and r.undone_at is null and r.currency is not null
          and (r.created_at at time zone 'utc')::date >= v_month group by r.currency) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- exposure
revoke all on function makeborne_private.care_status(public.client_care_plans), makeborne_private.care_client_json(public.client_care_plans),
  makeborne_private.care_paused(uuid, uuid), makeborne_private.care_plan_json(public.client_care_plans),
  makeborne_private.care_payment_json(public.client_care_payments) from public, anon, authenticated, service_role;

-- Client reads: service-role-only invoker bridges (same pattern as 20261016090000).
do $$ declare f record; args text; names text; begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'makeborne_private'
    and p.proname in ('portal_billing_home', 'portal_billing_site') loop
    args := pg_get_function_arguments(f.oid);
    select string_agg(x, ',' order by ord) into names from unnest((select proargnames from pg_proc where oid = f.oid)) with ordinality a(x, ord);
    execute format('create function public.makeborne_%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$ select makeborne_private.%I(%s); $fn$',
      f.proname, args, f.proname, names);
    execute format('revoke all on function makeborne_private.%I(%s) from public,anon,authenticated,service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function makeborne_private.%I(%s) to service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('revoke all on function public.makeborne_%I(%s) from public,anon,authenticated,service_role', f.proname, pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function public.makeborne_%I(%s) to service_role', f.proname, pg_get_function_identity_arguments(f.oid));
  end loop;
end $$;

-- Agency functions: privileged core in makeborne_rpc, security-invoker wrapper in public, both
-- executable by authenticated only (same boundary as 20261017080000).
do $$ declare f record; v_identity text; v_args text; v_result text; v_names text; v_volatility text; begin
  for f in select p.oid, p.proname, p.provolatile, p.proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'makeborne_rpc' and p.proname in ('makeborne_care_plan', 'makeborne_set_care_plan', 'makeborne_record_care_payment', 'makeborne_undo_care_payment', 'makeborne_care_plans') loop
    v_identity := pg_get_function_identity_arguments(f.oid);
    v_args := pg_get_function_arguments(f.oid);
    v_result := pg_get_function_result(f.oid);
    v_volatility := case f.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end;
    select string_agg(format('%I', x), ', ' order by ord) into v_names from unnest(f.proargnames) with ordinality a(x, ord);
    execute format('create function public.%I(%s) returns %s language sql %s security invoker set search_path = '''' as $wrapper$ select makeborne_rpc.%I(%s) $wrapper$',
      f.proname, v_args, v_result, v_volatility, f.proname, v_names);
    execute format('revoke all on function makeborne_rpc.%I(%s) from public, anon, authenticated, service_role', f.proname, v_identity);
    execute format('grant execute on function makeborne_rpc.%I(%s) to authenticated', f.proname, v_identity);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', f.proname, v_identity);
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, v_identity);
    execute format('comment on function public.%I(%s) is %L', f.proname, v_identity, 'Security-invoker wrapper; the privileged implementation is makeborne_rpc.' || f.proname || '.');
  end loop;
end $$;
commit;
