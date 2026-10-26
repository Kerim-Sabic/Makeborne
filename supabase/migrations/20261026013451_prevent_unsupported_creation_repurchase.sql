-- Fail before creating or resuming a provider checkout. The financial overlap
-- guard remains authoritative; a refund never erases historical grant evidence.
begin;
create or replace function makeborne_private.guard_creation_checkout() returns trigger
language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creation-checkout:'||new.user_id::text,0));
  if exists(select 1 from public.billing_memberships m where m.user_id=new.user_id
    and m.status not in ('canceled','expired','completed')) then
    raise exception using errcode='PBC01',message='A creation subscription already exists. Contact support to change it.';
  end if;
  -- The first allocation of either interval is a calendar month. Use the same
  -- conservative conflict function as settlement, including unknown legacy dates.
  -- This also runs on repeated request IDs before the unique constraint, so a
  -- retained checkout key cannot bypass the guard after a refund/cancellation.
  if makeborne_private.plan_allocation_conflict(new.user_id,'mem_checkoutEligibility',now(),now()+interval '1 month') is not null then
    raise exception using errcode='PBC03',message='A previous subscription allowance overlaps this purchase. Contact support before subscribing again.';
  end if;
  if exists(select 1 from public.billing_checkouts c where c.user_id=new.user_id
    and c.request_id<>new.request_id
    and not exists(select 1 from public.billing_memberships m where m.checkout_id=c.checkout_id)) then
    raise exception using errcode='PBC02',message='A checkout is already open or awaiting confirmation. Contact support if it cannot be completed.';
  end if;
  return new;
end $$;
alter function makeborne_private.guard_creation_checkout() owner to postgres;
revoke all on function makeborne_private.guard_creation_checkout() from public,anon,authenticated,service_role;
commit;
