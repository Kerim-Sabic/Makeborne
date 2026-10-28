-- Durable purchase confirmations (Consumer Rights Directive Art. 8(7)), the withdrawal
-- request function with an automatic acknowledgement (Art. 11a) and one mail outbox for both.
-- Additive only: checkout, fulfilment, credits, prices and access are unchanged. Nothing is
-- sent from SQL; the app claims outbox rows and reports each result. Service-role only.
begin;

-- 1. Records. Confirmation and request content never changes once written; deleting the
-- account removes them through the auth-user foreign key (account erasure).
create table makeborne_private.purchase_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan','pack')),
  payment_id text not null unique check (payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  request_id uuid not null,
  product text not null check (length(product) between 1 and 200),
  billing_interval text check (billing_interval in ('monthly','yearly')),
  credits bigint not null check (credits > 0),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  paid_at timestamptz not null,
  consent_version text check (length(consent_version) between 1 and 80),
  terms_version text check (length(terms_version) between 1 and 80),
  consent_text text check (length(consent_text) between 1 and 2000),
  consent_accepted_at timestamptz,
  recipient text not null check (length(recipient) between 3 and 320),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'plan') = (billing_interval is not null)),
  check (num_nulls(consent_version, terms_version, consent_text, consent_accepted_at) in (0, 4))
);
create index purchase_confirmations_user on makeborne_private.purchase_confirmations(user_id, paid_at desc);
comment on table makeborne_private.purchase_confirmations is
  'One immutable confirmation per verified, funded purchase payment: what was bought, the amount charged, the immediate-start request snapshot copied from checkout_consents, the withdrawal information and the exact email text. Not a refund or withdrawal decision.';

create table makeborne_private.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^WD-[0-9A-F]{8}$'),
  user_id uuid references auth.users(id) on delete cascade,
  source text not null check (source in ('signed_in','signed_out')),
  email text not null check (length(email) between 3 and 320 and position('@' in email) > 1),
  name text check (length(name) between 1 and 200),
  payment_reference text check (length(payment_reference) between 1 and 200),
  payment_id text check (payment_id ~ '^pay_[A-Za-z0-9]{1,64}$'),
  payment_kind text check (payment_kind in ('plan','pack')),
  statement text not null check (length(statement) between 20 and 2000),
  message text check (length(message) <= 2000),
  acknowledgement text not null check (acknowledgement in ('queued','manual')),
  received_at timestamptz not null default clock_timestamp(),
  check ((source = 'signed_in') = (user_id is not null)),
  check ((payment_id is null) = (payment_kind is null))
);
create index withdrawal_requests_user on makeborne_private.withdrawal_requests(user_id, received_at desc);
create index withdrawal_requests_email on makeborne_private.withdrawal_requests(email, received_at desc);
comment on table makeborne_private.withdrawal_requests is
  'Immutable withdrawal notices with server time. Receiving one never refunds or revokes anything by itself: support handles it through the existing refund workflow. Signed-out notices are acknowledged automatically only when the address matches the account that owns the payment.';

create table makeborne_private.transactional_mail (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purchase_confirmation','withdrawal_ack')),
  confirmation_id uuid unique references makeborne_private.purchase_confirmations(id) on delete cascade,
  withdrawal_id uuid unique references makeborne_private.withdrawal_requests(id) on delete cascade,
  recipient text not null check (length(recipient) between 3 and 320),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  provider_message_id text check (length(provider_message_id) between 1 and 200),
  last_error text check (last_error ~ '^[A-Z0-9_]{1,80}$'),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'purchase_confirmation') = (confirmation_id is not null)),
  check ((kind = 'withdrawal_ack') = (withdrawal_id is not null)),
  check ((status = 'sent') = (sent_at is not null))
);
create index transactional_mail_due on makeborne_private.transactional_mail(next_attempt_at) where status in ('pending','sending');
comment on table makeborne_private.transactional_mail is
  'Outbox for confirmations and acknowledgements. A failed or disabled send never blocks fulfilment; rows stay pending and are retried with backoff (12 attempts, or a permanent provider refusal, then failed for operator review).';

alter table makeborne_private.purchase_confirmations enable row level security;
alter table makeborne_private.withdrawal_requests enable row level security;
alter table makeborne_private.transactional_mail enable row level security;
revoke all on makeborne_private.purchase_confirmations, makeborne_private.withdrawal_requests, makeborne_private.transactional_mail
  from public, anon, authenticated, service_role;

