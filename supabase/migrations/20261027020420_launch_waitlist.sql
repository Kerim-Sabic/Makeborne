-- Launch waitlist: addresses people leave on the launch screen, used only for one launch invite and launch news.
-- Additive (one table, five functions). The table lives in the non-exposed makeborne_private schema with row level security on and no policies,
-- and no role but the owner has table privileges. service_role reaches it only through SECURITY DEFINER functions
-- with an empty search_path, behind public security-invoker wrappers (the 20261017 rpc_definer_boundary pattern),
-- and none of them is executable by anon or authenticated.
-- Emails are stored trimmed and lower-cased (checked below), so the unique constraint is case-insensitive without
-- adding the citext extension. No raw IP or browser string is stored: only keyed SHA-256 hashes made by the app.
begin;

create table makeborne_private.launch_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default clock_timestamp(),
  source text,
  consent_text_version text not null,
  ip_hash text not null,
  user_agent_hash text,
  invited_at timestamptz,
  unsubscribed_at timestamptz,
  constraint launch_waitlist_email_unique unique (email),
  constraint launch_waitlist_email_shape check (
    length(email) between 6 and 254 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint launch_waitlist_source_shape check (
    source is null or (length(source) <= 200 and source ~ '^(utm_source|utm_medium|utm_campaign|ref)=[A-Za-z0-9._~-]{1,48}(;(utm_source|utm_medium|utm_campaign|ref)=[A-Za-z0-9._~-]{1,48}){0,3}$')),
  constraint launch_waitlist_consent_shape check (consent_text_version ~ '^waitlist-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint launch_waitlist_ip_hash_shape check (ip_hash ~ '^[0-9a-f]{64}$'),
  constraint launch_waitlist_user_agent_hash_shape check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$')
);
comment on table makeborne_private.launch_waitlist is 'Launch waitlist. Used only for the launch invite and launch news; delete 90 days after launch or on request. Reached only through makeborne_private waitlist functions (service_role).';
create index launch_waitlist_source_recent on makeborne_private.launch_waitlist (ip_hash, created_at desc);
create index launch_waitlist_pending on makeborne_private.launch_waitlist (created_at, id) where invited_at is null and unsubscribed_at is null;
alter table makeborne_private.launch_waitlist enable row level security;
revoke all on table makeborne_private.launch_waitlist from public, anon, authenticated, service_role;

-- Join: validates, rate-limits per keyed IP hash, then inserts once. The limit is checked first and the answer is the
-- same for new and existing addresses, so the result never reveals whether an address is already on the list.
-- Re-joining never changes an existing row (it does not undo an unsubscribe).
create function makeborne_private.join_launch_waitlist(p_email text, p_source text, p_consent text, p_ip_hash text, p_user_agent_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email));
begin
  if v_email is null or length(v_email) not between 6 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_consent is null or p_consent !~ '^waitlist-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or (p_user_agent_hash is not null and p_user_agent_hash !~ '^[0-9a-f]{64}$')
     or (p_source is not null and (length(p_source) > 200 or p_source !~ '^(utm_source|utm_medium|utm_campaign|ref)=[A-Za-z0-9._~-]{1,48}(;(utm_source|utm_medium|utm_campaign|ref)=[A-Za-z0-9._~-]{1,48}){0,3}$')) then
    raise exception 'Invalid waitlist entry' using errcode = '22023';
  end if;
  if (select count(*) from makeborne_private.launch_waitlist w where w.ip_hash = p_ip_hash and w.created_at > clock_timestamp() - interval '10 minutes') >= 5
     or (select count(*) from makeborne_private.launch_waitlist w where w.created_at > clock_timestamp() - interval '1 hour') >= 5000 then
    raise exception 'Waitlist limit' using errcode = 'MB429';
  end if;
  insert into makeborne_private.launch_waitlist (email, source, consent_text_version, ip_hash, user_agent_hash)
  values (v_email, p_source, p_consent, p_ip_hash, p_user_agent_hash)
  on conflict (email) do nothing;
  return jsonb_build_object('accepted', true);
end $$;

-- Invite export: addresses not yet invited and not unsubscribed, oldest first.
create function makeborne_private.launch_waitlist_pending(p_limit integer)
returns table (id uuid, email text, created_at timestamptz) language sql stable security definer set search_path = '' as $$
  select w.id, w.email, w.created_at from makeborne_private.launch_waitlist w
  where w.invited_at is null and w.unsubscribed_at is null
  order by w.created_at, w.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 10000)
