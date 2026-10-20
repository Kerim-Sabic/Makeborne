# Customer custom domains

Owners can serve a published website from their own hostname, for example `www.example.com`, as well as from `<slug>.makeborne.site`. The hostname is attached to the `makeborne.site` zone with Cloudflare for SaaS custom hostnames. The site Worker resolves the hostname to the site's slug and then serves it exactly like the slug address.

**Status:** the database and Worker code exist in the repository. Nothing has been applied to a cloud database, deployed, routed or configured in Cloudflare. Leave the feature off until every step in [Before enabling](#before-enabling-owner--operator) is done.

Related: [HOSTING_JS.md](HOSTING_JS.md) covers the isolated site domain and Worker, [HOSTING_DOMAIN.md](HOSTING_DOMAIN.md) covers how addresses are switched on, and [STAGING_HOSTING_ISOLATION.md](STAGING_HOSTING_ISOLATION.md) covers the staging namespace.

## How it works

```
Visitor ─▶ https://www.example.com ─(customer CNAME)─▶ customers.makeborne.site (fallback origin, zone makeborne.site)
          Cloudflare for SaaS terminates TLS for the custom hostname and runs the zone's Worker route
          ─▶ Worker makeborne-site-host (infra/customer-sites/_worker.js)
               classify: kind "custom", host "www.example.com"     (namespace-policy.js)
               slug = rpc makeborne_resolve_site_host(p_host)      (publishable key, cached 60 s / 30 s)
               unknown → 404 page;  known → identical to <slug>.makeborne.site
```

The app does the following: it validates the hostname, creates the Cloudflare custom hostname with the server-only token, stores the row, shows the DNS records from `verification`, polls Cloudflare and sets `status`. The app code lives under `src/` and is described separately. The database and Worker contract is below.

### Database: `supabase/migrations/20261014160000_custom_domains.sql`

| Object | Contract |
| --- | --- |
| `public.custom_domains` | `id`, `workspace_id` (cascade), `artifact_id` → `hosted_sites` (cascade), `hostname` (unique), `status` `pending`/`active`/`failed`, `cloudflare_id`, `verification` (JSON array of DNS records to show), `ssl_status`, `error` (≤ 500 characters), `created_by`, `created_at`, `updated_at` (maintained by the trigger), `last_checked_at`. |
| Hostname CHECK | Lowercase, ≤ 253 characters, at least two DNS labels of 1–63 `[a-z0-9-]` characters with no leading or trailing hyphen, no trailing dot, and a final label that starts with a letter, so IP addresses are rejected. Hosts under `makeborne.com`, `makeborne.site` and `localhost` are refused. `infra/customer-sites/namespace-policy.js` `validCustomHostname()` applies the same rule. |
| Trigger `custom_domains_guard` | Enforces at most **5 domains per site** and **50 per workspace** with SQLSTATE `MB429`, on inserts and on moves between sites. Inserts are serialized per workspace with a transaction advisory lock. The row's `workspace_id` must equal the site's workspace (`23514`). |
| RLS and grants | RLS is on. `public`, `anon` and `authenticated` lose all privileges. `authenticated` gets `select` back, and `service_role` gets `all`. The `custom_domains_owner_read` policy lets only the workspace owner read rows. Writes are server-only (service role). |
| `public.makeborne_resolve_site_host(p_host text) → text` | `stable security definer`, `search_path=''`. Returns `hosted_sites.slug` only when `hostname = lower(p_host)`, `status = 'active'` and the site is `live`. Otherwise it returns null. `PUBLIC` execute is revoked. `anon`, `authenticated` and `service_role` can execute it, because the Worker calls it with the publishable key. The site readers still apply owner eligibility to the slug afterwards. |

`supabase/check-custom-domains.sql` covers shape, 22 invalid and 7 valid hostnames, limits, updated_at, the resolver truth table, grants, RLS (owner, other account, browser writes), service-role writes and cascades. It runs in one rolled-back transaction on an isolated local database:

```
# composed input: BEGIN; <migration body without its begin/commit>; <check without its begin> (ends in ROLLBACK)
docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < composed.sql
```

### Worker (`infra/customer-sites`)

- **Classification** (`classifySiteNamespaceRequest`). These rules run before any redirect, form, cache or upstream access. The authority is `new URL(request.url)`; `Host`, `Forwarded` and `X-Forwarded-Host` are never read.
  - *production*: the legacy host, the apex and `www` of `makeborne.site`, and `*.makeborne.site` keep their existing rules. Every other valid hostname that is not under Makeborne becomes `{kind:'custom', host}`. IP addresses, single labels, trailing dots, nondefault ports, credentials and anything under `makeborne.com` return null, which gives a 404.
  - *local*: only `*.test` hostnames are custom, for `wrangler dev`.
  - *staging*: only hostnames listed exactly in the `STAGING_CUSTOM_HOSTS` Worker variable are custom. It is a comma list of at most 20 entries, and absent or empty means none. Any invalid or duplicate entry makes the configuration invalid, so every request gets 503. Production and local refuse a non-empty `STAGING_CUSTOM_HOSTS`.
- **Resolution**: `makeborne_resolve_site_host` is called with the publishable key and a 512-byte response cap. Answers are cached in `caches.default` under a synthetic key, `https://<sites domain>/_mb/custom-host?__mb_namespace=<namespace>-v1&host=<host>`. That key is on the apex, which only redirects, so it never matches a visitor URL. Found hosts are cached for 60 s and unknown hosts for 30 s. Upstream errors are never cached and return 503. A cached entry is used only if it names the same host and a valid slug. Slugs that are invalid, or that are QA labels in production, are refused like unknown hosts.
- **Serving**: after resolution the request takes the same path as a slug address: documents, stored files, `robots.txt`, `/_mb/enquiries` with the resolved slug, 405 for other methods, and the same CSP and headers. The HTTP → HTTPS 308 redirect still runs before resolution. There are two deliberate differences:
  - Responses on a custom host send `Strict-Transport-Security: max-age=31536000` without `includeSubDomains`, because the custom hostname may be the customer's registrable apex.
  - The file cache key for a custom host also binds the resolved slug, so moving a hostname to another site never serves the old site's cached files.
- **Checks**: `infra/customer-sites/check-custom-hosts.mjs` covers the validator, classification in each namespace, mocked-fetch resolution, positive and negative caching, cache-entry validation, 404 and 503 handling, the redirect, enquiries and Origin checks, staging and local isolation, and a real local workerd Cache API run. `check-namespace.mjs` covers the existing namespace rules. `node scripts/run-checks.mjs` runs both.

## Before enabling (owner / operator)

Work through these steps in order. None of them has been done.

1. **Cloudflare for SaaS on the `makeborne.site` zone.** In the zone, enable custom hostnames under SSL/TLS → Custom Hostnames, and review that plan's included hostname quota and per-hostname pricing first. This is a billing decision for the owner. See [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/).
2. **Fallback origin.** Create a proxied DNS record for the CNAME target, for example `customers.makeborne.site`. The zone's existing placeholder style works, such as a proxied `AAAA customers 100::`. Set it as the zone's fallback origin and wait until Cloudflare reports it active.
   - Requests for custom hostnames still reach the Worker with the customer's hostname in the URL, so the fallback origin's own name is never served.
   - A direct visit to `https://customers.makeborne.site/` is an ordinary slug address: a 404 unless a site uses that slug. Recommended: make sure no site uses the label you choose, and reserve it. `RESERVED_SITE_SLUGS` in `infra/customer-sites/site-policy.js` is shared with the app. Adding a label there is a coordinated change, because an existing site with that slug would stop serving.
3. **Worker route that catches custom hostnames.** The production routes in `infra/customer-sites/wrangler.jsonc` are currently `*.makeborne.site/*` and `makeborne.site/*`, and those patterns never match `www.example.com`. When you enable the feature, add a catch-all route on the SaaS zone (typically the pattern `*/*` with `zone_name: "makeborne.site"`). Update the route assertion in `check-namespace.mjs` in the same change, then deploy with `npx wrangler deploy --env production`. Confirm in the dashboard that only the zone's own hostnames and its custom hostnames reach the Worker.
   - For a staging rehearsal: add an exact route for one QA hostname to `env.staging.routes` and set `STAGING_CUSTOM_HOSTS` to that hostname in `env.staging.vars`. The staging Worker resolves it against the staging database only.
4. **App environment (Vercel, server-only, never `NEXT_PUBLIC_`).**
   - `CLOUDFLARE_SAAS_ZONE_ID`: the `makeborne.site` zone ID.
   - `CLOUDFLARE_SAAS_API_TOKEN`: an API token scoped to **that zone only**, with the single permission **Zone → SSL and Certificates → Edit**. That permission covers creating, reading and deleting custom hostnames. Do not use a global API key or an account-wide token. Store it only as an encrypted Vercel variable for the environment that needs it, and never put it in the repository or in Worker variables.
   - `MAKEBORNE_CUSTOM_DOMAIN_TARGET`: the CNAME target from step 2, for example `customers.makeborne.site`.
5. **Customer DNS instructions shown by the app.**
   - A subdomain such as `www` uses `CNAME www → customers.makeborne.site`. A nested hostname shows its whole zone-relative name and the exact full name (`shop.eu.example.com` → name `shop.eu` in the zone `example.com`, full name `shop.eu.example.com`); both can be copied. The zone is the registrable domain as far as the app can tell, so a customer with a delegated zone (for example `eu.example.com`) uses the full name.
   - Certificate states are shown as they are: `validation_timed_out` and the other `*_timed_out` states, `expired`/`pending_expiration`, removed certificates and unrecognised values stop the progress spinner and polling and say what to do. "Check now" only re-reads the status; the app never restarts validation or recreates a hostname on its own. A provider error while checking returns 503 and leaves the stored row unchanged.
   - An apex domain needs a DNS provider that supports CNAME flattening or ALIAS records. Recommend `www` plus a registrar redirect from the apex.
   - Customers also add the ownership and certificate-validation records stored in `verification`. Cloudflare activates the hostname and issues the certificate only after those records validate.

## Migration and deploy order

1. **Database**: apply `20261014160000_custom_domains.sql` through the reviewed release process. It is additive and changes no existing objects. It needs the earlier `workspaces`, `hosted_sites` and `makeborne_hosting` migrations. Then run `supabase/check-custom-domains.sql` against an isolated copy, not production data.
2. **Worker**: deploy the updated Worker (`--env staging` first, then `--env production`). This is safe before step 3, because without a catch-all route no custom hostname can reach it, and slug addresses behave exactly as before. If a custom request did arrive before step 1, resolution would fail closed with 503.
3. **Cloudflare**: set up SaaS, the fallback origin and the route (steps 1–3 above).
4. **App**: set the environment variables and deploy the app half. Keep the UI hidden until one internal domain has been connected end to end.

## Rollout

1. In staging, run one QA hostname through the full flow: listed in `STAGING_CUSTOM_HOSTS`, an exact staging route, and the staging database. Then run one owner-controlled production domain. For each, verify:
   - the `pending` → `active` status
   - HTTPS with a valid certificate
   - the document, assets, robots.txt and enquiry form
   - that removing the domain makes the hostname 404 within about 60 s
2. Enable the UI for a small set of accounts, watch the Worker logs (`custom_host_resolve_error`, `custom_host_slug_refused`, `hosted_site_upstream_error`) and Cloudflare custom hostname statuses, then widen access.

## Rollback

Choose the smallest step that is enough:

- **Stop one domain**: the server sets `status` to `pending` or `failed`, or deletes the row, and removes the Cloudflare custom hostname. The Worker stops serving it within the 60 s cache TTL.
- **Stop all custom domains, keep slug sites**: remove the catch-all Worker route, and the Worker is never invoked for custom hostnames. Alternatively, redeploy the previous Worker version: it returns 404 for any host outside `*.makeborne.site`.
- **Disable creation**: unset `CLOUDFLARE_SAAS_API_TOKEN` in the app.
- **Database**: the migration is additive, so leave it in place. If it must be removed, first delete the Cloudflare custom hostnames, then run:

  ```sql
  drop function public.makeborne_resolve_site_host(text);
  drop table public.custom_domains;
  drop function makeborne_hosting.custom_domain_guard();
  ```

## Local testing

Run `wrangler dev` with the local configuration described in HOSTING_JS.md, and point it at the local Supabase stack with the migration applied. Insert an `active` row for a `.test` hostname, then request it with the right authority:

```
curl --resolve shop.example.test:8787:127.0.0.1 http://shop.example.test:8787/
```

## Known limitations / follow-ups

- The slug address keeps serving next to the custom domain. A canonical redirect, or a `rel=canonical` from `<slug>.makeborne.site` to the active custom domain, is not implemented yet.
- Activation and removal propagate through the edge cache within 60 s (found) and 30 s (unknown).
- The resolver ignores owner eligibility on purpose. The site readers (`makeborne_read_hosted_site_v3` and the file reader) still refuse ineligible owners, so a custom host for such a site returns 404.
