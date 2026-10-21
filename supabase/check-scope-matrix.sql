-- M17 scope matrix: who can read and write each protected resource, and what changes
-- when a member is removed, demoted, switches workspace or a tenant is deleted.
-- LOCAL DISPOSABLE DATABASE ONLY, after all migrations including
-- 20261020203000_scope_revocation_boundaries.sql. Everything rolls back.
--   docker exec -i <db-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-scope-matrix.sql
-- Pair with supabase/check-browser-acl.sql: on a database with privilege drift the
-- column-level assertions here fail, which is the intended signal.
\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
create temporary table scope_matrix(role text, resource text, visible integer) on commit drop;
grant insert, select on scope_matrix to authenticated, anon;
do $$
declare
  t timestamptz := clock_timestamp();
  o uuid := gen_random_uuid(); e uuid := gen_random_uuid(); r uuid := gen_random_uuid(); m uuid := gen_random_uuid();
  x uuid := gen_random_uuid(); n uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  w uuid; w2 uuid; c uuid; c2 uuid; pr uuid; pr2 uuid; art uuid; book uuid; art2 uuid; asset uuid := gen_random_uuid();
  acct_m uuid; acct_e uuid; seq uuid; enr_m uuid; enr_e uuid; dom uuid; access uuid;
  tok_fixed text; tok_latest text; tok_m text; link jsonb; res jsonb; cnt integer; ok boolean; v text;
  slug text := 'scope-matrix-'||substr(replace(gen_random_uuid()::text,'-',''),1,10);
  path text;
  resources constant text[] := array['workspaces','workspace_members','clients','contacts','projects','artifacts','artifact_versions','sources',
    'assets','tasks','brand_kits','client_review_links','client_review_comments','client_portal_access','mail_accounts','mail_templates',
    'mail_sequences','mail_enrollments','mail_messages','hosted_sites','custom_domains','site_enquiries','generation_jobs'];
  owner_only constant text[] := array['custom_domains','site_enquiries'];
  item text; who text; uid uuid;
