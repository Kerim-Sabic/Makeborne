-- Additive evidence only. Does not open sales or change credits/plan prices.
begin;
create table makeborne_private.checkout_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check(kind in ('plan','pack')),
  version text not null check(length(version) between 1 and 80),
  terms_version text not null check(length(terms_version) between 1 and 80),
  consent_text text not null check(length(consent_text) between 1 and 2000),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(user_id,kind,request_id,version)
);
alter table makeborne_private.checkout_consents enable row level security;
revoke all on makeborne_private.checkout_consents from public,anon,authenticated,service_role;
comment on table makeborne_private.checkout_consents is 'Server-timed immediate-performance request, text/version snapshot and actual checkout/order request binding. No IP or user agent. Not a waiver of statutory rights; purchase confirmation is a separate obligation.';

create function makeborne_rpc.makeborne_record_checkout_consent(
  p_user uuid,p_request uuid,p_kind text,p_version text,p_terms text,p_text text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_existing makeborne_private.checkout_consents;
begin
  if p_user is null or p_request is null or p_kind is null or p_kind not in ('plan','pack')
    or p_version is null or length(p_version) not between 1 and 80
    or p_terms is null or length(p_terms) not between 1 and 80
    or p_text is null or length(p_text) not between 1 and 2000 then
    raise exception 'Invalid checkout consent' using errcode='22023';
  end if;
  if (p_kind='plan' and not exists(select 1 from public.billing_checkouts where user_id=p_user and request_id=p_request))
    or (p_kind='pack' and not exists(select 1 from makeborne_private.topup_orders where user_id=p_user and request_id=p_request)) then
    raise exception 'Checkout consent is not bound to an owned order' using errcode='42501';
  end if;
  insert into makeborne_private.checkout_consents(user_id,request_id,kind,version,terms_version,consent_text)
    values(p_user,p_request,p_kind,p_version,p_terms,p_text) on conflict do nothing;
  select * into strict v_existing from makeborne_private.checkout_consents
    where user_id=p_user and request_id=p_request and kind=p_kind and version=p_version;
  if v_existing.terms_version<>p_terms or v_existing.consent_text<>p_text then
    raise exception 'Checkout consent version cannot change its meaning' using errcode='22023';
  end if;
  return true;
end $$;
revoke all on function makeborne_rpc.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text) to service_role;
create function public.makeborne_record_checkout_consent(
  p_user uuid,p_request uuid,p_kind text,p_version text,p_terms text,p_text text
) returns boolean language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_record_checkout_consent(p_user,p_request,p_kind,p_version,p_terms,p_text)
$$;
revoke all on function public.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_record_checkout_consent(uuid,uuid,text,text,text,text) to service_role;

create function makeborne_rpc.makeborne_prepare_consented_checkout(
  p_user uuid,p_request uuid,p_plan text,p_return text,p_version text,p_terms text,p_text text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into public.billing_checkouts(request_id,user_id,plan_id,return_path,status)
    values(p_request,p_user,p_plan,p_return,'pending');
  -- The existing financial/duplicate triggers still run before consent. Either
  -- both writes commit, or neither does; no external provider call in SQL.
  return makeborne_rpc.makeborne_record_checkout_consent(p_user,p_request,'plan',p_version,p_terms,p_text);
end $$;
revoke all on function makeborne_rpc.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text) to service_role;
create function public.makeborne_prepare_consented_checkout(
  p_user uuid,p_request uuid,p_plan text,p_return text,p_version text,p_terms text,p_text text
) returns boolean language sql security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_prepare_consented_checkout(p_user,p_request,p_plan,p_return,p_version,p_terms,p_text)
$$;
revoke all on function public.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_prepare_consented_checkout(uuid,uuid,text,text,text,text,text) to service_role;

-- Account export extension: preserve the original implementation unchanged in
-- the unexposed schema. Only the new consent source is handled here; every
-- existing source still calls the exact previous function, including its bounds.
alter function public.makeborne_account_export_rows(uuid,text,integer,integer) set schema makeborne_rpc;
alter function makeborne_rpc.makeborne_account_export_rows(uuid,text,integer,integer) rename to makeborne_account_export_rows_before_checkout_consent;
create function makeborne_rpc.makeborne_account_export_rows_with_checkout_consent(
  p_user uuid,p_source text,p_offset integer default 0,p_limit integer default 500
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_user is null then raise exception 'Account required' using errcode='22023'; end if;
  case p_source
  when 'checkout_consents' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at,x.request_id,x.kind,x.version),'[]'::jsonb) into result
    from (select request_id,kind,version,terms_version,consent_text,accepted_at from makeborne_private.checkout_consents
      where user_id=p_user order by accepted_at,request_id,kind,version
      offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,500),1),1000)) x;
    return result;
  else
    return makeborne_rpc.makeborne_account_export_rows_before_checkout_consent(p_user,p_source,p_offset,p_limit);
  end case;
end $$;
revoke all on function makeborne_rpc.makeborne_account_export_rows_with_checkout_consent(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function makeborne_rpc.makeborne_account_export_rows_with_checkout_consent(uuid,text,integer,integer) to service_role;
create function public.makeborne_account_export_rows(p_user uuid,p_source text,p_offset integer default 0,p_limit integer default 500)
returns jsonb language sql stable security invoker set search_path='' as $$
  select makeborne_rpc.makeborne_account_export_rows_with_checkout_consent(p_user,p_source,p_offset,p_limit)
$$;
revoke all on function public.makeborne_account_export_rows(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.makeborne_account_export_rows(uuid,text,integer,integer) to service_role;
commit;
