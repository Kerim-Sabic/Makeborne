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
