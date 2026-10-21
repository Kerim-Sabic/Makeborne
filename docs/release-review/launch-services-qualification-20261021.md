# Launch services qualification — 21 October 2026

## Release boundary

Production activation is **not approved** by this task. No production deployment,
database write, Worker update, merchant change or feature activation was performed.
Remote `main` was re-read as `70a1d910dce32f8a1fddaede0b437ec1ac105dcb`.

The tested source candidate is `54449ae0cb1c6aab71d33e1587e788f0d9a57e89` on
`qualification/launch-services-20261021`, based on that main. Its five source/check
files are committed locally; it has not been merged or pushed. There are no new
migrations in this candidate. Earlier uncommitted release notes are preserved.

## Evidence and fixes

| Area | Result | What was actually observed |
| --- | --- | --- |
| Local candidate | PASS | Typecheck, full lint, production build and 183/183 offline harnesses. Five separate opt-in/service checks remain explicit skips. |
| Generated website | PASS for tested fixtures | Real application runner with Anthropic and staging Auth/RPC/Storage saved a partial version at the time limit, then a separately admitted continuation completed version 2 without regenerating its image. A subsequent **real deployed `/api/build` HTTP request** completed version 3 with another registered OpenAI image and removed placeholder date/unverified availability copy. |
| Generated images | PASS for tested integration | Four actual generated images across website, book and deck. Model `gpt-image-2.5-flare`; registration, original Storage SHA-256, actual rendered images and export embedding checked. No overrun was reported. |
| Ebook | PASS with length caveat | Actual staging PDF is 16 pages, each 432 × 648 points (6 × 9 inches), with extractable text and one cover image. It has substantive chapters and a worksheet. The brief requested eight pages; pagination produced sixteen, so exact requested page-count control is **not** established. |
| Presentation | PASS with Office caveat | Actual staging PDF has six 16:9 slides. Actual PPTX has native text on every slide, a native chart, six notes and embedded images. Native Microsoft PowerPoint visual QA was not available; structural editability and PDF rendering are established. |
| Preview/output | PASS | Actual website previews checked at 375/1440 on both routes; generated images loaded, no horizontal overflow or page errors. Book/deck editor views checked at 375/1440. |
| Ordinary cloud publishing | PASS | Real compiler and two route renderer VMs; retained preview inspected before approval through the real staging API. Public HTTPS root/nested route content, headings and fonts matched the preview at 375/1440. Menus, visible entrance motion and images worked. |
| Public form and CRM | PASS | Phone submission → Worker signature gateway → correct staging artifact inbox → actual CRM conversion and enquiry activity. Test enquiry and client were deleted; previous enquiry setting restored. |
| Static recovery | PASS | Disabling JavaScript preserved static HTML, removed executable scripts and made the old script URL return 404; restoring it returned 200. Staging robots disallows indexing and sitemap returns 404. This does not prove a new address-change operation in this run. |
| Controller crash recovery | PASS | The real SDK accepted the watchdog command, the controller exited immediately with137, systemd restarted it under a new worker ID, the real five-minute lease expired, and the **same** preparation completed at attempt2/fence2. Both retained route HTML strings match the previously approved normal output byte-for-byte. Real staging API approval published revision9, with four public desktop/mobile route views passing again. |
| Checkout replay/abandonment | PASS, before payment | A fresh ordinary staging account received one actual sandbox $29/month checkout. Repeated request and a second abandoned-checkout request resumed the same URL. No purchase was submitted in this run. |
| Signature and job health | PASS | Bad signature rejected with 400 on the candidate preview. Both authenticated reconciliation health endpoints returned 200, `overdue:false`, zero open issues. These are health reads of the last completed jobs, not new renewal evidence. |
| New subscription/two distinct packs | PENDING OWNER TERMS CONSENT | Prepared fake-card sandbox checkout; action-time approval request covers $29/month plus two $12 packs and refund/cancel cleanup. No real money purchase or production account is involved. |
| Bound monthly renewal/failure | BLOCKED EXTERNAL EVIDENCE | All previous monthly probes are canceled. No bound monthly subscription is currently awaiting renewal. Official stable membership update supports metadata; beta cadence changes are not an accelerated clock and would change the tested offer. Weekly/unbound history and simulations are not recorded as real 30-day renewal evidence. |

### Two real renderer defects fixed

