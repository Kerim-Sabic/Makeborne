import { pinnedFetcher, type Fetcher } from "../mail/research";
import { INACCESSIBLE_LABEL, type InaccessibleReason } from "../research/contract";
import type { CachedPage, CacheEntry, ResearchCache } from "../research/cache";
import { normalizeUrl, readClientSite, siteHost, type FetchDeps, type SitePage } from "../research/site";
import { scoreFindings, type CheckFinding, type CheckStrength, type Evidence } from "./score";

/**
 * Website check for a prospect or client: is their current public site
 * holding them back, and how much? No AI and no invented claims:
 * - pages are read with the client-research reader (research/site.ts), so the
 *   existing guard rails apply unchanged: public addresses only (checked again
 *   on every redirect), standard ports, no credentials, robots.txt honoured,
 *   social networks and sign-in pages never read, per-page and per-check byte
 *   and time budgets;
 * - every finding is something measured on a page we actually read, and cites
 *   that page, when it was read, and the exact text or measurement;
 * - a site we could not read gets NO score, only the reason (never a guess);
 * - what this check cannot see is always listed.
 * Speed is one download timed from our server, and is labelled that way.
 */
export const CHECKER_VERSION = "crm-site-check-2026-10-25.1";
export const CHECK_LIMITS = Object.freeze({ maxPages: 4, timeMs: 20_000, maxPageBytes: 600_000, maxBytes: 2_000_000, links: 5, linkBytes: 65_536, linkTimeMs: 8_000 });
const SLOW_MS = 3_000, HEAVY_BYTES = 350_000;

export type CheckedPage = { url: string; role: SitePage["role"]; fetchedAt: string; sha256: string; bytes: number };
export type ContactFact = { kind: "phone" | "email" | "address" | "hours"; value: string; evidence: Evidence };
export type SiteCheck = {
  version: string; input: string; url: string | null; finalUrl: string | null; host: string | null;
  status: "checked" | "inaccessible" | "no_website";
  reason: InaccessibleReason | null; reasonLabel: string | null;
  checkedAt: string;
  score: number | null; band: "strong" | "some" | "low" | "unknown"; summary: string;
  findings: CheckFinding[]; strengths: CheckStrength[];
  contacts: ContactFact[]; platform: string | null;
  pages: CheckedPage[];
  inaccessible: { target: string; reason: InaccessibleReason; detail: string }[];
  links: { checked: number; broken: { url: string; label: string }[]; unchecked: number };
  notChecked: string[];
};

/** Always true of this check, whatever the site. */
export const NOT_CHECKED = [
  "How fast the site feels on a real phone (we time one download from our server)",
  "Google Business Profile, reviews and search ranking",
  "Scripts, images, animations and forms actually sending",
  "Pages behind a sign-in, and pages the site asks automated readers to skip",
];

type Capture = { html: string; ms: number; bytes: number };
export type CheckDeps = FetchDeps & { clock?: () => number };

/** A per-check page cache that lives only for this check (nothing is stored). */
export function memoryCache(): ResearchCache {
  const pages = new Map<string, CacheEntry>();
  return { async read(url: string): Promise<CachedPage | null> { const entry = pages.get(url); return entry ? { ...entry, expired: false } : null; }, async put(entry: CacheEntry) { pages.set(entry.url, entry); } };
}

/** The guarded fetcher, recording the raw bytes and download time of each successful answer. */
function recording(base: Fetcher, captures: Map<string, Capture>, clock: () => number): Fetcher {
  return async (url, init, addresses) => {
    const started = clock();
    const response = await base(url, init, addresses);
    if (response.ok && response.body) {
      const bytes = Buffer.from(await response.clone().arrayBuffer());
      captures.set(url, { html: bytes.toString("utf8"), ms: Math.max(0, Math.round(clock() - started)), bytes: bytes.length });
    }
    return response;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const day = (at: string) => at.slice(0, 10);
const plain = (value: string) => value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

function structuredData(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,60000}?)<\/script>/gi)) {
    const type = /"@type"\s*:\s*(?:\[\s*)?"([^"]{1,60})"/.exec(match[1])?.[1];
    if (type && /Business|Organization|Restaurant|Store|Dentist|Clinic|Salon|Hotel|Cafe|Bakery|Gym|Shop|Agency|Practice|Office|Service|Physician|Attorney|Lodging/i.test(type)) return type;
  }
  return null;
}
const GENERATORS: [RegExp, string][] = [[/wix\.com|wixstatic/i, "Wix"], [/squarespace/i, "Squarespace"], [/wp-content|wordpress/i, "WordPress"], [/godaddy|img1\.wsimg/i, "GoDaddy"], [/weebly/i, "Weebly"], [/shopify/i, "Shopify"], [/jimdo/i, "Jimdo"]];

