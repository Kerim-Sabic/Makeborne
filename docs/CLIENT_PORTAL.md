# Client portal (agency approves every change)

Agencies let a client edit their own website content (menu or services, prices, opening hours, contact details, news) in a simple portal with the agency's branding and a small "Powered by Makeborne" credit. Every client change goes to the agency for approval; nothing a client does changes the website until an owner or editor approves it. The design and later phases are in `docs/CLIENT_PORTAL_PLAN.md`.

## How it works

1. **Content collections.**
   - Websites built for a client include `src/content/collections.json` plus one `src/content/<name>.json` data file per collection.
   - Pieces involved:
     - `CONTENT_CONTRACT` (`src/lib/builder/content-prompt.ts`) is added to the build context when the project belongs to a client;
     - `ProjectFiles.problems()` enforces the contract with `src/lib/portal/content-model.ts`;
     - `dangerouslySetInnerHTML` is refused on sites that declare content.
2. **Agency, on the client's "Brand & client access" tab** (`client-portal-panel.tsx`):
   - turns editing on per website;
   - creates an invite link, which is shown once and stored only as a hash. The agency can copy it or send it with "Email it" from their own mail app;
   - sees who has access;
   - removes access.
3. **Client, at `/portal/join/<token>`:**
   - signs in with a one-time email code (strict match to the invited address) and accepts the invite;
   - edits collections at `/portal/sites/<id>`. Drafts save automatically, and nothing is versioned until the agency approves;
   - presses "Send changes to <agency>".
4. **Agency, in that website's Publish tab** (`website-portal-settings.tsx`):
   - sees a plain-English diff, such as "Thursday: closed → 09:00–18:30" or "Added “Children's check-ups”";
   - chooses Approve and save, or Don't approve, with an optional note.
   
   Approval creates a new version as the approving user. Only the changed collection files are spliced in, and every other file stays byte-identical. If the agency changed one of those files since, approval is refused unless they choose to overwrite. Publishing stays the agency's usual step.

## Security

- **Separate grants.** Portal users are never workspace members, and grants live in separate tables (`client_portal_access`, `client_portal_sites`, `client_portal_changes`). Every call re-checks:
  - the grant is accepted and not revoked;
  - `paid_through` hasn't passed;
  - the project still belongs to the client;
  - the site is enabled and is a website;
  - the owner can still host.
- **Locked-down functions.**
  - Client functions run only as `service_role`, with the verified actor and session (`portalContext`, `src/lib/portal/server.ts`).
  - Agency functions need an authenticated owner or editor; reviewers are refused.
  - Revoking works even without a creation membership.
- **Content boundary, enforced in SQL.**
  - Drafts may only touch declared and allowed `src/content/<name>.json` files, never `collections.json`, code, routes or SEO.
  - Values are validated with the content model on the server.
  - Links are https:, mailto:, tel:, site routes or anchors only.
- **Rate limits** (MB429), per grant, site, client or workspace:
  - 120 draft saves per hour;
  - 30 submissions per day;
  - 20 client versions per day per site;
  - 30 invites per day per workspace;
  - 10 grants per client and 100 per workspace.
- **Audit.** Rows go to `audit_events` with actor, names and counts only, never content, emails or notes.

## Verification (2026-10-15)

- **`supabase/check-client-portal.sql`:** 11 PASS groups, inside BEGIN…ROLLBACK on the fresh-quality and release-auth stacks. They cover exposure, invites, settings, home and read, isolation (0 rows from 12 tables), the content boundary, approval and conflicts, re-checked grants and revocation, rate limits, audit and cascades.
- **Offline:** `src/lib/portal/check-content-model.cjs` passes 8/8 and `check-portal-routes.cjs` passes 15/15. `run-checks` passes 133/133.
- **Real end-to-end on the local release-auth stack** (`work/click-to-edit-20261014/portal-e2e.cjs`, with `portal-e2e-db.cjs setup`/`teardown`):
  - the agency enables editing and creates an invite;
  - the client signs in with a one-time code issued by the local auth admin API, and is confirmed not to be a workspace member;
  - the client edits services and hours, and the draft saves without creating a version;
  - the client sends the changes, and the agency sees a readable diff and approves;
  - version 2 contains exactly the client's edit, with other files byte-identical;
  - the client sees the approval and the agency's note;
  - every step appears in the audit trail.
  
  The teardown removed every portal object and test row afterwards.

## Release steps

1. Rehearse and apply `supabase/migrations/20261016090000_client_portal.sql`. It is additive: three tables, two partial indexes on `audit_events`, and the portal functions. It works with or without `brand_kits` (the agency brand falls back to the workspace name).
2. **Supabase Auth:** the Magic Link and Confirm sign-up email templates must include `{{ .Token }}` so clients can type the code. Custom SMTP must be on.
3. No publication-function changes. Clients can't publish in Phase 1, by owner decision.

