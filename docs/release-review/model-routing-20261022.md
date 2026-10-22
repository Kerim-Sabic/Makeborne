# Model routing qualification, 22 October 2026

Owner approval: "Kerim, chat 2026-10-22: ~$20 Claude for model-routing qualification (scope model-routing-20261022)". No OpenAI spend. Local only: no production, staging, migrations or cloud resources.

## Result

**No class qualifies to route down.** `QUALIFIED_ROUTES` stays empty and `MAKEBORNE_MODEL_ROUTING` stays off (today's behaviour: Claude Opus 5.5 for every builder stage). The routed model was Claude Sonnet 5.5 for every class tested.

| Class | Samples (planned) | Gates and measured metrics | Blind pairwise judge (Opus 5.5 judge, both orders must agree) | Cost, time | Verdict |
|---|---|---|---|---|---|
| targeted edit | 6 (6) | All 12 runs finished and compiled; measure.mjs pass/fail identical item by item (117/132 checks each; both fixed the same two overflow issues) | Opus 2 wins (e04, e06: visual craft, mobile), 4 ties, Sonnet 0 | $1.357 vs $0.633 uncached (−53%); 48 vs 24 credits; 22 s vs 14 s mean | Not qualified: loses on the judge |
| new site | 3 (3) | All finished in one stage, compiled; Sonnet passed 60/66 checks vs Opus 57/66 (mostly Lighthouse perf on lighter pages); Sonnet sources 18–31% smaller | Opus 1 win (w07, brief fit and craft), Sonnet 1 win (w09), 1 split (w02) | $2.898 vs $1.416 (−51%), review stage on Opus in both | Not qualified: no clear "no loss" at n=3, and the comparison is confounded (below) |
| new document (deck, book) | 2 (2) | Both finished; measure identical (deck passes; both books fail K1/K2 on platform export issues) | Opus 2 wins of 2 (content substance) | $0.624 vs $0.234 (−62%); the Sonnet book had 2,793 words vs 4,853 | Not qualified |

Classes not tested (stay on Opus): redesign, edit, continuation, review, plan, document edit.

## Method

- Targeted edits (`scripts/eval/route-qualify.mjs`, cases `scripts/eval/routing/edit-cases.json`): six websites saved on the isolated release-auth stack by the 21 October app-route run (`outputs/eval/runs/live-20261021T202136Z`, read only), one short edit each (two with visual-editor element references). Both arms run the app's runBuilder with the build route's context layout through `routedWebsiteStage`, Medium effort, 50-credit operation cap; routed arm with `MAKEBORNE_ROUTE_TARGETED_EDIT=claude-sonnet-5-5` (budget share, time share and escalation as in production). No escalation was triggered. Outputs `outputs/eval/runs/mr-edit-20261022-before|-opus|-routed`, measured with 3 Lighthouse runs, judged with the unchanged site shown as "Before".
- New-site builds: `direct-run.mjs --variant enhanced --route new-site=claude-sonnet-5-5,continuation=claude-sonnet-5-5` on w02, w07, w09 (`outputs/eval/runs/mr-build-20261022-routed`), compared with the existing Opus results `outputs/eval/measure/dq-r21-app` (not rebuilt). The three briefs were chosen because the Opus run generated no images for them. Confounds: the Opus set ran through the app routes with images available (the model chose none), the Sonnet set through the direct harness with images unavailable (the app-route runner refuses to start while two unrelated billing migrations are missing on the isolated stack, and no OpenAI spend was approved); the design review ran on Opus in both.
- Documents (`scripts/eval/route-qualify-docs.mjs`): d01 (deck) and b01 (book), first document stage, both arms, exports rendered offline; judged with `scripts/eval/claude-judge-docs.mjs` (all slides; book cover, opener, body and last page plus full text).
- Judges: `scripts/eval/claude-judge.mjs` (judge-rubric.md v1 verbatim; an edit addendum with `--before`) and `claude-judge-docs.mjs`, Claude Opus 5.5 at medium effort, every pair judged in both orders. Rounds: `outputs/eval/review/claude-judge-mr-edit-20261022`, `-mr-build-20261022`, `-mr-docs-20261022`. Two edits (e03, e05) change things below the screenshot crop or only on behaviour, so their ties carry little information.

## Finding fixed during qualification

Edit e04, routed attempt: Sonnet sent two `edit_file` calls with absolute paths and `finish` in the same step; both edits were rejected, `finish` passed on the unchanged project and the summary claimed the change. The website builder now refuses a finish sent with a failed tool call in the same step (the document builder already did). e04 was re-run on the routed arm after the fix (it then made the change); the first attempt is kept in `outputs/eval/runs/mr-edit-20261022-superseded`. Its uncached cost ($0.085) is used in the cost row above; the re-run cost $0.011 because of a warm prompt cache.

## Spend

Scope model-routing-20261022 (first round): $6.071917 settled (45 reservations): edits $2.000916, documents $0.858249, new-site builds $1.415916 + enhancer $0.005544, judges $1.791292. Policy v2 round: $8.364804 more (32 reservations): first-step builds low $3.115071 + enhancer $0.005805, capped $2.538130 + enhancer $0.005209; on-mode and shadow edits $1.715317; judge $0.985272. Total **$14.436721 of $20, 77 reservations, 0 open, 0 unknown**. Ledger-wide cap $294.31 → $314.31 (this allowance's record); ledger-wide committed $266.344449 → $280.99696; the design cap and the other scope are untouched.

## Policy v2 (routing-policy-v2-20261022) runs

After the owner's mandate the same harnesses ran against policy v2 (versioned decisions, task-contract inputs, shadow mode, durable repair/escalation state machine).

- **On-mode edits** (`mr-edit-v2-20261022-routed`, 6 cases, routes for targeted edit and edit set to Sonnet): the signals kept 5 of 6 on Opus (functional complexity: reservation, form, pricing; design demand; business risk: price) and routed only e04. All 6 finished and compiled; measure.mjs 118/132 vs 117/132 for the off arm. Judge against the off arm: e04 (Sonnet) lost again (both orders), e06 (Opus vs Opus) also "lost" with both orders agreeing, 4 ties. An Opus-vs-Opus pair losing consistently shows the judge's own noise floor at about 1 pair in 5; e04 losing in two independent Sonnet runs is a consistent result. Cost $1.302 for the arm.
- **Shadow** (`mr-edit-v2-20261022-shadow`, e01 and e04): Opus executed exactly as off; the durable record carries the on-decision (`shadow: {model: claude-sonnet-5-5, escalation: claude-opus-5-5, firstStep: first-step-low-v1}`) and no extra call was made. Cost $0.413.
- **First-step rule** (`mr-first-step-20261022-low|capped`, w02, w07, w09, Opus, routing on, identical inputs): `first-step-low-v1` (today: effort low on the steps while the project is empty) finished all 3 first builds in one stage ($1.171, $0.969, $0.975; 210-279 s). `first-step-capped-v1` (medium intensity, first step capped at 24,000 output tokens) left **no recoverable project in 2 of 3** (w02: one call used its whole cap without writing a file and the loop stopped; w09: five calls, no index.html or src/main.tsx) and needed a continuation on the third ($1.405 vs $0.969). The 30b147f invariant holds only with the low rule. **Recommendation: keep first-step-low-v1** (now a named, versioned policy rule); no design judge was run because the capped arm failed the hard invariant on 2 of 3 briefs.

## What staging must qualify before routing is enabled

Routing is off by default and no class has a qualified default. Before any `MAKEBORNE_ROUTE_*` is set on staging: run the targeted-edit class on more cases whose change is visible on the first screen (at least 12, through the app routes on staging with images as configured), require zero judge losses with consistent orders, check escalation rate and the receipt (Model row, charge equal to the escalation alone) on real operations, and confirm `ai_model_route` log lines and the durable `route` detail on staging operations. Start with `MAKEBORNE_MODEL_ROUTING=shadow` (no behaviour change, no extra call) and compare the recorded decisions with real outcomes first. Open items outside this branch: one active writer per artifact is not enforced by routing (it adds no writer: attempts run sequentially inside one run and fence, but two operations on one artifact can still race; needs an RPC or constraint); the deferred acceptance checks (W-H2, W-H3, W-H7, W-H8, W-D3, O1-O5) need the site verifier, whose not_checked-means-verified defect (Codex, 22 October) must be fixed before its results feed routing; text-model selection does not use per-process health state.
