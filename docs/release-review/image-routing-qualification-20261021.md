# GPT Image routing and spend controls: local qualification, 21 October 2026

Evidence for the owner's decision on setting `MAKEBORNE_IMAGE_MODELS` in production. Nothing was changed in production or staging, and nothing was pushed.

- **Code under test:** branch `qualification/image-routing` at `9c2a933` (`feature/lovable-integration` merged with main `70a1d91`). It includes per-task routing (`image-router.ts`), D8 measured bounds ×1.5, auto-disable on overrun (`image-health.ts`), responsive copies and the cross-browser fixes. The coordinator's follow-up fix `9e37cf0` (Plan-mode "undefined credits") was not cherry-picked. Every build here used Create mode, which that fix doesn't touch.
- **How it was run:** I drove the real app routes (`POST /api/cloud/.../projects`, `.../artifacts`, `POST /api/build` with SSE, `POST /api/chat/brief`) on `next dev --webpack` at 127.0.0.1:3161. The app was signed in through `/login` as the local quality fixture (`work/release-auth-stack/quality-fixture.json`; password never printed). The database was the isolated release-auth stack (API 55435, DB 55438). Before the first request, each run checked that the client bundle inlines exactly `http://127.0.0.1:55435`.
- **Provider keys:** read from the primary checkout's `.env.local` into the dev process env only. `MAKEBORNE_IMAGE_MODELS` was also set only in that process. The scan of `outputs/image-routing-qualification-20261021/` found none of the key, secret-key or password literals (`scanForSecrets`: 120 files, 0 hits).
- **Network:** a `--require` preload in the dev process allowed only loopback, `api.anthropic.com` and `api.openai.com`. Over the session it refused 8 `fonts.googleapis.com` and 4 `registry.npmjs.org` connections (`network-guard-log.txt`). The browser context aborted every non-loopback request too.
- **Provider gate:** before each case the driver checked that the gate was idle (all scopes disabled, no emergency stop, nothing reserved today). It then enabled `global`/`anthropic`/`openai` at today's use plus that case's bound, and afterwards disabled them and read them back. Nothing else used the gate during the session.
- **Migration:** `20261020203000_scope_revocation_boundaries.sql` is **not** applied on the local stack, and these runs didn't need it. `20261020210000_artifact_card_previews.sql` is applied. No migration was applied.

Outputs (not committed): `outputs/image-routing-qualification-20261021/<case>/`. Each case folder has `item.json`, the raw `build.sse` and timed `build.events.jsonl`, and `cost.json`. `cost.json` holds the ledger reservations, every `live_provider_calls` row with bound, actual, latency and status, and the limit read-backs. Each folder also has `assets.json` (stored asset provenance including the router's record), `images/*.webp` (stored bytes) with `*.png` copies for inspection, `source/` (saved version files), `receipt.json` (the studio's run receipt computed by `run-receipt.ts` from the same events) and `log.txt`. The driver, preload and case briefs are in the session scratchpad; the briefs are copied to `outputs/.../cases.json`.

## Budget and ledger

- **Allowance:** `qualification-20261021`, "Kerim, chat 2026-10-21": Claude ≤ $20.00, OpenAI ≤ $3.00, scope total ≤ $20.00. It is recorded in the shared ledger `outputs/eval/budget/ledger.json`, separately from design round 3.
- **Ledger-wide cap:** one `capApprovals` record (`scope: qualification-20261021`) took the cap from **$194.31 to $214.31 (+$20.00)** and the ledger-wide OpenAI cap from **$4.06 to $7.06 (+$3.00)**. Entries were untouched.
- **Locking and compatibility:** the raise was written under the module's own `ledger.lock`. I wrote it only after checking, on a temp copy, that the design worktree's module accepts the raised ledger. That module already reads a higher, separately approved cap and treats scoped rows as another allowance. During the session its round-3 entries kept landing next to ours (ledger-wide committed went from $108.82 to $120.54 while we ran).
- **Module change** (`scripts/eval/lib/budget.mjs`, committed here):
  - `reserve({ scope })` checks the ledger-wide cap and the ledger-wide provider caps, then the allowance's own total and provider caps.
  - `raiseAllowance(scope)` adds exactly the allowance's amount to the current caps, once.
  - `scopeSummary(scope)` reports the allowance's own totals.
  - Self-test: 70/70, including 9 new allowance checks.
