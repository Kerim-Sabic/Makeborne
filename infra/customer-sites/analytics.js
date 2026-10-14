/** Privacy-friendly visitor analytics for published customer websites.
 *
 * After the Worker has served a successful (200) GET document, it records one
 * view through `makeborne_record_site_view` in `context.waitUntil`, so serving is
 * never slowed or changed. No cookie, script or storage is added to the site.
 * The visitor is a SHA-256 over the UTC day, slug, connecting IP, User-Agent and
 * the signing secret: it rotates daily, and neither the IP nor the User-Agent
 * ever leaves the Worker. Every call is signed with HMAC-SHA256 over the exact
 * string in supabase/migrations/20261014170000_site_analytics.sql. Failures are
 * logged as a JSON event without personal data. See docs/SITE_ANALYTICS.md. */
import { RESERVED_CUSTOM_HOST_SUFFIXES } from "./namespace-policy.js";

export const ANALYTICS_RPC = "makeborne_record_site_view";
export const ANALYTICS_PATH_LIMIT = 200;
const SECRET_MINIMUM = 32;

/** User agents that are not people reading the page: search and AI crawlers,
 * link-preview fetchers (chat apps, social networks), uptime monitors, performance
 * auditors, headless browsers and HTTP libraries. Matched case-insensitively
 * anywhere in the User-Agent. An absent or empty User-Agent is also skipped. */
export const ANALYTICS_BOT_PATTERN = new RegExp([
  // Generic crawler words (Googlebot, bingbot, YandexBot, Applebot, GPTBot, ClaudeBot, AhrefsBot, …).
  // ("Cubot" is a phone brand, so it is excluded.)
  "(?<!cu)bot\\b", "bot/", "crawl", "spider", "slurp", "scrap", "archiver", "indexer",
  // Link previews and embeds. In-app browsers (Facebook, LinkedIn, Pinterest, …) are
  // people and use their own tokens, so only the preview fetchers are listed.
  "preview", "facebookexternalhit", "facebookcatalog", "meta-externalagent", "embedly", "whatsapp/", "slack-imgproxy",
  "skypeuri", "vkshare", "quora link", "outbrain", "iframely", "mastodon/",
  // AI and data collection agents without "bot" in the name.
  "chatgpt", "claude-", "anthropic", "perplexity", "ccbot", "bytespider", "cohere-ai", "google-extended", "googleother",
  "google-inspectiontool", "apis-google", "mediapartners-google", "feedfetcher", "diffbot",
  // Monitors, auditors and test browsers.
  "monitor", "uptime", "pingdom", "statuscake", "site24x7", "newrelic", "datadog", "checkly", "better ?stack", "freshping",
  "lighthouse", "pagespeed", "gtmetrix", "webpagetest", "headless", "phantomjs", "selenium", "puppeteer", "playwright",
  "cypress", "validator", "w3c_", "cloudflare-", "nessus", "nmap", "nikto", "zgrab", "masscan", "censys", "expanse",
  // HTTP libraries and command-line tools.
  "curl/", "wget", "httpie", "python-", "python/", "aiohttp", "httpx", "go-http-client", "java/", "okhttp", "apache-httpclient",
  "axios", "node-fetch", "undici", "got \\(", "libwww", "lwp-", "http_request", "guzzle", "ruby", "php/", "dart:io", "postman",
  "insomnia", "rest-client", "winhttp", "powershell", "fetch/",
].join("|"), "i");

const PREFETCH_PATTERN = /prefetch|prerender|preview/i;
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const TABLET_PATTERN = /ipad|tablet|playbook|silk\/|kindle|nexus (?:7|9|10)|sm-t\d|android(?!.*mobile)/i;
const MOBILE_PATTERN = /mobi|iphone|ipod|android|windows phone|iemobile|opera mini|blackberry|bb10|webos/i;

/** Lowercase hex encoding of a digest or signature. */
const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
const encoder = new TextEncoder();

export function analyticsSecret(env) {
  const secret = env?.ANALYTICS_SIGNING_SECRET;
  return typeof secret === "string" && secret.length >= SECRET_MINIMUM ? secret : null;
}

/** "desktop" | "mobile" | "tablet" from the User-Agent (and the mobile client hint). */
export function deviceFromUserAgent(userAgent, mobileHint = null) {
  const agent = typeof userAgent === "string" ? userAgent : "";
  if (TABLET_PATTERN.test(agent)) return "tablet";
  if (MOBILE_PATTERN.test(agent) || mobileHint === "?1") return "mobile";
  return "desktop";
}

export function isBotUserAgent(userAgent) {
  return typeof userAgent !== "string" || userAgent.trim() === "" || ANALYTICS_BOT_PATTERN.test(userAgent);
}

/** Prefetches, prerenders and previews are not views, and neither are non-document
 * fetches of a page (a site's own script fetching "/", for example). */
