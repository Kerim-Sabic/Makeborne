# Client portal (Phase 1: agency approves every change)

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
