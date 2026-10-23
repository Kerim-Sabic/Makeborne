# Vendor docs and whitepapers on cost-versus-quality control for LLM agents (as of 23 October 2026)

Scope: what Anthropic, OpenAI and Google officially recommend and have measured about model choice, reasoning effort, caching, budgets and multi-model patterns, with the exact figures, for Makeborne's model orchestrator. Makeborne runs agent loops on the Anthropic API that write and edit React and CSS files, using Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5.

Notes on the sources:
- Most Anthropic figures come from one page, "Optimizing for cost and intelligence" (platform.claude.com). Anthropic calls them internal and directional, priced at list prices when each run happened. The runs are dated August to October 2026. Opus 5.5 SWE-bench Pro runs are from 19–20 Sep 2026. Sonnet 5.5 runs are from 24 Sep 2026, on a pre-release build. The cache-break test is from 20 Oct 2026.
- Pages were read with a fetch tool that summarizes long pages. Where I could, I checked the exact wording against the saved raw page text (the reference section of the cost guide and the Claude Code caching page). Figures marked "(summary)" came only through the summarizer.
- Model names are reported exactly as each vendor's page gives them. Anthropic pages also name Claude Fable 5.1, Fable 5, Mythos 5.1, Mythos 5, Opus 5, Sonnet 5 and the 4.x models. OpenAI pages name gpt-5.5, gpt-5.6-terra, gpt-5.6-luna, gpt-6-astra, GPT-6 Sol, GPT-6.1 Sol and GPT-6 Luna. Google pages name gemini-4-argon, gemini-3.8-flash, gemini-3.6-flash, gemini-3.5-flash-lite, gemini-3.1-pro-preview and others.

---

## Anthropic: what the official docs, engineering posts and guides recommend and have measured

### Takeaway
Anthropic's guidance is consistent across its pages:
- Turn on caching first. It is the largest lever: a well-built loop reads a median 84% of input from cache.
- Never break the cache mid-conversation. Each model has its own cache. A system-prompt edit or top-level effort change costs 20–50x a cache-safe alternative.
- Compare models on cost per solved task, not per token. Sonnet 5.5 at `high` and Opus 5.5 at `low` tie at about $0.11–0.12 per solved task on a SWE-bench Pro subset.
- Tune effort before switching models.
- When outputs are checkable, run at `low` and re-run failures at `high`. This was about 40% cheaper than everything at `high`, at the same or a better pass rate.
- Build a multi-model setup (advisor or orchestrator) only if it beats the single model's whole score-versus-cost curve. The measured advisor results are mixed.

### Cited Findings

