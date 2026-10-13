# CRM sales/delivery split: rollout, cutoff and rollback

Clients get **sales** stages: Lead → Contacted → Conversation → Proposal → Won / Lost. Each project gets a **delivery** stage: active → in_review → changes_requested → delivered. A client review moves only the delivery stage of the project its link belongs to.

The deployed app (`origin/main`) validates client stages with a strict enum: Lead, Contacted, Replied, Meeting, Proposal, Won and Lost. Any screen that loads a client stored as `Conversation` fails. Everything below exists so that the previous app never sees a stage it can't read, and so that switching versions never loses or misattributes a stage.

## Moving parts

| Piece | Purpose |
|---|---|
| `20261011180000_crm_sales_delivery_split.sql` | Adds `projects.delivery_stage`. The previous app ignores it. |
| `20261011190000_crm_transition.sql` | Review functions that move only the linked project, atomically. Audited project backfill. Directory accepts old and new filter names and returns stored stages unchanged. Contract/rollback functions and `makeborne_private.crm_migration_audit`. |
| `20261011200000_crm_write_freeze.sql` | Transition state (`mode`, `min_client_protocol`, `frozen`), the client write guard, stage-change recording, and the operator procedures below. |
| `supabase/post-deploy/crm_contract_client_stages.sql` | The contract procedure. Runs after the new app is live, never as part of a migration run. |

### Transition state: `makeborne_private.crm_transition`

- **`mode = 'expand'`** (after the migrations, and after any rollback). Both app versions may run.
  - Stages are **stored in the previous app's vocabulary**.
  - When the new app saves `Conversation`, a client stored as Replied or Meeting keeps that value, so provenance is preserved. Any other client is stored as `Replied`.
  - Every such translation writes a `client_stage_compat` audit row. The client's own history is not touched, so a full 300-entry history is preserved.
  - The new app maps stored stages to current ones when it reads them, so users see Conversation.
- **`mode = 'contracted'`** (after the contract). Only current stages are accepted, and `min_client_protocol = 2` applies.
- **`frozen = true`.** Every client write (insert, update or delete, from any role) fails with `MB423`, "briefly read-only". Only the transition procedures themselves are exempt.

### Ordinary stage changes

Every stage change made through the app writes a `client_stage_change` audit row. Rollback reads these and never overwrites a stage a user changed after the contract.

## Compatibility cutoff (enforced, not inferred from deployment aliases)

The cutoff is **CRM protocol 2**, `CRM_PROTOCOL` in `src/lib/crm-protocol.ts`.

- **Old browser tabs:** new browser bundles send `x-makeborne-crm-protocol: 2` on every API call. The new server answers client creates and updates from older bundles with **426, "Makeborne was updated. Reload this page"**. This applies from the moment the new app serves the route, whatever the mode.
- **Old servers:** the new server sends the same header on every database request, through `src/lib/supabase/server.ts` and `src/lib/billing/database.ts`. PostgREST exposes it as `request.headers`.
  - The client write guard rejects API writes whose protocol is below `min_client_protocol`, with `MB426`.
  - In `expand` the cutoff is 0, so the previous app works. The contract raises it to 2. From then on, any lingering previous-version server (an old deployment URL, an in-flight function) can no longer write clients, however it was reached.
  - Verified locally through the API gateway: with the cutoff temporarily at 2, an update with the header passed the guard (and failed validation as designed); the same update without it got `MB426`. No data changed.
- **Operator SQL** (no PostgREST headers) is not subject to the cutoff, but is subject to the freeze.

**Reads are not blocked.** After the contract, a previous-version tab or server that *reads* a `Conversation` client still fails to parse it. The data is unaffected and the screen tells the user to reload. This is why the contract comes after the new app serves all traffic, and why rollback restores the previous vocabulary **before** the previous app is deployed.

## In-flight requests: freeze and drain

- **Drain:** each client write takes a **share lock** on the transition row until it commits. `crm_freeze_writes()` updates that row, so it **waits for every in-flight client write to commit**. Bound the wait with `set lock_timeout`.
- **Racing writes:** a write that starts while the freeze is committing waits for it, then sees `frozen` and fails with `MB423`.
- **Enforced order:** contract and rollback refuse to run unless the CRM is frozen (`MB409`). Resume refuses unless the stored stages match the mode (`MB409`).
- **Review links deliberately keep working during a freeze.** Creating links, commenting, and approving or requesting changes write only review records and the project's `delivery_stage`, never client rows. Delivery stages are not part of the stage transition. Covered by test F, which runs every review decision while frozen.
- **Everything else that writes clients fails during a freeze with `MB423`:** creating or editing a client, importing local clients, and deleting a workspace or account, whose cascading deletes reach `clients`. Keep freezes short.

## Roll forward

1. Apply the migrations. The state is `expand`, cutoff 0, unfrozen. The previous app keeps working.
   - Check: `select makeborne_private.crm_transition_report();` should show `mode: expand` and `consistent: true`.
2. Deploy the new app. From now on, open previous-version tabs are asked to reload before writing clients, through the server-side 426.
3. Smoke-test the new app:
   - Clients stored as Replied/Meeting show as Conversation.
   - Saving such a client keeps its stored stage. Check `client_stage_compat` rows in the audit.
   - A review link moves only its project.
