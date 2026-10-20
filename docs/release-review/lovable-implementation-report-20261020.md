# Lovable audit — implementation report (Claude, 2026-10-20)

Local implementation only. **Production is unchanged**: nothing was pushed to or merged into `main`, nothing was deployed, no production migration, data, environment variable, DNS, Worker, SMTP, OAuth, permission or billing setting was touched, no checkout/charging/AI-image/publishing switch was activated, no paid AI call was made and no Lovable credit was spent (allowance remains exhausted at 20.303/20; the 18 paused layout instructions were not resumed or deleted). No credentials were created, no agreements accepted, nobody invited. Private raw evidence stayed local; no secret, signed URL or account inventory is committed.

## Branches

| Branch | Base | Head | Contents |
|---|---|---|---|
| `feature/lovable-audit-fixes` | `origin/main` `d14bf30` | see `git log` | F01–F14 (minus F08), M07, M13/M16 fonts, mail capability states, effort no-fit, and the merged slices below |
| ├ `feature/lovable-shell` (merged) | `d14bf30` | `f669393` | F02, F09, F10, F11, F12 |
| ├ `feature/lovable-public` (merged) | `d14bf30` | `2f0fc9c` | F05, F06, F07, F13 |
| ├ `feature/lovable-fonts` (merged) | `6e80315` | `31ddf31` | latin-ext font coverage (M13/M16) |
| ├ `feature/lovable-library` (merged) | `6e80315` | `853fac1` | M03, M04, M05 (migration renamed in `a148f84`) |
| ├ `feature/lovable-attachments` (merged) | `2db34d4` | `6eeea77` | M09 |
| `feature/billing-audit-ux` | billing `2862b78` (not rewritten) | `70f2a47` | top-up panel fixes + F08 (merged `feature/billing-usage-history` `6bf05ea`) |

`feature/billing-audit-ux` depends on the unmerged billing commit `2862b78`; it must land after (or with) `feature/billing-refunds-provenance`.

## Completion matrix

Legend: **Fixed (local)** = implemented, regression-checked, original code shown to fail the new check; **Codex** = needs qualification or work outside the local boundary; **Not changed** = reviewed, deliberately left.

### Correction queue F01–F14

| ID | Status | Commit(s) | Evidence |
|---|---|---|---|
| F01 Edit/Code guidance | Fixed (local) | `9e1bb5d` | `check-saved-preview.cjs` 7 formats × 2 roles; real-app pass: no fixture project renders the outline notice, so wiring is source-checked only |
| F02 loading shown as empty | Fixed (local) | `0c26a6f` | `check-library-state.cjs` (12); slow/503/capabilities-500/empty/cloud-off on the local stack |
| F03 stale palette search | Fixed (local) | `b79789a` | `check-palette-search.cjs` (4), `scripts/check-palette-search-browser.cjs` (6); original fails |
| F04 last Skip sends answer | Fixed (local) | `833d4a3` | `check-brief-questions.cjs` (8), `scripts/check-brief-skip-browser.cjs` (7); original fails |
| F05 nested pages noindex | Fixed (local), **Codex deploy** | `669a57d` | `check-sitemap.mjs`, `check-custom-hosts.mjs` (workerd), `check-analytics.mjs`; original fails |
| F06 SEO alt / word-count claims | Fixed (local) | `a851e8c` | `check-seo.cjs` (12) |
| F07 SSL timeout / nested DNS | Fixed (local), **Codex activation** | `83b15f7` | `check-custom-domains.cjs` (14), real route with recorded DB/Cloudflare |
| F08 usage history | Fixed (local), **Codex qualification** | `ce76efa`, `6bf05ea` | `check-usage-history.cjs` (36); SQL check on local stack inside a rolled-back transaction |
| F09 unsent draft lost | Fixed (local) | `f669393` | `check-unsent-draft.cjs` (17); reload/two-tab/sign-out on local stack |
| F10 320px format row | Fixed (local) | `f3a9c36` | 320/360/375/800/1440 no overflow (integrated pass) |
| F11 drawer focus | Fixed (local) | `c02a4e6` | 14–16 Tabs never leave the drawer at 320/375 (integrated pass) |
| F12 skip link / main | Fixed (local) | `c5f51f6`, `2db34d4` | one `main` at all widths; integrated pass found the phone skip link covering the menu toggle → fixed |
| F13 malformed fragments | Fixed (local) | `2f0fc9c` | `check-client-ready.cjs` (17); original throws `URIError` |
| F14 presenter shortcuts | Fixed (local) | `3bbf817` | `check-presenter-keys.cjs` (6), `scripts/check-presenter-keys-browser.cjs` (8); original fails at Enter on Previous |

