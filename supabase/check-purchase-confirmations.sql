\set ON_ERROR_STOP on
-- Purchase confirmations, withdrawal notices and the outbox (20261028100000). Ends with rollback.
begin;
do $$
declare
  u uuid := gen_random_uuid(); other uuid := gen_random_uuid(); req uuid := gen_random_uuid(); pack_req uuid := gen_random_uuid(); old_req uuid := gen_random_uuid();
  conf uuid; again uuid; c jsonb; mail jsonb; outcome text; w jsonb; order_id uuid := gen_random_uuid();
  consent text := 'I want my plan to start immediately. Exact displayed text.';
begin
  insert into auth.users(id, email, email_confirmed_at) values (u, 'Buyer@Example.invalid', now()), (other, 'other@example.invalid', now());
  insert into public.billing_checkouts(request_id, user_id, plan_id, checkout_id, return_path, status) values
    (req, u, 'plan_confirm', 'ch_Confirm1', '/studio', 'ready'), (old_req, u, 'plan_confirm', 'ch_Old1', '/studio', 'ready');
  insert into makeborne_private.checkout_consents(user_id, request_id, kind, version, terms_version, consent_text) values (u, req, 'plan', 'consent-v1', 'terms-v1', consent);
  insert into public.billing_memberships(membership_id, user_id, checkout_id, whop_user_id, plan_id, status) values
    ('mem_Confirm1', u, 'ch_Confirm1', 'user_Fixture1', 'plan_confirm', 'active'), ('mem_Old1', u, 'ch_Old1', 'user_Fixture1', 'plan_confirm', 'active');
  insert into makeborne_private.plan_payments(payment_id, user_id, membership_id, plan_id, billing_reason, currency, principal_cents, refunded_cents, dispute, paid_at, state, evidence, observed_at) values
    ('pay_First1', u, 'mem_Confirm1', 'plan_confirm', 'subscription_create', 'usd', 4900, 0, 'none', '2026-10-29T20:04:00Z', 'funded', '{}', now()),
    ('pay_Renew1', u, 'mem_Confirm1', 'plan_confirm', 'subscription_cycle', 'usd', 4900, 0, 'none', '2026-11-29T20:04:00Z', 'funded', '{}', now()),
    ('pay_Before1', u, 'mem_Old1', 'plan_confirm', 'subscription_create', 'usd', 2900, 0, 'none', '2026-10-01T10:00:00Z', 'funded', '{}', now());
  insert into makeborne_private.topup_orders(id, user_id, request_id, pack_id, catalog_version, credits, price_cents, merchant_id, plan_id, whop_user_id, checkout_id, payment_id, state, granted, evidence, observed_at)
    values (order_id, u, pack_req, 'boost_300', 'v1', 300, 3200, 'biz_Fixture1', 'plan_pack', 'user_Fixture1', 'ch_Pack1', 'pay_Pack1', 'funded', true, '{"principalCents":"3200"}', '2026-10-30T09:00:00Z');

  c := public.makeborne_purchase_confirmation_candidates(null);
  assert jsonb_array_length(c) = 0, 'No start time: nothing is due';
  c := public.makeborne_purchase_confirmation_candidates('2026-10-29T20:00:00Z');
  assert jsonb_array_length(c) = 2, 'First plan payment and the pack; not the renewal, not the earlier purchase';
  assert (select array_agg(x->>'payment_id' order by x->>'payment_id') from jsonb_array_elements(c) x) = array['pay_First1', 'pay_Pack1'];
  assert (c->0->>'consent_text') = consent and (c->0->>'recipient') = 'Buyer@Example.invalid', 'Consent snapshot and recipient come from storage';

  begin
    perform public.makeborne_record_purchase_confirmation('pay_First1', 'Studio plan', 'monthly', 750, 'Subject', 'Body without the reference or the request');
    raise exception 'Expected a refusal of text that does not quote the evidence';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.makeborne_record_purchase_confirmation('pay_Renew1', 'Studio plan', 'monthly', 750, 'Subject', 'pay_Renew1 ' || consent);
    raise exception 'Expected a refusal: renewals are not new contracts';
  exception when invalid_parameter_value then null; end;
  conf := public.makeborne_record_purchase_confirmation('pay_First1', 'Studio plan', 'monthly', 750, 'Subject', 'Ref pay_First1. "' || consent || '"');
  again := public.makeborne_record_purchase_confirmation('pay_First1', 'Studio plan', 'monthly', 750, 'Changed subject', 'Other pay_First1 ' || consent);
  assert conf = again, 'Replays return the first record';
  assert (select count(*) from makeborne_private.purchase_confirmations where payment_id = 'pay_First1') = 1;
  assert (select subject from makeborne_private.purchase_confirmations where id = conf) = 'Subject', 'The first text stays';
  assert (select amount_cents = 4900 and consent_text = consent and consent_version = 'consent-v1' and terms_version = 'terms-v1' from makeborne_private.purchase_confirmations where id = conf);
  assert (select count(*) from makeborne_private.transactional_mail where confirmation_id = conf and status = 'pending' and idempotency_key = 'purchase-confirmation:pay_First1') = 1;
  begin
    update makeborne_private.purchase_confirmations set body = 'tampered' where id = conf;
    raise exception 'Expected immutability';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.makeborne_record_purchase_confirmation('pay_Pack1', 'Credit pack', null, 999, 'Subject', 'pay_Pack1');
    raise exception 'Expected the pack credits to match the order';
  exception when invalid_parameter_value then null; end;
  assert public.makeborne_record_purchase_confirmation('pay_Pack1', 'Credit pack', null, 300, 'Subject', 'pay_Pack1, no request on record') is not null, 'A pack without a recorded request is confirmed with null consent';
  assert jsonb_array_length(public.makeborne_purchase_confirmation_candidates('2026-10-29T20:00:00Z')) = 0, 'Confirmed payments are no longer due';

  -- Outbox: claim, fail with backoff, claim again only when due, send once.
  mail := public.makeborne_transactional_mail_claim(10, 60);
  assert jsonb_array_length(mail) = 2;
  assert jsonb_array_length(public.makeborne_transactional_mail_claim(10, 60)) = 0, 'A lease hides claimed rows';
  outcome := public.makeborne_transactional_mail_result((mail->0->>'id')::uuid, false, null, 'MAIL_RATE_LIMITED');
  assert outcome = 'pending';
  assert (select next_attempt_at > clock_timestamp() and attempts = 1 and lease_until is null from makeborne_private.transactional_mail where id = (mail->0->>'id')::uuid), 'Backoff before the next attempt';
  outcome := public.makeborne_transactional_mail_result((mail->1->>'id')::uuid, true, 'email_123', null);
  assert outcome = 'sent';
  assert public.makeborne_transactional_mail_result((mail->1->>'id')::uuid, true, 'email_123', null) = 'unchanged', 'A sent row is final';
  begin
    update makeborne_private.transactional_mail set status = 'pending', sent_at = null where id = (mail->1->>'id')::uuid;
    raise exception 'Expected sent mail to stay sent';
  exception when object_not_in_prerequisite_state then null; end;
  update makeborne_private.transactional_mail set next_attempt_at = clock_timestamp() - interval '1 second' where id = (mail->0->>'id')::uuid;
  mail := public.makeborne_transactional_mail_claim(10, 60);
  assert jsonb_array_length(mail) = 1 and (mail->0->>'attempts')::int = 2;
  assert public.makeborne_transactional_mail_result((mail->0->>'id')::uuid, false, null, 'MAIL_HTTP_422', true) = 'failed', 'A permanent refusal stops retries';

  -- Withdrawal notices.
  w := public.makeborne_record_withdrawal_request(u, null, 'Ana', null, 'pay_First1', 'I hereby give notice that I withdraw from my contract for Studio.', null,
    'We received your withdrawal notice ({{reference}})', 'Ref {{reference}} at {{received}}');
  assert w->>'acknowledgement' = 'queued' and w->>'reference' ~ '^WD-[0-9A-F]{8}$' and w->>'paymentId' = 'pay_First1';
  assert (select recipient = 'buyer@example.invalid' and subject = 'We received your withdrawal notice (' || (w->>'reference') || ')' and body like 'Ref ' || (w->>'reference') || ' at % UTC'
    from makeborne_private.transactional_mail where withdrawal_id = (w->>'id')::uuid), 'Acknowledgement to the account address with reference and server time';
  begin
    perform public.makeborne_record_withdrawal_request(other, null, null, null, 'pay_First1', 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}');
    raise exception 'Expected another account to be refused';
  exception when insufficient_privilege then null; end;
  w := public.makeborne_record_withdrawal_request(null, 'stranger@example.invalid', null, 'pay_First1', null, 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}');
  assert w->>'acknowledgement' = 'manual', 'A typed address that is not the payer''s gets no automatic mail';
  assert not exists (select 1 from makeborne_private.transactional_mail where withdrawal_id = (w->>'id')::uuid);
  w := public.makeborne_record_withdrawal_request(null, ' BUYER@example.invalid ', null, ' pay_Pack1 ', null, 'I hereby give notice that I withdraw from my contract.', 'Please confirm.', 'S {{reference}}', '{{reference}} {{received}}');
  assert w->>'acknowledgement' = 'queued' and w->>'paymentId' = 'pay_Pack1', 'The payer''s own address is acknowledged';
  w := public.makeborne_record_withdrawal_request(null, 'nobody@example.invalid', null, 'my order from Tuesday', null, 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}');
  assert w->>'acknowledgement' = 'manual' and w->>'paymentId' is null, 'Free-text references are kept for support';
  begin
    perform public.makeborne_record_withdrawal_request(null, 'not-an-email', null, null, null, 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}');
    raise exception 'Expected an invalid address refusal';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.makeborne_record_withdrawal_request(u, null, null, null, null, 'I hereby give notice that I withdraw from my contract.', null, 'S', 'no tokens');
    raise exception 'Expected the acknowledgement template to carry its tokens';
  exception when invalid_parameter_value then null; end;
  perform public.makeborne_record_withdrawal_request(u, null, null, null, null, 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}') from generate_series(1, 3);
  begin
    perform public.makeborne_record_withdrawal_request(u, null, null, null, null, 'I hereby give notice that I withdraw from my contract.', null, 'S {{reference}}', '{{reference}} {{received}}');
    raise exception 'Expected the daily limit';
  exception when sqlstate '53400' then null; end;
  begin
    update makeborne_private.withdrawal_requests set statement = 'changed' where user_id = u;
    raise exception 'Expected immutable notices';
  exception when object_not_in_prerequisite_state then null; end;

  -- Account reads and export; erasure removes everything through the foreign keys.
  c := public.makeborne_account_purchase_records(u);
  assert jsonb_array_length(c->'confirmations') = 2 and jsonb_array_length(c->'withdrawals') = 4 and jsonb_array_length(c->'payments') = 4;
  assert jsonb_array_length(public.makeborne_account_purchase_records(other)->'confirmations') = 0;
  assert jsonb_array_length(public.makeborne_account_export_rows(u, 'purchase_confirmations')) = 2;
  assert jsonb_array_length(public.makeborne_account_export_rows(u, 'withdrawal_requests')) = 4;
  assert jsonb_array_length(public.makeborne_account_export_rows(u, 'purchase_confirmations', 1, 1)) = 1, 'Bounded pagination';
  assert public.makeborne_account_export_rows(u, 'checkout_consents') is not null, 'Existing sources still answer';
  delete from public.billing_memberships where user_id = u;
  delete from public.billing_checkouts where user_id = u;
  delete from makeborne_private.plan_payments where user_id = u;
  delete from makeborne_private.topup_orders where user_id = u;
  delete from auth.users where id = u;
  assert not exists (select 1 from makeborne_private.purchase_confirmations where user_id = u);
  assert not exists (select 1 from makeborne_private.withdrawal_requests where user_id = u);
  assert not exists (select 1 from makeborne_private.transactional_mail m where m.confirmation_id is not null and not exists (select 1 from makeborne_private.purchase_confirmations c2 where c2.id = m.confirmation_id));
  raise notice 'PASS confirmations: due set, evidence binding, immutable first text, outbox lease/backoff/final, notices, throttle, export and erasure';
