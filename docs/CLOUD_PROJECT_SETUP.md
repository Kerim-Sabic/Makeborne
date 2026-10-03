# Makeborne cloud project

Project: `rklojnmmsmhwnkbzuidp`, Frankfurt (`eu-central-1`), created by the owner on 2026-10-03. The repository CLI is linked to this project. Other projects must not be modified by Makeborne scripts.

## Applied configuration

- All six migrations were applied: the four original application migrations, dashboard helper restriction, and HTTP 409 revision-conflict correction.
- The schema probe returns `20261003_cloud_v2`.
- All 17 application tables in `public` have RLS enabled.
- The database function warnings were resolved by restricting the dashboard-created `rls_auto_enable()` function. Both anonymous and authenticated roles are denied direct execution. Its automatic RLS event trigger remains enabled. A later advisor refresh reported one Auth warning: leaked-password protection is disabled. This feature requires Pro or above; no paid upgrade was made. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).
- Development sign-in redirects allow only the explicit localhost and 127.0.0.1 callback, confirmation and password-update routes. The development site URL is `http://127.0.0.1:3000`.
- Minimum password length is 12 and email confirmation remains enabled. Undeclared remote settings were left unchanged.

The helper correction follows [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges). The migration tolerates local environments where this dashboard helper does not exist.

The hosted concurrency check exposed the [documented PostgREST retry bug](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b): a deliberate revision mismatch must use `PT409`, not the transient serialization code `40001`. The correction preserves the existing function and permissions while returning an explicit HTTP 409 conflict. A query for stale matching test sessions found none, so no sessions were terminated.

## Boundaries

This is development configuration, not production launch approval. A real deployment needs its own approved HTTPS site URL and redirect allowlist, verified email delivery and recovery, and browser session checks. Model generation, clipping, payments, and publishing remain disabled. CLI credentials and project keys must never be committed; the web app may receive only the publishable key.

Cloud fixture results are recorded separately by the verification runner. Local verification is not a substitute for cloud verification.

After the cloud and local fixture suites passed, the development app's gitignored `.env.local` was switched to this cloud URL and its publishable key. The former local configuration was backed up privately outside the repository. No privileged key was placed in app environment variables. Cloud database features are enabled for development; browser signup, email delivery, recovery and production activation remain unverified. See `CLOUD_BACKEND_VERIFICATION.md` for the storage-cache revocation limitation, which must be addressed before a private media release.
