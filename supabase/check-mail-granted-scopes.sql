-- Disposable local rehearsal only; no real OAuth or mailbox calls.
\set ON_ERROR_STOP on
begin;
do $$
declare
  owner_ uuid:=gen_random_uuid(); editor_ uuid:=gen_random_uuid(); reviewer_ uuid:=gen_random_uuid(); outsider_ uuid:=gen_random_uuid();
  ws uuid; account_ uuid; member_ uuid; n integer; invalid_ text; scopes_ text[];
begin
  if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
  assert (select relrowsecurity from pg_class where oid='public.mail_accounts'::regclass);
  assert has_table_privilege('authenticated','public.mail_accounts','select');
  assert not has_table_privilege('authenticated','public.mail_accounts','insert,update,delete');
  assert not has_column_privilege('authenticated','public.mail_accounts','granted_scopes','insert,update');
  assert not has_table_privilege('anon','public.mail_accounts','select,insert,update,delete');
  assert has_column_privilege('service_role','public.mail_accounts','granted_scopes','select,insert,update');
  assert (select not prosecdef and provolatile='i' and pg_get_userbyid(proowner)='postgres'
    and proconfig @> array['search_path=""'] from pg_proc where oid='makeborne_private.valid_mail_granted_scopes(text[])'::regprocedure);
  assert not has_function_privilege('anon','makeborne_private.valid_mail_granted_scopes(text[])','execute');
  assert not has_function_privilege('authenticated','makeborne_private.valid_mail_granted_scopes(text[])','execute');
  assert has_function_privilege('service_role','makeborne_private.valid_mail_granted_scopes(text[])','execute');
  raise notice 'PASS scopes SQL: RLS/ACLs retained, no browser scope writes, service validation callable, immutable private invoker';

  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into auth.users(id,email,email_confirmed_at)
    select id,id::text||'@scope-rehearsal.invalid',now() from unnest(array[owner_,editor_,reviewer_,outsider_]) id;
  insert into public.workspaces(name,owner_id) values('Scopes fixture',owner_) returning id into ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,editor_,'editor'),(ws,reviewer_,'reviewer');
  set local role service_role;
  -- Old application insert remains valid and records no inferred permission.
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,owner_,'google','scope-fixture@example.invalid') returning id into account_;
  assert (select granted_scopes='{}'::text[] from public.mail_accounts where id=account_);
  scopes_:=array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'];
  update public.mail_accounts set granted_scopes=scopes_ where id=account_;
  assert (select granted_scopes=scopes_ from public.mail_accounts where id=account_);
  update public.mail_accounts set display_name='Old application edit' where id=account_;
  assert (select granted_scopes=scopes_ from public.mail_accounts where id=account_);
  assert makeborne_private.valid_mail_granted_scopes(array['Mail.Send','Mail.ReadWrite','offline_access','https://graph.microsoft.com/User.Read']);
  reset role;
  raise notice 'PASS scopes SQL: service insert default empty, recorded Google/Microsoft scope formats valid, unrelated edits preserve grants';

  foreach member_ in array array[owner_,editor_,reviewer_,outsider_] loop
    perform set_config('request.jwt.claims',json_build_object('sub',member_,'role','authenticated')::text,true);
    set local role authenticated;
    select count(*) into n from public.mail_accounts where id=account_ and granted_scopes=scopes_;
    assert n=case when member_=outsider_ then 0 else 1 end, 'Scope evidence crossed tenant boundary';
    begin update public.mail_accounts set granted_scopes=array['https://www.googleapis.com/auth/gmail.readonly'] where id=account_; raise exception 'Browser fabricated scope evidence';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  set local role anon;
  begin perform granted_scopes from public.mail_accounts where id=account_; raise exception 'Anonymous scope read allowed';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS scopes SQL: owner/editor/reviewer read own workspace evidence, outsider/anonymous denied, all browsers unable to fabricate grants';

  set local role service_role;
  foreach invalid_ in array array['',' leading','trailing ','two scopes',E'line\nbreak',E'tab\tbreak','<scope>','scope?query','é',repeat('s',201)] loop
    begin update public.mail_accounts set granted_scopes=array[invalid_] where id=account_; raise exception 'Malformed scope accepted';
    exception when check_violation then null; end;
  end loop;
  begin update public.mail_accounts set granted_scopes=array[null::text] where id=account_; raise exception 'Null scope accepted';
  exception when check_violation then null; end;
  begin update public.mail_accounts set granted_scopes=null where id=account_; raise exception 'Null grant list accepted';
  exception when not_null_violation then null; end;
  begin update public.mail_accounts set granted_scopes=array['email','email'] where id=account_; raise exception 'Duplicate grants accepted';
  exception when check_violation then null; end;
  begin update public.mail_accounts set granted_scopes=array[['email']] where id=account_; raise exception 'Matrix grants accepted';
  exception when check_violation then null; end;
  begin update public.mail_accounts set granted_scopes='[0:0]={email}'::text[] where id=account_; raise exception 'Shifted grant array accepted';
  exception when check_violation then null; end;
  begin update public.mail_accounts set granted_scopes=(select array_agg('scope'||g) from generate_series(1,33) g) where id=account_; raise exception 'Too many grants accepted';
  exception when check_violation then null; end;
  assert (select granted_scopes=scopes_ from public.mail_accounts where id=account_), 'Rejected writes changed grants';
  update public.mail_accounts set granted_scopes=(select array_agg(repeat('s',198)||lpad(g::text,2,'0')) from generate_series(1,32) g) where id=account_;
  assert (select cardinality(granted_scopes)=32 and length(granted_scopes[32])=200 from public.mail_accounts where id=account_);
  update public.mail_accounts set granted_scopes='{}' where id=account_;
  assert (select granted_scopes='{}'::text[] from public.mail_accounts where id=account_);
  reset role;
  raise notice 'PASS scopes SQL: invalid content/null/duplicate/matrix/lower-bound/count/length rejected without mutation; 32 by 200 boundary and empty list valid';
end $$;
rollback;
