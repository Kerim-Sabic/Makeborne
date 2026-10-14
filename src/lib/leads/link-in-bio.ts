import { readWithHtml, extractEmails, contactLink } from "./enrich";
import { handleOf } from "./finder-types";
import type { Fetcher, Lookup } from "../mail/research";

/**
 * Link-in-bio pages (Linktree, Beacons, Stan and similar) are where creators
 * list their email and their own website. We follow a link written in the bio,
 * or check the creator's handle on the common hubs, and only trust a guessed hub
 * page when it links back to the same profile (so a stranger with the same
 * name is never mixed in). Everything goes through the guarded page reader.
 */
export const LINK_HUBS = ["linktr.ee", "beacons.ai", "stan.store", "bio.link", "linkin.bio", "campsite.bio", "solo.to", "tap.bio", "msha.ke", "hoo.be", "lnk.bio", "allmylinks.com", "snipfeed.co", "koji.to", "linkpop.com", "komi.io", "carrd.co"];
/** Hubs worth guessing by handle (public pages that answer plain requests). */
const GUESSABLE = ["linktr.ee", "stan.store"];
/** Affiliate and tracking networks: a creator's promo links, never their own site. */
const AFFILIATE = /(^|\.)(sjv\.io|pxf\.io|linksynergy\.com|shareasale\.com|awin1\.com|impact\.com|partnerize\.com|go2cloud\.org|skimresources\.com|rstyle\.me|shopstyle\.it|geni\.us|amzn\.to|bit\.ly|tinyurl\.com|rebrand\.ly|lnk\.to|smarturl\.it|ffm\.to|hyperurl\.co|confirmsubscription\.com|mailchi\.mp|eepurl\.com|kit\.com|convertkit\.com|beehiiv\.com|substack\.com|gofund\.me)$/i;
/** Lowercase letters and digits only: "Veggie.Nerd" and "veggie_nerd" compare equal. */
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Not a creator's own website: social networks, stores, music, link shorteners. */
const NOT_OWN = /(^|\.)(instagram|tiktok|youtube|youtu|facebook|fb|twitter|x|threads|pinterest|spotify|apple|music\.apple|amazon|amzn|snapchat|twitch|discord|patreon|onlyfans|whatsapp|wa|t|telegram|linkedin|google|bit|tinyurl|linktr|beacons|stan|bio|linkin|campsite|solo|tap|msha|hoo|lnk|allmylinks|snipfeed|koji|linkpop|komi|shopmy|ltk|liketoknow|amzlink|gofundme|paypal|venmo|cash|ko-fi|buymeacoffee|substack|medium|soundcloud|vimeo|reddit|tumblr|etsy|depop|vinted|ebay|shein|temu|zara|hm|nike|adidas)\.[a-z.]+$/i;

export type BioLink = { email: string; emailFrom: "link" | ""; website: string; hub: string };
type Deps = { fetcher?: Fetcher; resolve?: Lookup };

