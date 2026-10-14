begin;
-- Account-wide serialization covers different request IDs and old app callers.
-- Uncertain provider attempts remain blocked until support reconciles them.
create function makeborne_private.guard_creation_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creation-checkout:'||new.user_id::text,0));
  if exists(select 1 from public.billing_memberships m where m.user_id=new.user_id
    and m.status not in ('canceled','expired','completed')) then
    raise exception using errcode='PBC01',message='A creation subscription already exists. Contact support to change it.';
  end if;
  if exists(select 1 from public.billing_checkouts c where c.user_id=new.user_id
    and c.request_id<>new.request_id
    and not exists(select 1 from public.billing_memberships m where m.checkout_id=c.checkout_id)) then
    raise exception using errcode='PBC02',message='A checkout is already open or awaiting confirmation. Contact support if it cannot be completed.';
  end if;
  return new;
end $$;
revoke all on function makeborne_private.guard_creation_checkout() from public,anon,authenticated,service_role;
create trigger prevent_duplicate_creation_checkout before insert on public.billing_checkouts
for each row execute function makeborne_private.guard_creation_checkout();
commit;
