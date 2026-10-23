# Caches and checks beat model routing

The best v4 orchestrator for Makeborne is not a smarter router. It is a cache-disciplined, verifier-gated rule table with two writers: **Claude Haiku 5.5 at medium effort for copy edits that a model-free check can certify, and Claude Opus 5.5 for everything else, with effort rather than Sonnet 5.5 as the cost dial**. Makeborne's own 22–23 October measurements show why. A cold Opus targeted edit costs a median $0.23, and most of that is the cache write of system prompt plus site. A warm cache cuts the same edit by 70–90%, while Opus at low effort saves only about 10%. Haiku copy edits cost $0.005–0.007 (−97%). Sonnet saved about half on six edits but won none of the comparisons, and Opus won two on visual craft. The 2026 routing literature finds that learned prompt routers sit inside the noise of a simple task-type table, and that cascades pay only when the after-the-fact check is reliable. Anthropic's own benchmark puts Opus 5.5 at low and Sonnet 5.5 at high at the same cost per solved task ($0.12 vs $0.11). Codex's proposal gets the architecture right: a server-owned TaskDecision, one writer per task, a shared budget, failover kept apart from escalation, per-attempt token logging and cost per accepted result. Its central model assignment does not hold up: Sonnet for ordinary business sites, starting at medium effort, on a cost model that assumes uncached input. Once caching works, a Sonnet-first cascade with cold Opus escalation costs more than warm Opus alone. On price, the design undercuts Lovable's published edit prices. A $1.01 first build (about 34 credits, about $2.19) is roughly four times Lovable's 2-credit landing page, though, so Makeborne's price claim must rest on edits, on project-lifetime cost and on never charging for its own failed attempts, while its quality claim rests on Opus plus verification. A $100 evaluation can settle costs, measure verifier error and catch large regressions. It cannot prove quality parity; that evidence has to come from shadow traffic.

## A cold edit is mostly a cache write, so model choice is the smaller lever

Makeborne's own ledger frames the problem more sharply than any paper. Today's product runs Opus 5.5 everywhere. A first website costs a **median $1.01 across 103 runs**: about $0.68 for the build stage and about $0.30 for the screenshot design review, over roughly nine Opus calls, mostly spent on output tokens (code and thinking). Generated images add a median $0.011 per build (p90 $0.032), so image routing barely moves cost ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>); [ledger](../outputs/eval/budget/ledger.json)). A targeted edit on Opus medium costs a **median $0.23 cold (n = 25, range $0.19–0.29)**. Each edit sends about 7.6K tokens of system prompt, 1K of tool schemas and an 18K-token site. Writing that 26.6K-token prefix to the five-minute cache at Opus 5.5's $5/M costs **$0.133, about 58% of the edit before the model emits a token**. Reading the same prefix from a warm cache costs $0.0053, 25 times less (computed from [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). That explains the 23 October cold rerun. **Effort low saved only about 10% on edits ($0.21 vs $0.23)**, while a warm cache cut the same edit by **70–90%**. On 22 October a Sonnet edit cost $0.085 cold and $0.011 warm ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>)).

Two more measured facts shape the design. First, the design review, about 30% of first-build spend, never finishes. In all 8 saved sites of the 23 October qualification, and in the 21 October app run, **every review stopped after one model call without calling finish**. The review round's ceiling at Medium is 15 credits ($0.45). The cold first call, with screenshots and the whole site, costs $0.27–0.30, which leaves too little for the next call's worst-case reservation. The review never reaches its own checks or its summary. Second, the one cheap lane Makeborne has measured works. Haiku 5.5 copy edits cost $0.005–0.007, against $0.17–0.24 on Opus. The classifier sent all 20 copy cases to Haiku and kept all 12 targeted edits off it. All 5 first-pass "failures" turned out to be false alarms from the check itself, since Opus's correct edits failed the same 5 cases. After the check was fixed, all 60 saved results passed and the negative controls still failed ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>)).

| Task (today, measured) | Provider cost | Credits at $0.03 each | User price at ~$0.065/credit | Lovable's published example |
|---|---|---|---|---|
| First website, Opus medium, review included | $1.01 median (n=103) | ~34 | ~$2.19 | "Build a landing page with images": 2.00 credits ≈ $0.50 |
| Targeted edit, Opus medium, cold cache | $0.23 median (n=25) | ~8 | ~$0.50 | "Remove the footer": 0.90 ≈ $0.23 |
| Targeted edit, Opus, warm cache | $0.02–0.08 | 1–3 | $0.065–0.20 | — |
| Copy edit, Haiku 5.5 medium | $0.005–0.007 | 1 (minimum) | ~$0.065 | "Make the button gray": 0.50 ≈ $0.125 |

The Lovable column converts Lovable's example credit costs ([Lovable credits](https://docs.lovable.dev/user-guides/credits)) at the $0.25 per Pro credit that Lovable used when it converted old balances ([Lovable plans](https://docs.lovable.dev/introduction/plans-and-credits)). Lovable's real per-credit price varies by plan and top-up, so these are estimates. The arithmetic still makes the strategic point. **Makeborne can win on edit price and cannot win on first-build price at Opus cost.** The Haiku copy lane and warm Opus edits undercut Lovable's edits; a cold Opus edit does not. To match a $0.50 landing page at Makeborne's $0.03-per-credit cost basis, a build would have to cost about $0.23. Only Haiku- or Sonnet-class building gets near that, and the quality evidence below argues against it.

Over a project's life the picture improves. Take one first build plus 12 copy edits and 8 targeted edits:

| Scenario | Credits | Approx. user price |
|---|---|---|
| Lovable, from its published examples | ~15 | ~$3.80 |
| Makeborne with the Haiku copy lane but today's cold Opus edits (all-Opus today is ~182 credits) | ~110 | ~$7.15 |
| Makeborne with warm caching | ~62 | ~$4.03 |
| Makeborne with warm caching and a ~$0.55 first build | ~46 | ~$3.00 |

The last row assumes the review fix and an Opus-low build both pay off (all rows computed). Price leadership is therefore a result of cache engineering and build-cost work, not of routing, and it is reachable only over a project's life. The notes contain **no head-to-head quality measurement against Lovable, Bolt, v0, Base44, Replit, Cursor or Gamma**. For now the quality claim rests on Opus and on verification, not on a benchmark.

## Routing research converges on task tables and verified cascades