/** Same-site links on the home page worth a quick "does it answer" check (navigation first). */
export function linksToCheck(home: SitePage, html: string, read: ReadonlySet<string>, limit: number) {
  const host = siteHost(home.finalUrl), out: { url: string; label: string }[] = [];
  const consider = (href: string, label: string) => {
    if (out.length >= limit || !href || href.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(href)) return;
    try {
      const url = new URL(href, home.finalUrl); url.hash = "";
      if (!/^https?:$/.test(url.protocol) || siteHost(url.href) !== host || /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)$/i.test(url.pathname)) return;
      if (url.href === home.finalUrl || read.has(url.href) || out.some(item => item.url === url.href)) return;
      out.push({ url: url.href, label: plain(label).slice(0, 60) || url.pathname });
    } catch { /* not a link */ }
  };
  for (const item of home.page.nav) consider(item.url, item.label);
  for (const match of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']{1,500})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) consider(match[1], match[2].replace(/<[^>]+>/g, " "));
  return out;
}

/** What the reader returned, turned into evidence-backed findings. Pure (exported for tests). */
export function findingsFromPages(input: { home: SitePage; pages: readonly SitePage[]; captures: ReadonlyMap<string, Capture>; broken: { url: string; label: string }[]; now: Date }) {
  const { home } = input, html = input.captures.get(home.finalUrl)?.html ?? "", timing = input.captures.get(home.finalUrl);
  const at = home.fetchedAt, url = home.finalUrl;
  const findings: CheckFinding[] = [], strengths: CheckStrength[] = [];
  const evidence = (extra: { quote?: string; measured?: string }, page: SitePage = home): Evidence => ({ url: page.finalUrl, checkedAt: page.fetchedAt, sha256: page.sha256, ...extra });
  const signal = (label: string) => { const value = new RegExp(`${label}: (yes|no)`).exec(home.page.signals)?.[1]; return value ? `${label}: ${value}` : undefined; };
  const audit = new Map(home.page.audit.map(item => [item.id, item]));
  const add = (id: CheckFinding["id"], title: string, detail: string, proof: Evidence) => findings.push({ id, title, detail, evidence: proof, level: "low", points: 0 });

  if (audit.has("https")) add("https", "Not secure", `The site loaded without https (${url.split("/")[0]}//…), so browsers mark it “Not secure”.`, evidence({ measured: `Final address: ${url}` }));
  else strengths.push({ id: "https", title: "Secure connection (https)", evidence: evidence({ quote: signal("Secure connection") }) });
  if (audit.has("mobile")) add("mobile", "Not built for phones", "The page has no mobile viewport setting, so phones show a shrunken desktop page.", evidence({ quote: signal("Phone layout") }));
  else strengths.push({ id: "mobile", title: "Has a phone layout", evidence: evidence({ quote: signal("Phone layout") }) });
  if (audit.has("cta")) add("cta", "No clear next step", "We found no book, call or contact button or link on the home page.", evidence({ quote: signal("Clear next step") }));
  const allPhones = input.pages.flatMap(page => page.page.phones), allEmails = input.pages.flatMap(page => page.page.emails), anyAddress = input.pages.some(page => page.page.address);
  // Only when nothing that looks like contact details appears anywhere we read (a number in plain text counts).
  const visibleText = input.pages.map(page => `${page.page.text} ${(input.captures.get(page.finalUrl)?.html ?? "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")}`).join(" ");
  const phoneLike = (visibleText.match(/\+?\d[\d\s().\/-]{5,}\d/g) ?? []).some(value => { const digits = value.replace(/\D/g, "").length; return digits >= 7 && digits <= 15; });
  const emailLike = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(visibleText);
  if (!allPhones.length && !allEmails.length && !anyAddress && !phoneLike && !emailLike && !/href=["']tel:|href=["']mailto:/i.test(html))
    add("no_contact", "No contact details found", `None of the ${input.pages.length} page${input.pages.length === 1 ? "" : "s"} we read shows a phone number, email address or street address.`, evidence({ measured: `${input.pages.length} page(s) read: ${input.pages.map(page => page.finalUrl).join(", ")}`.slice(0, 480) }));
  if (timing && timing.ms > SLOW_MS) add("slow", "Slow to load", `The home page took ${(timing.ms / 1000).toFixed(1)} s to download when we checked on ${day(at)} (one measurement from our server).`, evidence({ measured: `Download time ${timing.ms} ms` }));
  if (input.broken.length) add("broken_links", "Broken links", `${input.broken.length} link${input.broken.length === 1 ? "" : "s"} on the home page lead${input.broken.length === 1 ? "s" : ""} to a missing page: ${input.broken.slice(0, 3).map(item => `“${item.label}”`).join(", ")}.`, evidence({ measured: input.broken.map(item => `${item.url} answered “not found”`).join("; ").slice(0, 480) }));
  const dated = audit.get("dated");
  if (dated) { const year = /© (\d{4})/.exec(dated.detail)?.[1]; add("dated", "Looks out of date", `The footer says © ${year}, which makes the business look inactive.`, evidence({ quote: year ? `© ${year}` : undefined, measured: year ? undefined : "Old copyright year" })); }
  if (audit.has("legacy")) add("legacy", "Built with outdated techniques", "The page uses old layout code (such as font, center or fixed-width tables) that breaks on modern phones.", evidence({ measured: "Outdated layout tags in the page's HTML" }));
  if (audit.has("form")) add("form", "No enquiry form", "Visitors can't send a message from the home page.", evidence({ quote: signal("Enquiry form") }));
  else strengths.push({ id: "form", title: "Has an enquiry form", evidence: evidence({ quote: signal("Enquiry form") }) });
  if (audit.has("phone")) add("phone", "No tap-to-call number", "There's no phone link, so phone visitors can't call with one tap.", evidence({ quote: signal("Tap-to-call") }));
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  if (timing && (timing.bytes > HEAVY_BYTES || scripts > 45)) add("heavy", "Heavy page", `The home page's HTML alone is ${Math.round(timing.bytes / 1000)} KB with ${scripts} scripts, which is slow on mobile data.`, evidence({ measured: `${timing.bytes} bytes of HTML, ${scripts} script tags` }));
  const schema = html ? structuredData(html) : null;
  if (html && !schema) add("structured", "No business details for search engines", "The page has no structured business data (opening hours, address, phone) for Google to read.", evidence({ measured: "No schema.org business data in the page's HTML" }));
  else if (schema) strengths.push({ id: "structured", title: `Structured business data (${schema})`, evidence: evidence({ measured: `schema.org type ${schema}` }) });
  // Conservative: any time range or "opening hours" wording in what we read means we don't claim they're missing.
  const hoursLike = /\b\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)?\s?(?:-|–|—|to|until)\s?\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)?\b|opening hours|opening times|\bopen (?:daily|every|from|mon|tue|wed|thu|fri|sat|sun)/i.test(visibleText);
  if (!hoursLike && !input.pages.some(page => page.page.hours.length)) add("hours", "No opening hours found", `None of the ${input.pages.length} page${input.pages.length === 1 ? "" : "s"} we read lists opening hours.`, evidence({ measured: `${input.pages.length} page(s) read` }));
  if (audit.has("h1")) add("h1", "No main headline", "The home page has no main headline telling visitors what the business does.", evidence({ quote: signal("Main headline") }));
  if (audit.has("description")) add("description", "No search description", "Google has no summary to show under the link.", evidence({ quote: signal("Search description") }));
  const alt = audit.get("alt");
  if (alt) add("alt", "Images aren't described", alt.detail, evidence({ measured: alt.detail }));
  if (audit.has("thin")) add("thin", "Very little text", `The home page has about ${home.page.words} words, too little for visitors or search engines.`, evidence({ measured: `${home.page.words} words of visible text` }));

  const platform = GENERATORS.find(([pattern]) => pattern.test(html.slice(0, 400_000)))?.[1] ?? null;
  return { findings: scoreFindings(findings).findings, strengths: strengths.filter(item => item.evidence.quote || item.evidence.measured), platform };
}

