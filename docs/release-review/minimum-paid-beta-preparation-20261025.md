# Minimum paid beta preparation — 25 October 2026

Status: staging qualification in progress; NO production activation or merge approval assumed.

## Owner decisions

New production offers: Create $20/$192, Studio $49/$470.40, Scale $99/$950.40 monthly/yearly. No trial or intro discount. Full refunds only when none of that payment's credits were used, handled by support; statutory/provider exceptions remain. Annual payments follow the same payment-wide rule, not prorated refunds of future months.

Production opening decision, NOT applied: global/Anthropic $10 per UTC day; OpenAI/images off. No per-user daily cap; credit holds still bound individual work. Emergency stop uses the global provider limit, never creation_enabled. If the November 20 renewal probes fail, close new subscription sales before November 24. Subscription end preserves saved site content but stops serving it, without grace. Publishing accepts 24-hour positive verification in background and at most 10 preparations per workspace per rolling hour. Existing packs $12/$32/$95 unchanged; pack checkout remains outside this beta.

## Integration and corrections

- Claude 3ce1e8b → b60e734: recover a possibly paid checkout before offering it again; resilient return polling and support route.
- Claude 197d085 → da9a473: visible paused-AI explanation.
- Claude ed1a0ac → 0543a24: opt-in publishing entitlement, production schema-3 controller; default allowlist and strict staging namespace preserved.
- Added owner-requested 10/workspace/hour limit, retaining the existing 30/account/hour ceiling. Replays do not consume another slot; concurrent workspace requests serialize.
- Reproduced and fixed refund/promotion ordering with actual local concurrent transactions: a previously blocked promotion could commit after refund revocation. Publication now shares finance's membership advisory lock. Refund-first refuses promotion; publish-first completes before the refund commits. Existing last-good behavior preserved.
- Abandoned checkout lookahead is reported separately from failed financial reconciliation. Eleven ordinary unpaid checkouts no longer prevent a successful job; failed/review recoveries still make it partial. Daily cron prepared at 03:17 UTC. Preview qualification invokes it manually; Vercel schedules it only after an approved production deployment.
- Production monthly catalog IDs updated from independently verified new hidden plans; annual mapping prepared. Production DB/env not changed. All six new offers hidden and out of stock; old offers and November probes untouched.
- Staging checkout returns only to its exact Vercel deployment hostname, under the existing exact-project/database/merchant sandbox guard. Local sandbox stays on Whop; production stays on makeborne.com. Caller Origin cannot choose a return host.
- Terms v9 explicitly cover full unused annual-payment refunds; checkout metadata records the terms version.

## Dependency safety

Installation audit reported Next critical advisories, Zod high severity, Undici high severity and sanitize-html moderate severity. Verified primary advisory pages and registry availability. Updated Next/eslint-config-next 16.4.3, Zod 4.6.6, sanitize-html 2.18.1 and Undici 7.30.1; patched the controller's transitive dependencies too. Both installed app and controller audit with zero vulnerabilities. No force upgrade or production patch performed.

Sources: https://github.com/advisories/GHSA-2464-fhr4-w9xw ; https://github.com/advisories/GHSA-673q-mjm6-r5xr ; https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 .

## Local evidence

- npm ci; patched production build; typecheck and full lint pass. The first parallel typecheck overlapped Next's generated-type cleanup and failed with missing .next/types files; rerunning after build succeeds. This was a harness scheduling failure, not silently counted as a pass.
- 187/187 offline harnesses pass; five existing exclusions remain explicit. Checkout redirect/terms and catalog mapping also have targeted checks after their final edits; final frozen-candidate run required before staging.
- Chromium mounted checks: paused builder, checkout return, header, connection wording and review draft restoration all pass (5/5 harnesses).
- Controller build/check: startup groups, nine profile groups and three actual SDK no-implicit-resume checks pass, with zero provider calls.
- Disposable network-disabled Postgres: complete candidate chain, 16 publication SQL groups, real refund ordering, rollback/reapply and seven existing hosting/publication suites pass. Existing databases untouched. See publication-beta-local-20261025.json.
- Rollback comparison initially failed because old migration function bodies mix LF/CRLF. Verified differences were newline-only. Report retains raw hashes and compares canonical SQL without changing any other characters. New migration and rollback file pinned LF before staging. A separate test-fixture leak initially blocked namespace switching; exact isolated-fixture cleanup fixes that, with the final full rehearsal passing.

## Staging migration

Only 20261025200000 applied to xzwikrunwpurxnxgkznh after a rolled-back dry run. Exact hash recorded privately; scope allowlist and billing settings unchanged. Security advisor remains 11 WARN, zero new WARN. One new INFO identifies the intentionally deny-all RLS on the private owner-only scope singleton. Initial whole-object comparison also flagged refreshed observation timestamps; this was reviewed explicitly, not treated as new security warnings. No production migration applied.

## Access and budgets

Dedicated primary ledger: outputs/eval/budget/minimum-paid-beta-20261025.ledger.json. Exactly $5 Anthropic reserved for one staging build; $3 cloud reserved for staging build/publication qualification. Prior reservations stay separate. No paid AI or new cloud VMs at this checkpoint; actual deployment charges require provider accounting.

A diagnostic read exposed an old staging automation-bypass value. Created its replacement privately and revoked the old value; verified only the replacement remains. It must be removed after testing. Production credentials unaffected. The old staging R2 access returns 401; a 24-hour staging-bucket-only replacement is prepared awaiting the browser's required action-time confirmation. Sandbox API expiry extension to November 30 is also prepared awaiting confirmation.

## Still required before final GO report

Freeze and deploy this exact candidate to staging; actual automatic Whop delivery, protected reconcile run/health/in-app alert, browser return/close-tab and cancel-at-period-end. Signed-in header/manual-export/anonymous-review journeys on that deployment. One non-admin paid build inside $5. Publishing option B3 using only the verified disposable QA owner, bounded cloud tests and restoration; production entitled scope remains conditional on that pass. Prepare explicit production backup/apply/stop/rollback steps and normal PR, then STOP for owner final GO. Production emergency-stop rehearsal, sales opening, live purchase/refund and 30-minute watch happen only after that GO.

Priority-2 GitHub/CRM/agency/design branches are excluded from this release and remain off.
