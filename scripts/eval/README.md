# Makeborne eval harness (launch quality, Phase 1)

Measures what Makeborne actually generates (websites, decks, books) and the studio that generates it, against the thresholds in `docs/execution/QUALITY_BAR.md` (ignored operator folder; the thresholds are mirrored as data in `lib/thresholds.mjs`). Results go to `outputs/eval/` (ignored by its own `.gitignore`).

This folder is its own npm package so its tooling (Lighthouse, html-validate, axe-core, pdf-lib, pdfjs-dist, web-vitals, @playwright/test) never enters the app's dependency tree or the Vercel build:

```bash
npm --prefix scripts/eval ci
```

## Safety rules (enforced in code)

- **Isolated stack only.** `lib/stack.mjs` refuses anything but the release-auth stack (API 127.0.0.1:55435, DB 127.0.0.1:55438). Fixture export may *read* other local stacks (55322, 55468) inside `begin read only … rollback`; it never writes to them.
- **$25 hard cap** for all paid provider calls of Phase 1 (runner and judge together) in `lib/budget.mjs`. Every call reserves its worst-case bound first; an unsettled reservation counts at its full bound. `EVAL_CAP_USD` can lower the cap, never raise it.
- **No paid call without an explicit live flag and a recorded approval.** Default modes are dry runs.
- **Never production or staging.** No Vercel, Cloudflare or cloud Supabase calls.
- **Lint-safe outputs.** ESLint lints the whole repo except its ignore list, which does not include `outputs/`. So nothing under `outputs/eval/` may have a `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.mts` or `.cts` extension: website sources are stored as `source.json`, bundles as `site.js.bundle` (served at `/site.js`).

## Layout

```
scripts/eval/
  README.md            this file (operator guide + contract)
  package.json         eval-only dependencies (own lockfile, .npmrc legacy-peer-deps)
  briefs/              24 frozen briefs (index.json + one JSON per brief)
  lib/                 shared modules (paths, stack guard, budget, stats, serve, thresholds, app-modules loader, instruments)
  run.mjs              budgeted generation runner (dry-run by default; --fixtures exports fixture projects)
  measure.mjs          instruments over a run/capture set
  resummarise.mjs      rebuilds a measured set's summary from its stored metrics
  accent-headline.mjs  counts the one-emphasised-phrase headline device across measured sets
  judge.mjs            blind pairwise judge (OpenAI, position-swapped) + human sheet
  judge-rubric.md      fixed rubric
  htmlvalidate.json    html-validate configuration
  competitors/         README with the 8 shared briefs, capture.mjs, captures/ (ignored)
  e2e/                 Playwright studio tests (funnel, axe + web-vitals, contrast)

outputs/eval/
  budget/ledger.json
  runs/<runId>/        runId = live-<stamp> | dry-<stamp> | fixtures-<stamp>
    run.json           {runId, mode, startedAt, finishedAt, effort, stack, briefsSha256, items:[{id,kind,status,costUsd}], budget}
    <itemId>/
      item.json        {id, kind: website|presentation|book, title, direction, briefId, brief, origin:{type: live|fixture, stack, artifactId, version, path}}
      brief.json       frozen brief copy (live runs)
      requests.json    request bodies per stage (no secrets, no screenshots)
      events/<n>-<stage>.sse   raw SSE per POST (plan, build, continuation-N, review-N)
      events.jsonl     parsed events {stage, ...event}; file contents truncated to 2 KB
      terminal.json    last done/error per stage
      cost.json        {boundUsd, reservationId, actualUsd, calls:[ledger rows], credits}
      version.json     saved artifact_versions row metadata (no content)
      source.json      WebsiteProjectSource (websites)
      document.json    deck/book document (decks, books)
      exports/document.pdf, exports/document.pptx
      status.json      {ok, stage, code, message}
  measure/<setId>/
    summary.json, summary.md, diversity.json
    <itemId>/
      metrics.json     every instrument result; instrument errors are recorded, never skipped silently
      build/index.html, build/site.css, build/site.js.bundle
      snapshot/index.html     static snapshot (scripts removed, js class removed, sanitised like hosting)
      published/index.html    snapshot + the module script: what a visitor loads first
      shots/<w>-first.png, shots/<w>-full.png (w in 360, 390, 820, 1440); shots/unstyled-1440-first.png (judge control)
      lighthouse.json, axe-<w>.json, htmlvalidate.json
  judge/<roundId>/     requests/, verdicts.jsonl, summary.json, summary.md, sheet.html, sheet-key.json
```

