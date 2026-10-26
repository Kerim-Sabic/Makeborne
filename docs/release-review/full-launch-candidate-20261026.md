# Full launch candidate, 26 October 2026

Owner's request: "i want everything in launch so we have best possible please think make sure everything is best possible".

This candidate holds every Claude feature branch that is ready to merge, on top of Codex's minimum candidate. Everything that is not qualified for production is OFF behind a server-side flag, or behind a gate that is already closed in production. Codex can qualify features one at a time and switch them on without another large merge.

- **Branch:** `claude/full-launch-candidate`, worktree `.claude/worktrees/full-launch`.
  - It has its own `node_modules`, installed with `npm ci`. It is a real directory, not a junction.
  - Base: Codex's `release/minimum-launch-20261025` at **5f655a7**.
- **Head:** see the handoff entry. The final head is the commit that adds this document.
- **Nothing was done outside this machine.** Nothing was pushed, merged to main or deployed. There were no staging or production database connections, no paid calls, no secrets, and no Whop, provider or November-probe actions.
- **Codex's release worktree** (`work/minimum-launch-20261025`) was read only. It was not touched.

## 1. Merge log

The list follows first-parent order on top of 5f655a7. Every commit carries `Co-Authored-By: Claude Opus 5.5`, except the four cherry-picked document commits, which keep their original messages.

