# Makeborne scope matrix (audit M17)

20 October 2026, branch `feature/lovable-scopes` (base `6b78269`). Local only: no production database, Worker, DNS, OAuth or permission setting was changed, and no paid AI call was made. No secrets, tokens or signed URLs appear here.

**Evidence levels.** *SQL-tested* means asserted by `supabase/check-scope-matrix.sql` or `supabase/check-browser-acl.sql` (plus the existing per-feature `supabase/check-*.sql`) on a disposable database built from every migration. *Route-tested* means an HTTP probe against a local dev server on the local `release-auth` stack. *Offline-tested* means a `check-*.cjs`/`check-*.mjs` harness with mocked I/O. *Source* means read, not executed.

## 1. Who the actors are

| Actor | How Makeborne knows them | Authority source |
| --- | --- | --- |
| **Owner** | `workspaces.owner_id` | `makeborne_private.is_owner` (`20261003114223_makeborne_foundation.sql:23`) |
| **Editor** | `workspace_members.role='editor'` | `makeborne_private.can_edit` (`…foundation.sql:32`, re-defined `20261004162455_whop_membership_access.sql:87`) |
| **Reviewer** | `workspace_members.role='reviewer'` | `makeborne_private.can_read` (`…foundation.sql:27`); every app write path refuses it (`src/lib/cloud/server.ts:151-156`) |
| **Removed member / other tenant / signed-in outsider** | signed-in account with no row for the addressed workspace | nothing: every RLS helper reads `workspace_members` live on each statement |
| **Client portal user** | `client_portal_access.user_id` after accepting an invite; never a workspace member | `makeborne_private.portal_grant` (`20261016090000_client_portal.sql:197`), re-checked on every portal call |
| **Anonymous review-link holder** | possession of a 256-bit bearer token; types their own name | `makeborne_private.client_review_live_link` (`20261011130000_client_review_links.sql:287`) |
| **Signed out** | none | hosting readers and the token/invite entry points only |

Role is never taken from the session token or user metadata. `cloudContext` (`src/lib/cloud/server.ts:95`) loads the role from the database on every request; `X-Makeborne-Account` can only constrain the authenticated identity (`:113`), never grant it.

## 2. Matrix

R = read, W = write, — = nothing. "Server" means the write happens with the server key after the route authorised the actor; browsers hold no direct write grant (`supabase/check-browser-acl.sql`).

