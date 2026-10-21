/** Route state of the editor's live website preview, kept as separate parts:
 * page path, query and fragment target come from the sandboxed frame's own
 * hash (the builder's hash-route convention, "#/menu"); title, scroll and
 * focus are reported by the preview runtime. Only fragment changes are
 * possible in a srcdoc document, so nothing here can change its origin. */

export type PreviewPage = { path: string; query: string; target: string };
export type PreviewRoute = { path: string; title?: string };
export type PreviewStart = { hash: string; target: string; y: number };

/** Outer editor URL parameter that mirrors the preview page. */
export const PREVIEW_PATH_PARAM = "preview-path";
/** Marks editor history entries written by the preview, so the studio can tell
 * a preview page step from a change of project or tab. */
export const PREVIEW_HISTORY_KEY = "makebornePreview";
const MAX_PATH = 300;
const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]*$/;
const TARGET = /^[^\s"'<>`]{1,200}$/;

const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return null; } };
export const HOME: PreviewPage = { path: "/", query: "", target: "" };

/** "/menu/" and "/menu" are the same page; "/" stays "/". */
export function normalizePath(path: string) {
  const trimmed = path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Owner-typed or URL-restored "/path?query#target". Invalid input gives null;
 * it is never interpreted as a request to create a page. */
export function parsePreviewPath(value: string | null | undefined): PreviewPage | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_PATH || !text.startsWith("/") || text.startsWith("//")) return null;
  const hashAt = text.indexOf("#");
  const beforeHash = hashAt < 0 ? text : text.slice(0, hashAt);
  const rawTarget = hashAt < 0 ? "" : text.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const rawPath = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? "" : beforeHash.slice(queryAt);
  if (!rawPath.split("/").every(part => SEGMENT.test(part)) || decode(rawPath) === null) return null;
  if (/[\s<>"`]/.test(query)) return null;
  const target = rawTarget ? decode(rawTarget) : "";
  if (target === null || (target && !TARGET.test(target))) return null;
  return { path: normalizePath(rawPath), query: query === "?" ? "" : query, target };
}

export function formatPreviewPath(page: PreviewPage) {
  return `${page.path}${page.query}${page.target ? `#${encodeURIComponent(page.target)}` : ""}`;
}

/** What the frame's location.hash says. "#/menu?x=1" is a page; "#ash" is a
 * section target on the page already shown (path unchanged). */
export function parseFrameHash(hash: string, previousPath = "/"): PreviewPage {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw === "/") return { ...HOME };
  if (!raw.startsWith("/")) {
    const target = decode(raw);
    return { path: previousPath, query: "", target: target && TARGET.test(target) ? target : "" };
  }
  const page = parsePreviewPath(raw);
  return page ?? { path: normalizePath(raw.split(/[?#]/)[0] || "/"), query: "", target: "" };
}

/** The frame hash that shows a page. Home is "#/" so a hash router leaves any
 * other page; a target on a single-page site is a native "#section". */
export function frameHashFor(page: PreviewPage, routes: readonly PreviewRoute[]) {
  if (page.path === "/") return page.target && routes.length <= 1 ? `#${encodeURIComponent(page.target)}` : "#/";
  return `#${page.path}${page.query}`;
}

export function samePage(left: PreviewPage, right: PreviewPage) {
  return left.path === right.path && left.query === right.query && left.target === right.target;
}

/** A page is missing only when the saved routes are known and none matches. */
export function isMissingPage(page: PreviewPage, routes: readonly PreviewRoute[]) {
  return routes.length > 0 && !routes.some(route => normalizePath(route.path) === page.path);
}

/** The preview's page title, kept apart from the editor's own title. A missing
 * page never inherits the home page's title. */
export function previewPageTitle(page: PreviewPage, routes: readonly PreviewRoute[], frameTitle: string) {
  if (isMissingPage(page, routes)) return "Page not found";
  const declared = routes.find(route => normalizePath(route.path) === page.path)?.title;
  return frameTitle.trim() || declared || (page.path === "/" ? "Home" : page.path);
}

/** Set or clear the preview page on the editor URL without touching any other parameter. */
export function withPreviewPathParam(href: string, page: PreviewPage | null) {
  const url = new URL(href);
  if (!page || samePage(page, HOME)) url.searchParams.delete(PREVIEW_PATH_PARAM);
  else url.searchParams.set(PREVIEW_PATH_PARAM, formatPreviewPath(page));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Start state embedded in a preview document, safe inside an inline script. */
export function previewStartScript(start: PreviewStart | null) {
  return JSON.stringify(start).replace(/</g, "\\u003c");
}

/** Marker in the preview runtime that the host replaces with the start state. */
export const PREVIEW_START_MARKER = "/*mb-start*/null";

/** Editor previews never send: no network requests from site code, no form
 * submissions. Images, fonts and the inlined bundle are unaffected. */
export const PREVIEW_DOCUMENT_CSP = "connect-src 'none'; form-action 'none'";

/** Embed the start state and the no-send policy into a preview bundle. */
export function preparePreviewDocument(html: string, start: PreviewStart | null) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_DOCUMENT_CSP}">`;
  const withPolicy = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${meta}`) : `${meta}${html}`;
  return withPolicy.replace(PREVIEW_START_MARKER, () => previewStartScript(start));
}
