# Makeborne cloud verification

## Unified Studio creation — 2026-10-04

Migration `20261003224557_unified_project_creation.sql` is applied locally and to the linked Makeborne project. The authenticated `/api/cloud/workspaces/[workspaceId]/studio-projects` endpoint creates the project, artifact, and initial saved version in one database transaction. It preserves effort and custom style snapshots. The existing request receipt system rejects changed payloads on retry and returns the original records for identical retries.

`supabase/check-unified-creation.sql` passes both locally and on the linked project: 14 checks cover saved effort/palette, the initial version, identical retries, altered retry rejection, invalid-version rollback, mismatched content, invalid effort, outsider replay denial, and reviewer write denial. Fixtures roll back. Production build, TypeScript, focused ESLint, and diff whitespace checks pass. Linked security advisors still report only the previously documented leaked-password-protection warning.

This verifies the database operation and compiled API integration, not the complete browser creation flow. The main creation wizard is not yet connected to this endpoint; account editor autosave and existing account project access are separate completed steps. Signed-in browser verification remains outstanding.

The separately guarded `supabase/check-cloud-fixtures.mjs` accepts only `https://rklojnmmsmhwnkbzuidp.supabase.co`. It requires `MAKEBORNE_VERIFY_CLOUD_FIXTURES=true` and `MAKEBORNE_CLOUD_KEYS_FILE` pointing to private revealed CLI API-key JSON outside the repository. Never print or commit that file. The original local runner remains restricted to its local endpoint.

Creates unique, confirmed test accounts through admin auth (no signup email), then authenticates them normally. Workspace/project creation uses authenticated RPCs. It never deletes existing data, resets the database, or enables paid integrations. Test users, workspaces and immutable artifacts remain for inspection. Requests refuse redirects. Credentials are not logged.

## 2026-10-03 findings

Two initial runs passed authentication, tenant reads, anonymous denial, reviewer/cross-workspace write denial, and idempotent concurrent artifact creation. The concurrent revision loser timed out at both 15 and 30 seconds. This is not a passing suite.

The original function deliberately raises SQLSTATE `40001` for a stale revision. [Supabase documents that this triggers infinite automatic retries in PostgREST 14](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). Local PostgREST did not exhibit the failure. A deterministic revision conflict must use `PT409`, returning HTTP 409 without retry. The verifier now requires that exact response; it cannot mistake a timeout for an accepted rejection.

After migration `20261003213957_revision_conflict_http409`, cloud run `3e42c21f-e81f-423b-8caa-e3e09bf6d46b` passed all 25 core checks, storage upload/read/tenant/overwrite controls, and revocation of database and uncached storage reads. The conflict response is now HTTP 409 with PT409. An intermediate run encountered a network connection timeout, which is not counted as a passing run. Network errors are now reported without raw exception output.

**Storage cache limitation:** with the SDK's default upload cache duration, the same previously downloaded authenticated URL continued returning bytes immediately after membership revocation. A fresh `cacheNonce` with `cache: "no-store"` was denied using the same session, proving current origin authorization was removed. This suite does not prove immediate invalidation of cached URLs or retract already delivered files. Production sensitive-asset delivery must define and verify an appropriate cache lifetime/invalidation policy; do not advertise instantaneous revocation of downloaded/cached content.

Recommended protected-media implementation: upload with `cacheControl: "0"`, perform fresh authenticated reads with `cache: "no-store"` and a fresh cache nonce, and verify that complete delivery path before release. This recommendation has not yet been implemented or validated as an application media flow; previously cached objects also need an explicit invalidation strategy.

Local regression run `adbfea66-c1c8-406c-ba93-6f56e40bd81a` also passed after the conflict-code migration, including its stricter same-URL storage revocation check. No application environment was changed by cloud verification. Browser auth, production deployment, generation, billing, publishing and full release-gate acceptance remain separate checks. Current advisor results are maintained in `CLOUD_PROJECT_SETUP.md`; this verification does not claim all advisor findings are resolved.
# Cloud outreach extension

