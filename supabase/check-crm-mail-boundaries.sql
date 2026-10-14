-- Final correction permissions and tenant/reference boundaries; all data rolls back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); ws uuid; other_ws uuid; c uuid; c2 uuid; other_c uuid;
  a uuid; a2 uuid; other_a uuid; s uuid; other_s uuid; e uuid; m uuid; f text;
begin
  if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
  foreach f in array array['makeborne_private.mail_token_read(uuid)','makeborne_private.mail_token_write(uuid,text,text,timestamptz)',
    'public.makeborne_mail_token_read(uuid)','public.makeborne_mail_token_write(uuid,text,text,timestamptz)'] loop
    assert not has_function_privilege('anon',f,'execute');
    assert not has_function_privilege('authenticated',f,'execute');
    assert has_function_privilege('service_role',f,'execute');
    assert (select pg_get_userbyid(proowner)='postgres' and proconfig @> array['search_path=""']
      and prosecdef=(f like 'makeborne_private.%') from pg_proc where oid=f::regprocedure);
  end loop;
  assert (select relrowsecurity from pg_class where oid='makeborne_private.mail_tokens'::regclass);
  foreach f in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(f,'makeborne_private.mail_tokens','select,insert,update,delete');
  end loop;
  set local role service_role;
  begin perform 1 from makeborne_private.mail_tokens; raise exception 'Direct token SELECT allowed';
  exception when insufficient_privilege then null; end;
  begin delete from makeborne_private.mail_tokens; raise exception 'Direct token DELETE allowed';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS mail boundaries: explicit owner, private definer/public invoker, restricted RPC grants, token RLS and no direct service table access';

  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into auth.users(id,email,email_confirmed_at) values(u,'mail-boundaries@example.invalid',now()),(other_u,'other-boundaries@example.invalid',now());
  insert into public.workspaces(name,owner_id) values('Mail boundaries fixture',u) returning id into ws;
  insert into public.workspaces(name,owner_id) values('Other boundaries fixture',other_u) returning id into other_ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(other_ws,u,'editor');
  insert into public.clients(workspace_id,name) values(ws,'Client') returning id into c;
  insert into public.clients(workspace_id,name) values(ws,'Another client') returning id into c2;
  insert into public.clients(workspace_id,name) values(other_ws,'Other workspace client') returning id into other_c;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,u,'google','first@example.invalid') returning id into a;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,u,'google','second@example.invalid') returning id into a2;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(other_ws,u,'google','other@example.invalid') returning id into other_a;
  insert into public.mail_sequences(workspace_id,name,steps) values(ws,'Sequence','[{}]') returning id into s;
  insert into public.mail_sequences(workspace_id,name,steps) values(other_ws,'Other sequence','[{}]') returning id into other_s;
  set local role service_role;
  begin insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws,other_s,c,a); raise exception 'Cross-tenant sequence accepted';
  exception when foreign_key_violation then null; end;
  begin insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws,s,c,other_a); raise exception 'Cross-tenant account accepted';
  exception when foreign_key_violation then null; end;
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws,s,c,a) returning id into e;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,direction,status) values(ws,c,other_a,'in','received'); raise exception 'Cross-tenant message account accepted';
  exception when foreign_key_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,direction,status) values(other_ws,other_c,other_a,e,'in','received'); raise exception 'Cross-tenant enrollment accepted';
  exception when foreign_key_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,direction,status) values(ws,c2,a,e,'in','received'); raise exception 'Wrong enrollment client accepted';
  exception when foreign_key_violation then null; end;
  begin insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,direction,status) values(ws,c,a2,e,'in','received'); raise exception 'Wrong enrollment mailbox accepted';
  exception when foreign_key_violation then null; end;
  begin insert into public.mail_messages(workspace_id,account_id,enrollment_id,direction,status) values(ws,a,e,'in','received'); raise exception 'Null client bypassed composite match';
  exception when check_violation then null; end;
  insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,step,direction,status) values(ws,c,a,e,0,'out','sent') returning id into m;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  begin update public.mail_sequences set workspace_id=other_ws where id=s; raise exception 'Linked sequence moved despite enrollment';
  exception when foreign_key_violation then null; end;
  reset role;
  raise notice 'PASS mail boundaries: server cross-tenant/wrong-client/wrong-account/null-client bindings rejected; linked sequence cannot move even with both workspace permissions';

  delete from public.mail_enrollments where id=e;
  assert (select enrollment_id is null and workspace_id=ws and account_id=a and client_id=c from public.mail_messages where id=m);
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws,s,c,a) returning id into e;
  update public.mail_messages set enrollment_id=e where id=m;
  delete from public.mail_sequences where id=s;
  assert not exists(select 1 from public.mail_enrollments where id=e);
  assert (select enrollment_id is null and workspace_id=ws and account_id=a and client_id=c from public.mail_messages where id=m);
  delete from public.mail_accounts where id=a;
  assert not exists(select 1 from public.mail_messages where id=m);
  raise notice 'PASS mail boundaries: enrollment/sequence deletion retains message tenant/client/account fields; mailbox deletion still cascades';

  assert not makeborne_private.valid_lead_tags(array[['matrix']]);
  assert not makeborne_private.valid_lead_tags('[0:0]={shifted}'::text[]);
  assert not makeborne_private.valid_lead_tags(null);
  assert makeborne_private.valid_lead_tags('{}'::text[]);
  assert makeborne_private.valid_lead_tags(array_fill('valid'::text,array[12]));
  begin update public.clients set tags=array[['matrix']] where id=c; raise exception 'Matrix tags persisted';
  exception when check_violation then null; end;
  begin update public.clients set tags='[0:0]={shifted}'::text[] where id=c; raise exception 'Shifted array persisted';
  exception when check_violation then null; end;
  raise notice 'PASS mail boundaries: multidimensional and shifted tag arrays rejected; empty and bounded flat arrays remain compatible';
end $$;
rollback;