- **Reservations:** every case reserved its worst case before any paid call. Website builds reserved $1.50 at Medium and $0.60 at Light for Anthropic, plus up to 3 images × $0.0648 for OpenAI; the advisor brief reserved $0.10. Each reservation was settled from the server's own `live_provider_calls` once the operation was quiet.

| | Anthropic | OpenAI | Total |
|---|---|---|---|
| Allowance | $20.00 | $3.00 | $20.00 |
| Settled in the ledger | **$1.8925** | **$0.2597** | **$2.1522** |
| Of which billed by a provider | $1.8925 | $0.1587 | $2.0512 |
| Of which mocked (no provider contact, recorded at the mocked usage) | – | $0.1010 | $0.1010 |

Two driver attempts failed before any provider contact and were settled at $0: a sign-in page timeout, and a crash after a successful advisor call. I settled that advisor call by hand at its recorded $0.000282. A third attempt was refused by the app (`QUOTE_CHANGED`, see the harness findings). Nothing is open or unknown in the allowance.

## Every paid call

All amounts come from `makeborne_private.live_provider_calls`. "Reserved" is the per-call bound held before the call and "actual" is what was charged. Latency is the time from opening the hold to closing it. Image rows also show output tokens against the bound's output tokens.

| Case | Provider | Model | Size | Quality | Purpose | Reserved | Actual | Latency | Output tokens / bound |
|---|---|---|---|---|---|---|---|---|---|
| A | Anthropic | claude-opus-5-5 | – | medium effort | builder step 1 | $0.4049 | $0.1278 | 9.8 s | |
| A | OpenAI | gpt-image-2.5-flare | 1536x1024 | medium | chalkboard menu, text | $0.0213 | $0.0112 | 10.4 s | 343 / 515 |
| A | OpenAI | gpt-image-2.5-sunburst | 1024x1536 | medium | shop sign, exact text | $0.0210 | $0.0111 | 17.3 s | 343 / 515 |
| A | OpenAI | gpt-image-2 | 1024x1024 | low | linen texture | $0.0084 | $0.0061 | 10.2 s | 196 / 217 |
| A | Anthropic | claude-opus-5-5 | – | | builder steps 2–4 | $0.3868 / $0.3679 / $0.3634 | $0.1722 / $0.0575 / $0.0213 | 61.1 / 4.2 / 7.7 s | |
| B | Anthropic | claude-opus-5-5 | – | | builder step 1 | $0.4040 | $0.1260 | 9.4 s | |
| B | OpenAI | gpt-image-2.5-flare | 1024x1024 | medium | mug cut-out, transparent | $0.0240 | $0.0136 | 11.7 s | 439 / 659 |
| B | OpenAI | gpt-image-2.5-flare | 1536x1024 | medium | workshop photo | $0.0195 | $0.0108 | 12.1 s | 343 / 515 |
| B | OpenAI | gpt-image-2.5-sunburst | 1024x1536 | medium | open-studio poster, text | $0.0210 | $0.0111 | 15.1 s | 343 / 515 |
| B | Anthropic | claude-opus-5-5 | – | | builder steps 2–6 | $0.389–0.419 each | $0.0644 / $0.1747 / $0.1105 / $0.1101 / $0.0440 | 8.6–58.9 s | |
| C | Anthropic | claude-opus-5-5 | – | | builder steps 1–4 | $0.336–0.402 each | $0.1242 / $0.0162 / $0.1553 / $0.0658 | 3.5–55.1 s | |
| C | OpenAI | gpt-image-2 | 1024x1024 | medium | waffle cone (opaque photo) | $0.0610 | $0.0531 | 28.4 s | 1,756 / 1,784 |
| C | OpenAI | gpt-image-2 | 1536x1024 | medium | kiosk photo, no text | $0.0490 | $0.0418 | 27.4 s | 1,372 / 1,384 |
| D | Anthropic | claude-opus-5-5 | – | light effort | builder step 1 | $0.3989 | $0.1101 | 7.9 s | |
| D | OpenAI (**mock**) | gpt-image-2.5-flare | 1024x1024 | medium | workshop photo, mocked token overrun | $0.0250 | $0.0213 (mocked) | 1.5 s (mocked) | **689 / 659** |
| E | Anthropic | claude-opus-5-5 | – | light effort | builder step 1 | $0.3989 | $0.1098 | 5.4 s | |
| E | OpenAI (**mock**) | gpt-image-2.5-sunburst | 1024x1024 | medium | fitting-room photo, mocked dollar overrun | $0.0248 | **$0.0797** (mocked) | 1.5 s (mocked) | **2,636 / 659** |
| F | Anthropic | claude-opus-5-5 | – | light effort | builder steps 1–3 | $0.348–0.402 each | $0.1079 / $0.1441 / $0.0503 | 3.1–55.3 s | |
| M14 | Anthropic | claude-haiku-5-5 | – | Standard | advisor brief draft | $0.0010 | $0.0003 | 2.6 s | |

