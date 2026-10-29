# Lead-engineer reconciliation — 21 October 2026

- **Base:** `origin/main` d066f23 (PR14, live on makeborne.com). Verified by fetch.
- **Branch:** `feature/library-redesign`.
- **Not in main:** Claude's newer work through d6830fc (design round 3 questions/enhancer, the image-routing qualification doc, the AI activation doc). Design round 4 (`feature/design-quality`) and hydration (`feature/site-hydration`) are still in progress. Each is reviewed and integrated as its own slice, never merged blindly.

Status words: **implemented** (code on a branch) · **local** (tested locally) · **staging** · **live** · **disabled** · **blocked**.

| # | Requirement | Current implementation (verified in source / release evidence) | Remaining gap | Slice | Acceptance evidence |
|---|---|---|---|---|---|
| 1 | Project library hierarchy | Live: real previews, title search, client filter, sort, Grid/List, publication labels (`account-projects.tsx`, `library-card-preview.tsx`). Returning users see the library first, but under a large "YOUR CREATION STUDIO / What will you make next?" hero plus "SAVED TO YOUR ACCOUNT / Your saved projects", with nested bordered panels | Too many headings and containers; preview is a side thumbnail, not dominant; no card actions; list view is a shrunken grid card; sidebar heavy; tablet squeezes the gallery | **S1 library redesign** (this branch, first) | Before/after captures at 1440 / narrow desktop / 800 / 375 / 320; measured first-card position and card geometry; correct project reopened among similar names; three-browser checks |
| 2 | Card actions | Rename exists for projects (`PATCH …/projects/[projectId]`, `expectedUpdatedAt` conflict guard). Publication state exists (card-meta) | No Open/Rename/Copy-link menu; live address not exposed to the card | S1 | Rename with conflict handling; Copy link only when card-meta confirms live and the address comes from the hosted-site row |
| 3 | Old "Untitled" projects | M04 fallback titles for new projects only (live); old Untitled rows unchanged by design | Suggest names from authorised content, with confirmation | S1b | Suggestion offered, never applied without confirmation; deliberate names untouched |
| 4 | Creation: prompt-first, optional Plan, questions, enhancer | Live: brief questions (F04/M08 rules), explicit Send, shown maximum. Round-3 questions/enhancer **implemented + local** on `feature/design-quality`, not live | Review the enhancer (opt-in, charge explained, no invented facts), keep books free of website-only styles, clearer progress states | S2 creation qualification | Journeys: complete prompt → build directly; vague prompt → questions; enhancer opt-in and charge shown; book flow |
| 5 | Generated output quality | Live: round-1/2 prompt (design seed, motion, a11y). Round 3/4 **local** (judge 40% vs golden; round 4 in progress) | Art direction, hierarchy, books/decks specifics | S3 output quality | Blind judging (owner + friends page), every page/slide inspected, cost recorded |
| 6 | Editor continuity | Live: M07/M08/M10 (version-bound edits, Undo, preview continuity, live/checked facts), M11/M12 compare/search | Selected-element feedback, pending/applying states polish, diagnostics | S4 editor | Mounted + real-app journeys |
| 7A | Instruction queue | Not present (follow-ups not queued, stated in UI) | Durable authorised queue | S5 | SQL + mounted checks; no reservation on enqueue |
| 7B | Independent drafts | Not present (history only) | Design and build | S6 | Isolation/conflict/acceptance checks |
| 7C | Knowledge and design systems | Brand kits (identity only, fingerprinted per run) | Scoped knowledge, versioned references | S7 | Isolation/revocation checks |
| 7D | GitHub | Push/export exists; two-way sync unverified | Pull/branch/conflict | S8 | Verified current behaviour first |
| 7E | Customer-app backend | Not provided (Makeborne DB/enquiry gateway are not customer backends) | Architecture decision first | S9 (ADR only) | ADR reviewed; no toggle |
| 7F | CSV/XLSX/DOCX/PPTX ingestion | Unsupported, stated per file (M09, live) | Bounded parsers with provenance | S10 | Fresh comprehension fixtures |
| 8 | Billing/launch boundaries | Live as released: checkout, packs, auto-charging, AI spending, images, Gmail automation all **disabled**; owner-only publishing | None in these slices; preserve | — | Unchanged settings |

Order: S1 → S1b → S2 → S3 → S4. S5–S10 are separate increments after the core journey is stable. External, release and paid steps go to Codex with exact handoffs.

