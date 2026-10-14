# Restricted publication worker authority — 13 October 2026

## Status and owned files

Local SQL package qualified in the previously inspected disposable container `makeborne_publication_20261013034802`, database `rehearsal`, pinned image `public.ecr.aws/supabase/postgres:17.11.0.002`. Before application it held 74 recorded migrations (20 production baseline + 54 candidates), latest `20261013180000`, and zero publication preparations. It had no mounts. No other database/container was modified by this package; no cloud writes, deployed credentials, provider requests, or paid calls occurred.

- Migration: `supabase/migrations/20261013190000_publication_worker_authority.sql`.
- SHA-256: `254f1c9d2c2e20e6cd95e7d1b39a9e0aefc820563410559dd2c1db1e20a43e89`.
- Catalog checks: `supabase/check-publication-worker-authority.sql`.
- Real SQL role, queue, retry and concurrency harness: `supabase/check-publication-worker-authority.mjs`.
- Machine evidence with pinned input hashes: `docs/release-review/publication-worker-authority-20261013.json`.

Supabase CLI 2.119.0 created `20261013043600_publication_worker_authority.sql`; only this newly generated file was renamed to 19:00 so it sorts after the existing 18:00 preparation migration. Migration 54 was not edited. The migration was applied with `psql` against the named disposable only; no linked CLI push/reset or main local database was used. Its migration history was not manually advanced.

## Restricted authority

The migration creates `makeborne_publication_worker` with NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. It creates no login, password, authenticator membership or storage authority. A separately provisioned future SQL login must be granted this role and explicitly `SET ROLE makeborne_publication_worker` on the control connection. That provisioning is outside this local package.

Only the six RPCs below and their private implementations are granted. Public bridges are SECURITY INVOKER; private implementations are SECURITY DEFINER with an empty search path, fully qualified application objects and an explicit SQL-role guard. The guard reads PostgreSQL's protected `role` setting because SECURITY DEFINER changes `current_user`. It does not trust JWT claims or user-controlled custom settings. Its internal assertion helper is not granted to the worker. There is no raw table access, publication request/promote permission, original service bridge grant, or general service-role privilege.

Existing anon/authenticated/service permissions and existing preparation RPC implementations remain unchanged. Catalog checks assert that no unrelated application function is executable by the new role and no application/auth/storage table is accessible to it.

## Contract for the control adapter

Every RPC returns `jsonb`. The public names below are exact.

| RPC | Parameters | Result |
| --- | --- | --- |
| `makeborne_publication_worker_candidates` | `p_limit integer default 10` | Array of `{id}` only; 1–25 requested entries, possibly empty. |
| `makeborne_publication_worker_claim` | `p_preparation uuid, p_worker uuid` | Existing v54 running snapshot including version; `null` when unavailable, already claimed, terminal or authority revoked. |
| `makeborne_publication_worker_load` | `p_preparation uuid, p_worker uuid, p_fence bigint` | Existing v54 fenced snapshot, immutable version content and scoped asset records. |
| `makeborne_publication_worker_asset_locator` | `p_preparation uuid, p_worker uuid, p_fence bigint, p_asset uuid` | One `{id, workspace_id, project_id, object_path, content_type, sha256}` from that preparation's current verified asset manifest. |
| `makeborne_publication_worker_complete` | `p_preparation uuid, p_worker uuid, p_fence bigint, p_receipt jsonb, p_output text` | Existing v54 immutable completion snapshot; exact successful replay preserved. |
| `makeborne_publication_worker_fail` | `p_preparation uuid, p_worker uuid, p_fence bigint, p_error text` | Existing v54 fenced failure snapshot, queued before attempt 3 and failed at exhaustion. |

Use a hardcoded logical-name-to-SQL mapping and parameterized arguments. Forward neither SQL credentials nor locator/storage authority to the compiler or renderer. `p_fence` remains a bigint string at the JavaScript boundary. The locator does not read object bytes or issue signed URLs; it supplies only a validated retained-source locator to a separate trusted download control path.

Error semantics:

