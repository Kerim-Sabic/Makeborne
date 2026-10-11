# Private compiled website previews

This Worker serves the existing immutable compiled-output contract from a private R2 binding. It reuses the existing preview gateway and two database RPCs; it creates no generation jobs, upload endpoint or payment authority.

## Configuration

- `wrangler.jsonc` defaults to **disabled**. A missing credential or invalid configuration returns a generic private/no-store 503. No customer-facing route is attached.
- `COMPILED_OUTPUT` must bind the production private bucket holding receipt-validated builds. Public bucket access must remain disabled.
- `SUPABASE_SECRET_KEY` is an operator-managed secret, never a browser variable. Its dedicated transport permits only the existing consume/read preview RPC endpoints on the configured Supabase project, with bounded responses, deadlines and safe errors. This credential itself has wider privileges; compromise of the Worker remains a material risk.
- Application and build-specific preview origins require working DNS/TLS. Do not enable the current placeholder preview subdomain until cookie/domain isolation is qualified. A sibling subdomain shares the app's registrable domain and permits cookie tossing unless separately mitigated. A separate preview domain also requires qualification of iframe cookie policy.
- Request tokens stay in one-use POST bodies. Browser cookies are opaque, host-only and HttpOnly; database state stores hashes. The shared gateway rechecks current Auth/membership and exact build authority before returning retained bytes.
- Invocation logs are disabled to avoid recording preview cookie/token requests. Do not add headers, request bodies or credentials to diagnostics.

## Local qualification

The generated Worker types and separate TypeScript configuration avoid mixing workerd globals into Next. Wrangler dry-run produces the actual deployment bundle without provisioning resources. `local-runtime.mjs` executes that bundle in current Miniflare/workerd against the same persistent private R2 fixture used by the builder. Its only outbound requests are two fixed RPCs on the local Supabase API. Fixture credentials stay in memory, telemetry is disabled, and runtime disposal is awaited before persistence removal.

`MAKEBORNE_VERIFY_LOCAL_PREVIEW_WORKER=true` together with the existing R2 and preview HTTP flags switches the original restricted builder/Auth/Next/browser verification to this actual bundled Worker. Supply the current dry-run bundle explicitly through `MAKEBORNE_LOCAL_PREVIEW_WORKER_BUNDLE`; an earlier hardcoded evidence bundle is no longer selected. The original Node gateway path remains available. R19/R20 evidence distinguishes failed attempts from the final verified runs.

## Production work still required

Cloudflare R2 API currently returns authorization error10000 under the existing Wrangler authorization, and the browser dashboard session needs sign-in. No bucket, credential, route, DNS record or deployed Worker was created by this increment. Production builder-to-R2 retention transport, least-privilege credentials, separate origin/cookie protections, resource limits, TLS, cloud readback and lifecycle/erasure remain required before activation. This is not a live hosting release.
