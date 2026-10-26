# New paying user journey audit (26 October 2026)

Owner request (verbatim): "i want to make sure everything works perfectly is everything working especially crm and that stuff and on boarding i want it to best experience possible for users".

**Scope.** I walked the whole first-time paying-user journey as a brand-new customer would, at 1440×900 and 390×844, and checked tight spots at 375. I fixed what was small and safe, each fix with a regression check that fails before it. Everything ran locally: no production, staging, Whop, provider or paid-AI action, and nothing was pushed.

## Verdict

| Journey | Verdict | In one line |
|---|---|---|
| A. Pricing → sign-up → email → plan → first landing | **Pass, with one Codex copy issue** | Sign-up with the emailed code works and returns to the chosen plan. With plans closed, the notice says "Pick another plan below" although every plan is closed. |
| B. Onboarding | **Was failing; fixed** | A new member **never saw the welcome** and the checklist was hidden until the first project. The library said "No account workspace was found". Fixed in cf2bea6, plus 6df394e, 36ea5ce, 8944406 and 2749692. |
| C. Projects | **Pass, with gaps** | Create, editor, AI-paused state, review link (anonymous comment → owner sees it) and static publish all work. A project can't be renamed, and the editor Preview stays empty for content-only projects. |
| D. CRM (live) | **Pass, one layout defect fixed** | Add client, CSV import (in-file duplicate skipped), tabs, follow-ups, notes, pipeline, bulk emails and export all work. The lead profile overflowed on phones (fixed in fc13533). Lead finder and AI drafts need AI. |
| E. CRM upgrade (flag on) | **Pass, wording defects fixed** | Needs attention, check, duplicates, do-not-contact, next step, timeline, draft and proposed→approved facts all work. The draft greeted businesses by their first word and wrote "I'm I." (fixed on feature/crm-research in a62c1c1). |
| F. Account and settings | **Pass, with product gaps** | Billing, credits, low-balance alert, usage limit, sign out/in and CSV export work. There is no profile, password or workspace-name setting and no account-data export. |

## How it was tested

- **Launch candidate:** `release/minimum-launch-20261025` at **5f655a7**, the newest head in `docs/AGENT_HANDOFF.md` (26 October, Codex). It already contains Claude's 3ce1e8b, 197d085 and ed1a0ac as b60e734, da9a473 and 0543a24.
- **My worktree:** `.claude/worktrees/journey-audit`, branch `claude/journey-polish`. `node_modules` is junctioned from `work/minimum-launch-20261025`, which I did not touch.
- **Database:**
  - A new isolated local Supabase stack, `makeborne-journey-audit` (API 127.0.0.1:55615, DB 55618, Mailpit 55620). I started it with the candidate's own 109 migrations, all of which applied cleanly.
  - I did **not** use the shared release-auth stack (55435/55438) for the candidate. It lacks the candidate migrations `20261021125359_checkout_payment_recovery` and `20261023000417_account_chat_history`, and setting its `creation_enabled` would have changed it for other agents.
  - For journey E, I added the six `feature/crm-research` migrations to my isolated stack only. There was no `db push`.
- **Server:** `next build --webpack` then `next start`, browsed as `localhost`.
  - All provider, Whop and mail variables were blank (same rule as `scripts/local-release-server.mjs`), so AI was paused ("not connected in this environment").
  - The browser bundle contained no cloud Supabase URL.
- **Accounts:** fresh, local and non-admin, created through the real sign-up form; the email code was read from local Mailpit.
  - Credentials are only in the session scratchpad (`journey-audit/test-accounts.local.json`), never here.
  - A paying Create membership plus 300 plan credits was simulated with local SQL (`billing_access_plans`, `billing_checkouts`, `billing_memberships`, `makeborne_record_plan_observation`). That path reads the database first and never calls Whop.
- **Tooling:** Playwright scripts with console, network, external-request and overflow capture. Screenshots are in the session scratchpad `journey-audit/` (134 files, listed at the end).
- **Not touched:** pricing, billing logic, auth policy, publishing/provider code, flag defaults and November renewal probes.

## Journey tables

Status: **pass**, **defect** (fixed, with commit), **confusing** (not fixed; ranked below) or **n/t** (not testable locally).

