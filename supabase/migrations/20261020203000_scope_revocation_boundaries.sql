-- M17 scope boundaries (2026-10-20). Additive, least privilege, no data rewrite.
--
-- 1. Member removal stops mailbox use. A connected mailbox belongs to the person
--    who connected it (mail/server.ts ownMailbox). When that person is removed
--    from the workspace, or demoted to reviewer, the workspace must stop sending
--    sequence steps and syncing replies through their account. This mirrors the
--    owner-initiated Disconnect route exactly: the stored refresh token is
--    replaced by the inert marker 'revoked', the account becomes 'disconnected'
--    and active enrollments on it are paused. Sent history is kept. Nothing is
--    revoked at the provider (that is the mailbox owner's own action).
--
-- 2. Browser sessions stop reading project-assets objects directly. The storage
--    API signs a download URL for anyone who can SELECT the object row, for any
--    lifetime the caller chooses, and the signed URL is not re-checked against
--    RLS when used. With the old project_assets_read policy any member (including
--    a reviewer) could mint a long-lived URL that keeps working after removal.
--    App routes now read bytes with the server key only after the caller's own
--    RLS-bound query proves the registered asset is visible to them
--    (src/lib/cloud/asset-storage.ts). Uploads are unchanged: they need only the
--    INSERT policy (upsert:false never asks for SELECT).
--
-- DEPLOY ORDER: ship the application change that reads through
-- asset-storage.ts first, then apply this migration. Applying it before that
-- code is live makes member artwork previews, exports and source downloads fail
-- closed (IMAGE_UNAVAILABLE / SOURCE_ASSET_UNAVAILABLE) until the app catches up.
begin;

create or replace function makeborne_private.revoke_departed_member_mailboxes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid := old.workspace_id; v_user uuid := old.user_id; v_now timestamptz := now();
  v_note constant text := 'The person who connected this mailbox no longer edits this workspace. They can reconnect it if they return.';
begin
  -- Still the owner, or still an editor (including an unchanged row): keep the mailbox.
  if exists(select 1 from public.workspaces w where w.id = v_workspace and w.owner_id = v_user)
    or exists(select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = v_user and m.role = 'editor') then
    return null;
  end if;
  update makeborne_private.mail_tokens t set refresh_token = 'revoked', access_token = null, access_expires_at = null, updated_at = v_now
    from public.mail_accounts a where a.id = t.account_id and a.workspace_id = v_workspace and a.user_id = v_user;
  update public.mail_enrollments e set status = 'paused', last_error = v_note, updated_at = v_now
    from public.mail_accounts a where a.id = e.account_id and a.workspace_id = v_workspace and a.user_id = v_user and e.status = 'active';
  update public.mail_accounts set status = 'disconnected', last_error = v_note, updated_at = v_now
    where workspace_id = v_workspace and user_id = v_user and status <> 'disconnected';
  return null;
end $$;
revoke all on function makeborne_private.revoke_departed_member_mailboxes() from public, anon, authenticated, service_role;
comment on function makeborne_private.revoke_departed_member_mailboxes() is
  'After a member leaves or stops being an editor, disconnect the mailboxes they connected in that workspace (same effect as the Disconnect route).';

drop trigger if exists workspace_member_mailbox_revocation on public.workspace_members;
create trigger workspace_member_mailbox_revocation
  after delete or update of role, workspace_id, user_id on public.workspace_members
  for each row execute function makeborne_private.revoke_departed_member_mailboxes();

-- Reads of project-assets objects are server-only from now on. The insert policy
-- (editors upload into their own workspace prefix) is unchanged.
drop policy if exists project_assets_read on storage.objects;

commit;
