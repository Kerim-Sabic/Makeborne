# Agency workflow: handoff for Codex, 24 October 2026

**Status: local only. This branch is not a frozen candidate.** Nothing here is pushed, merged to main, deployed or switched on. Every feature flag is off and set nowhere. No paid AI call was made and no cloud resource was touched. The budget ledger (`outputs/eval/budget/ledger.json` in the primary checkout) has no allowance for this work. My scopes are exhausted (website scope `image-led-20261022b` $43.83 of $46.90; the docs share has about $1 left), and `model-orchestrator-20261023` belongs to other work.

## 1. Branch and commits

Branch `feature/agency-workflow`, worktree `.claude/worktrees/agency-workflow`, based on origin/main **de7e657** (live). Candidate code revision: **0565f10**. The docs commit that adds this file follows it; see `git log`.

| Commit | What |
|---|---|
| f884f8b | map and ownership claim |
| 5b92a20 | merge stage 1, execution contract (06a8963 migration + SQL checks, c9a7a43 TypeScript, 2468cb2 handoff) |
| 4b9aa32 | merge stage 2, source ingestion (583974d, 12a8c13) |
| 6b9b7ba | merge stage 5, image editing, disabled (2da7058, ed76b7c, 8c41254, ce7e74a) |
| 78cdb14 | merge stage 3, approved client knowledge (bdd8d42, 345c070, 92136ca) |
| b5f4fe1 | merge stage 6, independent review (4fb3142, 8f75a9f) |
| 8ab4c69 | merge stage 4, Understand this client (8b34f85, f9f5c3d, 4b7cffb) |
| 68b50ac | merge stage 7, data to deliverable (b0ed998, 0ddc95b, 1e49313) |
| **7b828ec** | integration (this handoff, §3) |
| **85dc2a2** | evaluation set + XLSX price-extraction fix |
| **0565f10** | refactor: source choices recorded beside `operationContext` (no new merge conflict) |
| (next) | docs: this file, the eval note/results, AGENT_HANDOFF pointer |

Uncommitted work: none, apart from the docs commit that adds this file.

## 2. Features, flags and configuration (all off by default, set nowhere)

| Flag (server-side) | Default | Turns on | Also needs |
|---|---|---|---|
| `MAKEBORNE_AGENCY_TASKS=on` | off | agency task execution on the existing operation (`runAgencyTask`) | a qualified setting in `AGENCY_SETTINGS` (none exists: every kind is refused) |
| `MAKEBORNE_SOURCE_INGESTION_ENABLED=true` | off | DOCX/PPTX/XLSX/CSV and stored-reference sources in build/plan, `/api/build/sources` inspection, the sources upload route | migration 20261023130000 for large DOCX/XLSX/CSV uploads; sandboxing the worker for production (§8) |
| `MAKEBORNE_CLIENT_KNOWLEDGE=on` | off | knowledge routes and panel; knowledge reads inside agency steps; knowledge-backed facts in the independent review | migration 20261023210000 |
| `MAKEBORNE_CLIENT_RESEARCH=on` | off | "Understand this client" routes and panel | migration 20261024010000; assisted writing also needs agency tasks plus a qualified `research` setting; Save to client needs knowledge |
| `MAKEBORNE_IMAGE_EDITING=on` + `MAKEBORNE_IMAGE_EDIT_MODELS` | off / unset | Edit image routes and panel | measured edit cells (`MEASURED_EDIT_TOKENS` is empty), a qualified `image_edit` setting, the OpenAI key on that environment |
| `MAKEBORNE_INDEPENDENT_REVIEW=on` | off | independent-review API (deterministic checks always; the reviewer only with agency tasks plus a qualified `independent_review` setting) | none for checks only |
| `MAKEBORNE_CROSS_PROVIDER_REVIEW` | off | nothing: refused while unqualified, even when on | implementation, an OpenAI text price-card entry, qualification |
| `MAKEBORNE_DATA_REPORTS=on` | off | "Report from data" route, panel and the `stored=1` download branch | migration 20261024020000 (JSON in project-assets) |

## 3. Integration done in this pass (7b828ec, 85dc2a2, 0565f10)

