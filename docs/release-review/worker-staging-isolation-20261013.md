# Customer-site Worker staging namespace isolation

Date: 2026-10-13. Status: implemented and locally qualified; not deployed. No cloud API, database, DNS, route, certificate, credential or paid-provider change occurred.

## Changes

- `infra/customer-sites/wrangler.jsonc`: staging declares only `release-check.makeborne.site/*` and `release-check-renamed.makeborne.site/*`. Its prior apex/wildcard routes are removed. Production retains its wildcard/apex routes. Top-level local configuration has no routes; all environments keep workers.dev and preview URLs disabled.
- `infra/customer-sites/namespace-policy.js`: pure reusable deployment policy and constants, with no Worker-only imports. Syntax-only `validSiteLabel` and `site-policy.js` are unchanged so QA labels remain valid compiler inputs.
- `infra/customer-sites/_worker.js`: applies the namespace gate before HTTPS redirection, form handling, method handling, legacy redirects, robots, cache access and RPC. Asset cache keys now include the trusted namespace version; old unpartitioned or production cache entries cannot satisfy a staging read.
- `infra/customer-sites/check-namespace.mjs`: isolated policy/Worker checks and actual local workerd qualification with every upstream mocked. No cloud credentials are read.

Root owns app allocation/server guards, the standalone legacy redirect and older hosting fixture updates. SQL changes are separately owned and qualified. This report does not claim those boundaries from Worker tests.

## Configuration contract

| SITE_NAMESPACE | Worker authority |
|---|---|
| omitted or production | Ordinary valid customer labels under makeborne.site; both QA labels refused. Apex/www redirect to https://makeborne.com/. Existing sites.makeborne.com legacy paths redirect only for non-QA labels. |
| staging | Exactly the two QA hostnames. Other hosts, including apex/www, ordinary customer labels, legacy hosts and nested subdomains, return 404 before all lookup/redirect/form/cache paths. |
| local | Explicit local mode, localhost site domain, loopback HTTP database/app origins, and ALLOW_LOCAL_SUPABASE=true. Existing single-label *.localhost development sites and sites.localhost legacy behavior remain supported. Hosted domains are refused. |
| any other value | Invalid configuration; 503 before cache or upstream access. |

Hosted modes require SITES_DOMAIN=makeborne.site and reject local transport flags. Production pins the existing public database URL `https://rklojnmmsmhwnkbzuidp.supabase.co` and makeborne.com app origin. Staging pins `https://xzwikrunwpurxnxgkznh.supabase.co`, the existing staging app origin `https://makeborne-release-staging-feavd3cd1-kerimsabic-6594s-projects.vercel.app`, and SITE_INDEXING_ENABLED=false. Mixed production/staging bindings fail closed. App-origin omission retains the production default; staging requires its explicit pinned value. These identifiers are public configuration, not credentials.

Helper exports: STAGING_SITE_LABELS, STAGING_SUPABASE_URL, PRODUCTION_SUPABASE_URL, STAGING_APP_ORIGIN, siteNamespacePolicy(env), classifySiteNamespaceRequest(url,policy).

Request URL authority selects the host. Host, Forwarded and X-Forwarded-Host headers cannot select a namespace or change upstream bindings. URL parsing canonicalizes uppercase and default ports; nondefault hosted ports and trailing-dot host aliases are refused. HTTP on a permitted hosted hostname redirects to HTTPS only after namespace validation. Request query parameters cannot select the cache namespace.

The asset cache key is the canonical origin/path plus `?__mb_namespace=<trusted namespace>-v1`, ignoring caller query flags. This intentionally starts a fresh cache generation. Denied hosts do not attempt cache access, including conditional or preflight requests.

## Qualification

Current references were checked before implementation:

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
- Current published Workers types **5.20261013.1**, inspected under ignored `work/worker-types-inspect`; no dependency installation or manifest change.
- Installed/current Wrangler **4.149.0** configuration schema for routes, vars, workers_dev and preview_urls.
- [Cloudflare route matching](https://developers.cloudflare.com/workers/configuration/routing/routes/): more-specific exact hostname patterns win over the existing production wildcard. DNS/TLS and the actual zone route inventory still need live verification.

Checks:

- `node infra/customer-sites/check-namespace.mjs`: **12 groups passed**.
- The same harness ran **192 requests through actual local workerd**, using installed Miniflare **5.20261006.1-alpha**. A fixture-only wrapper primes Cache API; normal requests enter the actual bundled Worker. All upstream transports are intercepted and return synthetic responses; external network calls are zero.
- Coverage: exact route configuration; default/unknown/local namespace; mixed database/app bindings; both QA labels; ordinary/nested/legacy/apex hosts; GET/HEAD/POST/OPTIONS; robots; document and asset routes; spoofed authority headers; uppercase/default ports; nondefault ports and trailing dots; HTTPS redirects; signed allowed enquiry dispatch; forbidden forms; old and cross-namespace seeded caches; permitted same-namespace cache hits.
- `node src/lib/hosting/check-hosting.cjs`: **21 existing checks passed** using root's updated explicit namespace fixtures.
- Scoped ESLint on the Worker, helper and new harness: **zero warnings/errors**.
- Node prints the repository's existing module-type inference warning when directly importing these ESM .js files. No package type setting was changed.

This demonstrates Worker dispatch and cache boundaries under local workerd. It does not qualify Cloudflare edge route selection, actual remote database contents, live form delivery, domain ownership, TLS coverage, fresh model quality or publication executor readiness.

## Deployment and rollback requirements

Keep cloud/staging activation disabled until the app allocation guards and database namespace policy are applied together with the matching Worker configurations. Confirm the two QA labels are unused or owned by the intended QA artifact before assigning routes; no ownership was inspected or changed in this package. Verify proxied DNS, certificate coverage, the complete zone route inventory, exact-route precedence and ordinary-host rejection.

The staged configuration uses the existing pinned staging app origin. A future staging application deployment at another origin needs an explicit reviewed update of both the pin and environment; it cannot silently reuse a production gateway.

No production changes are authorized. The reported live inventory has only staging owning the wildcard; confirm the actual route inventory before cutover. Staging may be narrowed to the two QA routes when no existing unguarded production fallback exists. Any production wildcard, whenever separately authorized and activated, must already refuse both QA labels. If an existing unguarded production fallback is discovered, stop the staging cutover pending separate approval; do not modify production implicitly. If exact staging routes are later removed, any production wildcard fallback must continue to refuse both QA labels. Preserve those refusals and the SQL/app reservation guards during rollback; do not restore the previous staging wildcard/apex configuration. Purging old edge entries is not the namespace boundary; the new cache partition and hostname guard are.

Historical direct Worker cloud qualification scripts under scripts/ need review before reuse because they predate the explicit namespace configuration and may target ordinary staging slugs. They were not run here. No production/staging application, Worker, database or provider state was changed.

## Final local source inventory

| File under infra/customer-sites | SHA-256 |
|---|---|
| _worker.js | b8d1f428b70268a3abb38b322125e0eddf7e48271b1162409378299ee2811124 |
| namespace-policy.js | 9a65bd7a3758cf21a486a95f82067491477ee63640bcd36a4a49fb0f5b1f23ca |
| wrangler.jsonc | fce6ace73d0a437e41ca6443a83196af7e7e4b7bfb0bee111f991216554e33d3 |
| check-namespace.mjs | e0352d0acc9fb33513a1026a2e8574007847d41a896f66635f70ec09431869a7 |

