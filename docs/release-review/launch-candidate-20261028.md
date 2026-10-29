# Launch candidate for Thursday 29 October 2026 — `claude/launch-candidate-20261028`

**Not a launch approval.** Nothing here was deployed, merged to main or applied to any database, and no production, staging, Whop, Supabase, Vercel or mail setting was changed. Production sales stay closed.

## What it is

One branch for Codex: Codex's latest tested candidate `qualification/consumer-billing-20261026` **d5b3ecb** plus the launch countdown and waitlist line that so far lived only on `claude/launch-countdown`.

d5b3ecb already contains:
- the full version 9afc160;
- the legal pages 16437ab;
- consumer billing and consent, and Codex's four fixes;
- 0877345/59e5d32;
- the honesty and site-sweep fixes (3466f75, 7ef56ba, 6790f34, c081c23, a324a24, addf717, 688ecd6, e3656c5).

| Commit | What | Origin |
|---|---|---|
| 038b4dd | Full-page countdown on `/` with in-place reveal, slim banner, plans line | cherry-pick of 9ee4023 |
| cb6e60f | Final launch screen and launch waitlist | cherry-pick of eae4000 |
| e279bc7 | Waitlist migration named as its production version 20261027020420 | cherry-pick of 2aad7d0 |
| 3e04d56 | Launch Thu 29 Oct 21:00 CET, framed-site sneak peek, invites from admin@makeborne.com | cherry-pick of 8dcb54b |
| 122f31c | Invite email says "one brief" and names the seller | cherry-pick of 6c4d450 |
| a3ab7b5 | Customer copy says "one brief", never "a short brief" | new (help, onboarding, help demo, comparisons, site facts, /llms.txt) |
| f37a5c9 | Account-rights data map lists `makeborne_private.launch_waitlist`; the waitlist check reads the legal Privacy Policy | new (integration) |
| 82ca35f | Two billing browser checks assert the current tax note | new (test only) |
| 8234c24 | The 404 page imports no CSS module, so other pages stop preloading its styles | new (fix) |
| c92d4ff | `.env.example` names the Thursday launch instant | new (example only) |

The cherry-picked commit messages were rewritten only to drop the AI co-author trailers. Every file tree is unchanged.

## Conflicts and how they were resolved

- **`.env.example`, `src/app/layout.tsx` (9ee4023):**
  - Kept both sides.
  - In the env example: Codex's full-launch feature switches, then the countdown variables.
  - In the root layout: `data-ui-scale` and the launch banner together.
- **`src/app/privacy/page.tsx` (eae4000):** kept the candidate's legal-pages version, which renders `docs/legal/privacy.md`.
  - eae4000 had added a "Launch waitlist" section to the old inline page. It is now a row in the Privacy Policy's data table (`docs/legal/privacy.md` §2): what is stored, consent as the legal basis, deletion 90 days after launch or on request, and the unsubscribe link.
  - **`LEGAL_VERSION` was not bumped** (still 2026-10-26). `WITHDRAWAL_CONSENT_VERSION` is derived from it, and Codex's consent migration keeps immutable consent-text snapshots per version. A bump needs Codex's matching consent-text change. Codex: decide whether this added row needs a version bump before activation.
- The other three cherry-picks applied cleanly.

## Integration fixes found by the checks

- **`check-account-rights`** failed because the new table `makeborne_private.launch_waitlist` had no export or deletion decision.
  - It is keyed by email and holds no account id, so it is mapped as `system`: not part of an account export or deletion, removed on an emailed request, all rows deleted 90 days after launch.
- **`check-launch-waitlist`** read the old inline privacy page. It now checks the waitlist row in `docs/legal/privacy.md`.
- **`check-billing-ux-browser` and `check-creation-plans-browser` were already failing on d5b3ecb.**
  - d5b3ecb changed `TAX_NOTE` to the gross-price wording ("Price includes applicable tax. Any checkout fee is shown before you pay."), but both checks still asserted the old "plus any tax or checkout fee" text.
  - They now assert the current text. No billing code changed. `TAX_NOTE` itself remains Codex's to confirm before activation.
