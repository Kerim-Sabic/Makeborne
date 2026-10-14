# Fresh product quality launcher — local preparation only

## Qualification status

No paid provider requests, package reservation, enabled limits, or fresh generated products were made by this preparation. `node scripts/check-fresh-quality.mjs` passed **14 groups** against the exact guard SQL in a newly created disposable local database, then dropped that database. It verified the local provider ledger and limit rows remained identical. The separate authorized smoke creates only synthetic local users/projects/versions in the fresh stack; it makes no spending or provider-ledger writes. Focused ESLint passed with zero warnings/errors.

**Fresh stack and route/export smoke are ready; paid execution remains unreserved.** The existing local auth database at `127.0.0.1:55438/postgres` lacks current operation tables and was preserved unchanged. The launcher/common/preflight now require only the separate current stack at API `127.0.0.1:55465`, database `127.0.0.1:55468`, status `work/fresh-quality-stack/status.json`. The old ledger stays intact; the shared $50 round and exact $6 reservation still apply to the fresh empty ledger. The 14-group disposable guard harness passed again on this fresh cluster. Wait for Claude's final document handback before freezing the paid source snapshot.

Actual synthetic smoke passed **nine checks** at `outputs/fresh-quality-smoke-9eb8f8b8-c34f-4434-8cdc-fff8508e56e5/smoke-report.json`: sign-in, workspace, both project/artifact/version saves, book PDF, deck PDF/PPTX and both saved-source renderers. Provider ledger and limits stayed unchanged; own server process tree stopped. Both PDFs were rasterized. PPTX contains two native-text slides and two notes parts. Visually inspected the book cover/body and deck closing PDF rasters; this demonstrates synthetic transport/rendering only. Source hashes in the smoke report predate Claude's final body fixes.

The separate `scripts/check-fresh-quality-jump.mjs <smoke-uuid>` follow-up found saved `DocumentPreview` gated by paid-builder availability. Root fixed `cloud-studio.tsx`; a fresh snapshot then confirmed the provider-off saved book preview and deck preview/menu render. The book screenshot is `owner-book-saved-ui.png`. Selecting the deck's final slide resulted in target top **101.421875px**; the harness required exactly zero and failed before its reviewer phase. Bottom-scroll clamping may explain this, so it is **not an established product defect**. Exact jump landing and reviewer interaction remain unqualified. The original gating failure is preserved as `jump-ui-report-before-fix.json`, with latest observations/source hashes in `jump-ui-report.json`. Provider ledger/limits remained unchanged and the owned process tree stopped. The one-chapter synthetic book cannot qualify multi-chapter jumping. No further UI expansion is needed before the separately authorized paid generation package.

## Files and isolation

- `scripts/fresh-quality-server.mjs`: read-only preflight by default; explicit `--start` requires both root reservation records. Starts a dedicated `127.0.0.1:3068` Next dev process from an isolated source copy with its own `.next-fresh-quality` output. Copies all `src`/`public` files and an explicit list of app-needed infra/config files. Current inventory is 2,496 files; hidden paths/symlinks are refused. No broad infra directory, dotenv, prior output, or dependency tree is copied. Dependencies use a local junction.
- `scripts/fresh-quality-common.mjs`: exact loopback auth/database endpoints, allowlisted child environment, fixed Opus 5.5/model rate, no fallback model, no OpenAI/image credential, complete source inventory and action briefs.
- `scripts/fresh-quality-guard.sql`: owner-only local schema and BEFORE INSERT guard on every provider ticket. Not a migration. All browser and service-role access to its authority tables/functions is revoked. Existing provider admission locks continue to apply; the package row additionally serializes all package admissions.
- `scripts/qualify-fresh-products.mjs`: one explicit action per invocation; fresh fixture, project, artifact, action and step IDs; `styleId:automatic`; current operation envelope and canonical request digest. A prior attempted action cannot be silently retried.
- `scripts/render-fresh-quality.cjs`: renders saved source with snapshot renderers, rasterizes real API-exported PDF when bundled Poppler is present, inspects native PPTX XML. Does not claim images or Office rendering qualified.
- `scripts/check-fresh-quality.mjs`: offline/dry-run and real disposable PostgreSQL race checks. Representative minimal tables test the exact trigger; this is not an actual app/schema integration claim.
- `scripts/check-fresh-quality-routes.mjs`: explicit `--run` synthetic API/export smoke on the fresh stack only, independent port3069 and `work/fresh-quality-smoke/<uuid>`. Provider credentials are empty and limits must remain disabled. Creates a local fixture/admin, signs in, creates a workspace/project/artifact, saves synthetic documents, exports book PDF and deck PDF/PPTX through the real routes, runs the renderer, checks ledger/limits unchanged and terminates its own process tree. It never POSTs to generation routes or installs/arms the paid guard. The studio's read-only capability GETs may occur. Default `--dry-run` changes nothing. Synthetic output is not fresh generation quality.

The guard rejects every provider insert outside the armed fixture/action, including other users/apps sharing the database. It binds persisted operation/run IDs, hashes, versions, effort, fixed tariff, authorization cap, provider and model. All-day sums charge unresolved calls at their full bound; completed charged amounts remain counted. The three caps are book $2.70, deck $2.70 and one deck edit $0.60, total $6.00. No daily rollover allowance: dispatch stops before a fixed deadline, set before the next UTC midnight; admission requires 300 seconds remaining. Normal build execution is bounded to 280 seconds. A controller heartbeat plus backend PID check closes admission after controller loss (at most 15 seconds for a stalled but connected controller). The retained guard/lock prohibit implicit restarts.