function contactsOf(pages: readonly SitePage[]): ContactFact[] {
  const out: ContactFact[] = [], seen = new Set<string>();
  const push = (kind: ContactFact["kind"], value: string, page: SitePage, line: string) => {
    const clean = plain(value).slice(0, 200), key = `${kind}:${clean.toLowerCase()}`;
    // Only values whose exact line is in the page's citable text.
    if (!clean || seen.has(key) || !page.page.text.includes(line) || out.length >= 12) return;
    seen.add(key); out.push({ kind, value: clean, evidence: { url: page.finalUrl, checkedAt: page.fetchedAt, quote: line.slice(0, 480), sha256: page.sha256 } });
  };
  for (const page of pages) {
    for (const phone of page.page.phones) push("phone", phone, page, `Phone: ${phone}`);
    for (const email of page.page.emails) push("email", email, page, `Email: ${email}`);
    if (page.page.address) push("address", page.page.address, page, `Address: ${page.page.address}`);
    for (const hours of page.page.hours) push("hours", hours, page, `Hours: ${hours}`);
  }
  return out;
}

function unreadable(input: string, url: string | null, reason: InaccessibleReason, checkedAt: string, inaccessible: SiteCheck["inaccessible"]): SiteCheck {
  return { version: CHECKER_VERSION, input: input.slice(0, 500), url, finalUrl: null, host: url ? siteHost(url) || null : null, status: "inaccessible", reason, reasonLabel: INACCESSIBLE_LABEL[reason], checkedAt,
    score: null, band: "unknown", summary: `We couldn't read this site: ${INACCESSIBLE_LABEL[reason].toLowerCase()}. No score is given; check it by hand.`,
    findings: [], strengths: [], contacts: [], platform: null, pages: [], inaccessible, links: { checked: 0, broken: [], unchecked: 0 }, notChecked: NOT_CHECKED };
}

