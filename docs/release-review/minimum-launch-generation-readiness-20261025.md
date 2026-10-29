# Minimum launch, gate 2: generation readiness for ordinary paying users — 25 October 2026

Status: **NOT OPEN, and not ready to open tonight without owner decisions.** This is inspection and preparation only. Nothing was enabled anywhere except inside one local process and the local isolated stack, and that local state has been restored. There were no production or staging database connections, no paid AI calls, no credentials created or printed, and Whop and the November renewal probes were not touched.

- **Candidate inspected:** `release/minimum-launch-20261025` at 700a4e4 (staging runtime e8ccef9), read-only.
- **Work branch:** `claude/launch-generation` from 700a4e4, in worktree `.claude/worktrees/launch-generation`.
- **Local evidence (outside the repository):** screenshots, request/response captures and scripts are in `%TEMP%\claude\…\scratchpad\launch-gates\generation\` (Claude session d733aae7).

## 1. Every blocker between an ordinary paying user and generation

An ordinary user here means a confirmed account that is not an admin and has paid credits. The order follows the request path: `POST /api/build` → `cloudContext(…, write)` → creation access → priced model → provider capacity → operation and credit hold → per-call gate. File:line references are to 700a4e4.

| # | Blocker | Where (file:line) | Current state | Owner |
|---|---|---|---|---|
| B1 | **The owner has not approved an operating budget for customer generation.** The testing ledgers (agency qualification, the $1 cloud reservation and others) do not authorize ongoing customer costs. | `tonight-launch-gates-20261025.md` §5; `docs/AI_SPENDING.md:169-176` | None approved | **Owner** |
| B2 | **Provider daily limits:** `global`, `anthropic` and `openai` are disabled with a 0 µ$ limit. Every paid call fails closed: preflight returns `paused`, and `makeborne_provider_call_begin` raises `MB423`. | `supabase/migrations/20261012140000_live_ai_spend.sql:21-29`; gate `20261012150000_shared_provider_limits.sql:52-54`; preflight `:131-140`; `src/lib/ai/live-run.ts:15-32` | Production: all disabled at 0 (Codex, read-only). Staging: not read (no connection). | Owner approves the amount; whoever runs it needs DB-owner rights (§3) |
| B3 | **The DB creation switch is off:** `billing_settings.creation_enabled=false`. While it is off, a paid membership grants no creation access at all. | `20261004162455_whop_membership_access.sql:51-55,64-68`; `20261020090000_payment_funding_and_refunds.sql:441-452`; `src/lib/billing/access.ts:94-98` (`MEMBERSHIP_REQUIRED` 402) | Production `creation_enabled=false`, `free_tier_enabled=false` | Owner approves; Codex executes (billing gate) |
| B4 | **No production plan rows:** `billing_access_plans` needs `enabled=true` rows for the six new production plan IDs. Those IDs don't exist yet, and the current catalogue IDs carry the old prices. | `whop_membership_access.sql:56-59`; `src/lib/billing/config.ts:53-66` | Production IDs not created | Owner (Whop) + Codex |
| B5 | **Billing env:** `WHOP_API_KEY`, `WHOP_COMPANY_ID` (must equal the live merchant), `WHOP_WEBHOOK_SECRET` (`ws_…`), `WHOP_ACCESS_PLAN_IDS`, `WHOP_PLAN_CREDIT_MAP`, `WHOP_CREATION_ENABLED=true`, `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED=true`. Without them, live membership verification returns false. | `src/lib/billing/config.ts:27-66`; `access.ts:28-66` | Production mapping pending | Codex |
| B6 | **Paid credits must actually arrive.** The hold is reserved in SQL at admission. With 0 available credits, `MB402` → `INSUFFICIENT_CREDITS` (402) is returned before any provider call. Credits come from plan allocations, which depend on webhooks and reconciliation. | `src/lib/builder/operation-server.ts:50`; `docs/BILLING_PLAN_CREDITS.md` | Six sandbox purchases PASS; automatic webhook delivery and scheduled reconcile still OPEN | Codex |
| B7 | **Builder env:** `MAKEBORNE_LIVE_BUILDER_ENABLED` must not be `"false"`, and `ANTHROPIC_API_KEY` must be set. Otherwise build, plan and questions return 503 `BUILDER_UNAVAILABLE` and the studio shows the "AI building is off" panel. Expert chat has its own flag, `MAKEBORNE_EXPERT_CHAT_ENABLED`. | `src/app/api/build/route.ts:62,75`; `plan/route.ts:54,130`; `questions/route.ts:29,40`; `src/lib/experts/start.ts:13`; `src/lib/capabilities/server.ts:18` | Staging preview: builder disabled. Production env not inspected (no access taken). | Codex verifies; owner provides the production key |
| B8 | **`SUPABASE_SECRET_KEY` (`sb_secret_…`) in the runtime.** The spend gate and preflight run through `billingDatabase()`. Without the key, preflight returns `unavailable` and every paid route returns 503 `AI_UNAVAILABLE`. | `src/lib/billing/database.ts:7-13`; `live-run.ts:24-31` | Assumed present (billing uses it) | Codex verifies |
| B9 | **Model pricing:** the priced IDs are `claude-opus-5-5` (builder, Genius chat), `claude-haiku-5-5` (questions, Standard chat, brief) and `claude-sonnet-5-5`. Prices were last verified 2026-10-12/13, and an unknown model fails closed. `MAKEBORNE_BUILDER_MODEL` must stay unset (default Opus 5.5) or name a priced ID. | `src/lib/ai/prices.ts:29,42,50`; `src/lib/builder/agent.ts:27`; `src/lib/builder/ai-brief-questions.ts:11`; `src/lib/experts/chat-run.ts:13-15` | Priced. Re-verify against the provider pricing page on the day of opening. | Claude (re-verification), owner sign-off |
| B10 | **Generation is not qualified on this candidate for an ordinary user.** No paid build has run end to end on staging or production at e8ccef9 (gate 5: "Qualified generation is necessary before charging for creation"). The local quality harness and past local runs don't qualify this deployment. | `tonight-launch-gates-20261025.md` §5 | Not done; needs a small, separately approved staging allowance | Owner approves spend; Codex runs staging (Claude can prepare) |
| B11 | **Images:** they run only when `OPENAI_API_KEY` and `MAKEBORNE_IMAGE_MODELS`/`MAKEBORNE_IMAGE_MODEL` are set, with a bounded price card. Decision D8 says the owner requires AI images at launch, so an unqualified image path is a stated release blocker. Images on staging have not been qualified for this candidate. If images are configured while the `openai` gate stays disabled, each image call is refused and the builder continues with CSS/SVG (`agent.ts:267`), so the build still completes. | `src/lib/builder/images.ts:24-35`; `docs/AI_SPENDING.md:59`; `docs/RELEASE_DECISIONS.md:27,64,131` | Off | **Owner decision:** launch text-only (images off), or approve image qualification first |
| B12 | **There are no per-user rate or daily caps**, only these bounds: per-run provider caps by effort, the user's own credit hold, and per-process one-at-a-time for questions and chat. One user can use the whole platform daily limit, and everyone else then sees "Today's AI capacity has been reached." | `src/lib/builder/pricing.ts:36-42`; `questions/route.ts:17,52`; `experts/start.ts:15,29`; `docs/AI_SPENDING.md:201` | Accepted limitation, not a code blocker | Owner accepts or defers launch |
| B13 | **Owner/admin-only paths.** Admins bypass the membership check (`access.ts:30`; SQL admin clause in `has_creation_membership_for_actor`) and are exempt from credits, but **not** from provider limits. These are the only owner shortcuts in the generation path, and none of them is needed by ordinary users. The durable `/api/generate` operator path is not used by customers and fails closed (expired tariff). | `access.ts:30`; `20261020090000…:441-452`; `docs/AI_SPENDING.md:22-27` | Not a blocker for paying users | — |
| B14 | **Monitoring is manual.** There is no automatic cap controller or alerting (`AI_SPENDING.md:173`). Health checks are `makeborne_provider_spend_health()`, `/admin` (provider spend today) and the `ai_spend_stop` server logs. | `20261012140000…:179-192`; `20261013100000_admin_console.sql:56` | Manual | Owner/Codex watch during the 30-minute post-launch window |
| B15 | **The billing reconcile job is off** (`MAKEBORNE_BILLING_RECONCILE_ENABLED`, no cron). Stale provider calls still expire on the next gate entry (`expire_provider_calls(50)` inside `open_provider_call`), and holds are reclaimed on the next wallet write, so this does not block generation. | `20261012150000…:47`; `docs/BILLING_PLAN_CREDITS.md` (Reconciliation job) | Off | Codex (billing gate) |

Not present in this candidate: a prompt "enhance" endpoint. `rg -i enhanc src` finds only prompt text, so there is nothing to gate or verify for enhance at 700a4e4.

**Shortest path to an ordinary paying user generating (text only):**
- **Owner:** approves B1, decides B11 (text-only) and B12, and provides the key.
- **Codex:** closes B3–B6 (billing gate) and B7/B8 (env).
- **Owner, in the DB-owner session:** runs the §3 SQL.
- **Then:** one approved staging qualification (B10) before production.

## 2. Is the disabled state clear and honest? (reproduced locally)

**Setup.** Candidate code at 700a4e4 (worktree `claude/launch-generation`), `next dev --webpack` on localhost:3210, against the local isolated stack (API 127.0.0.1:55435, DB 127.0.0.1:55438). Provider limits were left exactly as in production: `global`, `anthropic` and `openai` disabled at 0.

**Fixture.** A fresh, confirmed, **non-admin** local account (`gen-gate-…@example.invalid`), created in the local stack only:
- 300 credits through a local `adjust` grant;
- a local verified membership on a local-only plan row `plan_LocalGenGate20261025`, with `creation_enabled=true` set temporarily in the local DB so the path is the paid-membership path.

**Provider safety.** `ANTHROPIC_API_KEY` was a dummy and `ANTHROPIC_BASE_URL=http://127.0.0.1:9` (a blackhole), and no OpenAI key was set. An accidental provider call could not have left the machine.

