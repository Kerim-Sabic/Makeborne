# Full launch candidate: browser matrix, 26 October 2026

This continues `full-launch-candidate-20261026.md`. That report left 5 mounted browser checks failing in Chromium, and Firefox and WebKit had not been run. All of them now pass in Chromium, Firefox and WebKit.

- **Branch:** `claude/full-launch-candidate`, worktree `.claude/worktrees/full-launch`. Base head 1062170.
- **Checks ran on:** a7263c6, which holds every fix. The final head is the commit that adds this report.
- **Nothing left this machine.** No push, merge to main or deploy. No staging or production calls, no paid calls, no secrets and no database push. Codex's worktrees were read only; the beta-combined fixture was copied, not edited.
- **Scratch worktree:** a detached one at 5f655a7, in the session scratchpad, verified the "also applies to 5f655a7" claims. It uses the candidate's `node_modules` through a junction.

## 1. The five failing checks: root causes

All 5 came from the checks or their fixtures. None was a product defect.

| Check | Root cause | Verdict | Fix | Also applies to 5f655a7 |
|---|---|---|---|---|
| `check-contrast-gate-browser` | The phone first-screen gate (f234bfa) reported "primary action is missing" on a clean page that has no action at all. | **Product gate** (builder-internal). The image-led agent fixed it. | **Merged** `feature/image-led-sites` 2653745 as **9976ac7**: the gate flags an action only when one exists but sits below the first phone screen. Only 2653745 was new; cd1524d, f234bfa and 76a0737 were already in the candidate through 839312c. Note: `public/builder-runtime/contrast-probe.js` is generated and gitignored, so run `node scripts/prepare-builder-runtime.mjs` (also `prebuild`/`predev`) before the check, or it measures the old probe. | no (f234bfa is not on 5f655a7) |
| `check-preview-continuity-browser` | 1) The released account chat history (13b1343) makes the builder `GET …/artifacts/<id>/chat`, and the fixture refused it. 2) On the full candidate only, the agency ingest client also does `GET /api/build/sources` on load. | Stale fixture | 1) **6ff8a07**: **Codex's correction**, unchanged. It was uncommitted in `work/beta-combined-20261022`; see the 23 Oct handoff "Codex — preview-continuity fixture correction". 2) **1ccce0b**: answers exactly that GET with the route's flag-off body. 12/12. | 6ff8a07 yes (verified 12/12 on 5f655a7); 1ccce0b no |
| `check-advisor-handoff-browser` | It waited for the full sentence "Up to 90 credits for this request, including automatic refinements." to be visible. | **Stale check.** See the explanation after this table. | **7e03299**: requires "Up to N credits" in the summary before Send (90 for a build, 10 for Plan first), then opens Request details and requires the full sentence. 9/9. | yes (verified 9/9) |
| `check-edit-intent-browser` (0/9) | 1) The fixture server treated every unknown API call as `POST /api/build`, so the account-chat GET and POST failed every scenario. 2) The brand note sits in the collapsed Request details. 3) On the full candidate only, the `GET /api/build/sources` read. | Stale fixture | **6445534**: answers the chat route for the fixture account (GET returns an empty transcript; POST confirms the saved ids, like `check-builder-stop-browser`); opens Request details before reading the brand note. **918c681**: the sources GET with the flag off. 9/9. | 6445534 yes, with one string changed: 5f655a7's note reads `Brand kit: Fictional Co`, without creation-quality's "· used for this request". Verified 9/9 there with that string. 918c681 no |
| `check-live-builder-flow` | 1) The same hidden credit sentence and measured range. 2) On the full candidate only: a short first website brief now gets the free on-device design questions even when the tailored set is empty (creation-quality 184df26, intended), so the chain, cap, review and fail scenarios waited for a build that only starts after the questions. | Stale check | **7fbd01d**: the maximum in the summary, then both sentences in the details. **8c3c4d8**: Send waits for the questions, requires that no `/api/build` request was made before them, then chooses Skip all. The chain scenario also requires the first build's message to be the brief exactly as written. 5/5. | 7fbd01d yes (verified 5/5); 8c3c4d8 no (on 5f655a7, `tailored ?? local` skips the questions when the tailored set is empty) |

### Why the advisor-handoff credit line should stay hidden

- **The change was deliberate.** Codex's composer simplification moved the limit sentence, the brand note and the cost notes behind a collapsed **Request details** disclosure: commit 13b1343, `docs/release-review/account-chat-composer-20261023.md`, owner-approved and released to production in PR15.
- **The maximum is still visible before Send.** The disclosure's summary always reads "Up to N credits", with the same number. In plan mode it shows the plan ceiling.
- **So the line should stay hidden and the check was stale.** The user outcome the check protects is still true: before Send, the user sees the most this request can charge, and can read the full explanation. The updated check asserts exactly that.