create function makeborne_private.reject_record_change() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception '% records cannot be changed', tg_table_name using errcode='55000';
end $$;
revoke all on function makeborne_private.reject_record_change() from public, anon, authenticated, service_role;
create trigger purchase_confirmations_immutable before update on makeborne_private.purchase_confirmations
  for each row execute function makeborne_private.reject_record_change();
create trigger withdrawal_requests_immutable before update on makeborne_private.withdrawal_requests
  for each row execute function makeborne_private.reject_record_change();

-- Outbox rows keep their content; only delivery fields move.
create function makeborne_private.keep_mail_content() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.kind, new.confirmation_id, new.withdrawal_id, new.recipient, new.subject, new.body, new.idempotency_key, new.created_at)
     is distinct from (old.kind, old.confirmation_id, old.withdrawal_id, old.recipient, old.subject, old.body, old.idempotency_key, old.created_at)
     or old.status = 'sent' then
    raise exception 'Mail content and sent mail cannot be changed' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function makeborne_private.keep_mail_content() from public, anon, authenticated, service_role;
create trigger transactional_mail_content before update on makeborne_private.transactional_mail
  for each row execute function makeborne_private.keep_mail_content();

-- 2. Purchases that need a confirmation. Plans: the first funded payment of a membership
-- (renewals continue the same contract). Packs: each funded, granted order. Only payments
-- at or after p_since are eligible, so enabling the feature never mails earlier buyers.
create function makeborne_rpc.makeborne_purchase_confirmation_candidates(p_since timestamptz, p_payment text default null, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
  with first_plan_payment as (
    select distinct on (pp.membership_id) pp.payment_id, pp.user_id, pp.membership_id, pp.plan_id, pp.currency, pp.principal_cents, pp.paid_at, pp.state
    from makeborne_private.plan_payments pp
    order by pp.membership_id, pp.paid_at, pp.payment_id
  ), due as (
    select 'plan'::text as kind, f.payment_id, f.user_id, c.request_id, f.plan_id, null::text as pack_id, null::bigint as credits,
      f.principal_cents as amount_cents, f.currency, f.paid_at
    from first_plan_payment f
    join public.billing_memberships m on m.membership_id = f.membership_id and m.user_id = f.user_id
    join public.billing_checkouts c on c.checkout_id = m.checkout_id and c.user_id = f.user_id
    where f.state = 'funded' and f.principal_cents > 0
    union all
    select 'pack', o.payment_id, o.user_id, o.request_id, o.plan_id, o.pack_id, o.credits,
      coalesce((o.evidence->>'principalCents')::bigint, o.price_cents), 'usd',
      coalesce((select min(x.observed_at) from makeborne_private.topup_observations x where x.order_id = o.id), o.observed_at, o.created_at)
    from makeborne_private.topup_orders o
    where o.state = 'funded' and o.granted and o.payment_id is not null
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.paid_at, r.payment_id), '[]'::jsonb) from (
    select d.kind, d.payment_id, d.user_id, d.request_id, d.plan_id, d.pack_id, d.credits, d.amount_cents, d.currency, d.paid_at,
      u.email as recipient, cc.version as consent_version, cc.terms_version, cc.consent_text, cc.accepted_at as consent_accepted_at
    from due d
    join auth.users u on u.id = d.user_id
    left join lateral (
      select x.version, x.terms_version, x.consent_text, x.accepted_at from makeborne_private.checkout_consents x
      where x.user_id = d.user_id and x.request_id = d.request_id and x.kind = d.kind
      order by x.accepted_at desc, x.version desc limit 1
    ) cc on true
    where p_since is not null and d.paid_at >= p_since and d.amount_cents > 0
      and (p_payment is null or d.payment_id = p_payment)
      and u.email is not null and length(u.email) between 3 and 320
      and not exists (select 1 from makeborne_private.purchase_confirmations pc where pc.payment_id = d.payment_id)
    order by d.paid_at, d.payment_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) r
$$;

