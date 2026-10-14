-- Customer custom domains (Cloudflare for SaaS custom hostnames) for published sites.
-- Additive: no existing table, function or grant changes. Rows are written only by the
-- server (service_role) after it registers the hostname with Cloudflare; owners read
-- their own workspace's rows. The site Worker resolves an active hostname to the
-- site's slug through makeborne_resolve_site_host() using the publishable key.
begin;

create table public.custom_domains (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 artifact_id uuid not null references public.hosted_sites(artifact_id) on delete cascade,
 hostname text not null unique check(
  char_length(hostname) <= 253
  and hostname = lower(hostname)
  -- At least two DNS labels of 1-63 [a-z0-9-] characters, no edge hyphens, no
  -- trailing dot; the final label starts with a letter so IP addresses never match.
  and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  and hostname !~ '(^|\.)(makeborne\.com|makeborne\.site|localhost)$'),
 status text not null default 'pending' check(status in ('pending','active','failed')),
 cloudflare_id text check(cloudflare_id is null or char_length(cloudflare_id) between 1 and 128),
 verification jsonb not null default '[]'::jsonb check(jsonb_typeof(verification) = 'array' and octet_length(verification::text) <= 16000),
 ssl_status text check(ssl_status is null or char_length(ssl_status) between 1 and 64),
 error text check(length(error) <= 500),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_checked_at timestamptz
);
create index custom_domains_artifact on public.custom_domains(artifact_id);
create index custom_domains_workspace on public.custom_domains(workspace_id);

comment on table public.custom_domains is 'Customer-owned hostnames attached to a published site through Cloudflare for SaaS. Written only by the server (service_role); owners read their own workspace rows. At most 5 per site and 50 per workspace.';
comment on column public.custom_domains.workspace_id is 'Workspace that owns the site; must equal hosted_sites.workspace_id of artifact_id.';
comment on column public.custom_domains.artifact_id is 'Published site (hosted_sites.artifact_id) this hostname serves.';
comment on column public.custom_domains.hostname is 'Lowercase DNS name without trailing dot, at least two labels; never under makeborne.com, makeborne.site or localhost.';
comment on column public.custom_domains.status is 'pending until Cloudflare reports the hostname and certificate active; active hostnames are served by the site Worker; failed records an unrecoverable provider state.';
comment on column public.custom_domains.cloudflare_id is 'Cloudflare for SaaS custom hostname identifier, once created.';
comment on column public.custom_domains.verification is 'JSON array of DNS records the owner must create (ownership and certificate validation), as shown in the app.';
comment on column public.custom_domains.ssl_status is 'Last certificate status reported by Cloudflare (informational).';
comment on column public.custom_domains.error is 'Last user-presentable provider or validation error (at most 500 characters).';
comment on column public.custom_domains.created_by is 'Account that requested the domain.';
comment on column public.custom_domains.last_checked_at is 'When the server last polled Cloudflare for this hostname.';

-- Limits, workspace consistency and updated_at. A per-workspace transaction lock
-- serializes concurrent inserts, so counts cannot be raced past the limits.
create function makeborne_hosting.custom_domain_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare site_workspace uuid;
begin
 if tg_op = 'UPDATE' then new.updated_at := now(); end if;
 if tg_op = 'INSERT' or new.artifact_id is distinct from old.artifact_id or new.workspace_id is distinct from old.workspace_id then
  select s.workspace_id into site_workspace from public.hosted_sites s where s.artifact_id = new.artifact_id;
  if site_workspace is distinct from new.workspace_id then
   raise exception 'Custom domain workspace must match its site' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('makeborne_custom_domains:' || new.workspace_id::text, 0));
  if (select count(*) from public.custom_domains d where d.artifact_id = new.artifact_id and d.id <> new.id) >= 5 then
   raise exception 'A site can have at most 5 custom domains' using errcode = 'MB429';
  end if;
  if (select count(*) from public.custom_domains d where d.workspace_id = new.workspace_id and d.id <> new.id) >= 50 then
   raise exception 'A workspace can have at most 50 custom domains' using errcode = 'MB429';
  end if;
 end if;
 return new;
end $$;
revoke all on function makeborne_hosting.custom_domain_guard() from public, anon, authenticated, service_role;
create trigger custom_domains_guard before insert or update on public.custom_domains
 for each row execute function makeborne_hosting.custom_domain_guard();

alter table public.custom_domains enable row level security;
revoke all on public.custom_domains from public, anon, authenticated;
grant select on public.custom_domains to authenticated;
grant all on public.custom_domains to service_role;
create policy custom_domains_owner_read on public.custom_domains for select to authenticated
 using(exists(select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

-- Public host lookup for the site Worker (publishable key). Returns only the slug of
-- a live site whose hostname is active; every other input returns null. The site
-- readers still apply their own eligibility rules to the slug.
create function public.makeborne_resolve_site_host(p_host text) returns text
language sql stable security definer set search_path='' as $$
 select s.slug from public.custom_domains d
 join public.hosted_sites s on s.artifact_id = d.artifact_id and s.workspace_id = d.workspace_id
 where char_length(p_host) <= 253 and d.hostname = lower(p_host) and d.status = 'active' and s.live
 limit 1;
$$;
comment on function public.makeborne_resolve_site_host(text) is 'Site Worker lookup: slug of the live site served by an active custom hostname, else null.';
revoke all on function public.makeborne_resolve_site_host(text) from public, anon, authenticated, service_role;
grant execute on function public.makeborne_resolve_site_host(text) to anon, authenticated, service_role;
commit;
