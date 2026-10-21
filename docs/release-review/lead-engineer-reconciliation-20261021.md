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
