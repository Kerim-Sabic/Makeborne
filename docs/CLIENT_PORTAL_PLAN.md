# Client portal: design plan

Client logins and client-editable content, with agency branding. This is a design, not implemented yet (2026-10-15).

## Facts from the code that shape the design

1. **Trusted publication is a prerequisite.** Source (React/Vite) sites publish only through `request_publication_preparation`, then the worker compile, then `promote_publication_preparation`. That path is still off in production (`MAKEBORNE_TRUSTED_PUBLICATION_ENABLED`). Until it is on, client edits can only be saved for the agency to publish.
2. **Clients must never become `workspace_members`.** `can_read` grants every tenant table to members. Portal access therefore gets its own grant tables, and portal users fail every existing RLS policy by construction.
3. **Client writes can't use the browser role.** `require_creation_membership_write` blocks authenticated writes by users without a membership. Portal writes therefore run as service_role through SECURITY DEFINER RPCs, with `p_actor` and a session check (the publication RPC pattern).
4. **Publishing as an offline owner needs a live check.** Owner membership freshness lasts five minutes, so a client-triggered publish must refresh the owner's entitlement live first.
5. **No toolchain change is needed for content files.** `.json` files are already editable project files, bundled by the browser bundler and Vite. `src/content/*.json` needs no change to the source schema, the DB source trigger or the publication controller.
6. **Every version stores the whole project.** Client drafts therefore live in a small side table, and a version is created only on publish or approval.
7. **AI runs can collide with client saves.** Runs save with the expected version captured at the start, so a portal save mid-run causes a conflict. A rebase over portal-only versions is needed.
8. **No source reaches client browsers.** Client previews use the trusted preparation's rendered "final appearance".
9. **There is no transactional email.** v1 invites are a copy-once link plus a `mailto:`. Login is an email one-time code. The Supabase templates must include `{{ .Token }}`, and custom SMTP must be on.

## Content model

- **Files:**
  - `src/content/collections.json`: the manifest. Only the agency edits it.
  - `src/content/<name>.json`: one data file per collection. List collections are `{items:[{id,…}]}` with stable ids; single collections are plain objects.
- **Field types:**
  - text (single or multiline), richtext (structured blocks, never HTML), number, price (decimal string), date, time;
  - hours (weekly shape plus exceptions), boolean, select;
  - url (https, mailto, tel, internal route or anchor only), email, phone;
  - image (`{src, alt}`, where src must be a project asset path).
- **Limits:** names are regex-bounded (which blocks `__proto__`), a data file is at most 200 KB, all content at most 600 KB, and `maxItems` at most 200.
- **Shared validation:** `src/lib/portal/content-model.ts` is client-safe. Portal forms, routes and `ProjectFiles.problems()` all use it, and `problems()` also forbids `dangerouslySetInnerHTML`.
- **Enforced in SQL:** the portal save function splices only the allowed `src/content/<name>.json` files, with per-file sha256 optimistic concurrency. Everything else (other files, routes, seo, style) stays byte-identical. A `portal_version_guard` trigger refuses versions by non-members unless a transaction-local marker is set.

## Security