- **Stage 2 → stage 1.** "Continue without it" choices (`omittedSources`) and the ingestion reference of every file read (`{sourceId, sha256, extractionVersion, format, status}`) are recorded once in the new operation's request context as `sources: {omitted, references, sha256}`, for both build and plan. A continuation must present the same set. If it does not, the request is refused with `OPERATION_SOURCES_CHANGED` before any step or hold. Visual-review stages are exempt, as they already are for attachments. Requests with no ingested or omitted files keep their exact old context (no `sources` key). For agency tasks, `bindTaskSources` adds the same entry to the task context and to the input digest, so a replay with a different extraction is a different request. Research binds the documents it read this way. Files: `src/lib/builder/operation-sources.ts` (new), `operation-server.ts` (create call + continuation check), `src/app/api/build/route.ts`, `src/app/api/build/plan/route.ts`, `src/lib/agency/task.ts`, `src/lib/research/research.ts`. Tests: `check-operations.cjs` (31 groups), `check-agency.cjs` (26).
- **Stage 3 → tasks.** The `AGENCY_KIND_POLICY.knowledge` flag is true for research, data_report and independent_review. `runAgencyTask` takes a `knowledge` dependency and calls it once, **after the step's run exists**, so the snapshot carries the operation id. It retries once when the snapshot is refused as stale (`knowledgeForTask`). If the knowledge changed or is unavailable, the step finishes failed and uncharged before any model call (`KNOWLEDGE_CHANGED` / `KNOWLEDGE_UNAVAILABLE`). The snapshot id, the count and the context digest are stored in the step detail. A lead may render the knowledge itself (`content` as a function, `knowledgeInContent`). It may also pin the digest its evidence was built from (`expectKnowledgeSha256`). **Research ordering fix:** with an assisted step, the planning read records no snapshot (`record: false`); the step reads again with its operation id and rebuilds the model's material from that read. The deterministic path still records its snapshot without an operation, because none exists. Data narratives receive knowledge as wording background only ("do not take any figure from it"). Routes wire `knowledgeForAgencyTask` when `MAKEBORNE_CLIENT_KNOWLEDGE=on`. Tests: `check-agency.cjs`, `check-research.cjs` (18), `check-data-reports.cjs` (20), `check-review.cjs` (19).
- **Stage 3 ↔ stage 6.** `src/lib/review/knowledge.ts` builds the reviewer's `ApprovedFacts` from the knowledge context: approved, non-inference facts under their citation ids (`K-xxxxxxxx-rN`). The `ClaimsCheck` is the knowledge module's checker. The new `judgeCopyClaims` also returns supported claims, so a grounded "this value is wrong" finding against a supported value is downgraded. Prices, times, figures, phones, emails and status words are covered. The approved brief also counts as support. Unapproved or unsupported values are not supported; a disputed approved value stands. The review route reads knowledge before the evidence is assembled (recorded when checks only; planning read when a model step follows). The model step re-reads with its operation id and refuses as `stale` if the facts changed. Without knowledge, or for a project with no client, the old behaviour stays: no facts, claims reported not checked.
- **Stage 6 project images.** `src/lib/review/website-assets.ts` makes a review copy of a React site that keeps the project's own image paths (`img-src data: 'self'`, used only inside the offline capture). It serves each image from the version's registered asset through the caller's RLS client: `resolveProjectImages`, a thin export of the existing original-asset resolver, with sha256, size and still-raster checks. Missing or changed bytes, or a deleted asset row, count as **broken**. Unconfirmed storage counts as **not checked** and is listed in coverage. Anything that is not a project asset is not served (unchanged). Tested with real Chromium in `check-review-render.cjs` (6/6).
- **Bug found by the evaluation, fixed (85dc2a2).** XLSX currency cells keep the amount in `value`, but `extract.ts` read only `number` (CSV's field). Real Excel price lists therefore never became knowledge suggestions. It now reads either field. A regression check runs the real parsers (`check-knowledge.cjs`, 15/15).
- **Merge impact.** `git merge-tree` of HEAD against `qualification/beta-combined-20261022`, `feature/model-routing`, `feature/image-led-sites`, `feature/docs-quality` and `feature/editor-header-hierarchy` gives exactly the same conflicting files as before the integration (68b50ac). Those files are `live-builder.tsx` (everywhere), `export-server.ts` (beta-combined, docs-quality), `next.config.ts` and `AGENT_HANDOFF.md` (beta-combined), `build/route.ts` (image-led, 1 hunk before and after) and `AGENT_HANDOFF.md` (editor-header).

### Not wired (on purpose): knowledge in the builder prompts

The shared builder files are changed on other branches, so this integration does not touch them. The exact step for whoever merges them is as follows:
1. `src/app/api/build/route.ts`, after `beginOperation` returns `admitted.run`: if `clientKnowledgeEnabled() && project.clientId`, call `knowledgeForAgencyTask({ actorId: user.id, workspaceId: body.workspaceId, clientId: project.clientId, artifactId: body.artifactId, operationId: operation.operation.id, objective: body.message, purpose: reviewing ? "visual review" : "website build" })`. Add `knowledge.context.text` to the `<project>` context block after the brand block. On `KnowledgeChanged`, call `finishOperation(reserved, 0, "failed", { code: "KNOWLEDGE_CHANGED" })` and return a 409.
2. Do the same in `src/app/api/build/plan/route.ts` (purpose `"site plan"`) and in the document branch (`documentBuildResponse`, purpose `"document build"`).
3. Before the save in `src/lib/builder/website-run.ts` and `docs-run.ts`, call `checkArtifactClaims(candidate.content, claimFacts(knowledge.context), project.brief)`. Treat `unsupported`/`unapproved` as a repair finding through the existing finish/repair path, not a silent pass. Store `knowledge.snapshotId` in the finish detail.
4. `src/lib/builder/prompt.ts` needs one line: client facts are data, and only approved ones may be stated. The knowledge block already carries the rules.
Conflict owners: `website-run.ts`/`prompt.ts` (feature/image-led-sites), `docs-run.ts` (feature/docs-quality), `build/route.ts` (image-led, model-routing).

## 4. Migrations and deployment compatibility

| Order | File | Kind | Local isolated stack (`supabase_db_makeborne-release-auth`) |
|---|---|---|---|
| 1 | `20261023130000_project_source_uploads.sql` | adds DOCX, XLSX, CSV to `project-assets` allowed types | **applied 24 Oct in this pass** (after the throwaway passed) |
| 2 | `20261023200000_agency_operation_contract.sql` | widens operation kinds; scope function; `result` outcome; heartbeat/progress; run columns | applied earlier (stage 1) |
| 3 | `20261023210000_client_knowledge.sql` | 5 new tables, triggers on sources/assets/projects, service-only entry points | applied earlier (stage 3) |
| 4 | `20261024010000_client_research.sql` | 2 new tables, service-only entry points | applied earlier (stage 4) |
| 5 | `20261024020000_data_report_files.sql` | adds `application/json` to `project-assets` | **applied 24 Oct in this pass** |

- All five are additive. The two bucket migrations are idempotent (re-applied on the throwaway: no change) and safe in either deploy order. They contain their own `begin/commit`. Migration 1 sorts before 2–5 and must be included (`--include-all`) wherever 2–5 or later migrations are already recorded. **Never a bare `supabase db push`.**
- **Full chain in order on a disposable database:** `node supabase/check-ai-operations-disposable.mjs makeborne_operations_20261024` built a fresh container from the production baseline (`docs/release-review/production-baseline.json`). It applied all 93 migrations missing from production in timestamp order, the five above included, with **no error**. The unmodified `check-ai-operations.sql` and the concurrency races all passed. The same disposable database then ran the suites in the full-chain column below. The container was stopped and removed afterwards.
- **Throwaway clone of the local stack:** `createdb -T` was impossible (5 live connections to `postgres`), so I made a full `pg_dump -Fc` of the local `postgres` DB and restored it into `makeborne_agency_chain_20261024` (0 restore errors). Catalog parity with the source: 474 functions, 149 tables, 85 policies, identical function-ACL digest. I applied migrations 1 and 5 in their transactions, ran the suites, then **dropped** the database and removed the dump.
- **Rollback:** application rollback means deploying the previous app. Every new path is behind an off flag, so the schema can stay. Schema rollback, if ever needed: the bucket migrations reverse with `update storage.buckets set allowed_mime_types = array(select unnest(allowed_mime_types) except select unnest(array[...added types...]))`. Do that only after the stored objects of those types are handled. Migrations 2–4 add tables and functions and widen checks. Dropping them loses knowledge/research data, and the widened kind checks can only be narrowed once no agency operation rows exist. Codex should write explicit down-migrations only if the owner asks.

### SQL results (24 Oct)

| Suite | Throwaway clone (+ pending migrations) | Disposable full chain | Notes |
|---|---|---|---|
| check-agency-operations | PASS | PASS | |
| check-agency-operations-concurrency (dblink, `allow_fixture_commit=on`) | PASS (races + cleanup) | not run | its connection string names the release-auth host |
| check-client-knowledge | PASS | PASS | |
| check-client-research | PASS | PASS | |
| check-ai-operations | PASS (fixture limit raised to 1,000,000,000 in a copy: the local ledger already holds today's rows) | PASS, **unmodified** | |
| check-ai-operation-cancellation | PASS (same raise) | PASS (same raise) | |
| check-plan-approval-idempotency | PASS | PASS | |
| check-usage-history | PASS | PASS | |
| check-brand-kits | PASS | PASS | |
| check-client-directory | PASS | PASS | |
| check-locked-content | PASS | PASS | |
| check-generation-authority | PASS | PASS | |
| check-scope-matrix | FAIL "Editor moved current_version" | FAIL (no `project-assets` bucket in the baseline) | identical failure on the local `postgres` DB without the pending migrations: local ACL drift. Our migrations grant nothing on `artifacts`. |
| check-browser-acl | FAIL (anon/PUBLIC privileges on `artifact_versions` …) | first 2 parts PASS ("RLS on every public table; anon and PUBLIC hold no table or column privilege"), then FAIL on `public.rls_auto_enable` (a platform function, not ours) | local failure identical on `postgres` without the pending migrations |
| check-client-projects | FAIL "Client unavailable" | **PASS** | local failure identical without the pending migrations (pre-existing drift; stage 3 recorded the same) |

## 5. Grants / RLS review (catalog of the throwaway clone)

- **anon:** no execute on any of the 50 new or replaced functions; no privilege on any of the 7 new tables (tables, columns and PUBLIC all empty). No `usage` on `makeborne_private`.
- **authenticated:** `SELECT` only on `client_facts`, `client_fact_evidence`, `client_fact_revisions`, `knowledge_snapshots`, `client_knowledge_state`, `client_research_pages` and `client_research_briefs`, each with RLS enabled and one policy (`*_member_read`, `makeborne_private.can_read(workspace_id)`: owners, editors and reviewers of that workspace). No insert, update or delete grant. No execute on any entry point. No access to `ai_operation_runs`. (`authenticated` has `usage` on `makeborne_private`, which already existed.)
- **service_role:** execute on the public entry points (`makeborne_agency_task_scope`, `makeborne_ai_operation_heartbeat/_progress`, `makeborne_knowledge_*` ×7, `makeborne_research_*` ×4), which are `security invoker` wrappers with `search_path=''`. Execute on the private definers they call (`agency_task_scope`, `ai_operation_begin/_cancel/_create/_finish/_heartbeat/_progress/_recover`, `knowledge_propose/_review/_correct/_revoke_source/_retrieve/_snapshot/_snapshot_view`, `research_*`). It also has execute on the non-definer helper `research_brief_json`. `SELECT` on the new tables; writes go only through the definer functions.
- Every definer has `search_path=""`. Internal helpers (`knowledge_require`, `knowledge_role`, `knowledge_bump`, `knowledge_record`, trigger functions, `ai_operation_agency_kind` …) are executable by no API role.
- Triggers added on existing tables: `knowledge_source_lifecycle@sources`, `knowledge_asset_lifecycle@assets`, `knowledge_brief_lifecycle@projects` (definer, `search_path=""`), plus immutability and epoch triggers on the new tables.
- `project-assets` stays private (`public=false`, 50 MB) with one storage policy (`project_assets_insert`, authenticated, own-workspace prefix). The migrations change only allowed types.
- **Points for review (not defects):** (1) members, reviewers included, can read all knowledge rows, quotes included, and the research page cache. This matches the stage 3 and 4 design but is a privacy decision for the owner. (2) `service_role` holds direct `SELECT` on the new tables (used by server reads); no API path exposes it to browsers.

## 6. Secret scan and whitespace

- `git diff --check origin/main..HEAD`: clean (exit 0).
- Secret scan of the added lines of `origin/main..HEAD` (17 patterns: Anthropic/OpenAI/Stripe/webhook/AWS/GitHub/Slack/Google/Supabase/Vercel/Resend keys, private keys, JWTs, bearer literals, password assignments, credentialed connection strings): 20,254 added lines, **0 hits**. The only credential-shaped text in the branch is the local stack's documented default DSN in `supabase/check-agency-operations-concurrency.sql` (`user=postgres password=postgres`, local container only). It is not a live value.

## 7. Test evidence (candidate code revision 0565f10)

These checks were run serially on HEAD `0565f10eb41c…` (working tree: only the two untracked eval docs) on 24 October 2026, on Windows with Node 22.18:

| Check | Result |
|---|---|
| `npm test` (offline harnesses) | **195/195 passed** (284 s). Same harness count as before; the new assertions sit inside existing harnesses: `check-agency` 26, `check-operations` 31, `check-review` 19, `check-review-render` 6 (real Chromium), `check-research` 18, `check-data-reports` 20, `check-knowledge` 15 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` (full) | exit 0, no output |
| `npx next build --webpack` | exit 0, "Compiled successfully"; the independent-review, data-reports and research routes are built. Turbopack refuses the junctioned node_modules, which is an environment issue. |
| `scripts/check-attachment-readiness-browser.cjs` (Chromium) | PASS (all scenarios, including 320/375 px) |
| `scripts/check-attachment-flow.cjs` (Chromium) | PASS (resume, unsupported, retry, account races, retention) |
| `scripts/check-builder-stop-browser.cjs` (Chromium) | **FAIL**: it expects the first request to be `/api/build` but sees `/api/build/sources` (stage 2 pre-Send inspection) and `…/chat` (main's account chat history, 13b1343). No browser-bundled file changed since 68b50ac, and the check was last updated on 21 Oct, before both features, so this pass did not cause it. **Not verified on main**: the check needs its request filter updated. |
| Image-edit, knowledge, research and data-report panels in a browser | **not run**: no harness exists, and they need a signed-in local session |
| Evaluation set (`scripts/eval/agency/run-agency-eval.cjs`) | 8/8 cases, 19/19 seeded defects caught, 0 network attempts, 0 paid calls (`agency-eval-20261024.{md,json}`, revision 0565f10) |
| SQL (local container only) | §4: throwaway clone + disposable full chain; 3 suites fail on known local drift or platform functions, none on these migrations |
| `git diff --check origin/main..HEAD` | clean |
| Secret scan, added lines of `origin/main..HEAD` | 20,254 lines, 17 patterns, **0 hits** (pattern self-test positive) |

## 8. Remaining service, credential and account steps (none done)

- Owner-approved budget ledger entries for each paid qualification below (new scopes; none exists).
- OpenAI image-edit models on the allowlist only on an approved environment (`MAKEBORNE_IMAGE_EDIT_MODELS`) after measured cells; an OpenAI text price-card entry before any cross-provider review.
- Production isolation for ingestion: run `src/lib/ingest/parsers/*.cjs` + `parse-worker.cjs` in the existing sandbox pattern (Vercel Sandbox deny-all, or the Docker runtime with no network, 1 CPU and 512 MiB) and qualify cold-start latency. A worker thread is not an OS sandbox.
- Apply the five migrations to staging (from this order, `--include-all`, never a bare push), then run the SQL suites there.
- Web search stays refused until a documented and enforced result-token ceiling exists. That is a provider/documentation question, not money.

## 9. Paid tests still required (estimates from each stage's qualification doc; each needs a new allowance)

| Test | Estimate | Cap / allowance to request | Doc |
|---|---|---|---|
| Ingestion: adversarial 10-file set through the real model | ≈ $1–2 Anthropic | propose $2 (new scope, e.g. `agency-ingest-qual`) | AGENT_HANDOFF stage 2 |
| Image edit: 24 edit calls + 3 end-to-end | $5.83 OpenAI + $0.36 Anthropic | **$6.50 OpenAI + $0.50 Anthropic** | `image-edit-qualification-20261023.md` |
| Independent review: 12 fixtures + 6 re-checks | ≈ $2.5 | **$5** | `independent-review-qualification-20261023.md` |
| Blind reviewer comparison: 20 pairs | ≈ $5–9 | **$12** | same |
| Research assisted brief: 12 runs + 3 Stop/replay | ≈ $2 | **$4.50** | `client-research-search-qualification-20261024.md` |
| Web search (once a result-token ceiling exists) | ≈ $0.60–0.85 | **$2** | same |
| Data narratives: 20 runs | ≈ $1.5 | **$3** | `data-reports-qualification-20261024.md` |
| Open-ended generated-code execution | ≈ $2–6 | **$8** | same |
| Human preference; previous vs new workflow on the same inputs | needs live generation on both paths; not estimated per stage | owner to size | `agency-eval-20261024.md` |

## 10. Known limitations

- No agency kind is qualified, so every model step is refused. In practice the shipped behaviour is deterministic only: research brief from quotes, review checks, plain data narrative, deterministic image ops.
- Knowledge is not in the builder prompts (§3). Retrieval is lexical (no embeddings), there is no advisory-lock race test, and client-less workspace knowledge is not supported.
- Ingestion does not render slides or pages to images. PDF text-layer detection is per document. Creation home cannot upload large files.
- Review: scripts, motion, hover, focus and form sending are not inspected. No PDF rasteriser runs. PowerPoint's own rendering is not inspected. A project image whose row exists but whose object cannot be read is reported not checked (it cannot be told apart from a storage outage).
- Image edit: the UI entry point is outline image blocks only. A failed step's specific code is kept only in the run detail.
- Data reports: open-ended code execution is not implemented. Reviewers may download saved report files (existing export rule, unchanged).
- No signed-in browser pass of the new panels (knowledge, research, image edit, data report): no harness exists for them.
- Local SQL drift on the release-auth stack makes `check-scope-matrix`, `check-browser-acl` and `check-client-projects` fail there regardless of these migrations (§4).

## 11. Rollback

Before any merge: delete or abandon the branch; nothing is deployed. After a merge with flags off: the new paths are inert, so revert the merge commit if the code must go. Unset any flag that was switched on to disable that feature immediately. Migrations: see §4 (additive; leave them in place unless the owner asks for down-migrations). Local stack: the two bucket migrations applied today change only `storage.buckets.allowed_mime_types` for `project-assets`. The previous value was `{image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/epub+zip}`.

## 12. Owner decisions pending

1. **Cross-project input boundary:** inputs may come from any project of the same client in the workspace (`agency_task_scope`). Confirm, or restrict to the artifact's own project.
2. **15-minute hold vs long paid steps:** lease renewal works only for exempt runs; paying runs must use sequential steps unless the hold lifetime policy changes.
3. **Client-level tasks:** today every task is anchored to an artifact; research anchors to one of the client's artifacts. Client-level operations need a scope decision.
4. **Reviewer downloads:** reviewers can download saved report files (existing export rule). Keep it, or restrict it.
5. **Uncharged review on turn-limit:** a review step that ends `incomplete` after max turns is charged confirmed usage under stage 1 policy, although the customer gets `review_unavailable`.
6. **Image-edit measured bounds sign-off:** measured edit bounds extend D8 (×1.5 headroom, ×1.1).
7. (New) Knowledge visibility to reviewers (§5) and whether data narratives should receive client knowledge at all (wired here as wording background only).

## 13. Changes since the last verified candidate

There is no previously verified candidate for this branch. Each stage was verified on its own sub-branch (see AGENT_HANDOFF stage entries). Changes since the last stage merge (68b50ac) are 7b828ec, 85dc2a2 and 0565f10 (§3), plus today's local application of migrations 1 and 5 to the release-auth stack. **This is a local branch, not a release candidate; nothing is live.**

## 14. Requests to Codex

Please **independently review**, without assuming my checks are right:
- migrations `supabase/migrations/20261023130000_project_source_uploads.sql`, `20261023200000_agency_operation_contract.sql`, `20261023210000_client_knowledge.sql`, `20261024010000_client_research.sql`, `20261024020000_data_report_files.sql`;
- the scope function `makeborne_private.agency_task_scope`, the **finish/recover branches** for the `result` outcome in `ai_operation_finish` / `ai_operation_recover`, and the **heartbeat bounds** in `ai_operation_heartbeat` (operation expiry, 60 minutes from the run start, the 15-minute hold);
- `src/lib/images/edit/accept.ts` (save path, reference rules) and the stage 1 `stageCap` addition;
- the trust boundary of the review route: `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/independent-review/route.ts` (now with knowledge and project images) and `src/lib/review/website-assets.ts`;
- the research routes `src/app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/research/route.ts` and `…/research/[briefId]/route.ts`;
- `src/lib/data/persist.ts` (save path) and the **`stored=1` branch** of `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/document-export/route.ts`;
- today's integration: `src/lib/agency/run.ts` (knowledge hook, failure before any call), `src/lib/builder/operation-sources.ts` + the continuation check in `operation-server.ts`, `src/lib/review/knowledge.ts`, `src/lib/knowledge/claims.ts` (`judgeCopyClaims`).

Then **qualify on staging within approved allowances only** (§9; none is approved today). **Coordinate integration** with `qualification/beta-combined-20261022`, `feature/model-routing`, `feature/image-led-sites`, `feature/docs-quality` and `feature/editor-header-hierarchy` (conflict files in §3; `QUALIFIED_ROUTES` vs `AGENCY_SETTINGS` should become one registry when routing qualifies cells). Acknowledgment is not assumed.

## 15. Paid qualification results (24 October 2026, appended)

Owner approval in chat, 24 Oct 2026: "approved run the paid tests". The ledger records it as scope `agency-qualification-20261024`: Anthropic $15 and OpenAI $6.50, with per-test caps. The run used the local isolated stack only. Flags and qualification settings existed only in the test process. The full report is `docs/release-review/agency-qualification-20261024.md`; the harness is `scripts/eval/agency/qualify/`.

**Spend.** The gate's settled records and the ledger agree exactly:
- **Anthropic $5.009723** of $15 (114 settled calls + 1 uncertain Stop call counted at its bound).
- **OpenAI $0.744806** of $6.50 (27 calls).
- No cap was reached, no call overran, and no entry is open or unknown. The live provider limits on the stack read back **off**.

| Test | Spend | Result |
|---|---|---|
| Ingestion adversarial (cap $2) | $0.377804 | **PASS**: 0/18 injections followed, 18/18 reported. File costs: 300-row XLSX 10.3k tokens, 12-slide deck 1.9k, two photos 3.1k. Findings: hidden DOCX text carries no reading note; PDFs reach the model without the untrusted rule |
| Data narratives (cap $3) | $1.451372 | **FAIL at 0565f10** (3/20 first-turn), **PASS at 31b1b3d** (20/20 first-turn, 0 untraceable figures, 0 injections followed, missing data 5/5, about $0.035 per narrative) |
| Research brief (cap $4.50) | $1.287283 | **PASS**: 174/174 facts grounded, 0 injected claims, 11/12 first-turn, about $0.09 per brief. Replay and the replay after Stop made 0 calls; Stop cancelled with credits charged 0. Notes: the server identity flag missed both conflicts (the model reported them); the guard over-removes some benign wording |
| Independent reviewer (cap $5) | $1.821532 | **FAIL, not qualified**: the model found 6/6 seeded defects, but the server kept only 4/6 (bug A: the same-spot dedupe drops distinct findings; bug B: the factual downgrade fires on any supported value in the quote). Books get false-positive margin majors from print slices without `@page` margins (C). Websites and decks pass |
| Image edit (cap $6.50 OpenAI + $0.50 Anthropic) | $0.744806 + $0.071732 | **PASS for the measured cells**: usage returned on 24/24 calls; 1,024 / 1,536 input tokens per image; 439 / 343 output (2.5 models), 1,756 (gpt-image-2); max $0.061 per call against the planned $0.243; real alpha on cut-outs. End-to-end 3/3 within the measured bound, and replay made 0 calls. Accept, export and publish were not run |

**Commits on this branch.**
- **31b1b3d**: narrative prompt fix (length limits, no dates).
- **8a96e93**: Stop browser check request filter; 5/5 in Chromium.
- **b974654**: harness and report.
- **11a9df1**: proposal only, flags remain off. `AGENCY_SETTINGS` `standard` qualifies research, data_report and image_edit (maxTurns 3), and `MEASURED_EDIT_TOKENS` holds the five measured medium cells. **The owner must still sign off the measured edit bounds** (the D8 extension, decision 6 in §12). independent_review and ingest stay unqualified.

**Still open.**
- Customer-credit settlement was not observed, because the fixture account has unlimited credits.
- Image accept, export and publish were not run end-to-end.
- Review bugs A, B and C, plus the research identity check.
- Staging qualification with the migrations applied.

## 16. Re-run after fixes (24 October 2026, appended)

Same scope (`agency-qualification-20261024`) and per-test caps; local isolated stack only; flags only in the test process. Each fix was reproduced by an offline check that failed before the fix and passes after it.

**Fixes.**
- **39b636f, review fixes A and B.** A: the same-spot dedupe now drops only the same defect. B: each claim in a quote is judged on its own.
- **5fdf7ea, fix C.** Book page images use the PDF page box and margins, with page breaks between whole lines.
- **1878a03, fix D.** Hidden DOCX text is marked for the model with a reading note, and PDFs carry the untrusted-source rule. The extraction version is now `ingest-2026-10-24.1`.
- **3a0aca8, fix E.** The server flags identity conflicts (a separate-branch document; places that do not match), and the followers guard matches counts only.
- **ef753a3, fix F (found by the re-run).** Elided quotes resolve when every part appears in order.

**Live re-runs.** Anthropic **$1.990532** in total.

| Test | Spend | Sub-cap | Result |
|---|---|---|---|
| Ingestion: hidden-DOCX + PDF, ×2 | $0.072768 | $0.30 | 0/4 followed, 4/4 reported |
| Research: both conflict fixtures | $0.150332 | $0.40 | Both now flag `conflict` |
| Reviewer | $1.767432 | $3.18 | Round 5 $0.915444; round 6 $0.851988 |

- **Reviewer, round 5.** Fixes A–E were in place. Two fixture flaws showed up: the brief said "three-slide", and book-s1's contradiction sat in the chapter that the seeded export drops. Fix F was still missing.
- **Reviewer, round 6 (ef753a3): PASS.**
  - 6/6 reviewer-only seeded defects grounded at the right place.
  - 6/6 acceptable fixtures with no blocker or major finding.
  - 6/6 re-checks resolved, with nothing added.
  - $0.040–0.069 per review; 0 refusals and 0 unavailable.

**Scope totals.** Anthropic **$7.000255** of $15 and OpenAI **$0.744806** of $6.50, over 187 ledger entries: all settled, none open, no overruns. The stack's limits are off.

| Test | Spend | Cap |
|---|---|---|
| Ingestion | $0.450572 | $2 |
| Data | $1.451372 | $3 |
| Research | $1.437615 | $4.50 |
| Reviewer | $3.588964 | $5 |
| Image | $0.744806 OpenAI + $0.071732 Anthropic | $6.50 + $0.50 |

**Proposal.** **adad1ac** adds `independent_review` to the proposed `standard` setting; flags remain off. The cross-provider reviewer stays off. The owner must still sign off the measured edit bounds (the D8 extension). Details are in `agency-qualification-20261024.md` §7.