Client list loading now projects only outreach stage and follow-up date. Full history is loaded through an authenticated, tenant-scoped client GET when opening details/outreach. Pending loads are invalidated on workspace changes and logout. Local fixture run `39a2fbfc-e878-4ec5-b1be-e0c58431989f` verified the actual PostgREST projection using 100 conversation entries: list response omitted history and was more than 20 times smaller, detail retained all entries, and another tenant received no record. Existing 25 isolation checks and storage/revocation checks also passed in that run. This does not substitute for signed-in browser verification.

Migration `20261003221220_client_outreach.sql` applied to local Makeborne and linked cloud project `rklojnmmsmhwnkbzuidp`. It adds optional outreach data to existing clients without changing tenant policies. Owner/editor update grants are constrained to the new column; reviewers retain read access only. The private validation trigger has no direct anonymous/authenticated execute grant and preserves existing history.

`supabase/check-client-outreach.sql` passes locally and via linked cloud query: 15 assertions cover owner/editor writes, reviewer reads and denied writes, cross-tenant isolation, stale revision rejection, invalid stages/dates/credential URLs, and append-only history. The script rolls back its fixtures in a subtransaction, including on failure. No messages or emails are sent.

Production build and TypeScript pass. Security advisors report no local issues and only the previously known cloud Auth leaked-password-protection warning. Signed-in browser verification of the new cloud panel remains pending; the inspected app browser session was signed out. Local outreach is not automatically uploaded; explicit project import excludes it and says so.


## Main Studio wizard connected — 2026-10-04

The existing creation modal now resolves the account destination and account clients before accepting a save. Signed-in creation calls the atomic endpoint, opens the returned artifact in the main Studio, and retains an identical request body for uncertain retries. New accounts provision their first workspace through the existing idempotent endpoint. Signed-out creation retains the explicitly labelled device draft flow. Account clients are fetched through all pages; device client IDs cannot be silently attached or uploaded. Pending account creation requests are visible and recoverable from Projects after closing the wizard.

Browser verification on localhost with an existing signed-in session: created `QA account creation — main Studio`, opened version 1 with supplied text, edited the paragraph, observed version 2, reloaded the page, reopened the account card, and confirmed the changed paragraph and both history entries. No generation was invoked. This proves that create/edit/autosave/reload path; simulated network interruption and concurrent browser editing remain unverified in the browser.

Eight creation payload checks, 15 autosave checks, 22 editor bridge checks, TypeScript and the production build pass. Focused ESLint reports no errors; two pre-existing image optimization warnings remain in studio.tsx. Homepage/login/signup redesign also inspected on desktop and 390px mobile, including signup mode and footer layout. Authentication submission logic is unchanged; the redesigned signup submission has not created another account.


## Account project links — 2026-10-04

Main Studio routes now include validated workspace/artifact IDs for account projects. New creation opens that route. Loading uses the authenticated artifact endpoint directly, so a project does not need to be in the first overview page. Missing membership produces an explicit access message rather than opening an unrelated workspace. The project editor view omits the creation hero and unrelated local cards. Removed the local-only sidebar count because it did not represent account projects.

Verified in the browser with the existing signed-in session: open account card, observe its workspace/artifact URL, refresh, read saved version 2 content, browser Back to project list, browser Forward to the same editor and content. Routing tests pass 12 checks. Auth destination tests pass 16 checks, including preserving valid account paths and discarding unsafe external/invalid targets. The sign-in entry preserves the validated destination; callback and confirmation handlers rebuild it. Email-link delivery and a full signed-out-to-signed-in redirect remain separate, unverified browser cases. Production build and TypeScript pass.


## Account editor exports — 2026-10-04

The account editor now exposes format-specific exports using the existing guarded localhost renderer: websites HTML/PDF, books PDF/EPUB, presentations native editable PPTX/PDF. Exports snapshot the current in-memory document; unsaved edits are explicitly identified. They do not save a version or publish a website. Book author/language are download-only metadata for now. Unsupported structured blocks, linked artwork, fonts or incomplete palettes are rejected without dropping content. Section headings and source text are preserved.

Seventeen pure adapter checks pass. Opt-in localhost HTTP checks return HTML, EPUB, PPTX and PDF successfully. HTML escaping/palette, EPUB source text/chapter headings, and editable PPTX text elements are inspected. PDF verification in this run checks a valid file signature only, not visual layout. Browser HTML export from the existing QA account document reaches its ready state and persistent download link. Browser download-event capture timed out; disk delivery via that browser is not claimed verified. Production rendering remains deliberately disabled until authenticated quotas/workers are installed. No paid providers were called.