1. A deck explicitly stored `cover-masthead` even when it referenced a paid image.
   The composition planner honored the decorative variant and silently omitted
   the image from HTML, PDF and PPTX. Image-bearing cover/closing slides now retain
   that semantic requirement. Oversized copy reports a fit issue instead of
   falling back to an image-free design. Decorative legacy slides stay supported.
2. Ordered ebook list markers were outside the clipped page gutter: stored
   `10/11/12` appeared as `0/1/2`. A scoped ordered-list gutter fix now accommodates
   double/triple digits. Real before/after PDFs and local Chromium regression
   checks establish the fix. Full HTML snapshot hashes changed only for this CSS;
   DOM hashes were unchanged.

The existing 7,197 pinned slide cases and 62 compositions remain covered. No
customer content was rewritten to conceal either rendering defect.

## Cloud test failures are retained

The first actual controller kill and supervisor restart reclaimed the same
preparation with new fences after the real five-minute lease. It then failed
closed because the reused staging R2 credential had expired. A read-only S3 probe
independently returned 403 `AccessDenied`; the same workload compiled locally.
Restricted staging login/IP-ban recovery also preceded any successful cloud run.

The R2 replacement was verified before more VMs were created. A fresh ordinary
app-authorized preparation then became ready and was published successfully.

A later precise crash probe wrote its marker but the controller continued: Docker
PID 1 ignored a self-sent SIGKILL. This was reproduced locally. That run produced
an ordinary ready build and is **not** a recovery pass. The corrected probe uses
an immediate process exit 137 after the real SDK accepts the watchdog command;
a local Docker test proved no `finally` cleanup runs. Its recovery result must be
recorded separately, including actual lease expiry, fence change and final ready
state. No database timestamps or provider events are rewritten.

## Spending

These are the existing approval ledgers, **not** the total historical account bill.
Measured usage costs are not invoice reconciliation.

| Approval ledger | Accounted amount | Cap |
| --- | ---: | ---: |
| Separate Claude API testing | $1.926543 measured | $50 |
| Original testing ledger | $4.956772, including prior retained bounds | $5 |
| Additional staging ledger | $1.00 accounted/reserved, including prior $0.55 and this run's $0.45 | $1 |

New OpenAI usage this run totals $0.043895. The final HTTP run added $0.332385
Anthropic and $0.010830 OpenAI. Both provider accounting and external approval
reservations were checked; no further AI calls are planned.

The cloud package retains its same $0.35 aggregate reservation. Its cumulative
guard was explicitly revised as failures were diagnosed; it is not reset between
restarts. Final maximum is 13 short sessions, 1 vCPU/2 GB, ≤75 seconds each. Actual
OCI manifests total 636,317,089 compressed bytes; three full registry lifetimes at
the published $0.10/GB are conservatively allowed $0.190896. VM bound $0.049,
two observed short preview builds allowed $0.060, other function/storage/network
headroom $0.050104. Total remains $0.35. No further guard expansion is authorized
by this operator plan.

