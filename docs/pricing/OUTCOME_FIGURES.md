# Pricing page figures: where each number and claim comes from

Updated 24 October 2026 (pricing page v2, `feature/pricing-page-v2`). This file records credit counts only. It never records provider cost in US dollars, so the AI cost per credit cannot be worked out from it if the docs become public.

## Source run

- Run: the 18 October 2026 golden-brief run, `golden-20261018` (`MEASURED_RUN` in `src/lib/builder/credit-estimate.ts`; `docs/execution/BASELINE_2026-10.md`).
- Conditions: Medium effort (the default, `DEFAULT_EFFORT` in `src/lib/routing/effort.ts`), Create mode, no AI images.
- Samples: 20 first website builds; 2 first presentations (8 and 10 slides); 2 first books (13 and 38 pages).
- At the default rate the measured first builds are: website 16–45 credits, typically 32; presentation 7–9, typically 8; book 9–14, typically 12. These come from `builderEstimates(aiCostUsdPerCredit())` at render time, so they follow the live rate.
- These runs predate the later caching, review and routing changes. The page says so in its footnote. Re-measuring a full first website, deck and book on the current pipeline is a release-checklist gate, or the owner accepts publishing these figures with that footnote.

## Formulas (all in `src/lib/billing/plans.ts`, unit-tested in `src/lib/billing/check-pricing-page.cjs`)

| Figure | Formula | Create / Studio / Scale today |
| --- | --- | --- |
| Websites a month | `floor(credits / website.max)` to `floor(credits / website.median)` (`planOutcomes`) | 6–9 / 16–23 / 34–48 |
| Presentations a month | same, presentation range | 33–37 / 83–93 / 172–193 |
| Books a month | same, book range | 21–25 / 53–62 / 110–129 |
| "(2 tests)" marker | shown when a range has fewer than `FEW_SAMPLES` (5) runs | presentations and books |
| Default-effort floor | `floor(credits / BUILDER_EFFORT.medium.ceilingCredits)` (`mediumFloor`), qualified "unless you approve going past a limit" | 6 / 15 / 31 |
| Credit multiple | `credits / Create credits`; one decimal when exact, else "over N×" (`creditMultiple`) | — / 2.5× / over 5× |
| Customer price per credit | `monthlyCents / monthlyCredits`, one decimal (`pricePerCreditCents`); shown once, in FAQ "What is a credit?" | 6.7¢ / 6.5¢ / 6.4¢ |

No count is typed into JSX: `check-pricing-page.cjs` parses `creation-plans.tsx`, `plan-assurances.tsx` and `billing-workspace.tsx` with the TypeScript AST and fails on literal ranges, floors, per-credit cents or an AI cost per credit.

## Every plan includes (`PLAN_INCLUDES`) and the code that verifies each item

| Item | Verified by |
| --- | --- |
| Websites, books and presentations | `src/app/api/build/route.ts` (websites), `src/lib/builder/docs-prompt.ts` and the document routes under `src/app/api/cloud/workspaces/[workspaceId]/artifacts/` (books, decks); no tier check exists anywhere (`CREATION_PLANS` has no per-tier feature fields) |
| Unlimited websites while your plan is active. Fair use: 50 new sites per day, 1,000 live sites per workspace. | `supabase/migrations/20261013120000_unlimited_sites.sql` (both limits); publishing requires creation access (`requireCreationAccess` in `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/publication/route.ts`) |
| Publishing and hosting for your sites at no credit cost while your plan is active | the same publication route, which gates on creation access and opens no credit hold; hosting is listed as free in the help article "credits-and-pricing" |
| Client tracking and follow-ups in the built-in CRM, plus client reviews | `src/components/client-workspace.tsx`, `src/lib/check-client-followups.cjs`, `src/components/client-review-page.tsx` |
| Editing by hand, previews, versions and source download at no credit cost | `src/components/billing-credit-costs.tsx` "Free" row ("Final render check, preview, visual and code edits, versions, source download · No AI involved"), pinned by `check-plans.cjs` |
| Spending controls: a low-balance alert and a monthly usage limit | `src/components/billing-controls.tsx`, `/api/billing/preferences` (`scripts/check-billing-ux-browser.cjs`) |
| Usage history showing the project and action behind each charge | `src/lib/billing/usage-history-server.ts`, `src/lib/billing/check-usage-history.cjs` |

Removed for lack of the same verification: "Custom styles and editable exports", "A receipt for every request: files changed, checks run", lead scores, CSV import and badge removal. Badge removal itself is real (`src/app/api/workspaces/branding/route.ts`, `src/components/site-badge-setting.tsx`, gated by `requireCreationAccess`), so the help article "publish-your-website" keeps it; it is simply not part of the pricing list. Footnote: "Custom-domain connections are not available yet."

## FAQ "What happens when I run low?": which sentence ships, and why

Variant (a) ships: "Each request needs enough credits to cover its limit before it starts…". The server reserves the full approved hold atomically before a run (`src/lib/billing/affordability.ts`: "The server still reserves the full approved hold atomically"; `src/app/api/build/route.ts` derives the hold from `BUILDER_EFFORT[level].ceilingCredits`). `MINIMUM_RUN_CREDITS = 2` (`src/lib/builder/pricing.ts`) is only the smallest balance worth starting with, not the hold, so variant (b) would overstate what a low balance can do.

## Copy that is deliberately not on the page (owner decisions)

- No "Most popular" (no recorded subscription data); Studio's badge is "Best for client work" (`RECOMMENDED_BADGE`).
- No 14-day money-back guarantee: it needs new terms and a `BILLING_TERMS_VERSION` bump. The page promises only "refundable in full while none of its credits have been used", with statutory rights preserved.
- No yearly toggle or "Save 20%" while no yearly offer is on sale; "Yearly billing." sits in the not-ready box.
- No follow-up-edit or review figures and no post-caching measurements until the measured arrays and their tests exist.
- Free-tier copy appears only through the existing `trialCredits` switch.
