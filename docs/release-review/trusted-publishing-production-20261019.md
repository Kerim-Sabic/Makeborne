# Production trusted publishing — preparation and qualification

Status: **local checks pass; cloud qualification and production activation remain blocked**.

Branch: `feature/trusted-publication-production`, based on `origin/main` `d14bf303165806ab2544299c3e1b63f923a5c9ea`. Changes remain uncommitted. No production migration, service, bucket, login, environment change or activation has occurred.

## Owner scope and budgets

- Prepare and qualify production publishing; stop for a separate owner go before activation.
- Approved: a dedicated DigitalOcean host at $6/month before tax; up to $2 total for new staging cloud builds/recovery tests and test storage. No new paid AI calls.
- New cloud test spending in this task: $0 so far. No host purchased. DigitalOcean's $5 signup credit is labelled Inference Cloud, not confirmed usable for Droplets.

## Implemented boundary

Staging retains its fixed project, database host, Vercel project, registry prefix, bucket, protected broker origin family and single QA workspace. Production pins its own corresponding identities and `https://makeborne.com`, forbids staging bypass credentials and requires an explicit workspace list.

The forward migration adds an owner-managed, RLS-protected private rollout table, empty by default. Authority, discovery and worker attestation use it. Production attestation returns the exact enabled set; the controller compares it before discovery and validates claimed/refreshed source scope before compilation. Cleanup is independent of rollout drift. The production broker separately checks deployment/database identity, allowed workspaces and its namespace-bound signature before privileged reads; original artwork authorization and hash checks remain in place.

New migration: `20261019134828_trusted_publication_production_profile.sql`. It contains no login password or activation/allowlist insert. Production controller configuration uses schema 2; staging remains schema 1.

## Verified locally

- Full offline runner: **139/139 harnesses pass**; explicit live/export/interactive checks reported as skipped remain unqualified.
- Full ESLint and TypeScript: pass.
- Application production build: pass.
- Controller build and checks: 8 startup, 6 profile/rollout and 3 actual pinned-SDK session groups pass, with no network/provider calls.
- Docker controller image builds from the locked Node 24 base. Its real bundle/native codec self-test passes without network, as a non-root user, read-only filesystem, capabilities dropped, bounded memory/CPU and no Docker socket. This proves local packaging only.
- Full production-shaped chain: **95 migrations**, normal run, injected failure and interrupted resume converge; rehearsal `passed: true`, stable input hashes. Includes new production-profile SQL authorization/privilege checks and existing publication/worker/journal suites. Evidence: `trusted-publishing-production-rehearsal-20261019.json`. Disposable containers are stopped, retained for inspection; production and the owner's working database were not modified.

## Host preparation

Historical staging used a bounded Windows process, not an always-on Linux service. The new systemd template and separate profile environments are prepared in `infra/publication-controller/deploy/`.

DigitalOcean account sign-in succeeds. The $6 Basic Regular plan (1 GiB, 1 vCPU, 25 GiB SSD) is available in London; IPv6 is selected, paid backups/volumes/databases are not. No host purchase submitted. Owner approved dedicated SSH access: a fresh Ed25519 key was generated in ignored local configuration with its private-file ACL restricted to the current user; only the public key was registered, and the dashboard confirmed success. Owner must enter and submit a payment method in the open billing form. The owner also requested minimizing subscriptions: retain the $6/month ceiling and add no paid extras.

Actual host identity, supervisor validation, IPv6/TLS connectivity, egress rules, image digest installation, restart/reboot recovery and monitoring are **not yet verified**. A service file alone is not reboot evidence.

## Cloud gates still required

1. Provision the approved host with independent restricted staging credentials; production service remains stopped and disabled.
2. Deploy the exact candidate broker to staging and apply only the new staging migration through the reviewed explicit-target path. Compare advisors and exposed schemas.
3. Revalidate/pin compiler and renderer images, build every fixture route, and record direct sandbox network-isolation observations.
4. Exercise restart mid-compile, ambiguous create, stale fence, revoked authority, exhausted attempts and inaccessible storage. Retain journal evidence and confirm all remote resources stopped; never infer cleanup from process death.
5. Approve/publish the retained preview; compare actual hosted desktop/mobile output and all routes; unpublish and verify recovery.
6. Prepare production-only login (sole worker membership), bucket-scoped credentials, immutable production images, empty rollout configuration and disabled service/flags. Confirm secrets differ without printing them.
7. Present exact evidence and activation/rollback steps; wait for owner go. Only then enable the selected workspace and publish/unpublish one golden production site.

The Oct 14 cloud receipts are historical references, not evidence that this new controller/profile or supervisor passed these gates.

## Rollback

Before activation, leave production flags and service off. After an approved activation, stop the production controller and disable new trusted-publication/broker admission. Preserve preparations, resource journal, output objects and additive migrations; existing hosted sites and unpublish controls must remain available. Revert application/controller code through a normal reviewed change. Do not restore raw browser-output promotion, delete uncertain sandbox records, or claim a stopped remote resource without provider confirmation.

Sources checked 19 October 2026: [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets), [Vercel Sandbox](https://vercel.com/sandbox). Actual account invoices remain the source of billed usage.

## Continuation — 20 October 2026

The approved $6/month host is now provisioned and hardened; actual cloud image self-check, host reboot and Docker staging database connectivity pass. Owner-approved 24-hour staging worker and bucket-only credentials are prepared on the host; actual TLS/role attestation and immutable R2 write/read/cleanup pass. Both controller services remain disabled/inactive. Full cloud build/recovery/network-isolation and preview/hosted equivalence remain pending; $0 new Sandbox VM/AI calls. No production activation. See publishing-host-preparation-20261020.md and the updated supervisor runbook.
