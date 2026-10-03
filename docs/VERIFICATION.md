# Milestone verification — 2026-10-03

## Executed

- Next production build succeeds; TypeScript completes.
- After replacing repeated logo images with a shared vector and optimising the landing artwork, two plain-image optimisation warnings remain for editor artwork. Final lint/build results are recorded below. Development dependency advisories remain documented separately.
- Desktop home and studio open in a real Chrome browser without a framework error overlay; console has only development messages.
- Mobile home at viewport 390px reports document width 375px, with stacked hero and no horizontal overflow.
- Created a review-only client through the UI and linked two website projects. Client detail lists both projects and the actual saved-version activity.
- Saved a content version, edited its text and restored the prior snapshot through the confirmation dialog. The original text reappeared.
- Fixed editor state leaking between consecutively created projects by resetting its React instance by project ID.
- Local recovery uses bounded structural and reference validation; unreadable saved bytes are protected from overwrite. This control has been inspected in source; full corruption/recovery scenarios are not yet browser verified.
- Generation endpoint returns HTTP 503 GENERATION_NOT_ENABLED. No paid API call was made.
- Manual HTML export returns 200; script-looking text is escaped rather than inserted as executable markup.
- Manual PDF export returns 200. Rendered and visually inspected its one page; body text extracted accurately.
- Native PPTX export returns 200. Inspected its slide XML: editable text and speaker notes are present. No claim of visual PowerPoint rendering verification yet.
- Production dependency audit reports zero known advisories after image-size override to 2.0.4.

## Second milestone checks

- Production dependency audit after adding Sharp/JSZip again reports zero known advisories.
- Illustrated custom-style PDF fixture returns 200; the four-page file contains its supplied artwork and extractable chapter text. Its cover was rendered and visually inspected.
- Complete visual PPTX fixture returns 200, with one image and zero rendered text nodes in slide XML. Actual supplied venture artwork is approximately 16:9 and the generated canvas is 16:9. This is package inspection, not visual PowerPoint rendering.
- A separate 3:2 artwork fixture exports to a 12192000×8128000 EMU canvas. Requesting that artwork as 16:9 returns 400 SLIDE_ASPECT; it is not silently cropped.
- Sample reflowable EPUB passes official EPUBCheck 5.4.0, zero errors or warnings. The validator reported EPUB 3.4 rules. No Kindle/Amazon compatibility claim follows from this sample.
- Fresh isolated Chrome checks at 390×844 open home, login and cloud studio with HTTP 200, zero broken images and zero page errors. Each page's document width equals its 390px viewport. Unconfigured account/cloud screens disclose unavailable storage and show local continuation links.
- Docker engine startup fails while initialising its local inference socket. Database runtime verification cannot proceed through that engine; no migration or cloud flag has been activated.
- A fresh isolated browser flow creates a custom style and book, uploads the supplied editorial artwork, downloads an EPUB with HTTP 200, then creates a website, adds a services scaffold and downloads HTML containing that section. There are zero page errors in this flow. The actual illustrated EPUB downloaded through the UI passes EPUBCheck with zero errors or warnings.
- Fixed the development loopback-origin mismatch found by browser testing. Same-port loopback aliases can reach request validation; different ports, external domains and `Origin: null` return 403. Production retains exact-origin matching. This is a bounded origin check, not a full CSRF penetration test.
- Nineteen offline job-domain assertions pass for disabled spending, reservations, uncertain outcomes, cancellation and related fixed-fixture cases. No provider, SQL concurrency, queue crash-recovery or live worker verification follows from those assertions.
- Final integrated production build and TypeScript pass. Final full ESLint run has zero errors and two editor-artwork optimisation warnings. No secret-pattern matches were found in the reviewed source/document/migration paths; this scan is not a credential-security certification.

## Not verified or unavailable

Database migrations and RLS runtime checks; cloud persistence, authenticated account flows and guest access; live provider generation; cost reservations and jobs; production exports; publication and custom domains; payments/webhooks; full print rendering/KDP acceptance and broad EPUB reader compatibility; discovery/media and all original production release gates. Cloud routes, immutable-save operations and permission migrations are written but their live behaviour remains unverified. A successful frontend build does not establish readiness for paying customers.

Browser verification records are development evidence. Review client data exists only in an isolated browser session; the application starts with an empty workspace.

## Current capability audit after book metadata persistence

The running development `/api/capabilities` returned HTTP 200: local workspace/manual development exports available; cloud account storage unconfigured, migrations unverified, AI dispatch unavailable, publication unavailable, and payments unavailable. This corroborates the implementation contract's current boundary. Previous visual/build checks must not be used to claim those production capabilities are complete. The next production dependency is configured cloud storage with verified account and tenant isolation flows; paid model calls remain unauthorised.

## Validated local save boundary

All studio local-workspace writes now call `saveLocalWorkspace`, which validates before touching storage. Invalid autosave data keeps the previous valid bytes and displays a persistent validation/recovery message. Editor title, brief, audience, purpose, version-note and review-note inputs now enforce their persisted length limits. Existing data is not truncated.

Production build passed; lint zero errors with two existing image warnings. Six direct assertions using a fake storage adapter verify validation rejection without writes, previous-value preservation, valid serialization, and propagated quota errors. This is unit-level storage-boundary evidence, not a browser quota-failure simulation or proof of every editor action.

## Task workflow browser verification

Used the previously empty localhost:3000 workspace (a separate origin from the user's 127.0.0.1 workspace) to create QA — task workflow. Added Review homepage through the actual wizard/editor. Found that a date displayed after browser input was not retained on submission; changed submission to read named form controls via FormData and preserve those values on failure. After the fix, editing the task retained 2026-10-12, completing it changed the count to zero, reload preserved the date and checked state, and reopening it restored the count to one and appended activity. Screenshot saved in user outputs. The QA project remains only in localhost browser storage; its temporary browser tab was closed. Client-linked counts, overdue styling, mobile task layout, and task storage failures remain unverified.
