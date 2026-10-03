# Owned artifact contracts

## Implemented boundary

`src/lib/artifacts/index.ts` exports concrete Zod contracts for SiteSpec, BookSpec, DeckSpec, ProjectContext and versioned styles. These are declarative data contracts and pure adapters. They do not constitute a completed visual editor, production generation pipeline, publishing system or KDP validator.

The original `domain.ts` ContentBlock remains the body format. Native text is not replaced by a parallel free-form HTML format. The local editor's current flat blocks and cloud ArtifactContent can be converted without inventing business claims or generated output.

## Shared contract

- `schemaVersion: 1`, UUID artifact ID, kind, title, language and authorship.
- Explicit style reference containing ID and version.
- Declared source UUIDs and an asset manifest.
- Structural IDs unique within each artifact. Asset IDs occupy a separate namespace.
- Reference validation rejects missing asset/source declarations.
- Strict structured objects reject unknown content fields.
- Body text preserves literal markup examples and prompt-like source strings as data. Bounded strings reject XML-forbidden controls and unpaired Unicode surrogates. Strict object schemas reject raw-HTML content properties; renderers must escape text and never execute it as HTML or privileged instructions.
- URL fields allow HTTP(S) without credentials; navigation also allows restricted root paths and anchors. URL validation is not an SSRF defence: the network-fetch boundary still needs host/IP validation, redirects and response limits.

An asset manifest records ID, MIME type, origin, availability, alternative text and optional dimensions. It never accepts arbitrary storage paths or executable inline SVG from the browser. Server ownership checks and safe asset-byte handling remain mandatory. Browser-declared provenance, rights and verification flags must not be trusted as authoritative evidence.

## Websites

SiteSpec owns pages, navigation and responsive declarative sections. Typed sections are hero, features, services, gallery, testimonials, FAQ, contact, footer and native content.

Page paths and per-page anchors must be unique. Grid rules specify desktop columns and one mobile column. Gallery and hero images reference the asset manifest. Form configuration references an integration ID instead of arbitrary inline code. Testimonial records require source references and a permission declaration; publication additionally checks for approved project evidence.

These declarations do not establish that a form integration works or that a quotation is genuine. The published renderer must check actual integration state and authoritative evidence.

## Books

BookSpec contains native chapters, artwork references and distinct edition profiles. Digital PDF, print and EPUB remain separate outputs with shared approved content.

Print profiles contain binding, trim, ink, paper, bleed, rule version and preflight state/report reference. EPUB profiles contain reflowable/fixed layout and validation state/report reference. These are declarations; dimensions and KDP rules must be validated by the actual future renderer/preflight pipeline. No schema claims Amazon acceptance.

Generated or mixed books need an available OpenAI-origin artwork declaration before the structural export checklist reports ready. Actual provenance must be established server-side. Tables, lists and charts in inherited ContentBlock still require richer renderer handling; this contract does not pretend plain prose is an editable chart.

## Presentations

DeckSpec defaults to `mode: "visual"`, preserving the latest human requirement: OpenAI generates each full slide including visible text. Each slide keeps native approved script blocks, notes, sources, visual asset reference and declared text-check state.

Supported aspect declarations are 16:9, 4:3 and 3:2. A renderer must use the declared canvas and actual verified image dimensions rather than silently cropping visible slide text. The schema default stays 16:9; a genuine 3:2 generated image can explicitly declare 3:2. Dimension inference and output rendering remain renderer responsibilities.

Visual mode rejects native element declarations so image slides cannot be misrepresented as native editable text. A missing full-slide image or unresolved text check blocks the structural export checklist.

Native mode owns typed text, image, shape and chart elements. Coordinates are normalized to the slide dimensions; elements must fit inside the slide. Chart arrays must match category counts and have source references. Supported shapes are rectangle, ellipse and line. Font role is sans/serif, with point size and colour. Exporters must explicitly implement these capabilities rather than claiming support from schema existence.

## Adapters and normalization

`fromLocalProject(project)` returns `{ spec, pendingAssets, warnings }`.

- Existing block IDs and text are retained.
- Additional container IDs are stable custom UUIDv8 derivations. They are not cryptographic, authorisation or externally unique identifiers.
- Inline image bytes stay outside the spec in `pendingAssets`, identified for an authorised upload.
- Flat websites become a truthful content section, not inferred fake testimonials or business metrics.
- Flat books become a native-body chapter and digital PDF profile.
- Existing manual presentation blocks become explicit native slides. They are never labelled fully OpenAI-generated.
- The adapter validates supported limits and rejects unsupported oversized/native inputs instead of silently cutting content.

`fromCloudContent(content, artifactId, styleRef, assets)` preserves existing section/block IDs and declared sources. Cloud presentation content needs a native layout pass; the adapter does not manufacture layouts or data charts. Referenced cloud images require their manifest supplied by the caller.

`normalizeArtifactSpec(input)` parses and validates. It never silently changes approved text or invents references.

`exportReadiness(spec)` is a structural checklist. It does not validate asset bytes, OCR quality, actual print files or underlying report results.

`publicationReadiness(spec, context)` checks declared rights/evidence relationships. Context must come from authenticated, authorised records, not a browser self-attestation. All server permissions and evidence verification remain separate requirements.

## Style presets

The authored Editorial/Venture/Studio version-one presets match the current local UI accent colours: terracotta #9B583C, cobalt #3358D4 and forest #33544C. The application brand stays cobalt. All presets use warm paper/ink; editorial headings use Source Serif 4, other headings Inter. Custom styles need persisted immutable revisions and actual reference assets before production generation.

## Verification

TypeScript compilation was run successfully after implementing these modules. No live provider, export or publication outcome is asserted by that check. UI/API migration is intentionally separate from this task.
