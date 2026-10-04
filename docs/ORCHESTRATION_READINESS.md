# Orchestration readiness — 4 October 2026

## Current status

Production generation is disabled. The application has bounded workflow preparation,
proposal integrity checks, OpenAI text/image attempt adapters, SQL reservation/dispatch
groundwork and pure job transitions. It has no deployed generation worker joining
these parts. Adding a provider key cannot make the current endpoint execute.

The eighteen styles have private directions in text and artwork prompts. Their
previews are visual references, not evidence that live customer outputs meet those
directions. No provider request or model-quality evaluation was performed in this
review.

## Hardening delivered

- Malformed or excessively long exact amounts fail validation without throwing a
  raw BigInt conversion error. The supported database integer range is unchanged.
- Stored quotes and attempts must match the job's input hash, base version and
  approved provider/model route. A fallback cannot be smuggled into an existing
  approved attempt.
- Dispatch rechecks that its reservation remains held and that current account
  limits cover all spending and reservations. Reducing a budget prevents further
  dispatch; already incurred provider costs still require reconciliation.
- Settlement checks workspace identity even on replay. A replay cannot change
  acceptance, the accepted asset list, or the customer charge's evidence/ledger ID.
  Duplicate assets and premature acceptance while later work is queued are denied.
- Style reference assets require authorization in the supplied asset manifest.
  Preserve-wording mode also preserves each block's semantic type.
- User brief, source text and custom style metadata stay in reference input, outside
  the text adapter's system instructions. Trusted authored style directions remain
  in the instructions. This separation is defense in depth, not proof that every
  model resists prompt injection. The adapter supplies no tools and output still
  passes structural/source/asset validation.

## Verification performed

All checks used local fixtures and stubbed transports. No paid requests were made.

| Runner | Passing checks |
| --- | ---: |
| src/lib/jobs/check-contracts.cjs | 19 |
| src/lib/jobs/check-hardening.cjs | 29 |
| src/lib/routing/check-routing.cjs | 22 |
| src/lib/routing/check-workflow.cjs | 19 |
| src/lib/routing/check-effort-matrix.cjs | 91 |
| src/lib/routing/check-proposal.cjs | 21 |
| src/lib/generation/check-draft.cjs | 51 |
| src/lib/generation/check-style-intent.cjs | 61 |
| **Total** | **313** |

TypeScript and focused ESLint passed. These checks do not establish database
atomicity, worker recovery, real provider costs, production execution or output
quality. Earlier SQL evidence remains separately scoped in the backend documents.

The new matrix covers all five effort levels across websites with and without
images, illustrated books, editable presentations and full-visual presentations.
It verifies stage capabilities, exact retry/execution ceilings, the common quality
floor, missing-provider rejection and the disabled registry boundary. Fixtures
use invented rates and scores; they are not a pricing recommendation.

## Production activation contract

Do not change the API/capabilities readiness flag merely because the fixtures pass,
credentials exist, or a model slot says ready. The production adapter must implement
and verify every applicable step below.

1. **Trusted request preparation.** Reauthenticate the account and creation
   membership. Load current project/version, source rights, asset references,
   stored style and server-owned price/route policy. Treat uploaded material as
   data. The browser cannot submit authority flags, token counts, balances,
   evaluation scores, unrestricted URLs, secret references or provider models.
2. **Complete route coverage.** Bind every required planning/draft/review/image
   stage to a concrete adapter and exact model configuration with current price,
   capability, privacy/license and quality evidence. OpenAI remains mandatory for
   book art and full-visual slides. Missing stages fail the entire preparation;
   a text-only result cannot masquerade as a completed illustrated book.
3. **Effort execution graph.** Persist each stage, execution ordinal and attempt
   under the approved workflow. Apply retry and execution caps once. The current
   pure job contract permits at most ten attempts total; an Ultra workflow can
   describe more than ten calls across stages. The worker therefore needs a
   deliberate parent/child-stage persistence model or a versioned aggregate
   contract before executing the full graph. Do not flatten it into one current
   job, truncate the graph, or raise caps without matching reservations.
4. **Quote and funds.** Present a bounded customer quote, bind it to the full input
   and policy, and reserve funded credits and vendor/global limits atomically.
   Revalidate any changed effort, content, route, price or expired approval.
   Budget limits are not funded balances. Define whether the accepted quote is a
   fixed customer price or metered ceiling; never present the maximum as measured
   consumption.
5. **Durable dispatch.** Atomically commit queue work and scoped attempt claims
   before external requests. Enforce leases, fencing, concurrency, cancellation,
   kill switches and deadlines. The OpenAI adapters have automatic retries off.
   Lost responses or ambiguous claims must enter reconciliation, not redispatch.
6. **Private output and review.** Persist actual usage, provider request IDs and
   outputs, then perform structure, factual/source and visual/text review. Validate
   slide text, overflow, book readability, image provenance and site behavior.
   Save accepted artifacts as new immutable versions; preserve existing edits and
   locks on failure. No second stage may bypass its parent workflow budget.
7. **Settlement.** Commit account totals, reservations, attempt evidence and unique
   ledger events together with expected revisions. Keep vendor expense separate
   from customer credits. Unknown costs retain holds. Failed or cancelled work
   must not receive an invented refund; implement evidenced adjustments separately.
8. **Customer delivery.** Connect progress/recovery and real revisions to the
   conversation UI, complete production upload/extraction and exports, and perform
   release/publishing through a separately authorized delivery service.
9. **Acceptance evidence.** Exercise normal execution, simultaneous requests,
   retry/duplicate events, timeout after provider acceptance, worker restart,
   cancellation, expired membership, insufficient credits, revoked access and
   partial failure. Verify costs and output quality on representative sites,
   books and decks at every offered effort level before opening creation sales.

## Model-selection limits

Current route selection is deterministic per stage. Economy prefers fewer quoted
customer credits and quality prefers the supplied evaluation score. Those scores
are trusted server input; the code does not discover the best model or measure
quality itself. All effort levels retain the same minimum acceptance floor while
higher levels allow more planning/review and bounded retries.

Calibrate model choices and customer allowances using accepted-output cost,
latency, factual/visual acceptance and revision rate on real fixtures. A high effort
label, larger model or additional pass alone is not evidence of a better result.
DeepSeek, Qwen, Anthropic and open-weight routes remain unconfigured integration
slots. Clipping and research retrieval require their own actual workers/adapters.
