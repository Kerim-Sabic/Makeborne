# Fresh product quality qualification plan — 2026-10-13

Status: local preparation only. No paid calls, cloud writes, generated samples or quality pass claimed. Root alone reserves a package from the shared API round. This document does not authorize execution.

## Readiness

- Credential presence: `.env.local` contains an Anthropic key; no OpenAI key. Neither key is present in the current process environment or `.env.builder-test.local`. Key validity/model entitlement has not been tested. Values are never included in evidence.
- Explicit launch configuration proposed: `claude-opus-5-5`, no fallback models, internal credit rate `$0.03`, images disabled. The current builder defaults to that text model; local env has no model override.
- Current [Anthropic model documentation](https://platform.claude.com/docs/en/models/overview) and [pricing](https://platform.claude.com/docs/en/about-claude/pricing), read today, agree with the code: input $4, output $20, five-minute cache write $5 and cache read $0.20 per million tokens. Thinking is billed as output. Existing bounds allow a 1.1 regional multiplier. No fast mode, paid server tools or one-hour cache.
- Shared round `api-budget-round-20261013.json`: $50 newly allocated, Codex $20 / Claude $20 / reserve $10; each spent/reserved $0 at inspection. Do not reuse the previous $25 authorization.
- Read-only loopback database inspection: 29 settled calls account for $4.014661; 6 uncertain calls account for $7.270483. Total $11.285144, reserved $0; matches historical evidence. All provider scopes are disabled. Unknown usage remains charged at its bound.
- `scripts/prepare-fresh-quality.mjs` only reads local source/config and a read-only transaction on the exact isolated loopback database. It emits key-presence booleans, current round ledger, baseline call IDs, reconciliation and source hashes. It cannot enable limits or make provider requests. Capture its output immediately before reservation and again after every operation.

## Actual paths and required local preparation

The current customer path is `/api/build` → `beginOperation` → `createOperationSpend` → `documentBuildResponse` / `websiteBuildResponse` → `runDocumentBuilder` / `runBuilder` → `budgetedStream`. Document tools write into `DocumentEditor`, validate schema/fit/assets at finish, and save a version. PDF/PPTX export must use the saved version through the document-export endpoint and existing `export-server.ts`.

`scripts/qualify-products.mjs` is stale: its request lacks the operation envelope now required by `/api/build`, and its fixture map reuses historical artifact IDs. `scripts/local-quality-server.mjs` hardcodes the old $25 round. Neither should be executed unchanged. The separate durable `qualification-proposal.ts` path is also historical: round-1 tariff expired October 10, and it does not support books. Do not refresh that tariff merely to bypass the active product path.

Before spending, root must prepare a separate isolated launcher with no inherited cloud/provider configuration except the approved Anthropic credential, exact loopback database and API, dedicated local port/build directory, explicit model/rate, OpenAI disabled, and only the reserved package available in global/Anthropic limits. Preserve the previous ledger, record its baseline IDs and all-day aggregate, prevent reset across UTC midnight, disable limits on exit and after the package, and refuse any overlapping unreserved consumer. Daily limits alone are not a cumulative shared-round cap.

Use new UUID-backed project/artifact identities with version 0 and no selected style (`automatic`). Store the brief on the project. Each explicit action uses a persisted unique `operation: {actionKey, stepKey}`; record returned operation/run IDs and source version. Replaying a transport request must reuse its keys. No automatic continuation, new action, paid review, top-up or fallback outside the reserved call plan. If incomplete, inspect and report first. Any later continuation must use the same operation's remaining authorization and a separately reviewed request count.

Freeze source hashes after Claude's document work, before calls; retain hashes again at export. Keep fresh artifacts under a new `outputs/fresh-product-quality-<run-id>/` folder. Preserve raw events, first generated source, subsequent edit source, provider usage, screenshots and exports. Never overwrite the first result or hand-polish it before assessment.

## Exact proposed package — $6 maximum

| Action | Effort | Operation cap | Maximum model attempts |
|---|---|---:|---:|
| New short book | high | $2.70 | 16 turns × at most 3 attempts = 48 |
| New eight-slide deck | high | $2.70 | 16 turns × at most 3 attempts = 48 |
| One targeted deck chat edit | light | $0.60 | 8 turns × at most 3 attempts = 24 |

These are 3 `/api/build` requests, at most 120 streaming attempts total and one free token-count request per run, all attempts sharing their operation cap. The actual attempt count is output-dependent, not exactly one model call per build. No image calls. API duration is 300 seconds with an earlier builder deadline. Internal SDK retries are off; explicit retries are bounded by the same spend authority. A provider overrun stops the run/scope and must be reported; the $6 is the enforced authorization bound, not a guarantee against provider misbilling.

### Book brief (no visual preset selected)

Create a complete short practical ebook titled **The Repair Table**, for volunteers running a monthly community repair cafe. Write 1,200–1,600 useful words in three substantive chapters: receiving an item and agreeing its scope; organizing a safe, respectful repair conversation; recording the result and a clear handover. Use a clearly fictional small-appliance example without hazardous electrical repair instructions. Include a short introduction, contents, a reusable intake checklist, a worked before/after record, and a concise final checklist. Make it a readable 6×9 inch portrait ebook ready for PDF export. Choose a coherent visual identity suited to this subject; do not add invented endorsements, citations or missing image placeholders.

### Deck brief (no visual preset selected)

Create an eight-slide proposal titled **Keep the Wheels Turning** for Tern, a fictional independent bicycle workshop proposing a simple maintenance membership to its local customers. Explain the customer problem, what is included, what is excluded, a three-step member journey, a comparison of two clearly fictional sample plans, a native editable chart using explicitly illustrative quarterly visit counts 12, 18, 25 and 30, a realistic launch timeline, and a clear next step. Use useful speaker notes and concise persuasive content. Choose a distinctive visual identity for Tern. Keep native text, shapes and chart editable in PowerPoint. Do not invent testimonials, real results or working checkout links.

### Exactly one chat edit, after first-version inspection

On the chart slide, change the second quarterly visit count from 18 to 21. Update that slide's explanatory text and speaker notes only where needed. Preserve all other slides, the deck theme, slide order and cover composition.

Identify the chart slide by its actual visible title/index in the final request; do not assume an index before generation. If the initial deck omits the requested chart, record that failure and stop before the edit instead of silently repairing the brief.

## Inspection and acceptance

1. **Freshness/completion:** generated source starts from empty new artifacts; finish event is true, version saves, no silent unresolved tool errors. Record supplied brief versus actual contents, titles, word/slide counts and unsupported requests. One sample is evidence, not a general quality guarantee.
2. **Automatic art direction:** judge subject-specific palette/type/hierarchy, authored cover geometry, meaningful diagrams, spacing and consistency. Compare book and deck identities. Optional cover composition now supports native rect/ellipse/line/text/image frame primitives with validated bounds/contrast/semantic title. Missing composition remains legacy rendering; do not claim a bespoke cover simply because that fallback rendered.
3. **Book:** inspect every preview and every rasterized PDF page at readable resolution, cover/title/contents/chapter transitions, trim 432×648 points, running heads/page numbers, text clipping, blank/near-empty pages, awkward breaks and missing assets. At current source, chapter markup supports paragraphs, headings, lists, quotes, notes and figures; native tables/worksheets/body diagrams are not available. Assess useful checklist content honestly and distinguish that renderer limitation from weak writing. Do not add unsupported structures by hand.
4. **Deck:** inspect all eight HTML slides at 1280×720 and all PDF pages at 960×540 points. Check title/body fit, no overlap/clipping, data and labels, notes, diagram legibility and meaningful layout variety. Inspect PPTX package for native text/shapes, native chart data, notes and correct slide count; verify content edit affected the chart cells/text and source as intended. Re-export edited PDF/PPTX and re-inspect the affected slide plus a full-deck comparison.
5. **Edit preservation:** compare first/edit saved source; stable IDs, unchanged unrelated slides, theme and cover, exact changed chart value 21. Confirm actual UI preview reflects the saved edit and exports match it.
6. **Visual evidence limits:** bundled Poppler is available for PDF rasterization. Native PPTX XML proves native objects, not PowerPoint visual fidelity; this runtime inventory did not locate bundled LibreOffice. If no supported presentation renderer is available, record actual Office/LibreOffice rendering as unqualified. Windows preview fonts do not prove production Linux font fidelity.
7. **Accounting:** reconcile every new provider-call ID to operation/run and the root reservation; retain input/output/cache tokens and model, actual versus uncertain cost, settled credit charge, per-run totals and all-day delta. Count missing usage at its reserved bound. No stale historical uncertain call is reclassified as free.

## Website follows separately — proposed additional $2.70

After book/deck findings, one fresh `high` build (at most 48 streaming attempts plus one free count request) for **Cinder Archive**, a fictional oral-history recording studio: useful services, example project stories explicitly fictional, process, package comparison, accessible navigation and an honest enquiry interaction. No style preset or prescribed palette/layout. Inspect mobile 390px and desktop 1440px, every link/button/form, overflow, contrast and build/export validity. Evaluate first output before any separately reserved chat repair. No publication or public hosting activation.

Historical `outputs/product-qualification` and synthetic `outputs/authored-cover-qualification` establish baseline behavior only. Their manually revised or synthetic compositions are not fresh model-quality evidence. Images remain blocked/unqualified until a separately approved, bounded image package with a real configured credential is possible.

## Native PowerPoint inspection update

Microsoft PowerPoint is installed at the standard Office16 path. Root opened the existing synthetic grid-deck.pptx and inspected both slides in the application on 2026-10-13. It opens without a repair warning and preserves visible composition geometry. The application reports Unlicensed Product, so editing/save controls are disabled; no authentication or license change was attempted. Use it for fresh-deck visual inspection, but retain the distinction between rendered appearance, native XML structure and actually editing/saving. Evidence: powerpoint-native-inspection-20261013.json. No fresh generated deck is qualified by this fixture check.
