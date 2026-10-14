-- Website badge setting: on by default, owners can turn it off, the public reader
-- reports it, and other members can't change it.
-- One rolled-back transaction; commits nothing. Needs migrations through 20261013140000.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := gen_random_uuid(); other uuid := gen_random_uuid(); w uuid := gen_random_uuid(); p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  slug text := 'badge-'||left(replace(gen_random_uuid()::text,'-',''),10); r jsonb; changed integer;
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@badge.example.invalid',now()),(other,other||'@badge.example.invalid',now());
  insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values(u,true,false,'Transaction fixture');
  insert into public.workspaces(id,name,owner_id) values(w,'Badge fixture',u);
  insert into public.workspace_members(workspace_id,user_id,role) values(w,other,'editor');
  insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
  insert into public.artifacts(id,workspace_id,project_id,title,kind,current_version) values(a,w,p,'Site','website',1);
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values(gen_random_uuid(),w,a,1,'{}','{}',u,now());
  perform public.makeborne_save_hosted_site_v4(u,w,a,1,slug,'<!doctype html><html><body><h1>Site</h1></body></html>'||repeat(' ',120),true,0,gen_random_uuid(),false,null,'[]',null);

  r := public.makeborne_read_hosted_site_v2(slug);
  assert (r->>'branding')::boolean is true, 'badge shown by default: '||coalesce(r::text,'null');
  raise notice 'PASS badge: shown by default on published websites';

  -- An editor can't change the owner's setting (RLS limits updates to the owner).
  perform set_config('request.jwt.claims', jsonb_build_object('sub',other,'role','authenticated')::text, true);
  set local role authenticated;
  update public.workspaces set site_badge=false where id=w;
  get diagnostics changed = row_count;
  reset role;
  assert changed = 0 and (select site_badge from public.workspaces where id=w), 'a workspace editor must not remove the badge';
  raise notice 'PASS badge: only the owner can change it';

  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;
  update public.workspaces set site_badge=false where id=w;
  get diagnostics changed = row_count;
  reset role;
  assert changed = 1, 'the owner can remove the badge';
  r := public.makeborne_read_hosted_site_v2(slug);
  assert (r->>'branding')::boolean is false, 'reader reports the badge removed: '||r::text;
  raise notice 'PASS badge: the owner removes it and the public reader reports branding=false';

  -- Owners still can't change other workspace columns.
  begin
    set local role authenticated;
    update public.workspaces set owner_id=other where id=w;
    raise exception 'owner change accepted';
  exception when insufficient_privilege then reset role; end;
  raise notice 'PASS badge: the new grant covers only the badge column';
  -- The API cannot be bypassed through an owner-issued direct Data API update.
  update public.workspaces set site_badge=true where id=w;
  delete from makeborne_private.account_privileges where user_id=u;
  begin
    set local role authenticated;
    update public.workspaces set site_badge=false where id=w;
    raise exception 'Unpaid owner removed badge through direct update';
  exception when sqlstate 'MB402' then reset role; end;
  assert (select site_badge from public.workspaces where id=w);
  raise notice 'PASS badge: unpaid owner cannot bypass paid eligibility with direct database update';
end $$;
select 'PASS: site badge setting' as result;
rollback;
