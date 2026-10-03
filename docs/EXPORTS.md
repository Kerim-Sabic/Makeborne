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
