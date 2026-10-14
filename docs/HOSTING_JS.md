# Interactive website hosting (JavaScript on an isolated domain)

> **Addresses and enablement now follow [HOSTING_DOMAIN.md](HOSTING_DOMAIN.md).** By default sites keep `https://sites.makeborne.com/<slug>` and publish static. The isolated domain below, and JavaScript with it, turns on only with the three explicit, attested variables described there. Every publish also keeps a portable copy for the existing host.

Published React websites now run their own JavaScript, so menus, tabs, carousels, forms, calculators and animations behave exactly like the editor preview. Nothing here has been deployed: this document is the owner's checklist.

## Architecture

```
Editor (browser)                         Next API (Vercel)                         Supabase (Postgres)
 - esbuild-wasm production build  ─────▶  POST …/publication                ─────▶  hosted_sites (+ interactive,
   (minified ESM, React inlined)           - validates sizes, UTF-8, types           entry_script, bundle_sha256)
 - sandboxed render → snapshot             - re-encodes project images (WebP)        hosted_site_files (JS, CSS, images,
   (image data URLs mapped back            - content-addresses /_mb/app-<h>.js/css    bytea + sha256, private table)
   to /images/… paths)                     - sanitises snapshot (no scripts)
                                           - makeborne_save_hosted_site_v2

Visitor ──▶ https://<slug>.makeborne.site ──▶ Cloudflare Worker `makeborne-site-host` (infra/customer-sites/_worker.js)
             - "/" and extension-less routes: snapshot HTML (+ <script type=module src=/_mb/app-<h>.js> when JS is on)
             - /_mb/app-<h>.js|css, /images/*.webp: stored files, sha256-verified, edge-cached
             - reads only via the publishable key: makeborne_read_hosted_site_v2 / makeborne_read_hosted_site_file
```

- **First paint / SEO / no-JS:** the sanitised static snapshot (as before) is served first; the bundle's `createRoot(...).render()` then replaces `#root`. Re-rendering (not `hydrateRoot`) is deliberate: the snapshot is captured after scrolling and animations, so markup can differ from the initial React tree, and React would discard a mismatched hydration anyway.
- **One origin per site** on a separate registrable domain: site code can never read or write Makeborne cookies, storage or sessions, and sites cannot touch each other's DOM or storage.
- **Per-site "Interactive (JavaScript)" toggle** (default on). It switches immediately without republishing (`PATCH …/publication`). While off, the Worker omits the script tag, the CSP sets `script-src 'none'`, and the database withholds the script file.
- `sites.makeborne.com/<slug>` (legacy Pages project, external DNS) becomes a 301 redirect to `https://<slug>.makeborne.site/`.

## Security headers (HTML)

