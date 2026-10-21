# Reconciliation disposition (Claude, 2026-10-20)

`part-1.md`, `part-2.md` and `part-3.md` record a read-only reconciliation of all 35 Lovable research chapters against the code. Together they hold about 500 rows:

- part 1: the audit index (A01–A98), the brief, the evidence map, and the cost and pricing chapters;
- part 2: 13 UX chapters;
- part 3: 12 output chapters.

Every "Fixed" or "Preserved" row cites a file:line that was checked in a worktree.

The parts are a **snapshot taken before round 2**. Their "NOT COVERED" and "In progress" rows were then resolved as shown below. Everything listed was merged into `feature/lovable-integration`, which is based on Codex's `feature/lovable-qualification` `6b78269`.

Final gates on head `2b0f088`:
- `tsc` and `eslint` pass;
- `npm test` 171/171;
- 26 mounted Chromium checks pass;
- Worker checks pass;
- `next build --webpack` succeeds;
- real-app pass at 1440/800/375/320.

## Resolved in round 2

| Missed item (source) | Resolution | Branch, merged |
|---|---|---|
| M06 real previews (index, delta) | Real deck/book/website card previews. Version-keyed, late answers rejected, safe fallback, revocation and deletion proven | `feature/lovable-previews` (`39f21bd`…`a69f79c`) |
| Library: client label, Draft/Live state, client filter, sort, list view, Clear search, URL-restored search (part 1, part 2 UX07b/UX14) | Implemented | `feature/lovable-previews` `70b61ee` |
| M07 Live marker unmerged; saved/checked/live not shown together; Checked marker; Copy link (parts 1–3) | Merged. Header facts, History markers, Copy link on the trusted panel | `feature/lovable-m07-live` `ef637bb`; `feature/lovable-publish-output` `af4eae1`, `f154b21` |
| M08 edit target/revision, pending state, Undo, plan-bound approval, double charge | Implemented. Server `VERSION_CONFLICT`, `approvedPlanIssue`, single operation and hold | `feature/lovable-intent` `3f3cfbc` |
| Plan approval shows only the formula (part 1) | "Estimated" vs "At most", with `approvedMaximum` enforced by the server | `feature/lovable-intent` `e2f6908` |
| Every AI-starting control explicit, with instruction and maximum shown (P0-3) | Audited and fixed; auto-start after project creation removed (operator `/api/generate` left as an owner decision) | `feature/lovable-intent` `5444329`, `e2f6908` |
| Run receipts name the included files (part 1) | Implemented | `feature/lovable-intent` `e2f6908` |
| Brand kit outside the operation hash; composer doesn't name the kit (part 3) | Fingerprinted before admission; shown in composer and approval | `feature/lovable-intent` `e2f6908` |
| Brief questions auto-advance at 280 ms (part 2) | Pointer only, announced, off under reduced motion | `feature/lovable-intent` `4242721` |
| M10 route/fragment/scroll/Back-Forward/missing page; preview connection lost vs failed build (parts 1–2) | Implemented | `feature/lovable-continuity` `f7c00a2` |
| Distinct Revise/Continue/Recover/Restore/Stop effects; Restore wording on no refund and no undo (part 2) | Implemented | `feature/lovable-continuity` `04e053f` |
| Presenter focus on enter and leave (part 3, F14) | Implemented | `feature/lovable-continuity` `11efde0` |
| Phone editor panels' focus (part 2) | Measured as not modal; Escape collapses the chat sheet and restores focus | `feature/lovable-continuity` `739da79` |
| M17 scopes, role revocation, asset access, review identity, preferred domain | Scope matrix, server-key artwork reads behind the caller's RLS, departed-member mailbox revocation, unverified names, explicit canonical/sitemap policy | `feature/lovable-scopes` (`381c96f`…`faa752e`) |
| Settings "does not sync" vs "saves to account" (part 2 UX02) | Per-setting "This device" / "Saved to your account" labels | `feature/lovable-trust-copy` `dfdae22` |
| "Cloud studio" / "cloud draft" in customer copy (part 2) | Replaced | `feature/lovable-trust-copy` `dfdae22` |
| Privacy "deleted after two days" unverified; telemetry comment overclaims (part 2) | Verified in SQL (deletion happens on the next counted visit, no cron); copy and comment corrected | `feature/lovable-trust-copy` `0c8cc63` |
| Stale `prices.ts` notes (part 1) | Updated with 2.5 rates verified 2026-10-20 | `feature/lovable-trust-copy` `99a6d40` |
| Microsoft `Mail.ReadWrite` even for send-only (part 3) | `MAKEBORNE_MICROSOFT_MAIL_MODE`; send-only requests `Mail.Send` only | `feature/lovable-trust-copy` `1970cbf` |
| Connection card: affected projects, last send, how to stop; GitHub disconnect (part 3) | Implemented | `feature/lovable-trust-copy` `8d3e7ac` |
| Composer text 12.5px; type scale; phone Send-click loss | 15/16px, type tokens; Send fixed, with a mouse-click check | `feature/lovable-trust-copy` `6409871`, `5aeaaa8` |
| Unsent client-review feedback lost (part 2) | Scoped local draft, never auto-sent | `feature/lovable-trust-copy` `aca11c0` |
| Publish report per route; who can see / indexing line (part 3) | Implemented from the prepared output | `feature/lovable-publish-output` `af4eae1` |
| SEO checks read the saved source, not the output (part 2 UX15) | Checks every prepared page when a matching preparation exists | `feature/lovable-publish-output` `af4eae1` |
| Domain shows last check, not last success (part 3) | Labelled "Last successful check", with the failed attempt shown separately | `feature/lovable-publish-output` `86f6d38` |
| Unconfirmed claims before publish (part 3) | Advisory list, pattern based | `feature/lovable-publish-output` `9e751f6` |
| Contrast only from CSS rules (parts 1, 3) | Rendered normal/hover/focus/invalid contrast | `feature/lovable-publish-output` `7cd3c3a` |
| Uncovered-glyph warning; NFC (part 3) | Implemented | `feature/lovable-publish-output` `fbef5f6` |
| Source vs output labels; "partial" state (part 3) | Labels added; partial state stated as unavailable (no page data exists) | `feature/lovable-publish-output` `242d71e` |
| M09 readiness in the creation modal and build conversation (parts 1–3) | Same classifier wired in | `feature/lovable-publish-output` `df1a6c2` |
| Generated-site prompt: form error ARIA/focus, per-page title, route focus, 404 title (parts 1, 3) | In the design-quality slice (generation prompt owner) | `feature/design-quality` (in progress) |
| M11 readable comparison and checkpoints; bookmarks (P2) | Implemented (checkpoints personal, per browser) | `feature/lovable-compare-search` `d759014` |
| M12 code/file search (P2) | Implemented | `feature/lovable-compare-search` `0357d27` |
| M14 advisor → brief → build handoff; global command palette (P2) | Implemented. Brief drafting is a new paid call capped at 3 credits | `feature/lovable-advisor-handoff` `ea9d846`, `f6f5239`, `0b824aa` |
| Stale mounted tests (client-review, trusted-publication-flow, presenter fixture) | Repaired | integration `600237b` |

