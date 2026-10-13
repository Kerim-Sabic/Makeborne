begin;
alter table public.hosted_sites add column enquiries_enabled boolean not null default false;
create table public.site_enquiries (
 id uuid primary key default gen_random_uuid(),
 artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 request_id uuid not null,
 name text not null check(length(name) between 1 and 120),
 email text not null check(length(email) between 3 and 254),
 message text not null check(length(message) between 1 and 5000),
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 read_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(artifact_id,request_id)
);
create index site_enquiries_recent on public.site_enquiries(artifact_id,created_at desc);
alter table public.site_enquiries enable row level security;
revoke all on public.site_enquiries from public,anon,authenticated;
grant select on public.site_enquiries to authenticated;
grant all on public.site_enquiries to service_role;
create policy site_enquiries_owner_read on public.site_enquiries for select to authenticated
 using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())));

create function makeborne_hosting.accept_enquiry(p_slug text,p_request uuid,p_name text,p_email text,p_message text,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hosted_sites%rowtype; previous public.site_enquiries%rowtype; result uuid;
begin
 if p_request is null or p_name is null or length(p_name) not between 1 and 120
  or p_email is null or length(p_email) not between 3 and 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_message is null or length(p_message) not between 1 and 5000
  or p_source is null or p_source !~ '^[0-9a-f]{64}$' then raise exception 'Invalid enquiry' using errcode='22023';end if;
 select * into s from public.hosted_sites where slug=p_slug for update;
 if not found or not s.live or not s.interactive or not s.enquiries_enabled then raise exception 'Form unavailable' using errcode='P0002';end if;
 select * into previous from public.site_enquiries where artifact_id=s.artifact_id and request_id=p_request;
 if found then
  if previous.name is distinct from p_name or previous.email is distinct from p_email or previous.message is distinct from p_message then raise exception 'Request changed' using errcode='MB409';end if;
  return jsonb_build_object('accepted',true,'id',previous.id);
 end if;
 if (select count(*) from public.site_enquiries where artifact_id=s.artifact_id and created_at>clock_timestamp()-interval '1 hour')>=100
  or (select count(*) from public.site_enquiries where artifact_id=s.artifact_id and source_hash=p_source and created_at>clock_timestamp()-interval '10 minutes')>=5 then raise exception 'Submission limit' using errcode='MB429';end if;
 insert into public.site_enquiries(artifact_id,workspace_id,request_id,name,email,message,source_hash)
 values(s.artifact_id,s.workspace_id,p_request,p_name,p_email,p_message,p_source) returning id into result;
 return jsonb_build_object('accepted',true,'id',result);
end $$;
revoke all on function makeborne_hosting.accept_enquiry(text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.makeborne_accept_site_enquiry(p_slug text,p_request uuid,p_name text,p_email text,p_message text,p_source text)
returns jsonb language sql set search_path='' as $$ select makeborne_hosting.accept_enquiry(p_slug,p_request,p_name,p_email,p_message,p_source); $$;
grant execute on function makeborne_hosting.accept_enquiry(text,uuid,text,text,text,text) to service_role;
revoke all on function public.makeborne_accept_site_enquiry(text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.makeborne_accept_site_enquiry(text,uuid,text,text,text,text) to service_role;
commit;
