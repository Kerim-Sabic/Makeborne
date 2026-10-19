# Release and recovery procedure — `a6e70c6` (prepared, NOT executed)

Nothing below has been run against production. Each numbered production action needs the owner's explicit approval.
Every commercial capability stays off throughout: provider spending scopes disabled, `creation_enabled=false`,
credit packs closed, `MAKEBORNE_TRUSTED_PUBLICATION_ENABLED` unset, enquiries forwarding off, mail automation off.

## 0. Preconditions (read-only)

1. Production still serves `f696b3a` (`dpl_CBFzseN65RTZFm5KAviBEJyN6kRr`) and has exactly 93 rows in
   `supabase_migrations.schema_migrations`, the last `20261017080000`. If either changed, stop and re-qualify.
2. All provider limits read back disabled; `billing_settings.creation_enabled = false`.
3. No other agent is deploying or migrating (check `docs/AGENT_HANDOFF.md`).

## 1. Production database (approval A)

1. Custom-format backup with the same method as `staging/staging-apply.mjs` (`pg_dump --format=custom`, read-only session,
   TLS verify-full), verify `pg_restore --list`, record bytes and sha256 outside Git.
2. Apply exactly one file, `supabase/migrations/20261019090000_app_observability.sql`
   (LF sha256 `c05a3c7b974a15331150b56a0b43976da109f3b3c3e86f484d6f16fc1b1efeb4`), in one transaction, with an
   explicit production target (pattern: `work/release-studio-parity-qualified-20261017/production-apply.mjs`), and record
   version `20261019090000` in `supabase_migrations.schema_migrations`. **Never `supabase db push` against the linked project.**
3. Verify read-only: 94 migrations; tables `makeborne_private.app_error_groups`, `app_error_days`, `telemetry_salts`,
   `studio_visits` exist with no SELECT/INSERT/UPDATE/DELETE privilege for `anon` or `authenticated` and the private schema
   is not API-exposed (criterion corrected during execution: these private tables have RLS off, like two pre-existing private
   tables, so "RLS on" was mis-specified; enabling RLS on them is optional hardening); `makeborne_record_app_error`, `makeborne_record_studio_visit`,
   `makeborne_admin_health` are executable by `service_role` only; Security Advisor shows no new warning.
   The migration is additive and unused by `f696b3a`, so it is safe before the app changes.

## 2. Application (approval B)

1. Build every release artifact with `git -c core.autocrlf=false` (N7).
2. Before pushing the branch, read the production Vercel project's **Preview** settings: previews share production's
   Supabase URL (N9). Confirm the preview maintenance setting blocks API reads/writes, or push only after accepting that a
   preview of the candidate can reach production data through its own UI.
3. Push `release/rc-20261019` and open a PR to `main`. Its code must equal `a6e70c6`:
   `git diff a6e70c6 <PR head> -- . ':!docs'` is empty (later commits on the branch are evidence docs only).
4. Require CI green, then merge normally (no force push, no admin bypass). Vercel deploys `main` to production.
5. Confirm the production deployment is READY, serves the merge commit, and `makeborne.com` points to it.

## 3. Post-deploy verification (approval C; no paid calls, no customer content changed)

1. `GET /api/build` answers `{available:false, configured:true, state:"paused"}` (or `off`) with `estimates`.
2. Read-only classification of every artifact's current version with `savedFormat` (`src/lib/cloud/saved-preview.ts`):
   the 13 legacy records (3 books, 2 decks, 8 sites; ids in `work/launch-audit-20261019/legacy-documents.json` for five of
   them) classify as `outline` or `website-design`, none as `starting`. Then open one legacy book and one legacy site as the
   account owner (or an administrator acting on the owner's instruction) and confirm the text renders and no build request is sent.
3. `/help/publish-your-website` and `/help/make-a-book-with-ai` contain neither "print-ready" nor "live in seconds".
4. Studio telemetry `POST /api/telemetry` → 204; `/admin` → Health shows the new error/visit counters.
5. Watch runtime logs and errors for 30 minutes: zero 5xx, zero new error groups attributable to the release.
6. Record results with timestamps next to this file.

## 4. Recovery

* **Application regression:** open and merge a normal revert PR of the release merge; Vercel redeploys the previous code.
  Leave migration `20261019090000` in place (additive; the previous code never calls it). Do not restore the database.
* **Migration fails:** it runs in one transaction, so nothing is applied; stop the release and keep production on `f696b3a`.
* **Database damage (not expected):** a restore from the step-1 backup is a separate incident with reconciliation of any
  writes since the backup; never restore over payments or usage recorded later.
* **Staging:** now serves `a6e70c6` with the migration applied. To return staging to the previous app, re-point
  `makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app` to `dpl_AWs16XNFspV6bm6MDWSKPFD2YtVg`
  (`aecb0b6`); keep the migration. Staging backup taken before the migration: `staging-before-a6e70c6.dump`
  (sha256 `fc2c0f4824e51924fcbd7b61fc68652bd11e331a32faa137973aa955172c3d55`, in ignored `work/rc-stack/staging/`).

## 5. Before any commercial capability is switched on (separate approvals, separate qualification)

| Capability | Evidence still required |
| --- | --- |
| AI generation (L03) | Recorded allowance and daily budget; fresh non-admin paid account creates, edits and resumes a website, book and deck on staging within holds; Plan mode re-measured (Q01) |
| Checkout and renewals (L05, L07) | Sandbox access restored; signed end-to-end purchase, duplicate/out-of-order delivery, renewal, failure, refund; scheduled reconciliation configured and seen running; N3 decided |
| Credit packs | Published pack terms (expiry conflict in `INVARIANTS.md`), signed top-up delivery |
| Plan switching (L06) | Owner decision on support-only vs in-app; then charge/allowance tests |
| Trusted publishing and enquiries (L04) | Allowance for sandbox compute; candidate publish, republish, rename, unpublish, forms→CRM on the two QA hosts; production controller profile; N4 decided |
| AI images (L08) | Supported model, key, measured bounds, export with images |
| Opening checkout at all | Plan copy promises publishing (M01): publishing must be on, or plan copy changed first |
