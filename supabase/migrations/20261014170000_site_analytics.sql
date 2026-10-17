-- Privacy-friendly visitor analytics for published customer websites.
-- Additive: no existing table, function or grant changes. The customer-site Worker
-- records one view per successful document response through
-- makeborne_record_site_view() with the publishable key; every call carries an
-- HMAC-SHA256 signature made with a secret shared only by the Worker
-- (ANALYTICS_SIGNING_SECRET) and makeborne_private.site_analytics_key, so the RPC
-- is useless to anyone else. No cookies, no raw IP addresses and no user agents
-- are stored: a visitor is a daily-rotating SHA-256 computed inside the Worker,
-- kept privately for at most three UTC days and only to count unique visitors.
-- Owners read daily totals and breakdowns of their own sites. See
-- docs/SITE_ANALYTICS.md. The operator inserts the secret; none is committed.
begin;

-- Signing secret (one row). No client role, not even service_role, can read it.
create table makeborne_private.site_analytics_key (
 singleton boolean primary key default true check(singleton),
 secret text not null check(length(secret) >= 32)
);
revoke all on makeborne_private.site_analytics_key from public, anon, authenticated, service_role;
comment on table makeborne_private.site_analytics_key is 'Single-row HMAC secret shared with the customer-site Worker (ANALYTICS_SIGNING_SECRET). Inserted by the operator through the release process; never committed and never readable by any client role. Without a row every view is rejected (MB503).';
comment on column makeborne_private.site_analytics_key.singleton is 'Always true; makes the table hold at most one row.';
comment on column makeborne_private.site_analytics_key.secret is 'At least 32 characters; must equal the Worker secret ANALYTICS_SIGNING_SECRET byte for byte.';

-- Daily totals per site.
create table public.site_view_days (
 artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 day date not null,
 views integer not null default 0 check(views >= 0),
 visitors integer not null default 0 check(visitors >= 0),
 primary key(artifact_id, day)
);
create index site_view_days_workspace_day on public.site_view_days(workspace_id, day);
comment on table public.site_view_days is 'Visitor analytics: counted page views and unique visitors per published site per UTC day. Written only by makeborne_record_site_view(); owners read their own workspace rows. Kept 400 days.';
comment on column public.site_view_days.artifact_id is 'Published site (hosted_sites.artifact_id).';
comment on column public.site_view_days.workspace_id is 'Workspace that owns the site when the view was recorded; drives owner-read RLS.';
comment on column public.site_view_days.day is 'UTC day of the Worker request (from the signed stamp).';
comment on column public.site_view_days.views is 'Successful document (HTML) responses counted that day, after bot, prefetch and per-visitor (200/day) filtering.';
comment on column public.site_view_days.visitors is 'Distinct daily visitor hashes that day. The hash rotates every UTC day, so visitors cannot be linked across days and multi-day sums overcount returning visitors.';

-- Daily breakdowns per site.
create table public.site_view_breakdowns (
 artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
 workspace_id uuid not null,
 day date not null,
 dimension text not null check(dimension in ('path','referrer','country','device')),
 value text not null check(length(value) between 1 and 200),
 views integer not null default 0 check(views >= 0),
 primary key(artifact_id, day, dimension, value)
);
create index site_view_breakdowns_workspace_day on public.site_view_breakdowns(workspace_id, day);
comment on table public.site_view_breakdowns is 'Visitor analytics: views per site per UTC day by dimension. At most 300 distinct values per site, day and dimension; later new values are counted as (other). Written only by makeborne_record_site_view(); owners read their own workspace rows. Kept 400 days.';
comment on column public.site_view_breakdowns.artifact_id is 'Published site (hosted_sites.artifact_id).';
comment on column public.site_view_breakdowns.workspace_id is 'Workspace that owns the site when the view was recorded; drives owner-read RLS.';
comment on column public.site_view_breakdowns.day is 'UTC day of the Worker request (from the signed stamp).';
comment on column public.site_view_breakdowns.dimension is 'path (URL path without query or fragment), referrer (external referring hostname), country (ISO 3166-1 alpha-2 from Cloudflare) or device (desktop, mobile, tablet).';
comment on column public.site_view_breakdowns.value is 'Dimension value. Special values: (direct) for no or same-site referrer, (unknown) for no country, (other) once 300 distinct values exist for the day.';
comment on column public.site_view_breakdowns.views is 'Views counted for this value that day.';