-- 3. Write one confirmation and its outbox row together. Everything financial and the consent
-- snapshot are re-read from stored evidence; the app supplies only labels and the composed text,
-- which must quote the payment reference and the accepted request word for word.
create function makeborne_rpc.makeborne_record_purchase_confirmation(
  p_payment text, p_product text, p_interval text, p_credits bigint, p_subject text, p_body text
) returns uuid language plpgsql security definer set search_path='' as $$
declare c jsonb; v_id uuid;
begin
  select id into v_id from makeborne_private.purchase_confirmations where payment_id = p_payment;
  if v_id is not null then return v_id; end if;
  if p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]{1,64}$' or p_product is null or length(p_product) not between 1 and 200
    or p_subject is null or length(p_subject) not between 1 and 200 or p_body is null or length(p_body) not between 1 and 20000
    or p_credits is null or p_credits <= 0 then
    raise exception 'Invalid purchase confirmation' using errcode='22023';
  end if;
  c := makeborne_rpc.makeborne_purchase_confirmation_candidates('-infinity'::timestamptz, p_payment, 1)->0;
  if c is null then raise exception 'This payment is not a confirmable funded purchase' using errcode='22023'; end if;
  if (c->>'kind') = 'plan' and (p_interval is null or p_interval not in ('monthly','yearly')) then
    raise exception 'A plan confirmation needs its billing interval' using errcode='22023'; end if;
  if (c->>'kind') = 'pack' and (p_interval is not null or p_credits <> (c->>'credits')::bigint) then
    raise exception 'A credit-pack confirmation must match its order' using errcode='22023'; end if;
  if position(p_payment in p_body) = 0 or (c->>'consent_text' is not null and position(c->>'consent_text' in p_body) = 0) then
    raise exception 'The confirmation must quote the payment reference and the accepted request' using errcode='22023'; end if;
  insert into makeborne_private.purchase_confirmations(user_id, kind, payment_id, request_id, product, billing_interval, credits, amount_cents,
      currency, paid_at, consent_version, terms_version, consent_text, consent_accepted_at, recipient, subject, body)
    values ((c->>'user_id')::uuid, c->>'kind', p_payment, (c->>'request_id')::uuid, p_product, case when c->>'kind' = 'plan' then p_interval end,
      p_credits, (c->>'amount_cents')::bigint, c->>'currency', (c->>'paid_at')::timestamptz, c->>'consent_version', c->>'terms_version',
      c->>'consent_text', (c->>'consent_accepted_at')::timestamptz, c->>'recipient', p_subject, p_body)
    on conflict (payment_id) do nothing
    returning id into v_id;
  if v_id is null then
    select id into strict v_id from makeborne_private.purchase_confirmations where payment_id = p_payment;
    return v_id;
  end if;
  insert into makeborne_private.transactional_mail(kind, confirmation_id, recipient, subject, body, idempotency_key)
    values ('purchase_confirmation', v_id, c->>'recipient', p_subject, p_body, 'purchase-confirmation:' || p_payment)
    on conflict do nothing;
  return v_id;
end $$;