## Phase 2 (branch `feature/client-editing-phase-2`, not part of the 2026-10-17 release)

Three additions, all still behind agency approval:

- **"Make this site client-editable".** On a client website that declares no editable content, the Publish tab offers this button. It only puts a fixed request (`MAKE_EDITABLE_REQUEST` in `src/lib/builder/content-prompt.ts`) in the builder chat; the owner sends it as a normal build (credits, undo from History). The request is a restructure, not a redesign: facts move into `src/content/*.json` collections and every visible word, image and style stays.
- **"Let my client edit this"** in click-to-edit (client websites only). The selected plain text moves into `src/content/site.json` (a single collection "Website text", one text field named by the agency) and the JSX renders `{siteContent.<key>}`. The page looks the same; it is an ordinary saved version and can be undone. Text with styled runs (for example an italic word) or live values is refused with a pointer to the builder. Re-selecting a handed-over text explains where it is now edited.
- **Client photo uploads.** In an image field the client can upload a JPG, PNG, WebP, AVIF or iPhone (HEIC) photo up to 8 MB. The server re-encodes it with sharp (orientation applied, EXIF/GPS and other metadata dropped, at most 2400 px, WebP 82, at least 200 px, at most 4 MB stored) into `project-assets/<workspace>/<project>/portal/<asset id>.webp` and registers it (`public.assets` row with provenance `portal_upload`, plus `client_portal_uploads`). It appears in that site's picker as `/images/client-<12 hex>.webp`. The agency sees the new photos with the change; approving adds only the photos the approved files reference to the new version's `websiteSource.assets` and `asset_manifest` (at most 100 source assets). Limits: 40 uploads per grant per day and 60 per site in total (MB429). Known limit: there is no way yet to delete an upload, and unused uploads stay in storage; a cleanup or delete action belongs in a later phase.

### Migration `20261017090000_client_portal_uploads.sql`

Additive, applies after `20261017080000_rpc_definer_boundary.sql`:

- table `client_portal_uploads` (RLS: members read; no browser writes; cascades with the grant, site and workspace);
- `makeborne_private.portal_upload_scope` and `portal_register_upload`, each behind a service-role-only `public` invoker bridge;
- `create or replace` of `makeborne_private.portal_read_site` and `portal_image` (uploads in the picker and thumbnails);
- `create or replace` of `makeborne_rpc.makeborne_decide_portal_change` (attaches referenced uploads) and `makeborne_rpc.makeborne_portal_site_settings` (lists the site's uploads among the images the agency's approval validates against). These replace the privileged implementations behind the existing `public` security-invoker wrappers, so grants and the advisor result are unchanged.

### Verification (2026-10-17)

- **SQL:** `supabase/check-client-portal-uploads.sql` passes 5 groups. Together with the 7 release suites (brand kits, client portal 11/11, custom domains, GitHub refresh, review views, analytics, sitemap), it runs on top of the whole release chain plus this migration inside BEGIN…ROLLBACK. The advisor-equivalent query (SECURITY DEFINER functions in `public` executable by anon or authenticated) returns the same 6 baseline functions as before the release.
- **Offline:** `check-visual-edit.cjs` 12/12 (hand-over: keys, import placement including multi-line imports, merging an existing collection, refusals, `problems()` clean), `check-portal-routes.cjs` 16/16 (upload route: same origin, photo types only, re-encoding with metadata stripped, storage path, trusted arguments, quota, idempotent re-upload; settings uploads), `check-content-model.cjs` 9/9 (studio wiring). `run-checks` 133/133, TypeScript and ESLint clean.
- **Real end-to-end on the local release-auth stack** (`work/client-editing-phase2-20261017/e2e.cjs` with `db.cjs setup`/`teardown`, phase 2 code served from the worktree):
  - the client uploads a 3000×2000 JPEG carrying EXIF; the stored object is a 2400×1600 WebP with no metadata;
  - the agency's review reads "“Teeth whitening”: photo added" and shows the photo; approving creates version 2 whose source assets and asset manifest hold exactly that photo;
  - the agency hands the hero intro to the client: the preview is unchanged, `site.json` and the import are written, and the photo asset survives the agency save; the client then sees a "Website text" tab with the text;
  - on a client site without editable content, the button fills the builder chat and creates no version;
  - no browser errors; the teardown left 0 portal objects or test rows.
- **Paid test** of the make-editable request (Monee Dental redesign, medium effort, $0.51): one pass, 0 static problems, 6 content collections. The visible text was identical (97/97 lines, same order), with the same page size and a 0.002% pixel difference.

### Release steps (when the owner approves Phase 2)

Apply `20261017090000_client_portal_uploads.sql` after the release migrations; re-run `check-client-portal-uploads.sql` and the advisor comparison on staging (expect no new warnings). No Worker, Auth or environment changes. The `project-assets` bucket already exists.
