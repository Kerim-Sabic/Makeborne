# Makeborne

Make something worth selling.

Creation and client studio for websites, illustrated books, and presentations. This repository contains an implementation in progress, not a finished production service.

## Current milestone

Authored identity and generated showcase artwork; device-local CRM and projects; guided briefs, three styles and custom styles; manual editing and snapshots; website section scaffolds; localhost-only HTML, illustrated digital PDF, PowerPoint and EPUB exports. PowerPoint supports separate native editable text and complete visual image modes. These exports package supplied content; they do not invoke live AI generation.

Cloud account screens, client/project routes, immutable revisions and conflict handling are implemented behind explicit configuration and database verification gates. Their migrations have not been applied or verified against a running database. Book/site/deck schemas and a bounded paperback profile validator exist; print rendering and Amazon acceptance remain unverified.

Cloud write contracts require persisted idempotency keys and include explicit recovery of uncertain responses. Offline generation job/budget contracts cover reservation, dispatch uncertainty and settlement; no durable worker or billable generation adapter is active. See `docs/EXPORTS.md`, `docs/JOBS.md` and `docs/VERIFICATION.md` for evidence and boundaries.

Local workspace data stays in the browser. It is not cloud storage or a shared client portal. Paid API calls, production generation, publication and payments are unavailable.

## Development

Node 22+. Run `npm ci`, then `npm run dev`. PDF export requires `npx playwright install chromium` or `CHROMIUM_EXECUTABLE_PATH` pointing to a local Chromium browser. Export routes are restricted to localhost development and unavailable in production pending authenticated workers and quotas.

Copy `.env.example` into a private environment file for optional Supabase identity configuration. Use only a current `sb_publishable_` key in the public key variable; the build rejects other key types. Review `docs/data-foundation.md` before applying migrations and enabling cloud access. Configuration never activates billable generation. Never commit credentials.

`npm run build` builds the application; `npm run lint` checks source. All 96 original acceptance requirements remain in `docs/RELEASE_GATES_v4.original.json`; scaffolding does not pass them. See `docs/IMPLEMENTATION.md` for full scope and limits. Brand provenance is in `docs/brand/`.
