import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  // Account, billing, and customer-workspace pages are intentionally excluded.
  // Add public pages here only when they have useful, indexable content.
  return [{ url: `${SITE.url}/` }];
}
