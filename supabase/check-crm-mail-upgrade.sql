-- Expanded by the rehearsal harness before applying the security correction.
-- A rolled-back test of existing data, successful upgrade and rejected upgrade.
\set ON_ERROR_STOP on
begin;
do $upgrade_test$
declare
  u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); ws uuid; other_ws uuid; c uuid; a uuid; s uuid; e uuid; m uuid; before_ jsonb; after_ jsonb;
begin
  if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
  insert into auth.users(id,email,email_confirmed_at) values(u,'mail-upgrade@example.invalid',now()),(other_u,'other-upgrade@example.invalid',now());
  insert into public.workspaces(name,owner_id) values('Mail upgrade fixture',u) returning id into ws;
  insert into public.workspaces(name,owner_id) values('Other upgrade fixture',other_u) returning id into other_ws;
  insert into public.clients(workspace_id,name) values(ws,'Upgrade client') returning id into c;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(ws,u,'google','upgrade@example.invalid') returning id into a;
  insert into public.mail_sequences(workspace_id,name,steps) values(ws,'Upgrade sequence','[{"delayDays":0,"subject":"Hello","body":"Fixture"}]') returning id into s;
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id) values(ws,s,c,a) returning id into e;
  insert into public.mail_messages(workspace_id,client_id,account_id,enrollment_id,step,direction,status) values(ws,c,a,e,0,'out','sent') returning id into m;
  perform public.makeborne_mail_token_write(a,'sealed-upgrade-refresh','sealed-upgrade-access',now());
  -- Existing released schema permits a linked sequence to move to another tenant.
  update public.mail_sequences set workspace_id=other_ws where id=s;
  begin
    execute $correction$__CRM_SECURITY_MIGRATION__$correction$;
    raise exception 'Invalid tenant data survived correction';
  exception when foreign_key_violation then null; end;
  assert to_regprocedure('makeborne_private.mail_token_read(uuid)') is null;
  assert (select prosecdef from pg_proc where oid='public.makeborne_mail_token_read(uuid)'::regprocedure);
  assert has_table_privilege('service_role','makeborne_private.mail_tokens','select');
  assert not (select relrowsecurity from pg_class where oid='makeborne_private.mail_tokens'::regclass);
  update public.mail_sequences set workspace_id=ws where id=s;
  raise notice 'PASS mail upgrade: invalid existing workspace binding rejected and earlier DDL/ACL changes rolled back';

  update public.clients set tags=array[['matrix']] where id=c;
  begin
    execute $correction$__CRM_SECURITY_MIGRATION__$correction$;
    raise exception 'Matrix tags survived correction';
  exception when check_violation then null; end;
  assert to_regprocedure('makeborne_private.mail_token_read(uuid)') is null;
  assert has_table_privilege('service_role','makeborne_private.mail_tokens','select');
  assert makeborne_private.valid_lead_tags(array[['matrix']]);
  update public.clients set tags=array['valid'] where id=c;
  raise notice 'PASS mail upgrade: invalid existing tag matrix rejected and function/constraints/ACL changes rolled back';

  select jsonb_build_object('account',(select to_jsonb(r) from public.mail_accounts r where id=a),
    'tokens',(select to_jsonb(r) from makeborne_private.mail_tokens r where account_id=a),
    'sequence',(select to_jsonb(r) from public.mail_sequences r where id=s),
    'enrollment',(select to_jsonb(r) from public.mail_enrollments r where id=e),
    'message',(select to_jsonb(r) from public.mail_messages r where id=m),
    'client',(select to_jsonb(r) from public.clients r where id=c)) into before_;
  execute $correction$__CRM_SECURITY_MIGRATION__$correction$;
  select jsonb_build_object('account',(select to_jsonb(r) from public.mail_accounts r where id=a),
    'tokens',(select to_jsonb(r) from makeborne_private.mail_tokens r where account_id=a),
    'sequence',(select to_jsonb(r) from public.mail_sequences r where id=s),
    'enrollment',(select to_jsonb(r) from public.mail_enrollments r where id=e),
    'message',(select to_jsonb(r) from public.mail_messages r where id=m),
    'client',(select to_jsonb(r) from public.clients r where id=c)) into after_;
  assert before_=after_, 'Correction rewrote existing data';
  set local role service_role;
  assert public.makeborne_mail_token_read(a)->>'refresh_token'='sealed-upgrade-refresh';
  perform public.makeborne_mail_token_write(a,null,'renewed-access',now());
  assert public.makeborne_mail_token_read(a)->>'refresh_token'='sealed-upgrade-refresh';
  reset role;
  raise notice 'PASS mail upgrade: populated fixture retained byte-identical values; existing token RPC signatures and refresh behavior work';
end $upgrade_test$;
rollback;
