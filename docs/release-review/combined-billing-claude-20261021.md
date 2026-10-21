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
| Secret pattern scan |417 changed paths, zero findings; not a complete secret-discovery guarantee |
| Eval live-path safety self-test |46/46 with fakes, no paid calls |

The frozen-commit105-chain SQL/recovery rerun completed:69/72 pass, three documented skips, zero failures, identical recovery schema. SQL is unchanged in final runtime3e8e518. Its actual committed-tree inventory check passes (1496 source files); Windows Git needed local core.longpaths=true to inspect an existing long document path. GitHub PR39520191870 and push39520186209 both pass at that head, as do Vercel checks. Report-only edits after it do not alter the frozen runtime.

## Staging

Only `xzwikrunwpurxnxgkznh` and `makeborne-release-staging` were changed. The compatible preview was READY before applying:

1. `20261020203000_scope_revocation_boundaries.sql`
2. `20261020210000_artifact_card_previews.sql`
3. `20261020231225_billing_ux_details_and_limits.sql`

Strict raw hashes of all prior staged migrations match. New migrations were LF-pinned before their first staging application. Existing billing flags are unchanged. Security advisors:11WARN before and after, identical, zero new.

Ordering deviation: the stable QA alias still pointed to the preceding application while these migrations ran. It was corrected immediately afterward. Creating an unused compatible preview is insufficient: production must actually route traffic to compatible code before the code-first migration. No failure was observed, but the compatibility gap is not claimed safe. Final UI-copy preview eqmo0h7pd now owns the QA alias.

Actual staging HTTP/Auth/SQL/browser checks pass: sign-in; caller-scoped credit settings save/read/reject/restore; title search50+11 and account/workspace isolation; Stop/reload/settled receipt; real website/book/deck create/save/replay/stale-write refusal; real PDF/PPTX routes; anonymous review/comment/approval/revocation; project-only delivery transition. Zero page errors and zero model calls. Outputs reuse earlier real AI fixtures, so this is not a new quality sample of Claude's latest design prompt.

Real regular-account billing at375/1440 passes save/restore, no horizontal overflow and no page errors. Real preference API refuses unauthenticated401, cross-origin403 and caller-selected account400, leaving saved settings unchanged.

Runtime/SQL preview: `makeborne-release-staging-lxsrfo2ab-kerimsabic-6594s-projects.vercel.app`. A second preview, `qm0mjudry`, refreshes only the staging webhook secret to match the active sandbox webhook. Its existing sandbox API key was tested read-only and retained. The variable is verified Preview-only on the staging project; production variables were not touched. Existing staging creation/catalogue gates were already enabled; fixture preparation preserves their prior state. No live merchant or real payment method is used.

Previous cloud publication proof is reused only for unchanged controller/broker/runtime code: the reviewed production-profile integration compiled two routes in three stopped VMs and published QA revision5. This turn creates no new VMs, does not deploy a Worker and does not activate production publishing. Customer-site footer accessibility changes pass local Worker checks; they have not been newly deployed to the Worker.

## Whop: distinguish evidence levels

1. Existing sandbox key refreshed for the same13permissions through22October00:00UTC; no new scope/key or production credential.
2. Real Whop dashboard redelivery of an old refunded monthly payment reached the exact candidate route through the dedicated sandbox-only receiver. With the monthly plan omitted from the isolated harness it was correctly ignored200; that is not credit delivery. With the exact monthly plan allowed and no checkout binding, it returned503. After inserting an explicitly SYNTHETIC disposable binding to the provider's real checkout ID, genuine signed replays returned200 twice: one event receipt, one membership, zero ledger grants for the refunded purchase. The disposable DB was removed. This proves redelivery/recovery/idempotency with a fixture binding, not a fresh purchase.
3. The same original provider signature reaches the real staging app unchanged; it returns `CHECKOUT_BINDING_PENDING`503 for the old checkout absent there. The relay does not re-sign or acknowledge an app failure as success.
4. After separate action-time owner approvals, actual monthly29USD and one-time12USD checkouts used only fake4242. Real application-created account bindings, unchanged provider signatures and the actual staging webhook delivered exactly300 plan credits plus100 pack credits. The actual return page reached studio; a second subscription request returned409. Repeated/abandoned requests resumed the same unpaid checkout URL. No synthetic binding was inserted for either fresh purchase.
5. An actual6USD partial sandbox pack refund held all100 pack credits for review, leaving300 available; this is the existing deliberate policy, not a proportional50-credit reversal. Refunding the remaining6USD fully reversed the100 credits. The unused29USD subscription refund reversed300 credits; immediate cancellation reached provider and staging as canceled. A real dashboard replay of the old pack success returned200 and did not recreate credits after refund. Final ledger: +300 plan, -300 adjustment, +100 pack, -100 adjustment; exactly one grant/order each, available0.
6. The weekly probe actually charged1USD at2026-10-21T00:09:05.603Z. Original signed notification reached staging200. It has no checkout binding and is outside the monthly catalogue: this proves provider renewal only, not account-bound monthly allowance delivery. No fabricated binding or weekly catalogue entry was added.

