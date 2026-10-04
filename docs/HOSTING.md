# Makeborne hosting

Reviewed 2026-10-04. **Hosting status: not yet deployed.** This document records the deployment plan and checks still required; it does not establish a live service or a completed launch.

## Selected starting point

Deploy the current Next.js application to **Vercel**, retaining the existing Supabase backend. This is the shortest path to an online app preview because Vercel runs Next.js directly, including server routes, streaming and Git previews. The repository uses Next.js 16.3.8 and a Node runtime; no Cloudflare adapter is configured. [Vercel Next.js support](https://vercel.com/docs/frameworks/full-stack/nextjs)

The connected Vercel account exposes `amuo's projects` (`amuos-projects`). Read-only checks found no Makeborne project. A later deployment-context check confirmed the connected team is on Hobby. Verify the selected destination and commercial hosting plan when creating the project; Vercel Hobby is restricted to personal, noncommercial use. No purchase is recorded by this assessment. [Vercel Hobby](https://vercel.com/docs/plans/hobby)

Cloudflare is a possible later hosting target, but it requires compatibility work for this repository's native image processing and local Chromium rendering. Cloudflare currently recommends vinext, which is beta; OpenNext also supports Next.js 16. Choosing either requires a separate build and runtime verification. Do not deploy this server application as a static Pages export. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext support](https://opennext.js.org/cloudflare)

## Minimum app preview checklist

- [ ] Create or identify the Makeborne Vercel project linked to `Kerim-Sabic/Makeborne`, using the repository root and the Next.js framework preset. Use the committed lockfile, `npm ci` and `npm run build`. Record the selected Node version; the repository requires Node 22 or newer.
- [ ] Deploy an explicit commit and record deployment URL, project, target environment, commit and build result. A successful build alone does not verify authentication or saved projects.
- [ ] Configure the intended Vercel environment using only the application variables listed below. Keep preview and production scope deliberate; never copy a local environment file wholesale or print its values.
- [ ] For cloud accounts, confirm that the selected Supabase project has all committed migrations and the required permission evidence. The linked development project has cloud verification recorded in `CLOUD_BACKEND_VERIFICATION.md`; this is not evidence that another project is ready. Enable the two cloud gates only for a verified target.
- [ ] Configure the exact deployed origin in Supabase Auth as described below, preserving existing authorized local development entries.
- [ ] On the deployed URL, verify landing page, login, account session refresh, prompt-to-project navigation, project create/edit/save/reload and client reads. Check a signed-out request and a second tenant cannot access the first tenant's records. Confirm same-origin write checks operate behind the deployed proxy without widening trusted origins.
- [ ] Check `/api/capabilities` reflects the intended account configuration and continues to report unavailable generation, publishing and payments. Confirm production-only restrictions below remain effective and `/admin` returns not found.
- [ ] Record observed results and remaining failures before sharing the URL as a working preview. An app preview is not a generation, export or customer-hosting launch.

### Variables actually read by the app

| Variable name | Purpose and deployment handling |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public URL of the selected Supabase project. Needed at build time as well as runtime. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key for that project. The app requires the `sb_publishable_` key type and rejects privileged or legacy keys here. |
| `MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED` | Server gate; enables only after migration and permission verification for that target. |
| `MAKEBORNE_CLOUD_ENABLED` | Server gate; accounts and cloud operations require this gate, the verification gate and valid public configuration together. |
| `NODE_ENV` | Framework/runtime-managed environment. Production deployments enforce the restrictions below. Do not override it to bypass development gates. |
| `CHROMIUM_EXECUTABLE_PATH` | Optional local browser path used by development PDF exports. Leave unset on Vercel; a Windows executable path is not a production renderer. |

No provider key or paid-generation activation variable is required for this preview. No privileged Supabase key is needed by the current user-scoped app routes. The current code does not read the extra site-URL variables found in some generic hosting examples; authentication redirect URLs are constructed from the browser's current origin.

### Supabase Auth origin and email setup

The application sends signup/resend links to `/auth/callback` with a validated local `next` destination. Recovery sends `/auth/callback?next=/auth/update-password`. The callback exchanges the code for a session; the separate `/auth/confirm` route accepts token-hash email and recovery links.

1. Select the actual deployed origin after Vercel returns it. Set the Supabase project's Site URL to the canonical app origin for that environment. Do not replace an existing production Site URL with an arbitrary preview URL.
2. Add the deployed origin's `/auth/callback` destinations to the Redirect URLs allowlist and verify the actual signup and recovery URLs, including their query strings. Use exact production host/path entries. For changing previews, prefer a stable preview origin or narrowly scoped preview patterns for the owned project; do not allow all Vercel tenants.
3. Inspect the active email templates. Existing token-hash templates using `SiteURL` and `/auth/confirm` always target that Site URL, even if the request began on a preview. Keep that behavior intentional. Default PKCE confirmation links can use the supplied callback destination. Do not append another confirmation path to a value already containing `/auth/callback`.
4. Confirm SMTP/delivery and exercise signup, confirmation, resend, logout, recovery, password change and expired links using a controlled recipient. The current code allows only its supported local destinations; preserve that restriction.

These are configuration checks still required on the deployed origin. Supabase documents matching redirect URLs to its allowlist, exact production paths, and the difference between Site URL and per-request redirect destinations. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

## Production feature gates and limits

| Feature | Current deployment behavior | Work required before enabling |
| --- | --- | --- |
| AI generation | `/api/generate` returns `GENERATION_NOT_ENABLED`; capabilities report unavailable. | Approved credentials and spend cap, durable execution and recovery, usage evidence, settlement, stored outputs and quality checks. **No paid AI calls are authorized.** Hosting does not change that instruction. |
| Server exports | `/api/export` rejects production and non-loopback development requests. | Authenticated queued rendering, tenant quotas, durable outputs and download delivery. |
| Artwork upload | Account asset POST rejects production. | Atomic storage quotas, scoped direct upload authorization, validation and orphan cleanup/reconciliation. |
| Artwork export variant | Account asset `variant=export` rejects production. Normal authenticated previews are separate. | Production export delivery and quota verification. |
| Payments | Capabilities report unavailable. | Merchant setup, verified checkout/webhooks, idempotent entitlements and credit accounting. |
| Website publication | Capabilities report unavailable. | Customer release hosting and domain pipeline described below. |
| Administration | `/admin` calls `notFound()` outside development. | Verified administrator identity, server-owned authorization and audited production operations. The current read-only development page is not a production admin console. |

Current artwork requests can contain 8 MiB and export JSON can contain 18,000,000 bytes. Vercel Functions have a 4.5 MB request/response payload limit; those existing development paths cannot simply be enabled on Vercel unchanged. Upload files directly to authorized private storage, submit bounded job references, and deliver completed exports through authorized storage downloads. [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

PDF rendering launches local Playwright Chromium. Its in-process two-export counter is not a distributed quota. A production worker must provide a compatible browser runtime and durable scheduling, concurrency, cancellation, recovery and accounting. The installed queue dependency and domain contracts do not constitute a running worker. Native `sharp` is also used for image validation and authenticated previews. On Cloudflare Workers these operations require compatible services or a container-based worker; ordinary Workers cannot launch local child processes or load native add-ons. [Cloudflare runtime boundaries](https://developers.cloudflare.com/sandbox/concepts/)

## Customer website publishing is a separate release

Publishing the Makeborne app does not host sites made by customers. Before enabling its Publish action:

- [ ] Persist an immutable, validated release snapshot with project ownership, publication permission and source asset rights.
- [ ] Implement isolated delivery for customer content/code, separately from the authenticated editor and its cookies/secrets. Choose a static artifact route or an isolated application runtime explicitly.
- [ ] Provision site addresses, resolve each hostname to its tenant/release, and enforce domain ownership verification before custom-domain activation.
- [ ] Complete DNS/SSL status handling, release promotion, rollback, unpublish and cache invalidation.
- [ ] Enforce per-tenant storage/build/request limits, handle failures and abuse, and record auditable publication history.
- [ ] Verify a complete first publish, update, rollback, custom-domain connection and removal without affecting another tenant.

Cloudflare for SaaS is a candidate for custom hostname management; Workers for Platforms is a candidate if Makeborne executes customer-supplied application code. These are separate integrations, not features activated by selecting Cloudflare for the editor. [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/), [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)

## Deployment record

2026-10-04: local production build and TypeScript passed for the new project workspace. Commit `cdcb40d` was pushed to `main`. Creating a Git-linked Makeborne project in the connected Vercel team failed with `repo_no_access`: that account does not have the required repository access. No successful deployment or remote URL was returned.

Browser GitHub sign-in returned `github_account_not_linked`: an account already exists for the GitHub email and must be accessed by email before linking GitHub. The sign-in page was opened for the user. No purchase, hosting upgrade, environment transfer or new GitHub permission grant was performed. Deployment and remote authentication verification remain blocked by account access. Customer publication remains unimplemented.

The user subsequently signed into the intended browser account (kerimsabic-6594). GitHub sign-in is linked to Kerim-Sabic. The connector remains tied to a different account, so browser deployment is the current path. The official Vercel GitHub app is not installed for the personal Kerim-Sabic scope. Its permission review is prepared with only Kerim-Sabic/Makeborne selected; the final Install action awaits the user's explicit approval because it grants new repository access. No repository clone, project deployment, Pro trial or upgrade was started. The remaining immediate blocker is repository-app access, not Vercel sign-in.