#### A. "Optimizing for cost and intelligence" guide: framing and decision table
- The guide splits levers into two groups. "Free wins" do not change quality: prompt caching, token hygiene, prompt audits, batch processing (50% off, results within 24 h) and workspace spend limits. "Tradeoffs" exchange cost for intelligence: model choice, effort, output caps and session budgets, elapsed-time signals, and multi-model setups. "Prompt caching was usually the largest lever" in Anthropic's measurements. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Rows from the decision table:
  - Costs too high but quality fine: try lower effort on the current model.
  - Not on the latest model: upgrade. "Each newer model solved at least as many tasks as the one before, usually for less per solved task."
  - Choosing or switching models: "Compare on cost per completed task, not per token."
  - High-volume work with checkable outputs: try Haiku 5.5 first.
  - Quality not good enough: restore lowered effort, or try the next tier up at its default effort.
  - Outputs checkable: run at `low` and re-run failures at `high`, about 40% lower cost than all-`high` at the same pass rate.
  - Cheaper model stalls on hard decisions: try an advisor, measuring the consult rate first.
  - Work exceeds one context window: split it and hand parts to lower-cost models.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Per-token comparisons are misleading. "The same text costs about 30% more tokens on Claude 4.7 and later," so per-token comparisons make newer models look more expensive by construction. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Price the tail, not the median.** In a 20-problem WideSearch run, two problems carried 43% of spend and the cheapest half carried 10%. "Failed tasks still bill tokens, then retries, then downstream costs." — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Measurement method:
  1. Pull tasks from production logs, weighted like real traffic, and write outcome checks.
  2. Record cost per task beside the score.
  3. Baseline each model tier across effort levels and plot score against spend. A multi-model setup must beat the single model's whole curve.
  4. Shadow-run the winner on a traffic slice before cutover, and keep the suite running.

  Pricing a task means summing five priced usage counts: uncached input, 5-minute writes (1.25x), 1-hour writes (2x), cache reads and output. Advisor and compaction tokens appear only in `usage.iterations`. Haiku 5.5 requests must be priced at the rate for their own prompt length. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- The `/claude-api cost-optimize` and `/claude-api hillclimb` commands automate the search. In one tau2-bench retail search on earlier models, the savings came from lowering effort and moving down a tier: Sonnet 5 at `low` was 61% cheaper than the Opus 5 starting point, within 2 points. Prompt edits brought no durable gain. Anthropic advises holding out a split the search never reads, and repeating the baseline first because identical runs differed by several tasks. — [Optimizing for cost and intelligence (reference section)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Lever summary rows:
  - Ask for shorter answers: about 13% less cost, from 39% fewer output tokens, with no quality change.
  - Raise `max_tokens`: cost per solved task about the same, and up to 22 more points of tasks solved on one coding benchmark.
  - Advisor: about 2.1x the cost of the model alone on coding.
  - Orchestrator: about half the cost on work larger than one context window, but 10–12 points lower.

  — [Optimizing for cost and intelligence (lever table)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)

#### B. Model choice: cost per solved task (SWE-bench Pro subset, 478 problems)

| Model | Effort | Score | Cost |
|---|---|---|---|
| Sonnet 5.5 | `high` (default) | 87.6% solved | $0.11 per solved task |
| Opus 5.5 | `low` | 87.4% | $0.12 per solved task |
| Opus 5.5 | `medium` (default) | 92.8% | $0.22 per solved task ($0.21 per task) |
| Fable 5.1 | `high` (default) | 92.3% (single run) | $1.19 per solved task |

— [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)

- Anthropic says to start with Opus 5.5 at its default `medium` for most agent work: "A stronger model can finish with less work, offsetting its per-token premium." — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Opus 5.5 at `low` matched Sonnet 5.5 at default within noise, for about 7% more per solved task, even though Opus's token prices are twice Sonnet's. Opus 5.5 at `low` did less work per task: a little over half of Sonnet 5.5's output tokens and a little over a third of its cache reads. At their defaults, Opus 5.5 `medium` solved about 5 points more than Sonnet 5.5 for about twice the cost. — [Optimizing for cost and intelligence (refs)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Opus 5.5 at default matched Fable 5.1 at default on SWE-bench Pro, within noise, for about a fifth of the cost per solved task. Both largely saturate the subset. Fable 5.1 is for demanding reasoning, long-horizon agentic work, or cases where Opus 5.5 at higher effort still falls short. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Internal agentic-coding benchmark: Opus 5.5 `medium` scored 86.6% at $0.84 per attempt. Fable 5.1 `medium` scored 84.2% at $2.68 per attempt. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- GPQA Diamond: Haiku 5.5 `medium` scored 85%, against 91% for Opus 5.5 and 91% for Sonnet 5.5. Haiku costs about 1/20 of Opus 5.5 per correct answer and 1/10 of Sonnet 5.5. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Claude Managed Agents task set (79 tasks), Haiku 5.5 `medium`:
  - 93% of attempts passed, at about $0.011 per passed attempt. Haiku 4.5 passed 62%, and Haiku 5.5 cost about 84% less per passed attempt. Repeat runs on 8–9 Oct gave Haiku 5.5 91–93%.
  - Haiku 5.5 used thinking in 59% of requests, against 22% for Haiku 4.5.
  - About 5% of Haiku 5.5's requests had prompts over 100,000 tokens, and they carried 73% of its cost.
  - Haiku 4.5 did not cache 80% of its requests because its minimum cacheable length is 4,096 tokens. Haiku 5.5's is 512.

  — [Optimizing for cost and intelligence (ref 25)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Upgrade results:
  - Sonnet 5 → Sonnet 5.5: about 10 more points, 87% less per solved task.
  - Opus 5 → Opus 5.5: 91.9% → 92.8%, 78% less per solved task.
  - Haiku 4.5 → Haiku 5.5: 62% → 93% passed, about 84% less per passed attempt.
  - Publicly stated: Opus 5 → 5.5 saves 40% on typical workloads, and Sonnet 5 → 5.5 saves up to 30% on most work.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Caveat: newer is not always cheaper. On DeepResearch Bench II, Fable 5.1 costs more per task than Fable 5 (+46% at `high`) because it does more work, despite identical input/output prices and a 4x cheaper cache read. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Model selection matrix: "Most workloads start with Claude Opus 5.5."
  - Fable 5.1: the highest capability.
  - Opus 5.5: complex agentic coding, large refactors, vision-heavy work, computer use.
  - Sonnet 5.5: everyday coding and agent work, code generation, content creation.
  - Haiku 5.5: the lowest latency and price, including "subagent tasks."

  "Tuning effort is often a better lever than switching models." The guide gives two ways to start: efficiency-first (Haiku 5.5, then upgrade only for capability gaps) or capability-first (Opus 5.5, then lower effort or downgrade). — [Choosing the right model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)
- Breaking changes on Opus 5.5:
  - Integrations that force tool use (`tool_choice` of `any`/`tool`) or turn thinking off must read the breaking changes before switching. — [Choosing the right model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)
  - Executors on Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject `tool_choice` types `tool` and `any`. Use a prompt nudge instead. — [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool)
- Prices on the caching page:

  | Model | Input | Output | Cache read | 5m write | 1h write |
  |---|---|---|---|---|---|
  | Opus 5.5 | $4 | $20 | $0.20 (0.05x) | $5 | $8 |
  | Sonnet 5.5 | $2 | $10 | $0.10 (0.05x) | $2.50 | $4 |
  | Haiku 5.5, prompts ≤100K tokens | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 |
  | Haiku 5.5, prompts >100K tokens | $0.50 | $2.50 | $0.05 | $0.625 | $1 |

  Sonnet 5.5's cache read launched at $0.20 and is now $0.10. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); [cost guide refs](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Haiku 5.5 long-context cliff: "compact before requests pass 100,000 prompt tokens. Over that, every token costs 5x, output included. Cache reads and writes count toward the 100,000." — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Output tokens cost 5x input tokens on Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1, and every output token comes back as input on later turns. Triage agent, three final-answer formats: one-line $0.49 per run, two-line $0.57, six-section memo $1.40. All three were 78–85% correct, within noise. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)

#### C. Effort parameter: levels, defaults and measured curves
- Levels are `low`, `medium`, `high`, `xhigh` and `max`. Opus 5.5, Sonnet 5.5 and Haiku 5.5 support all five.
- Defaults: `medium` on Opus 5.5 and Haiku 5.5, `high` on Sonnet 5.5 and most other models. Setting effort to the model's default is identical to omitting it.
- Effort affects all output tokens: text, tool calls and thinking. Lower effort means fewer and terser tool calls.
- "Effort is a behavioral signal, not a strict token budget."

  — [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- Per-model recommendations:
  - **Opus 5.5:** adaptive thinking is always on and can't be turned off; `thinking: disabled` returns 400. Run a fresh effort sweep and set a large `max_tokens` at higher levels.
  - **Sonnet 5.5:** levels are recalibrated against Sonnet 5. For agentic coding, start at `medium` for well-specified tasks and `high` for harder or longer ones. Use `xhigh`/`max` only where evals show a gain. Set `max_tokens` to 128,000 for agentic coding and stream. `thinking: {"type":"between_tools"}` is the lowest thinking setting and works only at `high` or below.
  - **Haiku 5.5:** start at `medium`, including for agentic coding. Use `low` for chat, short tool tasks and simple high-volume requests. "In long agent prompts, the model is more likely to skip a search, stop early, or skip a check at `low`." Use `high` for knowledge work, longer agent tasks and strict instruction following. Compare `xhigh`/`max` against Sonnet 5.5.

  — [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- Opus 5.5 effort curve on SWE-bench Pro:

  | Effort | Score | Cost per task | Against `high` |
  |---|---|---|---|
  | `low` | 87.4% | $0.11 | about 8 points lower for about 1/3 the cost |
  | `medium` | 92.8% | $0.21 | about 2.5 points lower for about 70% of the cost |
  | `high` | 95.3% | $0.29 | — |
  | `xhigh` | 96.7% (one run) | $0.74 | about 1.4 points higher for 2.5x the cost |

  — [Optimizing for cost and intelligence + refs](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Sonnet 5.5 `medium` against `high` on SWE-bench Pro (2 runs each): about 7 points lower for about 59% of the cost per task. On the internal agentic-coding benchmark: 62.7% against 77.8%. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Opus 5.5 at `low` against `medium`: the typical task took 84% less time on DRACO (score 13.3 points lower), 30% less on HLE (3.4 lower) and 47% less on an internal physics set (14.0 lower). — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Fable 5.1 on DeepResearch Bench II: almost the same rubric score from `low` (66%, $4.48) to `high` (65%, $6.89). "Higher effort bought cost, not score." Fable 5 on WideSearch, DeepWideSearch, BrowseComp and GDPval: `low` gave up 1–3 points for a third to a half off the cost per task, `medium` matched the default at about 70–87% of its cost, and the default bought nothing measurable over `medium`. — [Optimizing for cost and intelligence (+ref 1)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Sweep two or three effort levels on a traffic sample, each in a **separate session**. Changing top-level effort mid-session invalidates the cache and distorts the comparison. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Per-message effort (beta)** keeps the cache. It needs the header `mid-conversation-output-config-2026-07-01` and is available on the Claude API for Fable 5.1, Mythos 5.1, Opus 5.5, Opus 5, Sonnet 5.5 and Haiku 5.5. You send a `role: "system"` message with empty content and `output_config.effort`, and the level holds until changed again. A change placed after a tool_result-only user turn waits for the next user turn with new input. It is not allowed with Sonnet 5.5 `between_tools` or Haiku 5.5 `thinking: disabled`, where a differing per-message effort returns 400. A top-level change "restarts the cache." — [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- Best practice from the effort page: "Consider dynamic effort" by task complexity, but "hold top-level effort constant within cached conversations." — [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- Lance Martin's blog post (8 Sep 2026, updated for Opus 5.5) reports:
  - Fable 5 on FrontierCode Diamond: 11.5% at `low` ($5.35/task) against 30.9% at `max` ($19.00/task).
  - Fable 5.1 on HLE: about 53% at `low` (about $0.30/question) against about 61% at `max` (about $2.23). The last step added about half a point for 46% more cost, within noise.
  - Its advice: test stronger models at lower effort, and treat a flat cost/score curve as a sign that extra thinking won't help.

  — [Reducing cost and improving performance with Claude Platform](https://claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform)

#### D. "Run low, re-run failures high"

| Policy (Opus 5.5, SWE-bench Pro) | Tasks solved | Cost per task |
|---|---|---|
| `low`, failures re-run at `high` | 96.4–97.5% | about $0.17 |
| `medium`, failures re-run at `high` | 96.0–97.1% | about $0.24 |
| `high`, failures re-run at `high` | 96.9% | $0.31 |
| Everything at `high` | 94.8–95.8% | $0.29 |

At `low`, 13% of tasks failed. "Most of the small quality lift comes from the second attempt, not the higher effort." The policy needs two conditions: "a reliable failure signal (a checker that passes bad work lets failures through)," and acceptance that each first-pass failure takes two runs' worth of wall-clock time. — [Optimizing for cost and intelligence + ref 3](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)

#### E. Budgets and output caps
- **Task budgets (beta):**
  - Header `task-budgets-2026-03-13`, set as `output_config.task_budget: {type:"tokens", total, remaining?}`. Supported on Haiku 5.5, Sonnet 5.5, Opus 5.5 and others. Not on Sonnet 5 or Claude Code.
  - The model sees a server-side countdown covering one agentic turn: thinking, tool calls, tool results and output. It is advisory, "a soft hint, not a hard cap," and `max_tokens` remains the enforced limit.
  - The minimum total is 20,000 tokens. Size the budget from the p99 of measured per-task spend.
  - "A budget that is too small for the task can cause refusal-like behavior": the model may decline, scope down aggressively or stop early.
  - Changing the budget value invalidates the cache, so set it once and let the model self-regulate.
  - Effort tunes depth and task budgets tune breadth.

  — [Task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets)
- **Managed Agents session budgets:** a dollar cap on one session's list cost, covering tokens, web searches and runtime. At the cap the session pauses with `stop_reason: budget_reached`. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **`max_tokens`:** the cap is invisible to the model, so lowering it does not make the model economize. Cut-off turns are discarded but still billed. Recommended values are 64,000 for agentic work and 128,000 when a cut-off is costly. Treat `stop_reason: max_tokens` as a failure.

  Opus 5.5 on a repository-task benchmark:

  | `max_tokens` | Attempts cut off | Tasks solved | Cost per solved task |
  |---|---|---|---|
  | 16,384 | 25% | 57.6% | $5.38 |
  | 64,000 | 0% | 75.6% | $5.38 |
  | 128,000 | 0% | 68.9% | $5.94 |

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Elapsed-time signals:** telling the agent that time matters and showing elapsed time cut the median DRACO task (Opus 5.5 `medium`) by 47% in time and 60% in cost, with the average score 4.1 points lower. Time fell 14% on HLE and 7% on the physics set, where the score was 3.0 points lower. Lowering effort to `low` saved more but lost more score. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- The Opus 5.5 guide suggests appending `elapsed 340s / 1200s` to each harness message, or adding the line "Time matters here...". The budget is advisory, so keep your own timeout. — [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)

#### F. Prompt caching: mechanics, TTLs and what breaks it
- **Two modes:**
  - Automatic caching: one top-level `cache_control: {type:"ephemeral"}` moves the breakpoint forward as the conversation grows.
  - Explicit breakpoints: up to 4 per request. Automatic caching uses one of the 4 slots.

  Cache order is tools → system → messages. Reads look back up to **20 blocks** from a breakpoint, so a conversation that grows 20+ blocks past the last write needs a second breakpoint. Breakpoints themselves cost nothing. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- In Anthropic's test, one breakpoint on the system block plus one on each of the two most recent user turns worked well. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Pricing and sizes:**
  - Writes cost 1.25x input for 5 minutes and 2x for 1 hour. Reads cost 0.05x on Opus 5.5 and Sonnet 5.5, and 0.1x on Haiku 5.5.
  - The 5-minute TTL refreshes free on each use and is measured from the start of the request, so streaming time counts.
  - Minimum cacheable length is 512 tokens for Opus 5.5, Sonnet 5.5 and Haiku 5.5. Shorter prompts silently don't cache.
  - An entry is available only after the first response starts. Wait before fanning out parallel requests that need a hit.

  — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **What good looks like:** over a day of real traffic, agent loops read a median 84% of input from cache, and the top 10% read 94%+. "Below about 80%, look for something breaking the cache." Task cost grows roughly with the square of turn count, since a 40-turn task sends its first turn 40 times. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Cost multiplier without caching:**
  - Opus 5.5 on SWE-bench Pro: 3.3x.
  - Sonnet 5.5 on SWE-bench Pro: 3.1x.
  - Haiku 5.5 on short Managed Agents sessions: 1.7x.
  - Sonnet 5.5 triage agent: 7.3x.
  - DeepResearch Bench II: Fable 5.1 went from $37.94 to $6.89 per task with caching, and Sonnet 5 from $3.20 to $1.18.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **What invalidates which layer:**
  - Tool definitions invalidate everything.
  - `tool_choice` and images invalidate messages only.
  - Thinking parameters and `output_config.effort` are model-specific, but always invalidate the message layer.
  - Dropped thinking blocks on the 5.5 models invalidate messages.
  - Mid-conversation `role:"system"` messages do not invalidate on Opus 5.5, Sonnet 5.5 or Haiku 5.5. Tools can be added mid-conversation with the `inline-tools-2026-09-15` beta (`tool_addition` block).

  — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Measured cost of a mid-conversation change** (20 Oct 2026, about 101,000-token cached conversation):
  - A system-prompt edit cost 25–50x the same text as a mid-conversation system message.
  - A top-level effort change cost 20–40x a per-message change. It read the 20K system prompt and re-wrote 81K tokens.
  - Prompt-side cost of one request:

    | Model | System-prompt edit | System message | Top-level effort change | Per-message effort change |
    |---|---|---|---|---|
    | Opus 5.5 | $0.50 | $0.020 | $0.41 | $0.020 |
    | Sonnet 5.5 | $0.25 | $0.010 | $0.20 | $0.010 |
    | Haiku 5.5 (above 100K) | $0.063 | — | $0.052 | $0.005 (unchanged read) |

  - A 25-token per-request status line at the front of the system prompt forced a full rewrite of all 101K tokens. At the end of the newest user turn it kept the read intact.

  — [Optimizing for cost and intelligence (+ref)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Hard API constraint:** on accounts created on or after 31 Aug 2026 00:00 UTC, a request to Fable 5.1, Opus 5.5, Sonnet 5.5 or Haiku 5.5 that sends earlier thinking blocks back gets a 400 error by default if it changes `system`, `tools` or a message before one of them (the "prefix check"). — [Optimizing for cost and intelligence (ref)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence). The Haiku guide warns the same way: add new system-prompt text to new conversations only. — [Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
- **When to make a cache-breaking change:** triage agent on Sonnet 5, 5 sessions per arm. No change cost $0.81 per session. The same two cache-breaking changes (to default effort, plus one added tool) cost $0.95 when made mid-session at requests 12 and 17, and $0.75 when made together on the first request after compaction. Accuracy stayed within noise. Advice: make invalidating changes "at natural breaks, such as the first request after compaction." — [Optimizing for cost and intelligence (+ref)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence). The blog says the same: "Change model or effort when the cache will already break, such as during compaction." — [Lance Martin blog](https://claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform)
- **Choosing a TTL:**
  - Use the 1-hour cache when about 1 turn in 20 follows a 5–60-minute pause. Break-even is about 1 in 30 on Sonnet 5.5 and Opus 5.5.
  - For turns seconds apart, the 5-minute default is about 15–19% cheaper than 1-hour.
  - At 1 in 10 paused turns, the 5-minute setting cost 54% more.
  - Keep-alive trick: re-send the identical request with `max_tokens: 0` within 4 minutes of the last request's start. It saved 8–13% (Opus 5.5) and 8–16% (Sonnet 5.5) against 1-hour, but only with 1–2 gaps in 20. On Haiku 5.5 use the "Any" rows, because its 0.1x cache read makes keep-alive pings relatively twice as costly. A `max_tokens: 0` request is rejected with forced tool choice, structured outputs, `thinking.type: enabled` or top-level `compaction`.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence); [Prompt caching (pre-warming)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Caches are isolated per organization, and per workspace on the Claude API. — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

#### G. Switching models mid-conversation (official)
- "Each model has its own cache. Switching models recomputes the entire request even when the content is identical." After a switch, "the next request reads the entire conversation history with no cache hits." Within an organization or workspace, "any two requests with the same model and prefix read the same cache." — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- Several Claude Code features count as model switches for caching: the `opusplan` setting (Opus while planning, Sonnet while executing), automatic safety fallback to another model, and a skill whose frontmatter names a different `model`. Each starts a fresh cache. — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- On effort: "on most models, each effort level has its own cache." On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 with an API key, Claude Code changes effort without breaking the cache, using per-message effort. Claude Code's advice: "Pick your model and effort level at the top of a session." — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- **Subagents** start their own conversation and warm their own cache, and the parent's cache is unaffected. A **fork** inherits the parent's prefix and reads its cache. For a workflow fan-out of same-prefix agents, Claude Code holds all but the first for up to 5 s so they can read the first agent's cached prefix. — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- The advisor tool's definition sits after the cache breakpoint, so toggling `/advisor` keeps the cached prefix. — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- The cost guide gives no specific measurement of a model switch. Its cache-break figures (above) are the closest proxy. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) (summary)

#### H. Context editing, compaction and token hygiene
- **Context levers:**
  - Pruning and compaction help on long runs. On a long run (2.6x tokens), pruning cut cost 39% and compaction 32%. Context editing changed nothing there and added 73% on the short run.
  - On Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5, rewriting an earlier tool result invalidates every later thinking block, so "use compaction instead of pruning." Server-side context editing and compaction don't invalidate thinking blocks.
  - If you use context editing, clear in a few large batches.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Input trimming:**
  - Tool search with deferred loading: with 502 tools, run cost rose from $0.55 to $1.02 without it and stayed at $0.56 with it. Deferring a GitHub MCP toolset cut cost about 20%.
  - Data through code execution and the Files API instead of pasting a 1,862-row CSV: 25/25 correct for $0.40, against 7/25 for $5.01 (Sonnet 5).
  - Image resizing and tool search cut a triage agent's bill 21–26% with caching on.
  - Programmatic tool calling: 24% fewer input tokens.

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Prompt audits:** instructions written for older models ("verify twice", "be maximally thorough", mandatory procedures, scratchpads) are followed literally by newer models and cost money. Stale or contradictory text costs accuracy. The audit saved 14% on both upgrades tested. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence). The blog reports that Opus 4.8 → Opus 5.5 with only the model ID changed cut cost about 18%, and a prompt audit cut a further ~9% with ~2 points higher accuracy. — [Lance Martin blog](https://claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform)

#### I. Advisor tool: pairings, consult rates, results and billing
- **Setup:**
  - Beta header `advisor-tool-2026-03-01`, tool `{type:"advisor_20260301", name:"advisor", model:<advisor>}`.
  - The executor decides when to call. The advisor sees the full transcript, runs without tools, and its thinking is dropped. It typically returns 400–700 text tokens (1,400–1,800 including thinking).

  — [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool)
- **Pairings:**
  - Haiku 5.5 executor: may use Opus 5.5, Sonnet 5.5, Fable/Mythos 5.x, Opus 5, Opus 4.7/4.8, Sonnet 5 and Haiku 5.5 as advisors.
  - Sonnet 5.5 executor: Mythos 5.1, Fable 5.1, Mythos 5, Fable 5, Opus 5.5, Opus 5 and Sonnet 5.5.
  - Opus 5.5 executor: Fable/Mythos 5.x, Opus 5.5 and Opus 5.
  - The 5.5-generation advisors return encrypted results, so the advice text is not readable.

  — [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) (summary of the compatibility table)
- **Billing and controls:**
  - Advisor tokens bill at the advisor's rates and appear only in `usage.iterations[]` as `advisor_message`. They don't count toward the executor's task budget.
  - `max_uses` caps calls per request; there is no conversation-level cap, so count client-side.
  - Advisor-side `caching` breaks even at about 3 calls per conversation.
  - The advisor tool definition adds about 1,000 prompt tokens per request.
  - Setting the advisor's `max_tokens` to 2048 cut mean advisor output about 7x, from about 4,200–5,900 tokens, with no detectable quality loss. At 1024, about 10% of calls were truncated.

  — [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool); [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Measured on 5.5-era models:**

  | Benchmark and pairing | Score against executor alone | Cost | Consults |
  |---|---|---|---|
  | Internal coding: Opus 5.5 `high` + Fable 5.1 advisor | 90.1%, +1.7 points ("edge of noise") | about 2.1x ($2.92 per attempt) | about 1.4 per attempt |
  | GPQA Diamond: Haiku 5.5 or Sonnet 5.5 + Opus 5.5 advisor | within noise | +12% (Haiku), +25% (Sonnet) | zero, with no consultation prompt |
  | Chartography: Opus 5.5 `low` + Fable 5.1 advisor | 7 points worse | about the same | 1 of 300 tasks |

  Sonnet 5.5 at default `high` consulted an Opus 5.5 advisor on 0 of 20 SWE-bench Pro problems, with or without the suggested prompt. At `xhigh` it consulted on 3–4 of 20. The coding gain "landed about on Opus 5.5's own effort curve, so the advisor bought roughly what more effort buys." An earlier-model test found that lowering executor effort cut consultations, and the pairing then scored below the executor alone. — [Optimizing for cost and intelligence (+refs)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- **Earlier results (blog, 9 Apr 2026):**
  - Sonnet 4.6 + Opus 4.6 advisor: +2.7 points on SWE-bench Multilingual and 11.9% lower cost per task.
  - Haiku 4.5 + Opus 4.6 advisor on BrowseComp: 41.2%, against 19.7% for Haiku alone. That trails Sonnet alone by 29% in score but costs 85% less per task.

  — [The advisor strategy](https://claude.com/blog/the-advisor-strategy)
- **Prompting guidance:**
  - Call the advisor after orientation reads and before substantive work, again when done, and when stuck.
  - Expect about 2–3 calls per task. The advisor "adds most of its value on the first call."
  - A Sonnet executor at `medium` with an Opus advisor reaches intelligence comparable to Sonnet at default, at lower cost.
  - A turn-2 nudge raised Haiku 4.5 pass rates about 7 points, but it hurt Opus, and it hurt tasks whose baseline first call came at turn 7 or later.
  - Don't use the advisor for single-turn Q&A or workloads where every turn needs full capability.

  — [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool)

#### J. Orchestrator and subagent patterns
- Delegation saved money in only two measured situations: routine work with a long cost tail, and work larger than one context window. "When work is one dependent chain, or fits in one context without a long tail, the orchestrator's model alone at lower effort came out ahead in every case measured." On a defect-search benchmark, the orchestrator cost about half of Fable 5.1 alone ($468–552 per run) and scored 10–12 points lower. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- Multi-agent research system (13 Jun 2025):
  - An Opus 4 lead with Sonnet 4 subagents beat single-agent Opus 4 by 90.2% on an internal research eval.
  - Agents use about 4x the tokens of chat, and multi-agent systems about 15x.
  - Token usage explained 80% of BrowseComp variance.
  - "Most coding tasks involve fewer truly parallelizable tasks than research."
  - Effort-scaling rules: 1 agent with 3–10 tool calls for simple fact-finding, 2–4 subagents for comparisons, more than 10 for complex research.

  — [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- "Building effective agents" (19 Dec 2024; the live page now names Haiku 4.5/Sonnet 4.5):
  - The routing workflow sends "easy/common questions to smaller, cost-efficient models" and "hard/unusual questions to more capable models."
  - "Finding the simplest solution possible, and only increasing complexity when needed."
  - "Agentic systems often trade latency and cost for better task performance."
  - Evaluator-optimizer fits when there are clear evaluation criteria.

  — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

#### K. Model-specific failure modes (official prompting guides)
- **Haiku 5.5:**
  - At `low` in long agent prompts it may skip searches, stop early and hand the task back, or skip checks. Moving `low` → `medium` "roughly halved early stopping" but "more than doubled the output tokens."
  - At `low`/`medium` it sometimes reports code changes as done without running a check. Anthropic supplies a "run a real check" paragraph for this.
  - It ignores user text placed inside `tool_result`.
  - At `xhigh` in multi-turn chat it can put the whole answer in its thinking and return empty visible text.
  - With thinking off plus JSON structured output, it may skip a needed tool call.
  - It has no server-side fallback for refusals.

  — [Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
- **Sonnet 5.5:**
  - At `low`/`medium` on long agentic tasks it checks in before finishing.
  - At every effort it adds unrequested tests, docs and supporting files, more so at higher effort.
  - At `xhigh`/`max` it starts its own review rounds, sometimes with reviewer subagents. A supplied "stop and report" prompt cut session cost by about a third with no quality change.
  - It occasionally calls a tool with the wrong letter case or a near-miss parameter name; accept the call or return `is_error`.
  - With structured outputs at `low`/`medium` it occasionally thinks until it hits `max_tokens`. Treat that as failed.
  - Use `max_tokens` 128,000 for agentic coding.

  — [Prompting Claude Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)
- **Opus 5.5:**
  - It generates output tokens more than 30% faster than Opus 5. At `medium` it matched or beat Opus 5 at `high` on agentic coding, in fewer steps and tokens.
  - In unattended loops, some progress updates end the turn with text (`end_turn`). Treat these as reports and auto-continue, at most 2–3 times.
  - **Frontend design defaults:** without direction it falls back on cream or off-white backgrounds, italic accent words in headlines, numbered "01/02/03" section labels, monospace labels and pill-shaped buttons. Name the specific patterns to avoid; a general "avoid generic AI look" only swaps one default for another.
  - Thinking can't be disabled. Declare all tools from the first request, because adding tools later invalidates thinking blocks.

  — [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)

#### L. April 2026 Claude Code postmortem (published 23 Apr 2026)
- On 4 Mar, Claude Code's default effort was cut from `high` to `medium` for Sonnet 4.6 and Opus 4.6, to reduce latency long enough to make the UI look frozen. It was reverted on 7 Apr. "This was the wrong tradeoff": users said they would rather default to higher intelligence and opt into lower effort for simple tasks. Internally, `medium` had given slightly lower intelligence with significantly less latency. Defaults after the revert were `xhigh` for Opus 4.7 and `high` for other models. — [April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem). Secondary sources give 3 Mar instead of 4 Mar; the primary page says 4 Mar. — [smartscope.blog](https://smartscope.blog/en/blog/claude-code-quality-degradation-postmortem-2026/)
- A caching optimization meant to clear old thinking once after more than an hour idle instead cleared it on every turn, from 26 Mar until the fix on 10 Apr. It "made Claude seem forgetful and repetitive" and caused repeated cache misses that drained usage limits faster. — [April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- A verbosity prompt was added on 16 Apr and reverted on 20 Apr: "keep text between tool calls to ≤25 words" and "Keep final responses to ≤100 words…". An ablation showed a 3% drop for Opus 4.6 and Opus 4.7. — [April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- Process changes: per-model eval suites with line-by-line ablations for every system-prompt change, soak periods and gradual rollouts for changes that could trade off intelligence, and model-specific changes gated to their target model. The API was not affected. — [April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem)

### Inferences
- **Makeborne's default ladder.** On Anthropic's own data, the cost-optimal points for agentic coding (closest to Makeborne's file-editing loops) are:
  - Sonnet 5.5 `high` (about $0.11 per solved task) and Opus 5.5 `low` (about $0.12), which tie.
  - Opus 5.5 `medium`, about 5 points better for about 2x the cost.
  - Sonnet 5.5 `medium`, which saves 41% but loses about 7 points (15 on the internal coding benchmark). For multi-step file editing it looks like a poor default unless the task is well specified, which matches Anthropic's guidance.

  Haiku 5.5 suits only "checkable" high-volume subtasks, and it must stay under 100K prompt tokens.
- **Escalation should follow "run low, re-run high", not mid-conversation model switches.** The 40% saving depends on a reliable failure signal. For Makeborne that means build, typecheck, lint, render or screenshot checks. Since "most of the lift comes from the second attempt," a retry policy matters as much as the effort level.
- **Mid-conversation model switches are a large cost event.**
  - Example: escalating a 100K-token Haiku 5.5 conversation to Opus 5.5 re-writes about 100K tokens at Opus's 5-minute write price ($5/M), about $0.50, instead of reading at $0.20/M, about $0.02. That is about 25x, plus a slower turn.
  - Vendor-endorsed alternatives:
    - Escalate effort with per-message effort, which keeps the cache.
    - Switch models only at compaction or other natural boundaries ($0.75 against $0.95 in the triage test).
    - Hand the hard sub-problem to a fresh subagent with a small, cacheable prefix.
- **The Haiku 5.5 >100K cliff is the biggest hidden cost risk.** In Anthropic's Managed Agents data, 5% of Haiku requests carried 73% of its cost. Above 100K, Haiku's cache read ($0.05/M) is only 2x cheaper than Sonnet 5.5's ($0.10/M), and its output ($2.50/M) is 4x cheaper than Sonnet's ($10/M) instead of 20x. An orchestrator should compact Haiku conversations, or move them to a fresh context, well before 100K.
- **The advisor tool is unlikely to pay off for Makeborne by default.**
  - Sonnet 5.5 at `high` consulted 0 of 20 times, and Haiku/Sonnet consulted 0 times on GPQA without a prompt.
  - It adds about 1K prompt tokens per request, the 5.5 advisors' output is encrypted, and the measured gain was what more effort buys at about 2.1x cost.
  - If tried, measure the consult rate, cap the advisor's `max_tokens` at about 2048, and keep executor effort at its default.
- **Hard API constraints for the orchestrator:**
  - No forced `tool_choice` on Opus 5.5 or Sonnet 5.5.
  - No system or tools edits in conversations that carry thinking blocks (400 on new accounts). Use mid-conversation system messages or new-turn text instead.
  - Declare every tool on the first request, or use the `inline-tools` beta.
  - Keep per-request volatile text (timestamps, budgets, status) at the end of the newest user turn.
- **Product lesson from the postmortem:** cutting default effort to save latency or cost was publicly judged "the wrong tradeoff." Users preferred high intelligence by default with opt-in lower effort. Makeborne should gate any default-effort reduction behind per-model evals and gradual rollout, as Anthropic now does.
- **Opus 5.5 frontend defaults:** the named list (cream backgrounds, italic accent words, 01/02/03 labels, monospace labels, pill buttons) is directly usable as a "don't" list in Makeborne's website and slide generation prompts.

### Gaps
- Anthropic publishes no measurement of the cost of a mid-conversation model switch. Claude Code's docs state the mechanism ("each model has its own cache") but give no figures. The estimate above is my arithmetic from list prices.
- No vendor benchmark covers website, slide-deck or ebook generation. All coding figures are SWE-bench Pro, internal coding or repository-task benchmarks, so the transfer to React/CSS page building is unverified.
- Sonnet 5.5's SWE-bench Pro runs used a pre-release build. Opus 5.5 `xhigh` and Fable 5.1 figures are single runs.
- The advisor compatibility table was read through a summarizer. The pairings should be re-checked on the live page before implementation.
- The "Effort" page gives no Haiku 5.5 cost or score curve by effort level; only the GPQA and Managed Agents `medium` figures exist.
- The 23 Apr postmortem predates the 5.5 models. Current Claude Code default effort per model was not verified.

---

## OpenAI: router, reasoning_effort, verbosity, caching, flex and priority tiers

### Takeaway
OpenAI's API has no automatic cross-model router; the GPT-5 "real-time router" is a ChatGPT feature. The API exposes:
- `reasoning.effort`, from `none` to `xhigh`/`max`, with `medium` the default on current models.
- `text.verbosity` (`low`/`medium`).
- A Pro reasoning mode.
- A `configuration_update` that changes effort mid-conversation without breaking the cache.

OpenAI says the same thing as Anthropic: start at `medium` and raise effort only when evals show a measurable gain. Its newest models now charge for cache writes (1.25x for 30 minutes, 2.5x for 12 hours) and discount reads to 0.1x (0.05x on GPT-6.1 Sol).

### Cited Findings
- **GPT-5.5:**
  - `reasoning.effort` values are `none`, `low`, `medium`, `high` and `xhigh`, with `medium` the default.
  - OpenAI calls `medium` "the recommended balanced starting point for quality, reliability, latency, and cost." Use `low` for efficient reasoning, test it before `none` when tool use or planning still matters, and reserve `none` for latency-critical work without multi-step tool calls.
  - "Increase effort only when evals show a measurable quality gain," since higher effort can cause overthinking or unnecessary searching.
  - "GPT-5.5 reaches strong results with fewer reasoning tokens than prior models, even at the same reasoning effort."
  - The page gives no numeric benchmark or cost-per-task figures.

  — [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5.md)
- **Verbosity** (`text.verbosity`): `low` or `medium`, default `medium`. On GPT-5.5, `low` is "proportionally more concise" than on GPT-5.4. — [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5.md)
- **GPT-5.5 migration advice:**
  - Start from a fresh baseline rather than carrying over old prompts.
  - Use Structured Outputs instead of in-prompt schemas.
  - Use a stable `prompt_cache_key`, "important for optimizing cache hit rates on GPT-5.5."
  - Keep stable content first and dynamic content last.

  — [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5.md); press coverage: [The Decoder](https://the-decoder.com/openai-says-old-prompts-are-holding-gpt-5-5-back-and-developers-need-a-fresh-baseline/)
- **Current reasoning guide** (read through the summarizer; model names as the page gives them):
  - Start with `gpt-6-astra` for most reasoning workloads, `gpt-5.6-terra` for lower cost and `gpt-5.6-luna` for the lowest cost and latency.
  - Effort values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`, depending on the model. `medium` is the default on GPT-5.5, GPT-5.6, GPT-6 Sol, GPT-6.1 Sol and GPT-6 Luna.
  - Use `xhigh` only when evals show "a clear benefit that justifies the extra latency and cost."
  - Reasoning mode is `standard` (default) or `pro`, and is independent of effort. "Pro mode performs more model work… increasing token usage and cost." The page lists no `auto` mode.
  - Reasoning tokens bill as output. Reserve at least 25,000 tokens for reasoning plus output at first.
  - Persisted reasoning is reusable only within the same model family; GPT-5.6 and GPT-5.5 reasoning don't carry over.
  - `configuration_update` changes effort mid-conversation and "preserves the original prompt prefix for prompt caching."

  — [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
- **Prompt caching:**
  - On by default, with an exact prefix match.
  - The minimum is 1,024 visible input tokens on GPT-5.6+. It varies by settings on earlier models.
  - On GPT-5.6+, reads cost 0.1x input (0.05x on GPT-6.1 Sol) and writes cost 1.25x (`30m`, the default TTL) or 2.5x (`12h`). Earlier models had no write charge.
  - Earlier models' `prompt_cache_retention` is `in_memory` (about 5–10 minutes idle, up to 1 h) or `24h`.
  - About 15 requests per minute per `prompt_cache_key` before traffic overflows to other machines.
  - Best practices: append rather than rewrite history (compaction or truncation resets reuse), and keep tools stable, using `allowed_tools` or `tool_choice:"none"` rather than removing tools.
  - On models, the page says only that changing the model can change "weights and caching behavior."

  — [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- **Flex processing:** set `service_tier:"flex"` for Batch API rates (plus caching discounts) at slower speed. "429 Resource Unavailable" errors are not charged, and the fallback is `service_tier:"auto"`. Intended for evals, enrichment and async jobs. — [OpenAI flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
- **GPT-5 router (Aug 2025):**
  - The GPT-5 system card describes a fast model, a deeper reasoning model and a "real-time router." The router picks by conversation type, complexity, tool needs and explicit intent ("think hard"). It is trained on users switching models, preference rates and measured correctness.
  - The variants are gpt-5-main/-main-mini and gpt-5-thinking/-thinking-mini.

  — [GPT-5 system card](https://openai.com/nl-NL/index/gpt-5-system-card/) (via search snippet; openai.com returned 403 to direct fetch). Third-party analysis says the router applies only in ChatGPT and API access is not routed. — [Where's Your Ed At](https://www.wheresyoured.at/how-does-gpt-5-work/) (secondary). Users pushed back on the lack of control over which model answered. — [Fortune](https://fortune.com/2025/08/12/openai-gpt-5-model-router-backlash-ai-future)

### Inferences
- OpenAI and Anthropic now look alike structurally:
  - An effort parameter that defaults to `medium` and is to be raised only when evals show a gain.
  - A mid-conversation effort change that keeps the cache (`configuration_update`, and Anthropic's per-message effort).
  - Paid cache writes with about 0.05–0.1x reads.
  - Reasoning state that does not carry across model families.

  Both vendors' designs make cross-model hops mid-conversation expensive. This supports an orchestrator that picks a model per conversation or per sub-task and varies effort within a conversation.
- OpenAI's router lesson comes from the consumer product: a router trained on user switch and preference signals drew backlash over lack of control. Makeborne may want a visible quality/cost choice, or at least predictable behavior, rather than an opaque router.

### Gaps
- No OpenAI page found with measured cost per task or score by effort level for GPT-5.5 or the 6.x models.
- Priority-processing price premium and latency guarantees were not retrieved. The flex page does not cover them.
- The GPT-5 system card and launch post could not be fetched directly (403); router details come from a search snippet and secondary sources.
- The OpenAI model names reported (gpt-6-astra, gpt-5.6-terra/luna, GPT-6.1 Sol and others) came through a summarizer and should be confirmed on the live page before they are cited externally.

---

## Google: Gemini thinking levels and budgets, caching, Flash vs Pro, routing

### Takeaway
Gemini 3+ uses discrete `thinking_level` settings instead of a token budget. Defaults vary by model: `medium` on gemini-4-argon and 3.8/3.6 Flash, `minimal` on 3.5 Flash-Lite, `high` on 3.1 Pro Preview. Thinking tokens bill as output. Google's cost advice is to lower `thinking_level` rather than shrink `max_output_tokens`. Implicit caching is on by default with a 90% discount (Vertex) and no storage fee. Explicit caching also gives 90% on 2.5+ but charges storage, and it is not supported on Gemini 4 Argon. Vertex AI Model Optimizer is Google's official router, with three preferences: quality, balanced or cost.

### Cited Findings
- **`thinking_level` defaults and supported levels:**

  | Model | Default | Supported levels |
  |---|---|---|
  | gemini-4-argon | medium | low/medium/high |
  | gemini-3.8-flash | medium | low/medium/high |
  | gemini-3.6-flash | medium | minimal/low/medium/high |
  | gemini-3.5-flash-lite | minimal | minimal–high |
  | gemini-3.1-pro-preview | high | low/medium/high |
  | gemini-3-pro-preview | high | low/high |
  | gemini-2.5-pro and 2.5-flash | on | — |
  | gemini-2.5-flash-lite | off | — |

  — [Gemini API: Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- **Guidance and billing:**
  - "Use minimal or low thinking for fact retrieval or classification." Use default thinking for moderate tasks, and maximum thinking "for advanced coding, math, or multi-step planning."
  - Thinking tokens bill as output, even though only summaries are returned.
  - To cut cost or latency, lower `thinking_level` rather than set a small `max_output_tokens`. A truncated response still bills its thinking tokens.
  - In stateless multi-turn use, all thought blocks and signatures must be re-sent unchanged.

  — [Gemini API: Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- **Gemini 2.5 `thinking_budget`:** -1 is dynamic and 0 disables thinking. The two parameters should not be mixed across generations. — [Pipecat docs](https://docs.pipecat.ai/api-reference/server/services/llm/google.md) (secondary); [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/models-and-providers/reasoning/google) (secondary). The ai.google.dev thinking page fetched did not list budget ranges.
- **Implicit caching:**
  - "Enabled by default for all Gemini 2.5 and newer models."
  - Minimum input is 4,096 tokens on Gemini 4 Argon, 3.8 Flash, 3.6 Flash and 3.1 Pro Preview, and 2,048 on 2.5 Flash and Pro.
  - On Gemini 4, "Gemini caches the full previous request only if the new request adds at least 2,050 tokens."
  - Explicit caching is not supported on Gemini 4 Argon or later, or in the Interactions API.
  - Best practices: put large common content first and send similar-prefix requests close together in time.

  — [Gemini API: Context caching](https://ai.google.dev/gemini-api/docs/caching)
- **Vertex (Gemini Enterprise Agent Platform) caching:**
  - Implicit caching gives a 90% discount on cached tokens, with no storage cost. Prefixes expire within 24 h at most, and most are evicted sooner.
  - Explicit caching gives 90% on Gemini 2.5+ and 75% on 2.0. Creation bills at the standard input price, plus storage charges by time, with a default TTL of 60 minutes.
  - Minimum token counts: Vertex lists 6,144 tokens for implicit caching on 3.0 Flash Preview, 3.1 Pro Preview, 3.7 Flash and 3.8 Flash. ai.google.dev gives 4,096 for some of these, a conflict between the two Google pages.

  — [Vertex context cache overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview). Implicit caching launched on Gemini 2.5 in May 2025 at a 75% discount. — [Google Developers Blog](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)
- **Routing:** Vertex AI Model Optimizer is a single endpoint that picks a Gemini model by preference: `PRIORITIZE_QUALITY`, `BALANCED` or `PRIORITIZE_COST`. — [Vertex AI Model Optimizer](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/vertex-ai-model-optimizer); [RoutingConfig enum reference](https://docs.cloud.google.com/dotnet/docs/reference/Google.Cloud.AIPlatform.V1/latest/Google.Cloud.AIPlatform.V1.GenerationConfig.Types.RoutingConfig.Types.AutoRoutingMode.Types.ModelRoutingPreference)

### Inferences
- Google's "lower the thinking level, don't cap output" advice matches Anthropic's finding that `max_tokens` doesn't make the model economize and cut-off turns are still billed. Across vendors, output caps are a safety ceiling, not a cost lever.
- Google is the only vendor offering a first-party, preference-driven cross-model router API (Model Optimizer). No measured cost or quality data for it was found, so it is a design reference, not evidence.

### Gaps
- No official Google page with measured cost/quality numbers per thinking level, or for Flash against Pro on agentic coding, was retrieved.
- Official Flash-versus-Pro selection guidance was not retrieved; the Vertex thinking page body was truncated in the fetch.
- Whether explicit caches are bound to a specific model is not stated on the pages read.
- The Model Optimizer's current GA status and model list were not verified.

---

## Cross-vendor: cache cost when switching models mid-conversation, and measuring cost per completed task

### Takeaway
Every vendor's caching is model-scoped and prefix-exact, so a mid-conversation model switch forfeits the cached prefix:
- Anthropic states this explicitly ("each model has its own cache").
- OpenAI says reasoning state doesn't cross model families and that a model change changes caching behavior.
- Both offer a cache-preserving way to change effort mid-conversation; neither offers one for changing the model.

Anthropic is the only vendor whose official docs say to compare and choose models by cost per completed or solved task rather than per token, and it publishes the numbers.

### Cited Findings
- Anthropic, via Claude Code: "Each model has its own cache. Switching with `/model` means the next request reads the entire conversation history with no cache hits, even though the content is identical." — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
- Anthropic: make cache-invalidating changes, including model and effort, at natural breaks such as the first request after compaction. Measured: $0.75 per session at compaction against $0.95 mid-session, with $0.81 for no change. — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence); [Lance Martin blog](https://claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform)
- Anthropic: a top-level effort change on a ~101K-token conversation cost $0.41 on Opus 5.5 and $0.20 on Sonnet 5.5. A per-message change cost $0.020 and $0.010. — [Optimizing for cost and intelligence (ref)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- OpenAI: "Persisted reasoning is reusable only within the same model family." `configuration_update` changes effort while preserving the prefix for caching. — [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning). Changing the model can change "weights and caching behavior." — [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- Anthropic on cost per task:
  - "Compare models on cost per completed task, not per token."
  - "Compare per solved task, not per token… the same text costs about 30% more tokens on Claude 4.7 and later."
  - "Record cost per task beside the score."
  - "Price the tail, not the median."

  — [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- OpenAI advises benchmarking on accuracy, token consumption and end-to-end latency, but publishes no cost-per-task method or figures on the pages read. — [Using GPT-5.5](https://developers.openai.com/api/docs/guides/latest-model/gpt-5.5.md)

### Inferences
- An orchestrator that picks a model per user request inside one long-lived conversation pays a full re-write at the new model's write price on every hop. On Anthropic that is about 25x the read price for Opus and Sonnet 5.5 (5-minute writes at 1.25x against reads at 0.05x).
- The vendor-consistent design:
  1. Choose model and effort at conversation or sub-task start.
  2. Vary effort within a conversation via per-message effort.
  3. Escalate models by spawning a fresh sub-conversation with a compact, cacheable brief, or at a compaction boundary.
  4. Judge every policy on cost per accepted output, meaning a passing build and render, including retries and tail tasks.

### Gaps
- No vendor publishes a measured dollar cost of a mid-conversation model switch.
- Google's pages say nothing about model switching and caching.
- No vendor publishes cost-per-completed-task data for website, slide or ebook generation.
