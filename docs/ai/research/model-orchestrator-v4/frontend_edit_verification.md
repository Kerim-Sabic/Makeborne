# Verifying AI-made front-end edits (React/CSS): methods, measured accuracy, cost, and gate design (as of 23 Oct 2026)

Scope note: this covers automatic checks that confirm a cheap model's edit did what was asked, without regressions, for Makeborne's v4 cascade (Haiku 5.5 or low-effort Opus first, escalate to full-effort Opus on a failed check). Makeborne already has compile/type checks, a rendered contrast check, desktop and mobile screenshots, and a model-free copy check. Anything marked [unverified] could not be confirmed against a primary source in this session.

## 1. Deterministic checks: AST/JSX diffs, DOM diffs, CSS diff scope, "only the target changed"

### Takeaway
Deterministic scope checks are the cheapest and most reliable layer, and the research supports leaning on them. The best-measured failure of models on edit tasks is localization: they change the wrong place or make unneeded changes. A source-to-DOM mapping (stable element IDs), an AST diff, and a rendered DOM, style and box diff can catch this at close to zero cost, with no judge error.

### Cited Findings
- DesignBench (900 webpage samples; React, Vue, Angular, vanilla; generation, edit and repair tasks) reports that framework-based development is markedly harder than vanilla HTML/CSS, and that models struggle with JSX parsing (React), template syntax (Vue) and TypeScript architecture (Angular). — [DesignBench arXiv 2506.06251](https://arxiv.org/abs/2506.06251)
- DesignBench scores edits with deterministic code metrics alongside an MLLM judge. These are Compilation Success Rate; Code Modification Location Similarity (CMLS), a Jaccard score over AST-level add, delete and modify operations compared with ground truth; and Code Modification Content Similarity (CodeBLEU on matched operations). — [DesignBench v3 HTML](https://arxiv.org/html/2506.06251v3)
- DesignBench names code localization as the main bottleneck for edit and repair: models compile but fail to find and change the right regions. Its failure analysis lists "unnecessary modifications" and "wrong objects". Claude-3.7's best CMLS is 0.7696 (Angular), and localization stays modest across models. The authors recommend giving models explicit edit locations. The paper gives no frequencies for these failure types. — [DesignBench v3 HTML](https://arxiv.org/html/2506.06251v3)
- Lovable's Visual Edits uses a custom Vite plugin that gives every JSX component a unique, stable ID that survives edits. A clicked DOM element maps back to the JSX that renders it, both ways. The project is held as an AST, and edits are AST mutations, not regex. The code samples use Babel-style `traverse` and `generate`. On save, the AST is regenerated, only changed lines are diffed, and HMR refreshes the view. The post describes no separate verification step. — [Lovable blog: Visual Edits](https://lovable.dev/blog/visual-edits)
- The npm package `lovable-tagger` (v1.3.0) describes itself as a Vite plugin that adds `data-component-id` attributes to JSX/TSX components. Its README install line names `@test/plugin`, which looks like a placeholder. [partially unverified: the link between this package and Lovable's production pipeline is not confirmed] — [lovable-tagger README on jsDelivr](https://cdn.jsdelivr.net/npm/lovable-tagger@1.3.0/README.md)
- Interaction2Code (127 webpages, 374 interactions, 31 interaction categories; ASE 2025) prompts models to put IDs on interactive elements. Selenium finds the elements by ID, clicks them, and takes before and after screenshots. Pixel subtraction (or a diff tool when page size changes) isolates the affected region, which is then scored with SSIM, OCR-text BLEU, widget match and position similarity. — [Interaction2Code arXiv 2411.03292](https://arxiv.org/abs/2411.03292v3)
- Playwright ARIA snapshots serialize the accessibility tree (roles, names, attributes, hierarchy, order, states) as YAML, and `toMatchAriaSnapshot` asserts against a template. Templates allow partial matching and regex. Children modes are `contain` (default), `equal` and `deep-equal`. The assertion can be scoped to a locator, so one region can be checked. — [Playwright docs: ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- Playwright's `toMatchSnapshot` compares arbitrary text or binary data, so serialized DOM, style or box dumps can be asserted the same way as images. — [Playwright docs: visual comparisons](https://playwright.dev/docs/test-snapshots)
- The Chrome DevTools Protocol `DOMSnapshot.captureSnapshot` returns, in one call, the DOM tree, the layout tree with bounding boxes, a whitelisted set of computed styles per node, and text boxes. [unverified in this session: the docs page fetch returned only a redirect notice; the description is from prior knowledge] — [CDP DOMSnapshot domain](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/)
- DiffSpot builds its web-UI difference pairs by changing one CSS property on one element and re-rendering. A "grounding gate" keeps only pairs whose pixel difference stays inside the target element. This "diff confined to target" test is exactly an "only the target changed" check. — [DiffSpot arXiv 2605.29615](https://arxiv.org/abs/2605.29615)

### Inferences
- **Copy edits (a)** can be verified with no model in the loop. Makeborne's copy check (new text present, old text gone, few lines changed) should gain three more conditions:
  1. Rendered-DOM text diff: `innerText` or text nodes before and after differ only inside the target element's subtree.
  2. AST diff: the only changed nodes are `JSXText` or string literals, plus `alt`/`aria-label`/`title` attributes when asked, inside the target component.
  3. Pixel-diff bounding box: the box lies inside the target element's box, widened for reflow to the box of its nearest block-level ancestor.

  All three are binary, cheap and repeatable, so their error comes only from bugs in the harness.
- **Targeted style or layout edits (b)** need an "intended property moved, nothing else moved" check:
  1. Capture computed styles and boxes for all nodes before and after, keyed by the stable component ID. Use CDP `DOMSnapshot` or `page.evaluate` with `getComputedStyle` and `getBoundingClientRect`.
  2. Require the requested property on the target to change in the requested direction (for example `padding-top` rises, or `background-color` matches a token).
  3. Allow box changes only on the target, its descendants and elements reflowed by it (later siblings shifted along one axis by the same delta).
  4. Treat any other changed computed style as a regression signal.

  This catches the "unnecessary modifications" and "wrong object" failures that DesignBench names.
- Stable IDs at compile time (Lovable-style, or Interaction2Code's ID tagging) are the key enabler. Without them, before and after DOM nodes cannot be reliably paired, and diffs turn into heuristic tree matching.
- Tailwind-heavy code gives a cheap extra check: a set diff of `className` tokens on the target JSX element should show only the requested utilities added or removed. This follows from AST access and is not sourced.
- Standard tooling for these checks (general knowledge, not verified in this session): `@babel/parser`, `@babel/traverse` and `@babel/generator` for JSX ASTs; the TypeScript compiler API or ts-morph for typed TSX; PostCSS or css-tree for stylesheet diffs; Playwright (with CDP sessions in Chromium) for DOM, style and box capture; jsdom for DOM structure checks that need no layout. Note that jsdom does not compute layout, so it cannot replace a real browser for box or style checks.

### Gaps
- I found no published measurement of false-accept and false-reject rates for DOM, style or AST "scope" verifiers on real LLM edits. DesignBench's CMLS is a similarity score against ground truth, not a pass/fail verifier.
- I could not confirm whether React 19 still provides `_debugSource` (fiber-to-source mapping through `@babel/plugin-transform-react-jsx-source`). Babel's docs say adding that plugin errors under the automatic runtime. Makeborne should depend on its own compile-time ID attribute, not on React internals.
- CDP `DOMSnapshot` parameter names and experimental status were not confirmed (fetch returned a redirect).

## 2. Visual regression: pixel and perceptual diffs, region scoping, layout shift, false-positive control

### Takeaway
Pixel diffs with anti-aliasing detection and a strict capture discipline (no animations, caret hidden, masks, same rendering environment, wait for stable frames) are cheap and reliable for "did anything outside the target change?". They are poor at "is the change correct?", which is a semantic question. Vendors' AI review layers (Applitools, Percy) aim at false-positive triage, but none publish independent accuracy figures.

### Cited Findings
- Playwright `toHaveScreenshot` defaults: `animations: "disabled"` (finite animations fast-forwarded, infinite ones reset); `caret: "hide"`; `mask` (Locators covered with `#FF00FF` boxes); `stylePath` (CSS injected at capture, pierces Shadow DOM, added in v1.41); `threshold` default 0.2 (per-pixel perceived colour difference in YIQ space); `maxDiffPixels` and `maxDiffPixelRatio` set through config; `scale: "css"`. The assertion waits until two consecutive screenshots match before comparing. — [Playwright PageAssertions API](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1)
- Playwright warns that browser rendering varies with host OS, version, settings, hardware and headless mode, and says to run tests "in the same environment where the baseline screenshots were generated." It uses pixelmatch for image comparison. — [Playwright docs: visual comparisons](https://playwright.dev/docs/test-snapshots)
- pixelmatch: per-pixel `threshold` default 0.1. Anti-aliasing detection is on by default (`includeAA: false`) and implements Vyšniauskas (2009), "Anti-aliased Pixel and Intensity Slope Detector". Colour difference uses OKLab with HyAB distance. It has no dependencies and is "just a few hundred lines of code". — [mapbox/pixelmatch](https://github.com/mapbox/pixelmatch)
- Chromatic's default `diffThreshold` is 0.063, chosen to balance accuracy against artifacts such as anti-aliasing. Its docs warn that a high value like 0.8 can hide real changes such as repositioning. Anti-aliased pixels are ignored by default, and `diffIncludeAntiAliasing` re-enables them. — [Chromatic docs: threshold](https://docs.chromaticqa.com/threshold)
- Applitools has five match levels:
  - Strict: catches differences a person would notice and ignores rendering noise.
  - Layout: checks relative positions and appearing, vanishing or moved elements; ignores text, colour and styling.
  - Ignore colors.
  - Dynamic: pattern-validates dates, emails and similar values; the default for Web on supported SDKs.
  - Exact: pixel-for-pixel, and not recommended.

  The docs suggest Strict for the whole page with Layout regions for dynamic areas. They give no accuracy figures. — [Applitools docs: match levels](https://applitools.com/docs/common/cmn-eyes-match-levels.html)
- BrowserStack Percy launched an AI "Visual Review Agent" in October 2025. It writes natural-language summaries of changes, groups similar changes, and claims review cycles "up to 3x" faster. This is a vendor claim with no independent accuracy data. — [BrowserStack press release, 14 Oct 2025](https://tools.prnewswire.com/en-us/live/20813/release/20251014EN97311); [Percy docs: Visual Review Agent](https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview)
- Layout-shift scoring: each shift scores impact fraction × distance fraction. A "good" CLS is ≤ 0.1 and "poor" is > 0.25. Session windows allow < 1 s between shifts and last at most 5 s. Shifts within 500 ms of discrete input are flagged `hadRecentInput`. A `PerformanceObserver({type: 'layout-shift', buffered: true})` exposes them. Lab tools capture only load-time shifts, and iframes are not reported by the API. — [web.dev: CLS](https://web.dev/articles/cls)
- Interaction2Code uses before and after pixel subtraction to isolate the region an interaction changed, then scores that region (SSIM, position similarity). It works as a region-scoped diff baseline. — [Interaction2Code arXiv 2411.03292](https://arxiv.org/abs/2411.03292v3)
- DiffSpot finds that neither pixel magnitude nor CLIP distance reliably predicts whether VLMs notice a CSS change. Perceptual embedding distances are therefore poor proxies for semantic significance on UIs. — [DiffSpot arXiv 2605.29615](https://arxiv.org/abs/2605.29615)

### Inferences
- **Region-scoped diff as the regression gate.**
  1. Render before and after, both desktop and mobile, with the Playwright defaults above. Inject a `stylePath` stylesheet that hides known volatile regions (carousels, timestamps, embedded video).
  2. Run pixelmatch with anti-aliasing detection on.
  3. Compute the bounding boxes of the changed-pixel clusters.
  4. Pass only if every cluster falls inside the allowed region: the target's box at both the before and after positions, plus a reflow band for later siblings.

  This turns pixel diffing from "anything changed? (noisy)" into "did anything change outside where it should? (precise)".
- **False-positive controls for a hosted preview renderer.**
  - Use one pinned Chromium build and font set for before and after.
  - Render before and after in the same job and container, so no stored baselines go stale.
  - Wait for stable frames (two equal screenshots) and for web fonts to finish loading. Waiting on `document.fonts.ready` is general practice, not verified here.
  - Mask dynamic content.

  Rendering both states in the same job removes most cross-environment noise, which is the main cause of flakiness in the vendor docs.
- **Layout-shift detection** for edit verification is better done with a direct before/after diff of element boxes keyed by stable ID (section 1) than with CLS, because CLS measures load-time instability, not edit-induced displacement. CLS is still worth gating as a loading regression: flag a new CLS above 0.1 when the baseline was below it.
- SSIM and CLIP are useful for benchmark scoring (Interaction2Code, Design2Code) but not for pass/fail of a specific edit, because they do not encode which region should change.

### Gaps
- No vendor (Applitools, Percy, Chromatic) publishes independently verified false-positive or false-negative rates for AI-assisted visual review. All accuracy claims are marketing.
- I did not find benchmark data comparing pixelmatch, SSIM and perceptual-hash false-positive rates on web screenshots under controlled rendering.

## 3. LLM/VLM-as-judge for UI: benchmarks, agreement with humans, bias controls, cost

### Takeaway
Agreement with humans depends heavily on how narrow the question is:
- Narrow, criterion-specific edit judging reaches about 92–96% (DesignBench, GPT-4o).
- Checklist-guided holistic judging with code plus several screenshots reaches about 91% with a frontier judge (ArtifactsBench, Gemini-2.5-Pro).
- Open-ended pairwise preference on real arena pairs tops out around 70% (WebDevJudge), against about 85% for humans.
- VLMs asked to spot unprompted visual differences miss most of them: best recall is 40.7% (DiffSpot).

So a VLM judge should answer narrow, checklist-style questions with code or diff context, run in both candidate orders, and never act as the regression detector.

### Cited Findings
- **ArtifactsBench** (Tencent; 1,825 queries; 30+ LLMs):
  - Setup: each artifact runs in headless Chromium (Playwright, 1024×768), with three screenshots taken before, during and after a scripted interaction. The referee sees the task, the full code answer, the screenshots and a 10-item task-specific checklist (five visual, five code items). An LLM drafts each checklist and humans refine it.
  - Pairwise accuracy against front-end engineers (280 queries, 6 models; double-blind; ground truth is the median annotator rating):

    | Judge | No images | One image | Multiple images |
    |---|---|---|---|
    | Gemini-2.5-Pro | 79.06% | 87.10% | 90.95% |
    | o4-mini | 72.41% | 76.25% | 79.41% |
    | Qwen2.5-VL-72B | 61.80% | 68.08% | 71.34% |

  - Removing the code answer drops Gemini from 90.95% to 74.94%.
  - Ranking consistency with WebDev Arena is 94.4% (normalized Footrule), against 69.4% for WebBench. The paper gives no cost per judgment.
  - — [ArtifactsBench arXiv 2507.04952v2](https://arxiv.org/html/2507.04952v2)
- **WebDevJudge** (ICLR 2026 oral; 654 pairs from webdev-arena-preference-10k):
  - Human labels: inter-annotator agreement is 89.7% on the final labels. With a human-written rubric, agreement is 92.0% (90.0% with an LLM-generated rubric). Without a rubric it is 65.0%. Human pairwise agreement with the expert labels averages 84.56%.
  - Best pairwise judges: GPT-4.1 70.34%, Claude-4-Sonnet 70.18%, Claude-3.7-Sonnet 68.96%, GPT-4o 67.74%, Gemini-2.5-Pro 65.75%. Single-answer grading is more than 8 points worse on average (best: Claude-3.7-Sonnet 63.91%).
  - Inputs: for Claude-4-Sonnet, code plus image gives 70.18%, code only 67.58%, image only 59.48%.
  - Guidance: in pairwise mode, rubrics or Likert scales add little over direct prompting.
  - Agentic workflow: it did not beat vanilla judges (best combined-rubric agentic run 60.55% single-answer).
  - Position consistency is 83.3–89.6% (Claude-4-Sonnet 89.6%; GPT-4.1 favoured the second position in 15.8% of cases).
  - Named failure modes: rejecting functionally equivalent implementations, poor feasibility checks, and position bias.
  - Feasibility (WebDevJudge-Unit, 502 cases): code-reading LLM judges have high recall and low precision (GPT-4.1: precision 72.1, recall 90.0). The UI-TARS-1.5 agent has higher precision and lower recall (82.4 / 70.3). Ensembling adds about 1 point.
  - — [WebDevJudge arXiv 2510.18560v2](https://arxiv.org/html/2510.18560v2); [ICLR 2026 oral page](https://iclr.cc/virtual/2026/oral/10010880)
- **DesignBench edit and repair judge:** GPT-4o scores each edit 0–10. Human validation used 5 PhD annotators with majority vote (kappa 0.8648 for edit, 0.8428 for repair). The judge agreed with humans on 95.54% of 359 edit samples and 91.89% of 111 repair samples. GPT-4o was also one of the evaluated models. Best edit scores: Claude-3.7 8.18 / 8.36 / 8.02 / 9.15 (React / Vue / Angular / vanilla). — [DesignBench v3 HTML](https://arxiv.org/html/2506.06251v3)
- **DiffSpot** (May 2026; 4,400 web-UI pairs, single-CSS-property mutations; 13 VLMs zero-shot):
  - Best recall on real changes is 40.7% (Gemini 3.1 Pro), and hard-tier recall is below 23% for every model.
  - Claude Opus 4.7 scores 31.2% recall with 99.6% no-diff specificity; GPT-5.4 scores 30.5% and 99.6%.
  - Some open models invent differences on unchanged pairs: Kimi K2.5 87.2% specificity, Qwen3-VL-30B-Thinking about 77.8%.
  - — [DiffSpot arXiv 2605.29615](https://arxiv.org/abs/2605.29615); [benchmarklist DiffSpot table (self-reported scores)](https://benchmarklist.com/benchmarks/diffspot/)
- **VDiff-Bench** (1,756 four-way questions): for the 4 models with the largest gap between semantic and low-level performance, 48.1–80.9% of low-level questions get a "no difference" answer although each pair contains a real change. — [VDiff-Bench arXiv 2609.06245](https://arxiv.org/pdf/2609.06245)
- **MLLM-as-a-Judge** (ICML 2024): MLLMs align with humans on pairwise comparison but diverge on absolute scoring and batch ranking. GPT-4V's pairwise agreement is 0.636 with ties and 0.773 without. Its scoring similarity is 0.490 (Gemini 0.304). Weaker models show a "high-score" bias. — [MLLM-as-a-Judge arXiv 2402.04788](https://arxiv.org/pdf/2402.04788)
- **EditJudgeBias** (1 Oct 2026; image editing, not UI): 1,196 samples, 13 injected cues, 5 MLLM judges. Swapping candidate order reverses up to 60.9% of pairwise decisions. Fabricated majority opinions raise ratings, and edit-region cues reduce agreement with humans. The authors recommend measuring each judge against its own re-query noise floor. — [arXiv 2610.01670](https://arxiv.org/abs/2610.01670)
- **WebDev Arena** ranks models with a Bradley-Terry model over blind pairwise votes on interactive web apps. It had more than 80,000 votes as of its launch-period blog post. — [LMArena blog: WebDev Arena](https://news.lmarena.ai/webdev-arena)
- **Design2Code** scores with CLIP similarity on text-masked screenshots, plus element-level block-match, text, position and CIEDE2000 colour metrics on matched text blocks. [partially unverified: the human-correlation figures (r = 0.975 between simulated and human win rates) come from a third-party summary, and one review says human judgments diverge from the low-level metrics] — [Design2Code arXiv 2403.03163](https://arxiv.org/pdf/2403.03163); [alphaxiv Design2Code summary](https://alphaxiv.org/benchmarks/google-deepmind/design2code)
- **UICrit** (UIST 2024): 3,059 designer critiques and ratings over 983 mobile UIs. Few-shot plus visual prompting with the dataset gave a "55% gain" in LLM UI feedback; the exact metric is not stated in the abstract. — [UICrit arXiv 2407.08850](https://arxiv.org/abs/2407.08850)
- **Sketch2Code** (NAACL 2025): 731 sketches for 484 webpages. Even the strongest VLMs struggle to read sketches and to ask useful clarifying questions. — [Sketch2Code arXiv 2410.16232](https://arxiv.org/pdf/2410.16232)
- **ReLook** uses an MLLM critic that scores rendered screenshots during RL. Invalid renders get zero reward, and under "Forced Optimization" a revision is accepted only if it beats the previous one. The critic is removed at inference. The abstract gives no specific gains. — [ReLook arXiv 2510.11498](https://arxiv.org/abs/2510.11498)
- **Cost inputs (Anthropic docs, Oct 2026):**
  - Image tokens = ⌈width/28⌉ × ⌈height/28⌉.
  - "Claude 4.7 and later" models use a high-resolution tier (long edge 2,576 px, at most 4,784 visual tokens). Other models use the standard tier (1,568 px, 1,568 tokens).
  - The docs put a 1000×1000 image at about $5.18 per thousand on Opus 5.5.
  - Up to 100 or 600 images per request; above 20 images a stricter per-image dimension limit applies.
  - The docs advise putting images before text.
  - — [Claude docs: Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- **Prices:**

  | Model | Input / MTok | Output / MTok |
  |---|---|---|
  | Claude Haiku 5.5 (prompts ≤ 100k tokens) | $0.10 | $0.50 |
  | Claude Sonnet 5.5 | $2 | $10 |
  | Claude Opus 5.5 | $4 | $20 |

  The Batch API halves these. Cache hits on Opus 5.5 and Sonnet 5.5 cost 0.05× the base input price. — [Claude docs: Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### Inferences
- **Why the agreement figures conflict.** They measure different things:
  - DesignBench asks "was this specific edit done well?" against a known instruction (about 95%).
  - ArtifactsBench uses task-specific checklists and code plus multiple screenshots (about 91% with a frontier judge).
  - WebDevJudge asks for holistic preference between two often close implementations, with ties (about 70%).

  For Makeborne's edit verification, the DesignBench-style framing applies: narrow question, known instruction. A well-built judge plausibly lands at 5–10% error there, while holistic "is this design better?" judgments sit around 10–30% error. That is above the 10–20% cascade threshold the brief cites.
- **VLMs as regression detectors fail in the dangerous direction.** DiffSpot shows Claude and GPT-class models are conservative: specificity about 99.6% but recall about 30%. Asked "did anything else change?", they will usually say no when something did, which is a false accept. Regression detection must come from pixel and DOM diffs (sections 1–2). The VLM should get the diff evidence (a crop of the changed region plus a diff mask) and answer "is this change what was requested?", not discover changes itself.
- **Bias controls to build in:**
  - Run pairwise judgments in both orders (WebDevJudge: 10–17% inconsistency; EditJudgeBias: up to 60.9% reversals) and treat disagreement as uncertain, which means escalate.
  - Prefer binary checklist items over 1–10 scores (MLLM-as-a-Judge; WebDevJudge's 8-point pairwise advantage).
  - Always send code or a diff alongside images: image-only judging lost about 11 points in WebDevJudge and about 16 points in ArtifactsBench without the answer code.
  - Strip model-written explanations and commit messages from the judge input, which addresses verbosity and fabricated-opinion bias (EditJudgeBias).
- **Estimated cost per edit judgment** (arithmetic from Anthropic's published formula and prices; not measured):
  - Images: before and after at desktop 1280×800 (46×29 = 1,334 tokens each) and mobile 390×844 (14×31 = 434 tokens each) give about 3,536 visual tokens. Adding about 2,000 tokens of diff, checklist and instruction text gives about 5,500 input tokens, plus about 300 output tokens.
  - Haiku 5.5: about $0.00055 input + $0.00015 output ≈ $0.0007 per judgment (about $0.70 per 1,000); about $1.40 per 1,000 with order swapping.
  - Opus 5.5: about $0.022 + $0.006 ≈ $0.028 per judgment (about $28 per 1,000), before any extended-thinking tokens.
  - Cropping to the target region cuts image tokens several-fold.
  - Haiku 5.5's resolution tier is inferred to be high-resolution ("4.7 and later"), but 1280×800 is under both tiers' limits, so it makes no difference here.

### Gaps
- No benchmark found that measures Claude Haiku 5.5 or Opus 5.5 specifically as UI-edit judges. All agreement numbers above come from earlier judges (GPT-4o/4.1, Claude 3.7/4, Gemini 2.5).
- No paper found that measures VLM judging of "requested change done" with a pixel-diff overlay or crop given as evidence, against without it. DiffSpot covers only zero-shot discovery.
- ArtifactsBench and WebDevJudge report no cost per judgment.
- No primary source found for a verbosity-bias figure specific to UI or code judges.

## 4. Instruction-following verification: was the requested change made, and are earlier instructions still met?

### Takeaway
The strongest evidence favours two things. First, breaking the request into an explicit checklist of binary requirements. Second, re-verifying all earlier instructions every turn, because "forgetting" (overwriting earlier features) is common and FronTalk's AceCoder nearly removes it by re-checking every past instruction with a web agent. Agent-as-judge helps most for interactive or functional requirements. For static visual judgments it did not beat a plain judge in WebDevJudge.

### Cited Findings
- **FronTalk** (Wu et al.; arXiv 2601.04203, v3 Aug 2026): 100 multi-turn front-end dialogues built from real sites, each turn with a text instruction and an equivalent visual one (sketch, mockup, annotated screenshot). Evaluation uses a web agent that simulates the user and explores the site. All 20 models tested show significant forgetting, overwriting previously built features. AceCoder, which uses a web agent to critique the implementation of every past instruction, "reduces forgetting to nearly zero" and lifts performance from 56.0% to 65.3% (+9.3 points). — [FronTalk arXiv abs](https://arxiv.org/abs/2601.04203)
- Forgetting rates across FronTalk's models are reported as 4.3% to 44.6%, concentrated where successive turns modify the same component. [unverified: from a search-result summary of the PDF; the abstract does not state the range] — [FronTalk PDF](https://arxiv.org/pdf/2601.04203)
- **TICK** (NeurIPS 2024 workshop): LLM-generated, instruction-specific yes/no checklists raise exact agreement between LLM judges and humans from 46.4% to 52.2% compared with direct scoring. Human inter-annotator agreement rises from 0.194 to 0.256 when humans get the checklists. — [TICK arXiv 2410.03608](https://arxiv.org/pdf/2410.03608)
- **RocketEval** (ICLR 2025): recasting judging as grading an instance-specific checklist lets a lightweight judge (Gemma-2-2B) reach 0.965 correlation with human preferences on MT-Bench and WildBench, comparable to GPT-4o, at more than 50× lower cost. It relies on reweighting checklist items against supervised labels and is not purely zero-shot. — [RocketEval arXiv 2503.05142](https://export.arxiv.org/pdf/2503.05142)
- A 2025 follow-up questions when checklists actually help, so the gains may not hold everywhere. — [Are Checklists Really Useful… arXiv 2508.15218](https://arxiv.org/html/2508.15218v1)
- **ArtifactsBench** checklists: 10 items per task (5 visual, 5 code), LLM-drafted and human-refined, as described in section 3. — [ArtifactsBench](https://arxiv.org/html/2507.04952v2)
- **WebDevJudge** rubrics raise human agreement sharply (65.0% to 92.0%) but give LLM judges little gain in pairwise mode over direct prompting. — [WebDevJudge](https://arxiv.org/html/2510.18560v2)
- **WebCompass** (Apr 2026; text, image and video inputs; generation, editing and repair; 16 editing operation types): editing and repair are scored with a checklist-guided LLM-as-a-Judge. Generation uses Agent-as-a-Judge, which drives the site in a real browser over MCP and writes targeted tests iteratively. The abstract gives no human-agreement figures. — [WebCompass arXiv 2604.18224](https://arxiv.org/abs/2604.18224)
- **WebRISE** (Jun 2026; 442 tasks, 5,495 transitions, 5,271 requirement checks; 14 MLLMs) compiles requirements into Interaction Contract Graphs: observable states, user-intent transitions, and DOM or visual assertions, executed in a browser. Explicit and implicit requirements are separated.
  - ICG scoring finds state errors at 2–16× the rate of checkpoint-style evaluation, measured by defect injection.
  - Visual quality does not predict behaviour: one model scored V = 80.8 but transition validity T = 15.5.
  - The best model reaches 65.6% transition validity and 66.3% requirement coverage.
  - — [WebRISE arXiv 2606.03220](https://arxiv.org/abs/2606.03220)
- **WebGen-Bench**: 647 test cases (GPT-4o-drafted, human-refined), each an operation plus an expected result, run by a web-navigation agent. The best agent system (Bolt.diy with DeepSeek-R1) passes 27.8%; a fine-tuned Qwen2.5-Coder-32B reaches 38.2%. The abstract reports no agreement figure between the agent and manual testing. — [WebGen-Bench arXiv 2505.03733](https://arxiv.org/abs/2505.03733)
- **Agent-as-a-Judge** (Zhuge et al., ICML 2025; DevAI, 55 tasks, 365 hierarchical requirements): about 90% alignment with human consensus (92.07% gray-box, 90.44% black-box on OpenHands outputs), against 70.76% and 60.38% for LLM-as-a-Judge. Against three human experts it saves about 97.7% of time and 97.6% of cost (about 2 h and $31 against about 86 h and $1,297 at an assumed $15/h). It is much slower than an LLM judge (about 118 against about 11 minutes). — [Agent-as-a-Judge arXiv 2410.10934v2](https://arxiv.org/html/2410.10934v2); [ICML 2025 poster](https://icml.cc/virtual/2025/poster/45485); [Future AGI summary](https://futureagi.com/blog/agent-as-a-judge/)
- **WebDevJudge feasibility test**: code-reading LLM judges over-accept (high recall, low precision), while a GUI agent (UI-TARS-1.5) under-accepts (precision 82.4, recall 70.3). — [WebDevJudge](https://arxiv.org/html/2510.18560v2)

### Inferences
- **Checklist extraction is the bridge between the request and deterministic checks.** For each request, a cheap model (Haiku 5.5) splits the instruction into atomic, typed requirements. Each type has its own check:

  | Requirement type | Example | How it is checked |
  |---|---|---|
  | TEXT | "headline reads X" | Copy check plus DOM text assertion |
  | STYLE | "CTA button background is brand-500" | Computed-style assertion on the target ID |
  | LAYOUT | "cards in 3 columns at ≥1024 px, 1 column on mobile" | Box-geometry assertion per viewport |
  | PRESENCE / ABSENCE | "remove the pricing toggle" | ARIA-snapshot or DOM assertion |
  | INTERACTION | "menu opens on click" | Playwright action plus assertion |
  | SUBJECTIVE | "make it feel more premium" | VLM checklist item, run pairwise in both orders |

  Most edit requests break down mostly into deterministically checkable items, so the VLM handles only the subjective remainder.
- **Instruction ledger to prevent forgetting.** Store each accepted requirement's assertion (ARIA-snapshot template, DOM, style or box assertion, Playwright interaction) as a durable regression test and re-run the whole ledger after every edit. This is AceCoder's re-check-every-past-instruction idea with deterministic assertions in place of an agent, so it is cheaper and does not drift. FronTalk's +9.3 points and near-zero forgetting are the evidence for its value.
- **Checklist extraction is itself a model step that can fail.** The extracted list should be shown to the user, or at least logged, and the verifier should reject edits that touch areas no checklist item covers. That ties back to the scope check in section 1.
- **Agent-as-judge belongs to functional and interactive requirements and new builds.** WebDevJudge shows agentic judging does not help for static visual quality, while WebRISE, WebGen-Bench and FronTalk show executed interaction tests catch functional errors that screenshots miss.

### Gaps
- No benchmark found that reports the error rate of LLM checklist extraction (missing or invented requirements) for UI edit requests specifically.
- WebGen-Bench, WebCompass and FronTalk agreement figures between the agent judge and humans were not available in the abstracts fetched.

## 5. Accessibility and performance checks as regression gates

### Takeaway
axe-core is a good no-false-positive-by-design regression gate. Compare violation sets before and after and fail only on new violations, while remembering it covers only a bit over half of issues. Lighthouse performance scores are too noisy for per-edit gating without 5-run medians on dedicated hardware, so use deterministic proxies per edit.

### Cited Findings
- axe-core says it finds "on average 57% of WCAG issues automatically". Its manifesto targets zero false positives (bugs aside). Results it cannot decide are reported as "incomplete" for human review. Rules cover WCAG 2.0, 2.1 and 2.2 at A, AA and AAA, plus best practices. — [dequelabs/axe-core](https://github.com/dequelabs/axe-core)
- Deque's 57% figure comes from its own analysis of 2,000+ audits, 13,000+ pages and about 300,000 issues (March 2021). It measures issue volume, not WCAG criteria coverage, and has not been independently audited. — [Deque blog: 57% study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues)
- **Lighthouse variability:** "The median Lighthouse score of 5 runs is twice as stable as 1 run". The docs recommend median or percentile thresholds, at least 2 dedicated cores (4 recommended) and 2 GB RAM (4–8 GB recommended), no concurrent runs, and simulated throttling. Page nondeterminism is not mitigated by any throttling mode. — [Lighthouse docs: variability](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)
- **Lighthouse 10 performance weights:** FCP 10%, Speed Index 10%, LCP 25%, TBT 30%, CLS 25%. — [Chrome docs: performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)
- **CLS thresholds:** ≤ 0.1 good, > 0.25 poor; lab tools capture load-time shifts only. — [web.dev: CLS](https://web.dev/articles/cls)

### Inferences
- **Accessibility gate.** Run axe (for example through `@axe-core/playwright`, not verified here) on before and after at both viewports. Fail only on new violations, keyed by rule ID plus target selector or stable component ID, so existing debt does not block edits. Combined with the existing contrast check, this is cheap (milliseconds to seconds) and its false-positive rate is near zero by design. Do not treat a pass as proof of accessibility, since about 43% of issues are outside automated coverage by Deque's own count.
- **Performance gate.** Per-edit Lighthouse scores will flip on noise. Use deterministic proxies instead: JS and CSS bundle-size delta, new image bytes or missing `width`/`height`, new third-party requests, and load-time layout shift from the `layout-shift` observer. Run full Lighthouse (5-run median) only on new builds or before publishing.
- The ARIA snapshot (section 1) also works as an accessibility-structure regression check: a lost button name or changed heading level shows up there even when axe passes.

### Gaps
- No independent study found of axe-core's real-world false-positive rate. The "zero false positives" claim is a design goal stated by the vendor.
- `@axe-core/playwright` usage was not confirmed from a fetched page in this session.

## 6. Which combination gives the lowest verifier error at the lowest cost?

### Takeaway
A layered gate works best:
1. Deterministic build and scope checks first. They are near-free with near-zero judge error, and they catch localization failures and regressions.
2. Then deterministic per-requirement assertions from an extracted checklist, plus a re-run of the instruction ledger.
3. A cheap VLM checklist judge only for subjective items, run pairwise in both orders with code or diff evidence.
4. Escalate to Opus only on disagreement or failure.

Holistic VLM preference judging (about 70% agreement in WebDevJudge) should never be the sole gate for edits. For new builds and design reviews, VLM judges are advisory, and the binding checks are executed functional tests and accessibility.

### Cited Findings
- Deterministic and executed checks find errors that visual judging misses: ICG-based scoring detected state errors at 2–16× the rate of checkpoint-style evaluation, and visual quality did not predict behaviour. — [WebRISE](https://arxiv.org/abs/2606.03220)
- Narrow edit judging with a known instruction reaches 95.54% human agreement (GPT-4o, DesignBench edit). Holistic pairwise web preference tops out at 70.34% (WebDevJudge), against about 84.6% for humans. — [DesignBench](https://arxiv.org/html/2506.06251v3); [WebDevJudge](https://arxiv.org/html/2510.18560v2)
- Code plus multiple screenshots plus checklist is the best-performing judge input (ArtifactsBench, 90.95%). Removing code costs about 16 points, and image-only costs about 11 points in WebDevJudge. — [ArtifactsBench](https://arxiv.org/html/2507.04952v2); [WebDevJudge](https://arxiv.org/html/2510.18560v2)
- Cheap checklist judges can approach expensive judges (RocketEval: 2B model, 0.965 correlation, more than 50× cheaper; text tasks, with learned reweighting). — [RocketEval](https://export.arxiv.org/pdf/2503.05142)
- VLM discovery of unprompted UI differences is unreliable (best recall 40.7%), so VLMs cannot be the regression detector. — [DiffSpot](https://arxiv.org/abs/2605.29615)
- Re-checking all earlier instructions nearly removes forgetting (+9.3 points). — [FronTalk](https://arxiv.org/abs/2601.04203)
- "Accept only if it improves", with zero reward for invalid renders, is a working acceptance rule for MLLM-critic loops. — [ReLook](https://arxiv.org/abs/2510.11498)
- Order swapping can reverse many pairwise verdicts (up to 60.9% in image-edit judging; 10–17% inconsistency in WebDevJudge), so double-order judging is needed. — [EditJudgeBias](https://arxiv.org/abs/2610.01670); [WebDevJudge](https://arxiv.org/html/2510.18560v2)

### Inferences (proposed gate per edit class; design synthesis, not measured)

**Gate A: copy edits** (target: false accepts under 1%, cost about $0)
1. Compile, typecheck and render.
2. Existing copy check (new text present, old text gone, few lines changed).
3. AST scope: only `JSXText`, string literals or text attributes changed, inside the target component ID.
4. Rendered DOM text diff confined to the target subtree.
5. Pixel-diff clusters confined to the target box plus a reflow band, at both viewports.
6. axe: no new violations; contrast check passes.
7. Instruction ledger re-run.
8. Use a VLM only when the request is subjective ("punchier"). Then Haiku 5.5 grades one item, "does the new copy satisfy <request>?", with before and after text (no images needed). Escalate on "no" or low confidence.

**Gate B: targeted layout or style edits** (target: false accepts under 5%)
1. Everything in Gate A, but the AST scope allows style, `className` and token changes on the target and its descendants.
2. Computed-style and box diff keyed by stable ID:
   - the requested property moved in the requested direction on the target;
   - no other element's computed style changed;
   - box changes appear only on the target, its descendants and reflowed siblings.
3. ARIA snapshot unchanged outside the target (or changed only as requested).
4. Responsive check: re-assert at both desktop and mobile widths, since many layout edits break at the other breakpoint.
5. VLM checklist judge (Haiku 5.5):
   - Input: before and after crops of the target region at both viewports, the pixel-diff mask, the code diff and the extracted checklist.
   - Output: a binary verdict per subjective item.
   - Run both orders.
   - Cost: about $0.001–0.002 per edit.
6. Escalate to Opus full effort (as fixer or as second judge) if any deterministic check fails, the two orders disagree, or the judge says no.

**Gate C: new builds and design reviews** (no baseline; target: catch functional breakage, and use judges only as advisory input)
1. Compile, render and console-error check.
2. axe on all pages; 5-run Lighthouse median before publish only.
3. Interaction tests generated from the request as an ICG or test-case list (WebRISE, WebGen-Bench style) and executed by Playwright or a browser agent. Cache the generated tests into the instruction ledger.
4. ArtifactsBench-style checklist judge: code plus 3 screenshots (load, mid-interaction, after) plus a 10-item checklist, with a frontier judge (Opus 5.5) for design reviews. Expect about 10–30% disagreement with humans on holistic quality. Use it to rank or flag, not as a hard gate.
5. For pairwise "is v2 better than v1?" design reviews, run both orders and count ties or disagreements as "no improvement" (a ReLook-style forced-improvement rule).

**Measuring verifier error before trusting it** (needed because published numbers come from different judges and tasks)
- Build a Makeborne verifier test set by defect injection, as DiffSpot, WebRISE and EditJudgeBias do:
  - take real accepted edits;
  - create counterfactuals (wrong element changed, extra property changed, change missing, mobile breakpoint broken, earlier instruction overwritten);
  - include correct edits implemented in alternative ways, to measure false rejects of functionally equivalent solutions, a failure mode WebDevJudge names.
- Report false-accept and false-reject rates per gate and per edit class.
- With about 300 labeled cases per class, a 5% error rate has a 95% confidence interval of roughly ±2.5 points (binomial approximation), which is tight enough to judge whether a gate is under the 10–20% cascade-collapse threshold.

### Gaps
- No published end-to-end study measures a layered deterministic-plus-VLM gate for AI UI edits, or its combined false-accept rate. The proposed gates are a synthesis of component evidence.
- No data found on Haiku 5.5's or Opus 5.5's accuracy as UI-edit verifiers. Makeborne must measure this on its own labeled set.
- The share of real user edit requests that break down into deterministically checkable requirements is unknown. It would come from Makeborne's own logs (for example the routing eval cases in `scripts/eval/routing/`).
