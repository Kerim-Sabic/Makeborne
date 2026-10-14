# Book openings and navigation — 2026-10-13

## Scope and provenance

This is a local renderer correction following the fresh root-owned paid package `ac4b08bd-b91f-47bb-9956-c6d719505738`. Changes began only after root confirmed all seven calls settled and the launcher/guard/provider limits were stopped. This package made zero provider calls, database mutations, cloud changes, deployments or commits.

Original generated outputs remain under `outputs/fresh-product-quality-ac4b08bd-b91f-47bb-9956-c6d719505738/book`. The original saved JSON SHA256 remains `488e65d3649e5f78b3781b0172473af105f84f0993ffcbd50bd3a6e58a45eb7b`.

## Changes

- Optional chapter `opening: "page" | "inline"`. Omission keeps the existing separate-page opener and does not materialize a new stored default. Inline places the heading, optional epigraph/art and body in one chapter section; body text can still flow across pages.
- A supplied custom label is authoritative and suppresses the independent automatic numeral. Labels in any language, including an intentionally empty label, are handled without English heuristics. Unlabelled chapters retain existing automatic labels/numerals.
- Contents entries link to stable chapter anchors, in both preview and exported PDF. Compact contents retain the existing packing calculations and label/title columns. No fabricated printed page numbers.
- Book-only model guidance favors inline openings for short practical guides when a standalone page adds neither artwork nor a useful pause. Tool guidance describes the choice and preservation during edits.
- No front-matter, chapter prose, markup grammar, deck renderer, or slide prompt edits by this package. Root's shared prompt corrections coexist with the narrow book paragraph.

## Derived demonstration, not fresh generation

`outputs/derived-book-openings-ac4b08bd-b91f-47bb-9956-c6d719505738` contains the PDF, saved JSON, HTML, all 16 page PNGs, two section preview PNGs, derivation evidence and PDF navigation evidence. Exactly two document fields were manually added: `intro.opening="inline"` and `final-checklist.opening="inline"`. An inverse comparison proves every other document field matches the original.

The PDF was produced by the actual `documentPdf` implementation with network-blocked Chromium. All 16 PDF pages were visually inspected: no clipping, overlap, missing text or glyph defects observed. The original is 17 pages; this derived copy is 16. Introduction now shares its heading/body on one page. Three main chapter openers remain deliberate separate pages, now without conflicting numerals. The checklist's last two bullets continue onto a sparse final page. This remains an editorial limitation, not a completed claim of exceptional polish. Original prose continuity error about when the damaged cable was discovered is preserved, not silently repaired.

All five preview links were clicked and landed within one pixel of their target. Actual PDF annotations on contents page 4 resolve to pages **5, 6, 9, 12, 15**, and each destination's extracted text identifies the intended section. Native PDF destinations were inspected with PyMuPDF; actual PDF text/page geometry was rasterized for visual inspection. This local Windows font environment does not establish Linux font fidelity. Generated images remain unqualified (none requested).

## Checks

- `node src/lib/documents/check-book-openings.cjs`: **7/7 groups** — legacy omission, explicit modes, invalid mode rejection, unlabelled numeral parity, arbitrary/multilingual labels, inline image/epigraph/body, editor preservation and schema/tool guidance, unique links/anchors in both modes.
- `node src/lib/documents/check-book-body.cjs`: **8/8**. Only its exact contents assertion changed to account for the new closing anchor.
- `node src/lib/documents/check-cover-composition.cjs`: **10/10**. Only two book hashes updated; the no-label single-chapter fixture's entire DOM outside styles was compared with the frozen pre-change renderer and is unchanged. Deck hashes remain unchanged.
- Focused ESLint for all changed/new owned files: **0 errors, 0 warnings**.
- Reusable local derivation helper: `node scripts/derive-book-openings.cjs <original-saved-version.json> <new-output-directory>`. Refuses existing output directories, validates the source schema, compares the inverse edit, checks original SHA256 after export, blocks browser network, and records the postprocessing provenance.

## Compatibility and handback

Existing documents parse and keep separate-page behavior when opening is absent. Custom labels intentionally change rendered numeral behavior; multi-chapter contents gain links. A previously deployed strict schema will reject new saved documents containing `opening`; rollback must retain schema/renderer support rather than stripping that field. No database migration is needed or performed.

Owned files handed back: `src/lib/documents/schema.ts`, `render-book.ts`, `editor.ts`, new `check-book-openings.cjs`; narrow assertion/hash updates in `check-book-body.cjs`, `check-cover-composition.cjs`; book-only paragraph in `src/lib/builder/docs-prompt.ts`; new `scripts/derive-book-openings.cjs`; this report. The parent will run combined checks and independent review before any release decision.

Runtime SHA256 at handback:

| File | SHA256 |
| --- | --- |
| schema.ts | e5e63b901d9e8beea1e8bb0d5bbe7c5bc113d57b6244f8f1bd9d729fd341d33a |
| render-book.ts | 7efc3a7f57461f07e7b8a0896e79b196aac12747a6669c509de0de7c432fa5ec |
| editor.ts | 28ff049b8d9091c7a4d09b39c7e63a843dc8a7d815ecb00a530f11cbbc75ecd8 |
