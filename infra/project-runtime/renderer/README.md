# Publication image packaging

Local recipes only. The images have not been pushed to VCR or qualified in Vercel Sandbox. The first local renderer smoke reached Chromium but this Docker host denied its enabled OS sandbox. See `docs/release-review/publication-image-packaging-20261013.json` for the exact failure. Do not disable Chromium sandboxing or relax container security settings to turn that result into a pass.

The renderer pins Playwright 1.63.0 and installs its matching Chromium and OS libraries during image build. `/opt/ms-playwright` is independent of the workload's `HOME=/tmp`. Trusted runtime files reside at `/opt/makeborne`; the sibling policy imports resolve to `/opt/customer-sites`, with an explicit ES module package scope. `/vercel/sandbox` belongs to `node`. The compiler's `/input` likewise belongs to `node`, so the remote file writer does not require a mount or root.

From the repository root, choose new context directories with an existing parent:

```text
node infra/project-runtime/renderer/prepare-context.mjs compiler work/publication-compiler-context
node infra/project-runtime/renderer/prepare-context.mjs renderer work/publication-renderer-context
docker build --pull=false --platform linux/amd64 -t makeborne-publication-compiler-local:20261013 work/publication-compiler-context
docker build --pull=false --platform linux/amd64 -t makeborne-publication-renderer-local:20261013 work/publication-renderer-context
node infra/project-runtime/renderer/check-packaging.mjs makeborne-publication-compiler-local:20261013 makeborne-publication-renderer-local:20261013 work/publication-image-packaging.json
```

The context preparer refuses an existing destination and copies an explicit file allowlist. Each context includes sorted byte sizes/hashes and an aggregate hash. It never copies the checkout, `.env` files, credentials or local `node_modules`. The context hash establishes input identity; OS package repositories may supply updated dependencies on future builds, so qualify and pin each resulting final registry image separately.

The smoke uses disposable local containers with no network, host mounts or ports, one CPU, 2 GiB RAM, 128 PID limit, all capabilities dropped and no privilege escalation. It uses the image's default non-root user, overrides `HOME=/tmp`, and explicitly invokes the watchdog paths used by the executor. Its writable container filesystem permits input transfer; this test is not the older local adapter's read-only-root isolation qualification. The harness validates a real React compilation with a local font and artwork, renderer imports/browser location, capture identity, then denial/timeout cases only if capture works. A failed/skipped required check returns nonzero. Containers are removed in cleanup even after failure.

Only the trusted synthetic fixture executes locally. A local image ID/context hash is not a reviewed VCR manifest/evidence mapping. No example approval file is generated. Remote image readiness, actual default-user behavior, returned image-string canonicalization, network/resource enforcement, Chromium sandbox support and lifecycle recovery remain separate cloud gates.