Production build, TypeScript and focused lint pass. The export UI retains a prepared download link, aborts requests on unmount, and times out after 45 seconds without changing source content.


## PDF visual layout pass — 2026-10-04

Generated three development fixtures through the real export endpoint: a six-page editorial book, six-page dark-palette book and three-slide native presentation. Rendered all 15 pages with Poppler and inspected the contact sheet plus full-size quote and slide pages. Found closing quotes isolated on a page and undersized type on short base-style slides. The renderer now groups a chapter-ending quote with its preceding paragraph, adds page/total folios after the cover, and uses larger, vertically composed type for short native slides. Full-image slides remain unchanged.

Page margin counters follow the Chromium-supported CSS margin-box mechanism documented at https://developer.chrome.com/blog/print-margins. The fixture renderer reports Chromium 154. `check-pdf-layout.py` verifies the expected page counts, nonempty pages, all glyphs inside page bounds, cover folio suppression, subsequent page numbers, all twelve repeated source paragraphs, and final source sentences. The updated fixtures pass. The title-text check normalizes extracted line breaks; its initial exact-line assertion failed on a legitimate wrapped heading and was corrected rather than changing the source.

`check-pdf-layout.cjs` additionally verifies a deliberately overfull slide is rejected with HTTP 400 / SLIDE_CONTENT_OVERFLOW. The 17 account export checks and all four localhost renderer smoke checks pass, as do TypeScript, focused lint and production build. This covers these representative text-only fixtures; it is not comprehensive validation of all typography, languages, image-generated pages, print trims or publishing platforms. Fixtures remain in work/pdf-layout-checks as QA intermediates, not customer-ready books.


## Main Studio account CRM — 2026-10-04

- Clients now opens account-backed records for signed-in users. Device-only CRM remains explicitly accessible without implicit upload.
- Added account client creation, workspace selection, search/stage filters, pagination, contact editing, outreach/history, and linked project artifact navigation in the main Studio shell.
- Uses existing authenticated, workspace-scoped endpoints and optimistic client revisions. Reviewer controls remain read-only; no RLS or database schema changes.
- Request generations discard obsolete reads. Account changes unmount client state. Save-in-progress disables client-section/storage switches; uncertain creation requests remain recoverable through existing idempotency UI.
- Fixed shared API helper rejecting simultaneous GET reads (observed under development effect replay). Duplicate mutation protection remains enabled.
- Browser evidence: created `QA client — account CRM`, saved company `QA studio`, stage `Contacted`, channel `Instagram`, follow-up `2026-10-06`. Reload preserved company, stage and follow-up; outreach history recorded changes. Search by company and stage filtering behaved as expected. QA record retained; no outreach messages sent.
- Offline regression: `node src/components/check-cloud-api-concurrency.cjs` passes overlapping reads, duplicate mutation rejection, and lock release after completion.
- TypeScript, focused ESLint, and production build pass. Desktop and 390px client list visually inspected; mobile toolbar revised to keep the search field on its own row.
- Limits: browser scenario used one owner workspace and one QA client. First-workspace provisioning, multi-workspace selection, reviewer UI, pagination beyond 200 clients, and populated linked-project navigation need dedicated browser scenarios. Existing server isolation checks are separate evidence, not proof of these UI cases. Account CRM analysis/brief creation and permanent client-detail URLs remain follow-up work.


## Persistent account-client links — 2026-10-04

- Account client list/detail routes use validated workspace and account-client UUIDs. Device `client` links remain distinct and select the device CRM surface.
- Main Studio restores the account client route on initial load and browser history navigation. Details are fetched directly, independently of client-list pagination, after workspace membership lookup. Unknown workspace/client requests do not fall back to another client.
- Signed-out account-client links offer sign-in with a rebuilt, allowlisted destination. Redirect helper strips unrelated query parameters and rejects invalid identifiers.
- Existing account client creation now opens its permanent route; workspace selection and returning to the list preserve the selected workspace. Contact saves re-fetch the currently addressed client rather than dropping the user into another record.
- Verification: 19 pure Studio route checks and 22 auth destination checks passed. TypeScript, focused ESLint and production build passed.
- Browser: opened QA client `53bd4aa2-505e-444b-9a57-45684441fb51` in workspace `e68ff1eb-ed26-42ac-8864-689451e39c30`; verified detail URL, reloaded the same record, Back returned to the list, Forward restored the record including saved outreach fields/history.
- Limit: full signed-out sign-in return, missing-membership UI, device-client deep link browser scenario, and cross-workspace navigation were not browser-tested this pass. Route unit checks are not a substitute for those scenarios. Unsaved draft navigation protection remains outstanding.