Sources checked: [Vercel registry pricing](https://vercel.com/docs/container-registry/limits-and-pricing),
[Sandbox pricing](https://vercel.com/docs/sandbox/pricing),
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation).
The image price guard uses the owner's accepted measured-output policy, not a
provider-guaranteed maximum. Production still requires explicit spend settings.

## Cleanup and credential handling

- All AI calls settled; exact previous disabled staging limits, notes and
  timestamps restored and compared.
- Disposable AI user/workspace/sessions and all four original Storage objects
  removed. Sample versions, image bytes, receipts, screenshots and exports remain
  private local review artifacts.
- The temporary staging OpenAI/model environment settings and the second
  key-bearing disposable preview were removed after the HTTP check.
- Final controller/VM/registry cleanup is recorded in the execution addendum.
- The ordinary publishing test's enquiry/client were removed. The existing
  fictional public QA site is intentionally retained, with noindex.
- A serialized SDK object initially included a short-lived, staging-project-only
  token in diagnostic output. The probe now records only session ID/status;
  private host configuration is removed at cleanup. Replacement OIDC credentials
  were used; the earlier issued token must not be described as revoked. Its
  provider expiry remains the boundary. No production credential was involved.
- A staging R2 refresh token also appeared in a diagnostic response. Owner
  explicitly approved replacement and revocation; the exposed token was deleted.
  Its unexposed replacement is staging-bucket-only with a 24-hour expiry. Values
  are not included in this report or source commits.
- A browser probe initially evaluated an iframe while the route/size change was
  replacing it. The failure is retained; the corrected probe waits for the live
  image-bearing frame. No app source change or additional generation was used.

## Claude coordination and remaining release decisions

Claude advanced independently to `8c773a8` (responsive image/LCP and cross-browser
merges). Its implementation/output files remain untouched. A coordination entry
was appended to its actual handoff document and to the primary/qualification
handoffs; acknowledgement is not assumed. These additions are not part of
`54449ae`. Their runtime image changes need their own combined candidate and
qualification; older cloud receipts cannot qualify a changed runtime automatically.

Before commercial activation:

1. Finish the approved sandbox purchase/delivery/refund/second-payment checks once
   checkout terms consent arrives. Keep simulated, historical and fresh evidence
   separate. Establish a real bound renewal/failure probe or a supported provider
   test-clock route; do not manufacture a pass.
2. Decide whether Claude's new additions are included in the release, then freeze
   and verify that exact combined candidate. This source candidate is local only.
3. Review the production publishing preparation and controlled workspace allowlist
   in `production-publishing-preparation-20261021.md`. Production controller
   credentials/host activation and a production golden-site test remain separate
   owner-approved steps. Standard platform addresses can launch before custom domains.
4. Approve explicit ongoing production provider limits, provider/image settings,
   checkout and reconciliation settings, publishing and enquiry activation. The
   approved testing caps are not ongoing customer operating budgets.
5. Use the release checklist/backup/normal PR/smoke/watch process. Do not enable
   automatic top-ups or Gmail sending as a side effect of this work.

## Private evidence index

Primary checkout `work/launch-services-qualification-20261021/` contains:

- `fixed/review.json`, `fixed/export-inspection.json`, `fixed/book.pdf`,
  `fixed/presentation.pdf`, `fixed/presentation.pptx`, rendered page/contact PNGs.
- `website-http-output-review.json`, `all-final-ai-provider-calls.json`,
  `ai-fixture-cleanup.json`, `http-env-cleanup.json`.
- `profile-publication-{preview,public}-review.json`, `profile-public-form.json`,
  `public-static-recovery.json`, the separate cloud attempt receipts.
- `checkout-endpoint-check.json`, failed-old-secret read retained separately;
  correct current staging job secret returned both health reads successfully.
- `tests-final.log`, `lint-final.log`, `type-after-build.log`, `build-final.log`,
  `controller-checks.log`, `publication-executor-checks.log`.

No private configuration, credentials, raw webhook payloads or generated fixture
account credentials belong in a public commit.

## Execution addendum — final recovery result

Preparation `b958e1e1-d353-4d97-83b0-6d86fd3a6162` was claimed at
`2026-10-21T11:39:23.920Z`, lease ending `11:44:23.920Z`. The fault marker records
the actual watchdog command acceptance; systemd logs show exit137 and a new
worker process. No graceful handler or `finally` cleanup ran. The same preparation
subsequently became ready at attempt2/fence2. No timestamp was rewritten and no
provider response was invented. The independent denied-network probe from the
first actual compiler run remains separate evidence.

All **13** real VM sessions across successful and failed probes were independently
read back as stopped with `resume:false`. This includes the three initial
storage-failure compiler sessions, the three successful normal sessions, the three
ineffective self-signal probe sessions and the four genuine abrupt-exit/recovery
sessions. These are cumulative counts, not per-retry reset quotas.

The retained two-route HTML is exactly equal to the earlier reviewed normal
output. Staging API approval published revision9; public HTTPS desktop/mobile
checks passed again with no page errors. The staging controller is now stopped
and disabled, its private host environment/configuration removed, its restricted
login disabled/expired, and no queued/running preparation remains. Final registry
deletion receipts confirm both repositories were removed. Private test Docker
authentication was removed again. The same aggregate reservation is retained for
bounded pending sandbox billing callbacks/reads; it permits no further VMs,
deployment or AI call without a new reviewed reservation.

Read-only production boundary verification at `11:47:36Z` confirms makeborne.com
still points to READY deployment `dpl_ENjea1fLgLqR54bVLUcvMHXjfUfr`, source
`70a1d91`, in the production project. No deployment or activation occurred here.

**Commercial launch is still not cleared:** the fresh subscription/two-pack
purchases await the existing sandbox terms approval; bound monthly renewal and
renewal-failure provider evidence is not yet available. Do not turn those rows
green because AI and publishing passed.
