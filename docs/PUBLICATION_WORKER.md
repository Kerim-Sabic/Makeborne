# Publication service: activation contract

The controller runs on a dedicated supervisor host; production activation remains withheld. The web app does not run compilation in a request handler. The integrated staging qualification and its exact limits are recorded in [the 21 October report](release-review/production-publishing-integration-20261021.md). The older evidence below is historical and does not imply production activation.

## Implemented components

- `publication-supervisor.mjs` discovers at most ten durable preparations per poll, executes one at a time, and waits five seconds even after contention. Control failures back off to sixty seconds. Restarting discovers queued work and expired leases from SQL. Fenced SQL claim/complete remains authoritative across multiple processes.
- `publication-control.mjs` maps nine allowed logical calls to the dedicated worker RPCs, including lifecycle events and cleanup claims/results. Every call uses one checked-out PostgreSQL connection, a transaction-local worker role, five-second statement timeout, two-second lock timeout and ten-second overall deadline. Values are bound parameters. Errors, cancellation and ambiguous commit destroy the connection. Late pool acquisitions are released.
- `runPublicationPreparation` validates saved source/artwork and refreshes authority before creating a per-claim executor. Its factory receives only preparation ID, worker ID, fence and the database lease deadline. Control/storage credentials never enter generated code.
- Migration55 creates a `NOLOGIN`, `NOINHERIT`, non-administrator role with bounded discovery and claim/load/asset-locator/complete/fail access. It has no table access, request permission or promotion permission. Existing service RPC permissions are unchanged.
- `vercel-publication-*` prepares isolated compiler and renderer transport. Its injected SDK checks are not evidence of live cloud execution. Review its own qualification report before using it.
- Migration57 retains sandbox intents independently of project/account deletion. Only confirmed-stopped records can age out after thirty days; each cleanup poll removes at most one hundred. Cleanup has its own lease and fence. Missing provider responses, 404s and expected expiration never count as confirmation that a resource stopped.
- `publication-journal.mjs` validates the database acknowledgement before allowing creation, including immutable identity and microsecond lease timestamps. Recovery claims one resource at a time and only stops it; it never resumes work. A known session ID must match the retrieved session before any stop. Unresolved cleanup blocks new work even while retry backoff or another cleanup lease is active. Valid active peers are excluded by SQL.
- `publication-controller.mjs` composes the restricted control channel, persistent journal, per-claim executor and supervisor. Cleanup runs before discovery and before every new candidate, so an earlier candidate's cleanup failure cannot be bypassed by the next one in the queue. This is host composition with injected dependencies, not a provisioned server or credential bootstrap.

## Required operator configuration before any activation

1. Apply the final frozen migration chain to the isolated staging database, after the normal/failure/interruption rehearsal. Do not apply migration55 alone to an older schema.
2. Create a dedicated login with no administrator flags or unrelated memberships. Grant only the worker role with explicit `SET ROLE` authority. The migration deliberately creates no login or password. Never substitute the database owner, `service_role`, or a Supabase server key for this credential.
3. Use a pinned explicit `pg` runtime dependency, verified TLS and a pool with `max: 1`, `connectionTimeoutMillis: 5000`, and an idle-client error handler that emits only a sanitized code. Confirm the authenticated login and grants on the actual cloud connection. Pooler compatibility and TLS still need live qualification.
4. Provide separately scoped private source reads and immutable retained-output storage. The profile-pinned asset broker accepts signed preparation/worker/fence/asset identities, resolves the original on the app side and rechecks authority after download. The controller holds only its scoped broker key; the Supabase administrator key remains on the app. Use the required verified profile origin. Only staging accepts a header-only deployment protection credential; production rejects it. Never accept a caller-supplied URL or storage path. R2 output credentials stay in the controller. See `release-review/publication-asset-broker-20261013.md`; the actual cloud 20 MB boundary remains unqualified, and the broker defaults off.
5. Qualify both immutable cloud images and their runtime/controller identity mapping. Image digest syntax is not image qualification. Install the exact reviewed Sandbox SDK version as an explicit service dependency. Confirm the account's compute entitlement and approve a bounded compute allowance before creating cloud sessions.
6. Use the persistent SQL lifecycle journal and controller composition above. The callback durably saves `creating` before allowing the provider call and retains unresolved outcomes across process/host restarts. An in-memory map, ordinary log callback or ephemeral filesystem does not satisfy this contract. Cleanup uses the recorded random sandbox name with `resume: false`; never resume unknown work. A not-found response immediately after ambiguous creation is not proof that nothing was created. Monitor unresolved records and investigate persistent failures; do not delete them or mark them stopped just to reopen the queue.
7. Run the controller under a process supervisor with termination signals wired to an `AbortController`. Pass the same signal into `supervisePublications` and each `runPublicationPreparation`. Give shutdown time for independent cleanup/fenced failure reporting, then rely on the database lease and provider lifetime limit for crash recovery. Never call it as fire-and-forget work from Next.js.
8. Monitor queue age, terminal preparation failures, control outages, unresolved sandbox cleanup, retained-storage failures and process health. The safe event callback contains identifiers and bounded error codes only; do not attach raw exception messages, query arguments, connection strings, workload content or SDK responses.

## Staging and activation gates

Keep staging on its exact reserved QA routes, separate from production wildcard routes. Namespace guards, database-owner-controlled allocation policy (migration56), legacy redirect refusal and cache partitioning are covered by the staged qualification linked above. Follow `STAGING_HOSTING_ISOLATION.md` for route ownership and cutover. Production activation is a separate gate. Never restore the historical staging wildcard on rollback.

Qualify an actual cloud build with retained artwork, every declared page, static/interactive output, restart during compilation, ambiguous create/complete responses, stale fences, revoked access, exhausted attempts and unreachable storage. Verify the approved preview against publicly hosted desktop/mobile output. A provider session's accepted deadline, Chromium OS sandbox and network isolation must be observed rather than inferred from an SDK mock.

Only then enable publication preparation on staging. Production activation, credentials and release still require the separate final approval. No new compute purchase, credential or cloud activation was performed while preparing this package.

## Rollback

Stop discovery first and allow bounded active work to terminate. Keep migrations55–57 and the existing fenced preparation/promotion boundary. Disable preparation when the controller is unhealthy; prior live sites and take-offline controls remain available. Reconcile unresolved sandbox records without resuming them. Do not restore a controller without persistent journaling, browser-produced raw-output publishing, or administrator access to work around a worker outage. This package has no destructive down migration.

## References

- [PostgreSQL SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html)
- [node-postgres pool checkout and release](https://node-postgres.com/features/pooling)
- [Supabase database roles](https://supabase.com/docs/guides/database/postgres/roles)

These references establish platform behavior; local test reports establish only the exercised candidate behavior.