-- Daily visitor hashes (private). Only used to count unique visitors and to cap
-- one visitor at 200 counted views per site per day; purged after two days.
create table makeborne_private.site_view_visitors (
 artifact_id uuid not null,
 day date not null,
 visitor text not null check(visitor ~ '^[0-9a-f]{64}$'),
 views integer not null default 0,
 primary key(artifact_id, day, visitor)
);
create index site_view_visitors_day on makeborne_private.site_view_visitors(day);
revoke all on makeborne_private.site_view_visitors from public, anon, authenticated, service_role;
comment on table makeborne_private.site_view_visitors is 'Private visitor analytics working set: one row per daily visitor hash per site per UTC day. The hash is SHA-256 over day, slug, IP address, user agent and the Worker secret, computed in the Worker; neither IP nor user agent reaches the database. Rows older than two days are purged. No client role can read it.';
comment on column makeborne_private.site_view_visitors.artifact_id is 'Published site (hosted_sites.artifact_id). No foreign key: rows are transient and purged by age.';
comment on column makeborne_private.site_view_visitors.day is 'UTC day the hash belongs to.';
comment on column makeborne_private.site_view_visitors.visitor is 'Lowercase hex SHA-256 daily visitor hash (rotates every UTC day).';
comment on column makeborne_private.site_view_visitors.views is 'Views counted for this visitor that day (at most 200).';

