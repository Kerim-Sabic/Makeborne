import { replaceElements } from "../html/scan";
import { pinnedPageFetch, readPublicPage, type Fetcher, type Lookup, type PageFacts } from "../mail/research";

/**
 * Reads a lead's own public page under the research guard rails (public
 * addresses only, size and time limits, re-checked redirects) and keeps what a
 * first email needs: what they do, a public business email, social links.
 */

const JUNK = /\.(png|jpe?g|gif|webp|svg|avif|css|js)$|@(2x|3x)\b|example\.|sentry|wixpress|domain\.com|email\.com|yourdomain|yourname|u003e|^[0-9a-f]{20,}@/i;

/** Cloudflare's email protection: a hex string XOR-ed with its first byte. */
export function decodeCfEmail(hex: string) {
  if (!/^[0-9a-f]{4,200}$/i.test(hex) || hex.length % 2) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Public emails on a page, the site's own domain and role addresses (info@, hello@) first. */
export function extractEmails(html: string, siteHost: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const email = decodeURIComponent(raw).trim().replace(/^mailto:/i, "").split("?")[0].toLowerCase();
    if (/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$/.test(email) && !JUNK.test(email)) found.add(email);
  };
  for (const match of html.matchAll(/mailto:([^"'\s>?]+)/gi)) { try { add(match[1]); } catch { /* malformed escape */ } }
  for (const match of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) add(decodeCfEmail(match[1]));
  // Same result as html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "), in linear time (an unclosed <script is read once, not from every start).
  const text = replaceElements(html, ["script", "style"], { open: "name", boundary: false });
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}/g)) add(match[0]);
  const host = siteHost.replace(/^www\./, "").toLowerCase();
  const rank = (email: string) => (email.endsWith(`@${host}`) ? 0 : 2) + (/^(info|hello|contact|office|kontakt|studio|team|hi|mail)@/.test(email) ? 0 : 1);
  return [...found].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

/** Social profile links on a page (the first of each network). */
export function extractSocials(html: string) {
  const first = (pattern: RegExp) => pattern.exec(html)?.[0]?.replace(/["'<>].*$/, "") ?? "";
  return {
    instagram: first(/https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)[A-Za-z0-9_.]{2,30}\/?/i),
    facebook: first(/https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|plugins|tr\b)[A-Za-z0-9_.-]{2,60}\/?/i),
    linkedin: first(/https?:\/\/(?:[a-z]{2}\.|www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_-]{2,80}\/?/i),
  };
}

/** A same-site contact or about page linked from this page, if any. */
export function contactLink(html: string, base: URL) {
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    if (!/(contact|kontakt|impressum|imprint|about|o-nama|ueber-uns|uber-uns)/i.test(match[1])) continue;
    try {
      const url = new URL(match[1], base);
      if (url.hostname === base.hostname && /^https?:$/.test(url.protocol) && url.pathname !== base.pathname) return url.toString();
    } catch { /* not a link */ }
  }
  return "";
}

/** readPublicPage that also hands back the final page's HTML (capped) for email and link extraction. */
export async function readWithHtml(raw: string, deps: { fetcher?: Fetcher; resolve?: Lookup } = {}): Promise<{ facts: PageFacts; html: string }> {
  const inner = deps.fetcher ?? pinnedPageFetch;
  let html: Promise<string> = Promise.resolve("");
  const capture: Fetcher = async (url, init, addresses) => {
    const response = await inner(url, init, addresses);
    if (!response.ok || !response.body) return response;
    const [page, copy] = response.body.tee();
    html = (async () => {
      const reader = copy.getReader(), parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); size += value.length;
          if (size > 600_000) { await reader.cancel(); break; }
        }
      } catch { /* the reader side was cancelled */ }
      return new TextDecoder().decode(Buffer.concat(parts));
    })();
    return new Response(page, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const facts = await readPublicPage(raw, { fetcher: capture, resolve: deps.resolve });
  return { facts, html: await html };
}

export type Enriched = {
  ok: boolean; reason: string; url: string; platform: string; title: string; description: string; handle: string | null;
  followers: string | null; posts: string | null; bio: string; emails: string[]; instagram: string; facebook: string; linkedin: string;
};

