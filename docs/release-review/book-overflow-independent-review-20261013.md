# Book body overflow — independent reproduction, 2026-10-13

Two P2 rendering defects reproduced against `src/lib/documents/render-book.ts`, SHA-256 `d7aa0583c66fcd38cafa47b1835d5590774368470cc5526c8ff13be27759b4c4`. The renderer was not edited. All fixtures pass the actual `DocumentSourceSchema`; no model/provider or external network calls were made.

## 1. Valid maximum-length contents titles are silently clipped

Locations: fixed contents pagination at lines39/52–54; compact contents CSS at lines97–98; `.full` has fixed nine-inch height and `overflow:hidden`.

Fixture: 40 chapters, each title exactly120 characters made from normal words, using the default book theme. The fixed18-entry compact pages wrap the titles onto three lines.

| Render | First two contents page heights | Scroll height | Entirely invisible entries per page | Entries extending past bottom per page |
| --- | --- | --- | --- | --- |
| Preview | 864px | 1452px | 7 | 8 |
| Print media | 863px | 1452px | 7 | 8 |

Actual Chromium PDF output was rasterized with Poppler. Page4 visibly cuts chapter11 at the bottom and omits chapters12–18. The next contents page repeats the clipping for its corresponding18-entry group. The final four-entry page fits. This is lost visible content in both preview and PDF, despite all40 entries existing in the HTML.

The existing `check-book-body.cjs` contents check only counts sections and searches HTML strings with short titles. It does not establish physical fit. The narrow correction should account for wrapped title height when assigning contents pages, or use a conservative layout that demonstrably fits the schema maximum. Do not truncate chapter titles or merely hide overflow.

## 2. Valid unbroken Markdown table cells overflow and lose print content

Locations: table CSS at lines125–128. Automatic table sizing and normal wrapping allow one unbroken token to dictate table width.

Fixture: one chapter containing a valid two-column Markdown table; the first data cell contains800 alphabetic characters without spaces and the second contains `This row must remain visible in a printed book.` The chapter is well below the40,000-character limit.

Preview measurements: table width5664.016px versus437.766px usable wrapper width inside the576px page; table extends5166.734px beyond the chapter edge. Document horizontal scroll width becomes5855px. The cell's computed `overflow-wrap` is `normal`.

Actual Chromium print PDF is five pages at432×648pt (6×9in). Rasterized page5 shows only the first table heading and the beginning of the long token. The entire second column is absent. Independent `pdfplumber` extraction of page5 likewise contains no `Notes` heading or second-cell sentence. Print-media DOM width alone was not treated as print proof; the PDF raster and extracted text corroborate the loss.

The narrow correction should constrain table/column widths and allow long unbroken content to wrap in cells. Verify both preview and actual PDF with the valid fixture; ordinary table appearance and long-table pagination should remain covered by owner tests.

## Reproduction and evidence

Run from the repository root:

`node work/book-overflow-review-20261013/check.cjs`

Ignored evidence directory: `work/book-overflow-review-20261013/`.

- `check.cjs`: actual TypeScript loader, schema validation, browser measurements, preview screenshots and Chromium PDF generation.
- `contents.json`, `table.json`: valid synthetic source fixtures.
- `measurements.json`: renderer/schema hashes and all row/table bounds.
- `contents-preview.png`, `contents-print-page4.png`: independently inspected screenshots/rasterized print page.
- `table-preview.png`, `table-print-page5.png`: independently inspected print clipping evidence.
- `contents-print.pdf`, `table-print.pdf`: actual Chromium PDFs (86 and5 pages respectively).
- `pdf-text-evidence.json`: independent PDF text extraction and page geometry.

The sources are synthetic boundary fixtures, not generated product-quality samples. No shared renderer, schema, export implementation or owner tests were changed by this reviewer.

## Independent closure after Claude's fix

Both original P2 findings are resolved for the exact original fixtures. Reran the unchanged harness in `work/book-overflow-recheck-20261013/`, preserving all original failure evidence. Original and copied harness SHA-256 are identical: `4d357959db11bc77a51f465909a89e63b1be14c10a98eb3ea0a7890383fa2d33`. Corrected renderer SHA-256: `d3c10c5cf72e20a68533e85deebdf6f3510293674e8c03504430a8c76251bb15`.

- **Contents:** now five pages. Every preview page is 864 px high with scrollHeight 864; every print-media page is 863 px high with scrollHeight 863. Zero rows beyond or clipped at the bottom on all ten measured pages. Actual Chromium PDF is 88 pages, each 432 × 648 pt; all 40 chapter entries are present on contents PDF pages 4–8. Poppler raster of page 4 and the preview screenshot were independently inspected: readable text, complete rows and remaining bottom space.
- **Long table cell:** preview table width is 437.765625 px, exactly its usable wrapper width (previously 5664 px), and document scrollWidth is 800 px at an 800 px viewport. Actual five-page Chromium PDF page 5 shows both columns without clipping. Independent PDF cell extraction confirms all 800 token characters exactly match the fixture and the complete Notes sentence survives (normalizing only automatic line-break hyphenation). Poppler page 5 raster and preview screenshot were independently inspected.

Recheck evidence includes `measurements.json`, `pdf-text-evidence.json`, preview PNGs, both actual PDFs, and `contents-print-page4.png` / `table-print-page5.png` in the new directory. No source fix or broader test scope was introduced. This closes the two reproduced defects on the local Chromium/font environment; it does not claim fresh model quality or qualification of other operating-system fonts.
