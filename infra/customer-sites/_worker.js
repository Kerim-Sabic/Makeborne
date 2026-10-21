import { robotsDocument, sitemapDocument, sitePaths } from "./sitemap.js";
import { scheduleSiteView } from "./analytics.js";
import { submitEnquiry } from "./forms.js";
import { siteNamespacePolicy, classifySiteNamespaceRequest, STAGING_SITE_LABELS } from "./namespace-policy.js";
import {
  composeSiteDocument, siteDocumentHeaders, siteDocumentPath, siteErrorHeaders, siteErrorPage, siteFileHeaders, siteFilePath,
  siteOrigin, SITE_CONTENT_TYPES, SITE_LIMITS, siteScriptPath, siteFileContentType, validSiteLabel, immutableSiteFile,
} from "./site-policy.js";

/** Cloudflare Worker for published customer websites.
 *
 * `<slug>.<SITES_DOMAIN>` serves one site per origin: its prerendered snapshot
 * plus (when the owner keeps JavaScript on) its same-origin module bundle and
 * project images. The legacy path host (`sites.makeborne.com/<slug>`) redirects
 * there. A customer's own hostname (Cloudflare for SaaS, see
 * docs/CUSTOM_DOMAINS.md) resolves to a slug through the database and is then
 * served exactly like that slug's address. Site reads use the publishable
 * Supabase key against read-only RPCs. Enquiries use a separately signed app
 * gateway; visitor cookies are never forwarded and raw visitor IP addresses are
 * never stored. Successful document views are counted after the response with
 * signed, cookieless analytics (analytics.js, docs/SITE_ANALYTICS.md). */
const WORKER_VERSION = "mb4";
const ALLOWED_TYPES = new Set(Object.values(SITE_CONTENT_TYPES));
export const CUSTOM_HOST_CACHE_SECONDS = Object.freeze({ found: 60, missing: 30 });

function configuration(env) {
  const policy = siteNamespacePolicy(env);
  if (!policy) return null;
  const key = env.SUPABASE_PUBLISHABLE_KEY, url = env.SUPABASE_URL;
  if (typeof key !== "string" || !key.startsWith("sb_publishable_")) return null;
  return { key, url, ...policy };
}

function failure(status, secure, head) {
  return new Response(head ? null : siteErrorPage(status), { status, headers: siteErrorHeaders({ secure, status }) });
}

