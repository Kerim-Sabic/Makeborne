import { CUSTOMER_SITE_CSP } from "./website-policy.js";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": CUSTOMER_SITE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
const reserved = new Set(["admin", "api", "auth", "billing", "login", "studio", "support", "www", "makeborne", "robots-txt", "sitemap-xml"]);
function unavailable(status = 503) {
  return new Response(status === 404 ? "This website is not published." : "This website is temporarily unavailable.", {
    status, headers: { ...headers, "X-Robots-Tag": "noindex", ...(status === 503 ? {"Retry-After":"60"} : {}) },
  });
}
async function boundedJson(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      // JSON escaping may expand the bounded four-megabyte HTML snapshot.
      if (bytes > 24_000_100) { await reader.cancel(); throw new Error("size_limit"); }
      text += decoder.decode(chunk.value, {stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
const customerSites = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", {status:405,headers:{...headers,Allow:"GET, HEAD"}});
    if (url.pathname === "/") return Response.redirect("https://makeborne.com",302);
    if (url.pathname === "/robots.txt") return new Response(request.method === "HEAD" ? null : "User-agent: *\nAllow: /\n", {headers:{"Content-Type":"text/plain","Cache-Control":"public,max-age=3600"}});
    const slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug) || reserved.has(slug)) return unavailable(404);
    // This key is deliberately publishable. No admin/service key, cookies or identity are forwarded.
    const publicKey = env.SUPABASE_PUBLISHABLE_KEY;
    if (typeof publicKey !== "string" || !publicKey.startsWith("sb_publishable_")) return unavailable();
    try {
      const response = await fetch("https://rklojnmmsmhwnkbzuidp.supabase.co/rest/v1/rpc/makeborne_read_hosted_site", {
        method:"POST", headers:{apikey:publicKey,"Content-Type":"application/json"},
        body:JSON.stringify({p_slug:slug}), signal:AbortSignal.timeout(10_000), redirect:"manual",
      });
      if (!response.ok) { console.error(JSON.stringify({event:"hosted_site_upstream_error",status:response.status})); await response.body?.cancel(); return unavailable(); }
      const html = await boundedJson(response);
      if (html === null) return unavailable(404);
      if (typeof html !== "string" || !html.startsWith("<!doctype html>") || new TextEncoder().encode(html).byteLength > 4_000_000) return unavailable();
      return new Response(request.method === "HEAD" ? null : html,{headers});
    } catch (error) { console.error(JSON.stringify({event:"hosted_site_read_error",type:error instanceof Error ? error.name : "unknown"})); return unavailable(); }
  },
};

export default customerSites;
