/** sitemap.xml and robots.txt for published sites. Page paths come from the
 * database (live sites only); the origin is the address the visitor used. */

const PAGE_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;
const xml = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Validates the RPC answer: { paths: string[], updated_at: string|null } or null. */
export function sitePaths(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || !Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 100) throw new Error("invalid_sitemap");
  const paths = [...new Set(value.paths)].filter(path => typeof path === "string" && PAGE_PATH.test(path)).sort();
  if (!paths.length) throw new Error("invalid_sitemap");
  const updated = typeof value.updated_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.updated_at) ? value.updated_at.slice(0, 10) : null;
  return { paths, updated };
}

export function sitemapDocument(origin, paths, updated) {
  const lastmod = updated ? `<lastmod>${xml(updated)}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(path => `  <url><loc>${xml(origin + path)}</loc>${lastmod}</url>`).join("\n")}\n</urlset>\n`;
}

export function robotsDocument(origin, indexable) {
  return indexable ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
}
