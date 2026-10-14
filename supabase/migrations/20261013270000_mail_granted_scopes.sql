-- CLI-generated, sequenced after the current mail security correction.
-- Empty means unknown/no recorded grant. Never infer scopes for old mailboxes.
begin;
create function makeborne_private.valid_mail_granted_scopes(scopes text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select scopes is not null and cardinality(scopes)<=32
    and (cardinality(scopes)=0 or (array_ndims(scopes)=1 and array_lower(scopes,1)=1))
    and not exists(select 1 from unnest(scopes) scope
      where scope is null or scope collate "C" !~ '^[A-Za-z0-9][A-Za-z0-9:/._-]{0,199}$')
    and cardinality(scopes)=(select count(distinct scope collate "C") from unnest(scopes) scope);
$$;
alter function makeborne_private.valid_mail_granted_scopes(text[]) owner to postgres;
revoke all on function makeborne_private.valid_mail_granted_scopes(text[]) from public,anon,authenticated,service_role;
grant execute on function makeborne_private.valid_mail_granted_scopes(text[]) to service_role;

-- The table already allows member reads and only server writes. Do not grant
-- any browser writes: provider-observed grants are server-owned evidence.
alter table public.mail_accounts add column granted_scopes text[] not null default '{}'
  constraint mail_accounts_granted_scopes_check check(makeborne_private.valid_mail_granted_scopes(granted_scopes));
commit;
