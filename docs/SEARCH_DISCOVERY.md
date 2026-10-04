# Search and discovery

## Current public surface

- Canonical origin: `https://makeborne.vercel.app` in `src/lib/site-metadata.ts`.
- Home is indexable in production and has a canonical URL, descriptive title, description, Open Graph/Twitter preview, and `WebSite` structured data for the Makeborne identity.
- `/help` supplies visible answers about current availability, selecting styles, writing a brief, attachments, effort, account access, coffee support, client work, and publishing. It is linked from the home footer, has its own canonical metadata, and uses matching `WebPage`/`BreadcrumbList` structured data. It does not advertise unavailable generation or publishing as live.
- `/sitemap.xml` contains only home and `/help`. The public route list is shared in `site-metadata.ts`. Billing currently contains account information, so it is not a public pricing landing page.
- `/robots.txt` permits crawling so crawlers can read each route's `noindex` directive. `OAI-SearchBot` is explicitly allowed for ChatGPT search discovery. This does not change the existing wildcard policy for model-training crawlers or grant access to private workspaces.
- Public metadata requests large image previews and full snippets. Open Graph and Twitter both point to the actual 1200 × 630 brand image, with descriptive alt text.
- App pages default to `noindex, nofollow`. Studio, chat, login, billing, admin, auth, and API paths also send `X-Robots-Tag` headers, including non-HTML responses. This supplements indexing control; it does not replace authorization.
- Vercel preview public pages stay `noindex`; preview sitemaps contain no URLs.

## Adding a public page

Write useful visible content that matches the available product, add its path to `PUBLIC_PATHS`, and use `publicPageMetadata` to set its title/description, canonical URL, indexing and share previews. Do not put client projects, chat transcripts, account pages, or sample customer data in the sitemap. Update the shared canonical origin and the social-preview footer together when a custom domain launches, and redirect the previous public origin to it.

Public search-facing content must distinguish available features from planned features. Do not add reviews, ratings, price offers, user counts, or results to structured data unless they are genuine, visible, and maintained.

## Still requires launch work

- Verify ownership in Google Search Console and Bing Webmaster Tools, then submit the production sitemap. No ownership tokens or verified accounts have been supplied.
- Publish real privacy, terms, support, cancellation, and refund information before selling the service. Those policies depend on the operator's actual details and enabled services.
- Add product guides, public use-case pages, and documented examples after the corresponding features work. Avoid thin duplicate pages intended only to capture keywords.
- Measure real-user performance and search coverage after deployment; metadata alone does not establish performance or discoverability.

## AI answers and search

The implementation uses readable content and ordinary search metadata. Google states that its AI search features have no extra technical requirements or special schema/AI text files. No ranking, indexing, or AI citation outcome is guaranteed.

Sources checked on 4 October 2026:

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google: prevent indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Google: site names](https://developers.google.com/search/docs/appearance/site-names)
- [OpenAI: crawler and search-bot controls](https://developers.openai.com/api/docs/bots)

## Verification for this update

- Targeted ESLint passed for public metadata, home, sitemap, robots, help and the footer change.
- Local HTTP checks returned 200 for `/`, `/help`, `/sitemap.xml`, `/robots.txt`, and `/opengraph-image`.
- Home and help render canonical production URLs and `index, follow`; parsed JSON-LD matches their visible identity and breadcrumb.
- `/login` still renders `noindex, nofollow` in both its metadata and response header.
- The social image endpoint returns a PNG (approximately 74 KB). This does not substitute for production crawler inspection or real-user performance measurement.

Next.js implementation follows the installed 16.3.8 metadata, robots, sitemap, social image, and response-header documentation.
