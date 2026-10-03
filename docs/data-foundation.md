# Data foundation

## Current status

The migration was created with the Supabase CLI after reading command help. It is **not applied to any database**. No credentials were read, no cloud project was linked, and tenant policies have not been exercised against a running Supabase instance. This file describes implementation groundwork, not verified production capability.

`src/lib/domain.ts` owns Zod contracts for clients, projects, source records, style profiles, canonical artifact content, immutable versions, and generation jobs. UI records use camelCase; PostgreSQL columns use snake_case. The persistence adapter must map explicitly and validate both inputs and restored state. Client-side local persistence is a preview mode, not cloud storage.

## Access design

- Workspace ownership is an authoritative database field. Editable user metadata never grants access.
- Owners can manage editor/reviewer memberships. Reviewers can read their workspace and submit attributed version reviews; they cannot modify projects or snapshots.
- Composite foreign keys prevent attaching a project, artifact, source, review, or job to records in another workspace.
- Every application table has RLS. Unauthenticated callers receive no table grants or storage policies.
- Snapshot rows have select/insert grants only for authenticated editors. A trigger rejects snapshot updates, including worker updates. Parent versions must belong to the same artifact and precede the new version. Financial, job, release, and audit mutations are restricted to the trusted worker role.
- Private, fixed-search-path membership helpers avoid recursive RLS without placing security-definer functions in the exposed schema.
- Asset bucket is private. Paths start with a workspace UUID, followed by an asset UUID and immutable file name. Storage read/insert policies check membership; client overwrite and deletion policies are absent. Revisions create new objects. Asset records are append-only for application callers. Privileged retention must inspect references before deletion.
- Version asset manifests are UUID arrays. An insertion trigger requires every referenced asset to belong to the artifact's project and workspace. Arbitrary content JSON still requires server-side schema and reference validation before rendering or publishing.
- Ordinary application callers cannot delete projects or artifacts and thereby cascade-delete snapshots. Archive records instead. Privileged account/retention deletion remains a separate disclosed workflow.
- SQL bounds exposed text and JSON sizes; API and upload limits are additionally necessary. Workspace update grants allow only the name column, preventing client mutation of owner or primary identity.
- Public releases require a separate server adapter returning only the approved release projection. The schema grants no public access to private project records.
- Guest/client project access is intentionally not implemented through broad workspace membership. Do not invite external clients as workspace reviewers to simulate a restricted client portal. Add explicit assigned-project capabilities and isolation checks before enabling that feature.