### Mandatory slices M01–M18

| ID | Status | Notes |
|---|---|---|
| M01 | Fixed (local) | = F01 |
| M02 | Fixed (local) | = F02 + F03 |
| M03 library before hero | Fixed (local) | `d88381a`: returning users get heading → filters/search → projects → composer; first card top moves 805px → 429px at 1366×768; new users stay prompt-first; unknown states keep the last known layout for that account on this device; deep links unchanged |
| M04 titles / metadata | Fixed (local), **Codex** | `5efe9c8`: explicit titles kept; deterministic, editable brief-derived fallback (no URLs/emails/phones/attachment text, ≤60 chars); builds no longer overwrite a chosen title; cards say "Version N · saved <date>". Codex: confirm with a real (approved, paid) build that placeholder titles are replaced and chosen ones survive |
| M05 full-scope search | Fixed (local), **Codex** | `853fac1` + `a148f84`: migration `20261020120000_artifact_title_search.sql` (SECURITY INVOKER, `search_path=''`, authenticated only, `can_read` + RLS), route `GET /api/cloud/workspaces/[workspaceId]/artifacts`, keyset pages of 50, results keyed by account+workspace+kind+query; DB proof in a rolled-back transaction (no duplicates across pages under concurrent edits, cross-workspace refused). Codex: apply on staging, advisors, performance on large workspaces |
| M06 real artifact previews | **Codex** | Not started: needs render pipeline/version identity work and revocation/cache proof on real storage |
| M07 saved/checked/public | Fixed (local) part; **Codex** part | `fc1ce75`: legacy consent bound to reviewed version, status re-read after unconfirmed publish/offline, client-ready check no longer mixes unsaved source with prepared pages, SEO results fingerprinted and marked stale, restore copy. Server version binding was already correct (read-only audit). Codex: Worker edge cache (task C2), "Live" marker in version history (needs publication status in the editor) |
| M08 explicit intent | Fixed (local) part | F04 + effort no-fit (`f742ad9`). Exact edit target/Undo and plan-approval binding were not changed |
| M09 attachments | Fixed (local), **Codex** | `732e14f`, `6eeea77`: each file is ready / left out / unsupported (names the type) / too-large (by how much) / failed (Retry re-reads the stored copy) / checking before Send; duplicates sent once; the request carries exactly the "Will be read" files instead of all-or-nothing refusal; classifier reuses the server rules (`check-source-readiness.cjs` parity fixtures, 10); `scripts/check-attachment-readiness-browser.cjs` (9 scenarios incl. 320/375px), all fail on `2db34d4`. Codex: real model reading with independent fixtures; owner decision on excluding files in the home → project auto-start; the studio creation modal and notes tab still use the old list |
| M10 continuity | Fixed (local) part | F09–F12. Route/scroll/Back-Forward preview state not changed |
| M11, M12, M14 | Not changed | Optional; reviewed only |
| M13 book/deck/fonts | Fixed (local) part, **Codex** | fonts merged (`dea20e9`, `0d58d4d`, `31ddf31`); every-page export inspection and runtime image rebuild are Codex (C4) |
| M15 usage/receipts | Fixed (local), **Codex** | F08 + effort no-fit; real-ledger qualification (C3) |
| M16 public output | Fixed (local) part | F05, F06, F13, fonts |
| M17 settings/domains | Fixed (local) part | F07; scope/role revocation unchanged |
| M18 release | **Codex** | owner-gated release |

### Newer findings

| Finding | Status | Commit |
|---|---|---|
| MailCenter send-only success copy promised automation | Fixed (local) | `de8fca0` |
| MailCenter: late overview from previous workspace unlocks "Check now" | Fixed (local) | `fd62fae` |
| Effort "Best fit" on a plan no level fits | Fixed (local) | `f742ad9` |
| Top-up: revoke hidden when price null | Fixed (local) | `7702996` |
| Top-up: no Retry on load failure | Fixed (local) | `7702996` |
| Top-up: saved consent shown as "on" | Fixed (local) | `7702996` |
| Top-up: changed terms had no review path | Fixed (local) | `7702996` |
| Top-up: uncertain POST said "Nothing was changed" | Fixed (local) | `7702996` |
| Live-builder has no Stop | **Codex** (C1) | — |

