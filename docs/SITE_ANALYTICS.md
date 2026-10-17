# Visitor analytics for published websites

Owners can see how many people visit their published website, which pages they open, where they come from, and which countries and kinds of device they use. Counting happens in the customer-site Worker, so nothing is added to the site itself: no script, no cookie, no pixel and no browser storage.

**Status:** the database, Worker and checks are in the repository. Nothing has been applied to a cloud database, deployed or configured. Analytics stays off until both halves of the secret are in place (see [Operator setup](#operator-setup)). The app pages that show the numbers are a separate change under `src/`.

Related: [HOSTING_JS.md](HOSTING_JS.md) (site Worker and isolated domain), [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md) (custom hostnames, counted like slug addresses), [WEBSITE_ENQUIRIES.md](WEBSITE_ENQUIRIES.md) (the other signed Worker path).

## What is counted

The Worker counts one **view** when it has served a page of a live site with status **200** to a **GET** request, on `<slug>.makeborne.site` or on an active custom domain. The count is sent after the response, through `context.waitUntil`, so it never delays or changes the page.

It records, per site and UTC day:

| Figure | Source |
| --- | --- |
| Views | Each counted page response. |
| Visitors | Distinct daily visitor hashes (see [Privacy](#privacy)). The hash changes every UTC day, so a person who returns tomorrow is a new visitor. Visitor totals over several days are therefore sums of daily visitors, not unique people. |
| Path | The URL path, without query string or fragment, at most 200 characters, case kept (`/about`, `/Caf%C3%A9/`). |
| Referrer | Only the **hostname** of the `Referer` header, such as `www.google.com`. It is `(direct)` when there is no referrer, when it is the page's own host, when it is a Makeborne host (`makeborne.com`, `makeborne.site` and their subdomains, including other customer sites) or when it is not a plain web hostname. Sites send `Referrer-Policy: strict-origin-when-cross-origin`, so other sites usually see only the origin anyway. |
| Country | Cloudflare's two-letter country for the connection (`request.cf.country`), or `(unknown)`. Tor (`T1`) and `XX` are unknown. |
| Device | `mobile`, `tablet` or `desktop`, from the User-Agent and the `Sec-CH-UA-Mobile` client hint. iPads that present a desktop User-Agent count as desktop. |

## What is not counted

- `HEAD` requests, stored files (scripts, styles, images), `robots.txt`, `/_mb/*` paths, enquiry submissions, redirects, 404, 405 and 503 responses.
  - A `304 Not Modified` document response **is** counted: it is a returning visitor whose browser revalidated a page it already holds, so it is a real page view (product decision by Claude, 2026-10-14; easy to revert in `shouldRecordSiteView`).
- Prefetches, prerenders and previews: any request whose `Sec-Purpose`, `Purpose`, `X-Purpose` or `X-Moz` header contains `prefetch`, `prerender` or `preview`.
- Requests that are not top-level page loads: a `Sec-Fetch-Dest` header other than `document` (for example a site's own script fetching a page).
- Bots and automated clients: a missing or empty User-Agent, or one matching `ANALYTICS_BOT_PATTERN` in `infra/customer-sites/analytics.js`. That list covers:
  - search and AI crawlers (`…bot`, `crawl`, `spider`, `slurp`, GPTBot, ClaudeBot, PerplexityBot, CCBot, Bytespider, Google-InspectionTool, GoogleOther and others);
  - link-preview fetchers (Facebook, WhatsApp, Slack, Skype, Twitter/X, Discord, Telegram, Mastodon, Embedly);
  - uptime monitors and auditors (UptimeRobot, Pingdom, StatusCake, Lighthouse, PageSpeed, GTmetrix, WebPageTest);
  - headless and automated browsers (HeadlessChrome, Puppeteer, Playwright, Selenium);
  - HTTP libraries and command-line tools (curl, Wget, python-requests, Go, Java, axios, node-fetch and others).

  In-app browsers (Facebook, Instagram, LinkedIn, Pinterest) are people and are counted. The phone brand "Cubot" is deliberately not treated as a bot. A User-Agent list cannot catch bots that pretend to be browsers, so treat the numbers as good estimates, not audited figures.
- More than **200 views by one visitor on one site in one UTC day**. Further views that day are ignored (`{recorded:false, reason:'visitor_cap'}`).
- New breakdown values beyond **300 distinct values per site, day and dimension**. They are counted under `(other)`; values already seen that day keep counting normally.
- The local namespace, unless the Worker variable `ANALYTICS_LOCAL=true` is set for a local test.

## Privacy

- **No cookies, scripts or storage** are added to the visitor's browser. Nothing on the published page changes.
- **No raw IP address or User-Agent leaves the Worker.** The Worker computes a visitor hash: lowercase hex SHA-256 of `UTC day | slug | CF-Connecting-IP | User-Agent | ANALYTICS_SIGNING_SECRET`. Only this hash is sent and stored. Because the day, the site and a secret are part of it, the hash:
  - changes every UTC day, so visitors cannot be followed across days;
  - differs per site, so visitors cannot be followed across sites;
  - cannot be recomputed from a guessed IP address without the secret.
- **Visitor hashes are deleted after two days.** They exist only to count unique visitors and apply the 200-view cap. Daily totals and breakdowns contain no visitor data at all.
- Referrers are reduced to a hostname; query strings and fragments of page URLs are dropped. Country comes from Cloudflare's network data, not from a location lookup of a stored address.
- Worker failure logs (`site_view_record_error`) contain only the HTTP status, the database error code or the error type. They never include the slug, path, IP address, User-Agent or referrer.

## How it works

```
Visitor ─▶ Worker (infra/customer-sites/_worker.js)
            serveDocument → 200 GET page ─▶ response to the visitor (unchanged)
            └─ waitUntil: analytics.js
                 skip: no/short secret · local namespace · not GET/200 · /_mb/* · prefetch · not a document · bot
                 visitor = sha256(day|slug|ip|ua|secret)        (raw IP and User-Agent stay here)
                 signature = HMAC-SHA256(secret, stamp.slug|path|referrer|country|device|visitor)
                 POST /rest/v1/rpc/makeborne_record_site_view   (publishable key, 5 s timeout)
                        └─ Postgres: verify secret, stamp ±120 s, signature, shape, live site → upsert counts
```

### Database: `supabase/migrations/20261014170000_site_analytics.sql`

| Object | Contract |
| --- | --- |
| `makeborne_private.site_analytics_key` | One row (`singleton = true`) holding `secret` (at least 32 characters). No privileges for `anon`, `authenticated` or `service_role`. Without a row every call fails with `MB503`. |
| `public.site_view_days` | `artifact_id` → `hosted_sites` (cascade), `workspace_id` → `workspaces` (cascade), `day`, `views`, `visitors`; primary key `(artifact_id, day)`; index `(workspace_id, day)`. |
| `public.site_view_breakdowns` | `artifact_id` → `hosted_sites` (cascade), `workspace_id`, `day`, `dimension` (`path`, `referrer`, `country`, `device`), `value` (1–200 characters), `views`; primary key `(artifact_id, day, dimension, value)`; index `(workspace_id, day)`. |
| `makeborne_private.site_view_visitors` | `artifact_id`, `day`, `visitor` (64 hex), `views`; primary key `(artifact_id, day, visitor)`; index on `day`. No client privileges. |
| RLS and grants | Same as `site_enquiries`: RLS on; `public`, `anon`, `authenticated` lose everything; `authenticated` gets `select` back, limited by the `*_owner_read` policies to the workspace owner; `service_role` gets all. Browsers cannot write. |
| `public.makeborne_record_site_view(p_slug, p_path, p_referrer, p_country, p_device, p_visitor, p_stamp bigint, p_signature) → jsonb` | `volatile security definer`, `search_path=''`. Execute: `anon`, `authenticated`, `service_role` (not `PUBLIC`). Checks, in order: secret configured (`MB503`); no null argument (`22023`); `abs(now_ms - p_stamp) <= 120000` (`MB408`); signature (`MB401`); input shape (`22023`); site exists and is live (`MB404`). Then upserts the visitor row (cap 200), the day row (`visitors + 1` only for a new visitor hash) and one breakdown row per dimension (cap 300, then `(other)`; `(direct)` and `(unknown)` for empty referrer and country). Returns `{"recorded": true}` or `{"recorded": false, "reason": "visitor_cap"}`. |
| `makeborne_private.purge_site_view_visitors(p_artifact uuid default null) → bigint` | Deletes visitor hashes older than two UTC days (all sites) and daily totals and breakdowns older than 400 days (one site, or all sites without an argument). Returns rows removed. No client privileges. |

The signed string is exactly:

```
p_stamp::text || '.' || p_slug || '|' || p_path || '|' || p_referrer || '|' || p_country || '|' || p_device || '|' || p_visitor
```

The database compares signatures as HMACs of both values ("double HMAC"), because PL/pgSQL has no constant-time comparison; the timing of the final comparison then reveals nothing an attacker can steer. The day counted is the UTC day of `p_stamp`, the same day the Worker used for the visitor hash. PostgREST returns these errors as HTTP 400 with the SQLSTATE in `code`; the Worker logs that code.

## Operator setup

Analytics needs the same secret in two places. Never commit it, paste it into a ticket or put it in a `NEXT_PUBLIC_` variable.

1. **Generate** a random secret of at least 32 characters, for example:

   ```
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Use a different secret for staging and production. Do not reuse `FORMS_SIGNING_SECRET`.
2. **Database** (through the reviewed release process, after the migration is applied): run as the database owner in the SQL editor or the release psql session, pasting the value only into that session:

   ```sql
   insert into makeborne_private.site_analytics_key(secret) values ('<the secret>')
   on conflict (singleton) do update set secret = excluded.secret;
   ```

   Check it without printing it: `select length(secret) >= 32 from makeborne_private.site_analytics_key;`
3. **Worker**: store the same value as a secret (read from stdin, never as a `vars` entry):

   ```
   cd infra/customer-sites
   npx wrangler secret put ANALYTICS_SIGNING_SECRET --env staging      # staging value
   npx wrangler secret put ANALYTICS_SIGNING_SECRET --env production   # production value
   ```

   The pre-production secret check in [WEBSITE_ENQUIRIES.md](WEBSITE_ENQUIRIES.md) currently expects only `SUPABASE_PUBLISHABLE_KEY` and `FORMS_SIGNING_SECRET`. Once analytics is enabled, `npx wrangler secret list --env production` should list exactly those two plus `ANALYTICS_SIGNING_SECRET`, and never `STAGING_VERCEL_OIDC_TOKEN`.
4. **Rotate** by writing the new value to both places in quick succession (database first). Views signed with the old secret are rejected with `MB401` in between; nothing else breaks.

## Migration and deploy order

1. **Database**: apply `20261014170000_site_analytics.sql` through the reviewed release process. It is additive and needs the earlier `workspaces`, `hosted_sites` and `makeborne_private` migrations. Run `supabase/check-site-analytics.sql` against an isolated copy first (see [Checks](#checks)).
2. **Worker**: deploy the updated Worker (`--env staging`, then `--env production`). Without `ANALYTICS_SIGNING_SECRET` it does not record anything, so this is safe at any time.
3. **Secret**: insert the database row, then set the Worker secret (operator setup steps 2–3). Counting starts with the next page view.
4. **App**: deploy the owner-facing pages (separate change) once numbers appear in staging.

## Rollout

1. In staging, set the staging secret in both places, open `https://release-check.makeborne.site/` in a normal browser, and confirm a `site_view_days` row for today with `views = 1, visitors = 1`. Reload: `views` grows, `visitors` stays 1. A `curl` request and a prefetch are not counted.
2. Watch the staging Worker logs for `site_view_record_error`. `MB401` means the two secrets differ; `MB408` means clock skew or a slow retry; `MB404` means an offline site; `MB503` means the database row is missing.
3. Enable production the same way, then watch the error rate and the database load for a day before showing the numbers to owners.

## Rollback

Choose the smallest step that is enough:

- **Stop counting** (keeps all data): `npx wrangler secret delete ANALYTICS_SIGNING_SECRET --env production`. The Worker skips analytics immediately. Alternatively delete the database row; the Worker then logs `MB503` for each view, so removing the Worker secret is quieter.
- **Remove the Worker code**: redeploy the previous Worker version. Serving is unaffected either way.
- **Database**: the migration is additive; leave it in place. If it must be removed (this deletes all analytics):

  ```sql
  drop function public.makeborne_record_site_view(text, text, text, text, text, text, bigint, text);
  drop function makeborne_private.purge_site_view_visitors(uuid);
  drop table public.site_view_breakdowns;
  drop table public.site_view_days;
  drop table makeborne_private.site_view_visitors;
  drop table makeborne_private.site_analytics_key;
  ```

## Retention

| Data | Kept | Removed by |
| --- | --- | --- |
| Visitor hashes (`makeborne_private.site_view_visitors`) | Today plus the two previous UTC days | `purge_site_view_visitors`, run by the first counted view of each site each UTC day (all sites' old hashes are removed then) |
| Daily totals and breakdowns | 400 days | the same call, for that site |

A site that stops receiving views is not purged by the opportunistic call. To cover it, schedule a daily global purge as the database owner, for example with `pg_cron` if the project enables it:

```sql
select cron.schedule('purge-site-analytics', '17 3 * * *', $$select makeborne_private.purge_site_view_visitors()$$);
```

Or run `select makeborne_private.purge_site_view_visitors();` from the release runbook. Deleting a site deletes its totals and breakdowns (cascade); its visitor hashes expire with the two-day purge.

## Privacy notice text for site owners

Owners are responsible for their own privacy notice. They can adapt this paragraph:

> This website is hosted by Makeborne, which counts visits to help us understand how the site is used. Counting happens on the server when a page is delivered. No cookies are set and nothing is stored on your device. To count unique visitors, your IP address and browser identifier are combined with the date and a secret key into a one-way code that changes every day. The IP address itself is not stored, and the daily code is deleted after two days. We see only totals: the number of visits and visitors, the pages opened, the website that linked here, the country of the connection and the type of device. Automated traffic is filtered out where it can be recognised.

Makeborne should also describe this processing in its own privacy policy and data processing terms before enabling it in production. Whether a site owner needs consent depends on their jurisdiction; this design avoids device storage and stores no direct identifiers, which keeps that assessment simpler, but it is not legal advice.

## Checks

- **Database** (`supabase/check-site-analytics.sql`): shape, definitions, comments and indexes; not configured (`MB503`); a single secret row of at least 32 characters; valid signed views; visitor deduplication; `(direct)` and `(unknown)` defaults; bad, tampered, replayed, uppercase and foreign-key signatures (`MB401`); stale and future stamps (`MB408`); 14 malformed inputs (`22023`); offline and unknown sites (`MB404`); the 200-view visitor cap; the 300-value cap with `(other)`; retention per site, global and once per site per day; grants; `anon` can record only with a valid signature; owner-only reads; browser roles cannot write; cascade on site removal. It runs in one rolled-back transaction, with a throwaway secret inserted inside it, on the isolated local database only:

  ```
  # composed input: BEGIN; <migration body without its begin/commit>; <check without its begin> (ends in ROLLBACK)
  docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < composed.sql
  ```

  Never run it with `supabase db push`, `supabase link` or against a cloud database.
- **Worker** (`infra/customer-sites/check-analytics.mjs`, run by `node scripts/run-checks.mjs`): with every outbound call mocked, it checks that exactly one view is recorded per 200 or 304 GET document on slug and custom hosts; that nothing is recorded for HEAD, files, robots, `/_mb/*`, 404, 503, 405, enquiries, redirects, bots, previews, prefetch, prerender or non-document fetches; that the payload has exactly the contract fields and no IP, User-Agent, cookie or query string; that the signature equals a Node-computed HMAC over the exact contract string and a pgcrypto test vector; the referrer, device, country and path rules; the secret, client-IP and local-namespace switches; and that serving is unchanged and logs stay free of personal data when the RPC is rejected, fails, throws or hangs. It also runs the bundled Worker in a local workerd to confirm `waitUntil`, Web Crypto and the outbound call in the real runtime.