-- 4. Withdrawal notices. The statement is stored as submitted, with server time. The automatic
-- acknowledgement goes to the account's own address (signed in) or to a typed address only when
-- it matches the account that owns the referenced payment, so the form cannot mail anyone else.
-- Anything else is still recorded and answered by support. At most 5 notices per address a day.
create function makeborne_rpc.makeborne_record_withdrawal_request(
  p_user uuid, p_email text, p_name text, p_payment_reference text, p_payment_id text, p_statement text, p_message text,
  p_ack_subject text, p_ack_template text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text; v_kind text; v_payment text; v_owner uuid; v_ack text := 'manual'; v_id uuid; v_ref text; v_at timestamptz; v_body text;
begin
  if p_statement is null or length(p_statement) not between 20 and 2000 or (p_name is not null and length(p_name) not between 1 and 200)
    or (p_message is not null and length(p_message) > 2000) or (p_payment_reference is not null and length(p_payment_reference) not between 1 and 200)
    or p_ack_subject is null or length(p_ack_subject) not between 1 and 200 or p_ack_template is null or length(p_ack_template) not between 1 and 20000
    or position('{{reference}}' in p_ack_template) = 0 or position('{{received}}' in p_ack_template) = 0 then
    raise exception 'Invalid withdrawal notice' using errcode='22023';
  end if;
  if p_user is not null then
    select lower(email) into v_email from auth.users where id = p_user;
    if v_email is null then raise exception 'Account required' using errcode='42501'; end if;
    if p_payment_id is not null then
      if exists (select 1 from makeborne_private.plan_payments where payment_id = p_payment_id and user_id = p_user) then v_kind := 'plan';
      elsif exists (select 1 from makeborne_private.topup_orders where payment_id = p_payment_id and user_id = p_user) then v_kind := 'pack';
      else raise exception 'That payment does not belong to this account' using errcode='42501'; end if;
      v_payment := p_payment_id;
    end if;
    v_ack := 'queued';
  else
    v_email := lower(btrim(coalesce(p_email, '')));
    if v_email !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' then raise exception 'Invalid email address' using errcode='22023'; end if;
    if p_payment_id is not null then raise exception 'Sign in to choose a payment' using errcode='22023'; end if;
    if btrim(coalesce(p_payment_reference, '')) ~ '^pay_[A-Za-z0-9]{1,64}$' then
      v_payment := btrim(p_payment_reference);
      select user_id, 'plan' into v_owner, v_kind from makeborne_private.plan_payments where payment_id = v_payment;
      if v_owner is null then select user_id, 'pack' into v_owner, v_kind from makeborne_private.topup_orders where payment_id = v_payment; end if;
      if v_owner is null then v_payment := null; v_kind := null;
      elsif exists (select 1 from auth.users where id = v_owner and lower(email) = v_email) then v_ack := 'queued'; end if;
    end if;
  end if;
  if (select count(*) from makeborne_private.withdrawal_requests
      where (email = v_email or (p_user is not null and user_id = p_user)) and received_at > clock_timestamp() - interval '24 hours') >= 5 then
    raise exception 'Too many withdrawal notices today' using errcode='53400';
  end if;
  loop
    v_ref := 'WD-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    exit when not exists (select 1 from makeborne_private.withdrawal_requests where reference = v_ref);
  end loop;
  insert into makeborne_private.withdrawal_requests(reference, user_id, source, email, name, payment_reference, payment_id, payment_kind, statement, message, acknowledgement)
    values (v_ref, p_user, case when p_user is null then 'signed_out' else 'signed_in' end, v_email, nullif(btrim(p_name), ''),
      nullif(btrim(p_payment_reference), ''), v_payment, v_kind, p_statement, nullif(btrim(p_message), ''), v_ack)
    returning id, received_at into v_id, v_at;
  if v_ack = 'queued' then
    v_body := replace(replace(p_ack_template, '{{reference}}', v_ref), '{{received}}', to_char(v_at at time zone 'UTC', 'FMDD FMMonth YYYY, HH24:MI "UTC"'));
    insert into makeborne_private.transactional_mail(kind, withdrawal_id, recipient, subject, body, idempotency_key)
      values ('withdrawal_ack', v_id, v_email, replace(p_ack_subject, '{{reference}}', v_ref), v_body, 'withdrawal-ack:' || v_id);
  end if;
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'receivedAt', v_at, 'acknowledgement', v_ack, 'paymentId', v_payment);
end $$;

-- 5. Outbox delivery: claim due rows under a short lease, then report each result.
create function makeborne_rpc.makeborne_transactional_mail_claim(p_limit integer default 20, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  with due as (
    select id from makeborne_private.transactional_mail
    where status in ('pending','sending') and next_attempt_at <= clock_timestamp()
      and (lease_until is null or lease_until < clock_timestamp())
    order by next_attempt_at, created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  ), claimed as (
    update makeborne_private.transactional_mail t
       set status = 'sending', attempts = least(t.attempts + 1, 20),
           lease_until = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 600))
      from due where t.id = due.id
    returning t.id, t.kind, t.recipient, t.subject, t.body, t.idempotency_key, t.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.id), '[]'::jsonb) into result from claimed;
  return result;
end $$;

