# Makeborne

Make something worth selling.

Creation and client studio for websites, illustrated books, and presentations. This repository contains the first implementation milestone, not a finished production service.

## Current milestone

Authored identity and generated showcase artwork; device-local CRM and projects; guided briefs and three styles; manual editing and snapshots; localhost-only manual HTML/PDF/native PowerPoint exports. Supabase identity helpers and a tenant permission migration exist, but the migration is unapplied.

Local workspace data stays in the browser. It is not cloud storage or a shared client portal. Paid API calls, production generation, publication and payments are unavailable.

## Development

Node 22+. Run `npm ci`, then `npm run dev`. PDF export requires `npx playwright install chromium` or `CHROMIUM_EXECUTABLE_PATH` pointing to a local Chromium browser. Export routes are restricted to localhost development and unavailable in production pending authenticated workers and quotas.

Copy `.env.example` into a private environment file for optional Supabase identity configuration. Configuration does not activate cloud persistence or billable generation. Review `docs/data-foundation.md` before applying migrations. Never commit credentials.

`npm run build` builds the application; `npm run lint` checks source. All 96 original acceptance requirements remain in `docs/RELEASE_GATES_v4.original.json`; scaffolding does not pass them. See `docs/IMPLEMENTATION.md` for full scope and limits. Brand provenance is in `docs/brand/`.
