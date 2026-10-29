# Minimum paid beta — qualification progress, 25 October 2026

Status: NO GO. No production merge, app deployment, database/env activation or new sales.

## Candidate and preparation
- Release branch: release/minimum-launch-20261025. Runtime candidate: 9e90f50b228c284395e2fe71951b493423170315 (supersedes386293d).
- Claude3ce1e8b,197d085,ed1a0ac integrated and reviewed. Controller schema3 retained with staging/production separation.
- Production Whop merchant preparation only: six hidden, out-of-stock offers at20/192,49/470.40,99/950.40. Existing offers retained. No real purchase. Final GO must include making these offers purchasable; the app flag alone cannot override out-of-stock.
- New checkout selector WHOP_CREATION_CHECKOUT_PLAN_IDS separates six current sale offers from historical access and credit mappings. Never remove old mappings merely to avoid checkout ambiguity.
- Production delta is draft only. Preserve existing historical production mappings when merging the new six IDs.

## Verified
- Local full migration rehearsal,16publication SQL groups,7regression suites,actual refund/publication concurrency,rollback/reapply pass (publication-beta-local-20261025.json).
- Workspace10publishes/hour guard and finance advisory-lock ordering corrected. Replay does not consume another preparation.
- Dependency security updates: installed app/controller audit0vulnerabilities. Types/full lint pass after latest checkout correction. Earlier full187/187 pass; fresh final-head full run in progress. No test failure is being relabeled a pass.
- Exact staging ref xzwikrunwpurxnxgkznh: only20261025200000 applied. Scopeallowlist. Advisor11WARN before/after,none new; one reviewed private deny-allRLS INFO.
- Two staging deployments386293d READY. Third9e90f50 deployment and final whole-suite rerun in progress.
- Protected cron401withoutauthorization;200health withauthorization. First run34 partial unknownPlan4,overduetrue: legacy sandbox plan absent from new-only runtime mapping. Evidence preserved.
- Restored legacy sandbox mapping; run35 succeeded,unknownPlan0,failed0,overduefalse,openIssues0. Existing November subscriptions only read by normal reconciliation; no cancel/refund/payment-method/renewal changes.
- Real admin Overview displays failed-run alert plus latest-success time. Alert is in-app, not external email/pager.
- Signed-in editor and manual-export wording observed on staging386293d; paused-AI reason visible. New final deployment must be rechecked.

## Remaining gates
1. Verify final deployment's six current offers plus old renewal mapping, full checks and exact deployment identity.
2. Automatic provider webhook through temporary bypass, new fake-card purchase, return/close-tab recovery,cancel-at-period-endreadback,cleanup. Earlier six purchases were manual-event evidence and do not prove automatic delivery.
3. Real signed-out review-link journey and responsive exact-deployment evidence.
4. One small Anthropic build under5USD dedicated reservation. No paidAI calls yet.
5. B3 ordinary paying-account cloud publication,full route/preview/failure/lapsed-access checks. No VM started yet; disposable QA grant/site/source/wallet snapshotted; account's old exposed fixture password replaced and sessions revoked. Admin privilege not removed yet.
6. Action-time confirmations pending: existing sandbox credential expiry through30Nov; fresh24hstaging-bucket-onlyR2credential. Old R2 returns401.
7. Commercial launch blocker: owner team currently VercelHobby. Owner must upgrade himself or paid launch stays on hold. No recurring subscription purchased.
8. Production backup,exact reviewedDB/env/Whop/controller delta,normalPR,owner finalGO. Emergency provider stop rehearsal and10USD/dayopening only afterGO. Do not use creation_enabled asAIstop.
9. Real paid smoke/full-unused-refund,30minwatch onlyafterGO.

## Money and cleanup
Dedicated ledger outputs/eval/budget/minimum-paid-beta-20261025.ledger.json reserves5USDAnthropic and3USDcloud. Three build attempts bounded0.60each,sixVMmax0.14each,storage0.30,totalbound2.94. Actual cloud invoice not established; do not claim bound is charged spend. ZeroAIcalls/VMs at this checkpoint. No further build beyond three orVM beyond six without rechecking reservation.
Temporary staging bypass replacement saved privately; old exposed value revoked. Remove replacement after qualification. Staging controller remains inactive. Production controller not restarted or modified. QA privilege restoration/site restoration/refundcancel/session cleanup remain mandatory if later tests mutate them. No existing QA content deleted.

## Deliberately off/excluded
Images/OpenAI,topups/newpacks,customdomains,continuousGitHubsync,mailautomation,agencyworkflow,modelrouting and Priority2branches. Default publication scope remainsallowlist untilB3 passes; otherwise ship source download/manualGitHubexport and honestpublishingavailabilitycopy.

## Later exact-deployment findings and cleanup
- Candidate9e90f50 previewdbc6yifb8 READY; all6currentoffers returned with correct prices/allocations and legacy renewal map retained. Protected reconcile36succeeded,overduefalse.
- Browser GetCreate created one unpaid,account-bound sandbox checkout,then rejected its sandbox destination in the client. API readback200was not counted as browser success. Rootcause: client allowed onlylocalhost while server approved exact staging.
- Repaired locally with creation-only exactstaging-host navigation helper; production/unrelatedpreview negatives and unchangedtopupboundary covered.39URLchecks and mountedcheckoutbrowserPASS; latesttypes/full lintPASS; latestproductionbuildinprogress. No checkout termsaccepted,paymenttakenorrefundissued.
- Fresh full187/187suitePASS on9e90f50. Navigationpatch added afterward; finalfrozenfullsuite/remote requalificationremainrequired.
- Temporarystagingautomationbypassremoved; actualHTTPtestwithrevokedtoken302provesrejection. Initial attempt to unsetthedefaultenvflag400withnochange;directrevoke succeeded. No bypassretainedwhilewaiting.
- No fourthcloudbuildauthorizedunder currentallocation:3buildsreserved1.80leaves6VMsplusstoragewithin2.94totalbound. Reconcile actualbuildcharges or revise reservation before any furtherdeploy.
