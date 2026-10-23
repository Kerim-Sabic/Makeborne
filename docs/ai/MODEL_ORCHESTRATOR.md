# Model orchestrator: research and design (23 October 2026)

**Goal (owner):** use Haiku, Sonnet and Opus where each gives the best result, so customers don't waste credits, and quality doesn't drop.

**Branch:** `feature/model-orchestrator`, built on `feature/model-routing`. It is routing policy v3. Everything is **off by default**: routing mode `off`, no qualified routes. Nothing changes for customers until the qualification in §7 passes.

## The answer in one table

The rule: **start on the cheapest model whose result can be checked for free; escalate once, on evidence, to the builder model; never charge for the cheap attempt that failed.**

| Task class | Example | Today | Orchestrator cell (to qualify) | How the result is checked | If it fails | AI cost today → expected |
|---|---|---|---|---|---|---|
| **Copy edit** (new) | "Change the phone to +387 61 123 456", "Replace "Book now" with "Reserve"", "Promijeni radno vrijeme na 10:00–14:00" | Opus medium | **Haiku 5.5 medium** | Free check, no model: the new text appears, the old text is gone (tel:/mailto: too), ≤ 3 files and a few lines changed, no new structure, plus compile and the finish checks | 1 repair on Haiku, then Opus at the requested effort; Haiku's cost is not charged | $0.23 → **≈ $0.01–0.02** |
| Targeted edit | "Make the packages comparable cards" | Opus medium | **Opus 5.5 low**; Sonnet 5.5 medium as the alternative | Compile, finish checks, judged against Opus medium | Opus at the requested effort | $0.23 → **≈ $0.11** |
| Design review (screenshots) | After every build | Opus medium | **Opus 5.5 low** | Judged against Opus medium | — | $0.30 → **≈ $0.15** |
| Plan | Plan mode | Opus low/medium | Opus low | Plan validity | Opus medium | small |
| New site, redesign, unscoped or design edit | "Make it feel more premium" | Opus medium | **Unchanged: Opus medium** | Existing gates and review | — | unchanged |
| New deck or book | | Opus | **Unchanged**: Sonnet lost 2 of 2 on 22 Oct | | | unchanged |
| Chat (Standard), brief questions, lead ranking, personal emails | | Haiku | **Unchanged: Haiku** | | | already cheap |

At the new Create price ($0.0667 per credit), if the cells qualify:
- **A copy edit:** 1 credit, about 7¢. Lovable charges $0.13–0.30 and Base44 about $0.10.
- **A targeted edit:** about 4 credits, about 27¢. It was 8 credits, 53¢.
- **A first website:** about 29 credits, about $1.93. It was 34 credits, $2.27.

## 1. What each model is good at

Sources are Anthropic's model pages and docs unless marked; [3rd] means third-party and lower confidence.