## S1 / S1b project library — status (Claude, 21 October 2026)

**Status:** implemented and tested locally on `feature/library-redesign`. Not on staging, not live. No migration, no new route, no new dependency.

- **Hierarchy.** Returning users see one `Projects` heading, one primary `New project`, and one toolbar: search, format, client, sort, Grid/List and Refresh. The account list's controls join the page toolbar through a portal, so the list keeps one position. The "YOUR CREATION STUDIO / What will you make next?" hero and the "SAVED TO YOUR ACCOUNT / Your saved projects" panel are gone for returning users. New users keep the prompt-first page, and `?tab=`, `?create=` and handoff links are unchanged. The composer becomes a "Start something new" section below the library. Inspiration moves to Styles (one link).
- **Cards.** Every card has a full-width 16:10 preview:
  - website: the top of the home page at full width;
  - deck: the opening slide at 16:9, centred;
  - book: the portrait cover, contained and centred.

  Titles are clamped to two lines, and the full name stays in the DOM and in the tooltip. Client and format sit on one fixed line and the saved time on another (today and yesterday include the time). A small publication badge shows Draft / Live / "Live · unpublished changes", with exact versions in its tooltip. Measured on the fixture account: preview-height variance 0 and card-height variance 0 at 1440, 1024, 800, 375 and 320. Columns use `auto-fill`/`minmax(232px)` on the list's own width. The list view uses dense 57 px rows with a 64×40 preview, and container queries choose its columns.
- **Rail.** The rail is flush and lighter, with 36 px rows. At 701–959 px it folds to a 68 px icon rail, so the gallery keeps two columns at 800 px instead of one squeezed column. Names stay accessible and show as labels on hover or focus.
- **Card actions** (existing authorised paths only):
  - **Open.**
  - **Rename / Name this project.** A card names `public.artifacts.title`. Only `makeborne_save_artifact_version` writes it, by copying `content.title`, and the editor heading, title search and Title sort use the same field. `PATCH …/projects/[id]` changes `projects.title`, which no card shows. A rename therefore reads the current version through `GET …/artifacts/[id]` and saves it again through `POST …/artifacts/[id]/versions` with `expectedVersion`. Only `content.title` changes; the content, style and asset manifest are kept. The change summary reads "Renamed to “…”". A stale card is caught before writing. A 409 says the project was saved again and offers Refresh. Unconfirmed writes keep the cloud client's own message. The dialog states the effect per format: for websites the name is also the default site title once republished; for documents the cover and slides keep their own title. Reviewers and projects with no saved version get no Rename. **A rename alone is not an unpublished change** (Kerim, 21 October): a live site stays Live when every later version says it is a rename and the live and current saved content match apart from `content.title`. The label is only a hint; content, style and assets are compared, at most 8 projects per request. Proven on the local stack: a real edit labelled as a rename still shows unpublished changes. The editor's version bar keeps exact numbers ("version 9 saved, version 7 live"), because publishing again does update the site title.
  - **Copy live link / Open live site.** Shown only when card-meta reports Live or "Live · unpublished changes". The address is `siteAddress(slug)` of the same hosted-site row the Publish panel reads, and it is null for drafts and invalid slugs. The schema refuses an address on a draft and any non-http(s) address. A failed copy shows the address to copy by hand.
  - No archive, delete or duplicate actions.
- **S1b — old "Untitled …" names.** Suggestions are offered only for placeholder titles. They come from content the account can already read, in this order: the title inside the current book or deck, the M04 brief-derived name (no contact details or links), then the project record's title. A suggestion only fills the field, and nothing is saved until Rename. Deliberate names get no suggestions, and nothing is renamed automatically.
- **Preserved:** account and workspace isolation, version- and content-bound previews, late-result protection, revocation and deletion clean-up, bounded reads (two concurrent reads plus one capture), and script-free sandboxed frames.
- **Added:**
  - Retry on a failed preview;
  - a loading placeholder with the list's own shape;
  - a first paint that uses the device's layout memory, which brings returning-visit CLS to 0.006 on the real app.

  First-visit CLS is still 0.44. This is unchanged by design: the first visit is prompt-first until the list is known.

### Thumbnails decision: keep sandboxed frames and stored captures; no raster thumbnails now

