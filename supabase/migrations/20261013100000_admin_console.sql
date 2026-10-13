-- Administrator console: read-only views of customers, subscriptions, credits,
-- AI spend and service health for /admin.
-- * Every function re-checks that p_actor is an administrator
--   (makeborne_private.account_privileges.is_admin) and refuses otherwise (42501).
--   The app passes the user id of the verified session; browsers cannot call these.
-- * Read-only: no function writes anything. Amounts are returned raw; the app
--   prices subscriptions from its authoritative plan catalog.
-- * No secrets: no tokens, keys, password hashes or webhook payloads are returned.
begin;

create or replace function makeborne_private.require_admin(p_actor uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from makeborne_private.account_privileges where user_id=p_actor and is_admin)
  then raise exception 'Administrator access required' using errcode='42501'; end if;
end $$;
revoke all on function makeborne_private.require_admin(uuid) from public,anon,authenticated,service_role;

-- Latest plan tier/interval per membership, from recorded plan observations.
create or replace function makeborne_private.admin_membership_plans() returns table(membership_id text, tier text, billing_interval text)
language sql stable security definer set search_path='' as $$
 select distinct on (o.membership_id) o.membership_id, o.tier, o.billing_interval
 from makeborne_private.plan_observations o where o.tier is not null
 order by o.membership_id, o.observed_at desc
$$;
revoke all on function makeborne_private.admin_membership_plans() from public,anon,authenticated,service_role;

create or replace function public.makeborne_admin_overview(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform makeborne_private.require_admin(p_actor);
 select jsonb_build_object(
  'generatedAt', now(),
  'users', (select jsonb_build_object(
     'total', count(*), 'confirmed', count(*) filter (where u.email_confirmed_at is not null),
     'new7d', count(*) filter (where u.created_at > now()-interval '7 days'),
     'new30d', count(*) filter (where u.created_at > now()-interval '30 days'),
     'active7d', count(*) filter (where u.last_sign_in_at > now()-interval '7 days'),
     'admins', (select count(*) from makeborne_private.account_privileges where is_admin))
   from auth.users u),
  'subscriptions', coalesce((select jsonb_agg(x order by x->>'status', x->>'tier') from (
     select jsonb_build_object('status', m.status, 'tier', coalesce(p.tier,'unknown'), 'interval', coalesce(p.billing_interval,'unknown'),
       'current', m.status in ('active','canceling') and m.period_end > now(), 'count', count(*)) x
     from public.billing_memberships m left join makeborne_private.admin_membership_plans() p on p.membership_id=m.membership_id
     group by m.status, p.tier, p.billing_interval, (m.status in ('active','canceling') and m.period_end > now())) s), '[]'::jsonb),
  'checkouts', (select jsonb_build_object('open24h', count(*) filter (where created_at > now()-interval '24 hours'), 'total', count(*)) from public.billing_checkouts),
  'credits', jsonb_build_object(
     'balance', (select coalesce(sum(balance),0) from makeborne_private.credit_wallets),
     'reserved', (select coalesce(sum(reserved),0) from makeborne_private.credit_wallets),
     'wallets', (select count(*) from makeborne_private.credit_wallets),
     'ledger30d', coalesce((select jsonb_object_agg(kind, jsonb_build_object('credits', total, 'entries', entries)) from (
        select kind, sum(delta) total, count(*) entries from public.credit_ledger where created_at > now()-interval '30 days' group by kind) l), '{}'::jsonb)),
  'ai', jsonb_build_object(
     'today', coalesce((select jsonb_agg(jsonb_build_object('scope', scope, 'spentMicrousd', spent_microusd, 'reservedMicrousd', reserved_microusd) order by scope)
        from makeborne_private.live_provider_days where day=(now() at time zone 'utc')::date), '[]'::jsonb),
     'runs7d', coalesce((select jsonb_object_agg(outcome, jsonb_build_object('runs', runs, 'chargedCredits', charged, 'absorbedCredits', absorbed, 'providerMicrousd', provider)) from (
        select outcome, count(*) runs, sum(charged_credits) charged, sum(absorbed_credits) absorbed, sum(provider_microusd) provider
        from makeborne_private.ai_run_outcomes where recorded_at > now()-interval '7 days' group by outcome) r), '{}'::jsonb),
     'limits', public.makeborne_provider_spend_health()),
  'billingJobs', public.makeborne_billing_job_health(),
  'openPlanIssues', (select count(*) from makeborne_private.plan_credit_issues where resolved_at is null),
  'hosting', (select jsonb_build_object('sites', count(*), 'live', count(*) filter (where live), 'interactive', count(*) filter (where live and interactive),
     'enquiries7d', (select count(*) from public.site_enquiries where created_at > now()-interval '7 days')) from public.hosted_sites),
  'content', jsonb_build_object('workspaces', (select count(*) from public.workspaces),
     'artifacts', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.artifacts group by kind) a), '{}'::jsonb))
 ) into result;
 return result;
