import type { MetadataRoute } from "next";
import { IS_PREVIEW, PUBLIC_PATHS, SITE } from "@/lib/site-metadata";
import { HELP_ARTICLES } from "@/lib/help/articles";

export default function sitemap(): MetadataRoute.Sitemap {
  // Account and customer-workspace pages are intentionally excluded.
  // Add public pages here only when they have useful, indexable content.
  // No invented last-modified dates: only emit a timestamp when tied to a real edit
  // (help articles carry the date their content was last reviewed).
  if (IS_PREVIEW) return [];
  return [
    ...PUBLIC_PATHS.map(path => ({ url: `${SITE.url}${path}` })),
    ...HELP_ARTICLES.map(article => ({ url: `${SITE.url}/help/${article.slug}`, lastModified: article.updated })),
  ];
}