## Create projects from account clients — 2026-10-04

- Client detail now has Create for this client, opening the shared website/book/presentation wizard with the account client preselected.
- Explicit workspace handoffs are resolved against current memberships. Missing or reviewer-only destinations fail instead of falling back to another workspace. Signed-out handoffs cannot silently create a device project.
- Creation draft identity includes the workspace. Restoring a client selection no longer clears it while the account client list is loading; the live client list is checked before submission.
- Fixed linked-project navigation: a normal click now updates both the URL and Studio state. The link retains its real href for modified/new-tab clicks.
- Browser verified: QA client selection survived dialog reopening; created `QA client presentation — CRM handoff` with supplied text, then found it under that client's Projects tab. Artifact `03edc914-01d5-4838-9824-1f684bd705b5` in workspace `e68ff1eb-ed26-42ac-8864-689451e39c30`. Followed the client project link and confirmed the account editor opened. QA project retained; no provider calls or outreach messages.
- Nine workspace-selection checks and nine creation-payload checks pass; TypeScript, focused ESLint and production build pass.
- Limits: browser scenario covers presentation in one owner workspace. Website/book use the same handoff but were not separately created this pass. Multi-workspace and reviewer behavior have pure selection checks, not browser proof. Wizard resumes by initial format; resuming the last-used format after changing format and closing still needs improvement. Full AI generation remains disabled.


## Resume the last creation format — 2026-10-04

- The setup wizard now stores its last active format per creation context after the draft itself is written. Reopening resolves and validates that format before restoring the full draft.
- Successful creation clears the format pointer and all drafts for that context. Legacy drafts without a pointer still use the requested format. Invalid pointers or missing referenced drafts fail without overwriting the stored source.
- Browser verified in the QA account-client workflow: switch to Book, enter title/material, close/reopen, and observe Book/title/material/client retained. Then switch to Presentation, replace title/material, close, reload the page, reopen, and observe Presentation/title/material/client retained.
- No new cloud project or provider call was made in this pass. Temporary draft lived in the agent's browser tab.
- Nine offline draft-storage checks cover fresh and legacy cases, latest-format recovery, context separation, failed writes, damaged/missing pointers, and cleanup. TypeScript, focused lint and production build pass.
- Scope: same-tab session storage survives page refresh, not guaranteed browser closure or another device. Account-isolated draft namespaces and fuller draft management remain follow-up work; this is not a cloud draft-sync implementation.


## Account-scoped wizard recovery — 2026-10-04

- Wizard draft storage keys now include account and workspace identity; signed-out drafts use a separate device namespace. Draft schema seed remains the existing bounded context identifier.
- Account resolution moved to an outer setup boundary. The editable wizard does not mount until account resolution finishes, and its identity key changes between accounts/workspaces. Account loading/errors therefore cannot restore a draft under a guessed identity.
- Unscoped historical drafts are left untouched and are not automatically assigned to the currently signed-in account. A deliberate legacy-recovery experience remains unimplemented.
- Seventeen storage regression checks pass, including account/workspace/device isolation, cleanup limited to one owner context, invalid identity rejection, and preservation of unknown-owner legacy drafts.
- Browser: reopened a Book setup for the QA client and verified format/title/material/client still restored under the current account. No sign-out or second-account browser transition was performed; those need a dedicated authentication scenario. This does not claim encryption against someone with direct access to the same browser profile.
- TypeScript, production build and focused lint pass; Studio lint retains two pre-existing image-element performance warnings. No new cloud records or paid provider calls.


## Account identity during requests — 2026-10-04

