-- Ordinary paying-workspace publishing (minimum launch gate 3). Forward-only.
--
-- Applying this migration changes NO rollout scope: the new scope row starts in
-- 'allowlist' mode, so production still admits only enabled rows in
-- makeborne_private.trusted_publication_workspaces, and staging still admits only
-- its one QA workspace. The database owner opts production into 'entitled' mode
-- with makeborne_private.configure_trusted_publication_scope('entitled') only
-- after the matching controller (schema 3) and app broker configuration exist.
--
-- What changes immediately (all namespaces):
--  * Background/read authority (status, latest, worker claim, worker/broker
--    source load, candidate discovery) uses publication_entitled_for_actor: the
--    account's last provider verification was positive, within 24 hours (the
--    preparation lifetime), for an enabled access plan, the membership is
--    active/canceling, inside its period, not refunded/charged back, and global
--    creation is enabled. Before, these paths needed the 5-minute live
--    verification window, so a non-administrator's compile failed if it was
--    claimed or loaded more than five minutes after the last browser request.
--  * User-initiated mutations (request a preparation, promote it to live) still
--    require the existing strict, fresh check (has_creation_membership_for_actor)
--    in addition. Administrators are unaffected on every path.
--  * Publication authority and the legacy live writer share finance's
--    membership advisory lock, so a refund and a publish commit in a defined
--    order; membership locks are acquired before membership row locks.
--  * The legacy outline publisher (save_site_v4 live path) also rejects refunded
--    or charged-back periods, matching the trusted path.
-- Serving (makeborne_hosting.owner_can_host), fair-use limits (50 new sites a
-- day and 1,000 live sites per workspace in save_site_v2; 30 preparations an
-- hour per account; output size and file limits), the namespace guards and the
-- last-good retained output are unchanged. New preparations are additionally
-- capped at 10 per workspace per rolling hour (owner launch limit).
begin;

create table makeborne_private.trusted_publication_scope (
 singleton boolean primary key default true check(singleton),
 mode text not null default 'allowlist' check(mode in ('allowlist','entitled')),
 updated_at timestamptz not null default now()
);
alter table makeborne_private.trusted_publication_scope enable row level security;
revoke all on makeborne_private.trusted_publication_scope from public,anon,authenticated,service_role,makeborne_publication_worker;
insert into makeborne_private.trusted_publication_scope(singleton,mode) values(true,'allowlist');

create function makeborne_private.guard_trusted_publication_scope() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'Publication scope cannot be deleted' using errcode='42501'; end if;
 if new.singleton is distinct from true or new.mode is null or new.mode not in ('allowlist','entitled') then
  raise exception 'Invalid publication scope' using errcode='22023'; end if;
 -- Entitled scope is a production rollout setting. Staging keeps its single
 -- QA workspace and address pair; it must never become a second publisher.
 if new.mode='entitled' and not exists(select 1 from makeborne_private.site_address_namespace_policy where singleton and mode='production') then
  raise exception 'Entitled publication scope requires the production namespace' using errcode='42501'; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function makeborne_private.guard_trusted_publication_scope() from public,anon,authenticated,service_role,makeborne_publication_worker;
create trigger trusted_publication_scope_guard before insert or update or delete on makeborne_private.trusted_publication_scope
 for each row execute function makeborne_private.guard_trusted_publication_scope();

