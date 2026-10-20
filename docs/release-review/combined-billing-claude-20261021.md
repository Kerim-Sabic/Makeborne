# Combined Claude fixes and billing qualification — 21 October 2026

## Release state

**Production is unchanged. This is a draft release, not approval to open sales.**

Branch: `release/combined-rehearsal-20261020`, draft PR12. Main was independently read back as `d14bf303165806ab2544299c3e1b63f923a5c9ea`. Tested application/SQL checkpoint: `b63cceda62480c43c9fec985a7f0be8b02dc2652`. The final copy checkpoint changes only the cancellation-link label and removes an inaccurate reference to automatic-purchase controls being “below” when that panel is hidden. Its mounted billing, pricing and boundary checks pass; no payment behavior changes.

Merged Claude's `dd8aff6` and newer `ebd296f` through normal feature-branch merges. Both histories remain. Preserved Codex's browser font/artwork resolution and stronger publishing assertions; added Claude's code/transport classification. Copied the two inspected pending price-note/test corrections without editing Claude's source worktree. Claude's separate evaluation spending allowances are not inherited by this task.

## What is implemented

- Real project thumbnails, client/filter/sort/list/search state; target and revision-aware edits, plan maxima and conflict handling.
- Route/fragment/history continuity; version comparison, checkpoints, file search, saved/checked/live facts and output-based publication checks.
- Scope/revocation fixes, connection and trust copy, advisor-to-brief handoff and command palette.
- More varied design seeds, motion/accessibility guidance and output gates. Contributor image-routing work is integrated, but no image key/allowlist or production activation is added here. Observed image-token counts plus headroom are not provider-guaranteed maxima; that limitation remains explicit.
- Billing starts with balance and holds, then itemized usage, subscription/receipts, controls and catalogue. Rows link to accessible projects and show action mode, real plan/paid/other funding and clearly labelled whole-request totals.
- Stored subscription status, standard price and recorded period end are distinguished from a live invoice. Cancellation and plan changes request support; neither silently changes a subscription. Actual next-charge/tax/discount facts remain in Whop.
- Independent account low-balance alert and optional UTC-month credit-usage cap. Alerts are on this page, not email. The server enforces the cap under the same wallet lock as reservations; buying credits cannot reset it. Automatic charging remains unimplemented/off.
- Before sending, a known insufficient wallet explains the problem without discarding the draft or lowering the approved maximum. The server hold remains authoritative.
- Usage excludes grants and expiry explicitly. It never invents missing funding or reveals a revoked project's IDs.

## Independent checks

| Check | Result |
|---|---|
| Typecheck, full lint, production webpack build | PASS |
| Offline harnesses | 180/180; five documented interactive/tariff exclusions |
| Mounted Chromium harnesses | 28/28, including Stop, publishing recovery, intent, thumbnails, continuity, compare, advisor handoff and billing |
| Complete 105-file migration chain | 69/72 SQL suites pass, zero failures; three documented environment/upgrade-path skips |
| Actual concurrent credit cap | Eight connections compete for30-credit holds under100: exactly3 admitted,5 refused; replay/settlement preserve the cap |
| Usage v2 scale |100000 reservations plus100000 ledger rows; two UTC months,5000 unique rows/10pages each, correct10000-credit monthly sum; about0.97s per ten-page read locally |
| Migration recovery | Normal, injected failure and terminated backend converge to identical schema/ACL/policy/flags |
| Secret pattern scan |413 changed paths, zero findings; not a complete secret-discovery guarantee |
| Eval live-path safety self-test |46/46 with fakes, no paid calls |

The frozen-commit SQL/recovery rerun and current GitHub checks have separate private receipts; check their latest status before release. Do not substitute earlier green runs for the current head.

## Staging

Only `xzwikrunwpurxnxgkznh` and `makeborne-release-staging` were changed. Deployed code BEFORE applying:

1. `20261020203000_scope_revocation_boundaries.sql`
2. `20261020210000_artifact_card_previews.sql`
3. `20261020231225_billing_ux_details_and_limits.sql`

Strict raw hashes of all prior staged migrations match. New migrations were LF-pinned before their first staging application. Existing billing flags are unchanged. Security advisors:11WARN before and after, identical, zero new.

