# AI spending limits (live builder)

Step 2 of the release plan. Customers are never charged above their authorized hold, and provider dollars are bounded before every call. **Deployment dependency:** the daily limits ship disabled, so all generation fails closed until the database owner configures them. See `docs/RELEASE_RUNBOOK.md` for the order, the staging verification and how to restore service.

## Generation paths

| Path | Entry | Provider calls | Credit hold | Provider-dollar control |
|---|---|---|---|---|
| Website build | `POST /api/build` (mode `build`) → `website-run.ts` → `runBuilder` | Anthropic text (stream), OpenAI images | reserved before any call | per-call bound + run cap + daily DB gate |
| Design review | `POST /api/build` (mode `review`) → same | Anthropic text | reserved before any call | same, with the smaller review ceiling |
| Book / presentation build | `POST /api/build` → `docs-run.ts` → `runDocumentBuilder` | Anthropic text, OpenAI images | reserved before any call | same |
| Plan mode | `POST /api/build/plan` → `plan-run.ts` → `runPlanner` | Anthropic text | reserved before any call | same, with `PLAN_CEILING_CREDITS` |
| Expert advice / outreach drafts | `POST /api/chat` and client follow-up-draft routes → `startExpertReply` | Anthropic text | per-mode authorized hold | priced model, global/provider daily gate, per-run bound and full settlement |
| Durable generation jobs | `/api/generate/*` → `src/lib/generation/*` workers | Anthropic/OpenAI adapters | generation budget reservations | approved route tariffs with expiry; cumulative `generation_execution_caps`; **and the same daily gate** (migration `20261012150000`) |

**Other paths and limits:**
- Advisor chat now has a paid backend; AI-personalized outreach uses the same bounded expert runner. Standard and Genius have separate credit multipliers and holds. Their flags and provider gates are authoritative; do not describe these features as free.
- Research and clipping are research documents only (`MODEL_AND_CLIPPING_IMPLEMENTATION.md`); every clipping route in `routing/registry.ts` is `unconfigured`.
- `src/lib/generation/claude-pilot.ts` has no callers, and its database entry points were revoked from the service role.
- The durable path today serves only the operator qualification proposal, whose tariff window has expired, so it fails closed until that pricing is reviewed again.

**One authority for provider dollars.** When a durable capped dispatch reserves its whole-operation bound in `generation_execution_holds`, a trigger reserves the same bound in the live gate, in the same transaction:
- A disabled or exhausted gate makes the dispatch fail atomically (`MB423`/`MB402`), and no cap is allocated.
- When the job settles, a second trigger closes the gate call with the actual cost.
- Unknown outcomes keep their cumulative cap hold. Their gate call expires at its bound after 20 minutes, and an operator reconciliation trues it up once.
- Lock order is caps (global, provider), then gate limits (global, provider), then day rows. The live path never locks caps, so there is no deadlock cycle.

A structural test (`src/lib/ai/check-live-spend.cjs`, "structure") fails if:
- a live route contacts a provider before `requirePricedModel` → `reserveCredits` → `createRunSpend`;
- `runBuilder`, `runDocumentBuilder`, `runPlanner` or `startBudgetedImage` is called from anywhere else;
- any builder file streams or creates messages directly, enables SDK retries, uses server-side fallback, or caps usage before settlement.

## Prices (verified 2026-10-12)

`PRICE_EVIDENCE` in `src/lib/ai/prices.ts` records, for each priced model:
- the exact API model ID;
- the page that maps the display label to that ID (the models overview's "Claude API ID" column, or OpenAI's model page);
- every pricing page used;
- the verification date;
- every billable component.

Lookups use the API ID only: a display label such as "Claude Opus 5.5" is refused. A response whose `model` differs from the requested ID, without a per-attempt record that explains it, is recorded at its bound and the run fails closed. A test also checks that the durable route's tariff (4 / 20 µ$ per token for `claude-opus-5-5`) agrees with the evidence.