Remaining billing qualifications: a real account-bound recurring monthly renewal/failure and distinct second-payment behavior are not proven by this cycle or duplicate replay. Annual monthly allocation/expiry and concurrency remain actual SQL-test evidence, not a year of live merchant renewals. No real production purchase was made.

## Currency safety follow-up

The real pack checkout offered BAM conversion even though its plan currency was USD. Readback confirmed adaptive_pricing_enabled=true. Existing fulfillment deliberately accepts USD principal/refunds only; conversion must not be silently treated as equivalent. The controlled paid test explicitly selected USD.

New topup-checkout guard requires adaptive_pricing_enabled=false, including when resuming a saved URL. True, missing and null values refuse before a checkout POST. Regression harness, typecheck, targeted lint, all180 offline harnesses and production build pass. Actual sandbox plan GET plus the real guard also refuses both new and resumed in-memory fixture orders with zero checkout POSTs/DB writes; this is not another purchase. Final runtime3e8e518 (normal merge of Claude86cb4b6) is READY on staging bqemlgxby/dpl_5Xf3bANP87P1R3n5LZ3X5B5UsDmb; exact project/source metadata verified. Real regular-account billing375/1440 save/read/restore and zero browser errors/overflow pass there; fixture removed. QA alias now points to it. Paid webhook journeys above belong to the preceding runtime whose delivery code is unchanged. Intended merchant pack plans must have adaptive pricing disabled/read back before live sales. No production plan was changed. Existing exposed provider URLs are not invalidated by an app refusal; their settlement/reconciliation must remain working.

Provider schema: [Whop variant adaptive-pricing setting](https://docs.whop.com/api-reference/beta/variants/variant), [checkout configuration](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration). Taxed/promo/non-USD packs remain unsupported evidence, not newly enabled.

## Real staging reconciliation and final preview

Vercel Secret exports are masked; a pulled placeholder failed authentication and was not evidence of a broken deployed secret. An existing privately saved test credential also did not authenticate. Replaced only the isolated staging project's Preview-only CRON_SECRET with64 random hex characters, stored privately; no production row or runtime key changed. MAKEBORNE_TOPUP_RECONCILE_ENABLED was absent and was added only to that staging Preview environment after the owner approved an additional1USD cloud-test allowance.

Final preview1vj34rpbv/dpl_6Ruc4YYH2CvThJg8LfzfKyRzPppG is READY with exact staging-project and3e8e518 source metadata. QA alias points to it. Both actual cron endpoints ran successfully and their health reads report overdue:false, zero open issues; top-up unchecked/exposure are0. Fixture accounts were already removed, so both jobs processed0 rows: this proves deployed authentication/job/health plumbing, not another lost-payment delivery. No production schedule was activated. Phone/desktop regular-user billing save/read/restore rerun passes, no overflow/page errors, fixture removed.

The completed unbound weekly probe was canceled after capturing its renewal evidence, preventing further fake renewals. Temporary webhook remains disabled; receiver/tunnel remain stopped. No real charge, paid model call or production change occurred.

## Budgets and retained state

Original5USD ledger:4.912877 conservatively accounted/reserved,0.087123unreserved, including currency-guard and cron-recovery preview bounds. Owner then approved a separate additional1USD staging allowance;0.10 is retained there for the completed final top-up-job preview/check. These are test ledgers including retained worst-case bounds, not provider invoices. Separate50USD Claude-API allowance:0spent. No new paid AI calls. Prior approved6USD/month controller host is unchanged and its controller remains inactive.

App rehearsal fixture user/workspace/enquiry/client cleanup is audited at zero, with prior billing flags intact. Fresh billing fixture sessions revoked, account deleted and its membership/order rows absent after private financial evidence was retained. Both fake purchases fully refunded; new recurring test membership canceled. Temporary sandbox webhook read back Disabled; path receiver and tunnel stopped. Completed one-shot renewal follow-up paused to prevent duplicate work. Existing staging webhook-secret repair remains Preview-only. No new production resource/data/env/domain/service change, main merge/push or automatic charging activation.

## Rollout and recovery

Keep production held. Before requesting its approval, finish the outstanding fresh billing evidence, review current CI and image/spending decisions, and update the exact frozen inventory. M17 requires code-first deployment; do not apply its migration under the older app.

Rollback app through a normal revert; keep additive v1-compatible SQL. Saved usage limits must remain enforced during rollback—never remove a customer's cap to hide a UI problem. Restore a usable settings UI with a reviewed forward fix if necessary. Do not drop preferences/ledger/history. Production publishing still needs owner-approved allowlist/login/bucket/controller activation and one real golden publish/unpublish test. Images and automatic charging remain separate gates. No request here grants production approval.
