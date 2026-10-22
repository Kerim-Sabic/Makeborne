# Creation and website quality — qualification, 22 October 2026

- **Branch:** `feature/creation-quality`. It starts from verified `origin/main` d066f23 (PR14, live). `feature/design-quality` 4cdebf1 (design rounds 3 and 4) is merged into it as 1446044.
- **Status:** implemented and tested locally. Not on staging, not live. No migration, no setting change, nothing pushed.
- **Merge conflict:** one, in `scripts/check-attachment-flow.cjs`, where both sides had fixed the same stale fixture. The first resolution kept main's whole file and silently dropped the design branch's fixture brief; 9d172a1 restores it. Main's checkout recovery and reconcile freshness work is untouched.

## Acceptance criteria from the lead-engineer brief

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | The prompt helper is optional, keeps the client's facts, invents nothing and explains any charge | **Pass**, with one owner note | `check-brief-enhancer.cjs` (grounding: invented numbers dropped, client facts kept; examples never carry hours, prices, dates, counts or contact details; a detailed brief is analysed, never rewritten). `check-enhance-route.cjs` exercises the route behaviourally with fakes (7 checks): a 1-credit hold is always released and never settled, and the reply says `charged: 0`. "Start with my original · up to N credits" and Edit / Cancel are in `check-enhanced-brief-browser.cjs` (three engines). **Owner note:** the free reading still takes a 1-credit hold while it runs, which bounds provider spend. A user with no room for it gets a plain reason (`check-enhance-route.cjs`, "no room for the hold"), and the build can still start from their own words. |
| 2 | Questions are not a mandatory questionnaire | **Pass** | `check-brief-skip-browser.cjs` (Skip, Skip all and a custom answer send nothing unwanted; keyboard never auto-advances; reduced motion is respected). Website briefs over 150 words go straight on (`brief-questions.ts` `questionLimit`). One-click chips plus "Or in your own words". |
| 3 | No hidden paid calls and no auto-submit | **Pass** | A paid build starts only from Send, Start or "Start with my original", each showing the maximum. The real-app funnel recorded no POST to `/api/build`, `/api/generate` or `/api/chat` (`paidEndpointCalls: []`). A prepared brief handed over from project creation stops at the composer ("Review it and the maximum"). |
| 4 | Format, style, attachments, client and brand kit survive the questions and the helper | **Pass** | `check-brief-enhancer.cjs` ("the build binds the approved brief and answers to the operation"); `check-attachment-flow.cjs` 13/13 (home website, book and deck, plan to build, changed selection, account races). Plan builds now keep the structured design answers. |
| 5 | Books and presentations get no website-only steps | **Pass** | The enhance route refuses non-website projects before any hold (`check-enhance-route.cjs`). The concept step and design seed are website-only. Book and deck question banks ask about kind, reader, tone and length (`check-brief-questions.cjs`). |
| 6 | Progress states are clear and honest | **Pass** | The server's own reason reaches the card, and refusals that would also stop the build (AI paused, daily limit, no credits) offer no start (`check-enhanced-brief-browser.cjs`, "a blocking refusal"). Failed readings are logged with their cause, never their content. The receipt calls the reading free only when one ran. With AI off, the real app says "AI building is off right now. Notes stay in this browser tab; nothing is sent to AI or charged." |
| 7 | A failure loses nothing | **Pass** | Affordability runs before any reading. A refused start puts the brief, answers and edits back (`live-builder.tsx`; `check-enhanced-brief-browser.cjs`). |

## Checks run on this branch

- `tsc --noEmit` and `eslint .` are clean (33f281b fixed one `useCallback` dependency warning).
- `npm test`: 188/188 harnesses.
- `next build --webpack` passes.
- `scripts/run-browser-checks.mjs --engines chromium,firefox,webkit`: 93/93 runs.
- Studio e2e funnel on the real app (isolated release-auth stack, provider keys blank): 7/7 steps, no paid endpoint calls, cleanup 7/7 (`outputs/eval/e2e/20261022T000415Z/funnel.json`).
  - The run before it failed once at the client review step: the reviewer name was empty when Post comment was pressed, while the saved-draft restore appeared. This looks like a race in the review page, outside this slice, and is filed as its own task.
  - Two harness fixes were needed to run from a worktree (9d6f3b9): webpack instead of Turbopack, and an identity check that reads webpack chunks. The spec also still used a button label that changed on 19 October.

## Website output (design round 4, through the real app routes)

Full write-up: `design-quality-20261020.md`, round 4.

- **Gates met:** no serious axe issues 20/20, contrast 20/20, no invented facts 20/20, CLS 19/20.
- **Gates missed:**
  - judge 45% against a 75% target (18 of 40 verdicts);
  - D5 diversity 0.803 against 0.85;
  - first-build pass 14/20 against a 90% target;
  - 360 px overflow 4/20, which the finish gate now catches.