export function noWebsite(checkedAt: string): SiteCheck {
  return { version: CHECKER_VERSION, input: "", url: null, finalUrl: null, host: null, status: "no_website", reason: null, reasonLabel: null, checkedAt, score: null, band: "unknown",
    summary: "No website is listed for this business, so there was nothing to check. If they truly have none, a first website is the obvious offer; confirm before you say so.",
    findings: [], strengths: [], contacts: [], platform: null, pages: [], inaccessible: [], links: { checked: 0, broken: [], unchecked: 0 }, notChecked: NOT_CHECKED };
}

/** Reads and checks one site. Never throws for a site problem; access errors from the cache (42501/P0002) propagate. */
export async function checkWebsite(raw: string | null | undefined, options: { deps?: CheckDeps; now?: () => number } = {}): Promise<SiteCheck> {
  const now = options.now ?? Date.now, clock = options.deps?.clock ?? (() => performance.now());
  const input = (raw ?? "").trim();
  if (!input) return noWebsite(iso(now()));
  let url: string;
  try { url = normalizeUrl(input); } catch { return unreadable(input, null, "invalid", iso(now()), [{ target: input.slice(0, 300), reason: "invalid", detail: INACCESSIBLE_LABEL.invalid }]); }
  const captures = new Map<string, Capture>(), cache = memoryCache();
  const deps = (maxBytes: number): FetchDeps => ({ fetcher: recording(options.deps?.fetcher ?? pinnedFetcher(maxBytes), captures, clock), resolve: options.deps?.resolve });
  const read = await readClientSite({ url, competitors: [], readSubpages: true, cache, deps: deps(CHECK_LIMITS.maxPageBytes), now,
    limits: { maxPages: CHECK_LIMITS.maxPages, timeMs: CHECK_LIMITS.timeMs, maxPageBytes: CHECK_LIMITS.maxPageBytes, maxBytes: CHECK_LIMITS.maxBytes } });
  const home = read.pages.find(page => page.role === "home");
  if (!home) return unreadable(input, url, read.inaccessible[0]?.reason ?? "error", iso(now()), read.inaccessible.slice(0, 10));

  // Links on the home page that we didn't read: does each one answer? (robots honoured, tiny byte cap; an answer too large still answered.)
  const readUrls = new Set(read.pages.flatMap(page => [page.url, page.finalUrl]));
  const candidates = linksToCheck(home, captures.get(home.finalUrl)?.html ?? "", readUrls, CHECK_LIMITS.links);
  const outcomes = await Promise.all(candidates.map(async link => {
    const result = await readClientSite({ url: link.url, competitors: [], readSubpages: false, cache, deps: deps(CHECK_LIMITS.linkBytes), now,
      limits: { maxPages: 1, timeMs: CHECK_LIMITS.linkTimeMs, maxPageBytes: CHECK_LIMITS.linkBytes, maxBytes: CHECK_LIMITS.linkBytes + 25_000 } }).catch(() => null);
    const reason = result?.inaccessible[0]?.reason;
    return { link, state: result?.pages.length || reason === "too_large" || reason === "not_html" ? "ok" as const : reason === "not_found" ? "broken" as const : "unchecked" as const };
  }));
  const broken = outcomes.filter(item => item.state === "broken").map(item => item.link);

  const site = read.pages.filter(page => page.role !== "competitor");
  const { findings, strengths, platform } = findingsFromPages({ home, pages: site, captures, broken, now: new Date(now()) });
  const scored = scoreFindings(findings);
  return {
    version: CHECKER_VERSION, input: input.slice(0, 500), url, finalUrl: home.finalUrl, host: siteHost(home.finalUrl) || null, status: "checked", reason: null, reasonLabel: null, checkedAt: home.fetchedAt,
    score: scored.score, band: scored.band, summary: scored.summary, findings: scored.findings, strengths, contacts: contactsOf(site), platform,
    pages: site.map(page => ({ url: page.finalUrl, role: page.role, fetchedAt: page.fetchedAt, sha256: page.sha256, bytes: page.bytes })),
    inaccessible: read.inaccessible.slice(0, 10),
    links: { checked: outcomes.filter(item => item.state !== "unchecked").length, broken, unchecked: outcomes.filter(item => item.state === "unchecked").length },
    notChecked: [...NOT_CHECKED, ...read.notRead.slice(0, 5).map(item => `${item.url} (not read: page or time limit)`)],
  };
}
