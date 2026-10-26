/* eslint-disable @typescript-eslint/no-require-imports -- Offline check: public pages are indexable, private ones stay noindex. */
// Public pages in the sitemap must not be sent with a noindex header, and private pages must keep one.
// A rule for "/billing/:path*" also matches "/billing", which kept the pricing and terms pages out of search.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp");

(async () => {
  const root = path.join(__dirname, "..", "..");
  const config = (await import(pathToFileURL(path.join(root, "next.config.ts")).href)).default;
  const { PUBLIC_PATHS } = await import(pathToFileURL(path.join(root, "src", "lib", "site-metadata.ts")).href);
  const rules = await config.headers();
  const noindexFor = (route) => rules.filter(rule => pathToRegexp(rule.source).test(route))
    .flatMap(rule => rule.headers).filter(header => header.key.toLowerCase() === "x-robots-tag" && /noindex/i.test(header.value));

  for (const route of [...PUBLIC_PATHS, "/help/create-a-website-with-ai"]) {
    assert.deepEqual(noindexFor(route), [], `${route} is public and in the sitemap, so it must not get a noindex header`);
  }
  for (const route of ["/studio", "/studio/cloud", "/chat", "/login", "/billing/return", "/admin", "/auth/verify", "/api/credits", "/review/abc"]) {
    assert.ok(noindexFor(route).length > 0, `${route} is private and must keep a noindex header`);
  }
  console.log("public pages are indexable; private pages stay noindex");
})().catch(error => { console.error(error); process.exit(1); });