## 2. Real defect found by the WebKit run

**a324a24 `fix(onboarding)`: the closed checklist blocked taps along the bottom of phone screens.**

- **Cause.** Below 650 px, the Getting started box `.gs` is fixed from `left:12px` to `right:12px` so that its open panel can span the phone. When the checklist is closed, its only child is the 46 px progress ring at the right.
- **Effect.** The empty 366 × 46 px rest of the box still took pointer events. On a 390 × 844 phone, a tap anywhere in that bottom strip, left of the ring, hit an invisible box instead of the page.
- **How it was found.**
  - `check-onboarding-browser` failed in WebKit because "I'll look around first" could not be clicked: ".gs intercepts pointer events".
  - Chromium and Firefox passed only because they clicked before the ring mounted.
  - `elementFromPoint` returned the checklist box in all three engines.
- **Fix.** On phones the box ignores pointer events and its children (the ring and the panel) take them. Layout is unchanged.
- **Proof.** The drawer scenario now requires a tap beside the closed ring to reach the page. It fails without the fix (Chromium returned "checklist" instead of "page") and passes in all three engines.
- **Also applies to 5f655a7: yes, for `onboarding.css`.** The same phone rule is there, at `onboarding.css:54`. `check-onboarding-browser` is not on 5f655a7, so take only the CSS hunk.
- **Related fixture fix, a7263c6.** The fixture mocked AccountClients, so the welcome modal's `.mc-modal` rules (in `account-clients.css`) never loaded. The welcome therefore rendered unstyled under the strip, which is why the skip link sat beneath it in the fixture. In the real studio, AccountClients is a static import of `studio.tsx`, so the modal (z-index 1000) covers the strip. The fixture now loads that stylesheet. Also applies to 5f655a7: no.

## 3. Cross-browser check and harness fixes (no product change)

- **98affef `test(library)`.** WebKit's default Tab order skips links, as Safari does with its default setting. A probe page showed that Tab and Alt+Tab both skip an `<a href>`.
  - The library card's open link is therefore not a Tab stop in WebKit. That is engine behaviour, not a defect.
  - In WebKit the check now reports that measurement as engine-limited (`SKIP` / `PASS*`).
  - It still requires exactly one menu stop per card, in order; no focus on the frame; Tab ending after the grid; and every card link being focusable.
  - Chromium and Firefox are unchanged. Also applies to 5f655a7: no (the library grid is not there).
- **bf17882 `test(builder-client)`.** `check-builder-client.mjs` crashed before running any scenario. Its alias resolver turned `@/app/visual-editor.css` into `visual-editor.css.ts`. Aliased CSS now loads as an empty module. 8 groups pass. Also applies to 5f655a7: yes (verified).
- **b67cf90 `test(browser)`.** Five mounted harnesses launched Chromium directly. They now launch through `scripts/browser-engine.cjs`; the default is still Chromium, so `npm test` is unchanged.
  - The five: `check-live-builder-flow`, `check-plan-client-integrity`, `check-publication-namespace-ui`, `check-builder-client` and `src/lib/help/check-help-overflow`.
  - `run-browser-checks.mjs` now also runs the first three.
  - Also applies to 5f655a7: yes. Verified in WebKit; live-builder-flow also needs 7fbd01d.

## 4. The matrix (final code, a7263c6)

