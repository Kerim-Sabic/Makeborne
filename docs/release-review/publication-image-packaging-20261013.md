# Local publication image package — 2026-10-13

Both image recipes build locally. **Renderer execution is not qualified:** the Docker host refused Chromium's enabled sandbox (`No usable sandbox!`, SIGTRAP). No privilege, capability, seccomp or browser-sandbox setting was loosened. Cloud remains unqualified, and trusted publication remains disabled.

## Changes

- Compiler Dockerfile creates `/input` as root during build, then owns it to `node` with mode 0700. The existing compiler/source/receipt semantics are unchanged.
- New renderer package uses the existing digest-pinned Node 24 Debian base, an isolated manifest/lock with Playwright **1.63.0**, and its matching Chromium **153.0.8010.12**. The image contains browser OS dependencies and browser binaries at `/opt/ms-playwright`, so changing HOME does not hide them.
- Exact runtime files and sibling policy modules are copied to `/opt/makeborne` and `/opt/customer-sites`; the policy directory has explicit ES module scope. Writable render IO resides at `/vercel/sandbox`, owned by `node` mode 0700.
- An explicit allowlist prepares new, clean Docker contexts and hashes their inputs. Root package/lock, executor, protocol, compiler and renderer source semantics were not edited.
- A focused Docker-only harness records actual image IDs, real compiler output identity and renderer launch results. Its source uses no credentials or provider APIs.

## Observed checks

| Check | Result |
| --- | --- |
| Compiler and renderer `linux/amd64` builds | Both succeeded, one build each. Local dependency downloads only. |
| Repeat context generation | Identical input hashes for each image, 12 compiler files and 11 renderer files; fresh directories; no whole-checkout copy. |
| Script syntax | Both new scripts pass Node syntax checks. |
| Compiler input transfer | Default UID 1000 wrote `/input/request.json` without a mount or root. |
| Actual compiler work | React page compiled with retained original PNG and emitted local WOFF2; output lengths/hashes and source/runtime identities verified. |
| Renderer package discovery | Default UID 1000, HOME=/tmp; Playwright and sibling policy imports pass; browser executable readable/executable at fixed path; version identity derived; render directory writable. |
| Actual renderer watchdog | Exit 1. Enabled Chromium sandbox cannot start on this Docker host. Diagnostic preserved verbatim in JSON. |
| Renderer external-network and watchdog workload checks | Skipped because browser startup failed; no claim of passing denial or execution-timeout behavior. |
| Cleanup | No `mbpub-package-*` containers remained after checks. |

The first harness attempt exposed its own stdout-flush bug while returning compiled files; its explicit process exit cut output at 98,304 bytes. The harness was corrected to await the stdout write callback and rerun. No image rebuild or runtime change was involved.

Containers used no network, host mounts or ports; 1 CPU, 2 GiB memory/swap limit, 128 PIDs, all capabilities dropped and no privilege escalation. The fixture's writable container filesystem matches the new input-transfer requirement; it does not reproduce the existing local adapter's separate read-only-root qualification. Only the trusted synthetic fixture ran. A blocked local Chromium launch is not proof that Vercel Sandbox will fail or pass.

## Recorded identities

| Artifact | SHA256 / identity |
| --- | --- |
| Compiler clean context | `d5feaafca6d9284ca5d969edc21c0dffcffccba4cb40494740150cb38df28fe9` |
| Renderer clean context | `7610c4c7f84e1096a7ce18cce574bd484e54bee65310cfe0c8f35c0432ac6cc7` |
| Compiler Dockerfile | `e97de9b275df43c790edcf87e950865ed09b78adcf31292c27f16e7d19a1b97f` |
| Renderer Dockerfile | `84c7001a15b96b88a0b8fb50eec8f93c514ead8a0201cee305186472d611bfcd` |
| Renderer lockfile | `50576b6310fad066c7d3ccb8317cfcc04e837fac10337f52d9b5d7c03493f7b1` |
| Compiler fixture source | `b9ff97ee24be601dd0ab509e472ebabcbc937eaf167608bc636d5f1b5489264c` |
| Compiler fixture build | `d68662f54cfa715dade53981857548e9cefd62cec6cdbcfee9c7cd2b5535fab3` |

`publication-image-packaging-20261013.json` contains local image IDs, renderer binary/version/identity, per-check results and full sandbox failure. These are local image observations, not approved VCR digest mappings. Docker's local inspection identity may identify an OCI index; do not silently equate it with a cloud-selected manifest/config identity.

## Handback / next boundary

Packaging is available for review and subsequent isolated image probes. Renderer execution remains a gate requiring an approved environment supporting its unchanged Chromium sandbox. The next cloud step, if authorized, is the separately bounded compiler/renderer image registration and smoke described in `hosting-activation-review-20261013.md`; full service provisioning should not be mistaken for image qualification. No registry upload, cloud compute, credential creation, app/Worker deployment or production change occurred.
