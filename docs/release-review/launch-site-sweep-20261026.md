# Launch site sweep, 26 October 2026

Owner's ask (via the coordinator): a pre-launch, site-wide quality sweep of what customers see first, then "best possible in the world", with ads starting today. Ad traffic is mostly phones, so the ad landing path was done first.

- **Target:** Codex's minimum launch candidate `release/minimum-launch-20261025` at **5f655a7**. Codex's launch runtime is **59e5d32** (5f655a7 plus a checkout repurchase guard in `creation-plans.tsx` and a migration); none of my edits touch the lines it changes.
- **My branch:** `claude/launch-site-sweep`, worktree `.claude/worktrees/site-sweep`, `node_modules` junctioned from `work/minimum-launch-20261025` (read only, untouched).
- **Stack:** isolated local Supabase `makeborne-journey-audit` (API 127.0.0.1:55615, DB 55618, Mailpit 55620), the candidate's migrations. `next build --webpack` + `next start` on port 3071, browsed as `localhost`, every provider, Whop and mail variable blank (so AI shows as not connected and plans show "Opens at launch").
- **Nothing outside this machine:** no staging, production, Whop, provider or paid call; no push; no `supabase db push`. Test accounts are fresh local ones; credentials only in the scratchpad.
- **Evidence:** screenshots, axe JSON, Lighthouse JSON and page text in the session scratchpad `site-sweep/` (`public/`, `signedin/`, `after/`, `adpath/`, `lh/`).

## Summary

- **No code blocker left on the customer path.** Eleven small fixes (plus one lint chore) are on this branch: indexing of pricing, false copy, phone zoom, contrast and focus, the 404, and the CRM layout. Each has a check; they are listed under "Fixes so far".
- **Launch blockers are legal and operational, for the owner and a lawyer:**
  - L1: no general Terms of Service.
  - L2: no operator identity or imprint.
  - L3: privacy notice gaps.
  - L4: no account-deletion runbook behind the "email us" promise.
  - L5: the EU withdrawal-right consent at checkout.
  - L6: a DPA for customers' CRM data.
- **Owner decisions before ads:**
  - H1: say "publishing" is pending until it passes its staging test.
  - H4: open AI before ads.
  - Raise the auth email rate limit (30/hour).
  - Add a consent banner before any ad pixel.
  - Re-check the competitor claims.
