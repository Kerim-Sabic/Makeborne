-- Disposable rehearsal container only. All fixtures and token strings roll back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
end $$;
do $$
declare
  owner_ uuid:=gen_random_uuid(); editor_ uuid:=gen_random_uuid(); reviewer_ uuid:=gen_random_uuid(); outsider_ uuid:=gen_random_uuid();
  ws_ uuid; other_ws uuid; client_ uuid; other_client uuid; account_ uuid; template_ uuid; sequence_ uuid; enrollment_ uuid;
  name_ text; role_user uuid; n integer; token_ jsonb; message_ uuid;
begin
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into auth.users(id,email,email_confirmed_at)
    select id,id::text||'@mail-rehearsal.invalid',now() from unnest(array[owner_,editor_,reviewer_,outsider_]) id;
  insert into public.workspaces(name,owner_id) values('Mail security fixture',owner_) returning id into ws_;
  insert into public.workspaces(name,owner_id) values('Other mail fixture',outsider_) returning id into other_ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws_,editor_,'editor'),(ws_,reviewer_,'reviewer');
  insert into public.clients(workspace_id,name) values(ws_,'Mail fixture client') returning id into client_;
  insert into public.clients(workspace_id,name) values(other_ws,'Other fixture client') returning id into other_client;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws_,owner_,'google','owner@mail-rehearsal.invalid') returning id into account_;
  insert into public.mail_templates(workspace_id,name,body) values(ws_,'Fixture template','Fixture body') returning id into template_;
  insert into public.mail_sequences(workspace_id,name,steps) values(ws_,'Fixture sequence','[{"delayDays":0,"subject":"Hello","body":"Fixture"}]') returning id into sequence_;
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws_,sequence_,client_,account_) returning id into enrollment_;
  insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,step,direction,status,provider_message_id)
    values(ws_,client_,account_,enrollment_,0,'out','sent','fixture-message') returning id into message_;
  foreach name_ in array array['mail_accounts','mail_templates','mail_sequences','mail_enrollments','mail_messages'] loop
    assert (select relrowsecurity from pg_class where pg_class.oid=('public.'||name_)::regclass);
    assert not has_table_privilege('anon','public.'||name_,'select');
    assert has_table_privilege('authenticated','public.'||name_,'select');
    assert has_table_privilege('service_role','public.'||name_,'select,insert,update,delete');
  end loop;
  foreach name_ in array array['mail_accounts','mail_enrollments','mail_messages'] loop
    assert not has_table_privilege('authenticated','public.'||name_,'insert,update,delete');
  end loop;
  assert not has_table_privilege('authenticated','makeborne_private.mail_tokens','select,insert,update,delete');
  assert not has_table_privilege('anon','makeborne_private.mail_tokens','select,insert,update,delete');
  foreach name_ in array array['public.makeborne_mail_token_read(uuid)','public.makeborne_mail_token_write(uuid,text,text,timestamptz)'] loop
    assert not has_function_privilege('anon',name_,'execute');
    assert not has_function_privilege('authenticated',name_,'execute');
    assert has_function_privilege('service_role',name_,'execute');
    assert (select proconfig @> array['search_path=""'] from pg_proc where pg_proc.oid=name_::regprocedure);
  end loop;
  raise notice 'PASS mail SQL: exposed tables RLS, browser/server write ACLs, private token and RPC ACLs, pinned search paths';

  foreach role_user in array array[owner_,editor_,reviewer_,outsider_] loop
    perform set_config('request.jwt.claims',json_build_object('sub',role_user,'role','authenticated')::text,true);
    set local role authenticated;
    foreach name_ in array array['mail_accounts','mail_templates','mail_sequences','mail_enrollments','mail_messages'] loop
      execute format('select count(*) from public.%I where workspace_id=$1',name_) into n using ws_;
      assert n=case when role_user=outsider_ then 0 else 1 end, 'Mail tenant read leaked or lost records';
    end loop;
    begin perform public.makeborne_mail_token_read(account_); raise exception 'Browser read token RPC';
    exception when insufficient_privilege then null; end;
    begin perform public.makeborne_mail_token_write(account_,'replacement',null,null); raise exception 'Browser wrote token RPC';
    exception when insufficient_privilege then null; end;
    begin perform 1 from makeborne_private.mail_tokens; raise exception 'Browser read private tokens';
    exception when insufficient_privilege then null; end;
    begin update public.mail_accounts set status='disconnected' where id=account_; raise exception 'Browser wrote server mailbox';
    exception when insufficient_privilege then null; end;
    update public.mail_templates set subject='Updated' where id=template_;
    get diagnostics n=row_count;
    assert n=case when role_user in (owner_,editor_) then 1 else 0 end, 'Template edit RLS mismatch';
    update public.mail_sequences set name='Updated fixture' where id=sequence_;
    get diagnostics n=row_count;
    assert n=case when role_user in (owner_,editor_) then 1 else 0 end, 'Sequence edit RLS mismatch';
    if role_user in (owner_,editor_) then
      begin update public.mail_templates set workspace_id=other_ws where id=template_; raise exception 'Template moved across workspace boundary';
      exception when insufficient_privilege then null; end;
      begin update public.mail_sequences set workspace_id=other_ws where id=sequence_; raise exception 'Sequence moved across workspace boundary';
      exception when insufficient_privilege then null; end;
    else
      begin insert into public.mail_templates(workspace_id,name,body) values(ws_,'Denied','Denied'); raise exception 'Non-editor inserted template';
      exception when insufficient_privilege then null; end;
      begin insert into public.mail_sequences(workspace_id,name,steps) values(ws_,'Denied','[{}]'); raise exception 'Non-editor inserted sequence';
      exception when insufficient_privilege then null; end;
    end if;
    reset role;
  end loop;
  raise notice 'PASS mail SQL: owner/editor/reviewer/outsider visibility, editor-only edits, workspace-move refusal, token calls and mailbox writes denied';

  set local role service_role;
  assert public.makeborne_mail_token_read(account_) is null;
  begin perform public.makeborne_mail_token_write(account_,null,'access',now()); raise exception 'Missing refresh-token row accepted';
  exception when no_data_found then null; end;
  perform public.makeborne_mail_token_write(account_,'sealed-fixture-refresh','sealed-fixture-access',now()+interval '1 hour');
  token_:=public.makeborne_mail_token_read(account_);
  assert token_->>'refresh_token'='sealed-fixture-refresh' and token_->>'access_token'='sealed-fixture-access';
  perform public.makeborne_mail_token_write(account_,null,'sealed-fixture-renewed',now()+interval '2 hours');
  token_:=public.makeborne_mail_token_read(account_);
  assert token_->>'refresh_token'='sealed-fixture-refresh' and token_->>'access_token'='sealed-fixture-renewed';
  begin perform public.makeborne_mail_token_write(account_,repeat('x',8001),null,null); raise exception 'Unbounded token accepted';
  exception when check_violation then null; end;
  reset role;
  assert (select count(*) from makeborne_private.mail_tokens where account_id=account_)=1;
  raise notice 'PASS mail SQL: token missing-row failure, service read/write, refresh preservation, unique row and size bound';

  begin insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws_,sequence_,client_,account_); raise exception 'Duplicate active enrollment accepted';
  exception when unique_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,step,direction,status)
    values(ws_,client_,account_,enrollment_,0,'out','sending'); raise exception 'Duplicate step accepted';
  exception when unique_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,direction,status,provider_message_id)
    values(ws_,client_,account_,'in','received','fixture-message'); raise exception 'Duplicate provider message accepted';
  exception when unique_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,direction,status)
    values(ws_,other_client,account_,'in','received'); raise exception 'Foreign client accepted';
  exception when foreign_key_violation then null; end;
  begin update public.mail_sequences set steps='[]' where id=sequence_; raise exception 'Empty sequence accepted';
  exception when check_violation then null; end;
  begin update public.mail_sequences set steps=(select jsonb_agg('{}'::jsonb) from generate_series(1,9)) where id=sequence_; raise exception 'Long sequence accepted';
  exception when check_violation then null; end;
  begin update public.mail_accounts set daily_limit=201 where id=account_; raise exception 'Oversized daily quota accepted';
  exception when check_violation then null; end;
  delete from public.mail_accounts where id=account_;
  assert not exists(select 1 from makeborne_private.mail_tokens where account_id=account_);
  assert not exists(select 1 from public.mail_messages where id=message_);
  assert not exists(select 1 from public.mail_enrollments where id=enrollment_);
  raise notice 'PASS mail SQL: unique send/enrollment/message claims, client workspace binding, sequence/quota bounds, mailbox cascade cleanup';
end $$;
rollback;