- **How it was run:** `node scripts/run-browser-checks.mjs --engines chromium,firefox,webkit --jobs 3`.
- **Result: 141/141 check runs PASS.**
- **Before the fixes**, on 9976ac7 plus the check commits up to b67cf90, the same sweep was 139/141. The two failures were WebKit `check-library-previews-browser` and WebKit `check-onboarding-browser` (sections 2 and 3).

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| check-advisor-handoff-browser | PASS | PASS | PASS |
| check-attachment-flow | PASS | PASS | PASS |
| check-attachment-readiness-browser | PASS | PASS | PASS |
| check-autotopup-panel-browser | PASS | PASS | PASS |
| check-billing-ux-browser | PASS | PASS | PASS |
| check-brief-skip-browser | PASS | PASS | PASS |
| check-builder-paused-browser | PASS | PASS | PASS |
| check-builder-stop-browser | PASS | PASS | PASS |
| check-chat-history-browser | PASS | PASS | PASS |
| check-checked-version-browser | PASS | PASS | PASS |
| check-checkout-return-browser | PASS | PASS | PASS |
| check-client-review-browser | PASS | PASS | PASS |
| check-command-palette-browser | PASS | PASS | PASS |
| check-composer-send-browser | PASS | PASS | PASS |
| check-connections-browser | PASS | PASS | PASS |
| check-contrast-gate-browser | PASS | PASS | PASS |
| check-cover-composition-browser | PASS | PASS* | PASS* |
| check-creation-plans-browser | PASS | PASS | PASS |
| check-crm-research-browser | PASS | PASS | PASS |
| check-edit-intent-browser | PASS | PASS | PASS |
| check-editor-header-browser | PASS | PASS | PASS* |
| check-editor-quality-browser | PASS | PASS | PASS |
| check-enhance-flow-browser | PASS | PASS | PASS |
| check-enhanced-brief-browser | PASS | PASS | PASS |
| check-lead-profile-layout-browser | PASS | PASS | PASS |
| check-library-previews-browser | PASS | PASS | PASS* |
| check-live-builder-flow | PASS | PASS | PASS |
| check-mail-connected-browser | PASS | PASS | PASS |
| check-onboarding-browser | PASS | PASS | PASS |
| check-palette-search-browser | PASS | PASS | PASS |
| check-plan-client-integrity | PASS | PASS | PASS |
| check-plan-nofit-browser | PASS | PASS | PASS |
| check-plan-signup-browser | PASS | PASS | PASS |
| check-presenter-keys-browser | PASS | PASS | PASS |
| check-preview-assets-browser | PASS | PASS | PASS |
| check-preview-continuity-browser | PASS | PASS | PASS |
| check-publication-browser | PASS | PASS | PASS |
| check-publication-namespace-ui | PASS | PASS | PASS |
| check-publish-output-browser | PASS | PASS | PASS |
| check-review-draft-restore-browser | PASS | PASS | PASS |
| check-site-verifier-browser | PASS | PASS* | PASS* |
| check-source-output-browser | PASS | PASS | PASS |
| check-source-search-browser | PASS | PASS | PASS |
| check-topup-return-browser | PASS | PASS | PASS |
| check-trust-copy-browser | PASS | PASS | PASS |
| check-trusted-publication-flow | PASS | PASS | PASS |
| check-version-compare-browser | PASS | PASS | PASS |
| check-builder-client.mjs (run by hand, `--engine`) | PASS | PASS | PASS |
| src/lib/help/check-help-overflow.cjs (run by hand, `--engine`) | PASS | PASS | PASS |

**\* PASS with an engine-limited measurement that was not made in that engine** (the check prints `SKIP`):

- **cover-composition:** PDF page size. Playwright can print PDFs only in Chromium.
- **site-verifier:** the hardened Chromium launch and the CDP isolated world shared with the publication renderer. These are Chromium only by design, because the server renders in Chromium.
- **editor-header:** Tab out of the details popover. WebKit's default Tab order skips links and buttons.
- **library-previews:** Tab reaching each card's open link, for the same WebKit reason.

**Not in the matrix, and why:**

- **Server-side Chromium measurements**, which are part of `npm test` and run in Chromium, the engine the product's server uses: `contrast-gate.ts`, `check-layout-probe`, `check-comp-prompt`, `check-rendered-contrast`, `check-font-coverage`, `check-book-layout-browser`, `check-review-render`, `check-art-directions`, `check-browser-publication-parity` and the export and PDF renderers.
- **Harnesses that need a local database, Docker or staging:** `check-site-enquiries` (pg), `check-publication-runtime` and `check-publication-end-to-end` (operator Docker/SQL), `check-auth-staging`, the `scripts/eval` e2e specs and the quality/qualify renderers.

## 5. Final checks (a7263c6)

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `eslint .` | PASS: 0 errors, 1 warning. The warning is pre-existing: `check-preview-assets-browser.cjs:72` `catImage`. |
| `npm test` (run-checks) | **217/217**, with the same 5 explicit skips as before (local server, export HTTP, interactive fixture, two tariff-window qualifications). |
| `next build --webpack` | PASS. The builder runtime was regenerated first with `prepare-builder-runtime.mjs`. |

`outputs/authored-cover-qualification/` holds artefacts written by `check-cover-composition-browser`. It was left untracked.

## 6. For Codex: what to cherry-pick onto the minimum candidate

Apply these in order on 5f655a7. Each was cherry-picked cleanly onto a detached 5f655a7 and run there:

1. 6ff8a07 (your continuity correction)
2. 7e03299
3. 6445534, then change the brand string to `"Brand kit: Fictional Co", { exact: true }`
4. 7fbd01d
5. bf17882
6. b67cf90
7. a324a24, the `onboarding.css` hunk only

Full candidate only: 9976ac7, 1ccce0b, 918c681, 8c3c4d8, 98affef and a7263c6.
