-- Unlimited websites with fair use: more than 5 (and more than 20) live sites per workspace,
-- the 51st new site in one day refused, republishing never limited.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261013120000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); w uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  pad text := repeat(' ', 120); html text; a uuid; i integer; first_site uuid;
begin
  html := '<!doctype html><html><body><h1>Site</h1></body></html>' || pad;
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@sites.example.invalid',now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Transaction fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Unlimited sites fixture',u);
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  for i in 1..51 loop
    a := gen_random_uuid();
    if i = 1 then first_site := a; end if;
    insert into public.artifacts(id,workspace_id,project_id,title,kind,current_version) values(a,w,p,'Site '||i,'website',1);
    insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values(gen_random_uuid(),w,a,1,'{}','{}',u,now());
    if i <= 50 then
      perform public.makeborne_save_hosted_site_v4(u,w,a,1,'unlimited-'||i||'-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
    else
      begin
        perform public.makeborne_save_hosted_site_v4(u,w,a,1,'unlimited-51-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
        raise exception 'The 51st new site in one day was accepted';
      exception when sqlstate 'MB429' then null; end;
    end if;
  end loop;
  assert (select count(*) from public.hosted_sites where workspace_id=w and live) = 50, 'expected 50 live sites';
  raise notice 'PASS unlimited sites: 50 live websites in one workspace (old caps were 5 live, 20 total)';
  raise notice 'PASS fair use: the 51st new website in one day is refused with MB429';
  -- Republishing an existing site is never limited.
  perform public.makeborne_save_hosted_site_v4(u,w,first_site,1,'unlimited-1-'||left(replace(u::text,'-',''),8),html,true,1,gen_random_uuid(),false,null,'[]',null);
  raise notice 'PASS fair use does not block republishing an existing site';
  begin
    perform public.makeborne_save_hosted_site_v4(u,w,a,1,'unlimited-51-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
    raise exception 'Republishing bypassed daily limit';
  exception when sqlstate 'MB429' then null; end;
  perform public.makeborne_save_hosted_site_v4(u,w,first_site,1,'unlimited-1-'||left(replace(u::text,'-',''),8),html,false,2,gen_random_uuid(),false,null,'[]',null);
  begin
    perform public.makeborne_save_hosted_site_v4(u,w,a,1,'unlimited-51-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
    raise exception 'Unpublishing bypassed daily limit';
  exception when sqlstate 'MB429' then null; end;
  assert (select count(*) from makeborne_hosting.site_publication_events where workspace_id=w)=50;
  raise notice 'PASS republishing and unpublishing retain immutable daily publication accounting';
  -- One publication ages out of the rolling window; exactly one new slot opens.
  update makeborne_hosting.site_publication_events set first_published_at=clock_timestamp()-interval '1 day' where artifact_id=first_site;
  perform public.makeborne_save_hosted_site_v4(u,w,a,1,'unlimited-51-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
  assert (select count(*) from makeborne_hosting.site_publication_events where workspace_id=w and first_published_at>clock_timestamp()-interval '1 day')=50;
  assert not has_table_privilege('authenticated','makeborne_hosting.site_publication_events','UPDATE');
  assert not has_table_privilege('authenticated','makeborne_hosting.site_publication_events','DELETE');
  raise notice 'PASS rolling-day boundary reopens one slot; browser cannot erase publication events';
  -- The separate 1,000-live ceiling still applies even after the daily window.
  insert into public.artifacts(id,workspace_id,project_id,title,kind,current_version)
  select gen_random_uuid(),w,p,'Ceiling fixture','website',1 from generate_series(1,951);
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at)
  select gen_random_uuid(),w,id,1,'{}','{}',u,now() from public.artifacts where workspace_id=w and title='Ceiling fixture';
  insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id)
  select id,w,u,'cap-'||replace(id::text,'-',''),1,html,true,1,gen_random_uuid()
  from public.artifacts where workspace_id=w and title='Ceiling fixture' order by id limit 950;
  update makeborne_hosting.site_publication_events set first_published_at=clock_timestamp()-interval '2 days' where workspace_id=w;
  select ar.id into a from public.artifacts ar where ar.workspace_id=w and ar.title='Ceiling fixture'
    and not exists(select 1 from public.hosted_sites hs where hs.artifact_id=ar.id);
  begin
    perform public.makeborne_save_hosted_site_v4(u,w,a,1,'cap-new-'||left(replace(u::text,'-',''),8),html,true,0,gen_random_uuid(),false,null,'[]',null);
    raise exception 'Live-site ceiling was bypassed';
  exception when sqlstate 'MB429' then null; end;
  assert (select count(*) from public.hosted_sites where workspace_id=w and live)=1000;
  raise notice 'PASS fair-use ceiling still refuses live site 1,001';
end $$;
select 'PASS: unlimited sites' as result;
rollback;