## Verification run

- `feature/lovable-audit-fixes`: `npx tsc --noEmit -p .` ✓, `npx eslint .` ✓, `npm test` 150/150 ✓, `npx next build --webpack` ✓, Worker checks (`infra/customer-sites/check-*.mjs`) ✓.
- `feature/billing-audit-ux`: tsc ✓, eslint ✓, `npm test` 142/142 ✓, `next build --webpack` ✓.
- Mounted Chromium checks (not part of `npm test`; run with `node scripts/<name>.cjs`): `check-palette-search-browser`, `check-brief-skip-browser`, `check-presenter-keys-browser`, `check-mail-connected-browser`, `check-plan-nofit-browser` (1280 + 320px), `check-checked-version-browser`, `check-attachment-readiness-browser` (9 scenarios), and on the billing branch `check-autotopup-panel-browser` (375px, keyboard, request log). Each was also run against the original component and fails at the audited step.
- Integrated real-app pass on the isolated local stack (release-auth, 127.0.0.1:55435), merged branch, at 1440/800/375/320px: no horizontal overflow, exactly one `main`, no premature empty welcome, skip link first, filters inside the viewport, drawer keeps focus and Escape returns it to the toggle, no page or console errors, no external request attempted, no writes other than sign-in and local telemetry.
- Before/after screenshots and probe output are kept outside the repo in the session scratchpad (`integrated/`, `lovable-shell/shots/`, `lovable-fonts/`, `evidence/`); they contain only local fixture data.

## Codex handoffs

All tasks: work from the named branch, no production action without Kerim's explicit approval, environment variable **names** only.

**C1 — Live-builder Stop (server-bound, idempotent).** Branch from `feature/lovable-audit-fixes`. Today `live-builder.tsx` has no Stop, `/api/build` fetch has no signal, and `website-run.ts` deliberately continues after disconnect; `ai_operations.status` has no cancelled state. Design: migration adding `cancel_requested_at` to `makeborne_private.ai_operations` / active `ai_operation_runs`; RPC `makeborne_ai_operation_cancel(p_actor, p_operation, p_expected_revision)` (idempotent: returns the snapshot when already cancelled/finished); `ai_operation_provider_begin` refuses once cancel is requested so `RunSpend` raises and the run's AbortController fires; `ai_operation_finish` records `cancelled`, charges the measured cost, releases the rest of the hold, keeps any valid partial result recoverable; `DELETE /api/build/operations`; `cancel()` in `use-builder-operation.ts`; Stop button while `busy || operationRunning` (works after reload via the stored operation id). Qualification requires real paid runs on staging (bounded, owner-approved): stop before provider call (zero charge), mid-run (measured charge, hold released), double Stop, Stop after finish, reload during Stop. Rollback: revert commits; migration is additive (drop column/function).

**C2 — Worker edge cache serves stale assets.** `infra/customer-sites/_worker.js` `serveFile` checks the edge cache by path before the RPC, so non-hashed images (300 s) can outlive a republish or "Take offline", and old hashed bundles 404 for already-loaded pages. Fix: edge-cache only content-hashed paths (`SITE_SCRIPT_PATH`, `SITE_STYLE_PATH`, `SITE_VITE_PATH`), serve images with `max-age=0, must-revalidate` + sha256 ETag; consider keeping the previous revision's hashed bundles for a grace period. Qualify on staging Cloudflare (republish with a changed `/hero.webp`, take offline) and watch DB load. Deploy with F05 (`669a57d`) through the normal Worker approval gate. Rollback: redeploy the previous Worker version.

