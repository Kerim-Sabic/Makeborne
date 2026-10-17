-- Brand kits: shape, one kit per owner, client consistency, cascades, RLS and grants.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261014190000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); editor uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  k jsonb := '{"name":"Saffron Table","colors":{"primary":"#b4532a"}}'; n integer; stamp timestamptz;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.brand_kits'::regclass), 'RLS disabled';
  assert (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'brand_kits')
    = array['id','workspace_id','client_id','kit','updated_by','created_at','updated_at'], 'Unexpected columns';
  assert (select count(*) from pg_constraint where conrelid = 'public.brand_kits'::regclass and contype = 'f' and confdeltype = 'c') = 2, 'Foreign keys must cascade';
  raise notice 'PASS brand kits: columns and cascading keys';

  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@brand.example.invalid',now()),(editor,editor||'@brand.example.invalid',now()),(stranger,stranger||'@brand.example.invalid',now());
  insert into public.workspaces(id,name,owner_id) values(w,'Brand fixture',u),(w2,'Other fixture',stranger);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,editor,'editor');
  insert into public.clients(id,workspace_id,name) values(c,w,'Saffron Table'),(c2,w2,'Elsewhere');

  -- One workspace kit (client null) and one per client; the server upsert target works with nulls.
  insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,null,k,u),(w,c,k,u);
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,null,k,u); raise exception 'second workspace kit accepted';
  exception when unique_violation then null; end;
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,c,k,u); raise exception 'second client kit accepted';
  exception when unique_violation then null; end;
  insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,null,k || '{"tagline":"Fire"}',u)
    on conflict (workspace_id,client_id) do update set kit = excluded.kit;
  assert (select kit->>'tagline' from public.brand_kits where workspace_id = w and client_id is null) = 'Fire', 'upsert on the workspace kit failed';
  -- A client from another workspace can never carry this workspace's kit.
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,c2,k,u); raise exception 'cross-workspace client accepted';
  exception when foreign_key_violation then null; end;
  raise notice 'PASS brand kits: one per workspace and per client, upsert, client must belong to the workspace';

  -- Shape of the stored kit.
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w2,null,'{"name":"x","colors":{"primary":"red"}}',stranger); raise exception 'bad colour accepted';
  exception when check_violation then null; end;
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w2,null,'[]',stranger); raise exception 'array accepted';
  exception when check_violation then null; end;
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w2,null,jsonb_build_object('name','x','colors',jsonb_build_object('primary','#000000'),'logo',repeat('A',460000)),stranger); raise exception 'oversized kit accepted';
  exception when check_violation then null; end;
  stamp := (select updated_at from public.brand_kits where workspace_id = w and client_id = c);
  perform pg_sleep(0.01);
  update public.brand_kits set kit = k where workspace_id = w and client_id = c;
  -- now() is the transaction start, so the touch trigger keeps it equal within this test; it must not move backwards.
  assert (select updated_at >= stamp from public.brand_kits where workspace_id = w and client_id = c), 'updated_at moved backwards';
  raise notice 'PASS brand kits: kit shape and size checks';

  -- RLS: owner and editor read; a stranger reads nothing; browser roles cannot write.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.brand_kits) = 2, 'owner should read both kits';
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,null,k,u); raise exception 'authenticated insert allowed';
  exception when insufficient_privilege then null; end;
  begin update public.brand_kits set kit = k; raise exception 'authenticated update allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.brand_kits; raise exception 'authenticated delete allowed';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',editor,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.brand_kits) = 2, 'editor should read both kits';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',stranger,'role','authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.brand_kits where workspace_id = w) = 0, 'stranger read another workspace';
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin perform 1 from public.brand_kits; raise exception 'anon read allowed';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS brand kits: members read, strangers and browser writes refused';

  -- Deleting the client removes its kit; the workspace kit stays.
  delete from public.clients where id = c;
  select count(*) into n from public.brand_kits where workspace_id = w;
  assert n = 1, 'client kit should cascade with the client';
  raise notice 'PASS brand kits: client deletion cascades';
end $$;
rollback;