The alternative was stored raster thumbnails (PNG/WebP per saved version) instead of the current approach. The current approach renders decks, books and outlines live in script-free frames. Websites use the stored, server-sanitised home-page capture (`artifact_card_previews`) in a `sandbox=""` frame.

- **Security.** A raster image is inert in the browser, but producing one needs one of two things:
  - a headless browser on the server, which would render customer HTML: new attack surface, egress control, a sandboxed renderer;
  - or a client rasteriser that uploads images, which then needs server-side image decoding and validation, size limits and an upload path that can be abused.

  The current path renders nothing on the server, and the browser never runs generated code: frames have no scripts and website frames get an opaque origin. Raster images would also be a second copy of private customer content, with their own read authorisation, cache headers, revocation and deletion. Today the capture rows cascade with the artifact and version, and previews are never cached outside memory.
- **Performance.** Frames cost more than images, so they are bounded instead:
  - two reads at a time and one capture;
  - lazy loading within 240 px of the viewport;
  - frames mounted only within about 1600 px of the viewport (new), remounted from the in-memory cache with no new read;
  - a fixed 16:10 region, so loading never shifts the layout.

  On the 82-project fixture, a full scroll leaves 27 mounted frames (82 before this change) and 1.3 MB of frame HTML in the DOM (about 10 MB before).
- **Operational cost.** Rasters would need storage objects per version, a generation trigger and queue, a backfill for existing projects, invalidation on every save, deletion on revoke or delete, and monitoring. That is new infrastructure for appearance alone.
- **Revisit when:** workspaces routinely exceed about 200 projects (the in-memory cache bound), measured scroll jank appears on low-end devices, or previews must appear outside the app (email, shared links). The next step would rasterise the already-sanitised capture inside the existing sandbox, not add a server renderer.

## Larger parity features — status, 22 October 2026

Status words as above. "Live" means in production main d066f23. Each row was checked in source on main and on Claude's branches, not taken from earlier reports.

| Feature | Status | What exists | Gap / next step |
|---|---|---|---|
| Durable instruction queue | **absent** | With AI off, follow-ups are kept as notes in this browser tab only ("Saved in this tab · not applied"). Nothing is queued server-side. | Durable, authorised queue (S5). Enqueueing must take no hold; each item runs only on explicit start. |
| Independent drafts with explicit acceptance | **absent** | Linear version history with restore and compare. Earlier versions can be previewed read-only (`feature/editor-quality`, implemented + local). | Draft branches per request with isolation, conflicts and acceptance (S6). |
| Scoped project/workspace knowledge | **absent** | Brand kits (identity only, fingerprinted per run). Per-request attachments (PNG/JPEG/WebP/GIF/PDF/TXT/MD). | Scoped, revocable knowledge sources with provenance (S7). |
| Versioned reusable design systems | **absent** | Style presets and the automatic design seed (`feature/creation-quality`, implemented + local). Brand kits are not versioned design systems. | Versioned tokens and components across projects (S7). |
| Richer visual editing, multi-element selection, annotations | **partial** | Live: free single-element visual edits, Undo, edit target bound to its version. On `feature/editor-quality` (implemented + local): readable selection labels, keyboard selection and Escape, "Saved as version N · Undo", undo surviving a tab switch. | Multi-element selection and annotations are **absent**. |
| GitHub | **partial** (push only) | Code on main: GitHub App connection and a full-source push to a per-website branch (`github_website_links`). Production availability depends on the `MAKEBORNE_GITHUB_*` settings, which were not verified in this pass. | Pull, branch choice, conflicts and two-way sync are **absent** (S8). Verify current behaviour first. |
| Native CSV/XLSX/DOCX/PPTX ingestion | **absent** (refused honestly) | Live M09: these files are refused per file with a reason. Decks export to PPTX; that is export, not ingestion. | Bounded parsers with provenance (S10). |
| Customer-app databases, auth, storage, server functions | **absent** | Makeborne's own database and the enquiry gateway are not customer backends. No toggle exists, and none should be added. | Architecture decision first (S9), then explicit infrastructure approval. |
| Project ownership transfer and portable client handoff | **partial** | Source download (`website-source-download.tsx`), GitHub push, client review links and publishing. No workspace-member invite or ownership-transfer routes exist on main. | Transfer and handoff package are **absent**. They need an authorisation design (who may transfer, billing and data retention). |

None of these is in the core gallery/creation candidate. Each is a separate increment after the core journey is stable.
