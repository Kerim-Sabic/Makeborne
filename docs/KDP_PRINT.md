# Initial KDP paperback profile validation

Source review date: **2026-10-03**. Rule version: `kdp-paperback-6x9-2026-10-03`.

## Implemented scope

`src/lib/artifacts/print.ts` validates measurements supplied to a deterministic profile validator. It does not render or inspect PDF bytes, submit a book, place an order, or establish Amazon acceptance. The report explicitly retains `renderedFilesVerified: false` and `amazonAcceptance: false`, even when supplied metadata passes.

The initial profile supports 6×9 inch, left-to-right paperback interiors **without bleed**. Hardcover, groundwood, alternative trim sizes, RTL and interior bleed remain outside this validator. They remain in the broader product roadmap; unsupported values are rejected rather than called ready.

## Ink and paper

Effective page count rounds up to even, as KDP describes. A declared odd count produces a warning; actual rendered page count must match the declared count and the complete cover uses the effective count.

| Profile | Effective page range |
|---|---|
| Black ink, white paper | 24–828 |
| Black ink, cream paper | 24–776 |
| Premium colour, white paper | 24–828 |
| Standard colour, white paper | 72–600 |

Colour with cream paper is rejected. These are the reviewed 6×9 paperback limits, not hardcover limits or a promise about every marketplace. [Paperback submission table](https://kdp.amazon.com/en_US/help/topic/G201857950), [Ink and paper options](https://kdp.amazon.com/en_US/help/topic/G201834180).

## Margins

The no-bleed interior stays 6×9 inches. Top, bottom and outside margins each need at least 0.25 inch. Minimum inside/gutter margin rises with effective page count:

| Pages | Minimum gutter, inches |
|---|---|
| 24–150 | 0.375 |
| 151–300 | 0.5 |
| 301–500 | 0.625 |
| 501–700 | 0.75 |
| 701–828 | 0.875 |

Profiles with no remaining usable content area are rejected. A later bleed implementation must use different interior dimensions and margins. [Trim, bleed and margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6).

## Cover geometry and documentation discrepancy

The complete cover is a separate single-page PDF containing back, spine and front. Cover bleed remains 0.125 inch on the outer edges even when the interior has no bleed. Width is 12.25 inches plus spine; height is 9.25 inches.

The dedicated cover guide lists spine factors of 0.002252 inch per page for black/white and standard colour, 0.0025 for black/cream, and 0.002347 for premium colour. Its generic counterpart lists colour collectively as 0.002347. The implementation uses the **dedicated cover guide**, records that discrepancy, and requires final reconciliation against the official calculator/template before metadata can pass. [Cover guide](https://kdp.amazon.com/en_US/help/topic/G201953020), [Generic guide](https://kdp.amazon.com/en_US/help/topic/G201857950), [Official calculator](https://kdp.amazon.com/cover-calculator).

Spine text uses an 80-effective-page threshold and at least 0.0625 inch inset on each side. Cover text requires 0.25 inch distance from the file outer edge, including bleed. Geometric comparisons use a 0.001 inch implementation tolerance; this is a software comparison tolerance, not an Amazon-specified production allowance.

## Image resolution

`effectiveImageDpi()` divides actual retained raster pixels by actual placed inches on each axis, accounting for supplied pixel crop dimensions. Both axes need at least 300 DPI. A changed metadata DPI tag does not enter the calculation. Crop measurements exceeding source pixels are rejected. A full inventory of placed raster images is required; an absent inventory remains unknown. [Image guidance](https://kdp.amazon.com/en_US/help/topic/G202169030).

For example, 1200×1800 pixels placed at 4×6 inches gives 300 DPI. At 6×9 inches it gives 200 DPI. Cropping to 900×1800 pixels and placing at 4×6 gives 225 minimum DPI. Enlarging the displayed DPI metadata does not change those results.

## Supplied PDF observations

`validatePaperbackMetadata()` checks separate files, declared PDF type, nonempty size, page count, dimensions, individual interior pages, consistent dimensions, fonts, encryption, transparency, marks, annotations/bookmarks, placeholders/creation marks and minimum font size. Missing observations produce **unknown**, not a silent pass. Font minimum is 7 points, which is an eligibility floor rather than the product's preferred reading typography. File size is conservatively interpreted as 650,000,000 bytes. [Submission requirements](https://kdp.amazon.com/en_US/help/topic/G201857950).

`passed_metadata` means the supplied observations satisfy this limited validator. It does not prove they are truthful or complete. A future trusted inspector must obtain observations from actual files, record hashes and artifact versions, and preserve its report. Visual pagination, absent/missing content, barcode placement, colour handling, metadata matches and physical proof still require their own checks. [Formatting fixes](https://kdp.amazon.com/en_US/help/topic/G201834260).

## AI disclosure

Applicable generated text, images or translations produce a disclosure reminder. Generated covers and interior images remain AI-generated even after editing. This reminder does not submit the disclosure or verify rights. [KDP content guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).

## Integration

- `KdpPaperbackProfileSchema`: initial supported values and page ranges.
- `calculatePrintGeometry(profile)`: exact arithmetic for interior, cover, gutter and effective count.
- `effectiveImageDpi(placement)`: placed raster resolution.
- `validatePaperbackMetadata(input)`: failure/unknown/warning findings with sources.
- `printProfileFromBook(book, editionId, actualPageCount)`: maps an existing BookSpec print edition to this reviewed profile. Other print profiles remain unsupported here; the broader BookSpec is not silently narrowed.

The current digital PDF export must not use this validator's presence as evidence of print readiness. An actual print renderer and inspection pipeline are still necessary.