-- Owner-read RLS; writes are server-only (the definer function or service_role).
alter table public.site_view_days enable row level security;
alter table public.site_view_breakdowns enable row level security;
revoke all on public.site_view_days from public, anon, authenticated;
revoke all on public.site_view_breakdowns from public, anon, authenticated;
grant select on public.site_view_days to authenticated;
grant select on public.site_view_breakdowns to authenticated;
grant all on public.site_view_days to service_role;
grant all on public.site_view_breakdowns to service_role;
create policy site_view_days_owner_read on public.site_view_days for select to authenticated
 using(exists(select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy site_view_breakdowns_owner_read on public.site_view_breakdowns for select to authenticated
 using(exists(select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

-- Retention. Visitor hashes: rows older than two UTC days, everywhere (indexed by
-- day, so a run with nothing to delete is one index probe). Daily totals and
-- breakdowns: older than 400 days, for one site when p_artifact is given, else for
-- all sites. makeborne_record_site_view() calls it with the site on that site's
-- first counted view of each UTC day; a scheduled call with no argument (pg_cron
-- or the release runbook) also covers sites that stopped receiving views.
create function makeborne_private.purge_site_view_visitors(p_artifact uuid default null)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare today date := (clock_timestamp() at time zone 'utc')::date; removed bigint := 0; n bigint;
begin
 delete from makeborne_private.site_view_visitors where day < today - 2;
 get diagnostics n = row_count; removed := removed + n;
 delete from public.site_view_breakdowns where day < today - 400 and (p_artifact is null or artifact_id = p_artifact);
 get diagnostics n = row_count; removed := removed + n;
 delete from public.site_view_days where day < today - 400 and (p_artifact is null or artifact_id = p_artifact);
 get diagnostics n = row_count; removed := removed + n;
 return removed;
end $$;
revoke all on function makeborne_private.purge_site_view_visitors(uuid) from public, anon, authenticated, service_role;
comment on function makeborne_private.purge_site_view_visitors(uuid) is 'Analytics retention: deletes visitor hashes older than two UTC days (all sites) and daily totals/breakdowns older than 400 days (one site, or all when called without an argument). Returns the number of rows removed. Not callable by client roles; run as the database owner for a scheduled purge.';

-- One signed view from the customer-site Worker.
create function public.makeborne_record_site_view(
 p_slug text, p_path text, p_referrer text, p_country text, p_device text, p_visitor text, p_stamp bigint, p_signature text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
 secret text; now_ms bigint; expected text; d date; site public.hosted_sites%rowtype;
 visitor_views integer; new_visitor boolean; first_of_day boolean; dim text; val text; n integer;
begin
 select k.secret into secret from makeborne_private.site_analytics_key k where k.singleton;
 if secret is null then raise exception 'Site analytics is not configured' using errcode = 'MB503'; end if;
 if p_slug is null or p_path is null or p_referrer is null or p_country is null or p_device is null
  or p_visitor is null or p_stamp is null or p_signature is null then
  raise exception 'Invalid site view' using errcode = '22023';
 end if;
 -- Freshness: the Worker stamps milliseconds since the epoch; allow 2 minutes of skew.
 now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
 if abs(now_ms - p_stamp) > 120000 then raise exception 'Stale site view stamp' using errcode = 'MB408'; end if;
 -- Signature over the exact contract string. Compared as HMACs of both values
 -- ("double HMAC") because plpgsql has no constant-time equality: the timing of
 -- the final comparison then reveals nothing an attacker can steer.
 expected := encode(extensions.hmac(
  p_stamp::text || '.' || p_slug || '|' || p_path || '|' || p_referrer || '|' || p_country || '|' || p_device || '|' || p_visitor,
  secret, 'sha256'), 'hex');
 if p_signature !~ '^[0-9a-f]{64}$'
  or extensions.hmac(expected, secret, 'sha256') <> extensions.hmac(p_signature, secret, 'sha256') then
  raise exception 'Invalid site view signature' using errcode = 'MB401';
 end if;
 -- Shape (also bounds every stored value).
 if p_path !~ '^/' or length(p_path) > 200 or p_path ~ '[[:cntrl:]]'
  or (p_referrer <> '' and (length(p_referrer) > 200 or p_referrer !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'))
  or (p_country <> '' and p_country !~ '^[A-Z]{2}$')
  or p_device not in ('desktop','mobile','tablet')
  or p_visitor !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid site view' using errcode = '22023';
 end if;
 select * into site from public.hosted_sites s where s.slug = p_slug;
 if not found or not site.live then raise exception 'Site is not live' using errcode = 'MB404'; end if;

 -- The UTC day of the signed stamp: the same day the Worker used for the visitor hash.
 d := (to_timestamp(p_stamp / 1000.0) at time zone 'utc')::date;

 -- Per-visitor cap: the update is skipped once a visitor has 200 views, so no row returns.
 insert into makeborne_private.site_view_visitors as v(artifact_id, day, visitor, views)
 values(site.artifact_id, d, p_visitor, 1)
 on conflict (artifact_id, day, visitor) do update set views = v.views + 1 where v.views < 200
 returning v.views into visitor_views;
 if not found then return jsonb_build_object('recorded', false, 'reason', 'visitor_cap'); end if;
 new_visitor := visitor_views = 1;

 -- Daily totals. The row lock taken here serializes this site's day for the rest of
 -- the transaction, which keeps the distinct-value cap below exact under concurrency.
 insert into public.site_view_days as t(artifact_id, workspace_id, day, views, visitors)
 values(site.artifact_id, site.workspace_id, d, 1, case when new_visitor then 1 else 0 end)
 on conflict (artifact_id, day) do update
  set views = t.views + 1, visitors = t.visitors + excluded.visitors, workspace_id = excluded.workspace_id
 returning t.views = 1 into first_of_day;

 foreach dim in array array['path','referrer','country','device'] loop
  val := case dim
   when 'path' then p_path
   when 'referrer' then coalesce(nullif(p_referrer, ''), '(direct)')
   when 'country' then coalesce(nullif(p_country, ''), '(unknown)')
   else p_device end;
  update public.site_view_breakdowns b set views = b.views + 1, workspace_id = site.workspace_id
   where b.artifact_id = site.artifact_id and b.day = d and b.dimension = dim and b.value = val;
  if not found then
   select count(*) into n from public.site_view_breakdowns b
    where b.artifact_id = site.artifact_id and b.day = d and b.dimension = dim and b.value <> '(other)';
   if n >= 300 then val := '(other)'; end if;
   insert into public.site_view_breakdowns as b(artifact_id, workspace_id, day, dimension, value, views)
   values(site.artifact_id, site.workspace_id, d, dim, val, 1)
   on conflict (artifact_id, day, dimension, value) do update set views = b.views + 1, workspace_id = excluded.workspace_id;
  end if;
 end loop;

 -- Opportunistic retention: once per site per UTC day, on its first counted view.
 if first_of_day then perform makeborne_private.purge_site_view_visitors(site.artifact_id); end if;
 return jsonb_build_object('recorded', true);
end $$;
comment on function public.makeborne_record_site_view(text, text, text, text, text, text, bigint, text) is 'Customer-site Worker: record one signed page view. Signature: lowercase hex HMAC-SHA256(stamp || ''.'' || slug|path|referrer|country|device|visitor) with makeborne_private.site_analytics_key. Errors: MB503 not configured, 22023 invalid input, MB408 stamp outside ±120 s, MB401 bad signature, MB404 site missing or offline. Returns {recorded:true} or {recorded:false, reason:''visitor_cap''}.';
revoke all on function public.makeborne_record_site_view(text, text, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_record_site_view(text, text, text, text, text, text, bigint, text) to anon, authenticated, service_role;
commit;
