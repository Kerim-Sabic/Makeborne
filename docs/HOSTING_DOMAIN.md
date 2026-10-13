# Website addresses and the isolated hosting domain

## Default: existing addresses (no configuration)

- **Address:** `https://sites.makeborne.com/<slug>`, served by the existing static host (Pages project `makeborne-sites`, which reads `makeborne_read_hosted_site`).
- **Unchanged:**
  - every published link and slug;
  - republishing keeps the address;
  - new projects publish at the same kind of address.
- **Static only:** `sites.makeborne.com` belongs to the Makeborne application's site, so no customer JavaScript runs there:
  - the publish form shows no JavaScript toggle and sends no bundle;
  - the server ignores a bundle from an older client;
  - turning JavaScript on is refused (`JAVASCRIPT_UNAVAILABLE`);
  - the database refuses a script or the interactive flag without an isolated copy;
  - the host's CSP is `sandbox; script-src 'none'`.
- **Portable copy:** every publish stores a self-contained document in `hosted_sites.html`: inline styles, project images embedded as data URLs (2.5 MB combined), and no script. This is what the existing host serves, so the document never depends on files that only another host has.

## Isolated domain (explicit, validated configuration)

Customer JavaScript runs only on a separate registrable domain, where each site has its own origin: `https://<slug>.<domain>/`. All three settings are required, in the app's environment:

```
NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=isolated
NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE=https://{slug}.<domain>/
NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED=<domain>
```

The app keeps the existing addresses, and reports why in `HOSTING.issues`, when:
- a setting is missing;
- the template isn't exactly `https://{slug}.<domain>/` (lowercase, one `{slug}`, trailing slash);
- the domain is `makeborne.com` or one of its subdomains;
- the attestation doesn't match the domain.

The old single variable (`NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE` alone) no longer switches hosts. `http://{slug}.localhost:<port>/` is accepted only outside production, for local qualification.

**While enabled:**
- Each publish stores the portable copy plus `hosted_sites.isolated_html`, which links `/_mb/app-<hash>.css` and `/images/*`, and the site bundle.
- The isolated Worker (`makeborne_read_hosted_site_v2`) serves the isolated copy, with the script when JavaScript is on.
- The existing host keeps serving the portable copy.
- Canonical and Open Graph URLs in both copies point to the new address.
- On the isolated domain, the portable copy omits images over the 2.5 MB budget; in the default mode such a publish is refused instead.

### Prerequisites, before setting `..._DOMAIN_VERIFIED`

1. **A separate registrable domain** (for example `makeborne.site`), never a subdomain of makeborne.com. It's a purchase: the owner buys it, Claude doesn't.
2. **DNS** in the Cloudflare account (full-setup zone): proxied `AAAA * 100::` and `AAAA @ 100::`. Universal SSL must cover the apex and `*.<domain>`. Turn on Always Use HTTPS, with TLS 1.2 minimum.
3. **The site Worker** (`infra/customer-sites`, `env.production`):
   - `SITES_DOMAIN=<domain>`;
   - routes for `*.<domain>/*` and `<domain>/*`;
   - only the publishable Supabase key.

   Deploy it, then confirm:
   - `curl -sI https://<live-slug>.<domain>/` returns 200 with the strict CSP;
   - `curl -sI https://nope-123.<domain>/` returns 404.
4. **Database migrations** applied through `20261012160000_portable_site_html.sql`.
5. **Recommended:** submit the domain to the Public Suffix List (private section), so sites can't set cookies for each other.
6. **Only after 1–5:** set the three variables and deploy the app.
7. **Optional, last:** redirect `sites.makeborne.com/<slug>` to the new addresses by deploying `infra/customer-sites/legacy-redirect`, with `SITES_DOMAIN` set. Until then, old links keep working through the existing host's portable copies.

## Release-review notes (2026-10-13)

- **Worker `APP_ORIGIN` is validated.** It must be an `https://` origin (an `http://localhost` or `127.0.0.1` origin only in the local configuration); otherwise every request gets 503 (fail closed). It defaults to `https://makeborne.com` when unset. This changed `_worker.js`, so the staging Worker (version `1d9a7b03…`) predates the fix. Redeploy and re-check before production.
- **Shared routes.** The staging and production Worker environments both declare `*.makeborne.site/*` and `makeborne.site/*`. Remove the staging Worker before deploying production (`docs/RELEASE_CHECKLIST.md` section F).
- **Address cap.** Each website can hold at most 10 addresses, current plus retired (`20261013090000`); the 11th rename returns `PUBLISHING_LIMIT` (429). Returning to an earlier address of the same site is always allowed. Retired addresses are released only when the hosted site row is deleted.
- **Enquiries follow hosting eligibility.** A site that is not served (the owner can no longer host) also refuses form submissions.

## Verification

- Offline: `src/lib/hosting/check-hosting.cjs` covers configuration validation, portable inlining and the Worker. `src/lib/hosting/check-publication-modes.cjs` drives the real publication route under the default, misconfigured, isolated and rolled-back configurations.
- Database: `supabase/check-hosting-modes.sql` (rolled back) covers:
  - existing links on both readers;
  - republishing;
  - the isolated copy;
  - rollback;
  - new projects;
  - script and interactive guards;
  - privileges.

## Rollback

1. Remove the three variables (or set `NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=`) and redeploy the app. Addresses return to `sites.makeborne.com/<slug>` immediately.
2. If the legacy redirector was deployed, redeploy the previous static Pages bundle to `makeborne-sites`. It serves `makeborne_read_hosted_site`, which returns the portable copy of every site, including sites published while the isolated domain was on.
3. The isolated Worker can stay up. A site republished in the default mode loses its isolated copy and script; until then the isolated host keeps serving it.

No site needs republishing for its existing link to work again. The exception is a site published by the unreleased interactive app before portable copies existed: `needs_portable_republish` flags it, it keeps working on the isolated host, and it needs one republish for the existing host.