- **Grants:** scoped to (workspace, client, user), with each site enabled explicitly. Every call re-checks that the project still belongs to the client, that the grant is accepted and not revoked, `paid_through`, that the site is enabled, that it is a website, and `owner_can_host`.
- **Out of reach for clients:** source, CRM, billing, other clients, brand kits (apart from the agency's display fields), analytics, enquiries and audit tables.
- **Portal routes:** use a new `portalContext()`, not `cloudContext`. Every read and write is a grant-checking RPC.
- **Agency actions:** revocation always works, even without a membership. Reviewers can't manage the portal.
- **Audit:** all portal actions go into `audit_events`, with names and counts only, never content.
- **Rate limits:**
  - draft saves: 120 per hour per grant;
  - portal versions: 20 per day per site;
  - publication preparations: 10 per hour per actor;
  - invites: 30 per day per workspace;
  - grants: 100 per workspace and 10 per client.

## Phase 1: smallest useful slice

New builds include content collections, such as:
- menu or services with prices;
- opening hours;
- contact details;
- team;
- news.

The agency enables client editing on a site and invites the client. The client signs in with an email code and edits these. Publishing works in one of two modes:
- **direct:** the client publishes (requires trusted publication);
- **review:** the agency approves.

There are no uploads in Phase 1; image fields pick from the site's existing photos.

- **Migration A** `…_client_portal.sql`:
  - `client_portal_access` (invites and grants, token hash, `paid_through`, `plan_label`);
  - `client_portal_sites` (enabled, publish mode, allowed collections);
  - `client_portal_changes` (draft, pending, approved, rejected, applied, withdrawn);
  - private helpers, the guard trigger, portal RPCs (home, read site, save draft, submit, apply, invite read and accept) and agency RPCs (create, resend and revoke invites, site settings, access updates, decide on changes).
- **Migration B** `…_client_portal_publication.sql`: portal variants of publication authority, request and promote, ideally sharing cores extracted from the owner functions. This needs the full publication rehearsal.
- **Libraries** in `src/lib/portal/`: `content-model.ts`, `contracts.ts`, `server.ts` (`portalContext`, error mapping, owner entitlement refresh), `branding.ts` (portal theme from the workspace brand kit) and `rebase.ts`.
- **Routes:**
  - client side, under `/api/portal/…`: home, accept invite, read site, draft, changes, image thumbnails, publication;
  - agency side: client portal grants and invites, per-site portal settings, approve or reject changes.
- **Existing files to update:**
  - `proxy.ts` (portal paths);
  - `auth-flow.ts` (portal destinations);
  - `website-run.ts` (rebase on PT409).
- **Pages and components:**
  - `/portal`, `/portal/login`, `/portal/join/[token]` and `/portal/sites/[artifactId]`, with branded shell, site editor, collection forms, field editors (including hours and rich text) and publish with the prepared preview;
  - a shared `prepared-preview.tsx`;
  - studio panels: client portal panel on client Details, portal settings in Publish, and change review with an item-level diff.
- **Builder:** a CLIENT-EDITABLE CONTENT section in `prompt.ts`. It covers:
  - static JSON imports, with values rendered only as text, validated links or images;
  - one source of truth;
  - layouts that work with 0, 1 and the maximum number of items;
  - preserving item ids;
  - `problems()` validating the manifest, the data files and their imports.
- **Checks:**
  - `check-content-model.cjs`, `check-portal-routes.cjs` and `check-rebase.cjs`;
  - `check-client-portal.sql` (isolation, boundary, conflicts, revocation, invites, guard, limits, audit, cascade);
  - `check-client-portal-publication.sql`;
  - updated builder and auth-flow checks.
- **Risks:**
  - publication is off in production;
  - the content contract may affect design quality (needs a paid A/B run);
  - studio conflicts after client publishes;
  - the publication refactor must be rehearsed;
  - portal and studio share a session.

## Phase 2

- **Image uploads:** 8 MB, EXIF stripped, WebP, with quotas.
- **Draft previews:** preview-purpose preparations with content overrides.
- **Older sites without content files:**
  - deterministic "Let client edit this" in click-to-edit;
  - an AI "Make this site client-editable" pass, gated on visible text staying identical.
- **Merging:** item-level three-way merge, and a studio autosave rebase.
- **Collection routes:** pages per item, such as news posts.
- **Smaller items:** undo, rich-text marks, and hours and contact feeding structured data.

## Phase 3

- Custom portal domains and white-label branding.
- Branded transactional email.
- Agency-to-client billing.
- Portal seats in Makeborne plans.
- Multiple client users with roles.
- Showing clients their analytics and enquiries.

## Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Turn on trusted publication in production before launch, or ship "agency publishes" first? | Ship once trusted publication is live |
| D2 | Default publish mode | Review |
| D3 | Content collections in new builds | On by default for client sites; needs a paid A/B quality run |
| D4 | Instant source preview in client browsers? | No; prepared previews only |
| D5 | Invite redemption | Strict email match |
| D6 | Client login | Email code only for now |
| D7 | Invite email | Copy link + mail app in v1; branded email later |
| D8 | "Powered by Makeborne" in the portal; paid white-label? | Owner's call |
| D9 | Pricing | Included with fair-use caps, or a paid add-on |
| D10 | Owner's membership lapses | Portal becomes read-only |
| D11 | Who approves client changes | Owner and editors |
| D12 | Image upload storage quota | Owner's call (uploads off in production today) |
| D13 | Content responsibility | Terms: the agency is responsible for client-published content |
| D14 | Portal-only users visiting /studio | Redirect to /portal |
| D15 | Clients see enquiries and analytics? | Phase 3 |