### A. Arrive → pricing → sign up → plan → first landing

| # | Step (what the user sees) | Status | Notes and evidence |
|---|---|---|---|
| A1 | `/` "What will you make next?", with Pricing, Log in and Open studio | pass | No console errors, no overflow at 390 or 1440. The only failed requests are aborted RSC prefetches, which are navigation noise. `A01-*` |
| A2 | `/billing` "Pick how much you make each month.": three plans, "Opens at launch" | pass (local) | The buttons are disabled locally because Whop isn't configured. Copy, footnotes and "What isn't ready yet" are clear. `A02-*` |
| A3 | Plan click while signed out → `/login?mode=signup&next=/billing?plan=create…` ("Make room for your ideas", with a plan summary) | pass | I simulated the click (the code routes it there, `creation-plans.tsx:111`). The summary card "Create · $20 a month · 300 credits… then pay in secure Whop checkout" is good. `A03-*` |
| A4 | Create account → "Check your inbox" → code entered → "Email confirmed" | pass | The email is "Confirm your Makeborne email" with a link and a 6-digit code. The code path worked at both widths. Locally, links point to 127.0.0.1 (stack `site_url`). `A04/A05-*` |
| A5 | Back on `/billing?plan=create`, signed in, before paying | **confusing** (Codex) | "Create isn't available right now. **Pick another plan below.**" appears next to "Plans open at launch". Whenever sales are closed, every plan is unavailable, so the advice is wrong. `A06-*` |
| A6 | Confirmed non-member opens `/studio` → `/billing?required=membership` "Creating starts with a plan." | pass | Clear. `A07-*` |
| A7 | After the (simulated) payment: `/billing` "Your plan & credits", balance 300, expiry 25 Jan 2027 | pass | `A08-*`, `F03-*` |

### B. Onboarding

| # | Step | Status | Notes and evidence |
|---|---|---|---|
| B1 | First `/studio` as a paying member | **defect, fixed in cf2bea6** | No welcome and no checklist. The library said "**No account workspace was found.** Your device projects remain below." Cause: a workspace is only created by the first project or client, and `GettingStarted` was mounted only once a workspace existed. After the first project the account is no longer "fresh", so **the welcome modal could never appear on the main path**. `B01-*-1440/390` |
| B1′ | Same, after the fix (rebuilt candidate, two new accounts) | pass | "Welcome to Makeborne" with three paths. The library says "Nothing is saved to your account yet. Your first project will be saved here." Checklist 0/6. `V01-*` |
| B2 | Welcome → "Make my first website" | pass | Opens the creation dialog "Saving to your new account workspace" with focus inside it. `V02-after-make-website-*` |
| B3 | Welcome → "Find my first 10 leads" | pass / **confusing** | Lands on Clients "Start your client workspace" with **Set up client workspace**. One click later the lead finder opens. That extra step is unexplained. `V02/V03-*` |
| B4 | Welcome keyboard | **defect, fixed in 36ea5ce** | Focus moved behind the dialog on the 6th Tab ("Skip to project brief"). The shared `Modal` now wraps Tab and Shift+Tab. |
| B5 | Welcome copy "A print-ready e-book" | **defect, fixed in 8944406** | It contradicted pricing's "Print-ready books… haven't passed print checks". |
| B6 | First project with AI paused | pass | "Project saved to your account. Your supplied content is ready to edit; AI generation has not run." and "AI building is off right now. Notes stay in this browser tab; nothing is sent to AI or charged." Honest. `B12-*` |
| B7 | Checklist after the first project: 1/6, then 2/6 after a review link | pass | Every guide link returns 200. `B21-*` |
| B8 | Step "Find leads" | pass / n/t | Opens the lead finder. Submitting locally gives "Lead finding isn't connected in this environment." With AI paused in production it would be "AI generation is paused right now. Nothing was charged." The form gives no warning beforehand. `B32-*` |
| B9 | Step "Connect" (email) | pass (local) | "Mailbox connections need to be set up by the Makeborne administrator first." This step only completes if production mail is configured. `B3x-action-connect-*` |
| B10 | Step "Share work for review" → "Open projects" | **confusing, fixed in 6df394e** | The step landed on the library with no hint. Its guide said "choose Share for review", but since 60a92f0 the control is ••• → **Client review**. The hint, the guide and the demo caption now name it. |
| B11 | Step "Ask" → `/chat` | pass / n/t | Sending gives "Expert chat isn't connected in this environment." locally. **While AI is paused, "Find leads" and "Ask an advisor" cannot be completed.** |
| B12 | Checklist open at 390, then the menu opened | **defect, fixed in 2749692** | The checklist panel and pill covered the navigation drawer. `M-nav-390` |
| B13 | Help & guides | pass | `/help` and all six checklist guides return 200. `M-help-*` |