| Resource | Owner | Editor | Reviewer | Portal user | Review-link holder | Signed out | Enforced at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace, members | R, W (members) | R | R | — | — | — | RLS `workspace_read`, `membership_*` (`…foundation.sql:151-155`, `20261008181817_…deduplication.sql`); owner transfer impossible (no `owner_id` update grant) |
| Projects, artifacts (titles, kind, status) | R, W | R, W | R | — | — | — | RLS `tenant_*` (`…foundation.sql:157-166`); column grants: `artifacts.title` only, `projects` metadata only; no hard delete (`:178`) |
| Versions (saved source/content) | R, append via SQL function | R, append | R | — | fixed or latest version of one artifact | — | `artifact_versions` select-only + `version_insert`; immutable trigger (`…foundation.sql:213-239`); saves through `makeborne_save_artifact_version` |
| Website source bundle download | yes | yes | **no** | — | — | — | route `source/route.ts:15`; see §5 (reviewers can still read version content by RLS) |
| Sources, tasks, style profiles | R, W | R, W | R | — | — | — | RLS `tenant_*` |
| Assets: registry rows | R, insert | R, insert | R | images of granted site only | images of the reviewed version only | — | RLS `tenant_*`, append-only (`…foundation.sql:180`) |
| Assets: original bytes, previews, exports | via route | via route | via route (preview; export disabled in production) | via portal route | via review route | — | **server-key read only after the caller's RLS sees the registered asset** (`src/lib/cloud/asset-storage.ts`); bucket private; **no browser SELECT on `storage.objects`** after `20261020203000`; review `api/review/[token]/assets/[assetId]/route.ts`, portal `api/portal/sites/[artifactId]/images/[assetId]/route.ts` authorise by RPC first |
| Brand kits (identity facts) | R, W (server) | R, W (server) | R | — | — | — | RLS `brand_kits_member_read` (`20261014190000_brand_kits.sql:45`); route `brand-kits/route.ts:14-16`; no FK to project/version/asset |
| Clients, contacts, CRM notes | R, W | R, W | R | own portal overview only (no notes) | — | — | RLS `tenant_*`; `clients` column grants; CRM triggers |
| Mail accounts, templates, sequences, enrollments, messages | R; send only from own mailbox | R; send only from own mailbox | R (incl. sent bodies) | — | — | — | RLS `tenant_read` (`20261013240000_crm_email_automation.sql:115-127`); `mailContext`/`ownMailbox` (`src/lib/mail/server.ts:12-25`); tokens in `makeborne_private.mail_tokens`, service role only |
| Review links (agency side) | R, create/revoke | R, create/revoke | R | — | — | — | create is service-role with verified actor + `client_review_can_edit_as` (`20261011130000_…:406`); revoke/resolve require `can_edit` (`:469`, `:479`); token hash never selectable |
| Review comments and decisions | R, resolve | R, resolve | R | — | comment and decide on the version shown; **cannot resolve, revoke or publish** | — | `makeborne_add_client_review_comment`, `makeborne_decide_client_review` (`20261013160000_…:77`, `:107`) |
| Client portal grants, site settings, changes | R, invite/revoke, approve | R, invite/revoke, approve | — (refused even for reads) | own grant: allowed collections of enabled website projects of their client, current version | — | invite preview only | `agencyContext` (`src/lib/portal/agency.ts:15`); `portal_grant` (`…client_portal.sql:197`), re-checked per call |
| Publication (hosted site, live/offline, JS mode) | R, publish | R | R | — | — | published pages only | route owner check (`publication/route.ts:57`, `:118`); SQL owner check in `promote_retained_site_v4`; service role only |
| Custom domains | R, W (server) | — | — | — | — | resolves to a live site only | route `domains/route.ts:17`, `domains/[domainId]/route.ts:14`; RLS `custom_domains_owner_read` (`20261014160000_custom_domains.sql:74`) |
| Site analytics, enquiries | R | — | — | — | — | record a signed view / submit an enquiry | routes `analytics/route.ts:16`, `enquiries/route.ts:7`; owner-only RLS (`20261014170000_site_analytics.sql:86-88`, `20261012184407_hosted_site_enquiries.sql:21`) |
| Billing, credits, membership | own account | own account | own account | own account | — | — | `credit_ledger_own_read` (`20261011090000_credit_wallets_free_tier.sql`); billing tables server-only |
| GitHub connection, website link | own connection | own connection | — | — | — | — | per-user encrypted grant; links keyed by `user_id` (`api/cloud/…/github/route.ts:22,55`) |

SQL-tested read matrix (23 resources × 8 actors, `check-scope-matrix.sql` section 1): owner, editor and reviewer read every workspace resource; custom domains and enquiries are owner-only; other tenant, signed-in outsider, portal user and anonymous read nothing; no browser session (owner included) sees `project-assets` object rows; credits are per account.

## 3. Lifecycle

| Event | Effect | Evidence |
| --- | --- | --- |
| **Member removed** | Next statement: no reads, no writes, no asset objects; review links they created serve `{"status":"revoked"}` and refuse feedback; **mailboxes they connected in that workspace are disconnected** (token replaced by the inert `revoked` marker, account `disconnected`, active sequences paused, sent history kept). Other members' mailboxes untouched. | SQL-tested (section 4); trigger in `20261020203000` |
| **Editor demoted to reviewer** | Edit authority and mailbox use end at once; read stays. Re-promotion never reconnects a mailbox silently. | SQL-tested |
| **Workspace switch** | Authority is the addressed workspace's membership on every query; the same editor gets nothing from another workspace (tables, title search). | SQL-tested (section 3) |
| **Private preview session after removal** | Bounded: at most 20 minutes, consumed once, re-checked against the actor's session (`20261008182736_private_preview_sessions.sql:20,66`). | Source |
| **Portal grant revoked / unpaid / project moved / site disabled** | Refused on the next call; open changes withdrawn. | Existing `check-client-portal.sql` (12 groups PASS) |
| **Review link revoked / expired / creator lost editor** | Unavailable at once. | Existing `check-client-review-links.sql` + matrix |
| **Workspace deleted** | All tenant records cascade (clients, projects, artifacts, versions, links, portal grants, domains, mail rows). Bucket objects remain but are unreadable by any browser role; deleting them is an operator retention task. | SQL-tested (section 7) |
| **Project/artifact delete** | Not available to browsers (archive instead). | `check-browser-acl.sql` |
| **Account deleted** | `workspace_members`, mail accounts, GitHub connection and links cascade with `auth.users`. | Source (FKs) |

