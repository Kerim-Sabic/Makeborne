# Isolated staging address namespace — local qualification

Date: 2026-10-13. Scope: repository changes and the inspected disposable `makeborne_publication_20261013034802` database only. No production, staging, main local database, DNS, account, credential, deployment, provider, or paid-service changes.

## Frozen migration

- File: `supabase/migrations/20261013200000_staging_site_address_namespace.sql` (migration 56).
- SHA256: `9df32055e53e1bd19e257fd33880288515bfd124162c9c618d967f31f6a03972`.
- Created using Supabase CLI as `20261013050435_staging_site_address_namespace.sql`, then ordered after migration 55 as requested.
- Migration 55 remains unchanged: SHA256 `254f1c9d2c2e20e6cd95e7d1b39a9e0aefc820563410559dd2c1db1e20a43e89`.

## Contract and enforcement

The default `production` policy reserves exactly `release-check` and `release-check-renamed`. Other syntactically valid addresses retain existing authorization and publication behavior. This policy is separate from address syntax validation.

An independently configured staging database permits new publication and address claims only for those two labels and one selected QA workspace. SQL does not trust application environment variables, JWT claims, or a caller-supplied namespace. Private row triggers cover `public.hosted_sites`, `makeborne_hosting.site_address_reservations`, and `makeborne_private.publication_preparations`, including legacy/raw saves, trusted request/completion/promotion, rename, and direct table writes.

The configuration function is private, `SECURITY INVOKER`, and requires the effective current role to be the actual database owner. Browser, service, and restricted worker roles receive no configuration function or policy table privileges. The policy table has RLS enabled. Trigger helpers are private security definers with an empty search path and no caller execute grants.

For a separately authorized staging cutover, the database owner uses this template with an already verified workspace UUID:

```sql
select makeborne_private.configure_site_address_namespace(
  'staging', '<verified QA workspace UUID>'::uuid
);
```

The result is `{ "mode": "staging", "qaWorkspaceId": "..." }`. This command has only been exercised with synthetic local fixtures. The application's `MAKEBORNE_HOSTING_NAMESPACE` and `MAKEBORNE_STAGING_QA_WORKSPACE_ID` must agree with this independent database configuration.

Existing ordinary sites are not rewritten. Reads, enquiry/republish metadata changes, disabling interaction, unpublishing unchanged content, and deletion remain possible. Enabling interaction, replacing content, republishing, or changing an address outside the staging namespace is rejected. Reservation deletion remains available for cleanup.

## Collision and concurrency behavior

Migration installation locks the three address-bearing tables while checking collisions and installing guards. Any existing QA site, retained QA address reservation, or QA preparation aborts installation with `MB409`; ownership and data remain intact.

Configuration rejects an invalid workspace with `22023`, incompatible active preparations with `MB409`, and a reassignment or return to production that conflicts with existing QA ownership/history with `MB409`. It does not seize addresses or silently discard work. Drain incompatible queued/running/ready preparations before staging opt-in. Historical QA preparation records can also require explicit cleanup before returning that database to production mode or assigning another QA workspace.

Every checked write holds a shared lock on the policy row. Configuration updates take the conflicting row lock. Two real concurrent-session checks passed: configuration waited for a publisher and then rejected the newly committed incompatible preparation; a publisher waited for configuration and then rejected its ordinary label under the newly committed staging policy. A five-second lock timeout bounds waiting in the policy check/configuration functions.

## Evidence

`site-address-namespace-20261013.json` records the exact migration hash and nine passing functional groups from a clean application in the disposable database:

1. Atomic collision refusal for existing QA site, reservation, and preparation, followed by clean installation.
2. Both QA labels denied by production through actual legacy publication, trusted request, and reservation writes.
3. Actual temporary service/worker LOGIN sessions denied configuration, direct policy changes, and `SET ROLE` to database owner.
4. Both publication/configuration concurrency orderings described above.
5. Invalid-workspace and incompatible-active-work refusal.
6. Existing ordinary staging site read/metadata/interaction-off/unpublish/delete behavior; interaction-on, hidden HTML change, republish, and rename denied.
7. Exact QA workspace and labels enforced; legacy publish plus rename retains both reservations; conflicting reconfiguration refused.
8. Actual trusted QA request, claim, completion, and promotion; direct identity mutations denied.
9. Private helper privileges and policy RLS.

Additional passing checks: existing trusted publication SQL (8 groups), existing address-change SQL (4 groups), restricted worker authority SQL (2 groups), and the new read-only namespace catalog check. Focused ESLint passes without warnings after removing an unused harness helper. Temporary fixture users, sites, workspaces, and LOGIN roles are cleaned up; the policy is restored to production mode.

## Remaining release qualification

This is database qualification, not evidence of a deployed staging environment. The full migration-chain normal/failure/interruption rehearsal is owned by the parent task. A future authorized cutover must coordinate the application guard, independently configured staging database, and Worker exact-host policy; drain old publication calls first. The two fixed first-level staging hosts require route-priority and certificate checks before activation, as described in `publication-cloud-options-20261013.md`. No staging wildcard or apex routing is authorized by this package.
