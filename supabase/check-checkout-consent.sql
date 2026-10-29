\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); stamp timestamptz;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@consent.example.invalid',now()),(other_user,other_user||'@consent.example.invalid',now());
  insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status) values(req,u,'plan_consent','/studio','pending');
  assert public.makeborne_record_checkout_consent(u,req,'plan','fixture-v1','terms-v1','Exact displayed text');
  select accepted_at into strict stamp from makeborne_private.checkout_consents where user_id=u;
  assert public.makeborne_record_checkout_consent(u,req,'plan','fixture-v1','terms-v1','Exact displayed text');
  assert (select count(*)=1 and min(accepted_at)=stamp from makeborne_private.checkout_consents where user_id=u),'Retry preserves original timestamp';
  begin
    perform public.makeborne_record_checkout_consent(other_user,req,'plan','fixture-v1','terms-v1','Exact displayed text');
    raise exception 'Expected ownership refusal';
  exception when insufficient_privilege then null; end;
  begin
    perform public.makeborne_record_checkout_consent(u,req,'pack','fixture-v1','terms-v1','Exact displayed text');
    raise exception 'Expected kind binding refusal';
  exception when insufficient_privilege then null; end;
  begin
    perform public.makeborne_record_checkout_consent(u,req,'plan','fixture-v1','terms-v1','Changed text');
    raise exception 'Expected immutable text refusal';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.makeborne_record_checkout_consent(u,req,'plan','fixture-v1','terms-v2','Exact displayed text');
    raise exception 'Expected immutable terms refusal';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.makeborne_record_checkout_consent(u,req,'plan',null,'terms-v1','Exact displayed text');
    raise exception 'Expected null version refusal';
  exception when invalid_parameter_value then null; end;
  assert public.makeborne_record_checkout_consent(u,req,'plan','fixture-v2','terms-v2','New displayed version');
  assert (select count(*)=2 from makeborne_private.checkout_consents where user_id=u),'New version appends, never rewrites history';
  assert jsonb_array_length(public.makeborne_account_export_rows(u,'checkout_consents'))=2;
  assert jsonb_array_length(public.makeborne_account_export_rows(other_user,'checkout_consents'))=0,'No other account evidence exported';
  assert jsonb_array_length(public.makeborne_account_export_rows(u,'checkout_consents',1,1))=1,'Deterministic bounded pagination';
  assert jsonb_array_length(public.makeborne_account_export_rows(u,'billing_checkouts'))=1,'Existing export implementation preserved';
  delete from public.billing_checkouts where user_id=u;
  delete from auth.users where id=u;
  assert not exists(select 1 from makeborne_private.checkout_consents where user_id=u),'Auth erasure removes consent evidence';
  raise notice 'PASS consent binding, immutable text/terms, server time, idempotent retry, version append and invalid input';
end $$;
do $$ declare u uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@consent-atomic.example.invalid',now());
  begin
    perform public.makeborne_prepare_consented_checkout(u,req,'plan_consent','/studio',null,'terms-v1','Displayed text');
    raise exception 'Expected invalid consent refusal';
  exception when invalid_parameter_value then null; end;
  assert not exists(select 1 from public.billing_checkouts where request_id=req),'A failed consent write must not leave a pending checkout';
  assert public.makeborne_prepare_consented_checkout(u,req,'plan_consent','/studio','fixture-v1','terms-v1','Displayed text');
  assert exists(select 1 from public.billing_checkouts where request_id=req and user_id=u);
  assert exists(select 1 from makeborne_private.checkout_consents where request_id=req and user_id=u);
  raise notice 'PASS new checkout and consent atomic commit/rollback, no stranded pending order';
end $$;
do $$ declare f text; begin
  foreach f in array array['public.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text)','makeborne_rpc.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text)',
    'public.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text)','makeborne_rpc.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text)'] loop
    assert not has_function_privilege('anon',f,'EXECUTE');
    assert not has_function_privilege('authenticated',f,'EXECUTE');
    assert has_function_privilege('service_role',f,'EXECUTE');
  end loop;
  assert not (select prosecdef from pg_proc where oid='public.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text)'::regprocedure);
  assert (select relrowsecurity from pg_class where oid='makeborne_private.checkout_consents'::regclass);
  assert not has_table_privilege('service_role','makeborne_private.checkout_consents','INSERT,UPDATE,DELETE');
  assert not has_table_privilege('authenticated','makeborne_private.checkout_consents','SELECT');
  assert not has_table_privilege('anon','makeborne_private.checkout_consents','SELECT');
  raise notice 'PASS consent service-only RPC, private RLS, no direct mutation or browser access, no exposed definer';
end $$;
rollback;