end $$;
do $$
declare f text;
begin
  foreach f in array array['public.makeborne_purchase_confirmation_candidates(timestamptz,text,integer)', 'public.makeborne_record_purchase_confirmation(text,text,text,bigint,text,text)',
    'public.makeborne_record_withdrawal_request(uuid,text,text,text,text,text,text,text,text)', 'public.makeborne_transactional_mail_claim(integer,integer)',
    'public.makeborne_transactional_mail_result(uuid,boolean,text,text,boolean)', 'public.makeborne_account_purchase_records(uuid)', 'public.makeborne_admin_legal_requests(uuid)',
    'makeborne_rpc.makeborne_record_withdrawal_request(uuid,text,text,text,text,text,text,text,text)', 'makeborne_rpc.makeborne_transactional_mail_claim(integer,integer)'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), f;
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), f;
    assert has_function_privilege('service_role', f, 'EXECUTE'), f;
  end loop;
  assert not has_table_privilege('authenticated', 'makeborne_private.purchase_confirmations', 'SELECT');
  assert not has_table_privilege('service_role', 'makeborne_private.transactional_mail', 'SELECT'), 'Service role reaches the outbox only through functions';
  assert (select prosecdef from pg_proc where oid = 'public.makeborne_record_withdrawal_request(uuid,text,text,text,text,text,text,text,text)'::regprocedure) = false, 'Public wrappers are SECURITY INVOKER';
  begin
    perform public.makeborne_admin_legal_requests(gen_random_uuid());
    raise exception 'Expected a non-administrator refusal';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS grants: service role only, invoker wrappers, admin read refused to non-administrators';
end $$;
rollback;
