# Trusted publication controller

## Production profile preparation — 19 October 2026

The current candidate supports two strictly separated profiles. `controller.example.json` remains staging schema 1, with its single QA workspace and protected-preview bypass. `controller.production.example.json` is production schema 2, with an explicit nonempty workspace allowlist and no preview-bypass credential. `profiles.mjs` pins each profile's database, Vercel project, registry image prefix, bucket and broker origin; cross-profile combinations are refused. No production activation has occurred.

Production additionally requires migration `20261019134828_trusted_publication_production_profile.sql`. Its private workspace table starts empty. The controller's configured list must match the database's enabled list exactly at startup and before discovery; returned claims and source refreshes are checked again. Cleanup remains available during rollout drift. The application broker also requires the exact production deployment identity and its own explicit `MAKEBORNE_PUBLICATION_WORKSPACE_IDS` list. Coordinate all three lists while discovery is stopped; removing SQL authorization takes effect before the next compile/promotion.

`deploy/` contains the separate environment template and systemd supervisor preparation. The owner approved a $6/month DigitalOcean host and $2 total new staging tests, excluding paid AI and production activation. Neither approval nor these files proves cloud qualification. See `docs/release-review/trusted-publishing-production-20261019.md` from the repository root for evidence and remaining gates.

## Historical staging package contract

Standalone Node 24 controller for the existing trusted publication worker. This package is prepared locally; it does not deploy or provision anything. It starts with database attestation, reconciles unresolved sandboxes, then discovers work. The browser remains unable to request compiler commands, credentials, runtime images, or cleanup authority.

## Build and offline checks

From this directory:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run check
docker build --pull=false -t makeborne-publication-controller-local:20261013 dist
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m --cpus 1 --pids-limit 64 --tmpfs /tmp:size=32m makeborne-publication-controller-local:20261013 --self-check
```

The build bundles the current TypeScript worker, artwork resolver, broker downloader, R2 adapter, and controller composition. It removes `server-only` only inside this explicit trusted Node bundle. It fails if Supabase or Next dependencies enter the bundle. `pg` 8.23.1, `@vercel/sandbox` 3.7.0, and native `sharp` 0.35.5 remain external locked runtime dependencies. Other JavaScript is bundled. Runtime image installation uses the lockfile during image creation; startup performs no package installation. The final image runs as the Node user and needs no Docker socket, local source checkout, or administrator key.

`--self-check` imports the actual bundle and exercises the native image codec without network access. `--check-config` validates local files and credentials without opening a database or provider connection. Neither mode certifies cloud permissions or image qualification.

## Required configuration

Copy `controller.example.json` into an operator-owned configuration directory. Its placeholders deliberately fail validation. Set `MBPUB_CONFIG_FILE` to the absolute mounted filename. The approval mapping file must match the exact configured SHA256 and contain only:

```text
compiler: { image, runtimeImageId, evidenceSha256 }
renderer: { image, rendererId, evidenceSha256 }
```

Images must be reviewed immutable digest references. Evidence digests must refer to real qualification evidence. Compiler runtime identity and renderer/controller identity must match those approved images; syntax validation does not establish that proof.

Required host-only secret environment variables:

- `MBPUB_DB_PASSWORD`: dedicated staging SQL LOGIN password.
- `MBPUB_VERCEL_TOKEN`: explicit token for the pinned staging Vercel team/project.
- `MBPUB_BROKER_SECRET`: 64 lowercase hexadecimal characters, shared only with the application's private broker.
- `MBPUB_BROKER_PROTECTION_BYPASS`: automation bypass header secret for the selected protected staging app origin.
- `MBPUB_R2_ACCESS_KEY_ID` and `MBPUB_R2_SECRET_ACCESS_KEY`: independently verified bucket-scoped private output credentials.

Set `NODE_ENV=production`. Do not reuse the application's environment. Ambient PG, Supabase, database URL, Vercel, AWS/R2, Node preload/TLS override, certificate override, or proxy variables are rejected. Do not include any Supabase administrator/service key or JWT signing key.

The initial package accepts only:

- Supabase project `xzwikrunwpurxnxgkznh`, direct host `db.xzwikrunwpurxnxgkznh.supabase.co:5432`, database `postgres`.
- The known `makeborne-release-staging` Vercel project/team in the example.
- The staging project broker origin family already accepted by the broker implementation; the chosen exact origin must be verified before activation.
- R2 bucket `makeborne-publication-staging`, which has not been provisioned by this work.
- A dedicated SQL LOGIN named `makeborne_publication_controller_staging` (or that prefix plus a short lowercase suffix), with only non-admin, non-inherited, SET-enabled membership in `makeborne_publication_worker`.

There is no production or generic pooler fallback. Direct Supabase database connectivity may require IPv6 support; qualify connectivity on the selected supervisor host. TLS always uses the configured CA, expected server name, and `rejectUnauthorized:true`; connection strings and `sslmode` overrides are unsupported.

## Startup and shutdown

Before constructing SDK, R2, or broker adapters, startup verifies the negotiated TLS connection, actual session identity, role attributes/membership, and absence of extra login table/function/schema/database authority. The read-only migration 58 RPC then verifies the exact worker function signatures and privileges and returns the actual namespace/QA workspace. Startup requires staging and the configured QA UUID. It never infers health from a migration count.

The journal cleanup gate runs before polling and each attempt. Cleanup may stop an orphan but never resume or promote work. Unknown resources remain durable and block new provisioning. SIGTERM/SIGINT abort work and allow up to twenty seconds for its bounded cleanup, then up to five seconds to close the pool; an outer deadline and final exit prevent ignored SDK cancellation from retaining the process forever. Database pool failure exits unsuccessfully so a supervisor can restart it. Logs contain allowlisted event names, UUIDs, retry durations, and fixed error codes only.

Run the final image under an approved process supervisor with restart policy and a termination grace exceeding 26 seconds. Mount only the configuration/CA/approval files read-only and inject scoped secrets. Restrict controller egress to the pinned database, broker, R2, and provider endpoints. Do not mount a Docker socket. Runtime activation, remote image upload, networking rules, and hosting purchases need separate authorization.

## Missing activation inputs

No live activation has occurred. Required inputs remain: actual qualified compiler/renderer images and evidence; the private bucket and its scoped token; dedicated restricted SQL LOGIN; verified staging database CA/connectivity; database staging namespace configuration for a verified QA workspace; deployed broker and matching HMAC/protection secret; scoped Vercel credential and approved compute allowance; supervised host; and live unknown-create/expiry/network/resource qualification. Keep trusted publication disabled until those are verified.

Official references: [node-postgres TLS configuration](https://node-postgres.com/features/ssl), [Supabase function security](https://supabase.com/docs/guides/database/functions), [Vercel Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication).
