begin;
alter table public.clients add column outreach jsonb;

-- Validate direct Data API writes as well as application requests. No new role access.
create function makeborne_private.validate_client_outreach() returns trigger
language plpgsql set search_path='' as $$
declare v jsonb := new.outreach; item jsonb; k text; seen text[] := '{}'; previous jsonb;
begin
  if v is null then
    if tg_op='UPDATE' and old.outreach is not null then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    return new;
  end if;
  if jsonb_typeof(v)<>'object' or octet_length(v::text)>1000000
    or not (v ?& array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])
    or (v - array['stage','channel','profileUrl','lastContact','nextFollowUp','notes','activity'])<>'{}'::jsonb
    or coalesce(v->>'stage','') not in ('Lead','Contacted','Replied','Meeting','Proposal','Won','Lost')
    or coalesce(v->>'channel','') not in ('Not set','Email','Instagram','LinkedIn','Phone','Other')
    or jsonb_typeof(v->'profileUrl') is distinct from 'string' or length(v->>'profileUrl')>2000
    or ((v->>'profileUrl')<>'' and (v->>'profileUrl') !~ '^https?://[^/@[:space:]]+([/?#]|$)')
    or jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>5000
    or jsonb_typeof(v->'activity') is distinct from 'array' then
    raise exception 'Invalid outreach fields' using errcode='22023';
  end if;
  foreach k in array array['lastContact','nextFollowUp'] loop
    if v->k <> 'null'::jsonb then
      if jsonb_typeof(v->k)<>'string' or (v->>k) !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char((v->>k)::date,'YYYY-MM-DD')<>v->>k then
        raise exception 'Invalid outreach date' using errcode='22023';
      end if;
    end if;
  end loop;
  if jsonb_array_length(v->'activity')>300 then raise exception 'Outreach history limit reached' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(v->'activity') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['id','at','text','type'])
      or (item-array['id','at','text','type'])<>'{}'::jsonb
      or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'id')=any(seen)
      or jsonb_typeof(item->'at') is distinct from 'string'
      or (item->>'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
      or jsonb_typeof(item->'text') is distinct from 'string' or length(trim(item->>'text')) not between 1 and 2000
      or coalesce(item->>'type','') not in ('update','contact','note') then
      raise exception 'Invalid outreach history' using errcode='22023';
    end if;
    perform (item->>'at')::timestamptz;
    seen := array_append(seen,item->>'id');
  end loop;
  if tg_op='UPDATE' and old.outreach is not null then
    previous := old.outreach->'activity';
    if jsonb_array_length(v->'activity')<jsonb_array_length(previous) then
      raise exception 'Outreach history must be preserved' using errcode='22023';
    end if;
    for i in 0..jsonb_array_length(previous)-1 loop
      if previous->i is distinct from v->'activity'->i then
        raise exception 'Outreach history must be preserved' using errcode='22023';
      end if;
    end loop;
  end if;
  return new;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Invalid outreach date' using errcode='22023';
end;
$$;
revoke all on function makeborne_private.validate_client_outreach() from public,anon,authenticated;
create trigger client_outreach_validation before insert or update of outreach on public.clients
for each row execute function makeborne_private.validate_client_outreach();
grant update(outreach) on public.clients to authenticated;
commit;