| # | Commit | What | Conflicts and how they were resolved |
|---|---|---|---|
| 0 | 6138624, 517dc2f, 6abaea0, a64af3f | Cherry-picks of the Claude launch documents: cac474b (billing gates), ed6e663 (generation readiness plus `supabase/rehearse-generation-open-stop.sql`), 8b35393 (publishing entitlement), 2543dd8 (gate-5 journeys) | None. **Code was already in Codex's head:** 3ce1e8b = b60e734, 197d085 = da9a473 and ed1a0ac = 0543a24. I checked each pair with `git patch-id --stable`, so the code was not merged a second time. |
| 1 | f0e3d3b | `feature/library-redesign` a6d8e60: projects grid, large-screen `--ui-zoom` scaling, first-visit layout fix | `billing.css` and `cloud-workbench.css`. I kept the candidate's removal of `.billing-back`, `.billing-heading`, `.cloud-workbench-tabs` and `.workbench-more`, which pricing v2 and the header no longer render. I kept the library's `--ui-zoom` on `.billing-shell`. |
| 2 | 9e5768d | `feature/creation-quality` 4d94dcf: design rounds 3–4, brief enhancer E1–E4 plus migration `20261022100000`, attachment fixture, e2e harness, the fix for the questions hold release | **Duplicates checked:** the branch's "undefined credits" fix (9e37cf0/f028940) is the same patch as the candidate's 3dfd1ee, and git merged it once. **Conflicts:** `.gitattributes` (both LF pins kept); `agent.ts` (the candidate's cached system prompt `cache_control` plus the branch's concept-aware `tools(...)`); `live-builder.tsx` (the candidate's saved chat history plus the branch's enhanced-brief cards; the branch's brand-kit line and `shownMaximum` placed inside the candidate's collapsed Request details). |
| 3 | 0dcf79e | `feature/editor-quality` aa41b25: history snapshot preview, build-error banner and Fix it, Hide chat, element labels, keyboard selection, preview-asset fix, site verifier and repair, task contract | Resolved against the new header (60a92f0) at the points the header handoff listed. **`cloud-studio.tsx`:** ProjectHeader kept; `preview={previewFact}` moved into the header `details`; the skip links sit above the header; Hide chat (Ctrl+.) moved into the toolbar's `editor-view-switch`; the stage keeps `id="editor-stage"`; LivePreview gets `toolbar` plus `subject`, `onBuilt`, `onFixError` and `recover`. **`live-preview.tsx`:** the branch's richer status feeds both the portalled `lp-toolbar` and the fallback `lp-bar`; the header's JSX `editButton` was renamed `editControl` and carries the branch's `editButton` ref. **`live-builder.tsx`:** the branch's `locked`/`sendBlocked` replaces the candidate's duplicate `blockedReason`; the visible `lb-availability` line is kept. **CSS:** `.cloud-workbench-tabs button.workbench-chat-hide` retargeted to `.project-toolbar`. **Two check scripts** moved to the four-fact details form. |
| 4 | b3a961b | `feature/image-led-sites` 8a5a192: image-led websites, vision-checked images, art system, comp-first, layout-probe gates | **`agent.ts`:** the branch's comps and layout-defect state plus the candidate's `cache_control`. **`prompt.ts`:** checklist item 3 keeps both the Escape/link-closing `<details>` rule from editor-quality and the 360 px one-row header rule; item 4 takes the branch. |
| 5 | db13ef0 | `feature/docs-quality` cd1b707: full-image decks, book images, decks of any length, PDF CID fonts, 16 static `@fontsource` packages | **`anthropic-call.ts`:** both sides bounded image tokens. I kept image-led's pixel-size `messageTokenBound` and kept docs-quality's exported `IMAGE_BLOCK_TOKEN_BOUND`, which docs-agent uses to reserve per image. **`docs-agent.ts`:** the branch's block plus `cache_control`. **`check-slide-art.cjs` (follow-on):** an unreadable image is now bounded by `IMAGE_TOKENS_UNKNOWN`. **`package.json`:** Codex's patched next 16.4.3, zod 4.6.6, sanitize-html 2.18.1 and undici 7.30.1 kept, with the fonts added. **Codex's slide-scene and closing-checklist work** is not on 5f655a7, so there was no conflict. |
| 6 | 88c1582 | `feature/crm-research` fecb50a. It contains `feature/agency-workflow` c455a66 and every `feature/agency-*` stage, so one merge brings both. | **`build/route.ts`:** reviews keep the design-comp blocks; builds use the ingest pipeline's `prepared!.blocks`. **`live-builder.tsx`:** the ingest `BuilderSource` plus `omittedSources`, together with the enhanced brief and design answers. **`export-server.ts`:** the `fitArtwork` version of `dataUrls`, exported for independent review. **`AGENT_HANDOFF.md`:** both sides kept. |
| 7 | dae6a89 | **Mine:** flags for unqualified generation features (section 2) | — |
| 8 | 58c58f7 | **Mine:** editor-chrome integration fixes, and large-screen scaling behind `MAKEBORNE_UI_SCALE` | — |
| 9 | 3fb8e67 | `claude/journey-polish` 2df6fc8: cf2bea6, fc13533, 6df394e, **36ea5ce (touches Codex's `src/components/mail/modal.tsx`, a focus trap; a separate commit Codex can take or skip)**, 8944406, 2749692, plus doc 2df6fc8 | **`account-projects.tsx`:** the library grid kept, with the branch's new empty-library line applied to it. |
| 10 | 88abf2d | `feature/crm-research` a62c1c1 (honest first email) | None. |
| 11 | ab3e814 | **Mine:** no book or deck image questions where images can't be made; editor checks follow the header | — |
| 12 | 839312c | `feature/image-led-sites` 76a0737: image cells refused until measured, comps in the owner's reference pattern, phone first screen | None. **Another agent is still on the comp prompts. Expect a small follow-up merge.** |
| 13 | 03c8ab2 | `feature/docs-quality` 68d47b0 | None, and no tree change: `image-cells.*` was already identical, and `budget.mjs` matches image-led's. **The quality and aspect controls are still in progress. Expect a small follow-up merge.** |

**Deliberately not merged (candidates for Codex):**

- `feature/github-continuous-sync`: Codex's activation hold.
- `feature/model-routing` f99f2cb and `feature/model-orchestrator` f988ed0: pricing ancestry that Codex excluded.

Verified absent from the candidate: d977daa, 7d13889, 0364dd4, af9bdf7, f988ed0, 7b2ed31 and c26cecb. No routing-only commit came in through image-led or docs-quality. Their overlap with model-routing is only the creation-quality and editor-quality ancestry, which this candidate merges on purpose.

**Follow-up merges expected.** These had already landed when this candidate was frozen; they are NOT merged and NOT tested here:

- `claude/journey-polish` **c6ffbb6** (3 commits after 2df6fc8):
  - 7aa6b16: client workspace set up with the first client or lead search;
  - de81d6d: AI-only onboarding steps say up front when they can't start (new `/api/assistants` route plus `assistant-availability`);
  - c6ffbb6: editor Preview for content-only projects (`cloud-studio.tsx`, `saved-preview.ts`).
  - Expect small conflicts in `cloud-studio.tsx`, near the header and editor-quality resolution.
  - The project-rename fix is still to come.
- `feature/docs-quality` **b38bfc6**: reference-pattern prompts, the client's quality and shape, generated book pages. It touches 25 files, including files this candidate changed for the flags: `api/build/route.ts`, `docs-agent.ts`, `docs-run.ts`, `check-availability.cjs`, `check-slide-art.cjs`, `brief-questions.ts` and `export-server.ts`.
  - When merging, keep the `MAKEBORNE_DECK_FULL_IMAGE` gate (`artEnabled`) and the `"live"` default for new decks while the flag is off.
  - Keep `features.documentImages` in GET `/api/build`.
  - Then rerun `npm test` and the deck, book and attachment browser checks.
- `feature/image-led-sites`: further comp-prompt work may follow 76a0737.

## 2. Flags and gates

### How the switches work

- **New flags added in this candidate.** Each is ON only when its value is exactly `on`; `true` and `1` stay off.
- **Agency and CRM flags.** These came from their branches. Unless the table says otherwise, they follow the same exactly-`on` rule.
- **`.env.example`.** It lists every full-launch flag at its off value.
- **Pre-existing gates** still apply on top of every flag:
  - provider limits (production today: global, Anthropic and OpenAI all off);
  - `creation_enabled`;
  - `MAKEBORNE_IMAGE_MODELS`;
  - the publication allowlist.

### Generation, editor and site features

| Feature (branch) | Switch | Default | Qualification status (evidence) | Needed to turn it on |
|---|---|---|---|---|
| Projects library grid, first-visit fix (library-redesign a6d8e60) | **none, ships ON** | on | **LOCAL:** S1/S1b handoff, 21–22 Oct. `check-library-previews-browser` 25/25 and `check-library-grid` 4/4 on this candidate. Not on staging. | A staging visual pass of the library at 375, 1440 and 1920. |
| Large-screen scaling, `--ui-zoom` above 1700 px (library 0f29ffc) | **`MAKEBORNE_UI_SCALE` (new)** | off | **LOCAL:** measured in three engines on its branch. On this candidate: the header check passes the scaled 2560×1440 case 26/26, including the new scenario. It changes every page above 1700 px, including pricing, which Codex qualified unscaled. | A staging pass of `/`, `/billing`, the studio library and the editor at 1920 and 2560. The flag is read at render time; static pages pick it up at build. |
| Editor quality: history snapshot, build-error banner and Fix it, Hide chat, element labels, keyboard selection, preview-asset fix (editor-quality aa41b25) | **none, ships ON** (UI only, no spend) | on | **LOCAL:** S4 handoff, 22 Oct. On this candidate: `check-editor-quality-browser` 10/10, `check-preview-assets-browser` 10/10, header 26/26, publish-output 8/8. | A staging editor pass. "Fix it" only drafts text; sending still needs AI to be on. |
| Site verifier and repair, task contract (editor-quality) | operator tool; used only by independent review | n/a | **LOCAL:** `check-site-verifier` and `check-site-repair` are in `npm test`. | Nothing; independent review is flagged. |
| Design rounds 3–4: concept step, rendered-contrast finish gate, design questions, prompt rules (creation-quality) | **AI generation itself** (provider limits); `MAKEBORNE_CONTRAST_GATE` (default on, `off` disables it) | AI is paused in production | **LOCAL** paid eval rounds (design rounds 3–4, ledger). Codex's minimum generation qualification was on **5f655a7's pipeline, not this one.** | **The staging generation qualification must run on this candidate's pipeline** before AI opens on this build. |
| Brief enhancer E1–E4 (creation-quality) | **`MAKEBORNE_BRIEF_ENHANCER` (new)** plus migration 20261022100000 | off | **LOCAL:** E1–E4 repaired and "the Codex recheck it needs" (9a7cfa1). SQL `check-brief-enhancements` 7/7 on a throwaway chain. Mounted `check-enhance-flow-browser` 6/6, including flag off. | The Codex E1–E4 recheck, then a staging run with the flag on. |
| Image-led websites, vision-checked images (image-led) | **Image gate:** `OPENAI_API_KEY` + `MAKEBORNE_IMAGE_MODELS` + the OpenAI provider limit | off in production | **LOCAL:** rounds A–G2; ledger scope image-led-20261022b, $43.83 of $46.90. Not staging. | An owner decision on images at launch (D8) and an image quality budget; then OpenAI limit > 0 and a staging build. |
| Comp-first design comps (image-led) | **`MAKEBORNE_DESIGN_COMPS` (new)** plus a text-capable image model | off | **LOCAL**, unverified live (8a5a192/f234bfa "not yet verified live"). The phone first-screen gate in f234bfa breaks the branch's own `check-contrast-gate-browser` (section 4). | A live comp round under a quality budget; fix the contrast-gate fixture. |
| Book images, image-count questions (docs-quality) | image gate; questions shown only when `features.documentImages` (new, computed) | off in production | **LOCAL:** live scope docs-images-20261022. | The same image decision and budget as image-led websites. |
| Full-image slides, decks of any length (docs-quality) | **`MAKEBORNE_DECK_FULL_IMAGE` (new)** plus a text-capable image model | off. New decks are editable text slides; the style question is hidden. | **LOCAL:** 9de4c5b/cd1b707. Codex noted it is "NOT merged or qualified". Note: on 22 Oct the owner preferred image-led live-text slides. | An owner product decision, then a live round. |

### Agency and CRM features

| Feature (branch) | Switch | Default | Qualification status (evidence) | Needed to turn it on |
|---|---|---|---|---|
| Source ingestion: Word, Excel, CSV, stored large files (agency stage 2) | `MAKEBORNE_SOURCE_INGESTION_ENABLED` (exactly `true`) plus migration 20261023130000 | false. Requests are handled as before. | **LOCAL:** `check-ingest-pipeline` (npm test). | A staging upload and build. Note: the migration widens the `project-assets` MIME list for docx, xlsx, csv and json **whether or not the flag is on**. The app routes still refuse those types while the flag is off. |
| Agency tasks contract (stage 1) | `MAKEBORNE_AGENCY_TASKS` **and** `MAKEBORNE_AGENCY_TASK_KINDS` (comma list; empty = none) plus migration 20261023200000. Four kinds are already qualified, so each listed kind makes paid calls at once: a cost decision per kind (S4) | off / empty | **LOCAL:** SQL `check-agency-operations` 10/10 here; `check-ai-operations` unchanged, 2/2. | The flag; the owner's go-ahead per stage. |
| Approved client knowledge (stage 3) | `MAKEBORNE_CLIENT_KNOWLEDGE` plus 20261023210000 | off | **LOCAL:** SQL 12/12 here. | Owner go-ahead and a staging pass. |
| "Understand this client" research (stage 4) | `MAKEBORNE_CLIENT_RESEARCH` plus 20261024010000 | off | **PAID LOCAL:** `agency-qualification-20261024.md`, conflict fixtures PASS on the re-run. SQL 6/6 here. | A staging pass. Web search stays refused. |
| Image editing (stage 5) | `MAKEBORNE_IMAGE_EDITING` plus `MAKEBORNE_IMAGE_EDIT_MODELS` (empty); generated edits also need `MAKEBORNE_AGENCY_TASKS` and `image_edit` in `MAKEBORNE_AGENCY_TASK_KINDS` (S3, S4) | off | **PAID LOCAL:** measured edit bounds in the qualification report. | The owner signs off the D8 extension, then a staging pass. |
| Independent review (stage 6) | `MAKEBORNE_INDEPENDENT_REVIEW` (needs AGENCY_TASKS); `MAKEBORNE_CROSS_PROVIDER_REVIEW` | off | **PAID LOCAL:** re-run met every criterion at ef753a3 (adad1ac). Cross-provider: not covered. | A staging pass. |
| Data reports (stage 7) | `MAKEBORNE_DATA_REPORTS` plus 20261024020000 | off | **PAID LOCAL:** qualifies at or after 31b1b3d. | A staging pass. |
| CRM and lead research (crm-research) | `MAKEBORNE_CRM_RESEARCH` plus 20261025300000 and 20261026120000 | off; routes answer 404 | **LOCAL, no AI:** SQL 7/7 here; `check-crm-research-browser` 9/9 here. | Codex enforces do-not-contact in `mail/engine.ts` sendEmail and in sequences, reviews the trust boundary, and schedules the purge. Then the flag goes on. |

## 3. Migrations: new against main, in order, on a throwaway chain

### New migrations against main

1. `20261022100000_brief_enhancement_actions`
2. `20261023130000_project_source_uploads`
3. `20261023200000_agency_operation_contract`
4. `20261023210000_client_knowledge`
5. `20261024010000_client_research`
6. `20261024020000_data_report_files`
7. `20261025200000_paying_workspace_publication` (Codex's; already applied on staging)
8. `20261025300000_crm_research`
9. `20261026120000_crm_server_writes` (S9: website checks stored by the server only; next steps only through the compare-and-set function. Applied on the isolated local stack `makeborne-journey-audit` only, after a rolled-back dry run)

**Staging and push order.** Staging already has 20261025200000. Items 1–6 sort before it, so `supabase db push` would need `--include-all`, or Codex's `apply-staging-migrations.mjs` path. They are additive and do not touch the publication functions.

### How the chain was run

- The disposable harness reused the bootstrap from `scripts/rehearse-candidate.mjs`.
- Containers were fresh `public.ecr.aws/supabase/postgres:17.11.0.002` with `--network=none`, built as:
  - the platform schema;
  - the production schema dump;
  - the production baseline;
  - the populated fixture;
  - the legacy pause;
  - every candidate migration, in order.
- Two containers:
  - **base:** 89 migrations, equal to Codex's 5f655a7 chain;
  - **full:** 96 migrations, the whole candidate.
- All 82 `supabase/check-*.sql` files ran on both.
- Both containers were force-removed afterwards; `docker ps -a` shows none left.
- Evidence: `docs/release-review/full-launch-candidate-sql-20261026.json`. Its input hashes still match the final tree.

### SQL results

| | Count | Checks |
|---|---|---|
| All migrations apply | — | No error. Fingerprints: base 979ed245…, full 7bc87bf2…. |
| Pass on both base and full | 59 | Includes `check-paying-workspace-publication` 17/17, `check-ai-operations`, `check-trusted-publication` 8/8, the hosting, billing, credit, CRM and mail suites, and `check-generation-*`. |
| Pass on full only (they need the new tables) | 5 | `check-agency-operations` 10, `check-brief-enhancements` 7, `check-client-knowledge` 12, `check-client-research` 6, `check-crm-research` 7. |
| Fail identically on base and full | 18 | Environmental only. These suites need the named isolated stack or special guards: dblink to `supabase_db_makeborne-release-auth`, the `*-concurrency` suites, top-up/status/scale database-name guards, the CRM concurrency empty-DB guard, `__MAIL_SCOPE_MIGRATION__` substitution, publication worker `SET ROLE`, local pilot lock, `browser-acl` `rls_auto_enable` search_path, the scope-matrix bucket fixture, the auto-topup daily limit, and the crm-mail-upgrade fixture. |
| **Regressions** | **0** | — |

Not run: `check-agency-operations-concurrency` (needs dblink to the isolated stack). Run it there if Codex wants race evidence.

## 4. Check results on the final tree

All checks below are local and offline, with providers mocked.

| Check | Result |
|---|---|
| `npm ci` into the worktree's own `node_modules` | PASS. The lockfile is consistent after the merges. |
| `tsc --noEmit` | PASS |
| `eslint .` | PASS: 0 errors, 1 warning. The warning is pre-existing and comes from editor-quality: `scripts/check-preview-assets-browser.cjs:72` `catImage` is unused. |
| `npm test` (run-checks) | **217/217**. The same 5 explicit skips as Codex. `check-art-directions` takes about 111 s alone against a 120 s timeout and timed out once under load during the parallel SQL run. Pre-existing timing; it passes. |
| `next build --webpack` | PASS. Run twice, the second time on the final code. |
| SQL chain | Section 3. |

### Mounted browser checks in Chromium: 39/44 pass

**Integration breakages found by these checks and fixed by me:**

- **Editor header** (now 26/26):
  - skip links rendered visibly without `studio-refresh.css`;
  - the toolbar overflowed at 800 px once Hide chat joined it;
  - the four-fact details list;
  - plus a new scaled-editor scenario.
- **`check-editor-quality-browser`** (2/10 → 10/10): adapted to the header.
- **`check-attachment-readiness-browser`** (5/9 → 9/9) and **`check-attachment-flow`** (7/13 → 13/13): books always asked image questions, fixed by `documentImages`.
- **`check-enhance-flow-browser`** (6/6): adds the enhancer-off case.
- The availability, enhance-route, image-vision and slide-art offline checks were extended for the flags.

**Areas that pass:**

- **Billing:** billing return 4/4, checkout return, billing UX, top-up return, autotopup 9/9, creation plans, plan sign-up and plan fit.
- **Builder:** paused builder 6/6, composer send 2/2, brief skip 10/10, enhanced brief 8/8.
- **Connections and mail:** connections 5/5, mail connected 5/5.
- **CRM and onboarding:** CRM research 9/9, journey onboarding, lead-profile layout.
- **Library:** library previews 25/25.
- **Editor and publishing:** publish output 8/8, publication 6, version compare, preview assets 10/10, presenter, review restore, client review, source output and search, trust copy, palette and command palette.

**The 5 remaining failures are pre-existing. None is mine.**

- **On Codex's 5f655a7 in a detached baseline worktree** (the header handoff saw the same on de7e657):
  - `check-advisor-handoff-browser` 7/9;
  - `check-edit-intent-browser` 0/9;
  - `check-preview-continuity-browser`: Codex has an uncommitted account-chat GET fixture fix in the combined checkout;
  - `check-live-builder-flow`: the credit limit now sits in the collapsed Request details.
- **On `feature/image-led-sites` 76a0737 itself:**
  - `check-contrast-gate-browser`: its new phone first-screen gate (f234bfa) reports "primary action is missing" on the fixture's clean site. Note for the image-led agent.

`check-builder-stop-browser` and `check-chat-history-browser` also fail on 5f655a7 when run alone (chat-history needs `work/chat-hook-check.json`). Both passed in the final sequential sweep here.

**Not run:**

- Firefox and WebKit sweeps.
- e2e specs that write to a local stack.
- Real-app passes against a local Supabase stack.
- Anything on staging.

## 5. Known gaps and risks

1. **The generation pipeline differs from the one Codex qualified.** The design rounds, image-led prompt rules, vision checks, docs-agent changes and the contrast and first-screen gates are active whenever AI is on. Only the enhancer, comps and full-image slides have their own flags; images ride on the image gate. **If this build ships, the staging generation qualification must be redone on it.**
2. **UI ships on without flags:**
   - the library grid;
   - the editor-quality UI (Hide chat, history preview, error banner, element labels);
   - journey copy and onboarding fixes;
   - the CRM phone layout.

   All are covered by mounted checks, but none is on staging.
3. **`MAKEBORNE_CONTRAST_GATE` defaults ON.** It launches Chromium inside each AI build (sparticuz). Serverless cost and timing are unmeasured on staging.
4. **The `project-assets` MIME widening** (20261023130000 and 20261024020000) takes effect at migration time, not at flag time.
5. **Shared files changed:**
   - 36ea5ce changes Codex's `src/components/mail/modal.tsx` (focus trap);
   - `src/app/api/build/route.ts`, `cloud-studio.tsx`, `live-builder.tsx` and `live-preview.tsx` carry multi-branch resolutions (section 1);
   - billing and publication paths were not edited, beyond the library's CSS zoom fix in `billing.css`.
6. **More merges are coming:** follow-ups from journey-polish, image-led and docs-quality. Expect small, mostly non-overlapping merges.
7. **Owner decisions are still open:**
   - images at launch (D8) and the image quality budget;
   - full-image versus image-led slides;
   - the AI operating amount;
   - the CRM do-not-contact enforcement;
   - the per-stage agency go-ahead.

## 6. Recommended activation order for Codex

1. **Decide the vehicle.** Either ship this as the launch build with every flag off (it then needs the staging pass below plus a re-run of the generation qualification on this pipeline), or ship 5f655a7 first and this as a fast follow. The code paths that are on for customers with flags off are the UI items in section 5.2 and the generation-pipeline changes, which matter only once AI opens.
2. **First, no AI involved:**
   - the library and editor improvements (staging visual pass);
   - `MAKEBORNE_UI_SCALE` after a large-screen pass;
   - `MAKEBORNE_CRM_RESEARCH` once do-not-contact is enforced in mail.
3. **With the AI operating amount approved:**
   - re-qualify a website build on this pipeline;
   - then `MAKEBORNE_BRIEF_ENHANCER` after the Codex E1–E4 recheck.
4. **Once the image quality budget is approved:**
   - OpenAI limit > 0 for image-led websites and book images;
   - then `MAKEBORNE_DESIGN_COMPS`;
   - `MAKEBORNE_DECK_FULL_IMAGE` only if the owner wants full-image slides.
5. **Agency, later, stage by stage:**
   - `SOURCE_INGESTION`, then `CLIENT_KNOWLEDGE`, `CLIENT_RESEARCH` and `DATA_REPORTS`, then `INDEPENDENT_REVIEW` and `IMAGE_EDITING`;
   - each with the owner's go-ahead and a staging pass;
   - `CROSS_PROVIDER_REVIEW` stays off.
6. **Separately:** GitHub continuous sync (Codex's hold) and model routing and the orchestrator remain outside this candidate.
