\set ON_ERROR_STOP on
begin;
do $$ declare w uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); a jsonb; b jsonb; expired uuid:=gen_random_uuid(); exhausted uuid:=gen_random_uuid(); begin
 insert into makeborne_private.withdrawal_requests(id,reference,source,email,statement,acknowledgement)
 values(w,'WD-'||upper(substr(replace(w::text,'-',''),1,8)),'signed_out','mail-fence@example.invalid','Fictional transactional mail fencing fixture.','queued');
 insert into makeborne_private.transactional_mail(id,kind,withdrawal_id,recipient,subject,body,idempotency_key)
 values(m,'withdrawal_ack',w,'mail-fence@example.invalid','Fictional','Fictional','mail-fence:'||m::text);
 a:=public.makeborne_transactional_mail_claim(1,30);
 assert (a->0->>'id')::uuid=m and (a->0->>'attempts')::int=1;
 assert a->0->>'first_attempt_at' is not null and a->0->>'lease_until' is not null;
 update makeborne_private.transactional_mail set lease_until=clock_timestamp()-interval '1 second' where id=m;
 assert public.makeborne_transactional_mail_result(m,true,'expired',null,false,1)='unchanged','Expired claim cannot settle before reclaim';
 b:=public.makeborne_transactional_mail_claim(1,30);
 assert (b->0->>'attempts')::int=2 and a->0->>'first_attempt_at'=b->0->>'first_attempt_at';
 assert public.makeborne_transactional_mail_result(m,true,'stale',null,false,1)='unchanged','Stale success cannot settle a newer claim';
 assert public.makeborne_transactional_mail_result(m,false,null,'MAIL_NETWORK',false,1)='unchanged','Stale failure cannot release a newer claim';
 assert public.makeborne_transactional_mail_result(m,true,'legacy',null,false)='unchanged','Legacy result without its fence is refused';
 assert public.makeborne_transactional_mail_result(m,true,'current',null,false,2)='sent';
 assert public.makeborne_transactional_mail_result(m,true,'current',null,false,2)='unchanged';
 raise notice 'PASS mail fencing: expired, stale success/failure and legacy results refused; current claim settles once';

 -- Keep each immutable notice associated with at most one outbox row.
 insert into makeborne_private.withdrawal_requests(id,reference,source,email,statement,acknowledgement)
 values(expired,'WD-'||upper(substr(replace(expired::text,'-',''),1,8)),'signed_out','old-mail@example.invalid','Fictional old uncertain delivery fixture.','queued'),
 (exhausted,'WD-'||upper(substr(replace(exhausted::text,'-',''),1,8)),'signed_out','max-mail@example.invalid','Fictional maximum attempt fixture.','queued');
 insert into makeborne_private.transactional_mail(kind,withdrawal_id,recipient,subject,body,idempotency_key,attempts,first_attempt_at)
 values('withdrawal_ack',expired,'old-mail@example.invalid','Old','Old','old-mail:'||expired::text,1,clock_timestamp()-interval '24 hours'),
 ('withdrawal_ack',exhausted,'max-mail@example.invalid','Max','Max','max-mail:'||exhausted::text,12,clock_timestamp());
 assert jsonb_array_length(public.makeborne_transactional_mail_claim(100,30))=0,'Uncertain expired or exhausted rows are never sent again';
 assert (select status='failed' and last_error='MAIL_IDEMPOTENCY_EXPIRED' from makeborne_private.transactional_mail where withdrawal_id=expired);
 assert (select status='failed' and last_error='MAIL_ATTEMPTS_EXHAUSTED' from makeborne_private.transactional_mail where withdrawal_id=exhausted);
 raise notice 'PASS mail retry horizon: uncertainty beyond provider deduplication and maximum attempts require operator review';
end $$;
do $$ declare signature text:='public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean,integer)'; begin
 assert not has_function_privilege('anon',signature,'execute');
 assert not has_function_privilege('authenticated',signature,'execute');
 assert has_function_privilege('service_role',signature,'execute');
 assert not (select prosecdef from pg_proc where oid=signature::regprocedure);
 raise notice 'PASS mail permissions: new public wrapper is invoker and service-role only';
end $$;
rollback;
