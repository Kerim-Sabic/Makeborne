-- First-party error tracking and studio funnel analytics (no third-party vendor, no cookies).
-- * Errors: server (Next onRequestError) and browser (client instrumentation, error pages)
--   errors are grouped by a fingerprint the app computes from source, kind, a scrubbed
--   message and the route pattern. Only scrubbed text is stored: the app removes emails,
--   ids and long tokens first, and the database caps every field again.
-- * Visits: a page view of an allow-listed studio page counts once per visitor per day.
--   The visitor is a SHA-256 of a daily random salt + IP + user agent computed here; the
--   salt is deleted after two days, so stored hashes cannot be linked to people or days.
-- * Funnel: computed from existing records (sign-ups, projects, AI runs, review links,
--   live sites, memberships) for the admin console; nothing new is collected for it.
-- Everything lives in makeborne_private (not API-exposed). The three public functions are
-- SECURITY DEFINER but executable by service_role only (the app server), like the admin console.
begin;

create table makeborne_private.app_error_groups (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('server', 'client')),
  kind text not null check (char_length(kind) between 1 and 60),
  message text not null check (char_length(message) <= 300),
  route text not null check (char_length(route) <= 200),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  total bigint not null default 1,
  last_release text not null default '' check (char_length(last_release) <= 40)
);
create index app_error_groups_last_seen on makeborne_private.app_error_groups(last_seen desc);
create table makeborne_private.app_error_days (
  fingerprint text not null references makeborne_private.app_error_groups(fingerprint) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (fingerprint, day)
);
create table makeborne_private.telemetry_salts (
  day date primary key,
  salt bytea not null check (octet_length(salt) = 32)
);
create table makeborne_private.studio_visits (
  day date not null,
  page text not null check (page in ('home', 'pricing', 'login', 'studio', 'portal', 'help')),
  visitor bytea not null check (octet_length(visitor) = 32),
  primary key (day, page, visitor)
);
revoke all on makeborne_private.app_error_groups, makeborne_private.app_error_days, makeborne_private.telemetry_salts,
  makeborne_private.studio_visits from public, anon, authenticated, service_role;