- **Cost:** 31.6 credits per site on average (p90 37), with 0 repairs and 0 failed builds.
- **Human judges** (Kerim and Nadin, round 11 against the first versions): newer preferred in 25 of 40 verdicts, first version in 6, too close in 9. This is a different signal from the model judge, which put round 11 at 40%. Round 2 of human judging (round 21 against the first versions) is open.
- **Control run:** the unmodified baseline prompt tied the first versions (7/12); every newer prompt variant scored 2–4/12 with the model judge. The newer work leads on accessibility, honesty and correctness, but not on judged visual craft.

## Not covered here

- No AI-on journey was clicked through the UI, because that is paid. AI-on behaviour is covered by the mounted checks with mocked APIs and by the 40 round-4 builds through the app's own routes.
- The isolated stack lacks main's two newest billing migrations (`20261021125359_checkout_payment_recovery`, `20261021133151_billing_financial_reconcile_freshness`). The creation flow does not use them, so they were not applied.
- Hydration (`feature/site-hydration`) is a separate slice; CLS was measured without it.

## Release and rollback

These steps are for Codex, after Kerim approves this concrete release candidate:

1. Rebase or merge onto the then-current main.
2. Run the full checks on CI.
3. Deploy to staging with AI kept off, and check the AI-off honesty states.
4. With Kerim's separate approval of AI spending and its caps, run a small staging smoke test (one short and one detailed website brief, one book).
5. Promote.

**Rollback:** this slice has no migration or data change, so rollback is a redeploy of the previous build. Briefs already saved keep working.

## Brief enhancer repair (Codex E1–E4), 22 October 2026

Commits a2a1a8f (migration + SQL check), f7e0a77 (route), e3fd743 (studio), 6d9d859 (tests). The intermediate commits are not individually green; the route test is updated only in the last one. Status: implemented and tested locally. **Keep the enhancer out of any release candidate until Codex has rechecked it.**

- **Migration:** `supabase/migrations/20261022100000_brief_enhancement_actions.sql` (table `makeborne_private.brief_enhancements`; LF-frozen, sha256 begins `75dca905`).
  - Applied only to the isolated local stack, inside a transaction.
  - RLS is on and browser roles have no grants. The service role reaches the table only through security-definer entry points with `search_path=''`.
- **Setting:** `MAKEBORNE_ENHANCE_STOP_POLL_MS`, optional, default 1000.
- **E1 durable replay.** One row per (account, Idempotency-Key), bound to workspace, website and the sha256 of the normalised body. The claim and the 1-credit hold happen in one transaction. Repeats, parallel requests (6 requests over 3 route instances) and restarts produce one provider call and one hold. The same key with a changed body gets 409.
- **E2 settlement.** A missing, released or lapsed hold returns 409 `ENHANCE_BILLING_REVIEW` with no result and no re-charge. A failing release returns 503 `ENHANCE_BILLING_PENDING`. An idempotent PATCH completes it, and the release happens exactly once even with racing recoveries.
- **E3 release failure.** No swallowed errors. An unconfirmed release is stored durably and shown as billing `held` by GET. The copy never says "Nothing was charged" while the release is unconfirmed.
- **E4 optionality and receipts.**
  - A complete prompt builds directly, with no enhance request.
  - A short brief offers "Build with my brief · up to N credits" or "Improve my brief first · free"; nothing is sent until one is chosen.
  - A lost reply shows "checking" and is recovered by re-reading the same key, never by re-running. Reload works the same way, and Stop is durable.
  - Cancelling after a completed improvement keeps its receipt. "Build with my original instead" implies no refund.
  - The build receipt carries the improvement's charge from the stored record (0 credits today, by the owner's pricing decision).
- **Checks:**
  - `npm test` 189/189.
  - `check-enhance-route.cjs` 14/14 (Stop at four points; account, workspace and role isolation).
  - `check-enhance-durable.cjs` 10/10, both in memory and against real local SQL (`MAKEBORNE_VERIFY_ENHANCE_DB`); its fixtures are removed afterwards.
  - `supabase/check-brief-enhancements.sql` 7/7 groups.
  - `check-enhance-flow-browser.cjs` 5/5 and `check-enhanced-brief-browser.cjs` 8/8 in Chromium, Firefox and WebKit.
  - tsc, eslint and `next build --webpack` pass. A stale webpack cache was moved aside, not deleted.
- **Limits:**
  - The route tests use an in-memory model of the SQL; the real SQL is covered by the SQL check and the durable check's database mode.
  - The provider gate is proven in SQL only, because provider limits on the shared stack were not changed.
  - A `needs_review` action needs an operator to resolve it.
  - The browser checks use routed, fictional APIs.
- **For Codex:**
  - Rehearse the migration on staging and record its hash.
  - Independently re-run the durable check against real SQL.
  - One bounded paid staging journey (proposed: at most 5 improvement calls of about $0.001 each, under a $0.10 cap), covering one completed run, one Stop mid-run and one forced release failure followed by recovery; confirm one `live_provider_calls` row per action.
