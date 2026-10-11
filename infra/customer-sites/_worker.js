import {
  composeSiteDocument, siteDocumentHeaders, siteDocumentPath, siteErrorHeaders, siteErrorPage, siteFileHeaders, siteFilePath,
  siteOrigin, siteSlugFromHost, validSiteLabel, SITE_CONTENT_TYPES, SITE_LIMITS, SITE_SCRIPT_PATH,
} from "./site-policy.js";

/** Cloudflare Worker for published customer websites.
 *
 * `<slug>.<SITES_DOMAIN>` serves one site per origin: its prerendered snapshot
 * plus (when the owner keeps JavaScript on) its same-origin module bundle and
 * project images. The legacy path host (`sites.makeborne.com/<slug>`) redirects
 * there. Only the publishable Supabase key is used, against two read-only RPCs;
 * no visitor cookies, identity or headers are forwarded. */
const WORKER_VERSION = "mb2";
const ALLOWED_TYPES = new Set(Object.values(SITE_CONTENT_TYPES));

function configuration(env) {
  const key = env.SUPABASE_PUBLISHABLE_KEY, url = env.SUPABASE_URL, domain = env.SITES_DOMAIN;
  if (typeof key !== "string" || !key.startsWith("sb_publishable_")) return null;
  const hosted = typeof url === "string" && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url);
  // Local qualification only (wrangler dev against the local Supabase stack).
  const local = env.ALLOW_LOCAL_SUPABASE === "true" && typeof url === "string" && /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(url);
  if (!(hosted || local) || typeof domain !== "string" || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain)) return null;
  const appOrigin = typeof env.APP_ORIGIN === "string" && /^https?:\/\/[a-z0-9.:-]+$/.test(env.APP_ORIGIN) ? env.APP_ORIGIN : "https://makeborne.com";
  const legacyHost = typeof env.LEGACY_SITES_HOST === "string" ? env.LEGACY_SITES_HOST.toLowerCase() : "sites.makeborne.com";
  return { key, url, domain: domain.toLowerCase(), appOrigin, legacyHost };
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
const notModified = (request, headers) => request.headers.get("If-None-Match") === headers.ETag ? new Response(null, { status: 304, headers }) : null;

async function serveDocument(request, config, slug, pathname, secure) {
  const site = await rpc(config, "makeborne_read_hosted_site_v2", { p_slug: slug }, 24_000_100);
  if (site === null) return failure(404, secure, request.method === "HEAD");
  if (typeof site !== "object" || typeof site.html !== "string" || typeof site.interactive !== "boolean" || !Number.isInteger(site.revision)
    || (site.script !== null && (typeof site.script !== "string" || !SITE_SCRIPT_PATH.test(site.script)))
    || new TextEncoder().encode(site.html).byteLength > SITE_LIMITS.html) throw new Error("invalid_site");
  const interactive = site.interactive && site.script !== null;
  const headers = siteDocumentHeaders({ interactive, secure, indexable: pathname === "/", etag: `"${WORKER_VERSION}-${site.revision}-${interactive ? 1 : 0}"` });
  const cached = notModified(request, headers);
  if (cached) return cached;
  const html = composeSiteDocument(site.html, { script: site.script, interactive });
  return new Response(request.method === "HEAD" ? null : html, { headers });
}

async function serveFile(request, context, config, slug, url, secure) {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const key = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const hit = cache ? await cache.match(key) : null;
  if (hit) {
    if (request.headers.get("If-None-Match") === hit.headers.get("ETag")) return new Response(null, { status: 304, headers: hit.headers });
    return request.method === "HEAD" ? new Response(null, { headers: hit.headers }) : hit;
  }
  const file = await rpc(config, "makeborne_read_hosted_site_file", { p_slug: slug, p_path: url.pathname }, 3_000_000);
  if (file === null) return failure(404, secure, request.method === "HEAD");
  if (typeof file !== "object" || !ALLOWED_TYPES.has(file.content_type) || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
    || typeof file.body !== "string" || file.body.length > Math.ceil(SITE_LIMITS.image * 4 / 3) + 4) throw new Error("invalid_file");
  const bytes = decodeBase64(file.body);
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256) throw new Error("digest_mismatch");
  const headers = siteFileHeaders({ pathname: url.pathname, contentType: file.content_type, secure, etag: `"${file.sha256}"` });
  const cached = notModified(request, headers);
  if (cached) return cached;
  const response = new Response(bytes, { headers });
  if (cache && context?.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return request.method === "HEAD" ? new Response(null, { headers }) : response;
}

const customerSites = {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const head = request.method === "HEAD";
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...siteErrorHeaders({ secure, status: 405 }), "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" } });
    const config = configuration(env);
    if (!config) return failure(503, secure, head);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    // Legacy path-based addresses move to the site's own origin.
    if (host === config.legacyHost) {
      const slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (!slug) return Response.redirect(config.appOrigin, 302);
      if (!validSiteLabel(slug)) return failure(404, secure, head);
      return Response.redirect(`${siteOrigin(slug, config.domain, secure)}/`, 301);
    }
    if (host === config.domain || host === `www.${config.domain}`) return Response.redirect(config.appOrigin, 302);
    const slug = siteSlugFromHost(host, config.domain);
    if (!slug || url.pathname.length > 240) return failure(404, secure, head);
    if (url.pathname === "/robots.txt") {
      return new Response(head ? null : "User-agent: *\nAllow: /\n", { headers: { ...siteErrorHeaders({ secure, status: 200 }), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }
    try {
      if (siteFilePath(url.pathname)) return await serveFile(request, context, config, slug, url, secure);
      if (siteDocumentPath(url.pathname)) return await serveDocument(request, config, slug, url.pathname, secure);
      return failure(404, secure, head);
    } catch (error) {
      console.error(JSON.stringify({ event: "hosted_site_read_error", type: error instanceof Error ? error.message.slice(0, 40) : "unknown" }));
      return failure(503, secure, head);
    }
  },
};

export default customerSites;