**Afterwards.** The local switches were restored (`creation_enabled=false`, plan row disabled, membership cancelled), the fixture was banned and its sessions removed, and the local password and cookie files were deleted.

### What the paying user sees and gets (exact copy)

| Action | Result | Honest? |
|---|---|---|
| Home composer (`/studio`) | `Create`/`Plan` stay usable. Note under the box: "Your brief becomes a saved project. Available generation controls appear in its editor." | Yes. It promises a saved project, not generation. |
| Create → project opens | Banner: "Project saved to your account. Your supplied content is ready to edit; AI generation has not run." Preview: "Your website starts here. Your brief is saved. Your editable draft will appear here. You can add your own content in the editor." | Yes. "Will appear here" is mildly optimistic, but the banner states that AI has not run. |
| Builder composer (Build or Plan) | The message field and Send are **disabled**; balance "300 credits", "Up to 50 credits" (plan: "Up to 10 credits"). **Before the fix** the only visible line was "Sending unavailable  See request details". The reason, "AI building is paused right now. Your saved work is safe, and you can still open and edit it.", appeared only in a hover tooltip and inside the collapsed **Request details**. | Honest (nothing can be sent or charged) but **unclear**: the user isn't told why without opening a disclosure. **Fixed**, see below. |
| `POST /api/build` (Build) | 503 `{"code":"AI_PAUSED","message":"AI generation is paused right now. Nothing was charged. Please try again later."}` | Yes. Refused before any hold. |
| `POST /api/build/plan` (Plan) | Same 503 `AI_PAUSED`, same message. | Yes |
| `POST /api/build/questions` (tailored questions) | Same 503 `AI_PAUSED`, same message. | Yes |
| `POST /api/chat` / Expert chat UI | The UI lets you type and send, then shows: "AI generation is paused right now. Nothing was charged. Please try again later." with **Try again**. | Yes. There's no preflight in the chat UI, but nothing is reserved or charged. |
| Enhance | Not present at 700a4e4. | n/a |
| Ledger and gate after all four attempts | Balance 300 / reserved 0 / available 300, ledger entries 1 → 1; `live_provider_calls` for the user = 0; `credit_reservations` = 0. | **No charge, no hold, no provider contact.** |
| Builder **off** (`MAKEBORNE_LIVE_BUILDER_ENABLED=false`, as on the staging preview) | Studio panel: "**AI building is off right now.** Notes stay in this browser tab; nothing is sent to AI or charged." API: 503 `BUILDER_UNAVAILABLE` "The builder is not connected in this environment." / "Tailored questions aren't available in this environment." | Yes, and clear. |