/** TikTok network research is disabled pending a reviewed official integration. */
export async function tiktokProfile(raw: string, fetcher: typeof fetch = fetch): Promise<Enriched> {
  void fetcher;
  const handle = null;
  const base: Enriched = { ok: false, reason: "Profile not found", url: raw, platform: "TikTok", title: "", description: "", handle: handle ?? null, followers: null, posts: null, bio: "", emails: [], instagram: "", facebook: "", linkedin: "" };
  return { ...base, reason: "Social-platform research is disabled. Use the business website instead." };
}

/** No YouTube network access until a separate official integration is reviewed. */
export async function youtubeChannel(raw: string, fetcher: typeof fetch = fetch): Promise<Enriched> {
  void fetcher;
  const handle = null;
  const base: Enriched = { ok: false, reason: "Channel not found", url: raw, platform: "YouTube", title: "", description: "", handle: handle ?? null, followers: null, posts: null, bio: "", emails: [], instagram: "", facebook: "", linkedin: "" };
  return { ...base, reason: "Social-platform research is disabled. Use the business website instead." };
}

/** Subscriber count on a YouTube channel page ("1.2M subscribers"). */
export const youtubeSubscribers = (html: string) => /"([\d.,]+\s?[KMB]?)\s+subscribers"/i.exec(html)?.[1]?.replace(/\s/g, "") ?? /([\d.,]+\s?[KMB]?)\s+subscribers/i.exec(html)?.[1]?.replace(/\s/g, "") ?? null;

/** Reads the lead's page (and a contact page when no email shows), never throwing. */
export async function enrichPage(raw: string, deps: { fetcher?: Fetcher; resolve?: Lookup; oembed?: typeof fetch } = {}): Promise<Enriched> {
  const empty: Enriched = { ok: false, reason: "", url: raw, platform: "Website", title: "", description: "", handle: null, followers: null, posts: null, bio: "", emails: [], instagram: "", facebook: "", linkedin: "" };
  if (/^https:\/\/www\.tiktok\.com\/@/.test(raw)) return tiktokProfile(raw, deps.oembed);
  if (/^https:\/\/www\.youtube\.com\/(@|channel\/)/.test(raw)) return youtubeChannel(raw, deps.oembed);
  try {
    const { facts, html } = await readWithHtml(raw, deps);
    const url = new URL(facts.url);
    // Creators often put a business email in their bio; websites publish it on the page.
    let emails = facts.platform === "Website" ? extractEmails(html, url.hostname) : extractEmails(`${facts.bio} ${facts.description}`, "");
    const socials = facts.platform === "Website" ? extractSocials(html) : { instagram: "", facebook: "", linkedin: "" };
    if (facts.platform === "Website" && !emails.length) {
      const contact = contactLink(html, url);
      if (contact) { try { const page = await readWithHtml(contact, deps); emails = extractEmails(page.html, url.hostname); } catch { /* contact page unreadable */ } }
    }
    const youtube = facts.platform === "YouTube";
    return { ok: true, reason: "", url: facts.url, platform: facts.platform, title: facts.title, description: facts.description, handle: youtube ? url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") ?? facts.handle : facts.handle,
      followers: youtube ? youtubeSubscribers(html) : facts.followers, posts: facts.posts, bio: facts.bio, emails, ...socials, instagram: socials.instagram || (facts.platform === "Instagram" ? facts.url : "") };
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${(error as { cause?: { code?: string } }).cause?.code ?? ""}` : "";
    const reason = /ENOTFOUND|EAI_AGAIN/.test(text) ? "Website not found" : /timeout|aborted/i.test(text) ? "Website too slow" : /blocks automated/i.test(text) ? "Blocks automated reading" : "Website unreachable";
    return { ...empty, reason };
  }
}

/** Runs tasks with a fixed number in flight, reporting each completion. */
export async function pool<T, R>(items: T[], size: number, task: (item: T) => Promise<R>, onDone?: (done: number) => void, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      results[index] = await task(items[index]);
      onDone?.(++done);
    }
  }));
  return results;
}