## 4. Separate permissions that must stay separate

- **Identity vs. style vs. code reuse.** A brand kit holds identity facts (name, colours, fonts, logo, tone) per workspace or client and has no key to any project, version, asset or source; applying it copies the logo into the target project as a new asset. Curated styles (`style_id`) are catalogue IDs with no tenant data. There is no cross-project code-package or remix path today. Reusing a style therefore never grants source access, and source access never grants a style. SQL-tested (section 6).
- **Collaborator access vs. client approval vs. resolution vs. publication.** Review-link decisions are typed names on a bearer link: no account is recorded (`client_review_comments` has no author account column, asserted). A decision records the client's approval on its own link and moves only that project's delivery stage; it never resolves feedback, revokes links, changes the saved version or publishes. Resolution needs `can_edit`; publication needs the owner. The studio now labels decisions "Approved by "Name" (unverified)" with "Name as typed on the review link, not a verified account. Approval doesn't publish." (`src/lib/client-review/feedback.ts`). The collaborator `reviews` table (reviewer role may insert) is only consumed as repair input bound to the approving operator (`20261008210222_operator_website_repair_review.sql:95-118`), never as approval or publication.
- **Fixed vs. latest scope.** A review link fixed to version N always shows N and refuses decisions on other versions (`PT409`); a latest link follows saves. Portal grants always edit the current version; each change records `base_version` and approval refuses conflicting agency edits. SQL-tested here and in the existing checks.
- **Connectors.** Sign-in, mailbox send (personal, owner-only, send-only Google scope by default), GitHub repository access (per user) and website publication are distinct grants (`docs/release-review/lovable-connector-boundaries-20261020.md`). Disconnect is local; provider revocation is the person's own action and is never claimed.

## 5. Gaps found and what changed

| # | Gap (repro) | Fix | Status |
| --- | --- | --- | --- |
| G1 | **Self-minted asset URLs outlive removal.** The storage API signs a download URL for anyone who can SELECT the object row, for any lifetime the caller picks, and never re-checks RLS when it is used (`storage-api` `signObjectUrl` → `findObject`, then a JWT). `project_assets_read` let every member, reviewers included, select every object in the workspace. Repro (local evidence log, not committed): `repro-gaps-before-fix.log` ("reviewer sees 1 project-assets object row"); release-auth run before the migration fails "A browser session can see project-assets object rows". | App reads bytes through `src/lib/cloud/asset-storage.ts` (caller RLS must see the registered asset for that exact path, then the server key reads); migration `20261020203000` drops the browser SELECT policy. Uploads unchanged (insert policy; `upsert:false` never needs SELECT). | Fixed locally. **Deploy app first, then migration.** Needs Codex staging qualification. |
| G2 | **Removed editor's mailbox keeps sending.** Removing or demoting the person who connected a mailbox left it `active`, its token usable and its sequence due; the cron would keep sending and syncing replies through a departed person's account. Repro: same log ("mailbox/enrollment/token-usable = active/active/true"). | Trigger `workspace_member_mailbox_revocation` (same effect as the Disconnect route). | Fixed locally, SQL-tested. An enrollment already claimed by a running cron tick may still complete that one send. |
| G3 | **Typed names shown as verified approvers.** Panel said "Jane approved version 2", feed "Approved by Jane". | Unverified label and note (`feedback.ts`, panel, feed); offline check in `check-client-review.cjs`. | Fixed. |
| G4 | **Custom host contradicted the canonical.** Pages name the Makeborne address as canonical, but the custom host also served a sitemap of its own (non-canonical) URLs and pointed robots at it. | Explicit policy (see `docs/CUSTOM_DOMAINS.md` "Preferred address"): Makeborne address canonical, no redirects, sitemap only there; custom host `/sitemap.xml` 404 and robots without `Sitemap:`. Panel copy states it. | Fixed in Worker, offline + workerd tested. **Needs Codex staging qualification**; custom domains are not enabled in production. |
| G5 | **Local stack privilege drift.** `release-auth` has `anon` and `authenticated` holding ALL on ~20 early public tables (restored without ACLs, default privileges reapplied). RLS still hides rows, but column guards are bypassed: an editor can `UPDATE artifacts SET current_version=99` there. A fresh database built from the migrations has none of this. Repro: `acl-release-auth.log`, `scope-matrix-release-auth-composed.log` ("Editor moved current_version"). | New `supabase/check-browser-acl.sql` detects it in any environment. No local ACL was rewritten (shared stack). | Detector added. **Codex: run `check-browser-acl.sql` against staging and (read-only) production before trusting RLS results there.** |

