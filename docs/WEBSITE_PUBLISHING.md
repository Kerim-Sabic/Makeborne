# Website hosting and GitHub export

## Scope

Generated HTML/CSS websites use the same sanitised document renderer as preview and HTML download. Publishing preserves their generated body and stylesheet, adding canonical/Open Graph metadata for the public address. A malformed generated design fails publication rather than falling back to the compatibility outline. Older outline-only sites retain the structured renderer and embedded, re-encoded WebP images.

This release does not execute arbitrary JavaScript or provision customer databases, authentication, APIs, forms, checkout, or server processes. Main Makeborne remains on Vercel; customer pages run on Cloudflare Pages.

Public URL: `https://sites.makeborne.com/<slug>`. Five live sites and twenty reserved addresses per workspace; 4 MB HTML and 12 images / 2.5 MB combined artwork. Publishing requires a verified owner with an active creation entitlement or a verified administrator grant. Source references must be approved for public use. Taking a website offline does not require a paid plan.

The generated renderer sanitises HTML, strips executable elements and enforces the curated image allowlist. The legacy renderer escapes text and embeds vetted image bytes. The shared `infra/customer-sites/website-policy.js` defines approved concept imagery and the Cloudflare response policy. Cloudflare sends a sandboxed CSP with scripts, network connections and forms disabled, approved remote image paths plus legacy image data allowed, no-store responses, no referrer, and no framing. Only a publishable Supabase key is deployed there. The public database RPC exposes only eligible published HTML. Revoked or expired creation entitlements stop serving websites; no five-minute activity lease is applied to public viewing.

## Cloudflare deployment

Project: `makeborne-sites`; account `edda2b12d52321e4df2012e196b33640`. Deploy `infra/customer-sites` using Wrangler Pages. Set `SUPABASE_PUBLISHABLE_KEY` for the Pages project before deployment. It must be the public `sb_publishable_` key, never the secret server key. The first dashboard deployment embedded that public key in the upload bundle; use a normal environment binding for future deployments.

Attach `sites.makeborne.com` through the Pages domains API/dashboard and set the external DNS CNAME to `makeborne-sites.pages.dev`. Check HTTPS before enabling publishing in production. The free Functions quota and Supabase database/egress limits apply; this is not unlimited free hosting.

## GitHub

GitHub App: **Makeborne Websites**, app ID `5192280`, slug `makeborne-websites`. This is separate from identity-only GitHub sign-in. User authorization callback: `https://makeborne.com/api/github/callback`. Request Contents read/write and Metadata read-only. Keep user token expiration enabled. No workflow, administration, secrets, or organization permissions are needed.

The user connects, installs the App on selected repositories, refreshes the list, chooses a writable repository, and explicitly syncs a published website version. A dedicated `makeborne/site-<artifact UUID>` branch receives index.html and README.md. Existing default branches are not changed. Empty repositories must be initialized in GitHub first. External changes to a managed branch cause a conflict; imports/two-way sync are not supported.

OAuth state is bound to the verified account and an HttpOnly ten-minute cookie with PKCE. User tokens are AES-256-GCM encrypted with account ID as associated data, stored in server-only tables, and checked against GitHub on each operation. No installation token can bypass the user's own GitHub permissions. Tokens expire after eight hours and require reconnecting; automatic refresh is intentionally not implemented. Disconnect removes Makeborne's stored credential; users can also revoke the app in GitHub settings. No GitHub tokens are sent to the browser.

Required production settings: SUPABASE_SECRET_KEY, MAKEBORNE_GITHUB_CLIENT_ID, MAKEBORNE_GITHUB_CLIENT_SECRET, MAKEBORNE_GITHUB_APP_SLUG, MAKEBORNE_GITHUB_ENCRYPTION_KEY. Never put these secrets in NEXT_PUBLIC variables or commit them. The GitHub private key required during initial App registration is not used by this user-token implementation.

## Release checks

Build/typecheck and scoped lint passed. Local credential/link table RLS and grants checked: browser roles have no read/write access, service role does. Security advisors passed locally. Hosting SQL rollback fixtures passed locally and on the linked project; Cloudflare unpublished-slug 404 verified. These checks do not replace a real signed-in publish → visit → sync → disconnect check after production credentials and HTTPS are active.

Generated backend hosting remains a later release: isolated runtimes, per-project secrets, database provisioning and migration review, quota enforcement, deployment logs and rollback must be implemented before arbitrary server code is enabled.

## 8 October 2026 renderer verification

`node src/lib/generation/check-website-document.cjs --browser` verifies that generated content, stylesheet and imagery survive publication, while legacy rendering, malformed-design rejection, canonical escaping and GET/HEAD delivery remain correct. A local Chromium fixture compares identical main-region pixels at 390px and 1440px, loads approved images under the hosting HTTP CSP, checks overflow and follows real anchor links. Evidence is in `docs/execution/evidence/M00-T01-R01/`.

The browser records sandbox-blocked automation instrumentation separately from unexpected page/resource errors. Tests use local HTTP and a mocked public database response; this is not evidence of a production publish, customer entitlement check, domain deployment or GitHub sync. Both the application renderer and the Cloudflare bundle must be deployed together before the fix can be claimed live.
