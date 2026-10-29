# Next slices: dependency-aware plan, 22 October 2026

Claude, after the lead-engineer brief of 22 October. This is a plan, not a release claim. The status words are the brief's: implemented, locally tested, staging-tested, live, disabled, absent.

## Where things stand

| Slice | Branch / head | Status | What it needs before release |
|---|---|---|---|
| Project library (full-width previews, card actions, first-visit layout, large-screen scaling) | `feature/library-redesign` 0f29ffc | implemented, locally tested | Codex: recheck and stage it as an independent candidate. Independent of the enhancer. |
| Creation flow plus enhancer E1–E4 repair | `feature/creation-quality` 9a7cfa1 | implemented, locally tested | Codex: rehearse migration `20261022100000_brief_enhancement_actions.sql` on staging; one bounded paid staging journey. Keep the enhancer out of any candidate until then. |
| Editor improvements, preview missing-asset fix | `feature/editor-quality` 5f17dd1, stacked on creation-quality | implemented, locally tested | Codex: confirm the coastal-dog project on staging. |
| Generated-site verifier | `feature/editor-quality`, in progress | being implemented | Local tests now; Codex: cloud image, controller and isolation qualification. |
| Hydration | `feature/site-hydration` 62b57a9 | held | Rebase; measure the interactive delay; Codex: sandbox memory (~640 MB) and sanitizer review. |

## Order and dependencies

1. **Generated-site verifier (in progress).** It depends only on the isolated renderer foundation. It unblocks bounded repair (2) and honest evaluation (3), because both need machine-checked behaviour rather than screenshots.
2. **Bounded repair wired to the build operation.**
   - **Depends on:** 1; the existing durable operation, fencing, holds and settlement (`operation-server.ts`).
   - **What:** repair runs only the failed checks' issues, as a new version through the existing build lifecycle (no second charging system), then rechecks only the affected checks. At most 2 attempts within the authorised cap. The previous usable version is never overwritten.
   - **Cost:** paid at run time, so the code is built and tested with a mocked provider, and live use needs a budgeted staging journey (Codex).
   - **Estimate:** 1–2 days.
3. **Evaluation protocol** (no paid runs until authorised).
   - **What:**
     - a frozen set of 24 unseen briefs across 12 industries: 8 short prompts, 8 detailed briefs, 4 custom brands with supplied assets, 4 no-preset;
     - comparable inputs, budgets and correction opportunities;
     - metrics: verifier pass rate (from 1), brief fidelity, mobile behaviour, accessibility (axe), cost, and human correction time;
     - randomised order, independent human review using the judge page, sample sizes and failures reported;
     - position-swapped ratings counted once;
     - Makeborne-versus-Makeborne results never presented as a Lovable comparison.
   - **Builds on:** `scripts/eval` (golden 26 and short 10 brief sets, rubric v1, judge page). This adds the frozen unseen set, the verifier metric and a correction-time log.
   - **Estimate:** 1 day of preparation; runs need a reconciled reservation.
4. **Approved project knowledge.**
   - **Depends on:** existing brand kits, clients and project facts (it extends them; no new CRM or memory store).
   - **Model:** typed entries that the user can inspect, edit and remove, with revision history:
     - workspace convention;
     - client fact or brand;
     - project goal or constraint;
     - design or technical decision;
     - source reference with uncertainty.
   - **Rules:**
     - trusted user instructions are stored apart from imported source material;
     - imports cannot grant tool permissions or overwrite approved facts;
     - each operation snapshots the revisions it used, so a later edit doesn't change an authorised continuation;
     - receipts name the revision ids, never the content.
   - **Needs:** a migration and a route; local SQL tests with RLS.
   - **Estimate:** 3–4 days.
5. **Attachment understanding.**
   - **Depends on:** private storage plus bounded extraction workers. These run in the same isolated-runtime family, never inline base64. Today the builder reads PNG/JPEG/WebP/GIF/PDF/TXT/MD only: up to 5 files, 3 MB combined, 200,000 characters.
   - **Order:**
     1. CSV (headers and rows);
     2. DOCX (headings and tables);
     3. XLSX (sheets, cells, formulas versus cached values);
     4. PPTX (slide order, text, notes);
     5. larger PDFs.
   - **Each type:** decompression, size, time and memory bounds; no macros and no external links. If a chosen source can't be read, the run stops and explains before anything is generated. Tests use fresh facts absent from chat, corrupt files and account boundaries.
   - **Estimate:** about 1 day per type after a 1–2 day extraction foundation.
6. **Agency workflow connection.**
   - **Journey:** lead evidence → approved client facts → proposal → brief → website/book/deck → review → publication → care.
   - **Depends on:** 4, because approved client facts are the spine.
   - **Measures:** time to accepted delivery, revision rounds, factual errors.
   - **Estimate:** specified after 4.

## Later parity work: specify before building

Each needs a design note with its dependencies before any code. None goes into the current release.

- **Precise editing:**
  - extends `visual-edit.ts` with multiple selection, annotations and responsive scope;
  - keeps preview, apply, undo and the version-conflict checks;
  - deterministic edits stay free.
- **Durable follow-up queue:**
  - queued instructions are separate, explicit actions: pause, edit, reorder and remove before dispatch;
  - permission, base version and budget are rechecked at dispatch;
  - one active change per project;
  - unsent drafts are never sent automatically.
- **Independent builder drafts:**
  - each draft has its own base, source, conversation and preview;
  - drafts are compared and accepted explicitly, and accepting is separate from publishing;
  - conflicts are shown;
  - client-portal drafts are not a substitute.
- **Customer application backend:**
  - an architecture decision first: managed resources versus customer-owned connections, covering isolation, quotas, cost, migrations, backup, deletion and portability;
  - generated apps never get platform service-role credentials;
  - no "backend connected" toggle.
- **Runtime packages:**
  - a small, pinned dependency catalogue that preview, server compile, isolated build, renderer, export and publishing all agree on;
  - the import guard stays until then.
- **GitHub round trips:**
  - reviewed inbound changes first;
  - each link is bound to its repository, installation, branch and base SHA;
  - conflicts, revocation, duplicate webhooks and concurrent local edits are handled;
  - never force-push to hide a conflict;
  - today it is push-only.
- **Reusable design systems:**
  - versioned tokens and components, with examples, dependencies, validation and explicit update and rollback;
  - kept apart from brand data.

## External gates that stay with Codex

- Independent review of each candidate.
- Staging migrations.
- Cloud compiler, renderer and verifier qualification and network isolation.
- Staging sign-in, email, publishing and form journeys.
- Whop lifecycle, including the 20 November renewal probes.
- Paid AI and image accounting qualification.
- Provider configuration.
- CI/PR, the final release report, merge and deploy.

None of these is marked passed because a local test passed.