-- Records one error occurrence. New groups are capped at 300 per day; past that, occurrences
-- count into one overflow group so a flood of distinct messages cannot grow the table.
create or replace function public.makeborne_record_app_error(p_fingerprint text, p_source text, p_kind text, p_message text, p_route text, p_release text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare v_day date := (now() at time zone 'utc')::date; v_fp text := lower(coalesce(p_fingerprint, ''));
  v_kind text := left(coalesce(nullif(btrim(p_kind), ''), 'Error'), 60); v_message text := left(coalesce(p_message, ''), 300);
  v_route text := left(coalesce(p_route, ''), 200);
begin
  if v_fp !~ '^[0-9a-f]{64}$' or p_source is null or p_source not in ('server', 'client') then raise exception 'Invalid error report' using errcode='22023'; end if;
  if not exists(select 1 from makeborne_private.app_error_groups where fingerprint = v_fp)
    and (select count(*) from makeborne_private.app_error_groups where first_seen >= v_day) >= 300 then
    v_fp := encode(extensions.digest('makeborne-error-overflow:' || p_source, 'sha256'), 'hex');
    v_kind := 'Overflow'; v_message := 'More than 300 new kinds of error today; extra kinds are counted here.'; v_route := '';
  end if;
  insert into makeborne_private.app_error_groups(fingerprint, source, kind, message, route, last_release)
  values(v_fp, p_source, v_kind, v_message, v_route, left(coalesce(p_release, ''), 40))
  on conflict (fingerprint) do update set last_seen = now(), total = makeborne_private.app_error_groups.total + 1,
    last_release = excluded.last_release;
  insert into makeborne_private.app_error_days(fingerprint, day, count) values(v_fp, v_day, 1)
  on conflict (fingerprint, day) do update set count = makeborne_private.app_error_days.count + 1;
end $$;

-- Counts a visit to an allow-listed page. Hashing happens here with the day's salt.
create or replace function public.makeborne_record_studio_visit(p_page text, p_ip text, p_user_agent text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare v_day date := (now() at time zone 'utc')::date; v_salt bytea;
begin
  if p_page is null or p_page not in ('home', 'pricing', 'login', 'studio', 'portal', 'help') then raise exception 'Invalid page' using errcode='22023'; end if;
  insert into makeborne_private.telemetry_salts(day, salt) values(v_day, extensions.gen_random_bytes(32)) on conflict (day) do nothing;
  select salt into v_salt from makeborne_private.telemetry_salts where day = v_day;
  insert into makeborne_private.studio_visits(day, page, visitor)
  values(v_day, p_page, extensions.digest(v_salt || convert_to(left(coalesce(p_ip, ''), 64) || '|' || left(coalesce(p_user_agent, ''), 300), 'UTF8'), 'sha256'))
  on conflict do nothing;
  -- Retention: salts for two days, visits and error days for 400 days (opportunistic, cheap).
  delete from makeborne_private.telemetry_salts where day < v_day - 1;
  if random() < 0.01 then
    delete from makeborne_private.studio_visits where day < v_day - 400;
    delete from makeborne_private.app_error_days where day < v_day - 400;
    delete from makeborne_private.app_error_groups where last_seen < now() - interval '400 days';
  end if;
end $$;

-- Admin console: errors, visits and the studio funnel for the last p_days (1-90).
-- Funnel cohort = accounts created in the window; each later step counts accounts of that
-- cohort that ever reached it.
create or replace function public.makeborne_admin_health(p_actor uuid, p_days integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_days integer := least(90, greatest(1, coalesce(p_days, 7))); v_from timestamptz; v_day date := (now() at time zone 'utc')::date;
begin
  perform makeborne_private.require_admin(p_actor);
  v_from := now() - make_interval(days => v_days);
  return jsonb_build_object(
    'generatedAt', now(), 'days', v_days,
    'errors', jsonb_build_object(
      'last24h', (select coalesce(sum(d.count), 0) from makeborne_private.app_error_days d where d.day >= v_day - 1),
      'window', (select coalesce(sum(d.count), 0) from makeborne_private.app_error_days d where d.day > v_day - v_days),
      'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'server', x.server, 'client', x.client) order by x.day) from (
        select d.day, sum(d.count) filter (where g.source = 'server') as server, sum(d.count) filter (where g.source = 'client') as client
        from makeborne_private.app_error_days d join makeborne_private.app_error_groups g using (fingerprint)
        where d.day > v_day - v_days group by d.day) x), '[]'::jsonb),
      'top', coalesce((select jsonb_agg(jsonb_build_object('fingerprint', left(g.fingerprint, 12), 'source', g.source, 'kind', g.kind, 'message', g.message,
          'route', g.route, 'count', w.n, 'total', g.total, 'firstSeen', g.first_seen, 'lastSeen', g.last_seen, 'release', g.last_release) order by w.n desc, g.last_seen desc)
        from (select fingerprint, sum(count) as n from makeborne_private.app_error_days where day > v_day - v_days group by fingerprint order by sum(count) desc limit 25) w
        join makeborne_private.app_error_groups g using (fingerprint)), '[]'::jsonb)),
    'visits', coalesce((select jsonb_object_agg(page, n) from (select page, count(*) as n from makeborne_private.studio_visits where day > v_day - v_days group by page) v), '{}'::jsonb),
    'funnel', (select jsonb_build_object(
        'signedUp', count(*),
        'confirmed', count(*) filter (where u.email_confirmed_at is not null),
        'createdProject', count(*) filter (where exists(select 1 from public.artifacts a join public.workspaces w on w.id = a.workspace_id where w.owner_id = u.id)),
        'ranBuild', count(*) filter (where exists(select 1 from makeborne_private.ai_run_outcomes r where r.user_id = u.id and r.charged_credits + r.absorbed_credits > 0)),
        'sharedReview', count(*) filter (where exists(select 1 from public.client_review_links l where l.created_by = u.id)),
        'published', count(*) filter (where exists(select 1 from public.hosted_sites h where h.owner_id = u.id and h.live)),
        'paid', count(*) filter (where exists(select 1 from public.billing_memberships m where m.user_id = u.id)))
      from auth.users u where u.created_at >= v_from),
    'signupsByDay', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'count', s.n) order by s.day) from (
      select (u.created_at at time zone 'utc')::date as day, count(*) as n from auth.users u where u.created_at >= v_from group by 1) s), '[]'::jsonb));
end $$;

revoke all on function public.makeborne_record_app_error(text, text, text, text, text, text), public.makeborne_record_studio_visit(text, text, text),
  public.makeborne_admin_health(uuid, integer) from public, anon, authenticated;
grant execute on function public.makeborne_record_app_error(text, text, text, text, text, text), public.makeborne_record_studio_visit(text, text, text),
  public.makeborne_admin_health(uuid, integer) to service_role;
commit;