Competitor captures live in `scripts/eval/competitors/captures/<tool>/<briefId>/` (ignored): `meta.json`, `page.har` (embedded content, replayed offline by measure), `dom.html` (DOM after render), `shots/`.

## Commands

All commands run from the repo root. npm aliases: `eval:install`, `eval:fixtures`, `eval:run`, `eval:measure`, `eval:judge`, `e2e`, `e2e:launch-gate`.

| Command | What it does | Paid calls |
|---|---|---|
| `node scripts/eval/run.mjs --fixtures [--include-redesign]` | Exports the existing generated projects from the local stacks (read-only) into `outputs/eval/runs/fixtures-<stamp>/`; `node scripts/eval/lib/fixtures.mjs --only-redesign` exports only the redesign set | none |
| `node scripts/eval/run.mjs` | Dry run: preflight (stack, migrations, builder availability, provider limits, key presence), brief manifest hashes, budget plan, offline review-capture self-test; writes `runs/dry-<stamp>/run.json` with a "needed to run for real" list | none |
| `EVAL_SPEND_APPROVED=yes node scripts/eval/run.mjs --live --approval "<who/when>" [--only <briefId>] [--max <n>] [--images] [--rerun] [--plan]` | Generates the golden set at Medium effort in frozen priority order through the app's own routes in the studio's default Create mode (build → ≤ 2 continuations → review, like the studio); `--plan` puts the planner first and builds from the plan as proposed (Plan mode is measured as its own finding, not the golden path). Stores source, snapshot, SSE and cost per brief, stops at the cap | yes, ≤ $25 |
| `node scripts/eval/measure.mjs <runDir or captureDir> --lighthouse-runs 3 [--only <id,…>] [--out <dir>]` | All instruments on a run or a competitor capture set → `outputs/eval/measure/<setId>/`. The default is 1 Lighthouse run (exploratory); a gate decision needs 3. The published page loads fonts as separate `/assets/*.woff2` files like the trusted build (QUALITY_BAR v1.3); `EVAL_FONT_DELIVERY=bundle` measures the base64-in-CSS model the studio preview and review links still use. Competitor sets: W1/W2 n/a, Lighthouse only with `--lighthouse-live` | none |
| `node scripts/eval/resummarise.mjs outputs/eval/measure/<setId>` | Rebuilds `summary.*` and `diversity.json` from the stored `metrics.json` after a change to summary or diversity code, or after re-measured items (`measure.mjs --only … --out <recheck>`) were copied in (instruments are not re-run; the rebuild is recorded in the provenance) | none |
| `node scripts/eval/accent-headline.mjs outputs/eval/measure/<setA> [<setB> …]` | Per site and per set: does the h1 carry one emphasised phrase (a clearly different colour, its own background or gradient highlight, or italic in a roman headline)? The device W15 only catches in its cream-serif-italic form | none |
| `node scripts/eval/lib/budget.mjs --summary` / `--rebuild [--write]` | Prints the ledger totals (committed, open, remaining) / reconstructs a missing ledger from live runs' `cost.json` and live judge rows (dry unless `--write`; never overwrites an existing ledger) | none |
| `node scripts/eval/judge.mjs --a <setA> --b <setB> --sanity [--round <name>]` (`--sanity` is required for a round that gates J1/J2; without it the round is reported "not valid") | Blind pairwise judge; dry run (requests + cost estimate) unless `--live --approval` and `OPENAI_API_KEY`, `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_USD_PER_MTOK_IN/OUT` are set. Pairs by briefId, then relatedBriefId, or `--pairs` | live only, inside the cap |
| `node scripts/eval/judge.mjs --sheet --a <setA> --b <setB> [--n 10]` / `--score-sheet <answers.json…> --key <sheet-key.json>` | Self-contained ten-pair HTML sheet for human designers; the left/right key stays in `sheet-key.json` | none |
| `node scripts/eval/competitors/capture.mjs --urls scripts/eval/competitors/urls.json [--dry-run]` | Captures competitor results (HAR, DOM, screenshots) for measure and judge; see `competitors/README.md` | none |
| `npm run e2e` / `npm run e2e:launch-gate` | Studio Playwright suite on the isolated stack (default gate: no regression vs `e2e/baseline.json`; launch gate: the QUALITY_BAR values) | none |

