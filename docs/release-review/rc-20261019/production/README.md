# Production release record — rc-20261019 (owner-approved 2026-10-19)

Approval (owner, in chat): run `RELEASE_PROCEDURE.md` steps 0–3 for `a6e70c6` — production backup and the single
app_observability migration, push and PR (check preview env first), merge after CI, post-deploy checks and a 30-minute
watch; keep every commercial capability off.

| Time (UTC) | Step | Result | Evidence |
| --- | --- | --- | --- |
| 12:01 | 0. Preconditions | Production `f696b3a` (`dpl_CBFzseN65RTZFm5KAviBEJyN6kRr`); 93 migrations ending `20261017080000`, identical to the candidate's first 93; provider scopes 0 enabled; creation checkout off; packs 0; access plans 0; 9 security warnings | `00-vercel-before.json`, `01-preflight.json` |
| 12:02 | 1. Backup | 1,827,363 bytes, 2,335 entries, full decode passed, sha256 `6eaed14f…7eb8` (file kept in the ignored operator folder) | `02-backup.json` |
| 12:02 | 1. Migration | Dry run listed only `20261019090000_app_observability.sql`; applied through an explicit production `--db-url`; 94 migrations | `03-apply.json` |
| 12:02 | 1. Verify | Three functions service-role only with pinned `search_path`; new private tables: no client privileges, schema not API-exposed; switches unchanged; security warnings 9 → 9. The procedure's "RLS on" criterion was mis-specified for private tables and corrected with evidence (`prod-private-check.mjs`) | `04-verify.json` |
| 12:06 | 2. Preview env | Production-project previews: `MAKEBORNE_RELEASE_MAINTENANCE=on`, no service key, SSO protection → safe to push | `05-preview-env.json` |
| 12:06–12:21 | Baseline watch (`f696b3a`) | 10 samples, 0 HTTP failures; 0 runtime errors and 0 5xx requests (log filter corrected, see note) | `08a-pre-deploy-watch.json` |
| 12:22 | 2. PR and merge | [Kerim-Sabic/Makeborne#5](https://github.com/Kerim-Sabic/Makeborne/pull/5): CI 4/4 green, head code identical to `a6e70c6`; merged with a merge commit `d14bf303` | `gh pr view 5` |
| 12:26 | 2. Deploy | `dpl_BSTNcBDmzcEHDWSvoTV1pPpjq6cW` READY on `d14bf303`; `makeborne.com` and `www` point to it | `06-deployment.json` |
| 12:27 | 3. Checks | Public pages 200 with no "print-ready"/"live in seconds" (both present before); `/api/build` = paused + estimates (was `available:true`); signed-out workspaces 401; telemetry 204 (was 404); 17 artifacts, all 7 with content beyond their title classify as saved formats | `07a-pre-deploy-baseline.json` (before), `07-post-deploy-checks.json` (after) |
| 12:29 | 3. Telemetry | One verification visit (user agent `makeborne-release-verification/rc-20261019`) recorded as `home`; 0 error groups | this file |
| 12:27–12:58 | 3. Watch | see `08-watch.json` | `08-watch.json` |

Commercial switches were not touched: provider scopes, `creation_enabled`, packs, access plans and publication settings
read back unchanged after the migration.

## Left for the owner (needs the owner's own sign-in; not done by the agent)

* Open one legacy book and one legacy static-design site in the studio and confirm the text renders with the
  "saved as an outline / static design" notice (same code passed on staging and locally; production data classified above).
* `/admin` → Health: error and visit counters visible (the database side is verified above).

## Recovery (unchanged)

Revert PR of `d14bf303`; keep the additive migration; no database restore. The backup above is the restore point only
for a separate, reconciled incident.
