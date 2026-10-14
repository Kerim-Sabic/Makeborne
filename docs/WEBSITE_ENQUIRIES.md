# Hosted website enquiries

Status: implemented and tested locally; not enabled on production.

## Delivery

An interactive customer website posts `requestId`, `name`, `email` and `message`
to `/_mb/enquiries` on its own origin. The Worker validates the request and signs
it for the app gateway. The database accepts it only for a live website whose
owner enabled enquiries. Messages appear in that website's publishing panel.
The inbox is owner-only. Email forwarding is not implemented.

The same request ID and payload are safe to retry. Changed content needs a new
ID. A network error is not proof of failure or success: retain the same ID and
retry. The UI must show success only after `accepted: true`.

Limits are 5 messages per visitor hash per website per 10 minutes and 100 per
website per hour. Database locking enforces these under concurrent requests.
The visitor hash is keyed; raw IP addresses are not stored. These limits and the
honeypot are basic abuse controls, not a complete bot defense.

## Release prerequisites

1. Apply `20261012184407_hosted_site_enquiries.sql` after its predecessors.
2. Configure the same random secret (at least 32 characters) as
   `MAKEBORNE_FORMS_SIGNING_SECRET` on the app and `FORMS_SIGNING_SECRET` on the
   customer-site Worker. Store both as server secrets, never public variables.
3. Complete isolated customer-domain DNS/TLS and Worker qualification. Existing
   static path hosting cannot run these forms.
4. Set the Worker's `APP_ORIGIN` to the intended app, with its matching database.
5. Publish a connected form, enable enquiries, and test actual submission plus
   owner inbox in staging. Existing generated demo forms are not auto-converted.
6. Publish the site's privacy notice before collecting real visitor data.

## Staging gateway token (staging only)

The staging app is a protected Vercel preview, so the staging Worker cannot
reach `/api/hosting/enquiries` with the HMAC signature alone. For
qualification it carries a short-lived Vercel OIDC token as the Worker secret
`STAGING_VERCEL_OIDC_TOKEN`, sent as `x-vercel-trusted-oidc-idp-token`
(`infra/customer-sites/forms.js`, `stagingGatewayHeaders`).

Guards in code: the header is sent only when `SUPABASE_URL` is the staging
project and `APP_ORIGIN` matches
`https://makeborne-release-staging-<id>-kerimsabic-6594s-projects.vercel.app`.
Any other pairing throws. A token that expires within 30 seconds also throws,
so submissions fail closed (the visitor keeps the message) and never fall
back to an unauthenticated call. The HMAC signature is still required.

Current arrangement (2026-10-12T23:30Z):
- Worker `makeborne-site-host-staging` version `9668eef6-9754-4632-aeae-aef7613fb67c` sends forms to the final staging preview `feavd3cd1` (`dpl_9fsW18fAPRUynckkG7kueYrYskmy`), as recorded in `wrangler.jsonc`.
- The OIDC token was rotated with `scripts/refresh-staging-worker.mjs --deploy` and expires 2026-10-13T11:29:31Z. After that, staging forms fail closed with 503 and the visitor keeps the message.
- Evidence: `docs/release-review/staging-worker-refresh.json` and `public-hosting-http.json`.

Owner: whoever runs staging qualification. Purpose: let the public staging Worker reach the protected staging preview. Replacement: none needed in production (public app).

Refresh (owner, staging only):

1. Set `env.staging.vars.APP_ORIGIN` in `infra/customer-sites/wrangler.jsonc` to the preview being qualified.
2. Run `node scripts/refresh-staging-worker.mjs --deploy`. It pulls a fresh 12-hour token from the staging project's preview environment, checks the token's project and expiry, stores it as a staging-only Worker secret through stdin (never printed or saved in the repo), and deploys `--env staging`.
3. Run `node scripts/check-public-hosting.mjs` to submit test enquiries through the public Worker and confirm they reach the owner's inbox.

Clean up as soon as qualification ends:

```bash
npx wrangler secret delete STAGING_VERCEL_OIDC_TOKEN --env staging
```

Never put this secret in `--env production`. Before production, run
`npx wrangler secret list --env production` and confirm it lists only
`SUPABASE_PUBLISHABLE_KEY`, `FORMS_SIGNING_SECRET` and, once visitor analytics are enabled, `ANALYTICS_SIGNING_SECRET` (docs/SITE_ANALYTICS.md). The production app is
public, so its Worker needs no Vercel token. Even if the token were copied,
the code guard refuses it for the production Supabase URL and the
`makeborne.com` origin.

## Recovery

Leave the additive table and column in place if reverting the app. Disable
enquiries on the affected site to stop submissions; take it offline if needed.
App release maintenance also blocks the gateway with 503. The visitor keeps
their message and retries later. Do not drop the table: that deletes enquiries.
Rotate the matching secrets on both sides if a gateway credential is exposed.

## Evidence

`scripts/check-site-enquiries.mjs` uses only the isolated loopback stack. It
checks real publication, Worker JavaScript, signed delivery, the owner inbox,
idempotency, changed retries, rate limits, anonymous/unrelated-account denial,
eight concurrent requests admitting exactly five, and offline rejection.
It deletes only its synthetic enquiries and leaves its test site offline.

Public Cloudflare TLS, email forwarding and a generated form's full UI remain
separate qualification steps. No production release is implied by these tests.
