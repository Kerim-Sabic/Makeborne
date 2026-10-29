# Independent review: live qualification and blind comparison plan, 23 October 2026

Status: **not run**. No budget is approved for this work; everything below is a plan with estimates. The code paths are verified offline only (`src/lib/review/check-review.cjs`, `src/lib/review/check-review-render.cjs`).

## What is qualified so far (offline, no paid calls)

- Deterministic checks on real renders and real exports: website fixtures at 1440×900 and 390×844 in offline Chromium; book PDFs from `documentPdf`, read as files (page count, MediaBox, outline coverage, glyphs per page); decks from `deckPptx`, read as packages (native `c:chart` parts with embedded workbooks, notes slides).
- Contract handling with a fake reviewer that returns recorded findings: grounding, unverified downgrades, refusal, truncation, malformed and missing answers, stale results, bounded repair, the diff guard and the stage 1 operation path (in-memory RPCs).
- **Not qualified:** whether the live reviewer finds real visual and content defects, how often it is wrong, what it costs per review, and whether it keeps to the no-redesign rule. `AGENCY_SETTINGS` qualifies no kind, so `independent_review` is refused (the API returns a deterministic-only result with `review_unavailable / reviewer_not_qualified`).

## 1. Default reviewer (Claude, fresh context)

Fixtures, built in a harness the same way as the offline checks (no customer data):

| Kind | Acceptable | Seeded defects |
|---|---|---|
| Website | 2 | 2 (broken image + clipped badge; unsupported price + covered text + phone overflow) |
| Book | 2 | 2 (missing chapter; unsupported price + runt last page) |
| Deck | 2 | 2 (chart exported without its part + notes stripped; unsupported figure + low-contrast title) |

Runs: one full review per fixture (12), plus one targeted re-check after a scripted correct repair on each seeded fixture (6). Recorded: request digest, the raw answer, grounded and unverified findings, stop reason, measured usage.

Pass criteria (all needed before `qualifiedKinds` may include `independent_review`):
- every seeded visual or content defect that the deterministic checks cannot see is reported, grounded, at the right location (≥ 5 of 6 seeded fixtures);
- acceptable fixtures: no grounded blocker or major finding, no redesign above minor;
- the server downgrades every finding whose evidence or citation does not resolve (spot check of all unverified findings);
- every targeted re-check reports the repaired finding as gone and adds no repair-triggering finding;
- measured cost per review within the bound below; no refusals on the fixtures.

Cost estimate (Opus 5.5 price card in `src/lib/ai/prices.ts`: $4 / $20 per million input / output tokens, ×1.1 US inference): about 15,000 input tokens (text ~8k, images ~3.5–5.5k, system and tool schema ~2k) and 2–3k output tokens per review, so **≈ $0.13 expected, ≤ $0.24 per turn at the 8,000-token output bound** (≤ about $1 at the 4-turn ceiling). Plan total: 12 reviews + 6 re-checks ≈ **$2.5 expected, cap $5**.

## 2. Optional cross-provider reviewer (off by default)

`MAKEBORNE_CROSS_PROVIDER_REVIEW=off`; `REVIEWER_REGISTRY` marks it unqualified, and `resolveCrossProviderReviewer` refuses it even with the flag on. No provider call is implemented. Before anything is built, the OpenAI text model needs a price-card entry (today unpriced models fail closed).

Blind comparison:
- n = 20 request pairs: 10 seeded-defect and 10 acceptable fixtures, balanced across websites, books and decks; each request is identical for both reviewers (same digest).
- Both answers go through the same server-side validation. Findings are stripped of reviewer identity, merged, shuffled and graded by an operator against the seeded-defect answer key: true detection, false positive, unverified rate, redesign proposals.
- Qualify only if the second reviewer finds at least 2 seeded defects the default reviewer missed across the 20 pairs, with no more grounded false positives on acceptable fixtures, at least 90 % of its findings grounded after validation, and a cost per review that a customer price covers. Otherwise it stays off.
- Even when qualified, it is a second opinion: its findings are grounded like the default reviewer's and never replace them.

Cost estimate: Claude side 20 × $0.13 ≈ $2.6 (cap $5); the other provider about $0.10–0.20 per review once priced (≈ $2–4). **Total ≈ $5–9, cap $12.** Plus about one hour of operator grading.

## Not covered by either plan

Interactive behaviour (menus, focus, motion, form sending), rasters of PDF pages (no rasteriser in the runtime; the review sees print-layout slices and measures pages on the PDF itself), PowerPoint's own rendering of the PPTX, and project images on websites (the server capture does not fetch them yet, so they are reported as not checked).
