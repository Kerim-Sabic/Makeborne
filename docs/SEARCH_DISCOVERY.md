# Search and discovery

## Current public surface

- Canonical origin: `https://makeborne.vercel.app` in `src/lib/site-metadata.ts`.
- Home is indexable in production and has a canonical URL, descriptive title, description, Open Graph/Twitter preview, and `WebSite` structured data for the Makeborne identity.
- `/sitemap.xml` contains only home. Billing currently contains account information, so it is not a public pricing landing page.
- `/robots.txt` permits crawling so crawlers can read each route's `noindex` directive.
- App pages default to `noindex, nofollow`. Studio, chat, login, billing, admin, auth, and API paths also send `X-Robots-Tag` headers, including non-HTML responses. This supplements indexing control; it does not replace authorization.
- Vercel preview home pages stay `noindex`.

## Adding a public page

Write useful visible content that matches the available product, set its title/description and canonical URL, explicitly opt it into indexing, and add its canonical URL to the sitemap. Do not put client projects, chat transcripts, account pages, or sample customer data in the sitemap. Update the shared canonical origin and the social-preview footer together when a custom domain launches.

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

Next.js implementation follows the installed 16.3.8 metadata, robots, sitemap, social image, and response-header documentation.
