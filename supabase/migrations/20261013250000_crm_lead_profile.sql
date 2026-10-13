-- CRM lead profile: tags, deal value, lead source, and what research found
-- (platform, handle, audience size, bio, niche, angle). Additive columns with
-- bounds; existing rows get empty defaults, so older app versions are unaffected.
begin;

create or replace function makeborne_private.valid_lead_tags(tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(tags) <= 12 and not exists (select 1 from unnest(tags) tag where tag is null or length(trim(tag)) not between 1 and 30 or tag ~ '[<>\n\r]');
$$;

alter table public.clients
  add column if not exists tags text[] not null default '{}' check (makeborne_private.valid_lead_tags(tags)),
  add column if not exists deal_value numeric(14,2) check (deal_value is null or deal_value between 0 and 100000000),
  add column if not exists deal_currency text not null default 'EUR' check (deal_currency ~ '^[A-Z]{3}$'),
  add column if not exists lead_source text not null default '' check (length(lead_source) <= 60),
  -- { research: { url, platform, handle, followers, following, posts, bio, at }, insight: { niche, audience, angle, confidence, at } }
  add column if not exists lead_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(lead_profile) = 'object' and octet_length(lead_profile::text) <= 8000);

create index if not exists clients_tags on public.clients using gin (tags);

commit;
