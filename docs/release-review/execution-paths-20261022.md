# Execution paths and spend invariants, 22 October 2026

A read-only trace of `feature/editor-quality` (which contains `feature/creation-quality`), for the orchestration mandate (section 1: document what exists before replacing it). File:line references are in the trace; this is the summary that later work builds on.

## The shared spine (website, plan, review, book and deck generation)

The request goes `/api/build` → `beginOperation` → `createOperationSpend` → `websiteBuildResponse` or `documentBuildResponse` → `finishOperation`.

- **Durable identity:** `ai_operations` (unique on actor + action_key; an authorised-credits cap; revision; 24 h) and `ai_operation_runs` (unique on operation + step_key; a fence; a 15-min lease; a finish hash; at most one active run per operation). Migration: `20261013150000_cumulative_ai_operations.sql`.
- **Hold:** `ai_operation_begin` creates the run and the credit hold in one transaction.
- **Provider admission:** `ai_operation_provider_begin` checks the fence, run and hold expiry, and the cumulative ledger `used + bound ≤ authorised × rate`. It then calls `open_provider_call`, which applies the global and per-provider daily limits and the emergency stop.
- **Per-call bound:** `budgetedStream` reserves a bound before each attempt and shrinks `max_tokens` to the remaining budget. The SDK runs with `maxRetries: 0`; the app allows 2 attempts per model, each separately bounded. Unconfirmed usage stays at its bound.
- **Charge:**
  - Customer credits come from confirmed provider cost only, at $0.03 of provider cost per credit, capped at the allocation.
  - Settlement happens in the same transaction as the version save, which is a compare-and-swap on the expected version.
  - Failed, expired and conflict outcomes release the hold and record the cost as absorbed.
  - `ai_run_outcomes` keeps provider cost, charge and absorbed cost separate.
- **Replay:** the same step key returns the stored result with no provider call. Finish is idempotent by fingerprint.
- **Restart:** a worker is not resumable. Its run blocks new steps (OPERATION_BUSY) until the 15-min lease expires and is then released; open calls expire at their bound after 20 min. Provider room for a continuation is computed from the ledger, so a restart gets **no fresh allowance**.
- **Stop:** `ai_operation_cancel`. The worker polls every 1 s and aborts streams and images, and the SQL gate refuses new calls (MB499). A run that finishes after Stop is `cancelled`: confirmed usage is charged and the candidate goes to recovery, not into a saved version.
- **Models:** `builderModel()` is Opus 5.5 unless overridden, with explicit fallbacks only and no escalation. Effort is "low" while the project has no files (a recoverable project comes first), otherwise the policy intensity.

## Per path (differences from the spine)

| Path | Notes |
|---|---|
| New website | Quote, priced model and provider capacity are checked before any hold. A first build adds the design seed and concept step. Finish gates: quality, compile, rendered contrast. Images: up to maxImages and a third of the allowance. |
| Follow-up edit / continuation | A new action key; begin requires expected = last = current version. Partial work is saved and charged as unfinished. Automatic continuations (≤2) are **client-orchestrated**. Manual Continue authorises more cap (idempotent by authorisation key) and reuses the stored brief, plan, design, brand and attachments. |
| Plan | `/api/build/plan`, ceiling 10 credits, planner low/medium effort, ≤3 turns. The plan is saved with a revision compare-and-swap and its charge in one transaction. Approval binds the plan revision into the request context. |
| Review / refinement | 0–2 rounds by effort, **client-orchestrated**, as review stages of the same operation. Each round has a capped credit ceiling and no images; screenshots are taken in the browser. |
| Repair | "Fix it" only fills in the composer. A recoverable candidate is saved by `ai_operation_recover`, a compare-and-swap with no AI and no charge. The site-repair controller is not wired to the app. |
| Book / deck | Same spine. Images use the first allowed model only. "Incomplete" counts as finished and is charged. Export (`document-export`): no AI, no credits; concurrency is limited only by an in-process counter. |
| Images | `routeImage` (text → 2.5 flare/sunburst; cut-out → transparent-capable; else the cheapest bound; never gpt-image-1). A bound is reserved before contact; unknown cost stays at the bound. A token overrun disables the model **per process**; a dollar overrun trips the durable emergency stop. |
| Web search | Priced but never called (`assertWebSearchTool` throws). |
| Brief questions | One-credit hold per call with no durable identity. **Fixed in 4d94dcf:** the release used a fractional value and failed silently. |
| Brief enhancer | Fully durable (`20261022100000_brief_enhancement_actions.sql`): claim and hold in one transaction, fenced provider gate, outcome recorded before release, idempotent release, Stop tombstone. |
| Publication | Prepare is idempotent by actor + request id, bound to version and publication revision, rate-limited. The worker claim is fenced with a lease and ≤3 durable attempts. Promote is a compare-and-swap on revision + version hash + output hash with a single writer. The site verifier is operator-only, not in the publish path. |

## Invariant gaps the orchestration work must close

| Invariant | Holds today? | Gap → owner |
|---|---|---|
| Atomic reservations | yes, for operations and the enhancer | Questions, leads and chat holds have no durable action row; questions are idempotency-free (→ later, low risk, free steps) |
| Idempotent settlement | mostly | The questions release fix is done (4d94dcf) |
| Durable attempt / escalation counts | **partial** | Turns, malformed retries, image counts, continuations and review rounds are in memory or client-only; there is no escalation. **The routing state machine must be server-side and durable** (→ feature/model-routing) |
| Conservative uncertain usage | provider side yes | The token-overrun model disable is per-process (→ make it durable when routing selects models) |
| No fresh allowance after restart | yes ($) | Per-run image and turn limits reset on a new run (→ count against the operation in the routing state) |
| No duplicate charge on replay | yes | Unconfirmed: whether a reload lets the same approved plan be built as a new charged operation (→ verify; plan "built" is a client PUT) |
| Provider cost ≠ customer charge | yes | — |
| Admin exemption keeps provider limits | yes | — |
| Deadlines / expired holds stop calls | yes | A killed function leaves the run active ≤15 min and its calls open ≤20 min (documented; acceptable) |
| Stop invalidates stale promotion | yes (operations, enhancer) | Stop before the operation exists has no tombstone; publication has no cancel path (unconfirmed) |
| One writer per artifact | **partial** | Concurrent operations on one artifact are allowed (the loser goes to recovery). Export concurrency is per-process. MB403 from begin maps to a generic 503 (→ routing: one active writer per artifact) |

Not traced in depth: the admin-only durable generation pilot (`/api/generate`) and expert-chat settlement.
