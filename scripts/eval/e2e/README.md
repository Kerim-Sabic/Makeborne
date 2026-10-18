# Studio e2e suite (QUALITY_BAR S1–S5)

Playwright tests of the studio itself, on the isolated release-auth stack, with every provider key blank. No paid call can happen: the dev server starts with `ANTHROPIC_API_KEY=''`, `OPENAI_API_KEY=''` and `MAKEBORNE_LIVE_BUILDER_ENABLED=false`, and the funnel fails if any page POSTs to `/api/build`, `/api/generate` or `/api/chat`.

```bash
# from the repo root
node scripts/eval/node_modules/@playwright/test/cli.js test -c scripts/eval/e2e/playwright.config.mjs
E2E_GATE=launch node scripts/eval/node_modules/@playwright/test/cli.js test -c scripts/eval/e2e/playwright.config.mjs   # POSIX shells; on Windows: npm run e2e:launch-gate (= node scripts/eval/e2e/run-gate.mjs launch)
E2E_WRITE_BASELINE=1 node scripts/eval/node_modules/@playwright/test/cli.js test -c scripts/eval/e2e/playwright.config.mjs
```

Add a file name filter (`funnel`, `studio-quality`, `contrast`) to run one spec.

## Server

`server.mjs` runs `next dev --hostname 127.0.0.1 --port 3210` (port reserved for this suite) the way the UX audit did: every inherited key matching `ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_|CLOUDFLARE_` is set to `''`, and so is every key named in the files `next dev` loads (`.env`, `.env.local`, `.env.development`, `.env.development.local`; names found with dotenv's own line pattern, the same two patterns as `run.mjs parseEnvText`, so `KEY=value`, `export KEY=value`, `KEY: value`, names starting with a digit, dot or dash and multi-line quoted values are all handled as Next handles them), whatever its prefix (an empty string, not a deleted key, is what stops `@next/env` from filling a key back in from those files; OS keys such as `PATH` are never touched). Then it sets only what it needs: Supabase URL and keys from `lib/stack.mjs isolatedStack()` (anything but 127.0.0.1:55435/55438 is refused), `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3210`, `MAKEBORNE_LIVE_BUILDER_ENABLED=false` and the cloud flags. The log line counts the blanked file keys; it never prints a value. Playwright starts it as its `webServer` and kills it at the end; the script also kills the whole process tree (`taskkill /T /F` on Windows) on exit. Always use host `127.0.0.1`: the session cookies follow the host.

Playwright reuses a server that already answers on 3210 (`reuseExistingServer`, so `node scripts/eval/e2e/server.mjs` can be kept running between runs). A stray `next dev` started from a plain shell would read `.env.local` (cloud Supabase, provider key), so `global-setup.mjs` checks the server's identity (`identity.mjs`) before any test and refuses the run with the reasons and how to free the port unless: `GET /login` answers 2xx and names no `supabase.co`/`supabase.in` host; its scripts carry the compile-time Supabase URL `http://127.0.0.1:55435` and no cloud project URL (`https://<20-char ref>.supabase.co|in`; the SDK's own docs mention `xyzcompany.supabase.co`, which is not a project); `GET /api/build` answers `{"available":false}` (builder off; `/api/build/plan` and `/api/build/questions` use the same switch); `GET /api/capabilities` shows no Anthropic key (`aiGeneration.configured` false while `cloudWorkspace.configured` and `publicPublishing.configured` are true: by `src/lib/capabilities/snapshot.ts` that combination only arises when `ANTHROPIC_API_KEY` is blank); and every route behind `chatEnabled()` (`/api/chat`, the CRM `follow-up-draft`, `leads/find`) answers `503 CHAT_UNAVAILABLE`/`FINDER_UNAVAILABLE`. Those routes are POST-only, so they are probed with a POST that cannot start anything: no cookie, no Authorization, no Origin, an empty `text/plain` body (the gate runs before the body is read; with chat on the route answers `415` before the session, the database or a provider is reached), and only once the server has passed every GET check. A server with the builder off but a provider key present is refused by the last two checks.