create function makeborne_rpc.makeborne_transactional_mail_result(p_id uuid, p_sent boolean, p_provider_id text, p_error text, p_final boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  if p_id is null or p_sent is null or (p_sent and (p_provider_id is null or length(p_provider_id) not between 1 and 200))
    or (not p_sent and (p_error is null or p_error !~ '^[A-Z0-9_]{1,80}$')) then
    raise exception 'Invalid mail result' using errcode='22023';
  end if;
  if p_sent then
    update makeborne_private.transactional_mail set status = 'sent', sent_at = clock_timestamp(), provider_message_id = p_provider_id,
        last_error = null, lease_until = null
      where id = p_id and status = 'sending' returning status into v_status;
  else
    update makeborne_private.transactional_mail
       set status = case when coalesce(p_final, false) or attempts >= 12 then 'failed' else 'pending' end, last_error = p_error, lease_until = null,
           next_attempt_at = clock_timestamp() + least(interval '24 hours', interval '5 minutes' * power(2, greatest(attempts - 1, 0)))
      where id = p_id and status = 'sending' returning status into v_status;
  end if;
  return coalesce(v_status, 'unchanged');
end $$;

-- 6. Reads for the account (billing page) and for administrators.
create function makeborne_rpc.makeborne_account_purchase_records(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'confirmations', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'paymentId', c.payment_id, 'product', c.product,
        'interval', c.billing_interval, 'credits', c.credits, 'amountCents', c.amount_cents, 'currency', c.currency, 'paidAt', c.paid_at,
        'subject', c.subject, 'body', c.body, 'mail', coalesce(m.status, 'none'), 'sentAt', m.sent_at) order by c.paid_at desc)
      from makeborne_private.purchase_confirmations c left join makeborne_private.transactional_mail m on m.confirmation_id = c.id
      where c.user_id = p_user), '[]'::jsonb),
    'withdrawals', coalesce((select jsonb_agg(jsonb_build_object('reference', w.reference, 'receivedAt', w.received_at, 'paymentId', w.payment_id,
        'paymentReference', w.payment_reference, 'acknowledgement', w.acknowledgement, 'mail', coalesce(m.status, 'none')) order by w.received_at desc)
      from makeborne_private.withdrawal_requests w left join makeborne_private.transactional_mail m on m.withdrawal_id = w.id
      where w.user_id = p_user), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(x order by x->>'paidAt' desc) from (
        select jsonb_build_object('paymentId', pp.payment_id, 'kind', 'plan', 'planId', pp.plan_id, 'amountCents', pp.principal_cents, 'currency', pp.currency, 'paidAt', pp.paid_at) x
        from makeborne_private.plan_payments pp where pp.user_id = p_user and pp.principal_cents > 0
        union all
        select jsonb_build_object('paymentId', o.payment_id, 'kind', 'pack', 'packId', o.pack_id, 'credits', o.credits,
          'amountCents', coalesce((o.evidence->>'principalCents')::bigint, o.price_cents), 'currency', 'usd', 'paidAt', coalesce(o.observed_at, o.created_at))
        from makeborne_private.topup_orders o where o.user_id = p_user and o.payment_id is not null
      ) payments), '[]'::jsonb))
$$;

create function makeborne_rpc.makeborne_admin_legal_requests(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform makeborne_private.require_admin(p_actor);
  return jsonb_build_object(
    'generatedAt', now(),
    'withdrawals', coalesce((select jsonb_agg(r order by r.received_at desc) from (
        select w.reference, w.received_at, w.source, w.email, w.name, w.payment_reference, w.payment_id, w.payment_kind, w.acknowledgement,
          w.statement, w.message, coalesce(m.status, 'none') as mail
        from makeborne_private.withdrawal_requests w left join makeborne_private.transactional_mail m on m.withdrawal_id = w.id
        order by w.received_at desc limit 100) r), '[]'::jsonb),
    'mail', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('pending','sending')),
        'failed', count(*) filter (where status = 'failed'),
        'retrying', count(*) filter (where status in ('pending','sending') and attempts > 0),
        'sent7d', count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days'),
        'oldestPendingAt', min(created_at) filter (where status in ('pending','sending')))
      from makeborne_private.transactional_mail),
    'problems', coalesce((select jsonb_agg(r order by r.created_at) from (
        select m.kind, m.recipient, m.status, m.attempts, m.last_error, m.created_at, m.next_attempt_at
        from makeborne_private.transactional_mail m
        where m.status = 'failed' or (m.status in ('pending','sending') and m.attempts > 0)
        order by m.created_at limit 50) r), '[]'::jsonb),
    'confirmations7d', (select count(*) from makeborne_private.purchase_confirmations where created_at > now() - interval '7 days'));
end $$;

