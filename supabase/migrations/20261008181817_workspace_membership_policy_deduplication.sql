begin;
-- membership_read already includes owners. Restrict the existing owner-only
-- management predicate to writes, avoiding its duplicate SELECT evaluation.
drop policy membership_manage on public.workspace_members;
create policy membership_insert on public.workspace_members for insert to authenticated
 with check(makeborne_private.is_owner(workspace_id));
create policy membership_update on public.workspace_members for update to authenticated
 using(makeborne_private.is_owner(workspace_id)) with check(makeborne_private.is_owner(workspace_id));
create policy membership_delete on public.workspace_members for delete to authenticated
 using(makeborne_private.is_owner(workspace_id));
commit;
