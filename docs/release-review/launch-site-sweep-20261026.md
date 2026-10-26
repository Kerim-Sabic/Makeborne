# Launch site sweep, 26 October 2026

Owner's ask (via the coordinator): a pre-launch, site-wide quality sweep of what customers see first, then "best possible in the world", with ads starting today. Ad traffic is mostly phones, so the ad landing path was done first.

- **Target:** Codex's minimum launch candidate `release/minimum-launch-20261025` at **5f655a7**. Codex's launch runtime is **59e5d32** (5f655a7 plus a checkout repurchase guard in `creation-plans.tsx` and a migration); none of my edits touch the lines it changes.
- **My branch:** `claude/launch-site-sweep`, worktree `.claude/worktrees/site-sweep`, `node_modules` junctioned from `work/minimum-launch-20261025` (read only, untouched).
- **Stack:** isolated local Supabase `makeborne-journey-audit` (API 127.0.0.1:55615, DB 55618, Mailpit 55620), the candidate's migrations. `next build --webpack` + `next start` on port 3071, browsed as `localhost`, every provider, Whop and mail variable blank (so AI shows as not connected and plans show "Opens at launch").
- **Nothing outside this machine:** no staging, production, Whop, provider or paid call; no push; no `supabase db push`. Test accounts are fresh local ones; credentials only in the scratchpad.
- **Evidence:** screenshots, axe JSON, Lighthouse JSON and page text in the session scratchpad `site-sweep/` (`public/`, `signedin/`, `after/`, `adpath/`, `lh/`).

## Part 1 — Ad landing path (interim, reported first)

Path walked at 390×844 (phone, touch, 3× DPR) and 1440×900: `/` → `/billing` → plan click → `/login?mode=signup&next=/billing?plan=create…` → Create account → "Check your inbox" → 6-digit code from the email → back on `/billing?plan=create` → `/studio` as a confirmed non-member.

### Verdict

| Area | Verdict |
|---|---|
| Layout at 390 and 1440 | **Pass.** No sideways scroll on any step. Signup → email (arrives in ~3 s locally) → code → back on the chosen plan works at both widths. |
| Phone form zoom | **Was failing; fixed.** Email and password fields were 14 px (help search 15 px, portal 15 px, usage search 11 px). iPhone Safari zooms the page on focus below 16 px, which is the moment an ad visitor starts signing up. |
| Honesty on these pages | **Two false claims fixed; one owner decision.** See below. |
| Share preview (OG/Twitter) | **Pass.** One 1200×630 image on every page: "Make something worth opening. Websites. Books. Presentations." with the logo and makeborne.com. `summary_large_image`, per-page title, description and `og:url`. Home title "Makeborne — Websites, books & presentations". |
| Search indexing of pricing | **Was failing; fixed.** `/billing` and `/billing/terms` were sent with `X-Robots-Tag: noindex, nofollow` (see fix 1). |
| Cookies/analytics before consent | **Pass.** A fresh browser on `/`, `/billing`, `/help`, every help article, `/privacy`, `/login` gets **zero cookies** and makes **zero requests to any other host** (fonts are self-hosted by `next/font`). The only analytics is the first-party, cookieless visit counter described in the privacy notice; it skips GPC/DNT browsers. The only cookie is the Supabase auth cookie, set at sign-in (strictly necessary). No consent banner is needed for what ships today; one becomes necessary the day any third-party analytics, ad pixel or retargeting tag is added (see owner items). |
| Mobile Lighthouse | See below. After the fixes: `/` accessibility 100, SEO 100; `/billing` SEO **66 → 100** (the noindex header), accessibility 100; `/help` accessibility **96 → 100**. |

**Mobile Lighthouse, two ways** (local `next start`, no CDN, so production TTFB will differ):

| Page | Simulated (Lighthouse default, Moto G + slow 4G) | Observed (devtools throttling, 4× CPU) |
|---|---|---|
| `/` | perf 81 · LCP 4.5 s · CLS 0 · TBT 180 ms | perf 81 · **LCP 2.1 s** · CLS 0 · **TBT 620 ms** |
| `/billing` | perf 88 · LCP 3.6 s · CLS 0.052 · TBT 120 ms | perf 87 · LCP 2.0 s · CLS 0.029 · TBT 440 ms |
| `/login`, signup | perf 94–95 · LCP 3.0 s · CLS ≤ 0.023 | — |
| `/help` | perf 90 · LCP 3.4 s · CLS 0 · TBT 60 ms | — |