**When and why.** The copy says *that* generation is paused and that it is retryable ("try again later"). It deliberately gives no amounts or internal reasons (`src/lib/ai/failure.ts:1-11`). There is no ETA, which is correct while opening is an open owner decision: any date would be a false promise. If the owner wants a "launching soon" line, that is a copy decision, not a defect.

**Fix (on `claude/launch-generation`).**
- **Change:** `src/components/live-builder.tsx` now renders the full reason in the visible status line, `<p className="lb-availability" role="status">{blockedReason}</p>`, instead of "Sending unavailable / See request details". The duplicate inside the collapsed details was removed, and `src/app/live-builder.css` adjusts `.lb-availability` (12px, wraps).
- **Scope:** the same line also shows the existing actionable reason "Save or resolve the current draft before building."
- **Regression check:** `scripts/check-builder-paused-browser.cjs` mounts the real `LiveBuilder` with `BUILDER_WAITING_COPY[paused|limit|unavailable]` at 1440 px and 375 px, with routed APIs and no network. It asserts five things:
  - the reason is a visible `role=status` with the full text while Request details is collapsed;
  - it is on screen;
  - there is no "See request details" pointer;
  - the field and Send are disabled;
  - no POST is made to build, plan, questions or chat, and there is no horizontal scroll.