end $$;

-- One page of customers, newest first. p_filter: all | subscribed | admin | unconfirmed.
create or replace function public.makeborne_admin_users(p_actor uuid, p_search text default null, p_filter text default 'all', p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pattern text; result jsonb;
begin
 perform makeborne_private.require_admin(p_actor);
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 1000000
  or coalesce(p_filter,'all') not in ('all','subscribed','admin','unconfirmed') or length(coalesce(p_search,'')) > 200
  then raise exception 'Invalid customer query' using errcode='22023'; end if;
 -- Literal substring match: escape LIKE wildcards in the search text.
 pattern := case when nullif(btrim(p_search),'') is null then null
   else '%' || replace(replace(replace(btrim(p_search),'\','\\'),'%','\%'),'_','\_') || '%' end;
 with base as (
  select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null confirmed,
   coalesce(a.is_admin,false) is_admin, coalesce(a.unlimited_credits,false) unlimited,
   m.membership_id, m.status, m.plan_id, m.period_end, (m.status in ('active','canceling') and m.period_end > now()) as current_member
  from auth.users u
  left join makeborne_private.account_privileges a on a.user_id=u.id
  left join lateral (select * from public.billing_memberships bm where bm.user_id=u.id order by bm.checked_at desc limit 1) m on true
  where (pattern is null or u.email ilike pattern escape '\' or u.id::text = btrim(p_search))
   and case coalesce(p_filter,'all')
    when 'subscribed' then coalesce(m.status in ('active','canceling') and m.period_end > now(), false)
    when 'admin' then coalesce(a.is_admin,false)
    when 'unconfirmed' then u.email_confirmed_at is null
    else true end
 ), page as (select * from base order by created_at desc, id limit p_limit offset p_offset)
 select jsonb_build_object('total', (select count(*) from base), 'limit', p_limit, 'offset', p_offset,
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'email', page.email, 'createdAt', page.created_at, 'lastSignInAt', page.last_sign_in_at, 'confirmed', page.confirmed,
    'isAdmin', page.is_admin, 'unlimitedCredits', page.unlimited,
    'membership', case when page.membership_id is null then null else jsonb_build_object('status', page.status, 'planId', page.plan_id, 'periodEnd', page.period_end,
      'current', page.current_member, 'tier', p.tier, 'interval', p.billing_interval) end,
    'credits', jsonb_build_object('available', makeborne_private.credit_available(page.id), 'reserved', coalesce(w.reserved,0)),
    'workspaces', (select count(*) from public.workspaces ws where ws.owner_id=page.id),
    'sites', (select count(*) from public.hosted_sites hs where hs.owner_id=page.id and hs.live)
   ) order by page.created_at desc, page.id), '[]'::jsonb))
 into result
 from page
 left join makeborne_private.admin_membership_plans() p on p.membership_id=page.membership_id
 left join makeborne_private.credit_wallets w on w.user_id=page.id;
 return result;
end $$;

-- Everything about one customer that support needs, newest first and bounded.
create or replace function public.makeborne_admin_user(p_actor uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform makeborne_private.require_admin(p_actor);
 if not exists(select 1 from auth.users where id=p_user) then return null; end if;
 select jsonb_build_object(
  'profile', (select jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
     'confirmed', u.email_confirmed_at is not null, 'providers', coalesce(u.raw_app_meta_data->'providers','[]'::jsonb)) from auth.users u where u.id=p_user),
  'privileges', (select jsonb_build_object('isAdmin', is_admin, 'unlimitedCredits', unlimited_credits, 'reason', reason, 'updatedAt', updated_at)
     from makeborne_private.account_privileges where user_id=p_user),
  'memberships', coalesce((select jsonb_agg(jsonb_build_object('membershipId', m.membership_id, 'status', m.status, 'planId', m.plan_id, 'periodEnd', m.period_end,
     'checkedAt', m.checked_at, 'current', m.status in ('active','canceling') and m.period_end > now(), 'tier', p.tier, 'interval', p.billing_interval) order by m.checked_at desc)
     from public.billing_memberships m left join makeborne_private.admin_membership_plans() p on p.membership_id=m.membership_id where m.user_id=p_user), '[]'::jsonb),
  'periods', coalesce((select jsonb_agg(x) from (select jsonb_build_object('membershipId', membership_id, 'start', period_start, 'end', period_end, 'interval', billing_interval) x
     from makeborne_private.plan_periods where user_id=p_user order by period_start desc limit 24) s), '[]'::jsonb),
  'openIssues', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'membershipId', membership_id, 'allocationStart', allocation_start, 'firstSeenAt', first_seen_at) order by first_seen_at desc)
     from makeborne_private.plan_credit_issues where user_id=p_user and resolved_at is null), '[]'::jsonb),
  'credits', jsonb_build_object('available', makeborne_private.credit_available(p_user),
     'balance', coalesce((select balance from makeborne_private.credit_wallets where user_id=p_user),0),
     'reserved', coalesce((select reserved from makeborne_private.credit_wallets where user_id=p_user),0),
     'lots', coalesce((select jsonb_agg(x) from (select jsonb_build_object('source', source, 'amount', amount, 'spent', spent, 'held', held, 'lapsed', lapsed,
        'expiresAt', expires_at, 'createdAt', created_at) x from makeborne_private.credit_lots where user_id=p_user order by created_at desc limit 20) s), '[]'::jsonb),
     'ledger', coalesce((select jsonb_agg(x) from (select jsonb_build_object('delta', delta, 'kind', kind, 'balanceAfter', balance_after, 'createdAt', created_at) x
        from public.credit_ledger where user_id=p_user order by created_at desc limit 50) s), '[]'::jsonb)),
  'runs', coalesce((select jsonb_agg(x) from (select jsonb_build_object('outcome', outcome, 'chargedCredits', charged_credits, 'absorbedCredits', absorbed_credits,
     'providerMicrousd', provider_microusd, 'recordedAt', recorded_at) x from makeborne_private.ai_run_outcomes where user_id=p_user order by recorded_at desc limit 20) s), '[]'::jsonb),
  'workspaces', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name,
     'artifacts', (select count(*) from public.artifacts a where a.workspace_id=w.id)) order by w.name) from public.workspaces w where w.owner_id=p_user), '[]'::jsonb),
  'sites', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'live', s.live, 'interactive', s.interactive, 'enquiriesEnabled', s.enquiries_enabled, 'updatedAt', s.updated_at,
     'enquiries', (select count(*) from public.site_enquiries e where e.artifact_id=s.artifact_id)) order by s.updated_at desc) from public.hosted_sites s where s.owner_id=p_user), '[]'::jsonb)
 ) into result;
 return result;
end $$;

revoke all on function public.makeborne_admin_overview(uuid) from public,anon,authenticated;
revoke all on function public.makeborne_admin_users(uuid,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.makeborne_admin_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.makeborne_admin_overview(uuid) to service_role;
grant execute on function public.makeborne_admin_users(uuid,text,text,integer,integer) to service_role;
grant execute on function public.makeborne_admin_user(uuid,uuid) to service_role;

commit;
