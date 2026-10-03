# Workflow preparation

`prepareWorkflow` composes effort policy and the existing validated routing engine. It is pure server preparation, not a live generation endpoint, dispatcher, quote approval, or ledger reservation.

The caller supplies an output type, effort, presentation mode when applicable, image requirement, a trusted timestamp, global vendor/customer budgets, and bounded routing requests for planning/draft/review/images. All required stages must be routable. Missing stages, incompatible policies, expired prices, per-stage or whole-workflow budget failures produce a null snapshot and no customer quote. It never returns an executable partial plan.

Planning/review execution caps come from the versioned effort policy. Draft/image stages each have one execution; requested image count belongs in bounded usage. Per-execution retry caps are the lesser of trusted stage caps and effort caps. `selectRoute` already multiplies its price by retries; workflow preparation multiplies that result by stage executions exactly once and sums using BigInt. Both global budgets and signed database bigint range are enforced. This is a conservative maximum, not consumed credits or guaranteed output quality.

Book art and full-visual presentation images require OpenAI inside the trusted provider allowlist. No fallback to another provider can satisfy those stages. Other routing constraints remain intact, and required stage capabilities are added rather than replacing stricter caller capabilities. Every route uses the same preparation timestamp. Selection is deterministic per-stage; the function does not search all route combinations to optimize total cost.

The returned snapshot is recursively frozen and includes effort/version, concrete routes/price evidence, per-stage requests, attempts, executions, total bounds, earliest price expiry and `approved: false`. The caller must bind it to authorized workspace/project/source versions in a canonical input hash, persist it, obtain approval, and atomically reserve both budgets before any execution. Reject changed input/effort/policy/expired quote; reprepare and reapprove. A browser may suggest an effort preference but cannot supply trusted rates, evaluations, provider policy, rights, budgets, or usage authority.

Only `customerView` is suitable for the product UI: operation, maximum credits, and readiness for approval. Internal snapshots contain provider details and must remain server-side. Failed plans return no credit estimate. The executor must enforce the complete stage graph and all limits; preparation alone does not enforce runtime resource usage or authorize paid calls.

Run `node src/lib/routing/check-workflow.cjs`. Its rates and evaluation scores are explicitly invented fixtures. No live adapters or model quality are verified.