-- Database owner only, like configure_site_address_namespace. No bridge, no grants.
create function makeborne_private.configure_trusted_publication_scope(p_mode text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare scope makeborne_private.trusted_publication_scope%rowtype;
begin
 if current_user::regrole::oid is distinct from (select datdba from pg_database where datname=current_database()) then
  raise exception 'Database owner required' using errcode='42501'; end if;
 update makeborne_private.trusted_publication_scope set mode=p_mode where singleton returning * into scope;
 if not found then raise exception 'Publication scope unavailable' using errcode='P0002'; end if;
 return jsonb_build_object('mode',scope.mode,'updatedAt',scope.updated_at);
end $$;
revoke all on function makeborne_private.configure_trusted_publication_scope(text) from public,anon,authenticated,service_role,makeborne_publication_worker;

-- Entitlement for background and read paths. Same plan, period, status,
-- revocation and global switch as has_creation_membership_for_actor; the only
-- difference is the verification window: the most recent provider check must
-- have been positive (verified_until is only ever set past checked_at when the
-- membership matched and was active) and no older than 24 hours.
create function makeborne_private.publication_entitled_for_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor is not null and (makeborne_private.has_account_privilege(p_actor,'admin')
 or (coalesce((select creation_enabled from makeborne_private.billing_settings where singleton),false)
   and exists(select 1 from public.billing_memberships m
     join makeborne_private.billing_access_plans p on p.plan_id=m.plan_id and p.enabled
     where m.user_id=p_actor and m.status in ('active','canceling')
       and m.period_end>now() and m.verified_until>m.checked_at and m.checked_at>now()-interval '24 hours'
       and not makeborne_private.membership_access_revoked(m.membership_id, now()))));
$$;
revoke all on function makeborne_private.publication_entitled_for_actor(uuid) from public,anon,authenticated,service_role,makeborne_publication_worker;

create or replace function makeborne_private.publication_workspace_allowed(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype; scope makeborne_private.trusted_publication_scope%rowtype; v_owner uuid;
begin
 if p_workspace is null then return false; end if;
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then return false; end if;
 if policy.mode='staging' then return p_workspace=policy.qa_workspace_id; end if;
 if policy.mode<>'production' then return false; end if;
 -- Explicitly enabled (owner/admin rollout) workspaces keep their behaviour.
 perform 1 from makeborne_private.trusted_publication_workspaces where workspace_id=p_workspace and enabled for share;
 if found then return true; end if;
 select * into scope from makeborne_private.trusted_publication_scope where singleton for share;
 if not found or scope.mode<>'entitled' then return false; end if;
 select owner_id into v_owner from public.workspaces where id=p_workspace;
 return makeborne_private.publication_entitled_for_actor(v_owner);
end $$;

create or replace function makeborne_private.publication_authority(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid)
returns public.artifacts language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; v_membership text;
begin
 perform 1 from public.workspaces where id=p_workspace and owner_id=p_actor for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace and kind='website' for update;
 if not found then raise exception 'Website not found' using errcode='P0002'; end if;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 perform 1 from makeborne_private.account_privileges where user_id=p_actor for share;
 perform 1 from makeborne_private.billing_settings where singleton for share;
 -- BEGIN publication payment serialization. Match finance's exclusive
 -- makeborne.plan lock BEFORE taking membership row locks. A refund cannot
 -- commit between entitlement verification and publication commit. Shared
 -- locks permit unrelated publication reads and preserve finance lock order.
 for v_membership in select membership_id from public.billing_memberships where user_id=p_actor order by membership_id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('makeborne.plan:'||v_membership,0));
 end loop;
 -- END publication payment serialization.
 perform 1 from public.billing_memberships m join makeborne_private.billing_access_plans b on b.plan_id=m.plan_id
  where m.user_id=p_actor for share of m,b;
 -- Plan access before rollout scope, so a lapsed account hears about its plan.
 if not makeborne_private.publication_entitled_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 if not makeborne_private.publication_workspace_allowed(p_workspace) then raise exception 'Trusted publication workspace not enabled' using errcode='42501'; end if;
 return a;
end $$;

-- Body identical to 20261013180000 except fresh access and the workspace cap.
create or replace function makeborne_private.request_publication_preparation(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid,
 p_version integer,p_revision integer,p_slug text,p_interactive boolean,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; v public.artifact_versions%rowtype; p makeborne_private.publication_preparations%rowtype; rev integer;
begin
 a:=makeborne_private.publication_authority(p_actor,p_session,p_expires,p_workspace,p_artifact);
 -- 20261025200000: a new publication needs the fresh (five-minute) verification.
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 if p_request is null or p_version is null or p_revision is null or p_revision<0 or p_interactive is null or p_slug is null
  or p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' or p_slug like 'xn--%'
  or p_slug=any(array['admin','api','auth','billing','login','studio','support','www','makeborne','robots-txt','sitemap-xml']) then
  raise exception 'Invalid publication request' using errcode='22023'; end if;
 -- Actor-wide key serialization also handles requests racing across workspaces.
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
 select * into p from makeborne_private.publication_preparations where actor_id=p_actor and request_id=p_request for update;
 if found then
  if row(p.workspace_id,p.artifact_id,p.version_number,p.publication_revision,p.slug,p.interactive)
   is distinct from row(p_workspace,p_artifact,p_version,p_revision,p_slug,p_interactive) then
   raise exception 'Request changed' using errcode='MB409'; end if;
  return makeborne_private.publication_snapshot(p);
 end if;
 select * into v from public.artifact_versions where artifact_id=p_artifact and workspace_id=p_workspace and version_number=p_version for share;
 if not found or a.current_version<>p_version then raise exception 'Save latest website first' using errcode='PT409'; end if;
 if jsonb_typeof(v.content->'websiteSource') is distinct from 'object' then raise exception 'Source website required' using errcode='22023'; end if;
 perform makeborne_private.check_publication_sources(p_workspace,a.project_id,v.content);
 select revision into rev from public.hosted_sites where artifact_id=p_artifact for update;
 if coalesce(rev,0)<>p_revision then raise exception 'Publication changed' using errcode='PT409'; end if;
 -- publication_authority holds this workspace row FOR UPDATE, so concurrent
 -- requests with different keys/artifacts cannot exceed the workspace limit.
 -- Replays return above and never spend another preparation.
 if (select count(*) from makeborne_private.publication_preparations where workspace_id=p_workspace and created_at>clock_timestamp()-interval '1 hour')>=10 then
  raise exception 'Workspace preparation limit reached' using errcode='MB429'; end if;
 if (select count(*) from makeborne_private.publication_preparations where actor_id=p_actor and created_at>clock_timestamp()-interval '1 hour')>=30 then
  raise exception 'Preparation limit reached' using errcode='MB429'; end if;
 insert into makeborne_private.publication_preparations(actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,
  publication_revision,version_content_hash,slug,interactive,request_id)
 values(p_actor,p_session,p_workspace,a.project_id,p_artifact,v.id,p_version,p_revision,encode(sha256(convert_to(v.content::text,'UTF8')),'hex'),p_slug,p_interactive,p_request)
 returning * into p;
 return makeborne_private.publication_snapshot(p);
end $$;

-- Body identical to 20261013180000 except the marked fresh-access line.
create or replace function makeborne_private.promote_publication_preparation(p_preparation uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype; a public.artifacts%rowtype; v public.artifact_versions%rowtype; o jsonb; r jsonb; rev integer;
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation and actor_id=p_actor;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 a:=makeborne_private.publication_authority(p_actor,p_session,p_expires,p.workspace_id,p.artifact_id);
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if p.state='promoted' then return p.result; end if;
 -- 20261025200000: going live needs the fresh (five-minute) verification.
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 if p.state<>'ready' or p.expires_at<=clock_timestamp() then raise exception 'Preparation not ready' using errcode='PT409'; end if;
 select * into v from public.artifact_versions where id=p.version_id for share;
 select revision into rev from public.hosted_sites where artifact_id=p.artifact_id for update;
 if a.current_version<>p.version_number or a.project_id<>p.project_id or coalesce(rev,0)<>p.publication_revision
  or encode(sha256(convert_to(v.content::text,'UTF8')),'hex') is distinct from p.version_content_hash then
  raise exception 'Saved version or publication changed' using errcode='PT409'; end if;
 perform makeborne_private.check_publication_sources(p.workspace_id,p.project_id,v.content);
 if encode(sha256(convert_to(p.output_text,'UTF8')),'hex') is distinct from p.output_hash or p.receipt->>'outputHash' is distinct from p.output_hash then
  raise exception 'Retained output changed' using errcode='22023'; end if;
 o:=p.output_text::jsonb;
 r:=makeborne_hosting.promote_retained_site_v4(p.actor_id,p.workspace_id,p.artifact_id,p.version_number,p.slug,o->>'html',true,p.publication_revision,p.request_id,
  p.interactive,o->>'script',o->'files',o->>'isolatedHtml');
 delete from makeborne_hosting.site_routes where artifact_id=p.artifact_id;
 insert into makeborne_hosting.site_routes(artifact_id,path,html,isolated_html)
 select p.artifact_id,t->>'path',t->>'html',t->>'isolatedHtml' from jsonb_array_elements(o->'routes') t;
 update makeborne_private.publication_preparations set state='promoted',result=r,updated_at=clock_timestamp() where id=p.id;
 return r;
end $$;

-- Legacy outline publisher: refunded or charged-back periods cannot go live.
-- Body identical to 20261013180000 except the live access check and payment locks.
create or replace function makeborne_hosting.save_site_v4(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
 p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; v_membership text;
begin
 perform 1 from public.workspaces where id=p_workspace for update;
 perform 1 from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
 if p_live and exists(select 1 from public.artifact_versions where artifact_id=p_artifact and workspace_id=p_workspace and version_number=p_version
  and content->'websiteSource' is not null and content->'websiteSource'<>'null'::jsonb) then
  raise exception 'Trusted publication preparation required' using errcode='42501'; end if;
 -- 20261025200000: same creation predicate as the trusted path (adds refund/dispute
 -- revocation). Non-owners still reach the existing 'Owner required' refusal.
 if p_live and exists(select 1 from public.workspaces where id=p_workspace and owner_id=p_actor) then
 -- BEGIN publication payment serialization. Match finance's exclusive
 -- makeborne.plan lock BEFORE taking membership row locks. A refund cannot
 -- commit between entitlement verification and publication commit. Shared
 -- locks permit unrelated publication reads and preserve finance lock order.
 for v_membership in select membership_id from public.billing_memberships where user_id=p_actor order by membership_id loop
  perform pg_advisory_xact_lock_shared(hashtextextended('makeborne.plan:'||v_membership,0));
 end loop;
 -- END publication payment serialization.
  if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 end if;
 result:=makeborne_hosting.promote_retained_site_v4(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files,p_isolated_html);
 if p_live then delete from makeborne_hosting.site_routes where artifact_id=p_artifact; end if;
 return result;
end $$;

-- Attestation: identical to 20261019134828 except the scope table in the RLS
-- check and the entitled production contract (v3). Allowlist production stays
-- v2 with the exact enabled list; staging stays v1.
create or replace function makeborne_private.publication_worker_attest() returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare policy makeborne_private.site_address_namespace_policy%rowtype; scope makeborne_private.trusted_publication_scope%rowtype; signature text; private_oid oid; public_oid oid; f record;
 allowed_oids oid[]:='{}';
begin
 perform makeborne_private.assert_publication_worker();
 foreach signature in array array['publication_worker_candidates(integer)','publication_worker_claim(uuid,uuid)',
  'publication_worker_load(uuid,uuid,bigint)','publication_worker_asset_locator(uuid,uuid,bigint,uuid)',
  'publication_worker_complete(uuid,uuid,bigint,jsonb,text)','publication_worker_fail(uuid,uuid,bigint,text)',
  'publication_worker_sandbox_event(jsonb)','publication_worker_sandbox_cleanup_claim(uuid,integer)',
  'publication_worker_sandbox_cleanup_finish(text,uuid,bigint,text)','publication_worker_attest()'] loop
  private_oid:=to_regprocedure('makeborne_private.'||signature); public_oid:=to_regprocedure('public.makeborne_'||signature);
  if private_oid is null or public_oid is null then raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
  allowed_oids:=allowed_oids||array[private_oid,public_oid];
  for f in select p.oid,p.prosecdef,p.proconfig,p.prorettype,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in(private_oid,public_oid) loop
   if f.prosecdef is distinct from (f.nspname='makeborne_private') or not coalesce('search_path=""'=any(f.proconfig),false)
    or f.prorettype<>'jsonb'::regtype or not has_function_privilege('makeborne_publication_worker',f.oid,'EXECUTE')
    or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
    or has_function_privilege('service_role',f.oid,'EXECUTE') then
    raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
  end loop;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','makeborne_private','makeborne_hosting') and p.prokind='f'
   and has_function_privilege('makeborne_publication_worker',p.oid,'EXECUTE')
   and not p.oid=any(allowed_oids))
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','makeborne_private','makeborne_hosting','auth','storage') and c.relkind in('r','v','m','p')
   and has_table_privilege('makeborne_publication_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  or exists(select 1 from pg_class where oid in('makeborne_private.site_address_namespace_policy'::regclass,'makeborne_private.publication_sandboxes'::regclass,
   'makeborne_private.trusted_publication_workspaces'::regclass,'makeborne_private.trusted_publication_scope'::regclass) and not relrowsecurity) then
  raise exception 'Publication controller contract invalid' using errcode='PT409'; end if;
 select * into policy from makeborne_private.site_address_namespace_policy where singleton for share;
 if not found then raise exception 'Publication controller namespace unavailable' using errcode='PT409'; end if;
 if policy.mode='production' then
  select * into scope from makeborne_private.trusted_publication_scope where singleton for share;
  if not found then raise exception 'Publication controller scope unavailable' using errcode='PT409'; end if;
  if scope.mode='entitled' then
   return jsonb_build_object('contractVersion','publication-controller-v3','namespace','production','workspaceScope','entitled');
  end if;
  perform 1 from makeborne_private.trusted_publication_workspaces where enabled order by workspace_id for share;
  return jsonb_build_object('contractVersion','publication-controller-v2','namespace','production','workspaceAllowlist',
   (select coalesce(jsonb_agg(workspace_id::text order by workspace_id),'[]'::jsonb) from makeborne_private.trusted_publication_workspaces where enabled));
 end if;
 return jsonb_build_object('contractVersion','publication-controller-v1','namespace',policy.mode,'qaWorkspaceId',policy.qa_workspace_id);
end $$;

commit;
