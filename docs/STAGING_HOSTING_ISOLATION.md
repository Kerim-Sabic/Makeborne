# Customer-hosting staging isolation

Prepared locally on 2026-10-13. **Not deployed.** This replaces the proposed shared wildcard configuration; it does not certify DNS, TLS or a live release.

## Address boundary

| Environment | Allowed public hosts | Database | Application |
| --- | --- | --- | --- |
| Staging | `release-check.makeborne.site`, `release-check-renamed.makeborne.site` only | Separate staging project `xzwikrunwpurxnxgkznh` | Explicitly pinned staging preview |
| Production | Ordinary customer labels; both QA labels excluded | Production project `rklojnmmsmhwnkbzuidp` | `https://makeborne.com` |
| Local | Explicit localhost configuration only | Loopback database only | Loopback application only |

Staging has two exact Worker routes, no apex and no wildcard. Production keeps the wildcard and apex, with a request-level QA exclusion even if an exact route is missing. The most specific Cloudflare route wins, but the code checks authority before redirects, cache, forms, robots or database reads. The legacy Pages redirect also rejects both QA labels. Host and forwarding headers cannot choose an environment. Cached assets are partitioned by namespace.

Hostname *syntax* stays separate from who may claim an address: QA labels remain syntactically valid for compilation and serving. Each production customer can still create multiple uniquely named sites; the two reserved labels are the only new restrictions there.

## Three independent controls

1. **Database migration 56:** defaults to production reservation. It aborts without taking ownership if either QA label already exists in sites, reservations or preparations. Private triggers enforce every persisted claim, including old application callers. Staging is an explicit database-owner choice limited to one existing QA workspace. Browser, service and compiler-worker roles cannot configure it.
2. **App server:** `MAKEBORNE_HOSTING_NAMESPACE=staging` requires the exact staging Supabase URL and `MAKEBORNE_STAGING_QA_WORKSPACE_ID`. Omission on the known staging database or an invalid mode disables publication. The API returns allowed labels to the UI. Request flags and public environment variables cannot authorize the namespace. Existing status reads and taking sites offline remain available.
3. **Worker:** `SITE_NAMESPACE=staging` requires its pinned staging bindings, exact two hosts and indexing off. Production cannot serve those QA hosts or redirect its legacy paths to them. Unknown/mixed bindings fail closed. The operator must update and review the pinned staging application origin when moving to a new candidate preview.

## Coordinated staging cutover — not executed

1. Freeze the matching app, Worker, migration and test evidence. Re-read the live staging route list before any mutation. Confirm both QA names are unowned in **each** relevant database and the retained address/preparation history; never delete someone else's site to free them.
2. Drain old staging publication work. Back up staging and apply the reviewed pending migrations to the explicitly addressed staging database. Do not use the CLI's production link. Existing ordinary staging sites stay stored; under the new exact routes they will no longer be public.
3. In a database-owner session connected to staging, opt in the intended existing QA workspace:

   ```sql
   select makeborne_private.configure_site_address_namespace('staging', '<existing-QA-workspace-UUID>');
   ```

   Inspect the returned mode and workspace. Active incompatible preparations or an ownership conflict must be resolved before retrying; do not disable the guard.
4. Build the candidate staging app with the staging database and server namespace/workspace settings. Keep trusted publication disabled until its remote executor, output storage and durable supervision have separate qualification. Configure the exact candidate redirect URLs and refresh only staging's form credentials when needed.
5. Review the new preview origin and pin the staging Worker to it. Replace the staging wildcard/apex routes with the two exact QA routes. Confirm proxied DNS and valid TLS for both. **Do not move production's wildcard/apex to staging.** No production deployment is authorized by this checklist.
6. Publish on the first QA label; check menus, animation, scripts/assets, forms into the QA inbox, direct links and denied unknown paths. Rename to the second label and verify the intended old-address behavior. Try both labels against the production-configured Worker and its legacy redirect: neither may serve or redirect to QA.
7. Repeat sign-in, uploads, PDF/PPTX exports and release recovery against this exact app candidate. Save observed results separately from mock/local checks.

## Recovery

Keep the namespace guards during app rollback; earlier compatible app code cannot bypass the database trigger. Do not roll the staging Worker back to the historical wildcard configuration. A failed staging cutover should leave only the two exact QA routes or return them to an explicit unavailable response. Do not route QA to the production database. Existing customer routes are not a staging fallback.

Switching the database back to production mode deliberately refuses while QA ownership/history remains. Do not purge that history or drop the guard for a quick rollback. Keep staging mode and repair/roll forward, or use a reviewed isolated restore. The compiler worker must still pass its independent runtime and recovery gates.

## Evidence limits

Local SQL, app route, browser UI and workerd tests prove their respective code paths. They do not prove actual Cloudflare route precedence, live DNS/TLS, production ownership availability, provider credentials, or a new staging deployment. Those remain explicit cutover checks.

References: [Cloudflare route matching](https://developers.cloudflare.com/workers/configuration/routing/routes/) and [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).
