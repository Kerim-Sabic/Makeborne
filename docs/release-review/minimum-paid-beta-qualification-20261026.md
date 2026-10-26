# Minimum paid beta qualification — 26 October 2026

## Decision

**Staging qualification substantially complete; production remains CLOSED pending owner GO and the remaining gates below.** Runtime app candidate: `5f655a73720775daa1ba9b7297ee2f751facf4ab`, branch `release/minimum-launch-20261025`. Exact tested preview: `makeborne-release-staging-den2sk74d-kerimsabic-6594s-projects.vercel.app`, deployment `dpl_5LEjDAY9iHXBejU6jzXeHBS5LR44`.

No production app, database, environment, Worker or publishing-controller changes, push, merge or deployment occurred during this qualification. Earlier explicitly authorized preparation of hidden production Whop plans is separate; sales remain closed. No subscription was purchased.

## Results

| Gate | Result and evidence |
| --- | --- |
| Local candidate | 187/187 offline harnesses, full typecheck, ESLint and production build pass. Config-only follow-up pins the Cloudflare account and tests that pin. Full suite rerun passes with the follow-up. |
| Staging migration | Only `20261025200000_paying_workspace_publication.sql` applied to exact staging project `xzwikrunwpurxnxgkznh`; default scope allowlist. 11 WARN before/after, no new WARN; expected private-table INFO reviewed. Prior full-chain rehearsal and rollback evidence retained. |
| Automatic Whop delivery | Real sandbox $20 Create subscription: provider-delivered membership/payment events HTTP 200; exactly 300 credits. Matching receipts recorded. Invalid signature and wrong company refused; duplicate event does not grant twice. |
| Billing UX | Real checkout and return to studio observed. Existing active subscription blocks another checkout with 409. Cancel-at-period-end readback preserves paid access. Full refund plus immediate cancellation observed through provider reads and real webhook logs; wallet ends 0/0. |
| Reconciliation | Protected route refuses unauthenticated requests. Final run 40 succeeded: overdue false, openIssues 0, zero errors. One earlier failed run remains in historical 24-hour metrics. Preview cron was invoked manually; preview deployments do not prove the daily production scheduler fires. Daily schedule is in the candidate. |
| AI | Original Northline site saved and rendered on desktop and phone; no captured console errors. Medium build charged 16 credits. Earlier Light stream failed with uncertain usage and no customer charge; continuation truncated and charged 3 confirmed credits without a usable saved result. Stop worked. These failures are retained, not described as fixed. |
| Paying-workspace publication (B3) | Removed admin from the exact disposable QA account during qualification. Paid membership alone admitted preparation. Real cloud compiler plus renderer built `/` and `/work`; approved/promoted output was public over HTTPS, including the imported artwork. Admin grant restored after lapsed-access checks. Not a second independent workspace. |
| Publication recovery | Readable approved preview after 303 seconds. Edited version republished. A deliberately broken replacement exhausted 3 attempts while the previous good public HTML hash stayed unchanged. Restore, unpublish (404), fresh republish (200) passed. Ended subscription stopped serving the retained live site and new prepare returned 402. Owner could still unpublish. |
| Isolation | All 19 short VMs independently stopped, non-persistent, one vCPU, deny-all network. Direct probes in each VM: UID 1000, loopback available, external requests blocked, no secret environment keys. An edit compile retried after cleanup uncertainty. No fresh intentional mid-compile kill drill is claimed; earlier unchanged-controller recovery evidence remains separate. |
| Public website/forms | Desktop and 375px phone layout, menu, image and form checked. Phone enquiry reached the correct inbox and CRM lead. Duplicate deduplicated, changed replay 409, cross-origin 403. `/robots.txt` 200; staging `/sitemap.xml` 404 is deliberate noindex policy. |
| Anonymous review | Anonymous fetch and approval worked without account cookies. After agency updated the shared snapshot, stale approval returned REVIEW_STALE 409. Merely changing the working artifact does not change the shared snapshot. Test link revoked; subsequent write 404. |

Evidence is in ignored `work/qualification/beta-*` files. Financial and provider evidence contains identifiers and remains private. Key sanitized evidence: `beta-cron-after.json`, `beta-webhook-boundaries.json`, `beta-cancel-at-period-end.json`, `beta-ai-cost.json`, `beta-cloud-session-evidence.json`, `beta-failure-preserves-live.json`, `beta-refund-lapsed-access.json`, `beta-review-stale-after-refresh.json`.

## Budget