- **`check-launch-countdown-browser` failed on the integrated build:** "no console errors or warnings at all".
  - The cause: the root not-found boundary (addf717's branded 404) imported the help center's CSS module. Next preloads that stylesheet on every page that does not use it, so `/` and `/billing` logged "preloaded but not used".
  - The 404 page now uses `globals.css` classes and a few inline styles, with the same landmarks, title and links. `/`, `/billing`, `/help`, `/privacy` and an unknown path now carry no CSS preloads in the HTML.

## Check results (this branch, local, Windows, Node 22)

- `npm test`: **227/227 check harnesses passed** (5 skipped by the runner: check-runtime and check-pdf-layout need a server; preview-forms is interactive; the two time-boxed tariff harnesses need a pricing review).
- `npx tsc --noEmit`: pass. `npx eslint`: 0 errors, 1 pre-existing warning (`catImage` in `scripts/check-preview-assets-browser.cjs`).
- `next build --webpack`: "✓ Compiled successfully", 68/68 static pages.
- `check-launch-countdown-browser` (Chromium) against `next start` on this build: **12 launch countdown browser groups passed**.
  - Covered: launch screen at 390 and 1440 in light and dark, the waitlist, the mocked-clock reveal to "We're live.", the preview bypass, clock skew, banner, and the plans-page line.
- `check-launch-pages-browser`: **22 launch page checks passed** (branded 404, indexable /billing and /billing/terms).
- `check-legal-consent-browser`, `check-pack-consent-browser`, `check-plan-signup-browser`, `check-creation-plans-browser`, `check-billing-ux-browser`: pass.
- **Full mounted Chromium matrix:** `node scripts/run-browser-checks.mjs --engines chromium` gave 52/55 in one run. The three misses were environmental, and each passed when rerun:
  - `check-launch-countdown-browser` and `check-launch-pages-browser` need a running server; with `next start` they pass (above).
  - `check-chat-history-browser` needs the git-ignored `work/` folder; it passes once that exists.
  - So all 55 Chromium checks pass. Firefox and WebKit were not run.
- **Local page pass** (Playwright, `next start`, no providers configured): `/`, `/billing`, `/billing/terms`, `/terms`, `/privacy`, `/withdraw` at 1440×900 and 390×844.
  - All return 200 with no horizontal overflow. `/` shows the countdown ("Makeborne launches Thursday 29 October · 21:00 CET").
  - /billing shows $20/$49/$99 and 300/750/1,550 credits. /billing/terms also shows the yearly $192/$470.40/$950.40.
  - No retired prices and no "short brief" anywhere.
  - The yearly prices appear on /billing only when a yearly offer is configured, so not locally.
  - **Console:** `/` and `/billing/terms` were clean at both widths, and `/billing` was clean on the phone. The desktop `/billing` and the three legal pages logged "preloaded but not used" warnings.
    - Those preloads come from `next/link` viewport prefetching of other routes (the home page's and help center's CSS).
    - The same pattern exists on production today: makeborne.com/privacy logged 3 such warnings.
    - It is pre-existing and harmless, and not fixed here.

## Migrations vs production

Production (`rklojnmmsmhwnkbzuidp`, read with list_migrations on 28 Oct) records everything up to `20261023000417_account_chat_history`, then `20261027020420_launch_waitlist`.

This branch's `20261027020420_launch_waitlist.sql` is **byte-identical** to main's: blob 56c079d0dead932f5e996327bca1a765cdd8416e.

This branch adds 14 migrations that production does not have:

`20261022100000_brief_enhancement_actions`, `20261023130000_project_source_uploads`, `20261023200000_agency_operation_contract`, `20261023210000_client_knowledge`, `20261024010000_client_research`, `20261024020000_data_report_files`, `20261025200000_paying_workspace_publication`, `20261025300000_crm_research`, `20261026013451_prevent_unsupported_creation_repurchase`, `20261026100000_account_data_rights`, `20261026120000_crm_server_writes`, `20261026120100_research_daily_limits`, `20261026125554_billing_checkout_consent`, `20261026135550_crm_next_step_rpc_boundary`.

**Ordering concern:**
- All 14 sort before `20261027020420`, which production has already applied. `20261022100000` also sorts before `20261023000417`.
- So a plain migration run will skip or refuse them. Apply them with Codex's hash-verified apply script, or `--include-all`, after a backup, as Codex did on staging. **Never a bare `supabase db push`.**
- The waitlist migration creates only its own table and functions and touches none of these, so applying the 14 after it is order-independent for the waitlist.

## Still gated (from Codex's 26 Oct report, unchanged by this branch)

- **Whop:**
  - the final hosted payment button reads "Join";
  - seller-managed tax in the dashboard vs `collect_tax:true` in the plan API reads;
  - reopening a paid checkout URL still offers Join.
- **Durable purchase confirmation and the withdrawal request/acknowledgement journey** (being built separately; to be added to this branch).
- **Exact production webhook and env cutover, then final GO** (Codex and the owner).
- **Owner-paid infrastructure requirements:** Codex noted Vercel Hobby does not permit commercial use; the Supabase organisation is on the Free plan.
- **The November renewal probes.**
- **One more commit expected on this branch:** a launch-moment safety net for the countdown. If sales are not open at 21:00 CET, the screen should not say "We're live."

## How to run it locally

Start `next start -H 127.0.0.1 -p 3247` on a build of this branch (no env files needed). Then run:

```
MAKEBORNE_LAUNCH_URL=http://localhost:3247 node scripts/check-launch-countdown-browser.cjs
node scripts/check-launch-pages-browser.cjs http://localhost:3247
```
