import type { MetadataRoute } from "next";
import { IS_PREVIEW, PUBLIC_PATHS, SITE } from "@/lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  // Account, billing, and customer-workspace pages are intentionally excluded.
  // Add public pages here only when they have useful, indexable content.
  // No invented last-modified dates: only emit a timestamp when tied to a real edit.
  return IS_PREVIEW ? [] : PUBLIC_PATHS.map(path => ({ url: `${SITE.url}${path}` }));
}
