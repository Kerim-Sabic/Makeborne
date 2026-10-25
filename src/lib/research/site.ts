import { fetchPublic } from "../brand/server";
import { pinnedFetcher, platformOf, publicTarget, type Fetcher, type Lookup } from "../mail/research";
import { pagesToRead } from "../leads/redesign";
import { EXTRACTOR_VERSION, INACCESSIBLE_LABEL, type InaccessibleReason, type NotReadReason } from "./contract";
import { FAILURE_TTL_MS, PAGE_TTL_MS, ROBOTS_TTL_MS, usable, type CacheEntry, type ResearchCache } from "./cache";
import { extractPage, parseRobots, robotsAllows, sha256Hex, type PageData, type RobotsRules } from "./page";

/**
 * Reads the client's own public site and the competitor pages the person
 * supplied, under the EXISTING guard rails and within one request's budget:
 * - every fetch goes through fetchPublic (brand/server.ts): publicTarget on the
 *   URL and on every redirect (public addresses only, pinned DNS, standard
 *   ports, no credentials, at most 3 redirects), the pinned fetcher with a
 *   per-page byte cap (bodies at the cap are refused as too large) and its own
 *   6 s timeout. Nothing here opens a socket itself.
 * - per request: at most `maxPages` pages (home + same-site pages + supplied
 *   competitors), `maxBytes` read in total and `timeMs` elapsed; anything left
 *   is reported as not read, with the limit that stopped it.
 * - robots.txt is honoured for our reader or "*" (a disallowed page is not read).
 * - social networks are not read (their profiles need a sign-in to see fully),
 *   so nothing about followers or private profiles can come from them.
 * - copies are reused from the tenant's cache while valid; an expired copy is
 *   refetched, and if that fails the old copy is used and labelled stale.
 */
export type ResearchLimits = Readonly<{ maxPages: number; maxBytes: number; maxPageBytes: number; timeMs: number }>;
export const DEFAULT_LIMITS: ResearchLimits = Object.freeze({ maxPages: 6, maxBytes: 2_400_000, maxPageBytes: 600_000, timeMs: 25_000 });
export const HARD_LIMITS: ResearchLimits = Object.freeze({ maxPages: 10, maxBytes: 4_000_000, maxPageBytes: 600_000, timeMs: 45_000 });
export function boundedLimits(limits: Partial<ResearchLimits> = {}): ResearchLimits {
  const pick = (key: keyof ResearchLimits) => Math.max(1, Math.min(HARD_LIMITS[key], Math.floor(limits[key] ?? DEFAULT_LIMITS[key])));
  return Object.freeze({ maxPages: pick("maxPages"), maxBytes: pick("maxBytes"), maxPageBytes: pick("maxPageBytes"), timeMs: pick("timeMs") });
}

export type SitePage = Readonly<{
  url: string; finalUrl: string; role: "home" | "page" | "competitor"; fetchedAt: string; sha256: string; bytes: number;
  page: PageData; stale: boolean; fromCache: boolean; refreshFailed?: InaccessibleReason;
}>;
export type Inaccessible = { target: string; reason: InaccessibleReason; detail: string };
export type SiteRead = {
  pages: SitePage[]; inaccessible: Inaccessible[]; notRead: { url: string; reason: NotReadReason }[];
  pagesRead: number; bytesRead: number; elapsedMs: number; fetches: number;
};
export type FetchDeps = { fetcher?: Fetcher; resolve?: Lookup };

/** https:// is assumed when no scheme is given; fragments are dropped. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  url.hash = "";
  return url.href;
}
export const siteHost = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** A guard-rail failure in plain words (the raw message never reaches the customer). */
export function classifyFailure(error: unknown): InaccessibleReason {
  const message = error instanceof Error ? `${error.name} ${error.message} ${(error as { cause?: { code?: string } }).cause?.code ?? ""}` : String(error);
  if (/Private addresses/i.test(message)) return "private";
  if (/Not a valid link|Only web links|credentials|standard web ports/i.test(message)) return "invalid";
  if (/Too many redirects/i.test(message)) return "redirects";
  if (/answered (401|407)\b/.test(message)) return "login";
  if (/answered (403|429|451)\b/.test(message)) return "blocked";
  if (/answered (404|410)\b/.test(message) || /ENOTFOUND|EAI_AGAIN/.test(message)) return "not_found";
  if (/Unexpected content type|Not a web page/i.test(message)) return "not_html";
  if (/Too large/i.test(message)) return "too_large";
  if (/TimeoutError|AbortError|timed? ?out|aborted|time limit/i.test(message)) return "timeout";
  return "error";
}

