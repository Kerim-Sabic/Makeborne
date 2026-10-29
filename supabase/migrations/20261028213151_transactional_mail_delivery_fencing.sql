-- Delivery claims are fenced by monotonically increasing attempt number.
-- No automatic retry can outlive Resend's 24-hour idempotency window.
begin;
alter table makeborne_private.transactional_mail add column first_attempt_at timestamptz;
update makeborne_private.transactional_mail set first_attempt_at=created_at where attempts>0;

create or replace function makeborne_rpc.makeborne_transactional_mail_claim(p_limit integer default 20,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update makeborne_private.transactional_mail set status='failed',lease_until=null,
  last_error=case when first_attempt_at+interval '23 hours'<=clock_timestamp() then 'MAIL_IDEMPOTENCY_EXPIRED' else 'MAIL_ATTEMPTS_EXHAUSTED' end
 where status in ('pending','sending') and (lease_until is null or lease_until<clock_timestamp())
  and (attempts>=12 or first_attempt_at+interval '23 hours'<=clock_timestamp());
 with due as (
  select id from makeborne_private.transactional_mail
  where status in ('pending','sending') and next_attempt_at<=clock_timestamp()
   and (lease_until is null or lease_until<clock_timestamp()) and attempts<12
   and (first_attempt_at is null or first_attempt_at+interval '23 hours'>clock_timestamp())
  order by next_attempt_at,created_at limit least(greatest(coalesce(p_limit,20),1),100) for update skip locked
 ), claimed as (
  update makeborne_private.transactional_mail t set status='sending',attempts=t.attempts+1,
   first_attempt_at=coalesce(t.first_attempt_at,clock_timestamp()),
   lease_until=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,120),30),600))
  from due where t.id=due.id
  returning t.id,t.kind,t.recipient,t.subject,t.body,t.idempotency_key,t.attempts,t.lease_until,t.first_attempt_at
 ) select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.id),'[]'::jsonb) into result from claimed;
 return result;
end $$;

-- Legacy binaries cannot settle an unbound claim. Their sending flag must stay
-- off during rollout; no purchase or stored email is discarded by this repair.
create or replace function makeborne_rpc.makeborne_transactional_mail_result(p_id uuid,p_sent boolean,p_provider_id text,p_error text,p_final boolean default false)
returns text language plpgsql security definer set search_path='' as $$ begin return 'unchanged'; end $$;

create function makeborne_rpc.makeborne_transactional_mail_result(p_id uuid,p_sent boolean,p_provider_id text,p_error text,p_final boolean,p_attempt integer)
returns text language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
 if p_id is null or p_sent is null or p_attempt is null or p_attempt not between 1 and 12
  or (p_sent and (p_provider_id is null or length(p_provider_id) not between 1 and 200))
  or (not p_sent and (p_error is null or p_error !~ '^[A-Z0-9_]{1,80}$')) then
  raise exception 'Invalid fenced mail result' using errcode='22023';
 end if;
 if p_sent then
  update makeborne_private.transactional_mail set status='sent',sent_at=clock_timestamp(),provider_message_id=p_provider_id,last_error=null,lease_until=null
   where id=p_id and status='sending' and attempts=p_attempt and lease_until>clock_timestamp()
   returning status into v_status;
 else
  update makeborne_private.transactional_mail set status=case when coalesce(p_final,false) or attempts>=12 then 'failed' else 'pending' end,
   last_error=p_error,lease_until=null,next_attempt_at=clock_timestamp()+least(interval '24 hours',interval '5 minutes'*power(2,greatest(attempts-1,0)))
   where id=p_id and status='sending' and attempts=p_attempt and lease_until>clock_timestamp()
   returning status into v_status;
 end if;
 return coalesce(v_status,'unchanged');
end $$;
alter function makeborne_rpc.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) owner to postgres;
revoke all on function makeborne_rpc.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function makeborne_rpc.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) to service_role;
create function public.makeborne_transactional_mail_result(p_id uuid,p_sent boolean,p_provider_id text,p_error text,p_final boolean,p_attempt integer)
returns text language sql security invoker set search_path='' as $$ select makeborne_rpc.makeborne_transactional_mail_result(p_id,p_sent,p_provider_id,p_error,p_final,p_attempt) $$;
alter function public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) owner to postgres;
revoke all on function public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer) to service_role;
commit;