- Wrong SQL role or undeclared asset: `42501`.
- Candidate limit null, below 1 or above 25; null claim identity: `22023`.
- Load/complete/fail lease, worker or fence mismatch: existing `PT409`.
- Malformed/mismatched retained completion output: existing `22023`.
- Missing fenced preparation: existing `P0002` except claim's deliberate `null` case.
- Claim catches only the original authority errors `42501`, `MB402`, `P0002`. It marks a still-queued or expired-lease row failed (expired if lifetime ended), records `PUBLICATION_AUTHORITY_UNAVAILABLE`, and returns `null`. The failed inner subtransaction releases its authority locks first; the terminal update cannot overwrite a newly active lease.
- Other database faults propagate. Candidate cleanup has no exception-swallowing handler.

## Durable discovery and retry behavior

Discovery uses the existing preparation table, not another queue or a request-handler background task. It first retires at most 100 unlocked queued/expired-lease rows whose lifetime ended or attempts reached 3, using `FOR UPDATE SKIP LOCKED`. It never changes ready/promoted output. It then returns at most 25 eligible identifiers in deterministic oldest `updated_at,id` order. Active leases, terminal states, expired work and exhausted attempts cannot occupy candidate slots even when additional cleanup remains.

Partial dispatch and expiry indexes cover queued/running preparations. Discovery does not claim or lock returned candidates; competing supervisors may discover the same identifier and the existing claim fence decides the winner. A failed run updates its timestamp, allowing other waiting rows to progress. An abandoned third lease is terminalized by the next discovery call without requiring a failure callback. Revoked authority before claim becomes terminal rather than starving every poll.

The result count and mutation count are bounded, but that is not a hard bound on planner scan time for arbitrarily large queues. The trusted SQL control connection still needs statement/query timeouts, a bounded pool and bounded supervisor concurrency. The new role is not a qualified cloud compiler, renderer or hosted supervisor. No production execution service was provisioned by this work.

## Verification evidence

`node supabase/check-publication-worker-authority.mjs makeborne_publication_20261013034802` passed 10 groups on 2026-10-13 at 04:44:59 UTC:

1. Exact role attributes, six public/private grants, fixed search paths and zero raw/unrelated application authority.
2. Real dedicated LOGIN connection requires SET ROLE; three separate disposable LOGIN connections with anon/authenticated/service memberships cannot assume worker or forge access with JWT settings. Raw tables, original claim, request and promotion are denied.
3. Concurrent claims yield one winner. Active lease is excluded, expired lease rediscovered, reclaim increments the fence, and stale/cross-worker/foreign-asset access is denied.
4. Completion stores ready output, exact completion replay is preserved, and late failure cannot overwrite ready output.
5. Three claim/failure cycles terminate retries.
6. Third abandoned lease is failed by discovery.
7. A 105-row expired backlog is cleaned in 100+5 batches while usable work is immediately returned; ready output remains unchanged.
8. A larger valid queue produces exactly 25 identifiers with stable ordering and no source or actor content in the discovery response.
9. An injected unexpected `XX000` cleanup trigger error escapes and rolls back. Retrying after the test transaction disappears cleans up normally.
10. Revoking the originating session before claim removes the unusable request from future discovery.

The original `supabase/check-trusted-publication.sql` also passed all 8 groups after applying this migration. Focused ESLint and whitespace checks passed. The test harness cleans up its randomly scoped synthetic data and temporary login roles in `finally`; it uses TCP loopback inside the disposable container's existing trust configuration and creates no passwords. The fixture was left running for the separately coordinated real node-postgres transport probe; its owner will stop only this container afterward. Broader 55-migration full/fault/interruption rehearsal is owned by the root task and is separate evidence.

## Primary guidance consulted

The implementation follows Supabase's separation of roles and logins, and the recommendation to keep privileged functions outside exposed schemas with explicit grants and fixed search paths: [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles), [database functions](https://supabase.com/docs/guides/database/functions). The local Supabase and Postgres skills were read before implementation; their restricted privilege and `SKIP LOCKED` guidance was applied. No remote advisors were invoked against an account.
