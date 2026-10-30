# Academic literature on LLM routing, cascades and model/effort selection (2023 to Oct 2026), applied to Makeborne's v4 orchestrator

Scope note: compiled 23 Oct 2026. Primary sources were fetched this session (arXiv abstract pages, arXiv API, arXiv HTML, PDF text, the LMSYS and Google Research blogs) unless a line says "(not re-verified this session)". Venue tags taken from the arXiv comment field are marked "per arXiv comment". Venues from prior knowledge are marked "(venue unverified)". Many 2026 papers are single preprints that have not been peer reviewed. Their numbers are what the authors report.

Makeborne price context used in the inferences: Haiku 5.5 is $0.10/$0.50, Sonnet 5.5 is $2/$10 and Opus 5.5 is $4/$20 per 1M tokens. That makes the per-token price ratio Haiku:Sonnet:Opus = 1:20:40, and Opus costs only 2x Sonnet.

## Q1. What each named method does, what it saves at what quality, on which tasks, and how it fails

### Takeaway
The classic routers and cascades (2023–2025) report large savings, mostly 35–98%, but almost all of it on single-turn QA, chat or math, against GPT-4-era pairs. The 2026 re-evaluations (LLMRouterBench, Routing Plateau, Routing Collapse, "Misguided", "Task Type") find the same thing from several directions. Learned routers bunch together. Most gain comes from coarse task or dataset structure. Many routers do not beat the best single model, or a random split between two well-chosen models at matched cost. The remaining gap to the oracle sits on hard queries that prompt-only routers cannot see.

### Cited Findings