## Self-tests (all free, no network)

`node scripts/eval/lib/budget.mjs --selftest` (ledger tamper, concurrency, paid-work evidence; uses `EVAL_BUDGET_TEST_ROOT` temp roots, never the real ledger) · `node scripts/eval/run.mjs --selftest-live` (live path with fake SQL, server and signals) · `node scripts/eval/judge.mjs --selftest` (fake client: swapping, statistics, settlement rule, pairing, sheet) · `node scripts/eval/lib/website.mjs --selftest` · `node scripts/eval/lib/instruments/web.mjs --selftest [--skip-lighthouse]` · `node scripts/eval/lib/instruments/deck.mjs --selftest` · `node scripts/eval/lib/instruments/book.mjs --selftest` (negative controls must fail, a positive control must pass K1) · `node scripts/eval/lib/diversity.mjs --selftest` · `node scripts/eval/e2e/selftest.mjs`.

## Spend safety, in one place

- Every paid call reserves its worst-case bound in `outputs/eval/budget/ledger.json` first (website $1.50 = the 50-credit operation cap at $0.03 in Create mode, $1.80 with `--plan` for the 10-credit plan; deck/book $1.50; judge calls from token bounds × configured prices × 1.5). Unsettled or unknown entries count at their full bound. The ledger is validated on every read; an invalid ledger refuses everything, and a missing ledger is refused when any evidence of earlier paid work exists (`runs/live-*`, `runs/*/approval.json`, a live `run.json`, `judge/**/live-started.json`, live rows in `verdicts.jsonl`, a live judge `summary.json`).
- The runner and the judge create the ledger before their first run or round folder, so their own folder never counts as evidence against a missing ledger.
- The live runner refuses unless the dry-run preflight is green, `EVAL_SPEND_APPROVED=yes` and `--approval` are given, port 3211 is free, and its own freshly started `next dev` proves it compiled the isolated Supabase URL. It enables the database provider limits only for one brief at a time (today's spend + that brief's bound), disables and reads them back after every brief and in every exit path (signals, crashes, a detached watchdog), settles a brief only after the server-side operation is quiet, never PATCHes operations, never retries a stage, refuses a brief that already has a ledger entry unless `--rerun`, and scans the run folder for secrets as its very last step.
- The judge uses `maxRetries: 0`; failures after a request was sent settle at the full bound unless the provider's response proves nothing was billed; a fatal error halts every worker; a live round writes `live-started.json` before its first reservation; round names are one plain folder name.
- Deliberate hand edits of a well-formed ledger are out of scope: the cap protects against mistakes and bugs, not against an operator rewriting the file.

## Status and what a further run needs

The golden set was generated live on 18 October 2026 (Kerim's approval; 24 of 24 briefs, $19.26 of the $25 cap) after the 25 missing migrations were applied to the isolated release-auth stack, and measured with `--lighthouse-runs 3` (`outputs/eval/runs/golden-20261018`, `outputs/eval/measure/golden-20261018`; results in `docs/execution/BASELINE_2026-10.md`). $5.74 of the Phase 1 cap remains for the runner and the judge together.

1. A new round: Kerim's go, then `EVAL_SPEND_APPROVED=yes node scripts/eval/run.mjs --live --approval "Kerim, <date>"` (`--rerun` to regenerate briefs that already have a ledger entry).
2. Optional: `OPENAI_API_KEY` + `MAKEBORNE_IMAGE_MODEL` in `.env.local` and `--images` for photography.
3. Competitor captures (`competitors/README.md`) and, for the judge, an OpenAI vision model id and its prices.
