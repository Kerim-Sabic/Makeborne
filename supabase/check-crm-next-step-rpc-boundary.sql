\set ON_ERROR_STOP on
begin;
do $$ declare f text; begin
  assert not (select prosecdef from pg_proc where oid='public.makeborne_crm_next_step_set(uuid,uuid,text,integer)'::regprocedure);
  assert (select prosecdef from pg_proc where oid='makeborne_rpc.makeborne_crm_next_step_set(uuid,uuid,text,integer)'::regprocedure);
  foreach f in array array['public.makeborne_crm_next_step_set(uuid,uuid,text,integer)','makeborne_rpc.makeborne_crm_next_step_set(uuid,uuid,text,integer)'] loop
    assert not has_function_privilege('anon',f,'execute');
    assert has_function_privilege('authenticated',f,'execute');
    assert has_function_privilege('service_role',f,'execute');
  end loop;
  begin
    perform public.makeborne_crm_next_step_set(gen_random_uuid(),gen_random_uuid(),'Untrusted',0);
    raise exception 'Expected session-bound refusal';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS next-step unexposed definer, public invoker, unchanged callers and missing-session refusal';
end $$;
rollback;
