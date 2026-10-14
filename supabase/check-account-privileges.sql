-- Isolated, rolled-back fixtures. No provider calls, email or lasting grants.
begin;
do $$
declare
  admin_id uuid:=gen_random_uuid(); ordinary_id uuid:=gen_random_uuid(); unconfirmed_id uuid:=gen_random_uuid();
  w uuid:=gen_random_uuid(); other_w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  q uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); r uuid; s jsonb;
  t timestamptz:=clock_timestamp(); flags jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    (admin_id,'admin-fixture-'||admin_id||'@example.invalid',t,false),
    (ordinary_id,'ordinary-fixture-'||ordinary_id||'@example.invalid',t,false),
    (unconfirmed_id,'unconfirmed-fixture-'||unconfirmed_id||'@example.invalid',null,false);
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason)
    values(admin_id,true,true,'Transaction fixture'),(unconfirmed_id,true,true,'Transaction fixture');
  -- This fixture covers the paid/admin path; check-credit-wallets.sql covers the free tier.
  update makeborne_private.billing_settings set free_tier_enabled=false where singleton;
  insert into public.workspaces(id,name,owner_id) values(w,'Admin fixture',admin_id),(other_w,'Ordinary fixture',ordinary_id);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ordinary_id,'editor');
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Allowance fixture','website');

  assert not makeborne_private.has_account_privilege(unconfirmed_id,'admin'), 'Unconfirmed account authorized';
  assert not makeborne_private.has_account_privilege(admin_id,'unknown'), 'Unknown permission authorized';
  assert exists(select 1 from makeborne_private.account_privilege_events where user_id=admin_id and action='INSERT'), 'Grant was not audited';
  update auth.users set banned_until=now()+interval '1 day' where id=admin_id;
  assert not makeborne_private.has_account_privilege(admin_id,'admin'), 'Banned account authorized';
  update auth.users set banned_until=null where id=admin_id;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',ordinary_id,'role','authenticated','user_metadata',jsonb_build_object('is_admin',true,'unlimited_credits',true))::text,true);
  set local role authenticated;
  flags=public.makeborne_my_account_privileges();
  assert flags->>'userId'=ordinary_id::text and flags->>'isAdmin'='false' and flags->>'unlimitedCredits'='false', 'Forged metadata gave privileges';
  assert not makeborne_private.has_creation_membership(), 'Unpaid user bypassed membership';
  assert not makeborne_private.can_edit(w), 'Editor inherited admin owner allowance';
  begin
    insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(ordinary_id,true,true,'Spoof');
    raise exception 'Client self-promotion accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from makeborne_private.account_privileges;
    raise exception 'Client read private grants';
  exception when insufficient_privilege then null; end;
  begin
    perform makeborne_private.has_account_privilege(admin_id,'admin');
    raise exception 'Client queried another account privileges';
  exception when insufficient_privilege then null; end;
  begin
    update public.workspaces set name='Unpaid fixture' where id=other_w;
    raise exception 'Unpaid creation accepted';
  exception when sqlstate 'MB402' then null; end;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  set local role authenticated;
  flags=public.makeborne_my_account_privileges();
  assert flags->>'userId'=admin_id::text and flags->>'isAdmin'='true' and flags->>'unlimitedCredits'='true', 'Admin allowance unavailable';
  assert makeborne_private.has_creation_membership(), 'Admin needs payment';
  assert makeborne_private.can_edit(w), 'Admin cannot edit own workspace';
  assert not makeborne_private.can_read(other_w) and not makeborne_private.can_edit(other_w), 'Admin bypassed tenant isolation';
  perform public.makeborne_create_record(w,gen_random_uuid(),'create_client','{"name":"Admin creation fixture"}'::jsonb);
  reset role;

  update makeborne_private.account_privileges set is_admin=false where user_id=admin_id;
  set local role authenticated;
  assert not (public.makeborne_my_account_privileges()->>'isAdmin')::boolean, 'Role revocation stale';
  assert not makeborne_private.has_creation_membership(), 'Revoked admin bypassed payment';
  reset role;
  update makeborne_private.account_privileges set is_admin=true where user_id=admin_id;
  assert (select count(*) from makeborne_private.account_privilege_events where user_id=admin_id)=3, 'Role changes missing audit';
  perform set_config('request.jwt.claims','{}',true);
  set local role anon;
  begin
    perform public.makeborne_my_account_privileges();
    raise exception 'Anonymous privilege RPC accepted';
  exception when insufficient_privilege then null; end;
  reset role;

  s=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat('b',64),
    'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',w,'projectId',p,'artifactId',null),'baseVersionId',null),
    'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,
      'maximumVendorMicrousd','12','maximumCustomerCredits','10000','preparedAt',t,'expiresAt',t+interval '1 hour',
      'stages',jsonb_build_array('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)));
  insert into makeborne_private.generation_proposals(id,workspace_id,project_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
    values(q,w,p,repeat('a',64),repeat('b',64),s,12,10000,t,t+interval '1 hour'),
      (q2,w,p,repeat('a',64),repeat('c',64),jsonb_set(s,'{approvalHash}',to_jsonb(repeat('c',64))),12,10000,t,t+interval '1 hour');
  insert into makeborne_private.generation_budgets(workspace_id,vendor_limit,credit_limit) values(w,11,0);
  begin
    perform makeborne_private.reserve_generation_proposal(q,k,admin_id,repeat('b',64),repeat('a',64));
    raise exception 'Admin bypassed disabled spending';
  exception when insufficient_privilege then null; end;
  update makeborne_private.generation_budgets set spending_enabled=true where workspace_id=w;
  begin
    perform makeborne_private.reserve_generation_proposal(q,k,admin_id,repeat('b',64),repeat('a',64));
    raise exception 'Admin bypassed vendor ceiling';
  exception when sqlstate 'MB402' then null; end;
  update makeborne_private.generation_budgets set vendor_limit=100,emergency_stop=true where workspace_id=w;
  begin
    perform makeborne_private.reserve_generation_proposal(q,k,admin_id,repeat('b',64),repeat('a',64));
    raise exception 'Admin bypassed emergency stop';
  exception when insufficient_privilege then null; end;
  update makeborne_private.generation_budgets set emergency_stop=false,concurrency_limit=2 where workspace_id=w;
  set local role service_role;
  r=makeborne_private.reserve_generation_proposal(q,k,admin_id,repeat('b',64),repeat('a',64));
  assert r=makeborne_private.reserve_generation_proposal(q,k,admin_id,repeat('b',64),repeat('a',64)), 'Reservation replay mismatch';
  reset role;
  assert exists(select 1 from makeborne_private.generation_reservations where id=r and credit_amount=0 and credits_waived and vendor_amount=12), 'Admin credits were not waived';
  assert exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and credit_reserved=0 and vendor_reserved=12 and active_reservations=1), 'Wrong reservation counters';
  begin
    perform makeborne_private.reserve_generation_proposal(q2,gen_random_uuid(),ordinary_id,repeat('c',64),repeat('a',64));
    raise exception 'Ordinary editor inherited unlimited credits';
  exception when sqlstate 'MB402' then null; end;
  update makeborne_private.account_privileges set unlimited_credits=false where user_id=admin_id;
  begin
    perform makeborne_private.claim_generation_dispatch(r,gen_random_uuid(),admin_id,repeat('b',64),repeat('a',64));
    raise exception 'Dispatch used revoked credit allowance';
  exception when sqlstate 'PT409' then null; end;
  perform makeborne_private.release_generation_reservation(r,admin_id,'Fixture cancellation');
  assert exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and credit_reserved=0 and vendor_reserved=0 and active_reservations=0), 'Waived reservation release failed';
end $$;
select 'PASS: account roles, self-promotion denial, tenant boundaries, revocation, audit, credit waiver and vendor limits' as result;
rollback;
