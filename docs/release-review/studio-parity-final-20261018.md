# Makeborne studio parity release — 18 October 2026

Status: RELEASE COMPLETE for the owner-approved feature scope. The final production watch passed 1,808 seconds across 31 samples, with zero HTTP failures, runtime errors, server errors or log-coverage gaps. Final main CI passed; makeborne.com still points to the exact qualified merge. Disabled commercial capabilities listed below remain closed.

## Released source and infrastructure
- PR2 merged normally as 599bfe336f6718bfa5f456b74903ed4517d9b769; PR3 fixes review-date hydration, merged normally as f696b3ac612f2f5501bb08ffeb4571392bb47b9f. Its tree equals qualified aecb0b6.
- Live deployment: dpl_CBFzseN65RTZFm5KAviBEJyN6kRr, makeborne.com.
- Exact eight additive migrations applied in owner-approved order, ending20261017080000_rpc_definer_boundary. Production migration count85→93. No existing migration edited in production.
- Pre-change custom-format backup: production-before-55873a6-20261017184940.dump; SHA256 a78d283e59896eb9ad32f29c6aeadfb90ba68355268f13b6a8166b2253bdc40b. Archive fully decoded; external Storage files excluded. Retained in ignored operator directory, not public Git.
- Production customer Worker: makeborne-site-host, version0c544317-8b96-4ec2-83ab-ede2eb9d703d. Analytics signing key matches private database setting; never printed. Review-only portal and branded typeable-code email enabled.

## Gates and actual evidence
- Typecheck, ESLint,133 harnesses, production build, diff secret scan passed. Seven SQL suites passed with rolled-back transactions on full chain and actual staging-shaped isolated copy.
- Staging security11WARN baseline; production 9 WARN baseline; none new. makeborne_rpc is not API-exposed.
- Real staging email-code sign-in, isolated client invitation, assigned-site visibility, edit/send/agency approval5→6, only one source JSON changed, brand kit, click-to-edit, history and Publish panels passed.
- Actual staging public HTTPS document/assets/navigation/animation, form→inbox→CRM and signed analytics passed. Staging is deliberately noindex: robots Disallow and sitemap404. Positive sitemap behavior covered SQL/Worker suites.
- Production real email-code invitation, client non-membership, edit/send/approval1→2 and other18files byte-identical passed on initial599bfe3; that unchanged code remains in final release.
- Final production review: fresh signed-out deployment origin, anonymous review/comment, UTC timestamps, hard reload, zero browser errors, browser views recorded and visible to agency. Old inherited React418 is fixed without hydration suppression.
- Actual public production apex redirects308 to makeborne.com; unknown customer404 with security headers. Existing exact staging routes stay isolated. There are no published production customer sites; trusted publishing remains off, so no production publish or form success is claimed.
- Cleanup: only recorded production QA client/two projects deleted; hashes and counts of all original workspace/client/project/artifact/version/brand-kit rows match pre-test snapshots. Workspace and Auth accounts preserved. Stage QA fixtures/three enquiries removed; unrelated rows and existing published QA site preserved. Temporary staging forwarding token removed; stage forms now fail closed until next authorized refresh.
- No paid AI calls in this release.

## Preserved closed capabilities
AI provider spending limits, checkout, trusted publishing, production enquiries and Gmail activation are unchanged/off by owner instruction. Enabling them requires a separate qualification/approval. AI images still require a securely configured key and measured live qualification. Phase2 client editing is excluded.

Custom domains are shipped in setup state: all three SaaS variables unset because existing provisioning could not be verified. Next: enable Cloudflare for SaaS; configure fallback origin/customer CNAME and matching Worker custom-host route; create zone-scoped SSL-edit credential and three server variables; prove one custom hostname ownership/TLS and isolation. Cloudflare lists100 included hostnames and $0.10 per additional hostname: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/ . Do not activate automatically.

## Recovery
- Use normal revert PR/merge for the affected application merge; no force push. For date-only regression, reverting PR3 restores599bfe3 and its known review-date hydration defect; evaluate before doing so.
- Full feature rollback follows owner-approved PR2 revert, with compatible backend contracts verified first. Leave additive migrations in place unless harmful; report before dropping anything. Database restore is a separate incident with reconciliation/data-loss implications.
- This was the first production Worker deployment, with no prior Worker version. Restore its captured pre-release state by removing only its newly created production routes/Worker; preserve two exact staging routes. Do not invent a previous version.
- All private evidence, backups, credentials and QA bearer links remain outside Git. Public documentation contains no secrets. Final observation receipt resides in ignored work/release-review-date-fix-20261017/production-watch.json.