- Dedicated Anthropic allowance $5. **$0.959960 accounted**, including $0.395555 uncertain usage at its full reserved bound; confirmed usage $0.564405. This is not an invoice reconciliation.
- Dedicated cloud allowance $3. **$2.96 conservative retained bound**: 19 VMs × $0.14 plus $0.30 storage. All VMs stopped. Four Basic builds reconciled to included Hobby build compute with current team/deployment evidence; not a claim of zero total Vercel invoice.
- No additional paid AI, VM or production compute authorized by this report. Ledger: primary checkout `outputs/eval/budget/minimum-paid-beta-20261025.ledger.json`.

## Cleanup and deviations

- Original test subscription fully refunded/cancelled. Expected refund-after-use issue 81 preserved then resolved by database owner, granting zero credits. Resolution reason is in local evidence; the null-tier SQL branch does not persist the supplied note.
- All 19 VMs stopped; both exact temporary staging image repositories deleted. Controller staging service stopped/disabled; temporary host configuration removed. Restricted staging SQL login disabled, expired, password removed and worker-role membership revoked.
- Temporary R2 key deleted; old key read returns 401. Only 27 objects from this test's exact prefixes were deleted; older staging objects and production bucket untouched.
- Test enquiries and the newly created CRM lead deleted after backups. Original site republished as version 6/revision 22. Fictional AI sample and financial/review/version audit records retained for inspection; no claim that all staging rows are unchanged.
- Temporary sandbox webhook disabled and bypass removed from its saved URL. Vercel bypass revoked; old value returns 302. Staging Worker transport token invalidated; subsequent form delivery returns 503 safely. No valid temporary external transport remains.
- Shared Wrangler login belongs to another owner account. An initial unpinned operation created a NEW unrouted staging-named Worker in that account; the exact resource and bindings were removed. Existing Makeborne Worker was never missing. Shared credentials remained unchanged. Follow-up pins `account_id` and adds a regression check. No unrelated or production Worker changed.
- First new namespace assertion was before its local config declaration and failed the harness. Ordering corrected; final 187/187 passed. This was a test correction, not an application defect.

## Remaining gates before opening sales

1. **Close checkout before return is now observed, with a credit-delivery limitation.** Owner approved the additional fake $20 purchase. Checkout closed at 00:43:44 UTC while still on sandbox.whop.com displaying Processing payment; Whop subsequently delivered membership/payment webhooks at 00:43:46/48, both HTTP 200. No return-page visit was needed for those deliveries. However, this reused account had a previous refunded allowance in the same month: the existing account_overlap guard raised issue 82 and correctly withheld another allocation. This journey therefore proves post-close webhook receipt/account binding, NOT fresh-account credit delivery. Purchase fully refunded and cancelled, wallet 0/0. The billing UX must block this unsupported re-subscription before charging or clearly route it to support; do not weaken the financial overlap guard. A clean-account close-tab credit test remains unqualified. Evidence: beta-close-tab-browser.json, beta-close-tab-provider-log.txt, beta-close-tab-delivered.private.json and beta-close-tab-refund.private.json. Issue preserved and resolved only after test refund/cancel, granting zero; local evidence retains the reason. Temporary webhook disabled and staging bypass revoked again.
2. Owner purchases Vercel Pro himself; team still Hobby at verification. Re-read plan before any commercial launch. No purchase made by Codex.
3. Owner final production GO for exact frozen candidate and reviewed delta. Then backup, explicit-target migration dry run/apply, narrow env/DB changes, normal PR merge/deploy, golden publication, real owner purchase/refund and 30-minute watch. None completed here.
4. Real monthly renewal/failed-renewal observations remain due 20 November. Leave probe subscriptions unchanged. If they fail, owner stop rule closes new creation checkout before 24 November.
5. Before 19 November, rotate production publishing credentials (currently expire around 20 November) under owner approval and republish drill.

## Production release delta / exclusions

Use the existing release checklist and exact production baseline readback; never bare `supabase db push`. Migration intended for this slice is `20261025200000_paying_workspace_publication.sql`; do not assume it is the only pending file without a fresh explicit-target comparison. Preserve historical Whop plan mappings independently from the six new checkout offers. Activate entitled publication only after matching production controller schema 3 and owner approval; keep 10 preparations/workspace/hour and 24-hour plan verification. Future production AI global=Anthropic $10/day is owner-approved policy but **not applied**; rehearse global-limit emergency stop before opening. Never use creation_enabled as the AI stop.

Images/OpenAI, plan switching, new packs, automatic top-ups, continuous GitHub sync, custom domains and Gmail automation remain outside this minimum activation. Top-ups retain existing policy, not silently opened. Do not claim manual one-way GitHub export is continuous synchronization.

## Rollback

Keep checkout closed until final GO. If activation fails later: disable creation/top-up env flags as applicable, redeploy; disable global AI provider spending separately; stop the production publishing controller and restore the previous Worker/app deployment as reviewed. Revert via normal PR. Additive migration stays unless demonstrably harmful; never drop data as an automatic rollback. No rollback or production activation was executed in this staging run.
