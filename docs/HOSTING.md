# Makeborne hosting

Reviewed 2026-10-04. **Hosted app preview is live: https://makeborne.vercel.app.** Vercel reports the Production deployment Ready. The product still has the feature and launch limits below.

## Selected starting point

The current Next.js application is deployed to **Vercel**, retaining the existing Supabase backend. This is the shortest path to an online app preview because Vercel runs Next.js directly, including server routes, streaming and Git previews. The repository uses Next.js 16.3.8 and a Node runtime; no Cloudflare adapter is configured. [Vercel Next.js support](https://vercel.com/docs/frameworks/full-stack/nextjs)

Project `makeborne` belongs to the intended browser account, `kerimsabic-6594s-projects`, and is linked to `Kerim-Sabic/Makeborne` main. Future pushes to main deploy automatically. The connector is tied to a different account and was not used for this deployment. The current plan is Hobby; a commercial launch requires a suitable plan because Hobby is restricted to personal, noncommercial use. No purchase, Pro trial or upgrade was made. [Vercel Hobby](https://vercel.com/docs/plans/hobby)

Cloudflare is a possible later hosting target, but it requires compatibility work for this repository's native image processing and local Chromium rendering. Cloudflare currently recommends vinext, which is beta; OpenNext also supports Next.js 16. Choosing either requires a separate build and runtime verification. Do not deploy this server application as a static Pages export. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext support](https://opennext.js.org/cloudflare)

## Deployment and verification status

- [x] Created Makeborne with the Next.js preset, repository root, existing lockfile and default npm build.
- [x] Deployed commit `58921cd4d9eb2dac1c1a6365590258c1aaa99c26` to Production. Deployment `dpl_5aTZ5obkk1Yggz1rdrduLoP2xp9H` returned Ready and the stable alias `makeborne.vercel.app`.
- [x] Imported only the two public Supabase settings and the two verified cloud gates into Production and Preview. No provider keys, privileged Supabase key, or local Chromium path was uploaded.
- [x] Retained the verified Makeborne Supabase project `rklojnmmsmhwnkbzuidp`; see `CLOUD_BACKEND_VERIFICATION.md` for migration and isolation evidence.
- [x] Saved Supabase Site URL `https://makeborne.vercel.app`. Added that host's `/auth/callback`, `/auth/callback?next=**`, `/auth/confirm` and `/auth/update-password`; preserved all eight localhost entries. Only the callback query can vary on the exact hosted origin.
- [x] Hosted HTTP probes: /, /login, /studio, /billing and /chat returned 200; /admin returned 404; signed-out /api/workspaces returned 401 AUTH_REQUIRED.
- [x] Hosted capabilities report cloud accounts enabled and verified, and generation, exports, payments and public publishing unavailable. Same-origin generation request returned expected 503 GENERATION_NOT_ENABLED; an unrelated origin returned 403 ORIGIN_DENIED.
- [x] Visually inspected the deployed homepage and effort control. Local TypeScript, focused ESLint and production build passed.
- [ ] Signed-in project create/edit/save/reload and CRM reads on the hosted domain; the user was asked to sign in on that domain. Localhost authentication does not transfer to a new origin.
- [ ] Public signup and email recovery delivery: custom SMTP is not configured. The active confirmation and recovery templates both use the default ConfirmationURL.
- [x] Vercel reports Node.js 24.x, Fluid Compute, standard CPU and Standard Protection. The initial deployment used iad1; `vercel.json` now selects fra1 beside the existing Frankfurt database for subsequent deployments.

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

Origin and callback configuration is saved on the deployed origin; authenticated browser and email-delivery checks remain. Supabase documents matching redirect URLs to its allowlist, exact production paths, and the difference between Site URL and per-request redirect destinations. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

### Email delivery blocker

Supabase's dashboard confirms the default email sender is active. It only delivers to project team addresses and is unsuitable for public signup. Configure a verified sending domain and custom SMTP, then exercise confirmation and recovery end to end. Do not disable email confirmation as a workaround. [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp)

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

2026-10-04: deployed through the user's authenticated Vercel browser account after GitHub repository access became available. Imported the existing Makeborne repository, with no repository clone, no paid plan and no new backend project. Build, stable HTTPS alias and Production Ready status were observed. Vercel deployment URL: https://makeborne-cfcks2zqg-kerimsabic-6594s-projects.vercel.app. Project: https://vercel.com/kerimsabic-6594s-projects/makeborne.

The earlier connector repo_no_access and browser account mismatch are resolved for this browser deployment. The connector remains a different account. Customer website publishing, AI workers, paid integrations and public email delivery remain separate release work.