- **For Codex (performance, not changed):** split the home page client component (TBT 620 ms with 4× CPU); keep the Supabase Realtime and Zod bundles off public pages.

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
| 75bb0c4 | Signed-in contrast (lead profile, CRM chips, chat, command palette, review privacy line); review comments keep their text as the accessible name (the aria-label "Show comment from …" replaced it); clients Ctrl+K hint name; 24 px client checkboxes on phones; visible focus ring on the home composer. | axe on all signed-in pages: zero apart from the low items in §5 | yes |
| d63b024 | Cherry-pick of journey-polish fc13533: the client lead profile stays inside its card on phones (it was not in 5f655a7). | `scripts/check-lead-profile-layout-browser.cjs` 6/6 | already in |
| 688ecd6 | One global rule: every text field, select and text area is 16 px on touch phones (27 studio fields were 12–14 px, so iPhone zoomed on each). | site-sweep `fields.cjs` on 13 pages: 27 → 0 small fields, none smaller, 0 overflow | yes |
| 59ae59b | "Find more like this" on a client profile is hidden while look-alike discovery is off (the finder and help already say it's unavailable). | lead profile check 6/6, tsc | yes |

**Final state of this branch:** `tsc --noEmit` clean, full `eslint .` clean, `npm test` 188/188 (includes the new `check-public-indexing.cjs`), `next build --webpack` passes, `scripts/check-launch-pages-browser.cjs` 22/22, axe zero on all 44 public routes at 390 and 1440, no cookies or third-party requests before sign-in.

## Part 2 — Full sweep

Every `src/app/**/page.tsx` route was opened at 1440 and 390, signed out and, where it applies, signed in as a paying local member:

- **Public:** `/`, `/billing`, `/billing?required=membership`, `/billing/terms`, `/billing/return` (redirects), `/privacy`, `/help` and all 29 `/help/[slug]`.
- **Sign-in and account:** `/login`, `/login?mode=signup`, `/auth/verify`, `/auth/update-password`.
- **Portal and review:** `/portal`, `/portal/login`, `/portal/join/[token]`, and `/review/[token]` (valid and invalid). `/portal/sites/[id]` needs a portal invite and was not tested.
- **Signed in:** `/studio` (projects, clients, client detail, styles, settings, an open website editor), `/studio/cloud`, `/chat`, and `/admin` (404 for a non-admin).
- **Unknown URL:** the 404 page.

### 1. Honesty

**Fixed** (commits above):

- yearly billing (3 places);
- the closed-plan notice;
- Outlook (help ×5, demo ×3, onboarding, the in-app Email header);
- automatic sequences and reply tracking (demo);
- creator discovery (welcome);
- credit packs (Gamma comparison);
- "print-ready" (welcome, cherry-pick);
- "Share for review" naming (cherry-pick).

**Checked and true for this candidate:**

- The AI-paused states: "AI building is off right now…" and "isn't connected in this environment".
- Custom domains: "not available yet" and "being set up".
- Books: "print-ready books … haven't passed print checks".
- Credit packs: "Coming soon".
- GitHub: "One-way export … changes made in GitHub aren't imported".
- The measured credit ranges cite the 18 Oct runs and say "(2 tests)" where thin.
- The refund copy matches billing terms v9 (`2026-10-25-beta-v9`).
- The support address is `admin@makeborne.com` everywhere (42 uses, no other address).
- The style gallery says "AI-generated design concepts, not finished templates or customer work".
- The competitor pages cite official docs checked 13 Oct 2026, use "—" for "not covered" and list Makeborne's own gaps.

**Still open.** The owner decides. I did not change these because they are pricing or legal substance, or they depend on launch timing.

| # | File:line | Claim | Proposal |
|---|---|---|---|
| H1 | `src/lib/billing/plans.ts:48`, `src/lib/site-metadata.ts:65`, `src/lib/help/articles.ts:59`, `src/lib/help/comparisons.ts:36,84,130` | "Publishing and hosting … while your plan is active", "Yes: unlimited sites" | True only once paying-workspace publishing passes its staging test. Until then, add to `NOT_READY_YET`: "Publishing for paying workspaces: opens after its final check; your sites stay saved until then." |
| H2 | `src/app/billing/terms/page.tsx:8` (terms v9, "Before launch") | "Creation subscriptions and credit-pack checkout remain closed while the service is being qualified." | False the moment sales open. At activation, replace it with a dated "Launch" section and bump `BILLING_TERMS_VERSION`, because checkout records the version. |
| H3 | `src/app/privacy/page.tsx:15` | "This notice describes the current Makeborne preview." (updated 20 October) | Rewrite it for launch, together with the legal gaps below. |
| H4 | Home, help and llms: "Create … with AI", "Most websites are planned and built in a few minutes" | Needs the AI provider limit open; in production every limit is off. | Open AI before ads. Otherwise every paying visitor meets "AI generation is paused". |
| H5 | `src/components/creation-home.tsx:127,129`: the nav item "Templates" | The section it jumps to says "not finished templates". | Rename the nav item to "Styles", as the help header already does. Cosmetic. |
| H6 | `src/lib/help/comparisons.ts`: the competitor rows | Checked 13 Oct 2026. | Re-check them before any ad mentions a competitor. Don't reuse comparison claims in ads without a fresh check. |

### 2. Legal (flagged for the owner and a lawyer; I wrote no binding legal text)

**What exists:**

- `/privacy`: 10 sections, updated 20 Oct.
- `/billing/terms`: subscriptions, renewal, refunds and credits (v9).
- The Google API Limited Use statement.
- No cookie banner.

**What the product actually uses** (from code and config):

| Service | What it processes | Listed in /privacy? |
|---|---|---|
| Supabase | accounts, database, files | yes |
| Vercel (region `fra1`) | app hosting, request logs | yes |
| Cloudflare | published sites, forms Worker | yes |
| Resend (EU, eu-west-1) | account emails (`no-reply@makeborne.com`) | yes |
| Whop | checkout, subscriptions, receipts | yes |
| Anthropic | AI builds, advisors, outreach drafts | yes |
| OpenAI | images (off at launch) | yes, conditionally |
| Google | sign-in; Gmail send scope | yes |
| GitHub | sign-in, **plus a separate GitHub App with repository Contents write** for website export | sign-in only; **the export app is missing** |
| Microsoft | Outlook (deferred, no app) | mentioned; fine while deferred |
| OpenStreetMap Nominatim and Overpass, **plus the community mirrors `overpass.kumi.systems` and `overpass.private.coffee`** (`src/lib/leads/osm.ts:11-12,166`) | lead-finder niche and city queries, sent from the server | **no** |
| Public websites and Instagram, TikTok and YouTube pages | lead-research fetches | described as "public lead research"; the platforms are not named |

**Launch blockers for the owner and the lawyer.** These are legal substance; I did not draft binding text.

- **L1. There are no general Terms of Service.** Only billing terms exist. Missing:
  - acceptable use (spam and outreach rules, prohibited content);
  - who owns generated content, and the licence to host it;
  - an AI-output disclaimer;
  - account suspension and termination;
  - warranty and liability limits;
  - governing law and disputes;
  - a minimum age.

  Sign-up also shows no "By creating an account you agree to…" line.
- **L2. No page names the operator.** Neither /privacy nor any other page gives the legal entity, its address, company registration, VAT number or the data controller. Today there is only `admin@makeborne.com`.
  - GDPR Art. 13(1)(a) requires the controller's identity and contact details.
  - EU e-commerce rules require provider details for paid services.
- **L3. The privacy notice has gaps (GDPR Art. 13):**
  - a legal basis for each purpose;
  - retention periods (the only concrete one is "about 400 days" for visit counts and errors);
  - the full list of rights, including portability, objection and the right to complain to a supervisory authority;
  - international transfers and their safeguards: Whop, Anthropic and possibly Supabase and Vercel are US companies (SCCs or the Data Privacy Framework);
  - the GitHub export app;
  - the OpenStreetMap services and the two community mirrors;
  - children and a minimum age.
- **L4. Account deletion and data export are by email only, and no deletion workflow exists.**
  - `docs/data-foundation.md` (lines 19, 40 and 119) says account deletion and retention is a separate workflow that still needs approval.
  - The privacy notice promises deletion and copy requests by email, and GDPR gives one month to answer.
  - Before launch, the owner needs a written, tested runbook covering:
    - who verifies identity;
    - what is deleted in Supabase and Storage;
    - which Whop and billing records must be kept;
    - how published sites are taken down.
  - A self-serve "delete my account" or "export my data" button is a product gap, not something the notice promises today.
- **L5. The EU/UK withdrawal right at checkout.**
  - The terms say any immediate-performance consent "must be collected separately at checkout". Makeborne's plan buttons collect no consent, and nothing in this candidate shows that Whop does.
  - Without that consent, EU consumers may have a 14-day withdrawal right that goes beyond "refundable while no credits are used".
  - The lawyer should confirm what Whop's checkout shows, or a consent step should be added.
- **L6. The CRM holds personal data about third parties.**
  - Customers store their leads' and clients' personal data, and lead research collects it from public pages.
  - Makeborne is likely a processor for its customers' CRM data. That needs a data processing agreement (Art. 28) in the terms, and a position on Art. 14 for the leads it researches.
  - Outreach rules (ePrivacy/PECR, CAN-SPAM) belong in the acceptable-use terms.

**Proposed wording** for the owner to adapt with the lawyer (placeholders in brackets):

- **Sign-up line:** "By creating an account you agree to the [Terms of Service] and confirm you have read the [Privacy notice]."
- **Privacy, a new first section "Who we are":** "Makeborne is operated by [legal name], [address], [registration number], [VAT number]. [Legal name] is the controller for account, billing and website-visitor data. For data you add about your own clients and leads, you are the controller and we process it on your behalf under our [Data Processing Terms]. Contact: [privacy address]."
- **Privacy, "Services that process data", add:** "GitHub (when you connect the separate GitHub export app, it can write to repositories you choose) and OpenStreetMap services (Nominatim and Overpass, including community-run Overpass mirrors) for map-based lead searches; your search terms are sent from our servers, not your browser."
- **Privacy, "Your rights":** "You can ask for a copy of your data, correction, deletion, restriction, portability, or object to processing, by emailing [privacy address]. We answer within one month. You can also complain to your data protection authority, for example [lead authority]."

**Cookies and consent (EU): compliant for what ships today.**

- No cookies are set before sign-in.
- The Supabase auth cookie is strictly necessary.
- Drafts and preferences in `localStorage` are functionality the user asked for.
- Analytics is first-party and cookieless, hashed with a daily salt, and skips browsers that send GPC or DNT.
- The privacy notice's "Cookies and browser storage" section matches what the product does.

**Before adding any ad pixel, conversion tag or third-party analytics for the campaign, a consent banner is required.** It must block those tags until consent and make rejecting as easy as accepting. This is the most likely way a launch-day marketing change breaks compliance.

### 3. SEO and metadata

| Check | Result |
|---|---|
| Titles | Unique on every public page, with the brand template "· Makeborne". Help guides use "… · Makeborne Help" titles; 9 of them are over 60 characters, which Google truncates (acceptable). |
| Descriptions | Present on every page, 83–171 characters. Privacy's 83 is short but accurate. |
| Canonical | Absolute `https://makeborne.com/...` on every public page; none on private pages. |
| Robots | Public pages are indexable; private pages are `noindex` by meta tag and header. **Fixed:** the `noindex` header on `/billing` and `/billing/terms` (c081c23). `/review/*` also sends `noarchive`, `no-referrer` and `no-store`. |
| robots.txt and sitemap.xml | The sitemap lists 5 public paths plus 29 guides, with real `lastmod` dates. robots.txt allows everything except `/api/`, names the AI search crawlers, and leaves the training-crawler policy to the owner. |
| OG and Twitter | One shared 1200×630 image, `summary_large_image`, and a per-page title, description and URL. A single image is fine for launch; per-page images for pricing and help are optional. |
| Structured data | Organization, WebSite and SoftwareApplication with the monthly offers; help pages carry CollectionPage, ItemList and BreadcrumbList. The featureList includes "published on Makeborne hosting" (see H1). |
| Favicon and manifest | SVG icon and `manifest.webmanifest` (starts at `/studio`, standalone). `/favicon.ico` returns 404: browsers use the SVG link, but some crawlers and old clients still request `.ico`. Low. |
| Headings | One h1 per page after e3656c5. The help demo had added a second h1 on 9 pages. |

### 4. Error states

| State | Result |
|---|---|
| 404 | **Fixed** (addf717): branded, `noindex`, a main landmark, and links to home and help. Unknown guides and invalid portal invites use it too. |
| 500 / page error | `error.tsx`: "Something went wrong on this page. We've been notified. Your saved work is safe.", with Try again and Open studio. `global-error.tsx`: "Makeborne hit a problem." Both report to first-party telemetry (scrubbed). No stack traces are rendered; the page-text scan found none on any route. |
| Invalid review link | "This review link isn't available. Check that you copied the whole link…" (200, `noindex`). |
| Expired session | After revoking the session in the DB, `/api/credits` returns 401 `{"code":"AUTH_REQUIRED","message":"Sign in before continuing to payment or your workspace."}`, and reloading `/studio` goes to `/login?next=/studio` ("Welcome back"). Friendly. Minor: nothing says "your session expired". |
| Rate limit | The auth errors `over_request_rate_limit` and `over_email_send_rate_limit` map to "Too many requests. Wait a little before trying again." (`src/lib/supabase/auth-flow.ts:77`); resend shows a visible 60-second countdown. The local stack returned no 429 after 40 bad logins, so I read the message from the code rather than seeing it. Production Supabase allows 30 emails an hour with custom SMTP (templates README). **An ad-driven sign-up spike can hit that.** Owner: raise the Supabase/Resend email rate limit before ads. |
| Offline | No service worker or offline page, so the installed app (standalone manifest) shows the browser's offline screen. Studio keeps unsent writes in localStorage for recovery. Low for launch. |
| API errors | JSON `{error:{code,message}}` with plain-language messages. Unknown API paths return the HTML 404, not JSON. |

### 5. Accessibility

**axe-core 4.14** (WCAG 2.0/2.1/2.2 A and AA, plus best practice) ran on every route above at 1440 and 390.

- **Before:**
  - 10–13 serious colour-contrast failures on each help page;
  - contrast failures on privacy, terms, portal, studio, chat, billing and review;
  - `label-content-name-mismatch` on the portal and clients;
  - `target-size` on the client checkboxes and the chat back link;
  - no main landmark on the 404;
  - two h1 on 9 pages.
- **After the fixes:** zero violations on every public route at both widths. Signed-in pages are covered below.
- **Second contrast batch** (commit below): client lead-profile hints, CRM stage chips, client-workspace subtitles, chat advisor descriptions, eyebrows and the mode switch, and the command palette headers.
- **Still open (low):**
  - the `/studio?tab=clients` row checkboxes are 17 px on desktop (24 px on phones after the fix);
  - heading order of `.ap-reading > h3` in the editor (moderate).

**Keyboard.**

- Tab order on `/`, `/billing`, signup, `/help`, `/studio`, clients and `/chat` follows the visual order. Help and studio have skip links.
- Every stop has a visible focus style except the home composer, whose focus ring was a white glow on white (`0 0 0 3px #fff8`). **Fixed** with a 2 px violet outline.
- Other text fields show focus on their container through `:focus-within` rings (verified).

**Forms:** every input has a label or aria-label; axe's `label` rule passes everywhere.

### 6. Performance

- **Mobile Lighthouse:** see Part 1. `/studio` (signed in) was not run, because the CLI cannot carry the session cookie without a custom script. Its JavaScript was measured instead.
- **JavaScript per route** (Playwright, local, raw / transferred):

  | Route | Raw | Transferred |
  |---|---|---|
  | `/` | 1,103 KB | 331 KB |
  | `/billing` | 786 KB | 235 KB |
  | `/help` | 679 KB | 205 KB |
  | `/login` | 740 KB | 217 KB |
  | `/chat` | 964 KB | 288 KB |
  | `/studio` | 1,607 KB | 486 KB |
  | **Open website editor** | **2,125 KB** | **655 KB** |

  In the editor, chunk 4149 (403 KB) loads with the editor itself.
- **Heavy dependencies on public pages:**
  - The full Supabase client, including Realtime (chunk 1476, 167 KB raw), on `/`, `/login` and `/chat`.
  - Zod 4 (chunk 7270, 99 KB raw) on `/billing`, and even on `/help`.
- **Proposals for Codex** (not changed here):
  - Import only the `@supabase/ssr` browser auth where it is needed, and keep Realtime off the home page.
  - Move the Zod parsing on `/help` and `/billing` to the server, or use `zod/mini`.
  - Split `creation-home.tsx`.
- CLS is 0–0.05 everywhere. This branch adds no regressions; its changes are CSS colours, sizes and copy.

### 7. Links

- **Internal:** 42 unique links across all swept pages, **0 broken** (no 4xx). `/pricing` redirects 308 to `/billing`.
- **External:** 20 links (competitor docs, whop.com, and makeborne.com from the portal). Every `target="_blank"` link has `rel="noopener noreferrer"`.
- **Support address:** `admin@makeborne.com` everywhere, with `no-reply@makeborne.com` as the email sender. A `support@` alias for customers is the owner's choice; not changed.

### 8. Emails

**Templates** in `supabase/templates/` (confirmation, magic link, recovery):

- Each has the Makeborne mark (a PNG at `{{ .SiteURL }}/brand/makeborne-email-mark.png`, which exists), one button and a one-time code.
- Each says "Keep this code private" and "Didn't create an account? You can safely ignore this email."
- Links go to `{{ .SiteURL }}/auth/confirm?token_hash=…`, which is safe against link scanners: a GET never consumes the token and a POST confirms it. `redirect_to` is passed through `urlquery`.

**Local proof:**

- Sign-up sent "Confirm your Makeborne email" with a working 6-digit code, and the code returned the user to `/billing?plan=create`.
- Locally the links point at the stack's `site_url` (127.0.0.1).
- The local stack wires only the confirmation template, so the recovery and magic-link emails here were Supabase's defaults ("Reset your password", from admin@email.com). The branded versions exist only in production Supabase, where they are pasted by hand.

**Owner checks in production Supabase** (they cannot be verified from code):

- Site URL is `https://makeborne.com`.
- All three templates and their subjects are pasted from the repo.
- The redirect allowlist.
- Click tracking is off in Resend.
- The email rate limit (see section 4).

Minor wording: on the recovery screen, the button for a password-reset code says "Verify email" (`account-form.tsx:263`).

## Full candidate (`claude/full-launch-candidate`, 1062170)

Every fix on this branch applies there too. The copy, CSS and header rules are the same, there is no `not-found.tsx`, and the welcome still says "Local businesses or creators". The three journey-polish cherry-picks (6df394e, 8944406, fc13533) are already in it. Differences to watch when merging:

- `src/app/help/page.module.css` and `src/app/account-refresh.css` add `--ui-zoom` lines next to the changed colour lines. Small merge.
- `src/components/onboarding/getting-started.tsx` was rewritten by journey-polish. Re-apply the creator line by hand.
- Measured with `git merge-tree`: this branch merges cleanly onto 59e5d32 and onto the current `release/minimum-launch-20261025` (0877345). Onto 1062170 it conflicts in five files: `account-clients.css`, `expert-chat.css`, `global-command-palette.css`, `help/page.module.css` and `getting-started.tsx`. These are colour lines next to merged edits; take both sides.
- The full candidate adds flag-gated features (CRM research panel, agency tools). Their copy was not swept here, because they are off at launch. Sweep them before each flag goes on, especially CRM research, which adds client-facing "website check" text.

## How to re-run

- `node scripts/check-launch-pages-browser.cjs http://localhost:<port>`: launch landing pages at 390 and 1440 (one h1, 16 px phone fields, no sideways scroll, branded 404, indexable pricing).
- `node src/lib/check-public-indexing.cjs` (also in `npm test`).
- The sweep scripts (axe per route, ad path, keyboard, fields, links) are in the session scratchpad `site-sweep/` (`sweep.cjs`, `adpath.cjs`, `keyboard.cjs`, `fields.cjs`, `links.cjs`, `run.mjs`). They run against a local stack only.