- **Before the fix:** FAIL ("one status names the reason", 0 !== 1). **After:** 6/6 PASS.
- **Other checks:** the existing `check-editor-header-browser` (25/25), `check-composer-send-browser` (2/2), `check-availability.cjs`, `check-live-spend.cjs` (33) and `tsc` pass, and eslint on the changed files is clean.
- **Real app:** the re-captured studio shows the reason under the composer (`04-editor-collapsed.png`).
- **Stale availability:** an editor that was already open when limits change keeps its last availability (fetched once on mount, `cloud-studio.tsx:1181-1186`). Its next Send gets the 503 message above, and a reload shows the new state. This is acceptable and noted in the runbook.

**Local-only artifact.** "Chat history is unavailable" appeared because the local stack lacks migration `20261023000417_account_chat_history.sql`. This is not a candidate defect. Confirm the migration is applied wherever this candidate runs.

## 3. Prepared settings to open generation (NOT executed anywhere)

**Who can run it:**
- The limit functions are `makeborne_private.*`, revoked from `service_role`. They must be run as the **database owner** (Supabase SQL editor or psql as `postgres`) on the exact target project, after the owner's written approval of the amount.
- Never through the app, and never with a bare `supabase db push`. No migration is needed: all functions already exist at 700a4e4.

**Inputs.** `X` is the owner-approved operating amount in USD per UTC day. 1 USD = 1,000,000 µ$.

### 3.1 Limits as a function of X

- **`global = X`.** This is the hard platform-wide ceiling per UTC day, covering every provider plus the durable path.
- **Text-only launch (recommended unless images are qualified):** `anthropic = X`, and `openai` stays disabled at 0.
- **With images**, only after D8 image qualification on staging and a separate approval: `anthropic = 0.85·X`, `openai = 0.15·X`.
  - The 15% share comes from the medium website's ≤3 images. Each is bounded at about $0.03–0.06 (`AI_SPENDING.md`, D8), against a first-build median of about 32 credits × $0.03 ≈ $0.96 of text.
