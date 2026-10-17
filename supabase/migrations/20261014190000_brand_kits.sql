-- Brand kits: one logo, palette, fonts, tone and word list for a workspace's own
-- brand (client_id null) and one per client. Additive: no existing table,
-- function or grant changes. Members read their workspace's kits; rows are
-- written only by the server (service_role) after it validates the kit and
-- re-encodes the logo, and checks the caller is an owner or editor.
begin;

create table public.brand_kits (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 client_id uuid,
 kit jsonb not null check(
  jsonb_typeof(kit) = 'object'
  and octet_length(kit::text) <= 450000
  and jsonb_typeof(kit->'name') = 'string'
  and jsonb_typeof(kit->'colors') = 'object'
  and (kit->'colors'->>'primary') ~ '^#[0-9a-f]{6}$'),
 updated_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(client_id, workspace_id) references public.clients(id, workspace_id) on delete cascade,
 constraint brand_kits_one_per_owner unique nulls not distinct (workspace_id, client_id)
);
create index brand_kits_client on public.brand_kits(client_id) where client_id is not null;

comment on table public.brand_kits is 'Brand kit (logo, colours, fonts, tone, words) for a workspace''s own brand (client_id null) or one client. Written only by the server (service_role); workspace members read.';
comment on column public.brand_kits.client_id is 'Client this kit belongs to, or null for the workspace''s own brand (used for projects without a client and for outreach voice).';
comment on column public.brand_kits.kit is 'Validated BrandKit JSON (src/lib/brand/kit.ts); the logo is a re-encoded PNG or WebP data URL of at most 300 KB.';
comment on column public.brand_kits.updated_by is 'Account that last saved the kit.';

create function makeborne_private.touch_brand_kit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.updated_at := now();
 return new;
end $$;
revoke all on function makeborne_private.touch_brand_kit() from public, anon, authenticated, service_role;
create trigger brand_kits_touch before update on public.brand_kits
 for each row execute function makeborne_private.touch_brand_kit();

alter table public.brand_kits enable row level security;
revoke all on public.brand_kits from public, anon, authenticated;
grant select on public.brand_kits to authenticated;
grant all on public.brand_kits to service_role;
create policy brand_kits_member_read on public.brand_kits for select to authenticated
 using(makeborne_private.can_read(workspace_id));
commit;
