-- Created by `supabase migration new`; ordered after the existing 17:00 candidate.
-- No generation job, model request, credit reservation or provider call is involved.
begin;

create table makeborne_private.publication_preparations (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete cascade,
 requested_session_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 project_id uuid not null,
 artifact_id uuid not null,
 version_id uuid not null,
 version_number integer not null check(version_number>0),
 publication_revision integer not null check(publication_revision>=0),
 version_content_hash text not null check(version_content_hash ~ '^[0-9a-f]{64}$'),
 slug text not null,
 interactive boolean not null,
 request_id uuid not null,
 state text not null default 'queued' check(state in ('queued','running','ready','failed','expired','promoted')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 fence bigint not null default 0,
 worker_id uuid,
 last_worker_id uuid,
 lease_until timestamptz,
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 receipt jsonb,
 output_text text,
 output_hash text,
 error text,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_id),
 foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade,
 foreign key(artifact_id,project_id,workspace_id) references public.artifacts(id,project_id,workspace_id) on delete cascade,
 foreign key(version_id,artifact_id,workspace_id) references public.artifact_versions(id,artifact_id,workspace_id) on delete cascade,
 check((state in ('ready','promoted'))=(output_text is not null and receipt is not null and output_hash is not null)),
 check((state='promoted')=(result is not null)),
 check((state='running')=(worker_id is not null and lease_until is not null))
);
create index publication_preparations_scope on makeborne_private.publication_preparations(workspace_id,artifact_id,created_at desc);
create index publication_preparations_version on makeborne_private.publication_preparations(version_id);
create index publication_preparations_project on makeborne_private.publication_preparations(project_id);
alter table makeborne_private.publication_preparations enable row level security;
revoke all on makeborne_private.publication_preparations from public,anon,authenticated,service_role;

create function makeborne_private.publication_snapshot(p makeborne_private.publication_preparations) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'actorId',p.actor_id,'state',p.state,
 'scope',jsonb_build_object('workspaceId',p.workspace_id,'projectId',p.project_id,'artifactId',p.artifact_id),
 'versionId',p.version_id,'versionNumber',p.version_number,'publicationRevision',p.publication_revision,
 'versionContentHash',p.version_content_hash,'slug',p.slug,'interactive',p.interactive,
 'attempts',p.attempts,'fence',p.fence::text,'leaseUntil',p.lease_until,'expiresAt',p.expires_at,
 'error',p.error,'result',p.result,'receipt',p.receipt,'output',p.output_text::jsonb,'outputHash',p.output_hash);
$$;

-- All publication mutations lock workspace, artifact, then preparation. Current
-- session and entitlement rows are share-locked until promotion commits.
create function makeborne_private.publication_authority(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid)
returns public.artifacts language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype;
begin
 perform 1 from public.workspaces where id=p_workspace and owner_id=p_actor for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 select * into a from public.artifacts where id=p_artifact and workspace_id=p_workspace and kind='website' for update;
 if not found then raise exception 'Website not found' using errcode='P0002'; end if;
 perform makeborne_private.check_submission_session(p_actor,p_session,p_expires);
 perform 1 from makeborne_private.account_privileges where user_id=p_actor for share;
 perform 1 from makeborne_private.billing_settings where singleton for share;
 perform 1 from public.billing_memberships m join makeborne_private.billing_access_plans b on b.plan_id=m.plan_id
  where m.user_id=p_actor for share of m,b;
 if not makeborne_private.has_creation_membership_for_actor(p_actor) then raise exception 'Creation membership required' using errcode='MB402'; end if;
 return a;
end $$;