| | Claude Opus 5.5 | Claude Sonnet 5.5 | Claude Haiku 5.5 |
|---|---|---|---|
| Released | 22 Sep 2026 | 28 Sep 2026 | 7 Oct 2026 |
| Price per 1M tokens (input / output / cache read) | $4 / $20 / $0.20 | $2 / $10 / $0.10 | $0.10 / $0.50 / $0.01 (5× above 100K-token prompts) |
| Anthropic positions it for | "Long-running agentic coding and knowledge work"; the default "if you're unsure" | "Best combination of speed and intelligence"; "well-scoped everyday tasks, fixing bugs, polished documents" | High-volume, cost-sensitive work: classification, routing, sub-agents, "checkable outputs"; Sonnet/Opus for complex agentic coding |
| Agentic coding | Terminal-Bench 4.0 66.4%; FrontierCode 54.4% (54.6% at default medium) | Terminal-Bench 70.6%; FrontierCode 52.1% | Terminal-Bench 39.2%; FrontierCode 46.4% |
| Front-end design [3rd, WebDev Arena snapshot] | #1, 1807 | #3, 1768 | 1586 (≈ 22% win rate against Opus on whole builds) |
| Cost per solved task (Anthropic's SWE-bench Pro subset) | low 87.4% at $0.11 · medium 92.8% at $0.21 · high 95.3% at $0.29 · xhigh 96.7% at $0.74 | high 87.6% at $0.11; medium about 7 points lower at 59% of the cost | 93% of 79 internal agent tasks at $0.011 per pass |
| Vision | Even at **low** effort it reads charts better than Opus 5 at its maximum, using a tenth of the tokens | Good | Weaker (Chartography 46% vs 64%) |
| Speed [3rd, Artificial Analysis] | ~80 output tokens/s at medium | Fastest Sonnet yet (+30%) | ~170 output tokens/s |
| Known failure modes | Without named patterns to avoid, falls back on a few default styles; at max effort it can use the whole budget and produce nothing; may summarise before finishing | Adds tests, docs and files nobody asked for; at low effort skips verification; at low and medium may stop to check in; tool-name case slips | In long coding prompts at low effort it stops early; at low and medium it reports done without checking; **does not support the builder's progress notes** (handled: website stages now run without them) |

**Anthropic's advice on combining models, in its own order:**
1. Prompt caching first.
2. Then input hygiene.
3. Then effort: "tuning effort is often a better lever than switching models". For example, Opus at low matches Sonnet's default for about 7% more per solved task.
4. Then "run everything at low, re-run only the failures higher": about 97% solved at $0.17, against 95.3% at $0.29 when everything runs high.
5. Only then a cheaper model, judged on cost per *completed* task and on the hardest tenth of the work, not the median.

The **advisor** tool (a cheap model consulting a stronger one inside the same request) is allowed with Haiku 5.5 as executor and Sonnet 5.5 or Opus 5.5 as advisor. In Anthropic's own test, though, the executor consulted on 0 of 198 questions and cost rose 12–25%. The **orchestrator** shape (frontier model plans, cheap workers build) pays only when there is bulk too big for one context. On single-chain work, the coordinator alone at lower effort won every measured case.

## 2. What Makeborne measured

- **A first website** costs a median **$1.01** (103 runs). That is a build stage of about $0.68 plus the screenshot design review at about $0.30, across about 9 Opus calls. Output tokens dominate: the code written plus thinking.
- **A targeted edit:**
  - On Opus it costs a median **$0.23** (n = 13); on Sonnet $0.109 (n = 6).
  - Most of an edit is the cache *write* of the whole project: 7.6K tokens of system prompt plus about 18K tokens of site, on every request.
  - With a warm cache the same Sonnet edit cost **$0.011 instead of $0.085** (−87%).
- **Image generation barely changes token cost:**
  - Inline SVG is only **2.0%** of a site's code with images off (20 sites, 21 Oct; icons come from the icon library, not drawn SVG), and **0–0.3%** with images on (23 Oct runs).
  - Images themselves cost a median **$0.011** per build (p90 $0.032, 107 builds).
  - So the routing decisions and the cost figures here hold with image generation on. Image model choice is routed separately (`src/lib/builder/image-router.ts`).
- **22 Oct blind test** (Opus judge, both orders must agree):
  - On edits Sonnet lost 2 of 6 on visual craft (table, cards) and tied 4.
  - On documents Opus won 2 of 2.
  - New sites were inconclusive.
  - The judge's own noise floor is about 1 pair in 5 (Opus vs Opus "lost" once).
  - Haiku was never tested.

## 3. What the field does

- **Cursor Router (Jul 2026):**
  - A complexity predictor scores each turn; easy turns go to a cheap model. A task router then picks the frontier model that did best on that task type ("bounded edits", "visual-heavy changes").
  - Labels come from user behaviour: moving on counts as good, correcting the agent as bad. Cache misses from switching models count as cost.
  - A frontier model must clear a "75% uplift" bar.
  - Claimed: 41–68% cheaper at equal or better satisfaction. Users still complain that "Auto got worse".
- **Lovable:** no model picker. A "control plane" assigns build steps to models and switches only when the gain beats the lost cache. In-house small models handle routing and summaries. "Try to fix" is free.
- **v0:** a "Quick Edit" model for "updating text, fixing syntax errors, or reordering components", and a frontier model for new or large changes. Deterministic autofixers run while streaming.
- **Bolt** (earlier: "Haiku 4.5 for quick edits"), **Base44** ("Automatic" is the default; manual choice "can use more credits"), **GitHub Copilot** (Auto at a 10% discount, shows which model ran), **Replit** (a Lite mode for "small scoped changes"), **Claude Code** (`opusplan`: Opus plans, Sonnet executes).
- **Research** (RouteLLM, FrugalGPT, AutoMix, RouterBench, LLMRouterBench 2026):
  - Learned routers rarely beat simple baselines and collapse to the majority class.
  - **Cascades win only while the verifier's error stays under about 10–20%.**
  - LLM judges flip on swapped order about a third of the time, so judge both orders.
- **Backlash cases:** ChatGPT's GPT-5 router and Anthropic's own April 2026 effort-default change. Users noticed drops that internal evals missed, which is why rollouts need shadow mode, soak periods and gradual steps.

## 4. Design principles that follow

1. **Free wins first.** The system-prompt cache marker is done on `feature/pricing-match-field`. The next free win is a cache-stable edit context (§6.2).
2. **Effort before model.** Opus at low effort is the first candidate for targeted edits and the review. It keeps the strongest designer and halves the cost.
3. **A cheap model only where a free check exists.** That is the copy-edit class: the result is verified without any model, so the verifier's error is close to zero, well under the 10–20% at which cascades stop paying.
4. **One cheap attempt plus one repair, then escalate** with the failure notes, at the requested effort.
   - The failed cheap cost is absorbed, never charged.
   - Each request is classified again, so escalation is never sticky.
5. **Rules, not a learned router,** at our volume. A tiny Haiku classifier (about $0.0001) is the next step for ambiguous or multilingual requests. Today's rules read English plus common Bosnian, Croatian and Serbian verbs.
6. **No advisor and no multi-model orchestrator yet.** Anthropic's own measurements show neither pays on our shape of work. Revisit for very long books or 20+ page sites.
7. **Measure honestly:**
   - paired blind judging in both orders, with ties when they disagree;
   - an A-vs-A noise floor;
   - deterministic checks wherever possible;
   - then shadow mode, then one class at a time.

## 5. What is built (policy v3, off by default)

- **`src/lib/ai/copy-edit.ts`:**
  - Copy-edit detection: replace, correct or remove, with 1–6 explicit values.
  - Quote styles straight, curly, „low-high“ and «guillemets»; apostrophes are not quotes.
  - Values: phones, emails, links, times and prices.
  - Unicode-safe word matching for Bosnian, Croatian and Serbian.
  - Not a copy edit: additions, styling, layout, images, forms, or removing a block.
  - The model-free check described above, including "reworded instead of removed".
- **`src/lib/ai/model-routing.ts`:**
  - The `copy-edit` class. Price words don't count as business risk there; security and legal words still keep it on Opus.
  - `CANDIDATE_CELLS`, measured but never executed by default.
  - Per-class effort: `MAKEBORNE_ROUTE_<CLASS>_EFFORT`, which can only lower effort.
  - The escalation's own effort, which is the requested one.
  - `attemptGuidance()`: Anthropic's Haiku "keep working until done, re-read what you changed" text, put in the request so the system prompt stays identical and cached.
  - A repeated copy-check failure escalates instead of stopping.
  - Haiku is accepted for website stages, and still refused for plans and documents, which need progress notes.
- **`src/lib/builder/agent.ts`:** asks for progress notes only from models that offer them, and runs an attempt at its cell's effort.
- **`src/lib/builder/website-stage.ts`, `website-run.ts`:** the copy check runs on routed attempts, never on the Opus escalation; the request, effort and guidance are passed through.
- **Tests:**
  - `check-copy-edit.cjs`, 7 checks;
  - `check-model-routing.cjs`, 21 checks (3 new), including the full scenario: Haiku misses the text, the free check catches it, the repair is retried, Opus fixes it, and the customer pays only for Opus;
  - `npm test` 193/193, tsc and eslint clean.

To try it (staging only), set:

```
MAKEBORNE_MODEL_ROUTING=on
MAKEBORNE_ROUTE_COPY_EDIT=claude-haiku-5-5
MAKEBORNE_ROUTE_TARGETED_EDIT_EFFORT=low
MAKEBORNE_ROUTE_REVIEW_EFFORT=low
```

Start with `MAKEBORNE_MODEL_ROUTING=shadow`, which records decisions without changing anything.

## 6. Next

1. **Qualification:**
   - **Budget:** about $25–30 of AI, which needs the owner's approval.
   - **Method:** saved eval sites, on the release-auth stack, with `scripts/eval/route-qualify.mjs`.
   - **Design-sensitive classes:** pass = zero judge losses with both orders agreeing.
   - **Copy edits:** the deterministic check plus a screenshot judge.

   | Class | Cases | Arms | Estimated cost |
   |---|---|---|---|
   | Copy edit (new cases, incl. Bosnian, tel: links, prices) | 20 | Haiku medium, Haiku low, Opus medium (baseline) | ≈ $7 incl. judge |
   | Targeted edit (the 6 from 22 Oct + 6 new) | 12 | Opus low vs Opus medium | ≈ $7 |
   | Design review | 8 sites | Opus low vs Opus medium | ≈ $6 |
   | A-vs-A noise floor and repeats | — | — | ≈ $5 |

   This is a screening test (small n); the real gate is shadow mode and then a gradual rollout.
2. **Cache-stable edit context:** the biggest quality-neutral saving for edits.
   - **Design:** order the `current_files` snapshot so files unchanged since the last edit come first, with a cache marker after them. An edit then reads most of the site from cache and writes only the changed files.
   - **Expected:** about −40% on consecutive Opus edits, judging by the $0.085 → $0.011 warm-cache measurement. It changes only file order, not content; measure cache hits, then quality.
3. **Haiku request classifier** for requests the rules can't place, and for other languages: structured output, about $0.0001 per request.
4. **Document copy edits** (deck and book text corrections) as a Haiku class, with the same kind of check.
5. **Customer-facing:**
   - The field (Copilot, Cursor) shows which tier ran.
   - Proposal: label quick edits "Quick edit", with a "Redo with the full builder" button. No model names, per our receipts policy.

## 7. v4 plan: beat every competitor on price and quality (owner, 23 Oct: up to $100 more Claude testing after the first qualification)

**The idea:** every request runs on the cheapest *cell* (a model and an effort) that a free check can confirm. A failure moves one step up, and the customer pays only for the step that succeeded. Quality is protected four ways:
- free deterministic checks wherever possible;
- a free visual check;
- the builder model as the fallback;
- per-class qualification before anything changes for customers.

The v4 pieces, ordered by expected saving and the risk to quality:

| # | Piece | What it does | Quality risk | Why it beats the field | Test plan and budget |
|---|---|---|---|---|---|
| 1 | **Cache-stable edit context** | The `current_files` snapshot lists files unchanged since the last edit first, then a cache marker, then the changed files. Consecutive edits read most of the site from cache. | None by construction: same content, different file order | Edits get cheaper on every model; Lovable re-bills context on each edit | 10 three-edit sessions, old vs new order: cache-hit rate, cost per edit, and a judge spot-check on 6 edits. **≈ $12** |
| 2 | **Effort cascade on the same model** | A routed cell at lower effort (Opus low) escalates to the *same* model at the requested effort when a check fails. Today escalation exists only across models. | Low: failures are retried at today's setting | Anthropic measured "low first, retry the failures high": 97% solved at $0.17, against 95.3% at $0.29 | Reuse the 12 targeted-edit cases plus 8 harder ones: **≈ $6** |
| 3 | **Free visual check** | Screenshots before and after a cheap edit (local Playwright, no AI). Pixels may change only near the edited text; large layout shifts or other sections moving escalate. | None: it only adds a check | A verifier with almost no error lets the cheap tiers take more work safely, in line with the RouterBench rule that verifier error must stay under about 10–20% | Built and validated on the saved copy-edit results: **$0** |
| 4 | **Haiku request reader** | One structured Haiku call (about $0.0001) per edit turns the request into class, targets and exact old → new values, in any language. Rules stay the fallback. | Low: it only classifies, the checks still decide | More requests qualify as copy edits (Bosnian, vague wording), and the copy check gets exact old/new pairs | 120 labelled requests (60 English, 40 Bosnian, 20 tricky), accuracy against the rules: **≈ $0.10** |
| 5 | **New-site build sweep: effort and model** | First builds with three arms on the same briefs: today's Opus medium, Opus low (review at medium), and Sonnet medium. The Sonnet arm is Codex's 23 Oct proposal, "Sonnet for ordinary business websites". | Real: design is where quality shows. Sonnet lost on design on 22 Oct | A first website at about $1.20 instead of $2.27 if a cheaper arm holds | 10 golden briefs × 3 arms, blind-judged in both orders: **≈ $28**. Adopted only with zero judge losses beyond the noise floor |
| 5b | **Per-call usage logging (no spend)** | Every provider call records its input, output, cache-read and cache-write tokens in the call detail. Today only dollar totals are kept. | None | Measures true cost per accepted result, the cache hit rate, and the cache cost of switching models, which cache-aware routing needs (Codex's 23 Oct point) | $0 |
| 6 | **Decks and books effort sweep** | New decks and books at Opus low vs medium | Real for content depth (Sonnet lost here) | Decks at about 25¢, books at about 40¢ | 6 documents × 2 arms plus the docs judge: **≈ $6** |
| 7 | **Bigger sample on the winners** | More targeted and copy edits for any cell that passed, including Bosnian requests and image-led sites | Lowers false confidence | Rules out a lucky small sample | **≈ $15** |
| 8 | **Learning from customers (no spend)** | Each operation records its route. A redo, undo or "fix it again" on the same element within 10 minutes counts as a miss for that cell (Cursor's method). A weekly report shows the miss rate per cell. | None | The cells keep earning their place on real traffic | $0 |
| 9 | **"Quick edit" in the UI (no spend)** | Quick edits are labelled, with a "Redo with the full builder" button that is free when the quick result was wrong | None | Copilot and Cursor show the tier; nobody refunds a bad quick edit automatically | $0 |

**Total planned:** about $68 of the $100, leaving about $32 for repeats where a result is close.

**Rules for the v4 tests:**
- One lever per test.
- Judge in both orders, and measure the A-vs-A noise floor.
- A cell is adopted only with no losses beyond that floor, and only through shadow mode first.

**Not planned, and why:**
- **The advisor tool:** consults collapsed in Anthropic's own test.
- **A multi-model orchestrator:** our work fits one context.
- **Sonnet for design work:** it lost on 22 Oct.
- **A trained router:** our volume is too small, and the research shows rules plus a good verifier win.

**Target once v4 qualifies,** at the $20 Create price:

| Job | Makeborne | Field |
|---|---|---|
| Copy edit | 1 credit, about 7¢ | Lovable 13–30¢ |
| Targeted edit | 2–4 credits, 13–27¢ | — |
| First website | 18–29 credits, $1.20–1.93 | Lovable $1–2 untested, $2.50–5 tested |
| Deck | 4–8 credits, 27–53¢ | Gamma 18–90¢ |

## 8. Qualification results and the first v4 pieces (23 Oct, evening)

### 8.1 The $30 qualification: final results

Spent **$23.32 of the $30** (scope `model-orchestrator-20261023`, local eval stack, images off). The blind judge is Opus, both orders; a pair counts only when both orders agree. In this round the judge agreed with itself on every pair. So the A-vs-A row measures how much two runs of the *same* setup differ, and that is the noise floor to beat.

| Class | Arms | Cases | Blind verdict | Cost | Reading |
|---|---|---|---|---|---|
| Copy edit | Haiku medium vs Opus medium | 20 (incl. 2 Bosnian) | Haiku 2, Opus 1, **ties 17** | $0.005–0.007 vs $0.17–0.24 per edit | Haiku matches Opus. The copy check passes all 60 saved results; its negative controls fail. **Ready for shadow mode.** |
| Targeted edit | Opus low vs Opus medium | 12 | 4 / 4 / 4 ties | cold: median $0.21 vs $0.23 (−10%) | No quality difference visible, but only a 10% saving |
| Noise floor | Opus low vs Opus low (a second cold run) | 12 | 3 / 4 / 5 ties | — | **Two identical setups "win" 7 of 12 pairs.** One run-to-run sample cannot separate arms at n = 12 |
| Design review | Opus low vs Opus medium | 8 sites | low 3, medium 4, tie 1 | median $0.245 vs $0.30 (−18%) | Within noise. Both arms stopped after their first call (the budget bug below), so it re-qualifies after the fix |

**Decisions:**
- Copy edits on Haiku go to shadow mode next.
- Lowering effort on Opus edits is not worth a rollout: the saving is about 10%, and caching saves far more (8.2).
- The review is re-tested once it can complete.

### 8.2 Built today (branch `feature/model-orchestrator`, nothing switched on, no spend)

**1. Design-review budget bug (fixed).**
- **The bug:** a call's reservation priced every input token at the cache-write rate. A review round at Medium has 15 credits ($0.45), and its cold first call (system prompt, site and screenshots) costs about $0.27–0.30. The second call's reservation then no longer fitted, even though that call reads almost all of its input from the cache at 1/25 of the price. Every measured review ended after one call, without its finish checks.
- **The fix:** a call that continues a cached conversation reserves the cached prefix at the read price. Where:
  - `ContextMeter.cachedTokens` / `noteCache` in `src/lib/ai/anthropic-call.ts`;
  - `RunSpend.begin(…, { worstCaseMicrousd })` in `src/lib/ai/run-spend.ts`.
- **What counts as cached:** only what the previous call *reported* reading from or writing to the cache, and only while that cache is surely alive:
  - the same model and settings (tools, system, effort, thinking, betas);
  - under 4 of the 5 minutes since that call started;
  - an unchanged history;
  - at most 18 new positions, inside the provider's 20-position lookback.
- **The worst case without the cache:**
  - It is what the database gate reserves and polices, so a dropped cache can never trip the platform's emergency stop.
  - It must fit the run's allowance plus `CACHE_MISS_MARGIN` (50%).
  - A call above its reservation but within its worst case is recorded as `cacheMiss`. It is not an overrun.
  - Usage that cannot be confirmed counts at the worst case.
- **For review (Codex):** this changes spending semantics. A run stays within its allowance unless the provider drops a cache it just reported, and never goes past allowance × 1.5. Settlement still charges at most the hold, and the platform absorbs the rest. Tested end to end: a 15-credit round now continues past its cold first call (`check-live-spend.cjs`).

**2. Token usage for every AI call.**
- **Per call:** `TokenUsage` (input, cache read, cache writes by TTL, output, image input, web searches) goes into each call's `detail.usage` on `live_provider_calls`, for every route that uses `RunSpend`, text and image alike. Failed calls record the tokens they reported.
- **Per run:** website, document and plan runs add `usage` per model to their settlement detail (`RunSpend.usageByModel()`, including the cache-miss count).
- **Why it matters:** this is the data needed for true cost per accepted result, the cache hit rate, and cache-aware routing.

**3. Cached site snapshot** (`src/lib/builder/site-snapshot.ts`).
- **Request layout:**
  - tools;
  - the system prompt, with a 5-minute cache marker (agent, docs agent and planner, as on the pricing branch);
  - a snapshot of the site, with its own marker;
  - then everything that changes per request: attachments and screenshots, the project details, `<changes_since_snapshot>` (the current content of changed files and the deleted paths), the images, and the request.
- **Which version is the snapshot:**
  - It follows from the saved versions alone, so every run recomputes exactly what the run before it sent. No timing guesses, and no new database fields.
  - Versions are grouped in fixed blocks of 6. In a block, the first version with files is the snapshot, and it stays so while the changed files are at most half the site; otherwise that version becomes the snapshot.
  - Measured on 32 saved edits: one edit rewrites 8–38% of the site (median about 18%).
- **Where it's wired in:** the build route and both eval harnesses share it. A repair attempt keeps the snapshot and recomputes the changes from the working copy.
- **This supersedes the "unchanged files first" order in §6.2 and §7 row 1.** Which files are unchanged differs from edit to edit, so that order would never give a byte-identical prefix twice.
- **The request guard** now refuses any cache marker (tools, system or message block) that is not a 5-minute one, because bounds price cache writes at that rate.
- **Expected effect** for a run started while the previous run's cache lives: the system prompt and the unchanged part of the site are read, not written. That is about $0.05 for the system prompt plus about $0.07 for the snapshot, on a $0.23 Opus edit: roughly half. To be measured with the usage log before any claim.

**Known limits:**
- **A design review can't reuse an edit's cache.** Reviews drop the image tool, and tools come first in the cached prefix. Keeping the tool listed but disabled in reviews would allow the reuse; it changes review behaviour, so it needs a decision and a test.
- **Documents (decks, books) keep the old layout.**

**Tests:**
- `check-live-spend.cjs`: 40 checks, 7 new. They cover the cache-aware reservation, the review scenario end to end, staleness, edited history, the lookback limit, the dropped-cache miss within the margin, worst-case accounting, token usage records and the snapshot request layout.
- `check-site-snapshot.cjs`: 5 new checks. They cover the anchor rule, determinism across version windows and byte-identical snapshot text.
- `npm test` 194/194; tsc and eslint clean.

## Sources

- **Models:**
  - https://platform.claude.com/docs/en/about-claude/models/overview
  - https://www.anthropic.com/news/claude-opus-5-5
  - https://www.anthropic.com/news/claude-sonnet-5-5
  - https://www.anthropic.com/news/claude-haiku-5-5
  - https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- **Cost and effort:**
  - https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
  - https://platform.claude.com/docs/en/build-with-claude/effort
- **Advisor:** https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
- **Prompting guides:**
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5
- **Third-party measurements:**
  - https://artificialanalysis.ai/models/claude-opus-5-5-medium/providers
  - https://www.benchleader.com/benchmarks/lmarena_webdev
- **How products route:**
  - https://cursor.com/blog/how-cursor-router-works
  - https://lovable.dev/blog/the-model-picker-is-a-dead-end
  - https://vercel.com/blog/v0-composite-model-family
  - https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent
  - https://github.blog/changelog/2026-06-17-auto-mode-in-copilot-chat-available-for-all-users/
  - https://docs.base44.com/Account-and-billing/Credits
  - https://docs.replit.com/features/agent/agent-modes
  - https://code.claude.com/docs/en/model-config
  - https://anthropic.com/engineering/april-23-postmortem
- **Research:**
  - https://lmsys.org/blog/2024-07-01-routellm
  - https://arxiv.org/abs/2305.05176 (FrugalGPT)
  - https://arxiv.org/abs/2310.12963 (AutoMix)
  - https://arxiv.org/html/2403.12031v2 (RouterBench)
  - https://arxiv.org/abs/2601.07206 (LLMRouterBench)
  - https://arxiv.org/abs/2605.07395 (router collapse)
  - https://arxiv.org/pdf/2306.05685 (LLM-as-judge)
  - https://www.anthropic.com/research/statistical-approach-to-model-evals
- **Makeborne:**
  - `docs/release-review/model-routing-20261022.md`
  - `docs/market/teardown-2026-10-23/deep/pricing-economics.md`
  - `outputs/eval/budget/ledger.json`
