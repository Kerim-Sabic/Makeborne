import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    // Crawlers must be able to read the noindex directives on private routes.
    // robots.txt is never used as an access-control mechanism.
    // OAI-SearchBot is for ChatGPT search discovery. Its policy is independent
    // of model-training crawlers; do not change the owner's training policy here.
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/" },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