create function makeborne_private.check_publication_sources(p_workspace uuid,p_project uuid,p_content jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare source_id text; descriptor jsonb; asset public.assets%rowtype;
begin
 for source_id in select distinct source_ref.value #>> '{}' from jsonb_array_elements(coalesce(p_content->'sections','[]')) section,
  jsonb_array_elements(coalesce(section->'blocks','[]')) block,jsonb_array_elements(coalesce(block->'sourceIds','[]')) source_ref loop
  perform 1 from public.sources where id=source_id::uuid and workspace_id=p_workspace and project_id=p_project and permission='public' and approved for share;
  if not found then raise exception 'Referenced source is not approved for public use' using errcode='42501'; end if;
 end loop;
 for descriptor in select value from jsonb_array_elements(coalesce(p_content->'websiteSource'->'assets','[]')) loop
  select * into asset from public.assets where id=(descriptor->>'id')::uuid and workspace_id=p_workspace and project_id=p_project for share;
  if not found or asset.sha256 is distinct from descriptor->>'sha256' or asset.content_type is distinct from descriptor->>'mediaType'
   or asset.object_path not like p_workspace::text||'/'||p_project::text||'/%' then
   raise exception 'Source asset unavailable or changed' using errcode='42501'; end if;
 end loop;
end $$;

create function makeborne_private.request_publication_preparation(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid,
 p_version integer,p_revision integer,p_slug text,p_interactive boolean,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.artifacts%rowtype; v public.artifact_versions%rowtype; p makeborne_private.publication_preparations%rowtype; rev integer;
begin
 a:=makeborne_private.publication_authority(p_actor,p_session,p_expires,p_workspace,p_artifact);
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
 if (select count(*) from makeborne_private.publication_preparations where actor_id=p_actor and created_at>clock_timestamp()-interval '1 hour')>=30 then
  raise exception 'Preparation limit reached' using errcode='MB429'; end if;
 insert into makeborne_private.publication_preparations(actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,
  publication_revision,version_content_hash,slug,interactive,request_id)
 values(p_actor,p_session,p_workspace,a.project_id,p_artifact,v.id,p_version,p_revision,encode(sha256(convert_to(v.content::text,'UTF8')),'hex'),p_slug,p_interactive,p_request)
 returning * into p;
 return makeborne_private.publication_snapshot(p);
end $$;

create function makeborne_private.publication_preparation_status(p_preparation uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype;
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation and actor_id=p_actor;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.publication_authority(p_actor,p_session,p_expires,p.workspace_id,p.artifact_id);
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if p.state in ('queued','running','ready') and p.expires_at<=clock_timestamp() then
  update makeborne_private.publication_preparations set state='expired',worker_id=null,lease_until=null,output_text=null,output_hash=null,receipt=null,
   error='Preparation expired',updated_at=clock_timestamp() where id=p.id returning * into p;
 end if;
 return makeborne_private.publication_snapshot(p);
end $$;

create function makeborne_private.latest_publication_preparation(p_actor uuid,p_session uuid,p_expires timestamptz,p_workspace uuid,p_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preparation uuid;
begin
 perform makeborne_private.publication_authority(p_actor,p_session,p_expires,p_workspace,p_artifact);
 select id into preparation from makeborne_private.publication_preparations where actor_id=p_actor and workspace_id=p_workspace and artifact_id=p_artifact
  order by created_at desc,id desc limit 1;
 if preparation is null then return null; end if;
 return makeborne_private.publication_preparation_status(preparation,p_actor,p_session,p_expires);
end $$;

create function makeborne_private.claim_publication_preparation(p_preparation uuid,p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype; v public.artifact_versions%rowtype;
begin
 if p_worker is null then raise exception 'Worker required' using errcode='22023'; end if;
 select * into p from makeborne_private.publication_preparations where id=p_preparation;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 perform makeborne_private.publication_authority(p.actor_id,p.requested_session_id,clock_timestamp()+interval '1 minute',p.workspace_id,p.artifact_id);
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if p.state in ('ready','promoted','failed','expired') or (p.state='running' and p.lease_until>clock_timestamp()) then return null; end if;
 if p.expires_at<=clock_timestamp() or p.attempts>=3 then
  update makeborne_private.publication_preparations set state=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,
   worker_id=null,lease_until=null,error='Preparation retry limit or expiry reached',updated_at=clock_timestamp() where id=p.id;
  return null;
 end if;
 update makeborne_private.publication_preparations set state='running',attempts=attempts+1,fence=fence+1,worker_id=p_worker,last_worker_id=p_worker,
  lease_until=least(expires_at,clock_timestamp()+interval '5 minutes'),error=null,updated_at=clock_timestamp() where id=p.id returning * into p;
 select * into v from public.artifact_versions where id=p.version_id;
 return makeborne_private.publication_snapshot(p)||jsonb_build_object('version',to_jsonb(v),'content',v.content,'styleSnapshot',v.style_snapshot);
end $$;

create function makeborne_private.load_publication_preparation(p_preparation uuid,p_worker uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype; a public.artifacts%rowtype; v public.artifact_versions%rowtype; rev integer; assets jsonb;
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 a:=makeborne_private.publication_authority(p.actor_id,p.requested_session_id,clock_timestamp()+interval '1 minute',p.workspace_id,p.artifact_id);
 select * into p from makeborne_private.publication_preparations where id=p_preparation for share;
 if p.state<>'running' or p.worker_id is distinct from p_worker or p.fence is distinct from p_fence or p.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp() then
  raise exception 'Preparation lease changed' using errcode='PT409'; end if;
 select * into v from public.artifact_versions where id=p.version_id for share;
 select revision into rev from public.hosted_sites where artifact_id=p.artifact_id for share;
 if a.current_version<>p.version_number or a.project_id<>p.project_id or coalesce(rev,0)<>p.publication_revision
  or encode(sha256(convert_to(v.content::text,'UTF8')),'hex') is distinct from p.version_content_hash then
  raise exception 'Saved version or publication changed' using errcode='PT409'; end if;
 perform makeborne_private.check_publication_sources(p.workspace_id,p.project_id,v.content);
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'workspace_id',x.workspace_id,'project_id',x.project_id,'object_path',x.object_path,'content_type',x.content_type,'sha256',x.sha256)),'[]') into assets
 from public.assets x where x.workspace_id=p.workspace_id and x.project_id=p.project_id and x.id in
  (select (d->>'id')::uuid from jsonb_array_elements(coalesce(v.content->'websiteSource'->'assets','[]')) d);
 return makeborne_private.publication_snapshot(p)||jsonb_build_object('version',to_jsonb(v),'content',v.content,'styleSnapshot',v.style_snapshot,'assetRecords',assets);
end $$;

create function makeborne_private.complete_publication_preparation(p_preparation uuid,p_worker uuid,p_fence bigint,p_receipt jsonb,p_output text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype; o jsonb; binding jsonb; digest text; f jsonb; bytes bytea; total bigint:=0; paths text[]:='{}'; route_total bigint:=0; route_paths text[]:='{}'; declared_routes text[];
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 digest:=encode(sha256(convert_to(p_output,'UTF8')),'hex');
 if p.state in ('ready','promoted') and p.last_worker_id=p_worker and p.fence=p_fence and p.output_text=p_output
  and p.receipt=(p_receipt||jsonb_build_object('outputHash',digest)) then return makeborne_private.publication_snapshot(p); end if;
 if p.state<>'running' or p.worker_id is distinct from p_worker or p.fence is distinct from p_fence or p.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp() then
  raise exception 'Preparation lease changed' using errcode='PT409'; end if;
 binding:=jsonb_build_object('preparationId',p.id,'actorId',p.actor_id,'workspaceId',p.workspace_id,'projectId',p.project_id,'artifactId',p.artifact_id,
  'versionId',p.version_id,'versionNumber',p.version_number,'publicationRevision',p.publication_revision,'versionContentHash',p.version_content_hash,'slug',p.slug,'interactive',p.interactive);
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or not p_receipt @> binding or octet_length(p_receipt::text)>262144
  or (p_receipt ? 'outputHash' and p_receipt->>'outputHash' is distinct from digest) then raise exception 'Receipt binding mismatch' using errcode='22023'; end if;
 if p_output is null or octet_length(p_output)>24000000 then raise exception 'Output too large' using errcode='22023'; end if;
 o:=p_output::jsonb;
 if jsonb_typeof(o)<>'object' or not o ?& array['html','isolatedHtml','script','files','interactive','routes']
  or (select count(*) from jsonb_object_keys(o))<>6 or jsonb_typeof(o->'html')<>'string'
  or octet_length(o->>'html') not between 100 and 4000000 or left(o->>'html',15)<>'<!doctype html>'
  or jsonb_typeof(o->'isolatedHtml')<>'string' or octet_length(o->>'isolatedHtml') not between 100 and 4000000
  or left(o->>'isolatedHtml',15)<>'<!doctype html>' or o->'interactive' is distinct from to_jsonb(p.interactive)
  or jsonb_typeof(o->'files')<>'array' or jsonb_array_length(o->'files')>128
  or jsonb_typeof(o->'script') not in ('string','null') or jsonb_typeof(o->'routes')<>'array' or jsonb_array_length(o->'routes') not between 1 and 20 then raise exception 'Invalid retained output' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(o->'routes') loop
  if jsonb_typeof(f)<>'object' or not f ?& array['path','html','isolatedHtml'] or f->>'path' is null or f->>'path'=any(route_paths)
   or length(f->>'path')>240 or f->>'path' !~ '^/([A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*$'
   or jsonb_typeof(f->'html') is distinct from 'string' or jsonb_typeof(f->'isolatedHtml') is distinct from 'string'
   or octet_length(f->>'html') not between 100 and 4000000 or octet_length(f->>'isolatedHtml') not between 100 and 4000000
   or left(f->>'html',15)<>'<!doctype html>' or left(f->>'isolatedHtml',15)<>'<!doctype html>' then raise exception 'Invalid retained route' using errcode='22023'; end if;
  route_paths:=array_append(route_paths,f->>'path');
  route_total:=route_total+octet_length(f->>'html')+octet_length(f->>'isolatedHtml');
 end loop;
 if route_total>8000000 or not exists(select 1 from jsonb_array_elements(o->'routes') r where r->>'path'='/' and r->>'html'=o->>'html' and r->>'isolatedHtml'=o->>'isolatedHtml') then
  raise exception 'Incomplete retained routes' using errcode='22023'; end if;
 select array_agg(route->>'path' order by route->>'path') into declared_routes from public.artifact_versions v,
  jsonb_array_elements(v.content->'websiteSource'->'routes') route where v.id=p.version_id;
 if declared_routes is distinct from (select array_agg(route_path order by route_path) from unnest(route_paths) route_path) then
  raise exception 'Retained routes differ from saved source' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(o->'files') loop
  if jsonb_typeof(f)<>'object' or not f ?& array['path','body','sha256','content_type'] or f->>'path'=any(paths)
   or f->>'path' is null or length(f->>'path')>240 or position('..' in f->>'path')>0 or position('//' in f->>'path')>0
   or not ((f->>'path' ~ '^(/assets/[A-Za-z0-9_.-]+|/_mb/app-[0-9a-f]{16})\.js$' and f->>'content_type'='text/javascript; charset=utf-8')
    or (f->>'path' ~ '^(/assets/[A-Za-z0-9_.-]+|/_mb/app-[0-9a-f]{16})\.css$' and f->>'content_type'='text/css; charset=utf-8')
    or (f->>'path' ~ '^/assets/[A-Za-z0-9_.-]+\.woff2$' and f->>'content_type'='font/woff2')
    or (f->>'path' ~ '^/[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(webp|png|jpg|jpeg)$' and f->>'path' !~ '^/_mb/' and f->>'content_type' in ('image/webp','image/png','image/jpeg')))
   or f->>'content_type' is null or f->>'body' is null or f->>'sha256' is null then raise exception 'Invalid retained file' using errcode='22023'; end if;
  bytes:=decode(f->>'body','base64');
  if octet_length(bytes) not between 1 and (case f->>'content_type' when 'text/javascript; charset=utf-8' then 1500000 when 'text/css; charset=utf-8' then 1200000 else 2000000 end)
   or encode(sha256(bytes),'hex') is distinct from f->>'sha256' then raise exception 'Retained file digest or size mismatch' using errcode='22023'; end if;
  total:=total+octet_length(bytes); paths:=array_append(paths,f->>'path');
 end loop;
 if total>6000000 or (select count(*) from jsonb_array_elements(o->'files') file_entry where file_entry->>'content_type' like 'image/%')>40
  or (o->>'script' is not null and not exists(select 1 from jsonb_array_elements(o->'files') file_entry where file_entry->>'path'=o->>'script' and file_entry->>'content_type'='text/javascript; charset=utf-8'))
  or (p.interactive and o->>'script' is null) then raise exception 'Incomplete retained bundle' using errcode='22023'; end if;
 update makeborne_private.publication_preparations set state='ready',worker_id=null,lease_until=null,
  receipt=p_receipt||jsonb_build_object('outputHash',digest),output_text=p_output,output_hash=digest,updated_at=clock_timestamp() where id=p.id returning * into p;
 return makeborne_private.publication_snapshot(p);
end $$;

create function makeborne_private.fail_publication_preparation(p_preparation uuid,p_worker uuid,p_fence bigint,p_error text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p makeborne_private.publication_preparations%rowtype;
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 if p.state<>'running' or p.worker_id is distinct from p_worker or p.fence is distinct from p_fence or p.lease_until<=clock_timestamp() then
  raise exception 'Preparation lease changed' using errcode='PT409'; end if;
 update makeborne_private.publication_preparations set state=case when attempts<3 and expires_at>clock_timestamp() then 'queued' else 'failed' end,
  worker_id=null,lease_until=null,error=left(coalesce(p_error,'Preparation failed'),1000),updated_at=clock_timestamp() where id=p.id returning * into p;
 return makeborne_private.publication_snapshot(p);
end $$;

-- The original v4 CAS remains the atomic writer, callable only from definers.
alter function makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) rename to promote_retained_site_v4;
revoke all on function makeborne_hosting.promote_retained_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated,service_role;
create function makeborne_hosting.save_site_v4(p_actor uuid,p_workspace uuid,p_artifact uuid,p_version integer,p_slug text,p_html text,p_live boolean,p_revision integer,p_request uuid,
 p_interactive boolean,p_script text,p_files jsonb,p_isolated_html text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.workspaces where id=p_workspace for update;
 perform 1 from public.artifacts where id=p_artifact and workspace_id=p_workspace for update;
 if p_live and exists(select 1 from public.artifact_versions where artifact_id=p_artifact and workspace_id=p_workspace and version_number=p_version
  and content->'websiteSource' is not null and content->'websiteSource'<>'null'::jsonb) then
  raise exception 'Trusted publication preparation required' using errcode='42501'; end if;
 result:=makeborne_hosting.promote_retained_site_v4(p_actor,p_workspace,p_artifact,p_version,p_slug,p_html,p_live,p_revision,p_request,p_interactive,p_script,p_files,p_isolated_html);
 if p_live then delete from makeborne_hosting.site_routes where artifact_id=p_artifact; end if;
 return result;
end $$;
revoke all on function makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) from public,anon,authenticated;
grant execute on function makeborne_hosting.save_site_v4(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb,text) to service_role;

create function makeborne_private.promote_publication_preparation(p_preparation uuid,p_actor uuid,p_session uuid,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p makeborne_private.publication_preparations%rowtype; a public.artifacts%rowtype; v public.artifact_versions%rowtype; o jsonb; r jsonb; rev integer;
begin
 select * into p from makeborne_private.publication_preparations where id=p_preparation and actor_id=p_actor;
 if not found then raise exception 'Preparation unavailable' using errcode='P0002'; end if;
 a:=makeborne_private.publication_authority(p_actor,p_session,p_expires,p.workspace_id,p.artifact_id);
 select * into p from makeborne_private.publication_preparations where id=p_preparation for update;
 if p.state='promoted' then return p.result; end if;
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

create table makeborne_hosting.site_routes(
 artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
 path text not null, html text not null, isolated_html text not null, primary key(artifact_id,path)
);
alter table makeborne_hosting.site_routes enable row level security;
revoke all on makeborne_hosting.site_routes from public,anon,authenticated,service_role;
create function makeborne_hosting.read_hosted_site_v3(p_slug text,p_path text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('html',coalesce(r.isolated_html,s.isolated_html,s.html),'interactive',s.interactive and s.entry_script is not null and s.isolated_html is not null,
  'script',case when s.isolated_html is not null then s.entry_script end,'revision',s.revision,'branding',w.site_badge)
 from public.hosted_sites s join public.workspaces w on w.id=s.workspace_id and w.owner_id=s.owner_id
 left join makeborne_hosting.site_routes r on r.artifact_id=s.artifact_id and r.path=p_path
 where s.slug=p_slug and s.live and makeborne_hosting.owner_can_host(s.owner_id)
  and (r.artifact_id is not null or not exists(select 1 from makeborne_hosting.site_routes x where x.artifact_id=s.artifact_id));
$$;
create function public.makeborne_read_hosted_site_v3(p_slug text,p_path text) returns jsonb
language sql stable security invoker set search_path='' as $$ select makeborne_hosting.read_hosted_site_v3(p_slug,p_path); $$;
revoke all on function makeborne_hosting.read_hosted_site_v3(text,text),public.makeborne_read_hosted_site_v3(text,text) from public,anon,authenticated,service_role;
grant execute on function makeborne_hosting.read_hosted_site_v3(text,text),public.makeborne_read_hosted_site_v3(text,text) to anon,authenticated,service_role;

-- The older service bridges cannot bypass the trusted source publication path.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname in ('makeborne_save_hosted_site','makeborne_save_hosted_site_v2','makeborne_save_hosted_site_v3'))
   or (n.nspname='makeborne_hosting' and p.proname in ('save_site','save_site_v2','save_site_v3')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;

-- Manifest extension for trusted Vite output; no arbitrary public file types.
alter table public.hosted_sites drop constraint hosted_sites_entry_script_check;
alter table public.hosted_sites add constraint hosted_sites_entry_script_check check(entry_script ~ '^(/_mb/app-[0-9a-f]{16}|/assets/[A-Za-z0-9_.-]+)\.js$' and position('..' in entry_script)=0);
alter table public.hosted_site_files drop constraint hosted_site_files_path_check;
alter table public.hosted_site_files drop constraint hosted_site_files_content_type_check;
alter table public.hosted_site_files add constraint hosted_site_files_path_check check(char_length(path)<=240 and position('..' in path)=0 and position('//' in path)=0 and (
 path ~ '^/_mb/app-[0-9a-f]{16}\.(js|css)$' or path ~ '^/assets/[A-Za-z0-9_.-]+\.(js|css|woff2)$'
 or (path ~* '^/[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(webp|png|jpe?g)$' and path !~ '^/_mb/')));
alter table public.hosted_site_files add constraint hosted_site_files_content_type_check check(content_type in ('text/javascript; charset=utf-8','text/css; charset=utf-8','font/woff2','image/webp','image/png','image/jpeg'));
-- Increase only the manifest count in the established CAS implementation.
do $$ declare definition text; begin
 select pg_get_functiondef('makeborne_hosting.save_site_v2(uuid,uuid,uuid,integer,text,text,boolean,integer,uuid,boolean,text,jsonb)'::regprocedure) into definition;
 if position('jsonb_array_length(v_files)>42' in definition)=0 then raise exception 'Unexpected v2 manifest guard'; end if;
 execute replace(definition,'jsonb_array_length(v_files)>42','jsonb_array_length(v_files)>128');
end $$;

-- Public invoker bridges; private definers use fixed search paths and have no
-- browser grants. Table access stays unavailable even to service_role.
do $$ declare f record; args text; names text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private'
  and p.proname in ('request_publication_preparation','publication_preparation_status','latest_publication_preparation','claim_publication_preparation','load_publication_preparation',
    'complete_publication_preparation','fail_publication_preparation','promote_publication_preparation') loop
  args:=pg_get_function_arguments(f.oid);
  select string_agg(x,',' order by ord) into names from unnest((select proargnames from pg_proc where oid=f.oid)) with ordinality a(x,ord);
  execute format('create function public.makeborne_%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$ select makeborne_private.%I(%s); $fn$',f.proname,args,f.proname,names);
  execute format('revoke all on function makeborne_private.%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function makeborne_private.%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('revoke all on function public.makeborne_%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.makeborne_%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end $$;
revoke all on function makeborne_private.publication_snapshot(makeborne_private.publication_preparations),
 makeborne_private.publication_authority(uuid,uuid,timestamptz,uuid,uuid),makeborne_private.check_publication_sources(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

commit;