export function isSpeculativeRequest(request) {
  const headers = request.headers;
  for (const name of ["Sec-Purpose", "Purpose", "X-Purpose", "X-Moz"]) {
    const value = headers.get(name);
    if (value && PREFETCH_PATTERN.test(value)) return true;
  }
  const destination = headers.get("Sec-Fetch-Dest");
  return destination !== null && destination !== "document";
}

/** Makeborne's own hosts never count as referrers. */
function makeborneHost(host, config) {
  return [...RESERVED_CUSTOM_HOST_SUFFIXES, config.domain].some(suffix => host === suffix || host.endsWith("." + suffix));
}

/** The external referring hostname, or "" (direct, same host, Makeborne, invalid). */
export function referrerHost(request, url, config) {
  const value = request.headers.get("Referer");
  if (!value) return "";
  let referrer;
  try { referrer = new URL(value); } catch { return ""; }
  if (!["http:", "https:"].includes(referrer.protocol)) return "";
  const host = referrer.hostname.toLowerCase();
  if (!host || host === url.hostname.toLowerCase() || makeborneHost(host, config)) return "";
  return host.length <= 200 && HOSTNAME_PATTERN.test(host) ? host : "";
}

/** Two-letter ISO country from Cloudflare, or "" (unknown, Tor "T1", "XX"). */
export function countryCode(request) {
  const country = request.cf?.country;
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

/** The exact signed string (see the migration): stamp "." slug|path|referrer|country|device|visitor. */
export function siteViewMessage(view) {
  return `${view.p_stamp}.${view.p_slug}|${view.p_path}|${view.p_referrer}|${view.p_country}|${view.p_device}|${view.p_visitor}`;
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Whether this served response should be counted. Pure; reads only headers and bindings. */
export function shouldRecordSiteView(request, response, env, config, url) {
  if (!analyticsSecret(env)) return false;
  if (config.local && env.ANALYTICS_LOCAL !== "true") return false;
  // 304 is a returning visitor whose browser revalidated a cached page: a real view.
  if (request.method !== "GET" || (response.status !== 200 && response.status !== 304)) return false;
  if (url.pathname.startsWith("/_mb/") || url.pathname === "/robots.txt") return false;
  if (isSpeculativeRequest(request)) return false;
  return !isBotUserAgent(request.headers.get("User-Agent"));
}

/** Builds the signed RPC arguments. The raw IP and User-Agent are only hashed here. */
export async function siteViewPayload(request, env, config, slug, url, now = Date.now()) {
  const secret = analyticsSecret(env);
  const ip = request.headers.get("CF-Connecting-IP") ?? (config.local ? "local" : null);
  if (!secret || !ip) return null;
  const userAgent = request.headers.get("User-Agent") ?? "";
  const day = new Date(now).toISOString().slice(0, 10);
  const view = {
    p_slug: slug,
    p_path: url.pathname.slice(0, ANALYTICS_PATH_LIMIT),
    p_referrer: referrerHost(request, url, config),
    p_country: countryCode(request),
    p_device: deviceFromUserAgent(userAgent, request.headers.get("Sec-CH-UA-Mobile")),
    p_visitor: hex(await crypto.subtle.digest("SHA-256", encoder.encode(`${day}|${slug}|${ip}|${userAgent}|${secret}`))),
    p_stamp: now,
  };
  view.p_signature = await hmacHex(secret, siteViewMessage(view));
  return view;
}

function logFailure(details) {
  console.error(JSON.stringify({ event: "site_view_record_error", ...details }));
}

/** Records one view. Never throws; failures are logged without personal data. */
export async function recordSiteView(request, env, config, slug, url) {
  try {
    const view = await siteViewPayload(request, env, config, slug, url);
    if (!view) return;
    // Publishable key only; no cookies, identity or visitor headers are forwarded.
    const response = await fetch(`${config.url}/rest/v1/rpc/${ANALYTICS_RPC}`, {
      method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" },
      body: JSON.stringify(view), signal: AbortSignal.timeout(5_000), redirect: "manual",
    });
    const text = (await response.text()).slice(0, 2_000);
    if (!response.ok) {
      // PostgREST returns the SQLSTATE: MB401 signature, MB408 stamp, MB404 offline, 22023 input, MB503 unconfigured.
      let code = null;
      try { const body = JSON.parse(text); if (typeof body?.code === "string" && /^[0-9A-Z]{5}$/.test(body.code)) code = body.code; } catch { /* not JSON */ }
      logFailure({ status: response.status, code });
    }
  } catch (error) {
    logFailure({ type: error instanceof Error ? error.name.slice(0, 40) : "unknown" });
  }
}

/** Schedules recordSiteView after the response when it qualifies. Never throws. */
export function scheduleSiteView(request, response, env, context, config, slug, url) {
  try {
    if (typeof context?.waitUntil !== "function" || !shouldRecordSiteView(request, response, env, config, url)) return false;
    context.waitUntil(recordSiteView(request, env, config, slug, url));
    return true;
  } catch (error) {
    logFailure({ type: error instanceof Error ? error.name.slice(0, 40) : "unknown" });
    return false;
  }
}
