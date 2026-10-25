# Minimum launch preparation — 25 October 2026

Status: HOLD for production. The minimum code slice is locally qualified and deployed to a separate staging preview. All six sandbox purchases, exact first-month credit allocations, refunds and immediate cancellations PASS. Full automatic webhook/renewal/reconcile qualification is NOT complete. Nothing was pushed, merged into main or changed in production.

## Candidate

- Branch release/minimum-launch-20261025, code head e8ccef9, based on fetched origin/main de7e657.
- Selective integration: 47b9544 pricing/standalone cache-marker guard; e74d201 pricing page v2; fe796ad header implementation; 6f62c7a GitHub wording; 2d5afc4 review restore race.
- Do not merge the entire pricing branch: it contains extensive unrelated design and model-orchestration ancestors. These were deliberately not imported.
- Resolved pricing-browser fixture using the new v2 fixture. Retained both handoff entries in the review-fix documentation conflict.
- No added/changed SQL migration relative to origin/main.
- Current production catalogue IDs remain unchanged. They have old prices and are refused by the new offer verifier. Do not open production until six new production IDs are obtained and qualified.

## Actual checks

- npm ci completed; TypeScript clean; full ESLint clean; webpack production build passes.
- 186/186 runnable offline harnesses pass. Five existing exclusions remain exclusions: server runtime, HTTP PDF, interactive form fixture and two expired tariff windows.
- Mounted Chromium: pricing selection/signup handoff/retry/idempotency pass; editor header 25/25; connection panel 5/5 including manual export copy; four review pre-hydration/draft restoration cases pass; signup plan-preservation fixture passes.
- Whitespace check passes. Heuristic credential-pattern scan of 77 changed tracked files found zero matches; this is not a full security audit.
- Source logs in work/qualification, excluded from commits.

## Whop sandbox changes and evidence

Owner directed Codex to use the signed-in dashboard. Created six NEW hidden offers on Makeborne Release Test in biz_e4w3EGe3izP67k. Existing plans and active renewal probes were not modified.

| Tier | Monthly plan | Yearly plan | Monthly credits |
|---|---|---|---|
| Create | plan_gZzqsdRbnaqfg — $20 | plan_7eWh1fU9rYvxm — $192 | 300 |
| Studio | plan_6MX7m5Fp2rkb6 — $49 | plan_DtmF9u0J9U0Zw — $470.40 | 750 |
| Scale | plan_Ge244bwRTLV7x — $99 | plan_29gEGs9xNdIEj — $950.40 | 1,550 |

Actual pinned-version API GETs verify merchant, USD, renewal/buy_now shape, 30/365-day cadence, zero initial fee, no trial, hidden visibility and purchasable stock. See minimum-launch-provider-contract-20261025.json. Subsequent real sandbox purchase and credit-delivery evidence is documented in minimum-launch-six-purchases-20261025.md.

Existing sandbox API key initially returned 401. Owner approved restoring that exact key through 28 October, permissions unchanged; dashboard save succeeded and API returned 200. No new key was created or printed.

Staging DB target xzwikrunwpurxnxgkznh: inserted/enabled only these six IDs in billing_access_plans, preserving previous rows. Before/after saved privately in work/qualification/staging-allowlist.json. No production DB connection or write.

## Staging

- Deployment dpl_DQeybc5KJAy7MMPdWf1aQuZKDY4R, project prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc, team team_viiayqU1BnwJBdEqgHdgmtnA, target preview.
- URL https://makeborne-release-staging-dvqrlb4cg-kerimsabic-6594s-projects.vercel.app/billing
- Remote build READY. Real browser loads pricing v2 and enabled Create/Studio/Scale buttons, monthly/yearly choice. Yearly displays $192/$470.40/$950.40 correctly. After explicit terms approval, all six sandbox purchases were submitted with fake4242, qualified, fully refunded and immediately cancelled.
- Per-deployment sandbox mapping in minimum-launch-sandbox-plans-20261025.json. No sandbox IDs substituted into production catalogue constants.
- Disabled on this preview: live AI builder, trusted publishing, asset broker, top-ups, top-up qualification/reconcile, billing reconcile and mail automation. Sandbox creation checkout remains the isolated qualification target. No model-router import or enabling of new features.
- Vercel MCP is connected to a different account with no Makeborne project. Used existing authenticated CLI after verifying exact staging project/team instead. No new Vercel credential.

## Budget

Owner approved up to $1 additional for this staging deployment/checkout qualification. Full $1 reserved in work/qualification/cloud-budget.json; one staging build submitted. Actual charge pending provider accounting; do not claim remaining headroom or $0 cloud spend. No paid AI calls and no real-money purchase.

## Still required before production approval

1. Six fresh non-admin staging accounts now pass authenticated purchase/recovery, exact 300/750/1,550 first allocations, provider periods, duplicate-subscription refusal, wrong-account refusal, full unused-payment refund/reversal, immediate cancellation, signature rejection, wrong-merchant rejection, refund replay and delayed-payment safety. Remaining: actual automatic provider webhook delivery, protected scheduled reconciliation, cancel-at-period-end and partial/dispute cases for this candidate. Sandbox intentionally returns to Whop; the Makeborne browser return page was not qualified by API polling.
2. Preserve real scheduled renewal/failure evidence separately; existing probes must not be disturbed.
3. Stage signed-in header and GitHub manual export journey, plus anonymous review race smoke on this exact deployment. Current UI evidence for these components is mounted local Chromium only.
4. Obtain/create and verify the six production offers under a separately approved preparation step; map production catalogue/env/access rows. Keep sales closed before owner activation.
5. Verify final flags/price and refund copy against production runtime behavior, spending limits, publishing entitlement and current release decisions. A tested pricing page alone does not prove customer generation/hosting is open.
6. Prepare backup, exact environment/config delta, rollback and normal PR. Owner must approve production activation. No automatic promotion.

Rollback for staging preparation: restore per-deployment flags/mappings or remove this preview; remove only the six newly added allowlist rows after testing (before state is recorded). Preserve unrelated prior rows and renewal probes. Production rollback is a normal revert plus checkout disable/redeploy if an eventual approved release requires it.
