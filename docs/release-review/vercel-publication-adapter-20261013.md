# Vercel publication executor — local adapter qualification

Date: 2026-10-13. Status: local adapter and injected SDK contracts implemented; **cloud execution is unqualified and must remain disabled**. No Sandbox API call, paid compute, credential change, image build/push, deployment or commit occurred. Public documentation and the npm distribution were read only.

## Files and dependency

New files only:

- `infra/project-runtime/vercel-publication-executor.mjs`: operator transport, immutable approval mapping, per-claim executor, bounded transfer and cleanup reconciliation.
- `infra/project-runtime/vercel-publication-protocol.mjs`: bounded workload, build receipt and renderer wire validation.
- `infra/project-runtime/vercel-publication-render-entry.mjs`: fixed image-side entry using the existing publication renderer with Chromium sandbox enabled.
- `infra/project-runtime/vercel-publication-render-watchdog.mjs`: independent process deadline for the renderer.
- `infra/project-runtime/vercel-publication-check.mjs`: isolated injected-SDK contract checks.

No package manifest or lockfile changed. The future supervisor dependency must be pinned exactly to **@vercel/sandbox 3.7.0**, not a range. Its published tarball was inspected locally in ignored `work/vercel-sdk-inspect` without installing it or its dependencies:

- SHA-256: `2600479a47ec1b8c928330e8dd1e191b8c51aa2ee8713023762bdc03488ea312`
- npm integrity: `sha512-ncGIIIJHxMnZAw+UCCF1fxum0j1Sez/wVsRpuMpaekbEcaM5V4hahJ/HGw06r4cV48U0tEJqoMIMRAZIktlkWw==`

The SDK's actual declarations/source establish `Sandbox.create/get`, `runCommand({detached:true,timeoutMs,signal})`, `Command.wait({signal})`, `readFile(...,{signal})` and `stop({signal})`. Version 3.7.0 returns a Node readable for file reads. Its ordinary awaited command path accumulates logs, so this adapter always uses detached commands and status waits and never requests logs/stdout/stderr. SDK calls receive cancellation before invocation through a thunk; cancellation cannot start the next SDK mutation. [Official SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

## Supervisor integration

After a fenced authoritative claim/load, construct one executor for that claim:

```js
const transport = vercelSandboxTransport(Sandbox, credentials); // or managed OIDC
const executor = vercelPublicationExecutor({
  transport,
  approved, // trusted deployment configuration described below
  context: { preparationId, workerId, fence, leaseUntil },
  onLifecycle: durableJournalWrite,
});
return { ...executor, store: privateOutputStore, sitesDomain };
```

The root-owned worker factory supplies this context. Database, object storage and Vercel credentials remain in the supervisor. The adapter has no database/R2 binding and never forwards its transport credentials into a VM. Workload and renderer payloads contain only bounded source/public build bytes and nonsecret identities. Browser callers cannot select the mapping, command, image, environment or lease.

The frozen approval object has exact fields:

```text
compiler: { image, runtimeImageId, evidenceSha256 }
renderer: { image, rendererId, evidenceSha256 }
```

Both images must be immutable VCR references ending in `@sha256:<64 lowercase hex>`. The compiler runtime ID is `sha256:<64 hex>`; the renderer ID is `chromium-<actual version>-controller-<64 hex>`. A Docker config ID is different from a registry manifest digest. The compiler mapping explicitly binds these identities through independently reviewed evidence; the adapter does not pretend to discover that equivalence. Returned receipt identities are checked against this frozen mapping. The renderer returns the existing controller's actual identity, which hashes the controller/delivery policies and actual Chromium version. The registry digest additionally binds the new image entry/protocol/watchdog. No production identity or evidence digest is invented by these files.

## Isolation, time and transfer

Compiler and each route renderer use separate fresh names and microVMs. Creation requests set nonpersistent storage, deny-all network, no ports, no mounts, an empty application environment and one vCPU. No runtime dependency installation or source clone is requested. Deny-all remains a provider control that requires live qualification.