### C. Projects

| # | Step | Status | Notes and evidence |
|---|---|---|---|
| C1 | Create a website from the composer | pass | The submit control is the arrow button ("Create this project"). The Create/Plan toggle next to it is labelled "Create" too, which is easy to confuse; I clicked the toggle the first time. `B10/B11-*` |
| C2 | Project title | **confusing** | The title is the brief's first words: "A website for Saffron Table, a small Lebanese family". **There is no way to rename a project.** The title popover only shows details, and there is no title update API. `C20-*` |
| C3 | Editor header (Back, title, Saved, •••) and Content blocks | pass | Gate 5 already qualified the header at every width. `C02-*` |
| C4 | Preview tab for a content-only (no-AI) website | **confusing** | It shows "Your website starts here… Your editable draft will appear here" while Content has sections. Publishing does publish that content, and the client review page renders a layout preview of it, so the editor is the only place it can't be seen. `C10-*`, `C13-*` |
| C5 | ••• → Version history / Client review | pass | `C10-*` |
| C6 | Client review: create link → anonymous client at 390 → comment → owner sees it | pass | Created 201. The anonymous page renders the content, the personal note "Hi Rana, …" and "Comment added. Thank you!". The owner panel shows "1 open… Send 1 to builder" and view analytics. `C11–C15-*` |
| C7 | Review link expiry date | **confusing** (low) | Client page: "Link open until **8 Nov** 2026" (UTC). Owner panel: "expires **9 Nov**" (local, UTC+1, created at 00:57 local). |
| C8 | Publish (static) with the consent checkbox | pass | "Your saved website is live. Future edits stay private until you publish again." Live, version 1, Copy link. `C22-*` |
| C9 | Download draft, GitHub panel | pass | "Download draft" is offered. GitHub: "Repository connections are being set up. Your work is saved here." (no app configured locally; wording qualified in gate 5). Source download isn't offered because a content-only project has no source. |

### D. CRM (live version on the candidate)

| # | Step | Status | Notes and evidence |
|---|---|---|---|
| D1 | Clients, empty: "A place for your next client." with Import CSV | pass | `B3x-action-write-emails-*` |
| D2 | Add client (name and optional email) → detail with six tabs | pass | 201, "Client saved to your account." `D01/D02-*` |
| D3 | Tabs: Outreach & activity, Email, Contact details, Brand & client access, Projects, Client reviews | pass | The empty states explain the next action. `D03-*` |
| D4 | Lead profile at 375 and 390 | **defect, fixed in fc13533** | The score chip, currency and source selects ran past the card, and at 375 the page scrolled sideways by 2 px. `M-client-375/390` |
| D5 | Client Email tab with mail not configured | **confusing** (Codex) | "Connect or reconnect your Gmail or Outlook…", while the workspace Email view correctly says the administrator must set mailboxes up first. |
| D6 | CSV import (4 rows, one duplicate) | pass | Preview "Import 3 clients… 1 row will be skipped (Row 5: Duplicate in this file)", then "Imported 3 clients." `D04/D10-*` |
| D7 | Row quick action "contacted, +3 days", snooze, follow-up buckets | pass | "Logged contact with Bright Smile Dental. Next follow-up in 3 days."; Upcoming 2. Rows show ISO dates ("Follow up · 2026-10-29"). `D11/D17-*` |
| D8 | Pipeline board | pass | `D12-*` |
| D9 | Select two → Write personal emails | pass / n/t | The dialog is honest about cost and mailbox and notes "1 selected client(s) have no email address". Writing needs AI. `D14-*` |
| D10 | Rex follow-up draft | pass (paused) | "AI drafts aren't connected in this environment." Nothing is charged. `D15-*` |
| D11 | Save outreach (follow-up date and notes), log an update, conversation history | pass | `D16-*` |
| D12 | Export clients to CSV | pass | `makeborne-clients-2026-10-26.csv` with a header row. |
| D13 | Lead finder → lead → client | n/t | The whole route needs AI chat (`leads/find/route.ts:31`) and the public OSM services. Not run. |

