/**
 * Error text and routes are pattern-scrubbed before they leave the browser or reach the
 * database: emails, UUIDs, long token-like strings, numbers of four or more digits and URL
 * query strings are replaced. This is a best-effort filter, not a guarantee: a name, a short
 * secret or other personal text that matches none of the patterns is kept. Grouping uses the
 * scrubbed text, so "Order 4512 failed" and "Order 9921 failed" are one kind of error.
 * The privacy notice (src/app/privacy/page.tsx) describes these fields. Client-safe.
 */

export type TelemetryPage = "home" | "pricing" | "login" | "studio" | "portal" | "help";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
const NUMBER = /\b\d{4,}\b/g;
const URL_QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s]*/g;

/** The message with the patterns above replaced, whitespace collapsed, at most 300 characters. */
export function scrubMessage(value: unknown) {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  return text.replace(URL_QUERY, "$1").replace(EMAIL, "<email>").replace(UUID, "<id>").replace(TOKEN, "<token>").replace(NUMBER, "<n>")
    .replace(/\s+/g, " ").trim().slice(0, 300);
}

/** "/studio/9f1c…/edit?x=1" → "/studio/[id]/edit". */
export function routePattern(path: string) {
  const pathname = path.split(/[?#]/)[0] || "/";
  return pathname.split("/").map(part => IS_UUID.test(part) ? "[id]" : /^\d+$/.test(part) ? "[n]" : part.length >= 24 && /^[A-Za-z0-9_-]+$/.test(part) ? "[token]" : part)
    .join("/").slice(0, 200) || "/";
}

/** Error class name, e.g. "TypeError"; "Error" when unknown. */
export function errorKind(value: unknown) {
  const name = value instanceof Error ? value.name : typeof value === "object" && value && "name" in value ? String((value as { name: unknown }).name) : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name) ? name : "Error";
}

/** The text a fingerprint is computed from (digits removed so counters don't split groups). */
export const fingerprintSource = (source: "server" | "client", kind: string, message: string, route: string) =>
  `${source}|${kind}|${message.replace(/\d+/g, "#")}|${route}`;

/** Which allow-listed page a path is (null: not counted). */
export function telemetryPage(path: string): TelemetryPage | null {
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/") return "home";
  if (pathname === "/billing") return "pricing";
  if (pathname === "/login") return "login";
  if (pathname === "/studio" || pathname.startsWith("/studio/")) return "studio";
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "portal";
  if (pathname === "/help" || pathname.startsWith("/help/")) return "help";
  return null;
}

/** Browser noise that is not Makeborne's bug (extensions, benign layout warnings, aborted fetches). */
export const IGNORED_CLIENT_ERROR = /ResizeObserver loop|Non-Error promise rejection captured|chrome-extension:|moz-extension:|safari-extension:|AbortError|The user aborted a request|Load failed$|NetworkError when attempting to fetch/i;