**Foundational cascades and routers (2023–2024)**
- **FrugalGPT** (Chen, Zaharia, Zou; arXiv 2305.05176, 2023; TMLR 2024, venue unverified) is a learned cascade: it queries models in sequence and a scorer decides whether to stop. It reports matching GPT-4 with "up to 98% cost reduction", or +4% accuracy over GPT-4 at equal cost. It notes that API prices differ by about two orders of magnitude. — [arXiv 2305.05176](https://arxiv.org/abs/2305.05176)
- **AutoMix** (Aggarwal, Madaan et al.; arXiv 2310.12963; NeurIPS 2024 per arXiv comment) uses few-shot self-verification by the small model, plus a POMDP meta-verifier that decides whether to escalate. This is meant to handle a noisy self-verifier. It reports "over 50%" compute reduction for comparable performance, across 5 LMs and 5 datasets. — [arXiv 2310.12963](https://arxiv.org/abs/2310.12963)
- **Hybrid LLM** (Ding et al.; arXiv 2404.14618; ICLR 2024 per arXiv comment) uses a difficulty-predicting binary router (small vs large) with a quality threshold that can be tuned at test time. It reports "up to 40% fewer calls to the large model with no drop in response quality". — [arXiv 2404.14618](https://arxiv.org/abs/2404.14618)
- **RouteLLM** (Ong et al., LMSYS; arXiv 2406.18665, 2024; ICLR 2025, venue unverified) trains binary strong/weak routers on Chatbot Arena preference data: similarity-weighted ranking, matrix factorization (MF), a BERT classifier and a causal-LLM classifier. The abstract claims cost reductions "of over 2 times". The blog claims >85% cost reduction on MT-Bench, 45% on MMLU and 35% on GSM8K vs GPT-4-only while keeping 95% of GPT-4 performance, with GPT-4 Turbo as strong model and Mixtral 8x7B as weak. The blog's details:
  - MT-Bench: MF trained on Arena data alone needed 26% GPT-4 calls, about 48% cheaper than random. With LLM-judge-augmented data it needed 14% GPT-4 calls, 75% cheaper than random. The blog's 75% and the abstract's 85% are not reconciled.
  - MMLU: Arena-only routers performed near random, because MMLU is out of distribution. About 1,500 golden labels (<2% of training data) brought it to 54% GPT-4 calls, only 14% cheaper than random.
  - It was >40% cheaper than Martian and Unify at matched MT-Bench performance.
  — [LMSYS blog](https://lmsys.org/blog/2024-07-01-routellm/); [arXiv 2406.18665](https://arxiv.org/abs/2406.18665)
- **RouterBench** (Hu et al., Martian; arXiv 2403.12031, 2024) has 405,467 inference outcomes over 11 models, 8 datasets and 64 tasks; the limitations section says "seven datasets", an internal inconsistency. The oracle is far above the best model: MMLU 0.957 vs GPT-4 0.828. KNN and MLP predictive routers reach "the level of performance to the best individual LLMs with lower or similar costs". However, "none of the routing algorithms significantly outperform the baseline Zero router" (the convex-hull interpolation baseline); they are mixed by dataset and underperform on ARC-Challenge and MBPP. On RAG, all routers do beat the Zero router. — [arXiv 2403.12031 (HTML)](https://arxiv.org/html/2403.12031)
- **Consistency-based cascade, "Mixture of Thoughts"** (Yue et al.; arXiv 2310.03094; ICLR 2024 per arXiv comment) escalates when the weak LLM's sampled Chain-of-Thought and Program-of-Thought answers disagree. It reports performance comparable to the strong LLM alone at "only 40% of its cost" on six reasoning benchmarks. It needs several weak-model samples and short, comparable answers. — [arXiv 2310.03094](https://arxiv.org/abs/2310.03094)
- **Token-level uncertainty cascades** (Gupta et al., Google; arXiv 2404.10136, 2024) find that sequence-level uncertainty suffers from length bias. Learned post-hoc deferral rules over token-level uncertainty "significantly outperform" simple aggregation. The abstract gives no numbers. — [arXiv 2404.10136](https://arxiv.org/abs/2404.10136)
- **Cascade-Aware Training** (Wang et al., Google; arXiv 2406.00060, 2024) trains the small model knowing it sits in a cascade, optimizing joint quality and cost. It is evaluated on more than 60 tasks from SuperGLUE, WMT22 and FLAN2021, with no headline numbers in the abstract. It requires training the small model, which is not possible with a closed API model such as Haiku. — [arXiv 2406.00060](https://arxiv.org/abs/2406.00060)
- **Speculative cascades** (Narasimhan, Menon et al., Google; "Faster Cascades via Speculative Decoding", arXiv 2405.19261; ICLR 2025, venue unverified). The small model drafts tokens, the large model verifies in parallel, and a token-level deferral rule accepts or defers. The rule can use small-model confidence, compare the two models' confidence, weigh cost against benefit, or check top-k membership. The Google blog (11 Sep 2025) claims better cost-quality trade-offs and more tokens per large-model call than speculative decoding at the same quality, on Gemma and T5. Neither the blog nor the abstract gives exact numbers. It requires token-level access to both models, so it cannot be implemented on top of the Anthropic API. — [Google Research blog](https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/); [arXiv 2405.19261](https://arxiv.org/abs/2405.19261)

**Learned routers (2024–2025)**
- **RouterDC** (Chen et al.; arXiv 2409.19886; NeurIPS 2024 per arXiv comment) is a dual-contrastive query encoder. It reports +2.76% in-distribution and +1.90% out-of-distribution over the top individual LLM and prior routers. — [arXiv 2409.19886](https://arxiv.org/abs/2409.19886)
- **GraphRouter** (Feng et al.; arXiv 2410.03834; ICLR 2025, venue unverified) builds a heterogeneous task–query–LLM graph and predicts edges for effect and cost. It reports a "minimum performance improvement of 12.3%" over existing routers across three effect-cost weightings. — [arXiv 2410.03834](https://arxiv.org/abs/2410.03834)
- **Smoothie** (Guha et al., Hazy Research; arXiv 2412.04692; NeurIPS 2024, venue unverified) routes without labels. A latent-variable model fit over the generations' embeddings scores each model per sample. It picks the optimal model on 9 of 14 tasks and gains up to 10 accuracy points over baselines. It needs outputs from every candidate model first, so it does not save generation cost. — [arXiv 2412.04692](https://arxiv.org/abs/2412.04692)
- **MixLLM** (Wang et al.; arXiv 2502.18482; NAACL 2025 per arXiv comment) is a contextual bandit with lightweight quality and cost predictors plus a meta-decider that weighs latency. It reports 97.25% of GPT-4 quality at 24.18% of the cost under a time constraint. — [arXiv 2502.18482](https://arxiv.org/abs/2502.18482)
- **Mixture-of-Agents** (Wang et al., Together AI; arXiv 2406.04692, 2024; ICLR 2025, venue unverified) stacks layers of LLMs, each reading all of the previous layer's outputs. It scores 65.1% on AlpacaEval 2.0 vs 57.5% for GPT-4o. This is an ensemble for quality, not a cost saver: every query calls several models across several layers. — [arXiv 2406.04692](https://arxiv.org/abs/2406.04692)
- **Arch-Router** (Tran et al., Katanemo; arXiv 2506.16655, 2025) is a compact 1.5B model that maps queries to user-defined domain and action preferences, which are human-written route policies. It claims state-of-the-art preference matching on conversational datasets, beating top proprietary models. The abstract has no numbers, and I did not verify the paper's accuracy figures. — [arXiv 2506.16655](https://arxiv.org/abs/2506.16655)
- **BEST-Route** (Ding et al.; arXiv 2506.22716; ICML 2025 per arXiv comment) chooses both the model and how many responses to sample (best-of-n) from it, by difficulty. It reports "up to 60%" cost reduction with "less than 1% performance drop". — [arXiv 2506.22716](https://arxiv.org/abs/2506.22716)
- **Router-R1** (Zhang et al.; arXiv 2506.09033; NeurIPS 2025 per arXiv comment) is an LLM router trained with RL that interleaves "think" and "route" over multiple rounds, with a cost reward. It is evaluated on seven general and multi-hop QA benchmarks, with no headline number in the abstract. — [arXiv 2506.09033](https://arxiv.org/abs/2506.09033)
- **kNN beats learned routers** (Li et al.; arXiv 2505.12601, 2025): a tuned kNN over embeddings "often outperforms" state-of-the-art learned routers, because model performance is local in embedding space. — [arXiv 2505.12601](https://arxiv.org/abs/2505.12601)
- **Unified routing + cascading** (Dekoninck, Baader, Vechev, ETH; arXiv 2410.10347; ICML 2025 venue unverified) is "cascade routing". It reports up to 8% over cascading and up to 12% over routing on RouterBench, with SWE-Bench results under Q2. — [arXiv 2410.10347 (HTML)](https://arxiv.org/html/2410.10347)

**2026 re-evaluations and failure modes**
- **LLMRouterBench** (Li et al.; arXiv 2601.07206, 12 Jan 2026; one citing paper lists Findings of ACL 2026, unconfirmed):
  - Scale: the abstract says >400K instances, 21 datasets, 33 models and 10 baselines. The paper's own tables give 23,945 prompts and 391,645 instances, with a 70/30 split over 5 seeds.
  - Leading routers (EmbedLLM, GraphRouter, MODEL-SAT, Avengers) perform similarly and sit close to a dataset-level oracle that assigns each dataset its single best model.
  - At best they gain about 4% average accuracy over Best Single in the performance-cost setting. Top methods match Best Single's accuracy at up to 31.7% lower cost, and Avengers-Pro is near Pareto-optimal.
  - Binary routers (HybridLLM, FrugalGPT) struggle to save cost at Best-Single accuracy. OpenRouter scores −24.7% PerfGain vs Best Single.
  - "Model-recall failure": on the 410 queries (11.9%) where at most 3 models are correct, Avengers reaches 24.6% and EmbedLLM 23.2%.
  - Swapping the 7B embedding model for all-MiniLM-L6-v2 (22.7M parameters) made no significant difference.
  — [arXiv 2601.07206 (HTML)](https://arxiv.org/html/2601.07206)
- **Router collapse** (Lai & Ye, "When Routing Collapses: On the Degenerate Convergence of LLM Routers"; arXiv 2602.03478, 3 Feb 2026): as the budget rises, routers "systematically default to the most capable and most expensive model" even when cheaper models suffice. The cause is an objective–decision mismatch: routers predict scalar scores, but the decision is a discrete ranking, so small errors flip the ranking. The proposed EquiRouter learns rankings directly and cuts cost about 17% at GPT-4-level performance on RouterBench vs the strongest prior router. The abstract gives no collapse-rate figure. — [arXiv 2602.03478](https://arxiv.org/abs/2602.03478)
- **The Routing Plateau** (Lu et al., Rice/Amazon; arXiv 2606.07587, v2 28 Sep 2026) evaluates 21 methods on 5 benchmarks with 6 encoders. Top-5 methods differ by 0.22 pp on average, and paired bootstrap tests found no significant differences among them. The best still trail the oracle by 10.6–29.4 pp. Hard queries account for 53.3–80.7% of the oracle gap, and on them the wrong-model rate is 5.3–12.1x the easy-query rate. — [arXiv 2606.07587 (HTML)](https://arxiv.org/html/2606.07587v2)
- **"Dynamic LLM Routers are Often Misguided"** (Wang et al., Fastino Labs; arXiv 2610.02762, 2 Oct 2026) tests six commercial routers in 14 settings on 17 benchmarks (800 evaluation samples, 26 models). It replicates on RouterBench, SPROUT and LLMRouterBench.
  - Every commercial router except vLLM Semantic Router significantly underperforms a random choice between Gemini 3.7 Flash and Claude Opus 5 (high) at matched cost. Deficits run from −1.4 pp (Nadir) to −10.5 pp (Orca); Not Diamond is −8.8 (cost) and −4.1 (quality), and Azure is −8.4 and −2.2.
  - Four failure patterns:
    - Difficulty blindness: no router's choices correlate with difficulty above Goodman-Kruskal γ = +0.20.
    - Length reversal: five settings have significantly negative γ between expected answer length and the chosen model's cost.
    - Semantic matching: routers effectively route by data source.
    - Roster suboptimality: rosters include models that are off the Pareto frontier.
  - With perfect difficulty knowledge, a two-model roster is never more than 1 pp below the best roster of any size. Gemini 3.7 Flash trails Opus 5 (high) by 1.6 pp at a 96% discount.
  - Under the usual objective, escalation gains peak at moderate difficulty: the 60–80th percentile band beats the 80–100th by 6.3 ± 3.0 pp, because on the hardest queries both models fail.
  — [arXiv 2610.02762 (HTML)](https://arxiv.org/html/2610.02762v1)
- **"Most of the LLM Routing Gap Is Task Type"** (Lee, Redrob; arXiv 2608.23023, 25 Aug 2026) ran a fully executed matrix of 14 models x 294 questions (7 task types, 3 languages), twice.
  - Only 29 questions are routable (best single model wrong in both runs, another model right).
  - A static one-model-per-task-type table fixes 21 of the 29, and splitting by language fixes 2 more, leaving 6 of 294.
  - The static table answers 262/294 at $3.33 per run, vs the best single model's 245/294 at $7.69.
  - The paper's own caveat: everything is fitted and scored on the same 294 items, with no holdout.
  — [arXiv 2608.23023](https://arxiv.org/pdf/2608.23023)
- **Survey:** "Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey" (arXiv 2603.04445, 2026) exists. I did not review it. — [arXiv 2603.04445](https://arxiv.org/pdf/2603.04445)

### Inferences
- For Makeborne, the headline savings of the classic papers (98%, 85%, 60%, 50%, 40%) are not transferable. They come from single-turn QA or chat with GPT-4 vs Mixtral/Llama, with cheap judges or answer agreement as verifiers. The 2026 re-evaluations show the robust part of the gain is coarse task structure plus a good two-model roster.
- Several methods need things Makeborne does not have through the Anthropic API:
  - token-level probabilities: speculative cascades, token-uncertainty deferral;
  - training of the small model: Cascade-aware training;
  - generations from all candidates: Smoothie, Mixture-of-Agents;
  - large labeled preference sets: RouteLLM, RouterDC, GraphRouter.
  The approaches that fit are bounded cascades with external verifiers (FrugalGPT, AutoMix, Dekoninck), task-type policies (Arch-Router, the Lee static table) and per-step effort selection (Q4).
- Router collapse is a live risk for Makeborne's escalation path: if the escalation threshold drifts, more traffic ends up on Opus. The Opus share and the escalation rate per task class should be tracked as first-class KPIs.
- The "Misguided" roster result plus Makeborne's prices suggest Sonnet may be off the frontier. Opus is only 2x Sonnet per token. If Opus succeeds more often or uses fewer turns on a task class, its cost per accepted edit can match or beat Sonnet's. A {Haiku, Opus} x effort roster should be tested against {Haiku, Sonnet, Opus} per task class.

### Gaps
- Exact accuracy numbers for Arch-Router, Router-R1 and the kNN paper, and AutoMix's IBC figures, were not verified this session.
- The speculative-cascade paper's exact speedups were not retrieved.
- The "All Routes Lead to Collapse" paper (arXiv 2606.22325), "LLM Router: Rethinking Routing with Prefill Activations" (arXiv 2603.20895), SeqRoute (arXiv 2605.25424), CP-Router (AAAI 2026) and TwinRouterBench (arXiv 2605.18859, agentic static plus live evaluation) surfaced in searches but were not read.

## Q2. Evidence specific to agentic, multi-step coding (vs single-turn QA), including SWE-bench-style and web tasks

### Takeaway
For agentic coding, the 2026 evidence converges on four points:
- Prompt-only routing is weak: embedding routers score near chance on SWE-bench Verified, and RouteLLM-style classifiers collapse out of distribution.
- Solve sets are largely nested, so routing for accuracy has little headroom and routing for cost is the real prize.
- The useful information is in early execution: partial trajectories, repository scouting, verifier outcomes.
- Per-task token use varies up to 30x and is dominated by input tokens, so cost must be modeled per run, not per prompt.

There is no paper on routing for front-end, CSS or design-review work.

### Cited Findings
- **SWE-Router** (Son et al., UCL; arXiv 2607.00053, 30 Jun 2026, preprint).
  - Mechanism: a weak model runs K exploratory turns in mini-SWE-agent (75-step budget). A LoRA-tuned Qwen2.5-Coder-7B value head reads the partial trajectory and predicts eventual success. If the prediction falls below a threshold, the task restarts with the strong model from the original prompt, and the K weak turns still count toward cost.
  - Pairs: gpt-5-mini → gemini-3-pro-preview and deepseek-v3.2 → gemini-3-pro-preview.
  - Route-AUC on SWE-bench Verified, deepseek pair: 0.780 at K=2 vs 0.627 for the non-temporal (K=0) router, +15.3 pp.
  - gpt-5-mini pair: K=4 scores 0.709 vs 0.565 for embedding + logistic regression.
  - Prompt-only embedding baselines (LR, kNN, XGBoost on text-embedding-3-large) land around 0.43–0.57, roughly chance.
  - Failures: on the repository-disjoint SWE-Smith test split, the gpt-5-mini router loses to baselines (K=1 0.493 vs Embed+LR 0.591). Validation and test Route-AUC are poorly correlated, which the authors attribute to repository shift. AUROC is not strongly correlated with routing utility.
  - The paper reports no dollar savings.
  — [arXiv 2607.00053 (HTML)](https://arxiv.org/html/2607.00053v1)
- **Agent-as-a-Router / ACRouter** (Zhou et al., NUS/Alibaba; arXiv 2606.22902, Jun 2026, preprint).
  - Benchmark (CodeRouterBench): about 10K coding tasks from 15+ sources, 8 frontier models, and a 176-task OOD agentic-programming split.
  - In-distribution average performance: oracle 57.00%, ACRouter 49.98%, a rule-based per-dimension prior ("DimensionBest") 47.50%, Always-Opus 4.6 43.83%.
  - Perf/$: ACRouter 3.79 vs Always-Opus 1.29.
  - Static learned classifiers (LogReg, RouteLLM-BERT, RouteLLM-MF) score 46.2–47.3% in-distribution but drop to 8.9–21.4% OOD, below random (31.25%). kNN falls from 47.18% to 14.29% OOD.
  - Bandits (LinUCB/LinTS) hold up better OOD, at 46.4–49.8%.
  - Zero-shot LLM-as-router (Claude Sonnet 4.6) scores 41.41%, rising to 47.74% when given per-dimension stats. No LLM router beats DimensionBest, and Claude Opus 4.6 ranks last as a router despite being the best coder.
  - The authors' conclusion: execution-grounded feedback (verifier signals plus memory) matters more than router reasoning.
  - Caveats: the OOD split is small (176 tasks), agents are capped at 40 steps, and dollar costs are estimates because cache hits are unobservable.
  — [arXiv 2606.22902 (HTML)](https://arxiv.org/html/2606.22902)
- **Scrouting / SuperScout** (Bhola et al., SuperAGI; arXiv 2608.04804, 5 Aug 2026, preprint).
  - Mechanism: a 7B searcher explores the repository and produces a handoff of files, notes and a reproduction test. Its claims are sandbox-verified and false ones are stripped before the handoff is used. A router then picks one of four frontier fixers.
  - SWE-bench Pro Python (266 tasks): 159/266 solved vs 158 for the best single model (Claude Opus 4.6), at $0.230 vs $1.274 per solve, about one fifth.
  - Critical ablation: always using the cheapest fixer with the handoff ties the routed system. The handoff, not the routing decision, carries the result.
  - The handoff lifts the three cheaper fixers and slightly hurts the strongest. At N=99 this is directional only.
  - Router feature variants: task text alone saves 30.5% at matched solve rate, and adding searcher hidden states raises that to 34.3%. Feeding the handoff text to the router collapses savings to 8.0–9.4%.
  - Outcome-prediction AUC is 0.600 from hidden states vs 0.510 from handoff text. Logistic regression beat an MLP in every comparison.
  - Replaying learned routers on public per-task results of three SWE benchmarks: solve sets are "largely nested", and "no learned router we tested exceeded the solve rate of always picking the strongest model".
  - Caps matter: a 50-call cap bound in 17.3–48% of attempts, and auto-submit-at-cap rescued 24 of Opus 4.6's 158 solves.
  — [arXiv 2608.04804](https://arxiv.org/pdf/2608.04804)
- **Unified routing + cascading on SWE-Bench** (Dekoninck et al., ETH; arXiv 2410.10347):
  - Treating ground-truth tests as an accurate post-hoc quality signal, the AUC values are: linear interpolation 40.505, routing 40.471, threshold cascade 38.520, optimal cascade 53.20, cascade routing 54.122.
  - Routing does not beat trivial interpolation on SWE-Bench. A cascade driven by a good post-hoc check gains about 14 points.
  - The baseline threshold cascade was weak because binary feedback leaves the threshold only two choices: accept every model's output, or only correct ones.
  - The cost in this experiment is latency, not dollars.
  — [arXiv 2410.10347 (HTML)](https://arxiv.org/html/2410.10347)
- **"How Do AI Agents Spend Your Money?"** (Bai et al., incl. Brynjolfsson; arXiv 2604.22750, Apr 2026; listed at NeurIPS 2026):
  - Trajectories from 8 frontier LLMs on SWE-bench Verified differ by up to 30x in total tokens on the same task.
  - Higher token use does not mean higher accuracy; accuracy often peaks at intermediate cost.
  - Input tokens, not output tokens, drive most of the cost.
  - Models predict their own usage poorly (correlation ≤0.39) and underestimate it.
  - Some models use more than 1.5M more tokens than others per task.
  - These numbers come from the search summary and listings. The "1000x vs code chat" figure was not confirmed in the HF abstract.
  — [arXiv 2604.22750](https://arxiv.org/pdf/2604.22750); [NeurIPS 2026 listing](https://neurips.cc/virtual/2026/170688)
- **Session-level routing in agent benchmarks** (Kumar & Saminathan; arXiv 2608.14641, 28 Jul 2026) runs 4 open-source routers (incl. RouteLLM, Aurelio semantic router, vLLM Semantic Router) on RouterBench, BFCL v4, tau2-bench and WebArena: 290 frozen tasks against 2,610 outcomes.
  - Three routers emit constant or near-constant tiers. Always-Mid matches Aurelio exactly on three benchmarks and within 0.003 on the fourth.
  - vLLM Semantic Router shows no task-specific advantage over a share-matched content-blind allocation.
  - Gains "track selected-tier composition more closely than demonstrated task-specific targeting".
  - Per-step routing within a trajectory was not evaluated.
  — [arXiv 2608.14641](https://arxiv.org/pdf/2608.14641)
- **EcoAssistant** (Zhang et al.; arXiv 2310.03046, 2023) tackles code-driven QA with an executor loop. It tries cheaper LLMs first, escalates on failure and reuses past successful solutions as demonstrations. It reports "surpassing GPT-4 by 10 points of success rate with less than 50% of GPT-4's cost". — [arXiv 2310.03046](https://arxiv.org/abs/2310.03046)
- **Model Cascading for Code** (Chen et al.; arXiv 2405.15842, 2024) is a code-completion cascade in which models generate their own tests, which act as the acceptance check. It reports cost cut by 26% on average and up to 70% at best, "maintaining or improving" accuracy on some tasks. — [arXiv 2405.15842](https://arxiv.org/abs/2405.15842)
- **Agentic web tasks with effort routing:** Ares reports WebArena results (detail in Q4). — [arXiv 2603.07915 (HTML)](https://arxiv.org/html/2603.07915)

### Inferences
- For Makeborne, the route decision should not rest on the request text. The agentic evidence (SWE-Router, Scrouting, Agent-as-a-Router, Routing Plateau's recommendation) says the signal sits in what happens after engaging with the project:
  - files and components touched, and the size of the diff;
  - tool-call errors in the first K turns;
  - compile and contrast results;
  - for design work, render or screenshot diffs.
  Makeborne's existing "cheap attempt → check → repair → escalate" machine is structurally the design these papers converge on. v4 should strengthen the post-hoc signals rather than add a learned prompt router.
- Scrouting's ablation suggests a large lever: a cheap, verified "scout" pass that localizes the target and writes a compact, checked handoff (files, selectors, current values). Its finding was that the cheap fixer with a handoff ties the routed system. For targeted edits like "make the pricing cards equal height", a Haiku-low localization step that hands file, component and CSS rule to whichever model edits may be worth more than any routing model.
- Input tokens dominate agentic cost (Bai 2026), and an escalation restart re-reads context. Escalate with a compact handoff (diff, failing check, localized files) rather than replaying the full transcript.
- Anthropic prompt caches are model-specific (from prior knowledge; not re-verified this session). Switching Haiku → Opus therefore pays full input price on Opus's first turn, while a same-model effort bump can reuse the cache.
- Nested solve sets (Scrouting) imply that Opus will rarely fail where Haiku or Sonnet succeed on these tasks. The design goal is "Opus-level acceptance at Haiku-level cost", not "beat Opus by combining models".
- Per-task variance is high (30x), so per-request cost caps and step caps are part of the routing policy. Scrouting's caps bound often and changed solve rates by 9–13 pp.

### Gaps
- I found no paper on routing for front-end, React or CSS generation, website builders, slide or ebook generation, or screenshot-based design review. WebArena is web navigation, not web development.
- No paper reports routing results for Claude Haiku/Sonnet/Opus 5.5 specifically.
- No agentic-coding paper measures how often a verified cheap attempt yields a lower-quality but passing artifact, i.e. silent quality loss in design tasks.
- CodeRescue (arXiv 2607.19338, "Budget-Calibrated Recovery Routing for Coding Agents") appeared in search, but its PDF returned 404 and it was not read. It is likely relevant to repair-vs-escalate decisions.

## Q3. Verification-gated escalation: how judge/verifier error affects cascade gains; self-verification vs external verifiers; when cheap-model confidence works

### Takeaway
Cascades only pay when the post-hoc check is much more informative than what can be predicted from the prompt. In RouterBench's simulation, cascades beat everything at judge error ≤0.1 and deteriorate rapidly above 0.2. On SWE-Bench, a ground-truth-test-driven cascade gains about 14 AUC points where prompt routing gains nothing. Intrinsic self-verification and self-correction are unreliable without external feedback, and cheap-model confidence signals are weak in agentic coding (AUC around 0.5–0.6). External, deterministic, task-specific checks are what make escalation work.

### Cited Findings
- RouterBench's simulated cascades with judge error rates including 0, 0.1 and 0.2:
  - Cascades "surpass both individual LLMs and the Zero router by a significant margin" at error ≤0.1, and a zero-error judge "quickly approximates the performance of the Oracle".
  - Performance "may deteriorate rapidly, particularly when the error rate exceeds 0.2".
  - No exact crossover point is given.
  — [arXiv 2403.12031 (HTML)](https://arxiv.org/html/2403.12031)
- Dekoninck et al., on estimator quality:
  - Higher post-hoc noise causes "substantial performance degradation" for cascades, while higher ex-ante noise hurts routing.
  - Cascading is worthwhile "only when post-hoc estimates are significantly better than ex-ante ones"; otherwise direct routing is better.
  - Cascade routing's advantage narrows as noise rises.
  - With ground-truth tests on SWE-Bench, the optimal cascade reaches 53.20 AUC vs 40.47 for routing.
  — [arXiv 2410.10347 (HTML)](https://arxiv.org/html/2410.10347)
- AutoMix's design premise is that small-model self-verification is noisy. It wraps few-shot self-verification in a POMDP meta-verifier and reports >50% compute reduction at comparable performance. These are context-grounded QA tasks, not code. — [arXiv 2310.12963](https://arxiv.org/abs/2310.12963)
- "Large Language Models Cannot Self-Correct Reasoning Yet" (Huang et al.; arXiv 2310.01798; ICLR 2024 per arXiv comment): intrinsic self-correction without external feedback often fails, and performance "at times" degrades after self-correction. — [arXiv 2310.01798](https://arxiv.org/abs/2310.01798)
- "When Can LLMs Actually Correct Their Own Mistakes?" (Kamoi et al.; TACL 2024, vol. 12, pp. 1417–1440) is a critical survey. Self-correction works mainly with reliable external feedback or large-scale fine-tuning for it. — [arXiv 2406.01297](https://arxiv.org/abs/2406.01297)
- Consistency as a verifier: weak-LLM answer agreement across CoT and PoT samples gives strong-model-comparable performance at 40% of the cost on reasoning benchmarks. This requires short answers that can be compared. — [arXiv 2310.03094](https://arxiv.org/abs/2310.03094)
- Execution-based self-tests as the verifier in a code cascade: 26% average and up to 70% cost reduction. — [arXiv 2405.15842](https://arxiv.org/abs/2405.15842)
- Agentic confidence signals are weak:
  - SWE-Router: AUROC "is not strongly correlated with routing performance". — [arXiv 2607.00053](https://arxiv.org/html/2607.00053v1)
  - Scrouting: outcome-prediction AUC is 0.600 from hidden states and 0.510 from text. — [arXiv 2608.04804](https://arxiv.org/pdf/2608.04804)
  - Models forecast their own token usage poorly (r ≤0.39). — [arXiv 2604.22750](https://arxiv.org/pdf/2604.22750)
- Verification gates can strip false claims: Scrouting sandbox-verifies the scout's reproduction claims and removes false ones before any fixer sees them. Feeding unverified handoff text to the router hurt (savings 8.0–9.4% vs 34.3%). — [arXiv 2608.04804](https://arxiv.org/pdf/2608.04804)
- ACRouter's verifier is a weighted combination of AST parse, sandbox execution and other signals, scored in [0,1]. The authors credit execution-grounded feedback, not router reasoning, for the gains. — [arXiv 2606.22902](https://arxiv.org/html/2606.22902)
- Binary feedback limits the threshold cascade: on SWE-Bench the baseline threshold cascade (38.5) was below routing (40.5) because binary quality feedback forces "accept all or only correct" thresholds. The optimal cascade, which uses expected-quality reasoning, reached 53.2. — [arXiv 2410.10347 (HTML)](https://arxiv.org/html/2410.10347)

### Inferences
- Makeborne's compile and contrast checks and the model-free copy-edit check are exactly the high-precision, external, post-hoc verifiers that make cascades pay. The literature says the gain is set by the verifier's false-accept rate on the property the customer cares about.
- Compile plus contrast does not test "cards are equal height" or "the hero matches the screenshot". A cheap attempt can pass both checks and still fail the intent. That is a verifier error that a 0.1–0.2 threshold makes costly.
- v4 should add intent-specific deterministic checks where possible:
  - render the page and measure DOM boxes for layout edits;
  - text-diff assertions for copy edits, which already exist;
  - check that the change is confined to the intended selector, with no spill-over in the diff;
  - visual diff against the pre-edit render for unintended changes.
  Classes that cannot be checked deterministically should start on the stronger model.
- Do not use Haiku's self-assessment ("I have completed the change") as an acceptance gate (Huang 2023; Kamoi 2024). If an LLM judge is used, for example for screenshot design review, its error rate must be measured against human labels before it is trusted. Per RouterBench, above about 0.2 it can erase the cascade's benefit.
- The binary-threshold finding argues for graded check results (which checks failed, by how much) feeding the repair-vs-escalate decision, rather than a single pass/fail bit.
- Cost arithmetic (my calculation, not from a paper). Let h = cost of a cheap attempt, O = cost of a direct Opus run and p = the share of cheap attempts that pass a reliable check. Cheap-then-Opus saves money iff h < p·O.
  - Haiku → Opus: at Makeborne's 1:40 token prices, even if Haiku uses 3x the tokens of Opus, h/O = 0.075, so p > 7.5% suffices. Economically the Haiku-first cascade is almost always worth it, and the binding constraint is the verifier's false-accept rate (quality), not cost.
  - Sonnet → Opus: h/O ≈ 0.5 at equal token use, so Sonnet must pass more than about 50% of the time to save anything. A Sonnet-first cascade to Opus is marginal on cost.

### Gaps
- No paper measured verifier error rates for UI or CSS outcomes (layout assertions, visual diffs, VLM judges of screenshots) or their effect on cascade economics.
- RouterBench does not publish an exact crossover error rate.
- No study isolates the "one repair" step: whether a same-model repair with check feedback beats immediate escalation, and at what cost. CodeRescue (unread) may address it.

## Q4. Routing on reasoning effort / test-time compute vs routing across models

### Takeaway
Adaptive effort or compute works:
- Ares cuts reasoning tokens by up to 52.7% vs fixed-high with no accuracy loss on agent benchmarks.
- Input-adaptive compute halves compute at no quality cost.
- BEST-Route saves up to 60% by choosing the model plus the number of samples.

Fixed low effort collapses on long-horizon agent tasks, and high effort is not monotonically better ("overthinking"). For easy and medium problems, extra test-time compute on a smaller model can beat a 14x larger model, but hard problems need the bigger model. No paper directly compares effort switching with model switching in an agent loop, so "which is better" is unresolved. The strongest designs choose both jointly.

### Cited Findings
- **Ares** (Yang et al.; arXiv 2603.07915, 9 Mar 2026, preprint) uses a Qwen3-1.7B router, trained with SFT then GRPO, to choose low, medium or high effort for each step of a gpt-oss-20b agent from the interaction history.
  - Labels: the lowest effort that reproduces the reference action in 3 of 3 samples.
  - Results, accuracy and reasoning tokens, Ares vs fixed high:
    - TAU-Retail: 54.8% at 652k tokens vs 54.8% at 1,007k. The RL version reaches 58.5% at 476k, 52.7% fewer tokens.
    - TAU-Airline: high 38.0% at 873k vs RL Ares 42.0% at 133k, 84.8% fewer tokens.
    - BrowseComp-Plus: 41.3% at 1,071k vs 42.7% at 1,841k.
    - WebArena: 46.5% at 1,512k vs 45.0% at 2,763k.
  - Fixed low collapses on long-horizon tasks: BrowseComp-Plus 8.0% vs 42.7%.
  - Medium beats high on Airline (42.0 vs 38.0), the "overthinking" failure.
  - Prompting frontier models (GPT-5, Gemini 3 Pro) as effort routers underperforms the trained router.
  - Share of steps needing high effort in the training labels: 28% on TAU-Bench, 50% on BrowseComp-Plus, 64% on WebArena.
  - The authors argue effort switching keeps a predictable frontier and reuses the KV cache, but they ran no model-switching comparison.
  — [arXiv 2603.07915 (HTML)](https://arxiv.org/html/2603.07915)
- **Snell et al.** (arXiv 2408.03314, 2024; ICLR 2025 venue unverified): compute-optimal, prompt-adaptive test-time compute is more than 4x more efficient than best-of-N. In a FLOPs-matched evaluation it can "outperform a 14x larger model", on problems where the small model already has non-trivial success. — [arXiv 2408.03314](https://arxiv.org/abs/2408.03314)
- **Damani et al., "Learning How Hard to Think"** (arXiv 2410.04707, 2024) predicts per-input reward distributions and allocates compute (more samples, or a stronger decoder) where it helps. It reports "reduce computation by up to 50% at no cost to response quality" or "up to 10%" quality gain at fixed budget. — [arXiv 2410.04707](https://arxiv.org/abs/2410.04707)
- **BEST-Route** (ICML 2025) jointly chooses the model and the number of samples (best-of-n), cutting cost up to 60% with <1% drop. — [arXiv 2506.22716](https://arxiv.org/abs/2506.22716)
- **Route to Reason** (arXiv 2505.19435, 2025) routes jointly over the LM and the reasoning strategy under a budget. Per its abstract, via search summary, it beats the best single model in accuracy with >60% fewer tokens. — [arXiv 2505.19435](https://arxiv.org/abs/2505.19435)
- **DART** (arXiv 2606.23181, 2026) sets thinking budgets without training, from draft agreement. Per the search summary it reports up to +10 points on AIME 2025 for DeepSeek-V3.2 with 28% fewer thinking tokens; the authors call these exploratory results. — [arXiv 2606.23181](https://arxiv.org/pdf/2606.23181)
- **Think When Needed** (arXiv 2601.18146, 2026) uses a router head to decide whether to reason at all, per instance, for LLM ranking. Per the search summary: +6.3% NDCG@10 with 49.5% fewer tokens on MovieLens with Qwen3-4B, and the benefit of reasoning varies by instance and model. — [arXiv 2601.18146](https://arxiv.org/abs/2601.18146)
- **Budget Guidance** (arXiv 2506.13752, 2025) steers thinking length at the token level. Per the search summary: up to 26% accuracy gain on MATH-500 under tight budgets. — [arXiv 2506.13752](https://arxiv.org/html/2506.13752v1)
- **Agentic cost vs accuracy:** accuracy often peaks at intermediate token cost on SWE-bench Verified, so more tokens do not mean better results. — [arXiv 2604.22750](https://arxiv.org/pdf/2604.22750)
- **Model choice still dominates on the hardest items:** in "Misguided", Flash vs Opus 5 (high) differ by 1.6 pp overall, but escalation gains concentrate in moderate-difficulty bands. On the hardest queries both fail. — [arXiv 2610.02762](https://arxiv.org/html/2610.02762v1)

### Inferences
- For Makeborne, effort is a cheap, cache-friendly second axis. The evidence supports:
  - defaulting most tool steps to low or medium effort;
  - spending high effort on the planning and localization steps and on repair after a failed check, which matches Ares's observation that go_back and branch steps drew high effort;
  - not making high effort the default, given "overthinking" and accuracy peaking at intermediate cost.
- "Low first, retry high on the same model" is supported indirectly: it keeps the prompt cache and avoids context re-encoding. But no paper directly shows it beats "low on the small model, then escalate to the large model" in coding agents. The repair step in v4 should be an A/B arm: same-model higher effort vs escalate to Opus.
- Snell's result suggests Haiku-high could cover the easy and medium classes, while hard creative or structural classes (new site, complex layout rework) should start on Opus. Effort cannot buy capability the model lacks on hard items, as fixed-low's 8% on BrowseComp-Plus and Snell's hard-problem results show.
- Prompting a frontier model to pick the effort level is a poor router (Ares: GPT-5 and Gemini 3 Pro baselines; Agent-as-a-Router: Opus ranked last as a router). Use rules or a small trained classifier on observed step features.

### Gaps
- No study compares within-model effort routing against cross-model routing under matched dollar cost in a coding agent.
- No study covers Anthropic's effort parameter specifically.
- Ares has no coding benchmark.

## Q5. Router evaluation methodology: sample sizes, paired designs, noise floors, gap to oracle, gaming and adversarial routing

### Takeaway
Router differences are usually smaller than the noise floor:
- A temperature-0 rerun flips 5.37% of model–question correctness cells.
- The top-5 routers are statistically indistinguishable (paired bootstrap).
- Single-sample labels are unstable.

Credible evaluation needs paired designs on identical items, repeated runs, fixed-tier and random-split baselines at matched cost, mean rather than realized costs, and per-difficulty-band reporting. Routers are also easy to game: confounder gadgets push 73–100% of queries to the strong model in white-box settings and survive perplexity filters.

### Cited Findings
- **Noise floor:** rerunning an identical 14x294 matrix at temperature 0 and seed 42 through the same gateway flipped 221 of 4,116 correctness bits (5.37%), and billed cost moved −3.81%. The residual routing gain after task-type and language conditioning (2.04% of items) is below that noise. The author argues that "a small win does not show that routing did anything". — [arXiv 2608.23023](https://arxiv.org/pdf/2608.23023)
- **Indistinguishable top routers:** the top-5 of 21 methods differ by 0.22 pp, with no significant differences under paired bootstrap. Routers disagree on up to 70% of queries, yet median accuracy gaps are only 0.3–0.6 pp because the disagreements cancel. — [arXiv 2606.07587 (HTML)](https://arxiv.org/html/2606.07587v2)
- **Recommended protocol ("Misguided"):**
  - Compare against a random router over two well-chosen models at matched cost.
  - Charge each model its mean cost, not the realized cost, to prevent "accuracy hacking". Their example: escalating the shortest-answer 20% reaches 59.5% at $1.03 per 1k queries, only 1.6 pp below escalating the hardest 20%, at about 1.5% of the price.
  - Evaluate easy-band accuracy and cost separately from hard-band escalation, with the hard band defined as ≥50% failure rate (26.2% of their set).
  - Measure within-source γ, report 95% paired Wald intervals for accuracy differences and jackknife intervals for γ, and replicate across datasets.
  - Their own limitation: each outcome was generated only once.
  — [arXiv 2610.02762 (HTML)](https://arxiv.org/html/2610.02762v1)
- **Fixed-tier controls:** three of four open-source routers emitted constant or near-constant tiers, and Always-Mid matched one router exactly on three benchmarks. Fixed-tier baselines and selected-tier distributions are "necessary controls". — [arXiv 2608.14641](https://arxiv.org/pdf/2608.14641)
- **The blind-mixing line:** any random traffic split between a cheap and a strong model achieves the segment between their (cost, accuracy) points. "A routing system is interesting only if it operates above that segment." — [arXiv 2608.04804](https://arxiv.org/pdf/2608.04804)
- **Single-sample labels are unstable** (DARS; Lai et al.; arXiv 2606.06924; EMNLP 2026 Main per the arXiv page). Repeated decoding and semantics-preserving rewrites change scores and even model preferences. Supervision built from repeated observations (expected quality, cost, variability) improves routing utility over single-shot labels "under moderate sampling budgets". The abstract gives no exact sample count. — [arXiv 2606.06924](https://arxiv.org/abs/2606.06924)
- **Gap to oracle:**
  - Best routers trail the oracle by 10.6–29.4 pp, with hard queries carrying 53.3–80.7% of the gap. — [Routing Plateau](https://arxiv.org/html/2606.07587v2)
  - Leading routers approach a dataset-level oracle, not the query-level oracle. — [LLMRouterBench](https://arxiv.org/html/2601.07206)
  - On CodeRouterBench the oracle is 57.00% vs 49.98% for the best router, in-distribution. — [Agent-as-a-Router](https://arxiv.org/html/2606.22902)
- **Data scaling barely helps:** 10x more training data (302,371 queries, about 2.8M labels) plus fine-tuning gave +1.24 pp mean (range 0.31–2.13), and the mean stayed 13.27 pp below the oracle. — [arXiv 2606.07587 (HTML)](https://arxiv.org/html/2606.07587v2)
- **Adversarial routing, "Rerouting LLM Routers"** (Shafran, Schuster, Ristenpart, Shmatikov; arXiv 2501.01818, Jan 2025):
  - Query-independent "confounder gadgets" upgrade queries to the strong model:
    - White-box upgrade rates: 100% on MT-Bench for the SW, MF and classifier routers, and 73–100% across routers and datasets (e.g. causal-LLM router 73% MT-Bench, 95% MMLU, 94% GSM8K).
    - Black-box transfer stays high, e.g. 99% and 88%, with 45% against the LLM router.
    - Commercial routers: Unify was upgraded on 79–91% of queries, raising cost about 1.7x; NotDiamond 13–21%; for OpenRouter, some gadgets routed all queries to GPT.
  - Response quality did not drop and sometimes rose, e.g. GSM8K 46 → 64.
  - A perplexity filter caught naive gadgets (97% true positives at 3% false positives). Perplexity-optimized gadgets evaded it: ROC-AUC 0.66–0.71, while upgrade rates stayed high (e.g. MF on MT-Bench at 98%).
  — [arXiv 2501.01818 (HTML)](https://arxiv.org/html/2501.01818)
- **Error bars for evals** (Miller, Anthropic, "Adding Error Bars to Evals", arXiv 2411.00640, 2024; from prior knowledge, not re-verified this session) recommends:
  - clustered standard errors when items share context;
  - paired-difference analysis when two systems answer the same items;
  - resampling or repeated generations to reduce within-item variance;
  - power analysis to size evals.
  — [arXiv 2411.00640](https://arxiv.org/abs/2411.00640)

### Inferences
- Sample-size arithmetic (my calculation, not from a paper). To detect a 5 pp difference in acceptance rate (e.g. 80% vs 75%) at α=0.05 and 80% power:
  - Unpaired: about 1,090 requests per arm.
  - Paired on identical requests (McNemar), with about 10% of items discordant: about 310 paired items, roughly 3.5x fewer.
  - Non-inferiority margins of about 2 pp need several times more.
  At Makeborne's scale, use paired, replayed request sets with at least 2 runs per arm so the 5.37%-style flip rate can be measured. Do not trust differences inside that noise band.
- Baselines every v4 report should include, per task class:
  - Always-Haiku, Always-Sonnet and Always-Opus, at each effort;
  - a random split of Haiku and Opus at matched mean cost (the blind-mixing line);
  - the current v3 rule table.
  Report cost per accepted outcome with mean-cost accounting, plus escalation rate, repair rate and Opus share (the collapse monitor).
- Gaming risk is real for Makeborne in two ways:
  1. If the price a customer pays is flat but the routing depends on request text, users or prompt-injected content (e.g. text in a pasted brief) can push requests to Opus. Confounder gadgets show this works even against learned routers and evades perplexity filters.
  2. The orchestrator's own metrics can be "accuracy-hacked" by escalating cheap, short edits.
  Mitigations: route on verifiable post-hoc signals rather than prompt wording, cap escalations per request, and make tier changes visible in billing.

### Gaps
- No paper gives a recommended number of repeated samples per item for router labels; DARS says "moderate" without a figure in the abstract.
- No paper reports noise floors for agentic code-editing evals specifically, e.g. how often the same Makeborne-style edit passes or fails across reruns.
- Miller's paper was cited from prior knowledge.

## Q6. Rule-based vs learned routers at small data scale

### Takeaway
At small data, and often at large data, simple structure wins:
- A static task-type table captured 21 of 29 routable items.
- Rule-based per-dimension priors beat every LLM router on coding tasks.
- kNN on a frozen encoder ranks top-2 everywhere.
- A 22.7M-parameter encoder equals a 7B one.
- Logistic regression beat an MLP.

Learned static classifiers can match rules in-distribution but collapse out of distribution, sometimes below random. Learning helps most when it consumes execution signals (trajectory, verifier outcomes, memory), not prompt text.

### Cited Findings
- Static task-type table, with one model per task type chosen once: 21 of 29 routable questions improved, and +language 23 of 29. It reached 262/294 at $3.33 vs the best single model's 245/294 at $7.69. The residual a learned router could target was 6 of 294 items, smaller than the run-to-run noise. Caveat: no holdout. — [arXiv 2608.23023](https://arxiv.org/pdf/2608.23023)
- Rule-based "DimensionBest" (best model per task dimension) scores 47.50% in-distribution vs 46.2–47.3% for LogReg, RouteLLM-BERT and RouteLLM-MF, and vs 41.41–47.74% for zero-shot LLM routers. No LLM router beat it. However, a dimension prior cannot be applied to unseen task types. — [arXiv 2606.22902](https://arxiv.org/html/2606.22902)
- Learned static classifiers fail OOD: 8.9–21.4% vs random 31.25% (RouteLLM-style), and kNN 14.29%. Bandits with online feedback degrade less (46.4–49.8%), and the memory-plus-verifier agentic router does best (62.50% OOD vs Always-Opus 57.14%), on only 176 OOD tasks. — [arXiv 2606.22902](https://arxiv.org/html/2606.22902)
- kNN is in the top two on all five benchmarks; other routers gain at most 0.006 concordance over it, and frozen kNN matches fine-tuned routers after data scaling (69.38%). — [arXiv 2606.07587 (HTML)](https://arxiv.org/html/2606.07587v2); also [arXiv 2505.12601](https://arxiv.org/abs/2505.12601)
- Leading routers sit near the dataset-level oracle, meaning gains are coarse-grained. Embedding model size makes no significant difference (all-MiniLM-L6-v2 at 22.7M parameters ≈ gte-qwen2-7B). — [arXiv 2601.07206 (HTML)](https://arxiv.org/html/2601.07206)
- RouteLLM's routers trained on Arena data were near random on out-of-distribution MMLU. Adding about 1,500 in-domain golden labels (<2% of training data) made them useful. A small amount of in-domain labeled data matters more than a large amount of generic preference data. — [LMSYS blog](https://lmsys.org/blog/2024-07-01-routellm/)
- In Scrouting's cost router, logistic regression beat an MLP in every comparison. Text-only features still gave 30.5% savings at matched solve rate, but a "no-router" policy (always the cheapest fixer plus handoff) tied the routed system on SWE-bench Pro. — [arXiv 2608.04804](https://arxiv.org/pdf/2608.04804)
- In SWE-Router, prompt-only embedding routers were near chance (Route-AUC about 0.43–0.57), and the trajectory-conditioned value head won in-distribution but failed under repository shift (SWE-Smith test). — [arXiv 2607.00053 (HTML)](https://arxiv.org/html/2607.00053v1)
- Arch-Router's approach is human-written, preference-aligned route policies (domain and action descriptions) matched by a 1.5B model. It is an explicit argument that routing should follow operator-defined policy rather than benchmark-learned quality scores. Numbers were not verified. — [arXiv 2506.16655](https://arxiv.org/abs/2506.16655)
- Router collapse is a failure of score-predicting learned routers at high budgets. Learning rankings directly (EquiRouter) recovers about 17% cost at GPT-4-level performance. — [arXiv 2602.03478](https://arxiv.org/abs/2602.03478)

### Inferences
- For Makeborne at its current data scale (hundreds to low thousands of labeled request outcomes per class), the best-supported v4 design is a rule table keyed on task class. Each cell (new site, targeted edit, copy edit, design review, plan, slide, ebook) gets a starting model and effort, chosen offline from paired replay data at mean cost.
- On top of the rule table, add execution-grounded escalation:
  - deterministic checks;
  - early-trajectory features after K turns, e.g. tool errors, files touched vs the expected scope, and diff size;
  - a bounded repair and escalation budget.
- A learned component, if any, should be:
  - a logistic regression or kNN over observed run features, not prompt embeddings;
  - trained only on Makeborne's own outcomes;
  - re-validated per task class, given the repository-shift failures in SWE-Router and Agent-as-a-Router.
- Online bandit-style updating per class (LinUCB/LinTS held up out of distribution in Agent-as-a-Router) is a reasonable later step once volume allows. It should be gated by the paired-evaluation methodology in Q5.
- Expected gains from a learned prompt router over a good rule table are likely within noise (Lee 2026; Routing Plateau). Engineering effort is better spent on:
  1. stronger task-specific verifiers (Q3);
  2. a verified localization and handoff step (Scrouting);
  3. per-step effort policy (Ares);
  4. roster pruning to frontier models only ("Misguided").

### Gaps
- No paper studies rule vs learned routing for code or UI editing with fewer than about 1,000 labeled outcomes.
- No paper tests rule tables keyed on the kinds of edit-intent categories Makeborne uses (copy, layout, style, structural, new build). The Lee (2026) result is on QA-style task types with no holdout, and should be treated as suggestive, not conclusive.