- **Leave every other scope disabled:** `deepseek`, `qwen_hosted`, `self_hosted`, `media_worker`.
- **There is no per-user cap in code.** Each paying user is bounded by their own credits: `credits × $0.03` of confirmed provider cost (`MAKEBORNE_AI_COST_USD_PER_CREDIT` unset → 0.03, `src/lib/builder/pricing.ts:12,21-31`).
  - At list plans that is about $9, $22.50 and $46.50 of provider cost per month for Create, Studio and Scale.
  - Uncertain usage is absorbed on top of that.
  - Admins are not bounded by credits, but they are bounded by the gate.

**Per-run provider caps at $0.03/credit** (from `BUILDER_EFFORT` / `PLAN_CEILING_CREDITS` / `CHAT_MODES`). The gate reserves each call's bound before the call, so a day's remaining allowance must exceed the next call's bound.

| Path | Ceiling (credits) | Provider cap per run/step |
|---|---|---|
| Website/doc build, Light / Medium / High / Super high / Ultra | 20 / 50 / 90 / 140 / 240 | $0.60 / $1.50 / $2.70 / $4.20 / $7.20 |
| Design review round (Medium) | 15 | $0.45 |
| Plan | 10 | $0.30 |
| Tailored questions (never charged) | 1 | $0.03 |
| Expert chat, Standard / Genius | 3 / 15 | $0.006 / $0.30 |

**Worked examples.** Medium first build: median 32 credits ≈ $0.96 (measured range 16–45 ≈ $0.48–$1.35).

| X per day | `global` µ$ | `anthropic` µ$ (text-only) | `openai` µ$ (text-only) | With images: anthropic / openai µ$ | Rough daily capacity (text, medium) | Worst case | Monthly exposure if exhausted daily |
|---|---|---|---|---|---|---|---|
| $10 | 10000000 | 10000000 | 0 (disabled) | 8500000 / 1500000 | ~10 first builds at median | 6 medium runs at cap, or 1 Ultra plus small work; an Ultra call late in the day may hit "Today's AI capacity has been reached" | ~$300 |
| $25 | 25000000 | 25000000 | 0 (disabled) | 21250000 / 3750000 | ~26 first builds | 16 medium at cap / 3 Ultra | ~$750 |
| $50 | 50000000 | 50000000 | 0 (disabled) | 42500000 / 7500000 | ~52 first builds | 33 medium at cap / 6 Ultra | ~$1,500 |

Margin context: plans sell credits at $0.05–0.12 against a provider cost of $0.03/credit (`MARGIN_POLICY.enforcedMinAiMargin` 0.4). Exhausting X therefore corresponds to customers spending about X/0.03 credits they already paid for. The daily gate is a cost-of-goods cap, not revenue.

**Recommended backstop (owner, provider console):** set a monthly spend limit on the Anthropic organization/workspace for the production key, at about 30·X plus headroom. The provider then enforces a ceiling independent of Makeborne.

### 3.2 SQL to open (owner-approved X filled in; run as DB owner on the target project)

```sql
-- 0. Readback before (save the output with the change record).
select public.makeborne_provider_spend_health();
select creation_enabled, free_tier_enabled from makeborne_private.billing_settings;

begin;
-- 1. Provider-dollar gate (text-only launch). Replace <X_MICROUSD>, e.g. 10000000 for $10/day.
select makeborne_private.set_live_provider_limit('global',    true,  <X_MICROUSD>, false, 'Launch <date>: owner-approved $<X>/day, approval ref <ref>');
select makeborne_private.set_live_provider_limit('anthropic', true,  <X_MICROUSD>, false, 'Launch <date>: text generation, owner-approved $<X>/day');
select makeborne_private.set_live_provider_limit('openai',    false, 0,            false, 'Launch <date>: images off until qualified (D8)');
-- (Images only after qualification + approval:
--  select makeborne_private.set_live_provider_limit('anthropic', true, <0.85*X>, false, '...');
--  select makeborne_private.set_live_provider_limit('openai',    true, <0.15*X>, false, '...');)
commit;

-- 2. Creation switch: Codex's billing gate, only after the six production plan rows are enabled and verified.
--    update makeborne_private.billing_settings set creation_enabled = true where singleton;   -- free_tier_enabled stays false

-- 3. Readback after.
select public.makeborne_provider_spend_status('anthropic');   -- expect {"available": true}
select public.makeborne_provider_spend_status('openai');      -- expect {"available": false, "reason": "paused"} (text-only)
select public.makeborne_provider_spend_health();
```

