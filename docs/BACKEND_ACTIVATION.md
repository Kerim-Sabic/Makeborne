# Backend activation handoff

## Observed state, 2026-10-03

The repository has three Supabase migrations and real authenticated cloud routes. This is not a deployed backend. This audit found no `.env.local`, Supabase environment configuration, or callable Supabase connector. Docker's Linux engine named pipe was unavailable. The global Supabase CLI was not installed. No database was created or modified and no paid service was enabled.

## Required owner action

Connect an existing **isolated development Supabase project** through the agent's Supabase integration, or configure its URL and publishable key privately in `.env.local`. Do not send passwords, session tokens, service-role keys or secret keys in chat. An authenticated connector must target the intended project; a Lovable database connector cannot configure this separate Next.js repository.

Alternatively, start a working local Docker runtime. Then inspect the Supabase CLI's current `--help`, initialise this repository's local configuration, and start the local stack. Do not reset an existing database or delete Docker volumes as an installation shortcut.

## Configuration preflight

From the repository root, with Node 22:

```powershell
node --env-file-if-exists=.env.local supabase/check-setup.mjs
```

This reads configuration only and prints no secrets or configured URLs. Exit 2 means incomplete/unverified; even valid configuration shape does not count as a live connection. It rejects obvious secret keys in public variables, but is not a comprehensive secret scanner.

After an owner session exists, supply `MAKEBORNE_VERIFY_OWNER_A_TOKEN` privately in the process environment and run:

```powershell
node --env-file-if-exists=.env.local supabase/check-setup.mjs --online
```

This verifies the session and the read-only schema probe. Requests time out and refuse redirects so authentication headers are not forwarded to a different destination. Exit 0 proves only these two checks; exit 1 indicates a failed provider/schema check. The script never migrates, provisions, purchases, flips activation flags or prints provider response bodies.

## Activate in order

1. Inspect the selected environment and existing migration history using current CLI help or the authenticated Supabase connector. Confirm it is the intended disposable development project before applying anything.
2. Review and apply all three existing migrations in order. Preserve their names/history. Do not paste schema into an unrelated project or mark migrations applied without running them.
3. Run database advisors and inspect grants/RLS. Verify private helper schemas are unexposed, public tables have RLS, views do not bypass policy, and privileged keys stay server-side.
4. Create authorized owner A, owner B and reviewer fixtures. Run `supabase/verify-isolation.mjs` with its required IDs/session tokens. Read its mutation opt-in and incomplete-check messages; the runner alone is not complete acceptance.
5. Exercise storage tenant paths, immutable uploads, revoked memberships, cross-project references, browser cookie/session behavior, API errors, restore, and interrupted import. Record environment, commands and outcomes without credentials.
6. Complete email confirmation/recovery and SMTP setup in `AUTH_SETUP.md` using controlled test recipients.
7. Only after these checks, set `MAKEBORNE_CLOUD_ENABLED=true` and `MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED=true`, then restart the app. Repeat separately on the intended deployment.

## Separate integrations still required

Accounts/storage do not make generation or billing live. Durable workers, atomic credit reservation/settlement, payment webhooks and entitlements, provider credentials, publishing isolation, domain control, rollback and retention each require implementation and verification. The existing no-paid-API-calls restriction remains active. Do not claim a working generation system by merely adding provider names or environment variables.

Current official reference: [Supabase local development and CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). See also `data-foundation.md`, `AUTH_SETUP.md` and `JOBS.md` for the current implementation contracts and missing acceptance evidence.
