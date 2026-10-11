/** Delivery policy for published customer websites (interactive hosting).
 *
 * Every published site is served from its own origin on a dedicated registrable
 * domain (`<slug>.<SITES_DOMAIN>`, e.g. `good-dog.makeborne.site`). Site
 * JavaScript therefore never shares an origin, cookie scope or storage with
 * Makeborne itself. Pure functions only: the Worker, the Next publish route and
 * the offline checks all import this module.
 */
import { websiteImageCsp } from "./website-policy.js";

export const SITE_SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
export const RESERVED_SITE_SLUGS = Object.freeze(["admin", "api", "auth", "billing", "login", "studio", "support", "www", "makeborne", "robots-txt", "sitemap-xml"]);
/** A valid site address label: also a valid DNS label, never a punycode (IDN) label. */
export function validSiteLabel(value) {
  return typeof value === "string" && SITE_SLUG.test(value) && !RESERVED_SITE_SLUGS.includes(value) && !value.startsWith("xn--");
}

/** Built entry points are content-addressed under a reserved prefix. */
export const SITE_SCRIPT_PATH = /^\/_mb\/app-[0-9a-f]{16}\.js$/;
export const SITE_STYLE_PATH = /^\/_mb\/app-[0-9a-f]{16}\.css$/;
/** Project images keep the public path the site code references (`/images/hero.webp`). */
export const SITE_IMAGE_PATH = /^\/(?!_mb\/)(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\/){0,7}[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.(?:webp|png|jpe?g)$/i;
export const SITE_CONTENT_TYPES = Object.freeze({ script: "text/javascript; charset=utf-8", style: "text/css; charset=utf-8", image: "image/webp" });
export const SITE_LIMITS = Object.freeze({ html: 4_000_000, script: 1_500_000, style: 512_000, image: 2_000_000, images: 40, files: 42, total: 6_000_000 });

/** Path served by the Worker as a stored file (otherwise: document or 404). */
export function siteFilePath(pathname) {
  if (typeof pathname !== "string" || pathname.length > 240 || pathname.includes("..") || pathname.includes("//")) return false;
  return SITE_SCRIPT_PATH.test(pathname) || SITE_STYLE_PATH.test(pathname) || SITE_IMAGE_PATH.test(pathname);
}

/** Client-side (hash/state/history) routes: extension-less paths fall back to the document. */
export function siteDocumentPath(pathname) {
  if (typeof pathname !== "string" || pathname.length > 240 || !pathname.startsWith("/") || pathname.includes("//")) return false;
  if (pathname === "/" || pathname === "/index.html") return true;
  const last = pathname.replace(/\/$/, "").split("/").pop() ?? "";
  return /^[A-Za-z0-9_~-][A-Za-z0-9_~.-]*$/.test(last) && !last.includes(".");
}

/** The site's own subdomain on the isolated domain, or null for any other host. */
export function siteSlugFromHost(hostname, baseDomain) {
  if (typeof hostname !== "string" || typeof baseDomain !== "string" || !baseDomain) return null;
  const host = hostname.toLowerCase().replace(/\.$/, ""), base = baseDomain.toLowerCase();
  if (!host.endsWith(`.${base}`)) return null;
  const label = host.slice(0, -(base.length + 1));
  return validSiteLabel(label) ? label : null;
}

export function siteOrigin(slug, baseDomain, secure = true) {
  return `${secure ? "https" : "http"}://${slug}.${baseDomain}`;
}

const SHARED_DIRECTIVES = [
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${websiteImageCsp}`,
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "manifest-src 'self'",
  // No service or web workers: a site taken offline must not keep running from a
  // visitor's cache, and nothing may run outside the document's CSP.
  "worker-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

/** Document policy. Interactive sites run exactly one same-origin module bundle;
 * inline scripts, eval, remote scripts and third-party connections stay blocked. */
export function siteDocumentCsp({ interactive, secure }) {
  return [
    "default-src 'none'",
    interactive ? "script-src 'self'" : "script-src 'none'",
    interactive ? "connect-src 'self'" : "connect-src 'none'",
    ...SHARED_DIRECTIVES,
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Stored files are never documents: a navigated-to file renders inert. */
export const SITE_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
export const SITE_ERROR_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const SITE_PERMISSIONS_POLICY = [
  "accelerometer=()", "autoplay=(self)", "bluetooth=()", "browsing-topics=()", "camera=()", "display-capture=()", "encrypted-media=()",
  "fullscreen=(self)", "geolocation=()", "gyroscope=()", "hid=()", "magnetometer=()", "microphone=()", "midi=()", "payment=()",
  "picture-in-picture=(self)", "publickey-credentials-get=()", "screen-wake-lock=()", "serial=()", "usb=()", "xr-spatial-tracking=()",
].join(", ");

function baseHeaders(secure) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": SITE_PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    ...(secure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

/** HTML is always revalidated so publishing, JS toggles and takedowns apply at once. */
export function siteDocumentHeaders({ interactive, secure, indexable = true, etag }) {
  return {
    ...baseHeaders(secure),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Security-Policy": siteDocumentCsp({ interactive, secure }),
    ...(etag ? { ETag: etag } : {}),
    ...(indexable ? {} : { "X-Robots-Tag": "noindex" }),
  };
}

/** Content-addressed bundles are immutable; project images may change on republish. */
export function siteFileCacheControl(pathname) {
  return SITE_SCRIPT_PATH.test(pathname) || SITE_STYLE_PATH.test(pathname)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, stale-while-revalidate=3600";
}

export function siteFileHeaders({ pathname, contentType, secure, etag }) {
  return {
    ...baseHeaders(secure),
    "Content-Type": contentType,
    "Cache-Control": siteFileCacheControl(pathname),
    "Content-Security-Policy": SITE_FILE_CSP,
    ...(etag ? { ETag: etag } : {}),
  };
}

export function siteErrorHeaders({ secure, status }) {
  return {
    ...baseHeaders(secure),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": status === 404 ? "public, max-age=30" : "no-store",
    "Content-Security-Policy": SITE_ERROR_CSP,
    "X-Robots-Tag": "noindex",
    ...(status === 503 ? { "Retry-After": "60" } : {}),
  };
}

const ERROR_STYLE = "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f6;color:#191b23;font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;opacity:.75}a{color:inherit}";
export function siteErrorPage(status) {
  const [title, detail] = status === 404
    ? ["Page not found", "This website or page isn’t published."]
    : ["Temporarily unavailable", "This website couldn’t be loaded. Please try again in a minute."];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>${ERROR_STYLE}</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

/** Attach the site bundle to the prerendered snapshot. The snapshot paints first
 * (and is the no-JS/SEO fallback); the module then re-renders the root. */
export function composeSiteDocument(html, { script, interactive }) {
  if (typeof html !== "string" || !html.startsWith("<!doctype html>")) throw new Error("invalid_document");
  if (!interactive || !script) return html;
  if (!SITE_SCRIPT_PATH.test(script)) throw new Error("invalid_script");
  const tag = `<script type="module" src="${script}"></script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${tag}</head>`) : html.replace(/<body/i, () => `<head>${tag}</head><body`);
}
