# Pinned website build toolchain: local qualification

Operator-only infrastructure. Never invoke Docker from Makeborne request handlers or deploy this local adapter as a multi-tenant service. The production runtime provider remains under evaluation.

## What exists

- `src/lib/projects/build-input.ts` prepares a saved full-source revision using the shared source manifest and verified original-asset materialiser. It rejects package/lock drift and unsupported custom configuration instead of silently ignoring it.
- React 19.2.8, Vite 8.3.4, TypeScript 5.9.3 and React type definitions are exactly pinned in the toolchain package and lock. The Node base is pinned by image digest. There is no dependency installation during project execution.
- The image disables lifecycle scripts while installing trusted locked dependencies. Project scripts, Vite/PostCSS/Tailwind configuration and project environment files are not execution authorities. Visual CSS and components remain unconstrained by templates.
- The trusted entrypoint independently matches transferred bytes to the complete canonical source manifest/hash, checks the approved lock, performs strict TypeScript checks and bundles with fixed Vite configuration.
- Output receipts bind artifact/revision/version/source, dependency fingerprint, runtime image, routes and every output file hash. The controller rechecks receipt identity, paths, total bytes and file hashes before retaining output.
- Fresh containers use a read-only root, unprivileged user, no network, no capabilities, no privilege escalation, one CPU, 512 MiB memory, 64 PIDs and a 192 MiB temporary filesystem. Only a fresh input directory is mounted read-only; no app environment or Docker socket is forwarded.
- A separate watchdog stops the compiler process group within 65 seconds, including event-loop stalls. The controller has its own deadline and removes its exact named container in `finally`. Temporary host directory deletion verifies its resolved parent/prefix and rejects symlinks.

## Local qualification

From the app directory, build the image with `docker build --tag makeborne-react-vite:local-v1 infra/project-runtime`. Set `MAKEBORNE_VERIFY_LOCAL_RUNTIME=true`, then run `node infra/project-runtime/check-runtime.cjs`.

The check compiles a fixed React fixture twice, compares all artifacts, checks original artwork, inspects resource limits, probes environment/filesystem/network restrictions, forces watchdog expiry/controller timeout, rejects syntax/type errors and forged source identity, and navigates the compiled nested route at 390/1440 with a real browser. The fixture is an infrastructure check, not a generated design-quality benchmark. No cloud sandbox or paid model is used.

## Private output retention

The build worker now requires a private immutable `CompiledOutputStore`. It verifies every compiler file against the shared receipt, uploads without replacement, reads back exact size/hash, then writes the receipt marker last. SQL completion follows retention and repeats the live authority/fence checks. A failed retention attempt disposes temporary compiler output without marking the build compiled. Partial uploads remain unavailable through the marker-checking read helper.

`src/lib/projects/compiled-output.ts` is the shared retention/read contract. Locators include workspace, artifact, immutable revision and build hash; a locator is never authorization. Only manifest-listed files are readable, and each read rechecks marker and file hashes. `local-output-store.mjs` supplies an operator-only private disk implementation for qualification, with bounded reads, atomic create-without-replacement and temporary-file cleanup. It is not deployed or exposed over HTTP and does not establish production crash durability, retention policy or account erasure.

M03-T01-R14 verifies real Docker output remains readable from a reopened private disk store after runtime disposal. It also injects a retention failure before SQL completion, checks cleanup and explicitly retries the same lease; this compiles twice but issues no additional provider request. Production private object storage, abandoned-object garbage collection, authenticated isolated preview serving and UI integration remain required.

## Isolated private preview qualification

`authorized-preview.ts` checks the service-only current viewer/session/workspace/version/build authority before and after object-store reads. The read authority uses the current viewer, so a reviewer can inspect an existing saved build without buying a new creation plan or preserving the generator's original session. It denies cancelled work, mismatched identities and revoked access. Reads neither accept generation nor settle credits.

`preview-response.ts` serves exact retained bytes only on a build-hash-bound origin under a dedicated preview suffix. It rejects the application origin and shared/unbound hosts. Saved routes may resolve to the index; real manifest files take precedence and missing assets do not silently return HTML. Responses have explicit MIME, no-store, no permissive CORS, a sandbox/CSP, no-referrer, no indexing and origin isolation. HTTP is allowed only with an explicit localhost qualification option. External network requests, workers and form submissions are currently disabled; backend/form integration needs its own scoped policy.

The M03-T01-R15 localhost HTTP/Chromium fixture uses an opaque fixture-only viewer handle and the actual service-role SQL bridge/private disk storage. It proves retained React loads at 390/1440, script MIME is correct, app-origin requests are blocked, and removal of membership makes the next file request return 404. This does not implement the production Auth-to-preview credential handoff, cookies, wildcard DNS/TLS, production storage or editor iframe lifecycle. Never expose the internal viewer fields as browser-selected authority.

## Production work still required

Vercel Sandbox remains the planned first cloud evaluation. The local Docker results do not select a replacement provider or prove Firecracker isolation, provider startup/cost, cloud cleanup or multi-tenant preview security. Integrate a reviewed pinned image through a durable worker, account/revision authorisation, reservations, leases/fencing/cancellation and expense accounting. Verify the real provider before enabling dispatch. Never carry application credentials into generated-code execution.

Serve verified artifacts on isolated origins with the appropriate authenticated access and headers. The local browser server is a disposable test fixture, not a preview service. Wire the existing durable build receipts/private retention contract to production object storage, then add retention cleanup, source editing, repair and publication promotion. Keep the prior live build intact on failure. Add reviewed dependency profiles rather than permitting arbitrary installation.

The temporary base64 transfer is bounded and operator-only; production artifact transfer should stream to scoped object storage. Dependency audit results do not certify the base OS, package provenance or overall production security.