### E. CRM upgrade (`feature/crm-research`, `MAKEBORNE_CRM_RESEARCH=on`, knowledge on)

| # | Step | Status | Notes and evidence |
|---|---|---|---|
| E1 | Insights panel above the client list: Needs attention (2), Check a business, Possible duplicates, Do not contact | pass | `E01/E02-*` |
| E2 | Needs attention named "Olive & Thyme **Ltd**" (the company) while the list shows "Olive & Thyme **Deli**"; do-not-contact likewise | **defect, fixed in a62c1c1** | The panels now use the client's name, and Needs attention shows the company second. |
| E3 | Check a business with a local address | pass | "We couldn't read this site: not a valid public web address. No score is given; check it by hand." The real guard refuses localhost, so a **successful** check can't run against a local site from the app. `E10/E41-*` |
| E4 | Duplicate warning before adding | **defect, fixed in a62c1c1** | It said "Same website (oliveandthyme.test)" although the typed website differed; the match was the email's domain. Now: "Their email uses this website's domain / Email at this client's website domain". `E11-*` |
| E5 | Add as client with the check (no duplicate) | pass | Created and opened. `E42-*` |
| E6 | Do not contact: add an email | pass | The client page shows the banner "On your do-not-contact list… no email draft is written", and the draft button is absent. `E13/E44-*` |
| E7 | Website check card | pass | I ran the **real** check code once against a 127.0.0.1 fixture (harness-style test port) and attached the result to a client. The card shows 78/100 "Clear opportunity", 12 cited findings, "Where we saw this" and "What this check can't see". `E30-*` |
| E8 | Honest first email | **defect, fixed in a62c1c1** | It opened "Hi **Olive**," (the business's first word) and "I'm **I**." / "Best, **I**" for an account without a display name. It now greets "Hi there," unless the record clearly names a person with a separate company, and shows a visible "[your name]" placeholder with a warning. `E31-*` |
| E9 | Next step text | pass | "Next step saved." |
| E10 | Suggest facts → 9 proposed → Contact details → Approve | pass | "9 facts suggested. Review and approve them under Contact details." Each shows source, date and "Where this came from". Approve gives "Approved: Website: No business details for search engines." `E32–E34-*` |
| E11 | Timeline | pass | It merges notes, outreach updates and the website check. |
| E12 | Phone in plain text ("Phone: 0113 496 0123") not proposed as a fact | **confusing** (low) | Only `tel:` phones and emails become contact facts. |

### F. Account and settings

| # | Step | Status | Notes and evidence |
|---|---|---|---|
| F1 | Settings: account projects, device drafts backup/restore, sounds, website badge | pass / **gap** | There is no profile (name, email, password), no workspace name, no "export my data" and no account deletion. `F01-*` |
| F2 | Account menu: Signed in as…, Plans & credits, Sign out | pass | Sign out goes to `/login?next=/studio`; signing back in lands on `/studio`. `F02/F04/F05-*` |
| F3 | Credit settings: low-balance alert and monthly usage limit | pass | "Credit settings saved to your account." Alert at 310 with a 300 balance: "Low balance: 300 credits available, below your 310-credit alert." It shows **only on /billing**, not in the studio. `F10/F12/F13-*` |
| F4 | Usage history and download | pass | "No credit activity in October 2026". Download is disabled with no usage. |

## Defects fixed

| Commit | Branch | Fix | Regression check (fails before, passes after) |
|---|---|---|---|
| **cf2bea6** | claude/journey-polish | Welcome and checklist for a new member before any workspace exists; progress reloads when the checklist comes back into view; the library line now reads "Nothing is saved to your account yet…" | `scripts/check-onboarding-browser.cjs` (mounted Studio and the real checklist): 3/4 failed before |
| **fc13533** | claude/journey-polish | Client lead profile stays inside its card at 375 and 390 | `scripts/check-lead-profile-layout-browser.cjs`: 4/6 failed before |
| **6df394e** | claude/journey-polish | "Share work for review" step, guide and demo name ••• → Client review | `src/components/onboarding/check-onboarding.cjs`: new check failed before |
| **36ea5ce** | claude/journey-polish | Shared `Modal` keeps Tab and Shift+Tab inside (welcome, lead finder, email dialogs). **Touches `src/components/mail/modal.tsx`; separate commit so Codex can skip it.** | `check-onboarding-browser` `welcome-keeps-keyboard-focus-inside`: failed before |
| **8944406** | claude/journey-polish | Welcome no longer promises "print-ready" books | `check-onboarding-browser`: failed before |
| **2749692** | claude/journey-polish | Checklist hides while the phone navigation drawer is open | `check-onboarding-browser` `phone-navigation-drawer-…`: failed before |
| **a62c1c1** | feature/crm-research | First email: no "Hi Olive" / "I'm I."; clear duplicate reasons; clients named as in the list | `src/lib/crm-research/check-crm-research.cjs` (14/14): new check failed before |

All six candidate commits are small, independent and cherry-pickable onto 5f655a7. They touch:
- `getting-started.tsx`
- `studio.tsx` (2 lines)
- `account-projects.tsx` (1 string)
- `account-clients.css` (3 rules)
- `checklist.ts`, `articles.ts` and the help-demo `scripts.ts` (copy)
- `mail/modal.tsx`
- three check scripts

None touches billing, auth, publishing, providers or flags.

**Checks on the final head:** listed in the handoff entry and in [Verification](#verification).

## Remaining issues, ranked

Impact is for a new paying user; effort is S (under 1 day), M or L. Owner means who decides or builds.

| Rank | Issue | Impact | Effort | Owner |
|---|---|---|---|---|
| 1 | **While AI is paused, two of six checklist steps (Find leads, Ask an advisor), the welcome's "Find my first 10 leads" path and "watch it build, live" can't happen.** The lead finder form gives no warning until it is submitted. Suggest: read AI availability once, mark those steps and paths "paused for now", and show the paused notice in the lead finder before the form. | High while paused | S–M | Claude (UI) + owner (whether to launch paused) |
| 2 | **Projects can't be renamed**, and the default title is the brief's first ~8 words ("A website for Saffron Table, a small Lebanese family"). This needs an artifact title update (API with CAS, RLS check) and a "Rename" item in the title popover. | High (every project, client-facing in review links) | M | Claude, with Codex review of the route |
| 3 | **Content-only projects show an empty editor Preview** although Publish publishes that content and the review page renders it. Suggest using the review page's layout preview in the editor Preview when there is no generated document. | Medium–high while AI is paused | M | Claude |
| 4 | Plans closed: "Create isn't available right now. **Pick another plan below.**" while every plan is closed. Use "Plans aren't open yet" or hide the line when `prelaunch`. | Medium (any sales-closed period) | S | Codex (`creation-plans.tsx`, billing) |
| 5 | The client **Email** tab says "Connect or reconnect your Gmail or Outlook" when mailboxes aren't configured at all. Show the administrator message there too. The "Connect your email" step also stays undone forever if production mail isn't configured. | Medium | S | Codex (mail) |
| 6 | The "Find my first 10 leads" path needs an unexplained "Set up client workspace" click. Create the workspace automatically, as the first project does. | Medium | S | Claude |
| 7 | Settings lack profile, password change, workspace name, "export my data" and account deletion (GDPR access and erasure is by email today). | Medium (trust) | M–L | Owner decision, then Claude/Codex |
| 8 | **The do-not-contact list doesn't block the live send path or bulk "Write personal emails"**, and DNC clients still appear in follow-up buckets. Already listed in the CRM audit §6. | Medium (compliance) once the CRM flag is on | S–M | Codex (mail) |
| 9 | Review dates: the client page uses UTC ("until 8 Nov") and the owner panel local time ("expires 9 Nov"). Label UTC, or render both in UTC with the zone. | Low | S | Claude |
| 10 | The composer's Create/Plan toggle and the submit arrow both read as "Create". | Low | S | Claude |
| 11 | The low-balance alert only appears on /billing; the studio shows nothing. | Low–medium | S | Claude |
| 12 | Clients has an "On this device" tab next to "Account clients", which means nothing to a new user. Hide it when there are no device clients. | Low | S | Claude |
| 13 | CRM check: when the address was refused, the fit reason says "Their website didn't load when checked"; plain-text phone numbers aren't proposed as facts; placeholders are Bosnia-centric ("+387 …", "Dentist"). | Low | S | Claude (feature/crm-research) |
| 14 | Follow-up rows show ISO dates ("2026-10-29"), and the bulk dialog says "client(s)". | Low | S | Claude |

## What could not be tested, and how Codex should verify on staging

| Not tested | Why | Staging check |
|---|---|---|
| Paid AI: first build, plan, review, AI drafts, lead ranking, expert chat, the welcome's "watch it build, live" | Provider keys blank and limits off by rule; no paid calls | Inside the existing $5 Anthropic reservation, a new account does Make my first website → build. Confirm the checklist ticks off and nothing is charged on failure. |
| Real Whop checkout and return, membership verification, webhooks | No Whop locally; membership was simulated with SQL | A sandbox purchase from **signed-out /billing**. Check that the plan survives sign-up and the code confirmation (A3–A5 above), then returns to `/studio`, **where the welcome must now appear** (needs the cf2bea6 cherry-pick). |
| Real email: sign-up email delivery and branding, Gmail/Outlook connect and send | Local Mailpit only; no mail provider | Send the staging sign-up email to a test inbox; connect one sandbox mailbox and send one email to yourself. |
| Lead finder (map and list) | Needs AI chat and public OSM | One small map search with AI open on staging. |
| A successful CRM website check against a real site | The guard refuses local addresses; no public internet | With the flag on in staging only, check one public site you control. |
| Hosted site delivery after static publish | Local publish writes the record; `sites.makeborne.com` is not served locally | Publish once on staging and open the address. |

## Verification

**Candidate head 2749692** (5f655a7 plus the six commits):
- `npm test`: 187/187 harnesses.
- `tsc --noEmit`: clean.
- Full `eslint .`: clean.
- `next build --webpack`: exit 0.
- Browser checks (Chromium):
  - New: `check-onboarding-browser` 6/6 and `check-lead-profile-layout-browser` 6/6.
  - Existing ones that mount the touched code: `check-mail-connected-browser` 5/5, `check-connections-browser` 5/5, `check-command-palette-browser` 5/5, `check-composer-send-browser` 2/2, `check-trust-copy-browser` 6/6, `check-source-output-browser` 5/5 and `check-client-review-browser` pass. `check-lead-finder` 22/22.
- **Pre-existing failure, not caused by these commits:** `check-advisor-handoff-browser` is **7/9 on untouched 5f655a7 as well**. Two scenarios wait for a visible "Up to 90 credits…" / "Up to 10 credits for this plan." line that is now hidden (`.lb-limit`), probably since the paused-reason change da9a473. Codex: update the check or the expectation.

**feature/crm-research a62c1c1:**
- `check-crm-research` 14/14.
- `check-crm-research-browser` 9/9.
- `tsc` and `eslint` (changed areas) clean.

## Screenshots

All are in the session scratchpad `journey-audit/` (not committed). The prefix matches the journey:
- `A01–A08`: public pages, sign-up, email, plan return. Accounts owner, mobile, fresh3, fresh4 at 1440 and 390.
- `B01–B32`, `B3x-*`: first landing (before the fix), creation, checklist actions, paused AI.
- `V01–V03`: after the fix, the welcome at 1440 and 390, then the website path and the leads path.
- `C01–C22`: project, editor, actions menu, review link (anonymous at 390), publish.
- `D01–D18`: CRM add, tabs, CSV import, quick actions, pipeline, emails, follow-ups.
- `E01–E44`: CRM upgrade panels, check card, draft, facts, do-not-contact.
- `F01–F13`: settings, account menu, billing, credit controls, sign out/in.
- `M-*-390` and `M-*-375`: phone sweep of studio, projects, editor, clients, client, settings, billing, chat, help, styles, checklist and navigation.
