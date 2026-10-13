# Durable publication sandbox journal — local qualification

Date: 2026-10-13. Scope: local code and the inspected disposable `makeborne_publication_20261013034802` / `rehearsal` database. No cloud, main local database, staging, production, provider, deployment, credential, paid-call, or commit operation.

## Migration and ownership

Migration 57 is `20261013210000_publication_sandbox_journal.sql`. It originated from Supabase CLI `migration new publication_sandbox_journal` (`20261013053110_publication_sandbox_journal.sql`) and was ordered after frozen migration 56. Current qualified SHA256: `3431dbd248339da0114327f6214b148374e348144090b05abd44fd22c3631a39`.

Migrations 55 and 56 were not edited. The existing worker catalog test now explicitly includes the three new RPCs while retaining checks against all other function and raw-table privileges. The controller, executor composition, storage transport, and deployment configuration remain separate parent-task ownership.

## RPC contract

All three public functions are invoker bridges to private, fixed-search-path security definers. They require the existing effective SQL worker role; no browser/service grants, new login, password, role membership, or table access is added.

| Public function | Arguments | Result |
|---|---|---|
| `makeborne_publication_worker_sandbox_event` | `p_record jsonb` | Canonical lifecycle record |
| `makeborne_publication_worker_sandbox_cleanup_claim` | `p_worker uuid, p_limit integer default 10` | `{records:[{record,cleanupFence,cleanupLeaseUntil}],pending:number}` |
| `makeborne_publication_worker_sandbox_cleanup_finish` | `p_name text, p_worker uuid, p_cleanup_fence bigint, p_state text` | Canonical lifecycle record |

`p_limit` is 1–25. The controller should claim one cleanup at a time so work fits the 30-second cleanup lease. Fences are returned as decimal strings. Records preserve exactly the executor fields: preparationId, workerId, fence, leaseUntil, name, kind, image, evidenceSha256, runtimeIdentity, latestExpectedExpiry, state, and optional paired sessionId/providerExpiresAt. Event JSON is bounded at 4,096 bytes; unknown fields and nonstring values are rejected. No source, generated output, URL, SDK credentials, or free-form error payload is stored.

Timestamp identity compares actual PostgreSQL instants. Preserve the authoritative lease string including microseconds: converting it through JavaScript Date can truncate precision. Equivalent timezone formatting is accepted. The expected expiry must be at most lease expiry minus five seconds, and an observed provider expiry cannot exceed that bound.

Errors: `42501` for role denial; `22023` for invalid schema/values; `PT409` for stale lease, forbidden transition, identity change, or attempt/resource limit; `P0002` for a missing journal record. Unexpected database faults propagate.

## Execution and recovery invariants

- A `creating` record requires a currently running matching preparation, worker, fence, and exact lease. The controller must await the committed database acknowledgement before calling the provider. `running` requires the same live authority and an observed session/expiry pair.
- Name, kind, image digest, evidence digest, runtime identity, original claim identity, and deadlines never change. The optional provider session/expiry pair binds once. Exact replay is accepted; stopped is terminal. A stopped replay still verifies every immutable field and the session binding.
- Admission permits at most one compiler and twenty renderer intents per preparation fence. Any unresolved resource for that preparation, including an earlier fence, blocks another creation. Preparation locking serializes admission and fencing; unrelated valid active preparations remain usable.
- Original-attempt cleanup can record stopped/unconfirmed after execution authority expires. Once a recovery cleaner has acquired the row, its separate cleanup fence controls updates. Original writes cannot supersede recovery except an exact already-stopped replay.
- Cleanup discovery includes `cleanup_unconfirmed`, expired execution, missing preparation, and preparations whose current state/worker/fence/lease no longer match the record. A genuinely matching active peer is excluded. Authority lookup takes no reverse preparation lock.
- Cleanup acquisition uses `FOR UPDATE SKIP LOCKED`, increments its own fence, and grants only cleanup authority for thirty seconds. Only stopped or cleanup_unconfirmed may be settled. Exact settlement replay is stable; changing a settled result is rejected. An expired cleanup lease can be reclaimed under a higher fence.
- Pending includes all eligible unresolved records, even during backoff or another cleaner's lease. This prevents a controller from interpreting an empty due batch as a clean recovery state. Retry delays grow from five seconds to at most five minutes; old unknown resources do not consume every discovery slot.
- There is no preparation/account foreign key. Source, artifact, workspace, preparation, or account deletion cannot erase the cleanup obligation. No timeout, expiry, 404, missing response, or retry count is treated as evidence that a sandbox stopped. Only the trusted adapter's confirmed terminal stop event records stopped.
- Each cleanup poll deletes at most one hundred confirmed stopped rows older than thirty days. Unresolved rows remain indefinitely. Their resolution may require operator investigation; the database does not guess provider state.

## Evidence

`publication-sandbox-journal-20261013.json` records ten passing groups using real PostgreSQL sessions and synthetic metadata, with the exact migration hash. Coverage includes actual restricted LOGIN roles, schema/identity validation, concurrent creation, immutable provider binding, terminal replay, per-claim limits, concurrent cleaners, expiry, hidden-backoff pending, orphan/source/account deletion, cross-fence admission in both orderings, stale cleanup rejection, and bounded terminal retention. No Sandbox SDK call occurs in this test.

Read-only catalog assertions verify RLS, zero caller table/snapshot privileges, no cascading FK, three supporting indexes, private definers, invoker bridges, and fixed search paths. Existing restricted worker authority (10 groups), trusted publication (8 groups), address changes (4 groups), and namespace catalog checks passed against the journal-installed disposable. Focused lint is clean.

The real node-postgres driver harness also passed 10 groups. Three new cases exercise the actual cleanup-claim mapping with an empty `{records:[],pending:0}` response, send a mutable image identity through the event mapping and receive SQL `22023`, and receive SQL `P0002` for a nonexistent cleanup-finish record. The existing transaction-role reset, role denial, parameter rejection, queued/running cancellation, and ambiguous commit-response cases still pass. An existing pinned Node image ran in an ephemeral container sharing only the disposable network, with read-only source/dependency mounts and no image pull; its temporary credential-free LOGIN roles were dropped. This local transport check does not qualify production TLS.

Final cleanup verified zero journal rows, preparations, fixture users, temporary test LOGIN roles, and other database sessions. Only the inspected disposable container was stopped and retained; no other container was changed. Migration 57 is handed back at the hash above for the full chain rehearsal.

The full migration-chain normal/fault/interruption rehearsal and integrated controller checks remain parent-task responsibilities. Live provider isolation, immutable image qualification, absolute provider expiry after lost responses, scoped storage, host supervision, TLS, and authorized compute allowance are not proven by these SQL tests.

## Sources consulted

The implementation follows the official [Supabase function security guidance](https://supabase.com/docs/guides/database/functions) for private definers, fixed search paths, and explicit execute grants, and [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) for bounded competing queue consumers.