| Header | Value |
| --- | --- |
| Content-Security-Policy (JS on) | `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <3 curated makeborne.com images>; font-src 'self' data:; media-src 'self' data: blob:; manifest-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
| CSP (JS off) | same with `script-src 'none'; connect-src 'none'` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` (HTTPS only) |
| Permissions-Policy | camera, microphone, geolocation, payment, USB/serial/HID/Bluetooth, sensors, topics, display capture, WebAuthn get … all `()`; autoplay/fullscreen/picture-in-picture `(self)` |
| Other | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1` |
| Caching | HTML `public, max-age=0, must-revalidate` + ETag (publishing, toggles and takedowns apply at once); `/_mb/app-<hash>.*` `public, max-age=31536000, immutable`; images `public, max-age=300, stale-while-revalidate=3600`; 404 `max-age=30` |
| Stored files | `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` so a navigated-to file is inert |

No inline scripts, `eval`/`new Function`, remote scripts, third-party connections, workers/service workers (a site taken offline cannot keep running from a visitor's cache) or framing. Makeborne APIs are additionally unreachable because they require same-origin requests plus the `X-Makeborne-Account` header (forces a CORS preflight they never approve), and session cookies are host-only on the app domain.

## Limits

Script ≤ 1.5 MB, stylesheet ≤ 512 kB, ≤ 40 images (each ≤ 2 MB after WebP re-encoding), ≤ 6 MB of files per site, snapshot HTML ≤ 4 MB, publish request body ≤ 4.4 MB (Vercel caps function bodies at 4.5 MB; images are loaded server-side and never travel in it). Five live sites and twenty reserved addresses per workspace and the paid/admin publishing entitlement are unchanged.

## Deployment (in this order)

Cloudflare account: `edda2b12d52321e4df2012e196b33640`. Supabase project: `rklojnmmsmhwnkbzuidp`.

1. **Domain.** Register `makeborne.site` (or another *separate registrable domain*; never a subdomain of makeborne.com) with Cloudflare Registrar, or add it as a full-setup zone in the account above.
   - DNS: proxied `AAAA * 100::` and proxied `AAAA @ 100::` (placeholder origins; the Worker answers).
   - SSL/TLS: Universal SSL covers `makeborne.site` and `*.makeborne.site`; enable *Always Use HTTPS*, minimum TLS 1.2. HSTS is sent by the Worker.
   - Recommended next: submit `makeborne.site` to the Public Suffix List (private section, github.com/publicsuffix/list) so each `<slug>.makeborne.site` is its own *site* for cookies. Until listed, sites are separate origins (DOM/storage isolated) but one site could set a `.makeborne.site` cookie seen by another customer site. Makeborne itself is unaffected either way.
   - If you choose a different domain, change `SITES_DOMAIN` and the two `routes` in `infra/customer-sites/wrangler.jsonc` (`env.production`), `SITES_DOMAIN` in `infra/customer-sites/legacy-redirect/_worker.js`, and set `NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE` (step 4).
2. **Database migration** (additive; the old app and old Worker keep working): apply `supabase/migrations/20261011140000_hosted_site_bundles.sql` to production, e.g. `npx supabase link --project-ref rklojnmmsmhwnkbzuidp && npx supabase db push`, or paste it into the SQL editor. It adds `hosted_sites.interactive/entry_script/bundle_sha256`, the private `hosted_site_files` table, `makeborne_save_hosted_site_v2`, `makeborne_set_hosted_site_interactive` (service role only) and the public readers `makeborne_read_hosted_site_v2` / `makeborne_read_hosted_site_file`.
3. **Site Worker** (from the repository root):
   ```
   cd infra/customer-sites
   npx wrangler login                                   # account edda2b12…
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --env production   # the public sb_publishable_… key, never the secret key
   npx wrangler deploy --env production                 # Worker "makeborne-site-host", routes *.makeborne.site/* and makeborne.site/*
   ```
   Vars are in `wrangler.jsonc` → `env.production.vars`: `SUPABASE_URL=https://rklojnmmsmhwnkbzuidp.supabase.co`, `SITES_DOMAIN=makeborne.site`, `APP_ORIGIN=https://makeborne.com`, `ALLOW_LOCAL_SUPABASE=false`. The top-level (non-`--env`) config is local-only and has no routes. Check: `curl -sI https://<a-live-slug>.makeborne.site/` returns 200 with the CSP above; `curl -sI https://nope-123.makeborne.site/` returns 404.
4. **App (Vercel).** Deploying this branch changes nothing about addresses. To switch to the isolated domain, set `NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=isolated`, `NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE=https://{slug}.<domain>/` and `NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED=<domain>`, only after step 3 serves HTTPS (see HOSTING_DOMAIN.md).
5. **Legacy address.** Replace the old static Pages deployment with the redirector:
   `npx wrangler pages deploy infra/customer-sites/legacy-redirect --project-name makeborne-sites`
   (`sites.makeborne.com` keeps its external CNAME to `makeborne-sites.pages.dev`). `https://sites.makeborne.com/<slug>` then 301s to `https://<slug>.makeborne.site/`.
6. **Existing sites** keep serving their stored static HTML on the new domain (with scripts off, since they have no bundle). Owners click *Publish saved changes* once to get JavaScript and the new canonical URL.

Rollback: redeploy the previous Pages bundle (`git show 387df35:infra/customer-sites/_worker.js` etc.) and the previous app; the original `makeborne_read_hosted_site` / `makeborne_save_hosted_site` RPCs are untouched by the migration.

## Local qualification

```
# terminal 1: Worker against the LOCAL Supabase stack only
#   infra/customer-sites/.dev.vars (gitignored): SUPABASE_URL=http://127.0.0.1:55321, ALLOW_LOCAL_SUPABASE=true,
#   SITES_DOMAIN=localhost, SUPABASE_PUBLISHABLE_KEY=<local sb_publishable_ key from `npx supabase status -o env`>
cd infra/customer-sites && npx wrangler dev --port 8787 --ip 127.0.0.1 --local
# terminal 2: app on local Supabase (run `npm run prepare-runtime` first; dev-local.mjs skips predev)
NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE='http://{slug}.localhost:8787/' node C:/mbw/dev-local.mjs . 3205
```
The Worker refuses any non-`*.supabase.co` upstream unless `ALLOW_LOCAL_SUPABASE=true`, and the local config never contains the production URL. Offline checks: `node src/lib/hosting/check-hosting.cjs` (CSP/header generation, host/path routing, bundle validation, digest verification, snapshot sanitising, migration grants) runs in `npm test`.

## Not included yet

Enabled custom domains (the `custom_domains` table, host resolver and Worker support exist but are not deployed or configured; see [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md)), form/checkout back-ends, server code, per-route prerendering (client routes other than `/` get the home snapshot until React renders them, and are marked `noindex`), and automatic edge-cache purge on takedown (immutable bundles may stay in the edge cache, but without the HTML they are inert).