Pass `true` as the fourth argument only to clear an **overrun** emergency stop after an operator has reviewed it. Never pass it routinely.

### 3.3 Environment per deployment

| Variable | Production (to open) | Staging (qualification only, separately approved paid allowance) | Local |
|---|---|---|---|
| `MAKEBORNE_LIVE_BUILDER_ENABLED` | unset or `true` (anything except `false`) | currently `false`; unset only for the approved qualification window | as needed |
| `ANTHROPIC_API_KEY` | production key (owner), with a provider-side monthly limit | separate staging key with its own small provider limit | dummy for UI work |
| `MAKEBORNE_EXPERT_CHAT_ENABLED` | owner decision: `false` unless advisor chat is in launch scope and qualified | `false` unless being qualified | — |
| `MAKEBORNE_BUILDER_MODEL` | unset (`claude-opus-5-5`) | unset | — |
| `MAKEBORNE_BUILDER_FALLBACK_MODELS` | unset | unset | — |
| `MAKEBORNE_AI_COST_USD_PER_CREDIT` / `MAKEBORNE_USD_PER_CREDIT` | unset (0.03) | unset | — |
| `OPENAI_API_KEY`, `MAKEBORNE_IMAGE_MODELS`, `MAKEBORNE_IMAGE_MODEL` | unset for text-only; set only after D8 qualification and approval | set only for an approved image qualification | unset |
| `MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED`, `MAKEBORNE_PRESENTATION_SUBMISSIONS_ENABLED` | off (operator path) | off | — |
| `SUPABASE_SECRET_KEY`, `MAKEBORNE_CLOUD_ENABLED`, `MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED` | present / `true` / `true` (Codex verifies) | same | local values |
| Billing (`WHOP_*`, `WHOP_CREATION_ENABLED`, `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED`) | Codex's production mapping (B4/B5) | sandbox per `docs/BILLING_PLAN_CREDITS.md` | — |

## 4. Emergency shutdown runbook

**Fastest stop (seconds, no deploy).** As the DB owner on the affected project:

```sql
select makeborne_private.set_live_provider_limit('global', false, 0, false, 'EMERGENCY STOP <time UTC> by <name>: <reason>');
```

**What it stops.** Every new paid call, on every path, starting with the next call:
- the live builder, plan, questions, expert chat and the lead finder;
- the durable dispatch trigger.

They all go through `open_provider_call`, which raises `MB423` when `global` is disabled (`20261012150000…:52-54`). Preflight answers `paused` at once, so new requests are refused with 503 `AI_PAUSED` "AI generation is paused right now. Nothing was charged. Please try again later." before any credit hold exists.

To stop one provider only (for example images), disable that scope instead: `('openai', false, 0, false, '…')`.

**Behaviour of calls already in flight:**
- **A provider call that already started** is not interrupted by the database. It runs to completion or to its own hard timeout: at most min(600 s, the run deadline), and the run deadline is ≤ 280 s after the request (`route.ts:36`, `AI_SPENDING.md` "Hold lifetime"). It is then closed and charged once to the provider ledger. Rehearsed: the in-flight call closes once, and a replay changes nothing.
- **Residual exposure** is at most the sum of the bounds of calls open at the moment of the stop, which is what `reservedMicrousd` shows in health.
- **A run's next call** is refused, so the run stops with `AI_PAUSED`:
  - The operation finishes as `failed`, its credit hold is released, and **the customer is charged 0**.
  - Measured usage is recorded as absorbed.
  - Validated partial work is offered as a recoverable draft (`operation-server.ts:267-276`; `ai_operation_cancellation.sql` lines 88 and 137-140).
- **Calls left open by a killed process** expire at their bound after 20 minutes (`expire_provider_calls`).
- **Studio tabs that are already open** keep their last availability until reload. Their next Send gets the 503 paused message.