The headline savings of the 2023–2025 literature do not transfer to Makeborne. FrugalGPT reports up to 98% cost reduction at GPT-4 quality ([FrugalGPT](https://arxiv.org/abs/2305.05176)). RouteLLM reports more than 85% on MT-Bench, 45% on MMLU and 35% on GSM8K while keeping 95% of GPT-4's performance ([LMSYS](https://lmsys.org/blog/2024-07-01-routellm/)). Hybrid LLM reports 40% fewer large-model calls ([Hybrid LLM](https://arxiv.org/abs/2404.14618)) and AutoMix more than 50% less compute ([AutoMix](https://arxiv.org/abs/2310.12963)). All of these come from single-turn QA, chat or math, with GPT-4-era model pairs whose prices differ by two orders of magnitude. RouteLLM's own routers performed near random on out-of-distribution MMLU until about 1,500 in-domain golden labels were added ([LMSYS](https://lmsys.org/blog/2024-07-01-routellm/)). Makeborne has no comparable labelled corpus.

The 2026 re-evaluations land in the same place from several directions:

- **LLMRouterBench:** the leading routers bunch near a dataset-level oracle and gain at most about 4% over the best single model, matching its accuracy at up to 31.7% lower cost. Binary routers such as HybridLLM and FrugalGPT struggle to save money at best-single accuracy. Replacing a 7B embedding model with a 22.7M-parameter MiniLM made no significant difference ([LLMRouterBench](https://arxiv.org/html/2601.07206)).
- **The Routing Plateau:** the top five of 21 methods differ by 0.22 points and are statistically indistinguishable. They still trail the oracle by 10.6–29.4 points, and hard queries account for 53–81% of that gap ([Routing Plateau](https://arxiv.org/html/2606.07587v2)).
- **"Dynamic LLM Routers are Often Misguided":** every commercial router tested except vLLM Semantic Router underperformed a random split between two well-chosen models at matched cost, by 1.4 to 10.5 points. No router's choices correlated with difficulty above γ = 0.20. With perfect difficulty knowledge, a two-model roster is never more than 1 point below the best roster of any size ([Misguided](https://arxiv.org/html/2610.02762v1)).
- **"Most of the LLM Routing Gap Is Task Type":** a static one-model-per-task-type table fixed 21 of 29 routable questions. That left 6 of 294, fewer than the 5.37% of correctness cells that flip on a temperature-0 rerun, though the paper fits and scores on the same items with no holdout ([Lee](https://arxiv.org/pdf/2608.23023)).
- **Router collapse:** score-predicting routers drift toward the most expensive model as budgets rise ([Router collapse](https://arxiv.org/abs/2602.03478)).

The part that transfers is simple: task class plus a good two-model roster captures most of the value.

The agentic-coding evidence is closer to Makeborne's loops, and it points the same way:

- **SWE-Router:** on SWE-bench Verified, routers that read only the prompt score a Route-AUC of 0.43–0.57, roughly chance. A value head that reads two exploratory turns reaches 0.78, then fails under repository shift ([SWE-Router](https://arxiv.org/html/2607.00053v1)).
- **ACRouter:** static learned classifiers fall to 8.9–21.4% out of distribution, below random at 31.25%. A rule-based per-dimension prior beats every LLM router, and Claude Opus 4.6 ranks last as a router despite being the best coder ([Agent-as-a-Router](https://arxiv.org/html/2606.22902)).
- **Scrouting:** the cheapest fixer, given a sandbox-verified handoff, ties the routed system. It solved 159 of 266 tasks against 158 for the best single model, at $0.230 against $1.274 per solve. Solve sets are "largely nested", and step caps bound in 17–48% of attempts ([Scrouting](https://arxiv.org/pdf/2608.04804)).
- **Cascade routing on SWE-Bench:** routing scores about the same as linear interpolation between models (40.47 against 40.51 AUC), while a cascade driven by ground-truth tests reaches 53.2 ([Dekoninck et al.](https://arxiv.org/html/2410.10347)).
- **"How Do AI Agents Spend Your Money?":** token use varies up to 30x on the same task, input tokens drive most of the cost, and models predict their own usage at r ≤ 0.39 ([Bai et al.](https://arxiv.org/pdf/2604.22750)).

**No paper studies routing for front-end, CSS, deck or ebook generation, or for screenshot design review.** Makeborne is extrapolating.

Cascades pay only when the after-the-fact check is good. In RouterBench's simulation, cascades beat everything at judge error ≤ 0.1 and "deteriorate rapidly" above 0.2 ([RouterBench](https://arxiv.org/html/2403.12031)). Cascading is worthwhile only when post-hoc estimates are much better than what the prompt alone predicts ([Dekoninck et al.](https://arxiv.org/html/2410.10347)). Intrinsic self-correction without external feedback is unreliable ([Huang et al.](https://arxiv.org/abs/2310.01798); [Kamoi et al.](https://arxiv.org/abs/2406.01297)). Code cascades that use execution tests as the gate save 26% on average and up to 70% ([Chen et al.](https://arxiv.org/abs/2405.15842)).

The economics are simple. A cheap attempt costing h, before a strong run costing O, saves money only if h < p·O, where p is the share of cheap attempts that pass (computed):

- **Haiku copy edit:** h = $0.006. Against a cold Opus edit (O = $0.23) it needs p > 2.6%; against a warm one (O = $0.05), p > 12%. Both are trivially met, so the binding constraint is the check's false-accept rate, not cost.
- **Sonnet before Opus:** at about half Opus's cost, Sonnet must pass more than about 48% of the time. Each pass must also match Opus's quality, which no deterministic check certifies for visual craft.

Makeborne's holistic judge "lost" one Opus-versus-Opus pair in about five, which puts it right at the 0.2 error line where cascades stop paying.

Effort routing has its own evidence:

- **Ares**, a small per-step effort router, cut reasoning tokens by 52.7% with no loss on TAU-Retail. Medium beat high on TAU-Airline (42.0 against 38.0). Fixed low collapsed to 8.0% against 42.7% on BrowseComp-Plus, and prompted frontier models made poor effort routers ([Ares](https://arxiv.org/html/2603.07915)).
- **Snell et al.:** extra test-time compute lets a small model beat a 14x larger one only where it already has non-trivial success ([Snell et al.](https://arxiv.org/abs/2408.03314)).
- **BEST-Route**, which chooses both the model and the number of samples, saves up to 60% ([BEST-Route](https://arxiv.org/abs/2506.22716)).

No paper compares switching effort with switching models at matched dollars in a coding agent, so v4 has to measure it.

Two methodology warnings close the academic picture. Confounder "gadgets" pushed 73–100% of queries to the strong model in white-box tests and evaded perplexity filters ([Rerouting LLM Routers](https://arxiv.org/html/2501.01818)). That is one more reason to route on observed results rather than on prompt wording.

## Anthropic's own numbers make effort, not Sonnet, the middle rung

The vendor documentation is the closest evidence on Makeborne's exact model pool, and it points one way. The figures below come from a 478-problem SWE-bench Pro subset ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).

| Model and effort | Solved | Cost per solved task |
|---|---|---|
| Sonnet 5.5, `high` (its default) | 87.6% | $0.11 |
| Opus 5.5, `low` | 87.4% | $0.12 |
| Opus 5.5, `medium` (its default) | 92.8% | $0.22 |
| Opus 5.5, `low`, failures re-run at `high` | 96.4–97.5% | ~$0.17 per task |
| Opus 5.5, everything at `high` | 94.8–95.8% | $0.29 per task |

Opus at low ties Sonnet at high because it does "less work per task". It uses a little over half of Sonnet's output tokens and about a third of its cache reads. Sonnet at medium loses about 7 points for 59% of the cost: 62.7% against 77.8% on Anthropic's internal agentic-coding benchmark ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). The guidance follows from this. "Most workloads start with Claude Opus 5.5," and "tuning effort is often a better lever than switching models" ([Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)). None of these benchmarks is a website, deck or ebook task, so the transfer is unverified.

The most reusable result is **"run low, re-run failures at high"**. It is cheaper than Opus medium alone and solves more, but it needs two things: "a reliable failure signal", and acceptance that a failed first pass takes twice the wall-clock time. "Most of the small quality lift comes from the second attempt, not the higher effort." Opus's effort curve runs from 87.4% at $0.11 per task (low) to 92.8% at $0.21 (medium), 95.3% at $0.29 (high) and 96.7% at $0.74 (xhigh, one run) ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). Effort therefore gives Makeborne a three-to-one cost range inside one model and one cache.

On caching, Anthropic is blunt:

- **It is the biggest lever:** prompt caching "was usually the largest lever". A well-built loop reads a median 84% of its input from cache, and below 80% you should "look for something breaking the cache". Opus 5.5 costs 3.3x more without caching on SWE-bench Pro ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).
- **Caches are per model:** switching model "recomputes the entire request even when the content is identical" ([Claude Code prompt caching](https://code.claude.com/docs/en/prompt-caching)).
- **Mid-conversation changes are expensive:** on a ~101K-token conversation, a system-prompt edit cost 25–50x the same text sent as a mid-conversation system message. A top-level effort change on Opus cost $0.41, against $0.020 for a per-message change. A 25-token status line at the front of the system prompt forced a rewrite of all 101K tokens ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).
- **Per-message effort keeps the cache:** the beta header `mid-conversation-output-config-2026-07-01` lets effort change without invalidating the cache on Opus, Sonnet and Haiku 5.5 ([Effort](https://platform.claude.com/docs/en/build-with-claude/effort)).
- **New accounts get hard errors:** on accounts created on or after 31 August 2026, a request that sends earlier thinking blocks back with changed system, tools or earlier messages returns a 400 ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).

Haiku 5.5 is strong, and it has a cliff:

- **It passes checkable work cheaply:** at medium it passed 93% of a 79-task Managed Agents set at about $0.011 per passed attempt, and its minimum cacheable prefix is 512 tokens.
- **The 100K cliff:** above 100,000 prompt tokens every token costs 5x, output included. 5% of Haiku's requests were over that line and carried 73% of its cost ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).
- **Low effort cuts corners:** in long agent prompts at low it skips searches, stops early or skips checks. At low or medium it sometimes reports code changes as done without running a check ([Prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)). Anthropic recommends medium for agentic coding ([Effort](https://platform.claude.com/docs/en/build-with-claude/effort)).

Multi-model patterns fare poorly in Anthropic's own tests. An Opus-high executor with a Fable 5.1 advisor gained 1.7 points, "edge of noise", at about 2.1x the cost. Sonnet 5.5 at high consulted an Opus advisor on 0 of 20 problems ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). For orchestrators, "when work is one dependent chain, or fits in one context without a long tail, the orchestrator's model alone at lower effort came out ahead in every case measured." On work bigger than one context window, delegation cost about half and scored 10–12 points lower (same source). An 18K-token site fits in one context many times over.

Several operational facts matter for the harness:

- **Tool use:** Opus 5.5 rejects forced `tool_choice`, its thinking cannot be disabled, and every tool must be declared on the first request.
- **Early stops:** in unattended loops some progress updates end the turn, so the harness should auto-continue two or three times.
- **Design defaults:** without direction, Opus falls back on cream backgrounds, italic accent words, 01/02/03 section labels, monospace labels and pill buttons. Naming these patterns works better than "avoid a generic AI look" ([Prompting Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)).
- **Output caps:** `max_tokens` is invisible to the model and cut-off turns are still billed. Set 64,000 and treat a `max_tokens` stop as a failure ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).

The April 2026 postmortem is the cautionary tale. Cutting Claude Code's default effort from high to medium "was the wrong tradeoff". Three product changes passed evals and dogfooding but degraded quality for weeks, and Anthropic now requires per-model evals, ablations, soak periods and gradual rollouts ([Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem)). OpenAI's guidance mirrors this: default to medium, raise effort only when evals show a gain, change effort mid-conversation with `configuration_update` to keep the cache, and expect persisted reasoning not to carry across model families ([OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)).

## Competitors hide the model, price by complexity and win with pipelines

**Cursor** runs the most fully documented production router, in two stages:

- **Compass**, the first stage, predicts user satisfaction as a stand-in for complexity. Turns it rated most likely to succeed got a positive signal 96% of the time, against 71% for the least likely.
- **A taxonomy router**, the second stage, sends a turn to a frontier model only if that model clears a "one-sided 75% uplift threshold" on the task label, within the mode's cost budget.
- **Labels and cost:** labels come from the user's next action, and cost labels include "cache misses caused by switching models" ([How Cursor Router works](https://cursor.com/blog/how-cursor-router-works)).

Cursor reports 30–68% savings against pricing every request at a single expensive model (mostly Opus 4.8), all vendor-measured ([Cursor Router](https://cursor.com/blog/router)). Its most-cited user complaint is that you cannot see which model handled a step ([Cursor forum](https://forum.cursor.com/t/show-which-model-handled-each-step-when-using-auto-mode/164163)). The portable parts are the uplift bar, next-action labels and pricing switch costs into labels. The learned Compass model is not portable: it rests on hundreds of thousands of labelled turns that Makeborne does not have.

**Lovable**, Makeborne's main competitor, has removed model choice and argues that "the model picker is a dead end":

- **Control plane:** a control plane watches progress and difficulty and switches models only when the switch is "worth the cost". "Recovery should change the thing that failed, whether that is the context, plan, tool, or model" ([Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)).
- **Evaluation:** each task runs five times at low, medium and high effort, with 95% significance marked. One judge was recalibrated after ranking a hollow build near the top, and another was dropped. In that eval, Fable 5.1 beat Fable 5 on iterative fixing by 11.9–17.2% at 31–39% lower cost, but was worse at 0-to-1 building at high effort (−2.7%, significant) and cost more there ([Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)). The same model can be the right choice for edits and the wrong one for greenfield work, which argues for routing by task axis.
- **Pricing:** Lovable charges 0.50–2.00 credits per build message, by complexity. A stopped request is charged only for work done, and each account gets 10 free fixes per rolling 24 hours ([Lovable credits](https://docs.lovable.dev/user-guides/credits); [Lovable FAQ](https://docs.lovable.dev/introduction/faq)).

**v0** offers the strongest public evidence that pipeline beats model. Its composite pipeline has three parts: a frontier base model, a "Quick Edit" model for narrow edits such as text, syntax and reordering, and an RFT-trained AutoFix model that checks the output stream during generation and runs a final lint pass. It reached 93.87% error-free generation against 64.71% for bare Claude 4 Sonnet, a 29-point gain, on Vercel's own eval ([v0 composite](https://vercel.com/blog/v0-composite-model-family)). v0 later restored a Mini/Pro/Max picker, in December 2025 ([Create With](https://www.createwith.com/tool/v0/updates/v0-restores-three-model-choice-with-mini-pro-and-max)).

The other app builders follow the same pattern:

- **Bolt** replaced individual model picks with Standard and Max agents. Its earlier release notes kept "Haiku 4.5 for quick edits" ([Bolt release notes](https://support.bolt.new/release-notes)).
- **Base44** routes by complexity, at about 0.5 to 1.5 credits a message, and makes "Resolve with AI" free ([Base44](https://base44.com/blog/update-smarter-building-with-automatic-optimization)).
- **Replit** moved to effort-based pricing ([Replit](https://replit.com/blog/effort-based-pricing)). After Agent 3 launched, one user reported spending about $1,000 in a week, and Replit admitted that effort-based pricing "can end up being more expensive over the lifetime of a project" ([The Register](https://www.theregister.com/2025/09/18/replit_agent3_pricing/)).

The IDE tools turn routing into a visible user benefit:

- **GitHub Copilot** routes "along natural cache boundaries and large drifts in conversation complexity", shows which model produced each response, and gives a 10% discount for using Auto ([GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)).
- **Devin's Adaptive** charges one blended per-token rate whichever model runs ([Devin docs](https://docs.devin.ai/desktop/adaptive)). An independent test caught it picking different models for the same prompt ([zenn.dev](https://zenn.dev/hsl/articles/6dcf337e2b73c6?locale=en)), a reminder that routes should be deterministic and their reasons logged.
- **Claude Code's `opusplan`** routes by phase (Opus plans, Sonnet executes) and keeps fallbacks "for the current turn only" ([Claude Code model config](https://code.claude.com/docs/en/model-config)). There is no public data on its quality.

Two more sources fill out the picture:

- **Gamma**, the deck competitor, runs more than 20 models and picks them by tracking "whether people edit and share their creations or become paying customers" ([SiliconANGLE](https://siliconangle.com/2026/10/06/exclusive-gamma-revamps-presentation-platform-to-make-output-look-more-human/)). It charges nothing when an AI action fails ([Gamma Help](https://help.gamma.app/en/articles/7834324-how-do-ai-credits-work-in-gamma)).
- **Aider's architect/editor split** gained 3–10 points over solo runs, though on 2024 models and with no account of cache costs ([Aider](https://aider.chat/2024/09/26/architect.html)).

The convergent recipe across the market is **Auto by default, price by task complexity, verify with a pipeline, and let the stronger model take stuck work**. Every major backlash came from opacity, silent downgrades or surprise bills, not from routing itself.

## Deterministic scope checks catch what vision judges miss

The best-measured way models fail at edits is localization: they change the wrong place, or change things nobody asked for. DesignBench (900 webpage samples across React, Vue, Angular and vanilla) names code localization as the main bottleneck for edit and repair tasks. Its failure analysis lists "unnecessary modifications" and "wrong objects", and the authors recommend giving models explicit edit locations ([DesignBench](https://arxiv.org/html/2506.06251v3)).

The tools that catch this are cheap and deterministic:

- **Stable component IDs:** Lovable's Visual Edits gives every JSX component a stable ID and maps a clicked DOM element back to its source, with edits applied as AST mutations ([Lovable Visual Edits](https://lovable.dev/blog/visual-edits)). Interaction2Code tags interactive elements with IDs and takes before and after screenshots ([Interaction2Code](https://arxiv.org/abs/2411.03292v3)).
- **ARIA snapshots:** Playwright's ARIA snapshots can be scoped to one locator ([Playwright ARIA snapshots](https://playwright.dev/docs/aria-snapshots)).
- **Pixel diffs:** pixelmatch detects anti-aliasing by default ([pixelmatch](https://github.com/mapbox/pixelmatch)).
- **"Diff confined to target":** DiffSpot's grounding gate, which keeps only pixel differences inside the target element, is exactly an "only the target changed" test ([DiffSpot](https://arxiv.org/abs/2605.29615)).

All of these are binary and repeatable, so their only error source is a bug in the harness.

Vision-language judges are reliable only when the question is narrow:

| Judging setup | Agreement with humans | Source |
|---|---|---|
| A narrow edit judged against a known instruction | 95.5% (GPT-4o) | [DesignBench](https://arxiv.org/html/2506.06251v3) |
| Checklist plus code plus several screenshots | 90.95% (Gemini 2.5 Pro); 74.9% without the code | [ArtifactsBench](https://arxiv.org/html/2507.04952v2) |
| Holistic pairwise preference between two web apps | ~70% (best judges), against ~85% between humans | [WebDevJudge](https://arxiv.org/html/2510.18560v2) |

Asked to spot unprompted differences, the best VLM found only 40.7% of real CSS changes. Claude Opus 4.7 found 31.2%, with 99.6% specificity ([DiffSpot](https://arxiv.org/abs/2605.29615)). That means **a VLM asked "did anything else change?" usually says no when something did**: a false accept, the dangerous direction. Order effects are large too. WebDevJudge's position consistency is 83–90%, and swapping candidate order reversed up to 60.9% of decisions in image-edit judging ([EditJudgeBias](https://arxiv.org/abs/2610.01670)). The rule that follows: deterministic diffs detect regressions, and the VLM answers only "is this change what was asked for?", given crops, a diff mask and the code diff, in both orders.

Instruction-following needs its own guard against forgetting. All 20 models in FronTalk overwrote features built earlier in the conversation. AceCoder, which re-checks every past instruction with a web agent, "reduces forgetting to nearly zero" and lifts performance from 56.0% to 65.3% ([FronTalk](https://arxiv.org/abs/2601.04203)). Executed interaction contracts find state errors at 2–16 times the rate of checkpoint-style evaluation, and visual quality does not predict behaviour ([WebRISE](https://arxiv.org/abs/2606.03220)). axe-core finds "on average 57% of WCAG issues automatically", and it is designed to produce no false positives ([axe-core](https://github.com/dequelabs/axe-core)). Lighthouse performance scores are too noisy to gate single edits, since the median of 5 runs is only "twice as stable as 1 run" ([Lighthouse variability](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)).

Makeborne's own qualification taught three lessons the literature predicts:

- **The check was the bottleneck.** All five first-pass copy-edit "failures" were the check's own false positives, a 25% false-reject rate. Their causes were a 3-file limit, hours written as a range, a removal that also deleted a now-unused CSS rule, and a finish gate that demanded fixes.
- **Gates must compare before and after.** That finish gate, the builder's 360 px layout check, demanded CSS fixes for problems already present in the saved sites, so every model "failed". A gate must fail only on new violations, keyed to the edit.
- **The fixed check has not been tested on fresh cases.** It was repaired on the same cases it now passes, so its 60-of-60 result needs a held-out set ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>)).

The gate stack for v4 follows from this.

| Gate | Class | Checks, in order | Target |
|---|---|---|---|
| A | Copy edits (Haiku lane) | Compile and render; existing copy check; AST scope (only text nodes, string literals or text attributes inside the target component ID); rendered-DOM text diff confined to the target subtree; pixel-diff clusters inside the target box plus a reflow band, desktop and mobile; no new axe violations; instruction-ledger re-run; Haiku one-item judge only for subjective wording ("punchier") | False accepts <1%, cost ≈ $0 |
| B | Targeted layout or style edits | Gate A with style and `className` changes allowed on the target; computed-style and box diff keyed by stable ID (the requested property moved in the requested direction, nothing else moved except reflowed siblings); scoped ARIA snapshot; both viewports; Haiku checklist judge on crops, diff mask and code diff, both orders, about $0.001–0.002 per edit | False accepts <5% |
| C | New builds, design reviews, decks | Compile, render, console errors; axe on all pages; executed interaction tests generated from the request and stored in the instruction ledger; checklist judge on code plus three screenshots (advisory, not a hard gate); for "is v2 better?", both orders, with ties counted as no improvement | Catch functional breakage; judge ranks, never certifies |

A Haiku 5.5 judgment over about 5,500 input tokens (before and after images at both viewports, plus diff and checklist) costs about $0.0007; the same on Opus costs about $0.028 (computed from [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision) and [pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Verification is cheap. The expensive part is engineering stable IDs and the diffing harness.

## An append-only snapshot turns a $0.23 edit into about five cents

Caching matches the prefix byte for byte. It is layered as tools, then system, then messages, and a change at any layer invalidates that layer and everything after it ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). For Makeborne's 26.6K-token prefix on Opus 5.5, sending it uncached costs $0.106, a five-minute write $0.133, a one-hour write $0.213 and a read $0.0053 (computed). A write is worth making whenever the chance of reuse within its TTL is above about 26%. Makeborne's edits today are "mostly cache writes" because the site sits in the prefix and changes with every edit. Each edit therefore invalidates the cache from the site onward, and the next edit pays for a fresh write.

The fix is a layout borrowed from Claude Code, Aider and Manus:

- **Breakpoint 1, static prefix:** close the static system prompt plus tools (about 8.6K tokens) on a one-hour TTL. At $0.069 per write it is identical for every project of an artifact type in the workspace, so it stays warm.
- **Breakpoint 2, site snapshot:** close a canonical site snapshot, serialized once per session in a fixed file order (global CSS and theme first, then shared components, then page sections) with deterministic formatting.
- **Breakpoint 3, the tail:** let automatic caching carry the moving tail.
- **Append, never re-render:** each edit appends the user's request and the model's `str_replace` calls, which are themselves the diff. Changes made outside the conversation, such as visual-editor tweaks, manual code edits or an edit by another model, go in as an appended "changes since snapshot" reminder, never as a rewrite of the prefix ([Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/); [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus); [Aider caching](https://aider.chat/docs/usage/caching.html)).

At edit 10 of a warm session, assuming about 2K new tokens and 1.5K output tokens per edit, the costs are:

| Item | Cost (computed) |
|---|---|
| Read the cached 44.6K tokens (26.6K prefix plus 18K of history) | ~$0.009 |
| Write the 2K-token tail | ~$0.01 |
| 1.5K output tokens | ~$0.03 |
| **Total** | **~$0.05**, against $0.12–0.16 for the same edit shape when the prefix is re-written; the measured cold median, with more output and calls, is $0.23 |

The rerun's warm low-effort arm cost $0.02–0.08, which brackets this figure ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>)). Re-snapshot when the cache is already cold: after the TTL expires, a model change or a new session. A full write is due then anyway. Inside a warm session, re-snapshot only for quality reasons, such as when the accumulated diffs exceed roughly 30–50% of the snapshot. That threshold is a heuristic to tune. One subtle rule follows for Codex's TaskDecision: **`relevantFiles` must ride in the tail as a hint, never reorder or trim the snapshot**, or every request breaks the cache.

Model and effort have to be sticky for this to work:

- **Effort:** pick one top-level effort per model for the whole workspace. Implement the per-class effort cells as per-message effort, which keeps the cache, never as top-level changes, which restart it ([Effort](https://platform.claude.com/docs/en/build-with-claude/effort)).
- **Model:** fix the model per conversation. Haiku runs its own session per project; a cold Haiku write of the 26.6K-token prefix costs only $0.0033, so Haiku's cold starts barely matter.
- **Escalation:** a Haiku-to-Opus escalation goes into the project's Opus session, warm if it exists, as an appended task packet, or into a fresh sub-conversation with a compact brief. Claude Code moves models the same way, through subagents with a hand-off ([Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)).
- **Design review:** run it as a fork of the build conversation. A fork inherits the parent's prefix and reads its cache ([Claude Code prompt caching](https://code.claude.com/docs/en/prompt-caching)), and adding images invalidates only the messages that come after them ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). The review would no longer pay $0.27–0.30 to re-ingest a site Opus has just written.

This also settles the Sonnet question for edits. Take a Sonnet-first cascade at about $0.02 per warm Sonnet attempt and Codex's 20% escalation rate. If escalations land on a cold Opus session at $0.23, the expected cost is $0.02 + 0.2 × $0.23 ≈ **$0.066, more than the ~$0.05 of warm Opus alone**. If the Opus session happens to be warm, the saving is about $0.02 per edit, under one credit, bought against a measured quality deficit (computed).

The TTL choice should come from data. Anthropic's measurements put the one-hour TTL ahead when about 1 turn in 20 follows a 5–60 minute pause, with break-even near 1 in 30 on the 5.5 models. The five-minute TTL is 15–19% cheaper for turns seconds apart ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). Makeborne should log the gaps between edits in each session and set the snapshot's TTL from that distribution. Keep-alive pings with `max_tokens: 0` are an option for an active tab, capped at three or four. Two points are unverified: how a ping that hits an existing entry is billed, and whether pre-warming works at all, since it "is rejected if extended thinking is enabled" and Opus 5.5's adaptive thinking is always on. Pass `diagnostics.previous_message_id` on every turn and alert on `model_changed` or `system_changed` ([cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)). Claude Code's team says to "monitor cache hit rate like uptime" ([Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)).

Output is the next lever. At $20/M on Opus, rewriting a 4K-token component costs $0.08, while a 300-token search/replace hunk costs $0.006 (computed). On Aider's polyglot leaderboard, Claude models produce well-formed search/replace edits 93.3–99.6% of the time ([Aider leaderboards](https://aider.chat/docs/leaderboards/)), and search-replace is the best format for large models ([Diff-XYZ](https://arxiv.org/abs/2510.12487)). An Anthropic-only stack needs no third-party apply model. Asking for shorter final answers cut cost about 13%, and a prompt audit saved 14% on upgrades ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).

Progressive disclosure through a file index and `read_file` does not pay at 18K tokens. A warm read of the whole site costs $0.0036, less than one extra discovery turn (computed from [effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Compaction is unnecessary for cost: even 30 edits only grow a session to about 87K tokens. Haiku sessions, however, need a hard re-snapshot ceiling near 80K so they never cross the 100K price cliff.

## Charge per task class and keep router mistakes off the bill

The fair end of the market uses four mechanisms:

- **System failures cost nothing:** Gamma charges nothing "when an AI action fails, shows an error, or asks a clarifying question" ([Gamma Help](https://help.gamma.app/en/articles/7834324-how-do-ai-credits-work-in-gamma)).
- **Per-action cost is visible:** Lovable shows "Credits used" on every response ([Lovable plans](https://docs.lovable.dev/introduction/plans-and-credits)).
- **Letting the vendor route is cheaper:** Copilot discounts Auto by 10% ([GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)).
- **Spend controls:** Replit offers budget limits and usage alerts.

Refund features need caps and must actually work. Readdy's Credit Care allows 10–480 discards a month ([Readdy](https://docs.readdy.ai/features/credit-care)). Vercel staff say v0 charges for fixes and then refunds them, a user called the "free" label misleading, and free fixes are capped "to prevent abuse" ([Vercel community](https://community.vercel.com/t/improving-credit-usage-transparency-for-the-fix-with-v0-free-button/32245)). Framer users reported that "Mark as Bad" did not restore credits ([Framer](https://www.framer.com/blog/ai-credits-simpler-plans-and-lower-prices/)).

Every major backlash had the same trigger: bills or quality the user could not predict, or changes that were badly communicated. Cursor's June 2025 "unlimited" confusion ended in an apology and refunds ([TechCrunch](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/)). Replit's effort pricing was amplified by a more autonomous agent ([The Register](https://www.theregister.com/2025/09/18/replit_agent3_pricing/)). OpenAI's GPT-5 autoswitcher failure brought the model picker back ([VentureBeat](https://venturebeat.com/ai/openai-returns-old-models-to-chatgpt-as-sam-altman-admits-bumpy-gpt-5-rollout)).

Makeborne's v3 policy already absorbs failed cheap attempts and never charges for them. That is a stronger promise than Lovable's (credits non-refundable beyond 10 free fixes a day) or Replit's (silent on failed work), and it belongs on the pricing page in plain words. v4 should go further:

- **Quote by task class:** quote the price for the class before the run, capped, and charge that price rather than the realized cost of whatever attempts happened. Escalations stay Makeborne's cost.
- **Show without billing by tier:** show which model and effort ran at each step, as Copilot does, but do not bill by tier under Auto. Otherwise every escalation looks like a hidden charge.
- **Refund platform failures visibly:** offer a capped, immediate, ledger-visible refund for platform-caused failures.
- **Keep releases separate:** never change pricing and routing in the same release.
- **Keep tier names stable:** Replit's repeated mode renames confused users ([Replit modes](https://docs.replit.com/features/agent/agent-modes)).

Set class prices from the 75th-percentile measured cost and let the margin absorb the tail. Anthropic's warning to "price the tail, not the median" comes from a run in which two of 20 problems carried 43% of spend ([Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). Flat class pricing does create a gaming incentive, since users gain by pushing requests up to Opus. Classifying on request structure and on results observed after the attempt, rather than on free text, and capping escalations per request, closes most of it.

## Codex has the right skeleton and the wrong middle rung

Codex's 23 October proposal splits cleanly. The orchestration skeleton matches the evidence. The model assignment and cost model do not.

| Codex element | Verdict | Evidence | What to test |
|---|---|---|---|
| Server-owned, validated TaskDecision {role, model, effort, relevantFiles, requiredChecks, maxRepairAttempts, reason} | **Right** | Rule tables win at small data ([Lee](https://arxiv.org/pdf/2608.23023); [ACRouter](https://arxiv.org/html/2606.22902)); Lovable's control plane; logged reasons answer Devin-style nondeterminism | Keep `relevantFiles` in the tail; derive `requiredChecks` from typed checklist extraction |
| One code writer per task | **Right** | Single-context work: "the orchestrator's model alone at lower effort came out ahead in every case measured" ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)) | — |
| Shared parent budget (RunSpend) | **Right, with a fix** | The design-review starvation bug is exactly a budget reserving away its own finish step | Reserve verification and finish budget up front; size reservations from p95–p99 measured spend, not worst case ([task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets)) |
| Infrastructure failover separate from quality escalation | **Right** | Already in v3; Claude Code's turn-scoped fallback; Lovable: failover fixes availability, "not bad approaches" | — |
| Task packets for handoffs | **Right** | Scrouting: the verified handoff, not routing, carried the result ([Scrouting](https://arxiv.org/pdf/2608.04804)) | Verify packet claims before use; feeding unverified handoff text to the router cut its savings from 34% to 8–9% |
| Auto default with progress messages | **Right** | Industry convergence | Add per-step model and effort display ([GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)) |
| Haiku for extraction, classification, small localized edits | **Right for copy edits** | Internal −97% with zero false accepts on the controls | Extend to simple style edits only behind Gate B (E6); Haiku low only for classification and extraction |
| **Sonnet 5.5 for ordinary business websites and routine components** | **Contradicted** | Sonnet 0 wins vs Opus 2 of 6 on edits, 0 of 2 on documents; Opus low ≈ Sonnet high per solved task; two-model rosters lose ≤1 point ([Misguided](https://arxiv.org/html/2610.02762v1)); cache-switch economics above | Sonnet high vs Opus low vs Opus medium on new sites (E4) and warm edits (E3) |
| Sonnet medium as a starting effort | **Contradicted** | −7 points on SWE-bench Pro, −15 on internal coding ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)); Sonnet's default is high | Drop the cell |
| Opus for escalation "after repeated failure" | **Partly right** | Opus should be the default writer, not a last resort; the first escalation should be effort on the same model; v3 caps at one repair and one escalation | Same-model per-message effort bump vs cross-model escalation (E3) |
| Cost model: 60K uncached + 10K output, −30% at 20% escalation | **Contradicted** (Codex flagged the assumption) | Makeborne's cost is cache writes plus output; with caching, Sonnet-first ≈ $0.066 vs warm Opus ≈ $0.05 | Replace with measured per-call usage |
| Per-attempt instrumentation of tokens, cache reads and writes, checks, repairs, outcome | **Right and most urgent** | Anthropic prices five usage counts; Cursor folds cache misses into cost labels | Add cache-miss reason, inter-edit gap, Opus share, p95 cost |
| Evaluate current Opus, Sonnet, adaptive, Opus-plan + Sonnet-build on the same prompts by cost per accepted result; never compare raw routed success rates | **Right on metric, incomplete on method** | Routed rates are confounded ([Misguided](https://arxiv.org/html/2610.02762v1)) | Add an A/A noise floor, K repeats, a random-split baseline at matched cost, mean-cost accounting; run Opus-plan + Sonnet-build only if Sonnet survives E4 |
| Image routing separate | **Right, low value** | Images cost a median $0.011 per build | — |

The central error is treating Sonnet as the natural middle rung. Makeborne's own blind, both-orders comparison on 22 October gave Opus two wins on visual craft (a table and cards), four ties and no Sonnet wins, while Sonnet cost 51–53% less. Opus also won both new documents on content substance ([Makeborne eval](<../research_notes/Model orchestrator v4 design/makeborne_internal_evidence.md>)). Six cases prove nothing statistically. They point the same way as Anthropic's data, though, where Opus 5.5 at low matches Sonnet 5.5 at high on cost per solved task because Opus does about half the work. They also fit the roster result that a two-model mix within one point of the best roster exists ([Misguided](https://arxiv.org/html/2610.02762v1)). With Opus at only twice Sonnet's token price, a Sonnet-first cascade to Opus must pass more than about half the time on a quality-equivalent check just to break even (computed). For edits, caching removes even that margin. For new sites, no runtime check certifies design quality, so a Sonnet-first cascade would ship lower-quality sites that pass compile and contrast checks: the "silent quality loss" no paper has measured.

The second error is the cost model. Codex itself noted that its illustration "assumes uncached input and equal final success". Makeborne's measured costs are dominated by cache writes and output, so savings computed on uncached input overstate model routing and hide the caching lever. Codex was right to propose per-attempt token logging. Makeborne records only dollar totals today, which is why none of these decompositions can yet be read off production data.

## Twelve ranked moves for the v4 orchestrator

The ranking weighs expected dollars or quality protected against the strength of the evidence. Effects marked "computed" are this report's arithmetic from measured and list prices.

| Rank | Move | Evidence | Expected effect | Confidence |
|---|---|---|---|---|
| 1 | **Cache discipline:** three breakpoints (static prefix at 1-h TTL, canonical snapshot, tail), append-only edit log with "changes since snapshot" reminders, model fixed per session, one top-level effort per model with per-message effort cells, volatile text at the end of the newest turn, cache diagnostics on every turn, hit-rate target ≥80% | Internal warm −70–90%; Anthropic median 84% cache read, 3.3x without caching, 20–50x for mid-session changes | Targeted edit $0.23 → ~$0.05 (computed); makes edits cheaper than Lovable's | High on mechanism; replay-test (E2) |
| 2 | **Per-call usage logging** (uncached, 5-m write, 1-h write, cache read, output), check results, repairs, escalations, cache-miss reason; KPIs: cost per accepted outcome at mean cost, Opus share, escalation rate per class, p95 cost | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence); [Cursor](https://cursor.com/blog/how-cursor-router-works); [router collapse](https://arxiv.org/abs/2602.03478) | Prerequisite for every other decision | High |
| 3 | **Fix design-review budget starvation**, run the review as a fork of the build conversation, then decide review vs no review on evidence | Internal: every review stops after one call; [Claude Code fork caching](https://code.claude.com/docs/en/prompt-caching) | Redeems or saves ~$0.30 per first build (30%) | High on the bug; review value unknown (E5) |
| 4 | **Two-writer roster:** Haiku 5.5 medium for Gate-A copy edits, Opus 5.5 for everything else; remove Sonnet from the default roster pending E3/E4 | Internal 3a and 22 Oct; [Anthropic cost per solved task](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence); [Misguided](https://arxiv.org/html/2610.02762v1) | Copy edits −97%; avoids a measured quality deficit | High for Haiku; medium for removing Sonnet |
| 5 | **Effort as the cost dial:** for checkable edit classes, Opus low first and a same-session re-run at high when the gate fails, through per-message effort | Run-low/re-run-high: $0.17 at 96–97.5% vs $0.21 at 92.8% for medium alone | Cold edits save ~10% (measured); on a warm edit the $0.02 saving is ~40% (computed); higher pass rate | Medium; needs Gate B |
| 6 | **Deterministic verification stack:** compile-time stable component IDs, Gates A and B, gates that fail only on new problems, an instruction ledger re-run on every edit | [DesignBench](https://arxiv.org/html/2506.06251v3); [DiffSpot](https://arxiv.org/abs/2605.29615); [FronTalk](https://arxiv.org/abs/2601.04203); internal finish-gate lesson | Makes every cheap attempt safe; −forgetting | High value; engineering cost |
| 7 | **Measure verifier error before trusting it:** defect injection plus correct alternative implementations, held out from check tuning; target ≤5% false accepts per class | [RouterBench](https://arxiv.org/html/2403.12031) ≤0.1–0.2 threshold; internal 25% false-reject episode | Tells you which classes may cascade | High |
| 8 | **Escalation semantics:** graded check output (which checks failed, by how much); one repair on the same model with check feedback; one escalation via a verified task packet into a warm Opus session; a stuck/circling detector; per-run step and dollar caps | [Dekoninck](https://arxiv.org/html/2410.10347) on binary feedback; [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end); [Scrouting](https://arxiv.org/pdf/2608.04804) caps | Bounded tail; fewer wasted escalations | Medium |
| 9 | **Static per-class routing for new sites, decks and ebooks** (no runtime cascade); pick effort offline, with Opus low as the candidate | No reliable quality verifier; [Lovable per-axis results](https://lovable.dev/blog/fable-5-1-now-in-lovable) | If Opus low passes E4, ~30–50% off a $0.68 build (estimate) | Medium; E4 decides |
| 10 | **Fair pricing:** per-class quotes with caps, failures absorbed, model and effort shown per step, capped immediate refunds for platform failures, no pricing change bundled with routing | [Gamma](https://help.gamma.app/en/articles/7834324-how-do-ai-credits-work-in-gamma); [Lovable](https://docs.lovable.dev/introduction/faq); [Copilot](https://docs.github.com/en/copilot/concepts/models/auto-model-selection); Cursor and Replit backlash | Trust; predictable bills | High (policy) |
| 11 | **Staged rollout:** shadow → staff canary → per-project ramp → 7-day soak, kill switch with automatic rollback, next-action labels; promote a pricier cell only past a one-sided 75% uplift bar, a cheaper cell only past pre-registered non-inferiority | [Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem); [Cursor](https://cursor.com/blog/how-cursor-router-works); [Spotify guardrails](https://arxiv.org/pdf/2402.11609) | Catches the subtle losses offline sets miss | High |
| 12 | **Output and prompt hygiene:** `str_replace` by default, whole-file writes only for new files or >50% rewrites, short final summaries, Opus's named frontend-defaults "don't" list in build prompts, a prompt audit | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) −13% and −14%; [Prompting Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) | A few percent of cost; a visible design-quality gain | Medium |

Two ideas deserve experiments rather than adoption. The first is a **Haiku scout** that localizes a targeted edit and hands Opus a checked packet: file, component ID and CSS rule. Scrouting found the verified handoff carried the result, and DesignBench recommends explicit edit locations, but an 18K-token site already sits whole in Opus's context, so the gain is smaller than on SWE-bench. The second is a **Haiku lane for simple style edits behind Gate B**, the v0 "Quick Edit" and Bolt "Haiku for quick edits" pattern. The economics clear easily (p > 12% at warm Opus prices), so its value rests entirely on Gate B's false-accept rate. A learned router belongs much later, and only in a narrow form: logistic regression or kNN over observed run features such as files touched, diff size and first-turn tool errors, trained on thousands of Makeborne's own outcomes and re-validated per class.

## What v4 should refuse to build

| Don't | Why | Evidence |
|---|---|---|
| Train a router on prompt text (embeddings, LLM-as-router) | Near chance on agentic coding, collapses out of distribution, within noise of a task table | [SWE-Router](https://arxiv.org/html/2607.00053v1); [ACRouter](https://arxiv.org/html/2606.22902); [Routing Plateau](https://arxiv.org/html/2606.07587v2) |
| Cascade new sites or decks at runtime (Sonnet first, Opus on failure) | No reliable quality check; the judge's ~1-in-5 A/A error sits at the 0.2 cascade line; an escalation is a full rebuild | [RouterBench](https://arxiv.org/html/2403.12031); internal |
| Run Sonnet 5.5 at medium on multi-step file editing | −7 points (−15 on internal coding) | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) |
| Switch models inside a conversation, change top-level effort mid-session, or edit system, tools or earlier messages per request | Per-model caches, 20–50x cost, 400 errors when thinking blocks are present on new accounts | [Claude Code caching](https://code.claude.com/docs/en/prompt-caching); [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) |
| Put timestamps, budgets or status lines at the front of the prompt | A 25-token status line forced a 101K-token rewrite | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) |
| Accept a cheap attempt on the model's own "done" | Self-correction is unreliable; Haiku reports changes done without running checks | [Huang](https://arxiv.org/abs/2310.01798); [Prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5) |
| Use a VLM to detect regressions, or holistic preference as the only gate | Recall ≤40.7%; about 70% human agreement | [DiffSpot](https://arxiv.org/abs/2605.29615); [WebDevJudge](https://arxiv.org/html/2510.18560v2) |
| Gate on the absolute state of a site | The 360 px finish gate failed every model on problems already there | Internal; [axe-core](https://github.com/dequelabs/axe-core) |
| Turn on the advisor tool or a multi-agent orchestrator by default | 0 of 20 consults; ~2.1x cost; single-context work loses | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) |
| Let Haiku sessions pass ~80K tokens | Above 100K every token costs 5x, output included | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) |
| Use `max_tokens` or tiny task budgets as cost controls | Invisible to the model; cut-offs still billed; budgets that are too small cause refusal-like stops | [Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence); [task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets) |
| Lower a default effort globally without per-class evals and a soak | Anthropic's reversed high→medium change | [Postmortem](https://www.anthropic.com/engineering/april-23-postmortem) |
| Bill per model or tier under Auto, bill failed attempts, ship pricing and routing together, rename tiers | Cursor, Replit and GPT-5 backlashes | [TechCrunch](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/); [The Register](https://www.theregister.com/2025/09/18/replit_agent3_pricing/) |
| Regenerate whole files or sites for small edits, or add a third-party apply model | Output costs $20/M; Claude search/replace is already 93–99.6% well-formed | [Aider](https://aider.chat/docs/leaderboards/) |
| Read "not significantly worse" on 12–20 cases as parity | Power is 0.25 to detect a true 65% win rate at n = 20 | [Miller](https://arxiv.org/html/2411.00640); computed |

## A $100 plan that prices everything and catches big regressions

Small samples set hard limits:

- **A 20-pair judge test catches only large losses:** an exact sign test on 20 decided pairs needs 15 wins for significance, and has only a 25% chance of detecting a true 65% win rate.
- **Non-inferiority needs far more pairs:** showing a cheaper arm no worse needs about **65 decided pairs for a 15-point margin and 150 for a 10-point margin** (computed from standard formulas).
- **Ties shrink the sample:** decided pairs exclude ties. On 22 October, 4 of 6 comparisons tied, and at that rate 65 decided pairs need roughly 160–200 judged pairs (computed).
- **Zero failures in a small set proves little:** none in 20 bounds the failure rate only below 14%, and none in 300 below 1%.
- **Cost is the easy part:** edit costs are tightly bunched (n = 25, $0.19–0.29), so 20 runs per arm pin a mean to about ±$0.01, and cost differences of 10% are readily detectable (computed).

The $100 plan can therefore deliver four decision-grade answers:

- costs per arm;
- deterministic pass rates;
- verifier error rates, from free defect injection;
- the judge's own noise floor.

For judged quality it can only deliver a smoke alarm that catches large regressions.

The method follows Anthropic's statistics guidance and the 2026 router-evaluation papers:

- **Pairing and repeats:** pair every comparison on identical items, run K = 2–5 samples per case, and cluster standard errors by site or prompt ([Miller](https://arxiv.org/html/2411.00640)).
- **Judge discipline:** count a win only when both orders agree, report ties, measure the A/A noise floor first, and calibrate on about 40 pairs that Kerim labels blind ([judge bias](https://arxiv.org/html/2406.07791v9); [noisy-judge correction](https://arxiv.org/pdf/2601.05420)).
- **Baselines and accounting:** charge each arm its mean cost, and include fixed-tier baselines plus a random Haiku/Opus split at matched cost ([Misguided](https://arxiv.org/html/2610.02762v1); [session-level routing](https://arxiv.org/pdf/2608.14641)).
- **Discipline on the cases themselves:** keep held-out cases away from check tuning, and pre-register each decision rule.
- **Judging cost:** run all judging through the Batch API at 50% off ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)).

Judge-cost assumptions (computed): about $0.034 per both-order edit pair (crops plus diff) and about $0.18 per both-order site pair (code plus four screenshots per site), batched.

| # | Question | Design | Est. generation | Est. judging | Cap | Pre-registered decision |
|---|---|---|---|---|---|---|
| 0 | What are Gate A and B's false-accept and false-reject rates? | ~300 defect-injected cases per class from saved accepted edits (wrong element, extra property, missing change, broken mobile layout, earlier instruction overwritten) plus 40 correct alternative implementations from Haiku | ~$1 | $0 | **$2** | A gate may decide a cascade only if its 95% upper bound on false accepts is ≤5% and false rejects ≤10% |
| 1 | What is the judge's noise floor? | 20 edit and 10 site A/A pairs taken from the K = 2 duplicates in E3/E4; 40 human-labelled pairs; also judge the pending 23 Oct runs (12 edit pairs, 8 review pairs) | $0 | ~$3 | **$3** | Any later effect inside the A/A band counts as noise |
| 2 | Does the append-only snapshot hold quality at ~$0.05 per edit? | 6 saved sites × 5 consecutive edits, new layout vs current, Opus medium | ~$9.5 | ~$0.5 | **$10** | Adopt if median cost per edit falls ≥50%, cache hit rate is ≥80%, there is no gate regression, and judged losses stay inside the A/A band |
| 3 | Edits: Opus medium vs Opus low with re-run at high vs Sonnet high | 20 cases (12 existing + 8 new incl. responsive), K = 2, warm sessions on the E2 layout | ~$11 | ~$3 | **$14** | Drop Sonnet if Opus wins significantly or Sonnet saves <1 credit per edit; adopt low+re-run if its gate pass rate ≥ medium's and judged losses stay inside the A/A band |
| 4 | New sites: Opus medium vs Opus low vs Sonnet high | 20 prompts; Opus medium reuses the saved 21 Oct builds where prompts match; Opus low K = 2; Sonnet high K = 1; review off in all arms; Gate C | ~$27 | ~$11 | **$38** | Opus low goes to shadow if cost per accepted build falls ≥25% and Opus medium wins ≤55% of decided pairs; reject if medium wins significantly; drop Sonnet unless it is ≥25% cheaper than Opus low with no significant loss |
| 5 | Is the design review worth $0.30? | After the budget fix: 16 saved sites, reviewed vs unreviewed and low vs medium | ~$9 | ~$5 | **$14** | Keep the review only if reviewed sites win ≥60% of decided pairs with no gate regressions; otherwise remove it from the default build |
| 6 | Haiku lanes on held-out cases | 40 new copy edits (8 Bosnian) K = 5; 20 simple style edits behind Gate B K = 3 | ~$1.6 | ~$0.7 | **$3** | Copy lane stays if there are no gate-confirmed false accepts and escalation ≤5%; style lane opens only if the Gate B pass rate is ≥60% with losses inside the A/A band |
| 7 | Decks and ebooks: Opus low vs medium | 8 decks + 8 ebooks, K = 1; measure cost per document first | capped | ~$3 | **$10** | Probe only; feeds the static per-class table |
| | Reserve | | | | **$6** | |
| | **Total** | | | | **$100** | |

Two notes on running the plan:

- **Order:** run E0, E2 and E6 first. They are cheap, mostly deterministic and unblock everything else, and the roughly $13.7 left in the 23 October $30 scope can fund them now. Then run E3 and E5, then E4, the largest item, and E7 last.
- **Missing Opus-medium builds:** if the 21 October saved builds do not match E4's prompts, generating 20 fresh Opus-medium builds costs about $14. Drop E7 to pay for it.

Rollout after the offline gates follows Makeborne's existing off/shadow/on switch.

1. **Shadow:** run each changed cell in shadow on 10–20% of live jobs and serve only the current output. Collect at least 150 judged paired shadow outputs per class, enough for a 10-point non-inferiority margin. Judging that costs about $5 per class for edits and about $27 for sites, outside the $100.
2. **Staff canary:** move to a staff and friendly-account canary.
3. **Per-project ramp:** ramp at 1%, 5%, 25%, 50% and 100%, randomized per project, with a sample-ratio-mismatch check at every stage ([Kohavi et al.](https://www.cambridge.org/core/books/trustworthy-online-controlled-experiments/sample-ratio-mismatch-and-other-trustrelated-guardrail-metrics/8DBB0F59AC7729D7BC6B94690DB9CCD5)).
4. **Soak:** soak at least 7 days at the largest stage. No vendor publishes a number, so this is a judgment call covering weekly cycles.
5. **Kill switch:** keep a kill switch that rolls back automatically on any guardrail breach.

The primary online metric is the share of jobs that finish without the user reverting, regenerating or re-prompting within a fixed window. These are Cursor's and Gamma's next-action labels ([Cursor](https://cursor.com/blog/how-cursor-router-works); [SiliconANGLE](https://siliconangle.com/2026/10/06/exclusive-gamma-revamps-presentation-platform-to-make-output-look-more-human/)). Test it at a fixed horizon. Watch guardrails (errors, latency, refunds, cost per job) with always-valid sequential tests so daily checks do not inflate false alarms ([Johari et al.](https://arxiv.org/pdf/1512.04922); [Spotify](https://arxiv.org/pdf/2402.11609)).

Some unknowns sit outside this plan:

- A head-to-head quality benchmark against Lovable, Bolt, v0, Base44, Replit and Gamma needs competitor subscriptions, not API credits.
- Haiku 5.5 and Opus 5.5 have not been measured as UI-edit judges.
- Pre-warming with Opus's always-on adaptive thinking, and the billing of keep-alive pings, need small tests.
- Deck and ebook costs per document are not yet measured.

## Conclusion

The orchestrator question turned out to be mostly a caching and verification question. In the one cascade Makeborne has measured end to end, the check, not the model, was the binding constraint: all five Haiku "failures" were false alarms from the check. Edits are also cheap enough that, once the cache stays warm, every routing choice among Opus effort levels and Sonnet moves less than one credit. The dollars that still matter are elsewhere: the cold cache (about $0.18 of a $0.23 edit is avoidable), a design review that consumes 30% of a first build without finishing, the effort level of the first build itself, and the Haiku copy lane. Engineering time spent on stable component IDs, an append-only snapshot and a working review budget will return more than any router. The literature's verdict that routing value concentrates at moderate difficulty fits this. Makeborne's easy cases belong on Haiku behind deterministic gates, its hard creative cases on Opus, and the middle is better handled by Opus's effort dial than by a third model.

The competitive implication is sharper than "beat everyone on price and quality". At Opus cost, Makeborne cannot undercut Lovable on a first build, and should not try by downgrading the builder. The defensible position is the best first build, the cheapest edits, and a written guarantee that customers never pay for the platform's own failed attempts. That is a claim no major competitor makes, and the v4 design can back it with measured costs and logged checks.