- Shared request helper captures account identity and an account-change revision at request start. An A-to-B-to-A switch still invalidates the old response. Reaffirming the same account does not.
- Creation request hashing/storage uses the captured owner. A switch during hashing prevents storage/network dispatch; a switch after dispatch leaves the original owner's pending identity intact and reports an uncertain write rather than success under the new account.
- Duplicate mutation locks are account-specific. Existing idempotency hash format is preserved so prior pending requests remain reconcilable. Anonymous client-side writes are rejected.
- Browser calls include X-Makeborne-Account. Cloud context compares this optional constraint to auth.getUser before schema/workspace queries. It grants no authority, does not replace authentication/RLS, and preserves compatibility for other callers without the header.
- Eight mocked-transport/account checks and three concurrency regressions pass, including original-account retry with the same request key and header. Normal signed-in client detail loading succeeds through the updated server path. TypeScript, lint and production build pass.
- Limits: no real concurrent sign-out or second-account browser session was exercised; mismatch rejection is covered by the pure server predicate and code placement, not an authenticated HTTP mismatch fixture. No claim that a request already committed before a later sign-out can be undone. No cloud records or paid calls were made.


## Live account-project layout previews — 2026-10-04

- Account editor now renders the current content beside the text editor on wider screens and below it on narrow screens. Preview uses saved palette and supported typography without changing canonical content.
- Website preview includes desktop/mobile width controls. Book preview includes a cover and continuous reading layout. Presentation preview groups heading-led slides with previous/next controls. Missing artwork is explicitly represented as unavailable; structured blocks retain a labeled text representation.
- Browser: presentation Next control opened slide 2; editing its paragraph updated preview immediately and autosaved version 2 of QA artifact `03edc914-01d5-4838-9824-1f684bd705b5`. Website mobile-width control worked for existing Electric Mint QA artifact. Created QA book `QA — The Thoughtful Practice`, artifact `c63ae7ce-3a0d-4ab6-82d3-cce9435b3a45`, using Moss Notebook and supplied text; cover/reading layout rendered. No generated images or model calls.
- Inspected 390px book editor; document scroll width equaled viewport client width. Reduced narrow-screen cover padding/title sizing after observing a split word, then visually confirmed the corrected cover and reading layout. Viewport override reset.
- Ten pure preview-content checks pass for headings, order, exact text, empty states and non-mutation. TypeScript, focused lint and production build pass.
- Limits: this is a draft layout preview, not an export-equivalent renderer, full website runtime, generated artwork, or publishing. Long content is allowed to grow rather than clip; pagination/line breaks may differ from PDF/PPTX. Full rich-block and asset rendering, preview/export parity, and all-style/language coverage remain incomplete.

## Account block controls — 2026-10-04

- Added adjacent move, remove and last-removal undo controls to account content blocks. Pure transformations retain block IDs and source references, reject locked targets/neighbors, and preserve unrelated content. Undo preserves subsequent edits to other blocks; successful reload clears stale undo state.
- Structural controls pause during uncertain saves, conflicts and recovery. Reviewer controls remain unavailable. Textareas occupy the full editor column after a visual regression was found and corrected.
- Fifteen offline integrity assertions, focused lint and TypeScript pass. Production build passed before the final undo-reset and textarea-width adjustments; those adjustments were checked by TypeScript/lint and browser respectively.
- Browser: QA book c63ae7ce-3a0d-4ab6-82d3-cce9435b3a45 reopened with reordered paragraphs at version 2. Moving the third paragraph up restored original order and autosaved version 3; preview reflected the restored order. Screenshot captured in outputs/makeborne-editor-block-controls.png.
- Limits: remove/undo covered by pure assertions, not browser deletion. Undo is session-local and retains only the latest removal; this is not full version restoration. No paid calls.

## Saved version preview and restoration — 2026-10-04

- Account version history now opens a saved layout preview. Editors can restore an earlier snapshot into the editor; normal autosave creates a new version with a provenance note. Existing history remains intact.
- Restore is unavailable with unsaved edits, busy/paused/uncertain saves, conflicts, recovery drafts or reviewer role. Preparation validates the snapshot, artifact identity and format, rejects current/future versions, and refuses alteration/removal/movement/unlocking of current locked blocks. Content, style and asset references are cloned from the snapshot.
- Thirteen pure integrity assertions pass. Focused ESLint, TypeScript and production build pass. A subsequent display-only adjustment places preview buttons below dates.
- Browser: previewed version 1 of QA book c63ae7ce-3a0d-4ab6-82d3-cce9435b3a45, restored it, and observed saved version 4 with note Restored from version 1. Versions 1-3 remained listed. Current-version preview has no restore action.
- Limits: browser restoration exercised one text-only book, not all formats/assets or concurrent-editor races. Existing optimistic version checking and uncertain-save handling are reused. Snapshot artwork retains the existing unavailable placeholder where unsupported. No provider calls or paid services used.

