# Industry routing practice: how AI coding and app-builder products route between models, efforts and "apply" models (as of 23 Oct 2026)

Conventions used below:
- **[Vendor]** means a company-reported claim, not independently measured.
- **[Independent]** means a third-party measurement or observation.
- **[Anecdotal]** means a forum or user report.
- **[Unverified]** means it came only from a search summary or a secondary aggregator and I could not open the primary source.
- Model names below are the ones these vendors use in this timeline (Opus 4.8, Opus 5, Fable 5 / 5.1, GPT-5.6 Sol, Grok 4.5 and so on). Makeborne's pool is Haiku 5.5, Sonnet 5.5 and Opus 5.5 at low, medium or high effort.

## Cursor: Cursor Router / Auto (Compass complexity predictor, task router, labels from user behaviour, cache-switch cost, uplift bar), Composer, instant apply / speculative edits, Tab

### Takeaway
Cursor runs the most fully documented production router. It works in two stages. First, "Compass" predicts whether the user will be satisfied and uses that as a proxy for complexity, which decides cheap path versus escalation. Second, a task-taxonomy router picks a frontier model, but only if that model clears a 75% one-sided uplift bar on that task label and the mode's cost budget allows it. Labels come from the user's next action, and cost includes the cache misses caused by switching. Results are strong but vendor-reported. Users complain mostly about opacity: you cannot see which model ran. Cursor's other specialised models (instant apply, Tab, Composer) show a consistent recipe: fine-tune a narrow model for a narrow job and train it on the product's own accept/reject signals.

