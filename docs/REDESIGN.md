# Makeborne redesign — 3 October 2026

The user rejected the original warm editorial landing page, folded M and generated paper imagery. The current direction replaces those visible surfaces with a compact rounded mark, neutral product chrome, a central creation composer and authored style previews. Earlier brand-board files are historical and do not describe the current UI.

## Research applied

- [Lovable](https://lovable.dev/): direct browser inspection of its current entry screen showed a dominant composer, quiet navigation and a project gallery. Makeborne adopts a clear starting action and separates format selection from the prompt; its own blue/coral atmosphere and typography remain authored for this product.
- [Bolt](https://bolt.new/): direct browser inspection showed the prompt and format choices grouped together. Makeborne keeps website/book/presentation choices adjacent to the brief, with real text-file import and a working continuation action.
- [Claude artifacts](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them): content has a dedicated work surface. Makeborne keeps the artifact preview central and places editing controls around it.
- [ChatGPT writing blocks](https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt): direct editing, undo and saved context are useful workflow primitives. Makeborne preserves its manual editor and version history while simplifying entry into them.
- [Codex](https://openai.com/index/introducing-the-codex-app/): ongoing work is organised into persistent projects. Makeborne keeps client relationships, artifacts and revisions together rather than discarding context between creations.
- [Gamma creation](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma) and [visuals](https://help.gamma.app/en/articles/11856101-how-do-i-use-the-visuals-menu-in-gamma): clarify the brief and establish the visual direction early. Makeborne carries the selected direction into project setup, with source text distinct from instructions.
- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): reduce the visual weight of navigation and keep actions predictable. Makeborne uses a quieter sidebar, compact controls and stronger focus on the current work.

These are observed/documented interaction patterns and our design inferences, not claims of equal capability or superior usability. No competitor assets or private project contents were reused.

## Interaction contract

The home composer stores a bounded brief in session storage and navigates to project setup. It never pretends that the brief is generated output. Template previews provide direction and a starter brief. Original user content remains separate. The local editor still supports clients, projects, snapshots and exports. Live generation remains unavailable under the current no-paid-calls instruction.

Authentication is being completed against real Supabase flows, with configuration and migration checks. It cannot be described as working live until a configured project, email delivery and the full account lifecycle have been exercised.

## Visual rules

White/off-white surfaces, ink text, fine neutral borders, restrained coral accent, Inter for product chrome. The hero uses an authored CSS atmosphere rather than generated paper art. Style previews are native typography and geometry. Secondary text must remain readable; small labels must not carry essential instructions. Focus states, mobile layouts and reduced motion are part of the implementation.

## Verification for this revision

- Production build completed successfully; TypeScript passed.
- ESLint reported no errors and two existing warnings for user-uploaded inline artwork images.
- Browser checks at desktop and 390px mobile widths: home composer, template gallery, client workspace entry and honest account-unavailable screen.
- Typed home brief was preserved when selecting Signal; its actual palette reached step three. Closing and reopening restored the audience and brief.
- Six direction snapshots are schema validated and carry optional background/text colours into local previews and HTML/PDF/PPTX/EPUB renderers. Complete gallery compositions are inspiration, not implemented generated layouts.
- Signup, confirmation, login and recovery code are implemented. Live provider, SMTP, two-tenant RLS and production generation/export jobs remain unverified and gated. See AUTH_SETUP.md.
- No paid AI calls, purchases or deployment were made. Repository publication is distinct from a production launch.

## Colour and client-workspace refinement

The latest human direction adds more colour and glass to the product. Studio chrome now uses a static blue/coral atmosphere, blue-violet primary actions, translucent navigation/composer surfaces and four softly tinted client counters. Artifact canvases retain their chosen themes. Reduced-transparency and forced-colour fallbacks are included; no continuous decorative animation was added.

The local CRM now has client/project search, per-client format/status filters, actual saved-version counts and recent project activity. New project from a client profile preselects that client, with drafts scoped to that client. Switching clients resets project filters. Client saves validate the workspace and write to browser storage before reporting success; errors keep the form open. These improvements do not enable cloud sync or verified customer approval.

Production build passed. ESLint had no errors and the two existing inline-artwork image warnings. Desktop and 390px mobile studio were visually inspected with no horizontal overflow. The empty-client screen and whitespace-name save guard were checked without creating records in the user's workspace. Populated-client workflow and storage-failure behaviour still need runtime coverage. Live accounts, AI generation, publication and payments remain gated on their documented external configuration and authorization.

## Studio navigation continuity

Studio sections and selected local project/client IDs now have URLs. Refresh restores the matching local record, and browser Back restores the previous section. Missing IDs fall back to the list with an explanation; URLs contain IDs, not client names or emails. Local links require the matching browser workspace and are not cloud sharing links.

Verification: production build passed; six focused route-parser/URL assertions passed. Browser checks confirmed Styles survives reload, Back returns Clients to Styles, and an unsaved client name stays in its open form through Back. No test client was saved. Client/style forms remain mounted on history changes to preserve unsaved input.

## Local save failure recovery

A failed autosave now shows a persistent recovery banner with Retry save and Download backup. The download captures the current in-memory workspace. A beforeunload listener warns while saving remains failed; successfully saving clears that condition. Backup import writes the validated replacement before updating the displayed workspace or announcing success, preserving the existing workspace if storage rejects it.

Validation: production build passed; component lint has zero errors and two existing image-optimization warnings. Storage-quota failure, backup download, and beforeunload behavior have not yet been exercised in a controlled browser failure scenario. These checks remain open; this does not establish production readiness.

## Durable content restoration

Restoring a content version now adds a safety snapshot of the outgoing blocks and records the restoration in activity. The complete validated workspace is written before updating the editor. A failed storage write leaves current content untouched. The history/version caps block restoration rather than discarding existing history. Internally approved content returns to in-progress when restored; project details and style remain unchanged. Undo remains available during the editor session, while the safety version persists in browser storage.

Verification: nine direct assertions cover restored blocks, safety-copy content, approval reset, original immutability, deep-copy isolation, JSON survival, missing versions, version capacity, and activity capacity. Production build passed. These checks do not prove browser reload/restore interaction or simulated storage-failure handling; those remain to be exercised end to end.

## Project tasks and deadlines

History & review now contains structured project tasks: title, optional calendar due date, completion/reopen, and editing. Open tasks are ordered before completed tasks and by due date, with overdue labels based on the browser's local calendar day. Tasks persist with the workspace and backup; old workspaces remain valid. The client project list shows each project's open-task count. Task changes append activity for the client's project history. The complete workspace is validated and saved before applying task changes or clearing entered details, retaining the form on failure. Limits: 300 tasks per project, existing activity cap, no deletion, no reminders, no shared assignments or cloud task synchronization.

Verification: production build passed; lint zero errors, two existing image warnings. Nine schema/static-render assertions passed: valid task, invalid calendar date, blank title, old workspace compatibility, backup round-trip, duplicate ID rejection, task title rendering, open count, edit control. Interactive browser create/edit/complete/reopen and mobile layout remain unverified for this feature.

## Sidebar simplification

Removed the workspace switcher and duplicated home link. The brand is the home link; a quiet New project button sits above Projects, Clients and Styles. Active navigation uses a single pale-blue surface and aria-current. Footer settings/cloud links and a compact device-storage/backup control replace the larger storage notice. Main workspace gradients remain.

Mobile navigation now has an opaque drawer, dimmed/blurred backdrop, explicit close control, Escape handling, and closes before opening the creation wizard. Browser verification: New project opens the three-step creation dialog; Clients navigation closes the mobile drawer; 390px viewport has 375px document width (no horizontal overflow). Desktop and mobile screenshots reviewed and saved. Full generation flows are not verified or enabled by this visual change.

## Creation wizard keyboard flow

Format and style pickers now expose labelled radio groups with one selected option and one tab stop. Arrow keys wrap through choices; Home/End select the first/last option. Changing wizard steps focuses the new heading, and decorative progress segments are hidden from accessibility APIs. The existing dialog focus containment and trigger focus restoration remain in use.

Verification: production build passed. Browser checks confirmed Right selects/focuses Book from Website, End selects/focuses Presentation, and closing the dialog restores New project focus. Style keyboard transitions and full wizard completion were not exercised in this pass; no project was created and no model call was made.

## Unified sidebar and top bar

The navigation rail is now inset with a rounded, lightly tinted glass surface and a restrained lavender New project action. The top bar is transparent, showing the workspace atmosphere; it contains the current section title, local workspace status, and an actual Account link. Removed the redundant breadcrumb prefix and placeholder avatar. Mobile retains an opaque inset drawer, backdrop, and close control. Reduced-transparency and forced-colour fallbacks are supplied.

Verification: production build passed. Desktop screenshot reviewed; mobile drawer open/close checked at 390px with document width 375px, without horizontal overflow. Screenshot saved as makeborne-unified-studio.jpg in user outputs. No generation or account-availability claims follow from these layout changes.
