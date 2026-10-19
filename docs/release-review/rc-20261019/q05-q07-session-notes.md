# Q05 (studio contrast) and Q07 (responsive editor) — 2026-10-19

Session: worktree `.claude/worktrees/jolly-engelbart-d24df6`, branch `claude/jolly-engelbart-d24df6`, now at `dedf6d1` (feature/launch-core) with the residual patch uncommitted. Nothing committed, no paid calls, isolated release-auth stack only.

## Main finding: Q05 and Q07 are already fixed on `feature/launch-core`

The audit measured `main`. `feature/launch-core` (commit `734d794` "phone-first editor", merged via `f511ac0`) already contains:
- `--text-muted` (#6b6577) replacing the pale greys, studio labels ≥ 12px (Q05);
- editor toolbar under 960px: icon tabs (label = accessible name) + a "More" menu holding Download source (Q07);
- phones ≤ 760px: preview first, the chat as a bottom bar/sheet (`workbench-chat-toggle`, aria-expanded) (Q07);
- `.lb-controls` wraps, so the builder's Send button is no longer pushed out of the chat column.

The release-candidate session (`release/rc-20261019` = launch-core + 07ee171) is integrating it. A third, uncommitted version of the contrast/toolbar work also exists in `.claude/worktrees/zen-dhawan-0dfdd2` (Phase 2 session, S2/S3/S5); launch-core supersedes its S3/S5 hunks. Its S4 (editor CLS) is not in launch-core.

## Measurements (studio e2e: studio-quality + contrast specs, isolated stack, builder off)

| key | before (07ee171) | launch-core as is | launch-core + residual patch |
|---|---|---|---|
| contrast studio@1440 / @375 | 39 / 35 | 0 / 0 | 0 / 0 |
| contrast editor@1440 / @375 | 8 / 8 | 0 / 0 | 0 / 0 |
| editor-toolbar@800 | clipped, 39px hidden | not clipped, 0px | not clipped, 0px |
| axe serious studio@1440/375 | 2 / 2 | 1 / 1 | 0 / 0 |
| axe serious editor@1440/375 | 1 / 1 | 0 / 0 | 0 / 0 |
| axe serious home@1440/375 | 2 / 2 | 2 / 2 | 0 / 0 |
| overflowPx (all) | 0 | 0 | 0 |
| CLS editor@1440 / @375 | 0.1957 / 0.1294 | 0.1956 / 0.0989 | 0.1958 / 0.1043 |

Runs: `outputs/eval/e2e/{before-q05q07,launch-core-asis,launch-core-residual}` in the worktree.

Browser pane (launch-core, builder rendered with an offline placeholder key; nothing sent), Relay Operations editor: page overflow 0, toolbar not clipped and one row, every tab reachable, Download source reachable via "More" (Escape closes and returns focus), Send button hit-testable at 360, 375, 390, 768, 800, 820, 900 and 1440. Phone preview iframe top at y=164 (was 527 on 07ee171).

## Residual patch (`q05-residual-on-launch-core.patch`, this folder)

In-browser contrast audit of screens the e2e never opens found sub-4.5:1 or sub-11px text still on launch-core. Fixed with launch-core's own token (`var(--text-muted)`), no layout change:
- Editor views: Code (source-editor.css), History (globals.css `.cloud-version` p/small 10/9px → 12/11px), Publish (website-publish.css, website-seo.css), Client review panel (client-review-panel.css), book Edit (account-preview.css).
- Studio: composer credit note (generation-permissions.css), Clients header (account-clients.css), Settings toggles (studio-refresh.css), effort popover (effort-control.css), style gallery (template-gallery.css), home workflow numbers (home.css, counted by the e2e home axe gate).
- Not renderable without AI, fixed from the stylesheet only (not visually verified): plan card (plan-card.css), brief questions (brief-questions.css), attachments (file-attachments.css), new-project options (creation-plan.css).
- WCAG 2.5.3: removed aria-labels that reworded visible text on `.creation-effort-trigger` (composer-controls.tsx), `.mbg-card` (template-gallery.tsx), `.gs-pill` (onboarding/getting-started.tsx) — same change the Phase 2 session verified.
After the patch the audit finds 0 failures on: studio projects/clients/styles/settings, effort popover, website editor Preview/Code/History/Publish/Client review, book editor Preview/Edit/History, at 1440 and (studio, editor, chat sheet open, Code, Publish, Client review) at 375. Only false positive: white text on the gradient primary buttons (≥ 5.5:1, measured).

Every file in the patch is unchanged between 07ee171 and launch-core except where launch-core changed it, and it touches neither cloud-studio.tsx nor cloud-workbench.css, so it applies to release/rc-20261019 whatever the merge resolution.

Checks on dedf6d1 + patch: `npx tsc --noEmit` pass; `npx eslint` on the 3 changed TSX files pass; `npm test` 136/136 (2 time-boxed skips); e2e 11/11.

## Baseline

`baseline.after-q05.json` (this folder) = 07ee171's `scripts/eval/e2e/baseline.json` with contrast 0, toolbarClipped false, axeSerious 0 and three `changes` entries. Apply it on the release branch only once launch-core + this patch are both in (it would fail the gate on 07ee171 alone). CLS and LCP entries left unchanged.

## For the release-candidate session

- `scripts/eval/e2e/identity.mjs` refuses any server whose `GET /api/build` body has a key besides `available` (`Object.keys(body).length === 1`). launch-core adds `estimates`, so the suite refuses to start against launch-core; 07ee171's harness expects `{available, configured, state}`. The merged route and the identity check need to agree. I relaxed it only in my untracked harness copy to measure.
- Launch-core's GET /api/build reports `available: true` whenever the builder is enabled (no provider-capacity check); 07ee171's L02 fix is what makes paused spending show as paused. Keep 07ee171's behaviour in the merge.

## Follow-ups (not done here)

- Home page (marketing, out of Q05's studio scope): `.mk-availability` 10px 4.32:1, account popover "Signed in as" 10px 4.18:1 on the home nav, 8px hero foot labels.
- Editor CLS 0.196 at 1440 is unchanged by launch-core; the Phase 2 session's S4 fix (initialProjectOpen, account-projects rule moved) measured 0.0004.
- Plan card / brief questions / attachments: visual check once a plan or attachment can be rendered.

## Superseded

`q05q07-on-07ee171.patch` in this session's scratchpad: my first implementation on 07ee171 (Phase 2 hunks + a Chat/Website pane switch for phones), dropped once launch-core's phone-first editor turned up. Not needed.
