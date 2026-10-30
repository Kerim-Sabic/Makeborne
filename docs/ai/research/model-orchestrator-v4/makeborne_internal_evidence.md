# Makeborne internal evidence (measured 22–23 October 2026) and the Codex proposal

Source: Makeborne's own eval harness (`scripts/eval/route-qualify.mjs`, `review-qualify.mjs`), ledger `outputs/eval/budget/ledger.json` (scopes model-routing-20261022 and model-orchestrator-20261023), the saved websites of the 21 Oct app-route run (`outputs/eval/runs/live-20261021T202136Z`). Images off in all runs (no OpenAI spend). All cost figures are provider USD per run. Quality judging of the 23 Oct runs was still pending when these notes were written; treat quality claims below as cost and check results only, unless marked as judged.

## 1. Cost structure of today's product (Opus 5.5 everywhere)
- First website build: median $1.01 (103 runs). About $0.68 is the build stage and about $0.30 the screenshot design review; about 9 Opus calls; output tokens (code and thinking) dominate.
- System prompt: about 7.6K tokens; tools about 1K; a typical site about 18K tokens (31K characters across 4–13 files).
- Inline SVG is 2.0% of site code with images off and 0–0.3% with images on; generated images cost a median $0.011 per build (p90 $0.032, 107 builds). Image generation barely changes token cost.
- A targeted edit on Opus medium (cold cache): median about $0.23 (n = 25 across 22 and 23 Oct; range $0.19–0.29).

## 2. 22 Oct routing test (Sonnet 5.5 vs Opus 5.5, blind Opus judge, both orders must agree)
- Targeted edits: Sonnet 51–53% cheaper; Opus won 2 of 6 (visual craft: a table, cards), 4 ties, Sonnet 0. Judge noise floor: an Opus-vs-Opus pair "lost" once (about 1 pair in 5).
- New documents (deck, book): Opus won 2 of 2 on content substance.
- New sites: inconclusive (1–1–1, confounded).

## 3. 23 Oct qualification (scope model-orchestrator-20261023, $30 approved; about $16.3 committed at the time of writing)

### 3a. Copy edits on Haiku 5.5 (20 cases, incl. 2 Bosnian requests, phones, emails, prices, hours, headings, a removal)
- Classifier: all 20 were classified copy-edit and routed to Haiku; all 12 targeted edits stayed off Haiku.
- First-pass results: Haiku medium passed the model-free copy check 15/20 at $0.005–0.007 per edit (1 credit); Haiku low 14/20 at $0.001–0.002. Opus medium baseline cost $0.17–0.24 (6–8 credits) per copy edit.
- The 5 "failures" were the check's own false positives: Opus's correct edits failed it on the same 5 cases. Causes found and fixed: (1) a value spread over 4 files tripped a 3-file limit; (2) the builder's own finish gate (360 px layout check) demanded CSS fixes for problems already in those saved sites, and every model made them; (3) hours written as "between 07:30 and 14:00"; (4) a removal that also deleted the now-unused CSS rule. After the fixes all 60 saved final results pass, and negative controls still fail (old tel: links, stray file changes).
- Expected cost per copy edit with Haiku first (computed): with the original 25% escalation and cold Opus escalations about $0.057 (−72% vs Opus); with the fixed check and near-zero escalation about $0.006 (−97%). A re-run of the 5–6 previously escalated cases on Haiku with the fixed check was in progress.

### 3b. Targeted edits: Opus 5.5 low vs medium effort (12 cases: 6 from 22 Oct plus 6 new)
- All 24 runs finished and compiled.
- Cost confound found: the low arm ran right after the medium arm on the same site and read a warm cache, costing $0.02–0.08. Re-run cold: Opus low $0.171–0.250 (median about $0.21) vs medium $0.189–0.285 (median about $0.23). **Effort low saves only about 10% on edits; the prompt-cache write of system prompt plus site is most of an edit's cost.** A warm cache cuts the same edit by about 70–90% (also: a Sonnet edit $0.085 cold vs $0.011 warm on 22 Oct).
- Quality judging (blind, both orders) pending.

### 3c. Design review: Opus 5.5 low vs medium (8 saved sites, one shared capture each)
- Medium $0.22–0.32 (median about $0.30), changed 1–4 files; low $0.21–0.27 (median about $0.245, about −18%), changed 1 file in 7 of 8.
- Product finding: every review stopped after one model call without calling finish (both arms; same in the 21 Oct app run: "Saved the progress made so far"). The review round's ceiling at Medium is 15 credits ($0.45); the first call (cold cache with screenshots and the whole site) costs about $0.27–0.30, so the next call's worst-case reservation no longer fits. The review never reaches its own finish checks or summary.
- Quality judging pending.

### 3d. Other measured facts
- Haiku 5.5 does not support the builder's thinking "updates" display; website stages now run without it on Haiku.
- Haiku attempts in agent loops: about $0.005 per attempt (2 calls) on an 18K-token site.

## 4. What is built (branch feature/model-orchestrator, routing policy v3, off by default)
- Copy-edit class with a model-free check (new text present, old text gone incl. tel:/mailto:, every changed file carries a requested value, unexplained lines ≤ 4, structure kept, removal not reworded, builder-demanded stylesheet fixes allowed).
- Per-class effort cells (lower only), escalation at the requested effort, an effort cascade (a lower-effort cell escalates to the same model at the requested effort), Haiku guidance in the request so the system prompt stays cached, failed cheap attempts absorbed (never charged), at most one repair and one escalation, infrastructure failures never escalate.
- A system-prompt cache marker (5-minute) is on the pricing branch (`feature/pricing-match-field`).
- Launch prices (pricing branch): $20 / $49 / $99 per month for 300 / 750 / 1,550 credits (about $0.064–0.067 per credit); a credit represents $0.03 of provider cost.

## 5. Codex's proposal of 23 Oct (to evaluate critically, not to adopt as given)
- Server-owned orchestration with a validated TaskDecision {role, model, effort, relevantFiles, requiredChecks, maxRepairAttempts, reason}; one code writer per task; shared parent budget (RunSpend); infrastructure failover kept separate from quality escalation; task packets for handoffs; Auto as the default with progress messages.
- Model assignment proposed: Haiku for extraction, classification and small localized edits; **Sonnet 5.5 for ordinary business websites and routine components**; Opus 5.5 for demanding visual direction, complex architecture and escalation after repeated failure; image routing separate.
- Effort starting points: Haiku low (extraction/classification) or medium; Sonnet medium (high for harder); Opus medium.
- Illustrative saving: 60K uncached input + 10K output; Opus $0.44, Sonnet $0.22, Haiku router $0.00045; with 20% Sonnet→Opus escalation the expected cost is about $0.31 (−30%). Codex notes this assumes uncached input and equal final success.
- Instrumentation: record per attempt the model, effort, task class, input/output/cache-read/cache-write tokens, tool and image cost, latency, checks, repairs, escalations, final outcome (Makeborne does not record token usage per call today, only dollar totals).
- Evaluation: compare the current Opus workflow, a Sonnet workflow, adaptive routing, and Opus-plan + Sonnet-build on the same prompts; metrics: cost per accepted result, functional completion, blind visual preference, prompt adherence, latency, correction/rollback rate; do not compare raw routed-traffic success rates.
- Points of tension with Makeborne's evidence: Sonnet lost on design in Makeborne's 22 Oct test; Anthropic's data shows Opus low ≈ Sonnet high at about the same cost per solved task; Codex's cost model uses uncached input, while Makeborne's measured cost is dominated by cache writes and output.
