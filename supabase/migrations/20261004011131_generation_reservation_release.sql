begin;
alter table makeborne_private.generation_reservations
 add column dispatch_started_at timestamptz,
 add column released_at timestamptz,
 add column released_by uuid references auth.users(id),
 add column release_reason text check(length(release_reason) between 1 and 500),
 add constraint generation_release_metadata check (
   (status='released')=(released_at is not null)
   and (released_at is null)=(released_by is null)
   and (released_at is null)=(release_reason is null)
   and (released_at is null or dispatch_started_at is null)
 );
create index generation_reservations_released_by on makeborne_private.generation_reservations(released_by) where released_by is not null;
create function makeborne_private.release_generation_reservation(p_reservation_id uuid,p_actor uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 reservation makeborne_private.generation_reservations%rowtype;
 budget makeborne_private.generation_budgets%rowtype;
 target_workspace uuid; owner_id uuid; member_role text;
begin
 if p_actor is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'Actor and cancellation reason required' using errcode='22023'; end if;
 select workspace_id into target_workspace from makeborne_private.generation_reservations where id=p_reservation_id;
 if not found then raise exception 'Reservation unavailable' using errcode='P0002'; end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=target_workspace for share;
 if owner_id is distinct from p_actor then
   select m.role into member_role from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=p_actor for share;
   if member_role is distinct from 'editor' then raise exception 'Editor access required' using errcode='42501'; end if;
 end if;
 -- Same lock order as reservation/ future dispatch: workspace, budget, reservation.
 select * into budget from makeborne_private.generation_budgets where workspace_id=target_workspace for update;
 if not found then raise exception 'Generation budget unavailable' using errcode='P0002'; end if;
 select * into reservation from makeborne_private.generation_reservations where id=p_reservation_id for update;
 if reservation.status='released' then return reservation.id; end if;
 if reservation.status<>'reserved' or reservation.dispatch_started_at is not null then raise exception 'Dispatched or unresolved work requires reconciliation' using errcode='PT409'; end if;
 if budget.vendor_reserved<reservation.vendor_amount or budget.credit_reserved<reservation.credit_amount or budget.active_reservations<1 then raise exception 'Reservation counters require reconciliation' using errcode='PT409'; end if;
 update makeborne_private.generation_budgets set vendor_reserved=vendor_reserved-reservation.vendor_amount,credit_reserved=credit_reserved-reservation.credit_amount,active_reservations=active_reservations-1,revision=revision+1 where workspace_id=target_workspace;
 update makeborne_private.generation_reservations set status='released',released_at=clock_timestamp(),released_by=p_actor,release_reason=btrim(p_reason) where id=reservation.id;
 return reservation.id;
end $$;
revoke all on function makeborne_private.release_generation_reservation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function makeborne_private.release_generation_reservation(uuid,uuid,text) to service_role;
comment on function makeborne_private.release_generation_reservation(uuid,uuid,text) is 'Private trusted worker cancellation before dispatch only. Caller authenticates actor. Atomic and idempotent; does not refund actual charges. Dispatch must set dispatch_started_at transactionally before any external call.';
commit;