Compiler execution explicitly invokes `node /opt/makeborne/watchdog.mjs`, then a fixed readiness probe. OCI ENTRYPOINT/CMD are not assumed to execute. Manifest size is capped at 262,144 bytes; output at 50 MB / 1,000 listed files. Relative paths, duplicates, source/toolchain/routes/runtime identity, canonical receipt hash, exact byte length and each file hash are independently checked. Only listed paths are streamed; no archive is extracted. The VM stops before returning the bounded in-memory file reader, whose disposal clears retained buffers.

Renderer execution explicitly invokes the new process watchdog, which starts the entry. The entry loops over bounded reads, validates its fixed JSON protocol, preserves the existing manifest-only browser controller, native isolated-world capture, socket/service-worker restrictions and `chromiumSandbox:true`. Returned HTML is limited to 3.9 MB with exact expected renderer identity. JSON transfer limits account for string escaping.

The authority deadline is the claim's lease, with five seconds reserved. Creation has at most ten seconds and cleanup a separate four-second bound. Provider timeouts are at most 75 seconds for compiler or 35 seconds for renderer and shrink with the remaining lease, including time spent durably journaling. Command/process deadlines are shorter (compiler at most 65 seconds; renderer work at most 15 seconds plus watchdog overhead). Work and reads are also bounded by the observed provider expiry. This adapter never extends the lease or session timeout. Too many routes for the lease fail safely rather than extend authority.

Vercel's one-vCPU profile includes 2 GB memory and differs from the local Docker 512 MiB, PID, tmpfs, read-only-root and capability limits. Those local flags are not reproduced by SDK creation options. Accepted differences require actual resource/abuse qualification. [Official resource model](https://vercel.com/docs/sandbox/sdk-reference)

## Required durable lifecycle journal

`onLifecycle` is mandatory; no in-memory fallback is accepted. It must durably commit before resolving, including a **creating** record before the API call. Callback absence/rejection fails closed. A console logger is not a journal. Durable host/storage provisioning is outside this change.

Exact event fields:

| Field | Type / purpose |
|---|---|
| preparationId, workerId | UUID strings from claim |
| fence | positive decimal string |
| leaseUntil | claim ISO timestamp |
| name | generated `mbpub-(compiler|renderer)-<UUID>`; persisted before create |
| kind | compiler or renderer |
| image | immutable approved VCR digest reference |
| evidenceSha256 | approval-evidence digest |
| runtimeIdentity | mapped compiler runtime ID or actual expected renderer ID |
| latestExpectedExpiry | authority cutoff (leaseUntil minus five seconds), not a claimed observed provider expiry |
| state | creating, running, stopped, cleanup_unconfirmed |
| sessionId | optional bounded provider session identifier, present after successful creation |
| providerExpiresAt | optional observed provider ISO expiry, present after successful creation |

A creation error/cancellation may mean a VM was created. Finally cleanup uses the recorded name with `get({name,resume:false})` then stop with an independent signal. The retrieved name must match; stop must return the same session ID with terminal stopped, failed or aborted status before journaling stopped. A resolved stop request with running/stopping/pending/snapshotting status is unconfirmed. A missing response/404 is **not proof of absence**. Failed cleanup writes cleanup_unconfirmed and fails the attempt. A late create handle gets another best-effort stop; the unresolved durable record remains.

On supervisor restart, enumerate unresolved journal records and call:

```js
await reconcileVercelPublicationSandbox({ transport, record, onLifecycle: durableJournalWrite });
```

Reconciliation only retrieves without resume and stops; it never executes source, resumes, extends or promotes. An unresolved record must remain operator-visible and be retried or investigated. A failed journal update leaves the prior durable creating/running record available for recovery.

**Unknown creation remains a real integration gap:** a local cancellation does not prove provider cancellation. An unobserved server may complete creation later; the adapter cannot independently prove its absolute expiry or startup latency from the lost response. Provider session TTL limits the requested lifetime, and durable reconciliation is required. Live qualification must demonstrate provider expiry after supervisor death and unknown/lost creation responses.

## Image preparation still required

The existing local Docker image is **not usable as a qualified Vercel compiler image unchanged**: local Docker supplies /input through a bind mount, whereas Vercel file upload needs an existing writable /input directory. No cloud image was built or qualified here.

