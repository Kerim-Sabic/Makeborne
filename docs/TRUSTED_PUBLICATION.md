# Trusted website publication

## Current qualification

Implemented locally in the uncommitted candidate, including migration `20261013180000_trusted_publication_preparations.sql` (candidate migration 54). Production and the older staging deployment are unchanged. `MAKEBORNE_TRUSTED_PUBLICATION_ENABLED` defaults off. Turning it on alone does not create a publication worker.

Follow-up adds migration55 `20261013190000_publication_worker_authority.sql`, bounded discovery, a restricted SQL control adapter and sequential supervisor. The prepared Vercel executor has only injected-transport qualification. See `PUBLICATION_WORKER.md` for required real hosting, durable journaling, images, credential and activation checks, and `release-review/publication-delivery-integration-20261013.json` for the latest55-migration rehearsal. No56th admission migration is needed: real concurrent tests confirmed the existing workspace lock and one-owned-workspace invariant enforce the actor cap.

The operator Docker/compiler and browser adapter passed local qualification. They are not a qualified production service. A production executor still needs an independently enforced resource and network boundary, durable queue delivery and storage, monitoring, cancellation and crash recovery qualification. Do not run customer compilation inside a Next request handler or give generated code the control connection or storage credentials.

## Customer flow

1. Save the project. Request preparation using only version, current publication revision, chosen address, interactive mode and a stable request identity.
2. The server verifies the current user/session and creation access. SQL stores an immutable preparation bound to the saved version and expected live revision.
3. A worker claims a bounded, fenced lease. The worker loads original source and scoped artwork locators, verifies file sizes, hashes and raster types, then compiles in the pinned runtime. No AI provider call is needed.
4. An independent browser controller captures the retained build on every declared route. It verifies image/font readiness and uses the customer hosting policy. Project-emitted snapshot messages are ignored. Lazy-loaded route stylesheets remain attached to their route.
5. Completion stores exact serialized output and its digest with the receipt. It does not replace the current live site.
6. The customer reviews a sandboxed static preview of those prepared pages and explicitly approves. Approval submits a preparation identifier and acknowledgement only.
7. Promotion rechecks session, ownership, membership, source version and publication revision, then atomically publishes the retained output. A lost response can be replayed without another revision increment.

Reload/status polling does not compile, publish or contact a model. Changed content, address or mode requires a new preparation. Failed preparation/promotion leaves the previously published page intact. An owner can still take a site offline while new preparation is unavailable.

## Service contract

- Request/status/promote: `src/lib/projects/publication-server.ts` and the publication API routes.
- Worker entry: `runPublicationPreparation` in `publication-worker.ts`. It accepts a restricted RPC control adapter, qualified compiler/renderer, retained object store, fenced original-artwork resolver and trusted address formatter.
- Source artwork: `publication-assets.ts`. Storage reads are allowed only after the SQL resolver authorizes the original object locator; bytes and authority are checked again before compilation.
- Runtime/operator adapter: `infra/project-runtime/publication-adapter.mjs`. Pin its runtime image digest and renderer/controller digest from a separately reviewed qualification record. Do not discover and trust arbitrary runtime identities at production startup.
- SQL lease: five minutes, fenced against late results. Maximum three attempts; preparation expires after 24 hours. A supervisor must retry eligible queued/expired-lease work and monitor terminal failures.
- Output: six exact fields (`html`, `isolatedHtml`, `script`, `files`, `interactive`, `routes`). SQL verifies its digest, manifest and exact saved route set. No raw browser-produced snapshot, script or receipt can be promoted.
- Hosted route lookup: `makeborne_read_hosted_site_v3(slug,path)`. Trusted sites serve only declared routes; old publications keep their compatibility behavior.

## Cutover and recovery

1. Freeze and pin the complete candidate only after all active contributors hand back their files. Record the new migration and application/Worker identities. Rehearse the exact upgrade and recovery, not only this migration in isolation.
2. Drain/disable old publishing requests and in-flight jobs. Merely replacing the SQL function does not terminate an already executing old function body.
3. Apply migration 54 forward after the previously qualified chain. Existing live bytes and legacy readable addresses remain intact. Full-source raw-output publication is deliberately refused after this migration.
4. Deploy the matching customer Worker and app with preparation disabled, preserving old sites and offline controls. Validate exact-route reads and legacy compatibility.
5. Provision and qualify the isolated durable worker, immutable storage and delivery supervisor. Test crashes, expired leases, stale versions, revoked sessions, concurrent promotion and inaccessible storage on isolated staging. Confirm the final displayed preview matches hosted output at mobile/desktop sizes.
6. Enable preparation only after that whole staging path passes. Production activation still requires separate approval.

Recovery must retain the service-only preparation/promotion boundary and matching offline controls. Do not restore raw browser bundle promotion. Leave the flag off if the worker is unhealthy; existing live sites remain available. There is no destructive down migration or automatic republish of existing sites.

## Local evidence

- `trusted-publication-sql-20261013.json`: fresh pinned chain replay, 8 SQL groups, 5 concurrency groups and 4 hosting regression suites.
- `trusted-publication-compiler-20261013.json`: pinned Docker/Vite and browser execution, two routes, lazy CSS, original artwork and fonts, desktop/mobile, JavaScript on/off, security checks.
- `scripts/check-trusted-publication-flow.cjs`: mounted customer flow and consent/reload/stale-state/account isolation checks.
- `scripts/check-trusted-publication-worker.cjs`: mocked orchestration failure and lease boundaries, included in the offline runner.
- `scripts/check-publication-end-to-end.cjs`: actual service-role SQL → fenced original artwork → Docker compile → independent browser capture → exact-output SQL completion → explicit promotion/replay → both public route reads. Requires `MAKEBORNE_VERIFY_LOCAL_PUBLICATION=true` and a dedicated `makeborne_publication_<14 digits>` container using database `rehearsal`. Uses synthetic scoped fixtures and deletes them afterwards; never point it at another database.

None of these checks proves fresh model-generated design quality or a qualified production execution service. No paid provider calls are made by this package.
