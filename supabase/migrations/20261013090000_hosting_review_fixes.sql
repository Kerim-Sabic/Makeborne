-- Release review fixes for hosted sites.
-- 1. Enquiries follow the same eligibility as public reads: a site whose owner
--    can no longer host (lost membership, banned, deleted) is not served, so it
--    must not collect visitor messages either.
-- 2. Retired addresses stay reserved, but each website may hold at most 10
--    addresses in total, so repeated renames cannot squat unlimited addresses.
begin;

create or replace function makeborne_hosting.accept_enquiry(p_slug text,p_request uuid,p_name text,p_email text,p_message text,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hosted_sites%rowtype; previous public.site_enquiries%rowtype; result uuid;
begin
 if p_request is null or p_name is null or length(p_name) not between 1 and 120
  or p_email is null or length(p_email) not between 3 and 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_message is null or length(p_message) not between 1 and 5000
  or p_source is null or p_source !~ '^[0-9a-f]{64}$' then raise exception 'Invalid enquiry' using errcode='22023';end if;
 select * into s from public.hosted_sites where slug=p_slug for update;
 if not found or not s.live or not s.interactive or not s.enquiries_enabled or not makeborne_hosting.owner_can_host(s.owner_id)
  then raise exception 'Form unavailable' using errcode='P0002';end if;
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

create or replace function makeborne_hosting.reserve_site_address() returns trigger
language plpgsql security definer set search_path='' as $$
declare reserved uuid;
begin
 insert into makeborne_hosting.site_address_reservations(slug,artifact_id) values(new.slug,new.artifact_id) on conflict(slug) do nothing;
 select artifact_id into reserved from makeborne_hosting.site_address_reservations where slug=new.slug;
 if reserved is distinct from new.artifact_id then raise exception 'Address already reserved' using errcode='23505'; end if;
 if (select count(*) from makeborne_hosting.site_address_reservations where artifact_id=new.artifact_id)>10 then
  raise exception 'This website has used its 10 addresses; reuse one of its earlier addresses' using errcode='MB429';
 end if;
 return new;
end $$;

commit;
