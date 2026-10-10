begin;
-- Validate saved geometry at the original immutable version boundary, including direct RPC writes.
create function makeborne_private.validate_native_slide_design_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s jsonb; d jsonb; e jsonb; b jsonb; k text; ref text; value numeric; previous_content jsonb;
 ids text[]; text_refs text[]; image_refs text[]; allowed text[];
begin
 if new.parent_version_id is not null then
  select v.content into previous_content from public.artifact_versions v where v.id=new.parent_version_id and v.artifact_id=new.artifact_id and v.workspace_id=new.workspace_id;
  for s in select jsonb_array_elements(previous_content->'sections') loop
   if s ? 'slideDesign' and exists(select 1 from jsonb_array_elements(new.content->'sections') next_section where next_section->>'id'=s->>'id' and not next_section ? 'slideDesign') then
    raise exception 'Saved slide geometry cannot be silently discarded' using errcode='22023';
   end if;
  end loop;
 end if;
 for s in select jsonb_array_elements(new.content->'sections') loop
  if not s ? 'slideDesign' then continue; end if;
  d:=s->'slideDesign'; ids:='{}'; text_refs:='{}'; image_refs:='{}';
  if new.content->>'kind' is distinct from 'presentation' or jsonb_typeof(d) is distinct from 'object'
   or d->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(d->'elements') is distinct from 'array' then
   raise exception 'Invalid native slide design' using errcode='22023';
  end if;
  if jsonb_array_length(d->'elements') not between 1 and 40
   or exists(select 1 from jsonb_object_keys(d) key where key not in ('schemaVersion','background','elements'))
   or (d ? 'background' and (jsonb_typeof(d->'background') is distinct from 'string' or d->>'background' !~ '^#[0-9a-fA-F]{6}$')) then
   raise exception 'Invalid native slide metadata' using errcode='22023';
  end if;
  for e in select jsonb_array_elements(d->'elements') loop
   if jsonb_typeof(e) is distinct from 'object' or coalesce(e->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or e->>'id'=any(ids) or coalesce(e->>'kind','') not in ('text','image') then
    raise exception 'Invalid native slide element' using errcode='22023';
   end if;
   ids:=array_append(ids,e->>'id');
   foreach k in array array['x','y','width','height'] loop
    if jsonb_typeof(e->k) is distinct from 'number' then raise exception 'Invalid slide geometry' using errcode='22023'; end if;
    value:=(e->>k)::numeric;
    if value<0 or (k in ('width','height') and value=0) then raise exception 'Invalid slide geometry' using errcode='22023'; end if;
   end loop;
   if (e->>'x')::numeric+(e->>'width')::numeric>1280 or (e->>'y')::numeric+(e->>'height')::numeric>720 then
    raise exception 'Slide element exceeds canvas' using errcode='22023';
   end if;
   if e->>'kind'='text' then
    allowed:=array['id','kind','source','x','y','width','height','fontSize','lineHeight','font','weight','align','color'];
    if jsonb_typeof(e->'fontSize') is distinct from 'number' or jsonb_typeof(e->'lineHeight') is distinct from 'number'
     or jsonb_typeof(e->'source') is distinct from 'object' or coalesce(e->>'font','') not in ('heading','body')
     or coalesce(e->>'weight','') not in ('regular','bold') or coalesce(e->>'align','') not in ('left','center','right') then
     raise exception 'Invalid native text styling' using errcode='22023';
    end if;
    if (e->>'fontSize')::numeric not between 24 and 144 or (e->>'lineHeight')::numeric not between 1 and 1.8
     or (e ? 'color' and (jsonb_typeof(e->'color') is distinct from 'string' or e->>'color' !~ '^#[0-9a-fA-F]{6}$')) then
     raise exception 'Invalid native text styling' using errcode='22023';
    end if;
    if e#>>'{source,kind}'='title' and e->'source'='{"kind":"title"}'::jsonb then ref:='title';
    elsif e#>>'{source,kind}'='block' then
     ref:=e#>>'{source,blockId}';
     if e->'source' is distinct from jsonb_build_object('kind','block','blockId',ref)
      or not exists(select 1 from jsonb_array_elements(s->'blocks') block where block->>'id'=ref and block->>'type' in ('paragraph','quote','image')) then
      raise exception 'Text reference is not on this slide' using errcode='22023';
     end if;
    else raise exception 'Invalid text source' using errcode='22023'; end if;
    if ref=any(text_refs) then raise exception 'Duplicate slide text' using errcode='22023'; end if;
    text_refs:=array_append(text_refs,ref);
   else
    allowed:=array['id','kind','blockId','x','y','width','height','fit'];ref:=e->>'blockId';
    if coalesce(e->>'fit','') not in ('contain','cover') or ref=any(image_refs)
     or not exists(select 1 from jsonb_array_elements(s->'blocks') block where block->>'id'=ref and block->>'type'='image' and block->>'assetId' is not null) then
     raise exception 'Artwork reference is not on this slide' using errcode='22023';
    end if;
    image_refs:=array_append(image_refs,ref);
   end if;
   if exists(select 1 from jsonb_object_keys(e) key where not key=any(allowed)) then raise exception 'Unknown native slide field' using errcode='22023'; end if;
  end loop;
  if not 'title'=any(text_refs) then raise exception 'Missing slide title element' using errcode='22023'; end if;
  for b in select jsonb_array_elements(s->'blocks') loop
   if coalesce(b->>'type','') not in ('paragraph','quote','image')
    or ((b->>'type'<>'image' or length(b->>'text')>0) and not b->>'id'=any(text_refs))
    or (b->>'type'='image' and not b->>'id'=any(image_refs)) then
    raise exception 'Native slide omits source content' using errcode='22023';
   end if;
  end loop;
 end loop;
 return new;
end;
$$;
revoke all on function makeborne_private.validate_native_slide_design_revision() from public,anon,authenticated,service_role;
create trigger validate_native_slide_design_revision before insert on public.artifact_versions
for each row execute function makeborne_private.validate_native_slide_design_revision();
commit;
