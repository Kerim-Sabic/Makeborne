# Fresh deck and targeted edit: independent review

Reviewed the original paid outputs in `outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/deck` and `deck-edit`. This review made no provider calls and preserved those outputs. All eight original PDF page rasters were visually inspected.

## Confirmed renderer defect and bounded fix

On the member journey (slide 4), all three headings visibly occupy one line at the same baseline, but the estimated middle heading height is 63 scene pixels versus 34 for the outer headings. Descriptions were positioned separately below those estimates: middle y=486.76 versus outer y=457.76. The resulting 29 px offset is visible in the actual PDF and measures 25.375 px in the 1120 px preview.

Only the process branch in `src/lib/documents/slide-scene.ts` changed. It retains label placement, text, font sizes, circles and connecting line, collects the largest existing label height, and places sibling descriptions after that shared label row. The timeline branch and global text estimator are unchanged. This preserves enough room for genuinely wrapped labels while aligning descriptions in both HTML and native PowerPoint geometry.

Checks:

- `node src/lib/documents/check-process-alignment.cjs`: **32 actual Chromium cases passed**, covering eight font pairings, original and synthetic mixed label lengths, preview and print media; 16 wrapped labels and 80 single-line labels observed. Checks common description top, text inside slide bounds, and no label/detail overlap. Browser scripting disabled and all network requests blocked.
- `node src/lib/documents/check-documents.cjs`: **13 checks passed**.
- Focused ESLint for the two owned files: **0 errors/warnings**.
- `check-cover-composition.cjs` was attempted but stopped at its first **book** snapshot assertion while the separate book renderer fix was active (actual d5f96829… versus expected 0908c508…). That owner was notified; this review did not repin or claim that suite passed.

Separate derived outputs are at `outputs/fresh-deck-process-rerender-20261013/deck` and `deck-edit`, each containing source-preserving PDF/PPTX rerenders and provenance. These are rerenders of the paid saved source, not new model output. Independently inspected the corrected slide-4 Chromium preview and Poppler PDF raster: all descriptions align, no collision or clipping. Both derived native PPTX files place the three description shapes at the same y=4636389 EMU. Original paid PDFs/PPTX were not overwritten. Native Office rendering is root-owned and is not claimed by this review.

Owned source hashes:

- `slide-scene.ts`: `1f2bc1a3eaf28f4e20aa2ca286fb382e6b5275d4b0beaea57d0a04a5c7094b58`
- `check-process-alignment.cjs`: `c1bb7faa9f01b3e05a11d88ac8a281a798d638a27e0fd263b0c70776d9ab8f71`

## Targeted edit and native chart verification

Independent recursive comparison of the original saved document and edited saved document found exactly two changed paths: `/slides/5/chart/series/0/values/1` and `/slides/5/notes`. Both belong to the `visits` slide. All other slides, slide order, theme, assets, title, subtitle and author remain unchanged. The notes update keeps the spoken numeric example consistent with the requested data edit.

Inspected actual original PPTX ZIP/XML plus its embedded XLSX: a native column chart exists with values **12,18,25,30**, updated to **12,21,25,30** in the edit. The embedded workbook's B2:B5 values match both respective chart caches. Derived rerenders preserve those native chart values. This is structural editability evidence, not a substitute for PowerPoint rendering or interaction.

## Remaining content/design weaknesses

- The cover contains `[Presenter name]`; the closing slide contains `[month]`, `[date]`, `[your email]` and `[shop phone]`. These visibly prevent a presentation-ready result until the owner supplies details or the content omits them. They are generated-content weaknesses, not renderer defects; root owns the generic prompt correction.
- Slide 3 describes priority booking and puncture labour as membership-wide benefits, while the sample-plan slide explicitly lists them only under Commuter Care. The journey also broadly promises labour included for quick fixes. The scope should be reconciled before customer use.
- The closing slide asks to approve a pilot, which addresses an internal decision-maker more than the requested local-customer audience. The launch timeline is likewise an internal plan. Root owns content/audience guidance.
- The chart's takeaway repeats the illustrative caveat and occupies substantial space. The slide remains readable and its source is clearly marked illustrative; this is an editorial weakness, not an overflow defect.

The deck has a coherent workshop identity, useful diagrams, native editable data, and readable body text in the inspected local PDFs. The findings above remain relevant; the narrow spacing fix alone does not make the paid output ready to present or prove quality across other font environments.
