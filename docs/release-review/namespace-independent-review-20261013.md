# Independent staging namespace review — 2026-10-13

Status: local review and tests complete; no remaining concrete P1/P2 identified within the reviewed package. No cloud requests, writes, deployments or paid calls were made by this review.

## Scope and findings resolved

Reviewed the customer Worker namespace policy, route configuration, cache partition, standalone legacy redirect, application address-policy helper, publication preparation/promotion and legacy routes, mounted TrustedWebsitePublish UI, and additive migration 56.

1. The standalone legacy Pages redirect initially still redirected both QA labels from `sites.makeborne.com` into staging. This path is separate from the customer Worker's legacy branch. Root reserved both labels in that self-contained redirect and added a comparison regression. The independent hosting rerun passes.
2. A previously valid UI policy remained actionable after a failed status refresh. A mounted reproduction loaded the allowed staging policy, returned HTTP 503 on refresh, and observed Prepare still enabled beside the failure message. Root now clears address policy, availability and consent on refresh failure while preserving the existing site for reading/offline recovery. Mounted regression now passes. This was a stale UI permission issue; the server and SQL guards independently continued to enforce allocation rules.
3. A saved uncertain preparation request could strand the address input after namespace cutover: its ordinary address was no longer permitted, retry was disabled, and the pending request locked the input. The mounted reproduction confirmed both disabled controls and the absence of recovery. Root added **Clear saved preparation request**, which removes only browser request metadata and consent after a complete successful status refresh, while preserving the existing site/preparation and refusing recovery during running work. Copy explains that clearing does not cancel server work. The regression clears locally with zero writes, selects an allowed QA address and creates a new request key.
4. An older successful refresh could overwrite a newer running preparation or reopen permission after a newer error. The mounted out-of-order reproduction showed the running state disappearing after the older response arrived. Root now fences refresh successes and errors by sequence, and invalidates that sequence at mutation start and settlement. Ambiguous preparation writes retain their exact request metadata and require a new successful status refresh before retry or local discard. The mounted ordering and uncertain-response regressions pass.

## Reviewed boundary behavior

- Staging configuration accepts only its exact public database and application origin, and only `release-check.makeborne.site` / `release-check-renamed.makeborne.site`. Production rejects those labels before redirects, methods, enquiry submission, robots, cache or data access. Ordinary production hosts, apex behavior and normal legacy addresses remain available.
- The trusted deployment namespace is part of asset cache keys. A request query cannot select it, and old URL-only/production cache entries do not become staging responses.
- The application reads namespace and QA workspace from server configuration. Staging identity without matching configuration closes publication. Legacy live publication, trusted preparation, promotion and interactive enablement use the guard; existing offline cleanup remains available.
- SQL guards address-bearing hosted sites, reservation rows and preparations, including old service RPCs and direct writes. Policy is private, has RLS and no browser/service/worker grants. No user GUC chooses the mode. A shared policy-row lock serializes writes with configuration changes.
- Migration installation refuses any existing QA site, retired reservation or preparation instead of taking its label. Staging configuration refuses incompatible active preparations. Existing ordinary staging rows can be read, have harmless metadata changed, be taken offline, have scripts disabled, or be deleted; changing retained content/address or enabling scripts still requires a permitted namespace.
- Direct browser workspace insertion is revoked by the earlier idempotent-mutations migration; the normal creator assigns its own UUID. A browser cannot deliberately recreate a deleted QA workspace ID through that API.

## Evidence

Independently executed against current local files:

| Check | Result |
|---|---|
| `node scripts/check-publication-namespace-ui.cjs` | 16 mounted React/Chromium groups pass |
| `node scripts/check-trusted-publication-flow.cjs` | 6 existing mounted groups pass |
| `node src/lib/hosting/check-publication-modes.cjs` | 12 route/status groups pass |
| `node src/lib/hosting/check-hosting.cjs` | 21 hosting groups pass |
| `node infra/customer-sites/check-namespace.mjs` | 12 groups; 192 actual local workerd requests; zero external transport |
| Focused ESLint on the two UI test scripts | Zero errors/warnings |

The new mounted checks use the actual UI, account guard and browser with mocked APIs. They cover both QA selections, ordinary/reserved production labels, disabled policy, existing-site offline cleanup, denial of an out-of-namespace ready preparation, consent and identifier-only promotion for permitted QA output, policy withdrawal, missing/malformed initial policies, malformed/failed refresh after earlier permission, namespace-cutover request recovery, running/unconfirmed recovery refusal, out-of-order status responses, and ambiguous preparation writes. Only the new test script and a one-line legitimate production `addressPolicy` fixture update to the existing mounted flow were edited by this reviewer, plus this report.

The SQL owner's coordinated disposable evidence was inspected, not independently rerun while that agent owned the fixture: `site-address-namespace-20261013.json` reports nine groups passing, including real policy/write contention in both orders, restricted-login denial, migration collision rollback, legacy rename and trusted completion/promotion. Its recorded migration SHA-256 matches the reviewed file: `9df32055e53e1bd19e257fd33880288515bfd124162c9c618d967f31f6a03972`.

Selected handback hashes:

- Namespace policy: `9a65bd7a3758cf21a486a95f82067491477ee63640bcd36a4a49fb0f5b1f23ca`
- Customer Worker: `b8d1f428b70268a3abb38b322125e0eddf7e48271b1162409378299ee2811124`
- Wrangler configuration: `fce6ace73d0a437e41ca6443a83196af7e7e4b7bfb0bee111f991216554e33d3`
- TrustedWebsitePublish: `caaf563baf815a7dea44243deb3f2e3521fcb73705e8fc8996e2ccb182258126`
- New UI check: `4ab88dff6ca2c97cf97eaa0ff62f9dd6766ea73b298a62e7b86386b0fb96c72c`

## Limits and rollout requirements

Local routing emulation does not prove installed Cloudflare routes, DNS/TLS, actual public database bindings, caches at the edge, or deployed app/Worker compatibility. The production wildcard and exact staging patterns coexist in configuration; correct live route precedence and the installed policy must be verified at cutover. The guards make accidental wrong-worker dispatch fail closed locally.

Migration collision refusal and incompatible-preparation refusal are intentional rollout stops. Existing labels must be inventoried and explicitly resolved, and active incompatible preparations drained, before enabling staging mode. No ownership changes or destructive collision cleanup are authorized by this review. Full migration-chain rehearsal and deployed qualification belong to the root release package. This evidence does not qualify the remote compiler or permit cloud publication activation.
