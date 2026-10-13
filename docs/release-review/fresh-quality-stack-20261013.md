# Fresh local quality stack — 2026-10-13

Prepared a separate local Supabase stack for the bounded quality workflow. Existing `makeborne-release-auth`, `makeborne-local`, and unrelated stacks were left untouched.

- Project ID: `makeborne-fresh-quality`.
- API: `http://127.0.0.1:55465`; database: `127.0.0.1:55468/postgres`.
- Local mail UI: port 55470. Reserved inactive ports: shadow 55464, Studio 55469, inspector 55471, pool 55472, analytics 55473.
- Running services: database, Auth, REST, Storage, Kong, local mail. No external SMTP, OAuth, edge runtime, analytics, or AI credentials were configured.
- Ignored local configuration and secret status: `work/fresh-quality-stack/supabase/config.toml` and `work/fresh-quality-stack/status.json`.

Supabase CLI 2.119.0 was invoked with the explicit fresh work directory. The production application schema-only export was restored onto the fresh local platform; no production data or existing platform schemas were copied. All 58 pending migrations matched the successful full-chain rehearsal hashes before application, including the out-of-order empty migration. The local migration history records 20 baseline versions and 58 applied versions.

Application table grants were normalized to the explicit reviewed baseline/migration grants. Safe singleton rows disable creation and the legacy pilot. The private `project-assets` bucket and reviewed workspace-scoped storage policies were restored. Required operation tables are in `makeborne_private`, not the public schema; an initial check used the wrong schema, was corrected, and the actual private tables were verified without reapplying or resetting anything.

At handoff, no Auth users, workspaces, or provider calls existed; all live provider limits were disabled. The quality agent may create synthetic fixtures and run its separately authorized checks after handoff. No paid calls, provider-limit activation, cloud writes, deployment, or migration to another database occurred during stack preparation.

Machine evidence and exact migration hashes: `fresh-quality-stack-20261013.json`. Credentials were not copied into that evidence. Stack lifecycle commands must retain the explicit fresh work directory; never use a bare linked-project database command.