## Saved project design directions — 2026-10-04

- Added a collapsible Design direction panel inside the account editor. Three shared presets plus two format-specific authored directions show colour/type swatches. Custom controls apply a style name, heading font and background/text/accent colours through StyleProfile validation; remaining style metadata is retained for custom edits.
- Changes update the existing preview and autosave as new versions. Read-only/reviewer, busy, uncertain, conflict and recovery states disable changes. Content blocks are not replaced by style changes.
- Browser QA book c63ae7ce-3a0d-4ab6-82d3-cce9435b3a45: applied Ink & Vermilion and observed saved version 5. Applied QA Botanical Edition with Source Serif 4 and #456749 accent, observed saved version 6, then reloaded and confirmed version/style and all three original text blocks persisted. Screenshot outputs/makeborne-project-styles.png.
- Focused lint, TypeScript and production build pass. Limits: browser exercised a book at desktop width; cross-format/mobile/export visual parity and colour-contrast checks were not established. These presets change palette/type, not generated artwork or complete layout systems. No paid calls.

## Section and chapter editing — 2026-10-04

- Account editor now names sections/chapters and adds new sections. Each section owns its heading/paragraph/quote controls, replacing the old behavior that appended every block to the first section. Empty documents can create their first section.
- Transformations preserve existing sections, locks and provenance and reject missing targets/duplicate IDs. Structural mutations remain unavailable during reviewer, recovery, conflict or uncertain-save states. Section names permit normal spaces while typing, are bounded to 200 characters, and use the existing save schema.
- Browser: QA book c63ae7ce-3a0d-4ab6-82d3-cce9435b3a45 gained chapter 2, Making room for practice, with one new paragraph. Preview reflected both and autosave confirmed version 9. Existing three blocks remained in chapter 1. Screenshot outputs/makeborne-book-chapters.png.
- Twelve structural checks, fifteen block checks and ten preview checks pass. Focused ESLint, TypeScript and production build pass. No paid calls.
- Limits: no section deletion/reordering or cross-section block moves yet; presentation grouping still follows the existing heading-led preview/export convention. Browser scenario covered a book; this is not evidence of full slide or website layout editing.

## Client follow-up views — 2026-10-04

- Account client list now exposes All, Overdue, Due today, Upcoming and Not scheduled views with counts. Active follow-up views exclude Won/Lost and sort dated clients earliest first; normal search and stage filters still intersect with the selected view. Empty filtered views offer Clear filters.
- Calendar comparisons use the browser's local day, refreshing every minute and on focus. Row labels distinguish overdue/today/upcoming/closed. Counts and filters explicitly cover loaded clients; this is not yet a server-wide follow-up query.
- Eleven date/status assertions, focused lint, TypeScript and production build pass. Browser: existing QA client's 2026-10-06 follow-up appeared in Upcoming; Overdue showed the correct empty state; Clear filters restored visibility. Screenshot outputs/makeborne-client-followups.png. No records modified or outreach sent.
- Limits: server-wide filtering beyond loaded pages, timezone preferences and notifications remain unimplemented. Midnight refresh, mobile view and large client counts were not browser-tested this turn; date logic is covered by offline cases.

## Workspace-wide client directory — 2026-10-04