**Configurations refused before any provider contact:**
- **Request parameters:** anything outside `model`, `max_tokens`, `messages`, `system`, `tools`, `thinking`, `output_config.effort`, 5-minute `cache_control` and the one display beta. That rules out `speed`/fast mode, `inference_geo`, `fallbacks`, `service_tier`, server tools, 1-hour cache, other betas, aliases and unknown IDs.
- **Images:** a model without a bounded price card (`gpt-image-1` until its retirement, `gpt-image-2`), a quality or size not listed for it, `n` other than 1, or a non-text prompt. `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` are refused: they publish no output-token counts, so their cost cannot be bounded.

`src/lib/ai/prices.ts` holds the verified price card. Amounts are micro-USD per token, which is the same as USD per million tokens. A model or variant that isn't listed fails closed: there is no bound and no call. The routes check the configured model before anything is reserved.

| Model | Input | 5m cache write | 1h cache write | Cache read | Output | Source |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 4 | 5 | 8 | 0.20 | 20 | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| claude-sonnet-5-5 | 2 | 2.50 | 4 | 0.10 | 10 | same |

- US-only inference costs 1.1× on every category. We don't request it, but every bound assumes it.
- Fast mode isn't priced, so it fails closed.
- `gpt-image-1` costs $5/M for text input, $10/M for image input and $40/M for image output ([OpenAI pricing](https://developers.openai.com/api/docs/pricing)). Medium quality uses 1,056 output tokens for 1024×1024, 1,584 for 1024×1536 and 1,568 for 1536×1024 (image generation guide). Other qualities aren't listed yet and fail closed.
- **`gpt-image-1` retires on 2026-10-23** ([OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)). From `2026-10-23T00:00:00Z`, `imagePrice` refuses it (`retiresAt`), so it can no longer be used.
- **Images are opt-in, with no default model** (`imageConfiguration` in `src/lib/builder/images.ts`). They run only when `OPENAI_API_KEY` and `MAKEBORNE_IMAGE_MODEL` are both set, and the model has a current, bounded price card. Otherwise the run continues without the image tool and the model is told to design with typography, CSS and SVG. A set key with an unusable model (retired, unbounded, unpriced) is logged (`Image generation is off. …`) instead of failing the whole build. Before this change, an `OPENAI_API_KEY` with no model meant `gpt-image-1`, and from its retirement date every website and document build would have failed. **Qualification configuration: leave both unset until the image model passes live qualification. The owner requires AI images at launch; an unqualified image path remains a release blocker.**
- **Replacement `gpt-image-2`** (verified 2026-10-13, snapshot `gpt-image-2-2026-04-21`): $5/M text input, $8/M image input, $30/M image output. Output tokens per image come from the published per-image prices, rounded up: `ceil((price + $0.0005) / $30 per M)`. Bounds at 1.1×: low ≈ $0.007, medium ≈ $0.059, high ≈ $0.233 for a square image, plus the prompt at the text rate. OpenAI's reference is inconsistent about whether Images API responses for `gpt-image-2` include `usage`, so usage is treated as optional; without it, the bound is recorded as spent. OpenAI's deprecations page names `gpt-image-2.5-sunburst` or `-flare` as gpt-image-1's replacement, but they publish no per-image prices or output-token counts. They have price evidence but stay refused until a documented or provider-enforced maximum cost/output bound is verified. A measured run with statistical headroom is insufficient; `scripts/qualify-image-model.mjs` is blocked (decision D8). Mocked checks pass (`check-live-spend.cjs`, "image model replacement"). It is **not live-qualified**: there is no OpenAI key in this environment. After one approved live run, set `MAKEBORNE_IMAGE_MODEL=gpt-image-2` (decision D8 in `RELEASE_DECISIONS.md`).

## Before each call

- **Text.** The bound is the input-token bound × the highest input rate (base or 5-minute cache write) × 1.1, plus `max_tokens` × the output rate × 1.1. Thinking is part of the output.
  - **First request:** counted with the free token-counting endpoint, plus 2% and 512 tokens. If counting fails, nothing is sent.
  - **Later requests:** the last reply's known input and output, plus 5%, plus the UTF-8 bytes of every message appended since. A token always covers at least one byte.
  - **Tool definitions:** included in the count, along with the tool-use system prompt.
- **`max_tokens` is shrunk** to what the remaining budget can pay for. Below the minimum step (2,048 tokens, or 4,096 for planning) the run stops gracefully and keeps its finished work, without contacting the provider.
- **Images.** The bound is (prompt bytes + 64) × the text rate, plus the table's output tokens × the output rate, × 1.1. It's reserved before the request, and images run concurrently after their bounds are reserved.

## Retries, fallback, partial and failed calls

- **SDK retries are off** (`maxRetries: 0`) for text and images. Retries happen in `budgetedStream`: at most 2, only before any output, for 429/529/5xx. Each attempt reserves its own bound from the same remaining budget, and waits honour `Retry-After` within the deadline.
- **Server-side fallback (`fallbacks: "default"`) was removed.**
  - Its targets aren't published, so their price can't be bounded.
  - Its declined attempt is billed separately, in `usage.iterations`, and the old code didn't count it.
  - Safety refusals now end the run as `REFUSED`, as before.
- **Explicit fallback models** can be set in `MAKEBORNE_BUILDER_FALLBACK_MODELS` (off by default). They're tried after the primary's retries, from the same budget, and must be priced.
- **Costs come from the provider's usage:**
  - **With `usage.iterations`:** each attempt is billed at its own model's rate. An unpriced serving model fails closed and is recorded at the bound.
  - **Rejected before processing** (400/401/403/404/413/429/529, no stream): costs 0.
  - **5xx, transport failure, abort, or a stream that started and then failed:** the reported part is confirmed, and the rest is recorded at the bound as uncertain.
  - **Image without reported usage, or failed with anything other than 429:** recorded at the bound.

Uncertain usage counts in full against the run's limits and in provider spend, never as zero. Only confirmed usage is charged to the customer.

## Two separate limits

- **Provider dollars:**
  - **Per run:** the effort ceiling (or the planning or review ceiling) at `aiCostUsdPerCredit`, independent of the customer's balance.
  - **Per day:** the database gate in `20261012140000_live_ai_spend.sql`, with a `global` limit and one per provider, enforced atomically for concurrent requests.
  - **Admins:** unlimited-credit admins are exempt from credit charges but **not** from either provider limit.
- **Customer credits:** the hold reserved before the run. A run's allowance is the smaller of the provider cap and the hold.
- **Overrun:** a call that costs more than its bound is recorded, stops the run, and stops its provider in the gate until an operator reviews and clears it.

## Settlement

- **Measured usage:** routes send the **full** measured usage (confirmed cost in credits) to `makeborne_credit_settle_run`. The database charges at most the hold. `credit_ledger` records the excess as `shortfall`, and `ai_run_outcomes` records it as `absorbed_credits`.
- **`ai_run_outcomes`** records, per run:
  - measured, charged and absorbed credits;
  - the provider cost from `live_provider_calls`, with unconfirmed cost at the bound;
  - an explicit outcome:
    - `settled`;
    - `replayed`;
    - `exempt`;
    - `missing_hold`: a billing fault, logged, nothing charged;
    - `released_hold`: already released or timed out, cannot be charged;
    - `released`: failed or cancelled; the measured usage is recorded as absorbed.
- **`reserveCredits`** returns a hold and fails on any anomaly. A run can't start without one.

## Hold lifetime (timing proof)

**Enforced timeouts:**

| Limit | Value | Where |
|---|---|---|
| Platform | 300 s (`maxDuration`) | route |
| Run deadline | ≤ 280 s after the request; and ≤ `reservedAt` + 900 s − 60 s (settlement window) − 30 s (clock skew) | `createRunSpend` |
| A step starts only with ≥ 45 s left | | builder loop |
| A call starts only with ≥ 30 s left | | `RunSpend.begin` |
| Each text call | hard timeout = min(600 s, time left to the run deadline), via an abort signal | `budgetedStream` |
| Token counting | min(30 s, time left) | builder loops |
| Each image | min(180 s, time left) | `startBudgetedImage` |
| Retries | ≤ 2, only before output; each wait ≤ 30 s, and never past the deadline | `budgetedStream` |

**Proof.**
1. `reservedAt` is read on the app clock **before** the reserve RPC. So `reservedAt` ≤ the hold's `created_at` + skew, where `created_at` is on the database clock.
2. Every provider call ends by `D = reservedAt + 900 s − 90 s`, enforced by its own timeout, retries included.
3. The hold expires at `created_at + 900 s` ≥ `reservedAt + 900 s − skew`.
4. So for any skew ≤ 30 s, at least 60 s remain after the last call ends, before the hold can be reclaimed. That window covers the hold check, the save and the settle.
5. With today's 300 s platform limit, the run is killed long before `D`. The proof matters if `maxDuration` is raised (for example to 800 s on Pro).

**If the bound is broken anyway** (larger skew, a stalled database):
- the pre-save hold check uses the database clock and refuses (`HOLD_EXPIRED`): nothing is saved or charged;
- a settle against a reclaimed hold returns `released_hold` and charges nothing;
- no call can start after `D`.

Tests:
- a call that crosses the deadline is aborted at the deadline, not when the provider finishes, recorded at its bound, and nothing starts after it;
- a website run whose hold is reclaimed during a later step saves and charges nothing.

## Day boundaries, instances and reconciliation

- **UTC days:**
  - A call is charged to the UTC day it **opened** on, even when it finishes after midnight.
  - A new day is a fresh allowance.
  - Tested by moving a call and its reservation to "yesterday".
- **Multiple app instances:** they share only the database gate. Tested with 8 users on 8 sessions against a limit for 3: exactly 3 admitted, with exact reservations. Each instance's per-run tracker is local, and the gate is authoritative.
- **Crashed calls:** expire at their bound after 20 minutes. Their reservation is released exactly once, by the expiry. A late usage report (app or operator, `reconcile_provider_call`) replaces the bound with the actual cost once (`reconciled`). Further reports are replays, and the reservation is never released again. Tested sequentially and as finish racing the sweeper.

## Customer-facing failures

- **Preflight before any credit hold:** `makeborne_provider_spend_status` returns only `paused` or `limit`, never amounts. A paused, stopped or exhausted gate answers with a retryable 503, with no hold and no charge:
  - `AI_PAUSED`: "AI generation is paused right now. Nothing was charged. Please try again later."
  - `AI_DAILY_LIMIT`
  - `AI_UNAVAILABLE`
- **Mid-run stops:** stream the same codes with `retryable: true` and release the hold. Measured usage is recorded as absorbed, not charged.
- **Operator diagnostics** (limits, amounts, stop notes) are only in the database and in `ai_spend_stop` server logs.

- **15 minutes:** holds are reclaimed after this. Runs are capped at `maxDuration` 300 s minus 20 s.
- **Stop starting calls:** at the earlier of the platform deadline and the hold's end minus 90 s.
- **Before saving:** the run checks `makeborne_credit_hold_status`. A reclaimed hold means nothing is saved or charged (`HOLD_EXPIRED`).
- **After a reclaim:** a settle returns `released_hold`. A reclaimed hold is never spent.
- **Killed processes:** the hold is reclaimed by the next wallet write or the reconcile job. The open provider calls expire at their bound after 20 minutes (`makeborne_provider_calls_expire`, also run by the reconcile job).
- **Continuation requests** ("Ask me to continue") and client retries are new requests. Each gets its own hold and bounds, and a revision conflict releases the hold.

## Operating it

### Proposed launch growth policy — owner steering 2026-10-14

The owner wants the launch cap to depend on demand. Prepare cap reviews using verified active paying accounts, their measured provider usage, outstanding paid-credit obligations and the available operating budget. Forecast the next day's demand from that evidence, allow explicitly reviewed headroom, and retain a separate hard maximum. Exclude pending/unverified purchases when estimating funded demand. Customer holds, per-run bounds, admin provider limits and the existing total testing budget remain independent controls.

No numeric launch ceiling was selected by this answer. It authorizes demand-based planning, not production activation or automatic cap increases. The current implementation uses owner-set daily gates; an automatic adjustment controller and related alerts have not been implemented or qualified. Choose the initial hard ceiling during the release review, then increase it as observed paid demand and margins justify it. Current activation remains held.

- **Off by default:** all three limit rows ship disabled with a zero limit, so every live call fails closed ("AI generation is paused"). That includes local development and any deployment.
- **To enable:** as the database owner, run:

  ```sql
  select makeborne_private.set_live_provider_limit('global', true, <daily micro-USD>, false, '<reason>');
  ```

  For text features, configure both `global` and `anthropic` with the approved daily caps. Keep `openai` disabled until the required image model is qualified and its cap approved. Pass `true` as the fourth argument only to clear an overrun stop after review. Do not activate production during a local rehearsal; daily caps do not replace the separately recorded total testing budget.
- **Health:** `select public.makeborne_provider_spend_health();` shows today's spend and reservations per scope, stops, open and stale calls, overruns, and uncertain spend.

## Tests

| Check | Where | What |
|---|---|---|
| `src/lib/ai/check-live-spend.cjs` | offline (`npm test`) | 27 checks (adds: pricing evidence and durable tariff agreement, refused configurations, model mismatch, call crossing the hold deadline, reclaimed hold during a run, customer-facing stop messages) with mocked providers and billing: verified prices and fail-closed, per-attempt fallback billing, caps, uncertain usage, overrun, retries and fallback sharing a budget, partial stream failure, unpriced fallback, images, website runs (expensive output, low balance, interruption, images, hold reclaimed before save, hold lifetime, admin exemption, provider limit, missing/released holds, concurrency), document and plan runs, structure |
| `supabase/check-live-ai-spend.sql` | local DB, rolled back | gate fails closed; global and provider daily limits; idempotency; actual, uncertain, overrun and expired calls; UTC day boundary; late reconciliation once; operator reconciliation; preflight status; run outcomes; privileges |
| `supabase/check-generation-caps.sql` | local DB, rolled back | durable dispatch refused atomically by a disabled or exhausted shared gate; durable settlement closes its gate call |
| `supabase/check-live-ai-spend-concurrency.sql` | **disposable DB** | 8 users on 8 sessions against a limit for 3; finish racing the sweeper |
| `supabase/check-live-spend-e2e.cjs` | **disposable DB** | real website run module + real credit functions + real gate, mocked providers: disabled gate, success, killed run recovered, hold reclaimed mid-run, concurrent runs |

## Limitations

- **Prices are a manual card.** Re-verify on provider price changes and reconcile against invoices. Token-to-byte bounds assume no tokenizer emits zero-byte tokens.
- **Image bounds for `gpt-image-1` use the guide's medium-quality token table.** The actual usage reported by the API is what gets recorded.
- **Removing server-side fallback** means refused requests are not rerouted. An explicit, priced fallback list is available.
- **Uncertain usage is absorbed (not charged),** which lowers margins. Monitor `uncertainTodayMicrousd`.
- **Daily limits are UTC days and per platform,** not per customer. Per-customer rate limits are not part of this step.
- **Durable generation workers** keep their own tariffs and cumulative caps; the shared daily gate now applies on top. Durable tariffs price only input and output tokens (no cache), as before.

## Independent review correction — 2026-10-13

The Sunburst/Flare qualification script is disabled before reading credentials or contacting the provider. Sample counts multiplied by headroom cannot guarantee the approved spending cap. Another model's image counts cannot bound these models either (the provider explicitly says its GPT Image 2 calculator does not estimate 2.5 consumption). Do not populate measured output counts to enable production. Require a documented maximum or provider-enforced per-call limit before paid qualification. Images remain off.

Source: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst

## Lead/search spending correction — 2026-10-14

Anthropic web search remains priced for historical usage but new server-search calls are refused. The provider documents max_uses as a search-count cap, and bills search-result input tokens throughout internal iterations; no guaranteed result-token ceiling is documented. The former 20,000-token observed allowance was not a conservative maximum. Creator discovery and local look-alike discovery are unavailable; map and pasted-list finding remain available, with web fallback disabled.

Lead settlement adds delivered leads at 0.2 credits each and exact confirmed provider microdollars at the ranking/search conversion rates, then rounds the entire total up once to a whole credit. No-lead runs release the hold and absorb provider spending. Unknown usage still consumes its full bound and is recorded as uncertain provider cost; only confirmed usage is chargeable. Results are emitted only after a successful settled/replayed/exempt outcome; missing or expired holds return a retryable failure. Ambiguous settlement failures withhold results and ask the user to check their balance before retrying, because a lost RPC response does not prove no charge. Haiku prompts over 100,000 input tokens reserve all token categories at the 5x tier, including output.

Sources: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool and https://platform.claude.com/docs/en/about-claude/pricing