**End-to-end image latency** (SSE `image_start` to `image`, including WebP re-encoding, storage and responsive copies):
- 2.5 models: 11–18 s.
- `gpt-image-2` at medium: 28–29 s.
- `gpt-image-2` at low: 10.6 s.

**Hold before contact:** each image hold row was opened 2–7 ms before the preload saw the request leave for `api.openai.com`, all on the same machine. `startBudgetedImage` awaits `spend.begin` before calling the client.

## Routing: observed against expected

All routes below are from the stored asset provenance (`route.model / quality / size / reason / costMicrousd / outputTokens`). Each one matches the stream's `image` event and the run receipt's `images` list.

| Case | Request (tool fields) | Allowlist | Expected | Observed | |
|---|---|---|---|---|---|
| A1 | chalkboard menu, `text` = 4 lines, placement loose | flare, sunburst, gpt-image-2 | gpt-image-2.5-flare | flare, medium, 1536x1024, "text in the image needs a 2.5 model" | ✅ |
| A2 | shop sign, `text` = TALLOW & THYME, `textPlacement` exact | same | gpt-image-2.5-sunburst | sunburst, medium, 1024x1536 | ✅ |
| A3 | texture, no text | same | cheapest at low: gpt-image-2 | gpt-image-2, **low**, 1024x1024, "cheapest allowed model for a low texture" | ✅ |
| B1 | `kind` cutout | same | a 2.5 model, transparent | flare, medium, 1024x1024, stored with alpha, trimmed to 882x867 | ✅ |
| B2 | photo, no text | same | cheapest adequate at medium: a 2.5 model ($0.019 bound against gpt-image-2's $0.049) | flare, medium, 1536x1024, "cheapest allowed model for a medium photo" | ✅ |
| B3 | illustration poster with text | same | flare if loose, sunburst if exact | sunburst: the builder chose exact placement | ✅ for the input given (see the records gap) |
| C1 | kiosk photo, `text` = HARBOUR LIGHTS | gpt-image-2 only | tool error, then the words in HTML/CSS | tool error, then a text-free gpt-image-2 photo with an HTML overlay | ✅ |
| C2 | waffle cone "on a transparent background" | gpt-image-2 only | a clean failure, or an opaque alternative | the builder never asked for a cut-out (the tool description says cut-outs are unavailable) and generated an opaque photo, placed in a framed panel | ✅ (no refusal needed) |
| F1 | `kind` cutout, explicitly | gpt-image-2 only | clean tool error | tool error "Transparent cut-outs need a GPT Image 2.5 model…"; the builder drew the spoon as an SVG component (`src/components/Spoon.tsx`), no image asset | ✅ |
| D1 | photo, no text | gpt-image-1, flare, sunburst, gpt-image-2 | flare; gpt-image-1 excluded | flare; server log: `Image model left out. gpt-image-1 is never routed (provider shutdown 2026-10-23)` | ✅ |
| E1 | photo, no text, same server process after D | same | flare stopped, so sunburst | sunburst; server log: `Image model left out. gpt-image-2.5-flare is stopped after an overrun until reviewed` | ✅ |

**Retired model (item 5):** `gpt-image-1` was in the live allowlist for D and E and was left out with a log line at every configuration read. It was never routed. Offline, `allowedImageModels` at 2026-10-23T00:00:01Z excludes it the same way.

**Output tokens per (model, quality, size) were identical on every call:**
- 2.5 models: 343 for medium portrait and landscape, 439 for medium square.
- `gpt-image-2`: 196 for low square, 1,372 for medium landscape, 1,756 for medium square.

These match the 2026-10-20 research and the earlier `gpt-image-2` qualification exactly. The ×1.5 headroom on the 2.5 bounds is ample. `gpt-image-2`'s documented bounds have 0.9% (landscape) and 1.6% (square) headroom at medium, and 9.7% at low.

## Text legibility and spelling

I opened every text image at full size and checked the lettering, zooming into a crop where the letters were small (`A-text/images/60268f26-zoom.png`).

| Image | Requested text | Rendered | Result |
|---|---|---|---|
| `A-text/images/16767465.png` (flare, chalkboard) | TONIGHT / LEEK & POTATO SOUP 6 / BEEF SHIN PIE 14 / TREACLE TART 5 | the same four lines in chalk; prices aligned right | ✅ exact, legible |
| `A-text/images/60268f26.png` (sunburst, fascia) | TALLOW & THYME, placed exactly | gold serif capitals, centred on the green fascia board | ✅ exact, placed as asked |
| `B-cutout/images/539ff1e6.png` (sunburst, poster) | OPEN STUDIO / SATURDAY 9 NOVEMBER / KILN & CO | three lines, bold condensed type under the mug | ✅ exact, legible |

**Text-free images:** no stray lettering in any image generated without text (the texture, workshop, kiosk, cone and mug). The kiosk's sign board is blank, as intended. The `gpt-image-2` kiosk photo was asked for words that the router refused, and it came back with a clean blank board.

**Cut-out:** a clean alpha edge. Two specks a few pixels wide are left in the transparent margin at the lower right, which is cosmetic.

## Fallback (`MAKEBORNE_IMAGE_MODELS=gpt-image-2` only)

- **Text in an image:** the builder received the tool error *"Text in an image needs a GPT Image 2.5 model, which isn't enabled. Generate the image without text and set the words in HTML/CSS over it."* (`tool_error` event, `C-fallback/build.events.jsonl`). It then generated the photo without text and set the words over it. `src/App.tsx` has `<span className="sign" aria-hidden="true">HARBOUR LIGHTS</span>` inside the hero `.photo` block, and `site.css` positions `.sign` absolutely over the image. The name also appears as real text in the image's `alt` and in the footer.
- **Transparent cut-out:** refused cleanly with *"Transparent cut-outs need a GPT Image 2.5 model, which isn't enabled. Use a photo whose background matches its frame, or CSS/SVG artwork."* (case F). There was no provider call and no reservation for the refused image. The builder replaced it with an SVG.
- **Nothing silently dropped:** every refused hard need produced a `tool_error` event the studio shows. Case C2 shows that the tool description already steers the builder to an opaque photo before it asks.

## Spend controls

1. **Hold before the call, settle at actual, receipts.**
   - Every image and text call opened its `live_provider_calls` row at its bound before contacting the provider, and was settled at the reported usage (`status settled`, `charged = actual`).
   - The image route record on each asset, the SSE `image` event and the run receipt all carry the same model, quality, size, reason and cost.
   - **Operation outcomes** (`ai_run_outcomes`): for every build, measured credits = ⌈provider cost / $0.03⌉. A: $0.407 → 14. B: $0.665 → 23. C: $0.456 → 16. D: $0.131 → 5. E: $0.189 → 7. F: $0.302 → 11. Uncertain $0 throughout. The provider totals equal the ledger settlements.
   - The fixture account is exempt (outcome `exempt`, charged 0, absorbed = measured). The customer-charging arithmetic for a paying account was therefore not exercised in this run.
2. **Token overrun (MOCK, case D).**
   - **Method:** the dev process's preload answered one `images.generate` locally, without contacting OpenAI, with `output_tokens` = bound + 30 (689 against 659). No application code was changed.
   - **Result:**
     - The call settled at its mocked actual, $0.02127, inside its $0.02497 dollar bound.
     - The server logged `{"event":"image_model_overrun","model":"gpt-image-2.5-flare",…,"outputTokens":689,"boundTokens":659,"action":"routing to this model is stopped until reviewed"}`.
     - The run stopped immediately: no further provider call, and the stream ended `error BUILD_INCOMPLETE` after 11 s with the previous version kept.
     - In the next build in the same process (E), flare was left out and the router chose sunburst.
     - The database row records the token excess in `detail` (`outputTokens`, `boundOutputTokens`). `overrun` is false because the dollar bound held, so the database emergency stop was not tripped (correct).
3. **Dollar overrun (MOCK, case E).**
   - **Method:** the same mock with `output_tokens` = 4 × bound (2,636).
   - **Result:**
     - The call was charged its mocked actual, $0.07968, against a $0.02484 bound, so `overrun = true`.
     - `close_provider_call` set **`openai` `emergency_stop = true`**.
     - `makeborne_provider_spend_status('openai')` returned `{"available":false,"reason":"paused"}`.
     - Sunburst was stopped for routing (log line) and the run ended `BUILD_INCOMPLETE`.
     - In a rolled-back transaction, with `global` and `openai` re-enabled but the stop left in place, `makeborne_provider_call_begin(…'openai'…)` was refused with `MB423 Live AI provider spending is disabled or stopped`.
     - I then cleared the stop on the local stack with `set_live_provider_limit('openai', false, 0, true, …)` and recorded the reason.
4. **The ledger cap logic was never approached:** the allowance is at $2.15 of $20.00, and the ledger-wide total at $120.54 of $214.31.

Only the two overrun calls were mocked; real overruns cannot be produced on demand, because the measured token counts are deterministic. Both mocks are labelled in the table above and in `network-guard-log.txt` (`MOCK images.generate …`).

## M14 advisor brief (`POST /api/chat/brief`)

- **Success:** HTTP 200 in 5.6 s, one `claude-haiku-5-5` call (bound $0.000997, actual $0.000282). The outcome recorded **measured 1 credit** (inside the 1–3 range; the hold is 3), with charged 0 and absorbed 1 because the fixture is exempt.
- **Failure:** the daily limit was set to leave $0.0005, below the call's bound. The gate refused before any provider contact and the route returned HTTP 503 `AI_DAILY_LIMIT` "…Nothing was charged…". The outcome recorded **released**, measured 0, charged 0, provider $0 (`detail.code` `PROVIDER_LIMIT`, `reason` `brief_failed`).
- **Not covered:** a failure *after* partial provider usage releases at confirmed usage (`spend.customerCredits`), not at zero. That case was not exercised here.

Evidence: `outputs/image-routing-qualification-20261021/M14-advisor/result.json`.

## Findings that are not blockers

1. **The stop after a token overrun is per server instance and not persisted** (already documented in `AI_SPENDING.md`, D8). Other instances keep routing to the model until they see their own overrun. The database stop, which persists across instances, trips only on a dollar overrun. Because the token counts are deterministic per size and quality, a token overrun would mean the provider changed its counts, and every instance would hit it on its next call of that cell.
2. **An overrun ends the whole build** with `BUILD_INCOMPLETE`, and nothing from that run is saved (D and E). This fails closed for spend but costs the customer the run. It never happened on a real call: every real call stayed at its deterministic count.
3. **`gpt-image-2` medium headroom is under 2%** (see above). It is routed at medium only when no 2.5 model is allowed or both have been stopped. If OpenAI's counts for it ever rise slightly, it will trip the token stop (fail closed).
   - At low it is routed for textures. There it used the same 196 tokens at the same rates as a 2.5 model would (actual ≈ $0.006 either way); only its hold is smaller (≈ $0.008 against ≈ $0.011).
   - Dropping it from the allowlist would therefore cost almost nothing in actual spend, and would remove the near-bound fallback.
4. **Records gap:** the stored route record and its `reason` don't include `textPlacement`. "Sunburst because exact placement" can only be inferred from flare being the default. Suggestion: add the placement to `reason`.
5. **Eval harness (not product):**
   - `scripts/eval/run.mjs` doesn't send `approvedMaximum`, so a live run against this code would be refused with `QUOTE_CHANGED`. I hit this and added it to my driver.
   - `verifyServerIdentity` cannot read webpack dev bundles, where modules sit in eval strings. My driver checked the inlined URL in the escaped form instead.
   - Worktrees also need `npm run prepare-runtime` for `loadApp`.

## Verdict

**Qualified for production activation.** With `MAKEBORNE_IMAGE_MODELS=gpt-image-2.5-flare,gpt-image-2.5-sunburst,gpt-image-2`:
- Routing matched the owner's rules on every live image.
- All three text images were spelled exactly.
- The fallbacks returned clear tool errors and the builder used HTML/CSS or SVG instead.
- `gpt-image-1` is excluded.
- Holds open before contact and settle at actual.
- The per-model stop, the run stop and the database emergency stop all behaved as designed. The two overrun checks used labelled mocks.

This is a local qualification: it is not a production activation and changes nothing there. Activation still needs these owner steps:
- set the variable;
- keep `OPENAI_API_KEY`;
- enable the production `openai` provider scope with an approved daily cap (its production state was not checked here);
- accept limitation 1 above.

Findings 2–4 are improvements, not conditions.
