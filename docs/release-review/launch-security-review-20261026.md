# Launch security review, 26 October 2026

Claude, read-only review plus a fix branch. No staging or production access, no paid calls, no provider writes. No secret values appear here.

## Targets
| Target | Branch / head | Diff reviewed |
|---|---|---|
| Minimum launch candidate (Codex) | `release/minimum-launch-20261025` at **5f655a7** (worktree `work/minimum-launch-20261025`, not touched) | `git diff de7e657..5f655a7`: 124 files, +5,379/−775 |
| Full launch candidate (Claude) | `claude/full-launch-candidate` at **1062170** (worktree `.claude/worktrees/full-launch`, not touched) | `git diff de7e657..1062170`: 528 files, +51,667/−1,950 |

Live main is `de7e657`. The minimum branch has moved on to **59e5d32** (Codex's pre-checkout repurchase guard) since 5f655a7. That commit is reviewed briefly below.

The fix branch is `claude/launch-security-fixes`, made from 5f655a7 (worktree `.claude/worktrees/security-fixes`). Its `node_modules` is a junction to the minimum worktree's, so never `--force` remove it.

## Verdict
- **No critical or high findings in either candidate**, so the branch has no code fixes. It carries only this report.
- The most important finding is medium S1. It is a regex CPU denial of service on fetched HTML, it is **already live on main** and it sits in the Codex-owned `src/lib/mail/` area. It is documented here and not fixed, per the ownership rule. A fix is recommended before or soon after launch.
- `npm audit` finds 0 vulnerabilities in the app, the controller, the renderer and the toolchain lockfiles of both candidates.

## Findings
| ID | Severity | Applies to | Location | Issue |
|---|---|---|---|---|
| S1 | **Medium** | live main, 5f655a7, 1062170 | `src/lib/mail/research.ts:103` (`meta`), `:114` (`<title>`), `:122` (script/style strip) | Quadratic regex on untrusted fetched HTML (cap 600 KB), run synchronously on the request thread |
| S2 | Medium | 1062170 only (flags off) | `src/lib/research/page.ts:37,38,44`; `src/lib/crm-research/site-check.ts:75,97` | Same regex class in client research and CRM site check |
| S3 | Medium | 1062170 only (flag off) | `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/image-edits/shared.ts:15-17,36-48` | Paid image edit is gated only by `MAKEBORNE_IMAGE_EDITING`; no `MAKEBORNE_AGENCY_TASKS` gate and no early `requireProviderCapacity` |
| S4 | Medium (operational) | 1062170 only | `src/lib/agency/task.ts:61-63` vs comments in `research/route.ts:30`, `independent-review/route.ts:42`, `agency/run.ts` | Four agency kinds are listed as qualified while the comments say none are, so `MAKEBORNE_AGENCY_TASKS=on` turns on paid calls at once |
| S5 | Low | live main, both | `next.config.ts` `headers()` | The app has no Content-Security-Policy and no explicit HSTS (`X-Frame-Options: DENY`, nosniff and referrer policy are present). Published sites are fine (`infra/customer-sites/site-policy.js`) |
| S6 | Low | live main, both | `src/lib/server/http.ts` `sameOrigin()` | A request without an `Origin` header passes |
| S7 | Low | 1062170 only | `src/lib/data/persist.ts:39-41` | When a report object already exists, it is registered without re-reading its bytes |
| S8 | Low | 1062170 only | `src/app/api/build/sources/route.ts` (POST) | Any signed-in account, even without a plan, can use parser CPU; there is no rate limit |
| S9 | Low | 1062170 only | `supabase/migrations/20261025300000_crm_research.sql:28,41-42,88,91,109-111` | Editors can insert `crm_site_checks` rows directly (forged result, retention up to 2099); full-row UPDATE on `crm_next_steps` bypasses the revision compare-and-set |
| S10 | Low | 1062170 only | `supabase/migrations/20261023210000_client_knowledge.sql:651-657`, `:348-352` | `knowledge_snapshots` is written after a read-role check and the operation is loosely bound; a finished operation can still file proposals |
| S11 | Low | 1062170 only (default **on**) | `src/app/api/build/route.ts:232`; `src/lib/builder/contrast-gate.ts:78-89` | The contrast gate opens Chromium on the app origin taken from `request.url` and passes app-origin requests through |
| S12 | Low | 1062170 only | `src/lib/crm-research/server.ts:37-45`; busy limits in `research`, `data-reports`, `independent-review` routes | Concurrency caps only, no per-user rate limit; busy caps are per instance |
| S13 | Low | 1062170 only | `src/lib/knowledge/server.ts:118` | Validation messages are returned to the client without an allow-list |
| S14 | Info | live main, both | `scripts/eval/package-lock.json` | `npm audit`: 1 high (basic-ftp ReDoS via @lhci/cli / puppeteer). Dev-only eval harness, not deployed, unchanged since main |
| S15 | Info | 1062170 only | various | See the list at the end |

### S1 (medium): regex CPU denial of service in live page research
- **Exploit:**
  - A paid editor asks Makeborne to research a lead or prospect URL (lead research, follow-up draft or the lead-finder enrich path) whose owner serves a 600 KB page of `<meta<meta…` or `<a<a…` with no `>`.
  - `meta()` is called four times per page, and `researchLinks` reads up to 3 pages in parallel.
  - Measured locally with the same patterns: 80 KB takes 0.66 s (`meta`) and 1.6 s (open-tag scan), growing quadratically. At 600 KB that is roughly 37 s per `meta()` call, so one request can block a Node instance's event loop for minutes.
  - On Fluid compute, other users' requests on that instance stall, and CPU time is billed.
- **Who can trigger it:** the routes use `cloudContext(workspaceId, true)`, so a signed-in paying editor is needed. The page host can be anyone. Nothing is exposed, so this is availability and cost only.
- **Fix (minimal):**
  - bound the quantifiers (`[^>]{0,4096}`) and scan for closing tags with `indexOf` instead of lazy `[\s\S]*?`;
  - or cut the HTML to a much smaller head before meta extraction (titles and meta tags live in the first ~64 KB);
  - or run `extractPageFacts` in the existing ingestion worker with its wall-clock timeout.
- **Ownership:** Codex (mail). Not fixed here.

### S2–S4 (medium, full candidate only)
- **S2:** the same quadratic class (`<!--[\s\S]*?-->`, `<tag\b[^>]*>`, `<a\b[^>]*\shref…`) in the client research page cleaner and the CRM site check. Both are behind default-off flags (`MAKEBORNE_CLIENT_RESEARCH` + `MAKEBORNE_AGENCY_TASKS`, and `MAKEBORNE_CRM_RESEARCH`). Fix as in S1 before turning either on.
- **S3:**
  - Image edits make one Anthropic step and one OpenAI edit. The SQL provider gate and the credit hold still bound spend (`open_provider_call`, `ai_operation_provider_begin`), so spend is not unbounded.
  - But an operator who enables only image editing would get paid agency work without the agency switch, and users get late failures instead of a clean 503 while providers are paused.
  - Fix: in `editContext` for writes, require `agencyTasksEnabled()` and `requireProviderCapacity("anthropic")` and `requireProviderCapacity("openai")`.
- **S4:** correct the comments and the runbook so turning on `MAKEBORNE_AGENCY_TASKS` is recorded as a cost decision.

### Low items: fixes
- **S5:** add a CSP to app pages. Start with report-only, then `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` plus script/style sources that fit Next's inline runtime. On the production domain, confirm Vercel sends HSTS or add `Strict-Transport-Security: max-age=63072000`. This is pre-existing and not launch-blocking, because `X-Frame-Options: DENY` stops framing.
- **S6:** writes that use `boundedJson` need `Content-Type: application/json`, which forces a CORS preflight, so cross-site form posts fail. For defence in depth, consider requiring `Origin` (or `Sec-Fetch-Site: same-origin`) on cookie-authenticated writes.
- **S7:**
  - An editor can upload to `ws/proj/reports/<predicted-sha>.json` before the server writes there; the facts JSON is deterministic, so its sha256 can be predicted.
  - `document-export` re-hashes on download, so the worst case is a refused saved file, not tampered content.
  - Fix: on exists/duplicate, download and verify the sha256, as `registerSourceUpload` does, or deny browser inserts under `reports/`.
- **S8:** use `cloudContext(undefined, true)` and add a per-account limit.
- **S9:**
  - Add `check(url ~ '^https?://')`, `check(checked_at <= created_at + interval '5 minutes')` and a 31-day `expires_at` bound.
  - Grant column-level UPDATE (`text, revision, updated_by, updated_at`) and add a revision-increment trigger, or write both only through service functions.
  - Impact stays inside one workspace: composite foreign keys block cross-workspace references.
- **S10:** pass write=`true` to `knowledge_require` in the snapshot writer and require `o.artifact_id = p_artifact`; refuse proposals unless `o.status in ('active','paused') and o.expires_at > now()`.
- **S11:**
  - The generated document is rendered in an iframe with `sandbox="allow-same-origin"` and no scripts, and the Chromium context has no cookies, so there is no escalation today.
  - Prefer a configured app origin (environment) over `request.url`, or fulfil `/builder-runtime/*` from local files and abort everything else.
- **S12:** add an hourly per-user and per-workspace limit for website checks and per-user busy slots.
- **S13:** map the messages to the generic message or allow-list them.

### S15 (info, full candidate)
- The Teredo test in `src/lib/mail/research.ts:32` misses the compressed `2001::` form. It is not practically exploitable.
- The ingestion worker is a `worker_threads` thread, not an OS sandbox, and the comment in `parse-worker.cjs` overstates the isolation. The parsers are pure JavaScript and never evaluate input.
- Flag spelling is inconsistent: `MAKEBORNE_SOURCE_INGESTION_ENABLED=true`, while the others use `on`.
- The independent-review body limit (16.5 MB) and the image-edit limit (6 MB) exceed Vercel's 4.5 MB request cap. This is a functional problem only.
- Knowledge and research writes are not checked against paid membership in the database; only the route checks it.
- Page evidence `refId`, `sha256` and `fetchedAt` are taken from the caller.
- `agency_task_scope` does not require `sources.approved`.
- `knowledge_source_gone` has no workspace filter. It is safe today because reference ids are verified at insert.

## Verified with no finding
**Billing (5f655a7):**
- **`POST /api/billing/checkout`:**
  - The request checks the same origin, the session (`requireBillingUser`) and a strict Zod body.
  - The plan comes from the server (`verifiedCreationOffer`) and the database creation flag.
  - Each request id is bound to `user_id`.
  - Resuming goes through `assertResumable`. Only `pending` resumes; `recovered` returns 409; every other outcome, including `skipped` when migrations are unverified, fails closed.
  - The return URL comes from `SITE.url` or the platform's `VERCEL_URL` matched against the exact staging pattern, never from the request Origin.
  - The provider response must match the company and the plan.
- **`checkout-recovery.ts`:**
  - It uses no provider ids from the browser and runs under a database lease.
  - It reads one exact page of payments for this checkout, with full payment and membership identity checks (company, plan, checkout, user, membership, funded, no dispute or refund, current period).
  - Credits are granted only after `reconcilePlanPayment` returns `funded`.
- **Whop webhook (unchanged since main):**
  - The raw body is read with a 512 KB limit.
  - The signature is checked by `standardwebhooks`: HMAC with a timing-safe compare and a 5-minute timestamp tolerance against replay. The event id must equal `webhook-id`.
  - Every merchant id must match the configured company.
  - Membership and payment state are fetched fresh from the provider, never trusted from the event.
  - The user comes from the checkout binding; refunds and disputes revoke through payment evidence.
- **`/api/cron/billing-reconcile`:** a constant-time bearer check against a secret of at least 32 characters, plus an enable flag. The new `vercel.json` cron is harmless while the flag is off.
- **`checkout-navigation.ts`:** exact origins only (`whop.com`, or `sandbox.whop.com` only from a local or exact staging app origin), the `/checkout/ch_…` path pattern, and no credentials in the URL.

**Publishing (5f655a7):**
- **Migration `20261025200000`:**
  - The new scope table has RLS and `revoke all`, including from service_role.
  - The new functions are SECURITY DEFINER with `search_path=''`, revoked from everyone.
  - `create or replace` keeps the existing service-only ACLs.
  - `entitled` mode requires the production namespace (trigger) and the database owner (configure function).
  - Requests and promotions still need the fresh 5-minute membership check.
  - The workspace limit of 10 preparations per hour is enforced under the workspace row lock.
  - The refund/publish advisory lock order matches finance.
  - The legacy `save_site_v4` live path now rejects refunded periods.
- **Broker profile and controller schema 3:** `entitled` only in production; a leftover workspace list closes the broker; a v3 attestation is required; the claim and load RPCs re-run the database authority.
- **Publication route:** live publishing and turning on interactive JavaScript require plan access.

**Auth and review (5f655a7):**
- `auth-flow.ts`: `plan` and `interval` only from fixed lists; there is still no arbitrary-destination passthrough.
- Anonymous review routes (unchanged): token check, no-store, noindex, no-referrer and a same-origin check on writes. Asset reads are authorized twice, check the path and re-hash the bytes. `/review/*` has noindex, no-store and no-referrer headers.

**Full candidate (1062170):**
- **New API routes:** every one checks the session (`cloudContext`), membership and role (reviewers get 403 on writes), scopes URL and body ids to the workspace or artifact, applies the same-origin check and the JSON byte limit on writes, and uses default-off flags (exactly `on`). Paid AI runs behind operation holds.
- **The 7 new migrations:**
  - RLS on every new table, and anon gets nothing.
  - Every new function is service_role-only, or INVOKER under RLS (`makeborne_crm_next_step_set`).
  - Every SECURITY DEFINER function sets `search_path=''` and re-checks the caller.
  - The `project-assets` bucket stays private, and only document MIME types are added (no HTML or SVG).
- **SSRF:** all new fetches go through `publicTarget` + `pinnedFetcher`:
  - http/https on ports 80/443 only;
  - every DNS answer must be public, including the IPv4-mapped, ULA and NAT64 forms;
  - the checked address is pinned;
  - each redirect hop is re-checked, up to 3;
  - 6 s per hop, a byte cap and no compressed encodings.
  The research search is refused, and headless Chromium is offline (resolver rules, route abort, no WebSocket, WebRTC or service workers).
- **Parsers:**
  - ZIP: limits on entry count, per-entry size, total size and ratio; `maxOutputLength`; CRC checked; ZIP64 and path traversal refused.
  - XML refuses DOCTYPE, so there is no XXE or entity expansion.
  - PDF streams have caps; sharp runs with `limitInputPixels`.
  - Storage paths come from server ids plus the sha256, and bytes are re-hashed.
- **Injection:**
  - No new `dangerouslySetInnerHTML`, `eval` or `new Function`.
  - Book and chart output escapes text.
  - Iframes are sandboxed.
  - There are no new CSV/XLSX exports, so no formula-injection surface.
  - No PostgREST filter is built from template strings.
  - Fetched content sits in untrusted wrappers, the research run has no tools, and saving to a client only proposes facts.

**Secrets and dependencies:**
- No high-confidence credential patterns in either diff, and no `.env`, key or certificate files committed.
- `.env.example` additions are placeholders or comments only.
- `NEXT_PUBLIC_*` names are limited to the Supabase URL, the publishable key (checked for the `sb_publishable_` prefix in `next.config.ts`) and site/hosting flags.
- `npm audit --package-lock-only`: app 0 and controller 0 on both candidates; project-runtime renderer 0 and toolchain 0.

**59e5d32 (after 5f655a7):** the `guard_creation_checkout` trigger function is SECURITY DEFINER, `search_path=''`, owned by postgres and revoked from everyone. It serialises on a per-user advisory lock and fails before any provider checkout. No finding.

## Coverage notes
- Areas of the full candidate were split across three read-only sub-reviews: migrations, new routes, and SSRF/parsers/XSS. Their line references were spot-checked (S2, S3, S7, S11).
- The bodies of some older SQL helpers were relied on, not re-read: `makeborne_ai_operation_read`, `open_provider_call`, `ai_operation_permission`.
- Not covered: Firefox/WebKit, real stack or staging behaviour, and the customer-sites worker beyond its header policy.
