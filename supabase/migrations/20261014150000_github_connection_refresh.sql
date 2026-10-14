-- GitHub connection renewal: keep GitHub's single-use refresh token (about six
-- months) next to the eight-hour user token so the server can renew the
-- connection instead of asking users to reconnect every eight hours.
-- The refresh token is AES-256-GCM sealed by the application with the account ID
-- as associated data, exactly like token_ciphertext. Additive and nullable:
-- existing rows keep working and simply need one more reconnect to gain renewal.
-- No backfill. Grants are unchanged: only service_role can read this table.
begin;
alter table public.github_connections
  add column if not exists refresh_ciphertext text,
  add column if not exists refresh_expires_at timestamptz;
-- A sealed refresh token always has an expiry and vice versa.
alter table public.github_connections drop constraint if exists github_connections_refresh_pair;
alter table public.github_connections add constraint github_connections_refresh_pair
  check ((refresh_ciphertext is null) = (refresh_expires_at is null));
comment on column public.github_connections.refresh_ciphertext is
  'Application-sealed GitHub refresh token (single use). Server-only; never sent to browsers.';
comment on column public.github_connections.refresh_expires_at is
  'When the sealed GitHub refresh token stops working; null when no refresh token is held.';
-- Re-assert the original boundary so no browser role gains access to the new columns.
revoke all on public.github_connections from public,anon,authenticated;
grant select,insert,update,delete on public.github_connections to service_role;
commit;
