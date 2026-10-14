# Trusted publication gap — 2026-10-13

Historical Astra High audit. The local implementation and qualification described in `../TRUSTED_PUBLICATION.md` supersede the implementation status below. Cloud executor and combined staging qualification remain open. No production changes or paid provider calls were made; no cross-account or application-origin escape was demonstrated by this audit.

## Evidence

- The publication route accepts browser-supplied snapshot, JavaScript and CSS after owner/current-version checks. It does not load a trusted compiler receipt.
- Generated code executes inside the preview frame and can emit the same snapshot message as the capture shim. Checking the frame identity cannot attest the producing code.
- Preview retains inline index.html initializers, while publish compilation uses src/main.tsx. Behavior can differ even with honest input.
- Sanitization, byte limits and hashes protect other boundaries but do not prove output came from stored source.
- Publication image loading does not verify descriptor SHA/size as strictly as the existing source-assets materialization path.
- Existing database publication locks and CAS protect concurrent publication/version/address changes and should be retained.

Relevant files: publication/route.ts, builder/browser-bundler.ts, hosting/{snapshot,bundle}.ts, projects/{source-assets,source-files,build-input,build-receipt,compiled-output,build-worker}.ts and infra/project-runtime/build.mjs. The existing project_builds path is tied to legacy generation_jobs; its operator-only Docker executor is not a production publication service.

## Smallest coherent next package

1. Private durable publication preparation independent of generation jobs, bound to actor, workspace/project/artifact, immutable version, publication revision, source fingerprint, slug/mode and idempotency key. Browser supplies identifiers and intent only.
2. Restricted worker verifies original source/assets and compiles with allowlisted pinned runtime/compiler identities.
3. Trusted isolated browser captures retained output under actual hosting CSP, with resource/network bounds and font/image readiness. In-page messages are not attestations.
4. Immutable worker-issued receipt binds exact input/output manifests, source/assets, compiler/runtime, renderer, sanitizer/hosting policy, version and preparation identity. Write receipt marker last.
5. Service-only promotion locks current rows, rechecks access/version/publication revision and verified receipt, then atomically promotes exact retained bytes. Browser HTML/bundles cannot be promotion inputs.
6. Display receipt-bound final preview. Reject unsupported inline initializers consistently until migrated to supported entry code.

Vite multi-file output/fonts require a narrowly manifest-based host extension, preserving CSP and size limits. A separate two-file esbuild compiler is smaller but adds a distinct profile and cannot claim Vite/source-export parity.

## Recovery and rollout

Preparation failures leave old live bytes untouched. Retry expired preparation without model calls or AI charges. Reload retrieves account-bound status. Lost promotion responses replay the exact recorded result; later edits conflict. Existing sites remain readable with legacy provenance, and next React republish requires the new boundary. Drain old publishers before cutover; rollback retains receipt enforcement rather than restoring raw-output promotion.

## Qualification required

Forged snapshots; correct input hash with altered bundle; wrong actor/version/assets/compiler; missing/tampered fonts/images; unsupported routes; saves racing promotion; competing publishers; revoked authority; stale fences; storage interruption/process death/lost responses; preservation of old live output; actual static/interactive browser parity under hosting CSP.

**Original finding, now addressed locally:** a compiler/render/promotion boundary was required, not an added browser-provided hash field. Migration 54 and the matching worker/API/UI implement that boundary. See the SQL/compiler evidence records and actual end-to-end harness; production-service qualification remains open.
