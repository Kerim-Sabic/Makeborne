-- C3: actual wallet withhold/restore helpers -> caller-scoped usage history.
-- Disposable local candidate database only; no provider observations are claimed.
\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
do $$
declare u uuid:=gen_random_uuid(); result jsonb; amount bigint;
  start_ timestamptz:=date_trunc('month',now()); end_ timestamptz:=date_trunc('month',now())+interval '1 month';
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,u||'@usage-payment.example.invalid',now());
  perform makeborne_private.credit_grant(u,500,'adjust','usage-payment-fixture',jsonb_build_object('reason','Disposable funding fixture'));
  update makeborne_private.credit_lots set funding_payment_id='pay_usageActual' where user_id=u;
  perform makeborne_private.credit_reserve(u,20,'mystery:usage-actual');
  perform makeborne_private.credit_settle(u,'mystery:usage-actual',12);
  -- The same wallet lock required by the real reconciliation/refund callers.
  perform makeborne_private.lock_credit_wallet(u);
  amount:=makeborne_private.withhold_payment_lots(u,'pay_usageActual','disputed',null);
  assert amount=488 and makeborne_private.credit_available(u)=0,'actual withholding removes unused funding';
  assert makeborne_private.withhold_payment_lots(u,'pay_usageActual','disputed',null)=0,'duplicate withhold is inert';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.makeborne_usage_history(start_,end_,null,null,100);
  reset role;
  assert (result->'period'->>'used')::bigint=12,'payment withholding is not usage';
  assert (select count(*) from jsonb_array_elements(result->'entries') e where e->>'status'='Withheld' and e->>'credits'='488')=1,'real withhold appears once';
  assert result->'wallet'->>'available'='0','history balance reflects the hold';
  amount:=makeborne_private.restore_payment_lots(u,'pay_usageActual',array['disputed'],'Dispute resolved in merchant favour');
  assert amount=488 and makeborne_private.credit_available(u)=488,'actual restore returns unused funding';
  assert makeborne_private.restore_payment_lots(u,'pay_usageActual',array['disputed'],'Duplicate')=0,'duplicate restore is inert';
  set local role authenticated;
  result:=public.makeborne_usage_history(start_,end_,null,null,100);
  reset role;
  assert (result->'period'->>'used')::bigint=12 and (result->'period'->>'total')::int=3,'charge, withhold and restore remain separate';
  assert (select count(*) from jsonb_array_elements(result->'entries') e where e->>'status'='Restored' and e->>'credits'='488')=1,'real restore appears once';
  assert result->'wallet'->>'available'='488','history balance reconciles after restoration';
  assert (select sum(delta) from public.credit_ledger where user_id=u)=makeborne_private.credit_available(u),'funding ledger reconciles';
  assert result::text not like '%pay_usageActual%','provider identity is not disclosed';
  raise notice 'PASS C3 real withhold/restore -> usage: exact amounts, idempotency, unchanged used total, wallet reconciliation and private payment ID';
end $$;
rollback;
