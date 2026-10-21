# Final staging publishing qualification — 21 October 2026

**Result: the current staging publish/unpublish/recovery journey passes for the tested two-route fixture. Production remains unchanged. This is not a full paid-launch approval.**

Source: ff61f1d430f4512caeae75f2b217e9ea391c0b7f; application runtime is byte-equivalent to e45eaa50cf8527c367212df67f47bed4e63daced. The QA alias now points to that exact READY staging deployment, dpl_CANTnNxyU8e3j2uQjzfRR78w5Tox. No app preview was built during this run. No paid AI calls, merge or push.

## Results

| Check | Result and actual evidence |
|---|---|
| Full-source publishing | Current immutable compiler and renderer images ran in real cloud VMs; both declared routes were captured. The retained preview was inspected before real staging approval. |
| Desktop and phone | Both routes at375/1440 matched preview main text, heading and font after publishing. Images loaded; mobile menus worked; no page errors or horizontal overflow. Four preview + four public views on recovery, repeated after republishing:16 views total. |
| Stop/crash recovery | The test controller exited137 immediately after a real compiler watchdog command was accepted. systemd restarted it; after the actual five-minute lease expired, the same preparation completed at attempt3/fence3. Recorded gap: 304325ms. No lease/provider dates were rewritten. The first attempt had been consumed by a harness assertion, not an application failure. |
| Direct network isolation | Inside the actual non-root VM, loopback HTTP worked, external HTTPS and direct-IP HTTP were blocked. External host control returned200. No application/provider credentials were present; AWS_CA_BUNDLE is a benign certificate-path variable. |
| Public phone form | Real375px form → Worker signature gateway → correct staging artifact inbox → real CRM conversion and activity. Disposable enquiry/client removed; previous enquiry setting restored. |
| Unpublish and recover | Real unpublish returned public404. A new preparation succeeded on its first attempt, was reviewed and approved, and returned matching public output at revision12. |
| Asset broker boundary | A locally decoded valid PNG of exactly20,000,000 bytes uploaded as an authorized synthetic original and streamed through actual Vercel with exact size/hash. Stale fence, wrong asset ID, bad HMAC and ended lease each returned403 without image bytes. One-byte-over descriptor refused by the source schema offline. Temporary version, asset, preparation and Storage object removed; version3 restored. |
| Storage failures | Current actual R2 adapter rejected an injected pre-write transport outage with no object committed. A real successful PUT whose response was deliberately lost recovered by exact readback and conditional retry. Conflicting content did not overwrite immutable bytes. Test object deleted and absence confirmed. This is transport injection with real storage, not a spontaneous R2 outage or a complete publication-pipeline outage test. |
| SQL failure/concurrency boundaries | Four suites on an isolated copy of the107-migration chain pass: publication concurrency, sandbox lifecycle journal, worker attestation and admission. Includes stale fences, revocation, attempts/admission limits and ambiguous lifecycle cleanup. Synthetic workspaces were explicitly allowlisted only in the disposable database. Tests do not claim current cloud executions of every rare fault combination. |
| Safety-core compatibility | Exact git diff is empty from earlier real-cloud-qualified54449ae to current source for the controller, supervisor, executor, journal, publication worker, R2 store, downloader and broker. Earlier fault evidence remains identified by its original source; current healthy/crash integration uses the new renderer/compiler images. |
| Cleanup | All8 permitted VMs independently read back STOPPED with resume:false. Both private staging registry repositories deleted. Staging service disabled/inactive, private host config removed, login disabled/expired, publishing-fixture sessions revoked. Temporary Worker protection token deleted. Production service stays inactive. Local buildx cache remains but its credential config is absent. |

## Failures retained and corrected

- Controller initially used the unique preview URL, while the broker required its configured QA origin. Three preparation attempts failed before a VM was created; the old public site stayed live. Fixed staging-only config to the exact QA alias after independently pinning that alias to the candidate.
- Network harness wrongly treated AWS_CA_BUNDLE as a secret. The proof already showed outbound blocking and a successful local control. Corrected the assertion; no security or product policy was relaxed. The failed attempt and raw proof remain.
- A private host-update helper produced a malformed environment file; restored it from structured private input and started only staging. No production service/config changed. Neither that helper nor the fault-wrapped controller is a production deployment artifact.
- Full-chain SQL fixtures needed explicit workspace allowlisting and the v2 production attestation expectation. Fixture setup was corrected, without changing guards/functions. Their first failing runs remain in local evidence. A historical generated admission report was restored to its exact HEAD bytes; current results are in this run's evidence.
- Broker boundary fixture first omitted its asset ID from the version manifest, then tried worker SET ROLE through the owner connection. Those attempts correctly failed. The successful probe used a complete manifest and the existing dedicated restricted worker login. All attempted uploads/temporary versions were cleaned.

## Production boundary and launch inputs

Fresh read-only production inspection still finds105 migrations, exactly two pending, no controller login or enabled publishing workspace, all provider spending off and creation checkout off. makeborne.com still points to production70a1d91 / dpl_ENjea1fLgLqR54bVLUcvMHXjfUfr. The107-file inventory and hashes are frozen locally; no production migration ran.

Pending exact order:
1.20261021125359_checkout_payment_recovery.sql — cb048fb30957ceb52d64badedd37d12702477a99c5ea9544d619be9977ac3130
2.20261021133151_billing_financial_reconcile_freshness.sql — 5045b832f0fa763c94cfc581175aa41b002fb38f0c8350f5da18f9b763728ee6

See launch-go-no-go-20261021.md for the owner approval gates. Production needs its own plain controller package, scoped credentials/bucket/image references and approved workspace. **Never install this run's injected-fault/budget test image in production.** The plain current-source controller previously passed its own no-network self-check; activating it is a separate approved operation.

## Budget

A new owner-approved2USD allowance covered at most8 VMs (1vCPU/2GB,75s max), short-lived private registry/storage and bounded application requests. Exactly8 sessions were used and stopped; no AI/build/deployment spend was added. Retain the full2USD conservative bound until invoice reconciliation; this does not claim2USD was actually charged. Earlier ledgers and the separate Claude balance are unchanged. Registry compressed manifests total636,320,977 bytes. Published reference rates: [Sandbox](https://vercel.com/docs/sandbox/pricing), [VCR](https://vercel.com/docs/container-registry/limits-and-pricing).

After cleanup the staging site remains visible, but its temporary controller and protected-preview form access are off. Form delivery was proven during the test; it is intentionally not kept active with a temporary credential. Renew only staging access for a future test.

Private receipts, raw failures, screenshots and scripts: work/cloud-publication-final-20261021. Claude source head ba1a7d8 was rechecked; no new runtime changes were silently combined. Monthly renewal probes were left active and untouched.
