-- Rehearsal expands the migration placeholder. Fixtures and DDL roll back.
\set ON_ERROR_STOP on
begin;
do $scope_upgrade$
declare
  u uuid:=gen_random_uuid(); ws uuid; google_id uuid; microsoft_id uuid; before_ jsonb; after_ jsonb;
begin
  if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
  insert into auth.users(id,email,email_confirmed_at) values(u,'scope-upgrade@example.invalid',now());
  insert into public.workspaces(name,owner_id) values('Scope upgrade fixture',u) returning id into ws;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,u,'google','google-scope@example.invalid') returning id into google_id;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,u,'microsoft','microsoft-scope@example.invalid') returning id into microsoft_id;
  perform public.makeborne_mail_token_write(google_id,'sealed-google-refresh','sealed-google-access',now());
  perform public.makeborne_mail_token_write(microsoft_id,'sealed-ms-refresh','sealed-ms-access',now());
  select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.mail_accounts a where workspace_id=ws),
    'tokens',(select jsonb_agg(to_jsonb(t) order by account_id) from makeborne_private.mail_tokens t where account_id in (google_id,microsoft_id))) into before_;
  execute $scope_migration$__MAIL_SCOPE_MIGRATION__$scope_migration$;
  assert (select count(*) from public.mail_accounts where workspace_id=ws and granted_scopes='{}'::text[])=2;
  select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a)-'granted_scopes' order by id) from public.mail_accounts a where workspace_id=ws),
    'tokens',(select jsonb_agg(to_jsonb(t) order by account_id) from makeborne_private.mail_tokens t where account_id in (google_id,microsoft_id))) into after_;
  assert before_=after_, 'Adding grant evidence changed existing mailbox/token data';
  set local role service_role;
  perform public.makeborne_mail_token_write(google_id,null,'renewed-google-access',now());
  assert public.makeborne_mail_token_read(google_id)->>'refresh_token'='sealed-google-refresh';
  assert (select granted_scopes='{}'::text[] from public.mail_accounts where id=google_id);
  reset role;
  raise notice 'PASS scope upgrade: existing Google/Microsoft rows receive empty grants only; other data unchanged; existing token refresh remains compatible';
end $scope_upgrade$;
rollback;
