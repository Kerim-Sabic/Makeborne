# GPT Image 2.5 research for the website builder

20 October 2026. Owner approval: "Kerim, chat 2026-10-20: +$2 OpenAI image research". Direct Images API calls from a scratch script (not app code), each reserved at a worst-case bound in the eval ledger (provider `openai`, sub-cap $2.06) before the call and settled from the response's `usage`. No retries. Evidence: `outputs/eval/image-research/20261020/` (`results.jsonl`, the images, `sheet-cutouts.jpg`, `sheet-illus.jpg`), ledger kind `openai-image-research`.

## Spend

16 calls: 15 completed, 1 refused (400). Measured $0.1825; the refused call stays counted at its $0.02 bound (no usage returned), so the ledger commits $0.2025 of the $2.00 approved. OpenAI total in the ledger: $0.2556 of the $2.06 sub-cap.

## Cost per image (measured usage, $30/M image output, $5/M text input)

| Model | Quality | Size | Output tokens | Cost | Latency |
|---|---|---|---|---|---|
| 2.5 flare | low | 1536x1024 | 158 | $0.0055 | 14.1 s |
| 2.5 sunburst | low | 1536x1024 | 158 | $0.0055 | 16.3 s |
| 2.5 flare | medium | 1536x1024 | 343 | $0.0111 | 15.3 s |
| 2.5 sunburst | medium | 1536x1024 | 343 | $0.0111 | 18.1 s |
| 2.5 sunburst | high | 1536x1024 | 1,372 | $0.0419 | 31.7 s |
| 2.5 flare | medium | 1024x1536 | 343 | $0.0108–0.0111 | 8.8–10.2 s |
| 2.5 flare / sunburst | medium | 1024x1024 | 439 | $0.0137 | 9.0–17.5 s |
| 2.5 flare | low | 1024x1024 | 196 | $0.0063 | 8.7–14.7 s |
| 2.5 flare | low | 2048x1152 (custom) | 157 | $0.0053 | 11.0 s |
| gpt-image-2 (earlier qualification, for reference) | medium | 1024x1024 | 1,756 | $0.0530 | — |

Observations:
- Output tokens were identical for the same size and quality across both 2.5 models, different prompts (bakery, bookkeeping illustration, ceramic dripper, coffee bag, engineer, paper texture) and opaque or transparent backgrounds: low 158/196, medium 343/439 for landscape-portrait/square. This looks deterministic per (size, quality), like gpt-image-1's published table, but OpenAI documents no per-image count or maximum for 2.5, so it is evidence, not a bound.
- A 2.5 medium image costs about a quarter of gpt-image-2 medium ($0.011–0.014 vs $0.041–0.053). Text input is negligible (78–155 tokens).
- Squares cost more than 3:2 images at the same quality. A 2048x1152 custom low image cost the same as a 1536x1024 low one.

## Quality (reviewed by eye)

- Hero photography (bakery counter, 1536x1024): all four (flare/sunburst × low/medium) followed the composition brief (subject in the right two thirds, calm wall for a headline), palette and "no text". Low is already client-grade at web sizes; sunburst medium was the most natural and candid; flare medium had warmer, more saturated light. High (31 s, 4x the cost) added detail not visible at 1440 px.
- Illustration (gouache/cut paper on bottle green): both models on palette, with the requested empty top band; sunburst more painterly, flare flatter. Both drew ledger rules but no legible text, as instructed.
- Texture (low): a clean, low-contrast paper tile, usable as a CSS background.
- Wide custom size (2048x1152 low, van at blue hour): excellent; useful for full-bleed bands at the price of a low 3:2.

## Transparent backgrounds

- `background: "transparent"` worked on both 2.5 models with `output_format` webp and png: a real alpha channel, 44–56% fully transparent pixels for objects, 72% for a full-length person, clean edges over a gradient and a contrasting disc (`sheet-cutouts.jpg`). WebP cut-outs were 96–162 KB from the API and 65–131 KB after the builder's WebP re-encode, against 1.5 MB for PNG: always use WebP.
- `gpt-image-2` rejects it: HTTP 400 `invalid_value` "Transparent background is not supported for this model." So cut-outs need a 2.5 model (or gpt-image-1 until its 23 October shutdown).
- Trimming matters: the dripper occupied 916x812 of 1024x1024 and the engineer 517x1487 of 1024x1536. The builder now trims to the subject plus a 3% margin, so CSS places the object rather than empty canvas.

## Builder strategy (implemented)

| Asset | Kind | Model and size | Quality | Placement |
|---|---|---|---|---|
| Hero and full-bleed bands | photo | landscape 1536x1024 | medium | `object-fit: cover` in an aspect-ratio frame, `object-position` for phones, `fetchPriority="high"` on the hero only |
| Split and portrait slots | photo | portrait 1024x1536 | medium | bleeding off the viewport edge; mask-image fades into the ground |
| Concept and service art | illustration | square or landscape | medium | one technique for the whole site |
| Products, objects, people layered over colour fields, shapes, type or other images | cutout (transparent) | square or portrait | medium | positioned in grid cells or over colour blocks, overlapping section edges, `filter: drop-shadow()` (follows the alpha), never inside a boxed card |
| Paper, linen, stone surfaces | texture | square | medium (low would save $0.007 but the price card only covers medium) | CSS background on a decorative element, never behind body text |

- Tool: `generate_image` takes `kind` (photo, illustration, cutout, texture). `cutout` requests `background: "transparent"` only on models in `TRANSPARENT_IMAGE_MODELS` (`src/lib/ai/prices.ts`); otherwise the tool tells the model to use a photo on a matching background. The tool result now returns the real `width` and `height` (after trimming), so every `<img>` gets its size and nothing shifts.
- Storage (`prepareImageBytes`, `src/lib/builder/images.ts`): WebP; cut-outs trimmed to the subject with alpha quality 95; an image that came back opaque is reported as opaque. Provenance records `background` and `imageKind`.
- Prompt template (system prompt, IMAGERY): subject and action specific to the business, composition and camera with calm space for text, light, three or four palette colours named from the site tokens, material details, the site's house-style sentence (appended verbatim to every prompt), then "No text, letters, signage, logos or watermarks." Text and logos stay in HTML.
- Spending: unchanged. Every call is reserved at its price-card bound before the provider is contacted; the run's image share stays at most a third of its allowance.

## Decision needed (owner): D8 for the 2.5 models

The 2.5 models still have no bounded price card in the app (`MEASURED_IMAGE_OUTPUT_TOKENS` is empty, decision D8 and the 2026-10-13 review: a sample is not a maximum). This research did not change that. With images on today, only `gpt-image-2` can run (opaque only, about 4x the cost of a 2.5 image).

If the owner accepts the measured counts as the bound (with the existing overrun stop, which halts the provider scope on any call above its bound), the change is one entry per model in `MEASURED_IMAGE_OUTPUT_TOKENS`, e.g. medium `{ "1024x1024": 659, "1024x1536": 515, "1536x1024": 515 }` (439/343 × 1.5 headroom, rounded up), citing this file. Worst case per medium image would then be about $0.020 (square). Then set `MAKEBORNE_IMAGE_MODEL=gpt-image-2.5-flare` (fastest, same tokens and quality class as sunburst; sunburst for edit work). Without that decision, setting `MAKEBORNE_IMAGE_MODEL` to a 2.5 model only logs "Image generation is off" and builds continue without images. `gpt-image-1` is refused from 2026-10-23 either way.
