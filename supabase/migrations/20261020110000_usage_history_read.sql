-- Itemized credit usage for the signed-in account (audit F08). Read-only: this
-- migration adds one query and changes no table, row, balance or grant.
--
-- * public.makeborne_usage_history(period start, period end, cursor, limit):
--   executable by `authenticated` only (a security-invoker wrapper over the
--   privileged makeborne_rpc implementation, per 20261017080000). It takes no
--   user ID: the account is auth.uid() from the caller's own session, so a
--   client cannot widen its scope. anon and service_role cannot execute it.
-- * One row per credit hold (credit_reservations, the authoritative record of
--   every hold, charge and release): Reserved (live), Charged (settled; exact
--   charged credits), Released (returned without a charge; a hold older than 15
--   minutes counts as released at that instant, exactly as the wallet does).
--   Plus credit refunds (ledger kind 'refund': Refunded) and payment-review
--   reversals (ledger kind 'adjust' with a payment withhold/restore reference:
--   Withheld/Restored). Nothing is netted: each is its own row.
-- * Project mapping: an 'operation:<run>' hold joins its AI operation run,
--   artifact and project. The title is returned only while the caller can still
--   read that workspace (makeborne_private.can_read); otherwise its state is
--   'hidden'. A run deleted with its project returns state 'deleted'. Holds with
--   another known prefix name their feature; any other reference is returned as
--   'unknown', never dropped. Raw references, models and provider costs are not
--   returned.
-- * Period: [start, end) on each row's occurrence time (charge/release time,
--   hold time for live holds), at most 366 days. Keyset pagination on
--   (occurredAt desc, id desc), ids compared bytewise (collation "C"), with a
--   strict cursor; limit 1-500.
-- * Totals from the same snapshot: the wallet (credit_totals, as the balance
--   endpoint), and for the period: all rows, rows newer than the cursor, and
--   `used`, the sum of settled charges (independent of the page).
-- * Not listed (not usage): plan, pack, trial and operator credit grants, and
--   credit expiry. The app states this in the statement's coverage text.
--
-- Rollback: drop function public.makeborne_usage_history(timestamptz,timestamptz,timestamptz,text,integer);
--           drop function makeborne_rpc.makeborne_usage_history(timestamptz,timestamptz,timestamptz,text,integer);
-- (no data to restore).
begin;