## Authentication integration

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` through deployment configuration. These helpers use only the public key. The browser helper throws a clear unavailable message when configuration is absent. Server helpers are marked server-only and use verified Auth lookup, not an unverified session cookie.

The root `src/proxy.ts` must invoke `updateSession` from `src/lib/supabase/proxy.ts` for authentication routes and private cloud pages. It refreshes verified claims and carries response cookies forward. Never cache session-bearing responses publicly. Cookie writes from server components are performed by the proxy; route handlers and server actions may write directly.

Privileged worker clients must be separate server-only modules. Validate tenant context, roles, costs, and allowed state transitions before using worker privileges. Never expose privileged keys in a `NEXT_PUBLIC_` variable.

## Database activation procedure

1. Install/locate the Supabase CLI and inspect current command help.
2. Initialise a local Supabase project and start an available local database, or use an authorised isolated cloud development project.
3. Apply the migration in that environment. Generate database types after it applies.
4. Exercise owner/editor/reviewer/anonymous and two unrelated workspaces against each CRUD path and storage path. Include forged workspace IDs, cross-workspace foreign keys, membership revocation, immutable-version updates, and worker-only tables.
5. Check database advisors, policy execution plans, and schema constraints; fix issues before enabling cloud UI.
6. Implement transactional optimistic artifact changes, job/budget reservation operations, and durable workers. Merely defining reservation tables does not implement atomic spending controls.
7. Reconcile initial creation, account deletion/retention, public releases, guest access, and migrations before production use.

Database backups do not include actual storage objects. Backup and restore assets independently, then validate referenced versions and exports.

## Documentation consulted

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- Installed Next.js documentation for asynchronous cookies.

Consulted during implementation on 2026-10-03. Live authentication, RLS, storage, and restore verification remain pending configuration.

## Static security review

Reviewed ownership insertion/update checks, membership mutation, attributed reviews, compound tenant/project foreign keys, storage prefixes, snapshot deletion/overwrite paths, payload sizes, and session cache headers. Fixed indirect snapshot deletion through editable parents, asset overwrites, unbounded text/JSON, job/artifact project mismatch, and unconstrained snapshot asset manifests. Neither private helper functions nor policies use user-editable JWT metadata.

All SQL findings are from inspection only. Docker's local engine was unavailable and no authorised database credentials are configured. Run the activation matrix before treating these policies as verified. Token revocation semantics, transactional budget reservation, immutable release/content publication, guest access, source removal propagation, and reference-aware retention are still future work.

## Cloud CRM milestone

Implemented server routes, owned API contracts, explicit mappings, verified-user authentication, authoritative workspace membership checks, and additional SQL for atomic snapshots. These are implementation artifacts, not a claim of a configured cloud service.

Cloud activation requires **all** of:

- Valid Supabase URL and publishable key.
- `MAKEBORNE_CLOUD_ENABLED=true`.
- `MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED=true`, set only after the live isolation matrix passes.
- The authenticated schema probe returns `20261003_cloud_v2`.

Neither key presence nor the existence of SQL files activates cloud storage. No migration is applied automatically. These routes use the signed-in user's public-key client, not a service key, so RLS remains active for normal queries. Error messages omit database details and tokens. Responses have `private, no-store` and `Vary: Cookie`.

### Endpoint contract

| Endpoint | Operation |
|---|---|
| `GET /api/workspaces` | List RLS-visible workspaces with authoritative role |
| `POST /api/workspaces` | Create a workspace owned by the verified user; body `{name}` |
| `GET /api/cloud/workspaces/:workspaceId` | Return workspace, clients, projects, artifacts and explicit collection pagination |
| `POST .../:workspaceId/clients` | Create a validated canonical client |
| `PATCH .../:workspaceId/clients/:clientId` | Change allowed client fields using required `expectedUpdatedAt` |
| `POST .../:workspaceId/projects` | Create canonical project plus audience/purpose/wording |
| `PATCH .../:workspaceId/projects/:projectId` | Change permitted metadata using required `expectedUpdatedAt` |
| `POST .../:workspaceId/projects/:projectId/artifacts` | Create an empty artifact matching the project format |
| `GET .../:workspaceId/artifacts/:artifactId` | Return canonical artifact and immutable versions, 50 per page |
| `POST .../:workspaceId/artifacts/:artifactId/versions` | Save content/style/asset manifest atomically with `expectedVersion` |

Workspace collections return 200 rows per page with exact totals and next offsets. Query `clientsOffset`, `projectsOffset`, and `artifactsOffset` independently. History uses `offset`. Clients include `updatedAt`; cloud projects additionally include `audience`, `purpose`, and `wording`. All canonical fields use camelCase on the API. Current cloud creation supports the three base style IDs; custom saved-style administration is not implemented by these routes.

Version save body: `{expectedVersion, content, style, assetIds, changeSummary}`. Successful response: `{artifact, version}`. A conflicting expected revision returns HTTP 409 and `error.code=REVISION_CONFLICT`. Permission denial is 403; missing authentication is 401; cloud activation/schema failures are 503. Invalid IDs and bounded-input failures are 400. CRM timestamp conflicts may also represent deleted/unavailable records and instruct a reload rather than disclose unrelated records.

The second CLI-created migration adds server-managed millisecond timestamps so timestamp comparison survives JavaScript date conversion. Partial updates deliberately use schemas without creation defaults: omitted fields do not reset existing values.

### Atomic revision protocol

An exposed **security-invoker** wrapper calls a private fixed-search-path implementation. The private implementation explicitly checks current editor/owner membership, locks the scoped artifact, compares expected revision, validates content/style/project references, inserts the immutable snapshot and advances the revision pointer in one transaction. A stale concurrent request raises `40001` and does not overwrite work.

Direct authenticated snapshot insertion and current-version updates are revoked. Snapshot assets and source references must belong to the artifact's project; source permission and approval interpretation remains a separate publication decision. Revisions do not publish or change an already approved release. Version history restores should submit the selected prior content as a **new** revision using the current expected number.

No automatic local-to-cloud upload exists. Current UI import must be explicit and limited to supported text records until the storage/asset adapter is implemented. Inline images, local history, and custom references must not be silently discarded or falsely represented as imported. Multiple API creates are not an atomic full-workspace import; interrupted import must retain and disclose partial records.

### Verification state and runner

`supabase/verify-isolation.mjs` is an activation aid, not executed evidence. It requires isolated workspace/project fixtures and session tokens through environment variables, never logs tokens, and stops when positive controls fail. Without configuration it exits 2 as **NOT RUN**. Read-only checks also exit 2 when mutation checks are skipped.

Set `MAKEBORNE_VERIFY_DISPOSABLE_MUTATIONS=true` only for authorised disposable development fixtures. It then verifies forbidden tenant writes, reviewer writes, owner mutation, direct pointer/snapshot changes, deletion, and two concurrent revision saves. The temporary verification artifact remains for inspection and approved cleanup. Storage paths, revocation, malformed content, source/asset foreign references, API browser behaviour, account lifecycle and restoration still require the wider matrix.

Do not set the migration-verified flag from this script alone. Database syntax/execution, role semantics, policy/advisor results and the complete activation matrix remain unverified while no database is available. No paid provider calls are part of this milestone.

## Idempotency and uncertain outcomes

The third CLI-created migration is **unapplied**. Every workspace/client/project/artifact creation and every version-save POST now requires an `Idempotency-Key` UUID header. A browser must preserve this key, account, route and exact body across an uncertain outcome. Generating a new key on retry defeats protection. API bodies otherwise retain their prior contracts.

The database scopes receipts by authoritative actor, workspace and operation. It hashes canonical JSONB payloads with PostgreSQL SHA-256. A create and its receipt commit together; a save and its immutable version commit together. Concurrent same-key requests replay one committed result. Same key with different content returns HTTP 409 `IDEMPOTENCY_CONFLICT`. Different keys still use expected revision CAS for snapshots. Original receipt results may predate later edits: reload current work after a replay before editing it.

Workspace setup uses an actor-scoped receipt, an authoritative account-row lock and a unique owner index. One user owns one private workspace in this initial setup model; memberships in other workspaces remain separate. An existing workspace requested with another creation key returns HTTP 409 `WORKSPACE_EXISTS`; the UI must reload its workspace list. An upgrade with pre-existing duplicate owned workspaces cannot apply the unique index without an explicit reconciliation decision.

Current authoritative editor/owner access is checked before any replay lookup. Workspace creation replay additionally requires current ownership of the committed workspace. Direct authenticated creates and direct non-idempotent snapshot writes are revoked; exposed wrappers are security invoker and privileged implementations remain in the private schema.

Replay response payloads expire after 30 days. The privileged pruning function clears payloads, retaining durable key/hash/resource tombstones. Expired keys return HTTP 410 `IDEMPOTENCY_RESULT_EXPIRED`; they cannot silently create another record. There is no automatic receipt deletion or key reuse. Workspace deletion and account retention require a separately approved lifecycle workflow.

Receipts have SQL payload limits, a default rolling daily cap of 2,000 new committed operations per workspace, and a default lifetime cap of 100,000 receipts. Trusted operators can adjust server-owned caps within schema bounds. Caps reject new writes without freeing old keys; replay within its window does not consume another receipt. Workspace creation receipt history has an additional bounded actor limit. These are initial operational safeguards, not measured production sizing.

Unknown storage/network outcomes return HTTP 503 `CLOUD_OUTCOME_UNKNOWN` and instruct preservation of the draft and request key. Do not infer rollback from a failed HTTP response. Metadata PATCH operations use timestamp CAS and require latest-record inspection after an uncertain result; they do not append an extra immutable version. Idempotent imports are sequences of protected creates, not a single atomic multi-record workspace import.

The isolation runner now includes same-key concurrent creation, conflicting payloads, revision replay and an optional fresh-account workspace race fixture. It returns a skip exit when fresh-account verification is absent. Actual execution against PostgreSQL and browser response-loss/revoked-access checks remain pending. Static TypeScript checks cannot prove SQL transactions or RLS behaviour.
