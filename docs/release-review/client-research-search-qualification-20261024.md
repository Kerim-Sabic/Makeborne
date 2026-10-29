# Client research: web search qualification and assisted-research live plan, 24 October 2026

Status: **not run**. No budget is approved for this work. Everything below is a plan with cost estimates. The research flow itself is verified offline only (`src/lib/research/check-research.cjs`, `supabase/check-client-research.sql`).

## Current configuration (kept as it is)

- Web search is **refused**. `assertWebSearchTool` in `src/lib/ai/prices.ts` throws for every web-search request: "no documented or provider-enforced billable result-token ceiling". The lead finder's creator/similar modes return 503 and `discoveryAvailable` is false. This branch does not change any of that.
- The research flow has a search seam, `src/lib/research/search.ts`, and it asks through the same refusal (`serverToolBoundMicrousd`). It answers `SEARCH_NOT_QUALIFIED`. If that refusal were ever lifted, the seam would still answer `SEARCH_NOT_WIRED`. Enabling search needs a reviewed change to that file, and the change must pass the tests below first.
- Every brief says it was not searched. Competitors come only from links the person supplies. Time-sensitive facts come only from the client's own pages, which are read at a recorded time.

## Official documentation (read 2026-10-24, platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

- Versions: `web_search_20250305` (basic), `web_search_20260209` (adds dynamic filtering through code execution) and `web_search_20260318` (adds `response_inclusion`). Our price card names only `web_search_20250305` on `claude-haiku-5-5`.
- Parameters: `max_uses`, `allowed_domains` / `blocked_domains` (use one, not both), `user_location`, `allowed_callers`, and on 20260318 `response_inclusion`. **No parameter limits result tokens or content per search.**
- Pricing: $10 per 1,000 searches, plus standard token costs. Search results count as input tokens in the turn and in later turns. An errored search is not billed.
- Usage: `usage.server_tool_use.web_search_requests`. Errors come back inside a 200 response as `web_search_tool_result_error` with one of these codes: `too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large` or `unavailable`. A long turn can stop with `pause_turn`. Results carry `encrypted_content`, and continuing a conversation means sending that back unchanged.
- On 20260209 and later, `allowed_callers` defaults to code execution. Direct calls need `["direct"]`. Models without programmatic tool calling return 400 unless that is set.

## What must be proven before web search can be enabled for research

Each item needs recorded evidence: request digest, raw usage, model and tool version, and date. Any one failure keeps search refused.

1. **Pricing.**
   - The price card gets an entry for the exact tool version and model.
   - Measured usage must reconcile with the provider's billing export to within 1% across the qualification runs.
   - Reconciliation covers input tokens from results, `web_search_requests` and any code-execution tokens on 20260209+.
2. **Usage shape.**
   - Distribution of result-token cost per search: n ≥ 40 searches across 4 query types (competitor discovery, local business lookup, news or recency, a niche or long-tail query), on `max_uses: 1` and `max_uses: 3`.
   - Record p50, p95 and p99 input tokens added per search.
   - Record how many results came back, and confirm that `allowed_domains`/`blocked_domains` change the count.
3. **Result-token ceiling (the blocker).** One of these must hold:
   - (a) the provider documents or enforces a maximum on billable result tokens per search or per request; or
   - (b) we can enforce one ourselves before the cost is incurred, for example by having a priced, separately metered step fetch a bounded number of URLs through our own fetcher (`publicTarget`/`pinnedFetcher`, ≤ 600 KB per page), so search only returns URLs.
   - An empirical p99 × margin is **not** a bound and does not qualify (same rule as `prices.ts:91`, "An estimate is not a bound").
4. **Compatibility.**
   - The tool version and model pair is accepted (`capabilities.server_tools.web_search.supported`).
   - With `allowed_callers: ["direct"]`, the response matches what `budgetedStream` and `ContextMeter` handle: `server_tool_use` blocks, `web_search_tool_result`, citations and `pause_turn`.
   - `encrypted_content` round-trips across our loop's turns.
   - Organisation-level disablement returns a clean 400, mapped to a customer-safe "not available".
   - A **newer tool version** (20260209/20260318) is a separate qualification. Dynamic filtering adds code execution, which needs its own price evidence and its own failure handling.
5. **Failure tests**, each verified to reserve, record and settle correctly with no retry and the customer charged only confirmed usage:
   - `too_many_requests`, `max_uses_exceeded`, `query_too_long`, `request_too_large`, `unavailable`;
   - a timeout after the request was sent (uncertain attempt);
   - `pause_turn` at the step limit;
   - a search that returns injected instructions in result text (must stay data);
   - a result naming a private or internal URL (must never be fetched);
   - two concurrent research requests on one action key (one charge).
6. **Research-specific checks.** Search results become citable only as `url` sources with a fetched time. Facts still need a word-for-word quote from a page we read ourselves under the guard rails. Search snippets alone stay inferences.

**Cost of the search qualification** (only once 3 is solvable):
- Searches: 40 × $0.01 = $0.40.
- Result tokens on Haiku 5.5 ($0.10 / $0.50 per million, ×1.1 US inference, ×5 above 100k tokens): about 5–15k input tokens per search, so ≈ $0.07–$0.33 in total below the 100k tier.
- A few turns to exercise the failures: ≈ $0.10.
- Total: **≈ $0.60–$0.85 expected, cap $2**. The search half of this plan is **blocked on item 3**, not on money.

## Assisted research (the model writing the brief), live qualification

Today `AGENCY_SETTINGS` qualifies no kind, so `research` is refused. The route then writes the brief deterministically from the sources, with no AI writing and no charge.

Fixtures are generated in the harness and served from a local fixture server. A live model call is the only external request, and it uses no customer data. There are 12 fixture sets:
- 4 ordinary small-business sites;
- 2 with prompt injection (hidden and visible);
- 2 conflicting identities (same name, different site; a document for another branch);
- 1 mostly inaccessible (403, robots, sign-in);
- 1 with stated figures (subscriber count, revenue in a supplied document);
- 1 with competitors supplied;
- 1 with saved knowledge plus documents covering the offering.

Pass criteria (all needed before `qualifiedKinds` may include `research`):
- every stored fact cites a source the server could resolve;
- at least 90% of the facts the model submitted survive grounding;
- no invented revenue, follower or demographic claim survives, and the guard removes any that are attempted;
- the injected text never appears as a claim, and the model never asks for a tool it does not have;
- identity conflicts are reported;
- recommendations name a supported deliverable with a business reason tied to cited claims;
- schema-valid output on the first turn in ≥ 11 of 12 runs;
- measured cost within the bound below;
- replay of the same action key makes no second call.

Cost estimate, on the Opus 5.5 price card ($4 / $20 per million input / output tokens, ×1.1 US inference):
- Per brief: about 10–14k input tokens (bounded at 120,000 characters of source text, about 30k tokens, plus ~3k of system and result schema) and 2.5–4k output tokens. That is **≈ $0.12–0.15 expected per brief, ≤ $0.33 per turn** at the 8,000-token output bound. With at most 3 turns (invalid results are refused after 2 tries), the ceiling is ≤ $1.
- Plan: 12 runs + 3 Stop/replay checks ≈ **$2 expected, cap $4.50** (Anthropic). It needs an owner-approved ledger entry first.

## Live qualification still outstanding (summary)

| Item | Blocked on | Estimate | Cap |
|---|---|---|---|
| Web search for research | a result-token ceiling (item 3); then budget | $0.60–0.85 | $2 |
| Assisted brief writing (`research` kind) | budget approval | ≈ $2 | $4.50 |
