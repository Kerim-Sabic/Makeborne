/** Legacy Pages project behind `sites.makeborne.com` (external DNS CNAME, not a
 * Cloudflare zone). Path addresses move permanently to each site's own origin
 * on the isolated site domain. Self-contained: no bindings, no data access. */
const SITES_DOMAIN = "makeborne.site";
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const RESERVED = new Set(["admin", "api", "auth", "billing", "login", "studio", "support", "www", "makeborne", "robots-txt", "sitemap-xml"]);
const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Robots-Tag": "noindex" };

const legacyRedirect = {
  async fetch(request) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
    const slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (!slug) return Response.redirect("https://makeborne.com", 302);
    if (!SLUG.test(slug) || RESERVED.has(slug) || slug.startsWith("xn--")) return new Response("This website is not published.", { status: 404, headers });
    return Response.redirect(`https://${slug}.${SITES_DOMAIN}/`, 301);
  },
};

export default legacyRedirect;