async function boundedJson(response, limit) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("size_limit"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

async function rpc(config, name, args, limit) {
  // The key is deliberately publishable. No admin/service key, cookies or identity are forwarded.
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10_000), redirect: "manual",
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "hosted_site_upstream_error", rpc: name, status: response.status }));
    await response.body?.cancel();
    throw new Error("upstream");
  }
  return boundedJson(response, limit);
}

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const notModified = (request, headers) => {
  // GET/HEAD validators use weak comparison. CDN compression can add W/ to
  // our digest; still require the current authorized resource before this call.
  const condition = request.headers.get("If-None-Match");
  if (!condition || !headers.ETag) return null;
  const matches = condition.trim() === "*" || condition.split(",").some(tag =>
    tag.trim().replace(/^W\//, "") === headers.ETag.replace(/^W\//, ""));
  return matches ? new Response(null, { status: 304, headers }) : null;
};

/** Whether a successful document may be indexed: the namespace allows it and
 * the page is one the site's sitemap lists. "/" is always listed. Sites published
 * before per-route output answer every path with their home snapshot and list
 * only "/", so those copies stay noindex. If the page list can't be read, the
 * page is still served, only without permission to index it. */
function documentIndexable(config, slug, pathname) {
  if (!config.indexable) return Promise.resolve(false);
  if (pathname === "/") return Promise.resolve(true);
  return rpc(config, "makeborne_read_site_paths", { p_slug: slug }, 20_000)
    .then(value => sitePaths(value)?.paths.includes(pathname) ?? false)
    .catch(error => {
      console.error(JSON.stringify({ event: "site_index_paths_error", type: error instanceof Error ? error.message.slice(0, 40) : "unknown" }));
      return false;
    });
}

async function serveDocument(request, config, slug, pathname, secure) {
  // Read in parallel with the document so nested pages add no round trip.
  const indexable = documentIndexable(config, slug, pathname);
  const site = await rpc(config, "makeborne_read_hosted_site_v3", { p_slug: slug, p_path: pathname }, 24_000_100);
  if (site === null) return failure(404, secure, request.method === "HEAD");
  if (typeof site !== "object" || typeof site.html !== "string" || typeof site.interactive !== "boolean" || !Number.isInteger(site.revision)
    || (site.script !== null && (typeof site.script !== "string" || !siteScriptPath(site.script)))
    || (site.branding !== undefined && typeof site.branding !== "boolean")
    || new TextEncoder().encode(site.html).byteLength > SITE_LIMITS.html) throw new Error("invalid_site");
  const interactive = site.interactive && site.script !== null;
  // The owner can remove the badge in Settings; older readers omit the flag, so it stays on.
  const branding = site.branding !== false;
  const headers = siteDocumentHeaders({ interactive, secure, indexable: await indexable, etag:`"${WORKER_VERSION}-${site.revision}-${interactive ? 1 : 0}${branding ? "" : "-u"}"` });
  const cached = notModified(request, headers);
  if (cached) return cached;
  const html = composeSiteDocument(site.html, { script: site.script, interactive, branding });
  return new Response(request.method === "HEAD" ? null : html, { headers });
}

/** Custom hostname → slug, cached at the edge under a synthetic internal key on
 * the sites apex (which only ever redirects, so no visitor URL can address or
 * collide with it). Positive answers live 60 s, negative 30 s; upstream errors
 * are never cached. */
function customHostCacheKey(config, host) {
  return new Request(`https://${config.domain}/_mb/custom-host?__mb_namespace=${config.namespace}-v1&host=${encodeURIComponent(host)}`, { method: "GET" });
}
const acceptedSlug = (config, value) => typeof value === "string" && validSiteLabel(value)
  && !(config.namespace === "production" && STAGING_SITE_LABELS.includes(value));

async function resolveCustomHost(context, config, host) {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const key = customHostCacheKey(config, host);
  const hit = cache ? await cache.match(key) : null;
  if (hit) {
    try {
      const entry = await boundedJson(hit, 512);
      if (entry && typeof entry === "object" && entry.host === host && (entry.slug === null || acceptedSlug(config, entry.slug))) return entry.slug;
    } catch { /* A malformed entry is a miss. */ }
  }
  const value = await rpc(config, "makeborne_resolve_site_host", { p_host: host }, 512);
  if (value !== null && typeof value !== "string") throw new Error("invalid_host_resolution");
  // An unexpected slug shape is refused like an unknown host, not served.
  const slug = value !== null && acceptedSlug(config, value) ? value : null;
  if (value !== null && slug === null) console.error(JSON.stringify({ event: "custom_host_slug_refused" }));
  if (cache && context?.waitUntil) {
    const seconds = slug ? CUSTOM_HOST_CACHE_SECONDS.found : CUSTOM_HOST_CACHE_SECONDS.missing;
    context.waitUntil(cache.put(key, new Response(JSON.stringify({ host, slug }), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}` },
    })));
  }
  return slug;
}

/** A customer's hostname may be their registrable apex. Never extend HSTS to
 * the customer's other subdomains; otherwise the response is unchanged. */
function forCustomHost(response) {
  const hsts = response.headers.get("Strict-Transport-Security");
  if (!hsts || !/includeSubDomains/i.test(hsts)) return response;
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function serveFile(request, context, config, slug, url, secure, custom = false) {
  // Always consult the existing authoritative file read before the edge cache.
  // It checks live state, hosting access, current manifest and JavaScript consent.
  // A cache hit must never bypass Take offline or serve a retired script. Reusing
  // this RPC avoids a second query or a weaker, separately maintained ACL.
  const file = await rpc(config, "makeborne_read_hosted_site_file", { p_slug: slug, p_path: url.pathname }, 3_000_000);
  if (file === null) return failure(404, secure, request.method === "HEAD");
  if (typeof file !== "object" || !ALLOWED_TYPES.has(file.content_type) || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
    || typeof file.body !== "string" || file.body.length > Math.ceil(SITE_LIMITS.image * 4 / 3) + 4) throw new Error("invalid_file");
  // Legacy publishers normalized all raster bytes to WebP while retaining paths.
  if (file.content_type !== siteFileContentType(url.pathname)
    && !(file.content_type === SITE_CONTENT_TYPES.image && /\.(?:png|jpe?g)$/i.test(url.pathname))) throw new Error("invalid_file_type");
  const headers = siteFileHeaders({ pathname: url.pathname, contentType: file.content_type, secure, etag: `"${file.sha256}"` });
  const cache = immutableSiteFile(url.pathname) && typeof caches !== "undefined" ? caches.default : null;
  // v2 ignores all old path-only entries; digest, namespace and site identity
  // partition byte caches even if a publisher reuses a supposedly hashed path.
  const key = new Request(`${url.origin}${url.pathname}?__mb_namespace=${config.namespace}-v2&__mb_site=${slug}&sha=${file.sha256}${custom ? "&custom=1" : ""}`, { method: "GET" });
  const hit = cache ? await cache.match(key) : null;
  if (hit && hit.headers.get("ETag") === headers.ETag && hit.headers.get("Content-Type") === file.content_type) {
    const conditional = notModified(request, headers);
    if (conditional) { await hit.body?.cancel(); return conditional; }
    if (request.method === "HEAD") { await hit.body?.cancel(); return new Response(null, { headers }); }
    return new Response(hit.body, { headers });
  }
  await hit?.body?.cancel();
  const bytes = decodeBase64(file.body);
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256) throw new Error("digest_mismatch");
  const cached = notModified(request, headers);
  if (cached) return cached;
  const response = new Response(bytes, { headers });
  if (cache && context?.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return request.method === "HEAD" ? new Response(null, { headers }) : response;
}

async function serveCustomHost(request, env, context, config, url, host, secure, head) {
  let slug;
  try {
    slug = await resolveCustomHost(context, config, host);
  } catch (error) {
    console.error(JSON.stringify({ event: "custom_host_resolve_error", type: error instanceof Error ? error.message.slice(0, 40) : "unknown" }));
    return failure(503, secure, head);
  }
  if (!slug) return failure(404, secure, head);
  return serveSite(request, env, context, config, url, slug, secure, head, true);
}

async function serveSite(request, env, context, config, url, slug, secure, head, custom = false) {
  if (url.pathname === "/_mb/enquiries") return submitEnquiry(request, env, config, slug);
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...siteErrorHeaders({ secure, status: 405 }), "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" } });
  if (url.pathname.length > 240) return failure(404, secure, head);
  if (url.pathname === "/robots.txt") {
    // A custom host serves copies whose canonical is the Makeborne address, so it names no sitemap.
    return new Response(head ? null : robotsDocument(url.origin, config.indexable, !custom), { headers: { ...siteErrorHeaders({ secure, status: 200 }), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  }
  // Pages of the live site for search engines; not offered where indexing is off (staging, local),
  // nor on a custom host: its pages name the Makeborne address as canonical, and a sitemap lists canonical URLs only.
  if (url.pathname === "/sitemap.xml") {
    if (!config.indexable || custom) return failure(404, secure, head);
    try {
      const site = sitePaths(await rpc(config, "makeborne_read_site_paths", { p_slug: slug }, 20_000));
      if (!site) return failure(404, secure, head);
      return new Response(head ? null : sitemapDocument(url.origin, site.paths, site.updated), { headers: { ...siteErrorHeaders({ secure, status: 200 }), "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    } catch (error) {
      console.error(JSON.stringify({ event: "sitemap_read_error", type: error instanceof Error ? error.message.slice(0, 40) : "unknown" }));
      return failure(503, secure, head);
    }
  }
  try {
    if (siteFilePath(url.pathname)) return await serveFile(request, context, config, slug, url, secure, custom);
    if (siteDocumentPath(url.pathname)) {
      const response = await serveDocument(request, config, slug, url.pathname, secure);
      // Counted after the response (waitUntil); a failure there never changes it.
      scheduleSiteView(request, response, env, context, config, slug, url);
      return response;
    }
    return failure(404, secure, head);
  } catch (error) {
    console.error(JSON.stringify({ event: "hosted_site_read_error", type: error instanceof Error ? error.message.slice(0, 40) : "unknown" }));
    return failure(503, secure, head);
  }
}

const customerSites = {
  async fetch(request, env, context) {
    // Authority is the URL the runtime routed; Host/Forwarded headers are never read.
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const head = request.method === "HEAD";
    const config = configuration(env);
    if (!config) return failure(503, secure, head);
    const address = classifySiteNamespaceRequest(url, config);
    if (!address) return failure(404, secure, head);
    if (!secure && !config.local) {
      return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 308);
    }
    // A custom hostname resolves to a slug, then follows the exact site path below.
    if (address.kind === "custom") return forCustomHost(await serveCustomHost(request, env, context, config, url, address.host, secure, head));
    if (address.kind === "site") return serveSite(request, env, context, config, url, address.slug, secure, head);
    if (url.pathname === "/_mb/enquiries") return failure(404, secure, head);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...siteErrorHeaders({ secure, status: 405 }), "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" } });
    // Legacy path-based addresses move to the site's own origin.
    if (address.kind === "legacy") {
      const slug = address.slug;
      if (!slug) return Response.redirect(config.appOrigin, 302);
      return Response.redirect(`${siteOrigin(slug, config.domain, secure)}${url.port ? `:${url.port}` : ""}/`, 301);
    }
    if (address.kind === "apex") return Response.redirect(`${config.appOrigin}/`, 308);
    return failure(404, secure, head);
  },
};

export default customerSites;
