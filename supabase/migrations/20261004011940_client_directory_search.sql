begin;
create function public.makeborne_client_directory(p_workspace_id uuid,p_search text,p_stage text,p_follow_up text,p_day date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not makeborne_private.can_read(p_workspace_id) then raise exception 'Workspace access required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_day is null or p_offset is null or p_offset not between 0 and 100000
 or p_stage is null or p_stage not in ('All stages','Lead','Contacted','Replied','Meeting','Proposal','Won','Lost')
 or p_follow_up is null or p_follow_up not in ('all','overdue','today','upcoming','unscheduled') then raise exception 'Invalid directory filters' using errcode='22023'; end if;
 with base as materialized (
   select c.id,c.name,c.company,c.email,c.website,c.created_at,c.updated_at,
     coalesce(c.outreach->>'stage','Lead') as outreach_stage,c.outreach->>'nextFollowUp' as outreach_follow_up,
     case when c.outreach->>'stage' in ('Won','Lost') then 'closed'
       when c.outreach->>'nextFollowUp' is null then 'unscheduled'
       when c.outreach->>'nextFollowUp'<to_char(p_day,'YYYY-MM-DD') then 'overdue'
       when c.outreach->>'nextFollowUp'=to_char(p_day,'YYYY-MM-DD') then 'today'
       else 'upcoming' end as follow_up_bucket
   from public.clients c where c.workspace_id=p_workspace_id
 ), filtered as materialized (
   select * from base where (p_stage='All stages' or outreach_stage=p_stage)
     and (p_follow_up='all' or follow_up_bucket=p_follow_up)
     and (p_search='' or strpos(lower(name||' '||company||' '||email),lower(p_search))>0)
 ), page as (
   select * from filtered order by
     case when p_follow_up<>'all' then outreach_follow_up end asc nulls last,
     case when p_follow_up='all' then created_at end desc,
     id asc limit 50 offset p_offset
 )
 select jsonb_build_object(
   'clients',coalesce((select jsonb_agg(to_jsonb(page)-'follow_up_bucket') from page),'[]'::jsonb),
   'pagination',jsonb_build_object('total',(select count(*) from filtered),'nextOffset',case when p_offset+50<(select count(*) from filtered) then p_offset+50 else null end),
   'counts',(select jsonb_build_object('all',count(*),'overdue',count(*) filter(where follow_up_bucket='overdue'),'today',count(*) filter(where follow_up_bucket='today'),'upcoming',count(*) filter(where follow_up_bucket='upcoming'),'unscheduled',count(*) filter(where follow_up_bucket='unscheduled')) from base)
 ) into result;
 return result;
end $$;
revoke all on function public.makeborne_client_directory(uuid,text,text,text,date,integer) from public,anon;
grant execute on function public.makeborne_client_directory(uuid,text,text,text,date,integer) to authenticated;
commit;
