-- Generated with the local CLI, then sequenced after the existing candidate.
-- Additive read only: no catalogue activation, reconciliation or credit writes.
begin;
create function makeborne_private.topup_order_status(p_user uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'orderId', o.id,
    'packId', o.pack_id,
    'credits', o.credits,
    'priceCents', o.price_cents,
    'currency', 'usd',
    'state', case
      when o.state = 'reversed' then 'refunded'
      when o.state = 'funded' and o.granted then 'delivered'
      when o.state = 'awaiting_payment' and not o.granted then 'pending'
      else 'under_review'
    end
  )
  from makeborne_private.topup_orders o
  where o.id = p_order and o.user_id = p_user;
$$;
alter function makeborne_private.topup_order_status(uuid, uuid) owner to postgres;
revoke all on function makeborne_private.topup_order_status(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function makeborne_private.topup_order_status(uuid, uuid) to service_role;

create function public.makeborne_topup_order_status(p_user uuid, p_order uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select makeborne_private.topup_order_status(p_user, p_order);
$$;
alter function public.makeborne_topup_order_status(uuid, uuid) owner to postgres;
revoke all on function public.makeborne_topup_order_status(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_topup_order_status(uuid, uuid) to service_role;
commit;