**How to verify that the stop held:**
1. `select public.makeborne_provider_spend_status('anthropic');` → `{"available": false, "reason": "paused"}` (also for `'openai'`).
2. `select public.makeborne_provider_spend_health();` → `global.enabled=false`, `dailyLimitMicrousd=0`. `openCalls` falls to 0 within about 5 minutes (≤10 at most), and `staleOpenCalls=0` after 20 minutes. `reservedMicrousd` falls to 0, and `spentMicrousd` stops increasing.
3. No new rows: `select count(*) from makeborne_private.live_provider_calls where created_at > '<stop time>';` → 0.
4. App: `GET /api/build` → `{"available":false,"configured":true,"state":"paused"}`. A signed-in Send shows the paused copy, and the user's balance is unchanged.
5. Provider console: usage flattens within about 10 minutes.

**Belt and braces, if the DB itself is unreachable:**
- Set `MAKEBORNE_LIVE_BUILDER_ENABLED=false` and `MAKEBORNE_EXPERT_CHAT_ENABLED=false` and redeploy. This takes minutes and doesn't affect calls in flight.
- Last resort: revoke or disable the production provider key in the provider console. This has the widest blast radius and needs a key rotation to recover.

**Automatic stop that already exists.** A call whose actual cost exceeds its bound sets `emergency_stop=true` on its provider scope. This persists until an operator clears it with `p_clear_stop=true` after review (`20261012150000…:112-116`).

**Restore after a stop:** run the §3.2 statements again with the approved amount and a note naming the incident review.

**Local rehearsal.** `supabase/rehearse-generation-open-stop.sql` was run in one rolled-back transaction on the local stack and passed: open (global and anthropic enabled, openai off), refusal at the daily limit (`MB402`), refusal after the emergency stop (`MB423`), preflight `paused`, in-flight close exactly once, and health readback. The local limits afterwards were unchanged (all disabled at 0).

## 5. Verification steps for staging (after owner approval of a small, separate qualification allowance)

1. **Record the allowance first.** Reserve a dedicated amount, for example $3 total, in the qualification ledger. It is separate from the existing $1 cloud reservation, and the daily limits are not a substitute for it.
2. **Read before.** Read the staging gate and switch state read-only, and save `spend_health` and `billing_settings`.
3. **Set staging limits.** Use §3.2 against the staging project only, with `global=anthropic=` the approved amount (e.g. 3000000) and `openai` disabled. For the qualification window, set `MAKEBORNE_LIVE_BUILDER_ENABLED` unset/true on the staging preview, with a staging-only provider key carrying its own provider limit.
4. **Run as a fresh non-admin staging fixture with real sandbox credits** (the Codex billing path):
   - (a) the paused state before step 3 shows the visible reason;
   - (b) one Medium website build saves a version and charges ≤ 50 credits;
   - (c) one Plan charges ≤ 10;
   - (d) questions are not charged;
   - (e) the balance and `ai_run_outcomes` match `live_provider_calls`.
5. **Emergency-stop drill.** Disable `global` while a second build is running. The current call finishes, the run stops with `AI_PAUSED`, the charge is 0, and recovery is offered. Then complete the five §4 verification checks.
6. **Restore.** Return staging limits to disabled/0, set `MAKEBORNE_LIVE_BUILDER_ENABLED=false`, then retire the fixture and revoke its sessions.
7. **Report.** Record actual spend against the allowance, with the exact deployment and commit.

## 6. Ownership summary

- **Owner:**
  - approve the operating amount X and the provider-console backstop;
  - decide on images at launch, launching without per-user caps, and expert chat in scope;
  - approve a small staging qualification allowance;
  - execute or authorize the DB-owner SQL.
- **Codex:** creation switch and production plan rows/env (B3–B5), credit delivery (B6), env verification (B7/B8), the staging qualification run (B10), and integrating the UI fix below into the candidate if accepted.
- **Claude:** this document, the paused-state fix plus its check, the open/stop rehearsal SQL, and price re-verification on opening day if asked.