begin
  tok_fixed := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok_latest := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  tok_m := left(translate(encode(gen_random_bytes(32),'base64'),'+/=','-_'),43);
  perform set_config('request.jwt.claims','{}',true);
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    select u, 'scope-'||u||'@example.invalid', t, false from unnest(array[o,e,r,m,x,n,p]) u;
  insert into public.workspaces(name,owner_id) values('Scope agency',o) returning id into w;
  insert into public.workspaces(name,owner_id) values('Other tenant',x) returning id into w2;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,e,'editor'),(w,r,'reviewer'),(w,m,'editor');
  insert into public.clients(workspace_id,name,email,notes) values(w,'Maple Bakery','maple@example.invalid','Private agency note') returning id into c;
  insert into public.clients(workspace_id,name) values(w2,'Other client') returning id into c2;
  insert into public.contacts(workspace_id,client_id,name) values(w,c,'Mia');
  insert into public.projects(workspace_id,client_id,title,kind) values(w,c,'Maple site','website') returning id into pr;
  insert into public.projects(workspace_id,client_id,title,kind) values(w2,c2,'Other site','website') returning id into pr2;
  insert into public.tasks(workspace_id,project_id,title) values(w,pr,'Check copy');
  insert into public.sources(workspace_id,project_id,title,kind,content) values(w,pr,'Interview','text','Private source text');
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,pr,'website','Maple site',0) returning id into art;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    values(w,art,1,'{"schemaVersion":1,"title":"Maple site","kind":"website","sections":[],"website":{"html":"<main>v1</main>","css":""}}','{}',o);
  update public.artifacts set current_version=1 where id=art;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w,pr,'book','Maple guide',0) returning id into book;
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
    select w,book,v_,('{"schemaVersion":1,"title":"Maple guide","kind":"book","sections":[{"id":"s","title":"Version '||v_||'","blocks":[{"id":"b","type":"paragraph","text":"Body '||v_||'","sourceIds":[]}]}]}')::jsonb,'{"id":"editorial","referenceAssetIds":[]}',o
    from generate_series(1,2) v_;
  update public.artifacts set current_version=2 where id=book;
  insert into public.artifacts(workspace_id,project_id,kind,title,current_version) values(w2,pr2,'website','Other site',0) returning id into art2;
  path := w||'/'||pr||'/artwork/'||asset||'.webp';
  insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values(asset,w,pr,path,'image/webp',repeat('a',64));
  insert into storage.objects(bucket_id,name,owner) values('project-assets',path,o);
  insert into storage.objects(bucket_id,name,owner) values('project-assets',w2||'/'||pr2||'/artwork/other.webp',x);
  insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,c,'{"name":"Maple","colors":{"primary":"#aa5500"}}',o);
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(w,m,'google','m-'||m||'@example.invalid') returning id into acct_m;
  insert into public.mail_accounts(workspace_id,user_id,provider,email) values(w,e,'google','e-'||e||'@example.invalid') returning id into acct_e;
  perform makeborne_private.mail_token_write(acct_m,'fixture-refresh-m','fixture-access-m',t+interval '1 hour');
  perform makeborne_private.mail_token_write(acct_e,'fixture-refresh-e','fixture-access-e',t+interval '1 hour');
  insert into public.mail_templates(workspace_id,name,body) values(w,'Hello','Hi {{first_name}}');
  insert into public.mail_sequences(workspace_id,name,steps) values(w,'Intro','[{"delayDays":0,"subject":"Hi","body":"Hello"}]') returning id into seq;
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id,next_send_at,created_by) values(w,seq,c,acct_m,t,m) returning id into enr_m;
  insert into public.mail_messages(workspace_id,account_id,client_id,direction,status,subject,body) values(w,acct_m,c,'out','sent','Hi','Private email body');
  insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,request_id,live) values(art,w,o,slug,1,'<!doctype html><main>v1</main>',gen_random_uuid(),true);
  insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by,status) values(w,art,'shop.'||slug||'.example.com',o,'active') returning id into dom;
  insert into public.site_enquiries(artifact_id,workspace_id,request_id,name,email,message,source_hash) values(art,w,gen_random_uuid(),'Visitor','v@example.invalid','Private enquiry',repeat('b',64));
  insert into public.generation_jobs(workspace_id,project_id,kind,idempotency_key) values(w,pr,'website','scope-'||gen_random_uuid());
  insert into public.credit_ledger(user_id,delta,kind,reference,balance_after) values(o,10,'adjust','scope-'||o,10);
  insert into public.client_portal_access(workspace_id,client_id,email,token_hash,invite_expires_at,invited_by)
    values(w,c,'portal-'||p||'@example.invalid',sha256(convert_to(gen_random_uuid()::text,'UTF8')),t+interval '7 days',o) returning id into access;

  -- Review links: one fixed to version 1, one following the latest version (service role, verified actor).
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  link := public.makeborne_create_client_review_link(o,w,book,1,false,sha256(convert_to(tok_fixed,'UTF8')),7,'Maple','Fixed sign-off',null);
  link := public.makeborne_create_client_review_link(o,w,book,2,true,sha256(convert_to(tok_latest,'UTF8')),7,'Maple','Latest',null);
  link := public.makeborne_create_client_review_link(m,w,book,2,true,sha256(convert_to(tok_m,'UTF8')),7,'Maple','From member',null);
  reset role;
  perform set_config('request.jwt.claims','{}',true);
  -- One comment so resolution can be tested.
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  perform public.makeborne_add_client_review_comment(tok_latest,2,'Maple','','Make the heading warmer',null);
  reset role;

  -- 1. Read matrix for every protected resource.
  for who, uid in select * from (values ('owner',o),('editor',e),('reviewer',r),('member-to-remove',m),('other-tenant',x),('signed-in-outsider',n),('portal-user',p)) v(a,b) loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
    set local role authenticated;
    foreach item in array resources loop
      begin
        if item='workspaces' then execute 'select count(*) from public.workspaces where id=$1' into cnt using w;
        else execute format('select count(*) from public.%I where workspace_id=$1',item) into cnt using w; end if;
      exception when insufficient_privilege then cnt := -1; end;
      insert into scope_matrix values(who,item,cnt);
    end loop;
    select count(*) into cnt from storage.objects where bucket_id='project-assets' and name like w||'/%';
    insert into scope_matrix values(who,'storage.objects(project-assets)',cnt);
    select count(*) into cnt from public.credit_ledger where user_id=o;
    insert into scope_matrix values(who,'credit_ledger(owner)',cnt);
    reset role;
  end loop;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  foreach item in array resources loop
    begin execute format('select count(*) from public.%I',item) into cnt; exception when insufficient_privilege then cnt := -1; end;
    insert into scope_matrix values('anonymous',item,cnt);
  end loop;
  begin select count(*) into cnt from storage.objects where bucket_id='project-assets'; exception when insufficient_privilege then cnt := -1; end;
  insert into scope_matrix values('anonymous','storage.objects(project-assets)',cnt);
  reset role;

  -- Members see every workspace resource with rows; owner-only resources stay owner-only.
  select string_agg(role||'/'||resource||'='||visible,', ') into v from scope_matrix
    where role in ('owner','editor','reviewer','member-to-remove') and resource = any(resources)
      and (case when resource = any(owner_only) and role<>'owner' then visible>0 else visible<=0 end);
  assert v is null, 'Member read matrix wrong: '||v;
  select string_agg(role||'/'||resource||'='||visible,', ') into v from scope_matrix
    where role in ('other-tenant','signed-in-outsider','portal-user','anonymous') and visible>0;
  assert v is null, 'Outsider or anonymous read workspace rows: '||v;
  assert not exists(select 1 from scope_matrix where resource='storage.objects(project-assets)' and visible>0), 'A browser session can see project-assets object rows (and so sign URLs)';
  assert (select visible from scope_matrix where role='owner' and resource='credit_ledger(owner)')=1
    and not exists(select 1 from scope_matrix where resource='credit_ledger(owner)' and role<>'owner' and visible>0), 'Credit ledger is not per-account';
  raise notice 'PASS read matrix: owner, editor, reviewer read % workspace resources (domains/enquiries owner-only); other tenant, signed-in outsider, portal user and anonymous read none; no browser session reads asset objects; credits are per account', cardinality(resources);

  -- 2. Write matrix.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',e,'role','authenticated')::text,true);
  set local role authenticated;
  insert into public.tasks(workspace_id,project_id,title) values(w,pr,'Editor task');
  begin update public.artifacts set current_version=99 where id=art; raise exception 'Editor moved current_version'; exception when insufficient_privilege then null; end;
  begin update public.artifact_versions set change_summary='rewritten' where artifact_id=art; raise exception 'Editor rewrote a saved version'; exception when insufficient_privilege then null; end;
  begin delete from public.projects where id=pr; raise exception 'Editor hard-deleted a project'; exception when insufficient_privilege then null; end;
  begin insert into public.brand_kits(workspace_id,client_id,kit,updated_by) values(w,null,'{"name":"x"}',e); raise exception 'Editor wrote brand kit directly'; exception when insufficient_privilege then null; end;
  begin update public.hosted_sites set live=false where artifact_id=art; raise exception 'Editor changed publication directly'; exception when insufficient_privilege then null; end;
  begin insert into public.custom_domains(workspace_id,artifact_id,hostname,created_by) values(w,art,'x.'||slug||'.example.com',e); raise exception 'Editor added a domain directly'; exception when insufficient_privilege then null; end;
  begin insert into public.tasks(workspace_id,project_id,title) values(w2,pr2,'Cross-tenant'); raise exception 'Editor wrote into another tenant'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated')::text,true);
  set local role authenticated;
  begin insert into public.tasks(workspace_id,project_id,title) values(w,pr,'Reviewer task'); raise exception 'Reviewer inserted a task'; exception when insufficient_privilege then null; end;
  update public.clients set notes='reviewer edit' where id=c; get diagnostics cnt = row_count;
  assert cnt=0, 'Reviewer updated a client';
  begin perform public.makeborne_revoke_client_review_link(w,(link->>'id')::uuid); raise exception 'Reviewer revoked a review link'; exception when insufficient_privilege then null; end;
  begin perform public.makeborne_resolve_client_review_comment(w,(select id from public.client_review_comments where workspace_id=w limit 1),true); raise exception 'Reviewer resolved feedback'; exception when insufficient_privilege then null; end;
  begin perform public.makeborne_artifact_title_search(w2,'other'); raise exception 'Reviewer searched another tenant'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'role','authenticated')::text,true);
  set local role authenticated;
  begin insert into public.tasks(workspace_id,project_id,title) values(w,pr,'Intruder'); raise exception 'Other tenant inserted'; exception when insufficient_privilege then null; end;
  update public.clients set notes='intruder' where id=c; get diagnostics cnt = row_count; assert cnt=0, 'Other tenant updated a client';
  begin insert into public.workspace_members(workspace_id,user_id,role) values(w,x,'editor'); raise exception 'Other tenant joined a workspace'; exception when insufficient_privilege then null; end;
  reset role;
  assert (select notes from public.clients where id=c)='Private agency note', 'Client notes changed by a non-editor';
  raise notice 'PASS write matrix: editors write content but never version history, publication, domains, brand kits or other tenants; reviewers, outsiders and other tenants write nothing';

  -- 3. Workspace switch: the same signed-in editor addressing another workspace gets nothing.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',e,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into cnt from public.artifacts where workspace_id=w2; assert cnt=0, 'Editor read another workspace artifacts';
  select count(*) into cnt from public.clients where workspace_id=w2; assert cnt=0, 'Editor read another workspace clients';
  begin perform public.makeborne_artifact_title_search(w2,'other'); raise exception 'Workspace switch search leaked'; exception when insufficient_privilege then null; end;
  assert makeborne_private.can_read(w) and not makeborne_private.can_read(w2), 'can_read crosses workspaces';
  reset role;
  raise notice 'PASS workspace switch: authority comes from the addressed workspace membership on every query, not from a session-wide grant';

  -- 4. Role removal and demotion take effect on the next statement.
  assert makeborne_private.client_review_can_edit_as(m,w), 'fixture: member starts as editor';
  assert (select status from public.mail_accounts where id=acct_m)='active' and (select status from public.mail_enrollments where id=enr_m)='active', 'fixture: mailbox starts active';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated')::text,true);
  set local role authenticated;
  delete from public.workspace_members where workspace_id=w and user_id=m; get diagnostics cnt = row_count; assert cnt=1, 'Owner could not remove the member';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);
  set local role authenticated;
  assert not makeborne_private.can_read(w) and not makeborne_private.can_edit(w), 'Removed member keeps authority';
  foreach item in array resources loop
    begin
      if item='workspaces' then execute 'select count(*) from public.workspaces where id=$1' into cnt using w;
      else execute format('select count(*) from public.%I where workspace_id=$1',item) into cnt using w; end if;
    exception when insufficient_privilege then cnt := 0; end;
    assert cnt=0, 'Removed member still reads '||item;
  end loop;
  select count(*) into cnt from storage.objects where bucket_id='project-assets' and name like w||'/%'; assert cnt=0, 'Removed member still sees asset objects';
  begin insert into public.tasks(workspace_id,project_id,title) values(w,pr,'After removal'); raise exception 'Removed member wrote'; exception when insufficient_privilege then null; end;
  reset role;
  -- Links the departed member created stop working; the owner's links do not.
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  assert public.makeborne_read_client_review(tok_m)=jsonb_build_object('status','revoked'), 'Departed member review link still serves';
  begin perform public.makeborne_add_client_review_comment(tok_m,2,'Maple','','After removal',null); raise exception 'Departed member link accepted feedback'; exception when sqlstate 'P0002' then null; end;
  assert public.makeborne_read_client_review(tok_latest)->>'status'='active', 'Owner link affected by member removal';
  reset role;
  -- Their mailbox is disconnected exactly like the Disconnect route; the editor's is untouched.
  assert (select status from public.mail_accounts where id=acct_m)='disconnected', 'Departed member mailbox still active';
  assert (select status from public.mail_enrollments where id=enr_m)='paused', 'Sequence still sends through the departed member mailbox';
  assert (select refresh_token='revoked' and access_token is null from makeborne_private.mail_tokens where account_id=acct_m), 'Departed member tokens still usable';
  assert (select status from public.mail_accounts where id=acct_e)='active'
    and (select refresh_token='fixture-refresh-e' from makeborne_private.mail_tokens where account_id=acct_e), 'Other editor mailbox affected';
  assert (select count(*) from public.mail_messages where account_id=acct_m)=1, 'Sent history was removed';
  -- Demotion to reviewer removes write authority and mailbox use at once.
  insert into public.clients(workspace_id,name) values(w,'Second client') returning id into c2;
  insert into public.mail_enrollments(workspace_id,sequence_id,client_id,account_id,next_send_at,created_by) values(w,seq,c2,acct_e,t,e) returning id into enr_e;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated')::text,true);
  set local role authenticated;
  update public.workspace_members set role='reviewer' where workspace_id=w and user_id=e;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',e,'role','authenticated')::text,true);
  set local role authenticated;
  assert makeborne_private.can_read(w) and not makeborne_private.can_edit(w), 'Demotion did not remove edit authority';
  begin insert into public.tasks(workspace_id,project_id,title) values(w,pr,'After demotion'); raise exception 'Demoted member wrote'; exception when insufficient_privilege then null; end;
  reset role;
  assert (select status from public.mail_accounts where id=acct_e)='disconnected', 'Demoted editor mailbox still active';
  assert (select status from public.mail_enrollments where id=enr_e)='paused', 'Demoted editor sequence still active';
  -- Re-promotion does not silently reconnect a mailbox; the person reconnects it themselves.
  update public.workspace_members set role='editor' where workspace_id=w and user_id=e;
  assert (select status from public.mail_accounts where id=acct_e)='disconnected', 'Re-promotion reconnected a mailbox without consent';
  raise notice 'PASS revocation: removal and demotion end reads/writes on the next statement, kill review links the member created, and disconnect only their mailboxes (tokens revoked, sequences paused, sent history kept)';

  -- 5. Anonymous bearer-link feedback: fixed vs latest scope, unverified identity, no resolution or publication.
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  assert (public.makeborne_read_client_review(tok_fixed)->>'version')::int=1, 'Fixed link does not show its fixed version';
  assert (public.makeborne_read_client_review(tok_latest)->>'version')::int=2, 'Latest link does not show the latest version';
  begin perform public.makeborne_decide_client_review(tok_fixed,2,'Maple','','approved',''); raise exception 'Fixed link approved a version it does not show'; exception when sqlstate 'PT409' then null; end;
  res := public.makeborne_decide_client_review(tok_fixed,1,'Not Really Maple','','approved','Looks good');
  begin perform public.makeborne_resolve_client_review_comment(w,(select null::uuid),true); raise exception 'Anonymous resolved feedback'; exception when insufficient_privilege then null; end;
  begin perform public.makeborne_revoke_client_review_link(w,(link->>'id')::uuid); raise exception 'Anonymous revoked a link'; exception when insufficient_privilege then null; end;
  begin perform public.makeborne_save_hosted_site_v4(o,w,art,1,slug,'<!doctype html><main>x</main>',true,0,gen_random_uuid(),false,null,'[]'::jsonb,null);
    raise exception 'Anonymous published'; exception when insufficient_privilege then null; end;
  reset role;
  assert res->'decision'->>'name'='Not Really Maple' and (res->'decision'->>'version')::int=1, 'Decision payload wrong';
  -- The approval is a typed name bound to a bearer link, not an account: nothing records who held the link.
  assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_review_comments' and column_name in ('author_id','user_id','created_by')),
    'Review comments now claim an author account; update the unverified-identity copy';
  assert (select decision='approved' and decided_version=1 from public.client_review_links where token_hash=sha256(convert_to(tok_fixed,'UTF8'))), 'Decision not recorded on its own link';
  assert (select delivery_stage from public.projects where id=pr)='delivered', 'Client approval did not record delivery';
  assert (select live and version_number=1 from public.hosted_sites where artifact_id=art), 'Client approval changed publication';
  assert (select current_version from public.artifacts where id=book)=2, 'Client approval changed the saved version';
  assert not exists(select 1 from public.client_review_comments where workspace_id=w and resolved_at is not null), 'Client approval resolved feedback';
  -- A signed-in visitor deciding through a link is still only a link holder.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'role','authenticated')::text,true);
  set local role authenticated;
  res := public.makeborne_decide_client_review(tok_latest,2,'Maple','','changes_requested','Warmer please');
  select count(*) into cnt from public.client_review_comments where workspace_id=w; assert cnt=0, 'Link holder gained read access to the workspace';
  reset role;
  raise notice 'PASS review links: fixed and latest scopes hold; decisions are typed names on a bearer link (no account recorded), record client approval and delivery only; anonymous holders cannot resolve, revoke or publish';

  -- 6. Identity, style and code reuse stay separate permissions.
  assert not exists(select 1 from information_schema.table_constraints tc join information_schema.constraint_column_usage u using(constraint_schema,constraint_name)
    where tc.table_schema='public' and tc.table_name='brand_kits' and tc.constraint_type='FOREIGN KEY' and u.table_name in ('artifacts','artifact_versions','projects','assets','sources')),
    'Brand kits now reference project source; reusing a style would carry source access';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into cnt from public.brand_kits where workspace_id=w; assert cnt=0, 'Other tenant reads brand kit';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into cnt from public.brand_kits where workspace_id=w; assert cnt=1, 'Reviewer cannot read brand kit';
  begin update public.brand_kits set kit='{"name":"y"}' where workspace_id=w; raise exception 'Reviewer edited brand kit'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS reuse separation: brand kits hold identity facts only (no project/version/asset keys), are tenant-scoped, readable by members and written only by the server for editors';

  -- 7. Deletion: removing a tenant removes its records; storage objects lose every browser path.
  delete from public.workspaces where id=w2;
  assert not exists(select 1 from public.artifacts where workspace_id=w2) and not exists(select 1 from public.clients where workspace_id=w2), 'Tenant deletion left records';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id='project-assets'; assert cnt=0, 'Deleted tenant objects visible to former owner';
  reset role;
  raise notice 'PASS deletion: workspace removal cascades tenant records; orphaned bucket objects remain server-only (retention is an operator task)';

  for v in select format('%-20s %-34s %s', role, resource, case visible when -1 then 'no privilege' else visible::text end) from scope_matrix order by role, resource loop
    raise notice 'MATRIX %', v;
  end loop;
end $$;
rollback;