Shutdown disables guard and global/Anthropic limits, terminates the owned Windows process tree, then independently reads all limit scopes and guard state. Unconfirmed state is recorded as false/null and gives a nonzero exit; it never reports a failed update as confirmed disabled. Historical rows are checked against the initial baseline; mismatch fails. Main DB preflight requires zero open historical calls because normal provider admission can expire stale calls. The scripts do not erase or reclassify prior settled/uncertain rows.

## Exact root sequence after prerequisites

1. Run `node scripts/fresh-quality-server.mjs --dry-run` and `node scripts/check-fresh-quality.mjs`. Ensure runtime readiness and all providers disabled. Run `node scripts/check-fresh-quality-routes.mjs --run` against the fresh stack and inspect its synthetic output and `smoke-report.json`. All fixture/workspace/project/artifact/save/PDF/PPTX checks must pass with unchanged provider ledger/limits.
2. Root chooses a fresh UUID and writes a reservation entry into `docs/release-review/api-budget-round-20261013.json`: Codex `reservedUsd:6`; append `{packageId,owner:"Codex",status:"reserved",reservedUsd:6}` to `calls`. Preserve all prior rows. Do not debit actual spend before observation.
3. Root writes `docs/release-review/fresh-quality-reservation-20261013.json` with exactly the fields below. Use a fresh expiry no more than one hour ahead, leaving at least six minutes and avoiding the UTC day boundary. This file is an operator authorization, not generated automatically by these scripts.

```json
{
  "packageId": "ROOT-GENERATED-FRESH-UUID",
  "allocation": "Codex",
  "capMicrousd": 6000000,
  "model": "claude-opus-5-5",
  "port": 3068,
  "status": "reserved",
  "roundAuthorizedAt": "COPY-EXACT-CURRENT-ROUND-authorizedAt",
  "actionsSha256": "7074719ce2ef2b9a4ce4ac97121de8f076ba801886c879fb790a6cbec28927f4",
  "expiresAt": "ROOT-CHOSEN-FUTURE-UTC-TIMESTAMP"
}
```

4. Start `node scripts/fresh-quality-server.mjs --start`. Wait for the local login to respond; local fixture credentials stay in ignored `work/fresh-quality/session.json`. Logs are local and must be inspected for redaction before sharing.
5. Run `node scripts/qualify-fresh-products.mjs book --run`. Inspect the untouched saved JSON, full preview and every actual exported PDF page under `outputs/fresh-product-quality-<packageId>/book`. Judge substantive completeness, portrait layout, page breaks, typography and clipping before continuing.
6. Run `node scripts/qualify-fresh-products.mjs deck --run`. Inspect all slide and PDF images and the exported PPTX in the installed PowerPoint. Root has confirmed PowerPoint can render existing synthetic decks; fresh deck inspection remains required. Unlicensed Office disables editing/saving, so native XML plus visual rendering are distinct evidence.
7. Run `node scripts/qualify-fresh-products.mjs deck-edit --run`. It selects the requested unique 12/18/25/30 native chart, requests changing only 18→21, preserves untouched prior output, and records the full before/after and changed slide IDs. Inspect this diff to determine success; a completed model run alone does not prove a correct edit.
8. Stop the launcher with Ctrl+C. Inspect `shutdown-ledger.json`, each action's ledger and terminal/events. Reconcile all new rows against the root shared reservation; unknown/in-flight outcomes retain their full exposure. Missing usage is never zero. Do not rerun failed actions under the same authorization.

These are **three application `/api/build` requests**, not three model HTTP calls. Existing bounded tool turns/retries may result in multiple provider tickets within the same operation caps; no extra plan/image/review request is authorized. Native images are explicitly unqualified: OpenAI is absent. Tokens are not persisted by the normal provider ledger; monetary bounds/charged totals are recorded, and no invented token usage should be reported.

## Regression coverage and remaining boundaries

Four dry runs; sanitized environment; complete source inventory; canonical digest equality with actual `canonicalSourceJson`; accepted exact fixture; wrong actor/run/model/provider/source/bound; wrong trusted operation hash/action/step/tariff; disabled/unarmed/expired-heartbeat/dead-PID/day-boundary/deadline rejection; exact action ceiling; two real concurrent admissions competing for the exact remaining amount; old-day uncertain bound retained; old call can settle after disarming/closing; aggregate $6 ceiling; anonymous/authenticated/service role cannot reopen authority; original ledger and limits preserved.

The dry run is not a provider egress interceptor or model quality claim. No actual fresh generated output has yet been produced; only the separately labeled synthetic route/export/renderer smoke has passed. The local guard has not been installed on the auth database. No cleanup removes its authority automatically: after a crash/operator stop, independently disable limits, observe/reconcile all package calls, confirm the owned server tree stopped, and obtain explicit recovery approval before removing the guard or lock. Keep unresolved exposure reserved even after the deadline. This launcher does not provision a durable production controller or authorize staging/production use.
