# Four-fix and ordinary-subscriber qualification — 26 October 2026

Status: four functional fixes qualified with an ordinary subscriber. Production remains unchanged. A staging financial-reconciliation cleanup limitation and separate launch blockers remain below.

## Candidate and boundaries

Branch qualification/consumer-billing-20261026. Cloud-qualified behavior: 0f5a9d42d25c35dd6e2cee654c608cbdf8d65590. Final local candidate: 4fe4fe5f00698daa53744e1223133fcbc5edc4e0 (only additional change: a deterministic measured-result summary, covered by the same passed/failed/unavailable regression). Local-only commits bfa3834, b5e34e4, 37085e6, bf63510, c1033d8, 0f5a9d4 and 4fe4fe5. No production change, push or merge. No migration was added in this follow-up. Claude coordination entries are in AGENT_HANDOFF; no acknowledgment is assumed.

Only fictional staging fixtures and a USD 20/month fake 4242 sandbox subscription are used. The November renewal probes are excluded. The subscriber has no admin or unlimited-credit grant. Its initial allocation was 300 credits.

## Fixes and observed evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Report retry | Real ordinary-subscriber report generated verified USD 430, PDF and facts. Exact action replay returns 200 with the same version/files and no second model call. Changed title 409; wrong digest 409. Fingerprint binds approved revision/source/options/facts. | PASS |
| Review classifier | Trusted renderer marks only structural counters. Chromium regression retains real quantities, dates, prices and notes. Real 6-slide/PPTX review removes structural false positives. It still reports 7 unapproved timeline claims plus 2 layout findings. | Classifier PASS; fictional deck intentionally changes_needed |
| Best continuation | Same 50-credit authorization resumes 3/4 saved deck; first paid call is pending image. Final 4/4 verified 4:3 Best slides, 4 distinct SHA values; 3 prior assets preserved. PDF: 4 pages, 960 × 720 pt. Too-small allowance refuses before provider calls/charge. | PASS |
| Subscriber billing | Fresh actual sandbox Create purchase grants 300. Website saved v2, one call USD 0.343241/12 credits; reportUSD0.018644/1 credit; reviewUSD0.067508/3 credits; Best recoveryUSD0.296584/10 credits. | PASS |
| Expired verification mid-build | Actual subscriber comp attempt exposed 42501 after five-minute verification expiry; stopped with 0 customer charge. Forward fix re-fetches fenced actor and verifies actual Whop, retrying same admission ticket once. Injected expiry on 37085e6 renewed with Whop and continued; revoked identities/Stop/caps remain denied. | PASS |
| Comp fidelity | Real weight support, headline lines, repeated finish gate and explicit measured/not-checked coverage implemented. Previous cloud run honestly returned not_checked: missing Playwright resource. /api/build now explicitly traces browser packages/binary. Approved-photo allocation no longer reserves unused hypothetical slots. | PASS: all four targets measured on cloud 0f5a9d4 |

## Validation

- Final 4fe4fe5 full offline suite 225/225. Image-vision harness now has 17 groups, including ordinary-edit saved-reference checks.
- TypeScript pass; full ESLint: 0 errors/one existing catImage warning.
- Optimized local production build passes. Build trace includes playwright-core/browsers.json and Chromium binary.
- Diff scan: 580 files against 9 available private values/PEM pattern: clear; private evidence excluded from Git.
- Staging security advisor: 11 WARN / 0 ERROR, unchanged.
- Exact final cloud source independently matches 2339/2339 files.
- Desktop 1440 and phone 375 signed-in browser: correct preview heading, 0 page errors; screenshots visually inspected.

## Staging deployment deviation

Local work/release-auth-stack was found empty during testing; the cause is not established. No credentials were reconstructed or weakened. The documented Vercel deploymentId+files API rebuilt the exact source in the isolated staging project. Live preflight proved prior inline image settings were not retained; that rejected attempt made 0 provider calls. A second preview explicitly supplies existing private local provider keys and comp-only settings, with new sales/mail/publication disabled. Included Hobby Basic build only; no Sandbox VMs or new paid compute subscription. The previous staging preview was used for real Whop verification, then removed with the other isolated previews.