Actual staging HTTP/Auth/SQL/browser checks pass: sign-in; caller-scoped credit settings save/read/reject/restore; title search50+11 and account/workspace isolation; Stop/reload/settled receipt; real website/book/deck create/save/replay/stale-write refusal; real PDF/PPTX routes; anonymous review/comment/approval/revocation; project-only delivery transition. Zero page errors and zero model calls. Outputs reuse earlier real AI fixtures, so this is not a new quality sample of Claude's latest design prompt.

Real regular-account billing at375/1440 passes save/restore, no horizontal overflow and no page errors. Real preference API refuses unauthenticated401, cross-origin403 and caller-selected account400, leaving saved settings unchanged.

Runtime/SQL preview: `makeborne-release-staging-lxsrfo2ab-kerimsabic-6594s-projects.vercel.app`. A second preview, `qm0mjudry`, refreshes only the staging webhook secret to match the active sandbox webhook. Its existing sandbox API key was tested read-only and retained. The variable is verified Preview-only on the staging project; production variables were not touched. Existing staging creation/catalogue gates were already enabled; fixture preparation preserves their prior state. No live merchant or real payment method is used.

Previous cloud publication proof is reused only for unchanged controller/broker/runtime code: the reviewed production-profile integration compiled two routes in three stopped VMs and published QA revision5. This turn creates no new VMs, does not deploy a Worker and does not activate production publishing. Customer-site footer accessibility changes pass local Worker checks; they have not been newly deployed to the Worker.

## Whop: distinguish evidence levels

1. Existing sandbox key refreshed for the same13permissions through22October00:00UTC; no new scope/key or production credential.
2. Real Whop dashboard redelivery of an old refunded monthly payment reached the exact candidate route through the dedicated sandbox-only receiver. With the monthly plan omitted from the isolated harness it was correctly ignored200; that is not credit delivery. With the exact monthly plan allowed and no checkout binding, it returned503. After inserting an explicitly SYNTHETIC disposable binding to the provider's real checkout ID, genuine signed replays returned200 twice: one event receipt, one membership, zero ledger grants for the refunded purchase. The disposable DB was removed. This proves redelivery/recovery/idempotency with a fixture binding, not a fresh purchase.
3. The same original provider signature reaches the real staging app unchanged; it returns `CHECKOUT_BINDING_PENDING`503 for the old checkout absent there. The relay does not re-sign or acknowledge an app failure as success.
4. A new regular staging account actually signs in and creates one new monthly29USD SANDBOX checkout through the real app. Repeated request IDs and a new request resume the same URL. The fake4242card is selected. Purchase submission is pending the owner's action-time consent to the displayed terms.
5. The weekly probe is due21October00:08:59UTC. It has no Makeborne checkout binding and is outside the monthly catalogue. Such an event can be ignored200 as unconfigured; it must never earn a monthly allowance. A real weekly charge proves provider renewal only, not account-bound customer-credit delivery.

Pending: fresh bound subscription and pack settlement/return, duplicate subscription refusal after purchase, pack partial/full refunds and second-payment behavior, plus the actual upcoming renewal observation. Do not mark these passed from local signatures, mocked Whop, initial trial-ending charges or the old refunded replay.

## Budgets and retained state

Original5USD ledger:4.712877 conservatively accounted/reserved,0.287123unreserved. This is a test ledger including retained worst-case bounds, not a provider invoice. Separate50USD Claude-API allowance:0spent. No new paid AI calls. Prior approved6USD/month controller host is unchanged and its controller remains inactive.

App rehearsal fixture user/workspace/enquiry/client cleanup is audited at zero, with prior billing flags intact. New billing test account and unpaid checkout are retained privately pending checkout confirmation. The sandbox-only path relay/tunnel is retained for the near-term renewal check; all other paths refuse. The scheduled follow-up owns final disable/stop/cleanup if the active run has ended. No new production resource/data/env/domain/service change, main merge/push or automatic charging activation.

## Rollout and recovery

Keep production held. Before requesting its approval, finish the outstanding fresh billing evidence, review current CI and image/spending decisions, and update the exact frozen inventory. M17 requires code-first deployment; do not apply its migration under the older app.

Rollback app through a normal revert; keep additive v1-compatible SQL. Saved usage limits must remain enforced during rollback—never remove a customer's cap to hide a UI problem. Restore a usable settings UI with a reviewed forward fix if necessary. Do not drop preferences/ledger/history. Production publishing still needs owner-approved allowlist/login/bucket/controller activation and one real golden publish/unpublish test. Images and automatic charging remain separate gates. No request here grants production approval.
