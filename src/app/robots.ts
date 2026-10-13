import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    // Crawlers must be able to read the noindex directives on private routes.
    // robots.txt is never used as an access-control mechanism.
    // AI *search* crawlers (they cite and link pages in answers) are named so
    // discovery is explicit. Model-training crawlers keep the default policy;
    // do not change the owner's training policy here.
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      { userAgent: ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Applebot", "Bingbot", "Googlebot"], allow: ["/", "/llms.txt"], disallow: ["/api/"] },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
