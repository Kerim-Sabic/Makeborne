# Image editing: live qualification plan (outstanding), 23 October 2026

Status: **not run.** There are no approved OpenAI funds for this work. Image editing ships disabled (`MAKEBORNE_IMAGE_EDITING` unset, `MAKEBORNE_IMAGE_EDIT_MODELS` unset, `MEASURED_EDIT_TOKENS` empty, no agency setting qualified for `image_edit`). Every edit is refused before any operation, hold or call. Running this plan needs an explicit owner-approved OpenAI allowance recorded in the budget ledger (`outputs/eval/budget/ledger.json`, kind `openai-image-edit-qualification`) first.

## Why live calls are needed (official docs, checked 2026-10-23)

| Fact | Source | Consequence |
|---|---|---|
| Edits endpoint supported by gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-image-2 | model pages (`/api/docs/models/<id>`, "Image edit v1/images/edits: Supported") | candidates |
| Sunburst "for workflows where editing precision matters most"; Flare "fastest ... everyday image generation" | same | precision edits → Sunburst; restyles/variants may use Flare |
| Rates: text input $5, image input $8, image output $30 per 1M (2.5 and gpt-image-2) | `/api/docs/pricing` | rates known |
| Input-image token rule published **for gpt-image-1 only** (shut down 2026-10-23) | `/api/docs/guides/images-vision` "GPT Image model inputs" | input-image cost per source/reference/mask is **unknown** for every callable model |
| gpt-image-2 processes all image inputs at high fidelity; edits "can use more input tokens" | image-generation guide, "Image input fidelity" | no bound from generation prices |
| A mask adds "additional instructions" (size unpublished); masking is prompt-based, "may not follow its exact shape" | image-generation guide, "Edit an image using a mask" | mask text tokens must be measured; never promise pixel preservation |
| Cached input pricing does not apply to `/v1/images/edits` | guide, "Cached input pricing" | bound at full rates (done) |
| Each partial image adds 100 output tokens | guide, "Partial images cost" | streaming/partials refused (done) |
| `usage` documented "For gpt-image-1 only" in the edit reference | `/api/reference/resources/images/methods/edit` | must verify usage is actually returned per model; a cell without usage cannot be measured and stays refused |
| Transparent background: documented for 2.5; "in preview" for gpt-image-2 | edit reference, `background` | cut-outs only on 2.5 |

## Calls (24 image calls + 3 end-to-end instruction steps)

All at `quality: "medium"`, `n: 1`, `output_format: "png"`, no streaming, `maxRetries: 0`, inputs normalised by `normaliseForEdit` exactly as in production, on an isolated local stack with the real ledger gate (`makeborne_ai_operation_provider_begin` / `close_provider_call`). One call at a time; stop on the first overrun, refusal or missing usage for that model.

| # | Model | Size | Operations (one call each) | Calls | Proves |
|---|---|---|---|---|---|
| 1 | gpt-image-2.5-sunburst | 1024x1024 | background_replace, object_remove (mask), object_replace (mask), extend (auto-mask, square source shrunk to 80%), relight_restyle, variant, cutout (transparent), variant + 3 references | 8 | usage returned on edits; input image tokens per normalised image; mask text tokens; output tokens; real alpha on cut-out; exact output size |
| 2 | gpt-image-2.5-sunburst | 1536x1024 | same 8 (extend from a square source to landscape) | 8 | the landscape cell |
| 3 | gpt-image-2.5-flare | 1024x1024, 1536x1024 | relight_restyle, variant, variant + 1 reference | 6 | routine cells; whether Flare's counts equal Sunburst's (they did for generation; edits are not assumed) |
| 4 | gpt-image-2 | 1024x1024 | relight_restyle, variant | 2 | routine comparison (no transparency) |
| 5 | end-to-end | 1024x1024 | full flow through the route with the Claude instruction step (Opus 5.5 "standard" setting, 2 turns max), Sunburst edit, accept on one block, export PDF/PPTX and GitHub snapshot, publish preparation | 3 | the whole path, settlement, provenance, resolvers |

Also verify once (no extra call): a duplicate submission replays without a call; Stop during a call; the 180 s timeout path is not exercised live.

## Cost estimate (from published rates; input-image counts are a planning assumption, not a bound)

- Planning assumption per input image: 6,500 tokens (gpt-image-1's published high-fidelity square figure of about 4,354 tokens, rounded well up for gpt-image-2-family high fidelity). Output: 2,000 tokens (above gpt-image-2's published medium square 1,785 and the 439 measured for 2.5 generation).
- Worst planned call (source + mask + reference = 3 images, 1,000 text tokens): (1,000 × $5 + 19,500 × $8 + 2,000 × $30) / 1M × 1.1 = **$0.243**.
- 24 image calls × $0.243 = **$5.83**; 3 instruction steps at their bound (2 × (6,000 in × $5.5 + 1,200 out × $22) / 1M) = 3 × $0.119 = **$0.36**.
- **Requested allowance: $6.50 OpenAI + $0.50 Anthropic.** Expected actual spend if 2.5 edits behave like 2.5 generation: roughly $1–2.

## After the run

1. Record each call (model, size, operation, usage, latency, output checks) in `docs/release-review/image-edit-qualification-<date>.md` and the raw rows in `outputs/eval/image-edit/<date>/results.jsonl`.
2. Fill `MEASURED_EDIT_TOKENS` with the largest observed counts per (model, medium, size); `maskTextTokens` only where masked calls were observed. Bounds then apply ×1.5 headroom and ×1.1 (owner sign-off needed: this extends D8 to edits).
3. Qualify the agency setting for `image_edit` (`AGENCY_SETTINGS`) with the run's evidence; set `MAKEBORNE_IMAGE_EDIT_MODELS` only on an approved environment; turn `MAKEBORNE_IMAGE_EDITING=on` only with the owner's approval.
4. Any cell without returned usage, any overrun, or any wrong-size/non-alpha result stays refused.
