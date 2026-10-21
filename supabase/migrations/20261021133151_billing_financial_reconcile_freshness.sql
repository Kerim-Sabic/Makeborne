-- Membership checks do not verify payment/refund state. They must not postpone
-- daily financial reconciliation. Forward-only; existing history is preserved.
begin;
create function makeborne_private.due_financial_memberships(p_limit integer,p_stale_seconds integer)
returns table(membership_id text,user_id uuid,plan_id text,checkout_id text,whop_user_id text,needs_payments boolean,last_observed_at timestamptz)
language sql stable security definer set search_path='' as $$
  select m.membership_id,m.user_id,m.plan_id,m.checkout_id,m.whop_user_id,
    exists(select 1 from makeborne_private.plan_credit_issues i where i.membership_id=m.membership_id and i.resolved_at is null),
    (select max(o.recorded_at) from makeborne_private.plan_observations o where o.membership_id=m.membership_id and o.source='reconcile')
  from public.billing_memberships m
  where (m.status in ('active','canceling','past_due','trialing') or m.period_end>now()-interval '40 days'
    or exists(select 1 from makeborne_private.plan_credit_issues i where i.membership_id=m.membership_id and i.resolved_at is null))
    and coalesce((select max(o.recorded_at) from makeborne_private.plan_observations o where o.membership_id=m.membership_id and o.source='reconcile'),'-infinity')
      < now()-make_interval(secs=>greatest(p_stale_seconds,60))
  order by 7 nulls first,m.membership_id limit greatest(1,least(p_limit,500));
$$;
revoke all on function makeborne_private.due_financial_memberships(integer,integer) from public,anon,authenticated;
grant execute on function makeborne_private.due_financial_memberships(integer,integer) to service_role;
create or replace function public.makeborne_billing_job_due_memberships(p_limit integer,p_stale_seconds integer)
returns table(membership_id text,user_id uuid,plan_id text,checkout_id text,whop_user_id text,needs_payments boolean,last_observed_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from makeborne_private.due_financial_memberships(p_limit,p_stale_seconds)$$;
revoke all on function public.makeborne_billing_job_due_memberships(integer,integer) from public,anon,authenticated;
grant execute on function public.makeborne_billing_job_due_memberships(integer,integer) to service_role;
commit;