For a compiler derivative, retain the exact reviewed toolchain files, dependencies, fonts/licenses, build.mjs, identity.mjs and watchdog.mjs under /opt/makeborne. Bake both /input and /vercel/sandbox as writable directories before selecting the nonroot user. A concrete build-time preparation fragment is:

```dockerfile
# FROM the independently selected, immutable reviewed compiler base
USER root
RUN install -d -m 1777 /input /vercel/sandbox
USER node
```

This directory mode avoids relying on an unverified SDK default UID. The fresh single-workload VM contains no secrets or other tenants; it is not a multi-user isolation claim. Qualification must verify the actual SDK command/file user, file upload, executable paths, writable /tmp, and clean absence of old /tmp/project, /tmp/result and /tmp/build-complete artifacts. Do not make /opt/makeborne or its toolchain writable as a shortcut.

For the renderer, prepare a separately pinned Linux image with Node, Playwright exactly **1.63.0** and its Linux Chromium/system dependencies installed at image-build time. The inspected repository browser manifest associates that Playwright version with Chromium revision **1243**, version **153.0.8010.12**; this is an input to preparation, not a qualified cloud renderer identity.

Place the existing publication-renderer.mjs and new protocol, identity, render-entry and render-watchdog modules under /opt/makeborne, with Playwright resolvable from that directory. Preserve relative imports by placing site-policy.js and website-policy.js under /opt/customer-sites. Bake writable /vercel/sandbox and /tmp and a writable nonroot home. Capture the actual controller identity from the exact Linux image. The OS Chromium sandbox must work unchanged; do not add --no-sandbox. Audit the image filesystem/environment for baked secrets.

Both images need optimized linux/amd64 VCR preparation and independent digest/evidence recording. No placeholder Dockerfile, local ID, mutable tag or successful mocked response establishes that qualification. [Official image requirements](https://vercel.com/docs/sandbox/concepts/images)

## Local checks and remaining release gate

`node infra/project-runtime/vercel-publication-check.mjs`: **18/18 groups passed**, with zero provider calls. Scoped ESLint on the five new modules passed with zero warnings/errors. Fixtures and identities are synthetic. Tests cover SDK credential separation, immutable config, exact commands and output, separate VM identities, journal failure, path/hash/source failures, oversize/missing/stalled streams, aborted reads/stages without unhandled rejections, journal time consumption, provider expiry mismatch, unknown create, stop failure, retrieved sandbox identity and terminal stop-response validation, restart reconciliation, nonzero commands and renderer spoofing. Independent read-only review checked the actual pinned SDK contract and reproduced the cleanup-response gap; its correction is included in the final check run.

This is not a live SDK transport, VCR, OS sandbox, fresh-model-quality or cloud qualification result. Before activation, independently qualify exact images and SDK; authenticated provider access; source/asset transfer; Linux font/render parity; browser OS sandbox and denied egress; hung compiler/renderer; abandoned VM TTL; lost create/stop responses; durable journal restart; fenced duplicate/stale-source/revoked-session handling; private R2 readback; and SQL completion/recovery under the full lease. Root owns the durable supervisor/control integration and its separate evidence.


## Final local source inventory

| File in infra/project-runtime | SHA-256 |
|---|---|
| `vercel-publication-check.mjs` | `41cdd9fe0ca951d533339598266bcc66d6a56cbd2a9e73955d6df363b0bde2dc` |
| `vercel-publication-executor.mjs` | `524cbf1f0a09a93a2972bf67c13dca3d862ee91cde665f082d18a6c55da73a76` |
| `vercel-publication-protocol.mjs` | `2616b217b3533789df76d9d8395493bdf8c1e4355fa0143e1efcac7446320596` |
| `vercel-publication-render-entry.mjs` | `c1c5fbb7028a10ee1fa7ec7c0958f9b0876ec4cb78fa759ff15c508186dbcfbf` |
| `vercel-publication-render-watchdog.mjs` | `c8856af373fd7a03bd8e4bf0bf7ca7a67dcde13fe62105d9560e75874c90a49e` |


