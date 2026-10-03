# Provider routing and credit quotes

## Implemented scope

`src/lib/routing/contracts.ts` provides runtime-validated capability routing, rejection reasons, deterministic selection and an unapproved quote compatible with `src/lib/jobs/contracts.ts`. `registry.ts` declares eight **unconfigured integration slots**, not available generation services. No request dispatch, API keys, network calls, invented prices or customer balances are included.

The registry separates text/code, image/visual slides, transcription, clip selection and clip rendering. A text model cannot satisfy an image request; a transcription model cannot render clips. Research source retrieval has its own capability, with no default candidate: text generation alone is insufficient evidence for market research.

Candidates must pass configured model/adapter, workspace provider allowlist, external-processing permission, source rights, license approval, policy approval, quality evaluation, price validity and both independent budget caps. Economy ranks by the customer quote only after the same minimum quality gates. Quality ranks by evaluated quality first. Ties use explicit priority and stable route ID; order of input does not change the result. No fallback is dispatched automatically.

Quotes use decimal strings and BigInt arithmetic: vendor micro-USD and customer credits are different accounts. Each usage line rounds upward separately and includes a maximum attempts multiplier, including fixed costs per attempt. A rate card must price every requested unit and the request must bound every unit on that card. Use separate route/rate variants for combinations with different billing dimensions. No floating-point currency conversion occurs. Price cards have evidence IDs, versions and expiration; quote expiration cannot outlive the card. Database bigint overflow rejects a route.

`customerCredits` is an integer in the existing job schema, not fractional display credits. These are maximum reservations, **not consumed credits**. Accepted-work debits and refunds come from the durable job ledger after settlement. A UI must not present a quote or reservation as a completed charge.

## Integration contract

1. Authorize the workspace/project on the server and load policy/rights from trusted records. Never accept `sourceRightsConfirmed`, provider allowlists, rate cards, evaluation scores, timestamps or budget balances as browser authority.
2. Resolve a pinned model/deployment and secret-store configuration reference from a server allowlist. Do not resolve browser-provided endpoint URLs. Recheck model support, license and deployment data boundary. `workspace_private` is a claim requiring deployment verification, not a privacy guarantee provided by self-hosting software.
3. Build bounded usage from the actual versioned input, count tokens with the adapter's tokenizer, cap output/reasoning tokens, image sizes/count/quality, media duration, retrieval calls and worker compute. Bind these and the source hashes to the canonical input hash. Include potentially billable failures/repairs in the attempts bound. Enforce these bounds at runtime.
4. Call `prepareRouteQuote` with a database-generated quote ID and authorised scope. Persist its full selected route snapshot, price evidence and request bounds alongside the job. The compact job `routeVersion` combines route and price versions; deployments must keep those identifiers unambiguous and immutable.
5. Display provider, operation, maximum credit reservation and input/output limitations before approval. Any route, material input or price change requires a new quote and approval. Never silently downgrade OpenAI-image book/slide art to an incompatible text model.
6. Reserve both budgets transactionally using the existing job machine/database path. Revalidate authority immediately before dispatch. The pure routing function does **not** grant permission to spend, reserve funds or enqueue anything. No-paid-call configuration remains in force independently of all route flags.
7. Persist actual provider request IDs and measured usage evidence; settle/release through the job ledger idempotently. Unknown provider outcomes keep the reservation until reconciliation. Re-evaluate privacy/policy for failover and obtain a new quote; retry limits must agree with the quote.

## Provider research (official sources, reviewed 2026-10-03)

- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation): image generation is a distinct API/tool path. It requires separate adapters, image parameters and output checks. This registry intentionally does not pin a current model or infer prices from documentation examples.
- [Claude model overview](https://platform.claude.com/docs/en/models/overview): consult model identifiers/versioning when configuring a deployed adapter. Text/vision understanding does not establish raster image generation support.
- [DeepSeek API introduction](https://api-docs.deepseek.com/): compatibility is an integration starting point, not proof that another provider's tools, usage accounting or retry semantics work unchanged.
- [Qwen's vLLM deployment guidance](https://github.com/QwenLM/Qwen3/blob/main/docs/source/deployment/vllm.md): a self-hosted text serving option. Choose the exact model weights and review their license separately. Hardware, hosting and inference time must still be costed.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): transcription component candidate; it does not by itself select persuasive excerpts or render finished clips. Timestamp accuracy, language quality and worker resource limits need evaluation.
- [FFmpeg licensing](https://www.ffmpeg.org/legal.html): rendering component candidate; obligations depend on the actual build and enabled dependencies. No blanket commercial-use conclusion is embedded in the registry.

Open-weight deployments may eventually earn a lower credit quote after measured costs and quality evaluation. They are not assumed free or cheaper. User preference for OpenAI-generated book art and full visual slide designs requires dedicated image steps, text accuracy checks and explicit editable-vs-raster export choices. Website hosting is a separate deployment pipeline, not a model capability.

## Verification and remaining launch work

Run `node src/lib/routing/check-routing.cjs` for 22 offline fixture checks covering default denial, independent budget math, deterministic ranking, rights/privacy/provider/capability gates, missing configuration/evaluation/pricing, expired quotes and existing JobQuote compatibility. Fixtures are not vendor pricing or quality measurements.

Still needed: live provider adapters and credential provisioning; real evaluation datasets/results; verified rate cards and runtime metering; trusted policy and source-rights records; transactionally persisted quote snapshots; dispatch integration; production retry/reconciliation; complete clipping pipeline; model-driven website/book/slide output verification. No live provider execution or customer charging was tested. The module is groundwork and does not make generation launch-ready.