const hostOf = (raw: string) => { try { return new URL(raw).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const isHub = (raw: string) => LINK_HUBS.some(hub => hostOf(raw) === hub || hostOf(raw).endsWith(`.${hub}`));

/** URLs written in a bio ("linktr.ee/mia", "www.miacooks.com"), never the domain part of an email address. */
export function bioUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(^|[\s(|•·,])((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/[^\s"'<>()|•]*)?)/gi)) {
    const raw = match[2].replace(/[.,;:!?]+$/, "");
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = hostOf(url);
    if (!host || /\.(png|jpe?g|gif|mp4|pdf)$/i.test(host) || /^(instagram|tiktok|youtube)\.com$/.test(host)) continue;
    if (!found.includes(url)) found.push(url);
  }
  return found.slice(0, 3);
}

/**
 * The creator's own website among a hub page's links: a domain that matches
 * their handle or name, or a link they titled "my website / store / blog".
 * Affiliate, brand and promo links are never picked.
 */
export function ownSite(html: string, who: { handle: string | null; name: string }): string {
  const links: { url: string; title: string }[] = [];
  for (const match of html.matchAll(/"title":"([^"]{1,160})"[^{}]{0,400}?"url":"(https?:[^"\s]+)"/g)) links.push({ title: match[1], url: match[2].replace(/\\u0026/gi, "&").replace(/\\u002F/gi, "/") });
  for (const match of html.matchAll(/<a[^>]+href="(https?:\/\/[^"\s]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) links.push({ url: match[1], title: match[2].replace(/<[^>]+>/g, " ") });
  const keys = [who.handle ?? "", who.name].map(squash).filter(key => key.length >= 5);
  const usable = links.filter(link => { const host = hostOf(link.url); return host && !NOT_OWN.test(host) && !AFFILIATE.test(host) && !isHub(link.url); });
  const byDomain = usable.find(link => { const domain = squash(hostOf(link.url).split(".").slice(0, -1).join("")); return domain.length >= 5 && keys.some(key => key.includes(domain) || domain.includes(key)); });
  const byTitle = usable.find(link => /\b(my|our|official)\s+(web\s?site|site|store|shop|blog|portfolio|recipes?|book|course)\b|^\s*(web\s?site|blog|shop)\s*$/i.test(link.title));
  const pick = byDomain ?? byTitle;
  return pick ? `${new URL(pick.url).protocol}//${new URL(pick.url).hostname}/` : "";
}

/** The username a hub page belongs to (Linktree, Stan and others publish it in their page data). */
export const hubUsername = (html: string) => /"username":"([^"]{2,40})"/.exec(html)?.[1] ?? /"pageTitle":"@([^"]{2,40})"/.exec(html)?.[1] ?? "";

/** Does this hub page link back to the creator's profile? */
export const linksBack = (html: string, profileUrl: string) => {
  const key = handleOf(profileUrl);
  return Boolean(key) && html.toLowerCase().replace(/www\./g, "").includes(key);
};

async function readSite(url: string, deps: Deps) {
  try {
    const { facts, html } = await readWithHtml(url, deps);
    const host = new URL(facts.url).hostname;
    let emails = extractEmails(html, host);
    if (!emails.length) {
      const contact = contactLink(html, new URL(facts.url));
      if (contact) { try { emails = extractEmails((await readWithHtml(contact, deps)).html, host); } catch { /* contact page unreadable */ } }
    }
    return { url: facts.url, emails };
  } catch { return null; }
}

/**
 * Contact details from a creator's link-in-bio. Returns null when nothing
 * trustworthy is found. Bounded: at most a hub page, one website and its
 * contact page, all under the reader's time and size limits.
 */
export async function followLinkInBio(input: { profileUrl: string; handle: string | null; bio: string; name?: string }, deps: Deps = {}): Promise<BioLink | null> {
  const written = bioUrls(input.bio);
  const hubsFromBio = written.filter(isHub);
  const sitesFromBio = written.filter(url => !isHub(url) && !NOT_OWN.test(hostOf(url)));
  // The handle as written and without dots or underscores (people often drop them on other sites).
  const spellings = input.handle && /^[A-Za-z0-9_.-]{2,40}$/.test(input.handle) ? [...new Set([input.handle, input.handle.replace(/[._-]/g, "")])] : [];
  const guesses = GUESSABLE.flatMap(hub => spellings.map(spelling => `https://${hub}/${spelling}`));
  // A hub the creator linked is theirs; a guessed one must link back to their profile or be registered to the same username.
  for (const [url, guessed] of [...hubsFromBio.map(url => [url, false] as const), ...guesses.filter(url => !hubsFromBio.includes(url)).map(url => [url, true] as const)]) {
    let page: { html: string; facts: { url: string } };
    try { page = await readWithHtml(url, deps); } catch { continue; }
    if (guessed && !linksBack(page.html, input.profileUrl) && !(input.handle && squash(hubUsername(page.html)) === squash(input.handle))) continue;
    const hubEmails = extractEmails(page.html.replace(/"[a-z]+":"[^"]*linktr\.ee[^"]*"/gi, ""), "").filter(email => !/@(linktr\.ee|linktree\.com|stan\.store|beacons\.ai)$/i.test(email));
    const site = ownSite(page.html, { handle: input.handle, name: input.name ?? "" }) || sitesFromBio[0];
    const read = site ? await readSite(site, deps) : null;
    const email = hubEmails[0] ?? read?.emails[0] ?? "";
    return { email, emailFrom: email ? "link" : "", website: read?.url ?? site ?? "", hub: page.facts.url };
  }
  if (sitesFromBio.length) {
    const read = await readSite(sitesFromBio[0], deps);
    if (read) return { email: read.emails[0] ?? "", emailFrom: read.emails[0] ? "link" : "", website: read.url, hub: "" };
  }
  return null;
}