**C3 — F08 usage history on real data.** Branch `feature/billing-audit-ux`. Apply `20261020110000_usage_history_read.sql` on the rc stack with the full chain (`docs/release-review/launch-20261020/run-sql-suites.mjs` picks up `supabase/check-usage-history.sql`); exercise real `withhold_payment_lots` / `restore_payment_lots`; signed-in `/billing` browser check (`NEXT_PUBLIC_SUPABASE_URL`, publishable key read by `requireSupabaseConfig`); query performance on real ledger sizes; owner review of labels (Withheld/Restored, "No project yet", "Client CRM"). Rollback: revert `6bf05ea`, `ce76efa`; drop the two `makeborne_usage_history` functions if applied.

**C4 — Fonts in deployed outputs.** Rebuild/qualify the compiler runtime image (it carries its own `font-portability.cjs`/`build.mjs`) and run `check-font-portability.cjs` with `MAKEBORNE_VERIFY_PORTABLE_RUNTIME=true`; real serverless PDF export with regional names; PPTX in PowerPoint (Windows + macOS); cache headers for `/builder-runtime/fonts/*-latin-ext-*`. Watch the hosted CSS size for heavy pairings (Fraunces+Inter with italics ≈ 952 KB vs 1.2 MB limit).

**C5 — Billing follow-ups found while fixing the top-up panel (owner decisions).** (a) `revokeAutotopup` and the status GET call `requireSetup()`, so if `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED` is ever turned off while authorizations exist, customers cannot revoke them; revoke should not depend on the setup flag. (b) `authorizeAutotopup` hashes consent text built with a hard-coded `credits: 100` while the panel shows `offer.credits`; they diverge if the offer's credits change. Neither is active today (charging is unimplemented).

**C6 — Test fixture repair.** `scripts/check-attachment-flow.cjs`: five scenarios (plan-to-build, plan-changed-selection, chain, resume, retry) also time out on `2db34d4`; stale fixture, not caused by this work.

**C7 — Activation qualification already owned elsewhere:** custom domains (F07 Cloudflare timeout recovery, delegated zones, apex), client-ready card with real prepared HTML (F13), mail OAuth send-only vs full scopes (no OAuth was performed here).

## Rollback

Nothing is deployed, so rollback is "do not merge". After a merge, every finding is its own commit: `git revert <sha>` (revert F09 `f669393` before F02 `0c26a6f`, both touch `studio.tsx`). Two new migrations, both additive functions only: `20261020110000_usage_history_read.sql` (billing branch; drop statements in its header) and `20261020120000_artifact_title_search.sql` (`drop function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid);`). Neither was applied anywhere except the isolated local stack (title search) or inside a rolled-back transaction (usage history). Revert M05 `853fac1` before M04 `5efe9c8` before M03 `d88381a`; M09 is `6eeea77`, `732e14f`. No dependency was added. The Worker change (F05) needs a Worker redeploy to roll back.

## Round 2 (after Codex's qualification branch)

At Kerim's request, M06, the rest of M07/M08/M10, M17, a row-by-row reconciliation of all 35 research chapters, the gaps it found, and the optional M11/M12/M14 were implemented. They are merged into **`feature/lovable-integration`** (head `2b0f088`), based on Codex's `feature/lovable-qualification` `6b78269`. The merged branches are previews, m07-live, continuity, intent, scopes, trust-copy, publish-output, compare-search and advisor-handoff.

Final gates:
- `npx tsc --noEmit -p .` ✓, `npx eslint .` ✓;
- `npm test` 171/171 ✓;
- 26 mounted Chromium checks ✓ (each new one fails on its base);
- Worker checks ✓, `npx next build --webpack` ✓;
- an integrated real-app pass on the local stack at 1440/800/375/320 (no overflow, no page errors, no external requests, no unexpected writes; real previews render).

New migrations, all additive, none applied anywhere but the local stack:
- `20261020203000_scope_revocation_boundaries.sql`: deploy app code `381c96f` **before** it.
- `20261020210000_artifact_card_previews.sql`.

The reconciliation tables and the resolution of every missed item are in `docs/release-review/lovable-reconciliation-20261020/` (`part-1..3.md` and `DISPOSITION.md`), together with the Codex assignments, owner decisions and local-state cleanup.

Behaviour changes to note:
- briefs handed over from project creation wait for an explicit Send;
- the advisor can draft a brief, a new paid call capped at 3 credits;
- the editor preview blocks network and form submission (CSP).

Design quality (`feature/design-quality`, Kerim's +$100 Claude / +$2 OpenAI test budget) is reported separately.
