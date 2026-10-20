/** Per-page publish report (audit RSR §2, reconciliation part-3 #22/#31/#38): for
 * each prepared route, what visitors and search engines will get — title,
 * description, canonical address, robots/indexing and share image — read from
 * the prepared output itself, plus one plain line on who can see the site.
 * Pure and client-safe; no network.
 *
 * Limits: it reads the prepared HTML, not the live server's response, so HTTP
 * status and response headers aren't observed here. Indexing follows the
 * hosting policy (the site Worker): test and local addresses send noindex on
 * every page; otherwise the home page and every published page are listed in
 * sitemap.xml and may be indexed, unless a page carries its own robots noindex. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–", middot: "·" };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => name[0] === "#"
  ? String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)) : ENTITIES[name.toLowerCase()] ?? whole).trim();
const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? "") : null;
};
function meta(head: string, key: "name" | "property", value: string) {
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) if (attribute(tag, key)?.toLowerCase() === value) return attribute(tag, "content");
  return null;
}

export type PreparedHead = { title: string | null; description: string | null; canonical: string | null; robots: string | null; socialImage: string | null; h1: number };
export function readPreparedHead(html: string): PreparedHead {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const canonical = (head.match(/<link\b[^>]*>/gi) ?? []).find(tag => attribute(tag, "rel")?.toLowerCase() === "canonical");
  return {
    title: title === undefined ? null : decode(title.replace(/<[^>]*>/g, "")) || null,
    description: meta(head, "name", "description") || null,
    canonical: canonical ? attribute(canonical, "href") || null : null,
    robots: meta(head, "name", "robots") || null,
    socialImage: meta(head, "property", "og:image") || null,
    h1: (html.match(/<h1\b/gi) ?? []).length,
  };
}

export type IndexingPolicy = { indexable: boolean; reason: "test" | "local" | "public" };
/** From what the app knows: a test-workspace address list (staging) or a localhost
 * site template means the Worker serves noindex; otherwise indexing is allowed. */
export function indexingPolicy(input: { testAddresses: boolean; localHosting: boolean }): IndexingPolicy {
  if (input.localHosting) return { indexable: false, reason: "local" };
  if (input.testAddresses) return { indexable: false, reason: "test" };
  return { indexable: true, reason: "public" };
}

/** One plain line on audience and indexing, shown near the publish consent and after publishing. */
export function audienceLine(policy: IndexingPolicy) {
  if (policy.reason === "local") return "Who can see it: only this computer. Local test addresses are never indexed by search engines.";
  if (policy.reason === "test") return "Who can see it: anyone with the address, but it’s a test address: every page is sent with noindex, so search engines are told not to list it.";
  return "Who can see it: anyone with the address — no sign-in. Search engines may find and list the home page and every published page (each is in the site’s sitemap). Makeborne can’t control whether or how they rank it.";
}

export type RouteReport = {
  path: string; status: "ready" | "check"; problems: string[];
  title: string | null; description: string | null; canonical: string | null; socialImage: string | null;
  robots: string | null; index: "allowed" | "noindex-policy" | "noindex-page";
};
const pathOf = (url: string) => { try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch { return null; } };

/** `address`: the site's own address (it may carry a path, such as https://sites.makeborne.com/slug).
 * A canonical is right when its path is the route's path under that address, or the route's
 * path at a domain root (a connected custom domain); its host isn't judged here. */
export function publishReport(routes: readonly { path: string; html: string }[], policy: IndexingPolicy, address?: string): RouteReport[] {
  const base = address ? pathOf(address) ?? "/" : "/";
  const join = (path: string) => (base === "/" ? path : `${base}${path === "/" ? "" : path}`).replace(/\/+$/, "") || "/";
  return routes.map(route => {
    const head = readPreparedHead(route.html), problems: string[] = [];
    if (!head.title) problems.push("No page title");
    if (!head.description) problems.push("No description");
    if (!head.canonical) problems.push("No canonical address");
    else if (![route.path.replace(/\/+$/, "") || "/", join(route.path)].includes(pathOf(head.canonical) ?? "")) problems.push(`Canonical points to ${pathOf(head.canonical) ?? "an invalid address"}`);
    if (head.h1 !== 1) problems.push(head.h1 ? `${head.h1} main headings` : "No main heading");
    const pageNoindex = !!head.robots && /\bnoindex\b|\bnone\b/i.test(head.robots);
    return { path: route.path, status: problems.length ? "check" : "ready", problems, title: head.title, description: head.description, canonical: head.canonical,
      socialImage: head.socialImage, robots: head.robots, index: !policy.indexable ? "noindex-policy" : pageNoindex ? "noindex-page" : "allowed" };
  });
}

export const INDEX_LABELS: Record<RouteReport["index"], string> = {
  allowed: "May be indexed", "noindex-policy": "Not indexed (test or local address)", "noindex-page": "Not indexed (page says noindex)",
};
