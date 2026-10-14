\set ON_ERROR_STOP on
begin;
do $$
declare result jsonb; role_name text;
begin
  if current_database()<>'rehearsal' then raise exception 'Disposable rehearsal required'; end if;
  foreach role_name in array array['anon','makeborne_publication_worker'] loop
    assert not has_function_privilege(role_name,'makeborne_private.valid_lead_tags(text[])','EXECUTE');
  end loop;
  assert has_function_privilege('authenticated','makeborne_private.valid_lead_tags(text[])','EXECUTE');
  assert has_function_privilege('service_role','makeborne_private.valid_lead_tags(text[])','EXECUTE');
  set local role authenticated;
  assert makeborne_private.valid_lead_tags(array['agency','website']);
  assert not makeborne_private.valid_lead_tags(array['<invalid>']);
  reset role;
  raise notice 'PASS lead validation stays available to authorized client writers without publication access';
  set local role makeborne_publication_worker;
  result:=public.makeborne_publication_worker_attest();
  assert result->>'contractVersion'='publication-controller-v1';
  begin
    perform makeborne_private.valid_lead_tags(array['agency']);
    raise exception 'Publication role can execute unrelated helper';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS actual publication attestation succeeds with final mail/lead schema and rejects unrelated helper';
end $$;
rollback;
