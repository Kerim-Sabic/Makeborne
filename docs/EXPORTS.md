# Current export contract

Exports run only through the localhost development route. Production export responds with 503 until authenticated durable workers, tenant storage and quotas are connected. No export invokes a paid provider.

## Supported content

- HTML: escaped native text, supplied artwork, style colour/font and authored website sections. No executable user HTML, network resources or functional contact-form backend.
- Digital PDF: native text plus supplied raster artwork, chapter breaks and cover layout. This is an A4 digital document, not a KDP paperback interior.
- Native PPTX: editable text and placed artwork with speaker notes. It does not claim pixel parity with complete generated slide images.
- Visual PPTX/PDF: one complete supplied image per slide; text remains part of that image. The canvas is inferred or explicitly selected from 16:9, 3:2, 4:3 and 1:1. Images must share that ratio within one percent; incompatible inputs are rejected rather than cropped. Native manual drafts default to native mode; the generation domain's default remains visual mode.
- EPUB: reflowable EPUB package with escaped XHTML chapters, navigation, cover artwork, language and an explicit or generated document identifier. Author metadata is included only when supplied. Typography adapts to the reader; it does not reproduce PDF pagination.

## Resource and input bounds

Request bodies are bounded at 18 MB; the local process permits two concurrent exports. There are at most 150 blocks or 40 explicitly supplied slides. Raster artwork accepts PNG/JPEG/WebP data URLs only, with actual format and decoded pixel checks: 3 MB per input image, 12 MB distinct input artwork, 4096 pixels per side and 16,777,216 pixels. Decoding normalises orientation and sRGB, strips metadata, and enforces output/time bounds. Remote URLs, SVG and file paths are not accepted. Original workspace artwork remains unchanged.

PDF rendering disables script execution, blocks network requests and closes its browser after rendering. These controls are a development boundary, not a complete production sandbox or tenant quota system.

## Evidence and limits

The illustrated custom-style book fixture produced a four-page PDF with artwork and extractable chapter text; its cover was rendered and visually inspected. The full visual slide fixture produced one picture and zero rendered text objects in slide XML. The supplied venture artwork is 1672×941, approximately 16:9. Its PowerPoint canvas is 12192000×6858000 EMU. This package inspection does not establish visual rendering in PowerPoint.

The sample EPUB passes official EPUBCheck 5.4.0 with zero errors or warnings. The validator reported EPUB 3.4 rules; this is a bounded fixture check, not blanket validation of every future export, Kindle rendering or Amazon acceptance. The fixture preserves script-looking text as escaped readable content.

A separate 3:2 artwork fixture produces a 12192000×8128000 EMU PowerPoint canvas. An explicit incompatible 16:9 request returns 400 SLIDE_ASPECT. This checks canvas handling only; the artwork fixture is not a claim of a newly generated slide.

Implementation references: [Sharp metadata](https://sharp.pixelplumbing.com/api-input/), [PptxGenJS image API](https://gitbrent.github.io/PptxGenJS/docs/api-images/), [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/) and [EPUBCheck releases](https://github.com/w3c/epubcheck/releases).

## Authored direction refinement

The six authored direction IDs now select dedicated website, book and native-slide compositions in HTML/PDF and the local preview. Native PowerPoint uses larger editable statement layouts for short slides, with restrained native vector details for Signal and Atlas; it is not a pixel-identical HTML export.

Books use artwork as the cover only when the image is the first authored block. Images in chapters remain in place, and cover captions stay visible. HTML/PDF contents link to the actual heading IDs; supplied author/language metadata are respected. Native presentations preserve image-block captions in their text flow.

Native PDF slides now have a print-layout overflow check. Content that exceeds its slide returns SLIDE_CONTENT_OVERFLOW with the affected slide numbers, preserving the source instead of silently cropping text or making one logical slide span several PDF pages. This revision has compiled successfully; representative rendered output and overflow behaviour still need runtime verification. Earlier fixture evidence above does not prove these new layouts.

## Rendered review, 3 October 2026

The local development export endpoint was exercised after the authored-direction changes. Signal produced a two-page 16:9 PDF; both pages were rendered and inspected. A Field Guide fixture produced four A4 pages with chapter artwork still on page 3, an intact visible caption, and two contents-link annotations. Moving that same artwork explicitly to block zero produced a four-page document with the image only on cover page 1. The first cover attempt exposed a fifth page containing a stranded decorative rule; the fixed cover layout now keeps artwork, caption and rule on one page. The page background now also reaches the PDF margins.

Both Signal and base Editorial rejected a 4,485-character slide with HTTP 400 SLIDE_CONTENT_OVERFLOW. Native PPTX slide XML retained the image caption. The Form HTML fixture was inspected in the browser at desktop and 390px widths; measured mobile document width was 375px with no horizontal overflow. Production build passed after the fixes.

This evidence covers the named fixtures only. PowerPoint rendering, all style/content combinations, extremely long cover captions, customer-generated imagery and production worker/auth flows remain unverified. Temporary sample exports and the reproduction driver live under the task's work/artifact-review and work/review-artifact-exports.mjs; they are not customer deliverables or generated client work.

### Saved book publishing details

Book author and language now live in optional project `bookMetadata`, so workspace save/restore retains them. Existing projects without metadata use an empty author and English. Exports read these project values; changing them updates the project timestamp and reopens internally approved work. Imported valid language tags outside the preset list remain visible as a saved-language option.

Validation: production build passed and lint reported zero errors (two existing image warnings). Four schema assertions passed for older workspaces, metadata JSON round-trip, author length, and invalid language tags. Browser reload and a fresh exported-file metadata inspection remain unverified for this change.

### Live metadata export evidence

After the saved-metadata change, POST requests to the running local `/api/export` returned 200 for EPUB and HTML using author `Mira & Co` and language `pl`. Inspection of the returned EPUB ZIP confirmed escaped author text in `dc:creator`, `pl` in `dc:language`, and matching XHTML language/byline. Returned HTML contained the matching language and escaped byline. These checks exercise the real export route, not a mocked renderer. They do not exercise project editing/reload, PDF metadata, or reader compatibility.