const HTML_ACCEPT = "text/html,application/xhtml+xml";
const HTML_TYPES = /^text\/html$|^application\/xhtml\+xml$/;

export async function readClientSite(input: {
  url: string; competitors: readonly string[]; readSubpages: boolean;
  limits?: Partial<ResearchLimits>; cache: ResearchCache; deps?: FetchDeps; now?: () => number;
}): Promise<SiteRead> {
  const limits = boundedLimits(input.limits);
  const now = input.now ?? Date.now;
  const started = now(), deadline = started + limits.timeMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The research time limit was reached.", "TimeoutError")), limits.timeMs);
  (timer as { unref?: () => void }).unref?.();
  const base = input.deps?.fetcher ?? pinnedFetcher(limits.maxPageBytes);
  // The same pinned fetcher, also stopped by this request's time limit.
  const fetcher: Fetcher = (url, init, addresses) => base(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }, addresses);
  const deps = { fetcher, resolve: input.deps?.resolve };
  const out: SiteRead = { pages: [], inaccessible: [], notRead: [], pagesRead: 0, bytesRead: 0, elapsedMs: 0, fetches: 0 };
  const robots = new Map<string, Promise<RobotsRules>>();
  let considered = 0;

  const deadlineRace = <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
    if (controller.signal.aborted) { reject(controller.signal.reason); return; }
    const onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => { controller.signal.removeEventListener("abort", onAbort); resolve(value); }, error => { controller.signal.removeEventListener("abort", onAbort); reject(error); });
  });
  const fail = (target: string, reason: InaccessibleReason) => { out.inaccessible.push({ target, reason, detail: INACCESSIBLE_LABEL[reason] }); return null; };
  const remember = async (entry: CacheEntry) => { try { await input.cache.put(entry); } catch (error) { if ((error as { code?: string }).code) throw error; } };
  const failure = async (url: string, reason: InaccessibleReason) => {
    const at = now();
    if (reason !== "timeout") await remember({ url, status: "inaccessible", reason, bytes: 0, page: {}, extractorVersion: EXTRACTOR_VERSION, fetchedAt: new Date(at).toISOString(), expiresAt: new Date(at + FAILURE_TTL_MS).toISOString() });
    return fail(url, reason);
  };

  async function rulesFor(origin: string): Promise<RobotsRules> {
    const robotsUrl = `${origin}/robots.txt`;
    const cached = await input.cache.read(robotsUrl).catch(error => { if (error?.code) throw error; return null; });
    if (cached && usable(cached, now()) && cached.status === "ok") return { allow: (cached.page.allow as string[] | undefined) ?? [], disallow: (cached.page.disallow as string[] | undefined) ?? [] };
    try {
      out.fetches++;
      const result = await deadlineRace(fetchPublic(robotsUrl, "text/plain", /^text\/plain$/, deps, 65_536));
      out.bytesRead += result.bytes.length;
      const rules = parseRobots(result.bytes.toString("utf8"));
      const at = now();
      await remember({ url: robotsUrl, finalUrl: result.url.href, status: "ok", sha256: sha256Hex(result.bytes), bytes: result.bytes.length, page: { ...rules },
        extractorVersion: EXTRACTOR_VERSION, fetchedAt: new Date(at).toISOString(), expiresAt: new Date(at + ROBOTS_TTL_MS).toISOString() });
      return rules;
    } catch (error) {
      // No robots.txt (or an unreadable one) means no restriction, as for any crawler.
      const reason = classifyFailure(error);
      if (reason === "not_found" || reason === "not_html" || reason === "too_large") {
        const at = now();
        await remember({ url: robotsUrl, status: "ok", sha256: sha256Hex(""), bytes: 0, page: { allow: [], disallow: [] }, extractorVersion: EXTRACTOR_VERSION,
          fetchedAt: new Date(at).toISOString(), expiresAt: new Date(at + ROBOTS_TTL_MS).toISOString() });
      }
      return { allow: [], disallow: [] };
    }
  }

  async function readOne(raw: string, role: SitePage["role"]): Promise<SitePage | null> {
    let url: string;
    try { url = normalizeUrl(raw); } catch { return fail(raw.slice(0, 300), "invalid"); }
    if (considered >= limits.maxPages) { out.notRead.push({ url, reason: "page_budget" }); return null; }
    if (now() >= deadline - 250 || controller.signal.aborted) { out.notRead.push({ url, reason: "time_budget" }); return null; }
    if (out.bytesRead >= limits.maxBytes - 20_000) { out.notRead.push({ url, reason: "byte_budget" }); return null; }
    considered++;
    // Social networks are not read at all (no lookup, no request).
    if (platformOf(new URL(url)) !== "Website") return failure(url, "login");
    let target;
    try { target = await publicTarget(url, input.deps?.resolve); } catch (error) { return failure(url, classifyFailure(error)); }
    const cached = await input.cache.read(url).catch(error => { if (error?.code) throw error; return null; });
    if (cached && usable(cached, now())) {
      if (cached.status === "inaccessible") return fail(url, cached.reason ?? "error");
      out.pagesRead++;
      const page: SitePage = { url, finalUrl: cached.finalUrl ?? url, role, fetchedAt: cached.fetchedAt, sha256: cached.sha256 ?? "", bytes: cached.bytes, page: cached.page as unknown as PageData, stale: false, fromCache: true };
      out.pages.push(page); return page;
    }
    const staleCopy = cached && cached.status === "ok" && cached.extractorVersion === EXTRACTOR_VERSION ? cached : null;
    const staleOr = (reason: InaccessibleReason): SitePage | null => {
      if (!staleCopy) return null;
      out.pagesRead++;
      const page: SitePage = { url, finalUrl: staleCopy.finalUrl ?? url, role, fetchedAt: staleCopy.fetchedAt, sha256: staleCopy.sha256 ?? "", bytes: staleCopy.bytes, page: staleCopy.page as unknown as PageData, stale: true, fromCache: true, refreshFailed: reason };
      out.pages.push(page); return page;
    };
    try {
      const rules = await (robots.get(target.url.origin) ?? robots.set(target.url.origin, rulesFor(target.url.origin)).get(target.url.origin)!);
      if (!robotsAllows(rules, `${target.url.pathname}${target.url.search}`)) return failure(url, "robots");
      out.fetches++;
      const result = await deadlineRace(fetchPublic(url, HTML_ACCEPT, HTML_TYPES, deps, Math.min(limits.maxPageBytes, limits.maxBytes - out.bytesRead)));
      out.bytesRead += result.bytes.length;
      const page = extractPage(result.bytes.toString("utf8"), result.url, new Date(now()));
      if (page.flags.login) return staleOr("login") ?? failure(url, "login");
      if (page.flags.blocked) return staleOr("blocked") ?? failure(url, "blocked");
      const at = now(), sha256 = sha256Hex(result.bytes);
      await remember({ url, finalUrl: result.url.href, status: "ok", sha256, bytes: result.bytes.length, page: page as unknown as Record<string, unknown>, extractorVersion: EXTRACTOR_VERSION,
        fetchedAt: new Date(at).toISOString(), expiresAt: new Date(at + PAGE_TTL_MS).toISOString() });
      out.pagesRead++;
      const read: SitePage = { url, finalUrl: result.url.href, role, fetchedAt: new Date(at).toISOString(), sha256, bytes: result.bytes.length, page, stale: false, fromCache: false };
      out.pages.push(read); return read;
    } catch (error) {
      if ((error as { code?: string })?.code === "42501" || (error as { code?: string })?.code === "P0002") throw error;
      const reason = classifyFailure(error);
      return staleOr(reason) ?? failure(url, reason);
    }
  }

  try {
    const home = await readOne(input.url, "home");
    if (home && input.readSubpages) {
      const room = Math.max(0, limits.maxPages - 1 - input.competitors.length);
      const wanted = pagesToRead(home.page.nav, 4);
      for (const item of wanted.slice(0, room)) {
        // Only pages of the same site (navigation is already same-host).
        if (siteHost(item.url) !== siteHost(home.finalUrl)) continue;
        await readOne(item.url, "page");
      }
      for (const item of wanted.slice(room)) out.notRead.push({ url: item.url, reason: "page_budget" });
    }
    for (const competitor of input.competitors) await readOne(competitor, "competitor");
  } finally {
    clearTimeout(timer);
    out.elapsedMs = now() - started;
  }
  return out;
}
