# Agency workflow: implementation map, 23 October 2026

Branch `feature/agency-workflow` from origin/main `de7e657` (live). Owner brief: "connected agency workflow" (understand a client, remember approved facts, plan and build, generate or edit imagery, verify, revise/review/publish safely). Local implementation only, behind server-side flags; production, deployment and new spending are out of scope.

## Current truth (verified read-only on de7e657; file:line references are in the survey notes)

| Starting observation | Verdict | Evidence |
|---|---|---|
| PDFs and images reach Claude as native content | TRUE | `src/lib/builder/attachments.ts:102-108` emits native `document` (base64 PDF, text) and `image` blocks; build and plan routes; 5 files / 3 MB combined; no per-page coverage report |
| Claude web search has a bounded integration | **FALSE in operation** | `discover.ts:98-112` sends `web_search` with `max_uses`, but `assertWebSearchTool` always throws (`prices.ts:211`: no documented or enforced billable result-token ceiling); lead finder creator/similar modes return 503; `discoveryAvailable: false` |
| Existing-image edits are refused | TRUE | `image-router.ts:78`; `prices.ts:270` refuses image input; `openai-image.ts:46` "no edits" |
| Image estimates include empirical observations, not maxima | TRUE | 2.5 models: observed tokens ×1.5 from 15 calls (`prices.ts:121-150`); `prices.ts:91` "An estimate is not a bound"; overruns trip the per-provider emergency stop |
| Saved chat transcripts are not memory, tool history, spending authority or approval | TRUE | `artifact_chat_messages` table comment; no server code reads it as model context; spend authority comes from `ai_operations` action keys |

Implemented and live on main: durable operations, RunSpend and provider limits, builder attachments (images, PDF, text), safe public fetch, image generation behind opt-in config, visual review with screenshots, brand kits, clients, sources, immutable assets, native PPTX charts.
On unmerged branches only (not live): model routing (feature/model-routing, routing off by default), vision-checked imagery and comp-first websites (feature/image-led-sites), full-image decks (feature/docs-quality), rendered-contrast gate (several branches), site verifier (qualification/beta-combined-20261022).

## Map: each addition → the existing component it extends

| # | Addition | Extends (no parallel system) | New |
|---|---|---|---|
| 1 | Common execution contract | `ai_operations` / `ai_operation_runs`, `beginOperation` / `createOperationSpend` / `finishOperation` (`src/lib/builder/operation-server.ts`), `RunSpend`, `operation-contract.ts` | A typed task envelope (scope, objective, source versions, permitted tools, qualified settings); new operation kinds via a widening migration; a specialist helper that spends the parent's remaining allowance; lease renewal for long steps |
| 2 | Source ingestion | `attachments.ts`, `source-readiness.ts`, `sources` / `assets` tables, `input-images.ts` | Parsers for DOCX, PPTX, CSV, XLSX in an isolated worker (`worker_threads` with resource limits, then the sandbox pattern for production); extraction records with hash, version, coverage; storage references for large inputs |
| 3 | Approved client knowledge | `clients`, `sources` (approved flag), `brand_kits` | `client_facts` with status, provenance, approval, supersession; bounded text retrieval; per-task snapshots |
| 4 | Understand this client | `fetchPublic` / `publicTarget` / `readPublicPage` (`src/lib/mail/research.ts`, `src/lib/brand/server.ts`), lead redesign import | Cited research brief from supplied sources and public pages; web search stays refused until a result-token ceiling is qualified |
| 5 | Image editing | `routeImage`, `startBudgetedImage`, `storeGeneratedImage`, price evidence | Edit contract and price evidence for image input; deterministic image ops with sharp; new asset per edit; accept as a version-checked reference swap |
| 6 | Independent review | `review.ts`, `review-policy.ts`, finish gates, capture pipeline, PDF/PPTX exporters | Fresh-context reviewer with typed findings bound to a revision; bounded repair; seeded-defect fixtures |
| 7 | Data to deliverable | `ChartSchema`, `pptx.ts` native charts, `client-csv.ts` formula guard | Deterministic aggregation with cell references; report/deck generation from verified numbers |
| 8 | Voice / agents | none | Out of scope; no implementation |

## Budget status (ledger `outputs/eval/budget/ledger.json`, 23 Oct)

No new spending is approved by this brief. My earlier allowances are nearly exhausted: website scope `image-led-20261022b` $43.83 of $46.90 (Anthropic room about $1.17), docs scope about $1 Claude, OpenAI effectively $0. The `model-orchestrator-20261023` scope belongs to other work. **All verification in this task is local, with fakes and fixtures; every live provider qualification is recorded as outstanding with a cost estimate.**

## Order

1 and 2 first (foundation and ingestion, independent files), then 3, 5 and 6, then 4 and 7. Each stage lands on its own branch off `feature/agency-workflow`, is merged back after its checks pass, and gets a handoff entry.