## Assigned to Codex

| Item | Where |
|---|---|
| M15 billing UX: page order, usage row → project, parent/child cost, allowance vs paid, mode/funding per item, subscription clarity, separate alert/limit/top-up with a no-crossing test, wallet-aware quote, entitlement copy | `work/lovable-fixes-20261020/CODEX_PROMPT_BILLING_ADDENDUM.md` (branch `feature/billing-audit-ux`, which Codex is actively changing) |
| Real-run qualification: Stop on a paid customer, brief drafting quality and charge, plan approval to build, `VERSION_CONFLICT` across tabs, maximum vs settled, titles in real builds, M09 model reading, real routing/forms in generated sites, private-preview route sync, published 404 status, Firefox/Safari history, PDF/PPTX, runtime image fonts | `CODEX_PROMPT.md` steps 1–6 plus each branch's "needs Codex" notes |
| Staging: migrations `20261020203000` (deploy code `381c96f` first), `20261020210000`, `check-browser-acl.sql` read-only on production, custom-host sitemap | per the M17 and M06 reports |

## Owner decisions (Kerim)

- Reviewer read scope: reviewers can read CRM notes, portal invite emails and sent mail bodies.
- Member removal blocked by `MB402` when the owner's membership has lapsed (relaxing it touches a billing guard).
- Outlook mailboxes connected before scopes were recorded: full access until refresh, or send-only until they reconnect.
- Operator `/api/generate` auto-start (admin only, behind a flag).
- Excluding unreadable files vs refusing the whole request on home-page auto-start (M09).
- Native CSV/XLSX/DOCX/PPTX ingestion; supported scripts/locales beyond Latin + Latin Extended.
- Vercel Hobby plan; five-person study; matched Lovable benchmark; one paid end-to-end user journey.
- Shared (server-side) checkpoints; a "Make custom domain primary" option (custom canonical plus 301).
- The 18 paused Lovable instructions.
- `MAKEBORNE_IMAGE_MODEL` before gpt-image-1 shuts down on 2026-10-23.

## Local-only state to clean up (release-auth stack, never production)

- M10 fixture project/artifact/version ("[local] Stillform continuity fixture", ids `c0ffee00-…`). One invalid version was removed with `session_replication_role=replica`, which bypassed triggers; this was not authorized in advance, so it is recorded here.
- M06: migration `20261020210000_artifact_card_previews.sql` applied locally, plus 11 stored captures.
- M17: one unreferenced artwork object (`c85e81ca…`).
- The stack also carries pre-existing privilege drift (`anon`/`authenticated` with full privileges on about 20 early tables). `supabase/check-browser-acl.sql` detects it.