create function makeborne_rpc.makeborne_usage_history(p_period_start timestamptz, p_period_end timestamptz,
  p_before_at timestamptz default null, p_before_id text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_at timestamptz := makeborne_private.credit_clock();
  v_wallet jsonb;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'authenticated' or v_user is null then
    raise exception 'Sign in to see usage history' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start
     or p_period_end - p_period_start > interval '366 days' then
    raise exception 'Usage period is invalid' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Usage page size out of range' using errcode = '22023';
  end if;
  if (p_before_at is null) <> (p_before_id is null)
     or (p_before_id is not null and p_before_id !~ '^(hold:[0-9a-f]{32}|ledger:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$') then
    raise exception 'Usage cursor is invalid' using errcode = '22023';
  end if;

  v_wallet := makeborne_private.credit_totals(v_user, v_at);

  with holds as (
    select r.reference, r.amount, r.charged,
      case when r.status = 'settled' then 'Charged'
           when r.status = 'released' or r.created_at < v_at - interval '15 minutes' then 'Released'
           else 'Reserved' end as status,
      case when r.status = 'settled' then r.resolved_at
           when r.status = 'released' then least(r.resolved_at, r.created_at + interval '15 minutes')
           when r.created_at < v_at - interval '15 minutes' then r.created_at + interval '15 minutes'
           else r.created_at end as occurred_at,
      r.status = 'reserved' and r.created_at < v_at - interval '15 minutes' as timed_out
    from makeborne_private.credit_reservations r
    where r.user_id = v_user
  ), hold_events as (
    select ('hold:' || md5(h.reference)) collate "C" as id, h.occurred_at, h.status,
      case when h.status = 'Charged' then coalesce(h.charged, 0) else h.amount end as credits,
      case when h.status = 'Charged' then coalesce(h.charged, 0) else 0 end as charged,
      jsonb_strip_nulls(jsonb_build_object(
        'source', case when h.reference like 'operation:%' then 'operation'
          when split_part(h.reference, ':', 1) in ('brief_questions', 'lead_find', 'chat', 'personalize', 'followup') then split_part(h.reference, ':', 1)
          else 'unknown' end,
        'operationKind', o.kind, 'runKind', run.kind, 'format', a.kind,
        'projectState', case when h.reference not like 'operation:%' then null when run.id is null then 'deleted'
          when o.id is null or a.id is null or p.id is null or not makeborne_private.can_read(o.workspace_id) then 'hidden' else 'visible' end,
        'projectTitle', case when p.id is not null and makeborne_private.can_read(o.workspace_id) then p.title end,
        'expert', case when split_part(h.reference, ':', 1) in ('chat', 'personalize', 'followup') then nullif(split_part(h.reference, ':', 2), '') end,
        'held', h.amount::text,
        'lapsed', case when h.status = 'Released' then nullif(lots.lapsed, 0)::text end,
        'reason', case when h.timed_out then 'hold timeout' when h.status = 'Released' then rel.metadata->>'reason' end)) as detail
    from holds h
    left join makeborne_private.ai_operation_runs run on h.reference like 'operation:%' and run.reference = h.reference
    left join makeborne_private.ai_operations o on o.id = run.operation_id and o.actor = v_user
    left join public.artifacts a on a.id = o.artifact_id and a.workspace_id = o.workspace_id
    left join public.projects p on p.id = a.project_id and p.workspace_id = a.workspace_id
    left join public.credit_ledger rel on rel.user_id = v_user and rel.kind = 'release' and rel.reference = h.reference
    left join lateral (select coalesce(sum(hl.lapsed), 0) as lapsed from makeborne_private.credit_hold_lots hl
      where hl.user_id = v_user and hl.reference = h.reference) lots on true
    where h.occurred_at >= p_period_start and h.occurred_at < p_period_end
  ), ledger_events as (
    select ('ledger:' || l.id::text) collate "C" as id, l.created_at as occurred_at,
      case when l.kind = 'refund' then 'Refunded' when l.delta < 0 then 'Withheld' else 'Restored' end as status,
      abs(l.delta) as credits, 0::bigint as charged,
      jsonb_strip_nulls(jsonb_build_object('source', case when l.kind = 'refund' then 'refund' else 'payment' end,
        'paymentKind', case when l.reference like 'credit_topup:%' then 'credit_pack' when l.kind = 'adjust' then 'payment' end,
        'reason', case when l.kind = 'adjust' and l.delta < 0 then l.metadata->>'reason' end)) as detail
    from public.credit_ledger l
    where l.user_id = v_user and l.delta <> 0 and l.created_at >= p_period_start and l.created_at < p_period_end
      and (l.kind = 'refund' or (l.kind = 'adjust' and l.reference ~ '^(payment|credit_topup):pay_[A-Za-z0-9]{1,64}:(withhold|restore):[0-9]+$'))
  ), period as (
    select * from hold_events union all select * from ledger_events
  ), page as (
    select * from period
    where p_before_at is null or (occurred_at, id) < (p_before_at, p_before_id)
    order by occurred_at desc, id desc
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by occurred_at desc, id desc) as n from page
  )
  select jsonb_build_object(
    'unit', 'whole_customer_credits',
    'generatedAt', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'wallet', jsonb_build_object('available', (v_wallet->>'available')::bigint::text, 'reserved', (v_wallet->>'reserved')::bigint::text,
      'balance', (v_wallet->>'balance')::bigint::text, 'unlimited', makeborne_private.has_unlimited_credits(v_user)),
    'period', jsonb_build_object(
      'start', to_char(p_period_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'end', to_char(p_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'total', (select count(*) from period),
      'used', (select coalesce(sum(charged), 0) from period)::text,
      'newer', case when p_before_at is null then 0 else (select count(*) from period where (occurred_at, id) >= (p_before_at, p_before_id)) end,
      'hasMore', (select count(*) > p_limit from page)),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', id,
        'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'status', status, 'credits', credits::text) || detail order by n)
      from numbered where n <= p_limit), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;
comment on function makeborne_rpc.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) is
  'Caller-scoped (auth.uid()) itemized credit usage for one period with keyset pagination and same-snapshot wallet/period totals. Read-only.';
revoke all on function makeborne_rpc.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) from public, anon, authenticated, service_role;
grant execute on function makeborne_rpc.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) to authenticated;

create function public.makeborne_usage_history(p_period_start timestamptz, p_period_end timestamptz,
  p_before_at timestamptz default null, p_before_id text default null, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select makeborne_rpc.makeborne_usage_history(p_period_start, p_period_end, p_before_at, p_before_id, p_limit);
$$;
comment on function public.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) is
  'Security-invoker wrapper; the privileged implementation is makeborne_rpc.makeborne_usage_history. Signed-in callers read only their own account.';
revoke all on function public.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_usage_history(timestamptz, timestamptz, timestamptz, text, integer) to authenticated;

commit;
