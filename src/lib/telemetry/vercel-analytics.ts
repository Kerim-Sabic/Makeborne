import type { BeforeSendEvent } from "@vercel/analytics/next";

type PrivacyPreferences = { doNotTrack?: string | null; globalPrivacyControl?: boolean };
const pages = new Set(["/", "/billing", "/login", "/signup", "/studio", "/chat", "/templates", "/done-for-you", "/terms", "/privacy", "/dpa", "/imprint", "/refunds", "/withdraw"]);

export function analyticsPathAllowed(path: string): boolean {
  return pages.has(path) || /^\/help(?:\/[a-z0-9-]+)*\/?$/.test(path);
}
export function analyticsPrivacyAllowed(preferences: PrivacyPreferences): boolean {
  return preferences.doNotTrack !== "1" && preferences.globalPrivacyControl !== true;
}
/** Never send project/account query strings, private share URLs, or custom event data. */
export function sanitizeAnalyticsEvent(event: BeforeSendEvent, preferences: PrivacyPreferences): BeforeSendEvent | null {
  if (!analyticsPrivacyAllowed(preferences) || event.type !== "pageview") return null;
  try {
    const url = new URL(event.url);
    if (url.protocol !== "https:" || !["makeborne.com", "www.makeborne.com"].includes(url.hostname) || !analyticsPathAllowed(url.pathname) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return { type: "pageview", url: url.toString() };
  } catch { return null; }
}