### Cited Findings
**Cursor Router launch (22 July 2026)**
- Launched 22 July 2026 for Teams and Enterprise plans, with three modes: Intelligence ("Frontier quality"), Balance ("Strong quality") and Cost ("Good quality … optimizing token spend"). Admins can enable it per team or group, choose which modes members may use, set the default mode, and allow or block specific models. — [Cursor, "Introducing Cursor Router"](https://cursor.com/blog/router)
- **[Vendor]** Results claimed at launch:
  - Online A/B tests showed "frontier-quality performance at 60% savings."
  - Early-access enterprises saw "approximately 30–50% lower cost."
  - Auto Intelligence is "near Fable" on user satisfaction at "about 60% lower cost for teams," and about 15% more satisfying than Opus 4.8 at nearly the same cost.
  - Auto Balance is "above Opus 4.8" at "about 36% lower cost."
  - Three high-volume accounts saved 30–50% against all-Opus-4.8 routing "with no decrease in quality."
  - Savings are measured against traffic "priced entirely at Opus 4.8 API rates." — [Cursor, "Introducing Cursor Router"](https://cursor.com/blog/router)
- **[Vendor]** Cost per commit from a single commit observation: Intelligence $6.76, Balance $4.63, Opus 4.8 $7.34, Fable 5 $12.69. — [Cursor, "Introducing Cursor Router"](https://cursor.com/blog/router)
- The pool named at launch: Fable 5, Opus 4.8, GPT-5.6 Sol, Grok 4.5, and Cursor's own Composer "for everyday tasks." The launch post says the router was trained on 600k+ requests and is cache-aware. — [Cursor, "Introducing Cursor Router"](https://cursor.com/blog/router)

**How the router works (6 August 2026 post)**
- **Inputs:** structured features such as task category, recent tool calls and broader conversation context. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Stage 1, Compass:**
  - It predicts whether the user will be satisfied and uses that as a complexity proxy, because "users rarely ask for corrections after simple tasks, like making a commit."
  - It outputs a score from 0 to 1. Turns below a threshold stay on the price-efficient model; turns above it go to the task router. Raising the threshold upgrades more turns.
  - **[Vendor]** Online validation: turns Compass rated most likely to succeed got a positive signal 96% of the time, against 71% for the least likely. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Labels:** performance is inferred from the user's next action. Moving on to another task is a strong positive; correcting the agent is a strong negative. Cost comes from API pricing and per-turn token use, "including cache misses caused by switching models." Training data is "hundreds of thousands of turns" of live traffic sampled across multiple models, with privacy mode and retention settings respected. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Stage 2, taxonomy router:**
  - The taxonomy has three axes: Domains (backend, database schemas, frontend), Tasks (fixing bugs, running commands, writing tests) and Modifiers (bounded edits, product questions, visual-heavy changes).
  - Stated model strengths:
    - Grok for routine work such as Git commands and general database operations, because of its low cost.
    - Sol for planning and codebase comprehension.
    - Opus for execution-heavy work (devops, database queries, performance).
    - Fable for debugging and visual implementation. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Uplift bar:** a candidate model is eligible only if its observed performance on a task label clears a "one-sided 75% uplift threshold" against the price-efficient model, which the post describes as roughly 75% confidence that the gain is real. An optimizer then picks the traffic-weighted mix that maximises expected gain while keeping average cost per turn within the mode's budget. Balance has a smaller task-router budget than Intelligence. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Cache-switch cost:** there is no explicit runtime "stickiness" mechanism. Cache-miss costs from switching are folded into the training cost labels and into live cost measurement. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **Evaluation:** offline cross-validation to tune Compass thresholds and budgets, then a held-out test set, then online measurement of satisfaction and real per-turn cost (including caching and switching). — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **[Vendor]** Updated figures as of 6 August 2026, after adding Opus 5 to the mix and improving Compass:
  - Auto Intelligence: "above Fable-level user satisfaction at 68% lower cost" (a further 18% cut since launch).
  - Auto Balance: outperforms Opus 4.8 at 41% lower cost, with satisfaction up 3%.
  - The baselines are not perfectly clear in the text, and the post states future plans for a continuously updated per-model quality/cost predictor as a goal, not a shipped feature. — [Cursor, "How Cursor Router chooses the right model"](https://cursor.com/blog/how-cursor-router-works)
- **[Independent]** One analysis notes that the Intelligence savings claim is made against pinning every request to one expensive model, not against Cost mode. — [Medium, "LLM Router Investigate: Cursor Router"](https://medium.com/@wuhaifengdhu_73579/llm-router-investigate-cursor-router-bc7f9f044a7e)

**Visibility and user complaints**
- Neither router post says whether users can see which model handled a turn. — [Cursor, "Introducing Cursor Router"](https://cursor.com/blog/router); [Cursor, "How Cursor Router chooses…"](https://cursor.com/blog/how-cursor-router-works)
- **[Anecdotal]** A forum feature request asks Cursor to "Show which model handled each step when using Auto mode" and says there is no way to see after the fact which model handled each turn or agent step. — [Cursor Forum](https://forum.cursor.com/t/show-which-model-handled-each-step-when-using-auto-mode/164163)
- **[Anecdotal]** Repeated quality complaints about Auto, for example "Has auto mode become worse quality?", "Auto mode has become almost unusable" and "Auto Mode is terrible."
  - Users report weak memory, poor rule-following and syntax errors.
  - Users guess that Auto falls back to Composer or GPT-4.1 for most work; Cursor has not confirmed either.
  - Per these threads, staff describe Auto as a router that, "for a lot of requests," picks a faster, lighter model (Composer or a Flash-class model). They point users to manual model choice for hard tasks and use request IDs to check which model ran.
  - Sources: [thread 163936](https://forum.cursor.com/t/has-auto-mode-become-worse-quality/163936); [thread 153944](https://forum.cursor.com/t/auto-mode-has-become-almost-unusable/153944); [thread 150271](https://forum.cursor.com/t/auto-mode-is-terrible/150271); [thread 161962](https://forum.cursor.com/t/cursor-2-x-auto-seems-have-degraded-ai/161962). I did not open each thread individually, so which statement sits in which thread is [Unverified].

**Pricing reversal (2025)**
- On 16 June 2025 Cursor made "unlimited" usage apply only to Tab and Auto, plus $20 of frontier-model usage at API prices.
  - Heavy users of manually picked premium models burned through the $20 and were billed overage.
  - On 4 July 2025 the CEO wrote that the changes "were not communicated clearly" and promised refunds of unexpected charges from 16 June to 4 July. — [Cursor, "June 2025 pricing" / "Clarifying our pricing"](https://cursor.com/en/blog/june-2025-pricing); [TechCrunch, 7 Jul 2025](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/); [Simon Willison, 5 Jul 2025](https://simonwillison.net/2025/Jul/5/cursor-clarifying-our-pricing)

**Instant apply / speculative edits (14 May 2024)**
- A frontier model plans the change and a specialised fine-tuned model applies it. The apply model regenerates the full file rather than emitting a diff, because models "struggle with diff formats" and line counting. — [Cursor, "Editing files at 1000 tokens per second"](https://cursor.com/blog/instant-apply)
- The model was Llama-3-70B fine-tuned. Speculative edits use a deterministic draft (the original file) instead of a draft model.
- **[Vendor]** About 1,000 tokens/s (about 3,500 chars/s), "~13x speedup over vanilla inference," and about 9x faster than their earlier GPT-4 speculative-edits deployment. — [Cursor, instant apply](https://cursor.com/blog/instant-apply)
- **[Vendor]** The eval was about 450 full-file edits on files under 400 lines, graded by Claude-3 Opus (the authors note this may favour Claude outputs). The fine-tuned 70B model "almost matches" claude-3-opus-diff and beats gpt-4-turbo and gpt-4o. — [Cursor, instant apply](https://cursor.com/blog/instant-apply)

**Tab model with online RL (12 September 2025)**
- Tab serves more than 400M requests per day.
- It is trained with policy gradient on live accept/reject signals: +0.75 for an accepted suggestion, -0.25 for a rejected one, 0 when nothing is shown. This teaches the model to show a suggestion only when its estimated acceptance chance is above 25%.
- New checkpoints ship several times a day, on a cycle of about 1.5–2 hours.
- **[Vendor]** The new model makes 21% fewer suggestions with a 28% higher accept rate. — [Cursor, "Improving Cursor Tab with online RL"](https://cursor.com/blog/tab-rl)

**Composer**
- Composer 2 is built on Kimi K2.5. It gets continued pretraining on a code-heavy mix, then large-scale RL inside real Cursor sessions using the same tools and harness as the deployed model. Speed is an explicit training goal: the model is rewarded for efficient tool use and parallelism. — [Cursor, Composer 2 technical report](https://cursor.com/blog/composer-2-technical-report); [arXiv 2603.24477](https://arxiv.org/html/2603.24477v1); [Cursor, "Composer"](https://cursor.com/blog/composer)
- **[Vendor]** Launch coverage cites "4x faster than similarly intelligent models." — [DataCamp](https://www.datacamp.com/blog/composer-2) (secondary)

### Inferences
- Cursor's design maps directly onto Makeborne. Haiku 5.5 or Sonnet 5.5 at low effort is the "price-efficient default"; a Compass-like predictor gates escalation; each move to a stronger model or effort level needs a per-task-label uplift bar with a stated confidence (Cursor uses one-sided 75%), not just an average win.
- Using "the user's next action" as the label is cheap and scalable for Makeborne. Positive signals: the client accepts, publishes or moves on. Negative signals: a correction, a "redo," or a manual edit of the same section. Cursor shows the label is noisy but usable at scale; the 96% vs 71% spread is the evidence that it carries signal.
- Folding cache-miss cost into the cost label, rather than writing hand rules, is the cleanest way to price switching. The catch is that it needs per-turn logging of cached versus uncached input tokens.
- The largest user complaint is opacity, not cost. Showing which model and effort ran per step is cheap goodwill that Cursor still has not given.
- The 2025 Cursor pricing reversal shows that if routing is tied to billing, the "free" or "unlimited" path must be explained precisely in advance.

### Gaps
- No independent measurement of Cursor Router savings or quality was found. All numbers are Cursor's.
- The text does not cleanly state the baseline for the 6 August "68% lower cost" figure (Opus 4.8 or Fable).
- No runtime cache-stickiness rule is documented (for example "don't switch mid-turn"). Cursor only says switching cost is priced into the labels.
- No quantified results were published for Cost mode.

## Lovable: "The model picker is a dead end," the control plane, in-house small models, edit vs build pricing, free "Try to fix," eval methodology

### Takeaway
Lovable removed user model choice for building. A "control plane" watches the build, assigns parts of it to different models, and switches only when the expected gain beats the lost context. Recovery changes whatever actually failed: context, plan, tool or model. Small in-house models handle routing, summarisation and commit messages, and post-trained models now carry "a meaningful share" of building. Pricing is per message and scales with complexity (0.50 to 2.00 credits in the examples). "Try to fix" is free up to 10 fixes per rolling 24 hours. The eval method repeats each task five times at three effort levels and reports significance at 95%. Judges are cross-checked against human judgment and dropped when they misbehave.

### Cited Findings
**The control plane ("The model picker is a dead end," 11 August 2026)**
- Thesis: a model dropdown "freezes the decision before the system has enough information about the problem."
  - "Model indifference" means the same prompt and tools with a swapped model name.
  - Real model independence means tuning instructions, tools, how tools are explained, how much project context is shown, and how long builds are summarised, separately for each model. — [Lovable, "The model picker is a dead end"](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- The control plane watches the user's goal, how hard the job has become, and "whether the agent is making progress or circling." It can assign different parts of a build to different models. — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- **Switching rule:** switching mid-build can mean compressing history and rebuilding cached context, and some details may survive only as a summary. A switch must be "worth the cost," and "Recovery should change the thing that failed, whether that is the context, plan, tool, or model." — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- **Recovery options on failure:** retry, change the plan, use another tool, bring in "a model that reasons differently," or ask the user. Provider failover (same model through another provider) fixes availability but "not bad approaches." The agent can report problems through a "vent tool." — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- **In-house models:** Lovable began by training small models for routing requests, summarising responses and writing commit messages. Its post-trained models now handle "a meaningful share" of app-building work. No percentage is given. They pass through the same control plane and must "earn their traffic." — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)

**Eval methodology**
- Candidates are tested inside Lovable's own prompts, tools, context and agent loop.
- Every build runs more than once, because a single good result can be luck.
- Success is judged on the finished app and the whole trajectory: attempts, recovery, build time, cost, and whether the app does what was asked.
- Human judgment, LLM judges and outside rankings are checked against each other, and disagreements are investigated. In one bake-off, a judge that ranked a hollow build near the top was recalibrated, and another that gave near-identical builds opposite scores was dropped. Human judgment is the final check. — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- **[Vendor]** In one eval, a frontier model finished 15% faster than its predecessor with 40% fewer turns and scored 2–3% higher. Another model repeatedly re-read files already in context, which instruction changes addressed. — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)

**Fable 5.1 default (1 September 2026)**
- "We're routing sessions that get stuck, along with longer and more complex work, to Fable 5.1" while A/B tests continue. It is not a hard cutover. — [Lovable, "Fable 5.1 now in Lovable"](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- The eval covers three axes: 0-to-1 building, iterative fixing of existing code, and UI/design quality. Each task ran five times at low, medium and high effort. Scores are a weighted composite of token efficiency, self-verification and request fidelity, with 95% significance marked. — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- **[Vendor]** Score change against Fable 5 at low / medium / high effort:

  | Axis | Low | Medium | High |
  |---|---|---|---|
  | 0-to-1 building | -1.4% | -0.9% | -2.7% (significant) |
  | Iterative fixing | +11.9% | +12.1% | +17.2% (all significant) |
  | UI/design | +1.6% | +2.7%* | +3.5%* |

  — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- **[Vendor]** Cost per task against Fable 5 at low / medium / high effort:

  | Axis | Low | Medium | High |
  |---|---|---|---|
  | 0-to-1 building | +6.3% | +2.9% | +7.1% |
  | Iterative fixing | -36.3% | -39.2% | -31.4% |
  | UI/design | +15.8% | +5.4% | +7.8% |

  — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- Fable 5.1 opens the running app in a browser to verify its work before declaring a task done. — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- A secondary write-up ties the Fable 5.1 change to cache compression on switching. That detail is in the model-picker post, not the Fable 5.1 post. — [AlphaSignal, 1 Sep 2026](https://alphasignal.ai/news/lovable-s-fable-5-1-fixes-live-apps-17-better-at-31-lower-cost)

**Pricing**
- Build-mode credits scale with complexity. Docs examples: "Make the button gray" 0.50, "Remove the footer" 0.90, "Add authentication" 1.20, "Build a landing page with images" 2.00.
- Plan mode costs 1 credit per message plus any subagent research. Chat is "a fraction of a credit."
- Stopped Build requests are "charged based on the work completed so far," and a request stopped before any change "is not charged."
- Long Build runs check in at 20 credits by default; this can be set from 20 to 100,000 credits or turned off.
- `/goal` runs cost "noticeably more." — [Lovable docs, Credits](https://docs.lovable.dev/user-guides/credits)
- **Try to fix:** "Your account includes 10 free fixes, shared across Try to fix and fixes from the Security view." Each one "becomes available again 24 hours after you use it." After that, fixes are billed as standard build usage. — [Lovable docs FAQ](https://docs.lovable.dev/introduction/faq). Several third-party guides still describe Try to fix as free without a cap, which is now outdated. — e.g. [Bilt](https://bilt.me/blog/lovable-pricing)
- **No model choice:** Lovable picks the model for Build, Plan and Chat modes, "so you cannot pick a specific model for building." Model choice exists only for AI features inside the apps users build. Users can see the exact credit cost per message, but the docs do not say they can see the model. — [Lovable docs FAQ](https://docs.lovable.dev/introduction/faq); [Lovable docs, Credits](https://docs.lovable.dev/user-guides/credits)

### Inferences
- Lovable's eval protocol is the one to copy for Makeborne's website, deck and ebook builders:
  - Run each case N times (five) at each effort level.
  - Score the whole trajectory, including cost and attempts, not just the final artefact.
  - Report per-axis results (greenfield vs iterative edit vs design) with significance markers.
  - Audit LLM judges against humans and drop unreliable ones.
- The Fable 5.1 numbers show a model can be better at iterative fixing while worse and more expensive at greenfield building. That argues for routing by task axis (build vs edit vs design), not one global "best model."
- "Route stuck sessions to the stronger model" is a cheap, high-value escalation trigger. It needs a reliable "stuck" or "circling" detector: repeated failed verification, repeated reads, or no diff progress.
- The capped free fix allowance (10 per rolling 24h) is a pricing pattern that protects users from paying for the platform's own errors without creating an abuse loophole.
- Charging stopped runs only for work completed, and nothing before the first change, is a fair default worth matching.

### Gaps
- Lovable gives no percentage of traffic on in-house models, names no in-house model, and gives no eval set sizes.
- No public numbers show how often the control plane switches models mid-build or what that costs.
- It is undocumented whether failed builds that are not stopped are charged in full.
- Lovable does not publish which external models power default Build mode, beyond Fable 5.1 for stuck and complex work.

## v0 (Vercel): composite model family (base model + Quick Edit + AutoFix), streaming fixers, Mini/Pro/Max and Auto

### Takeaway
v0's 2025 "composite model" is the clearest public example of an apply/fix pipeline for an app builder. It has four parts: retrieval-augmented pre-processing, a frontier base model (Anthropic Sonnet) for new generations, a fast "Quick Edit" model for narrow edits, and a custom RFT-trained AutoFix model that checks the stream mid-generation plus a final lint pass. Later v0 brought back user-selectable Mini/Pro/Max tiers (December 2025), plus an Auto option that maps quick edits to Mini and complex builds to Max.

### Cited Findings
**Composite model (1 June 2025)**
- **Pre-processing:** a system prompt, recent messages with older ones summarised, and retrieval from docs, UI examples, project sources and internal Vercel knowledge. — [Vercel, "Introducing the v0 composite model family"](https://vercel.com/blog/v0-composite-model-family)
- **Base model:** v0-1.0-md used Sonnet 3.7 and v0-1.5-md uses Sonnet 4.
- **Quick Edit:** a speed-optimised model "optimal for tasks with narrow scope, like updating text, fixing syntax errors, or reordering components." The post says only that "parts of your request are routed" to it; the scoping rule is not published. — [Vercel](https://vercel.com/blog/v0-composite-model-family)
- **AutoFix:** vercel-autofixer-01 checks the output stream mid-generation for errors, inconsistencies and best-practice violations, runs a final pass after streaming, and a linter runs on the output. It started on Gemini Flash 2.0 and was then trained with Fireworks AI using reinforcement fine-tuning over several iterations. Deterministic rules are combined with AI corrections. — [Vercel](https://vercel.com/blog/v0-composite-model-family)
- **[Vendor]** AutoFix speed: 8,130.01 chars/s, against 559.05 for gemini-2.5-flash-preview-05-20 and 238.9 for gpt-4o-mini ("10 to 40 times faster"). AutoFix error-free output: autofixer-01 86.14, gemini-2.5-flash 89.55, gpt-4o-mini 83.33. The custom model was slightly less accurate than Flash but far faster. — [Vercel](https://vercel.com/blog/v0-composite-model-family)
- **[Vendor]** Error-free generation rate on Vercel's eval:

  | Model | Rate |
  |---|---|
  | v0-1.5-md | 93.87 |
  | v0-1.5-lg | 89.80 |
  | claude-4-opus | 78.43 |
  | claude-4-sonnet | 64.71 |
  | gemini-2.5-flash | 60.78 |
  | gemini-2.5-pro | 58.82 |
  | o3 | 58.82 |
  | gpt-4.1 | 58.82 |

  The composite pipeline added about 29 points over bare Sonnet 4 on this metric. — [Vercel](https://vercel.com/blog/v0-composite-model-family)
- v0-1.0-md on the AI Gateway: 128K context, 32K max output, $3.00 / $15.00 per M input/output tokens, the same as the Sonnet list price. — [Vercel AI Gateway](https://vercel.com/ai-gateway/models/v0-1.0-md)

**Tiers and Auto**
- **Reversal:** on 12 December 2025 v0 "restored" a three-model picker (v0 Mini, fastest and cheapest; v0 Pro, for most tasks; v0 Max, highest intelligence and "best designs"), replacing "a single default experience." No per-tier pricing or base models were disclosed. — [Create With, 12 Dec 2025](https://www.createwith.com/tool/v0/updates/v0-restores-three-model-choice-with-mini-pro-and-max); [v0 on LinkedIn](https://www.linkedin.com/posts/v0dev_you-can-now-select-from-3-different-models-activity-7405055747052441600-RmLM)
- **[Unverified]** A v0 post on X reportedly says: "v0 Auto picks the right model for your prompt, whether that's Mini for quick edits, Pro for most tasks, or Max for complex builds." I saw this only through an aggregator, and its date is unknown. — [traeai aggregator](https://www.traeai.com/articles/38ec5343-2749-41b5-accc-5dbf45fb4cc1)

### Inferences
- For Makeborne, the v0 pattern points to three cheap wins:
  - A Haiku 5.5 "quick edit" lane for narrow copy, style and reorder edits.
  - A deterministic validator plus small-model fixer that runs during or after generation (HTML/CSS lint, broken links, layout checks) before any expensive retry.
  - Measuring "error-free generation rate" as a first-class metric.
- The 29-point gain over bare Sonnet 4 came from pipeline, not model, which is the strongest public evidence that verification and fixers beat buying a bigger model.
- v0 went from a single default back to user-visible tiers, and Lovable and Base44 went the other way. The market has no consensus on hiding the model completely. The common middle ground is Auto as the default with an override.

### Gaps
- No public 2026 v0 architecture update was found: which base models sit behind Mini/Pro/Max, whether AutoFix still exists, or pricing per tier.
- The Quick Edit routing rule (classifier vs heuristic) is undisclosed.
- I found no reporting of user backlash around the tier changes.

## App builders: Replit Agent modes and effort-based pricing; Bolt (Standard/Max, earlier "Haiku for quick edits"); Base44 automatic model

### Takeaway
Every major app builder has moved from per-message flat pricing to complexity-scaled pricing, and from a raw model dropdown to a few named modes or agents, with "Auto" as the recommended default. Replit renamed and retired modes several times in 2026, which confused users. Base44 removed manual model choice in December 2025 but now offers it again on higher plans. Bolt replaced model picks with Standard and Max agents. The recurring user complaint is unpredictable cost, especially agents billing for their own retry loops.

### Cited Findings
**Replit**
- **Current modes:**
  - Free Mode "always uses intelligent model routing." It is available on Starter, Core and Pro; on Core and Pro the allowance "refreshes every five hours."
  - Power Mode is "Optimized for cost."
  - Max Mode is "Optimized for capability."
  - Economy is "no longer available. Power Mode replaces it at the same price." — [Replit Docs, Agent Modes](https://docs.replit.com/features/agent/agent-modes)
- **Auto:** in Power or Max, Core and Pro builders can select Auto, and Replit "chooses a model for each task up to the selected mode's capability." Enterprise gets a single Auto mode that can pick both the mode and an allowed model. Users can also pick a model manually with an Effort setting. — [Replit Docs, Agent Modes](https://docs.replit.com/features/agent/agent-modes)
- **[Unverified]** Mode history:
  - In 2026 the old "Economy" mode was renamed "Power" and the old "Power" became "Max." Lite became Free Mode.
  - An April 2026 changelog said Max had been retired, but Max appears again in later docs. — [Replit changelog 17 Apr 2026](https://docs.replit.com/updates/2026/04/17/changelog); [Replit changelog 28 Aug 2026](https://docs.replit.com/updates/2026/08/28/changelog). This comes from a search summary; I did not open the changelogs.
- **[Unverified]** Effort-based pricing:
  - It replaced the flat $0.25 per checkpoint on 18 June 2025.
  - Simple requests reportedly cost "as little as $0.06," and larger work can run to "multiple dollars."
  - Replit reportedly acknowledged that effort-based pricing "can end up being more expensive over the lifetime of a project," and gave $10 in credits after a rough launch.
  - These come from third-party pages. — [banani.co](https://www.banani.co/blog/replit-pricing); [flexprice.io](https://flexprice.io/pricing-index/replit); [pricinginnovation substack](https://pricinginnovation.substack.com/p/replits-pricing-journey-hiring-software)
- **Turbo:** sources conflict, from about 2x the cost of Power to up to 6x. It is paid-only and off by default. [Unverified] — [aiagentsquare](https://aiagentsquare.com/agents/replit); [emergent.sh](https://emergent.sh/learn/replit-pricing)
- **[Anecdotal / Unverified]** A user reportedly lost a third of a monthly $100 Pro budget in one overnight session while Agent 3 kept retrying a failed fix. Critics note that rework caused by the agent is still billed as effort. — [aiagentsquare review](https://aiagentsquare.com/blog/replit-review-2026)

**Bolt**
- Bolt now offers "two agents, Standard and Max, instead of individual model options." Standard is "more token-efficient," and Max "uses more tokens for deeper reasoning." Max needs a paid plan. — [Bolt Release Notes](https://support.bolt.new/release-notes); [Softr guide](https://www.softr.io/blog/bolt-ai-pricing)
- Earlier release notes made Sonnet 4.6 the default, called Opus 4.7 the most capable, and said: "You can continue to use Haiku 4.5 for quick edits and Opus 4.6 for the most complex reasoning tasks." — [Bolt Release Notes](https://support.bolt.new/release-notes)

**Base44**
- **11 December 2025:**
  - The agent "analyzes task complexity and routes each prompt": deep-reasoning models for architectural changes, faster ones for small UI tweaks.
  - Pricing moved from one credit per message to complexity-scaled credits: about 0.5 for a simple UI tweak, about 1.5 for full app logic. Discuss Mode costs 0.3 per message, and "Resolve with AI" is free.
  - Manual model choice was removed.
  - **[Vendor]** Quality claims with no benchmarks: "higher-fidelity code," "reduces hallucinations." — [Base44 blog](https://base44.com/blog/update-smarter-building-with-automatic-optimization)
- **[Unverified] Partial reversal:**
  - Current docs again show a model picker in the AI chat, and choosing a model "needs a Builder plan or above." Automatic is described as the cheapest default; manual choice is described as "less predictable" and can use more credits, and premium models (Opus 5.5, GPT-6.1 Sol) cost "many times more."
  - An October 2026 changelog lets Enterprise admins disable models and set defaults.
  - Discuss mode uses its own model whatever the app's selection.
  - This comes from a search summary of [Base44 Credits docs](https://docs.base44.com/Account-and-billing/Credits), [AI chat modes](https://docs.base44.com/Building-your-app/AI-chat-modes) and [changelog](https://docs.base44.com/changelog/product).

### Inferences
- The convergent pattern for app builders:
  - Hide raw models behind Auto plus one or two named tiers.
  - Price per message by work done.
  - Show the exact credit cost after each message.
  - Make error-recovery actions free or capped-free: Base44's "Resolve with AI" is free, Lovable's Try to fix is free 10 times a day.
- Makeborne can beat this on predictability by quoting a price range before the run and refunding or not charging verified platform-caused failures. The Replit overnight-retry story is the failure mode to design against. Hard per-run budgets and Lovable-style check-ins are the guardrail.
- Renaming modes (Replit) creates confusion. Pick stable user-facing tier names that do not encode model names.

### Gaps
- I could not access Replit's primary effort-based pricing post or current Turbo multiplier.
- No dates for Bolt's switch to Standard/Max agents, or which models currently sit behind each.
- No routing internals (signals, classifiers) are published for Replit, Bolt or Base44.
- None of the three documents whether users can see the model per message.

## IDE and agent routers with price levers: GitHub Copilot Auto, Windsurf/Devin "Adaptive," Amazon Kiro Auto

### Takeaway
The IDE vendors make routing pay off for the user directly. Copilot gives a 10% discount (30% for Copilot Max until 28 October 2026) and shows the model per response. Devin's Adaptive charges one flat blended per-token rate whatever model runs. Kiro prices Auto at 1.0x against Sonnet at 1.3x. Copilot is the only one that documents a cache rule: it routes "along natural cache boundaries and large drifts in conversation complexity."

### Cited Findings
**GitHub Copilot**
- **Timeline:**
  - Auto in Copilot CLI on 17 April 2026, with a 10% multiplier discount for all paid users. — [GitHub Changelog 17 Apr 2026](https://github.blog/changelog/2026-04-17-github-copilot-cli-now-supports-copilot-auto-model-selection/)
  - Cloud agent support on 14 May 2026. — [GitHub Changelog 14 May 2026](https://github.blog/changelog/2026-05-14-copilot-cloud-agent-supports-auto-model-selection/)
  - CLI auto "routes based on task" from 1 July 2026. — [GitHub Changelog 1 Jul 2026](https://github.blog/changelog/2026-07-01-copilot-cli-auto-model-selection-routes-based-on-task/) (title only; not opened)
- **How it works:**
  - Two systems combine: one "tracks real-time system health and availability," and one "evaluates task complexity."
  - "Routing occurs along natural cache boundaries and large drifts in conversation complexity," to "avoid additional cache related costs without quality improvements."
  - It excludes models outside the plan, admin-blocked models, and models excluded by data residency or FedRAMP rules. — [GitHub Docs, auto model selection](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)
- **Visibility:** "You can see which model was used for each Copilot response": by hover in Chat and the app, in terminal output in the CLI, and at the end of the response in cloud agent. — [GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)
- **Tiers (14 September 2026):**
  - Efficiency "prioritizes keeping costs low."
  - Balance "weighs cost, quality, and latency."
  - Intelligence "prioritizes quality."
  - All tiers use the same model set, and a simple docstring task may still go to a small model on Intelligence.
  - "Usage is charged based on the model auto selects, regardless of tier." GitHub calls this "the first step" toward user-customisable selection. — [GitHub Changelog 14 Sep 2026](https://github.blog/changelog/2026-09-14-configure-cost-and-quality-in-copilot-auto-model-selection/)
- **Discounts:** 10% off model costs on auto for paid plans; Copilot Max gets 30% "through October 28, 2026." — [GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)

**Windsurf / Devin Desktop "Adaptive"**
- **Launch:** Adaptive went live on 6 April 2026 for all self-serve users, as a router that "automatically picks the best model for every task while avoiding overuse of premium models." — [Windsurf on X, Apr 2026](https://x.com/windsurf/status/2041290315999408330). Windsurf was rebranded Devin Desktop around June 2026. — [Devin Docs changelog](https://docs.devin.ai/desktop/changelog)
- **Pricing:** one fixed rate whatever the model: input $0.50 per M tokens, output $2.00 per M, cache read $0.10 per M. Enterprise usage is metered in ACUs that scale with tokens and the selected model. — [Devin Docs, Adaptive](https://docs.devin.ai/desktop/adaptive)
- **Signals:** Adaptive "analyzes your prompt" and "takes prompt caching into account," and staying on one model enables caching.
  - **[Vendor]** The only claim is that it "typically consumes fewer tokens overall," with no data.
  - The same page recommends "Fusion" for most users: a frontier lead model paired with a cost-efficient sidekick.
  - Enterprise admins must enable Adaptive, which is off by default. — [Devin Docs, Adaptive](https://docs.devin.ai/desktop/adaptive)
- **[Independent / Anecdotal]** A June 2026 test found Adaptive picked different models for the same prompt across three trials. The author guesses context size correlates with the choice. — [zenn.dev](https://zenn.dev/hsl/articles/6dcf337e2b73c6?locale=en)

**Amazon Kiro**
- **15 September 2025:** Auto "uses a mix of different frontier models such as Sonnet 4" plus specialised models, with "intent detection and caching." A task costing X credits on Auto "will cost you 1.3X credits to execute via Sonnet 4."
  - **[Vendor]** "Sonnet 4-level quality" at lower cost.
  - Users can still pick Sonnet manually.
  - Plans: Free 50 credits, Pro $20 / 1,000, Pro+ $40 / 2,000, Power $200 / 10,000, overage $0.04 per credit. — [Kiro blog](https://kiro.dev/blog/new-pricing-plans-and-auto/)
- **[Vendor / Unverified]** A later Auto version cut credit use by 21% on typical requests and 36% on the most demanding ones (the date is unclear). — [Kiro, "Making your Kiro credits go further"](https://kiro.dev/blog/making-credits-go-further/)

### Inferences
- A flat blended price (Devin) or a fixed discount (Copilot, Kiro) turns the router's savings into a visible user benefit and makes the user indifferent to which model ran. For Makeborne, a single "Makeborne Auto" price per task class could undercut competitors as long as the router's blended cost stays below it.
- Copilot's "route only at cache boundaries or on large complexity drift" is the simplest documented anti-thrash rule. Makeborne could lock the model within a build step or tool loop and re-route only at step boundaries or on a detected escalation trigger.
- Copilot shows the model per response, and that has not stopped auto adoption. Visibility does not seem to hurt.
- Independent observation of non-deterministic routing (Devin) is a trust risk. Same-input/same-route determinism, or at least a logged reason, is worth providing.

### Gaps
- No vendor published quality or cost results for Copilot Auto or Devin Adaptive.
- The complexity classifiers' features and training labels are undisclosed for Copilot, Devin and Kiro.
- Whether Devin Desktop shows the model per turn is undocumented.

## Claude Code (opusplan, Haiku subagents, effort defaults, fallbacks, the April 2026 postmortem) and OpenAI Codex

### Takeaway
Claude Code routes by phase, not by classifier. `opusplan` uses Opus in plan mode and Sonnet for execution. Fallback chains handle availability, and there are content-based re-runs on other models. The 5.5 generation defaults to `medium` effort. The April 2026 postmortem is the key cautionary tale. Silently lowering default effort from high to medium (4 March 2026), a cache/thinking-clearing bug, and a brevity system prompt (-3% on ablation) together caused six weeks of "it got dumber" reports that internal evals did not catch. All three were reverted and usage limits were reset. Codex has no documented automatic model or effort router; users are asking for one.

### Cited Findings
**Aliases and phase routing**
- Aliases on the Anthropic API resolve to Opus 5.5, Sonnet 5.5 and Haiku 5.5. `haiku` is "for simple tasks."
- "`opusplan`: Special mode that uses `opus` during plan mode, then switches to `sonnet` for execution … This pairs Opus's reasoning for planning with Sonnet's efficiency for execution."
- The default model is Opus 5.5 for Pro, Max, Team, Enterprise and the API. — [Claude Code docs, Model configuration](https://code.claude.com/docs/en/model-config)

**Effort defaults**
- "`high` on every model that supports effort, except that Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`, Opus 4.7 defaults to `xhigh`."
- The 5.5 models support low, medium, high, xhigh and max.
- Precedence: explicit flag or env var, then settings, then the model default. — [Claude Code docs](https://code.claude.com/docs/en/model-config)

**Fallbacks**
- `--fallback-model sonnet,haiku`: up to three models, used when the primary is "overloaded, unavailable, or returns another non-retryable server error." "The switch lasts for the current turn only." Subagents use the same chain. — [Claude Code docs](https://code.claude.com/docs/en/model-config)
- Content-based fallback: a request flagged by a safety classifier re-runs on an older model. For Opus 5.5, biology flags go to Opus 5 and cybersecurity flags to Opus 4.8. This is configurable with `switchModelsOnFlag: false`. — [Claude Code docs](https://code.claude.com/docs/en/model-config)

**April 2026 postmortem (23 April 2026)**
- **Effort default (4 March to 7 April):** default effort was changed from `high` to `medium` "to reduce long latency that made the UI appear frozen."
  - Internal evals showed "slightly lower intelligence with significantly less latency." Anthropic calls it "the wrong tradeoff."
  - Users felt Claude Code was less intelligent, and most kept the default even after UI changes surfaced the setting.
  - Reverted 7 April. — [Anthropic Engineering, "An update on recent Claude Code quality reports"](https://www.anthropic.com/engineering/april-23-postmortem)
- **Thinking/cache bug (26 March to 10 April):** a change meant to clear old thinking once for sessions idle for more than an hour instead cleared it every turn. Claude seemed "forgetful and repetitive," and cache misses likely drained usage limits faster. — [Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- **Verbosity prompt (16 to 20 April):** "keep text between tool calls to ≤25 words," with final answers capped at about 100 words. An ablation showed "a 3% drop for both Opus 4.6 and 4.7." Reverted. — [Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- **Detection:** the issues passed code review, unit and end-to-end tests and dogfooding, and were masked by unrelated experiments. Root cause took over a week. — [Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- **Lessons and remedy:**
  - Staff will use the exact public build.
  - Every system-prompt change gets per-model evals and line-by-line ablations.
  - Model-specific prompt changes are gated to the target model.
  - Changes that could trade off intelligence get soak periods and gradual rollouts.
  - Usage limits were reset for all subscribers. — [Anthropic postmortem](https://www.anthropic.com/engineering/april-23-postmortem)
- Secondary coverage notes that Reddit users also blamed sub-agent delegation to Haiku, which the postmortem does not address. — [InfoQ, May 2026](https://www.infoq.com/news/2026/05/anthropic-claude-code-postmortem/)

**OpenAI Codex**
- No official automatic model or effort router was found.
- GitHub issue #8649 (January 2026) asks for "Auto" reasoning effort by task type; #47576 proposes a "Dynamic Mode" choosing model and effort per phase. Both are requests, not shipped. — [openai/codex #8649](https://github.com/openai/codex/issues/8649); [openai/codex #47576](https://github.com/openai/codex/issues/47576)
- A July 2026 community request asks for per-subagent model and effort controls with a parent-set ceiling. — [OpenAI Community](https://community.openai.com/t/feature-request-per-worker-model-and-reasoning-effort-controls-for-codex-subagents/1386418)
- **[Unverified]** A third-party guide says Codex config has separate `model_reasoning_effort` and `plan_mode_reasoning_effort`, with medium as the default. — [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/03/27/reasoning-effort-tuning/)

### Inferences
- Anthropic's own harness now defaults the 5.5 family (Makeborne's exact pool) to `medium` effort, after the March 2026 reversal that applied to the 4.6 models. Medium is Anthropic's current recommended starting point for 5.5, so Makeborne's default-medium-escalate-to-high design is consistent with the vendor. That is my reading of the two documents together; Anthropic does not state it.
- The postmortem's main lesson for an orchestrator: any change that lowers effort, trims context or caches thinking is an intelligence trade-off. It needs per-model ablation evals, gradual rollout and a live quality metric (Cursor-style next-action labels) that would catch a regression within days, not six weeks. Users rarely change defaults ("most kept the medium default"), so the default is the product.
- Phase-based routing (opusplan: strong model plans, cheaper model executes) is the simplest deterministic baseline for Makeborne. For example, Opus 5.5 plans the site or deck outline and Sonnet 5.5 or Haiku 5.5 renders sections. A learned router should be required to beat it.
- Turn-scoped fallback (switch for the current turn only) is a good availability pattern that does not pollute the cache for the rest of the session.

### Gaps
- The Claude Code docs page was too long to read fully. I did not confirm from the primary docs which built-in subagents (for example Explore) default to Haiku, or any small/fast background-model setting.
- No public data was found on opusplan's quality or cost against all-Opus.
- No OpenAI documentation of Codex routing was found.

## Specialised "apply" and two-model edit patterns: Aider architect/editor, Morph Fast Apply, Relace Instant Apply and rerankers

### Takeaway
Splitting "reasoning about the change" from "writing the edit" is measurably better in the one independent-style benchmark available (Aider's own). Architect/editor pairs beat solo runs by 3 to 10 points. A dedicated apply model then makes edits fast and cheap: Morph and Relace claim 4k to 10k+ tokens/s at well under frontier prices. All apply-model accuracy numbers are vendor-reported.

### Cited Findings
**Aider architect/editor (26 September 2024)**
- The Architect describes the solution; the Editor turns it into concrete file edits. — [Aider, "Separating code reasoning and editing"](https://aider.chat/2024/09/26/architect.html)
- Pass rates on Aider's code-editing benchmark:

  | Architect + Editor | Edit format | Pairing | Solo baseline |
  |---|---|---|---|
  | o1-preview + o1-mini | whole | 85.0% | 79.7% |
  | o1-preview + DeepSeek | whole | 85.0% | 79.7% |
  | o1-preview + claude-3.5-sonnet | diff | 82.7% | 79.7% |
  | Sonnet + Sonnet | diff | 80.5% | 77.4% |
  | gpt-4o + gpt-4o | diff | 75.2% | 71.4% |
  | o1-mini + DeepSeek | whole | 71.4% | 61.1% |
  | gpt-4o-mini + gpt-4o-mini | whole | 60.2% | 55.6% |

  — [Aider](https://aider.chat/2024/09/26/architect.html)
- Aider notes that the 85% "whole file" runs are slow and "probably not practical for interactive use"; diff format is the efficient choice. A cheap editor (DeepSeek) helped every architect except Sonnet. — [Aider](https://aider.chat/2024/09/26/architect.html)

**Morph**
- **[Vendor]** Launch HN (2025): "Apply AI code edits at 4,500 tokens/sec." — [Launch HN mirror](https://hn.svelte.dev/item/44490863)
- **[Vendor]** OpenRouter listings: morph-v3-fast at about 10,500 tok/s with "96% accuracy," and morph-v3-large at about 4,500 tok/s with "98% accuracy." The accuracy test method is not published. — [OpenRouter, morph-v3-fast](https://openrouter.ai/ko-KR/morph/morph-v3-fast)
- **[Vendor]** AWS case study: 10,000 tok/s per request, and about 400 ms for a 15,000-token multi-file refactor. — [AWS case study](https://aws.amazon.com/solutions/case-studies/morph-case-study/)
- **[Vendor / Unverified]** About 35% faster end-to-end task completion than search-and-replace, with apply latency of 1–3 s. I saw this only in a search summary; the page fetch was rate-limited. — [Morph blog](https://www.morphllm.com/blog/morph-breaks-10k-barrier.md)

**Relace**
- **[Vendor]** Instant Apply merges code snippets at about 4,300 tok/s with about 900 ms average end-to-end latency. Its embedding plus reranker pair scores relevance against million-line codebases in about 1–2 s. — [YC Launch, Relace](https://www.ycombinator.com/launches/NV5-relace-cheaper-faster-and-more-reliable-ai-code-generation)
- Relace Apply 3 is listed as released 26 September 2025, with a 256K context window and $0.85 / $1.25 per M input/output tokens on OpenRouter-based listings. One listing shows $1.17 / $1.72 instead. — [ModelGrep](https://modelgrep.com/models/relace/relace-apply-3); [OpenCode data](https://opencode.ai/data/relace/relace-apply-3.md)
- **[Independent]** ModelGrep measured Relace Apply 3 at about 2.8k output tok/s, below the vendor's throughput claims. — [ModelGrep](https://www.modelgrep.com/best/fastest/relace)
- I found no published merge-accuracy number for Apply 3.

**Cursor's precedent:** see the instant apply findings in the Cursor section: full-file rewrite with speculative decoding at about 1,000 tok/s, and a fine-tuned 70B that "almost matches" Opus-diff. — [Cursor](https://cursor.com/blog/instant-apply)

### Inferences
- Makeborne is Anthropic-only, so it cannot use Morph or Relace without adding a vendor. The Anthropic-native version of the pattern is to have Opus 5.5 or Sonnet 5.5 output a compact edit plan and have Haiku 5.5 apply it to the section or file.
  - Aider's Sonnet+Sonnet gain (+3.1 points) and gpt-4o-mini pair (+4.6 points) suggest even same-model splits help.
  - This should be measured on Makeborne's own edit cases.
- For page, slide or ebook-chapter documents, section-scoped full rewrite (the Cursor approach) may be more reliable than diffs, given models' known weakness with line-numbered diffs. Prompt caching of the unchanged document keeps it cheap.
- Use Haiku 5.5 to rank candidate sections or files before an expensive model is called. That reproduces the Relace reranker idea at low cost.

### Gaps
- No independent accuracy benchmarks exist for Morph or Relace apply models.
- No public Aider architect/editor results for 2026 models were found in this pass.

## Others: Gamma, Framer AI, JetBrains Junie, Google Jules / Firebase Studio

### Takeaway
Public detail is thin. Gamma is the most relevant deck competitor. It runs more than 20 models from Anthropic, OpenAI and Google plus image generators, and picks models with evals and user experiments that use edit, share and paid-conversion signals. Jules reports a 9.5% cut in task failures from a "Planning Critic" agent. I found nothing substantive on Framer AI routing, Junie routing or Firebase Studio model selection.

### Cited Findings
- **Gamma (6 October 2026):** combines "more than 20 AI models, including those from Anthropic … OpenAI … and Google … along with several image generators."
  - It selects models "through internal evaluations and user experiments," tracking "whether people edit and share their creations or become paying customers."
  - It reports about 110M free sign-ups. — [SiliconANGLE, 6 Oct 2026](https://siliconangle.com/2026/10/06/exclusive-gamma-revamps-presentation-platform-to-make-output-look-more-human/)
- **[Unverified date]** Gamma: "Claude powers well over half of Gamma's AI features," with OpenAI and Google models alongside, "letting Gamma route each task to the model that performs best." — [AI Magazine](https://aimagazine.com/news/gamma-ai-presentations-for-100m-users-us-100m-arr-and-prof)
- **[Vendor]** Jules (26 January 2026): a "Planning Critic" reviews every plan that does not need human approval before code runs. It adds a little planning time but "yields a 9.5% reduction in task failure rates." Jules uses Gemini, with Gemini 3 for Pro and Ultra users. I found no user-facing model picker. — [Jules changelog](https://jules.google/docs/changelog/2026-01-26-1); [Google Developers Blog](https://developers.googleblog.com/jules-gemini-3/)
- **[Unverified]** Junie: third-party pages describe manual model choice across Claude, Gemini, GPT and Grok, with no automatic routing documented. JetBrains AI Assistant, not Junie, is said to "suggest the optimal" model per task. — [tech-insider](https://tech-insider.org/jetbrains-junie-vs-github-copilot-vs-cursor-2026/); [aicoolies](https://aicoolies.com/reviews/junie-review)

### Inferences
- Gamma's selection signal (did users edit, share or pay) is Cursor's next-action label adapted to decks. It is directly usable for Makeborne's decks and ebooks: positive is export, publish or share without heavy edits; negative is regenerate or heavy manual editing.
- A plan critic (Jules) is a cheap pre-execution check. For Makeborne, a Haiku 5.5 or Sonnet 5.5 critic on the build plan before an expensive Opus 5.5 render could cut wasted full runs.

### Gaps
- Framer AI: I found no public information on model routing or composition. Not searched exhaustively.
- Firebase Studio: no results on model selection.
- JetBrains Junie: no primary JetBrains source on routing or credits found.
- Gamma: no detail on per-task routing (which model does outline vs text vs layout), effort use or pricing exposure.

## Cross-cutting: signals, verification, model visibility, charging for failed attempts, backlash, and lessons for Makeborne v4

### Takeaway
Leaders route on a few signals:
- predicted difficulty or satisfaction
- task type
- conversation or build state (stuck, circling, phase)
- cache boundaries
- system health

They learn from users' next actions rather than hand labels. They verify with deterministic checks, small fixer models, critics or browser self-checks before anything goes back to a costly model. Pricing has converged on complexity-scaled per-message credits, with Auto cheaper than manual premium choice. The biggest backlashes came from opacity, silent default downgrades and surprise bills, not from routing as such.

### Cited Findings
**Signals**
- **Predicted satisfaction as complexity, plus task taxonomy, recent tool calls and conversation context:** Cursor. — [Cursor](https://cursor.com/blog/how-cursor-router-works)
- **Goal, difficulty, progress vs circling:** Lovable. — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)
- **Stuck sessions and longer or complex work:** Lovable's routing to Fable 5.1. — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- **System health plus task complexity, re-routed only at cache boundaries or on large complexity drift:** Copilot. — [GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)
- **Prompt analysis plus caching:** Devin Adaptive. — [Devin Docs](https://docs.devin.ai/desktop/adaptive)
- **Intent detection plus caching:** Kiro. — [Kiro](https://kiro.dev/blog/new-pricing-plans-and-auto/)
- **Phase (plan vs execute):** Claude Code `opusplan`. — [Claude Code docs](https://code.claude.com/docs/en/model-config)
- **Edit/share/pay outcomes for model selection:** Gamma. — [SiliconANGLE](https://siliconangle.com/2026/10/06/exclusive-gamma-revamps-presentation-platform-to-make-output-look-more-human/)

**Labels and evaluation**
- **Live next-action labels:** Cursor. — [Cursor](https://cursor.com/blog/how-cursor-router-works)
- **Accept/reject reward with an explicit show threshold:** Cursor Tab. — [Cursor Tab RL](https://cursor.com/blog/tab-rl)
- **Repeated runs (five times) at three effort levels with 95% significance, and judge cross-validation against humans:** Lovable. — [Lovable, Fable 5.1](https://lovable.dev/blog/fable-5-1-now-in-lovable); [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)

**Verification**
- **Streaming AutoFix model, final pass and linter:** v0, which reports +29 points error-free over bare Sonnet 4. — [Vercel](https://vercel.com/blog/v0-composite-model-family)
- **Browser self-check before "done":** Lovable Fable 5.1. — [Lovable](https://lovable.dev/blog/fable-5-1-now-in-lovable)
- **Planning critic:** Jules, which reports -9.5% task failures. — [Jules](https://jules.google/docs/changelog/2026-01-26-1)
- **Recovery that changes the failing component (context, plan, tool or model):** Lovable. — [Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)

**Showing which model ran**

| Product | Shows the model? | Source |
|---|---|---|
| Copilot | Yes, per response | [GitHub Docs](https://docs.github.com/en/copilot/concepts/models/auto-model-selection) |
| Kiro | Model is selectable; per-response display not confirmed | [Kiro](https://kiro.dev/blog/new-pricing-plans-and-auto/) |
| Cursor | No, a user complaint | [Cursor Forum](https://forum.cursor.com/t/show-which-model-handled-each-step-when-using-auto-mode/164163) |
| Lovable | No; credits are shown, not the model | [Lovable FAQ](https://docs.lovable.dev/introduction/faq) |
| Base44 | Credits shown; model display not stated | [Base44](https://base44.com/blog/update-smarter-building-with-automatic-optimization) |

**Charging for failed attempts**
- **Lovable:** 10 free fixes per rolling 24 h, then billed; stopped runs are charged only for work done. — [Lovable FAQ](https://docs.lovable.dev/introduction/faq); [Lovable Credits](https://docs.lovable.dev/user-guides/credits)
- **Base44:** "Resolve with AI" is free. — [Base44](https://base44.com/blog/update-smarter-building-with-automatic-optimization)
- **Replit:** criticised for billing agent rework as effort. [Anecdotal] — [aiagentsquare](https://aiagentsquare.com/blog/replit-review-2026)

**Backlash and reversals**
- **Cursor, June 2025 pricing:** apology and refunds. — [TechCrunch](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/)
- **Anthropic, March 2026 effort-default cut:** reverted, usage limits reset. — [Anthropic](https://www.anthropic.com/engineering/april-23-postmortem)
- **v0:** single default reverted to a three-tier picker (December 2025). — [Create With](https://www.createwith.com/tool/v0/updates/v0-restores-three-model-choice-with-mini-pro-and-max)
- **Base44:** manual choice removed (December 2025), then apparently brought back for Builder plans and above. [Unverified] — [Base44 docs](https://docs.base44.com/Account-and-billing/Credits)
- **Replit:** repeated mode renames and retirements in 2026. [Unverified] — [Replit Docs](https://docs.replit.com/features/agent/agent-modes)
- **Cursor Auto:** quality complaints. [Anecdotal] — [Cursor Forum](https://forum.cursor.com/t/has-auto-mode-become-worse-quality/163936)

### Inferences
These are recommendations for Makeborne v4, synthesised from the findings above. They are my reasoning, not vendor statements.

1. **Two-stage router.**
   - Stage 1: a cheap complexity or satisfaction predictor decides whether a step can stay on Haiku 5.5 or Sonnet 5.5 at low or medium effort.
   - Stage 2: escalate to Sonnet 5.5 high or Opus 5.5 only for task labels where the uplift is demonstrated with stated confidence (Cursor's one-sided 75%), within a per-tier cost budget.
   - Keep a deterministic phase baseline (Opus plans, cheaper models execute, opusplan-style) that the learned router must beat.
2. **Labels.** Use the client's next action: accept, publish or move on versus correct, regenerate or manual edit, as Cursor and Gamma do. Include cache-miss cost in the per-turn cost label.
3. **Switching discipline.** Route only at step or cache boundaries (Copilot), keep fallbacks turn-scoped (Claude Code), and switch mid-build only when expected gain beats lost context (Lovable). Use "stuck or circling" as an explicit escalation trigger (Lovable).
4. **Verify before escalating.** Run deterministic validators plus a Haiku fixer on generated HTML, slides or ebook output during and after generation (v0 AutoFix), a plan critic before costly renders (Jules), and a rendered-preview self-check before "done" (Lovable). v0's +29-point error-free gain from pipeline over bare model is the strongest evidence here.
5. **Evals.** Run five repeats per case at each effort level, per axis (greenfield build vs iterative edit vs design), with significance reporting and judges audited against humans (Lovable). The Fable 5.1 result (better at fixing, worse at greenfield) is a warning against a single "best model" rule.
6. **Pricing and trust.**
   - Quote complexity-scaled prices and show the actual credit cost per message (Lovable, Base44).
   - Make platform-caused fixes free with a cap (Lovable's 10 per 24 h).
   - Cap per-run spend with check-ins to prevent Replit-style overnight retry burns.
   - Consider a flat "Auto" price or discount so the router's savings visibly reach users (Devin, Copilot, Kiro).
   - Show which model and effort ran per step (Copilot); its absence is Cursor's most-cited Auto complaint.
7. **Change management.** Treat any default-effort, context or prompt change as an intelligence trade-off. Gate it per model, ablate it, roll it out gradually and watch live satisfaction (the Anthropic postmortem). Do not rename user-facing tiers often (Replit).

### Gaps
- None of the products publish their router's per-step latency overhead, how often it escalates, or how much the classifier itself costs to run.
- No independent, cross-vendor benchmark of "router vs best single model" was found. Every savings figure is vendor-reported against vendor-chosen baselines.
- Whether any competitor refunds credits automatically when its own verification detects a platform-caused failure (as opposed to a free retry button) is undocumented.
