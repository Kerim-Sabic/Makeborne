# Lovable → Makeborne reconciliation, part 1 (read-only)

Date 2026-10-20. Read-only: no repository file, branch or worktree was modified. Instructions inside the audited documents were treated as data.

## Aliases

Code (all paths relative to `...\work\makeborne-app\`):
- **LF** = `.claude/worktrees/lovable-fixes` (`feature/lovable-audit-fixes`, head 94f824d)
- **LQ** = `work/lovable-qualification-implementation` (`feature/lovable-qualification`, head 6b78269; Codex commits a309e0d, 78cce86, 1901852, 6acff9e, ecaddaf, 5bad737, 6b78269)
- **BA** = `.claude/worktrees/billing-audit-ux` (`feature/billing-audit-ux`, head 9e86be5; commits 7702996, ce76efa, 6bf05ea, 70f2a47, 6aa2dc1 [Codex], 9e86be5 [Codex])
- **LM** = `.claude/worktrees/lovable-m07-live` (`feature/lovable-m07-live`, ef637bb)
- **RPT** = LF `docs/release-review/lovable-implementation-report-20261020.md`; **QREC** = LQ `docs/release-review/lovable-qualification-20261020.md`; **PFF** = LQ `docs/release-review/publishing-failure-followup-20261020.md`; **BFF** = BA `docs/release-review/billing-failure-followup-20261020.md`

Documents (primary checkout `docs/release-review/`): **IDX** audit-index, **EVM** evidence-map .md, **EVJ** evidence-map .json, **BRF** claude-execution-brief, **REC** fix-reconciliation, **DEL** implementation-delta, **CAP** capability-states, **EFF** effort-cost-contract, **PDM** pricing-decision-model, **PRF** pricing-forensics.

Kinds: **gap** = gap-to-fix; **pres** = preserve-existing; **lov** = Lovable-only observation (no Makeborne action); **own** = owner decision; **qual** = qualification-only.
Statuses: Fixed / In progress / Codex task / Preserved / **NOT COVERED** / N/A (as defined in the task). "Fixed" rows were verified in source at the cited file:line.

Active slices treated as In progress: **M06** (real library previews), **M08** (exact edit target/revision, pending state, Undo, saved-plan-bound approval, no duplicate charge), **M10** (preview route/fragment/scroll/Back-Forward/missing-page recovery; distinct Revise/Continue/Recover/Restore/Stop), **M17** (permission/role/asset scopes, portal/review audiences, preferred-domain canonical policy).

---

## A. IDX — interaction coverage register (all 98 rows, IDX lines 95–192)

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| A01 | Prompt + Build/Plan/Chat mode selection | IDX register "New project / Prompt…" | lov | N/A | Lovable mode observation; Makeborne has its own Create/Plan modes | — |
| A02 | Multi-file upload/preview/reading; repeated Reference duplicates chips | IDX "Attachments / Multi-file" | gap (dedup) + lov | Fixed (dedup) | 732e14f/6eeea77: duplicates sent once; LF `src/lib/builder/source-readiness.ts:99` (`decideSources`, `duplicateOf`); LQ `src/lib/builder/source-readiness.ts:140` filters `duplicateOf` | Native Office/CSV ingestion is an optional extension (BRF "Optional extensions"), not done |
| A03 | Fresh facts vs embedded instructions in uploaded files | IDX "Attachments / Fresh facts versus embedded instructions" | qual | Codex task (done) | QREC "Sources": real planner used PDF facts, found tail fact, ignored embedded instruction (two fixtures) | Not a general injection qualification (stated in QREC) |
| A04 | Provider import / ZIP round trip | IDX "New project / Import providers and ZIP" | lov (optional ext) | N/A | BRF follow-up: source import is optional, not launch | — |
| A05 | Design-system role / release gate | IDX "New project / Design-system role" | lov | N/A | BRF: keep identity/direction/code-package reuse separate; no release manager needed | Preserve brand kits (see C-section) |
| A06 | Cross-project context chip | IDX "New project / Cross-project context chip" | lov | N/A | Observation only | — |
| A07 | Database connection choice / Cloud provisioning | IDX "New project / Database connection choice" | lov | N/A | BRF "Cloud follow-up": does not authorize a Makeborne backend platform | — |
| A08 | Recent/starred/shared/visits/templates | IDX "Library / Recent, starred…" | lov | N/A | Navigation states only | — |
| A09 | Real previews; project menu availability follows publish state | IDX "Library / Real previews and project menu" | gap | In progress (M06) | RPT M06 "Not started" on 94f824d; active slice M06 | Card publish/live state is part of DEL §1 contract; confirm M06 includes it (see B16) |
| A10 | Grid/list + sort, layout persists on reload | IDX "Library / Grid/list and sort" | gap (DEL §1 "Offer compact list view") | **NOT COVERED** | LF `src/components/account-projects.tsx:174` renders only `account-project-grid`; no list view or sort control | Optional-ish but stated in DEL §1 contract |
| A11 | Owner/folder/visibility/status/star filters | IDX "Library / Owner/folder/…"; IDX "library folders" follow-up ("enhance recognizable/client-filtered library") | gap | **NOT COVERED** | Only format filters exist (LF `src/app/studio-refresh.css:457` `.filter-tabs`); no client or live/draft filter | Client filter / status filter not in any slice |
| A12 | Search beyond title, empty result, Clear filters also clears q | IDX "Library / Search…"; DEL §2 "no-match gives Clear search" | gap | Fixed (search) / **NOT COVERED** (Clear) | 853fac1+a148f84: LF `src/lib/projects/title-search.ts:1-30`, `account-projects.tsx:114-180`; LQ 1901852 ACL `supabase/migrations/20261020144714_artifact_title_search_acl.sql`; staging 50+11 pages, 404/409 (QREC) | No "Clear search" action on no-match (grep "Clear" in account-projects/studio: none). DEL §2 acceptance explicitly asks for it |
| A13 | Copy project vs published link | IDX "Library / Copy project…" | lov | N/A | Observation | — |
| A14 | Bulk selection / move / transfer / delete | IDX "Library / Bulk selection" | lov | N/A | Not a Makeborne requirement | — |
| A15 | Same project retained through Preview/Code/Files | IDX "Editor / Preview/Code/Files/More" | gap (IDX P1-8) | In progress (M10) | Active M10 (route/scroll) | Selection/scroll across settings/history is broader than "preview route" — confirm M10 covers history/settings round-trip |
| A16 | Global command search; shortcut scope; Last edited includes chat | IDX "Editor / Global command search" | lov + gap (palette) | Fixed (palette, see A90) | — | M04 activity-vs-source distinction: see A71/C04 |
| A17 | Keyboard bypass into active task (F12) | IDX "Editor / Keyboard bypass" | gap | Fixed | c5f51f6, 2db34d4: LF `src/components/studio.tsx:667` skip links, `:776`/`:793` `<main id="studio-content">`; `src/lib/studio-skip-links.ts:9-16` | — |
| A18 | Page selector, route history, fragments, missing path 404 with root title, unsent demo form lost | IDX "Editor / Page selector…" | gap | In progress (M10) | Active M10 slice | — |
| A19 | Whole-editor 375/800 px; Makeborne first phone project card below 931 px | IDX "Editor / Desktop/mobile preview"; BRF follow-up "prioritize its first phone project card below931px" | gap | Fixed (M03) | d88381a: LF `src/lib/projects/library-state.ts:62-63` `libraryLayout`, `studio.tsx:559` | RPT measured 1366×768 only (805→429 px); phone position not re-measured in RPT |
| A20 | 320 px reflow (F10) + drawer focus (F11) | IDX "Layout / 320px…" | gap | Fixed | See C22/C23 | — |
| A21 | Source filename/content search, in-file Find (M12) | IDX "Editor / Source filename…"; IDX source-navigation follow-up | gap (optional X) | **NOT COVERED** (deferred) | RPT "M11, M12, M14 Not changed — Optional; reviewed only" | Owner decision whether M12 is wanted |
| A22 | Element selection/context | IDX "Editor / Element selection" | pres | Preserved (not re-verified line-by-line) | Existing visual editing; not touched by fixes | — |
| A23 | Literal inline text edit, 0 credits | IDX "Editor / Literal inline text edit"; IDX P1-9 | gap | In progress (M08) | Active M08 (target/pending/Undo) | — |
| A24 | Draw/comment tools | IDX "Editor / Draw/comment" | lov (optional) | N/A | IDX follow-up: "Extend existing visual-selection/context contracts if useful" | — |
| A25 | Toolbar minimization/options | IDX "Editor / Toolbar…" | lov | N/A | — | — |
| A26 | Working state / tool progress | IDX "Agent / Working state" | lov | N/A | — | — |
| A27 | Structured briefing questions (F04) and "known facts not asked again" | IDX "Agent / Structured briefing"; BRF M08 row | gap | Fixed (F04); Preserved (known facts) | 833d4a3: LF `src/components/brief-questions-card.tsx:33-41`; existing `src/lib/builder/brief-questions.ts:3` ("asked only when the brief doesn't already…") | — |
| A28 | Stop | IDX "Agent / Stop"; IDX "Codex active Stop" | gap | Codex task (C1, done) | 6acff9e, ecaddaf: LQ `src/components/live-builder.tsx:647-655`, `src/components/use-builder-operation.ts:130`, `src/app/api/build/operations/route.ts:20` (DELETE), migrations `20261020174011_ai_operation_cancellation.sql`, `20261020183417_ai_operation_cancel_compatibility.sql` | Staged Stop used exempt admin (QREC); paid-customer staging Stop not run |
| A29 | Invalid saved source + restore; free-repair entry | IDX "Recovery / Invalid saved source" | gap | In progress (M10 Recover/Restore) | — | — |
| A30 | Queue vs steering; Repeat | IDX "Agent / Queue versus steering"; BRF "In-progress instruction follow-up" | gap (M10 semantics) + optional ext | In progress (M10) / NOT COVERED (unsent-text-while-busy, optional) | Live-builder still disables entry while busy | BRF calls safe unsent text preparation "smaller and separable"; optional |
| A31 | Edit historical message / Revert and resend | IDX "Recovery / Edit historical message"; IDX/BRF "historical-message resend boundary" | gap | In progress (M10) | Active M10 (distinct Revise/Continue/Recover/Restore) | — |
| A32 | Project monitoring / background spend | IDX "Agent / Project monitoring"; IDX monitoring follow-up | own (optional) | N/A | "optional bounded recurring reviews … not a new launch feature" | — |
| A33 | Persistent Goal preflight | IDX "Agent / Persistent Goal"; PRF "Persistent goals" | lov (no Makeborne goals) | N/A | PRF: only "if persistent work/delegation is later added" | — |
| A34 | Delegated research | IDX "Agent / Delegated research" | lov | N/A | Documentary only | — |
| A35 | Plan without changing website | IDX "Plan / Plan without changing website" | pres | Preserved | Plan runs are separate operations (LQ `src/lib/builder/plan-run.ts` touched only for Stop settlement) | Not re-qualified |
| A36 | Plan edit/Save lost (Lovable); Makeborne must bind approval to saved plan, test reconnect/repeat-save | IDX "Plan / Review, edit and Save"; IDX P0-4 | gap | In progress (M08 saved-plan-bound approval) | RPT M08: "plan-approval binding were not changed" on 94f824d | — |
| A37 | Plan approve/build | IDX "Plan / Approve/build" | lov | N/A | — | — |
| A38 | Bookmarks / origin-message navigation (M11) | IDX "History / Originating turn…" | gap (optional X) | **NOT COVERED** (deferred) | RPT M11 "Not changed" | Owner decision |
| A39 | Undo/snapshot/restore | IDX "History / Undo, snapshot, restore" | pres + gap (restore copy) | Preserved + Fixed (copy) | fc1ce75: restore says it saves a new version and does not change live site (commit msg); LF `src/components/cloud-studio.tsx:39` `prepareVersionRestore` | — |
| A40 | Draft create/update/accept/Undo, automatic conflict choice | IDX "History / Draft…"; BRF conflict follow-up | pres | Preserved | LF `src/lib/cloud/contracts.ts:48` `expectedVersion`; portal base-hash route `src/app/api/portal/sites/[artifactId]/draft/route.ts` | — |
| A41 | Generated PDF/PPTX cards are real files | IDX "Files / Generated PDF/PPTX cards" | lov | N/A | — | — |
| A42 | Viewer / metadata / download | IDX "Files / Viewer…" | lov | N/A | — | — |
| A43 | Add to chat / gallery search excludes sources | IDX "Files / Add to chat…" | pres (source/output distinction) | Preserved | M09 keeps source vs output; dedup fixed (A02) | — |
| A44 | PDF dimensions/text/rendering | IDX "PDF" row | qual | Codex task (C4, partly done) | QREC "Exports": cloud book PDF 11 pp 6×9 in, rasterized and inspected | Regional-glyph review still listed as remaining (QREC "Still required") |
| A45 | PPTX native shapes/assets | IDX "PPTX" row | qual | Codex task (C4, partly done) | QREC: five 16:9 slides, native text, one native chart, five notes parts | — |
| A46 | Real PowerPoint manual edit | IDX "Exports / Actual Microsoft PowerPoint" | qual | Codex task (C4, open) | QREC/PFF/BFF: native Windows/macOS Office still pending | — |
| A47 | Templates gallery | IDX "Templates" | lov | N/A | — | — |
| A48 | Interactive deck: focused slider Right advances slide | IDX "Presentations / Public interactive starter"; DEL §6 | gap (Makeborne presenter) | Fixed | 3bbf817: LF `src/lib/documents/presenter-keys.ts:15-17` (`[role='slider']` in control/key-widget selectors), `document-preview.tsx:44` | — |
| A49 | Project collaborators / roles | IDX "Sharing / Project collaborators" | gap | In progress (M17) | — | — |
| A50 | Shared preview + review feedback; anonymous/other-role denial unqualified | IDX "Sharing / Shared preview…" | gap/qual | In progress (M17 portal/review audiences) | — | — |
| A51 | Explicit publish boundary | IDX "Publishing / Public publish and explicit update" | pres + gap | Preserved + Fixed (M07) | fc1ce75: LF `src/lib/hosting/checked-version.ts:9-22`; consent bound to reviewed version | — |
| A52 | HTTPS / routes / assets | IDX "Publishing / HTTPS/routes/assets" | gap/qual | Fixed (F05) + Codex task (C2 done) | 669a57d LF `infra/customer-sites/_worker.js:83-96`; 78cce86 LQ `_worker.js:170` (`immutableSiteFile`), `site-policy.js:124,132-139` (`max-age=0, must-revalidate`); staged Worker on QA hosts (QREC) | Production Worker deploy owner-gated |
| A53 | Real form delivery / custom domain | IDX "Publishing / Real form delivery" | qual | Codex task (form done; domain C7 open) | QREC "Staging app": real phone form → Worker → inbox → CRM lead | Custom domain activation (C7) not qualified |
| A54 | General identity / project role | IDX "Settings / General…" | lov | N/A | — | — |
| A55 | Preview/publish/security toggles | IDX "Settings / Preview/publish…" | lov | N/A | — | — |
| A56 | GitHub/GitLab/Bitbucket/ZIP | IDX "Settings / GitHub…" | pres | Preserved | LF `src/lib/github/check-github-renewal.cjs:76-89` (refresh CAS harness) | — |
| A57 | Domains/search/connect; 64-char pre-submit gap (Lovable) | IDX "Settings / Domains…"; IDX domain follow-up | pres + gap (F07) | Preserved + Fixed | Slug 3–48: LF `src/lib/projects/publication-contract.ts:8`; F07 see C26 | — |
| A58 | Knowledge & skills; context provenance | IDX "Settings / Knowledge and skills"; IDX "reusable workflow/context review" | gap (X) | **NOT COVERED** | No change found for "explainable, version-bound context provenance under M08/M09/M13/M14/M17/M18" | Recommendation, not a launch blocker |
| A59 | Workspace people / roles | IDX "Workspace / People…" | gap | In progress (M17) | — | — |
| A60 | Groups / identity / announcements | IDX "Workspace / Groups…" | lov | N/A | Business-gated | — |
| A61 | Registry / build secrets | IDX "Workspace / Registry…" | lov | N/A | Enterprise-gated | — |
| A62 | Connector catalogue vs configured backend | IDX "Workspace / Connector catalogue"; IDX "connector identity" | gap | In progress (M17) | M17 permission scopes | Confirm M17 explicitly includes "distinguish sign-in, mail access, repository access, project unlink, local disconnect and provider revoke" |
| A63 | MCP / API keys / OAuth apps | IDX "Workspace / MCP…" | lov | N/A | — | — |
| A64 | Agent permissions (account-wide policy) | IDX "Account / Preferences and agent permissions"; IDX "permission-review continuation" | gap | In progress (M17) | "inspectable scope/grant/revoke explanation under M17" | Same scope confirmation as A62 |
| A65 | Security / 2FA | IDX "Account / Security/2FA" | lov | N/A | — | — |
| A66 | Devices & Apps / Slack | IDX "Account / Devices…" | lov | N/A | — | — |
| A67 | Monthly/yearly quotes; Makeborne shows exact annual total | IDX "Billing / Monthly/yearly…"; IDX phone-billing follow-up | pres | Preserved | LF `src/components/creation-plans.tsx:90` ("billed once a year") | — |
| A68 | One-off / automatic pack matrix | IDX "Billing / One-off/automatic pack matrix" | lov | N/A | PDM: do not copy complexity | — |
| A69 | Gift/invoice value vs credit packs | IDX "Billing / Gift…"; PRF "Gift value" | lov | N/A | PRF: "does not recommend adding gift cards to launch" | — |
| A70 | Auto amount/threshold/cap/consent | IDX "Billing / Auto amount…" | gap | Fixed (panel) | 7702996, 6aa2dc1: BA `src/components/billing-autotopup.tsx:80,98-105`; `src/lib/billing/autotopup.ts:41-57` | Charging unimplemented; activation qualification separate |
| A71 | Balance breakdown / receipts / project cost; meter vs coverage vs debit | IDX "Billing / Balance breakdown…" | gap (M15) | Partly Fixed (F08) / **NOT COVERED** (parent/child items, funding reason) | F08 history see C25 | PRF "Makeborne acceptance implication (M15 and M18)" parent+child items with covered amount / funding reason: not implemented |
| A72 | Run/build grants + usage filters; date/chart reset on reload | IDX "Billing / Run/build grants…" | gap | Fixed (F08) | BA `src/components/billing-workspace.tsx:19` period+cursor in URL (`?usage=YYYY-MM&usageBefore=`), `:73` month nav | Grants/expiry rows excluded and labelled (BA `src/lib/billing/view.ts:70`) |
| A73 | Spend limits vs balance notifications | IDX "Billing / Spend limits…"; PRF §7 | own/qual | **NOT COVERED** | No customer alert/usage-limit features exist; PRF says test auto-top-up vs usage-limit interaction explicitly | Activation-time qualification; owner decision whether to add alerts/limits |
| A74 | Expiry / rollover / cancellation rules | IDX "Billing / Expiry…"; PRF lifecycle B/C | qual | Codex task (partial) | BFF: SQL suites for expiry, rollover, annual allocations, refunds | Policy matrix shown to customers (lot types) and pending-plan/effective-date UI not covered (see J rows) |
| A75 | Tax / invoice / refund / renewal / auto charge | IDX "Billing / Tax…" | qual | Codex task (partial) | BFF: webhook route + sandbox reads; PFF "Remaining release gates": fresh provider-signed checkout/refund/renewal still open | Release gate |
| A76 | Database/Users/Storage enablement | IDX "Services / Database…" | lov | N/A | — | — |
| A77 | Payments service | IDX "Services / Payments" | lov | N/A | — | — |
| A78 | Emails (app mail vs CRM mailbox) | IDX "Services / Emails"; CAP | gap | Fixed | de8fca0: LF `src/lib/mail/connected-message.ts:9-22` | — |
| A79 | AI/backend runtime | IDX "Services / AI/backend runtime" | lov | N/A | — | — |
| A80 | Security scans green while dependency findings remain | IDX "Security / Quick/deep scan"; BRF §5 | pres/qual | Preserved (scope copy) | LF `src/components/client-ready-check.tsx:19,32,42` ("No issues found by these checks", not a full review) | — |
| A81 | SEO findings, no generic Fix all | IDX "SEO / Findings…"; IDX P2-13 | gap | Fixed (F06) | See C24 | No Makeborne "Fix all" found; demo-label/fix-all behaviour not re-audited |
| A82 | Analytics | IDX "Analytics" | pres | Preserved | LF `src/lib/telemetry/client.ts:26-27` (GPC/DNT) | — |
| A83 | Generated mobile menu / route focus | IDX "Generated site / Mobile menu"; IDX generated-navigation follow-up ("add deliberate route-focus tests to M16") | qual | **NOT COVERED** | Prompt contract preserved (LF `src/lib/builder/prompt.ts:110,139`); no route-focus qualification/test found | — |
| A84 | No-preset direction + narrow repair (393 px overflow, CTA contrast) | IDX "Generated site / Independent no-preset…"; IDX no-preset + repair follow-ups | qual | **NOT COVERED** | No "actual geometry/contrast/claim provenance qualification" or version-bound scoped repair with cumulative cost found | — |
| A85 | Font delivery & regional coverage | IDX "Typography" row; IDX font follow-up | gap/qual | Fixed + Codex task (C4) | dea20e9/0d58d4d/31ddf31: LF `src/lib/builder/fonts.ts:21-24` (latin-ext); QREC C4 17 portability groups, cloud renderer fonts | Arabic/Cyrillic/CJK still uncovered by design; regional-glyph export review open (QREC) |
| A86 | Generated form invalid/success focus & error attributes | IDX "Generated site / Empty/invalid form"; BRF M16 "useful errors/focus" | gap | **NOT COVERED** | LF `src/lib/builder/prompt.ts:139` requires labelled fields only; no aria-invalid/error-description/focus-on-error contract (grep found none) | — |
| A87 | Compile-only probe; receipts name each check actually run | IDX "Generated site / Final-revision compile-only"; BRF §5 | pres | Preserved | LF `src/lib/builder/run-receipt.ts:3-5,37` (checks list from what ran) | — |
| A88 | Makeborne estimate provenance + cumulative settlement | IDX "Makeborne / Estimate provenance" | pres | Preserved | LF `supabase/migrations/20261013150000_cumulative_ai_operations.sql:289`; `src/components/billing-credit-costs.tsx:7,42` | — |
| A89 | Current implementation comparison | IDX "Makeborne / Current implementation comparison" | bookkeeping | N/A | Baseline record | — |
| A90 | Client palette stale selection / error-as-empty (F03) | IDX "Makeborne / Client palette" | gap | Fixed | b79789a: LF `src/lib/cloud/palette-search.ts:13-23`; `src/components/client-command-palette.tsx:85-86` (Retry) | — |
| A91 | Presenter keyboard routing (F14) | IDX "Makeborne / Presenter…" | gap | Fixed | See C35 | Real renderer + fullscreen qualification still separate |
| A92 | Client-ready parser failure + coverage limit (F13) | IDX "Makeborne / Client-ready parser…" | gap | Fixed | See C34 | — |
| A93 | Final briefing Skip payload (F04) | IDX "Makeborne / Final briefing-question Skip" | gap | Fixed | See C21 | — |
| A94 | Preview transport reconnection: distinguish from failed build, retry without regenerating, confirm content returns | IDX "Recovery / Actual preview transport reconnection"; CAP "Actual lost-preview recovery" | gap/qual | **NOT COVERED** | Only existing manual "Reload preview" (LF `src/components/live-preview.tsx:194`); no lost-connection state distinct from build failure | Not in M10 slice wording (route/fragment/scroll); confirm or add |
| A95 | Disconnected email explanation | IDX "Services / Disconnected email" | gap | Fixed | de8fca0 (A78) | — |
| A96 | Provider-rate freshness; stale doc notes | IDX "Billing / Current provider-rate freshness"; PRF "Provider price freshness" | gap (doc) | **NOT COVERED** | LF `src/lib/ai/prices.ts:103-105` still says "half a cent" for +0.0005 (0.05 cent); `:82` "Not live-qualified (no OpenAI key)" contradicts saved Image 2 qualification; `:90` "OpenAI publishes no per-image price … for 2.5" now stale | Doc-only; keep 2.5 refused |
| A97 | Top-up revoke hidden when price null; no inline retry | IDX "Makeborne / Top-up authorization control" | gap | Fixed | See E01/E02 | — |
| A98 | Plan no-fit recommends High as Best fit | IDX "Makeborne / Effort settings and Plan no-fit" | gap | Fixed (no-fit) / **NOT COVERED** (ceiling) | f742ad9: LF `src/lib/builder/plan.ts:131` `effortFit`; `src/components/plan-card.tsx:152,156` | Plan footer still shows only `~min–max` formula (plan-card.tsx Build button), no hard ceiling — see H02 |

## B. IDX — other sections

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| B01 | 18 paused Lovable instructions; permanent queue cleanup awaits owner | IDX header "Current safety and budget"; PRF "Latest safety checkpoint" | own (Lovable account) | N/A (not Makeborne) | — | Owner still has to decide Clear queue in Lovable |
| B02 | No further credit-consuming Lovable research authorized | IDX header; BRF "Current verified checkpoint" | bookkeeping | N/A | RPT: "no Lovable credit was spent" | — |
| B03 | Effort/estimate semantics paragraph | IDX "Effort and estimate semantics" | gap | see H01–H07 | — | — |
| B04 | Branch reconciliation / top-up | IDX "Branch reconciliation…" | gap | see E-section | — | — |
| B05 | Capability-state follow-up | IDX "Capability-state…" | gap | see G-section | — | — |
| B06 | Image qualification scope; production image readiness unqualified | IDX "Current pricing and image qualification scope" | qual | **NOT COVERED** (gate) | QREC/PFF: "No OpenAI image key; … images remain unqualified" | Owner-gated activation |
| B07 | Nested-page indexing P1 | IDX "New high-priority finding" | gap | Fixed (F05) | C23 | Deployed candidate qualification owner-gated |
| B08 | Historical checkpoints / funding reconciliation / read-in-order list | IDX lines 27–79, 244–284 | bookkeeping | N/A | Dated evidence history | — |
| B09 | Main conclusion: make editing/versions/recovery/publishing work together; don't replicate menus | IDX "Main conclusion" | design principle | N/A (guidance) | Followed by slice ordering | — |
| B10 | Remaining proof: payment lifecycle / net charges | IDX "Completion boundaries" row 1 | qual | Codex task (partial) | BFF/PFF remaining gate: fresh provider-signed checkout/refund/renewal | — |
| B11 | Remaining proof: collaborator/anonymous roles | IDX "Completion boundaries" row 2 | qual | In progress (M17) | — | Needs separate-session tests |
| B12 | Remaining proof: cross-provider import | IDX "Completion boundaries" row 3 | lov | N/A | Optional | — |
| B13 | Remaining proof: custom domain + mail/form delivery | IDX "Completion boundaries" row 4 | qual | Codex task (C7 open; form done) | QREC public form→CRM | Domains not qualified |
| B14 | Remaining proof: generated quality across industries (matched briefs, blind rating) | IDX "Completion boundaries" row 5; IDX "Evidence that would establish improvement" | own/qual | **NOT COVERED** | Needs separate budget/authorization | Owner decision |
| B15 | Remaining proof: physical phone keyboard, screen reader, reduced motion, frame/load | IDX "Completion boundaries" row 6 | qual | **NOT COVERED** | RPT: viewport/AX only | — |
| B16 | Remaining proof: long-running failure/restart, ambiguous external outcome | IDX "Completion boundaries" row 7 | qual | Codex task (partial) | C1 races + PFF ambiguous cloud create/restart | Exactly-once external effects (mail/payment) not covered |
| B17 | Remaining proof: enterprise/workspace policy | IDX "Completion boundaries" row 8 | lov | N/A | Gated | — |
| B18 | Remaining proof: improvement claims need reviewed implementation + release gates | IDX "Completion boundaries" row 9 | qual | Codex task (M18) | Draft PRs #9/#10/#11 (QREC "Final qualification checkpoint") | No merge/production approval yet |
| B19 | P0-1 finish publishing/billing qualification gates | IDX "What to change" P0-1 | qual | Codex task (partial) | QREC/PFF/BFF | Owner-gated |
| B20 | P0-2 Save/Quality/Publication independent states tied to version IDs | IDX P0-2 | gap | Fixed (M07) | fc1ce75 LF `checked-version.ts:9-22`; ef637bb LM `src/components/use-live-version.ts`, `cloud-studio.tsx:44` | ef637bb is on its own branch (not in LF/LQ heads); rendered-preview version identity not displayed |
| B21 | P0-3 every AI-starting button explicit; show generated instruction before submit for neutral-sounding labels; no hidden recurring AI spend | IDX P0-3 | gap | **NOT COVERED** | No audit/fix commit for AI-starting controls; not in M08 active-slice wording | Needs an audit of AI-starting controls |
| B22 | P0-4 Plan Save durable before approval; recover by operation ID | IDX P0-4 | gap | In progress (M08) + Preserved | Operation-ID recovery: LQ `src/components/use-builder-operation.ts:6-19` (stored action key/id) | — |
| B23 | P0-5 quotes/reservations/measured/receipts/project totals consistent; auto-purchase consent elements | IDX P0-5 | gap | Partly Fixed (F08, C1, top-up) / **NOT COVERED** (project totals) | — | No per-project cost total / drill-down back to artifact (BA billing-workspace has no artifact links) |
| B24 | P1-6 real previews + title/type/client/last edit/saved-live state on cards | IDX P1-6; DEL §1 | gap | In progress (M06 previews) + Fixed (title, saved date) + **NOT COVERED** (client label, live/draft state on card) | 5efe9c8 LF `src/lib/projects/project-labels.ts:15-18`; `account-projects.tsx:174` | Client label and live state not on cards; fold into M06 if intended |
| B25 | P1-7 returning users' work before hero; strong no-results recovery | IDX P1-7 | gap | Fixed (M03) / **NOT COVERED** (no-results Clear) | d88381a | See A12 |
| B26 | P1-8 keep artifact visible while changing tools; preserve route/slide/selection/scroll | IDX P1-8 | gap | In progress (M10) | — | — |
| B27 | P1-9 target→pending→applying→saved→Undo; literal edits not paid rebuild | IDX P1-9 | gap | In progress (M08) | — | — |
| B28 | P1-10 label local vs cloud, agency vs client, unpublished vs crawlable, operator-disabled vs disconnected vs plan-gated | IDX P1-10 | gap | Partly Fixed / In progress (M17) | Library failed-state copy ("Projects on this device are not affected", LF `account-projects.tsx:141`); mail capability copy (de8fca0) | "unpublished vs publicly crawlable" label not found |
| B29 | P2-11 business-specific art direction; styles optional | IDX P2-11 | pres | Preserved (not re-verified) | Existing prompt/brand policy untouched | — |
| B30 | P2-12 real document systems; inspect every page/slide | IDX P2-12 | qual | Codex task (C4 partial) | QREC exports | Native Office open |
| B31 | P2-13 judge quality vs brief; honest demo labels must not trigger destructive fix-all | IDX P2-13 | gap | Fixed (F06 partly) | F06 short-by-design pages get no hint (LF `seo.ts:129,155-158`) | — |
| B32 | P2-14 agency workflow differentiator | IDX P2-14 | design | N/A | Strategy | — |
| B33 | 5-user agency study (find project, saved vs live, edit, cost, recover, publish) | IDX "Evidence that would establish improvement"; DEL "What establishes success"; BRF §4 | own | **NOT COVERED** | Needs authorization to recruit/spend | Owner decision |
| B34 | Index follow-ups: page annotation, history retrieval, design-system lifecycle, cloud | IDX follow-up paragraphs | lov/optional | N/A | "Extend … if useful" | — |
| B35 | Index follow-up: monitoring/privacy — field-minimization, audience/retention clarity into M15/M17/M18 | IDX "Monitoring/privacy follow-up" | gap | **NOT COVERED** | No commit addresses telemetry field minimization or audience/retention copy; GPC/DNT preserved (A82) | — |
| B36 | Index follow-up: limit-form — scope-derived affected-operation/recovery copy into M15/M16 | IDX "Limit-form follow-up"; PRF "Additional limit-form interaction" | gap | **NOT COVERED** | No customer limits exist; daily/provider caps have no affected-operation explanation change | Owner decision if limits are added |
| B37 | Index follow-up: phone billing — role-aware quote/eligibility/availability separation | IDX "Codex phone-billing continuation" | gap | Preserved (partly) | LF `creation-plans.tsx:75` ("Opens at launch"), `:101` availability states; BA admin "Unlimited credits · Administrator allowance" (`billing-workspace.tsx:57`) | Ordinary agency checkout not qualified |
| B38 | Index follow-up: project handoff — exact delivery version, actor authority, excluded client data, integration ownership, recurring cost | IDX "Codex project handoff and recovery review" | gap/qual | **NOT COVERED** (M17 partly) | No handoff/export change; M17 in-progress covers scopes only | Preserve explicit-version source download (not re-verified) |
| B39 | Index follow-up: library folders/upsell — show actual incremental entitlements; preserve privacy on cancellation | IDX "Codex library folders and contextual upsell review" | gap | **NOT COVERED** | No change to plan-comparison entitlement copy | Small copy/policy item |
| B40 | Index follow-up: custom-domain primary-domain canonical/og:url parity (CUSTOM_DOMAINS.md:111) | IDX "Codex custom-domain follow-up" (1) | own/gap | In progress (M17 preferred-domain canonical) | — | — |
| B41 | Index follow-up: SSL validation_timed_out mapping + recovery copy; preserve transient-503 behavior | IDX "Codex custom-domain follow-up" (2) | gap | Fixed | 83b15f7 LF `src/lib/hosting/custom-domains.ts:154-184` | — |

## C. BRF — execution brief

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| C01 | M01 notice names actual Code/Edit control | BRF §2 M01; first-slice M01 | gap | Fixed | 9e1bb5d LF `src/lib/cloud/saved-preview.ts:64` `editorEntry`; `cloud-studio.tsx:1548` | RPT: no fixture renders outline notice in real app; source-checked only |
| C02 | M02 truthful loading/empty/failed + palette | BRF M02 | gap | Fixed | F02 (C20) + F03 (A90) | — |
| C03 | M03 library before hero; explicit New stays prompt-first; deep links unchanged | BRF M03 | gap | Fixed | d88381a LF `library-state.ts:62-63`; `studio.tsx:559` | — |
| C04 | M04 titles never overwritten; short non-sensitive fallback; distinguish chat activity / saved source / rendered preview / published version | BRF M04 | gap | Fixed (titles, saved-source label) / **NOT COVERED** (published version on cards) | 5efe9c8 LF `src/lib/projects/project-title.ts:1-30`; `website-run.ts:29`; `project-labels.ts:1-18` (explicitly says published version is "not part of this listing, so a card does not claim them") | Paid-run title proof: Codex real AI titles (QREC "Real AI": Stillform / The Clear Brief / From Brief to Better Work) |
| C05 | M05 full-scope search, stable pagination, isolation, account races | BRF M05 | gap | Fixed + Codex task (done locally/staging) | 853fac1, a148f84, 1901852 (ACL repair), QREC 5,000-artifact + staging 50+11 | Cloud advisor/perf on large workspaces partly (local 785 ms) |
| C06 | M06 real artifact previews | BRF M06 | gap | In progress | RPT "Not started" | — |
| C07 | M07 saved/rendered/checked/public separation; late results can't publish wrong source; failed publish leaves previous; restore never publishes | BRF M07 | gap/qual | Fixed (local) + Codex task (done) | fc1ce75; ef637bb (LM); PFF "preservation of the previous live output" (SQL) | ef637bb not merged into LF/LQ heads |
| C08 | M08 Skip fix + exact edit target/revision, pending, Undo, saved-plan approval, no duplicate charge; questions optional | BRF M08 | gap | Fixed (F04) + In progress (rest) | 833d4a3 | — |
| C09 | M09 per-file readiness, immutable retry, dedup, no silent truncation | BRF M09 | gap | Fixed (two composers) / **NOT COVERED** (studio creation modal, build-conversation) | 732e14f/6eeea77/a309e0d: LQ `src/components/file-attachments.tsx:122,138`, `source-readiness.ts:140` | LQ `src/components/studio.tsx:1543` and `build-conversation.tsx:87` still render `AttachmentList` without `readiness` (RPT also flags) |
| C10 | M10 320/375 reflow + keyboard context | BRF M10 | gap | Fixed | F10/F11 | — |
| C11 | M10 route/fragment/title/scroll/focus/Back-Forward/missing page | BRF M10 | gap | In progress (M10) | — | — |
| C12 | M10 restore scoped unsent drafts, no dispatch/consent | BRF M10 | gap | Fixed (home/studio) | F09 (C27) | Shared-review reply unsent draft (IDX "Shared-review cleanup") not covered — see C49 |
| C13 | M10 Revise/continue/recover/restore/Stop/queues distinct | BRF M10 | gap | In progress (M10) + Codex (Stop done) | 6acff9e | — |
| C14 | M11 readable comparison / optional retrieval | BRF M11 | gap (X) | **NOT COVERED** (deferred) | RPT "Not changed"; existing compare preserved: LF `src/components/version-compare.tsx:9,49` | Formatted/content view for minified diffs (DEL follow-up) not done |
| C15 | M12 full-source search | BRF M12 | gap (X) | **NOT COVERED** (deferred) | RPT "Not changed" | Owner decision |
| C16 | M13 book/deck export quality, every page/slide | BRF M13 | qual | Codex task (C4 partial) | QREC exports | Native Office + regional glyph review open |
| C17 | M14 advisor→approved brief→build handoff | BRF M14 | gap (X) | **NOT COVERED** (deferred) | RPT "Not changed" | Optional |
| C18 | M15 usage history, receipts, wallet-aware quotes, lot semantics | BRF M15 | gap/qual | Fixed (F08) + Codex (C3) / **NOT COVERED** (funding reason, wallet-aware quotes) | C25 | See J-rows |
| C19 | M16 nested noindex; real forms; errors/focus; HTTP missing route; truthful checks; alt | BRF M16 | gap/qual | Fixed (F05, F06, F13) + Preserved (404) + **NOT COVERED** (form errors/focus) | LF `_worker.js:98` (real 404) | A86 |
| C20 | F02 unknown count vs zero | BRF F02; first-slice M02 | gap | Fixed | 0c26a6f LF `src/lib/projects/library-state.ts:23,43`; `studio.tsx:839`; `account-projects.tsx:141` | — |
| C21 | F04 last Skip | BRF F04 | gap | Fixed | 833d4a3 LF `brief-questions-card.tsx:33-41` | — |
| C22 | F10 320 px format row | BRF F10 | gap | Fixed | f3a9c36 LF `src/app/studio-refresh.css:457` | — |
| C23 | F05 nested pages noindex; preserve staging/local/error noindex | BRF F05 | gap | Fixed + Codex (deploy) | 669a57d LF `infra/customer-sites/_worker.js:83-96` | Production Worker deploy owner-gated |
| C24 | F06 decorative alt vs missing; no 150-word ranking claim | BRF F06; source-corrections rows 2–3 | gap | Fixed | a851e8c LF `src/lib/hosting/seo.ts:103,123-125,147-158` | — |
| C25 | F08 usage history wired, period/pagination, reversals, unknown | BRF F08; PRF "Current Makeborne: an existing data path…" | gap | Fixed + Codex task (C3 done) | ce76efa/6bf05ea BA `src/app/billing/page.tsx:8,22-26`; `src/lib/billing/usage-history-server.ts:15-28`; `src/lib/billing/view.ts:70,83-96` (statement with period/coverage/filters/complete); 9e86be5 scale SQL (100k rows) | Grants/top-ups/expiry not listed (honestly labelled); no link from rows back to artifact |
| C26 | F07 SSL timeout/expiry + nested DNS FQDN | BRF F07; source-corrections row 4 | gap | Fixed + Codex (C7 activation) | 83b15f7 LF `custom-domains.ts:7-8,40-63,154-184`; `website-domains.tsx:11,120-121` | Delegated-zone/apex qualification open (C7) |
| C27 | F09 unsent draft restore; logout/account switch/attachments/quote; never auto-send | BRF F09 | gap | Fixed | f669393 LF `src/lib/unsent-draft.ts:1-14` (no consent/quotes/files stored, never submits), `src/components/use-unsent-draft.ts:45,108-118`, `src/lib/account-local-data.ts:12-13` (sign-out cleanup) | — |
| C28 | F11 drawer focus | BRF F11 | gap | Fixed | c02a4e6 LF `studio.tsx:193-204,721` (inert background); `src/lib/overlay-focus.ts` | — |
| C29 | F12 skip link + main | BRF F12 | gap | Fixed | c5f51f6, 2db34d4 (A17) | — |
| C30 | F01 | BRF F01 | gap | Fixed | = C01 | — |
| C31 | F03 | BRF F03 | gap | Fixed | = A90 | — |
| C32 | F13 contrast coverage limit: describe static scope accurately | BRF "F13 evidence" paragraph | gap | Fixed | LF `client-ready-check.tsx:19,42` | — |
| C33 | F13 note: background-job identity; scan completion ≠ agent completion | BRF "F13 evidence" | pres | N/A (no Makeborne security scan) | — | — |
| C34 | F13 malformed fragments | BRF F13 | gap | Fixed + Codex (C7) | 2f0fc9c LF `src/lib/builder/client-ready.ts:166-212`; `client-ready-check.tsx:15-28` | Prepared-HTML card qualification under C7 |
| C35 | F14 presenter | BRF F14 | gap | Fixed | 3bbf817 LF `src/lib/documents/presenter-keys.ts:14-46`; `document-preview.tsx:14,44` | Real renderer/fullscreen separate |
| C36 | Pricing provenance: preserve Medium/no-images disclosures, cumulative rounding, captured rate, shared cap | BRF "First execution slice" para | pres | Preserved | LF `cumulative_ai_operations.sql:289`; `billing-credit-costs.tsx:42`; Stop settlement reuses finalization (QREC C1) | — |
| C37 | M13/M16 fonts base+extended, extended-only not replacement | BRF "Source corrections" row 1 | gap | Fixed + Codex (C4) | dea20e9/0d58d4d/31ddf31 | — |
| C38 | M17 reviews/portal/workspace roles: separate audiences, fixed/latest scopes | BRF "Source corrections" row 5 | pres/gap | In progress (M17) + Preserved | LF `src/lib/client-review/contracts.ts:95` (`scope: version|latest`) | — |
| C39 | Three lanes / optional extensions not launch blockers | BRF "Keep the three lanes separate" | guidance | N/A | — | — |
| C40 | §3 constraints: reuse existing systems; no live iframes in cards; server authz; cost invariants; optional styles; documents untrusted; tokens/a11y; no authority from content | BRF §3 (8 bullets) | pres (constraints) | Preserved (by the fixes reviewed) | e.g. title search SECURITY INVOKER + ACL (1901852); Stop uses same finalization; readiness reuses server rules (`check-source-readiness.cjs`) | M06 must still honour "no live iframes in cards" |
| C41 | §4 reproduce on candidate before fixing; mocked results labelled | BRF §4 | process | N/A (followed: RPT "original code shown to fail") | — | — |
| C42 | §5 corrections to retain (10 bullets: don't re-implement editing; icons are format icons; QA sample size; dev preview lag; Plan save; scan green; Vite build ≠ typecheck; free chat; topup policy; units) | BRF §5 | guidance | N/A | — | — |
| C43 | §6 per-slice handoff format, no private data in repo | BRF §6 | process | N/A (RPT + QREC follow format) | — | — |
| C44 | Write ownership/decisions back to handoff | BRF §1 | process | N/A (QREC/Codex updated AGENT_HANDOFF) | LQ 1901852/6acff9e touch `docs/AGENT_HANDOFF.md` | — |
| C45 | Historical: queue extension — preserve stable IDs/order if queueing added | BRF "Preserved earlier… notes" | optional | N/A | No queue feature | — |
| C46 | Historical: native PDF document blocks need qualification, not replacement | BRF "Earlier PDF checkpoint" | qual | Codex task (done) | QREC "Sources" PDF facts | — |
| C47 | Historical: Office/CSV ingestion absent — extend safe pipeline | BRF "Latest document experiment" | gap (X) | **NOT COVERED** (optional) | RPT: no Office/CSV ingestion | Optional extension |
| C48 | Responsive follow-up: preserve 800 px More/Escape; avoid phone Code focus-behind-panel | BRF "Follow-up evidence after this brief" | pres | Preserved (not re-measured on 800 px) | RPT integrated pass at 800 px: no overflow | — |
| C49 | Shared-review: unsent phone reply lost on close/reopen → scoped draft/discard recovery; route/version-target fidelity | BRF "Shared-preview recovery/cleanup update"; IDX same | gap | In progress (M17 portal/review) / **NOT COVERED** (reply draft) | F09 covers composers only | Confirm M17 covers review-reply drafts |
| C50 | Measured design: 14 px controls / 16 px entry targets to qualify | BRF "Measured design follow-up" | own/qual | **NOT COVERED** | No typography change | Optional visual decision |
| C51 | Conflict follow-up: exact current/proposed/resolved identity; never auto-overwrite agency-approved text | BRF "Conflict-resolution follow-up" | pres | Preserved | `expectedVersion` (A40) | — |
| C52 | Queue completion boundary: authority decides join vs new request at dispatch | BRF "Queue completion-boundary update" | gap | In progress (M10) | — | — |
| C53 | P2 palette: M04 distinguish source/preview/publish/activity | BRF "Codex P2 research — client palette" | gap | Fixed (activity ≠ saved, labelled) | LF `project-labels.ts:1-12` | Publish/preview time still absent (C04) |
| C54 | Repeat charge: per-item mode snapshot + customer-readable funding reason | BRF "Repeat charge independently reconciled"; PRF "M15 acceptance refinement" | gap | **NOT COVERED** | Usage history has status/source only (BA `src/lib/billing/usage-history.ts:69-71`) | — |
| C55 | Capability-state follow-up: MailCenter success copy | BRF "Capability-state follow-up" | gap | Fixed | de8fca0 | — |
| C56 | Billing follow-up: revoke regardless of offer; distinguish saved consent vs charging; load retry; uncertain outcome | BRF "Billing branch follow-up" | gap | Fixed | 7702996 (E01–E05) | — |
| C57 | Effort follow-up: truthful no-fit; separate formula/measured/authorization | BRF "Effort and estimate contract" | gap | Fixed (no-fit) / **NOT COVERED** (ceiling in Plan) | H01–H07 | — |

## D. EVM / EVJ — evidence map

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| D01–D14 | F01–F14 location rows (report section, proof mode, private artifacts) | EVM "Finding locations"; EVJ `rows[]` | bookkeeping → each F | see C-rows (all 14 Fixed) | F01 C01, F02 C20, F03 A90, F04 C21, F05 C23, F06 C24, F07 C26, F08 C25, F09 C27, F10 C22, F11 C28, F12 C29, F13 C34, F14 C35 | — |
| D15 | Proof-mode caveats: F08 integration gap; F09–F12 UX gaps, not WCAG verdicts | EVM "Location and interpretation" | guidance | N/A | RPT does not claim WCAG passes | — |
| D16 | Frozen copies / Worker hashes match main d14bf30 | EVJ `frozenCopyComparisons`, `workerSourceComparisons` | bookkeeping | N/A | Fingerprints now stale after fixes (expected) | EVJ says regenerate after edits; not required for closure |
| D17 | Private evidence stays local | EVM | process | N/A | RPT: kept in scratchpad/private dirs | — |

## E. REC — fix reconciliation

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| E01 | Render existing authorization + revoke independent of offer price | REC "Focused correction contract" 1 | gap | Fixed | 7702996 BA `billing-autotopup.tsx:98-105` (Turn off always rendered with authorization; null-price note) | — |
| E02 | In-place Retry for initial load error, no mutation | REC 2 | gap | Fixed | BA `billing-autotopup.tsx:75,80` ("Try again") | — |
| E03 | "Authorization saved — charging not active" | REC 3 | gap | Fixed | BA `billing-autotopup.tsx:84` `notCharging` note; `panelHeading(status)` | — |
| E04 | Terms/price-change review path; no implicit re-consent | REC 4 | gap | Fixed | BA `billing-autotopup.tsx:104` ("Review the new terms", resets confirmed) | — |
| E05 | Uncertain POST: fetch authoritative status before retry | REC 5 | gap | Fixed | BA `billing-autotopup.tsx:88` ("Check current status" when `unconfirmed`) | Dropped-response execution not simulated in REC; RPT mounted check with request log |
| E06 | Preserve price/version checks, consent, caps, disabled charging | REC 6; REC "preserve the new protections" | pres | Preserved | BA `autotopup.ts:41-51` (requireSetup for authorize; consent from stored offer) | — |
| E07 | Regression evidence: revoke with price null/terms changed/charging disabled/stale offer; keyboard + 375 px | REC "Required regression evidence" | qual | Fixed + Codex | RPT `check-autotopup-panel-browser` (375 px, keyboard); 6aa2dc1 adds setup-disabled case | — |
| E08 | C5(a) revoke must not depend on setup flag | RPT C5(a) (derived from REC) | gap | Codex task (done) | 6aa2dc1 BA `autotopup.ts:53-57` (`revokeAutotopup` has no `requireSetup`) | — |
| E09 | C5(b) consent hash hard-coded `credits: 100` | RPT C5(b) | gap | Codex task (done) | 6aa2dc1 BA `autotopup-consent.ts:15` uses `offer.credits`; `autotopup.ts:43-45` | — |
| E10 | No existing finding closed by unrelated billing changes | REC table | bookkeeping | N/A | — | — |

## F. DEL — implementation delta

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| F01 | Compact library + single New; prompt-first for new users | DEL §1 contract 1 | gap | Fixed | d88381a | — |
| F02 | Cards: real preview, title, format, client, updated date, draft/live; compact list view | DEL §1 contract 2 | gap | In progress (M06) / **NOT COVERED** (client, live state, list view) | A10, B24 | — |
| F03 | Website=immutable rendered version, book=cover, deck=opening slide; store artifact/version/render outcome; no late overwrite; safe renderer; neutral fallback + Retry | DEL §1 contract 3–6 | gap | In progress (M06) | — | — |
| F04 | Deterministic fallback title from approved brief; never overwrite deliberate title | DEL §1 contract 7 | gap | Fixed | 5efe9c8 | — |
| F05 | §1 acceptance: phone, keyboard, reduced motion, long titles; unauthorized/deleted never leak preview | DEL §1 acceptance | qual | In progress (M06) | — | — |
| F06 | §2 server search, Unicode/case defined, Clear search, distinct loading/error/no-workspace/no-project/no-match, precise counts | DEL §2 | gap | Fixed (most) / **NOT COVERED** (Clear search) | `account-projects.tsx:168-180` | — |
| F07 | §3 show saved/rendered/checked/live identities; restore no silent publish; previous public version on failed update; preserve page/slide/scroll when opening history | DEL §3 | gap/qual | Fixed (M07 saved/checked/live) + Codex (PFF previous live output) + In progress (M10 scroll) | fc1ce75, ef637bb | Rendered-preview version identity not shown |
| F08 | §4 attachment states incl. Local only / Processing; name included files in receipt without telemetry content | DEL §4 near-term | gap | Fixed (states) / **NOT COVERED** (receipt names files) | 6eeea77 | Run receipt naming which files were included: not found |
| F09 | §4 larger-file private ingestion pipeline | DEL §4 later | gap (X) | **NOT COVERED** (optional) | — | — |
| F10 | §4 acceptance incl. local→login handoff, account switch, expired source snapshot, retry with removed/changed files | DEL §4 acceptance | qual | Fixed (local) + Codex task (real model, done) | RPT 9 browser scenarios; QREC sources | — |
| F11 | §5 pending→apply→saved→Undo; Plan approval bound to saved revision; disclose AI/backend-starting actions; Cancel costs nothing before provider call | DEL §5 | gap | In progress (M08) + Codex (Stop zero-charge before provider) | QREC C1 "before initial operation event" case | AI-start disclosure: B21 |
| F12 | §6 documents: dimensions/pagination/notes/charts; presentation shortcuts yield to sliders | DEL §6 | qual/gap | Codex (C4) + Fixed (F14) | — | — |
| F13 | §7 billing clarity separate from financial qualification; never silently enroll auto-top-up | DEL §7 | pres | Preserved | BA consent checkbox flow; charging off (QREC) | — |
| F14 | Execution order 1–8; per-slice report | DEL "Recommended execution order" | process | N/A | — | — |
| F15 | Comparison enhancement: formatted/content view for minified diffs, raw diff retained | DEL "Existing comparison deserves preservation" | gap (X, M11) | Preserved (raw diff) / **NOT COVERED** (formatted view) | LF `version-compare.tsx:9` (300-line limit), `:49` | — |
| F16 | Keyboard comparison: standardize interaction pattern; don't add tab roles without full pattern | DEL "Keyboard comparison" | guidance | N/A | — | — |

## G. CAP — capability states

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| G01 | MailCenter success copy promised automation unconditionally | CAP "Source-proven wording mismatch" | gap | Fixed | de8fca0 LF `src/lib/mail/connected-message.ts:9-22` | — |
| G02 | Overview failure after connect: keep acknowledgement, say verification couldn't finish, Retry | CAP same section | gap | Fixed | LF `mail-center.tsx:66` (connectedMessage(…, null, true) + Try again) | — |
| G03 | Stale capabilities from previous workspace must not unlock next context | CAP "How to verify" | gap | Fixed | fd62fae (`mail-center.tsx`, failedScope) | — |
| G04 | Preserve initial mail-load failure alert + Try again | CAP "Existing Makeborne behavior to preserve" 1 | pres | Preserved | LF `mail-center.tsx:66` | — |
| G05 | Preserve Gmail send-only note | CAP preserve 2 | pres | Preserved | LF `mail-center.tsx:76` | — |
| G06 | Preserve "Check now sends due emails" consequence | CAP preserve 3 | pres | Preserved | LF `mail-center.tsx:77` | — |
| G07 | Preserve operator-unconfigured providers + domain not-published/not-live/DNS steps/disconnect confirm | CAP preserve 4 | pres | Preserved (not re-verified line-by-line) | F07 changed only state mapping/DNS copy | — |
| G08 | Preserve domain request account guard | CAP preserve 5 | pres | Preserved | LF `website-domains.tsx:33-36` (`cloudAccountGuard`) | — |
| G09 | Lost-preview recovery acceptance | CAP "Actual lost-preview recovery" | gap/qual | **NOT COVERED** | = A94 | — |
| G10 | State contract table (loading, platform setup absent, permission missing, not connected, reduced capability, scheduler off, credit limit, temporary failure, uncertain mutation, revoked) | CAP "State contract" (10 rows) | qual | Partly Fixed (mail) / **NOT COVERED** (systematic fixtures for role-denied, provider-unconfigured, revoked) | Mail fixtures in de8fca0/fd62fae | "role denied" and "revoked/expired connection" fixtures not found; M17 may cover role |
| G11 | Send/publish/payment outcomes need isolated E2E with operation IDs, no duplicate side effect | CAP "How to verify" final para | qual | Codex task (partial) | PFF publish idempotency SQL; BFF webhook duplicate | Mail send exactly-once not qualified |
| G12 | App mail vs CRM mailbox: don't share misleading setup copy | CAP "Fresh observed journey" | guidance | N/A (no Makeborne app-mail feature) | — | — |

## H. EFF — effort / cost contract

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| H01 | Describe effort as allowance, not guaranteed quality | EFF contract 1 | pres/gap | Preserved | LF `src/lib/routing/effort.ts:10-15` ("More room…", "allowance") | — |
| H02 | Distinguish formula estimate / historical / authorized maximum / reserved / settled; show maximum before billable approval | EFF contract 2; EFF "A second kind of estimate" | gap | **NOT COVERED** (Plan path) | `plan-card.tsx` Build button still `~min–max credits` only; no ceiling shown | Live-builder build path already shows ceiling (PRF) — gap is Plan approval |
| H03 | No-fit reason / staged proposal instead of High "Best fit" | EFF contract 3 | gap | Fixed | f742ad9 LF `plan.ts:131`; `plan-card.tsx:152,156` | Staged-plan proposal is advisory copy only (allowed) |
| H04 | Effort/plan/image change invalidates old quote; preserve saved-plan binding | EFF contract 4 | gap | In progress (M08 saved-plan approval) | — | — |
| H05 | Partial result recoverable at budget/time limit, no second charge | EFF contract 5 | gap | Codex task (done) | QREC C1: "valid partial work is offered for explicit recovery without another charge" | — |
| H06 | Qualify choice→quote→approval→output→receipt for website/document/Plan/review | EFF contract 6 | qual | Codex task (partial) | QREC "Real AI" website/book/deck | Review path + higher-effort document costs not qualified |
| H07 | Offline cases list (every level, first empty website, Plan intensity, review limits, schema-max no-fit, one-file edit, cap clamp, effort change after quote, stale Plan revision, insufficient wallet) | EFF "Required offline cases" | qual | Partly Fixed / **NOT COVERED** | f742ad9 adds no-fit + positive controls (RPT `check-plan-nofit-browser`) | Effort-change-after-quote, stale Plan revision, insufficient-wallet offline cases not found |
| H08 | Don't advertise routing minimumQuality 80 or merge policies | EFF "Operation-specific differences" | pres | Preserved | No UI use found | — |

## I. PDM — pricing decision model

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| I01 | Keep Studio "Recommended"; don't relabel Cheapest | PDM §1 | pres | Preserved | LF `creation-plans.tsx:87` | — |
| I02 | Preserve exact annual total | PDM §1 | pres | Preserved | LF `creation-plans.tsx:90` | — |
| I03 | Preserve "switching not available, contact support" | PDM §2/§3 | pres | Preserved | LF `creation-plans.tsx:101` | — |
| I04 | Rollover copy (two months, oldest first) not independently re-qualified | PDM §3 | qual | Codex task (done, SQL) | BA `billing-workspace.tsx:77`; BFF rollover/expiry suites | — |
| I05 | Low-balance wallet-aware quote (missing capacity, usable balance, pack price; server quote revalidated) | PDM §4 | gap (X) | **NOT COVERED** | No low-balance quote UI | Owner decision |
| I06 | Personalized recommendation must state objective/assumptions | PDM §4 | gap (X) | N/A until feature exists | — | — |
| I07 | Alert vs spend limit vs automatic payment separate; threshold must not bypass AI-spend authorization | PDM §4 last para | own/qual | **NOT COVERED** | = A73 | — |
| I08 | Proofs 1–6 before shipping a recommendation | PDM §5 | qual | N/A (no recommendation shipped) | — | Applies only if I05 is built |

## J. PRF — pricing forensics (Makeborne implications)

| # | Finding (short) | Source | Kind | Status | Evidence | Gap note |
|---|---|---|---|---|---|---|
| J01 | Show annual total next to monthly equivalent | PRF §1 | pres | Preserved | = I02 | — |
| J02 | Show full job total incl. media/research; reconcile job, project and wallet views | PRF §2 "Makeborne lesson" | gap | **NOT COVERED** | No per-operation parent/child cost view | = A71 |
| J03 | One structured pricing source for UI/help/receipts | PRF §3 | pres | Preserved (not re-verified) | Catalog `src/lib/billing/topups-catalog.ts` single source | — |
| J04 | Plainly named cancellation control; distinct cancel/downgrade/refund/delete | PRF §4; lifecycle B | gap | **NOT COVERED** | No self-service cancel/switch UI change | Billing scope; owner decision |
| J05 | "Calculating price"; purchase disabled until server quote final | PRF §5 | pres | Preserved (partly) | BA `src/components/billing-topups.tsx:41` blocks purchase until availability; total review in Whop checkout (`creation-plans.tsx:101`) | Pack prices are static catalog, not a loading quote |
| J06 | Auto-top-up consent binds merchant/currency/pack/price/trigger/cap/terms/account; serialize; dedupe; reconcile ambiguous | PRF §6 contract | pres/qual | Preserved + Codex (SQL) | REC preserve list; BFF consent/state SQL | Charging unimplemented |
| J07 | "This cap cannot cover one purchase" (no theoretical summary) | PRF §6 edge case | gap | N/A | Makeborne monthly limit is a count of charges, not credits, so the mismatched-cap state does not arise | — |
| J08 | Three concepts alert / usage limit / auto top-up | PRF §7 | own | **NOT COVERED** | = A73 | — |
| J09 | Compare same completed job; record customer charge and provider expense separately | PRF §8 | qual | **NOT COVERED** | Needs matched benchmark (B14) | — |
| J10 | Commercial lessons (add capacity without upgrade; money difference recurring vs one-off; features vs quantity; job/project cost, coverage, expiry, renewal; deliberate auto-buy; one source; don't copy complexity) | PRF §8 | gap/pres | Partly Preserved / **NOT COVERED** (job/project cost) | Packs exist; F08 history | — |
| J11 | Measured usage vs allowance-covered vs wallet charge vs provider cost as separate facts; check-in ≠ hard cap | PRF lifecycle A | pres/gap | Preserved (hard caps) / **NOT COVERED** (covered-by-allowance column) | Stop + caps preserved (QREC C1) | — |
| J12 | Current plan / pending plan / effective date / next charge / lot expiry visible | PRF lifecycle B | gap | **NOT COVERED** | No pending-plan/effective-date UI | Billing scope |
| J13 | Policy matrix: subscription lots, packs, promo, expired, refunded, holds — versioned across checkout/terms/receipts/support | PRF lifecycle C | gap/own | **NOT COVERED** (customer-facing matrix) | Backend lot SQL exists (BFF) | — |
| J14 | Exact amount due, currency, interval, renewal, tax included; integer money units | PRF lifecycle D | pres | Preserved (partly) | `creation-plans.tsx:90,101` | Renewal date/tax shown only in Whop checkout |
| J15 | Runtime limits defined separately if Makeborne meters hosting | PRF lifecycle E | own | N/A (no runtime metering) | — | — |
| J16 | Acceptance matrix (10 questions: purchase binding, cancellation, upgrade, annual, hard cap, alert, savings, double charge, refund, promotion) | PRF "Recommended acceptance matrix" | qual | Codex task (partial) | BFF SQL suites (annual, refunds, top-up fulfillment, duplicates) | Fresh provider-signed lifecycle open (PFF) |
| J17 | Distinct columns: gross work, covered, debit, pending holds, returned, provider expense; accessible table; label rounding/delayed | PRF "E. Design implications" | gap | Partly Fixed (Reserved/Charged/Released statuses, accessible table) / **NOT COVERED** (covered column) | BA `usage-history.ts:69` | — |
| J18 | Limit explanations from same definition as enforcement; affected operations, reset, recovery | PRF "Additional limit-form interaction" | gap | **NOT COVERED** | = B36 | — |
| J19 | Goals/delegation: one aggregate budget, read-only delegates, stop blocks dispatch | PRF "Persistent goals…" | lov (future) | N/A | Only if added | — |
| J20 | Parent total + child items with stable IDs, category, covered amount, debit; unknown not coerced to zero | PRF "Makeborne acceptance implication (M15 and M18)" | gap | **NOT COVERED** | Unknown preserved in run-receipt (A87) but no parent/child ledger view | — |
| J21 | F08 contract bullets: scoped ledger mapping; separate balances; truthful pagination/period; JSON declares period/filters/completeness; reconcile receipt→ledger incl. reversals; project drill-down back to artifact; read without side effects | PRF "Acceptance contract: M15" | gap | Fixed (mapping, pagination, JSON, reversals, read-only RPC) / **NOT COVERED** (drill-down link to artifact; grants/expiry rows) | BA `view.ts:83-96`; `usage-history.ts:69-71,102-109`; usage read RPC `makeborne_usage_history` | `/api/credits` trial side effect avoided by new RPC |
| J22 | Per-item mode snapshot + funding reason | PRF "M15 acceptance refinement" | gap | **NOT COVERED** | = C54 | — |
| J23 | Gift value ≠ credit pack; not a launch feature | PRF "Gift value" | lov | N/A | — | — |
| J24 | Preserve cumulative rounding, operation identity, captured rate, shared allowance | PRF "Preserve the cumulative rounding…" | pres | Preserved | LF `cumulative_ai_operations.sql:289,336` | — |
| J25 | Preserve Medium-only measured disclosure; ceiling shown separately in LiveBuilder | PRF same | pres | Preserved | LF `billing-credit-costs.tsx:7,42` | — |
| J26 | Non-exempt run/lot/account/export reconciliation for M15/M18 | PRF "What this proves…" | qual | Codex task (partial) | QREC: regular-credit SQL + real local provider tests; staged Stop exempt | Non-exempt staging lifecycle open |
| J27 | Doc fixes: `tokensFromPrice` comment; Image 2 "no key" note; 2.5 estimator note | PRF "Provider price freshness" | gap (doc) | **NOT COVERED** | = A96 | — |
| J28 | Preserve Image 1 retirement guard; keep 2.5 refused | PRF same | pres | Preserved | LF `src/lib/ai/check-live-spend.cjs:585-601`; `prices.ts:90-91` | — |
| J29 | Image qualification sample does not qualify storage/display/portrait/production | PRF same | qual | **NOT COVERED** (gate) | = B06 | — |

---

## Missed items (NOT COVERED rows that apply to Makeborne)

| Row(s) | Item | Suggested fix | Size |
|---|---|---|---|
| A12, B25, F06 | No "Clear search" on a no-match library search (DEL §2 acceptance) | Add a Clear search / Clear filters button next to the zero-results status in `account-projects.tsx:172` that resets query and format filter | S |
| A10, F02 | No compact list view / sort in the library (DEL §1) | Add a grid/list toggle (per-viewer preference) and name/date sort over the loaded and searched results | M |
| A11, B24, C04, F02 | Library cards lack client label, draft/live state and published version | Fold into M06: show authorized client name and a Live / Not live badge from publication status (the GET used by `use-live-version.ts`), plus a client filter | M |
| C09 | M09 readiness is missing in the studio creation modal (`studio.tsx:1543`) and build conversation/notes (`build-conversation.tsx:87`) | Pass `useSourceReadiness` + `readiness`/`onExclude` to those `AttachmentList`s and gate Send with `sourceIntentIssue` | S–M |
| F08 | Run receipt doesn't name which files went into the request | Add an attachment-name list (names only, no content) to the operation receipt | S |
| B21 | P0-3: no audit that every AI-starting control is explicit and shows the generated instruction | Inventory AI-starting buttons (SEO/client-ready/plan/repair/personalize), label them "Uses AI · up to N credits", preview the instruction | M |
| A98, H02, C57 | Plan approval shows only the formula `~min–max`, not the hard request ceiling | Show "Estimate ~x–y · limit N credits" in the Plan footer/Build button, matching live-builder | S |
| H07 | Offline cases for effort change after quote, stale Plan revision, insufficient wallet | Add pure-helper/route checks (overlaps M08) | S |
| A86, C19 | Generated forms: no aria-invalid / error description / focus-on-error / success-focus contract | Add to `prompt.ts` ACCESSIBILITY + review checklist, plus a client-ready check | S–M |
| A83 | Route-focus tests for generated multi-page sites (M16) | Add a mounted check: menu → route sets title, closes menu, moves focus to main/h1 | S |
| A84 | Geometry/contrast/claim-provenance qualification of generated output; version-bound scoped repair + cumulative cost | Add root-overflow at 393 px + CTA contrast to automated review; record repair cost cumulatively | M |
| A94, G09 | Preview transport loss not separated from build failure (only manual Reload) | Detect iframe load failure/timeout → "Preview lost connection · Try again" without regenerating; confirm content after retry | S–M |
| A96, J27 | Stale notes in `prices.ts` (lines 103-104, 82, 90) | Correct comments: 0.05 cent headroom; Image 2 qualified once (cite record); 2.5 has a published estimator but stays refused | S |
| A71, B23, J02, J10, J17, J20, J21 | No parent/child operation cost view, no allowance-covered column, no project drill-down link from usage rows | Extend usage history: group child entries under operation id, add covered/debit split, link the project to its artifact | M |
| C54, J22 | No per-item mode snapshot / funding reason in receipts or usage history | Store mode and funding reason (plan/pack/trial/exempt) on the settlement and show it | M |
| A73, B36, I07, J08, J18 | No customer alert / usage limit; no explicit test that auto-top-up can't cross a limit | Owner decision; if added, keep three separate controls and test their interaction before activation | M–L |
| J04, J12, J13 | No plainly named cancel; no pending plan / effective date / next charge / lot-expiry view; no customer-facing lot policy matrix | Billing-owner work: a "Your plan" panel with current/pending/effective date/next charge and lot expiries | M–L |
| I05 | No wallet-aware low-balance quote | Owner decision; build on a server quote that uses actual lots | M |
| B35 | Telemetry field minimization and audience/retention clarity (M15/M17/M18) | Review telemetry payload fields; add short retention/audience copy | S |
| B38 | Handoff/export: exact delivery version, actor authority, excluded client data, integration ownership, recurring cost | Spec + checks on the existing export/download paths | M |
| B39 | Plan comparison should show actual incremental entitlements; keep privacy choices on cancellation | Copy review of plan cards | S |
| A58 | Version-bound, explainable context provenance (which brand kit/style/sources were used) | Record the context set on each version and show it in History | M |
| C49 | Unsent client-review reply lost on close/reopen | Add scoped draft retention to the review reply box (reuse `unsent-draft.ts` pattern), unless M17 covers it | S |
| G10 | No fixtures for role-denied / provider-unconfigured / revoked connection states | Add component fixtures (may be part of M17) | S |
| A30 | Composer blocks typing while busy (optional "prepare next message") | Optional: allow unsent text while busy without enabling submit | S |
| B15 | Physical phone keyboard / screen reader / reduced-motion qualification | Run one assisted session on a real device + NVDA/VoiceOver | M |
| B14, B33, J09 | Matched-brief benchmark and 5-user agency study | Owner decision + budget | L |
| B06, J29 | Production image readiness unqualified | Owner-gated activation | — |
| Deferred optional | M11 bookmarks/formatted diff (A38, C14, F15), M12 source search (A21, C15), M14 advisor handoff (C17), Office/CSV ingestion (C47), large-file pipeline (F09), 14/16 px type targets (C50) | Owner decision on whether any go into launch scope | M each |

## Claimed fixes that look incomplete against the acceptance text

1. **M04 (C04).** The acceptance says to distinguish "last chat activity, saved source, rendered preview and published version". The fix labels only the saved-source time ("Version N · saved <date>", `project-labels.ts:15-18`) and deliberately shows nothing about live or preview state. The title part is done.
2. **M05 (A12/F06).** The full-scope search works, but DEL §2 also says "no-match gives Clear search", and there is no clear action.
3. **M09 (C09).** RPT marks it Fixed, but `studio.tsx:1543` (creation modal) and `build-conversation.tsx:87` still use the old list without readiness. RPT admits this; Codex a309e0d did not change them.
4. **M07 (B20/C07).** The "Live" marker is only on `feature/lovable-m07-live` (ef637bb). It is in neither the LF nor the LQ head, so it must be merged on purpose. The acceptance also asks for "rendered preview version" identity, and nothing displays it.
5. **Effort contract (A98/H02).** The no-fit fix is correct. Contract item 2 says "show the maximum before a billable approval", but the Plan footer still shows only the formula range.
6. **F08 (C25/J21).** The history, pagination and JSON statement match the contract. Two things are still missing: rows have no project drill-down "how to return to that artifact", and grants/top-ups/expiry rows are absent (excluded and labelled, `view.ts:70`). The contract asks to "distinguish subscription grants, top-ups, holds, releases, final charges, expiry and reversals".
7. **M03 (A19).** It is verified at 1366×768. The "first phone project card below 931 px" measurement was not re-done in RPT, although the layout change applies at all widths.
8. **F01 (C01).** It is source-checked only. RPT says no real-app fixture renders the outline notice.
9. **C1 Stop (A28).** It is implemented and staged, but the staged Stop used an exempt admin account (QREC). A paid-customer Stop on staging (measured charge, hold released) is still open.
10. **F05/C2 (A52/C23).** Both are staged on QA hosts only. The production Worker deploy is owner-gated, and the F05 note "qualify actual deployed candidate separately" stays open until then.