4. Contract: `psql -v ON_ERROR_STOP=1 -f supabase/post-deploy/crm_contract_client_stages.sql`. This runs **freeze (drain) → contract → verify → resume**.
   - The report must show `mode: contracted`, `consistent: true` and `clientsLegacyStages: 0`.
   - From here, previous-version servers are rejected by the database (`MB426`).
5. Next release: write and verify a **separate SQL-only follow-up migration** so fresh environments end up contracted. Do not copy the psql script: it uses `\set` and commits the freeze separately, which a migration cannot do.
   - The migration runs inside one transaction, after all earlier migrations. In a fresh environment no previous-version app is serving, so it can freeze, contract and resume atomically: `select makeborne_private.crm_freeze_writes('contract migration'); select makeborne_private.crm_contract_client_stages(); select makeborne_private.crm_resume_writes();`
   - Keep the rollout order. Production must already be contracted (step 4) **before** that migration is applied there, and there it must find nothing to change (`clients: 0`). Verify on a staging copy of production first: it should report `mode: contracted`, `consistent: true`, `clients: 0`.
   - `src/lib/check-crm-stages.cjs` fails any migration that runs a transition step. When adding this migration, allow-list exactly that one reviewed file there; keep the guard for every other migration.

## Rollback to the previous app

This procedure restores **CRM compatibility only**. It does not authorize a whole-app
Vercel rollback. The 2026-10-12 production-baseline rehearsal confirmed that the
deployed commit's pilot dispatch permission is revoked by the new migrations.
Use the release recovery gate in `docs/RELEASE_RUNBOOK.md`; keep generation closed
until the chosen recovery build is qualified against the upgraded database.

Each step is its own transaction. Run them as the database owner.

1. **Freeze and drain:** `set lock_timeout='30s'; select makeborne_private.crm_freeze_writes('rollback');`
2. **Restore:** `select makeborne_private.crm_rollback_client_stages();`
   - The mode returns to `expand` and the cutoff to 0.
   - Clients the contract moved to Conversation, with no stage change since, get their **exact** original stage back (Replied or Meeting).
   - A Conversation chosen in the new app after the contract becomes Replied.
   - Stages users changed after the contract, such as Proposal, are kept.
   - Every change is audited. History entries are added only where the history has room.
3. **Switch versions only after the whole-release recovery gate passes:** use the separately qualified recovery build. Restoring CRM stages alone is not permission for a Vercel instant rollback.
   - Any new-app instance still serving now writes in `expand` mode, so its `Conversation` saves are stored as Replied/Meeting.
   - Its open tabs get 426 from the previous server only if that server enforces it. The previous app does not, but `expand` storage keeps the data readable.
4. **Verify:** `select makeborne_private.crm_transition_report();` should show `mode: expand`, `consistent: true` and `clientsCurrentOnlyStages: 0`. Then load the previous app's CRM list.
5. **Resume:** `select makeborne_private.crm_resume_writes();`. It refuses if the state is inconsistent.

To roll forward again, follow "Roll forward" from step 2. Repeated cycles keep exact provenance (test H).

If the contract has **not** run, rollback is the same procedure. Nothing is stored as Conversation, so step 2 changes nothing.

## Audit

`makeborne_private.crm_migration_audit` records, one row each:
- every project backfill
- every contract and rollback change
- every expand-mode translation (`client_stage_compat`)
- every ordinary stage change (`client_stage_change`)

`history_logged` says whether the client's own history also got an entry. It is false when the history was full; the audit row is then the only record. The table is not readable through the API.

## Tests

- `supabase/check-crm-sales-delivery.sql` covers sections A–F and H. It runs in rolled-back transactions on the local database and leaves no data behind.
  - A: project backfill.
  - B: expand-mode writes from both app versions, provenance, a 300-entry history.
  - C: the contract requires a freeze; freeze, cutoff and legacy rejection.
  - D: rollback provenance, and later user changes kept.
  - E: delivery-stage permissions.
  - F: review decisions during a freeze, for anonymous, plan-less and paid reviewers, plus dead links, a foreign project, marker abuse and atomicity.
  - H: three rollback/roll-forward cycles, and resume refusing an inconsistent state.

### Concurrency check (isolated database only)

`supabase/check-crm-concurrency.sql` (G) uses real sessions to show:
- the freeze drains an in-flight write
- the freeze blocks a racing write
- an out-of-date server is rejected after the contract
- the previous app is restored after rollback

It **commits**, and contract/rollback act on every client, so it refuses to run in the `postgres` database or in any database holding clients or CRM audit rows. Create a disposable copy of the schema first:

```bash
docker exec supabase_db_makeborne-local psql -U postgres -c "create database makeborne_crm_isolated;"
docker exec supabase_db_makeborne-local pg_dump -U postgres --schema-only --no-owner --no-privileges postgres | docker exec -i supabase_db_makeborne-local psql -U postgres -q -d makeborne_crm_isolated
docker exec supabase_db_makeborne-local pg_dump -U postgres --data-only --no-owner -t makeborne_private.crm_transition -t makeborne_private.billing_settings postgres | docker exec -i supabase_db_makeborne-local psql -U postgres -q -d makeborne_crm_isolated
docker exec -i supabase_db_makeborne-local psql -U postgres -d makeborne_crm_isolated -v ON_ERROR_STOP=1 < supabase/check-crm-concurrency.sql
```

Drop `makeborne_crm_isolated` afterwards. Copying the realtime partitions may log duplicate-partition notices. They don't affect the check.