- Supabase invoker function makeborne_client_directory applies workspace RLS plus explicit membership, literal case-insensitive name/company/email search, stage and follow-up filters before 50-row pagination. It returns workspace-wide follow-up counts and a filtered total. Full outreach histories and notes are omitted from list payloads.
- New authenticated GET clients endpoint validates bounded search/date/filter/offset inputs. Client response contract distinguishes directory reads from creation writes. Debounced directory hook ignores superseded responses, resets paging on query changes and merges additional pages by ID. Existing client detail remains a separate request.
- Eleven local SQL assertions with 205 generated clients pass: later-page search/overdue discovery, full counts, literal percent punctuation, filter intersection, last page, summary payload, cross-workspace denial, invalid offset and anonymous denial. Fixtures rolled back. Five shared API concurrency/response checks pass, including the new directory contract; lint and TypeScript pass. Production build passed before the final GET response-schema correction; that correction was then checked by TypeScript/lint and browser.
- Migration 20261004011940 verified locally and applied to cloud after a single-migration dry-run. Browser against cloud: loaded client counts/list, searched a missing name to get zero results, and Clear filters restored the existing QA client and full-workspace total. Screenshot outputs/makeborne-workspace-client-search.png. No client records modified or outreach sent. Cloud advisor retains only the known leaked-password-protection warning.
- Limits: 205-record pagination was verified in SQL, not through the browser load-more button; multi-session client updates can shift offset pages. Counts scan the authorized workspace and need larger-scale performance evaluation. Response race handling is implemented but not stress-tested. This supersedes the earlier loaded-clients-only limitation for the account directory.

## Client-specific project directory — 2026-10-04

Replaced the account client's loaded-snapshot project view with an independently paginated directory. It joins all projects linked to that client with their document records, includes projects without documents, and returns 50 items per request with the full client item count. Cards show format, project status, version, and last update, with real editor links supporting modified clicks.

Migration `20261004012849_client_project_directory` applied locally and to the linked cloud project. The invoker function retains RLS, explicitly checks workspace access, validates client scope/page bounds, and denies anonymous execution. Summary payloads omit document content and project briefs.

Evidence: nine local transactional SQL checks passed (56-item paging, no overlap, empty projects, client isolation/minimal payload, workspace/client/offset/anonymous denial). Seven cloud API fixture checks passed, including directory response validation. TypeScript and touched component lint passed. Local security advisor clean; cloud retained only the existing leaked-password-protection warning. Browser displayed two linked QA documents and opened the correct book at saved version 9.

Limits: pagination uses offsets, so concurrent inserts/updates can move page boundaries; UI deduplicates loaded IDs. The count represents document items plus documentless projects, not unique projects. Generation, publishing, and billing are not changed by this work.

## Chapter and section editing — 2026-10-04

Account editors now support moving adjacent sections, removing a section, and undoing the latest section removal. Complete sections retain block IDs, source references, artwork references, and text. Locked sections and locked neighbors cannot be reordered; a section containing locked blocks cannot be removed. Reviewer, conflict, recovery, and uncertain-save restrictions remain in force. Reload/version restore clears stale undo state.

Evidence: 26 section action checks passed; TypeScript and component lint passed. Browser QA book: chapter two moved above chapter one (saved version 10), original order restored (11), chapter two removed (12), then undone with its original paragraph restored. Prior versions remain available.

Limits: undo retains the latest removed section during the current editor session. It is not a multi-step undo history. Previous saved versions remain the recovery mechanism across reloads. Reordering uses explicit up/down controls rather than drag-and-drop.
The undo result saved successfully as version 13, confirmed by the account editor's Saved status.

## Locked content persistence — 2026-10-04

Migration `20261004015856_protect_locked_blocks` extends the existing atomic save function under the artifact row lock. Every previously locked block must remain in its original section, with the same ID and exact JSON fields except its lock flag. Removing it, changing its text/provenance/artwork/type, or combining text changes with an unlock is rejected. An unchanged block can be unlocked in a separate saved version. Relative position within its section is not part of this server invariant.

Account editor now exposes Lock/Unlock controls. Changes must be saved before changing protection; while a lock change is pending, the composing area is inert until a confirmed save. Existing reviewer/conflict/uncertain-save rules still apply. Failed saves preserve the draft and can be retried.

Seven local transactional database checks passed: edits, bundled unlock/edit, block removal, section removal rejected; failed changes leave the revision unchanged; a separate unlock and subsequent edit succeed. TypeScript and lint passed. Local security advisor clean. Migration applied to the linked cloud project.
Browser verification: QA book heading locked and saved as version 14; its textarea was disabled. A separate unlock saved as version 15 and the original text remained present with the Lock control available again. Cloud advisor retained only the pre-existing leaked-password-protection warning.