`node scripts/eval/e2e/selftest.mjs` checks the harness itself without the app or a database: the identity check against fake servers on ephemeral ports (the suite's own, one with builder off but chat on, one with a whitespace key, one on cloud Supabase that must get no POST at all), the stale-ledger rules with injected PIDs and start times, and the env-file key parser against `run.mjs parseEnvText`. `node scripts/eval/e2e/selftest.mjs --serve chat-on` keeps the builder-off-chat-on fake on 3210 so the refusal can be watched end to end (run the suite, expect `Refusing to run…`, then stop the fake).

## Specs

| File | Metric | What it does |
|---|---|---|
| `funnel.spec.mjs` | S1 | One serial flow: sign in (fixture account from `quality-fixture.json`, password never logged) → brief (Website, Create) → plan (Plan mode, edit "Sections to include", Confirm plan & create) → build (asserts `GET /api/build` is `{available:false}` and that an instruction is saved "in this tab · not applied"; annotated) → preview (Saffron Table fixture, `h1` inside the preview iframe) → review link (Client review tab, Create review link, open it in a new signed-out context, post a comment, request changes, turn the link off from the panel and check the client page refuses) → publish (trusted publishing off: message shown and "Prepare saved website" disabled; annotated). |
| `studio-quality.spec.mjs` | S2, S4, S5 | `/` (signed out), `/studio` and the Saffron Table editor (signed in) at 375×812 and 1440×900: axe-core 4.14 (`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`; preview iframe and the Next dev-tools portal excluded), web-vitals 6 CLS/LCP/FCP/TTFB after load and a wheel scroll to the bottom, horizontal overflow; editor toolbar at 800×900 (`nav[aria-label="Project view"]` and `.workbench-toolbar`, `scrollWidth ≤ clientWidth`). Routes are warmed first, because `next dev` compiles on first request. |
| `contrast.spec.mjs` | S3 | The UX audit's in-page script, verbatim (`audit-contrast.mjs`, exported as `AUDIT_SCRIPT`), on the `/studio` first screen and the editor at 375 and 1440; gates `lowContrastCount`. |

## Gates

Each metric carries its QUALITY_BAR threshold and a regression rule against `baseline.json` (values per page and width, written from the first real measurement).

- **`E2E_GATE=baseline` (default)** fails only on regression: a value that misses the bar *and* is worse than its baseline. Counts (axe critical/serious rules, low-contrast elements, overflow px) may not grow; CLS may not grow by more than 0.02; LCP (dev server, noisy) may not exceed 1.5 × baseline + 500 ms; a clipped toolbar is a regression only if the baseline was not clipped. Every gap to the bar is still reported as a `gap` annotation and in the summaries. In the funnel, a sub-step may fail only if it is listed in `baseline.json` `entries.funnel.knownBlocked` **and** its failure is the stack's known schema gap, confirmed by a read-only query (`begin read only … rollback`) of the isolated database.
- **`E2E_GATE=launch`** asserts the bar for every launch-tier (L) metric: 0 axe critical and serious, 0 low-contrast elements, CLS < 0.1, 0 overflow, toolbar not clipped, and every funnel step working. LCP is tier F in QUALITY_BAR S4 (follows launch), so it is reported as a gap, not failed.
- **`E2E_WRITE_BASELINE=1`** records the measured values into `baseline.json` instead of judging them against it. Only re-baseline deliberately, after a fix, and commit the new file with the fix.

## Output

`next dev` watches the repo, and any write under `outputs/` makes it rebuild (measured: ~1.8 s added to the next request's TTFB, which then shows up as LCP). So per-test results and baseline updates are staged in `<os temp>/makeborne-e2e/<stamp>/` and copied by each spec's `afterAll`, after its timed pages; the next spec's warm-up absorbs the rebuild. Then `outputs/eval/e2e/<stamp>/` (one stamp per run, set in the config) holds:

- `studio-quality.json`, `contrast.json`: per page@width metrics, gate rows, gaps and regressions; `quality/*.json`, `contrast/*.json` per test (axe violations with targets, the full audit result).
- `funnel.json`: steps with timings and annotations, created project ids, blocked sub-steps with their cause, findings (every API response ≥ 400, page errors), cleanup outcome. Review tokens are redacted (`/review/<token>`).
- `teardown.json`: what `global-teardown.mjs` found still pending in this run's ledger and what it cleaned (no machine paths).
- `report.json` (Playwright JSON reporter, with the JSON attachments), `test-results/` (failure screenshots). No HTML reporter and no traces: the HTML reporter can copy `.js` files under `outputs/` (ESLint lints it), and a trace would record the sign-in form.

## Data the suite writes (isolated stack only, through the app's own UI/API)

The app has no project delete. Each funnel run creates two website projects; cleanup renames them `[e2e] E2E funnel <stamp> (brief|plan)` (a saved version with the new title plus a project PATCH) and sets their status to `archived`. The review link is turned off from the panel (API fallback, found by its recipient name `[e2e] Funnel <stamp>`), any client comment is resolved, and the fixture project's delivery stage (moved to "in review" by sharing) is restored. The fixture website itself is never edited.

Every created object is recorded the moment it exists in a ledger, `<os temp>/makeborne-e2e/<stamp>/created.jsonl` (the review link before it is even requested), and marked done once cleaned (`cleanup.mjs`). Cleanup runs from three places, so a killed run cannot leave a review link valid for its 3 days:

1. the funnel's `afterAll` (normal end);
2. `global-teardown.mjs` (failures, a crashed worker, Ctrl+C; it runs before Playwright stops the server, signs in in its own browser and only talks to a server that passes the identity check);
3. `global-setup.mjs` of the next run, for earlier ledgers whose run is over (a hard-killed run, or a teardown that could not reach the server). Their items are cleaned before any test, review links first. A run is over when it wrote `run-end`, when its runner PID is gone, when that PID now belongs to a process that started at another time than the runner (the run line records `startedAt`; the OS start time is read with `Get-Process` on Windows, `ps -o etime=` elsewhere; 5 s tolerance), or when its ledger has been idle for 2 hours whatever the PID shows. The setup log prints the reason per run.

## Known state of the isolated stack

The release-auth database predates some migrations. Today this blocks: client comments and decisions on review links (`20261013160000_client_review_view_integrity`: the RPCs lack `p_version`, the page shows "We couldn't save that"), and the Publish tab's status read (`20261013180000_trusted_publication_preparations`: 503 "Cloud storage could not confirm this request"). They are recorded as findings, not hidden. Next dev builds the review link from the request origin, so it reads `http://localhost:3210/review/…` rather than `127.0.0.1`; the suite opens it as given.