## Final comp evidence

Fresh run produced 4 approved comps and 1 vessel photograph. The first cloud attempt exposed missing browser resources; the next exposed protected static assets. Browser packaging plus a preview-only private token fallback fixes these without weakening protection. Production ignores that fallback; headers reach only same-origin static runtime paths.

A further real edit exposed saved readings being selected only for reviews. Ordinary edits and continuations now use the stored readings too. Final text-only verification saved v4, finished:true, compFidelity:passed, measured hero (desktop), hero (mobile), collection (desktop), studio (desktop), notChecked:[]. It found an actual hero photo/text overlap, repaired the columns and rechecked successfully. No new images were bought. Independent version 2 → 4 comparison preserves all 4 reference entries, source assets and asset manifest exactly. This is a measured geometric/font/line-count comparison, not a universal visual-quality guarantee.

The model writes its notes before finish measures the site. The local summary-only follow-up always prints the authoritative server pass/fail/not-checked result after those notes, so earlier estimates cannot obscure the measured result. That formatting delta is locally tested; it was not separately deployed after the cloud behavior pass.

## Accounting and cleanup

Scope full-version-staging-20261026, including earlier full-version tests: **USD9.331320 /13**. Anthropic6.994286/10; OpenAI2.337034/3. Remaining3.668680 (A3.005714/O0.662966). All reservations settled,0unknown,0open provider calls. Uncertain earlier image cost remains counted at its bound. No additional paid cloud machine, VM, subscription or compute allowance was used; included Hobby Basic builds only.

Subscriber initial grant300;101credits charged across8settled runs,2other holds released, final reserved0. Actual total confirmed provider spend is reconciled separately from customer charges; the failed pre-repair lease attempt cost0.228191 and charged0.

Approved USD20 fake4242 payment pay_NYZvDUfnBG3I5R fully refunded in Whop dashboard. Exact membership mem_jXjjv2PDNwwUcD immediately terminated; Makeborne force-verification reads canceled, verification epoch0, checkout status pending/no active access. November probes untouched. Evidence includes dashboard screenshots privately.

**Financial cleanup limitation:** no automatic webhook was connected for this subscriber test. The old local cron secret returns401, so the financial refund reconciliation was NOT run or declared passed. The retired fixture retains its199credit historical balance, reserved0, awaiting legitimate reconciliation/expiry; it was not manually zeroed or its history erased. A refund while Whop still marked the membership active remained active until cancellation; that is not refund-webhook qualification. Restore the private staging configuration or qualified reconcile access before closing that billing gate.

Fixture banned and globally signed out,0sessions,0privilege rows. Fictional source/assets retained for audit. All10exact isolated previews removed with safe removal; shared staging and production untouched. All provider limits disabled. Temporary request copies were scrubbed of provider/OIDC values; original private provider configuration remains intact. No test tunnel or new credential was created in this follow-up.

## Remaining release gates

This report does not resolve seller-managed consumer tax/hosted checkout CTA/confirmation requirements, actual November renewals, custom domains, production publishing qualification, Google review, or other separately unqualified areas. A review finding is not an approved claim; a saved functional website is not an unmeasured fidelity pass.

Claude also reported direct Whop store/affiliate purchases lack Makeborne account binding. This scope does not independently clear that finding. Keep launch traffic on Makeborne-created bound checkouts; do not auto-bind a purchase by matching email alone.

Private evidence location: outputs/four-fixes-qualification-20261026 (excluded from Git). Key records: final-source-verification.json, comp-integrity.json, comp-final-browser.json, best-integrity.json, subscription-cleanup.json, fixture-retired.json, final-cleanup.json and scoped spend records.