- **Observed LCP is good (≈2 s); the 4.5 s on `/` is Lighthouse's pessimistic estimate.** The LCP element is the server-rendered h1 "What will you make next?" (no animation hides it).
- **The real phone cost is main-thread time:** TBT 620 ms on `/` with 4× CPU. The whole home page is one client component (`src/components/creation-home.tsx`, "use client") that hydrates the composer, attachments, effort control, account hook and style gallery before the page is interactive; ≈300 KB of JS, 107 KiB unused on first load (largest chunk `5342-*.js`). Not fixed here (a code change, not a copy fix). **Proposed for Codex:** keep the hero h1, subtitle and nav as server HTML, and load the style gallery and file-attachment code on demand (`next/dynamic`) below the fold. Expected effect: lower TBT/INP on the first tap of an ad visitor.
- CLS is 0–0.05 everywhere (good).

### False or overstated claims on the ad path

| # | Where | Claim | Status |
|---|---|---|---|
| 1 | `src/components/billing-workspace.tsx:86` | FAQ "Is there a free trial or yearly billing? **Not at launch.**" — shown even when yearly offers exist (launch sells $192/$470.40/$950.40 yearly). | **Fixed** (3466f75) |
| 2 | `src/app/llms.txt/route.ts:33`, `src/lib/help/articles.ts:326` | "Yearly billing isn't available yet." | **Fixed** (3466f75) |
| 3 | `src/components/creation-plans.tsx:88` | After sign-up from a plan link while sales are closed: "Create isn't available right now. **Pick another plan below.**" — every plan is closed. | **Fixed** (3466f75): "Plans aren't open yet, so Create can't be bought right now. Nothing was charged." The old line stays when other offers are open. |
| 4 | `src/lib/billing/plans.ts:48` (pricing "Every plan includes", `/llms.txt`), `src/lib/help/articles.ts:59`, `src/lib/site-metadata.ts:65` | "**Publishing and hosting** for your sites at no credit cost while your plan is active" / "published on Makeborne hosting". The owner's decision is that paying-workspace publishing opens **only after its staging test**. | **Owner decision, not changed** (pricing substance). If launch opens before that test passes, add to "What isn't ready yet": *"Publishing for paying workspaces: opens after its final check; your sites stay saved until then."* and drop it again when publishing opens. The help "Publish your website" guide already hedges correctly. |
| 5 | Home, pricing, help: "Create … with AI" | True only once the owner opens the AI provider limit (production today: every provider limit off). | **Owner sequencing.** Do not start ads before AI is open, or ad visitors who pay will see "AI generation is paused". |
| 6 | Pricing "Websites: 6–9 first builds …" | Backed by the 18 Oct measured runs, says "(2 tests)" where thin, and says the runs predate later efficiency changes. | **OK as written.** |
| 7 | Pricing "What isn't ready yet" | Custom domains, print-ready books, plan switching, credit packs ("Coming soon" on member billing). | **OK, honest.** |

### Fixes so far (branch `claude/launch-site-sweep`, on 5f655a7)

| Commit | Fix | Check (fails before, passes after) | Full candidate? |
|---|---|---|---|
| c081c23 (+ f2f1fef lint header) | `/billing` and `/billing/terms` were sent `X-Robots-Tag: noindex, nofollow` (the private-route rule `/billing/:path*` also matches `/billing`) while both are in the sitemap. Only `/billing/return` is kept out now. | `src/lib/check-public-indexing.cjs` | yes |
| 3466f75 | Yearly plans exist: FAQ, `/llms.txt`, help "credits" no longer say otherwise; closed-plan notice no longer says "Pick another plan below". | `check-plans.cjs`, `check-help.cjs` | yes |
| 2d088ef, 6790f34 | Cherry-picks of journey-polish 6df394e ("Share work for review" names ••• → Client review) and 8944406 (welcome no longer promises print-ready books). Their browser check file does not exist on 5f655a7 and was left out. | `check-onboarding.cjs` | already in |
| addf717 | Branded 404 ("We couldn't find that page.", home + help links, help header/footer, main landmark, noindex, title "Page not found · Makeborne"). | `scripts/check-launch-pages-browser.cjs` | yes |
| e3656c5 | Phone fields 16 px (sign-up/sign-in, help search, portal, usage search); WCAG AA contrast on help, privacy, terms, studio hints, chat, credit packs, client review, portal footer; the help demo's second `<h1>` removed; portal link label; chat back-link target size. | `scripts/check-launch-pages-browser.cjs` (22/22), axe 0 violations on every public route at 390 and 1440 | yes |
| 7ef56ba | Help, demos, onboarding and the in-app Email header stop promising Outlook, automatic sequences, reply tracking, creator search and on-sale credit packs. | `check-help.cjs` | yes |

## Part 2 — Full sweep

(Continues below once complete.)