$$;

-- After the owner has sent the invites: mark exactly those rows. Unsubscribed or already invited rows are left alone.
create function makeborne_private.mark_launch_waitlist_invited(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 10000 then
    raise exception 'Invalid invite batch' using errcode = '22023';
  end if;
  update makeborne_private.launch_waitlist w set invited_at = clock_timestamp()
  where w.id = any(p_ids) and w.invited_at is null and w.unsubscribed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Social proof on the launch screen: how many people are on the list (not unsubscribed). A number only, never rows.
create function makeborne_private.launch_waitlist_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from makeborne_private.launch_waitlist w where w.unsubscribed_at is null
$$;

-- Unsubscribe from a signed link (the app verifies the signature). Same answer whether or not the id exists.
create function makeborne_private.unsubscribe_launch_waitlist(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null then raise exception 'Invalid unsubscribe' using errcode = '22023'; end if;
  update makeborne_private.launch_waitlist w set unsubscribed_at = coalesce(w.unsubscribed_at, clock_timestamp()) where w.id = p_id;
  return jsonb_build_object('unsubscribed', true);
end $$;

revoke all on function makeborne_private.join_launch_waitlist(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function makeborne_private.launch_waitlist_pending(integer) from public, anon, authenticated, service_role;
revoke all on function makeborne_private.mark_launch_waitlist_invited(uuid[]) from public, anon, authenticated, service_role;
revoke all on function makeborne_private.unsubscribe_launch_waitlist(uuid) from public, anon, authenticated, service_role;
revoke all on function makeborne_private.launch_waitlist_count() from public, anon, authenticated, service_role;
grant execute on function makeborne_private.join_launch_waitlist(text, text, text, text, text) to service_role;
grant execute on function makeborne_private.launch_waitlist_pending(integer) to service_role;
grant execute on function makeborne_private.mark_launch_waitlist_invited(uuid[]) to service_role;
grant execute on function makeborne_private.unsubscribe_launch_waitlist(uuid) to service_role;
grant execute on function makeborne_private.launch_waitlist_count() to service_role;

-- API-visible wrappers: security invoker, service_role only.
create function public.makeborne_join_launch_waitlist(p_email text, p_source text, p_consent text, p_ip_hash text, p_user_agent_hash text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select makeborne_private.join_launch_waitlist(p_email, p_source, p_consent, p_ip_hash, p_user_agent_hash)
$$;
create function public.makeborne_launch_waitlist_pending(p_limit integer)
returns table (id uuid, email text, created_at timestamptz) language sql stable security invoker set search_path = '' as $$
  select * from makeborne_private.launch_waitlist_pending(p_limit)
$$;
create function public.makeborne_mark_launch_waitlist_invited(p_ids uuid[])
returns integer language sql volatile security invoker set search_path = '' as $$
  select makeborne_private.mark_launch_waitlist_invited(p_ids)
$$;
create function public.makeborne_launch_waitlist_count()
returns integer language sql stable security invoker set search_path = '' as $$
  select makeborne_private.launch_waitlist_count()
$$;
create function public.makeborne_unsubscribe_launch_waitlist(p_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select makeborne_private.unsubscribe_launch_waitlist(p_id)
$$;
revoke all on function public.makeborne_join_launch_waitlist(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.makeborne_launch_waitlist_pending(integer) from public, anon, authenticated;
revoke all on function public.makeborne_mark_launch_waitlist_invited(uuid[]) from public, anon, authenticated;
revoke all on function public.makeborne_unsubscribe_launch_waitlist(uuid) from public, anon, authenticated;
revoke all on function public.makeborne_launch_waitlist_count() from public, anon, authenticated;
grant execute on function public.makeborne_join_launch_waitlist(text, text, text, text, text) to service_role;
grant execute on function public.makeborne_launch_waitlist_pending(integer) to service_role;
grant execute on function public.makeborne_mark_launch_waitlist_invited(uuid[]) to service_role;
grant execute on function public.makeborne_unsubscribe_launch_waitlist(uuid) to service_role;
grant execute on function public.makeborne_launch_waitlist_count() to service_role;

commit;
