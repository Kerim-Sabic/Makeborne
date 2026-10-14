-- The free tier (creation access and one-time trial credits for confirmed
-- accounts without a plan) is opt-in. 20261011090000 now adds the setting as
-- OFF; this forward migration aligns databases that applied the earlier
-- default. It changes only the column default: an environment that already
-- enabled the free tier keeps it, and granted trial credits are untouched.
-- Enable at launch: update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
begin;

alter table makeborne_private.billing_settings alter column free_tier_enabled set default false;

-- The live offer, so marketing and billing copy never promise a trial that is
-- switched off. Service role only (read by the server for public pages).
create function public.makeborne_free_tier_offer() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'enabled',coalesce((select free_tier_enabled from makeborne_private.billing_settings where singleton),false),
    'trialCredits',coalesce((select trial_credits from makeborne_private.billing_settings where singleton),0));
$$;
revoke all on function public.makeborne_free_tier_offer() from public,anon,authenticated;
grant execute on function public.makeborne_free_tier_offer() to service_role;

commit;
