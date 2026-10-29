-- Forward boundary repair for the combined staging candidate. Preserve the
-- existing CAS/body/auth.uid() checks; only move privileged execution off the
-- API-exposed schema. No feature activation, data rewrite or grant widening.
begin;
alter function public.makeborne_crm_next_step_set(uuid,uuid,text,integer) set schema makeborne_rpc;
revoke all on function makeborne_rpc.makeborne_crm_next_step_set(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_crm_next_step_set(uuid,uuid,text,integer) to authenticated,service_role;
create function public.makeborne_crm_next_step_set(p_workspace uuid,p_client uuid,p_text text,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_crm_next_step_set(p_workspace,p_client,p_text,p_expected_revision)
$$;
revoke all on function public.makeborne_crm_next_step_set(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_crm_next_step_set(uuid,uuid,text,integer) to authenticated,service_role;
comment on function public.makeborne_crm_next_step_set(uuid,uuid,text,integer) is 'Invoker wrapper; privileged next-step CAS remains in unexposed makeborne_rpc with unchanged editor and client ownership checks.';
commit;