-- 7. Account export: the two new sources; every existing source still calls the previous function.
create function makeborne_rpc.makeborne_account_export_rows_with_purchase_records(
  p_user uuid, p_source text, p_offset integer default 0, p_limit integer default 500
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_user is null then raise exception 'Account required' using errcode='22023'; end if;
  case p_source
  when 'purchase_confirmations' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.paid_at, x.payment_id), '[]'::jsonb) into result
    from (select kind, payment_id, product, billing_interval, credits, amount_cents, currency, paid_at, consent_version, terms_version,
        consent_text, consent_accepted_at, recipient, subject, body, created_at
      from makeborne_private.purchase_confirmations where user_id = p_user order by paid_at, payment_id
      offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 500), 1), 1000)) x;
    return result;
  when 'withdrawal_requests' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at, x.reference), '[]'::jsonb) into result
    from (select reference, source, email, name, payment_reference, payment_id, payment_kind, statement, message, acknowledgement, received_at
      from makeborne_private.withdrawal_requests where user_id = p_user order by received_at, reference
      offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 500), 1), 1000)) x;
    return result;
  else
    return makeborne_rpc.makeborne_account_export_rows_with_checkout_consent(p_user, p_source, p_offset, p_limit);
  end case;
end $$;
create or replace function public.makeborne_account_export_rows(p_user uuid, p_source text, p_offset integer default 0, p_limit integer default 500)
returns jsonb language sql stable security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_account_export_rows_with_purchase_records(p_user, p_source, p_offset, p_limit)
$$;

-- 8. Public SECURITY INVOKER wrappers and grants: service role only.
create function public.makeborne_purchase_confirmation_candidates(p_since timestamptz, p_payment text default null, p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_purchase_confirmation_candidates(p_since, p_payment, p_limit) $$;
create function public.makeborne_record_purchase_confirmation(p_payment text, p_product text, p_interval text, p_credits bigint, p_subject text, p_body text)
returns uuid language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_record_purchase_confirmation(p_payment, p_product, p_interval, p_credits, p_subject, p_body) $$;
create function public.makeborne_record_withdrawal_request(p_user uuid, p_email text, p_name text, p_payment_reference text, p_payment_id text,
  p_statement text, p_message text, p_ack_subject text, p_ack_template text)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_record_withdrawal_request(p_user, p_email, p_name, p_payment_reference, p_payment_id, p_statement, p_message, p_ack_subject, p_ack_template) $$;
create function public.makeborne_transactional_mail_claim(p_limit integer default 20, p_lease_seconds integer default 120)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_transactional_mail_claim(p_limit, p_lease_seconds) $$;
create function public.makeborne_transactional_mail_result(p_id uuid, p_sent boolean, p_provider_id text, p_error text, p_final boolean default false)
returns text language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_transactional_mail_result(p_id, p_sent, p_provider_id, p_error, p_final) $$;
create function public.makeborne_account_purchase_records(p_user uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_account_purchase_records(p_user) $$;
create function public.makeborne_admin_legal_requests(p_actor uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_admin_legal_requests(p_actor) $$;

do $$
declare f text;
begin
  foreach f in array array[
    'makeborne_rpc.makeborne_purchase_confirmation_candidates(timestamptz,text,integer)', 'public.makeborne_purchase_confirmation_candidates(timestamptz,text,integer)',
    'makeborne_rpc.makeborne_record_purchase_confirmation(text,text,text,bigint,text,text)', 'public.makeborne_record_purchase_confirmation(text,text,text,bigint,text,text)',
    'makeborne_rpc.makeborne_record_withdrawal_request(uuid,text,text,text,text,text,text,text,text)', 'public.makeborne_record_withdrawal_request(uuid,text,text,text,text,text,text,text,text)',
    'makeborne_rpc.makeborne_transactional_mail_claim(integer,integer)', 'public.makeborne_transactional_mail_claim(integer,integer)',
    'makeborne_rpc.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean)', 'public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean)',
    'makeborne_rpc.makeborne_account_purchase_records(uuid)', 'public.makeborne_account_purchase_records(uuid)',
    'makeborne_rpc.makeborne_admin_legal_requests(uuid)', 'public.makeborne_admin_legal_requests(uuid)',
    'makeborne_rpc.makeborne_account_export_rows_with_purchase_records(uuid,text,integer,integer)', 'public.makeborne_account_export_rows(uuid,text,integer,integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
commit;
