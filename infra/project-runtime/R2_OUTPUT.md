# Private compiled output on Cloudflare R2

`src/lib/projects/r2-output-store.ts` implements the existing `CompiledOutputStore` contract for a trusted R2 bucket binding. The compiler, receipt validation, retention, database completion and preview readers keep using their existing shared contracts.

## Guarantees

- Namespaced keys bind workspace, artifact, revision and full build hash. Only exact receipt/file keys are accepted.
- Conditional R2 creation never replaces existing bytes, including competing uploads. SHA-256 is supplied to R2. The shared retention layer independently reads back each file and publishes the receipt marker last.
- Reads check object size before allocation and enforce exact size while streaming. Cancellation cancels the reader and rejects late results. R2 binding calls themselves cannot be interrupted; abort never confirms SQL build completion.
- A locator or receipt marker grants no access. Private preview readers still require current session/membership and exact immutable build/source authority before and after object-store I/O.
- No public R2 domain, public bucket URL, CORS bypass, HTTP upload endpoint or bucket credential is created here.

## Local qualification

`local-r2-output.mjs` uses the current pinned Miniflare/workerd SDK with private temporary persistence. It has no remote bindings or account credentials. Telemetry and CF metadata fetches are disabled. Its sole worker always returns 404; tests access the local bucket through the SDK. Always await `dispose()` before reopening/removing the caller-owned directory.

Run `node src/lib/projects/check-r2-output-store.cjs` for actual local conditional-write races, bounded reads, interruptions, cancellation, persistence restart and corruption checks.

The existing restricted database/Docker/Auth/Next/Chromium qualification additionally accepts `MAKEBORNE_VERIFY_LOCAL_R2_OUTPUT=true`. This uses R2 for the actual compiled files and the real private preview flow, including empty-storage/fresh-browser recovery. It is synthetic zero-cost generation and does not prove model design quality.

## Production work still required

`src/lib/projects/r2-s3-output-store.ts` now supplies the trusted Node builder's signed S3 transport. It implements the same CompiledOutputStore, using fixed standard R2 account/bucket endpoints, AWS SigV4 payload hashes, signed `If-None-Match: *`, bounded exact-size streaming reads, caller snapshots and a 30-second request deadline. No redirects or implicit retries; existing retention readback verifies conditional conflicts. Only `NoSuchKey` is absence; bucket/auth/service errors are unavailable. No browser/presigned URL or HTTP upload endpoint is exposed.

The signer uses the pinned `aws4fetch` package described in [Cloudflare's official example](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/). Conditional writes follow [R2's current S3 compatibility contract](https://developers.cloudflare.com/r2/api/s3/api/). Canonical key validation, limits and exact-size/cancellable reads are shared with the Worker binding adapter to avoid divergent storage rules. Jurisdiction-specific endpoints and temporary session credentials are not implemented; the standard account endpoint requires separate live qualification.

`local-r2-s3-output.mjs` is a loopback-only qualification fixture: independently verifies SigV4/payload/conditional headers, then uses actual workerd/R2. Its synthetic credentials cannot access a cloud account. `MAKEBORNE_VERIFY_LOCAL_R2_S3_OUTPUT=true` plus the existing R2 option exercises the original restricted builder through this signed HTTP transport. To qualify the actual preview Worker too, pass the explicit current dry-run bundle with `MAKEBORNE_LOCAL_PREVIEW_WORKER_BUNDLE`; no hardcoded older bundle is selected. The fixture is not a production S3 server or complete R2 S3 compatibility implementation.

Provision a private bucket and deploy the isolated preview gateway with its actual binding, dedicated origin, DNS/TLS, current service-side RPC credentials and operational limits. Connect bucket-scoped S3 credentials to the separately operated builder only; do not give them to generated code or browser/server-component props. The transport is implemented but live credential, bucket, process bootstrap, cloud retention/readback, resource limits and error recovery remain unverified. No live configuration is inferred from local passing tests.

Qualify live retention/readback and failure recovery before enabling previews. Add lifecycle collection for abandoned uploads, customer deletion and revision retention without deleting live/reviewed releases. No blanket bucket deletion or unverified public enablement.

Keep public generation paused until the complete worker/budget/provider/design/publication gates pass. No paid Claude calls are required to qualify storage.
