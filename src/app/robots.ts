import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    // Crawlers must be able to read the noindex directives on private routes.
    // robots.txt is never used as an access-control mechanism.
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
