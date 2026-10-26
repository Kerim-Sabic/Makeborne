/** Launch waitlist pieces shared by the browser form and the server. No secrets here. */

/** The notice people saw under the form. Change the version whenever the consent line changes. */
export const WAITLIST_CONSENT_VERSION = "waitlist-2026-10-27";
export const WAITLIST_CONSENT_TEXT = "We'll only use your email to send your launch invite and launch news. Unsubscribe any time. See our Privacy Policy.";

const SOURCE_KEYS = ["utm_source", "utm_medium", "utm_campaign", "ref"] as const;
const SOURCE_VALUE = /^[A-Za-z0-9._~-]{1,48}$/;

/** Campaign tags from the page address ("utm_source=instagram;ref=story"), or null. Anything unexpected is dropped. */
export function waitlistSourceFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return null; }
  const parts = SOURCE_KEYS.flatMap(key => {
    const value = params.get(key);
    return value && SOURCE_VALUE.test(value) ? [`${key}=${value}`] : [];
  });
  return parts.length ? parts.join(";") : null;
}

/** Re-validates a source string sent by a browser; the database applies the same shape check. */
export function cleanWaitlistSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const parts = value.split(";");
  const seen = new Set<string>();
  for (const part of parts) {
    const [key, item, extra] = part.split("=");
    if (extra !== undefined || !SOURCE_KEYS.includes(key as typeof SOURCE_KEYS[number]) || seen.has(key) || !SOURCE_VALUE.test(item ?? "")) return null;
    seen.add(key);
  }
  return value || null;
}
