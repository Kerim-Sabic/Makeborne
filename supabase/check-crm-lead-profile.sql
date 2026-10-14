-- Disposable rehearsal container only; additive compatibility and validation.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'rehearsal' then raise exception 'Disposable rehearsal database required'; end if;
end $$;
do $$
declare
  owner_ uuid:=gen_random_uuid(); editor_ uuid:=gen_random_uuid(); reviewer_ uuid:=gen_random_uuid(); outsider_ uuid:=gen_random_uuid();
  ws_ uuid; client_ uuid; role_user uuid; n integer; invalid_tags text[]; text_ text;
begin
  update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
  insert into auth.users(id,email,email_confirmed_at)
    select id,id::text||'@lead-rehearsal.invalid',now() from unnest(array[owner_,editor_,reviewer_,outsider_]) id;
  insert into public.workspaces(name,owner_id) values('Lead security fixture',owner_) returning id into ws_;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws_,editor_,'editor'),(ws_,reviewer_,'reviewer');
  -- Previous app insert does not know about any new columns.
  insert into public.clients(workspace_id,name) values(ws_,'Old app client') returning id into client_;
  assert (select tags='{}'::text[] and deal_value is null and deal_currency='EUR' and lead_source='' and lead_profile='{}'::jsonb from public.clients where id=client_);
  assert exists(select 1 from pg_indexes where schemaname='public' and tablename='clients' and indexname='clients_tags' and indexdef like '%USING gin (tags)%');
  assert not has_table_privilege('authenticated','public.clients','update');
  foreach text_ in array array['tags','deal_value','deal_currency','lead_source','lead_profile'] loop
    assert has_column_privilege('authenticated','public.clients',text_,'update');
  end loop;
  raise notice 'PASS lead SQL: old app insert uses empty additive defaults and tags GIN index exists';

  update public.clients set tags=array['Creator','Design'],deal_value=1234.56,deal_currency='USD',lead_source='Referral',lead_profile='{"research":{"followers":123},"insight":{"confidence":"low"}}' where id=client_;
  update public.clients set name='Old app edit' where id=client_;
  assert (select tags=array['Creator','Design'] and deal_value=1234.56 and lead_profile->'research'->>'followers'='123' from public.clients where id=client_);
  foreach role_user in array array[owner_,editor_,reviewer_,outsider_] loop
    perform set_config('request.jwt.claims',json_build_object('sub',role_user,'role','authenticated')::text,true);
    set local role authenticated;
    select count(*) into n from public.clients where id=client_;
    assert n=case when role_user=outsider_ then 0 else 1 end;
    update public.clients set tags=array['Updated'],deal_value=500.25,lead_source='Edited',lead_profile='{"insight":{"angle":"fixture"}}' where id=client_;
    get diagnostics n=row_count;
    assert n=case when role_user in (owner_,editor_) then 1 else 0 end;
    reset role;
  end loop;
  raise notice 'PASS lead SQL: old edits retain profile fields; owner/editor writes and reviewer/outsider restrictions preserved';

  foreach text_ in array array['',repeat('x',31),'bad<tag','bad>tag',E'bad\ntag',E'bad\rtag'] loop
    begin update public.clients set tags=array[text_] where id=client_; raise exception 'Invalid tag accepted';
    exception when check_violation then null; end;
  end loop;
  invalid_tags:=array_fill('tag'::text,array[13]);
  begin update public.clients set tags=invalid_tags where id=client_; raise exception 'Too many tags accepted';
  exception when check_violation then null; end;
  begin update public.clients set tags=array[null::text] where id=client_; raise exception 'Null tag accepted';
  exception when check_violation then null; end;
  begin update public.clients set tags=null where id=client_; raise exception 'Null tag array accepted';
  exception when not_null_violation then null; end;
  begin update public.clients set deal_value=-0.01 where id=client_; raise exception 'Negative deal accepted';
  exception when check_violation then null; end;
  begin update public.clients set deal_value=100000000.01 where id=client_; raise exception 'Oversized deal accepted';
  exception when check_violation then null; end;
  foreach text_ in array array['usd','US','USDx'] loop
    begin update public.clients set deal_currency=text_ where id=client_; raise exception 'Invalid currency accepted';
    exception when check_violation then null; end;
  end loop;
  begin update public.clients set lead_source=repeat('x',61) where id=client_; raise exception 'Long source accepted';
  exception when check_violation then null; end;
  begin update public.clients set lead_profile='[]' where id=client_; raise exception 'Array profile accepted';
  exception when check_violation then null; end;
  begin update public.clients set lead_profile=jsonb_build_object('bio',repeat('x',8000)) where id=client_; raise exception 'Oversized profile accepted';
  exception when check_violation then null; end;
  update public.clients set tags=array_fill(repeat('x',30)::text,array[12]),deal_value=100000000,lead_source=repeat('x',60),lead_profile='{}' where id=client_;
  raise notice 'PASS lead SQL: tag count/content/null, deal range, currency, source and profile shape/size boundaries';
end $$;
rollback;