## 6. Documented, not changed (owner decisions)

- **Member removal is billing-gated.** The `require_creation_membership` trigger also covers `DELETE`/`UPDATE` on `workspace_members`, so an owner whose creation membership lapsed cannot remove or demote a member through the Data API (`MB402`; `repro-revocation-billing-gate.log`). Portal revocation deliberately bypasses this. Relaxing it is a guard change, so it was not made. There is no member-management UI today; removal is an operator action until one exists.
- **Reviewer reads everything in the workspace**, including CRM notes, portal invite emails and sent email bodies. Consistent with "reviewer = read-only collaborator", but broader than "reviews work". Narrowing needs a product decision.
- **Website source download** is refused to reviewers by the route, but reviewers can read version content (the same files) through RLS because previews need it. The route gate is a convenience, not a confidentiality boundary.
- **Primary custom domain** (custom canonical + `301` from the Makeborne address) is not implemented; see `docs/CUSTOM_DOMAINS.md`.
- **Orphaned bucket objects** after deletions remain until an operator retention job removes them (now server-only).

## 7. How to run the evidence

```
# disposable DB built from every migration (Supabase image, auth/storage schema copied from the local stack)
docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-browser-acl.sql
docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/check-scope-matrix.sql
node src/lib/cloud/check-asset-storage.cjs
node infra/customer-sites/check-sitemap.mjs && node infra/customer-sites/check-custom-hosts.mjs
```

Results on 20 October 2026: fresh database — ACL 4/4 PASS, matrix 7/7 PASS (also in a `rehearsal` copy), existing `check-client-portal`, `check-client-review-links`, `check-client-review-document-assets`, `check-review-link-views`, `check-crm-mail-security`, `check-crm-mail-boundaries`, `check-brand-kits`, `check-custom-domains`, `check-artifact-title-search`, `check-site-analytics`, `check-site-enquiries`, `check-hosting-modes`, `check-locked-content`, `check-unified-creation`, `check-client-projects` all PASS with the new migration. Route probe on the local stack: owner upload 201 and preview 200 (`private, no-store`), with the storage log showing the upload as `authenticated` and the read as `service_role`; another project's or tenant's asset id 404; unregistered id 404; signed out 401.

## 8. Rollback

- App: revert `381c96f` (asset reads) only **after** reverting the migration's policy drop, or reads fail closed.
- Database: `create policy project_assets_read on storage.objects for select to authenticated using (bucket_id='project-assets' and exists (select 1 from public.workspaces w where (w.id)::text = (storage.foldername(objects.name))[1] and makeborne_private.can_read(w.id)));` and `drop trigger workspace_member_mailbox_revocation on public.workspace_members; drop function makeborne_private.revoke_departed_member_mailboxes();`. Mailboxes already disconnected stay disconnected; owners reconnect them.
- Worker: revert `24ac033` and redeploy the previous Worker version.
