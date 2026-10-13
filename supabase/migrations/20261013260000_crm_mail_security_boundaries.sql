-- CLI-generated and sequenced after the applied email/lead additions.
-- Existing RPC signatures remain compatible. Invalid existing tenant bindings
-- or tag arrays abort the transaction; no customer data is silently repaired.
begin;

create function makeborne_private.mail_token_read(p_account uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('refresh_token',t.refresh_token,'access_token',t.access_token,'access_expires_at',t.access_expires_at)
  from makeborne_private.mail_tokens t where t.account_id=p_account;
$$;
create function makeborne_private.mail_token_write(p_account uuid,p_refresh text,p_access text,p_expires timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_refresh is null then
    update makeborne_private.mail_tokens set access_token=p_access,access_expires_at=p_expires,updated_at=now() where account_id=p_account;
    if not found then raise exception 'Mailbox tokens missing' using errcode='P0002'; end if;
  else
    insert into makeborne_private.mail_tokens(account_id,refresh_token,access_token,access_expires_at,updated_at)
    values(p_account,p_refresh,p_access,p_expires,now())
    on conflict(account_id) do update set refresh_token=excluded.refresh_token,access_token=excluded.access_token,
      access_expires_at=excluded.access_expires_at,updated_at=now();
  end if;
end $$;
create or replace function public.makeborne_mail_token_read(p_account uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select makeborne_private.mail_token_read(p_account);
$$;
create or replace function public.makeborne_mail_token_write(p_account uuid,p_refresh text,p_access text,p_expires timestamptz) returns void
language sql security invoker set search_path = '' as $$
  select makeborne_private.mail_token_write(p_account,p_refresh,p_access,p_expires);
$$;
do $$ declare f text; begin
  foreach f in array array['makeborne_private.mail_token_read(uuid)','makeborne_private.mail_token_write(uuid,text,text,timestamptz)',
    'public.makeborne_mail_token_read(uuid)','public.makeborne_mail_token_write(uuid,text,text,timestamptz)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
alter table makeborne_private.mail_tokens enable row level security;
revoke all on makeborne_private.mail_tokens from public,anon,authenticated,service_role;

-- Composite references also prevent an editor moving a sequence out of the
-- workspace while a server-owned enrollment still points at it.
alter table public.mail_accounts add constraint mail_accounts_id_workspace_key unique(id,workspace_id);
alter table public.mail_sequences add constraint mail_sequences_id_workspace_key unique(id,workspace_id);
alter table public.mail_enrollments
  add constraint mail_enrollments_account_workspace_fk foreign key(account_id,workspace_id)
    references public.mail_accounts(id,workspace_id) on delete cascade,
  add constraint mail_enrollments_sequence_workspace_fk foreign key(sequence_id,workspace_id)
    references public.mail_sequences(id,workspace_id) on delete cascade,
  add constraint mail_enrollments_binding_key unique(id,workspace_id,client_id,account_id);
alter table public.mail_messages
  add constraint mail_messages_account_workspace_fk foreign key(account_id,workspace_id)
    references public.mail_accounts(id,workspace_id) on delete cascade,
  add constraint mail_messages_enrollment_client_check check(enrollment_id is null or client_id is not null),
  add constraint mail_messages_enrollment_binding_fk foreign key(enrollment_id,workspace_id,client_id,account_id)
    references public.mail_enrollments(id,workspace_id,client_id,account_id) on delete set null(enrollment_id);

-- PostgreSQL text[] also accepts matrices and nonstandard lower bounds;
-- browsers and the lead contract expect a flat zero-or-more list.
create or replace function makeborne_private.valid_lead_tags(tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select tags is not null and cardinality(tags)<=12
    and (cardinality(tags)=0 or (array_ndims(tags)=1 and array_lower(tags,1)=1))
    and not exists(select 1 from unnest(tags) tag where tag is null or length(trim(tag)) not between 1 and 30 or tag ~ '[<>\n\r]');
$$;
-- Revalidate existing rows against the tightened helper as well as future writes.
alter table public.clients add constraint clients_tags_flat_check check(makeborne_private.valid_lead_tags(tags));
-- Client updates are granted per column in the production baseline. New lead
-- fields need the same grants; the existing editor-only RLS still decides rows.
grant update(tags,deal_value,deal_currency,lead_source,lead_profile) on public.clients to authenticated;
commit;
